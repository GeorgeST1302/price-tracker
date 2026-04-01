import logging
import os

import requests


logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()
TELEGRAM_API_BASE = os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")


def is_telegram_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


def _build_message(product_name: str, current_price: float, target_price: float, product_id: int) -> str:
    return (
        "PricePulse alert\n\n"
        f"Product: {product_name}\n"
        f"Current price: Rs. {current_price:.2f}\n"
        f"Your target: Rs. {target_price:.2f}\n"
        f"Product ID: {product_id}\n\n"
        "A tracked product has reached your target price."
    )


def send_triggered_alert(*, product_name: str, current_price: float, target_price: float, product_id: int) -> tuple[bool, str | None]:
    if not is_telegram_configured():
        return False, "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."

    message = _build_message(
        product_name=product_name,
        current_price=float(current_price),
        target_price=float(target_price),
        product_id=int(product_id),
    )

    try:
        response = requests.post(
            f"{TELEGRAM_API_BASE}/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message,
            },
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            description = payload.get("description") or "Telegram returned an unexpected response."
            return False, str(description)
        return True, None
    except Exception as exc:
        logger.exception("Telegram notification failed: %s", exc)
        return False, str(exc)
