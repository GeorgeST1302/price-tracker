import logging
import os
import time

import requests
from requests import exceptions as requests_exceptions


logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()
TELEGRAM_API_BASE = os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")
TELEGRAM_CONNECT_TIMEOUT = float(os.getenv("TELEGRAM_CONNECT_TIMEOUT_SECONDS", "10"))
TELEGRAM_READ_TIMEOUT = float(os.getenv("TELEGRAM_READ_TIMEOUT_SECONDS", "30"))
TELEGRAM_MAX_ATTEMPTS = max(1, int(os.getenv("TELEGRAM_MAX_ATTEMPTS", "2")))


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


def _safe_error_from_response(response: requests.Response) -> str:
    status_code = int(response.status_code)
    description = None

    try:
        payload = response.json()
        description = payload.get("description")
    except Exception:
        description = None

    if status_code == 401:
        return "Telegram rejected the bot token. Update TELEGRAM_BOT_TOKEN in the backend environment."
    if status_code in (400, 403):
        if description:
            return f"Telegram rejected the destination chat: {description}"
        return "Telegram rejected the destination chat. Check TELEGRAM_CHAT_ID and start the bot chat first."
    if description:
        return f"Telegram request failed: {description}"
    return f"Telegram request failed with status {status_code}."


def send_triggered_alert(*, product_name: str, current_price: float, target_price: float, product_id: int) -> tuple[bool, str | None]:
    if not is_telegram_configured():
        return False, "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."

    message = _build_message(
        product_name=product_name,
        current_price=float(current_price),
        target_price=float(target_price),
        product_id=int(product_id),
    )

    last_error = None

    for attempt in range(1, TELEGRAM_MAX_ATTEMPTS + 1):
        try:
            response = requests.post(
                f"{TELEGRAM_API_BASE}/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": message,
                },
                timeout=(TELEGRAM_CONNECT_TIMEOUT, TELEGRAM_READ_TIMEOUT),
            )
            if not response.ok:
                error_message = _safe_error_from_response(response)
                logger.warning("Telegram notification failed with status %s: %s", response.status_code, error_message)
                return False, error_message

            payload = response.json()
            if not payload.get("ok"):
                description = payload.get("description") or "Telegram returned an unexpected response."
                return False, f"Telegram request failed: {description}"
            return True, None
        except requests_exceptions.Timeout as exc:
            last_error = "Telegram request timed out. It will be retried on the next refresh or scheduled check."
            logger.warning("Telegram notification timed out on attempt %s/%s: %s", attempt, TELEGRAM_MAX_ATTEMPTS, exc)
            if attempt < TELEGRAM_MAX_ATTEMPTS:
                time.sleep(1)
        except requests_exceptions.RequestException as exc:
            last_error = "Could not reach Telegram right now. It will be retried on the next refresh or scheduled check."
            logger.exception("Telegram notification request failed: %s", exc)
            if attempt < TELEGRAM_MAX_ATTEMPTS:
                time.sleep(1)
            else:
                break
        except Exception as exc:
            logger.exception("Telegram notification failed unexpectedly: %s", exc)
            return False, "Telegram delivery failed unexpectedly. Please try again."

    return False, last_error or "Telegram delivery failed. Please try again."
