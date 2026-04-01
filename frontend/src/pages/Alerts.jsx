import { useEffect, useMemo, useState } from "react"

import { apiJson } from "../lib/apiBaseUrl"

function Alerts() {
  const [products, setProducts] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [createdMsg, setCreatedMsg] = useState(null)

  const [productId, setProductId] = useState("")
  const [targetPrice, setTargetPrice] = useState("")

  async function loadAll() {
    setLoading(true)
    setError(null)

    try {
      const [productsData, alertsData] = await Promise.all([
        apiJson("/products"),
        apiJson("/alerts?triggered_only=true"),
      ])

      setProducts(Array.isArray(productsData) ? productsData : [])
      setAlerts(Array.isArray(alertsData) ? alertsData : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProducts([])
      setAlerts([])
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

    const parsedTarget = Number(targetPrice)
    const parsedProductId = Number(productId)

    if (!Number.isFinite(parsedProductId) || parsedProductId <= 0) {
      setError("Select a product")
      return
    }

    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError("Alert target price must be a positive number")
      return
    }

    try {
      setSubmitting(true)
      const created = await apiJson("/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: parsedProductId, target_price: parsedTarget }),
      })

      const product = products.find((item) => Number(item.id) === Number(created.product_id))
      setCreatedMsg(`Alert created for ${product?.name || "product"} at Rs. ${created.target_price}`)
      setTargetPrice("")
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const byProductId = useMemo(() => new Map(products.map((product) => [Number(product.id), product])), [products])

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Alerts</h2>
          <p className="section-sub">Triggered alerts appear here when a tracked price meets your threshold.</p>
        </div>
        <span className="kbd">Auto-checked on scheduled updates</span>
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}
      {createdMsg ? <div className="notice notice-success">{createdMsg}</div> : null}

      <form className="card stack" onSubmit={handleCreate}>
        <h3>Create Alert</h3>

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

        <label className="stack" htmlFor="alert-target-price">
          <span>Alert target price</span>
          <input
            id="alert-target-price"
            className="input"
            value={targetPrice}
            onChange={(event) => setTargetPrice(event.target.value)}
            placeholder="e.g. 1200"
            disabled={loading || submitting}
          />
        </label>

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
      ) : alerts.length === 0 ? (
        <div className="notice">No triggered alerts yet.</div>
      ) : (
        <div className="stack">
          {alerts.map((alert) => {
            const product = byProductId.get(Number(alert.product_id))
            return (
              <article className="card" key={alert.id}>
                <div className="row">
                  <h3>{product?.name || `Product #${alert.product_id}`}</h3>
                  <span className="badge badge-good">Triggered</span>
                </div>
                <p className="section-sub">Threshold: Rs. {alert.target_price}</p>
                <p className="section-sub">Triggered at: {alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : "-"}</p>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default Alerts
