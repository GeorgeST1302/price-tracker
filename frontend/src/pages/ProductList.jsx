import { useEffect, useMemo, useState } from "react"
import { getApiBaseUrl } from "../lib/apiBaseUrl"

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

  const apiBaseUrl = useMemo(() => {
    return getApiBaseUrl()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 280)

    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoading(true)
      setError(null)

      const url = new URL(`${apiBaseUrl}/products`)
      if (searchTerm) {
        url.searchParams.set("q", searchTerm)
      }

      console.log("[ProductList] Fetching:", url)

      try {
        const res = await fetch(url.toString())

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "")
          throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
        }

        const data = await res.json()
        console.log("[ProductList] Response:", data)

        if (cancelled) return

        if (!Array.isArray(data)) {
          console.error("[ProductList] Expected an array but got:", data)
          setProducts([])
          setError("Unexpected API response format")
          return
        }

        setProducts(data)
      } catch (err) {
        if (cancelled) return
        console.error("[ProductList] Fetch failed:", err)
        setProducts([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadProducts()

    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, searchTerm])

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

    // Default: newest by created_at.
    cloned.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return cloned
  }, [products, sortBy])

  async function handleDelete(productId) {
    setError(null)
    setDeletingId(productId)

    try {
      const res = await fetch(`${apiBaseUrl}/products/${productId}`, { method: "DELETE" })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }

      // Refresh list.
      const url = new URL(`${apiBaseUrl}/products`)
      if (searchTerm) url.searchParams.set("q", searchTerm)
      const next = await fetch(url.toString())
      if (!next.ok) {
        const bodyText = await next.text().catch(() => "")
        throw new Error(`HTTP ${next.status} ${next.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }
      const data = await next.json()
      setProducts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("[ProductList] Delete failed:", err)
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
          onChange={(e) => setSearchInput(e.target.value)}
        />

        <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="newest">Sort: Newest</option>
          <option value="name_asc">Sort: Name A-Z</option>
          <option value="target_asc">Sort: Target Price Low-High</option>
          <option value="target_desc">Sort: Target Price High-Low</option>
        </select>

        {searchInput ? (
          <button className="button" type="button" onClick={() => setSearchInput("")}>Clear</button>
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
          {sortedProducts.map((p) => (
            <article className="card" key={p.id}>
              <div className="row">
                <h3>{p.name}</h3>
                <span className="badge badge-warn">Target ₹{p.target_price}</span>
              </div>
              <p className="section-sub">
                Added: {new Date(p.created_at).toLocaleDateString()}
              </p>
              <p className="section-sub">
                Last updated: {p.last_updated ? getRelativeTimeLabel(p.last_updated) : "-"}
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <span className="section-sub">
                  Latest: {Number.isFinite(Number(p.latest_price)) ? `₹${Number(p.latest_price)}` : "N/A"}
                </span>
                <span className={p.recommendation === "BUY" ? "badge badge-good" : p.recommendation === "HOLD" ? "badge badge-danger" : "badge badge-warn"}>
                  {p.recommendation || "-"}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={deletingId === p.id}
                  onClick={() => handleDelete(p.id)}
                >
                  {deletingId === p.id ? "Deleting..." : "Delete"}
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