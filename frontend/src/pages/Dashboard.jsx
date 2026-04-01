import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import ProductCard from "../components/ProductCard"
import { apiJson, apiRequest } from "../lib/apiBaseUrl"

function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [products, setProducts] = useState([])
  const [deletingId, setDeletingId] = useState(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const productsData = await apiJson("/products")
      setProducts(Array.isArray(productsData) ? productsData : [])
    } catch (err) {
      setProducts([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  async function handleDelete(productId) {
    setError(null)
    setDeletingId(productId)

    try {
      await apiRequest(`/products/${productId}`, { method: "DELETE" })
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  const trackedCount = products.length
  const buyNowCount = products.filter((product) => String(product.recommendation).toUpperCase().includes("BUY")).length
  const avgDelta = (() => {
    const deltas = products.map((product) => Number(product.delta_from_avg_pct)).filter((value) => Number.isFinite(value))
    if (!deltas.length) return 0
    return deltas.reduce((sum, value) => sum + value, 0) / deltas.length
  })()

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Smart purchase dashboard</h2>
          <p className="section-sub">Track price context, spot bargains, and decide whether to buy now or wait a little longer.</p>
        </div>
        <span className="kbd">Live from your backend API</span>
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      <div className="grid-cards">
        <article className="card">
          <p className="section-sub">Tracked products</p>
          <p className="metric">{trackedCount}</p>
        </article>
        <article className="card">
          <p className="section-sub">Buy now opportunities</p>
          <p className="metric">{buyNowCount}</p>
        </article>
        <article className="card">
          <p className="section-sub">Average move vs 30D average</p>
          <p className="metric" style={{ fontSize: "1.2rem" }}>{Number.isFinite(avgDelta) ? `${avgDelta.toFixed(1)}%` : "N/A"}</p>
        </article>
      </div>

      {loading ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span>Loading dashboard insights...</span>
        </div>
      ) : products.length === 0 ? (
        <div className="notice">No tracked products yet. Add one to start getting buy-or-wait guidance.</div>
      ) : (
        <div className="stack">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              footer={
                <p className="section-sub">
                  Last updated: {product.last_updated ? new Date(product.last_updated).toLocaleString() : "Waiting for first refresh"}
                </p>
              }
              actions={
                <>
                  <Link className="button button-secondary" to={`/detail?product=${product.id}`}>
                    Inspect
                  </Link>
                  {product.purchase_url ? (
                    <a className="button" href={product.purchase_url} target="_blank" rel="noreferrer">
                      Buy Now
                    </a>
                  ) : null}
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={deletingId === product.id}
                    onClick={() => handleDelete(product.id)}
                  >
                    {deletingId === product.id ? "Deleting..." : "Delete"}
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default Dashboard
