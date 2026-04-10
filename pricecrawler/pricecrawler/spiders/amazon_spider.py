import re

import scrapy


class AmazonSpider(scrapy.Spider):
    name = "amazon_price"

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

        title = response.css("#productTitle::text").get()

        price = (
            response.css(".a-price-whole::text").get()
            or response.css("#priceblock_dealprice::text").get()
            or response.css("#priceblock_ourprice::text").get()
        )

        availability = response.css("#availability span::text").get()

        yield {
            "title": title.strip() if title else None,
            "price": price,
            "availability": availability
        }
