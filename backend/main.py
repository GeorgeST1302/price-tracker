import importlib
import os
import re
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from . import models, schemas
    from .database import SessionLocal, engine, ensure_sqlite_schema
    from .services.product_service import (
        compute_recommendation_details,
        compute_trend,
        get_product_data,
        resolve_asin,
    )
    from .services.scraper_service import search_amazon_products
    from .services.telegram_client import is_telegram_configured, send_triggered_alert
except ImportError:
    import models
    import schemas
    from database import SessionLocal, engine, ensure_sqlite_schema
    from services.product_service import (
        compute_recommendation_details,
        compute_trend,
        get_product_data,
        resolve_asin,
    )
    from services.scraper_service import search_amazon_products
    from services.telegram_client import is_telegram_configured, send_triggered_alert


models.Base.metadata.create_all(bind=engine)
ensure_sqlite_schema()

app = FastAPI(title="PricePulse API")


def _parse_cors_origins_from_env() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    if not raw.strip():
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


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


@app.get("/notifications/status")
def notifications_status():
    configured = is_telegram_configured()
    return {
        "telegram_configured": configured,
        "channels": {
            "telegram": configured,
        },
    }


@app.post("/notifications/test")
def test_notification():
    sent, error_message = send_triggered_alert(
        product_name="PricePulse test alert",
        current_price=1499.0,
        target_price=1999.0,
        product_id=0,
    )
    return {
        "sent": bool(sent),
        "detail": "Test alert delivered to Telegram." if sent else (error_message or "Telegram delivery failed."),
    }


def _build_product_purchase_url(product: models.Product) -> str | None:
    asin = (product.asin or "").strip()
    if not asin:
        return None
    return f"https://www.amazon.in/dp/{asin}"


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

    product.purchase_url = _build_product_purchase_url(product)
    product.source = product.source or "Amazon India"

    if reference_prices:
        latest_price = reference_prices[-1]
        average_7d = _mean(prices_7d)
        average_30d = _mean(prices_30d)
        details = compute_recommendation_details(reference_prices, average_reference=average_30d)

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

        if not product.last_updated:
            newest = _get_latest_price_entry(db, product.id)
            if newest:
                product.last_updated = newest.timestamp
    else:
        product.latest_price = None
        product.trend = None
        product.recommendation = None
        product.recommendation_reason = None
        product.average_7d = None
        product.average_30d = None
        product.delta_from_avg = None
        product.delta_from_avg_pct = None
        product.prediction = None
        product.prediction_confidence = None

    return product


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

    product_data = get_product_data(resolved_asin)
    if not product_data or "title" not in product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to fetch product details right now.")

    new_product = models.Product(
        name=product_data["title"],
        asin=resolved_asin,
        image_url=product_data.get("image_url"),
        source=product_data.get("source") or "Amazon India",
        target_price=product.target_price,
        last_updated=datetime.utcnow(),
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    price_entry = models.PriceHistory(product_id=new_product.id, price=float(product_data["price"]))
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
    days: int | None = Query(default=None, ge=1, le=365),
    limit: int | None = Query(default=None, ge=1, le=500),
    db: Session = Depends(get_db),
):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    return _get_history_rows(db, product_id, days=days, limit=limit, descending=True)


@app.post("/products/{product_id}/refresh", response_model=schemas.PriceHistoryResponse)
def refresh_product_price(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_data = get_product_data(product.asin)
    if not product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to fetch price")

    if product_data.get("title"):
        product.name = product_data["title"]
    if product_data.get("image_url"):
        product.image_url = product_data["image_url"]
    if product_data.get("source"):
        product.source = product_data["source"]

    price_entry = models.PriceHistory(product_id=product.id, price=float(product_data["price"]))
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

    if not isinstance(alert.target_price, (int, float)) or alert.target_price <= 0:
        raise HTTPException(status_code=400, detail="target_price must be a positive number")

    new_alert = models.Alert(product_id=alert.product_id, target_price=float(alert.target_price))
    db.add(new_alert)
    db.commit()
    db.refresh(new_alert)

    latest_entry = _get_latest_price_entry(db, product.id)
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
                if product_data.get("image_url"):
                    product.image_url = product_data["image_url"]
                if product_data.get("source"):
                    product.source = product_data["source"]

                entry = models.PriceHistory(product_id=product.id, price=float(product_data["price"]))
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
            product = models.Product(
                name=item["name"],
                asin=item["asin"],
                source="Amazon India",
                target_price=item["target_price"],
                last_updated=datetime.utcnow(),
            )
            db.add(product)
            db.commit()
            db.refresh(product)

            entry = models.PriceHistory(product_id=product.id, price=item["price"])
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
