from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ProductCreate(BaseModel):
    product_name: str
    target_price: float
    asin: Optional[str] = None


class ProductResponse(BaseModel):
    id: int
    name: str
    image_url: str | None = None
    source: str | None = None
    last_fetch_method: str | None = None
    target_price: float
    created_at: datetime
    last_updated: datetime | None = None
    latest_price: float | None = None
    trend: str | None = None
    recommendation: str | None = None
    recommendation_reason: str | None = None
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
    asin: str
    title: str
    image_url: str | None = None
    price: float | None = None
    seller: str | None = None
    source: str | None = None
    product_url: str | None = None


class AlertCreate(BaseModel):
    product_id: int
    target_price: float


class AlertResponse(BaseModel):
    id: int
    product_id: int
    target_price: float
    triggered_flag: bool
    notification_sent_flag: bool
    created_at: datetime
    triggered_at: datetime | None = None
    notification_sent_at: datetime | None = None
    notification_error: str | None = None

    class Config:
        from_attributes = True
