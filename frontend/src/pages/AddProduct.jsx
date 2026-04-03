import { useEffect, useState } from "react"

import SearchHistory from "../components/SearchHistory"
import { apiJson } from "../lib/apiBaseUrl"
import { formatCurrency } from "../lib/formatters"
import { clearRecentSearches, readRecentSearches, saveRecentSearch } from "../lib/recentSearches"

function getPreviewKey(item) {
  return `${item?.source_key || ""}:${item?.asin || item?.external_id || item?.product_url || item?.title || ""}`
}

function AddProduct() {
  const [productName, setProductName] = useState("")
  const [productUrl, setProductUrl] = useState("")
  const [targetPriceMin, setTargetPriceMin] = useState("")
  const [targetPriceMax, setTargetPriceMax] = useState("")
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState("")
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
        const params = new URLSearchParams({ q: term, limit: "9" })
        const data = await apiJson(`/products/search?${params.toString()}`, { timeoutMs: 20000 })
        if (cancelled) return

        const safeResults = Array.isArray(data) ? data : []
        setSearchResults(safeResults)

        if (selectedPreview) {
          const selectedKey = getPreviewKey(selectedPreview)
          const stillExists = safeResults.find((item) => getPreviewKey(item) === selectedKey)
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
    const trimmedProductUrl = productUrl.trim()
    const parsedMin = Number(targetPriceMin)
    const parsedMax = Number(targetPriceMax)
    const trimmedInterval = refreshIntervalMinutes.trim()

    let parsedInterval = null
    if (trimmedInterval) {
      parsedInterval = Number(trimmedInterval)
      if (!Number.isFinite(parsedInterval) || parsedInterval <= 0 || !Number.isInteger(parsedInterval)) {
        setError("Check interval must be a whole number of minutes.")
        return
      }
      if (parsedInterval < 15 || parsedInterval > 20160) {
        setError("Check interval must be between 15 and 20160 minutes.")
        return
      }
    }

    const usingUrl = Boolean(trimmedProductUrl)

    if (!usingUrl) {
      if (!trimmedProductName) {
        setError("Enter a product name to search and track (or paste a product URL below).")
        return
      }

      if (trimmedProductName.length < 2) {
        setError("Use at least 2 characters so we can search for the correct product.")
        return
      }
    }

    if (!Number.isFinite(parsedMin) || parsedMin <= 0 || !Number.isFinite(parsedMax) || parsedMax <= 0) {
      setError("Target price range must be positive numbers.")
      return
    }

    if (parsedMin > parsedMax) {
      setError("Target min must be less than or equal to target max.")
      return
    }

    try {
      setLoading(true)
      let data

      if (usingUrl) {
        let normalizedUrl = trimmedProductUrl
        if (!/^https?:\/\//i.test(normalizedUrl)) {
          normalizedUrl = `https://${normalizedUrl}`
        }

        try {
          new URL(normalizedUrl)
        } catch {
          setError("Enter a valid product URL (include https://).")
          return
        }

        const payload = {
          url: normalizedUrl,
          target_price_min: parsedMin,
          target_price_max: parsedMax,
        }
        if (parsedInterval != null) payload.refresh_interval_minutes = parsedInterval

        data = await apiJson("/products/from-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } else {
        const payload = {
          product_name: trimmedProductName,
          target_price_min: parsedMin,
          target_price_max: parsedMax,
          asin: selectedPreview?.asin || null,
          source_key: selectedPreview?.source_key || null,
          external_id: selectedPreview?.external_id || null,
          product_url: selectedPreview?.product_url || null,
          image_url: selectedPreview?.image_url || null,
          source: selectedPreview?.source || null,
        }
        if (parsedInterval != null) payload.refresh_interval_minutes = parsedInterval

        data = await apiJson("/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      }

      setCreated(data)
      if (trimmedProductName) setRecentSearches(saveRecentSearch(trimmedProductName))
      setProductName("")
      setProductUrl("")
      setTargetPriceMin("")
      setTargetPriceMax("")
      setRefreshIntervalMinutes("")
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
          <p className="section-sub">Search, pick one listing, and start tracking your target range.</p>
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

        <label className="stack" htmlFor="product-url-input">
          <span>Product URL (optional)</span>
          <input
            id="product-url-input"
            className="input"
            value={productUrl}
            onChange={(event) => setProductUrl(event.target.value)}
            placeholder="https://www.amazon.in/dp/..."
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
            <p className="section-sub">Comparison results (click any product name to open source page)</p>

            {searchLoading ? (
              <div className="row">
                <span className="spinner" aria-label="Loading" />
                <span className="section-sub">Searching comparison sources...</span>
              </div>
            ) : searchError ? (
              <div className="notice notice-error">Error: {searchError}</div>
            ) : searchResults.length === 0 ? (
              <div className="notice">No live results yet. Try a more specific product name.</div>
            ) : (
              <div className="table-wrap">
                <table className="table compare-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Product</th>
                      <th>Price</th>
                      <th>Track</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((item) => {
                      const key = getPreviewKey(item)
                      const isSelected = selectedPreview ? getPreviewKey(selectedPreview) === key : false
                      return (
                        <tr key={key} className={isSelected ? "row-selected" : ""}>
                          <td>{item.source || item.seller || item.source_key || "Marketplace"}</td>
                          <td>
                            {item.product_url ? (
                              <a href={item.product_url} target="_blank" rel="noreferrer">
                                {item.title}
                              </a>
                            ) : (
                              item.title
                            )}
                          </td>
                          <td>{formatCurrency(item.price)}</td>
                          <td>
                            <button
                              type="button"
                              className={isSelected ? "button button-small" : "button button-secondary button-small"}
                              onClick={() => {
                                setSelectedPreview(item)
                                if (item.title) setProductName(item.title)
                              }}
                            >
                              {isSelected ? "Selected" : "Track this"}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="section-sub">Type at least 2 characters to load comparison results.</p>
        )}

        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="stack" htmlFor="target-min-input" style={{ flex: 1 }}>
            <span>Target min (Rs.)</span>
            <input
              id="target-min-input"
              className="input"
              value={targetPriceMin}
              onChange={(event) => setTargetPriceMin(event.target.value)}
              placeholder="e.g. 2000"
              disabled={loading}
            />
          </label>

          <label className="stack" htmlFor="target-max-input" style={{ flex: 1 }}>
            <span>Target max (Rs.)</span>
            <input
              id="target-max-input"
              className="input"
              value={targetPriceMax}
              onChange={(event) => setTargetPriceMax(event.target.value)}
              placeholder="e.g. 3000"
              disabled={loading}
            />
          </label>
        </div>

        <label className="stack" htmlFor="refresh-interval-input">
          <span>Check interval (minutes, optional)</span>
          <input
            id="refresh-interval-input"
            className="input"
            value={refreshIntervalMinutes}
            onChange={(event) => setRefreshIntervalMinutes(event.target.value)}
            placeholder="360"
            disabled={loading}
          />
        </label>

        <div className="row">
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Adding..." : "Start Tracking"}
          </button>
        </div>
      </form>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {created ? (
        <div className="notice notice-success">
          Added <b>{created.name}</b>. Current price: {formatCurrency(created.latest_price)}. Target:{" "}
          {formatCurrency(created.target_price_min)} - {formatCurrency(created.target_price_max)}.
        </div>
      ) : null}
    </section>
  )
}

export default AddProduct
