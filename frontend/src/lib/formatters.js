export function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "N/A"
  return `Rs. ${amount.toLocaleString("en-IN", { maximumFractionDigits: amount % 1 === 0 ? 0 : 2 })}`
}

export function formatPercent(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "N/A"
  return `${amount > 0 ? "+" : ""}${amount.toFixed(1)}%`
}
