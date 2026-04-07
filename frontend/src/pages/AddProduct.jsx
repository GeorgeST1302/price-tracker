import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"

import SearchHistory from "../components/SearchHistory"
import { apiJson } from "../lib/apiBaseUrl"
import { formatCurrency } from "../lib/formatters"
import { clearRecentSearches, readRecentSearches, saveRecentSearch } from "../lib/recentSearches"

function getPreviewKey(item) {
  return `${item?.source_key || ""}:${item?.asin || item?.external_id || item?.product_url || item?.title || ""}`
}

function formatScore(value) {
  if (!Number.isFinite(Number(value))) return "N/A"
  return Number(value).toFixed(1)
}

function buildPriceBands(results) {
  const sorted = [...results].filter((item) => Number.isFinite(Number(item?.price)) && Number(item.price) > 0).sort((a, b) => Number(a.price) - Number(b.price))
  if (!sorted.length) return { budget: [], mid: [], premium: [] }

  const chunkSize = Math.max(1, Math.ceil(sorted.length / 3))
  return {
    budget: sorted.slice(0, chunkSize),
    mid: sorted.slice(chunkSize, chunkSize * 2),
    premium: sorted.slice(chunkSize * 2),
  }
}

function getRating(item) {
  const rating = Number(item?.rating)
  return Number.isFinite(rating) && rating > 0 ? rating : null
}

function buildValueScore(item, minPrice, maxPrice) {
  const price = Number(item?.price)
  if (!Number.isFinite(price) || price <= 0) return Number.POSITIVE_INFINITY
  const rating = getRating(item)
  const priceSpan = Math.max(1, (Number(maxPrice) || price) - (Number(minPrice) || 0))
  const normalizedPrice = (price - (Number(minPrice) || price)) / priceSpan
  const ratingBoost = rating ? Math.max(0, (rating - 3) / 2) * 0.35 : 0
  const availabilityBoost = String(item?.availability || "").toLowerCase().includes("stock") ? 0.1 : 0
  return normalizedPrice - ratingBoost - availabilityBoost
}

function summarizeIntent(query) {
  const text = String(query || "").toLowerCase()
  const budgetMatch = text.match(/(?:under|below|less than|max(?:imum)?|upto|up to)\s*[₹rs.\s]*([0-9][0-9,]*)/i)
  const budget = budgetMatch ? Number(String(budgetMatch[1]).replace(/,/g, "")) : null
  const cheapHint = /(cheap|budget|affordable|lowest|best deal)/i.test(text)
  return { budget, cheapHint }
}

const PRICE_RANGE_PRESETS = [
  { id: "all", label: "All prices", range: [0, Number.POSITIVE_INFINITY] },
  { id: "budget", label: "Rs. 0 - Rs. 1,000", range: [0, 1000] },
  { id: "everyday", label: "Rs. 1,000 - Rs. 3,000", range: [1000, 3000] },
  { id: "value", label: "Rs. 3,000 - Rs. 7,000", range: [3000, 7000] },
  { id: "premium", label: "Rs. 7,000 - Rs. 15,000", range: [7000, 15000] },
  { id: "high-end", label: "Rs. 15,000 - Rs. 30,000", range: [15000, 30000] },
]

function formatPriceRangeLabel(min, max) {
  const minLabel = Number(min).toLocaleString("en-IN")
  const maxLabel = Number(max).toLocaleString("en-IN")
  return `Rs. ${minLabel} - Rs. ${maxLabel}`
}

function AddProduct() {
  const [productName, setProductName] = useState("")
  const [productUrl, setProductUrl] = useState("")
  const [searchSource, setSearchSource] = useState("all")
  const [minRating, setMinRating] = useState("all")
  const [availability, setAvailability] = useState("all")
  const [selectedPriceRange, setSelectedPriceRange] = useState("all")
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState("")
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchError, setSearchError] = useState(null)
  const [selectedPreview, setSelectedPreview] = useState(null)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null)
  const [recentSearches, setRecentSearches] = useState([])

  const filteredSearchResults = useMemo(() => {
    const selectedPreset = PRICE_RANGE_PRESETS.find((preset) => preset.id === selectedPriceRange) || null
    const [selectedMin, selectedMax] = selectedPreset ? selectedPreset.range : [null, null]

    return searchResults.filter((item) => {
      if (searchSource !== "all") {
        const itemSource = String(item?.source_key || item?.source || "").toLowerCase()
        if (itemSource !== searchSource) return false
      }

      if (minRating !== "all") {
        const itemRating = getRating(item)
        if (itemRating == null || itemRating < Number(minRating)) return false
      }

      if (availability !== "all") {
        const itemAvailability = String(item?.availability || "").toLowerCase()
        if (!itemAvailability.includes(availability)) return false
      }

      if (selectedPreset && selectedPriceRange !== "all") {
        const price = Number(item?.price)
        if (!Number.isFinite(price)) return false
        if (price < selectedMin) return false
        if (Number.isFinite(selectedMax) && price > selectedMax) return false
      }

      return true
    })
  }, [availability, minRating, searchResults, searchSource, selectedPriceRange])

  const selectedPreset = useMemo(() => {
    return PRICE_RANGE_PRESETS.find((preset) => preset.id === selectedPriceRange) || null
  }, [selectedPriceRange])

  const searchMeta = useMemo(() => {
    const parsed = summarizeIntent(productName)
    const priced = filteredSearchResults.filter((item) => Number.isFinite(Number(item?.price)) && Number(item.price) > 0)
    const sorted = [...priced].sort((a, b) => Number(a.price) - Number(b.price))
    const bands = buildPriceBands(priced)
    const minPrice = sorted.length ? Number(sorted[0].price) : null
    const maxPrice = sorted.length ? Number(sorted[sorted.length - 1].price) : null
    const bestValue = sorted.length
      ? [...sorted].sort((a, b) => buildValueScore(a, minPrice, maxPrice) - buildValueScore(b, minPrice, maxPrice))[0]
      : null

    return {
      budget: parsed.budget,
      cheapHint: parsed.cheapHint,
      cheapest: sorted[0] || null,
      bestValue,
      bands,
      minPrice,
      maxPrice,
      total: priced.length,
      visible: filteredSearchResults.length,
      priceRangeLabel: selectedPriceRange === "all" || !selectedPreset ? "Any price" : formatPriceRangeLabel(selectedPreset.range[0], selectedPreset.range[1]),
    }
  }, [filteredSearchResults, productName, selectedPreset])

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
        if (searchSource !== "all") params.set("source", searchSource)
        if (minRating !== "all") params.set("min_rating", minRating)
        if (availability !== "all") params.set("availability", availability)
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
  }, [availability, minRating, productName, searchSource, selectedPreview])

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setCreated(null)

    const trimmedProductName = productName.trim()
    const trimmedProductUrl = productUrl.trim()
    const currentPreset = PRICE_RANGE_PRESETS.find((preset) => preset.id === selectedPriceRange) || PRICE_RANGE_PRESETS[0]
    const [parsedMin, parsedMax] = currentPreset.range
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
      setSelectedPriceRange("all")
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
          <span>Search for a product</span>
          <input
            id="product-name-input"
            className="input"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
            placeholder="Type what you would normally search for, like wireless mouse or Samsung phone"
            disabled={loading}
          />
          <span className="section-sub">Search by brand, model, or a plain description. You do not need an exact title.</span>
        </label>

        <label className="stack" htmlFor="product-url-input">
          <span>Product link or product page URL, optional</span>
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

        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3>Visible filters</h3>
              <p className="section-sub">These stay on the page so you can compare results the way a normal shopper would.</p>
            </div>
            <span className="kbd">{searchMeta.visible} shown</span>
          </div>

          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="stack" htmlFor="search-source-filter" style={{ minWidth: "180px", flex: 1 }}>
              <span>Source</span>
              <select
                id="search-source-filter"
                className="input"
                value={searchSource}
                onChange={(event) => setSearchSource(event.target.value)}
                disabled={loading || searchLoading}
              >
                <option value="all">All sources</option>
                <option value="amazon">Amazon</option>
                <option value="flipkart">Flipkart</option>
                <option value="reliance">Reliance Digital</option>
                <option value="snapdeal">Snapdeal</option>
              </select>
            </label>

            <label className="stack" htmlFor="min-rating-filter" style={{ minWidth: "180px", flex: 1 }}>
              <span>Minimum rating</span>
              <select
                id="min-rating-filter"
                className="input"
                value={minRating}
                onChange={(event) => setMinRating(event.target.value)}
                disabled={loading || searchLoading}
              >
                <option value="all">Any rating</option>
                <option value="4">4.0+</option>
                <option value="4.2">4.2+</option>
                <option value="4.5">4.5+</option>
              </select>
            </label>

            <label className="stack" htmlFor="availability-filter" style={{ minWidth: "180px", flex: 1 }}>
              <span>Availability</span>
              <select
                id="availability-filter"
                className="input"
                value={availability}
                onChange={(event) => setAvailability(event.target.value)}
                disabled={loading || searchLoading}
              >
                <option value="all">Any status</option>
                <option value="in stock">In stock</option>
                <option value="available">Available</option>
                <option value="preorder">Pre-order</option>
                <option value="out of stock">Out of stock</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card stack">
          <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {PRICE_RANGE_PRESETS.map((preset) => {
              const isSelected = selectedPriceRange === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={isSelected ? "button" : "button button-secondary"}
                  onClick={() => setSelectedPriceRange(preset.id)}
                  disabled={loading}
                  style={{ textAlign: "left", minHeight: 96 }}
                >
                  <strong>{preset.label}</strong>
                </button>
              )
            })}
          </div>
        </div>

        {productName.trim().length >= 2 ? (
          <div className="card stack" style={{ background: "linear-gradient(180deg, rgba(57,131,255,0.08), rgba(57,131,255,0.02))" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3>Live shopping summary</h3>
                <p className="section-sub">Results are grouped by price so you can compare like a normal person shopping online.</p>
              </div>
              {searchMeta.budget ? <span className="badge badge-warn">Intent: under Rs. {searchMeta.budget.toLocaleString("en-IN")}</span> : null}
            </div>

            <div className="grid-cards">
              <article className="card">
                <p className="section-sub">Cheapest live option</p>
                <strong>{searchMeta.cheapest ? searchMeta.cheapest.title : "N/A"}</strong>
                <p className="section-sub">{searchMeta.cheapest ? `${formatCurrency(searchMeta.cheapest.price, searchMeta.cheapest.source_key)} · ${searchMeta.cheapest.source || searchMeta.cheapest.source_key}` : "No live result yet."}</p>
              </article>
              <article className="card">
                <p className="section-sub">Best value pick</p>
                <strong>{searchMeta.bestValue ? searchMeta.bestValue.title : "N/A"}</strong>
                <p className="section-sub">{searchMeta.bestValue ? `${formatCurrency(searchMeta.bestValue.price, searchMeta.bestValue.source_key)} · score ${formatScore(buildValueScore(searchMeta.bestValue, searchMeta.minPrice, searchMeta.maxPrice))}` : "No live result yet."}</p>
              </article>
              <article className="card">
                <p className="section-sub">Live results</p>
                <strong>{searchMeta.visible}</strong>
                <p className="section-sub">{searchMeta.total} live matches before filters.</p>
              </article>
            </div>

            <div className="row" style={{ flexWrap: "wrap" }}>
              {created ? (
                <Link className="button button-secondary" to="/alerts">
                  Create Telegram alert
                </Link>
              ) : null}
              <span className="kbd">Telegram alerts fire when your target range is hit.</span>
            </div>
          </div>
        ) : null}

        {productName.trim().length >= 2 ? (
          <div className="stack">
            <p className="section-sub">Live results from shopping sites. Pick the one that looks closest to what you want.</p>

            {searchLoading ? (
              <div className="row">
                <span className="spinner" aria-label="Loading" />
                <span className="section-sub">Searching comparison sources...</span>
              </div>
            ) : searchError ? (
              <div className="notice notice-error">Error: {searchError}</div>
            ) : filteredSearchResults.length === 0 ? (
              <div className="notice">No live results yet. Try a more specific product name.</div>
            ) : (
              <div className="table-wrap">
                <table className="table compare-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Picture</th>
                      <th>Product</th>
                      <th>Price</th>
                      <th>Rating</th>
                      <th>Availability</th>
                      <th>Track</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSearchResults.map((item) => {
                      const key = getPreviewKey(item)
                      const isSelected = selectedPreview ? getPreviewKey(selectedPreview) === key : false
                      return (
                        <tr key={key} className={isSelected ? "row-selected" : ""}>
                          <td>{item.source || item.seller || item.source_key || "Marketplace"}</td>
                          <td>
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={item.title}
                                loading="lazy"
                                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 12, display: "block" }}
                              />
                            ) : (
                              <span className="section-sub">No image</span>
                            )}
                          </td>
                          <td>
                            {item.product_url ? (
                              <a href={item.product_url} target="_blank" rel="noreferrer">
                                {item.title}
                              </a>
                            ) : (
                              item.title
                            )}
                            {item.feature_summary ? <p className="section-sub">{item.feature_summary}</p> : null}
                          </td>
                          <td>{formatCurrency(item.price, item.source_key)}</td>
                          <td>{getRating(item) != null ? `${getRating(item).toFixed(1)}/5` : "-"}</td>
                          <td>{item.availability || "-"}</td>
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

            {filteredSearchResults.length ? (
              <div className="grid-cards">
                <article className="card">
                  <p className="section-sub">Cheaper options</p>
                  {buildPriceBands(filteredSearchResults).budget.map((item) => (
                    <p key={getPreviewKey(item)}>{item.title} · {formatCurrency(item.price, item.source_key)}</p>
                  ))}
                </article>
                <article className="card">
                  <p className="section-sub">Middle options</p>
                  {buildPriceBands(filteredSearchResults).mid.map((item) => (
                    <p key={getPreviewKey(item)}>{item.title} · {formatCurrency(item.price, item.source_key)}</p>
                  ))}
                </article>
                <article className="card">
                  <p className="section-sub">Higher-end options</p>
                  {buildPriceBands(filteredSearchResults).premium.map((item) => (
                    <p key={getPreviewKey(item)}>{item.title} · {formatCurrency(item.price, item.source_key)}</p>
                  ))}
                </article>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="section-sub">Type at least 2 characters to load comparison results.</p>
        )}

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
          Added <b>{created.name}</b>. Current price: {formatCurrency(created.latest_price, created.source_key)}. Target: {" "}
          {formatCurrency(created.target_price_min)} - {formatCurrency(created.target_price_max)}.
        </div>
      ) : null}
    </section>
  )
}

export default AddProduct
