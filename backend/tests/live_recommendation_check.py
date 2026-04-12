import sys
from dataclasses import dataclass

import requests


BASE_URL = "https://price-tracker-backend-hxqx.onrender.com"
PRODUCTS_URL = f"{BASE_URL}/products"
TIMEOUT_SECONDS = 30


@dataclass
class CaseResult:
    name: str
    expected: str
    actual: str
    status: str
    product_name: str
    latest_price: float | None
    target_price: float | None
    detail: str


def normalize_recommendation(value: str | None) -> str:
    text = (value or "").strip().upper()
    if text.startswith("BUY NOW") or text.startswith("BUY"):
        return "BUY"
    if text.startswith("HOLD"):
        return "HOLD"
    if text.startswith("WAIT"):
        return "WAIT"
    return text or "MISSING"


def expected_recommendation(target_price: float, latest_price: float) -> str:
    if latest_price <= target_price:
        return "BUY"
    if latest_price <= target_price * 1.10:
        return "HOLD"
    return "WAIT"


def fetch_products() -> list[dict]:
    response = requests.get(PRODUCTS_URL, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError(f"Expected list from {PRODUCTS_URL}, got: {type(payload).__name__}")
    return payload


def build_case_result(case_name: str, product: dict | None) -> CaseResult:
    if not product:
        return CaseResult(
            name=case_name,
            expected=case_name,
            actual="NOT FOUND",
            status="SKIP",
            product_name="-",
            latest_price=None,
            target_price=None,
            detail=f"No live product matched the {case_name} scenario.",
        )

    latest_price = product.get("latest_price")
    target_price = product.get("target_price")
    actual = normalize_recommendation(product.get("recommendation"))
    status = "PASS" if actual == case_name else "FAIL"

    return CaseResult(
        name=case_name,
        expected=case_name,
        actual=actual,
        status=status,
        product_name=str(product.get("name") or "-"),
        latest_price=float(latest_price) if latest_price is not None else None,
        target_price=float(target_price) if target_price is not None else None,
        detail=str(product.get("reason") or ""),
    )


def print_result(result: CaseResult) -> None:
    print(f"Case: {result.name}")
    print(f"Expected: {result.expected}")
    print(f"Actual: {result.actual}")
    print(f"Status: {result.status}")
    print(f"Product: {result.product_name}")
    print(f"Latest Price: {result.latest_price}")
    print(f"Target Price: {result.target_price}")
    if result.detail:
        print(f"Reason: {result.detail}")
    print("-" * 50)


def main() -> int:
    print(f"Checking recommendation logic against: {BASE_URL}")
    print("=" * 50)

    try:
        products = fetch_products()
    except Exception as exc:
        print(f"Failed to fetch products: {exc}")
        return 1

    eligible_products = []
    for product in products:
        latest_price = product.get("latest_price")
        target_price = product.get("target_price")
        if latest_price is None or target_price is None:
            continue
        try:
            latest_value = float(latest_price)
            target_value = float(target_price)
        except (TypeError, ValueError):
            continue
        if latest_value <= 0 or target_value <= 0:
            continue
        eligible_products.append(
            {
                **product,
                "latest_price": latest_value,
                "target_price": target_value,
                "expected_case": expected_recommendation(target_value, latest_value),
            }
        )

    results: list[CaseResult] = []
    for case_name in ("BUY", "HOLD", "WAIT"):
        matching_product = next(
            (product for product in eligible_products if product["expected_case"] == case_name),
            None,
        )
        results.append(build_case_result(case_name, matching_product))

    for result in results:
        print_result(result)

    failed = [result for result in results if result.status == "FAIL"]
    if failed:
        print(f"Overall Status: FAIL ({len(failed)} failing case(s))")
        return 1

    skipped = [result for result in results if result.status == "SKIP"]
    if skipped:
        print(f"Overall Status: PARTIAL ({len(skipped)} case(s) skipped because no live product matched)")
        return 0

    print("Overall Status: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
