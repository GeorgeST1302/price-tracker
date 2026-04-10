import logging

try:
    from .api_fallback import fetch_amazon_price_api
    from .scraper_service import fetch_amazon_price_scraper, resolve_asin_from_search_term
    from .zyte_client import fetch_price_from_zyte
except ImportError:
    from services.api_fallback import fetch_amazon_price_api
    from services.scraper_service import fetch_amazon_price_scraper, resolve_asin_from_search_term
    from services.zyte_client import fetch_price_from_zyte


logger = logging.getLogger(__name__)


def compute_trend(prices: list[float]) -> str | None:
    """Compute trend direction from a sequence of prices (oldest -> newest)."""
    if not prices or len(prices) < 2:
        return None

    cleaned = [float(p) for p in prices if p is not None]
    if len(cleaned) < 2:
        return None

    mean_price = sum(cleaned) / len(cleaned)
    epsilon = max(1.0, 0.002 * mean_price)

    inc = 0
    dec = 0
    flat = 0

    for prev, curr in zip(cleaned, cleaned[1:]):
        diff = curr - prev
        if abs(diff) <= epsilon:
            flat += 1
        elif diff > 0:
            inc += 1
        else:
            dec += 1

    total = max(1, len(cleaned) - 1)
    if dec / total >= 0.7:
        return "DECREASING"
    if inc / total >= 0.7:
        return "INCREASING"
    return "STABLE"


def compute_recommendation(prices: list[float]) -> str | None:
    """Return BUY/WAIT/HOLD based on recent price behavior.

    Rules (per spec):
      - If current price is the lowest in recent history -> BUY
      - If prices are consistently decreasing -> WAIT
      - If prices are increasing -> HOLD
      - Otherwise -> WAIT
    """
    if not prices:
        return None

    cleaned = [float(p) for p in prices if p is not None]
    if not cleaned:
        return None

    latest = cleaned[-1]
    min_recent = min(cleaned)
    mean_price = sum(cleaned) / len(cleaned)
    epsilon = max(1.0, 0.002 * mean_price)

    if latest <= (min_recent + epsilon):
        return "BUY"

    trend = compute_trend(cleaned)
    if trend == "INCREASING":
        return "HOLD"
    if trend == "DECREASING":
        return "WAIT"
    return "WAIT"


def get_product_data(asin: str):
    # Try scraper first.
    data = fetch_amazon_price_scraper(asin)

    if data:
        logger.info("Scraper success for ASIN=%s", asin)
        return data

    logger.info("Direct scraper failed for ASIN=%s, trying Zyte", asin)
    data = fetch_price_from_zyte(asin)
    if data and isinstance(data, dict):
        return data

    # Fallback if the scraper cannot get live data.
    logger.warning("Scraper failed for ASIN=%s, using fallback", asin)
    return fetch_amazon_price_api(asin)


def resolve_asin(product_name: str | None = None):
    if product_name and product_name.strip():
        return resolve_asin_from_search_term(product_name.strip())

    return None
