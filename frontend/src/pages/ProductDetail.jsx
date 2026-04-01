import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import PriceChart from "../components/PriceChart"
import ProductCard from "../components/ProductCard"
import { apiJson } from "../lib/apiBaseUrl"
import { formatCurrency } from "../lib/formatters"

function rangeToQuery(range) {
  if (range === "7d") return "?days=7&limit=120"
  if (range === "30d") return "?days=30&limit=240"
  return "?limit=240"
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

  async function loadHistory(productId, nextRange = range) {
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
  }

  useEffect(() => {
    if (!selectedProductId) return
    void loadHistory(selectedProductId, range)
  }, [selectedProductId, range])

  async function refreshNow() {
    if (!selectedProductId) return

    setRefreshing(true)
    setError(null)

    try {
      await apiJson(`/products/${selectedProductId}/refresh`, { method: "POST" })
      const updatedProducts = await apiJson("/products")
      setProducts(Array.isArray(updatedProducts) ? updatedProducts : [])
      await loadHistory(selectedProductId, range)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === String(selectedProductId)),
    [products, selectedProductId]
  )

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

          <div className="row">
            <button className="button" type="button" disabled={!selectedProductId || refreshing} onClick={refreshNow}>
              {refreshing ? "Refreshing..." : "Refresh Price"}
            </button>
          </div>
        </div>
      )}

      {selectedProduct ? (
        <ProductCard
          product={selectedProduct}
          footer={
            <p className="section-sub">
              Latest snapshot: {formatCurrency(selectedProduct.latest_price)} | Last updated:{" "}
              {selectedProduct.last_updated ? new Date(selectedProduct.last_updated).toLocaleString() : "-"}
            </p>
          }
          actions={
            selectedProduct.purchase_url ? (
              <a className="button" href={selectedProduct.purchase_url} target="_blank" rel="noreferrer">
                Buy Now
              </a>
            ) : null
          }
        />
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
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.timestamp).toLocaleString()}</td>
                      <td>{formatCurrency(entry.price)}</td>
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
