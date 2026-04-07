import os
from typing import Optional

from fastapi import FastAPI
from pydantic import BaseModel

from .scraper import fetch_snapshot, search_products

app = FastAPI(title="PricePulse Scrapy API", version="1.0.0")


class SnapshotRequest(BaseModel):
    source_key: Optional[str] = None
    product_url: Optional[str] = None
    asin: Optional[str] = None
    external_id: Optional[str] = None


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "service": "scrapy-api"}


@app.get("/scrape/search")
async def scrape_search(
    q: str,
    limit: int = 9,
    source: Optional[str] = None,
    min_rating: Optional[float] = None,
    availability: Optional[str] = None,
) -> dict:
    timeout = float(os.getenv("SCRAPY_REQUEST_TIMEOUT", "10"))
    results = await search_products(
        query=q,
        limit=limit,
        source=source,
        min_rating=min_rating,
        availability=availability,
        timeout=timeout,
    )
    return {"results": results}


@app.post("/scrape/snapshot")
async def scrape_snapshot(body: SnapshotRequest) -> dict:
    timeout = float(os.getenv("SCRAPY_REQUEST_TIMEOUT", "10"))
    snapshot = await fetch_snapshot(
        source_key=body.source_key,
        product_url=body.product_url,
        asin=body.asin,
        external_id=body.external_id,
        timeout=timeout,
    )
    return {"snapshot": snapshot}
