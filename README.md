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

## Private Repository Setup (Render)

This project works with a private GitHub repository.

1. Keep the repository visibility set to Private in GitHub.
2. In Render, open Account Settings -> GitHub and confirm Render has access to this private repository.
3. In each Render service, verify the connected repository and branch are correct.
4. Keep required environment variables configured in Render:
  - Frontend: VITE_API_BASE_URL
  - Backend: CORS_ORIGINS and other runtime secrets
5. Trigger a manual deploy in Render after changing repository visibility.

If auto deploy fails after making the repository private, reconnect the GitHub integration for Render and redeploy.

## API Docs (Backend)

When running backend locally, API docs are available at:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## License

Internal project / educational use.
