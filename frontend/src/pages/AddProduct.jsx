import { useEffect, useMemo, useState } from "react"
import { getApiBaseUrl } from "../lib/apiBaseUrl"

function AddProduct() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])

  const [productName, setProductName] = useState("")
  const [targetPrice, setTargetPrice] = useState("")
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [selectedPreview, setSelectedPreview] = useState(null)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null)

  useEffect(() => {
    const term = productName.trim()

    if (term.length < 2) {
      setSearchResults([])
      setSelectedPreview(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchLoading(true)

      try {
        const url = new URL(`${apiBaseUrl}/products/search`)
        url.searchParams.set("q", term)
        url.searchParams.set("limit", "6")

        const res = await fetch(url.toString())
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "")
          throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
        }

        const data = await res.json()
        if (cancelled) return

        const safe = Array.isArray(data) ? data : []
        setSearchResults(safe)

        if (selectedPreview) {
          const stillExists = safe.find((x) => x.asin === selectedPreview.asin)
          if (!stillExists) setSelectedPreview(null)
        }
      } catch (err) {
        if (cancelled) return
        console.error("[AddProduct] Live search failed:", err)
        setSearchResults([])
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [apiBaseUrl, productName, selectedPreview])

  async function handleSubmit(e) {
    e.preventDefault()
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

    const url = `${apiBaseUrl}/products`
    console.log("[AddProduct] POST:", url)

    try {
      setLoading(true)
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: trimmedProductName,
          target_price: parsedTarget,
          asin: selectedPreview?.asin || null,
        }),
      })

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`)
      }

      const data = await res.json()
      console.log("[AddProduct] Created:", data)
      setCreated(data)
      setProductName("")
      setTargetPrice("")
      setSearchResults([])
      setSelectedPreview(null)
    } catch (err) {
      console.error("[AddProduct] Create failed:", err)
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
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. logitech mouse"
            disabled={loading}
          />
        </label>

        {productName.trim().length >= 2 ? (
          <div className="stack">
            <p className="section-sub">Live search results</p>

            {searchLoading ? (
              <p className="section-sub">Searching live products...</p>
            ) : searchResults.length === 0 ? (
              <p className="section-sub">No live results yet. Try a more specific name.</p>
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
                        <p className="section-sub">Seller: {item.seller || "Marketplace seller"}</p>
                        <p className="live-price">{Number.isFinite(item.price) ? `Rs. ${item.price}` : "Price unavailable"}</p>
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
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="e.g. 1200"
            disabled={loading}
          />
        </label>

        <div className="row">
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Adding..." : "Start Tracking"}
          </button>
          <span className="section-sub">Select a live result to preview seller and current price before tracking.</span>
        </div>
      </form>

      {error ? <div className="notice notice-error">Error: {error}</div> : null}

      {created ? (
        <div className="notice notice-success">
          Added <b>{created.name}</b> | Target: Rs. {created.target_price}
        </div>
      ) : null}
    </section>
  )
}

export default AddProduct
