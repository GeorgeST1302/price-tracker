import json
import logging
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

try:
    from .scraper_service import DESKTOP_BROWSER_HEADERS, _extract_price_value, _request_with_retries
except ImportError:
    from scraper_service import DESKTOP_BROWSER_HEADERS, _extract_price_value, _request_with_retries


logger = logging.getLogger(__name__)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    return cleaned or None


def _normalize_image_url(url: str | None) -> str | None:
    if not url:
        return None
    value = str(url).strip()
    if value.startswith("//"):
        return "https:" + value
    return value


def _extract_brand(product_obj: dict) -> str | None:
    brand = product_obj.get("brand")
    if isinstance(brand, str):
        return _clean_text(brand)
    if isinstance(brand, dict):
        return _clean_text(brand.get("name"))
    if isinstance(brand, list):
        for item in brand:
            if isinstance(item, str) and _clean_text(item):
                return _clean_text(item)
            if isinstance(item, dict) and _clean_text(item.get("name")):
                return _clean_text(item.get("name"))
    return None


def _extract_offers_price(product_obj: dict) -> float | None:
    offers = product_obj.get("offers")
    candidates: list[float] = []

    def _consider(offer: dict):
        if not isinstance(offer, dict):
            return
        for key in ("price", "lowPrice", "highPrice", "priceSpecification"):
            value = offer.get(key)
            if isinstance(value, dict):
                price_value = _extract_price_value(value.get("price"))
            else:
                price_value = _extract_price_value(value)
            if price_value is not None:
                candidates.append(float(price_value))

    if isinstance(offers, dict):
        _consider(offers)
    elif isinstance(offers, list):
        for offer in offers:
            _consider(offer)

    if not candidates:
        return None

    # Prefer the lowest numeric candidate.
    return float(min(candidates))


def _extract_product_from_jsonld(payload) -> dict | None:
    """Return a normalized Product-like dict from JSON-LD payload."""

    def _flatten(obj):
        if obj is None:
            return []
        if isinstance(obj, list):
            items = []
            for entry in obj:
                items.extend(_flatten(entry))
            return items
        if isinstance(obj, dict) and "@graph" in obj:
            return _flatten(obj.get("@graph"))
        return [obj]

    for node in _flatten(payload):
        if not isinstance(node, dict):
            continue

        node_type = node.get("@type")
        types = []
        if isinstance(node_type, str):
            types = [node_type]
        elif isinstance(node_type, list):
            types = [t for t in node_type if isinstance(t, str)]

        if not any(t.lower() == "product" for t in types):
            continue

        title = _clean_text(node.get("name"))
        if not title:
            continue

        image = node.get("image")
        image_url = None
        if isinstance(image, str):
            image_url = image
        elif isinstance(image, list) and image:
            first = image[0]
            if isinstance(first, str):
                image_url = first

        return {
            "title": title,
            "price": _extract_offers_price(node),
            "image_url": _normalize_image_url(image_url),
            "brand": _extract_brand(node),
        }

    return None


def fetch_generic_product(product_url: str) -> dict | None:
    if not product_url or not str(product_url).strip():
        return None

    url = str(product_url).strip()

    try:
        response = _request_with_retries(url, headers=DESKTOP_BROWSER_HEADERS, timeout=15, retries=3)
        if response.status_code != 200:
            logger.warning("Generic scrape HTTP %s for %s", response.status_code, url)
            return None
        html = response.text
    except Exception as exc:
        logger.warning("Generic scrape failed for %s: %s", url, exc)
        return None

    soup = BeautifulSoup(html, "html.parser")

    # JSON-LD (best signal)
    parsed = None
    for script in soup.select("script[type='application/ld+json']"):
        raw = script.get_text("\n", strip=True)
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue

        parsed = _extract_product_from_jsonld(payload)
        if parsed:
            break

    title = (parsed or {}).get("title")
    price = (parsed or {}).get("price")
    image_url = (parsed or {}).get("image_url")
    brand = (parsed or {}).get("brand")

    if not title:
        title = _clean_text((soup.select_one("meta[property='og:title']") or {}).get("content"))
    if not title and soup.title and soup.title.text:
        title = _clean_text(soup.title.text)

    if not image_url:
        image_url = _normalize_image_url((soup.select_one("meta[property='og:image']") or {}).get("content"))

    if not brand:
        brand = _clean_text(
            (soup.select_one("meta[property='product:brand']") or {}).get("content")
            or (soup.select_one("meta[name='brand']") or {}).get("content")
            or (soup.select_one("meta[itemprop='brand']") or {}).get("content")
        )

    if price is None:
        meta_price = (
            (soup.select_one("meta[property='product:price:amount']") or {}).get("content")
            or (soup.select_one("meta[itemprop='price']") or {}).get("content")
            or (soup.select_one("meta[name='price']") or {}).get("content")
        )
        price = _extract_price_value(meta_price)

    if price is None:
        # Heuristic fallback: look for a currency-ish pattern.
        text = soup.get_text(" ", strip=True)
        match = re.search(r"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*\.?[0-9]{0,2})", text, flags=re.IGNORECASE)
        if match:
            price = _extract_price_value(match.group(1))

    if not title or price is None:
        return None

    hostname = (urlparse(url).hostname or "").lower()
    source = hostname or "Website"

    return {
        "title": title,
        "price": float(price),
        "image_url": image_url,
        "brand": brand,
        "source_key": "generic",
        "source": source,
        "purchase_url": url,
        "external_id": None,
        "fetch_method": "generic_scraper",
    }
