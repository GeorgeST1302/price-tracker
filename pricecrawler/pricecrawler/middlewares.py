import json
import random
import time
from collections import deque
from urllib import request

from scrapy import signals
from scrapy.downloadermiddlewares.retry import get_retry_request


class PricecrawlerSpiderMiddleware:
    # Not all methods need to be defined. If a method is not defined,
    # scrapy acts as if the spider middleware does not modify the
    # passed objects.

    @classmethod
    def from_crawler(cls, crawler):
        # This method is used by Scrapy to create your spiders.
        s = cls()
        crawler.signals.connect(s.spider_opened, signal=signals.spider_opened)
        return s

    def process_spider_input(self, response, spider):
        # Called for each response that goes through the spider
        # middleware and into the spider.

        # Should return None or raise an exception.
        return None

    def process_spider_output(self, response, result, spider):
        # Called with the results returned from the Spider, after
        # it has processed the response.

        # Must return an iterable of Request, or item objects.
        for i in result:
            yield i

    def process_spider_exception(self, response, exception, spider):
        # Called when a spider or process_spider_input() method
        # (from other spider middleware) raises an exception.

        # Should return either None or an iterable of Request or item objects.
        pass

    async def process_start(self, start):
        # Called with an async iterator over the spider start() method or the
        # matching method of an earlier spider middleware.
        async for item_or_request in start:
            yield item_or_request

    def spider_opened(self, spider):
        spider.logger.info("Spider opened: %s" % spider.name)


class PricecrawlerDownloaderMiddleware:
    # Not all methods need to be defined. If a method is not defined,
    # scrapy acts as if the downloader middleware does not modify the
    # passed objects.

    @classmethod
    def from_crawler(cls, crawler):
        # This method is used by Scrapy to create your spiders.
        s = cls()
        crawler.signals.connect(s.spider_opened, signal=signals.spider_opened)
        return s

    def process_request(self, request, spider):
        # Called for each request that goes through the downloader
        # middleware.

        # Must either:
        # - return None: continue processing this request
        # - or return a Response object
        # - or return a Request object
        # - or raise IgnoreRequest: process_exception() methods of
        #   installed downloader middleware will be called
        return None

    def process_response(self, request, response, spider):
        # Called with the response returned from the downloader.

        # Must either;
        # - return a Response object
        # - return a Request object
        # - or raise IgnoreRequest
        return response

    def process_exception(self, request, exception, spider):
        # Called when a download handler or a process_request()
        # (from other downloader middleware) raises an exception.

        # Must either:
        # - return None: continue processing this exception
        # - return a Response object: stops process_exception() chain
        # - return a Request object: stops process_exception() chain
        pass

    def spider_opened(self, spider):
        spider.logger.info("Spider opened: %s" % spider.name)


class RotatingProxyMiddleware:
    """Rotate free proxies and retry transparently on proxy failures."""

    FAIL_HTTP_STATUSES = {403, 429}

    def __init__(
        self,
        *,
        proxy_sources,
        cooldown_seconds,
        min_pool_size,
        validate_timeout,
        max_validation_proxies,
        selection_strategy,
        retry_reason_prefix,
    ):
        self.proxy_sources = list(proxy_sources)
        self.cooldown_seconds = int(cooldown_seconds)
        self.min_pool_size = int(min_pool_size)
        self.validate_timeout = float(validate_timeout)
        self.max_validation_proxies = int(max_validation_proxies)
        self.selection_strategy = str(selection_strategy).strip().lower()
        self.retry_reason_prefix = str(retry_reason_prefix)

        self.working_proxies = []
        self.blacklist = {}  # {proxy: expiry_ts}
        self._round_robin = deque()

    @classmethod
    def from_crawler(cls, crawler):
        settings = crawler.settings
        obj = cls(
            proxy_sources=settings.getlist(
                "ROTATING_PROXY_SOURCES",
                [
                    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
                    "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
                ],
            ),
            cooldown_seconds=settings.getint("ROTATING_PROXY_COOLDOWN_SECONDS", 300),
            min_pool_size=settings.getint("ROTATING_PROXY_MIN_POOL_SIZE", 8),
            validate_timeout=settings.getfloat("ROTATING_PROXY_VALIDATE_TIMEOUT_SECONDS", 5.0),
            max_validation_proxies=settings.getint("ROTATING_PROXY_MAX_VALIDATE_PER_REFRESH", 60),
            selection_strategy=settings.get("ROTATING_PROXY_SELECTION_STRATEGY", "random"),
            retry_reason_prefix=settings.get("ROTATING_PROXY_RETRY_REASON_PREFIX", "rotating_proxy"),
        )
        crawler.signals.connect(obj.spider_opened, signal=signals.spider_opened)
        crawler.signals.connect(obj.spider_closed, signal=signals.spider_closed)
        return obj

    def spider_opened(self, spider):
        self._ensure_pool(spider, force=True)
        spider.logger.info(
            "RotatingProxyMiddleware initialized. pool=%s blacklist=%s",
            len(self.working_proxies),
            len(self.blacklist),
        )

    def spider_closed(self, spider):
        spider.logger.info(
            "RotatingProxyMiddleware closed. pool=%s blacklist=%s",
            len(self.working_proxies),
            len(self.blacklist),
        )

    def process_request(self, request_obj, spider):
        self._ensure_pool(spider)
        proxy = self._choose_proxy()
        if not proxy:
            spider.logger.warning("No working proxy available; request continues without proxy: %s", request_obj.url)
            return None

        request_obj.meta["proxy"] = proxy
        request_obj.meta["rotating_proxy"] = proxy
        spider.logger.debug("Proxy used: %s -> %s", proxy, request_obj.url)
        return None

    def process_response(self, request_obj, response, spider):
        proxy = request_obj.meta.get("rotating_proxy") or request_obj.meta.get("proxy")
        if response.status in self.FAIL_HTTP_STATUSES:
            self._mark_bad(proxy, spider, reason=f"http_{response.status}")
            retry_req = get_retry_request(
                request_obj,
                spider=spider,
                reason=f"{self.retry_reason_prefix}_http_{response.status}",
            )
            if retry_req is not None:
                spider.logger.info(
                    "Retrying with new proxy after status=%s. proxy=%s url=%s",
                    response.status,
                    proxy,
                    request_obj.url,
                )
                return retry_req
        return response

    def process_exception(self, request_obj, exception, spider):
        proxy = request_obj.meta.get("rotating_proxy") or request_obj.meta.get("proxy")
        self._mark_bad(proxy, spider, reason=exception.__class__.__name__)
        retry_req = get_retry_request(
            request_obj,
            spider=spider,
            reason=f"{self.retry_reason_prefix}_{exception.__class__.__name__}",
        )
        if retry_req is not None:
            spider.logger.info(
                "Retrying after exception=%s proxy=%s url=%s",
                exception.__class__.__name__,
                proxy,
                request_obj.url,
            )
            return retry_req
        return None

    def _ensure_pool(self, spider, force=False):
        self._cleanup_blacklist()
        if not force and len(self.working_proxies) >= self.min_pool_size:
            return

        new_candidates = self._fetch_proxy_candidates(spider)
        if not new_candidates:
            spider.logger.warning("Proxy refresh found no candidates.")
            return

        validated = self._validate_candidates(new_candidates, spider)
        if not validated:
            spider.logger.warning("Proxy refresh validated 0 proxies.")
            return

        existing = set(self.working_proxies)
        added = 0
        for proxy in validated:
            if proxy in existing:
                continue
            self.working_proxies.append(proxy)
            self._round_robin.append(proxy)
            existing.add(proxy)
            added += 1

        spider.logger.info(
            "Proxy pool refreshed. added=%s pool=%s blacklist=%s",
            added,
            len(self.working_proxies),
            len(self.blacklist),
        )

    def _fetch_proxy_candidates(self, spider):
        candidates = []
        seen = set()
        for src in self.proxy_sources:
            try:
                req = request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
                with request.urlopen(req, timeout=self.validate_timeout) as resp:
                    payload = resp.read().decode("utf-8", errors="ignore")
            except Exception as exc:
                spider.logger.warning("Proxy source failed: %s (%s)", src, exc)
                continue

            for line in payload.splitlines():
                line = line.strip()
                if not line or ":" not in line:
                    continue
                host, port = line.rsplit(":", 1)
                if not host or not port.isdigit():
                    continue
                proxy = f"http://{host}:{port}"
                if proxy in seen or proxy in self.blacklist:
                    continue
                seen.add(proxy)
                candidates.append(proxy)
                if len(candidates) >= self.max_validation_proxies:
                    return candidates
        return candidates

    def _validate_candidates(self, candidates, spider):
        validated = []
        random.shuffle(candidates)
        for proxy in candidates:
            if self._validate_proxy(proxy):
                validated.append(proxy)
            if len(validated) >= self.min_pool_size:
                break
        spider.logger.info("Proxy validation done. ok=%s checked=%s", len(validated), len(candidates))
        return validated

    def _validate_proxy(self, proxy):
        """Validate a proxy using httpbin.org/ip with a strict timeout."""
        proxy_handler = request.ProxyHandler({"http": proxy, "https": proxy})
        opener = request.build_opener(proxy_handler)
        req = request.Request("http://httpbin.org/ip", headers={"User-Agent": "Mozilla/5.0"})
        try:
            with opener.open(req, timeout=self.validate_timeout) as resp:
                if int(resp.status) != 200:
                    return False
                raw = resp.read().decode("utf-8", errors="ignore")
                payload = json.loads(raw)
                origin = str(payload.get("origin", "")).strip()
                return bool(origin)
        except Exception:
            return False

    def _choose_proxy(self):
        self._cleanup_blacklist()
        if not self.working_proxies:
            return None

        if self.selection_strategy == "round_robin":
            if not self._round_robin:
                self._round_robin = deque(self.working_proxies)
            proxy = self._round_robin[0]
            self._round_robin.rotate(-1)
            return proxy

        # Default: random selection for better diversity.
        return random.choice(self.working_proxies)

    def _mark_bad(self, proxy, spider, reason="unknown"):
        if not proxy:
            return
        now = int(time.time())
        self.blacklist[proxy] = now + self.cooldown_seconds
        if proxy in self.working_proxies:
            self.working_proxies = [p for p in self.working_proxies if p != proxy]
        self._round_robin = deque([p for p in self._round_robin if p != proxy])
        spider.logger.warning(
            "Proxy failure: proxy=%s reason=%s cooldown=%ss pool=%s blacklist=%s",
            proxy,
            reason,
            self.cooldown_seconds,
            len(self.working_proxies),
            len(self.blacklist),
        )

    def _cleanup_blacklist(self):
        now = int(time.time())
        expired = [proxy for proxy, expiry in self.blacklist.items() if expiry <= now]
        for proxy in expired:
            self.blacklist.pop(proxy, None)
