import { useEffect, useMemo, useState } from "react"
import { getApiBaseUrl } from "../lib/apiBaseUrl"

function History() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])

  const [products, setProducts] = useState([])
  const [selectedProductId, setSelectedProductId] = useState("")
  const [history, setHistory] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoadingProducts(true)
      setError(null)
      const url = `${apiBaseUrl}/products`
      console.log("[History] Fetch products:", url)

      try {
        const res = await fetch(url)
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "")
          throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
        }
        const data = await res.json()
        if (cancelled) return
        setProducts(Array.isArray(data) ? data : [])
      } catch (err) {
        if (cancelled) return
        console.error("[History] Products fetch failed:", err)
        setError(err instanceof Error ? err.message : String(err))
        setProducts([])
      } finally {
        if (!cancelled) setLoadingProducts(false)
      }
    }

    loadProducts()
    return () => {
      cancelled = true
    }
  }, [apiBaseUrl])

  async function loadHistory(productId) {
    setLoadingHistory(true)
    setError(null)
    const url = `${apiBaseUrl}/products/${productId}/history`
    console.log("[History] Fetch history:", url)

    try {
      const res = await fetch(url)
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }
      const data = await res.json()
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("[History] History fetch failed:", err)
      setError(err instanceof Error ? err.message : String(err))
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  async function refreshNow() {
    if (!selectedProductId) return
    setError(null)
    const url = `${apiBaseUrl}/products/${selectedProductId}/refresh`
    console.log("[History] Refresh now:", url)

    try {
      const res = await fetch(url, { method: "POST" })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }
      const data = await res.json()
      console.log("[History] Refresh saved:", data)
      await loadHistory(selectedProductId)
    } catch (err) {
      console.error("[History] Refresh failed:", err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === String(selectedProductId))

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Price History</h2>
          <p className="section-sub">Inspect timeline data and refresh a product instantly.</p>
        </div>
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {loadingProducts ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span>Loading products...</span>
        </div>
      ) : products.length === 0 ? (
        <div className="notice">No products yet. Add one first.</div>
      ) : (
        <div className="card stack">
          <label className="stack" htmlFor="history-product-select">
            <span>Product</span>
            <select
              id="history-product-select"
              className="select"
              value={selectedProductId}
              onChange={async (e) => {
                const id = e.target.value
                setSelectedProductId(id)
                setHistory([])
                if (id) await loadHistory(id)
              }}
            >
              <option value="">Select...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="row">
            <button className="button" onClick={refreshNow} disabled={!selectedProductId || loadingHistory}>
              Refresh price now
            </button>
          </div>
        </div>
      )}

      {selectedProduct ? (
        <div className="card stack">
          <p>
            <b>{selectedProduct.name}</b>
          </p>
          <p>Target: ₹{selectedProduct.target_price}</p>
        </div>
      ) : null}

      {selectedProductId ? (
        loadingHistory ? (
          <div className="row">
            <span className="spinner" aria-label="Loading" />
            <span>Loading history...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="notice">No price history yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.timestamp).toLocaleString()}</td>
                    <td>₹{h.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  )
}

export default History