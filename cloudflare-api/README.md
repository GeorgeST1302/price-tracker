# Cloudflare API (D1 + Workers)

This folder contains the Cloudflare-native backend for PricePulse so the app can run without the legacy Python backend.

## What this backend supports

- `GET /`
- `GET /healthz`
- `GET /products`
- `POST /products`
- `POST /products/from-url`
- `PATCH /products/:id/target`
- `POST /products/:id/refresh`
- `GET /products/:id/history`
- `DELETE /products/:id`
- `GET /products/search`
- `GET /alerts`
- `POST /alerts`
- `GET /notifications/status`
- `POST /notifications/test`

Notes:

- Search and refresh use live marketplace fetchers first: Amazon India, Reliance Digital, Snapdeal, then generic HTML/JSON-LD parsing.
- Synthetic fallback is disabled in production by default (`ALLOW_SYNTHETIC = "0"` in `wrangler.toml`).
- Telegram delivery uses Worker secrets: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Scheduled refresh runs from a Worker cron trigger every 15 minutes and is capped per run with `MAX_CRON_REFRESHES_PER_RUN`.

## Runtime configuration

These values are read from Worker vars or dashboard environment variables.

Required secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional vars and defaults:

- `CORS_ORIGINS` - comma-separated allowlist for the React Pages origin
- `DEFAULT_REFRESH_MINUTES` - `360`
- `MIN_REFRESH_MINUTES` - `15`
- `MAX_CRON_REFRESHES_PER_RUN` - `12`
- `ALLOW_SYNTHETIC` - `0` in production
- `TELEGRAM_API_BASE` - `https://api.telegram.org`

Legacy aliases still supported by the Worker:

- `PRICEPULSE_CORS_ORIGINS`
- `PRICEPULSE_DEFAULT_REFRESH_MINUTES`
- `PRICEPULSE_DEFAULT_REFRESH_INTERVAL_MINUTES`
- `PRICEPULSE_MIN_REFRESH_MINUTES`
- `PRICEPULSE_SCHEDULER_INTERVAL_MINUTES`
- `PRICEPULSE_MAX_CRON_REFRESHES_PER_RUN`
- `PRICEPULSE_ALLOW_SYNTHETIC`
- `PRICEPULSE_TELEGRAM_API_BASE`
- `PRICEPULSE_TELEGRAM_BOT_TOKEN`
- `PRICEPULSE_TELEGRAM_CHAT_ID`

## One-time setup

1. Install dependencies:

```bash
cd cloudflare-api
npm install
```

2. For local `wrangler dev`, copy [.dev.vars.example](./.dev.vars.example) to [.dev.vars](./.dev.vars) and fill in any values you need locally.

3. Create D1 database:

```bash
npm run db:create
```

4. Copy the returned `database_id` into [`wrangler.toml`](./wrangler.toml) if you created a new database.

5. Apply schema:

```bash
npm run db:migrate
```

6. Add Telegram secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

## Deploy Worker

```bash
npm run deploy
```

After deploy, note the Worker URL printed by Wrangler, for example:

- `https://price-tracker-api.<your-subdomain>.workers.dev`

Set this as `VITE_API_BASE_URL` in your Cloudflare Pages frontend project, then redeploy the frontend. After the Pages site at `https://price-tracker-app.pages.dev` is live, tighten `CORS_ORIGINS` to only that exact origin.

## CORS

[`wrangler.toml`](./wrangler.toml) uses `CORS_ORIGINS`, a comma-separated allowlist.

Current production default:

```toml
[vars]
CORS_ORIGINS = "https://price-tracker-app.pages.dev"
```

If you are testing the Worker locally against `wrangler dev`, temporarily override `CORS_ORIGINS` to include your local frontend origin as well.

Defaults are applied in the Worker if these variables are not present.
