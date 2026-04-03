import json
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path


logger = logging.getLogger(__name__)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _pricecrawler_dir() -> Path:
    return _repo_root() / "pricecrawler"


def _normalize_price(value):
    if value is None:
        return None
    text = str(value).replace(",", "").replace("Rs.", "").replace("INR", "").strip()
    try:
        return float(text)
    except Exception:
        return None


def fetch_price_with_local_scrapy(asin: str, timeout_seconds: int = 70):
    """Run local Scrapy spider once and return normalized product data.

    This path is used only as a resilience fallback when direct requests fail.
    """

    enabled = os.getenv("PRICEPULSE_ENABLE_LOCAL_SCRAPY", "1") == "1"
    if not enabled:
        return None

    spider_project_dir = _pricecrawler_dir()
    scrapy_cfg = spider_project_dir / "scrapy.cfg"
    if not scrapy_cfg.exists():
        logger.info("Local scrapy fallback skipped because scrapy.cfg was not found: %s", scrapy_cfg)
        return None

    asin_value = str(asin or "").strip().upper()
    if not asin_value:
        return None

    with tempfile.TemporaryDirectory(prefix="pricepulse_scrapy_") as tmp_dir:
        output_path = Path(tmp_dir) / "output.json"
        cmd = [
            sys.executable,
            "-m",
            "scrapy",
            "crawl",
            "amazon_price",
            "-a",
            f"asin={asin_value}",
            "-O",
            str(output_path),
            "-L",
            os.getenv("PRICEPULSE_SCRAPY_LOG_LEVEL", "ERROR"),
        ]

        try:
            completed = subprocess.run(
                cmd,
                cwd=str(spider_project_dir),
                capture_output=True,
                text=True,
                timeout=max(20, int(timeout_seconds)),
                check=False,
            )
        except Exception as exc:
            logger.warning("Local scrapy fallback failed to execute for ASIN=%s: %s", asin_value, exc)
            return None

        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            logger.info("Local scrapy fallback returned %s for ASIN=%s: %s", completed.returncode, asin_value, stderr)
            return None

        if not output_path.exists():
            logger.info("Local scrapy fallback produced no output file for ASIN=%s", asin_value)
            return None

        try:
            payload = json.loads(output_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.info("Local scrapy fallback output parse failed for ASIN=%s: %s", asin_value, exc)
            return None

        if not isinstance(payload, list) or not payload:
            return None

        item = payload[0] if isinstance(payload[0], dict) else None
        if not item:
            return None

        title = item.get("title")
        price = _normalize_price(item.get("price"))
        if not title or price is None:
            return None

        return {
            "asin": item.get("asin") or asin_value,
            "title": title,
            "price": price,
            "source": "Amazon India",
            "image_url": item.get("image_url"),
            "brand": item.get("brand"),
            "purchase_url": item.get("product_url") or f"https://www.amazon.in/dp/{asin_value}",
            "fetch_method": "scrapy_local",
        }
