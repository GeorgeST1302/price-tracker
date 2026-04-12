import os
import importlib
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from .database import SessionLocal, engine, ensure_sqlite_schema
    from . import models, schemas
    from .services.product_service import compute_trend, get_product_data, resolve_asin
    from .services.scraper_service import search_amazon_products
    from .services.telegram_client import is_telegram_configured, send_triggered_alert
except ImportError:
    from database import SessionLocal, engine, ensure_sqlite_schema
    import models
    import schemas
    from services.product_service import compute_trend, get_product_data, resolve_asin
    from services.scraper_service import search_amazon_products
    from services.telegram_client import is_telegram_configured, send_triggered_alert

# Create database tables
models.Base.metadata.create_all(bind=engine)
ensure_sqlite_schema()

app = FastAPI(title="PricePulse API")
logger = logging.getLogger(__name__)
ASIN_PATTERN = re.compile(r"^[A-Z0-9]{10}$")


def _compute_deal_status(latest_price: float | None, target_price: float | None) -> tuple[str | None, str | None]:
    if latest_price is None or target_price is None:
        return None, None

    try:
        latest = float(latest_price)
        target = float(target_price)
    except (TypeError, ValueError):
        return None, None

    if not (latest > 0 and target > 0):
        return None, None

    pct_diff = ((latest - target) / target) * 100 if target else 0.0

    if latest <= target:
        return (
            "BUY NOW - Good deal",
            f"Current price is {abs(pct_diff):.1f}% below your target price.",
        )

    if latest <= target * 1.10:
        return (
            "HOLD - Price is close to your target",
            f"Current price is {pct_diff:.1f}% above your target price.",
        )

    return (
        "WAIT - Price is too high",
        f"Current price is {pct_diff:.1f}% above your target price.",
    )


def _parse_cors_origins_from_env() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    if not raw.strip():
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


def _normalize_requested_asin(raw_asin: str | None) -> str | None:
    asin = (raw_asin or "").strip().upper()
    if not asin:
        return None
    if not ASIN_PATTERN.fullmatch(asin):
        raise HTTPException(status_code=400, detail="Invalid ASIN. Expected 10 uppercase letters or digits.")
    return asin


def _coerce_numeric_price(value) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_product_name(requested_name: str, product_data: dict | None, asin: str) -> str:
    title = ((product_data or {}).get("title") or "").strip()
    fallback = (requested_name or "").strip()
    return title or fallback or f"Amazon Product {asin}"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins_from_env(),
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://[a-z0-9-]+(?:\.onrender\.com|\.pages\.dev)$",
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


@app.get("/version")
def version():
    return {
        "service": "pricepulse-backend",
        "render_git_commit": os.getenv("RENDER_GIT_COMMIT"),
        "render_service_id": os.getenv("RENDER_SERVICE_ID"),
    }


@app.get("/notifications/status")
def notifications_status():
    return {
        "telegram_configured": is_telegram_configured(),
        "channels": {
            "telegram": is_telegram_configured(),
        },
    }


def _get_recent_prices(db: Session, product_id: int, limit: int = 10) -> list[float]:
    rows = (
        db.query(models.PriceHistory)
        .filter(models.PriceHistory.product_id == product_id)
        .order_by(models.PriceHistory.timestamp.desc())
        .limit(max(5, min(10, int(limit))))
        .all()
    )

    # Convert to chronological (oldest -> newest).
    rows.reverse()
    return [float(r.price) for r in rows if r.price is not None]


def _attach_product_insights(db: Session, product: models.Product) -> models.Product:
    prices = _get_recent_prices(db, product.id, limit=10)
    if prices:
        product.latest_price = prices[-1]
        product.price_available = True
        product.trend = compute_trend(prices)
        product.recommendation, product.reason = _compute_deal_status(product.latest_price, product.target_price)
        # If last_updated wasn't set for legacy rows, infer from newest history.
        if not product.last_updated:
            newest = (
                db.query(models.PriceHistory)
                .filter(models.PriceHistory.product_id == product.id)
                .order_by(models.PriceHistory.timestamp.desc())
                .first()
            )
            if newest:
                product.last_updated = newest.timestamp
    else:
        product.latest_price = None
        product.price_available = False
        product.trend = None
        product.recommendation = None
        product.reason = None
    return product


def _get_latest_price_entry(db: Session, product_id: int):
    return (
        db.query(models.PriceHistory)
        .filter(models.PriceHistory.product_id == product_id)
        .order_by(models.PriceHistory.timestamp.desc())
        .first()
    )


def _notify_alert_if_possible(alert: models.Alert, product: models.Product, current_price: float, db: Session):
    if alert.notification_sent_flag:
        return

    sent, error_message = send_triggered_alert(
        product_name=product.name,
        current_price=float(current_price),
        target_price=float(alert.target_price),
        product_id=product.id,
    )
    alert.notification_sent_flag = bool(sent)
    alert.notification_sent_at = datetime.utcnow() if sent else None
    alert.notification_error = None if sent else error_message
    db.commit()


def _trigger_alert_if_needed(alert: models.Alert, product: models.Product, current_price: float, db: Session):
    if alert.triggered_flag:
        if not alert.notification_sent_flag:
            _notify_alert_if_possible(alert, product, current_price, db)
        return

    if current_price > float(alert.target_price):
        return

    alert.triggered_flag = True
    alert.triggered_at = datetime.utcnow()
    db.commit()
    _notify_alert_if_possible(alert, product, current_price, db)


@app.post("/products", response_model=schemas.ProductResponse)
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):
    requested_asin = _normalize_requested_asin(product.asin)
    resolved_asin = requested_asin
    if not resolved_asin:
        resolved_asin = resolve_asin(product.product_name)
    if not resolved_asin:
        raise HTTPException(
            status_code=400,
            detail="Could not find a matching product on Amazon for that product name",
        )
    if not ASIN_PATTERN.fullmatch(resolved_asin):
        raise HTTPException(
            status_code=400,
            detail="Could not resolve a valid Amazon ASIN for that product",
        )

    existing = db.query(models.Product).filter(models.Product.asin == resolved_asin).first()
    if existing:
        raise HTTPException(status_code=409, detail="Product already tracked")

    # 🔥 Fetch real data (scraper or fallback)
    product_data = get_product_data(resolved_asin) or {}
    live_price = _coerce_numeric_price(product_data.get("price"))

    requested_target = float(product.target_price)
    if live_price is not None and requested_target >= live_price:
        raise HTTPException(
            status_code=400,
            detail=f"Target price must be lower than the current price (current: Rs. {live_price:.2f}).",
        )

    new_product = models.Product(
        name=_build_product_name(product.product_name, product_data, resolved_asin),
        asin=resolved_asin,
        target_price=product.target_price,
        last_updated=datetime.utcnow() if live_price is not None else None,
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    # 🔥 Store first price entry
    if live_price is not None:
        price_entry = models.PriceHistory(
            product_id=new_product.id,
            price=live_price
        )

        db.add(price_entry)
        new_product.last_updated = price_entry.timestamp
        db.commit()
    else:
        logger.warning("Created product id=%s asin=%s without live price data", new_product.id, resolved_asin)

    _attach_product_insights(db, new_product)

    return new_product


@app.get("/products", response_model=list[schemas.ProductResponse])
def get_products(q: str | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Product)

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        query = query.filter(func.lower(models.Product.name).like(term))

    products = query.order_by(models.Product.created_at.desc()).all()
    for p in products:
        _attach_product_insights(db, p)
    return products


@app.get("/products/search", response_model=list[schemas.ProductSearchResult])
def search_products(q: str = Query(min_length=2), limit: int = Query(default=9, ge=1, le=12)):
    return search_amazon_products(q, limit=limit)


@app.get("/products/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    _attach_product_insights(db, product)
    return product


@app.get("/products/{product_id}/history", response_model=list[schemas.PriceHistoryResponse])
def get_product_history(
    product_id: int,
    limit: int | None = Query(default=None, ge=1, le=200),
    db: Session = Depends(get_db),
):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    query = (
        db.query(models.PriceHistory)
        .filter(models.PriceHistory.product_id == product_id)
        .order_by(models.PriceHistory.timestamp.desc())
    )
    if limit is not None:
        query = query.limit(int(limit))
    return query.all()


@app.post("/products/{product_id}/refresh", response_model=schemas.PriceHistoryResponse)
def refresh_product_price(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_data = get_product_data(product.asin) or {}
    live_price = _coerce_numeric_price(product_data.get("price"))
    if live_price is None:
        latest_entry = _get_latest_price_entry(db, product.id)
        if latest_entry:
            logger.warning("Refresh degraded to cached price for product id=%s asin=%s", product.id, product.asin)
            return latest_entry
        raise HTTPException(status_code=503, detail="Live price is currently unavailable and no cached price exists")

    # Keep name in sync if scraper returns it.
    if product_data.get("title"):
        product.name = product_data["title"]

    price_entry = models.PriceHistory(product_id=product.id, price=live_price)
    db.add(price_entry)
    product.last_updated = price_entry.timestamp
    db.commit()
    db.refresh(price_entry)

    try:
        current_price = float(price_entry.price)
        alerts = (
            db.query(models.Alert)
            .filter(models.Alert.product_id == product.id)
            .all()
        )
        for a in alerts:
            _trigger_alert_if_needed(a, product, current_price, db)
    except Exception:
        db.rollback()
    return price_entry


@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Production-ish explicit deletes (works even if SQLite FK/cascade isn't enabled).
    db.query(models.PriceHistory).filter(models.PriceHistory.product_id == product_id).delete(
        synchronize_session=False
    )
    db.query(models.Alert).filter(models.Alert.product_id == product_id).delete(
        synchronize_session=False
    )
    db.delete(product)
    db.commit()
    return {"deleted": True, "product_id": product_id}


@app.post("/alerts", response_model=schemas.AlertResponse)
def create_alert(alert: schemas.AlertCreate, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == alert.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if not isinstance(alert.target_price, (int, float)) or alert.target_price <= 0:
        raise HTTPException(status_code=400, detail="target_price must be a positive number")

    latest_entry = _get_latest_price_entry(db, product.id)
    if latest_entry and latest_entry.price is not None:
        try:
            current_price = float(latest_entry.price)
        except (TypeError, ValueError):
            current_price = None

        if current_price is not None and float(alert.target_price) >= current_price:
            raise HTTPException(
                status_code=400,
                detail=f"Alert target price must be lower than the current price (current: Rs. {current_price:.2f}).",
            )

    new_alert = models.Alert(product_id=alert.product_id, target_price=float(alert.target_price))
    db.add(new_alert)
    db.commit()
    db.refresh(new_alert)

    if latest_entry and latest_entry.price is not None:
        try:
            _trigger_alert_if_needed(new_alert, product, float(latest_entry.price), db)
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
    """Background job: scrape & store a new price point for every product."""
    db = SessionLocal()
    try:
        products = db.query(models.Product).all()
        for product in products:
            try:
                product_data = get_product_data(product.asin)
                if not product_data or "price" not in product_data:
                    continue

                if product_data.get("title"):
                    product.name = product_data["title"]

                entry = models.PriceHistory(product_id=product.id, price=float(product_data["price"]))
                db.add(entry)
                product.last_updated = entry.timestamp
                db.commit()

                # Trigger alerts if threshold met.
                try:
                    current_price = float(entry.price)
                    alerts = (
                        db.query(models.Alert)
                        .filter(models.Alert.product_id == product.id)
                        .all()
                    )
                    for a in alerts:
                        _trigger_alert_if_needed(a, product, current_price, db)
                except Exception:
                    db.rollback()
            except Exception:
                # Never let one product break the whole job.
                db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def _lifespan(app_instance: FastAPI):
    scheduler = None
    enable = os.getenv("PRICEPULSE_ENABLE_SCHEDULER", "1") == "1"

    if enable:
        try:
            BackgroundScheduler = importlib.import_module(
                "apscheduler.schedulers.background"
            ).BackgroundScheduler
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
            app_instance.state.scheduler = scheduler
        except Exception:
            scheduler = None

    try:
        yield
    finally:
        if scheduler:
            try:
                scheduler.shutdown(wait=False)
            except Exception:
                pass


app.router.lifespan_context = _lifespan
