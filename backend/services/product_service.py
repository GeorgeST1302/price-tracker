import logging

try:
    from .api_fallback import fetch_amazon_price_api
    from .marketplace_service import fetch_marketplace_product, normalize_source_key
    from .generic_scraper_service import fetch_generic_product
    from .scrapy_runner import fetch_price_with_local_scrapy
    from .scraper_service import fetch_amazon_price_scraper, resolve_asin_from_search_term, search_amazon_products
    from .zyte_client import fetch_price_from_zyte
except ImportError:
    from services.api_fallback import fetch_amazon_price_api
    from services.marketplace_service import fetch_marketplace_product, normalize_source_key
    from services.generic_scraper_service import fetch_generic_product
    from services.scrapy_runner import fetch_price_with_local_scrapy
    from services.scraper_service import fetch_amazon_price_scraper, resolve_asin_from_search_term, search_amazon_products
    from services.zyte_client import fetch_price_from_zyte


logger = logging.getLogger(__name__)


def _clean_prices(prices: list[float]) -> list[float]:
    return [float(p) for p in prices if p is not None]


def _mean(values: list[float]) -> float | None:
    cleaned = _clean_prices(values)
    if not cleaned:
        return None
    return sum(cleaned) / len(cleaned)


def _format_rupees(value: float | None) -> str:
    amount = float(value or 0)
    if amount.is_integer():
        return f"Rs. {amount:,.0f}"
    return f"Rs. {amount:,.2f}"


def _describe_vs_average(delta_from_avg_pct: float | None) -> str:
    if delta_from_avg_pct is None:
        return "around its recent average"

    if abs(delta_from_avg_pct) < 1:
        return "roughly in line with the recent average"
    if delta_from_avg_pct < 0:
        return f"{abs(delta_from_avg_pct):.1f}% below the recent average"
    return f"{delta_from_avg_pct:.1f}% above the recent average"


def compute_trend(prices: list[float]) -> str | None:
    """Compute trend direction from a sequence of prices (oldest -> newest)."""
    cleaned = _clean_prices(prices)
    if len(cleaned) < 2:
        return None

    mean_price = sum(cleaned) / len(cleaned)
    epsilon = max(1.0, 0.002 * mean_price)

    inc = 0
    dec = 0

    for prev, curr in zip(cleaned, cleaned[1:]):
        diff = curr - prev
        if abs(diff) <= epsilon:
            continue
        if diff > 0:
            inc += 1
        else:
            dec += 1

    total = max(1, len(cleaned) - 1)
    if dec / total >= 0.7:
        return "DECREASING"
    if inc / total >= 0.7:
        return "INCREASING"
    return "STABLE"


def _count_streak(prices: list[float], direction: str) -> int:
    cleaned = _clean_prices(prices)
    if len(cleaned) < 2:
        return 0

    streak = 0
    for prev, curr in zip(reversed(cleaned[:-1]), reversed(cleaned[1:])):
        if direction == "down" and curr < prev:
            streak += 1
            continue
        if direction == "up" and curr > prev:
            streak += 1
            continue
        break
    return streak


def compute_recommendation_details(
    prices: list[float],
    average_reference: float | None = None,
    target_price_min: float | None = None,
    target_price_max: float | None = None,
    target_price: float | None = None,
) -> dict:
    cleaned = _clean_prices(prices)
    if not cleaned:
        return {
            "recommendation": None,
            "recommendation_reason": None,
            "prediction": None,
            "prediction_confidence": None,
            "delta_from_avg": None,
            "delta_from_avg_pct": None,
        }

    latest = cleaned[-1]
    min_recent = min(cleaned)
    average_price = average_reference if average_reference is not None else _mean(cleaned)
    delta_from_avg = latest - average_price if average_price is not None else None
    delta_from_avg_pct = ((delta_from_avg / average_price) * 100.0) if average_price else None
    trend = compute_trend(cleaned) if len(cleaned) >= 2 else None
    epsilon = max(1.0, 0.002 * latest)
    falling_streak = _count_streak(cleaned, "down")
    rising_streak = _count_streak(cleaned, "up")
    enough_history = len(cleaned) >= 3
    target_min_value = float(target_price_min) if target_price_min is not None else None
    target_max_value = float(target_price_max) if target_price_max is not None else None
    target_fallback = float(target_price) if target_price is not None else None
    if target_min_value is None and target_max_value is None and target_fallback is not None:
        target_min_value = target_fallback
        target_max_value = target_fallback
    elif target_min_value is None and target_max_value is not None:
        target_min_value = target_max_value
    elif target_max_value is None and target_min_value is not None:
        target_max_value = target_min_value
    target_value = target_max_value
    target_gap = (latest - target_value) if target_value is not None else None
    at_or_below_target = target_gap is not None and target_gap <= epsilon
    inside_target_band = (
        target_min_value is not None
        and target_max_value is not None
        and (target_min_value - epsilon) <= latest <= (target_max_value + epsilon)
    )
    near_recent_low = latest <= (min_recent + epsilon)
    avg_description = _describe_vs_average(delta_from_avg_pct)

    recommendation = "WATCH CLOSELY"
    reason = "There is not enough pricing movement yet, so keep monitoring this product."

    if at_or_below_target:
        recommendation = "BUY NOW"
        if target_min_value is not None and latest < (target_min_value - epsilon):
            reason = "Current price is even better than the lower end of your target range."
        elif inside_target_band and near_recent_low:
            reason = "Current price is inside your target range and near the lowest level you have tracked."
        elif near_recent_low:
            reason = f"Current price has reached your target and is near the lowest level you have tracked."
        elif delta_from_avg_pct is not None:
            reason = f"Current price has reached your target and is {avg_description}."
        else:
            reason = "Current price has reached your target, so this is a valid buy window."
    elif not enough_history:
        if target_gap is not None and target_gap > 0:
            reason = f"We need a little more history first. Right now the price is {_format_rupees(target_gap)} above your target ceiling."
        else:
            reason = "We need a little more history before recommending a confident buy decision."
    elif target_gap is not None and target_gap > 0 and trend == "DECREASING":
        recommendation = "WAIT"
        if falling_streak >= 2:
            reason = f"Price is still {_format_rupees(target_gap)} above your target and has fallen for {falling_streak} consecutive updates."
        else:
            reason = f"Price is still {_format_rupees(target_gap)} above your target and trending down, so waiting makes more sense."
    elif target_gap is not None and target_gap > 0 and trend == "INCREASING":
        recommendation = "WATCH CLOSELY"
        reason = f"Price is {_format_rupees(target_gap)} above your target and moving upward, so this is not a strong buy moment."
    elif near_recent_low and (delta_from_avg_pct is not None and delta_from_avg_pct <= -6):
        recommendation = "BUY NOW"
        reason = f"Current price is {avg_description} and close to the lowest tracked level."
    elif trend == "DECREASING" and (delta_from_avg_pct is None or delta_from_avg_pct > -4):
        recommendation = "WAIT"
        if falling_streak >= 2:
            reason = f"Price has fallen for {falling_streak} consecutive updates and may dip a little further."
        else:
            reason = "Price is trending down, so waiting could unlock a slightly better deal."
    elif delta_from_avg_pct is not None and abs(delta_from_avg_pct) <= 2:
        recommendation = "WATCH CLOSELY"
        reason = "Current price is very close to the recent average, so a bit more monitoring is worthwhile."
    elif delta_from_avg_pct is not None and delta_from_avg_pct > 4:
        recommendation = "WAIT"
        reason = f"Current price is {avg_description}, so it does not look like a bargain yet."

    prediction = "Need more data"
    confidence = "low"
    if not enough_history:
        prediction = "Need more history"
        confidence = "low"
    elif trend == "DECREASING":
        prediction = "Likely to dip slightly"
        confidence = "medium" if len(cleaned) >= 5 else "low"
    elif trend == "INCREASING":
        prediction = "Stable to slightly higher"
        confidence = "medium" if rising_streak >= 2 else "low"
    elif near_recent_low:
        prediction = "Near recent low"
        confidence = "medium"
    elif delta_from_avg_pct is not None and abs(delta_from_avg_pct) <= 2:
        prediction = "Stable price"
        confidence = "medium"

    return {
        "recommendation": recommendation,
        "recommendation_reason": reason,
        "prediction": prediction,
        "prediction_confidence": confidence,
        "delta_from_avg": delta_from_avg,
        "delta_from_avg_pct": delta_from_avg_pct,
    }


def compute_recommendation(
    prices: list[float],
    average_reference: float | None = None,
    target_price_min: float | None = None,
    target_price_max: float | None = None,
    target_price: float | None = None,
) -> str | None:
    return compute_recommendation_details(
        prices,
        average_reference,
        target_price_min,
        target_price_max,
        target_price,
    ).get("recommendation")


def _enrich_product_data(asin: str, data: dict | None) -> dict | None:
    if not data or not isinstance(data, dict):
        return data

    enriched = dict(data)
    enriched["asin"] = enriched.get("asin") or asin
    enriched["source_key"] = normalize_source_key(enriched.get("source_key"))
    enriched["source"] = enriched.get("source") or "Amazon India"
    enriched["purchase_url"] = enriched.get("purchase_url") or f"https://www.amazon.in/dp/{asin}"
    enriched["fetch_method"] = enriched.get("fetch_method") or "unknown"

    if enriched.get("source_key") == "amazon" and (not enriched.get("image_url") or not enriched.get("title")):
        try:
            fallback_results = search_amazon_products(asin, limit=1)
        except Exception:
            fallback_results = []

        if fallback_results:
            first = fallback_results[0]
            enriched["image_url"] = enriched.get("image_url") or first.get("image_url")
            enriched["title"] = enriched.get("title") or first.get("title")
            enriched["purchase_url"] = enriched.get("purchase_url") or first.get("product_url")
            enriched["source"] = first.get("source") or enriched.get("source") or "Amazon India"

    return enriched


def _normalize_fetch_mode(fetch_mode: str | None) -> str:
    normalized = str(fetch_mode or "").strip().lower()
    if normalized == "zyte-only":
        return "zyte-only"
    return "auto"


def _get_amazon_product_data(asin: str, fetch_mode: str | None = None):
    mode = _normalize_fetch_mode(fetch_mode)

    if mode == "zyte-only":
        logger.info("Zyte-only mode enabled for ASIN=%s", asin)
        data = fetch_price_from_zyte(asin)
        if data and isinstance(data, dict):
            return _enrich_product_data(asin, data)

        logger.warning("Zyte-only mode failed for ASIN=%s", asin)
        return None

    data = fetch_amazon_price_scraper(asin)

    if data:
        logger.info("Scraper success for ASIN=%s", asin)
        return _enrich_product_data(asin, data)

    logger.info("Direct scraper failed for ASIN=%s, trying local Scrapy", asin)
    data = fetch_price_with_local_scrapy(asin)
    if data and isinstance(data, dict):
        logger.info("Local Scrapy success for ASIN=%s", asin)
        return _enrich_product_data(asin, data)

    logger.info("Local Scrapy failed for ASIN=%s, trying Zyte", asin)
    data = fetch_price_from_zyte(asin)
    if data and isinstance(data, dict):
        return _enrich_product_data(asin, data)

    logger.warning("Scraper failed for ASIN=%s, using fallback", asin)
    return _enrich_product_data(asin, fetch_amazon_price_api(asin))


def get_product_data(
    asin: str | None = None,
    *,
    fetch_mode: str | None = None,
    source_key: str | None = None,
    product_url: str | None = None,
    external_id: str | None = None,
):
    normalized_source = normalize_source_key(source_key)

    if normalized_source == "generic":
        if not product_url:
            return None
        data = fetch_generic_product(product_url)
        identifier = external_id or asin or ""
        return _enrich_product_data(identifier, data)

    if normalized_source != "amazon":
        data = fetch_marketplace_product(
            normalized_source,
            asin=asin,
            external_id=external_id,
            product_url=product_url,
        )
        identifier = asin or external_id or ""
        return _enrich_product_data(identifier, data)

    amazon_asin = str(asin or external_id or "").strip().upper()
    if not amazon_asin:
        return None
    return _get_amazon_product_data(amazon_asin, fetch_mode=fetch_mode)


def resolve_asin(product_name: str | None = None):
    if product_name and product_name.strip():
        return resolve_asin_from_search_term(product_name.strip())

    return None
