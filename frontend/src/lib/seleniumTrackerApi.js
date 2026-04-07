const DEFAULT_TRACKER_API_BASE_URL = import.meta.env.VITE_SELENIUM_TRACKER_API_BASE_URL || "http://localhost:8000"

export function getTrackerApiBaseUrl() {
  return String(DEFAULT_TRACKER_API_BASE_URL || "").trim().replace(/\/$/, "")
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
