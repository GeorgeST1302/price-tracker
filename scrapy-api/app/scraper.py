import asyncio
import re
from typing import Any, Dict, List, Optional

import httpx
from scrapy import Selector

DESKTOP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

SOURCE_LABELS = {
    "amazon": "Amazon India",
    "flipkart": "Flipkart",
    "reliance_digital": "Reliance Digital",
    "snapdeal": "Snapdeal",
    "generic": "Website",
}


def clean_text(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    text = re.sub(r"\s+", " ", text)
    return text or None


def parse_price(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value)
    text = text.replace(",", "")
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
    if not match:
        return None
    try:
        parsed = float(match.group(1))
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def normalize_url(source_key: str, value: Optional[str]) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith("//"):
        raw = f"https:{raw}"
    if raw.startswith("/"):
        if source_key == "amazon":
            raw = f"https://www.amazon.in{raw}"
        elif source_key == "flipkart":
            raw = f"https://www.flipkart.com{raw}"
        elif source_key == "reliance_digital":
            raw = f"https://www.reliancedigital.in{raw}"
        elif source_key == "snapdeal":
            raw = f"https://www.snapdeal.com{raw}"
        else:
            return None
    if not raw.startswith("http://") and not raw.startswith("https://"):
        return None
    return raw


def make_row(source_key: str, title: Optional[str], price: Optional[float], product_url: Optional[str], image_url: Optional[str] = None) -> Optional[Dict[str, Any]]:
    title = clean_text(title)
    product_url = normalize_url(source_key, product_url)
    if not title or not product_url or price is None:
        return None
    return {
        "source_key": source_key,
        "source": SOURCE_LABELS.get(source_key, "Marketplace"),
        "title": title,
        "price": round(price, 2),
        "product_url": product_url,
        "image_url": clean_text(image_url),
    }


async def fetch_text(url: str, timeout: float) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=DESKTOP_HEADERS)
            if response.status_code >= 400:
                return None
            return response.text
    except Exception:
        return None


async def search_amazon(query: str, limit: int, timeout: float) -> List[Dict[str, Any]]:
    html = await fetch_text(f"https://www.amazon.in/s?k={httpx.QueryParams({'q': query})['q']}", timeout)
    if not html:
        return []
    sel = Selector(text=html)
    rows: List[Dict[str, Any]] = []
    for node in sel.css('[data-component-type="s-search-result"]'):
        title = node.css("h2 a span::text").get()
        href = node.css("h2 a::attr(href)").get()
        price_whole = node.css("span.a-price-whole::text").get()
        price_fraction = node.css("span.a-price-fraction::text").get()
        price = parse_price(f"{price_whole or ''}.{price_fraction or '00'}")
        image_url = node.css("img.s-image::attr(src)").get()
        row = make_row("amazon", title, price, href, image_url)
        if row:
            rows.append(row)
        if len(rows) >= limit:
            break
    return rows


async def search_flipkart(query: str, limit: int, timeout: float) -> List[Dict[str, Any]]:
    html = await fetch_text(f"https://www.flipkart.com/search?q={httpx.QueryParams({'q': query})['q']}", timeout)
    if not html:
        return []
    sel = Selector(text=html)
    rows: List[Dict[str, Any]] = []
    for node in sel.css("a[href*='/p/']"):
        title = node.css("::attr(title)").get() or node.css("div::text").get()
        href = node.css("::attr(href)").get()
        text_block = " ".join(node.css("::text").getall())
        price = parse_price(text_block)
        image_url = node.css("img::attr(src)").get() or node.css("img::attr(data-src)").get()
        row = make_row("flipkart", title, price, href, image_url)
        if row:
            rows.append(row)
        if len(rows) >= limit:
            break
    return rows


async def search_reliance(query: str, limit: int, timeout: float) -> List[Dict[str, Any]]:
    api_url = f"https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products?q={httpx.QueryParams({'q': query})['q']}"
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(api_url, headers={**DESKTOP_HEADERS, "Accept": "application/json,text/plain,*/*"})
            if response.status_code >= 400:
                return []
            payload = response.json()
    except Exception:
        return []

    rows: List[Dict[str, Any]] = []
    for item in payload.get("items", []) or []:
        title = clean_text(item.get("name"))
        item_code = item.get("item_code")
        slug = item.get("slug")
        price = parse_price(((item.get("price") or {}).get("effective") or {}).get("min"))
        image_url = None
        medias = item.get("medias") or []
        if medias:
            image_url = medias[0].get("url")
        product_url = f"https://www.reliancedigital.in/{slug}/p/{item_code}" if slug and item_code else None
        row = make_row("reliance_digital", title, price, product_url, image_url)
        if row:
            rows.append(row)
        if len(rows) >= limit:
            break
    return rows


async def search_snapdeal(query: str, limit: int, timeout: float) -> List[Dict[str, Any]]:
    html = await fetch_text(f"https://www.snapdeal.com/search?keyword={httpx.QueryParams({'q': query})['q']}", timeout)
    if not html:
        return []

    rows: List[Dict[str, Any]] = []
    for match in re.finditer(r'href="(https://www\.snapdeal\.com/product/[^"]+)"', html):
        url = match.group(1)
        window = html[max(0, match.start() - 1500): min(len(html), match.end() + 3000)]
        title_match = re.search(r'title="([^"]+)"', window)
        image_match = re.search(r'<img[^>]+(?:src|data-src)="([^"]+)"', window)
        price = parse_price(window)
        row = make_row("snapdeal", title_match.group(1) if title_match else None, price, url, image_match.group(1) if image_match else None)
        if row:
            rows.append(row)
        if len(rows) >= limit:
            break
    return rows


def apply_filters(rows: List[Dict[str, Any]], source: Optional[str], min_rating: Optional[float], availability: Optional[str]) -> List[Dict[str, Any]]:
    # Ratings/availability are optional in this first Scrapy migration.
    filtered = rows
    if source:
        normalized_source = str(source).strip().lower()
        filtered = [row for row in filtered if str(row.get("source_key", "")).lower() == normalized_source]
    if min_rating is not None or availability:
        # Keep behavior stable until richer extraction fields are added.
        return filtered
    return filtered


async def search_products(query: str, limit: int, source: Optional[str], min_rating: Optional[float], availability: Optional[str], timeout: float) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 9), 15))
    per_source = max(1, (safe_limit + 3) // 4)

    tasks = [
        search_amazon(query, per_source, timeout),
        search_flipkart(query, per_source, timeout),
        search_reliance(query, per_source, timeout),
        search_snapdeal(query, per_source, timeout),
    ]

    settled = await asyncio.gather(*tasks, return_exceptions=True)
    merged: List[Dict[str, Any]] = []
    seen = set()

    for result in settled:
        if isinstance(result, Exception):
            continue
        for row in result:
            key = f"{row.get('source_key')}::{row.get('product_url')}"
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)

    merged = sorted(merged, key=lambda item: float(item.get("price") or 1e18))
    merged = apply_filters(merged, source=source, min_rating=min_rating, availability=availability)
    return merged[:safe_limit]


async def fetch_snapshot(source_key: Optional[str], product_url: Optional[str], asin: Optional[str], external_id: Optional[str], timeout: float) -> Optional[Dict[str, Any]]:
    source = str(source_key or "generic").strip().lower()
    url = normalize_url(source, product_url)

    if source == "amazon" and not url and asin:
        url = f"https://www.amazon.in/dp/{asin}"

    if source == "reliance_digital" and not url and external_id:
        url = f"https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products/{external_id}"

    if not url:
        return None

    if source == "reliance_digital" and "raven-api" in url:
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(url, headers={**DESKTOP_HEADERS, "Accept": "application/json,text/plain,*/*"})
                if response.status_code >= 400:
                    return None
                payload = response.json()
                data = payload.get("data") or {}
                price = parse_price(((data.get("price") or {}).get("effective") or {}).get("min"))
                if price is None:
                    return None
                return {
                    "price": round(price, 2),
                    "fetch_method": "scrapy_api",
                    "image_url": ((data.get("medias") or [{}])[0]).get("url"),
                    "brand": clean_text(((data.get("brand") or {}).get("name"))),
                }
        except Exception:
            return None

    html = await fetch_text(url, timeout)
    if not html:
        return None

    sel = Selector(text=html)
    title = (
        sel.css("meta[property='og:title']::attr(content)").get()
        or sel.css("title::text").get()
    )
    image_url = sel.css("meta[property='og:image']::attr(content)").get()

    if source == "amazon":
        whole = sel.css("span.a-price-whole::text").get()
        frac = sel.css("span.a-price-fraction::text").get()
        price = parse_price(f"{whole or ''}.{frac or '00'}")
    else:
        text_blob = " ".join(sel.css("body *::text").getall()[:5000])
        price = parse_price(text_blob)

    if price is None:
        return None

    return {
        "price": round(price, 2),
        "fetch_method": "scrapy_api",
        "image_url": clean_text(image_url),
        "brand": None,
        "title": clean_text(title),
    }
