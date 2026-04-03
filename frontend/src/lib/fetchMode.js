const FETCH_MODE_KEY = "pricepulse_fetch_mode"
const FETCH_MODE_EVENT = "pricepulse-fetch-mode-changed"
const FETCH_TOGGLE_REVEAL_KEY = "pricepulse_fetch_toggle_revealed"

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage
}

function emitChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(FETCH_MODE_EVENT))
}

export function getFetchMode() {
  if (!canUseStorage()) return "auto"
  const value = window.localStorage.getItem(FETCH_MODE_KEY)
  return value === "zyte-only" ? "zyte-only" : "auto"
}

export function setFetchMode(mode) {
  if (!canUseStorage()) return
  const normalized = mode === "zyte-only" ? "zyte-only" : "auto"
  window.localStorage.setItem(FETCH_MODE_KEY, normalized)
  emitChange()
}

export function isFetchToggleRevealed() {
  if (!canUseStorage()) return false
  return window.localStorage.getItem(FETCH_TOGGLE_REVEAL_KEY) === "1"
}

export function setFetchToggleRevealed(revealed) {
  if (!canUseStorage()) return
  if (revealed) {
    window.localStorage.setItem(FETCH_TOGGLE_REVEAL_KEY, "1")
  } else {
    window.localStorage.removeItem(FETCH_TOGGLE_REVEAL_KEY)
  }
  emitChange()
}

export function subscribeToFetchMode(listener) {
  if (typeof window === "undefined") return () => {}

  const handleStorage = (event) => {
    if (!event.key || event.key === FETCH_MODE_KEY || event.key === FETCH_TOGGLE_REVEAL_KEY) {
      listener()
    }
  }

  window.addEventListener(FETCH_MODE_EVENT, listener)
  window.addEventListener("storage", handleStorage)

  return () => {
    window.removeEventListener(FETCH_MODE_EVENT, listener)
    window.removeEventListener("storage", handleStorage)
  }
}
