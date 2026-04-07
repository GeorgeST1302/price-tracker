# Scrapy API Service

This service is the primary scraping backend for PricePulse.

## Run locally

```powershell
cd scrapy-api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Endpoints

- `GET /healthz`
- `GET /scrape/search?q=...&limit=...`
- `POST /scrape/snapshot`

## Notes

- Parsing uses Scrapy selectors (`scrapy.Selector`) for all providers.
- The Cloudflare Worker should be configured with `SCRAPY_API_BASE`, for example `https://your-scrapy-service.example.com`.
