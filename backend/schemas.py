from pydantic import BaseModel
from datetime import datetime

class ProductCreate(BaseModel):
    asin: str
    target_price: float


class ProductResponse(BaseModel):
    id: int
    name: str
    asin: str
    target_price: float
    created_at: datetime

    class Config:
        from_attributes = True