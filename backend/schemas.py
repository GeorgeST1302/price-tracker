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
    target_price: float
    created_at: datetime
    last_updated: datetime | None = None
    latest_price: float | None = None
    trend: str | None = None
    recommendation: str | None = None

    class Config:
        from_attributes = True


class PriceHistoryResponse(BaseModel):
    id: int
    product_id: int
    price: float
    timestamp: datetime

    class Config:
        from_attributes = True


class ProductSearchResult(BaseModel):
    asin: str
    title: str
    image_url: str | None = None
    price: float | None = None
    seller: str | None = None


class AlertCreate(BaseModel):
    product_id: int
    target_price: float


class AlertResponse(BaseModel):
    id: int
    product_id: int
    target_price: float
    triggered_flag: bool
    created_at: datetime
    triggered_at: datetime | None = None

    class Config:
        from_attributes = True
