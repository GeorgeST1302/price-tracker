import { useEffect, useRef, useState } from "react"

import { getFetchMode, isFetchToggleRevealed, setFetchMode, setFetchToggleRevealed, subscribeToFetchMode } from "../lib/fetchMode"

function SecretFetchModeToggle() {
  const [fetchMode, setFetchModeState] = useState(() => getFetchMode())
  const [revealed, setRevealed] = useState(() => isFetchToggleRevealed())
  const clickCountRef = useRef(0)
  const resetTimerRef = useRef(null)

  useEffect(() => {
    return subscribeToFetchMode(() => {
      setFetchModeState(getFetchMode())
      setRevealed(isFetchToggleRevealed())
    })
  }, [])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current)
    }
  }, [])

  function handleUnlockClick() {
    clickCountRef.current += 1

    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => {
      clickCountRef.current = 0
    }, 1300)

    if (clickCountRef.current < 5) return

    clickCountRef.current = 0
    const next = !revealed
    setFetchToggleRevealed(next)
    setRevealed(next)
  }

  const zyteOnly = fetchMode === "zyte-only"

  return (
    <div className="secret-toggle-shell">
      <button type="button" className="eyebrow eyebrow-button" onClick={handleUnlockClick}>
        Price monitoring & alerting
      </button>

      {revealed ? (
        <div className="secret-toggle-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong className="secret-toggle-title">Hidden fetch mode</strong>
            <button
              type="button"
              className="secret-toggle-close"
              onClick={() => {
                setFetchToggleRevealed(false)
                setRevealed(false)
              }}
              aria-label="Hide developer toggle"
            >
              x
            </button>
          </div>

          <p className="section-sub">Search still discovers products normally. Manual create and refresh requests from this browser can force Zyte only.</p>

          <div className="row">
            <button
              type="button"
              className={zyteOnly ? "button button-small" : "button button-secondary button-small"}
              onClick={() => {
                const nextMode = zyteOnly ? "auto" : "zyte-only"
                setFetchMode(nextMode)
                setFetchModeState(nextMode)
              }}
            >
              {zyteOnly ? "Zyte-only on" : "Zyte-only off"}
            </button>
            <span className="section-sub">{zyteOnly ? "Scraper is bypassed for your manual fetches." : "Auto mode uses scraper first, then Zyte fallback."}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SecretFetchModeToggle
