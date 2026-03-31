export function getApiBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  if (fromEnv) return String(fromEnv).replace(/\/$/, "")

  const host = window.location.hostname
  if (host === "localhost") return "http://localhost:8000"
  if (host === "127.0.0.1") return "http://127.0.0.1:8000"

  // In production, explicitly require VITE_API_BASE_URL so the app points
  // to the deployed backend instead of accidentally calling localhost.
  console.warn("VITE_API_BASE_URL is not set; API calls may fail in production")
  return ""
}
