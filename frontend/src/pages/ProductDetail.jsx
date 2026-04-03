import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import PriceChart from "../components/PriceChart"
import ProductCard from "../components/ProductCard"
import { apiJson } from "../lib/apiBaseUrl"
import { formatCurrency } from "../lib/formatters"

function getPurchaseButtonLabel(recommendation) {
  return String(recommendation || "").toUpperCase() === "BUY NOW" ? "Buy Now" : "Open Listing"
}

function rangeToQuery(range) {
  if (range === "7d") return "?days=7&limit=120"
  if (range === "30d") return "?days=30&limit=200"
  return "?limit=200"
}

function ProductDetail() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [selectedProductId, setSelectedProductId] = useState("")
  const [history, setHistory] = useState([])
  const [range, setRange] = useState("30d")
  const [loading, setLoading] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savingTarget, setSavingTarget] = useState(false)
  const [targetMinInput, setTargetMinInput] = useState("")
  const [targetMaxInput, setTargetMaxInput] = useState("")
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoading(true)
      setError(null)

      try {
        const data = await apiJson("/products")
        if (cancelled) return
        const safe = Array.isArray(data) ? data : []
        setProducts(safe)

        const paramId = searchParams.get("product")
        if (paramId && safe.some((product) => String(product.id) === String(paramId))) {
          setSelectedProductId(String(paramId))
        }
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
  }, [searchParams])

  const loadHistory = useCallback(async (productId, nextRange) => {
    setLoadingHistory(true)
    setError(null)

    try {
      const data = await apiJson(`/products/${productId}/history${rangeToQuery(nextRange)}`)
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedProductId) return
    void loadHistory(selectedProductId, range)
  }, [loadHistory, selectedProductId, range])

  const runSilentSync = useCallback(async () => {
    if (!selectedProductId) return
    setRefreshing(true)
    try {
      await apiJson(`/products/${selectedProductId}/refresh`, { method: "POST", timeoutMs: 30000 })
      const updatedProducts = await apiJson("/products", { timeoutMs: 30000 })
      setProducts(Array.isArray(updatedProducts) ? updatedProducts : [])
      await loadHistory(selectedProductId, range)
    } catch {
      // silent sync should not interrupt user flow with noisy errors
    } finally {
      setRefreshing(false)
    }
  }, [selectedProductId, range, loadHistory])

  useEffect(() => {
    if (!selectedProductId) return undefined
    const timer = window.setInterval(() => {
      void runSilentSync()
    }, 60000)
    return () => window.clearInterval(timer)
  }, [selectedProductId, runSilentSync])

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === String(selectedProductId)),
    [products, selectedProductId]
  )

  useEffect(() => {
    if (!selectedProduct) return
    setTargetMinInput(selectedProduct.target_price_min != null ? String(selectedProduct.target_price_min) : "")
    setTargetMaxInput(selectedProduct.target_price_max != null ? String(selectedProduct.target_price_max) : "")
  }, [selectedProduct])

  async function saveTargetRange() {
    if (!selectedProductId) return
    setError(null)

    const parsedMin = Number(targetMinInput)
    const parsedMax = Number(targetMaxInput)
    if (!Number.isFinite(parsedMin) || parsedMin <= 0 || !Number.isFinite(parsedMax) || parsedMax <= 0) {
      setError("Target range must be positive numbers")
      return
    }
    if (parsedMin > parsedMax) {
      setError("Target min must be <= target max")
      return
    }

    setSavingTarget(true)
    try {
      await apiJson(`/products/${selectedProductId}/target`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_price_min: parsedMin, target_price_max: parsedMax }),
      })
      const updatedProducts = await apiJson("/products")
      setProducts(Array.isArray(updatedProducts) ? updatedProducts : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingTarget(false)
    }
  }

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Product detail</h2>
          <p className="section-sub">Inspect one product deeply, compare it with recent history, and refresh instantly when you want a new reading.</p>
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
              onChange={(event) => {
                const nextId = event.target.value
                setSelectedProductId(nextId)
                setHistory([])
                setSearchParams(nextId ? { product: nextId } : {})
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

          <p className="section-sub">{refreshing ? "Auto-syncing latest price..." : "Auto-sync runs in background every minute while this page is open."}</p>
        </div>
      )}

      {selectedProduct ? (
        <ProductCard
          product={selectedProduct}
          footer={
            <p className="section-sub">
              Latest snapshot: {formatCurrency(selectedProduct.latest_price)} | Last updated:{" "}
              {selectedProduct.last_updated ? new Date(selectedProduct.last_updated).toLocaleString() : "-"}
              {selectedProduct.historical_low != null ? ` | Low ever: ${formatCurrency(selectedProduct.historical_low)}` : ""}
            </p>
          }
          actions={
            <>
              {selectedProduct.purchase_url ? (
                <a className="button" href={selectedProduct.purchase_url} target="_blank" rel="noreferrer">
                  {getPurchaseButtonLabel(selectedProduct.recommendation)}
                </a>
              ) : null}
              <button className="button button-secondary" type="button" disabled={!selectedProductId || savingTarget} onClick={saveTargetRange}>
                {savingTarget ? "Saving..." : "Save Target Range"}
              </button>
            </>
          }
        />
      ) : null}

      {selectedProduct ? (
        <div className="card stack">
          <h3>Edit target range</h3>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="stack" style={{ flex: 1 }}>
              <span>Target min (Rs.)</span>
              <input className="input" value={targetMinInput} onChange={(e) => setTargetMinInput(e.target.value)} placeholder="e.g. 2000" />
            </label>
            <label className="stack" style={{ flex: 1 }}>
              <span>Target max (Rs.)</span>
              <input className="input" value={targetMaxInput} onChange={(e) => setTargetMaxInput(e.target.value)} placeholder="e.g. 3000" />
            </label>
          </div>
          <p className="section-sub">Current: {formatCurrency(selectedProduct.target_price_min)} - {formatCurrency(selectedProduct.target_price_max)}</p>
        </div>
      ) : null}

      {selectedProductId ? (
        loadingHistory ? (
          <div className="row">
            <span className="spinner" aria-label="Loading" />
            <span>Loading price history...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="notice">No price history yet. Refresh the product to create the next price point.</div>
        ) : (
          <div className="stack">
            <PriceChart history={history} range={range} onRangeChange={setRange} />

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Price</th>
                    <th>Fetch path</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.timestamp).toLocaleString()}</td>
                      <td>{formatCurrency(entry.price)}</td>
                      <td>{entry.fetch_method || "-"}</td>
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
