const TRACKER_API_BASE_URL_KEY = "selenium_tracker_api_base_url"
const DEFAULT_TRACKER_API_BASE_URL = import.meta.env.VITE_SELENIUM_TRACKER_API_BASE_URL || ""

export function getTrackerApiBaseUrl() {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(TRACKER_API_BASE_URL_KEY)
    if (stored) return String(stored).trim().replace(/\/$/, "")
  }

  return String(DEFAULT_TRACKER_API_BASE_URL || "").trim().replace(/\/$/, "")
}

export function setTrackerApiBaseUrl(value) {
  if (typeof window === "undefined") return
  const normalized = String(value || "").trim().replace(/\/$/, "")
  if (normalized) {
    window.localStorage.setItem(TRACKER_API_BASE_URL_KEY, normalized)
  } else {
    window.localStorage.removeItem(TRACKER_API_BASE_URL_KEY)
  }
}

export async function trackUrls(urls, { headless = true } = {}) {
  const response = await fetch(`${getTrackerApiBaseUrl()}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, headless }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `HTTP ${response.status}`)
  }

  return response.json()
}
