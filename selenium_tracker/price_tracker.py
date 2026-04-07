import os
import random
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager


# Default Brave paths by OS. Override with BRAVE_BINARY_PATH env var if needed.
DEFAULT_BRAVE_PATHS = {
    "nt": r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "posix": "/usr/bin/brave-browser",
}

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


@dataclass
class ProductSnapshot:
    product_url: str
    title: str
    current_price: Optional[float]
    availability: str


def detect_platform(product_url: str) -> str:
    host = urlparse(product_url).netloc.lower()

    if "amazon.in" in host:
        return "amazon"
    if "flipkart.com" in host:
        return "flipkart"
    if "reliancedigital.in" in host:
        return "reliance"

    raise ValueError(f"Unsupported platform for URL: {product_url}")


def random_human_delay() -> None:
    time.sleep(random.uniform(2, 5))


def clean_price(text: str) -> Optional[float]:
    if not text:
        return None

    cleaned = text.replace(",", "")
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", cleaned)
    if not match:
        return None

    try:
        return float(match.group(1))
    except ValueError:
        return None


def fallback_price_from_source(page_source: str, patterns: list[str]) -> Optional[float]:
    source = page_source or ""
    for pattern in patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1) if match.groups() else match.group(0)
        parsed = clean_price(candidate)
        if parsed is not None:
            return parsed
    return None


def format_inr(value: Optional[float]) -> str:
    if value is None:
        return "N/A"
    return f"₹{int(value):,}" if value.is_integer() else f"₹{value:,.2f}"


def create_driver(headless: bool = False) -> webdriver.Chrome:
    brave_binary = os.getenv("BRAVE_BINARY_PATH")
    if not brave_binary:
        brave_binary = DEFAULT_BRAVE_PATHS["nt"] if os.name == "nt" else DEFAULT_BRAVE_PATHS["posix"]

    if not os.path.exists(brave_binary):
        raise FileNotFoundError(
            "Brave binary not found. Set BRAVE_BINARY_PATH env var, for example: "
            r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
        )

    options = Options()
    options.binary_location = brave_binary

    # Anti-bot and browser hardening settings.
    options.add_argument(f"--user-agent={DEFAULT_USER_AGENT}")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-infobars")
    options.add_argument("--start-maximized")

    if headless:
        options.add_argument("--headless=new")

    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)

    # Helps reduce basic webdriver detection.
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    return driver


def wait_text(driver: webdriver.Chrome, selectors: list[str], timeout: int = 15) -> Optional[str]:
    for selector in selectors:
        try:
            element = WebDriverWait(driver, timeout).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, selector))
            )
            text = element.text.strip()
            if text:
                return text
        except TimeoutException:
            continue
    return None


def scrape_amazon(driver: webdriver.Chrome, product_url: str) -> ProductSnapshot:
    driver.get(product_url)
    random_human_delay()

    title = wait_text(driver, ["#productTitle", "span#title"], timeout=20) or "Unknown title"
    price_text = wait_text(
        driver,
        [
            "span.a-price.aok-align-center .a-offscreen",
            "span.a-price .a-offscreen",
            "#priceblock_ourprice",
            "#priceblock_dealprice",
        ],
        timeout=20,
    )

    availability = wait_text(
        driver,
        ["#availability span", "#deliveryBlockMessage", "#outOfStock"],
        timeout=10,
    ) or "Unknown"

    price = clean_price(price_text or "")
    if price is None:
        price = fallback_price_from_source(
            driver.page_source,
            [
                r'"price"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)',
                r'₹\s*([0-9][0-9,]*(?:\.[0-9]+)?)',
            ],
        )

    return ProductSnapshot(
        product_url=product_url,
        title=title,
        current_price=price,
        availability=availability,
    )


def scrape_flipkart(driver: webdriver.Chrome, product_url: str) -> ProductSnapshot:
    driver.get(product_url)
    random_human_delay()

    title = wait_text(
        driver,
        ["span.VU-ZEz", "h1.yhB1nd", "span.B_NuCI", "h1"],
        timeout=20,
    ) or "Unknown title"

    price_text = wait_text(
        driver,
        ["div.Nx9bqj.CxhGGd", "div._30jeq3._16Jk6d", "div._25b18c ._30jeq3"],
        timeout=20,
    )

    availability = wait_text(
        driver,
        ["div._16FRp0", "div.Z8JjpR", "div._1u9uOA"],
        timeout=10,
    ) or "Unknown"

    price = clean_price(price_text or "")
    if price is None:
        price = fallback_price_from_source(
            driver.page_source,
            [
                r'"finalPrice"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)',
                r'"sellingPrice"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)',
                r'₹\s*([0-9][0-9,]*(?:\.[0-9]+)?)',
            ],
        )

    return ProductSnapshot(
        product_url=product_url,
        title=title,
        current_price=price,
        availability=availability,
    )


def scrape_reliance(driver: webdriver.Chrome, product_url: str) -> ProductSnapshot:
    driver.get(product_url)
    random_human_delay()

    title = wait_text(driver, ["h1.pdp__title", "h1"], timeout=20)
    if not title:
        title = driver.execute_script(
            "return document.querySelector(\"meta[property='og:title']\")?.content || document.title || ''"
        )
    title = (title or "Unknown title").strip()

    price_text = wait_text(
        driver,
        [".pdp__offerPrice", ".pdp__priceSection .price", "span.sc-bdVaJa"],
        timeout=20,
    )

    availability = wait_text(
        driver,
        [".pdp__availabilityText", ".pdp__deliveryOptions", ".out-of-stock"],
        timeout=10,
    ) or "Unknown"

    price = clean_price(price_text or "")
    if price is None:
        price = fallback_price_from_source(
            driver.page_source,
            [
                r'"price"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)',
                r'"sellingPrice"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)',
                r'₹\s*([0-9][0-9,]*(?:\.[0-9]+)?)',
            ],
        )

    return ProductSnapshot(
        product_url=product_url,
        title=title,
        current_price=price,
        availability=availability,
    )


def init_db(db_path: str = "price_tracker.db") -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            product_url TEXT PRIMARY KEY,
            title TEXT,
            last_price REAL,
            last_checked TEXT
        )
        """
    )
    conn.commit()
    return conn


def get_previous_price(conn: sqlite3.Connection, product_url: str) -> Optional[float]:
    row = conn.execute(
        "SELECT last_price FROM products WHERE product_url = ?",
        (product_url,),
    ).fetchone()
    if not row:
        return None
    return row[0]


def save_snapshot(conn: sqlite3.Connection, snapshot: ProductSnapshot) -> None:
    conn.execute(
        """
        INSERT INTO products (product_url, title, last_price, last_checked)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(product_url) DO UPDATE SET
            title = excluded.title,
            last_price = excluded.last_price,
            last_checked = excluded.last_checked
        """,
        (
            snapshot.product_url,
            snapshot.title,
            snapshot.current_price,
            datetime.utcnow().isoformat(timespec="seconds"),
        ),
    )
    conn.commit()


def print_price_status(old_price: Optional[float], new_price: Optional[float], title: str) -> None:
    print(f"Title: {title}")
    print(f"Old Price: {format_inr(old_price)}")
    print(f"New Price: {format_inr(new_price)}")

    if old_price is not None and new_price is not None and new_price < old_price:
        print("Status: PRICE DROPPED!")
    else:
        print("Status: No drop")


def build_tracking_result(old_price: Optional[float], new_price: Optional[float], title: str, availability: str, product_url: str) -> dict[str, Any]:
    status = "PRICE DROPPED!" if old_price is not None and new_price is not None and new_price < old_price else "No drop"
    return {
        "product_url": product_url,
        "title": title,
        "old_price": old_price,
        "new_price": new_price,
        "availability": availability,
        "status": status,
    }


def choose_scraper(product_url: str) -> Callable[[webdriver.Chrome, str], ProductSnapshot]:
    platform = detect_platform(product_url)
    if platform == "amazon":
        return scrape_amazon
    if platform == "flipkart":
        return scrape_flipkart
    if platform == "reliance":
        return scrape_reliance
    raise ValueError(f"No scraper available for URL: {product_url}")


def track_single_url(driver: webdriver.Chrome, conn: sqlite3.Connection, product_url: str) -> dict[str, Any]:
    scraper = choose_scraper(product_url)
    snapshot = scraper(driver, product_url)

    old_price = get_previous_price(conn, product_url)
    save_snapshot(conn, snapshot)

    print_price_status(old_price, snapshot.current_price, snapshot.title)
    print(f"Availability: {snapshot.availability}")
    print("-" * 60)

    return build_tracking_result(
        old_price=old_price,
        new_price=snapshot.current_price,
        title=snapshot.title,
        availability=snapshot.availability,
        product_url=product_url,
    )


def track_product_url(product_url: str, driver: Optional[webdriver.Chrome] = None, conn: Optional[sqlite3.Connection] = None, headless: bool = True) -> dict[str, Any]:
    owns_driver = driver is None
    owns_conn = conn is None
    local_driver = driver or create_driver(headless=headless)
    local_conn = conn or init_db()

    try:
        return track_single_url(local_driver, local_conn, product_url)
    finally:
        if owns_driver:
            local_driver.quit()
        if owns_conn:
            local_conn.close()


def collect_urls_from_user() -> list[str]:
    print("Enter product URLs (Amazon India / Flipkart / Reliance Digital).")
    print("Type 'done' when finished.")

    urls: list[str] = []
    while True:
        value = input("URL: ").strip()
        if not value:
            continue
        if value.lower() == "done":
            break
        urls.append(value)

    return urls


def main() -> None:
    urls = collect_urls_from_user()
    if not urls:
        print("No URLs provided. Exiting.")
        return

    conn = init_db()
    driver = create_driver(headless=False)

    try:
        for url in urls:
            try:
                track_single_url(driver, conn, url)
            except Exception as exc:
                print(f"Failed to track {url}: {exc}")
                print("-" * 60)
    finally:
        driver.quit()
        conn.close()


if __name__ == "__main__":
    main()
