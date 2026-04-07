# Selenium Price Tracker (Brave + ChromeDriver)

A beginner-friendly multi-platform price tracker using Python, Selenium, and SQLite.

Supported platforms:
- Amazon India
- Flipkart
- Reliance Digital

## Features

- Uses Selenium with ChromeDriver configured for Brave browser
- Automatic platform detection from product URL
- Platform-specific scraper functions:
  - `scrape_amazon()`
  - `scrape_flipkart()`
  - `scrape_reliance()`
- Dynamic waits with `WebDriverWait`
- Basic anti-bot measures:
  - Random delay (2-5 seconds)
  - Custom user-agent
  - Disabled automation flags
- SQLite storage:
  - `product_url`
  - `title`
  - `last_price`
  - `last_checked`
- Price drop detection with output status

## Setup

```powershell
cd selenium_tracker
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

## Brave browser path

By default on Windows, this path is used:

`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`

If Brave is installed somewhere else, set environment variable:

```powershell
$env:BRAVE_BINARY_PATH="D:\Apps\Brave\Application\brave.exe"
```

## Run

```powershell
python price_tracker.py
```

Then paste one or more product URLs and type `done`.

## Real-time frontend mode

Start the API server:

```powershell
cd selenium_tracker
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Start the React app in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the `Selenium Tracker` tab in the app and paste product URLs.

If your API is hosted somewhere else, set `VITE_SELENIUM_TRACKER_API_BASE_URL` in `frontend/.env`.

Cloudflare Pages can host the frontend, but it cannot run the Selenium/Brave API itself. The API must live on a separate public Python host.

## Example output

```text
Title: iPhone 13
Old Price: ₹52,000
New Price: ₹49,999
Status: PRICE DROPPED!
Availability: In stock
```
