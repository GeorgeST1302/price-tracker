from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ProductCreate(BaseModel):
    product_name: str
    target_price: float | None = None
    target_price_min: float | None = None
    target_price_max: float | None = None
    refresh_interval_minutes: int | None = None
    asin: Optional[str] = None
    source_key: Optional[str] = None
    source: Optional[str] = None
    product_url: Optional[str] = None
    external_id: Optional[str] = None
    image_url: Optional[str] = None


class ProductUrlCreate(BaseModel):
    url: str
    target_price: float | None = None
    target_price_min: float | None = None
    target_price_max: float | None = None
    refresh_interval_minutes: int | None = None


class ProductTargetUpdate(BaseModel):
    target_price: float | None = None
    target_price_min: float | None = None
    target_price_max: float | None = None


class ProductResponse(BaseModel):
    id: int
    name: str
    source_key: str | None = None
    external_id: str | None = None
    product_url: str | None = None
    image_url: str | None = None
    brand: str | None = None
    source: str | None = None
    last_fetch_method: str | None = None
    refresh_interval_minutes: int | None = None
    target_price: float
    target_price_min: float | None = None
    target_price_max: float | None = None
    created_at: datetime
    last_updated: datetime | None = None
    latest_price: float | None = None
    historical_low: float | None = None
    historical_low_timestamp: datetime | None = None
    trend: str | None = None
    recommendation: str | None = None
    recommendation_reason: str | None = None
    deal_status: str | None = None
    purchase_url: str | None = None
    average_7d: float | None = None
    average_30d: float | None = None
    delta_from_avg: float | None = None
    delta_from_avg_pct: float | None = None
    prediction: str | None = None
    prediction_confidence: str | None = None

    class Config:
        from_attributes = True


class PriceHistoryResponse(BaseModel):
    id: int
    product_id: int
    price: float
    fetch_method: str | None = None
    timestamp: datetime

    class Config:
        from_attributes = True


class ProductSearchResult(BaseModel):
    source_key: str
    asin: str | None = None
    external_id: str | None = None
    title: str
    image_url: str | None = None
    price: float | None = None
    seller: str | None = None
    source: str | None = None
    product_url: str | None = None
    trackable: bool = True


class AlertCreate(BaseModel):
    product_id: int
    target_price: float | None = None
    target_price_min: float | None = None
    target_price_max: float | None = None
    telegram_enabled: bool = True
    browser_enabled: bool = False
    alarm_enabled: bool = False
    email_enabled: bool = False


class AlertResponse(BaseModel):
    id: int
    product_id: int
    target_price: float
    target_price_min: float | None = None
    target_price_max: float | None = None
    telegram_enabled: bool
    browser_enabled: bool
    alarm_enabled: bool
    email_enabled: bool
    triggered_flag: bool
    notification_sent_flag: bool
    created_at: datetime
    triggered_at: datetime | None = None
    notification_sent_at: datetime | None = None
    notification_error: str | None = None

    class Config:
        from_attributes = True


class CrawlRunRequest(BaseModel):
    start_urls: list[str]
    session_id: str = "http"
    concurrency: int = 5
    per_domain_concurrency: int = 2
    download_delay_seconds: float = 0.5
    max_pages: int = 30
    max_retries: int = 2
    resume: bool = False
    proxies: list[str] | None = None


class CrawlRunResponse(BaseModel):
    stats: dict
    items: list[dict]
