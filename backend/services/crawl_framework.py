import asyncio
import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator, Awaitable, Callable
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup


logger = logging.getLogger(__name__)


CallbackType = Callable[["CrawlResponse"], Awaitable[list[Any]] | list[Any]]


@dataclass
class CrawlRequest:
    url: str
    callback: CallbackType | None = None
    session_id: str = "http"
    meta: dict[str, Any] = field(default_factory=dict)
    retries: int = 0
    priority: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "session_id": self.session_id,
            "meta": self.meta,
            "retries": self.retries,
            "priority": self.priority,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CrawlRequest":
        return cls(
            url=str(payload.get("url", "")).strip(),
            session_id=str(payload.get("session_id", "http")).strip() or "http",
            meta=dict(payload.get("meta") or {}),
            retries=int(payload.get("retries") or 0),
            priority=int(payload.get("priority") or 0),
        )


@dataclass
class CrawlResponse:
    url: str
    status: int
    text: str
    headers: dict[str, str]
    request: CrawlRequest
    blocked: bool = False
    error: str | None = None
    elapsed_ms: float = 0.0


@dataclass
class CrawlStats:
    started_at: float
    finished_at: float | None = None
    requested: int = 0
    succeeded: int = 0
    failed: int = 0
    blocked: int = 0
    retried: int = 0
    enqueued: int = 0
    items: int = 0

    def to_dict(self) -> dict[str, Any]:
        duration = None
        if self.finished_at:
            duration = round(max(0.0, self.finished_at - self.started_at), 3)
        payload = asdict(self)
        payload["duration_seconds"] = duration
        return payload


class CrawlItems(list):
    def to_json(self) -> str:
        return json.dumps(self, ensure_ascii=False, indent=2)

    def to_jsonl(self) -> str:
        return "\n".join(json.dumps(item, ensure_ascii=False) for item in self)


@dataclass
class CrawlResult:
    items: CrawlItems
    stats: CrawlStats
    checkpoint_path: str | None = None


class ProxyRotator:
    def __init__(self, proxies: list[str] | None = None):
        self._proxies = [p.strip() for p in (proxies or []) if str(p).strip()]
        self._cursor = 0
        self._blacklist_until: dict[str, float] = {}
        self.cooldown_seconds = 300

    def _is_available(self, proxy: str) -> bool:
        until = self._blacklist_until.get(proxy)
        return not until or time.time() >= until

    def get(self) -> str | None:
        if not self._proxies:
            return None
        for _ in range(len(self._proxies)):
            proxy = self._proxies[self._cursor % len(self._proxies)]
            self._cursor += 1
            if self._is_available(proxy):
                return proxy
        return None

    def mark_bad(self, proxy: str | None):
        if not proxy:
            return
        self._blacklist_until[proxy] = time.time() + self.cooldown_seconds


class BaseSession:
    async def fetch(self, request: CrawlRequest, proxy: str | None = None) -> CrawlResponse:
        raise NotImplementedError


class RequestsSession(BaseSession):
    def __init__(self, timeout_seconds: int = 20):
        self.timeout_seconds = timeout_seconds

    async def fetch(self, request: CrawlRequest, proxy: str | None = None) -> CrawlResponse:
        started = time.perf_counter()

        def _do_get():
            proxies = {"http": proxy, "https": proxy} if proxy else None
            return requests.get(
                request.url,
                timeout=self.timeout_seconds,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                    "Accept-Language": "en-IN,en;q=0.9",
                },
                proxies=proxies,
            )

        try:
            response = await asyncio.to_thread(_do_get)
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            return CrawlResponse(
                url=str(response.url),
                status=int(response.status_code),
                text=response.text or "",
                headers={k: v for k, v in response.headers.items()},
                request=request,
                elapsed_ms=elapsed,
            )
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            return CrawlResponse(
                url=request.url,
                status=0,
                text="",
                headers={},
                request=request,
                error=str(exc),
                elapsed_ms=elapsed,
            )


class ScraplingSession(BaseSession):
    def __init__(self, timeout_seconds: int = 20, verify_ssl: bool = False):
        self.timeout_seconds = timeout_seconds
        self.verify_ssl = verify_ssl

    async def fetch(self, request: CrawlRequest, proxy: str | None = None) -> CrawlResponse:
        started = time.perf_counter()
        try:
            import scrapling
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            return CrawlResponse(
                url=request.url,
                status=0,
                text="",
                headers={},
                request=request,
                error=f"scrapling unavailable: {exc}",
                elapsed_ms=elapsed,
            )

        def _do_get():
            fetcher = scrapling.Fetcher(auto_match=False)
            kwargs = {"timeout": self.timeout_seconds, "verify": self.verify_ssl}
            if proxy:
                kwargs["proxy"] = proxy
            return fetcher.get(request.url, **kwargs)

        try:
            response = await asyncio.to_thread(_do_get)
            status = int(getattr(response, "status", 0) or 0)
            text = str(getattr(response, "text", "") or getattr(response, "html_content", "") or "")
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            return CrawlResponse(
                url=str(getattr(response, "url", request.url)),
                status=status,
                text=text,
                headers={},
                request=request,
                elapsed_ms=elapsed,
            )
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            return CrawlResponse(
                url=request.url,
                status=0,
                text="",
                headers={},
                request=request,
                error=str(exc),
                elapsed_ms=elapsed,
            )


class CrawlSpider:
    name = "spider"
    start_urls: list[str] = []
    concurrency: int = 5
    per_domain_concurrency: int = 2
    download_delay_seconds: float = 0.5
    max_pages: int = 50
    max_retries: int = 2
    blocked_statuses: set[int] = {403, 429}
    blocked_patterns: tuple[str, ...] = ("captcha", "access denied", "blocked")
    blocked_domains: tuple[str, ...] = ()
    session_map: dict[str, str] = {"default": "http"}
    checkpoint_dir = Path("backend/checkpoints")
    checkpoint_every_seconds: float = 10.0

    def start_requests(self) -> list[CrawlRequest]:
        return [
            CrawlRequest(url=url, callback=self.parse, session_id=self.session_map.get("default", "http"))
            for url in self.start_urls
        ]

    async def parse(self, response: CrawlResponse) -> list[Any]:
        soup = BeautifulSoup(response.text or "", "html.parser")
        title = (soup.title.get_text(" ", strip=True) if soup.title else None) or response.url
        price_match = re.search(r"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*\.?[0-9]{0,2})", soup.get_text(" ", strip=True), re.I)
        price = None
        if price_match:
            try:
                price = float(price_match.group(1).replace(",", ""))
            except Exception:
                price = None
        return [
            {
                "url": response.url,
                "status": response.status,
                "title": title,
                "price": price,
                "session_id": response.request.session_id,
                "elapsed_ms": response.elapsed_ms,
            }
        ]

    def is_blocked(self, response: CrawlResponse) -> bool:
        if response.status in self.blocked_statuses:
            return True
        lowered = (response.text or "").lower()
        return any(pattern in lowered for pattern in self.blocked_patterns)

    def domain_key(self, url: str) -> str:
        return (urlparse(url).hostname or "").lower()


class SpiderRunner:
    def __init__(self, spider: CrawlSpider, sessions: dict[str, BaseSession], proxy_rotator: ProxyRotator | None = None):
        self.spider = spider
        self.sessions = sessions
        self.proxy_rotator = proxy_rotator or ProxyRotator([])
        self.stats = CrawlStats(started_at=time.time())
        self.items = CrawlItems()
        self._seen: set[str] = set()
        self._last_fetch_at_by_domain: dict[str, float] = {}
        self._domain_semaphores: dict[str, asyncio.Semaphore] = {}
        self._queue: asyncio.Queue[CrawlRequest] = asyncio.Queue()
        self._item_stream: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def _checkpoint_path(self) -> Path:
        self.spider.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        return self.spider.checkpoint_dir / f"{self.spider.name}.json"

    async def _save_checkpoint(self):
        pending: list[dict[str, Any]] = []
        queue_items = list(self._queue._queue)  # noqa: SLF001
        for req in queue_items:
            pending.append(req.to_dict())
        payload = {
            "pending": pending,
            "seen": sorted(self._seen),
            "stats": self.stats.to_dict(),
            "saved_at": time.time(),
        }
        path = self._checkpoint_path()
        await asyncio.to_thread(path.write_text, json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")

    async def _load_checkpoint(self) -> bool:
        path = self._checkpoint_path()
        if not path.exists():
            return False
        raw = await asyncio.to_thread(path.read_text, "utf-8")
        payload = json.loads(raw)
        self._seen = set(payload.get("seen") or [])
        for entry in payload.get("pending") or []:
            request = CrawlRequest.from_dict(entry)
            request.callback = self.spider.parse
            await self._queue.put(request)
            self.stats.enqueued += 1
        return True

    async def _remove_checkpoint(self):
        path = self._checkpoint_path()
        if path.exists():
            await asyncio.to_thread(path.unlink)

    async def _enqueue(self, req: CrawlRequest):
        if not req.url or req.url in self._seen:
            return
        domain = self.spider.domain_key(req.url)
        if domain and any(domain == d or domain.endswith(f".{d}") for d in self.spider.blocked_domains):
            return
        self._seen.add(req.url)
        await self._queue.put(req)
        self.stats.enqueued += 1

    async def _throttle_domain(self, domain: str):
        if not domain:
            return
        delay = max(0.0, float(self.spider.download_delay_seconds))
        if delay <= 0:
            return
        last = self._last_fetch_at_by_domain.get(domain, 0.0)
        now = time.time()
        wait_for = delay - (now - last)
        if wait_for > 0:
            await asyncio.sleep(wait_for)
        self._last_fetch_at_by_domain[domain] = time.time()

    async def _process_request(self, request: CrawlRequest):
        domain = self.spider.domain_key(request.url)
        sem = self._domain_semaphores.setdefault(domain, asyncio.Semaphore(max(1, self.spider.per_domain_concurrency)))

        async with sem:
            await self._throttle_domain(domain)
            session = self.sessions.get(request.session_id) or self.sessions.get("http")
            proxy = self.proxy_rotator.get()
            response = await session.fetch(request, proxy=proxy)
            self.stats.requested += 1

            blocked = self.spider.is_blocked(response) or bool(response.error)
            response.blocked = blocked
            if blocked:
                self.stats.blocked += 1
                self.proxy_rotator.mark_bad(proxy)
                if request.retries < self.spider.max_retries:
                    retry_req = CrawlRequest(
                        url=request.url,
                        callback=request.callback,
                        session_id=request.session_id,
                        meta=request.meta,
                        retries=request.retries + 1,
                        priority=request.priority,
                    )
                    self.stats.retried += 1
                    await self._queue.put(retry_req)
                    return
                self.stats.failed += 1
                return

            if response.status and 200 <= response.status < 400:
                self.stats.succeeded += 1
            else:
                self.stats.failed += 1
                return

            callback = request.callback or self.spider.parse
            try:
                output = callback(response)
                if asyncio.iscoroutine(output):
                    output = await output
            except Exception as exc:
                logger.warning("Parse callback failed for %s: %s", request.url, exc)
                self.stats.failed += 1
                return

            for obj in output or []:
                if isinstance(obj, CrawlRequest):
                    if self.stats.enqueued < self.spider.max_pages:
                        await self._enqueue(obj)
                    continue
                if isinstance(obj, dict):
                    self.items.append(obj)
                    self.stats.items += 1
                    await self._item_stream.put(obj)

    async def _worker(self):
        while True:
            req = await self._queue.get()
            if req is None:
                self._queue.task_done()
                break
            await self._process_request(req)
            self._queue.task_done()

    async def _checkpoint_loop(self, stop_event: asyncio.Event):
        while not stop_event.is_set():
            await asyncio.sleep(self.spider.checkpoint_every_seconds)
            await self._save_checkpoint()

    async def run(self, resume: bool = False) -> CrawlResult:
        resumed = False
        if resume:
            resumed = await self._load_checkpoint()
        if not resumed:
            for req in self.spider.start_requests():
                await self._enqueue(req)

        stop_event = asyncio.Event()
        checkpoint_task = asyncio.create_task(self._checkpoint_loop(stop_event))
        workers = [asyncio.create_task(self._worker()) for _ in range(max(1, self.spider.concurrency))]

        try:
            await self._queue.join()
        except KeyboardInterrupt:
            await self._save_checkpoint()
            raise
        finally:
            for _ in workers:
                await self._queue.put(None)
            await asyncio.gather(*workers, return_exceptions=True)
            stop_event.set()
            checkpoint_task.cancel()
            self.stats.finished_at = time.time()
            await self._item_stream.put(None)

        if self._queue.empty():
            await self._remove_checkpoint()

        return CrawlResult(items=self.items, stats=self.stats, checkpoint_path=str(self._checkpoint_path()))

    async def stream(self, resume: bool = False) -> AsyncGenerator[dict[str, Any], None]:
        runner_task = asyncio.create_task(self.run(resume=resume))
        while True:
            item = await self._item_stream.get()
            if item is None:
                break
            yield item
        await runner_task

