import json
import re

import scrapy


class AmazonSpider(scrapy.Spider):
    name = "amazon_price"

    def _clean_text(self, value):
        if value is None:
            return None
        cleaned = re.sub(r"\s+", " ", str(value)).strip()
        return cleaned or None

    def _parse_price(self, value):
        if value is None:
            return None
        text = str(value)
        text = text.replace(",", "")
        match = re.search(r"([0-9]+(?:\.[0-9]{1,2})?)", text)
        if not match:
            return None
        try:
            return float(match.group(1))
        except Exception:
            return None

    def _extract_brand_from_jsonld(self, response):
        scripts = response.css("script[type='application/ld+json']::text").getall() or []

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

        for raw in scripts:
            raw = (raw or "").strip()
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except Exception:
                continue
            for node in _flatten(payload):
                if not isinstance(node, dict):
                    continue
                node_type = node.get("@type")
                types = [node_type] if isinstance(node_type, str) else ([t for t in node_type if isinstance(t, str)] if isinstance(node_type, list) else [])
                if not any(t.lower() == "product" for t in types):
                    continue
                brand_obj = node.get("brand")
                if isinstance(brand_obj, str) and self._clean_text(brand_obj):
                    return self._clean_text(brand_obj)
                if isinstance(brand_obj, dict) and self._clean_text(brand_obj.get("name")):
                    return self._clean_text(brand_obj.get("name"))
        return None

    def _extract_brand_from_byline(self, response):
        text = self._clean_text(response.css("#bylineInfo::text").get())
        if not text:
            text = self._clean_text(response.css("#bylineInfo").xpath("string(.)").get())
        if not text:
            return None
        match = re.search(r"visit the\s+(.+?)\s+store", text, flags=re.IGNORECASE)
        if match:
            return self._clean_text(match.group(1))
        match = re.search(r"brand\s*[:\-]\s*(.+)", text, flags=re.IGNORECASE)
        if match:
            return self._clean_text(match.group(1))
        return None

    def _extract_image_url(self, response):
        selectors = [
            "#landingImage::attr(data-old-hires)",
            "#landingImage::attr(src)",
            "#imgBlkFront::attr(src)",
            "img[data-old-hires]::attr(data-old-hires)",
            "meta[property='og:image']::attr(content)",
        ]
        for sel in selectors:
            value = self._clean_text(response.css(sel).get())
            if value:
                return value
        return None

    def __init__(self, asin=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        normalized_asin = (asin or "").strip().upper()
        self.asin = normalized_asin or None

    def _validate_asin(self):
        if not self.asin:
            return "missing_required_asin", "Missing required spider argument: asin"

        if not re.fullmatch(r"[A-Z0-9]{10}", self.asin):
            return f"invalid_asin:{self.asin}", f"Invalid ASIN provided: {self.asin}"

        return None, None

    def _build_start_request(self):
        url = f"https://www.amazon.in/dp/{self.asin}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "en-IN,en;q=0.9"
        }

        return scrapy.Request(url=url, headers=headers, callback=self.parse)

    async def start(self):
        reason, message = self._validate_asin()
        if reason:
            self.logger.error(message)
            close_async = getattr(self.crawler.engine, "close_spider_async", None)
            if close_async is not None:
                await close_async(reason=reason)
            else:
                self.crawler.engine.close_spider(self, reason)
            return

        yield self._build_start_request()

    def start_requests(self):
        reason, message = self._validate_asin()
        if reason:
            self.logger.error(message)
            self.crawler.engine.close_spider(self, reason)
            return

        yield self._build_start_request()

    def parse(self, response):

        title = self._clean_text(
            response.css("#productTitle::text").get()
            or response.css("#title::text").get()
            or response.css("h1::text").get()
        )

        price_raw = (
            response.css("span.a-price span.a-offscreen::text").get()
            or response.css("#priceblock_dealprice::text").get()
            or response.css("#priceblock_ourprice::text").get()
            or response.css(".a-price-whole::text").get()
        )
        price = self._parse_price(price_raw)

        availability = self._clean_text(response.css("#availability span::text").get())
        image_url = self._extract_image_url(response)
        brand = self._extract_brand_from_jsonld(response) or self._extract_brand_from_byline(response)

        yield {
            "asin": self.asin,
            "title": title,
            "price": price,
            "image_url": image_url,
            "brand": brand,
            "availability": availability,
            "product_url": response.url,
        }
