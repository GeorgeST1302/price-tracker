def fetch_amazon_price_api(asin: str):
    # fallback (for now fake)
    return {
        "title": "Fallback Product",
        "price": 999.0,
        "source": "Amazon India",
        "asin": asin,
        "purchase_url": f"https://www.amazon.in/dp/{asin}",
        "fetch_method": "fallback",
    }
