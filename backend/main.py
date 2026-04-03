import importlib
import json
import os
import re
import hashlib
import time
from urllib.parse import urlsplit, urlunsplit
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from bs4 import BeautifulSoup

try:
    from .config import load_backend_env
except ImportError:
    from config import load_backend_env

load_backend_env()

try:
    from . import models, schemas
    from .database import SessionLocal, engine, ensure_sqlite_schema
    from .services.marketplace_service import detect_source_key_from_url, get_source_label, normalize_source_key, search_marketplace_products
    from .services.crawl_framework import CrawlRequest, CrawlSpider, ProxyRotator, RequestsSession, ScraplingSession, SpiderRunner
    from .services.product_service import (
        compute_recommendation_details,
        compute_trend,
        get_product_data,
        resolve_asin,
    )
    from .services.scraper_service import fetch_amazon_price_scraper
    from .services.scrapy_runner import fetch_price_with_local_scrapy
    from .services.scrapling_service import fetch_amazon_price_with_scrapling
    from .services.zyte_client import fetch_price_from_zyte
    from .services.telegram_client import is_telegram_configured, send_triggered_alert
    from .services.email_client import is_email_configured, send_email_alert
except ImportError:
    import models
    import schemas
    from database import SessionLocal, engine, ensure_sqlite_schema
    from services.marketplace_service import detect_source_key_from_url, get_source_label, normalize_source_key, search_marketplace_products
    from services.crawl_framework import CrawlRequest, CrawlSpider, ProxyRotator, RequestsSession, ScraplingSession, SpiderRunner
    from services.product_service import (
        compute_recommendation_details,
        compute_trend,
        get_product_data,
        resolve_asin,
    )
    from services.scraper_service import fetch_amazon_price_scraper
    from services.scrapy_runner import fetch_price_with_local_scrapy
    from services.scrapling_service import fetch_amazon_price_with_scrapling
    from services.zyte_client import fetch_price_from_zyte
    from services.telegram_client import is_telegram_configured, send_triggered_alert
    from services.email_client import is_email_configured, send_email_alert


models.Base.metadata.create_all(bind=engine)
ensure_sqlite_schema()

app = FastAPI(title="PricePulse API")


def _default_refresh_interval_minutes() -> int:
    try:
        return max(15, int(os.getenv("PRICEPULSE_DEFAULT_REFRESH_INTERVAL_MINUTES", "360")))
    except Exception:
        return 360


def _canonicalize_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    value = str(raw_url).strip()
    if not value:
        return None
    try:
        parts = urlsplit(value)
        parts = parts._replace(fragment="")
        return urlunsplit(parts)
    except Exception:
        return value


def _url_fingerprint(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()  # noqa: S324


def _effective_target_bounds(
    *,
    target_price_min: float | None,
    target_price_max: float | None,
    target_price: float | None = None,
) -> tuple[float | None, float | None]:
    target_min = float(target_price_min) if target_price_min is not None else None
    target_max = float(target_price_max) if target_price_max is not None else None
    fallback = float(target_price) if target_price is not None else None

    if target_min is None and target_max is None and fallback is not None:
        return fallback, fallback
    if target_min is None and target_max is not None:
        return target_max, target_max
    if target_max is None and target_min is not None:
        return target_min, target_min
    return target_min, target_max


def _enforce_target_below_current_price(target_max: float, current_price: float | None, *, context: str) -> None:
    """
    Guardrail: target should represent a drop from current listing price.
    """
    enforce = os.getenv("PRICEPULSE_ENFORCE_TARGET_BELOW_CURRENT", "1") == "1"
    if not enforce or current_price is None:
        return

    current = float(current_price)
    target = float(target_max)
    if target >= current:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{context}: target_price_max must be lower than the current listed price "
                f"(current Rs. {current:,.2f}, target max Rs. {target:,.2f})."
            ),
        )


def _resolve_current_price_for_guardrail(product: models.Product) -> float | None:
    """
    Resolve a current price for strict target validation:
    1) latest stored history
    2) live fetch fallback
    """
    latest_price_attr = getattr(product, "latest_price", None)
    if latest_price_attr is not None:
        try:
            return float(latest_price_attr)
        except Exception:
            pass

    db = SessionLocal()
    try:
        latest_entry = _get_latest_price_entry(db, product.id)
    finally:
        db.close()

    if latest_entry and latest_entry.price is not None:
        try:
            return float(latest_entry.price)
        except Exception:
            pass

    try:
        live = get_product_data(
            product.asin,
            source_key=product.source_key,
            external_id=product.external_id,
            product_url=product.product_url,
        )
        if live and live.get("price") is not None:
            return float(live["price"])
    except Exception:
        return None
    return None


def _classify_deal_status(
    *,
    current_price: float | None,
    historical_low: float | None,
    average_30d: float | None,
    target_price_min: float | None,
    target_price_max: float | None,
    history_points: int = 0,
) -> tuple[str | None, str | None]:
    if current_price is None:
        return None, None

    current = float(current_price)
    epsilon = max(1.0, 0.002 * current)

    low = float(historical_low) if historical_low is not None else None
    avg = float(average_30d) if average_30d is not None else None
    target_min = float(target_price_min) if target_price_min is not None else None
    target_max = float(target_price_max) if target_price_max is not None else None
    has_target = target_max is not None
    target_hit = has_target and current <= (target_max + epsilon)
    enough_history_for_low_call = int(history_points) >= 3

    if has_target and not target_hit:
        gap = current - target_max
        return "HOLD ON", f"Current price is still Rs. {gap:,.0f} above your target ceiling."

    # Good Deal: inside target band or meaningfully below the 30D average.
    if target_min is not None and target_max is not None and target_hit:
        if (target_min - epsilon) <= current <= (target_max + epsilon):
            return "GOOD DEAL", "Current price is inside your target range."
        return "GOOD DEAL", "Current price is at or below your target ceiling."

    # Buy Now: at/near the historical low, but only after enough history.
    if target_hit and low is not None and enough_history_for_low_call:
        near_low_threshold = low * (1.0 + float(os.getenv("PRICEPULSE_NEAR_LOW_PCT", "0.02")))
        if current <= (near_low_threshold + epsilon):
            return "BUY NOW", "Current price is at or near the lowest price you have tracked."

    if avg is not None and target_hit:
        good_deal_pct = float(os.getenv("PRICEPULSE_GOOD_DEAL_PCT", "0.05"))
        if current <= (avg * (1.0 - good_deal_pct) + epsilon):
            return "GOOD DEAL", "Current price is a solid discount versus the recent average."

    if has_target:
        return "HOLD ON", "Current price has reached your target, but there is not enough history for a strong buy-now call yet."
    return "HOLD ON", "Current price is not a strong deal right now."


def _parse_cors_origins_from_env() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    if not raw.strip():
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


def _get_requested_fetch_mode(request: Request) -> str:
    raw = request.headers.get("x-pricepulse-fetch-mode", "")
    normalized = raw.strip().lower()
    if normalized == "zyte-only":
        return "zyte-only"
    return "auto"


app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins_from_env(),
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://[a-z0-9-]+\.onrender\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"message": "PricePulse API is running successfully"}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/keepalive")
def keepalive():
    return {
        "status": "alive",
        "service": "pricepulse-backend",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/notifications/status")
def notifications_status():
    configured = is_telegram_configured()
    email_configured = is_email_configured()
    return {
        "telegram_configured": configured,
        "email_configured": email_configured,
        "channels": {
            "telegram": configured,
            "email": email_configured,
        },
    }


@app.post("/notifications/test")
def test_notification():
    simulated_current_price = 1999.0
    simulated_target_price = 1499.0
    sent, error_message = send_triggered_alert(
        product_name="PricePulse Telegram test",
        current_price=simulated_current_price,
        target_price=simulated_target_price,
        product_id=-1,
        deal_status="TEST MESSAGE",
        deal_reason=(
            "This is a connectivity test only. "
            "Live buy/wait and trigger decisions come from your tracked product data."
        ),
    )
    return {
        "sent": bool(sent),
        "detail": "Test alert delivered to Telegram." if sent else (error_message or "Telegram delivery failed."),
        "mode": "test_only",
        "note": "This endpoint does not evaluate live price logic.",
    }


def _build_product_purchase_url(product: models.Product) -> str | None:
    if product.product_url:
        return str(product.product_url)

    asin = (product.asin or "").strip()
    if asin:
        return f"https://www.amazon.in/dp/{asin}"
    return None


def _mean(values: list[float]) -> float | None:
    cleaned = [float(value) for value in values if value is not None]
    if not cleaned:
        return None
    return sum(cleaned) / len(cleaned)


def _get_history_rows(
    db: Session,
    product_id: int,
    *,
    days: int | None = None,
    limit: int | None = None,
    descending: bool = True,
):
    query = db.query(models.PriceHistory).filter(models.PriceHistory.product_id == product_id)

    if days is not None:
        since = datetime.utcnow() - timedelta(days=int(days))
        query = query.filter(models.PriceHistory.timestamp >= since)

    order_column = models.PriceHistory.timestamp.desc() if descending else models.PriceHistory.timestamp.asc()
    query = query.order_by(order_column)

    if limit is not None:
        query = query.limit(int(limit))

    return query.all()


def _get_recent_prices(db: Session, product_id: int, limit: int = 10) -> list[float]:
    rows = _get_history_rows(db, product_id, limit=max(5, min(30, int(limit))), descending=True)
    rows.reverse()
    return [float(row.price) for row in rows if row.price is not None]


def _get_latest_price_entry(db: Session, product_id: int):
    return (
        db.query(models.PriceHistory)
        .filter(models.PriceHistory.product_id == product_id)
        .order_by(models.PriceHistory.timestamp.desc())
        .first()
    )


def _attach_product_insights(db: Session, product: models.Product) -> models.Product:
    prices_recent = _get_recent_prices(db, product.id, limit=10)
    prices_7d = [float(row.price) for row in _get_history_rows(db, product.id, days=7, descending=False) if row.price is not None]
    prices_30d = [float(row.price) for row in _get_history_rows(db, product.id, days=30, descending=False) if row.price is not None]
    reference_prices = prices_30d or prices_recent

    historical_low_row = (
        db.query(models.PriceHistory)
        .filter(models.PriceHistory.product_id == product.id)
        .filter(models.PriceHistory.price.isnot(None))
        .order_by(models.PriceHistory.price.asc(), models.PriceHistory.timestamp.asc())
        .first()
    )
    product.historical_low = float(historical_low_row.price) if historical_low_row and historical_low_row.price is not None else None
    product.historical_low_timestamp = historical_low_row.timestamp if historical_low_row else None

    product.purchase_url = _build_product_purchase_url(product)
    product.source = product.source or "Amazon India"
    if not product.last_fetch_method:
        latest_entry = _get_latest_price_entry(db, product.id)
        if latest_entry and latest_entry.fetch_method:
            product.last_fetch_method = latest_entry.fetch_method

    if reference_prices:
        latest_price = reference_prices[-1]
        average_7d = _mean(prices_7d)
        average_30d = _mean(prices_30d)
        details = compute_recommendation_details(
            reference_prices,
            average_reference=average_30d,
            target_price_min=product.target_price_min,
            target_price_max=product.target_price_max,
            target_price=product.target_price,
        )

        product.latest_price = latest_price
        product.trend = compute_trend(reference_prices[-10:]) if len(reference_prices) > 1 else None
        product.recommendation = details.get("recommendation")
        product.recommendation_reason = details.get("recommendation_reason")
        product.average_7d = average_7d
        product.average_30d = average_30d
        product.delta_from_avg = details.get("delta_from_avg")
        product.delta_from_avg_pct = details.get("delta_from_avg_pct")
        product.prediction = details.get("prediction")
        product.prediction_confidence = details.get("prediction_confidence")

        effective_min, effective_max = _effective_target_bounds(
            target_price_min=product.target_price_min,
            target_price_max=product.target_price_max,
            target_price=product.target_price,
        )
        deal_status, deal_reason = _classify_deal_status(
            current_price=float(latest_price) if latest_price is not None else None,
            historical_low=product.historical_low,
            average_30d=average_30d,
            target_price_min=effective_min,
            target_price_max=effective_max,
            history_points=len(reference_prices),
        )
        product.deal_status = deal_status
        if deal_status:
            product.recommendation = deal_status
        if deal_reason:
            product.recommendation_reason = deal_reason

        if not product.last_updated:
            newest = _get_latest_price_entry(db, product.id)
            if newest:
                product.last_updated = newest.timestamp
    else:
        product.latest_price = None
        product.historical_low = None
        product.historical_low_timestamp = None
        product.trend = None
        product.recommendation = None
        product.recommendation_reason = None
        product.deal_status = None
        product.average_7d = None
        product.average_30d = None
        product.delta_from_avg = None
        product.delta_from_avg_pct = None
        product.prediction = None
        product.prediction_confidence = None

    return product


def _notify_alert_if_possible(
    alert: models.Alert,
    product: models.Product,
    current_price: float,
    db: Session,
    *,
    deal_status: str | None = None,
    deal_reason: str | None = None,
):
    if alert.notification_sent_flag:
        return

    any_sent = False
    errors: list[str] = []

    if getattr(alert, "telegram_enabled", True):
        sent, error_message = send_triggered_alert(
            product_name=product.name,
            current_price=float(current_price),
            target_price_min=alert.target_price_min,
            target_price_max=alert.target_price_max,
            target_price=float(alert.target_price) if alert.target_price is not None else None,
            product_id=product.id,
            deal_status=deal_status,
            deal_reason=deal_reason,
            purchase_url=_build_product_purchase_url(product),
            historical_low=getattr(product, "historical_low", None),
        )
        any_sent = any_sent or bool(sent)
        if not sent and error_message:
            errors.append(f"telegram: {error_message}")

    if getattr(alert, "email_enabled", False):
        subject = f"PricePulse: {deal_status or 'Alert'} — {product.name}"
        body = (
            f"Product: {product.name}\n"
            f"Current price: Rs. {float(current_price):.2f}\n"
            f"Action: {deal_status or 'ALERT'}\n"
            f"Reason: {deal_reason or 'A tracked product met an alert condition.'}\n"
            f"Link: {_build_product_purchase_url(product) or ''}\n"
        )
        sent, error_message = send_email_alert(subject=subject, body=body)
        any_sent = any_sent or bool(sent)
        if not sent and error_message:
            errors.append(f"email: {error_message}")

    alert.notification_sent_flag = bool(any_sent)
    alert.notification_sent_at = datetime.utcnow() if any_sent else None
    alert.notification_error = None if not errors else "; ".join(errors)
    db.commit()


def _trigger_alert_if_needed(alert: models.Alert, product: models.Product, current_price: float, db: Session):
    if alert.triggered_flag:
        if not alert.notification_sent_flag:
            _notify_alert_if_possible(alert, product, current_price, db)
        return

    effective_alert_min, effective_alert_max = _effective_target_bounds(
        target_price_min=alert.target_price_min if alert.target_price_min is not None else product.target_price_min,
        target_price_max=alert.target_price_max if alert.target_price_max is not None else product.target_price_max,
        target_price=alert.target_price if alert.target_price is not None else product.target_price,
    )
    threshold = effective_alert_max

    # Compute deal-status using alert target band (if present), otherwise product target band.
    historical_low_row = (
        db.query(models.PriceHistory)
        .filter(models.PriceHistory.product_id == product.id)
        .filter(models.PriceHistory.price.isnot(None))
        .order_by(models.PriceHistory.price.asc(), models.PriceHistory.timestamp.asc())
        .first()
    )
    historical_low = float(historical_low_row.price) if historical_low_row and historical_low_row.price is not None else None
    avg_30d_rows = [float(row.price) for row in _get_history_rows(db, product.id, days=30, descending=False) if row.price is not None]
    avg_30d = _mean(avg_30d_rows)

    deal_status, deal_reason = _classify_deal_status(
        current_price=float(current_price),
        historical_low=historical_low,
        average_30d=avg_30d,
        target_price_min=effective_alert_min,
        target_price_max=effective_alert_max,
        history_points=len(avg_30d_rows),
    )

    is_deal_trigger = deal_status in {"BUY NOW", "GOOD DEAL"}
    is_target_trigger = threshold is not None and float(current_price) <= float(threshold)

    if not (is_deal_trigger or is_target_trigger):
        return

    alert.triggered_flag = True
    alert.triggered_at = datetime.utcnow()
    db.commit()
    # Attach insight fields used by notification rendering.
    product.historical_low = historical_low
    product.deal_status = deal_status
    _notify_alert_if_possible(alert, product, current_price, db, deal_status=deal_status, deal_reason=deal_reason)


@app.post("/products", response_model=schemas.ProductResponse)
def create_product(product: schemas.ProductCreate, request: Request, db: Session = Depends(get_db)):
    fetch_mode = _get_requested_fetch_mode(request)
    requested_source_key = normalize_source_key(product.source_key)

    refresh_interval_minutes = product.refresh_interval_minutes
    if refresh_interval_minutes is None:
        refresh_interval_minutes = _default_refresh_interval_minutes()
    try:
        refresh_interval_minutes = int(refresh_interval_minutes)
    except Exception:
        raise HTTPException(status_code=400, detail="refresh_interval_minutes must be an integer")
    if refresh_interval_minutes < 15 or refresh_interval_minutes > (60 * 24 * 14):
        raise HTTPException(status_code=400, detail="refresh_interval_minutes must be between 15 and 20160")

    target_min = product.target_price_min
    target_max = product.target_price_max
    if target_min is None and target_max is None and product.target_price is not None:
        target_min = float(product.target_price)
        target_max = float(product.target_price)
    if target_min is None and target_max is not None:
        target_min = float(target_max)
    if target_max is None and target_min is not None:
        target_max = float(target_min)

    if target_min is None or target_max is None:
        raise HTTPException(status_code=400, detail="Provide target_price_min/target_price_max (or a single target_price).")
    if not isinstance(target_min, (int, float)) or not isinstance(target_max, (int, float)):
        raise HTTPException(status_code=400, detail="Target prices must be numbers.")
    if float(target_min) <= 0 or float(target_max) <= 0:
        raise HTTPException(status_code=400, detail="Target prices must be positive numbers.")
    if float(target_min) > float(target_max):
        raise HTTPException(status_code=400, detail="target_price_min must be <= target_price_max")

    resolved_asin: str | None = None
    external_id = (product.external_id or "").strip() or None
    product_url = (product.product_url or "").strip() or None

    if requested_source_key == "amazon":
        requested_asin = (product.asin or "").strip().upper()
        resolved_asin = requested_asin if re.fullmatch(r"[A-Z0-9]{10}", requested_asin) else None
        if not resolved_asin:
            resolved_asin = resolve_asin(product.product_name)
        if not resolved_asin:
            raise HTTPException(
                status_code=400,
                detail="Could not find a matching product for that name. Try a more specific search term.",
            )

        existing = db.query(models.Product).filter(models.Product.asin == resolved_asin).first()
        if existing:
            raise HTTPException(status_code=409, detail="That product is already being tracked.")
    else:
        if not external_id and not product_url:
            raise HTTPException(status_code=400, detail="Pick a live result so we have an external_id or product_url to track.")

        existing_query = db.query(models.Product).filter(models.Product.source_key == requested_source_key)
        if external_id:
            existing_query = existing_query.filter(models.Product.external_id == external_id)
        elif product_url:
            existing_query = existing_query.filter(models.Product.product_url == product_url)
        if existing_query.first():
            raise HTTPException(status_code=409, detail="That product is already being tracked.")

    product_data = get_product_data(
        resolved_asin,
        fetch_mode=fetch_mode,
        source_key=requested_source_key,
        product_url=product_url,
        external_id=external_id,
    )
    if not product_data or "title" not in product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to fetch product details right now.")
    _enforce_target_below_current_price(float(target_max), product_data.get("price"), context="Create product")

    new_product = models.Product(
        name=product_data["title"],
        asin=resolved_asin,
        source_key=requested_source_key,
        external_id=product_data.get("external_id") or external_id,
        product_url=product_data.get("purchase_url") or product_url,
        image_url=product_data.get("image_url"),
        brand=product_data.get("brand"),
        source=product_data.get("source") or get_source_label(requested_source_key),
        last_fetch_method=product_data.get("fetch_method"),
        refresh_interval_minutes=refresh_interval_minutes,
        target_price=float(target_max),
        target_price_min=float(target_min),
        target_price_max=float(target_max),
        last_updated=datetime.utcnow(),
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    price_entry = models.PriceHistory(
        product_id=new_product.id,
        price=float(product_data["price"]),
        fetch_method=product_data.get("fetch_method"),
    )
    db.add(price_entry)
    new_product.last_updated = price_entry.timestamp
    db.commit()

    _attach_product_insights(db, new_product)
    return new_product


@app.get("/products", response_model=list[schemas.ProductResponse])
def get_products(q: str | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Product)

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        query = query.filter(func.lower(models.Product.name).like(term))

    products = query.order_by(models.Product.created_at.desc()).all()
    for product in products:
        _attach_product_insights(db, product)
    return products


@app.get("/products/search", response_model=list[schemas.ProductSearchResult])
def search_products(q: str = Query(min_length=2), limit: int = Query(default=6, ge=1, le=12)):
    return search_marketplace_products(q, limit=limit)


@app.get("/diagnostics/scraper-benchmark")
def scraper_benchmark(asin: str = Query(min_length=10, max_length=10)):
    """
    Compare fetch performance across available Amazon fetchers.
    """
    asin_value = asin.strip().upper()
    runners = [
        ("scrapling", lambda: fetch_amazon_price_with_scrapling(asin_value)),
        ("scraper", lambda: fetch_amazon_price_scraper(asin_value)),
        ("scrapy_local", lambda: fetch_price_with_local_scrapy(asin_value)),
        ("zyte", lambda: fetch_price_from_zyte(asin_value)),
    ]

    results: list[dict] = []
    for method, fn in runners:
        started = time.perf_counter()
        error = None
        data = None
        try:
            data = fn()
        except Exception as exc:
            error = str(exc)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        success = bool(data and isinstance(data, dict) and data.get("price") is not None)
        results.append(
            {
                "method": method,
                "success": success,
                "duration_ms": elapsed_ms,
                "price": (float(data["price"]) if success else None),
                "title": (str(data.get("title"))[:140] if success and data.get("title") else None),
                "fetch_method": (data.get("fetch_method") if success else None),
                "error": error,
            }
        )

    ranked = sorted(results, key=lambda item: (not item["success"], item["duration_ms"]))
    winner = next((item for item in ranked if item["success"]), None)
    return {
        "asin": asin_value,
        "winner": winner["method"] if winner else None,
        "results": ranked,
    }


def _build_adhoc_runner(payload: schemas.CrawlRunRequest) -> SpiderRunner:
    clean_urls = [str(url).strip() for url in payload.start_urls if str(url).strip()]
    if not clean_urls:
        raise HTTPException(status_code=400, detail="start_urls must contain at least one URL.")

    class AdHocSpider(CrawlSpider):
        name = "adhoc_crawl"
        start_urls = clean_urls
        concurrency = max(1, min(20, int(payload.concurrency)))
        per_domain_concurrency = max(1, min(10, int(payload.per_domain_concurrency)))
        download_delay_seconds = max(0.0, float(payload.download_delay_seconds))
        max_pages = max(1, min(500, int(payload.max_pages)))
        max_retries = max(0, min(6, int(payload.max_retries)))
        session_map = {"default": str(payload.session_id or "http").strip().lower() or "http"}
        blocked_statuses = {403, 429, 503}
        blocked_patterns = ("captcha", "verify you are human", "access denied", "temporarily blocked")

        async def parse(self, response):
            soup = BeautifulSoup(response.text or "", "html.parser")
            title = (soup.title.get_text(" ", strip=True) if soup.title else None) or response.url
            page_text = soup.get_text(" ", strip=True)
            price_match = re.search(r"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*\.?[0-9]{0,2})", page_text, re.IGNORECASE)
            price = None
            if price_match:
                try:
                    price = float(price_match.group(1).replace(",", ""))
                except Exception:
                    price = None

            outputs: list[dict | CrawlRequest] = [
                {
                    "url": response.url,
                    "status": response.status,
                    "title": title,
                    "price": price,
                    "blocked": response.blocked,
                    "session_id": response.request.session_id,
                    "elapsed_ms": response.elapsed_ms,
                }
            ]

            depth = int(response.request.meta.get("depth", 0))
            if depth < 1:
                base_domain = urlsplit(response.url).hostname or ""
                for a in soup.select("a[href]"):
                    href = (a.get("href") or "").strip()
                    if not href or href.startswith("#") or href.startswith("javascript:"):
                        continue
                    absolute = href
                    if href.startswith("/"):
                        absolute = f"{urlsplit(response.url).scheme}://{base_domain}{href}"
                    parsed = urlsplit(absolute)
                    if not parsed.scheme.startswith("http"):
                        continue
                    if parsed.hostname != base_domain:
                        continue
                    outputs.append(
                        CrawlRequest(
                            url=absolute,
                            callback=self.parse,
                            session_id=response.request.session_id,
                            meta={"depth": depth + 1},
                        )
                    )
                    if len(outputs) >= 5:
                        break
            return outputs

    spider = AdHocSpider()
    sessions = {
        "http": RequestsSession(timeout_seconds=20),
        "scrapling": ScraplingSession(
            timeout_seconds=int(os.getenv("PRICEPULSE_SCRAPLING_TIMEOUT_SECONDS", "15")),
            verify_ssl=(os.getenv("PRICEPULSE_SCRAPLING_VERIFY_SSL", "0") == "1"),
        ),
    }
    selected_session = str(payload.session_id or "http").strip().lower() or "http"
    if selected_session not in sessions:
        raise HTTPException(status_code=400, detail=f"Unsupported session_id: {selected_session}")

    proxies = payload.proxies or []
    proxy_rotator = ProxyRotator(proxies)
    return SpiderRunner(spider=spider, sessions=sessions, proxy_rotator=proxy_rotator)


@app.post("/diagnostics/crawl/run", response_model=schemas.CrawlRunResponse)
async def run_crawl(payload: schemas.CrawlRunRequest):
    runner = _build_adhoc_runner(payload)
    result = await runner.run(resume=bool(payload.resume))
    return {
        "stats": result.stats.to_dict(),
        "items": list(result.items),
    }


@app.post("/diagnostics/crawl/stream")
async def stream_crawl(payload: schemas.CrawlRunRequest):
    runner = _build_adhoc_runner(payload)

    async def _stream():
        async for item in runner.stream(resume=bool(payload.resume)):
            yield json.dumps({"type": "item", "data": item}, ensure_ascii=False) + "\n"
        yield json.dumps({"type": "done", "stats": runner.stats.to_dict()}, ensure_ascii=False) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@app.get("/products/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    _attach_product_insights(db, product)
    return product


@app.patch("/products/{product_id}/target", response_model=schemas.ProductResponse)
def update_product_target(product_id: int, update: schemas.ProductTargetUpdate, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    target_min = update.target_price_min
    target_max = update.target_price_max
    if target_min is None and target_max is None and update.target_price is not None:
        target_min = float(update.target_price)
        target_max = float(update.target_price)
    if target_min is None and target_max is not None:
        target_min = float(target_max)
    if target_max is None and target_min is not None:
        target_max = float(target_min)

    if target_min is None or target_max is None:
        raise HTTPException(status_code=400, detail="Provide target_price_min/target_price_max (or a single target_price).")
    if float(target_min) <= 0 or float(target_max) <= 0:
        raise HTTPException(status_code=400, detail="Target prices must be positive numbers")
    if float(target_min) > float(target_max):
        raise HTTPException(status_code=400, detail="target_price_min must be <= target_price_max")

    latest_price = _resolve_current_price_for_guardrail(product)
    if latest_price is None:
        raise HTTPException(
            status_code=503,
            detail="Could not validate target against current price right now. Please try again in a moment.",
        )
    _enforce_target_below_current_price(float(target_max), latest_price, context="Update target")

    product.target_price = float(target_max)
    product.target_price_min = float(target_min)
    product.target_price_max = float(target_max)
    db.commit()
    db.refresh(product)
    _attach_product_insights(db, product)
    return product


@app.get("/products/{product_id}/history", response_model=list[schemas.PriceHistoryResponse])
def get_product_history(
    product_id: int,
    days: int | None = Query(default=None, ge=1, le=365),
    limit: int | None = Query(default=None, ge=1, le=500),
    db: Session = Depends(get_db),
):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    return _get_history_rows(db, product_id, days=days, limit=limit, descending=True)


@app.post("/products/{product_id}/refresh", response_model=schemas.PriceHistoryResponse)
def refresh_product_price(product_id: int, request: Request, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_data = get_product_data(
        product.asin,
        fetch_mode=_get_requested_fetch_mode(request),
        source_key=product.source_key,
        external_id=product.external_id,
        product_url=product.product_url,
    )
    if not product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to fetch price")

    if product_data.get("title"):
        product.name = product_data["title"]
    if product_data.get("image_url"):
        product.image_url = product_data["image_url"]
    if product_data.get("brand"):
        product.brand = product_data["brand"]
    if product_data.get("source"):
        product.source = product_data["source"]
    if product_data.get("fetch_method"):
        product.last_fetch_method = product_data["fetch_method"]

    price_entry = models.PriceHistory(
        product_id=product.id,
        price=float(product_data["price"]),
        fetch_method=product_data.get("fetch_method"),
    )
    db.add(price_entry)
    product.last_updated = price_entry.timestamp
    db.commit()
    db.refresh(price_entry)

    try:
        current_price = float(price_entry.price)
        alerts = db.query(models.Alert).filter(models.Alert.product_id == product.id).all()
        for alert in alerts:
            _trigger_alert_if_needed(alert, product, current_price, db)
    except Exception:
        db.rollback()

    return price_entry


def _extract_amazon_asin_from_url(url: str) -> str | None:
    if not url:
        return None
    match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", str(url).upper())
    if match:
        return match.group(1)
    return None


@app.post("/products/from-url", response_model=schemas.ProductResponse)
def create_product_from_url(payload: schemas.ProductUrlCreate, request: Request, db: Session = Depends(get_db)):
    raw_url = _canonicalize_url(payload.url)
    if not raw_url:
        raise HTTPException(status_code=400, detail="Provide a valid url")

    refresh_interval_minutes = payload.refresh_interval_minutes
    if refresh_interval_minutes is None:
        refresh_interval_minutes = _default_refresh_interval_minutes()
    try:
        refresh_interval_minutes = int(refresh_interval_minutes)
    except Exception:
        raise HTTPException(status_code=400, detail="refresh_interval_minutes must be an integer")
    if refresh_interval_minutes < 15 or refresh_interval_minutes > (60 * 24 * 14):
        raise HTTPException(status_code=400, detail="refresh_interval_minutes must be between 15 and 20160")

    target_min = payload.target_price_min
    target_max = payload.target_price_max
    if target_min is None and target_max is None and payload.target_price is not None:
        target_min = float(payload.target_price)
        target_max = float(payload.target_price)
    if target_min is None and target_max is not None:
        target_min = float(target_max)
    if target_max is None and target_min is not None:
        target_max = float(target_min)
    if target_min is None or target_max is None:
        raise HTTPException(status_code=400, detail="Provide target_price_min/target_price_max (or a single target_price).")
    if float(target_min) <= 0 or float(target_max) <= 0:
        raise HTTPException(status_code=400, detail="Target prices must be positive numbers.")
    if float(target_min) > float(target_max):
        raise HTTPException(status_code=400, detail="target_price_min must be <= target_price_max")

    source_key = detect_source_key_from_url(raw_url)
    asin = _extract_amazon_asin_from_url(raw_url) if source_key == "amazon" else None
    if source_key == "amazon" and not asin:
        source_key = "generic"

    external_id = None
    if source_key == "generic":
        external_id = _url_fingerprint(raw_url)

    existing_query = db.query(models.Product).filter(models.Product.source_key == source_key)
    if asin:
        existing_query = existing_query.filter(models.Product.asin == asin)
    elif external_id:
        existing_query = existing_query.filter(models.Product.external_id == external_id)
    else:
        existing_query = existing_query.filter(models.Product.product_url == raw_url)
    if existing_query.first():
        raise HTTPException(status_code=409, detail="That product is already being tracked.")

    product_data = get_product_data(
        asin,
        fetch_mode=_get_requested_fetch_mode(request),
        source_key=source_key,
        product_url=raw_url,
        external_id=external_id,
    )
    if not product_data or "title" not in product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to scrape this URL right now.")
    _enforce_target_below_current_price(float(target_max), product_data.get("price"), context="Create product")

    canonical_purchase_url = _canonicalize_url(product_data.get("purchase_url") or raw_url) or raw_url
    new_external_id = product_data.get("external_id") or external_id
    if source_key == "generic" and not new_external_id:
        new_external_id = _url_fingerprint(canonical_purchase_url)

    new_product = models.Product(
        name=product_data["title"],
        asin=asin,
        source_key=source_key,
        external_id=new_external_id,
        product_url=canonical_purchase_url,
        image_url=product_data.get("image_url"),
        brand=product_data.get("brand"),
        source=product_data.get("source") or get_source_label(source_key),
        last_fetch_method=product_data.get("fetch_method"),
        refresh_interval_minutes=refresh_interval_minutes,
        target_price=float(target_max),
        target_price_min=float(target_min),
        target_price_max=float(target_max),
        last_updated=datetime.utcnow(),
    )
    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    price_entry = models.PriceHistory(
        product_id=new_product.id,
        price=float(product_data["price"]),
        fetch_method=product_data.get("fetch_method"),
    )
    db.add(price_entry)
    new_product.last_updated = price_entry.timestamp
    db.commit()

    _attach_product_insights(db, new_product)
    return new_product


@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    db.query(models.PriceHistory).filter(models.PriceHistory.product_id == product_id).delete(synchronize_session=False)
    db.query(models.Alert).filter(models.Alert.product_id == product_id).delete(synchronize_session=False)
    db.delete(product)
    db.commit()
    return {"deleted": True, "product_id": product_id}


@app.post("/alerts", response_model=schemas.AlertResponse)
def create_alert(alert: schemas.AlertCreate, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == alert.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    target_min = alert.target_price_min
    target_max = alert.target_price_max
    if target_min is None and target_max is None and alert.target_price is not None:
        target_min = float(alert.target_price)
        target_max = float(alert.target_price)
    if target_min is None and target_max is not None:
        target_min = float(target_max)
    if target_max is None and target_min is not None:
        target_max = float(target_min)

    if target_min is None or target_max is None:
        raise HTTPException(status_code=400, detail="Provide target_price_min/target_price_max (or a single target_price).")
    if float(target_min) <= 0 or float(target_max) <= 0:
        raise HTTPException(status_code=400, detail="Target prices must be positive numbers")
    if float(target_min) > float(target_max):
        raise HTTPException(status_code=400, detail="target_price_min must be <= target_price_max")

    latest_entry = _get_latest_price_entry(db, product.id)
    latest_price = _resolve_current_price_for_guardrail(product)
    if latest_price is None:
        raise HTTPException(
            status_code=503,
            detail="Could not validate alert target against current price right now. Please try again in a moment.",
        )
    _enforce_target_below_current_price(float(target_max), latest_price, context="Create alert")

    # Keep only one pending alert per product: creating again updates/replaces it.
    existing_pending = (
        db.query(models.Alert)
        .filter(models.Alert.product_id == alert.product_id)
        .filter(models.Alert.triggered_flag == False)  # noqa: E712
        .order_by(models.Alert.created_at.desc())
        .first()
    )
    if existing_pending:
        existing_pending.target_price = float(target_max)
        existing_pending.target_price_min = float(target_min)
        existing_pending.target_price_max = float(target_max)
        existing_pending.telegram_enabled = bool(alert.telegram_enabled)
        existing_pending.browser_enabled = bool(alert.browser_enabled)
        existing_pending.alarm_enabled = bool(alert.alarm_enabled)
        existing_pending.email_enabled = bool(alert.email_enabled)
        existing_pending.notification_sent_flag = False
        existing_pending.notification_sent_at = None
        existing_pending.notification_error = None
        existing_pending.created_at = datetime.utcnow()
        db.commit()
        db.refresh(existing_pending)

        if latest_price is not None:
            try:
                _trigger_alert_if_needed(existing_pending, product, float(latest_price), db)
                db.refresh(existing_pending)
            except Exception:
                db.rollback()

        return existing_pending

    new_alert = models.Alert(
        product_id=alert.product_id,
        target_price=float(target_max),
        target_price_min=float(target_min),
        target_price_max=float(target_max),
        telegram_enabled=bool(alert.telegram_enabled),
        browser_enabled=bool(alert.browser_enabled),
        alarm_enabled=bool(alert.alarm_enabled),
        email_enabled=bool(alert.email_enabled),
    )
    db.add(new_alert)
    db.commit()
    db.refresh(new_alert)

    if latest_price is not None:
        try:
            _trigger_alert_if_needed(new_alert, product, float(latest_price), db)
            db.refresh(new_alert)
        except Exception:
            db.rollback()

    return new_alert


@app.get("/alerts", response_model=list[schemas.AlertResponse])
def list_alerts(
    triggered_only: bool = Query(default=False),
    product_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(models.Alert)
    if product_id is not None:
        query = query.filter(models.Alert.product_id == product_id)
    if triggered_only:
        query = query.filter(models.Alert.triggered_flag == True)  # noqa: E712
    return query.order_by(models.Alert.created_at.desc()).all()


def _record_prices_for_all_products():
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        products = db.query(models.Product).all()
        for product in products:
            interval = product.refresh_interval_minutes
            if interval is None:
                interval = _default_refresh_interval_minutes()
            try:
                interval = int(interval)
            except Exception:
                interval = _default_refresh_interval_minutes()
            interval = max(15, interval)

            last_seen = product.last_updated or product.created_at
            if last_seen and now < (last_seen + timedelta(minutes=interval)):
                continue

            try:
                product_data = get_product_data(
                    product.asin,
                    source_key=product.source_key,
                    external_id=product.external_id,
                    product_url=product.product_url,
                )
                if not product_data or "price" not in product_data:
                    continue

                if product_data.get("title"):
                    product.name = product_data["title"]
                if product_data.get("image_url"):
                    product.image_url = product_data["image_url"]
                if product_data.get("brand"):
                    product.brand = product_data["brand"]
                if product_data.get("source"):
                    product.source = product_data["source"]
                if product_data.get("fetch_method"):
                    product.last_fetch_method = product_data["fetch_method"]

                entry = models.PriceHistory(
                    product_id=product.id,
                    price=float(product_data["price"]),
                    fetch_method=product_data.get("fetch_method"),
                )
                db.add(entry)
                product.last_updated = entry.timestamp
                db.commit()

                try:
                    current_price = float(entry.price)
                    alerts = db.query(models.Alert).filter(models.Alert.product_id == product.id).all()
                    for alert in alerts:
                        _trigger_alert_if_needed(alert, product, current_price, db)
                except Exception:
                    db.rollback()
            except Exception:
                db.rollback()
    finally:
        db.close()


def _seed_default_products_if_empty():
    db = SessionLocal()
    try:
        existing_count = db.query(models.Product).count()
        if existing_count > 0:
            return

        seed_products = [
            {
                "name": "Logitech G102 Gaming Mouse",
                "asin": "B0895DY6F5",
                "target_price": 1200.0,
                "price": 1149.0,
            },
            {
                "name": "Apple iPhone 13 (128GB)",
                "asin": "B09G9BL5CP",
                "target_price": 52000.0,
                "price": 53999.0,
            },
            {
                "name": "boAt Rockerz 450 Headphones",
                "asin": "B08R6K8W7C",
                "target_price": 1499.0,
                "price": 1399.0,
            },
        ]

        for item in seed_products:
            target = float(item["target_price"])
            product = models.Product(
                name=item["name"],
                asin=item["asin"],
                source_key="amazon",
                external_id=item["asin"],
                product_url=f"https://www.amazon.in/dp/{item['asin']}",
                source="Amazon India",
                last_fetch_method="seed",
                refresh_interval_minutes=_default_refresh_interval_minutes(),
                target_price=target,
                target_price_min=target,
                target_price_max=target,
                last_updated=datetime.utcnow(),
            )
            db.add(product)
            db.commit()
            db.refresh(product)

            entry = models.PriceHistory(product_id=product.id, price=item["price"], fetch_method="seed")
            db.add(entry)
            product.last_updated = entry.timestamp
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def _startup_scheduler():
    enable = os.getenv("PRICEPULSE_ENABLE_SCHEDULER", "1") == "1"

    _seed_default_products_if_empty()

    if not enable:
        return

    try:
        BackgroundScheduler = importlib.import_module("apscheduler.schedulers.background").BackgroundScheduler
    except Exception:
        return

    interval_minutes = int(os.getenv("PRICEPULSE_SCHEDULER_INTERVAL_MINUTES", "30"))
    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(
        _record_prices_for_all_products,
        "interval",
        minutes=interval_minutes,
        id="pricepulse_track_prices",
        replace_existing=True,
    )
    scheduler.start()
    app.state.scheduler = scheduler


@app.on_event("shutdown")
def _shutdown_scheduler():
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
