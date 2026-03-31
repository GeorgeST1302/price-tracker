# PricePulse Frontend (Vite + React)

This frontend is ready to deploy as a Render Static Site.

## 1) Required environment variable

Set this in Render (Static Site -> Environment):

```bash
VITE_API_BASE_URL=https://your-backend-service.onrender.com
```

Notes:
- Do not add a trailing slash.
- This value is required in production.

## 2) Render Static Site settings

Use these values when creating the frontend service in Render:

- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

## 3) Backend CORS

The backend now allows:
- `localhost` / `127.0.0.1` during local development
- `https://*.onrender.com`

For stricter production control, set backend env var:

```bash
CORS_ORIGINS=https://your-frontend.onrender.com,https://your-custom-domain.com
```

## 4) Routing behavior

The app uses `HashRouter` so deep links work on static hosting without extra rewrite rules.

Example URLs:
- `https://your-frontend.onrender.com/#/`
- `https://your-frontend.onrender.com/#/products`
