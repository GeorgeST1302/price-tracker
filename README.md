# PricePulse

A full-stack price tracking web app that monitors products, stores price history, and alerts users when target prices are reached.

[![Live Demo](https://img.shields.io/badge/Live-Demo-1f6feb?style=for-the-badge)](https://price-tracker-j87h.onrender.com)

## Live Deployment

- App URL: https://price-tracker-j87h.onrender.com

## Key Features

- Track products with target prices
- Automatic price refresh and history logging
- Smart recommendation logic (BUY / HOLD / WAIT)
- Price trend analysis from historical data
- Alert system with Telegram notifications
- Dashboard views for tracked products and alert status

## Tech Stack

- Frontend: React, Vite, React Router, Chart.js
- Backend: FastAPI, SQLAlchemy, SQLite, APScheduler
- Integrations: BeautifulSoup scraping, Zyte fallback, Telegram Bot API
- Hosting: Render

## Project Structure

```text
FullStackInternalProject/
  backend/
    main.py
    models.py
    schemas.py
    services/
    tests/
  frontend/
    src/
    public/
  landing/
  PROJECT_KNOWLEDGE_TRANSFER.md
```

## Local Development

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

## Deployment Notes

- Production frontend is available at: https://price-tracker-j87h.onrender.com
- Set frontend environment variable:

```bash
VITE_API_BASE_URL=<your-backend-url>
```

- For backend CORS restrictions in production, set:

```bash
CORS_ORIGINS=https://your-frontend-domain.com
```

## API Docs (Backend)

When running backend locally, API docs are available at:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## License

Internal project / educational use.
