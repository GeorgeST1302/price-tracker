import { useEffect, useMemo, useRef } from "react"
import Chart from "chart.js/auto"

import { formatCurrency } from "../lib/formatters"

const RANGE_OPTIONS = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
]

function buildStats(history) {
  const prices = history.map((entry) => Number(entry.price)).filter((value) => Number.isFinite(value))
  if (!prices.length) {
    return {
      current: null,
      min: null,
      max: null,
      average: null,
    }
  }

  return {
    current: prices[0],
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, value) => sum + value, 0) / prices.length,
  }
}

function PriceChart({ history, range, onRangeChange }) {
  const chartRef = useRef(null)
  const canvasRef = useRef(null)

  const points = useMemo(() => [...history].reverse(), [history])
  const stats = useMemo(() => buildStats(history), [history])

  useEffect(() => {
    if (!canvasRef.current) return undefined

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    if (!points.length) return undefined

    const labels = points.map((entry) => {
      const date = new Date(entry.timestamp)
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    })

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Tracked price",
            data: points.map((entry) => Number(entry.price)),
            tension: 0.28,
            borderWidth: 2,
            borderColor: "#0ea5e9",
            backgroundColor: "rgba(14, 165, 233, 0.18)",
            fill: true,
            pointRadius: points.length > 12 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: false },
        },
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [points])

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h3>Price history</h3>
          <p className="section-sub">Compare the current price against recent behavior before deciding to buy.</p>
        </div>
        <div className="row">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={range === option.value ? "button button-small" : "button button-secondary button-small"}
              type="button"
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="product-metrics">
        <div>
          <span className="metric-label">Current</span>
          <strong>{formatCurrency(stats.current)}</strong>
        </div>
        <div>
          <span className="metric-label">Average</span>
          <strong>{formatCurrency(stats.average)}</strong>
        </div>
        <div>
          <span className="metric-label">Low</span>
          <strong>{formatCurrency(stats.min)}</strong>
        </div>
        <div>
          <span className="metric-label">High</span>
          <strong>{formatCurrency(stats.max)}</strong>
        </div>
      </div>

      {points.length < 2 ? (
        <div className="notice">Add a few more price updates to unlock a meaningful trend chart.</div>
      ) : (
        <div style={{ height: 280 }}>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  )
}

export default PriceChart
