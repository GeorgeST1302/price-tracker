from fastapi.testclient import TestClient

from backend import main
from backend import models
from backend.database import SessionLocal
from backend.services import product_service


client = TestClient(main.app)


def test_pages_origin_cors_preflight_is_allowed():
    response = client.options(
        "/healthz",
        headers={
            "Origin": "https://price-tracker-app.pages.dev",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://price-tracker-app.pages.dev"


def test_products_search_returns_trackable_fields(monkeypatch):
    monkeypatch.setattr(
        main,
        "search_amazon_products",
        lambda q, limit=9: [
            {
                "source_key": "amazon",
                "asin": "B012345678",
                "title": "Test Product",
                "image_url": "https://example.com/test.jpg",
                "price": 1999.0,
                "seller": "Amazon Marketplace",
                "source": "Amazon India",
                "product_url": "https://www.amazon.in/dp/B012345678",
                "trackable": True,
            }
        ],
    )

    response = client.get("/products/search?q=test&limit=9")

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["source_key"] == "amazon"
    assert payload[0]["product_url"] == "https://www.amazon.in/dp/B012345678"
    assert payload[0]["trackable"] is True


def test_product_service_returns_none_when_all_live_sources_fail(monkeypatch):
    monkeypatch.setattr(product_service, "fetch_amazon_price_scraper", lambda asin: None)
    monkeypatch.setattr(product_service, "fetch_price_from_zyte", lambda asin: None)
    monkeypatch.setattr(product_service, "fetch_amazon_price_api", lambda asin: None)

    assert product_service.get_product_data("B012345678") is None


def _delete_product_by_asin(asin: str):
    db = SessionLocal()
    try:
        product = db.query(models.Product).filter(models.Product.asin == asin).first()
        if not product:
            return
        db.query(models.PriceHistory).filter(models.PriceHistory.product_id == product.id).delete(
            synchronize_session=False
        )
        db.query(models.Alert).filter(models.Alert.product_id == product.id).delete(
            synchronize_session=False
        )
        db.delete(product)
        db.commit()
    finally:
        db.close()


def test_create_product_rejects_invalid_explicit_asin():
    response = client.post(
        "/products",
        json={
            "product_name": "Bad ASIN Product",
            "target_price": 999.0,
            "asin": "bad-asin",
        },
    )

    assert response.status_code == 400
    assert "Invalid ASIN" in response.json()["detail"]


def test_create_product_persists_without_live_price(monkeypatch):
    asin = "B0STABLE01"
    _delete_product_by_asin(asin)
    monkeypatch.setattr(main, "get_product_data", lambda resolved_asin: None)

    response = client.post(
        "/products",
        json={
            "product_name": "Fallback Product Name",
            "target_price": 999.0,
            "asin": asin,
        },
    )

    try:
        assert response.status_code == 200
        payload = response.json()
        assert payload["name"] == "Fallback Product Name"
        assert payload["latest_price"] is None
        assert payload["price_available"] is False
        assert payload["last_updated"] is None
    finally:
        _delete_product_by_asin(asin)


def test_refresh_returns_cached_entry_when_live_fetch_fails(monkeypatch):
    asin = "B0REFRESH1"
    _delete_product_by_asin(asin)
    monkeypatch.setattr(main, "get_product_data", lambda resolved_asin: {"title": "Initial Name", "price": 1499.0})

    create_response = client.post(
        "/products",
        json={
            "product_name": "Initial Name",
            "target_price": 999.0,
            "asin": asin,
        },
    )
    assert create_response.status_code == 200
    product_id = create_response.json()["id"]

    monkeypatch.setattr(main, "get_product_data", lambda resolved_asin: None)
    refresh_response = client.post(f"/products/{product_id}/refresh")

    try:
        assert refresh_response.status_code == 200
        payload = refresh_response.json()
        assert payload["product_id"] == product_id
        assert payload["price"] == 1499.0
    finally:
        _delete_product_by_asin(asin)
