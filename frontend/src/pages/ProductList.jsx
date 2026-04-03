import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import ProductCard from "../components/ProductCard"
import { apiJson, apiRequest } from "../lib/apiBaseUrl"

function getPurchaseButtonLabel(recommendation) {
  return String(recommendation || "").toUpperCase() === "BUY NOW" ? "Buy Now" : "Open Listing"
}

function ProductList() {
  const [products, setProducts] = useState([])
  const [searchInput, setSearchInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState("newest")
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editMin, setEditMin] = useState("")
  const [editMax, setEditMax] = useState("")
  const [savingId, setSavingId] = useState(null)

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
        if (searchTerm) params.set("q", searchTerm)

        const path = params.toString() ? `/products?${params.toString()}` : "/products"
        const data = await apiJson(path)
        if (cancelled) return
        setProducts(Array.isArray(data) ? data : [])
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

    function targetCeiling(product) {
      if (product?.target_price_max != null) return Number(product.target_price_max)
      if (product?.target_price != null) return Number(product.target_price)
      if (product?.target_price_min != null) return Number(product.target_price_min)
      return Number.POSITIVE_INFINITY
    }

    if (sortBy === "name_asc") {
      cloned.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      return cloned
    }

    if (sortBy === "target_asc") {
      cloned.sort((a, b) => targetCeiling(a) - targetCeiling(b))
      return cloned
    }

    if (sortBy === "target_desc") {
      cloned.sort((a, b) => targetCeiling(b) - targetCeiling(a))
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
      setProducts((current) => current.filter((product) => Number(product.id) !== Number(productId)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  function beginEdit(product) {
    setEditingId(product.id)
    setEditMin(String(product.target_price_min ?? product.target_price ?? ""))
    setEditMax(String(product.target_price_max ?? product.target_price ?? ""))
  }

  async function saveTargetRange(productId) {
    const parsedMin = Number(editMin)
    const parsedMax = Number(editMax)

    if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax) || parsedMin <= 0 || parsedMax <= 0) {
      setError("Target range must contain positive numbers.")
      return
    }
    if (parsedMin > parsedMax) {
      setError("Target min must be less than or equal to target max.")
      return
    }

    setError(null)
    setSavingId(productId)
    try {
      const updated = await apiJson(`/products/${productId}/target`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_price_min: parsedMin,
          target_price_max: parsedMax,
        }),
      })
      setProducts((current) => current.map((item) => (Number(item.id) === Number(productId) ? updated : item)))
      setEditingId(null)
      setEditMin("")
      setEditMax("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Tracked products</h2>
          <p className="section-sub">Search, compare recommendations, and jump straight into purchase or deeper inspection.</p>
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
          <button className="button button-secondary" type="button" onClick={() => setSearchInput("")}>
            Clear
          </button>
        ) : null}
      </div>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {loading ? (
        <div className="row">
          <span className="spinner" aria-label="Loading" />
          <span>{searchTerm ? "Searching tracked products..." : "Loading products..."}</span>
        </div>
      ) : sortedProducts.length === 0 ? (
        <div className="notice">
          {searchTerm ? `No products match "${searchTerm}".` : "No products yet. Add one to start tracking prices."}
        </div>
      ) : (
        <div className="stack">
          <p className="section-sub">Showing {sortedProducts.length} result(s)</p>
          {sortedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              footer={<p className="section-sub">Added: {new Date(product.created_at).toLocaleString()}</p>}
              actions={
                <>
                  <Link className="button button-secondary" to={`/detail?product=${product.id}`}>
                    View Detail
                  </Link>
                  {product.purchase_url ? (
                    <a className="button" href={product.purchase_url} target="_blank" rel="noreferrer">
                      {getPurchaseButtonLabel(product.recommendation)}
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
                  {editingId === product.id ? (
                    <>
                      <input
                        className="input"
                        style={{ minWidth: 140 }}
                        value={editMin}
                        onChange={(event) => setEditMin(event.target.value)}
                        placeholder="Target min"
                      />
                      <input
                        className="input"
                        style={{ minWidth: 140 }}
                        value={editMax}
                        onChange={(event) => setEditMax(event.target.value)}
                        placeholder="Target max"
                      />
                      <button
                        className="button button-small"
                        type="button"
                        disabled={savingId === product.id}
                        onClick={() => saveTargetRange(product.id)}
                      >
                        {savingId === product.id ? "Saving..." : "Save range"}
                      </button>
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        onClick={() => {
                          setEditingId(null)
                          setEditMin("")
                          setEditMax("")
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="button button-secondary button-small" type="button" onClick={() => beginEdit(product)}>
                      Edit range
                    </button>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default ProductList
