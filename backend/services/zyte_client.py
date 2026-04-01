import base64
import json
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

ZYTE_API_TOKEN = os.getenv("ZYTE_API_TOKEN")
ZYTE_PROJECT_ID = os.getenv("ZYTE_PROJECT_ID")
ZYTE_JOB_ID = os.getenv("ZYTE_JOB_ID")
ZYTE_API_HOST = os.getenv("ZYTE_API_HOST", "https://app.zyte.com")
ZYTE_STORAGE_HOST = os.getenv("ZYTE_STORAGE_HOST", "https://storage.zyte.com")


class ZyteConfigError(RuntimeError):
    pass


def _require_config():
    if not ZYTE_API_TOKEN:
        raise ZyteConfigError("set ZYTE_API_TOKEN to trigger Zyte jobs")
    if not ZYTE_PROJECT_ID or not ZYTE_JOB_ID:
        raise ZyteConfigError("set ZYTE_PROJECT_ID and ZYTE_JOB_ID for Zyte runs")
    return {
        "token": ZYTE_API_TOKEN,
        "project": ZYTE_PROJECT_ID,
        "spider": ZYTE_JOB_ID,
    }


def _auth_headers():
    config = _require_config()
    token_bytes = f"{config['token']}:".encode("utf-8")
    basic = base64.b64encode(token_bytes).decode("ascii")
    return {"Authorization": f"Basic {basic}"}


def _run_url():
    return f"{ZYTE_API_HOST}/api/run.json"


def _jobs_url():
    return f"{ZYTE_API_HOST}/api/jobs/list.json"


def _items_url(job_key: str):
    return f"{ZYTE_STORAGE_HOST}/items/{job_key}"


def _extract_output_item(payload):
    if isinstance(payload, list):
        return payload[0] if payload else None
    if isinstance(payload, dict):
        items = payload.get("items")
        if isinstance(items, list) and items:
            return items[0]
        return payload
    return None


def _normalize_output_item(item, asin: str):
    if not isinstance(item, dict):
        return None

    title = item.get("title") or item.get("name")
    price = item.get("price") or item.get("latest_price")
    if title is None or price is None:
        return None

    try:
        normalized_price = float(str(price).replace(",", "").replace("Rs.", "").replace("INR", "").strip())
    except Exception:
        return None

    return {
        "asin": item.get("asin") or asin,
        "title": title,
        "price": normalized_price,
        "source": "Amazon India",
        "purchase_url": f"https://www.amazon.in/dp/{asin}",
    }


def fetch_price_from_zyte(asin: str, timeout: int = 45):
    """Trigger a Scrapy Cloud spider run, wait for completion, and fetch its first scraped item."""
    try:
        config = _require_config()
        headers = _auth_headers()
    except ZyteConfigError as exc:
        logger.info("Zyte not configured (%s)", exc)
        return None

    payload = {
        "project": config["project"],
        "spider": config["spider"],
        "asin": asin,
    }

    logger.info("Triggering Zyte run for ASIN=%s", asin)
    response = requests.post(_run_url(), headers=headers, data=payload, timeout=15)
    response.raise_for_status()
    run_data = response.json()

    job_key = run_data.get("jobid")
    if not job_key:
        logger.error("Zyte run response missing jobid: %s", run_data)
        return None

    deadline = time.time() + timeout
    while time.time() < deadline:
        poll = requests.get(
            _jobs_url(),
            headers=headers,
            params={"project": config["project"], "job": job_key},
            timeout=15,
        )
        poll.raise_for_status()
        status_data = poll.json()
        jobs = status_data.get("jobs") or []
        if not jobs:
            logger.info("Zyte job %s not visible yet, waiting", job_key)
            time.sleep(3)
            continue

        job = jobs[0]
        state = str(job.get("state") or "").lower()
        close_reason = str(job.get("close_reason") or "").lower()

        if state == "finished" or close_reason == "finished":
            logger.info("Zyte run %s finished", job_key)
            items_response = requests.get(
                _items_url(job_key),
                headers=headers,
                params={"format": "json"},
                timeout=15,
            )
            items_response.raise_for_status()

            try:
                items_payload = items_response.json()
            except json.JSONDecodeError:
                logger.error("Zyte items response was not JSON for job %s", job_key)
                return None

            item = _extract_output_item(items_payload)
            return _normalize_output_item(item, asin)

        if state in {"deleted"} or close_reason in {"cancelled", "finished_without_items"}:
            logger.error("Zyte job %s ended without usable data: %s", job_key, job)
            return None

        logger.info("Zyte run %s pending (%s/%s), waiting", job_key, state, close_reason)
        time.sleep(3)

    logger.warning("Zyte run %s timed out after %s seconds", job_key, timeout)
    return None
