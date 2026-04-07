import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_healthz(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    @patch("app.main.search_products", new_callable=AsyncMock)
    def test_scrape_search(self, mock_search):
        mock_search.return_value = [
            {
                "source_key": "amazon",
                "source": "Amazon India",
                "title": "iPhone 13",
                "price": 49999.0,
                "product_url": "https://www.amazon.in/dp/example",
                "image_url": None,
            }
        ]

        response = self.client.get("/scrape/search?q=iphone&limit=1")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["results"]), 1)
        self.assertEqual(body["results"][0]["title"], "iPhone 13")

    @patch("app.main.fetch_snapshot", new_callable=AsyncMock)
    def test_scrape_snapshot(self, mock_snapshot):
        mock_snapshot.return_value = {
            "price": 49999.0,
            "fetch_method": "scrapy_api",
            "image_url": "https://example.com/img.jpg",
            "brand": "Apple",
        }

        response = self.client.post(
            "/scrape/snapshot",
            json={"source_key": "amazon", "product_url": "https://www.amazon.in/dp/example"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNotNone(body["snapshot"])
        self.assertEqual(body["snapshot"]["price"], 49999.0)


if __name__ == "__main__":
    unittest.main()