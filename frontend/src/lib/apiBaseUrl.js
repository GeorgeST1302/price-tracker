import { getFetchMode } from "./fetchMode"

export function getApiBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  const normalizedFromEnv = String(fromEnv || "").trim().replace(/\/$/, "")
  const isPlaceholder =
    !normalizedFromEnv ||
    normalizedFromEnv.includes("<subdomain>") ||
    normalizedFromEnv.includes("your-")

  if (!isPlaceholder) return normalizedFromEnv

  const host = window.location.hostname
  if (host === "localhost") return "http://localhost:8787"
  if (host === "127.0.0.1") return "http://127.0.0.1:8787"

  // In production, explicitly require VITE_API_BASE_URL so the app points
  // to the deployed Worker instead of accidentally calling localhost.
  console.warn("VITE_API_BASE_URL is not set; API calls may fail in production")
  return ""
}

const DEFAULT_TIMEOUT_MS = 20000

export const API_TIMEOUT_MESSAGE =
  "The Worker is taking too long to respond. If it is warming up, wait a few seconds and try again."

function formatApiDetail(detail) {
  if (!detail) return null

  if (typeof detail === "string") {
    return detail
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") return null
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null
        const message = item.msg || item.message
        if (!message) return null
        return field ? `${field}: ${message}` : message
      })
      .filter(Boolean)

    return messages.length ? messages.join(" ") : null
  }

  if (typeof detail === "object" && detail.message) {
    return String(detail.message)
  }

  return null
}

async function extractApiErrorMessage(response) {
  const fallback = `HTTP ${response.status} ${response.statusText}`.trim()

  try {
    const contentType = response.headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
      const payload = await response.json()
      const detailMessage = formatApiDetail(payload?.detail)
      if (detailMessage) return detailMessage
      return fallback
    }

    const bodyText = await response.text().catch(() => "")
    return bodyText || fallback
  } catch {
    return fallback
  }
}

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
  const requestHeaders = new Headers(headers || {})
  const fetchMode = getFetchMode()

  if (fetchMode === "zyte-only") {
    requestHeaders.set("X-PricePulse-Fetch-Mode", "zyte-only")
  }

  try {
    const response = await fetch(requestUrl, {
      ...rest,
      headers: requestHeaders,
      cache: "no-store",
      signal: timeout.signal,
    })

    if (!response.ok) {
      const message = await extractApiErrorMessage(response)
      throw new Error(message)
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
