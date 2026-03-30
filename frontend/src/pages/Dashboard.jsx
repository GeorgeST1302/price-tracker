import { useCallback, useEffect, useMemo, useState } from "react"
import { getApiBaseUrl } from "../lib/apiBaseUrl"

function Dashboard() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [products, setProducts] = useState([])
  const [insights, setInsights] = useState([])
  const [deletingId, setDeletingId] = useState(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const productsRes = await fetch(`${apiBaseUrl}/products`)
      if (!productsRes.ok) {
        const bodyText = await productsRes.text().catch(() => "")
        throw new Error(`HTTP ${productsRes.status} ${productsRes.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }

      const productsData = await productsRes.json()
      const productsArray = Array.isArray(productsData) ? productsData : []

      const historyResults = await Promise.all(
        productsArray.map(async (p) => {
          try {
            const res = await fetch(`${apiBaseUrl}/products/${p.id}/history?limit=10`)
            if (!res.ok) return { productId: p.id, history: [] }
            const data = await res.json()
            return { productId: p.id, history: Array.isArray(data) ? data : [] }
          } catch {
            return { productId: p.id, history: [] }
          }
        })
      )

      setProducts(productsArray)

      const byProduct = new Map(historyResults.map((x) => [x.productId, x.history]))
      const nextInsights = productsArray.map((p) => {
        const history = byProduct.get(p.id) || []
        const latestFromHistory = history[0]?.price
        const oldestFromHistory = history[history.length - 1]?.price

        const latest = Number.isFinite(Number(p.latest_price)) ? Number(p.latest_price) : Number(latestFromHistory)
        const oldest = Number(oldestFromHistory)
        const dropPct =
          Number.isFinite(latest) && Number.isFinite(oldest) && oldest > 0 ? ((oldest - latest) / oldest) * 100 : null
        const gap = Number.isFinite(latest) ? latest - p.target_price : null

        const rec = p.recommendation || "-"
        const tone = rec === "BUY" ? "badge-good" : rec === "HOLD" ? "badge-danger" : "badge-warn"

        return {
          product: p,
          latest,
          points: history.length,
          gap,
          dropPct,
          recommendation: { label: rec, tone },
        }
      })

      setInsights(nextInsights)
    } catch (err) {
      console.error("[Dashboard] load failed:", err)
      setProducts([])
      setInsights([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    ;(async () => {
      await loadDashboard()
    })()
  }, [loadDashboard])

  async function handleDelete(productId) {
    setError(null)
    setDeletingId(productId)
    try {
      const res = await fetch(`${apiBaseUrl}/products/${productId}`, { method: "DELETE" })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }
      await loadDashboard()
    } catch (err) {
      console.error("[Dashboard] Delete failed:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  const trackedCount = products.length

  const belowTargetCount = insights.filter(
    (x) => Number.isFinite(Number(x.latest)) && Number.isFinite(Number(x.product.target_price)) && Number(x.latest) <= Number(x.product.target_price)
  ).length

  const avgDropPct = (() => {
    const drops = insights
      .map((x) => x.dropPct)
      .filter((x) => Number.isFinite(x) && x > 0)
    if (!drops.length) return 0
    return drops.reduce((sum, curr) => sum + curr, 0) / drops.length
  })()

  const recentlyUpdated = [...products]
    .filter((p) => p.last_updated)
    .sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())
    .slice(0, 5)

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Pricing Intelligence Dashboard</h2>
          <p className="section-sub">Recommendations are computed from the last 5–10 price points and refreshed automatically on a schedule.</p>
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
                {recentlyUpdated.map((p) => (
                  <span key={p.id} className="badge badge-warn">
                    {p.name}
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
                <span>Target: ₹{product.target_price}</span>
                <span>Latest: {Number.isFinite(latest) ? `₹${latest}` : "N/A"}</span>
                <span>Points: {points}</span>
                <span>
                  Gap: {Number.isFinite(gap) ? (gap > 0 ? `+₹${gap.toFixed(2)}` : `₹${gap.toFixed(2)}`) : "N/A"}
                </span>
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