# Define here the models for your scraped items
#
# See documentation in:
# https://docs.scrapy.org/en/latest/topics/items.html

import scrapy


class PricecrawlerItem(scrapy.Item):
    asin = scrapy.Field()
    title = scrapy.Field()
    price = scrapy.Field()
    image_url = scrapy.Field()
    brand = scrapy.Field()
    availability = scrapy.Field()
    product_url = scrapy.Field()
