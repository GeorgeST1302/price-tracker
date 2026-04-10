import { useEffect, useRef, useState } from "react"
import Chart from "chart.js/auto"

import { apiJson } from "../lib/apiBaseUrl"

function ProductDetail() {
  const [products, setProducts] = useState([])
  const [selectedProductId, setSelectedProductId] = useState("")
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
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
        const data = await apiJson("/products")
        if (cancelled) return
        setProducts(Array.isArray(data) ? data : [])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
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
      const data = await apiJson(`/products/${productId}/history?limit=60`)
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    if (!canvasRef.current) return undefined

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    if (!history || history.length < 2) return undefined

    const points = [...history].reverse()
    const labels = points.map((entry) => {
      const date = new Date(entry.timestamp)
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
    })
    const prices = points.map((entry) => Number(entry.price))

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Price (Rs.)",
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
      await apiJson(`/products/${selectedProductId}/refresh`, { method: "POST" })
      await loadHistory(selectedProductId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const selectedProduct = products.find((product) => String(product.id) === String(selectedProductId))
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

          <button className="button" type="button" disabled={!selectedProductId || refreshing} onClick={refreshNow}>
            {refreshing ? "Refreshing..." : "Refresh Price"}
          </button>
        </div>
      )}

      {selectedProduct ? (
        <div className="card stack">
          <h3>{selectedProduct.name}</h3>
          <div className="row">
            <span>Target: Rs. {selectedProduct.target_price}</span>
            <span>Latest: {Number.isFinite(Number(latestPrice)) ? `Rs. ${latestPrice}` : "N/A"}</span>
            {isDropped ? <span className="badge badge-good">Price dropped!</span> : null}
          </div>
          <p className="section-sub">Last updated: {selectedProduct.last_updated ? new Date(selectedProduct.last_updated).toLocaleString() : "-"}</p>
          <p className="section-sub">Recommendation: {selectedProduct.recommendation || "-"} | Trend: {selectedProduct.trend || "-"}</p>
        </div>
      ) : null}

      {selectedProductId ? (
        loadingHistory ? (
          <div className="row">
            <span className="spinner" aria-label="Loading" />
            <span>Loading price history...</span>
          </div>
        ) : history.length === 0 ? (
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
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.timestamp).toLocaleString()}</td>
                      <td>Rs. {entry.price}</td>
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
