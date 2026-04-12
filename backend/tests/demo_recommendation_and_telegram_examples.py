import sys


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def normalize_recommendation_text(value: str) -> str:
    normalized = str(value or "").strip().upper().replace("-", " ").replace("_", " ")
    if normalized.startswith("BUY"):
        return "BUY"
    if normalized.startswith("HOLD") or normalized.startswith("ON HOLD"):
        return "HOLD"
    if normalized.startswith("WAIT"):
        return "WAIT"
    return normalized or "UNKNOWN"


def recommendation_for_prices(latest_price: float, target_price: float) -> str:
    if latest_price <= target_price:
        return "BUY NOW - Good deal"
    if latest_price <= target_price * 1.10:
        return "HOLD - Price is close to your target"
    return "WAIT - Price is too high"


def badge_class_for_recommendation(recommendation: str) -> str:
    normalized = normalize_recommendation_text(recommendation)
    if normalized == "BUY":
        return "badge-good"
    if normalized == "HOLD":
        return "badge-warn"
    if normalized == "WAIT":
        return "badge-danger"
    return "badge-warn"


def simulated_telegram_message(case_name: str, product_name: str, latest_price: float, target_price: float) -> str:
    if case_name == "BUY":
        return (
            "🟢 BUY NOW\n"
            f"Product: {product_name}\n"
            f"Price: ₹{latest_price:.0f}\n"
            f"Target: ₹{target_price:.0f}"
        )
    if case_name == "HOLD":
        return (
            "🟡 HOLD\n"
            f"Product: {product_name}\n"
            f"Price: ₹{latest_price:.0f}\n"
            f"Target: ₹{target_price:.0f}\n"
            "Price is close to your target"
        )
    return (
        "🔴 WAIT\n"
        f"Product: {product_name}\n"
        f"Price: ₹{latest_price:.0f}\n"
        f"Target: ₹{target_price:.0f}\n"
        "Price is too high"
    )


def main() -> None:
    cases = [
        {"case": "BUY", "product": "Test Product", "latest_price": 400, "target_price": 500},
        {"case": "HOLD", "product": "High Value Product", "latest_price": 44000, "target_price": 40000},
        {"case": "WAIT", "product": "Logitech M186 Wireless Mouse", "latest_price": 599, "target_price": 499},
    ]

    print("Recommendation Demo")
    print("=" * 50)

    for item in cases:
        expected = item["case"]
        recommendation = recommendation_for_prices(item["latest_price"], item["target_price"])
        actual = normalize_recommendation_text(recommendation)
        color = badge_class_for_recommendation(recommendation)
        status = "PASS" if actual == expected else "FAIL"

        print(f"Case: {expected}")
        print(f"Expected: {expected}")
        print(f"Actual: {actual}")
        print(f"Color: {color}")
        print(f"Status: {status}")
        print("-" * 50)

    print("Simulated Telegram Messages")
    print("=" * 50)
    for item in cases:
        print(simulated_telegram_message(item["case"], item["product"], item["latest_price"], item["target_price"]))
        print("-" * 50)


if __name__ == "__main__":
    main()
