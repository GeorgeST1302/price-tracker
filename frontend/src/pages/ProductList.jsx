import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import ProductCard from "../components/ProductCard"
import { apiJson, apiRequest } from "../lib/apiBaseUrl"

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
      setProducts((current) => current.filter((product) => Number(product.id) !== Number(productId)))
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

export default ProductList
