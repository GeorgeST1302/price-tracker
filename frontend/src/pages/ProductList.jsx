import { useEffect, useMemo, useState } from "react"

import { apiJson, apiRequest } from "../lib/apiBaseUrl"

function getRelativeTimeLabel(isoDate) {
  const ms = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(ms / 60000)

  if (!Number.isFinite(minutes) || minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function ProductList() {
  const [products, setProducts] = useState([])
  const [searchInput, setSearchInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState("newest")
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 280)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        if (searchTerm) {
          params.set("q", searchTerm)
        }

        const path = params.toString() ? `/products?${params.toString()}` : "/products"
        const data = await apiJson(path)
        if (cancelled) return

        if (!Array.isArray(data)) {
          setProducts([])
          setError("Unexpected API response format")
          return
        }

        setProducts(data)
      } catch (err) {
        if (cancelled) return
        setProducts([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProducts()

    return () => {
      cancelled = true
    }
  }, [searchTerm])

  const sortedProducts = useMemo(() => {
    const cloned = [...products]

    if (sortBy === "name_asc") {
      cloned.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      return cloned
    }

    if (sortBy === "target_asc") {
      cloned.sort((a, b) => Number(a.target_price) - Number(b.target_price))
      return cloned
    }

    if (sortBy === "target_desc") {
      cloned.sort((a, b) => Number(b.target_price) - Number(a.target_price))
      return cloned
    }

    cloned.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return cloned
  }, [products, sortBy])

  async function handleDelete(productId) {
    setError(null)
    setDeletingId(productId)

    try {
      await apiRequest(`/products/${productId}`, { method: "DELETE" })

      const params = new URLSearchParams()
      if (searchTerm) {
        params.set("q", searchTerm)
      }

      const path = params.toString() ? `/products?${params.toString()}` : "/products"
      const data = await apiJson(path)
      setProducts(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Tracked Products</h2>
          <p className="section-sub">All products monitored by PricePulse (prices update automatically on a schedule).</p>
        </div>
      </div>

      <div className="card row">
        <input
          className="input"
          placeholder="Search by product name"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />

        <select className="select" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="newest">Sort: Newest</option>
          <option value="name_asc">Sort: Name A-Z</option>
          <option value="target_asc">Sort: Target Price Low-High</option>
          <option value="target_desc">Sort: Target Price High-Low</option>
        </select>

        {searchInput ? (
          <button className="button" type="button" onClick={() => setSearchInput("")}>
            Clear
          </button>
        ) : null}
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {loading ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span>{searchTerm ? "Searching products..." : "Loading products..."}</span>
        </div>
      ) : sortedProducts.length === 0 ? (
        <div className="notice">
          {searchTerm ? `No products match "${searchTerm}".` : "No products yet. Add one to start tracking prices."}
        </div>
      ) : (
        <div className="stack">
          <p className="section-sub">Showing {sortedProducts.length} result(s)</p>
          {sortedProducts.map((product) => (
            <article className="card" key={product.id}>
              <div className="row">
                <h3>{product.name}</h3>
                <span className="badge badge-warn">Target Rs. {product.target_price}</span>
              </div>
              <p className="section-sub">Added: {new Date(product.created_at).toLocaleDateString()}</p>
              <p className="section-sub">Last updated: {product.last_updated ? getRelativeTimeLabel(product.last_updated) : "-"}</p>
              <div className="row" style={{ marginTop: 10 }}>
                <span className="section-sub">
                  Latest: {Number.isFinite(Number(product.latest_price)) ? `Rs. ${Number(product.latest_price)}` : "N/A"}
                </span>
                <span className={product.recommendation === "BUY" ? "badge badge-good" : product.recommendation === "HOLD" ? "badge badge-danger" : "badge badge-warn"}>
                  {product.recommendation || "-"}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={deletingId === product.id}
                  onClick={() => handleDelete(product.id)}
                >
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

export default ProductList
