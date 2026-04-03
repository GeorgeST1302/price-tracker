# PricePulse - Smart Purchase Decision Assistant

PricePulse is a full-stack web app for tracking product prices, comparing listings, and alerting users when prices meet their target range.

## What is implemented now

- Full-stack architecture:
  - Frontend app: React + Vite (`frontend/`)
  - Backend API: FastAPI + SQLAlchemy (`backend/`)
  - Database: SQLite (`backend/pricepulse.db`)
- External integrations:
  - Telegram Bot API for alerts
  - Zyte integration and local Scrapy fallback for scraping paths
- Product flow:
  - Search results across Amazon India, Reliance Digital, Snapdeal
  - Select one listing and start tracking
  - Track by target range (`target_price_min`, `target_price_max`)
  - Store historical prices and show recommendation/status
- Alerts:
  - Telegram-first alert creation
  - Trigger checks during refresh/scheduler cycles

## Routes and API

Frontend routes:
- `/#/` Dashboard
- `/#/add` Add Product
- `/#/products` Products
- `/#/detail` Product Detail
- `/#/history` History
- `/#/alerts` Alerts

Core backend endpoints:
- `GET /healthz`
- `GET /products/search`
- `POST /products`
- `GET /products`
- `PATCH /products/{id}/target`
- `POST /products/{id}/refresh`
- `GET /products/{id}/history`
- `DELETE /products/{id}`
- `POST /alerts`
- `GET /alerts`
- `GET /notifications/status`
- `POST /notifications/test`

## Render deployment (production)

### 1) Backend Web Service (Render)

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Required backend environment variables:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `ZYTE_API_TOKEN`
- `ZYTE_PROJECT_ID`
- `ZYTE_SPIDER_NAME`
- `CORS_ORIGINS` (include your frontend and landing URLs)

Recommended backend environment variables:
- `PRICEPULSE_ENABLE_SCHEDULER=1`
- `PRICEPULSE_DEFAULT_REFRESH_INTERVAL_MINUTES=15`
- `PRICEPULSE_ENFORCE_TARGET_BELOW_CURRENT=1`
- `PRICEPULSE_ENABLE_LOCAL_SCRAPY=1`

### 2) Frontend Static Site (Render)

- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

Required frontend environment variable:
- `VITE_API_BASE_URL=https://<your-backend-service>.onrender.com`

### 3) Landing Static Site (Astro, optional)

- Root Directory: `landing`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

## Local run

Backend:
```powershell
cd backend
py -3 -m uvicorn main:app --reload --port 8000
```

Frontend:
```powershell
cd frontend
npm install
npm run dev
```

Landing (optional):
```powershell
cd landing
npm install
npm run dev
```

## Verified test status (April 3, 2026)

Build checks:
- `frontend`: `npm run build` -> PASS
- `landing`: `npm run build` -> PASS
- `backend`: `py -3 -m compileall backend` -> PASS

Live backend smoke:
- `GET /` -> PASS
- `GET /healthz` -> PASS
- `GET /products/search` -> PASS
- `POST /products/{id}/refresh` increased history count -> PASS
- `POST /alerts` upsert/create -> PASS
- `POST /notifications/test` returned success (`mode=test_only`) -> PASS

## Post-deploy smoke checklist

1. Open frontend `/#/add`.
2. Search a product and confirm comparison rows appear.
3. Click a result title and verify it opens the source URL.
4. Track one listing with target min/max and interval.
5. Open `/#/products` and edit range once.
6. Refresh one product and confirm history grows in `/#/detail` or `/#/history`.
7. Open `/#/alerts`, create an alert, run `Test Telegram`.
8. Check backend logs for scheduler refresh activity.

## Notes

- `/notifications/test` validates Telegram connectivity only. It does not evaluate live trigger decision logic.
- If you run backend from inside `backend/`, use `main:app` (not `backend.main:app`).
  - pull requests / milestone commits
