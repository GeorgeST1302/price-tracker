import { useEffect, useState } from "react"

import { apiJson } from "../lib/apiBaseUrl"

function History() {
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

      try {
        const data = await apiJson("/products")
        if (cancelled) return
        setProducts(Array.isArray(data) ? data : [])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setProducts([])
      } finally {
        if (!cancelled) setLoadingProducts(false)
      }
    }

    void loadProducts()

    return () => {
      cancelled = true
    }
  }, [])

  async function loadHistory(productId) {
    setLoadingHistory(true)
    setError(null)

    try {
      const data = await apiJson(`/products/${productId}/history`)
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  async function refreshNow() {
    if (!selectedProductId) return

    setError(null)

    try {
      await apiJson(`/products/${selectedProductId}/refresh`, { method: "POST" })
      await loadHistory(selectedProductId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectedProduct = products.find((product) => String(product.id) === String(selectedProductId))

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
              onChange={async (event) => {
                const nextId = event.target.value
                setSelectedProductId(nextId)
                setHistory([])
                if (nextId) await loadHistory(nextId)
              }}
            >
              <option value="">Select...</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <div className="row">
            <button className="button" type="button" onClick={refreshNow} disabled={!selectedProductId || loadingHistory}>
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
          <p>Target: Rs. {selectedProduct.target_price}</p>
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
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td>Rs. {entry.price}</td>
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
