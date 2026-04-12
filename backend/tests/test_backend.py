from fastapi.testclient import TestClient

from backend import main
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
