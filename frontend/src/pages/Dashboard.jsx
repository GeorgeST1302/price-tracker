import { useCallback, useEffect, useState } from "react"

import { apiJson, apiRequest } from "../lib/apiBaseUrl"

function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [products, setProducts] = useState([])
  const [insights, setInsights] = useState([])
  const [deletingId, setDeletingId] = useState(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const productsData = await apiJson("/products")
      const productsArray = Array.isArray(productsData) ? productsData : []

      const historyResults = await Promise.all(
        productsArray.map(async (product) => {
          try {
            const historyData = await apiJson(`/products/${product.id}/history?limit=10`, { timeoutMs: 15000 })
            return { productId: product.id, history: Array.isArray(historyData) ? historyData : [] }
          } catch {
            return { productId: product.id, history: [] }
          }
        })
      )

      setProducts(productsArray)

      const byProduct = new Map(historyResults.map((entry) => [entry.productId, entry.history]))
      const nextInsights = productsArray.map((product) => {
        const history = byProduct.get(product.id) || []
        const latestFromHistory = history[0]?.price
        const oldestFromHistory = history[history.length - 1]?.price

        const latest = Number.isFinite(Number(product.latest_price)) ? Number(product.latest_price) : Number(latestFromHistory)
        const oldest = Number(oldestFromHistory)
        const dropPct =
          Number.isFinite(latest) && Number.isFinite(oldest) && oldest > 0 ? ((oldest - latest) / oldest) * 100 : null
        const gap = Number.isFinite(latest) ? latest - product.target_price : null

        const recommendation = product.recommendation || "-"
        const tone = recommendation === "BUY" ? "badge-good" : recommendation === "HOLD" ? "badge-danger" : "badge-warn"

        return {
          product,
          latest,
          points: history.length,
          gap,
          dropPct,
          recommendation: { label: recommendation, tone },
        }
      })

      setInsights(nextInsights)
    } catch (err) {
      setProducts([])
      setInsights([])
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

  const belowTargetCount = insights.filter(
    (item) =>
      Number.isFinite(Number(item.latest)) &&
      Number.isFinite(Number(item.product.target_price)) &&
      Number(item.latest) <= Number(item.product.target_price)
  ).length

  const avgDropPct = (() => {
    const drops = insights.map((item) => item.dropPct).filter((value) => Number.isFinite(value) && value > 0)
    if (!drops.length) return 0
    return drops.reduce((sum, current) => sum + current, 0) / drops.length
  })()

  const recentlyUpdated = [...products]
    .filter((product) => product.last_updated)
    .sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())
    .slice(0, 5)

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Pricing Intelligence Dashboard</h2>
          <p className="section-sub">Recommendations are computed from the last 5-10 price points and refreshed automatically on a schedule.</p>
        </div>
        <span className="kbd">Live from your backend API</span>
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      <div className="grid-cards">
        <article className="card">
          <p className="section-sub">Total Products</p>
          <p className="metric">{trackedCount}</p>
        </article>
        <article className="card">
          <p className="section-sub">Below Target Price</p>
          <p className="metric">{belowTargetCount}</p>
        </article>
        <article className="card">
          <p className="section-sub">Avg Drop % (recent)</p>
          <p className="metric" style={{ fontSize: "1.2rem" }}>{avgDropPct.toFixed(2)}%</p>
        </article>
      </div>

      {loading ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span>Loading dashboard insights...</span>
        </div>
      ) : insights.length === 0 ? (
        <div className="notice">No products yet. Add a product to generate recommendations.</div>
      ) : (
        <div className="stack">
          {recentlyUpdated.length ? (
            <div className="card">
              <p className="section-sub">Recently updated</p>
              <div className="row" style={{ marginTop: 8 }}>
                {recentlyUpdated.map((product) => (
                  <span key={product.id} className="badge badge-warn">
                    {product.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {insights.map(({ product, latest, points, gap, recommendation }) => (
            <article className="card" key={product.id}>
              <div className="row">
                <h3>{product.name}</h3>
                <span className={`badge ${recommendation.tone}`}>{recommendation.label}</span>
              </div>
              <p className="section-sub">Trend: {product.trend || "-"} | Auto-updated via scheduler</p>
              <div className="row" style={{ marginTop: 10 }}>
                <span>Target: Rs. {product.target_price}</span>
                <span>Latest: {Number.isFinite(latest) ? `Rs. ${latest}` : "N/A"}</span>
                <span>Points: {points}</span>
                <span>Gap: {Number.isFinite(gap) ? (gap > 0 ? `+Rs. ${gap.toFixed(2)}` : `Rs. ${gap.toFixed(2)}`) : "N/A"}</span>
                <button className="button" type="button" disabled={deletingId === product.id} onClick={() => handleDelete(product.id)}>
                  {deletingId === product.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default Dashboard
