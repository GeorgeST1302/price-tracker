from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from database import SessionLocal, engine
import models
import schemas

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="PricePulse API")


# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Root endpoint
@app.get("/")
def root():
    return {"message": "PricePulse API is running successfully"}


# Create product (CREATE)
@app.post("/products", response_model=schemas.ProductResponse)
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):

    new_product = models.Product(
        name="Placeholder Name",  # Will replace with real API fetch later
        asin=product.asin,
        target_price=product.target_price
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    return new_product


# Get all products (READ)
@app.get("/products", response_model=list[schemas.ProductResponse])
def get_products(db: Session = Depends(get_db)):
    return db.query(models.Product).all()