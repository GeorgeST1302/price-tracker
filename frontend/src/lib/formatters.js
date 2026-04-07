export function formatCurrency(value, sourceKey = null) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "N/A"
  if (String(sourceKey || "").trim().toLowerCase() === "pricerunner") {
    return `£${amount.toLocaleString("en-GB", { maximumFractionDigits: amount % 1 === 0 ? 0 : 2 })}`
  }
  return `Rs. ${amount.toLocaleString("en-IN", { maximumFractionDigits: amount % 1 === 0 ? 0 : 2 })}`
}

export function formatPercent(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "N/A"
  const sign = amount >= 0 ? "+" : "-"
  return `${sign}${Math.abs(amount).toFixed(1)}%`
}
