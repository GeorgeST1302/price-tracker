export function hasAvailablePrice(product) {
  if (typeof product?.price_available === "boolean") {
    return product.price_available
  }

  return Number.isFinite(Number(product?.latest_price))
}

export function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "N/A"
  return `Rs. ${amount.toFixed(2)}`
}

export function getPriceAvailabilityMessage(product, options = {}) {
  const { hasHistory = false, showingCachedValue = false } = options

  if (showingCachedValue && hasHistory) {
    return "Live price unavailable. Showing last known value."
  }

  if (!hasAvailablePrice(product) && hasHistory) {
    return "Price unavailable right now. Showing last known value from history."
  }

  if (!hasAvailablePrice(product)) {
    return "Price unavailable right now. Tracking will continue in the background."
  }

  return null
}
