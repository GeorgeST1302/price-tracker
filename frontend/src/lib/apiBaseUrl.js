const DEFAULT_PRODUCTION_API_BASE_URL = "https://price-tracker-backend-hxqx.onrender.com"

export function getApiBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  const normalizedFromEnv = String(fromEnv || "").trim().replace(/\/$/, "")
  if (normalizedFromEnv) return normalizedFromEnv

  const host = window.location.hostname
  if (host === "localhost") return "http://localhost:8000"
  if (host === "127.0.0.1") return "http://127.0.0.1:8000"

  console.warn("VITE_API_BASE_URL is not set; falling back to the production backend URL")
  return DEFAULT_PRODUCTION_API_BASE_URL
}

const DEFAULT_TIMEOUT_MS = 20000

export const API_TIMEOUT_MESSAGE =
  "The backend is taking too long to respond. If Render is waking the API up, wait a few seconds and try again."

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(new Error(API_TIMEOUT_MESSAGE)), timeoutMs)

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timeoutId)
    },
  }
}

export function buildApiUrl(path) {
  const baseUrl = getApiBaseUrl()
  if (!baseUrl) {
    throw new Error("VITE_API_BASE_URL is not set for this deployment.")
  }

  if (/^https?:\/\//i.test(path)) return path

  const normalizedPath = String(path || "").replace(/^\//, "")
  return new URL(normalizedPath, `${baseUrl}/`).toString()
}

export async function apiRequest(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, headers, ...rest } = options
  const requestUrl = buildApiUrl(path)
  const timeout = withTimeout(signal, timeoutMs)

  try {
    const response = await fetch(requestUrl, {
      ...rest,
      headers,
      cache: "no-store",
      signal: timeout.signal,
    })

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null)
        const detail = payload && typeof payload === "object" ? payload.detail : null
        if (typeof detail === "string" && detail.trim()) {
          throw new Error(detail)
        }
      }

      const bodyText = await response.text().catch(() => "")
      throw new Error(`HTTP ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
    }

    return response
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(API_TIMEOUT_MESSAGE)
    }

    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    timeout.cleanup()
  }
}

export async function apiJson(path, options = {}) {
  const response = await apiRequest(path, options)
  return response.json()
}
