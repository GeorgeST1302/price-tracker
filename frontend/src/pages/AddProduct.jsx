import { useEffect, useState } from "react"

import { apiJson } from "../lib/apiBaseUrl"
import { hasAvailablePrice } from "../lib/productState"

function AddProduct() {
  const [productName, setProductName] = useState("")
  const [targetPrice, setTargetPrice] = useState("")
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchError, setSearchError] = useState(null)
  const [selectedPreview, setSelectedPreview] = useState(null)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null)

  function applyHoldTarget() {
    const current = Number(selectedPreview?.price)
    if (!Number.isFinite(current) || current <= 0) return

    // HOLD recommendation generally appears when current price is within ~10% above target.
    const holdTarget = Math.max(1, Math.floor((current / 1.1) * 100) / 100)
    setTargetPrice(String(holdTarget))
  }

  useEffect(() => {
    const term = productName.trim()

    if (term.length < 2) {
      setSearchResults([])
      setSelectedPreview(null)
      setSearchLoading(false)
      setSearchError(null)
      return undefined
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)

      try {
        const params = new URLSearchParams({ q: term, limit: "9" })
        const data = await apiJson(`/products/search?${params.toString()}`, { timeoutMs: 15000 })
        if (cancelled) return

        const safeResults = Array.isArray(data) ? data : []
        setSearchResults(safeResults)

        if (selectedPreview) {
          const stillExists = safeResults.find((item) => item.asin === selectedPreview.asin)
          if (!stillExists) setSelectedPreview(null)
        }
      } catch (err) {
        if (cancelled) return
        setSearchResults([])
        setSearchError(err instanceof Error ? err.message : "Live product search is unavailable right now. Please try again in a moment.")
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [productName, selectedPreview])

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setCreated(null)

    const trimmedProductName = productName.trim()
    const parsedTarget = Number(targetPrice)

    if (!trimmedProductName) {
      setError("Enter a product name")
      return
    }

    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError("Target price must be a positive number")
      return
    }

    if (Number.isFinite(Number(selectedPreview?.price))) {
      const current = Number(selectedPreview.price)
      if (parsedTarget >= current) {
        setError(`Target price must be lower than the current price (current: Rs. ${current}).`)
        return
      }
    }

    try {
      setLoading(true)
      const data = await apiJson("/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: trimmedProductName,
          target_price: parsedTarget,
          asin: selectedPreview?.asin || null,
          preview_price: Number.isFinite(Number(selectedPreview?.price)) ? Number(selectedPreview.price) : null,
        }),
      })

      setCreated(data)
      setProductName("")
      setTargetPrice("")
      setSearchResults([])
      setSelectedPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Add Product</h2>
          <p className="section-sub">Track a new item by product name and set your optimal buy threshold.</p>
        </div>
      </div>

      <form className="card stack" onSubmit={handleSubmit}>
        <label className="stack" htmlFor="product-name-input">
          <span>Product name</span>
          <input
            id="product-name-input"
            className="input"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="e.g. logitech mouse"
            disabled={loading}
          />
        </label>

        {productName.trim().length >= 2 ? (
          <div className="stack">
            <p className="section-sub">Live search results</p>

            {searchLoading ? (
              <p className="section-sub">Searching live products...</p>
            ) : searchError ? (
              <div className="notice notice-error">Error: {searchError}</div>
            ) : searchResults.length === 0 ? (
              <p className="section-sub">Live search unavailable or no results. You can still track manually.</p>
            ) : (
              <div className="live-grid">
                {searchResults.map((item) => {
                  const active = selectedPreview?.asin === item.asin
                  return (
                    <button
                      type="button"
                      key={item.asin}
                      className={active ? "live-card live-card-active" : "live-card"}
                      onClick={() => {
                        setSelectedPreview(item)
                        setProductName(item.title)
                      }}
                    >
                      <img
                        src={item.image_url || "https://via.placeholder.com/120x120?text=No+Image"}
                        alt={item.title}
                        loading="lazy"
                      />
                      <div className="live-card-body">
                        <p className="live-title">{item.title}</p>
                        <p className="section-sub">{item.source || item.seller || "Marketplace"}</p>
                        <p className="live-price">{Number.isFinite(item.price) ? `Rs. ${item.price}` : "Price unavailable"}</p>
                        {item.product_url ? <p className="section-sub">Product detail page available</p> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        <label className="stack" htmlFor="target-input">
          <span>Target price</span>
          <input
            id="target-input"
            className="input"
            value={targetPrice}
            onChange={(event) => setTargetPrice(event.target.value)}
            placeholder="e.g. 1200"
            disabled={loading}
          />
        </label>

        {Number.isFinite(Number(selectedPreview?.price)) ? (
          <div className="row" style={{ alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <button className="button" type="button" onClick={applyHoldTarget} disabled={loading}>
              Use HOLD target
            </button>
            <span className="section-sub">
              Current: Rs. {Number(selectedPreview.price).toFixed(2)} | This fills a target likely to produce HOLD.
            </span>
          </div>
        ) : null}

        <div className="row">
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Adding..." : "Start Tracking"}
          </button>
          <span className="section-sub">Set a target below today's price to hunt for a deal.</span>
        </div>
      </form>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {created ? (
        <div className="notice notice-success">
          Added <b>{created.name}</b> | Target: Rs. {created.target_price}
          {!hasAvailablePrice(created) ? " | Price unavailable right now, tracking will continue in the background." : ""}
        </div>
      ) : null}
    </section>
  )
}

export default AddProduct
