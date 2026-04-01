function SearchHistory({ items, onSelect, onClear }) {
  if (!items.length) return null

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="section-sub">Recent searches</p>
        <button className="button button-secondary button-small" type="button" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="row">
        {items.map((item) => (
          <button key={item} className="search-chip" type="button" onClick={() => onSelect(item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  )
}

export default SearchHistory
