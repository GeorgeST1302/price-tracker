import logging
import os
import time

import requests
from requests import exceptions as requests_exceptions

try:
    from ..config import load_backend_env
except ImportError:
    try:
        from config import load_backend_env
    except ImportError:
        load_backend_env = None

if load_backend_env is not None:
    load_backend_env()


logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()
TELEGRAM_API_BASE = os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")
TELEGRAM_CONNECT_TIMEOUT = float(os.getenv("TELEGRAM_CONNECT_TIMEOUT_SECONDS", "10"))
TELEGRAM_READ_TIMEOUT = float(os.getenv("TELEGRAM_READ_TIMEOUT_SECONDS", "30"))
TELEGRAM_MAX_ATTEMPTS = max(1, int(os.getenv("TELEGRAM_MAX_ATTEMPTS", "2")))


def is_telegram_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


def _format_target_range(target_price_min: float | None, target_price_max: float | None) -> str:
    low = float(target_price_min) if target_price_min is not None else None
    high = float(target_price_max) if target_price_max is not None else None

    if low is not None and high is not None:
        if abs(low - high) < 0.01:
            return f"Rs. {high:.2f}"
        return f"Rs. {low:.2f} - Rs. {high:.2f}"
    if high is not None:
        return f"Up to Rs. {high:.2f}"
    if low is not None:
        return f"From Rs. {low:.2f}"
    return "Custom target range"


def _build_message(
    *,
    product_name: str,
    current_price: float,
    target_price_min: float | None,
    target_price_max: float | None,
    product_id: int,
    deal_status: str | None = None,
    deal_reason: str | None = None,
    purchase_url: str | None = None,
    historical_low: float | None = None,
) -> str:
    lines = [
        "PricePulse alert",
        "",
        f"Product: {product_name}",
        f"Current price: Rs. {current_price:.2f}",
        f"Your target range: {_format_target_range(target_price_min, target_price_max)}",
        f"Product ID: {product_id}",
    ]

    if deal_status:
        lines.insert(3, f"Action: {deal_status}")
    if historical_low is not None:
        lines.append(f"Historical low: Rs. {float(historical_low):.2f}")
    if purchase_url:
        lines.append(f"Link: {purchase_url}")

    lines.append("")
    lines.append(deal_reason or "A tracked product has reached an alert condition.")
    return "\n".join(lines)


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


def send_triggered_alert(
    *,
    product_name: str,
    current_price: float,
    target_price_min: float | None = None,
    target_price_max: float | None = None,
    target_price: float | None = None,
    product_id: int,
    deal_status: str | None = None,
    deal_reason: str | None = None,
    purchase_url: str | None = None,
    historical_low: float | None = None,
) -> tuple[bool, str | None]:
    if not is_telegram_configured():
        return False, "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."

    normalized_max = float(target_price_max if target_price_max is not None else target_price if target_price is not None else current_price)
    normalized_min = float(target_price_min) if target_price_min is not None else normalized_max

    message = _build_message(
        product_name=product_name,
        current_price=float(current_price),
        target_price_min=normalized_min,
        target_price_max=normalized_max,
        product_id=int(product_id),
        deal_status=deal_status,
        deal_reason=deal_reason,
        purchase_url=purchase_url,
        historical_low=historical_low,
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
