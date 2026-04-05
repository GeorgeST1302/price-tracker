# PricePulse - Smart Purchase Decision Assistant

PricePulse is a full-stack web app for tracking product prices, comparing listings, and alerting users when prices meet their target range.

Primary stack:
- JavaScript Cloudflare Worker + D1 backend in [cloudflare-api/](cloudflare-api/)
- React + Vite frontend in [frontend/](frontend/)
- Astro landing page in [landing/](landing/) (optional)

## What is implemented now

- Full-stack architecture:
  - Frontend app: React + Vite ([frontend/](frontend/))
  - Backend API: Cloudflare Worker + D1 ([cloudflare-api/](cloudflare-api/))
  - Landing site: Astro static site ([landing/](landing/), optional)
- External integrations:
  - Telegram Bot API for alerts
  - Marketplace scraping and scheduled refresh in the JavaScript Worker
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

## Cloudflare deployment (Pages + Workers + D1)

This repo includes a Cloudflare-native backend in [cloudflare-api/](cloudflare-api/) so you can deploy without running the legacy Python stack.

- API (Worker + D1): see [cloudflare-api/README.md](cloudflare-api/README.md)
- End-to-end Cloudflare guide: see [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)

High level:
- Deploy the Worker API first.
- Deploy the React dashboard to Cloudflare Pages and set `VITE_API_BASE_URL` to the Worker URL.
- After the Pages site at `https://price-tracker-app.pages.dev` is live, tighten `CORS_ORIGINS` in the Worker to only that exact origin.
- Deploy the Astro landing site last if you want it; it is optional for the app itself.
- Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as Worker secrets before enabling alerts.
- The Worker also runs scheduled refreshes every 15 minutes via cron.

## Local run

Backend:
```powershell
cd cloudflare-api
npm install
npm run dev
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
- `cloudflare-api`: syntax check -> PASS
- `frontend`: `npm run build` -> PASS
- `landing`: `npm run build` -> PASS

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
8. Check Worker logs with `wrangler tail` for scheduler refresh activity.

## Notes

- `/notifications/test` validates Telegram connectivity only. It does not evaluate live trigger decision logic.
- If you run the Worker locally, use `cd cloudflare-api && npm run dev`.
