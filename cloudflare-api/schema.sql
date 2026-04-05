CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  asin TEXT,
  source_key TEXT NOT NULL DEFAULT 'generic',
  external_id TEXT,
  product_url TEXT,
  image_url TEXT,
  brand TEXT,
  source TEXT,
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 360,
  target_price REAL NOT NULL,
  target_price_min REAL NOT NULL,
  target_price_max REAL NOT NULL,
  last_fetch_method TEXT,
  last_updated TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  price REAL NOT NULL,
  fetch_method TEXT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_time
  ON price_history (product_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  target_price REAL NOT NULL,
  target_price_min REAL NOT NULL,
  target_price_max REAL NOT NULL,
  telegram_enabled INTEGER NOT NULL DEFAULT 1,
  browser_enabled INTEGER NOT NULL DEFAULT 0,
  alarm_enabled INTEGER NOT NULL DEFAULT 0,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  triggered_flag INTEGER NOT NULL DEFAULT 0,
  triggered_at TEXT,
  notification_sent_flag INTEGER NOT NULL DEFAULT 0,
  notification_sent_at TEXT,
  notification_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_product_created
  ON alerts (product_id, created_at DESC);
