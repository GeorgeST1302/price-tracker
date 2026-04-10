def fetch_amazon_price_api(asin: str):
    # fallback (for now fake)
    return {
        "title": "Fallback Product",
        "price": 999.0,
        "source": "fallback",
        "asin": asin,
    }