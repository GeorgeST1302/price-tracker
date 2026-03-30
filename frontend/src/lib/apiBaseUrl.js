export function getApiBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  if (fromEnv) return String(fromEnv).replace(/\/$/, "")

  const host = window.location.hostname
  if (host === "localhost") return "http://localhost:8000"
  if (host === "127.0.0.1") return "http://127.0.0.1:8000"
  return "http://127.0.0.1:8000"
}
