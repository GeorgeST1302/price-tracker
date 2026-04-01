import os
import importlib
import re
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from .database import SessionLocal, engine, ensure_sqlite_schema
    from . import models, schemas
    from .services.product_service import compute_recommendation, compute_trend, get_product_data, resolve_asin
    from .services.scraper_service import search_amazon_products
except ImportError:
    from database import SessionLocal, engine, ensure_sqlite_schema
    import models
    import schemas
    from services.product_service import compute_recommendation, compute_trend, get_product_data, resolve_asin
    from services.scraper_service import search_amazon_products

# Create database tables
models.Base.metadata.create_all(bind=engine)
ensure_sqlite_schema()

app = FastAPI(title="PricePulse API")


def _parse_cors_origins_from_env() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    if not raw.strip():
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]

# CORS: allow the Vite dev server to call the API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins_from_env(),
    # Vite may auto-increment ports (5173 -> 5174, etc.).
    # Also allow Render static-site domains by default.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://[a-z0-9-]+\.onrender\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Root endpoint
@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"message": "PricePulse API is running successfully"}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


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
        product.trend = compute_trend(prices)
        product.recommendation = compute_recommendation(prices)
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
        product.trend = None
        product.recommendation = None
    return product


# CREATE PRODUCT (NOW REAL DATA)
@app.post("/products", response_model=schemas.ProductResponse)
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):
    requested_asin = (product.asin or "").strip().upper()
    resolved_asin = requested_asin if re.fullmatch(r"[A-Z0-9]{10}", requested_asin) else None
    if not resolved_asin:
        resolved_asin = resolve_asin(product.product_name)
    if not resolved_asin:
        raise HTTPException(
            status_code=400,
            detail="Could not find a matching product on Amazon for that product name",
        )

    existing = db.query(models.Product).filter(models.Product.asin == resolved_asin).first()
    if existing:
        raise HTTPException(status_code=409, detail="Product already tracked")

    # 🔥 Fetch real data (scraper or fallback)
    product_data = get_product_data(resolved_asin)
    if not product_data or "title" not in product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to fetch product details from Amazon")

    new_product = models.Product(
        name=product_data["title"],
        asin=resolved_asin,
        target_price=product.target_price,
        last_updated=datetime.utcnow(),
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    # 🔥 Store first price entry
    price_entry = models.PriceHistory(
        product_id=new_product.id,
        price=product_data["price"]
    )

    db.add(price_entry)
    new_product.last_updated = price_entry.timestamp
    db.commit()

    _attach_product_insights(db, new_product)

    return new_product


# GET ALL PRODUCTS
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
def search_products(q: str = Query(min_length=2), limit: int = Query(default=6, ge=1, le=12)):
    return search_amazon_products(q, limit=limit)


@app.get("/products/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    _attach_product_insights(db, product)
    return product


# GET PRICE HISTORY FOR A PRODUCT
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


# MANUALLY REFRESH PRICE (SCRAPE NOW + STORE)
@app.post("/products/{product_id}/refresh", response_model=schemas.PriceHistoryResponse)
def refresh_product_price(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_data = get_product_data(product.asin)
    if not product_data or "price" not in product_data:
        raise HTTPException(status_code=502, detail="Failed to fetch price")

    # Keep name in sync if scraper returns it.
    if product_data.get("title"):
        product.name = product_data["title"]

    price_entry = models.PriceHistory(product_id=product.id, price=float(product_data["price"]))
    db.add(price_entry)
    product.last_updated = price_entry.timestamp
    db.commit()
    db.refresh(price_entry)

    # Also trigger alerts on manual refresh.
    try:
        current_price = float(price_entry.price)
        alerts = (
            db.query(models.Alert)
            .filter(models.Alert.product_id == product.id)
            .filter(models.Alert.triggered_flag == False)  # noqa: E712
            .all()
        )
        for a in alerts:
            if current_price <= float(a.target_price):
                a.triggered_flag = True
                a.triggered_at = datetime.utcnow()
        db.commit()
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

    new_alert = models.Alert(product_id=alert.product_id, target_price=float(alert.target_price))
    db.add(new_alert)
    db.commit()
    db.refresh(new_alert)
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
                        .filter(models.Alert.triggered_flag == False)  # noqa: E712
                        .all()
                    )
                    for a in alerts:
                        if current_price <= float(a.target_price):
                            a.triggered_flag = True
                            a.triggered_at = datetime.utcnow()
                    db.commit()
                except Exception:
                    db.rollback()
            except Exception:
                # Never let one product break the whole job.
                db.rollback()
    finally:
        db.close()


def _seed_default_products_if_empty():
    """Seed a few demo products so first-time users see useful data immediately."""
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
    """Optional scheduler to auto-track prices periodically.

    Env vars:
      - PRICEPULSE_ENABLE_SCHEDULER=1 (default: 1)
      - PRICEPULSE_SCHEDULER_INTERVAL_MINUTES=60
    """
    enable = os.getenv("PRICEPULSE_ENABLE_SCHEDULER", "1") == "1"

    # Populate sample data on first run for better first-time UX.
    _seed_default_products_if_empty()

    if not enable:
        return

    try:
        BackgroundScheduler = importlib.import_module(
            "apscheduler.schedulers.background"
        ).BackgroundScheduler
    except Exception:
        # APScheduler not installed; skip silently to avoid breaking the app.
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

    # Store on app state so it can be shut down cleanly.
    app.state.scheduler = scheduler


@app.on_event("shutdown")
def _shutdown_scheduler():
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
