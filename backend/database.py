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
		_add_column_if_missing("alerts", "notification_sent_flag", "notification_sent_flag BOOLEAN DEFAULT 0")
		_add_column_if_missing("alerts", "notification_sent_at", "notification_sent_at DATETIME")
		_add_column_if_missing("alerts", "notification_error", "notification_error VARCHAR")
	except Exception:
		# If DB is brand new, tables may not exist yet; create_all will handle it.
		pass
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
