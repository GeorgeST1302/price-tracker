const RECENT_SEARCHES_KEY = "pricepulse_recent_searches"
const MAX_RECENT_SEARCHES = 6

export function readRecentSearches() {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []
  } catch {
    return []
  }
}

export function saveRecentSearch(term) {
  const nextTerm = String(term || "").trim()
  if (!nextTerm) return []

  const current = readRecentSearches()
  const next = [nextTerm, ...current.filter((item) => item.toLowerCase() !== nextTerm.toLowerCase())].slice(0, MAX_RECENT_SEARCHES)

  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
  } catch {
    return next
  }

  return next
}

export function clearRecentSearches() {
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY)
  } catch {
    // Ignore storage failures.
  }
}
