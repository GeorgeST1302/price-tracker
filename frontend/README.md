# PricePulse Frontend (Vite + React)

This app is the user-facing dashboard for PricePulse. It consumes the FastAPI backend and provides full product tracking workflows.

## Features

- Add Product with live comparison rows (list/table style)
- Product click-through to source listing URL
- Target range tracking (`target_price_min`, `target_price_max`)
- Edit target range from Products page
- Dashboard insights and recommendation badges
- Product Detail and History views with chart + refresh
- Alerts page with Telegram-first flow and test action

## Routes

- `/#/` Dashboard
- `/#/add` Add Product
- `/#/products` Products
- `/#/detail` Product Detail
- `/#/history` History
- `/#/alerts` Alerts

## Environment

Create `frontend/.env` from `frontend/.env.example`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_DEMO_CHECKOUT_URL=
```

Production:

```bash
VITE_API_BASE_URL=https://your-backend-service.onrender.com
```

Rules:
- no trailing slash in `VITE_API_BASE_URL`
- never put secrets in Vite env vars

## Local development

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:
- `http://localhost:5173`

Backend must be running at:
- `http://127.0.0.1:8000`

## Build

```bash
npm run build
```

Verified on April 3, 2026:
- `npm run build` -> PASS

## Render static deployment

- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
- Environment Variable:
  - `VITE_API_BASE_URL=https://<your-backend>.onrender.com`

Backend CORS must include this frontend domain:

```bash
CORS_ORIGINS=https://<your-frontend>.onrender.com,https://<your-landing>.onrender.com
```

## Regression test checklist

1. Open `/#/add`.
2. Search `logitech mouse`.
3. Confirm rows show source, title, and price.
4. Click title and confirm listing opens in a new tab.
5. Select one row, set min/max, click `Start Tracking`.
6. Open `/#/products`, edit range, and save.
7. Open `/#/detail`, run refresh, verify history/chart updates.
8. Open `/#/alerts`, create alert, run `Test Telegram`.

## Alert UI behavior

- Alert creation is Telegram-focused.
- Browser, Alarm, and Email checkboxes are intentionally removed from UI.
- Frontend sends:
  - `telegram_enabled=true`
  - `browser_enabled=false`
  - `alarm_enabled=false`
  - `email_enabled=false`
