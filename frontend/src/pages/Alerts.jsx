import { useEffect, useMemo, useState } from "react"
import { getApiBaseUrl } from "../lib/apiBaseUrl"

function Alerts() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])

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
      const [productsRes, alertsRes] = await Promise.all([
        fetch(`${apiBaseUrl}/products`),
        fetch(`${apiBaseUrl}/alerts?triggered_only=true`),
      ])

      if (!productsRes.ok) {
        const bodyText = await productsRes.text().catch(() => "")
        throw new Error(`HTTP ${productsRes.status} ${productsRes.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }

      if (!alertsRes.ok) {
        const bodyText = await alertsRes.text().catch(() => "")
        throw new Error(`HTTP ${alertsRes.status} ${alertsRes.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }

      const productsData = await productsRes.json()
      const alertsData = await alertsRes.json()

      setProducts(Array.isArray(productsData) ? productsData : [])
      setAlerts(Array.isArray(alertsData) ? alertsData : [])
    } catch (err) {
      console.error("[Alerts] load failed:", err)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl])

  async function handleCreate(e) {
    e.preventDefault()
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
      const res = await fetch(`${apiBaseUrl}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: parsedProductId, target_price: parsedTarget }),
      })

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }

      const created = await res.json()
      const product = products.find((p) => Number(p.id) === Number(created.product_id))
      setCreatedMsg(`Alert created for ${product?.name || "product"} at ₹${created.target_price}`)
      setTargetPrice("")
      await loadAll()
    } catch (err) {
      console.error("[Alerts] create failed:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const byProductId = useMemo(() => new Map(products.map((p) => [Number(p.id), p])), [products])

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
            onChange={(e) => setProductId(e.target.value)}
            disabled={loading || submitting}
          >
            <option value="">Select...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
            onChange={(e) => setTargetPrice(e.target.value)}
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
          {alerts.map((a) => {
            const p = byProductId.get(Number(a.product_id))
            return (
              <article className="card" key={a.id}>
                <div className="row">
                  <h3>{p?.name || `Product #${a.product_id}`}</h3>
                  <span className="badge badge-good">Triggered</span>
                </div>
                <p className="section-sub">Threshold: ₹{a.target_price}</p>
                <p className="section-sub">
                  Triggered at: {a.triggered_at ? new Date(a.triggered_at).toLocaleString() : "-"}
                </p>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default Alerts
