import logging
import json
import os
import re
import time
from urllib.parse import quote_plus, urlparse

import requests
from bs4 import BeautifulSoup

try:
    from .scraper_service import (
        DESKTOP_BROWSER_HEADERS,
        MOBILE_BROWSER_HEADERS,
        _extract_price_value,
        _request_with_retries,
        fetch_amazon_price_scraper,
        search_amazon_products,
    )
except ImportError:
    from scraper_service import (
        DESKTOP_BROWSER_HEADERS,
        MOBILE_BROWSER_HEADERS,
        _extract_price_value,
        _request_with_retries,
        fetch_amazon_price_scraper,
        search_amazon_products,
    )


logger = logging.getLogger(__name__)

SOURCE_LABELS = {
    "amazon": "Amazon India",
    "reliance_digital": "Reliance Digital",
    "snapdeal": "Snapdeal",
    "generic": "Website",
}

ALLOWED_DOMAINS = {
    "amazon": ("amazon.in", "www.amazon.in"),
    "reliance_digital": ("reliancedigital.in", "www.reliancedigital.in"),
    "snapdeal": ("snapdeal.com", "www.snapdeal.com"),
}

DEFAULT_SKIP_PREFIXES = (
    "/private/",
    "/forum/admin/",
    "/wp-admin/",
    "/admin/",
    "/login",
    "/account/",
    "/share/",
)
DEFAULT_SKIP_PATTERNS = (
    r"[?&](utm_|fbclid|gclid)=",
    r"/(cart|checkout|wishlist)(/|$)",
)


def normalize_source_key(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "amazon_india": "amazon",
        "amazon": "amazon",
        "reliance": "reliance_digital",
        "reliance_digital": "reliance_digital",
        "snapdeal": "snapdeal",
        "generic": "generic",
        "url": "generic",
        "website": "generic",
    }
    return aliases.get(normalized, "amazon")


def get_source_label(source_key: str | None) -> str:
    return SOURCE_LABELS.get(normalize_source_key(source_key), "Marketplace")


def detect_source_key_from_url(url: str | None) -> str:
    if not url:
        return "generic"

    try:
        hostname = (urlparse(str(url)).hostname or "").lower()
    except Exception:
        hostname = ""

    if not hostname:
        return "generic"

    if "amazon." in hostname:
        return "amazon"
    if hostname.endswith("reliancedigital.in"):
        return "reliance_digital"
    if hostname.endswith("snapdeal.com"):
        return "snapdeal"

    return "generic"


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    return cleaned or None


def _strip_html(value: str | None) -> str | None:
    if not value:
        return None
    return _clean_text(BeautifulSoup(str(value), "html.parser").get_text(" ", strip=True))


def _query_tokens(query: str) -> list[str]:
    stop_words = {"for", "with", "and", "the", "from", "buy", "online", "price"}
    tokens = []
    for raw in re.split(r"[^a-z0-9]+", str(query or "").lower()):
        if len(raw) < 3 or raw in stop_words:
            continue
        tokens.append(raw)
    return tokens


def _match_score(query: str, title: str | None) -> float:
    tokens = _query_tokens(query)
    title_text = str(title or "").lower()
    if not tokens or not title_text:
        return 0.0
    hits = sum(1 for token in tokens if token in title_text)
    return hits / len(tokens)


def _normalize_image_url(value: str | None) -> str | None:
    if not value:
        return None
    image_url = str(value).strip()
    if image_url.startswith("https:/") and not image_url.startswith("https://"):
        return "https://" + image_url.split("https:/", 1)[1].lstrip("/")
    if image_url.startswith("//"):
        return "https:" + image_url
    return image_url


def _normalize_product_url(source_key: str | None, value: str | None) -> str | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if raw.startswith("//"):
        raw = f"https:{raw}"
    if raw.startswith("/"):
        normalized = normalize_source_key(source_key)
        if normalized == "amazon":
            raw = f"https://www.amazon.in{raw}"
        elif normalized == "reliance_digital":
            raw = f"https://www.reliancedigital.in{raw}"
        elif normalized == "snapdeal":
            raw = f"https://www.snapdeal.com{raw}"
        else:
            return None

    if not raw.startswith("http://") and not raw.startswith("https://"):
        return None
    return raw


def _parse_csv_env(name: str, default_values: tuple[str, ...] = ()) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return [value for value in default_values if value]
    return [value.strip() for value in raw.split(",") if value.strip()]


def _should_skip_url(source_key: str | None, value: str | None) -> bool:
    url = _normalize_product_url(source_key, value)
    if not url:
        return True

    try:
        parsed = urlparse(url)
        path = (parsed.path or "").lower()
        query = (parsed.query or "").lower()
        full = f"{path}?{query}" if query else path
    except Exception:
        return True

    prefixes = _parse_csv_env("PRICEPULSE_SKIP_URL_PREFIXES", DEFAULT_SKIP_PREFIXES)
    for prefix in prefixes:
        if not prefix:
            continue
        normalized_prefix = prefix.lower().strip()
        if normalized_prefix and path.startswith(normalized_prefix):
            return True

    patterns = _parse_csv_env("PRICEPULSE_SKIP_URL_PATTERNS", DEFAULT_SKIP_PATTERNS)
    for pattern in patterns:
        try:
            if re.search(pattern, full, flags=re.IGNORECASE):
                return True
        except re.error:
            continue

    return False


def _is_allowed_store_url(source_key: str | None, value: str | None) -> bool:
    url = _normalize_product_url(source_key, value)
    if not url:
        return False
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
    except Exception:
        return False

    allowed = ALLOWED_DOMAINS.get(normalize_source_key(source_key))
    if not allowed:
        return False
    return any(host == domain or host.endswith(f".{domain}") for domain in allowed)


def _is_link_reachable(url: str, source_key: str | None) -> bool:
    """
    Best-effort reachability check to reduce broken links in UI.
    Amazon often blocks HEAD, so we trust canonical amazon.in product URLs.
    """
    normalized_source = normalize_source_key(source_key)
    if normalized_source == "amazon":
        return True

    timeout_seconds = max(1, int(os.getenv("PRICEPULSE_LINK_CHECK_TIMEOUT_SECONDS", "4")))
    user_agent_headers = {
        "User-Agent": DESKTOP_BROWSER_HEADERS.get("User-Agent", "Mozilla/5.0"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        head_resp = requests.head(
            url,
            headers=user_agent_headers,
            timeout=timeout_seconds,
            allow_redirects=True,
        )
        if 200 <= head_resp.status_code < 400:
            return True
    except Exception:
        pass

    try:
        get_resp = requests.get(
            url,
            headers=user_agent_headers,
            timeout=timeout_seconds,
            allow_redirects=True,
            stream=True,
        )
        try:
            status_code = get_resp.status_code
            return 200 <= status_code < 400
        finally:
            get_resp.close()
    except Exception:
        return False


def _rank_rows(search_term: str, rows: list[dict], limit: int) -> list[dict]:
    query_lower = str(search_term or "").lower()
    query_tokens = _query_tokens(search_term)
    min_match_ratio = float(str(os.getenv("PRICEPULSE_MIN_SEARCH_MATCH_RATIO", "0.2")).strip() or "0.2")
    min_match_ratio = max(0.0, min(1.0, min_match_ratio))
    min_valid_price = float(str(os.getenv("PRICEPULSE_MIN_VALID_PRICE", "10")).strip() or "10")

    def _intent_score(title: str | None) -> float:
        title_text = str(title or "").lower()
        if not title_text:
            return -1.0

        accessory_words = {
            "adapter",
            "cable",
            "charger",
            "case",
            "cover",
            "skin",
            "sleeve",
            "dock",
            "hub",
            "converter",
            "stand",
            "mouse pad",
            "keyboard cover",
            "protector",
        }
        laptop_words = {"laptop", "notebook", "macbook", "chromebook"}
        laptop_specs = {
            "intel",
            "ryzen",
            "ssd",
            "ram",
            "windows",
            "core i3",
            "core i5",
            "core i7",
            "16gb",
            "8gb",
            "512gb",
            "1tb",
        }
        laptop_strong_specs = {
            "intel",
            "ryzen",
            "core i3",
            "core i5",
            "core i7",
            "windows",
            "16gb ram",
            "8gb ram",
            "15.6",
            "14 inch",
            "15 inch",
        }
        phone_words = {"phone", "smartphone", "iphone", "android"}
        phone_specs = {"gb", "mah", "camera", "display", "5g", "4g", "snapdragon", "mediatek"}

        accessory_hit = any(word in title_text for word in accessory_words)

        if any(token in query_lower for token in laptop_words):
            has_device = any(word in title_text for word in laptop_words)
            has_specs = any(word in title_text for word in laptop_specs)
            has_strong_specs = any(word in title_text for word in laptop_strong_specs)
            if accessory_hit and not has_strong_specs:
                return -1.1
            if has_device and has_strong_specs:
                return 0.8
            if has_device and not accessory_hit:
                return 0.4
            if has_device and has_specs:
                return 0.2
            return -0.2

        if any(token in query_lower for token in phone_words):
            has_device = any(word in title_text for word in phone_words)
            has_specs = any(word in title_text for word in phone_specs)
            if has_device and has_specs:
                return 0.7
            if has_device and not accessory_hit:
                return 0.35
            if accessory_hit and not has_specs:
                return -0.8
            return -0.2

        # Neutral fallback for non-device-intent searches.
        return -0.1 if accessory_hit else 0.0

    normalized_rows = []
    for row in rows:
        title = _clean_text(row.get("title"))
        product_url = _normalize_product_url(row.get("source_key"), row.get("product_url"))
        price = row.get("price")
        if not title or not product_url:
            continue
        if _should_skip_url(row.get("source_key"), product_url):
            continue
        if not _is_allowed_store_url(row.get("source_key"), product_url):
            continue
        if price is None:
            continue
        try:
            numeric_price = float(price)
            if numeric_price < min_valid_price:
                continue
        except Exception:
            continue

        lexical_score = _match_score(search_term, row.get("title"))
        if query_tokens and lexical_score < min_match_ratio:
            continue
        intent_score = _intent_score(row.get("title"))
        score = lexical_score + intent_score
        if score < -0.3:
            continue
        next_row = dict(row)
        next_row["product_url"] = product_url
        next_row["_score"] = score
        normalized_rows.append(next_row)

    normalized_rows.sort(
        key=lambda row: (
            row.get("price") is None,
            -(row.get("_score", 0.0)),
            row.get("price") or float("inf"),
            row.get("source") or "",
        )
    )
    return [{k: v for k, v in row.items() if not k.startswith("_")} for row in normalized_rows[: max(1, int(limit))]]


def _extract_reliance_item(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None

    title = _clean_text(item.get("name"))
    item_code = item.get("item_code")
    slug = item.get("slug")
    price = (((item.get("price") or {}).get("effective") or {}).get("min"))
    medias = item.get("medias") or []
    image_url = None
    for media in medias:
        if isinstance(media, dict) and media.get("url"):
            image_url = media["url"]
            break

    if not title or not item_code:
        return None

    product_url = f"https://www.reliancedigital.in/{slug}/p/{item_code}" if slug else None
    return {
        "source_key": "reliance_digital",
        "source": get_source_label("reliance_digital"),
        "title": title,
        "price": float(price) if price is not None else None,
        "image_url": _normalize_image_url(image_url),
        "product_url": product_url,
        "seller": ((item.get("brand") or {}).get("name") or "Reliance Digital"),
        "external_id": str(item_code),
        "trackable": bool(product_url),
    }


def search_reliance_products(search_term: str, limit: int = 3) -> list[dict]:
    if not search_term or not search_term.strip():
        return []

    try:
        response = requests.get(
            "https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products",
            params={"q": search_term.strip()},
            headers={**DESKTOP_BROWSER_HEADERS, "Accept": "application/json,text/plain,*/*"},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.warning("Reliance Digital search failed for %r: %s", search_term, exc)
        return []

    rows = []
    for item in payload.get("items") or []:
        parsed = _extract_reliance_item(item)
        if not parsed:
            continue
        rows.append(parsed)
    return _rank_rows(search_term, rows, limit)


def _extract_snapdeal_external_id(url: str | None) -> str | None:
    if not url:
        return None
    match = re.search(r"/product/[^/]+/(\d+)", url)
    if match:
        return match.group(1)
    return None


def search_snapdeal_products(search_term: str, limit: int = 3) -> list[dict]:
    if not search_term or not search_term.strip():
        return []

    try:
        url = f"https://www.snapdeal.com/search?keyword={quote_plus(search_term.strip())}"
        response = _request_with_retries(url, headers=DESKTOP_BROWSER_HEADERS, timeout=15, retries=3)
        if response.status_code != 200:
            logger.warning("Snapdeal search HTTP %s for %r", response.status_code, search_term)
            return []
        soup = BeautifulSoup(response.text, "html.parser")
    except Exception as exc:
        logger.warning("Snapdeal search failed for %r: %s", search_term, exc)
        return []

    rows = []
    for card in soup.select("div.product-tuple-listing"):
        link = card.select_one("a.dp-widget-link")
        title_node = card.select_one("p.product-title")
        price_node = card.select_one("span.product-price")
        image_node = card.select_one("img.product-image")

        title = _clean_text(title_node.get_text(" ", strip=True) if title_node else None)
        product_url = link.get("href") if link else None
        price = _extract_price_value((price_node.get("data-price") if price_node else None) or (price_node.get_text(" ", strip=True) if price_node else None))
        image_url = _normalize_image_url((image_node.get("src") or image_node.get("data-src")) if image_node else None)

        if not title or not product_url:
            continue

        rows.append(
            {
                "source_key": "snapdeal",
                "source": get_source_label("snapdeal"),
                "title": title,
                "price": float(price) if price is not None else None,
                "image_url": image_url,
                "product_url": product_url,
                "seller": "Snapdeal Marketplace",
                "external_id": _extract_snapdeal_external_id(product_url) or card.get("id"),
                "trackable": True,
            }
        )
    return _rank_rows(search_term, rows, limit)


def search_amazon_products_multi(search_term: str, limit: int = 3) -> list[dict]:
    rows = []
    for item in search_amazon_products(search_term, limit=max(1, limit)):
        rows.append(
            {
                "source_key": "amazon",
                "source": get_source_label("amazon"),
                "asin": item.get("asin"),
                "external_id": item.get("asin"),
                "title": item.get("title"),
                "image_url": item.get("image_url"),
                "price": item.get("price"),
                "seller": item.get("seller"),
                "product_url": item.get("product_url"),
                "trackable": True,
            }
        )
    return _rank_rows(search_term, rows, limit)


def search_marketplace_products(search_term: str, limit: int = 9) -> list[dict]:
    if not search_term or not search_term.strip():
        return []

    provider_map = {
        "amazon": search_amazon_products_multi,
        "reliance_digital": search_reliance_products,
        "snapdeal": search_snapdeal_products,
    }
    requested_providers = _parse_csv_env("PRICEPULSE_SEARCH_PROVIDERS", ("amazon", "reliance_digital", "snapdeal"))
    providers = [provider_map[key] for key in requested_providers if key in provider_map]
    if not providers:
        providers = [search_amazon_products_multi, search_reliance_products, search_snapdeal_products]

    max_search_results = max(1, int(os.getenv("PRICEPULSE_MAX_SEARCH_RESULTS", "9")))
    bounded_limit = max(1, min(int(limit), max_search_results))
    per_source = max(1, (bounded_limit + len(providers) - 1) // len(providers))
    requests_per_minute = max(1, int(os.getenv("PRICEPULSE_REQUESTS_PER_MINUTE", "60")))
    min_pause_seconds = 60.0 / float(requests_per_minute)

    rows = []
    for index, provider in enumerate(providers):
        start = time.time()
        rows.extend(provider(search_term, limit=per_source))
        if index < (len(providers) - 1):
            elapsed = time.time() - start
            remaining = min_pause_seconds - elapsed
            if remaining > 0:
                time.sleep(remaining)

    # Keep one listing per source+url to avoid duplicates and noisy output.
    deduped = []
    seen = set()
    for row in rows:
        key = (row.get("source_key"), row.get("product_url") or row.get("external_id") or row.get("title"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    ranked = _rank_rows(search_term, deduped, limit=bounded_limit)
    link_check_limit = max(1, int(os.getenv("PRICEPULSE_LINK_CHECK_LIMIT", "9")))
    checked = 0
    reachable_rows: list[dict] = []
    for row in ranked:
        url = row.get("product_url")
        source_key = row.get("source_key")
        if not url or not _is_allowed_store_url(source_key, url):
            continue
        if _should_skip_url(source_key, url):
            continue

        should_check = checked < link_check_limit
        if should_check:
            checked += 1
            if not _is_link_reachable(url, source_key):
                logger.info("Dropping unreachable result url=%s source=%s", url, source_key)
                continue

        reachable_rows.append(row)

    return reachable_rows[: bounded_limit]


def fetch_reliance_product(external_id: str | None = None, product_url: str | None = None) -> dict | None:
    item_code = str(external_id or "").strip()
    if not item_code and product_url:
        match = re.search(r"/p/(\d+)", str(product_url))
        if match:
            item_code = match.group(1)

    if not item_code:
        return None

    try:
        response = requests.get(
            f"https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products/{item_code}",
            headers={**DESKTOP_BROWSER_HEADERS, "Accept": "application/json,text/plain,*/*"},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        item = payload.get("data") or {}
        title = _clean_text(item.get("name"))
        brand = ((item.get("brand") or {}).get("name"))
        price = (((item.get("price") or {}).get("effective") or {}).get("min"))
        image_url = None
        for media in item.get("medias") or []:
            if isinstance(media, dict) and media.get("url"):
                image_url = media["url"]
                break
        slug = item.get("slug")
        purchase_url = product_url or (f"https://www.reliancedigital.in/{slug}/p/{item_code}" if slug else None)

        if not title or price is None:
            return None

        return {
            "title": title,
            "price": float(price),
            "image_url": _normalize_image_url(image_url),
            "brand": _clean_text(brand),
            "source_key": "reliance_digital",
            "source": get_source_label("reliance_digital"),
            "purchase_url": purchase_url,
            "external_id": item_code,
            "fetch_method": "reliance_api",
        }
    except Exception as exc:
        logger.warning("Reliance Digital fetch failed for %s: %s", item_code, exc)
        return None


def fetch_snapdeal_product(product_url: str | None = None) -> dict | None:
    if not product_url:
        return None

    try:
        response = _request_with_retries(product_url, headers=DESKTOP_BROWSER_HEADERS, timeout=15, retries=3)
        if response.status_code != 200:
            logger.warning("Snapdeal fetch HTTP %s for %s", response.status_code, product_url)
            return None
        soup = BeautifulSoup(response.text, "html.parser")
    except Exception as exc:
        logger.warning("Snapdeal fetch failed for %s: %s", product_url, exc)
        return None

    brand = None
    try:
        for script in soup.select("script[type='application/ld+json']"):
            raw = script.get_text("\n", strip=True)
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except Exception:
                continue

            def _flatten(obj):
                if obj is None:
                    return []
                if isinstance(obj, list):
                    nodes = []
                    for entry in obj:
                        nodes.extend(_flatten(entry))
                    return nodes
                if isinstance(obj, dict) and "@graph" in obj:
                    return _flatten(obj.get("@graph"))
                return [obj]

            for node in _flatten(payload):
                if not isinstance(node, dict):
                    continue
                node_type = node.get("@type")
                types = [node_type] if isinstance(node_type, str) else ([t for t in node_type if isinstance(t, str)] if isinstance(node_type, list) else [])
                if not any(t.lower() == "product" for t in types):
                    continue
                brand_obj = node.get("brand")
                if isinstance(brand_obj, str) and _clean_text(brand_obj):
                    brand = _clean_text(brand_obj)
                    break
                if isinstance(brand_obj, dict) and _clean_text(brand_obj.get("name")):
                    brand = _clean_text(brand_obj.get("name"))
                    break
            if brand:
                break
    except Exception:
        brand = None

    if not brand:
        brand = _clean_text(
            (soup.select_one("meta[property='product:brand']") or {}).get("content")
            or (soup.select_one("meta[name='brand']") or {}).get("content")
            or (soup.select_one("meta[itemprop='brand']") or {}).get("content")
        )

    title = _clean_text((soup.select_one("meta[property='og:title']") or {}).get("content"))
    if not title:
        title = _clean_text(soup.title.get_text(" ", strip=True) if soup.title else None)

    price = _extract_price_value(
        (soup.select_one("span.pdp-final-price") or soup.select_one("span.payBlkBig")).get_text(" ", strip=True)
        if (soup.select_one("span.pdp-final-price") or soup.select_one("span.payBlkBig"))
        else None
    )
    image_url = _normalize_image_url((soup.select_one("meta[property='og:image']") or {}).get("content"))

    if not title or price is None:
        return None

    return {
        "title": title,
        "price": float(price),
        "image_url": image_url,
        "brand": brand,
        "source_key": "snapdeal",
        "source": get_source_label("snapdeal"),
        "purchase_url": product_url,
        "external_id": _extract_snapdeal_external_id(product_url),
        "fetch_method": "snapdeal_scraper",
    }


def fetch_marketplace_product(
    source_key: str | None,
    *,
    asin: str | None = None,
    external_id: str | None = None,
    product_url: str | None = None,
) -> dict | None:
    normalized = normalize_source_key(source_key)

    if normalized == "amazon":
        data = fetch_amazon_price_scraper(str(asin or external_id or "").strip())
        if not data:
            return None
        data["source_key"] = "amazon"
        data["external_id"] = str(asin or external_id or "").strip() or None
        data["purchase_url"] = data.get("purchase_url") or product_url
        return data

    if normalized == "reliance_digital":
        return fetch_reliance_product(external_id=external_id, product_url=product_url)

    if normalized == "snapdeal":
        return fetch_snapdeal_product(product_url=product_url)

    return None
