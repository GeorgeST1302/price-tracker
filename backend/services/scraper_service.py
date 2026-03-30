import logging
import random
import time

import requests
from bs4 import BeautifulSoup
import re


logger = logging.getLogger(__name__)


def _request_with_retries(url: str, headers: dict, timeout: int = 12, retries: int = 3):
    last_exc = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            return requests.get(url, headers=headers, timeout=timeout)
        except Exception as exc:
            last_exc = exc
            # Backoff with jitter.
            if attempt < retries:
                time.sleep((0.6 * attempt) + random.random() * 0.4)
    raise last_exc


def fetch_amazon_price_scraper(asin: str):
    try:
        url = f"https://www.amazon.in/dp/{asin}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "en-IN,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }

        response = _request_with_retries(url, headers=headers, timeout=12, retries=3)

        if response.status_code != 200:
            logger.warning("Amazon scrape HTTP %s for ASIN=%s", response.status_code, asin)
            return None

        soup = BeautifulSoup(response.text, "html.parser")

        title_node = soup.select_one("#productTitle")

        # Prefer the screen-reader full price if present.
        price_node = (
            soup.select_one("span.a-price span.a-offscreen")
            or soup.select_one("#priceblock_dealprice")
            or soup.select_one("#priceblock_ourprice")
            or soup.select_one(".a-price-whole")
        )

        if not title_node or not getattr(title_node, "text", None):
            return None

        title = title_node.text.strip()

        price_value = None
        if price_node and getattr(price_node, "text", None):
            cleaned = re.sub(r"[^0-9.]", "", price_node.text)
            try:
                price_value = float(cleaned) if cleaned else None
            except Exception:
                price_value = None

        if price_value is None:
            # Graceful failure if the page layout changed or price is hidden.
            logger.info("Amazon scrape missing price for ASIN=%s", asin)
            return None

        return {
            "title": title,
            "price": price_value,
            "source": "scraper",
        }

    except Exception as exc:
        logger.exception("Amazon scrape failed for ASIN=%s: %s", asin, exc)
        return None


def resolve_asin_from_search_term(search_term: str):
    """Resolve first Amazon result ASIN from a user-friendly search query."""
    try:
        if not search_term or not search_term.strip():
            return None

        query = search_term.strip().replace(" ", "+")
        url = f"https://www.amazon.in/s?k={query}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "en-IN,en;q=0.9",
        }

        response = _request_with_retries(url, headers=headers, timeout=12, retries=3)
        if response.status_code != 200:
            logger.warning("Amazon search HTTP %s for term=%r", response.status_code, search_term)
            return None

        soup = BeautifulSoup(response.text, "html.parser")

        # Preferred: explicit ASIN attribute on search result cards.
        first_with_asin = soup.select_one("div.s-result-item[data-asin]")
        if first_with_asin:
            asin = (first_with_asin.get("data-asin") or "").strip()
            if re.fullmatch(r"[A-Z0-9]{10}", asin):
                return asin

        # Fallback: parse from first /dp/<ASIN> link.
        link = soup.select_one("a[href*='/dp/']")
        if link and link.get("href"):
            match = re.search(r"/dp/([A-Z0-9]{10})", link.get("href"))
            if match:
                return match.group(1)

        return None
    except Exception as exc:
        logger.exception("Amazon ASIN resolve failed for term=%r: %s", search_term, exc)
        return None


def search_amazon_products(search_term: str, limit: int = 6):
    """Return lightweight live search results for UI preview cards."""
    try:
        if not search_term or not search_term.strip():
            return []

        query = search_term.strip().replace(" ", "+")
        url = f"https://www.amazon.in/s?k={query}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "en-IN,en;q=0.9",
        }

        response = _request_with_retries(url, headers=headers, timeout=12, retries=3)
        if response.status_code != 200:
            logger.warning("Amazon live search HTTP %s for term=%r", response.status_code, search_term)
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        results = []
        seen_asin = set()

        def extract_price(node):
            if not node or not getattr(node, "text", None):
                return None
            cleaned = re.sub(r"[^0-9.]", "", node.text)
            try:
                return float(cleaned) if cleaned else None
            except Exception:
                return None

        # Strategy 1: standard Amazon result cards.
        items = soup.select("div.s-result-item[data-asin], div[data-component-type='s-search-result']")
        for item in items:
            asin = (item.get("data-asin") or "").strip()
            if not re.fullmatch(r"[A-Z0-9]{10}", asin) or asin in seen_asin:
                continue

            title_node = item.select_one("h2 a span") or item.select_one("a h2 span")
            img_node = item.select_one("img.s-image") or item.select_one("img")
            price_node = item.select_one("span.a-price span.a-offscreen") or item.select_one("span.a-price-whole")

            title = title_node.text.strip() if title_node and title_node.text else None
            if not title:
                continue

            results.append(
                {
                    "asin": asin,
                    "title": title,
                    "image_url": img_node.get("src") if img_node else None,
                    "price": extract_price(price_node),
                    "seller": "Amazon Marketplace",
                }
            )
            seen_asin.add(asin)

            if len(results) >= max(1, limit):
                return results

        # Strategy 2: fallback by scanning /dp/<ASIN> links when card selectors fail.
        for link in soup.select("a[href*='/dp/']"):
            href = link.get("href") or ""
            match = re.search(r"/dp/([A-Z0-9]{10})", href)
            if not match:
                continue

            asin = match.group(1)
            if asin in seen_asin:
                continue

            title = None
            if link.get("aria-label"):
                title = link.get("aria-label").strip()
            elif link.text and link.text.strip():
                title = link.text.strip()

            # Skip non-product/nav links.
            if not title or len(title) < 6:
                continue

            img_node = None
            parent = link.parent
            if parent:
                img_node = parent.select_one("img")

            results.append(
                {
                    "asin": asin,
                    "title": title,
                    "image_url": img_node.get("src") if img_node else None,
                    "price": None,
                    "seller": "Amazon Marketplace",
                }
            )
            seen_asin.add(asin)

            if len(results) >= max(1, limit):
                break

        return results
    except Exception as exc:
        logger.exception("Amazon live search failed for term=%r: %s", search_term, exc)
        return []