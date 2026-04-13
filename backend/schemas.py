from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class ProductCreate(BaseModel):
    product_name: str
    target_price: float
    asin: Optional[str] = None
    preview_price: float | None = None


class ProductResponse(BaseModel):
    id: int
    name: str
    target_price: float
    created_at: datetime
    last_updated: datetime | None = None
    latest_price: float | None = None
    price_available: bool = False
    trend: str | None = None
    recommendation: str | None = None
    reason: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PriceHistoryResponse(BaseModel):
    id: int
    product_id: int
    price: float
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class ProductSearchResult(BaseModel):
    source_key: str | None = None
    asin: str
    title: str
    image_url: str | None = None
    price: float | None = None
    seller: str | None = None
    source: str | None = None
    product_url: str | None = None
    trackable: bool = True


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

    model_config = ConfigDict(from_attributes=True)
