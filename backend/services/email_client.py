import logging
import os
import smtplib
from email.message import EmailMessage

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


SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.getenv("SMTP_FROM", "").strip() or SMTP_USERNAME
SMTP_TO = os.getenv("SMTP_TO", "").strip()
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "1") == "1"


def is_email_configured() -> bool:
    return bool(SMTP_HOST and SMTP_PORT and SMTP_FROM and SMTP_TO)


def send_email_alert(*, subject: str, body: str) -> tuple[bool, str | None]:
    if not is_email_configured():
        return False, "Email is not configured. Set SMTP_HOST/SMTP_PORT/SMTP_FROM/SMTP_TO (and optionally SMTP_USERNAME/SMTP_PASSWORD)."

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = SMTP_TO
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.ehlo()
            if SMTP_USE_TLS:
                server.starttls()
                server.ehlo()
            if SMTP_USERNAME and SMTP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        return True, None
    except Exception as exc:
        logger.exception("Email notification failed: %s", exc)
        return False, "Email delivery failed. Check SMTP_* environment variables and provider settings."
