import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { apiJson, getApiBaseUrl } from "../lib/apiBaseUrl"

const SEEN_ALERTS_STORAGE_KEY = "pricepulse_seen_alert_ids"

function readSeenAlerts() {
  try {
    const raw = window.localStorage.getItem(SEEN_ALERTS_STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.map(String) : [])
  } catch {
    return new Set()
  }
}

function saveSeenAlerts(ids) {
  try {
    window.localStorage.setItem(SEEN_ALERTS_STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // Ignore storage failures so alert polling still works.
  }
}

function formatAlertBody(alert) {
  const target = Number(alert.target_price)
  if (Number.isFinite(target)) {
    return `A tracked product reached your target price of Rs. ${target}.`
  }

  return "A tracked product reached your configured target price."
}

function AlertWatcher() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const seenAlertIdsRef = useRef(new Set())
  const initializedRef = useRef(false)

  const [freshAlerts, setFreshAlerts] = useState([])
  const [notificationSupported] = useState(typeof window !== "undefined" && "Notification" in window)
  const [permission, setPermission] = useState(notificationSupported ? Notification.permission : "denied")

  useEffect(() => {
    seenAlertIdsRef.current = readSeenAlerts()
  }, [])

  useEffect(() => {
    if (!apiBaseUrl) return undefined

    let cancelled = false

    async function pollAlerts() {
      try {
        const data = await apiJson("/alerts?triggered_only=true", { timeoutMs: 15000 })
        if (cancelled || !Array.isArray(data)) return

        const seenIds = seenAlertIdsRef.current
        const incomingAlerts = data
          .filter((alert) => alert && alert.id != null)
          .sort((a, b) => new Date(b.triggered_at || 0).getTime() - new Date(a.triggered_at || 0).getTime())

        if (!initializedRef.current) {
          incomingAlerts.forEach((alert) => seenIds.add(String(alert.id)))
          saveSeenAlerts(seenIds)
          initializedRef.current = true
          return
        }

        const nextFreshAlerts = incomingAlerts.filter((alert) => !seenIds.has(String(alert.id)))
        if (!nextFreshAlerts.length) return

        nextFreshAlerts.forEach((alert) => seenIds.add(String(alert.id)))
        saveSeenAlerts(seenIds)
        setFreshAlerts((current) => {
          const next = [...nextFreshAlerts, ...current]
          return next.slice(0, 5)
        })

        if (notificationSupported && Notification.permission === "granted") {
          nextFreshAlerts.forEach((alert) => {
            new Notification("PricePulse alert", {
              body: formatAlertBody(alert),
            })
          })
        }
      } catch {
        // Silent failure: page-level API surfaces handle the detailed error states.
      }
    }

    pollAlerts()
    const intervalId = window.setInterval(pollAlerts, 60000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [apiBaseUrl, notificationSupported])

  async function enableNotifications() {
    if (!notificationSupported) return

    const nextPermission = await Notification.requestPermission()
    setPermission(nextPermission)
  }

  if (!freshAlerts.length && permission !== "default") {
    return null
  }

  return (
    <div className="app-banner">
      <div>
        <strong>Alerts</strong>
        <p className="section-sub">
          {freshAlerts.length
            ? `${freshAlerts.length} new price alert${freshAlerts.length === 1 ? "" : "s"} detected.`
            : "Enable browser notifications to get alerted while the app is open."}
        </p>
      </div>

      <div className="row">
        {permission === "default" ? (
          <button className="button" type="button" onClick={enableNotifications}>
            Enable Browser Alerts
          </button>
        ) : null}
        {freshAlerts.length ? (
          <Link className="tab tab-active" to="/alerts">
            Open Alerts
          </Link>
        ) : null}
      </div>
    </div>
  )
}

export default AlertWatcher
