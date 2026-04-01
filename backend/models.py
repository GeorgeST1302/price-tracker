from sqlalchemy import Boolean, Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

try:
    from .database import Base
except ImportError:
    from database import Base

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    asin = Column(String, unique=True)
    image_url = Column(String, nullable=True)
    source = Column(String, nullable=True)
    target_price = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.utcnow)

    price_history = relationship(
        "PriceHistory",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    alerts = relationship(
        "Alert",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"))
    price = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product", back_populates="price_history")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True)
    target_price = Column(Float)
    triggered_flag = Column(Boolean, default=False)
    notification_sent_flag = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    triggered_at = Column(DateTime, nullable=True)
    notification_sent_at = Column(DateTime, nullable=True)
    notification_error = Column(String, nullable=True)

    product = relationship("Product", back_populates="alerts")
