# PricePulse Frontend (Vite + React)

This app is the user-facing dashboard for PricePulse. It consumes the Cloudflare Worker backend and provides full product tracking workflows.

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
VITE_API_BASE_URL=http://localhost:8787
```

Production:

```bash
VITE_API_BASE_URL=https://price-pulse-api.<subdomain>.workers.dev
```

- no trailing slash in `VITE_API_BASE_URL`
- never put secrets in Vite env vars

## Local development

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:
- `http://localhost:5173`

Worker API must be running at:
- `http://localhost:8787` via `wrangler dev`

## Build

```bash
npm run build
```

Verified on April 3, 2026:
- `npm run build` -> PASS

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

## Deploying to Cloudflare Pages + Workers

Recommended order:

1. Deploy the Cloudflare Worker API first and note the Worker URL, for example `https://price-tracker-api.<subdomain>.workers.dev`.
1. Deploy the Cloudflare Worker API first and note the Worker URL, for example `https://price-pulse-api.<subdomain>.workers.dev`.
2. Deploy this React dashboard to Cloudflare Pages with:
  - Build command: `npm install && npm run build`
  - Build directory: `dist`
3. Set `VITE_API_BASE_URL` in the Pages project to the Worker URL, without a trailing slash.
4. After the Pages project has its final domain, tighten `CORS_ORIGINS` in `cloudflare-api/wrangler.toml` or in the Worker environment to only that exact origin.
5. Deploy the Astro landing site last if you want it; it is optional for the app itself.

Notes:
- If you prefer to publish the Worker to a custom subdomain, use that URL for `VITE_API_BASE_URL`.
- Secrets such as Telegram tokens must stay in the Worker environment; do not place them in Vite env vars.
