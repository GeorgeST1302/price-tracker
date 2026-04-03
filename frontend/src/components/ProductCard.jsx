import RecommendationBadge from "./RecommendationBadge"
import { formatCurrency, formatPercent } from "../lib/formatters"

function formatFetchMethod(value) {
  const normalized = String(value || "").trim()
  if (!normalized) return null

  const labels = {
    scraper: "Direct scraper",
    scraper_search_fallback: "Scraper search fallback",
    zyte: "Zyte",
    fallback: "Fallback data",
    seed: "Seed data",
    unknown: "Unknown fetch path",
  }

  return labels[normalized] || normalized.replaceAll("_", " ")
}

function ProductCard({ product, actions, footer }) {
  if (!product) return null

  const avg30 = Number(product.average_30d)
  const deltaPct = Number(product.delta_from_avg_pct)
  const targetMin = product.target_price_min != null ? Number(product.target_price_min) : null
  const targetMax = product.target_price_max != null ? Number(product.target_price_max) : null
  const refreshInterval = product.refresh_interval_minutes != null ? Number(product.refresh_interval_minutes) : null

  const targetLabel = (() => {
    if (Number.isFinite(targetMin) && Number.isFinite(targetMax) && targetMin !== targetMax) {
      return `${formatCurrency(targetMin)} - ${formatCurrency(targetMax)}`
    }
    if (Number.isFinite(targetMax)) return formatCurrency(targetMax)
    if (Number.isFinite(targetMin)) return formatCurrency(targetMin)
    return formatCurrency(product.target_price)
  })()

  return (
    <article className="product-card">
      <div className="product-media">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} loading="lazy" />
        ) : (
          <div className="product-media-fallback">{String(product.name || "P").slice(0, 1).toUpperCase()}</div>
        )}
      </div>

      <div className="product-body">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="stack" style={{ gap: 6 }}>
            <h3 className="product-title">{product.name}</h3>
            <p className="section-sub">{product.source || "Tracked source"}</p>
            {product.brand ? <p className="section-sub">Brand: {product.brand}</p> : null}
            {Number.isFinite(refreshInterval) ? <p className="section-sub">Checks every {refreshInterval} min</p> : null}
            {formatFetchMethod(product.last_fetch_method) ? (
              <p className="section-sub">Latest fetch: {formatFetchMethod(product.last_fetch_method)}</p>
            ) : null}
          </div>
          <RecommendationBadge label={product.recommendation} />
        </div>

        <div className="product-metrics">
          <div>
            <span className="metric-label">Current</span>
            <strong>{formatCurrency(product.latest_price)}</strong>
          </div>
          <div>
            <span className="metric-label">Target</span>
            <strong>{targetLabel}</strong>
          </div>
          <div>
            <span className="metric-label">30D avg</span>
            <strong>{formatCurrency(avg30)}</strong>
          </div>
          <div>
            <span className="metric-label">Vs avg</span>
            <strong>{Number.isFinite(deltaPct) ? formatPercent(deltaPct) : "N/A"}</strong>
          </div>
        </div>

        {product.recommendation_reason ? <p className="section-sub">{product.recommendation_reason}</p> : null}
        {product.prediction ? (
          <p className="section-sub">
            Prediction: <strong>{product.prediction}</strong> {product.prediction_confidence ? `(${product.prediction_confidence} confidence)` : ""}
          </p>
        ) : null}

        {actions ? <div className="row">{actions}</div> : null}
        {footer ? <div>{footer}</div> : null}
      </div>
    </article>
  )
}

export default ProductCard
