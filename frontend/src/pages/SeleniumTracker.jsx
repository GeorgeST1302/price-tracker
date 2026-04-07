import { useEffect, useMemo, useState } from "react"

import { trackUrls, getTrackerApiBaseUrl, setTrackerApiBaseUrl } from "../lib/seleniumTrackerApi"

function SeleniumTracker() {
  const [urlsText, setUrlsText] = useState("")
  const [headless, setHeadless] = useState(true)
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getTrackerApiBaseUrl())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState([])

  const urls = useMemo(
    () => urlsText.split(/\n+/).map((line) => line.trim()).filter(Boolean),
    [urlsText],
  )
  const trackerApiBaseUrl = getTrackerApiBaseUrl()
  const needsPublicApi = typeof window !== "undefined" && window.location.hostname !== "localhost" && !trackerApiBaseUrl

  function handleApiBaseChange(event) {
    const value = event.target.value
    setApiBaseUrl(value)
    setTrackerApiBaseUrl(value)
  }

  async function handleTrack() {
    if (!urls.length) {
      setError("Add at least one product URL.")
      return
    }

    setError(null)
    setLoading(true)
    try {
      const payload = await trackUrls(urls, { headless })
      setResults(Array.isArray(payload?.results) ? payload.results : [])
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : String(exception))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (urls.length) {
        handleTrack().catch(() => null)
      }
    }, 30000)

    return () => window.clearInterval(timer)
  }, [urls.length, headless])

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h2>Live Selenium Tracker</h2>
          <p className="section-sub">Track Amazon India, Flipkart, and Reliance Digital URLs in real time using Brave + Selenium.</p>
        </div>
        <span className="kbd">API: {trackerApiBaseUrl}</span>
      </div>

      {needsPublicApi ? (
        <div className="notice notice-warn">
          This page is open on a public site, but the tracker API is still set to localhost. Cloudflare Pages cannot reach localhost.
          Set <b>VITE_SELENIUM_TRACKER_API_BASE_URL</b> to a public Python API URL before expecting live results on Cloudflare.
          See <b>selenium_tracker/DEPLOY.md</b> for the Docker and deployment steps.
        </div>
      ) : null}

      <div className="card stack">
        <label className="stack">
          <span>Tracker API Base URL</span>
          <input
            className="input"
            value={apiBaseUrl}
            onChange={handleApiBaseChange}
            placeholder="https://your-public-selenium-api.example.com"
          />
        </label>

        <label className="stack">
          <span>Product URLs</span>
          <textarea
            className="input"
            rows={8}
            value={urlsText}
            onChange={(event) => setUrlsText(event.target.value)}
            placeholder={"Paste one URL per line\nhttps://www.amazon.in/dp/...\nhttps://www.flipkart.com/...\nhttps://www.reliancedigital.in/..."}
          />
        </label>

        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
          <span>Run browser headless</span>
        </label>

        <div className="row">
          <button className="button" type="button" onClick={handleTrack} disabled={loading}>
            {loading ? "Tracking..." : "Track now"}
          </button>
          <span className="section-sub">Refreshes automatically every 30 seconds when URLs are present.</span>
        </div>

        {error ? <div className="notice notice-error">{error}</div> : null}
        {!trackerApiBaseUrl ? <div className="notice notice-warn">Set a public API base URL above before running from Cloudflare Pages.</div> : null}
      </div>

      <div className="grid-cards">
        {results.length ? results.map((item) => (
          <article className="card" key={item.product_url}>
            <h3>{item.title}</h3>
            <p className="section-sub">Old Price: {item.old_price == null ? "N/A" : `₹${Number(item.old_price).toLocaleString("en-IN")}`}</p>
            <p className="section-sub">New Price: {item.new_price == null ? "N/A" : `₹${Number(item.new_price).toLocaleString("en-IN")}`}</p>
            <p className="section-sub">Availability: {item.availability || "Unknown"}</p>
            <p className={String(item.status).includes("DROPPED") ? "badge badge-good" : "badge badge-warn"}>{item.status}</p>
            <p className="section-sub">{item.product_url}</p>
          </article>
        )) : (
          <div className="notice">Paste URLs and click Track now to see live Selenium results here.</div>
        )}
      </div>
    </section>
  )
}

export default SeleniumTracker