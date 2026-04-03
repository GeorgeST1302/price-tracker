from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = f"sqlite:///{(BASE_DIR / 'pricepulse.db').as_posix()}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
	# Ensure SQLite enforces ON DELETE CASCADE.
	try:
		cursor = dbapi_connection.cursor()
		cursor.execute("PRAGMA foreign_keys=ON")
		cursor.close()
	except Exception:
		pass


def ensure_sqlite_schema():
	"""Best-effort migrations for local SQLite.

	SQLAlchemy's `create_all` does not add missing columns to existing tables.
	This keeps dev databases working when new columns are introduced.
	"""

	def _column_exists(table_name: str, column_name: str) -> bool:
		with engine.connect() as conn:
			rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
		return any(r[1] == column_name for r in rows)

	def _add_column_if_missing(table_name: str, column_name: str, ddl: str):
		if _column_exists(table_name, column_name):
			return
		with engine.connect() as conn:
			conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))
			conn.commit()

	try:
		_add_column_if_missing("products", "last_updated", "last_updated DATETIME")
		_add_column_if_missing("products", "source_key", "source_key VARCHAR")
		_add_column_if_missing("products", "external_id", "external_id VARCHAR")
		_add_column_if_missing("products", "product_url", "product_url VARCHAR")
		_add_column_if_missing("products", "image_url", "image_url VARCHAR")
		_add_column_if_missing("products", "brand", "brand VARCHAR")
		_add_column_if_missing("products", "source", "source VARCHAR")
		_add_column_if_missing("products", "last_fetch_method", "last_fetch_method VARCHAR")
		_add_column_if_missing("products", "refresh_interval_minutes", "refresh_interval_minutes INTEGER")
		_add_column_if_missing("products", "target_price_min", "target_price_min FLOAT")
		_add_column_if_missing("products", "target_price_max", "target_price_max FLOAT")
		_add_column_if_missing("price_history", "fetch_method", "fetch_method VARCHAR")
		_add_column_if_missing("alerts", "target_price_min", "target_price_min FLOAT")
		_add_column_if_missing("alerts", "target_price_max", "target_price_max FLOAT")
		_add_column_if_missing("alerts", "telegram_enabled", "telegram_enabled BOOLEAN DEFAULT 1")
		_add_column_if_missing("alerts", "browser_enabled", "browser_enabled BOOLEAN DEFAULT 1")
		_add_column_if_missing("alerts", "alarm_enabled", "alarm_enabled BOOLEAN DEFAULT 0")
		_add_column_if_missing("alerts", "email_enabled", "email_enabled BOOLEAN DEFAULT 0")
		_add_column_if_missing("alerts", "notification_sent_flag", "notification_sent_flag BOOLEAN DEFAULT 0")
		_add_column_if_missing("alerts", "notification_sent_at", "notification_sent_at DATETIME")
		_add_column_if_missing("alerts", "notification_error", "notification_error VARCHAR")
		with engine.connect() as conn:
			conn.execute(text("UPDATE products SET source_key = 'amazon' WHERE (source_key IS NULL OR source_key = '') AND asin IS NOT NULL"))
			conn.execute(text("UPDATE products SET target_price_min = target_price WHERE target_price_min IS NULL AND target_price IS NOT NULL"))
			conn.execute(text("UPDATE products SET target_price_max = target_price WHERE target_price_max IS NULL AND target_price IS NOT NULL"))
			conn.execute(text("UPDATE alerts SET target_price_min = target_price WHERE target_price_min IS NULL AND target_price IS NOT NULL"))
			conn.execute(text("UPDATE alerts SET target_price_max = target_price WHERE target_price_max IS NULL AND target_price IS NOT NULL"))
			conn.commit()
	except Exception:
		# If DB is brand new, tables may not exist yet; create_all will handle it.
		pass
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
