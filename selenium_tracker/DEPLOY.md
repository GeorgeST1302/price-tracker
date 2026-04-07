# Selenium Tracker Deployment

This tracker can be used from Cloudflare Pages, but the Selenium/Brave API must run on a public Python host.

## What runs where

- Cloudflare Pages: React frontend
- Public Python host: Selenium API (`server.py`)

## API deployment options

Use any public container host that can run Docker, for example:
- Render
- Railway
- Fly.io
- Cloud Run

For the simplest path from this repo, use the included `render.yaml` so Render can deploy directly from GitHub.

## Docker build

From this folder:

```powershell
docker build -t selenium-tracker-api .
docker run -p 8000:8000 -e BRAVE_BINARY_PATH="/usr/bin/brave-browser" selenium-tracker-api
```

If Brave is in a custom location, set `BRAVE_BINARY_PATH`.

Render will use the same container definition automatically through `render.yaml`.

## Cloudflare frontend config

Set the frontend env var:

```text
VITE_SELENIUM_TRACKER_API_BASE_URL=https://your-public-api.example.com
```

Then deploy the React app to Cloudflare Pages.

## CORS

Set `SELENIUM_TRACKER_CORS_ORIGINS=*` for testing, or set it to your Cloudflare Pages domain for production.
