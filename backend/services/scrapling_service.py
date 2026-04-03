import logging
import os
import re

from bs4 import BeautifulSoup

try:
    from .scraper_service import _extract_price_value
except ImportError:
    from scraper_service import _extract_price_value


logger = logging.getLogger(__name__)


def _safe_text(node) -> str | None:
    if not node:
        return None
    text = node.get_text(" ", strip=True)
    return text.strip() if text else None


def _extract_product_page_image(soup: BeautifulSoup) -> str | None:
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


def _extract_brand(soup: BeautifulSoup) -> str | None:
    byline = soup.select_one("#bylineInfo")
    text = _safe_text(byline)
    if not text:
        return None

    match = re.search(r"visit the\s+(.+?)\s+store", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"^by\s+(.+)$", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None


def fetch_amazon_price_with_scrapling(asin: str):
    """
    Fetch Amazon product page using Scrapling (curl-cffi powered) and parse price/title.
    Returns None on any failure so caller fallback chain can continue.
    """
    if not asin:
        return None

    try:
        import scrapling  # lazy import so app still starts if dependency is absent
        from scrapling.core.utils import set_logger

        silent_logger = logging.getLogger("pricepulse.scrapling")
        silent_logger.setLevel(logging.ERROR)
        if not silent_logger.handlers:
            silent_logger.addHandler(logging.StreamHandler())
        set_logger(silent_logger)
    except Exception as exc:
        logger.info("Scrapling not available: %s", exc)
        return None

    verify_ssl = os.getenv("PRICEPULSE_SCRAPLING_VERIFY_SSL", "0") == "1"
    timeout_seconds = int(os.getenv("PRICEPULSE_SCRAPLING_TIMEOUT_SECONDS", "15"))
    url = f"https://www.amazon.in/dp/{asin}"

    try:
        fetcher = scrapling.Fetcher()
        try:
            fetcher.configure(auto_match=False)
        except Exception:
            pass
        response = fetcher.get(
            url,
            timeout=timeout_seconds,
            verify=verify_ssl,
            headers={
                "Accept-Language": "en-IN,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )

        status = getattr(response, "status", None)
        if status != 200:
            logger.warning("Scrapling HTTP %s for ASIN=%s", status, asin)
            return None

        html = str(getattr(response, "text", "") or getattr(response, "html_content", "") or "")
        if not html:
            return None

        soup = BeautifulSoup(html, "html.parser")
        title_node = soup.select_one("#productTitle") or soup.select_one("#title") or soup.select_one("h1")
        price_node = (
            soup.select_one("span.a-price span.a-offscreen")
            or soup.select_one("#priceblock_dealprice")
            or soup.select_one("#priceblock_ourprice")
            or soup.select_one(".a-price-whole")
        )

        title = _safe_text(title_node)
        if not title and soup.title and soup.title.text:
            title = re.sub(r"^\s*Amazon\.in\s*:?\s*", "", soup.title.text).strip()

        price = _extract_price_value(_safe_text(price_node))
        if not title or price is None:
            return None

        return {
            "title": title,
            "price": float(price),
            "source": "Amazon India",
            "image_url": _extract_product_page_image(soup),
            "brand": _extract_brand(soup),
            "purchase_url": url,
            "fetch_method": "scrapling",
        }
    except Exception as exc:
        logger.warning("Scrapling failed for ASIN=%s: %s", asin, exc)
        return None
