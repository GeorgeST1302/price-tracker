export function isPlaceholderProductUrl(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return false

  try {
    const parsed = new URL(normalized)
    return parsed.hostname === "example.com"
  } catch {
    return normalized.includes("example.com/")
  }
}

export function hasRealPurchaseUrl(value) {
  return Boolean(value) && !isPlaceholderProductUrl(value)
}