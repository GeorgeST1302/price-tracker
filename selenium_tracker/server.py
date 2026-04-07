import os
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel

from price_tracker import init_db, track_product_url

app = FastAPI(title="Selenium Price Tracker API", version="1.0.0")


class TrackRequest(BaseModel):
    urls: List[str]
    headless: bool = True


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "service": "selenium-tracker"}


@app.post("/track")
def track(body: TrackRequest) -> dict:
    conn = init_db(os.getenv("PRICE_TRACKER_DB", "price_tracker.db"))
    results = []
    try:
        from price_tracker import create_driver

        driver = create_driver(headless=body.headless)
        try:
            for url in body.urls:
                results.append(track_product_url(url, driver=driver, conn=conn, headless=body.headless))
        finally:
            driver.quit()
    finally:
        conn.close()

    return {"results": results}
