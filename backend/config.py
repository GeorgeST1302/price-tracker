from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parent
BACKEND_ENV_PATH = BACKEND_DIR / ".env"


def load_backend_env() -> None:
    load_dotenv(BACKEND_ENV_PATH, override=False)
