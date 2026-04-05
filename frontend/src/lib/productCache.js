const CACHE_KEY = "pricepulse_products_cache"

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined"
}

export function readCachedProducts() {
  if (!canUseStorage()) return []

  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCachedProducts(products) {
  if (!canUseStorage()) return

  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(Array.isArray(products) ? products : []))
  } catch {
    // Ignore storage failures.
  }
}