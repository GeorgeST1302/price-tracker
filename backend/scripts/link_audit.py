import csv
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "pricepulse.db"
OUT_DIR = REPO_ROOT / "backend" / "reports"
OUT_DIR.mkdir(parents=True, exist_ok=True)

TIMEOUT_SECONDS = max(1, int(os.getenv("PRICEPULSE_LINK_CHECK_TIMEOUT_SECONDS", "4")))
USER_AGENT = "PricePulse-LinkAudit/1.0 (+https://github.com)"


def _check_url(url: str) -> tuple[int | None, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"}
    try:
        r = requests.head(url, timeout=TIMEOUT_SECONDS, allow_redirects=True, headers=headers)
        if 200 <= r.status_code < 400:
            return int(r.status_code), "ok"
    except Exception:
        pass

    try:
        r = requests.get(url, timeout=TIMEOUT_SECONDS, allow_redirects=True, headers=headers, stream=True)
        try:
            code = int(r.status_code)
            if 200 <= code < 400:
                return code, "ok"
            if code in (403, 404, 410, 429, 500, 502, 503, 504):
                return code, "broken"
            return code, "warning"
        finally:
            r.close()
    except Exception as exc:
        return None, f"error:{exc.__class__.__name__}"


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, source_key, product_url, last_updated
            FROM products
            WHERE product_url IS NOT NULL AND TRIM(product_url) <> ''
            ORDER BY id DESC
            """
        )
        rows = cur.fetchall()

    checked_at = datetime.now(timezone.utc).isoformat()
    report = []
    for product_id, name, source_key, product_url, last_updated in rows:
        url = str(product_url).strip()
        parsed = urlparse(url)
        status_code, health = _check_url(url)
        report.append(
            {
                "checked_at": checked_at,
                "product_id": product_id,
                "name": name,
                "source_key": source_key,
                "domain": parsed.netloc,
                "url": url,
                "status_code": status_code,
                "health": health,
                "last_updated": last_updated,
            }
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_path = OUT_DIR / f"link-audit-{stamp}.json"
    csv_path = OUT_DIR / f"link-audit-{stamp}.csv"

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "checked_at",
                "product_id",
                "name",
                "source_key",
                "domain",
                "url",
                "status_code",
                "health",
                "last_updated",
            ],
        )
        writer.writeheader()
        writer.writerows(report)

    broken_count = sum(1 for item in report if item["health"].startswith("broken") or item["health"].startswith("error"))
    print(
        json.dumps(
            {
                "checked": len(report),
                "broken_or_error": broken_count,
                "json_report": str(json_path),
                "csv_report": str(csv_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
