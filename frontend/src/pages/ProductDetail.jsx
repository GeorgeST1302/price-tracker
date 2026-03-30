import { useEffect, useMemo, useRef, useState } from "react"
import { getApiBaseUrl } from "../lib/apiBaseUrl"
import Chart from "chart.js/auto"

function ProductDetail() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [products, setProducts] = useState([])
  const [selectedProductId, setSelectedProductId] = useState("")
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const chartRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${apiBaseUrl}/products`)
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "")
          throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
        }

        const data = await res.json()
        if (cancelled) return
        setProducts(Array.isArray(data) ? data : [])
      } catch (err) {
        if (cancelled) return
        console.error("[ProductDetail] Products fetch failed:", err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadProducts()
    return () => {
      cancelled = true
    }
  }, [apiBaseUrl])

  async function loadHistory(productId) {
    setError(null)
    try {
      const res = await fetch(`${apiBaseUrl}/products/${productId}/history?limit=60`)
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }
      const data = await res.json()
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("[ProductDetail] History fetch failed:", err)
      setError(err instanceof Error ? err.message : String(err))
      setHistory([])
    }
  }

  useEffect(() => {
    // Rebuild chart when history changes.
    if (!canvasRef.current) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    if (!history || history.length < 2) return

    const points = [...history].reverse()
    const labels = points.map((h) => {
      const d = new Date(h.timestamp)
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
    })
    const prices = points.map((h) => Number(h.price))

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Price (₹)",
            data: prices,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: false },
        },
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [history])

  async function refreshNow() {
    if (!selectedProductId) return
    setRefreshing(true)
    setError(null)

    try {
      const res = await fetch(`${apiBaseUrl}/products/${selectedProductId}/refresh`, { method: "POST" })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }
      await loadHistory(selectedProductId)
    } catch (err) {
      console.error("[ProductDetail] Refresh failed:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === String(selectedProductId))
  const latestPrice = history[0]?.price
  const isDropped =
    selectedProduct && Number.isFinite(Number(latestPrice)) && Number(latestPrice) <= Number(selectedProduct.target_price)

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Product Detail</h2>
          <p className="section-sub">Inspect one product deeply and trigger instant refresh.</p>
        </div>
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {loading ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span>Loading products...</span>
        </div>
      ) : products.length === 0 ? (
        <div className="notice">No products yet. Add one to start tracking prices.</div>
      ) : (
        <div className="card stack">
          <label className="stack" htmlFor="detail-select">
            <span>Select product</span>
            <select
              id="detail-select"
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

          <button className="button" type="button" disabled={!selectedProductId || refreshing} onClick={refreshNow}>
            {refreshing ? "Refreshing..." : "Refresh Price"}
          </button>
        </div>
      )}

      {selectedProduct ? (
        <div className="card stack">
          <h3>{selectedProduct.name}</h3>
          <div className="row">
            <span>Target: ₹{selectedProduct.target_price}</span>
            <span>Latest: {Number.isFinite(Number(latestPrice)) ? `₹${latestPrice}` : "N/A"}</span>
            {isDropped ? <span className="badge badge-good">Price dropped!</span> : null}
          </div>
          <p className="section-sub">Last updated: {selectedProduct.last_updated ? new Date(selectedProduct.last_updated).toLocaleString() : "-"}</p>
          <p className="section-sub">Recommendation: {selectedProduct.recommendation || "-"} | Trend: {selectedProduct.trend || "-"}</p>
        </div>
      ) : null}

      {selectedProductId ? (
        history.length === 0 ? (
          <div className="notice">No price history yet.</div>
        ) : (
          <div className="stack">
            <div className="card stack">
              <h3>Price Trend</h3>
              <div style={{ height: 260 }}>
                <canvas ref={canvasRef} />
              </div>
              <p className="section-sub">Chart updates instantly after a refresh.</p>
            </div>

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
          </div>
        )
      ) : null}
    </section>
  )
}

export default ProductDetail