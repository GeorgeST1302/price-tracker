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

## 5) Using a private GitHub repository

This frontend can be deployed from a private repository.

Checklist:
- In Render account settings, ensure GitHub is connected with access to your private repository.
- Confirm the Static Site service points to the correct private repository and branch.
- Keep `VITE_API_BASE_URL` set in Render environment variables.
- Run a manual deploy once after switching the repository from public to private.

If deploys stop after visibility changes, reconnect the GitHub integration in Render and redeploy.
