import unittest

from app.scraper import clean_text, parse_price, normalize_url, make_row


class ScraperHelperTests(unittest.TestCase):
    def test_clean_text(self):
        self.assertEqual(clean_text("  hello   world  "), "hello world")

    def test_parse_price(self):
        self.assertEqual(parse_price("Rs. 49,999.00"), 49999.0)

    def test_normalize_url(self):
        self.assertEqual(
            normalize_url("amazon", "/dp/B0CS5ZZMN8"),
            "https://www.amazon.in/dp/B0CS5ZZMN8",
        )

    def test_make_row(self):
        row = make_row("amazon", "iPhone 13", 49999, "/dp/example")
        self.assertIsNotNone(row)
        self.assertEqual(row["source_key"], "amazon")
        self.assertEqual(row["title"], "iPhone 13")


if __name__ == "__main__":
    unittest.main()