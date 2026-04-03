function getTone(label) {
  const normalized = String(label || "").toUpperCase()
  if (normalized.includes("BUY")) return "badge-good"
  if (normalized.includes("GOOD")) return "badge-good"
  if (normalized.includes("HOLD") || normalized.includes("WAIT")) return "badge-danger"
  return "badge-warn"
}

function RecommendationBadge({ label }) {
  if (!label) return null
  return <span className={`badge ${getTone(label)}`}>{label}</span>
}

export default RecommendationBadge
