import scrapy

class AmazonSpider(scrapy.Spider):
    name = "amazon_price"

    def start_requests(self):
        asin = getattr(self, 'asin', None)

        url = f"https://www.amazon.in/dp/{asin}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept-Language": "en-IN,en;q=0.9"
        }

        yield scrapy.Request(url=url, headers=headers, callback=self.parse)

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
