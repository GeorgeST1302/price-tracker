import RecommendationBadge from "./RecommendationBadge"
import { formatCurrency, formatPercent } from "../lib/formatters"

function ProductCard({ product, actions, footer }) {
  if (!product) return null

  const avg30 = Number(product.average_30d)
  const deltaPct = Number(product.delta_from_avg_pct)

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
            <strong>{formatCurrency(product.target_price)}</strong>
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
