import logging
import random
import re
import time
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup


logger = logging.getLogger(__name__)


DESKTOP_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

MOBILE_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Mobile Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _request_with_retries(url: str, headers: dict, timeout: int = 12, retries: int = 3):
    last_exc = None
    last_response = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
                last_response = response
                time.sleep((0.6 * attempt) + random.random() * 0.4)
                continue
            return response
        except Exception as exc:
            last_exc = exc
            # Backoff with jitter.
            if attempt < retries:
                time.sleep((0.6 * attempt) + random.random() * 0.4)
    if last_response is not None:
        return last_response
    raise last_exc


def _extract_price_value(text: str | None):
    if not text:
        return None

    cleaned = re.sub(r"[^0-9.]", "", str(text).replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except Exception:
        return None


def _extract_asin_from_href(href: str | None):
    if not href:
        return None

    for pattern in (r"/dp/([A-Z0-9]{10})", r"pd_rd_i=([A-Z0-9]{10})"):
        match = re.search(pattern, href)
        if match:
            return match.group(1)
    return None


def _extract_mobile_card_title(card, asin: str):
    candidates = []
    for link in card.select("a[href]"):
        href = link.get("href") or ""
        if asin not in href:
            continue

        text = re.sub(r"\s+", " ", link.get_text(" ", strip=True)).strip()
        if not text:
            continue

        lower = text.lower()
        if any(
            marker in lower
            for marker in (
                "amazon's choice",
                "limited time deal",
                "free delivery",
                "see all details",
                "stars",
                "bought in past month",
                "m.r.p",
                "% off",
            )
        ):
            continue

        if re.fullmatch(r"[\d\s.,()+-]+", text):
            continue

        candidates.append(text)

    if not candidates:
        return None

    title = max(candidates, key=len)
    brand = next((item for item in candidates if len(item.split()) <= 2 and len(item) <= 20), None)
    if brand and brand.lower() not in title.lower():
        title = f"{brand} {title}"

    return title


def _extract_mobile_card_image(card):
    for img in card.select("img"):
        for attr in ("data-src", "src"):
            value = (img.get(attr) or "").strip()
            if not value or "grey-pixel" in value or value.endswith(".svg"):
                continue
            return value
    return None


def _extract_product_page_image(soup):
    selectors = (
        "#landingImage",
        "#imgBlkFront",
        "img[data-old-hires]",
        "meta[property='og:image']",
    )
    for selector in selectors:
        node = soup.select_one(selector)
        if not node:
            continue
        for attr in ("data-old-hires", "src", "content"):
            value = (node.get(attr) or "").strip()
            if value:
                return value
    return None


def _extract_mobile_card_price(card):
    selectors = (
        "span.a-price-whole",
        "span.a-price span.a-offscreen",
        "span.a-price span[aria-hidden='true']",
    )
    for selector in selectors:
        node = card.select_one(selector)
        value = _extract_price_value(node.get_text(" ", strip=True) if node else None)
        if value is not None:
            return value
    return None


def fetch_amazon_price_scraper(asin: str):
    try:
        url = f"https://www.amazon.in/dp/{asin}"

        response = _request_with_retries(url, headers=MOBILE_BROWSER_HEADERS, timeout=12, retries=3)

        if response.status_code != 200:
            logger.warning("Amazon scrape HTTP %s for ASIN=%s", response.status_code, asin)
            return None

        soup = BeautifulSoup(response.text, "html.parser")

        title_node = (
            soup.select_one("#productTitle")
            or soup.select_one("#title")
            or soup.select_one("h1")
        )

        # Prefer the screen-reader full price if present.
        price_node = (
            soup.select_one("span.a-price span.a-offscreen")
            or soup.select_one("#priceblock_dealprice")
            or soup.select_one("#priceblock_ourprice")
            or soup.select_one(".a-price-whole")
        )

        title = title_node.get_text(" ", strip=True) if title_node and getattr(title_node, "text", None) else None
        if not title and soup.title and soup.title.text:
            title = re.sub(r"^\s*Amazon\.in\s*:?\s*", "", soup.title.text).strip()

        if not title or title == "Amazon.in":
            return None

        image_url = _extract_product_page_image(soup)
        price_value = _extract_price_value(price_node.get_text(" ", strip=True) if price_node else None)

        if price_value is None:
            # Fallback: search by ASIN and use the first matching live result.
            logger.info("Amazon direct page missing price for ASIN=%s, retrying via search", asin)
            fallback_results = search_amazon_products(asin, limit=1)
            if fallback_results:
                first = fallback_results[0]
                if first.get("price") is not None:
                    return {
                        "title": first.get("title") or title,
                        "price": float(first["price"]),
                        "source": "Amazon India",
                        "image_url": first.get("image_url"),
                        "purchase_url": first.get("product_url") or url,
                    }
            return None

        return {
            "title": title,
            "price": price_value,
            "source": "Amazon India",
            "image_url": image_url,
            "purchase_url": url,
        }

    except Exception as exc:
        logger.exception("Amazon scrape failed for ASIN=%s: %s", asin, exc)
        return None


def resolve_asin_from_search_term(search_term: str):
    """Resolve first Amazon result ASIN from a user-friendly search query."""
    try:
        if not search_term or not search_term.strip():
            return None

        results = search_amazon_products(search_term, limit=1)
        if results:
            return results[0]["asin"]
        return None
    except Exception as exc:
        logger.exception("Amazon ASIN resolve failed for term=%r: %s", search_term, exc)
        return None


def search_amazon_products(search_term: str, limit: int = 6):
    """Return lightweight live search results for UI preview cards."""
    try:
        if not search_term or not search_term.strip():
            return []

        query = quote_plus(search_term.strip())
        url = f"https://www.amazon.in/gp/aw/s?k={query}"

        response = _request_with_retries(url, headers=MOBILE_BROWSER_HEADERS, timeout=12, retries=3)
        if response.status_code != 200:
            logger.warning("Amazon live search HTTP %s for term=%r", response.status_code, search_term)
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        results = []
        seen_asin = set()

        for card in soup.select("div.s-widget-container"):
            card_html = str(card)
            if "/ref=mp_s_a_" not in card_html:
                continue

            hrefs = [link.get("href") or "" for link in card.select("a[href*='/dp/']")]
            asin = next(
                (
                    candidate
                    for candidate in (_extract_asin_from_href(href) for href in hrefs)
                    if candidate and candidate not in seen_asin
                ),
                None,
            )
            if not asin or not re.fullmatch(r"[A-Z0-9]{10}", asin):
                continue

            title = _extract_mobile_card_title(card, asin)
            if not title or len(title) < 6:
                continue

            results.append(
                {
                    "asin": asin,
                    "title": title,
                    "image_url": _extract_mobile_card_image(card),
                    "price": _extract_mobile_card_price(card),
                    "seller": "Amazon Marketplace",
                    "source": "Amazon India",
                    "product_url": f"https://www.amazon.in/dp/{asin}",
                }
            )
            seen_asin.add(asin)

            if len(results) >= max(1, limit):
                return results

        return results
    except Exception as exc:
        logger.exception("Amazon live search failed for term=%r: %s", search_term, exc)
        return []
