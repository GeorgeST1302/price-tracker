import { useEffect, useMemo, useState } from "react"

import { apiJson } from "../lib/apiBaseUrl"

function formatDeliveryNote(note) {
  if (!note) return null

  const value = String(note)
  if (value.toLowerCase().includes("email is not configured") || value.toLowerCase().includes("smtp_")) {
    return "Email is not configured or failed to send. Set SMTP_HOST/SMTP_PORT/SMTP_FROM/SMTP_TO (and credentials if required)."
  }
  if (value.includes("Read timed out") || value.includes("HTTPConnectionPool")) {
    return "Telegram timed out. The backend will retry on the next refresh or scheduled check."
  }
  if (value.includes("Unauthorized")) {
    return "Telegram rejected the bot token. Update TELEGRAM_BOT_TOKEN in the backend environment."
  }
  if (value.includes("chat not found") || value.includes("Forbidden")) {
    return "Telegram could not send to that chat. Make sure you started the bot and that TELEGRAM_CHAT_ID is correct."
  }

  return value
}

function Alerts() {
  const [products, setProducts] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [savingAlertId, setSavingAlertId] = useState(null)
  const [deletingAlertId, setDeletingAlertId] = useState(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState(null)
  const [createdMsg, setCreatedMsg] = useState(null)
  const [testMsg, setTestMsg] = useState(null)
  const [notificationStatus, setNotificationStatus] = useState(null)

  const [productId, setProductId] = useState("")
  const [editingAlertId, setEditingAlertId] = useState("")
  const [editMin, setEditMin] = useState("")
  const [editMax, setEditMax] = useState("")
  const [editTelegramEnabled, setEditTelegramEnabled] = useState(true)
  const [editBrowserEnabled, setEditBrowserEnabled] = useState(false)
  const [editAlarmEnabled, setEditAlarmEnabled] = useState(false)
  const [editEmailEnabled, setEditEmailEnabled] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError(null)

    try {
      const [productsData, alertsData, statusData] = await Promise.all([
        apiJson("/products"),
        apiJson("/alerts"),
        apiJson("/notifications/status"),
      ])

      setProducts(Array.isArray(productsData) ? productsData : [])
      setAlerts(Array.isArray(alertsData) ? alertsData : [])
      setNotificationStatus(statusData)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProducts([])
      setAlerts([])
      setNotificationStatus(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (cancelled) return
      await loadAll()
    })()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(event) {
    event.preventDefault()
    setError(null)
    setCreatedMsg(null)
    setTestMsg(null)

    const parsedProductId = Number(productId)

    if (!Number.isFinite(parsedProductId) || parsedProductId <= 0) {
      setError("Select a product")
      return
    }

    const selectedProduct = products.find((item) => Number(item.id) === parsedProductId)
    const parsedMin = Number(selectedProduct?.target_price_min ?? selectedProduct?.target_price)
    const parsedMax = Number(selectedProduct?.target_price_max ?? selectedProduct?.target_price)

    if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax) || parsedMin <= 0 || parsedMax <= 0) {
      setError("Selected product does not have a valid target range. Set product range first.")
      return
    }

    if (parsedMin > parsedMax) {
      setError("Alert target min must be <= target max")
      return
    }

    try {
      setSubmitting(true)
      const created = await apiJson("/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: parsedProductId,
          target_price_min: parsedMin,
          target_price_max: parsedMax,
          telegram_enabled: true,
          browser_enabled: false,
          alarm_enabled: false,
          email_enabled: false,
        }),
      })

      if (created.triggered_flag) {
        setCreatedMsg(
          `Alert created and already triggered for ${selectedProduct?.name || "product"} at Rs. ${created.target_price_min} - ${created.target_price_max}`
        )
      } else {
        setCreatedMsg(
          `Alert created for ${selectedProduct?.name || "product"} at Rs. ${created.target_price_min} - ${created.target_price_max}`
        )
      }
      setProductId("")
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSendTest() {
    setError(null)
    setTestMsg(null)
    setTesting(true)

    try {
      const result = await apiJson("/notifications/test", { method: "POST" })
      setTestMsg(result?.detail || (result?.sent ? "Telegram test sent." : "Telegram test failed."))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  function beginEdit(alert) {
    setError(null)
    setCreatedMsg(null)
    setTestMsg(null)
    setEditingAlertId(String(alert.id))
    setEditMin(String(alert.target_price_min ?? alert.target_price ?? ""))
    setEditMax(String(alert.target_price_max ?? alert.target_price ?? ""))
    setEditTelegramEnabled(Boolean(alert.telegram_enabled))
    setEditBrowserEnabled(Boolean(alert.browser_enabled))
    setEditAlarmEnabled(Boolean(alert.alarm_enabled))
    setEditEmailEnabled(Boolean(alert.email_enabled))
  }

  function cancelEdit() {
    setEditingAlertId("")
    setEditMin("")
    setEditMax("")
    setEditTelegramEnabled(true)
    setEditBrowserEnabled(false)
    setEditAlarmEnabled(false)
    setEditEmailEnabled(false)
  }

  async function handleSaveAlert(alertId) {
    const parsedMin = Number(editMin)
    const parsedMax = Number(editMax)

    if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax) || parsedMin <= 0 || parsedMax <= 0) {
      setError("Alert target range must contain positive numbers.")
      return
    }
    if (parsedMin > parsedMax) {
      setError("Alert target min must be <= target max")
      return
    }

    setError(null)
    setSavingAlertId(alertId)

    try {
      await apiJson(`/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_price_min: parsedMin,
          target_price_max: parsedMax,
          telegram_enabled: editTelegramEnabled,
          browser_enabled: editBrowserEnabled,
          alarm_enabled: editAlarmEnabled,
          email_enabled: editEmailEnabled,
        }),
      })
      cancelEdit()
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingAlertId(null)
    }
  }

  async function handleDeleteAlert(alertId) {
    setError(null)
    setDeletingAlertId(alertId)

    try {
      await apiJson(`/alerts/${alertId}`, { method: "DELETE" })
      if (String(editingAlertId) === String(alertId)) cancelEdit()
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingAlertId(null)
    }
  }

  const byProductId = useMemo(() => new Map(products.map((product) => [Number(product.id), product])), [products])
  const pendingAlerts = useMemo(() => {
    const latestByProduct = new Map()

    alerts
      .filter((alert) => !alert.triggered_flag)
      .forEach((alert) => {
        const key = Number(alert.product_id)
        const existing = latestByProduct.get(key)
        if (!existing) {
          latestByProduct.set(key, alert)
          return
        }
        const existingTs = new Date(existing.created_at || 0).getTime()
        const nextTs = new Date(alert.created_at || 0).getTime()
        if (nextTs >= existingTs) {
          latestByProduct.set(key, alert)
        }
      })

    return Array.from(latestByProduct.values()).sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    )
  }, [alerts])
  const triggeredAlerts = alerts.filter((alert) => alert.triggered_flag)

  function renderAlertEditor(alert) {
    const isEditing = String(editingAlertId) === String(alert.id)
    if (!isEditing) return null

    return (
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="stack" style={{ flex: 1 }}>
            <span>Target min</span>
            <input className="input" value={editMin} onChange={(event) => setEditMin(event.target.value)} />
          </label>
          <label className="stack" style={{ flex: 1 }}>
            <span>Target max</span>
            <input className="input" value={editMax} onChange={(event) => setEditMax(event.target.value)} />
          </label>
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={editTelegramEnabled} onChange={(event) => setEditTelegramEnabled(event.target.checked)} />
            <span>Telegram</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={editBrowserEnabled} onChange={(event) => setEditBrowserEnabled(event.target.checked)} />
            <span>Browser</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={editAlarmEnabled} onChange={(event) => setEditAlarmEnabled(event.target.checked)} />
            <span>Alarm</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={editEmailEnabled} onChange={(event) => setEditEmailEnabled(event.target.checked)} />
            <span>Email</span>
          </label>
        </div>

        <div className="row">
          <button className="button button-small" type="button" onClick={() => handleSaveAlert(alert.id)} disabled={savingAlertId === alert.id}>
            {savingAlertId === alert.id ? "Saving..." : "Save alert"}
          </button>
          <button className="button button-secondary button-small" type="button" onClick={cancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  function renderAlertCard(alert) {
    const product = byProductId.get(Number(alert.product_id))
    const isTriggered = Boolean(alert.triggered_flag)
    const isEditing = String(editingAlertId) === String(alert.id)

    return (
      <article className="card" key={`${isTriggered ? "triggered" : "pending"}-${alert.id}`}>
        <div className="row">
          <h3>{product?.name || `Product #${alert.product_id}`}</h3>
          <span className={isTriggered ? "badge badge-good" : "badge badge-warn"}>{isTriggered ? "Triggered" : "Pending"}</span>
          {isTriggered ? (
            <span className={alert.notification_sent_flag ? "badge badge-good" : "badge badge-danger"}>
              {alert.notification_sent_flag ? "Notified" : "Not notified"}
            </span>
          ) : null}
        </div>
        <p className="section-sub">Threshold: Rs. {alert.target_price_min} - {alert.target_price_max}</p>
        <p className="section-sub">Created at: {new Date(alert.created_at).toLocaleString()}</p>
        {isTriggered ? (
          <>
            <p className="section-sub">Triggered at: {alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : "-"}</p>
            {alert.notification_sent_at ? <p className="section-sub">Notified at: {new Date(alert.notification_sent_at).toLocaleString()}</p> : null}
            {alert.notification_error ? <p className="section-sub">Delivery note: {formatDeliveryNote(alert.notification_error)}</p> : null}
          </>
        ) : null}

        {!isTriggered ? <p className="section-sub">Notifications: {alert.telegram_enabled ? "Telegram" : "-"}{alert.email_enabled ? ", Email" : ""}{alert.browser_enabled ? ", Browser" : ""}{alert.alarm_enabled ? ", Alarm" : ""}</p> : null}

        {renderAlertEditor(alert)}

        {!isEditing ? (
          <div className="row">
            <button className="button button-secondary button-small" type="button" onClick={() => beginEdit(alert)}>
              Edit
            </button>
            <button className="button button-danger button-small" type="button" disabled={deletingAlertId === alert.id} onClick={() => handleDeleteAlert(alert.id)}>
              {deletingAlertId === alert.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Alerts</h2>
          <p className="section-sub">Create and track Telegram alerts for target price drops.</p>
        </div>
        <div className="row">
          <button className="button button-secondary button-small" type="button" onClick={handleSendTest} disabled={testing}>
            {testing ? "Sending..." : "Test Telegram"}
          </button>
          <span className="kbd">Auto-checked on scheduled updates</span>
        </div>
      </div>

      {notificationStatus ? (
        <div className="stack">
          {notificationStatus.telegram_configured ? (
            <div className="notice notice-success">Telegram phone alerts are configured on the backend.</div>
          ) : (
            <div className="notice">
              Telegram phone alerts are not configured yet. Set <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> on the backend to send alerts to your phone.
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="notice notice-error">Error: {error}</div> : null}
      {createdMsg ? <div className="notice notice-success">{createdMsg}</div> : null}
      {testMsg ? <div className="notice notice-success">{testMsg}</div> : null}

      <form className="card stack" onSubmit={handleCreate}>
        <label className="stack" htmlFor="alert-product-select">
          <span>Product</span>
          <select
            id="alert-product-select"
            className="select"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            disabled={loading || submitting}
          >
            <option value="">Select...</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        <p className="section-sub">This alert will use the selected product's existing target range.</p>

        <div className="row">
          <button className="button" type="submit" disabled={loading || submitting}>
            {submitting ? "Creating..." : "Create Alert"}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span className="section-sub">Loading alerts...</span>
        </div>
      ) : (
        <div className="stack">
          <div className="card stack">
            <h3>Pending Alerts</h3>
            {pendingAlerts.length === 0 ? (
              <p className="section-sub">No pending alerts right now.</p>
            ) : (
              pendingAlerts.map((alert) => renderAlertCard(alert))
            )}
          </div>

          <div className="card stack">
            <h3>Triggered Alerts</h3>
            {triggeredAlerts.length === 0 ? (
              <p className="section-sub">No triggered alerts yet.</p>
            ) : (
              triggeredAlerts.map((alert) => renderAlertCard(alert))
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default Alerts
