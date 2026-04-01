import { useEffect, useState } from "react"

import SearchHistory from "../components/SearchHistory"
import { apiJson } from "../lib/apiBaseUrl"
import { formatCurrency } from "../lib/formatters"
import { clearRecentSearches, readRecentSearches, saveRecentSearch } from "../lib/recentSearches"

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
  const [recentSearches, setRecentSearches] = useState([])

  useEffect(() => {
    setRecentSearches(readRecentSearches())
  }, [])

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
        const params = new URLSearchParams({ q: term, limit: "6" })
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
      setError("Enter a product name to search and track.")
      return
    }

    if (trimmedProductName.length < 2) {
      setError("Use at least 2 characters so we can search for the correct product.")
      return
    }

    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError("Target price must be a positive number.")
      return
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
        }),
      })

      setCreated(data)
      setRecentSearches(saveRecentSearch(trimmedProductName))
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
          <h2>Add product</h2>
          <p className="section-sub">Search a product, compare the live preview, then lock in the price threshold that matters to you.</p>
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
            placeholder="e.g. Logitech M331 Silent Plus"
            disabled={loading}
          />
        </label>

        <SearchHistory
          items={recentSearches}
          onSelect={(value) => setProductName(value)}
          onClear={() => {
            clearRecentSearches()
            setRecentSearches([])
          }}
        />

        {productName.trim().length >= 2 ? (
          <div className="stack">
            <p className="section-sub">Live search results</p>

            {searchLoading ? (
              <div className="row">
                <span className="spinner" aria-label="Loading" />
                <span className="section-sub">Searching live products...</span>
              </div>
            ) : searchError ? (
              <div className="notice notice-error">Error: {searchError}</div>
            ) : searchResults.length === 0 ? (
              <div className="notice">No live results yet. Try a more specific product name.</div>
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
                        <p className="section-sub">{item.source || item.seller || "Marketplace listing"}</p>
                        <p className="live-price">{formatCurrency(item.price)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="notice">Start typing a product name to see live search previews from your source marketplace.</div>
        )}

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

        <div className="row">
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Adding..." : "Start Tracking"}
          </button>
          <span className="section-sub">Pick the live result that matches best to store richer details like image, source, and purchase link.</span>
        </div>
      </form>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {created ? (
        <div className="notice notice-success">
          Added <b>{created.name}</b>. Current price: {formatCurrency(created.latest_price)}. Target: {formatCurrency(created.target_price)}.
        </div>
      ) : null}
    </section>
  )
}

export default AddProduct
