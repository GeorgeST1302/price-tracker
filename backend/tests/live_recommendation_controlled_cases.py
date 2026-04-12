import sys
import uuid
from dataclasses import dataclass

import requests


BASE_URL = "https://price-tracker-backend-hxqx.onrender.com"
TIMEOUT_SECONDS = 30


@dataclass
class TestResult:
    case: str
    expected: str
    actual: str
    status: str
    detail: str = ""


def normalize_recommendation(value: str | None) -> str:
    text = (value or "").strip().upper()
    if text.startswith("BUY NOW") or text.startswith("BUY"):
        return "BUY"
    if text.startswith("HOLD"):
        return "HOLD"
    if text.startswith("WAIT"):
        return "WAIT"
    return text or "MISSING"


def get_products() -> list[dict]:
    response = requests.get(f"{BASE_URL}/products", timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("GET /products did not return a list")
    return payload


def get_search_candidates(query: str) -> list[dict]:
    response = requests.get(
        f"{BASE_URL}/products/search",
        params={"q": query, "limit": 9},
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        return []
    return payload


def create_product(product_name: str, target_price: float, asin: str | None = None) -> requests.Response:
    return requests.post(
        f"{BASE_URL}/products",
        json={
            "product_name": product_name,
            "target_price": round(float(target_price), 2),
            "asin": asin,
        },
        timeout=TIMEOUT_SECONDS,
    )


def delete_product(product_id: int) -> None:
    requests.delete(f"{BASE_URL}/products/{product_id}", timeout=TIMEOUT_SECONDS)


def pick_reference_product(products: list[dict]) -> dict:
    for product in products:
        latest_price = product.get("latest_price")
        target_price = product.get("target_price")
        try:
            latest_value = float(latest_price)
            target_value = float(target_price)
        except (TypeError, ValueError):
            continue
        if latest_value > 0 and target_value > 0:
            return product
    raise RuntimeError("No existing product with valid latest_price/target_price found in GET /products")


def pick_untracked_candidate(existing_asins: set[str], reference_query: str) -> dict:
    candidates = get_search_candidates(reference_query)
    for item in candidates:
        asin = str(item.get("asin") or "").strip().upper()
        if not asin or asin in existing_asins:
            continue
        return item
    raise RuntimeError(f"No untracked search candidate found for query {reference_query!r}")


def fetch_created_product(product_id: int) -> dict:
    products = get_products()
    for product in products:
        if int(product.get("id")) == int(product_id):
            return product
    raise RuntimeError(f"Created product id={product_id} was not found in GET /products")


def print_result(result: TestResult) -> None:
    print(f"Case: {result.case}")
    print(f"Expected: {result.expected}")
    print(f"Actual: {result.actual}")
    print(f"Status: {result.status}")
    if result.detail:
        print(f"Detail: {result.detail}")
    print("-" * 50)


def run_hold_or_wait_case(case_name: str, expected: str, target_multiplier: float, reference_query: str) -> TestResult:
    existing_products = get_products()
    existing_asins = {str(item.get("asin") or "").strip().upper() for item in existing_products}
    candidate = pick_untracked_candidate(existing_asins, reference_query)

    search_price = candidate.get("price")
    if search_price is None:
        return TestResult(case_name, expected, "NOT CREATED", "FAIL", "Search candidate did not include a price.")

    target_price = float(search_price) * target_multiplier
    unique_name = f"{candidate['title']} [{case_name}-{uuid.uuid4().hex[:6]}]"
    response = create_product(unique_name, target_price, asin=candidate["asin"])

    if response.status_code >= 400:
        return TestResult(case_name, expected, f"HTTP {response.status_code}", "FAIL", response.text[:300])

    created = response.json()
    product_id = int(created["id"])
    try:
        fetched = fetch_created_product(product_id)
        actual = normalize_recommendation(fetched.get("recommendation"))
        detail = (
            f"latest_price={fetched.get('latest_price')}, "
            f"target_price={fetched.get('target_price')}, "
            f"reason={fetched.get('reason')}"
        )
        return TestResult(case_name, expected, actual, "PASS" if actual == expected else "FAIL", detail)
    finally:
        delete_product(product_id)


def run_buy_case(reference_product: dict) -> TestResult:
    latest_price = float(reference_product["latest_price"])
    target_price = latest_price + 1000.0
    detail = (
        "API-only BUY creation is blocked by current backend validation: "
        f"POST /products rejects target_price >= current price. "
        f"Reference product latest_price={latest_price}, requested target_price={target_price}."
    )
    return TestResult("BUY", "BUY", "BLOCKED BY API VALIDATION", "FAIL", detail)


def main() -> int:
    print(f"Testing controlled recommendation cases against: {BASE_URL}")
    print("=" * 50)

    try:
        reference_product = pick_reference_product(get_products())
    except Exception as exc:
        print(f"Failed to load reference product: {exc}")
        return 1

    results = [
        run_buy_case(reference_product),
        run_hold_or_wait_case("HOLD", "HOLD", 0.92, "mouse"),
        run_hold_or_wait_case("WAIT", "WAIT", 0.70, "keyboard"),
    ]

    for result in results:
        print_result(result)

    overall_failed = any(result.status == "FAIL" for result in results)
    print(f"Overall Status: {'FAIL' if overall_failed else 'PASS'}")
    return 1 if overall_failed else 0


if __name__ == "__main__":
    sys.exit(main())
