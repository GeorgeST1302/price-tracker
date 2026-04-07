const ONE_DAY_MS = 24 * 60 * 60 * 1000

const DESKTOP_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Accept-Language": "en-IN,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

const MOBILE_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36",
  "Accept-Language": "en-IN,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

const SOURCE_LABELS = {
  amazon: "Amazon India",
  flipkart: "Flipkart",
  reliance_digital: "Reliance Digital",
  snapdeal: "Snapdeal",
  pricerunner: "PriceRunner",
  bing_shopping: "Bing Shopping",
  generic: "Website",
}

const ALLOWED_DOMAINS = {
  amazon: ["amazon.in", "www.amazon.in"],
  flipkart: ["flipkart.com", "www.flipkart.com"],
  reliance_digital: ["reliancedigital.in", "www.reliancedigital.in"],
  snapdeal: ["snapdeal.com", "www.snapdeal.com"],
  pricerunner: ["pricerunner.com", "www.pricerunner.com"],
  bing_shopping: ["bing.com", "www.bing.com"],
}

function normalizeSourceKey(value) {
  const normalized = String(value || "").trim().toLowerCase()
  const aliases = {
    amazon_india: "amazon",
    amazon: "amazon",
    reliance: "reliance_digital",
    reliance_digital: "reliance_digital",
    snapdeal: "snapdeal",
    flipkart: "flipkart",
    pricerunner: "pricerunner",
    bing_shopping: "bing_shopping",
    generic: "generic",
    url: "generic",
    website: "generic",
  }
  return aliases[normalized] || normalized || "generic"
}

function getSourceLabel(sourceKey) {
  return SOURCE_LABELS[normalizeSourceKey(sourceKey)] || "Marketplace"
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCharCode(code) : ""
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCharCode(code) : ""
    })
}

function stripTags(value) {
  const withoutTags = String(value || "").replace(/<[^>]*>/g, " ")
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim()
}

function cleanText(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim()
  return cleaned || null
}

function extractPriceValue(text) {
  if (!text) return null
  const cleaned = String(text)
    .replace(/,/g, "")
    .replace(/Rs\.?/gi, "")
    .replace(/INR/gi, "")
    .replace(/₹/g, "")
    .replace(/\s+/g, " ")
    .trim()

  const match = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function normalizeImageUrl(value) {
  if (!value) return null
  const imageUrl = String(value).trim()
  if (!imageUrl) return null
  if (imageUrl.startsWith("https:/") && !imageUrl.startsWith("https://")) {
    return `https://${imageUrl.slice("https:/".length).replace(/^\/+/, "")}`
  }
  if (imageUrl.startsWith("//")) return `https:${imageUrl}`
  return imageUrl
}

function normalizeProductUrl(sourceKey, value) {
  if (!value) return null
  let raw = String(value).trim()
  if (!raw) return null
  if (raw.startsWith("//")) raw = `https:${raw}`

  if (raw.startsWith("/")) {
    const normalized = normalizeSourceKey(sourceKey)
    if (normalized === "amazon") raw = `https://www.amazon.in${raw}`
    else if (normalized === "reliance_digital") raw = `https://www.reliancedigital.in${raw}`
    else if (normalized === "snapdeal") raw = `https://www.snapdeal.com${raw}`
    else if (normalized === "flipkart") raw = `https://www.flipkart.com${raw}`
    else if (normalized === "pricerunner") raw = `https://www.pricerunner.com${raw}`
    else return null
  }

  if (!/^https?:\/\//i.test(raw)) return null
  return raw
}

function isAllowedStoreUrl(sourceKey, url) {
  const normalizedUrl = normalizeProductUrl(sourceKey, url)
  if (!normalizedUrl) return false

  const allowed = ALLOWED_DOMAINS[normalizeSourceKey(sourceKey)]
  if (!allowed) return false

  try {
    const host = new URL(normalizedUrl).hostname.toLowerCase()
    return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error("Fetch timed out")), timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function requestWithRetries(url, options = {}, { timeoutMs = 15000, retries = 3 } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs)
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        await response.arrayBuffer().catch(() => null)
        await sleep(350 * attempt)
        continue
      }
      return response
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await sleep(350 * attempt)
      }
    }
  }

  throw lastError || new Error("Request failed")
}

function toProxyUrl(url) {
  const normalized = String(url || "").trim()
  if (!normalized) return null
  const stripped = normalized.replace(/^https?:\/\//i, "")
  return `https://r.jina.ai/http://${stripped}`
}

function extractFirstCurrencyValue(text) {
  const match = String(text || "").match(/(?:Rs\.?|₹|£|€|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i)
  if (!match) return null
  return extractPriceValue(match[1])
}

function parseProxyJsonText(text) {
  const raw = String(text || "")
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function parseAmazonProxySearchResults(text, limit = 3) {
  const rows = []
  const rawText = String(text || "")
  const regex = /\[!\[Image \d+: ([^\]]+)\]\([^\)]*\)\]\((https?:\/\/www\.amazon\.in\/[^)]+\/dp\/([A-Z0-9]{10})\/[^)]*)\)/g
  let match

  while ((match = regex.exec(rawText)) && rows.length < limit) {
    const title = cleanText(match[1])
    const productUrl = normalizeProductUrl("amazon", match[2])
    const asin = match[3]
    const window = rawText.slice(match.index, Math.min(rawText.length, match.index + 12000))
    const price = extractFirstCurrencyValue(window)
    const imageMatch = match[0].match(/\]\((https:\/\/m\.media-amazon\.com\/[^)]+)\)/i)
    const imageUrl = normalizeImageUrl(imageMatch ? imageMatch[1] : null)

    if (!title || !Number.isFinite(price)) continue
    if (imageUrl && /megamenu|nav|icon/i.test(imageUrl)) continue
    if (/megamenu|nav/i.test(title)) continue

    const row = normalizeSearchRow({
      source_key: "amazon",
      source: getSourceLabel("amazon"),
      asin,
      external_id: asin,
      title,
      price,
      image_url: imageUrl,
      product_url: productUrl,
      seller: "Amazon Marketplace",
    })

    if (row) rows.push(row)
  }

  return rows
}

function extractPriceRunnerExternalId(productUrl) {
  const match = String(productUrl || "").match(/\/pl\/([^/]+)/i)
  return match ? match[1] : null
}

function extractFlipkartExternalId(productUrl) {
  const match = String(productUrl || "").match(/\/p\/([^/?#]+)/i)
  return match ? match[1] : null
}

function parsePriceRunnerSearchResults(text, limit = 3) {
  const rawText = String(text || "")
  const rows = []
  const seen = new Set()
  const regex = /\[([^\]]+?)\]\((https:\/\/www\.pricerunner\.com\/pl\/[^)]+)\)/gi
  let match

  while ((match = regex.exec(rawText)) && rows.length < limit) {
    const anchorText = cleanText(match[1])
    const productUrl = normalizeProductUrl("pricerunner", match[2])
    if (!anchorText || !productUrl) continue

    const externalId = extractPriceRunnerExternalId(productUrl)
    const dedupeKey = externalId || productUrl
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const title = cleanText(anchorText.split("Add or remove from lists")[0] || anchorText)
    const price = extractFirstCurrencyValue(anchorText)
    if (!title || !Number.isFinite(price) || price <= 0) continue

    const storeMatch = anchorText.match(/\b([0-9]+\+?|Out of stock)\s+stores?\b/i)
    const seller = storeMatch ? `PriceRunner (${storeMatch[1]})` : "PriceRunner"

    const row = normalizeSearchRow({
      source_key: "pricerunner",
      source: getSourceLabel("pricerunner"),
      title,
      price,
      product_url: productUrl,
      seller,
      external_id: externalId,
    })
    if (row) rows.push(row)
  }

  return rows
}

async function searchPriceRunnerProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)

  try {
    const url = `https://www.pricerunner.com/search?q=${encodeURIComponent(q)}`
    const response = await requestWithRetries(url, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return []
    const text = await response.text()
    const parsed = parsePriceRunnerSearchResults(text, safeLimit)
    if (parsed.length) return parsed
  } catch {
    // Fall through to proxy fallback.
  }

  try {
    const proxyUrl = toProxyUrl(`https://www.pricerunner.com/search?q=${encodeURIComponent(q)}`)
    if (!proxyUrl) return []
    const response = await requestWithRetries(proxyUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
    })
    if (!response.ok) return []
    const text = await response.text()
    const parsed = parsePriceRunnerSearchResults(text, safeLimit)
    console.log("search proxy provider=pricerunner", JSON.stringify({ query: q, rows: parsed.length }))
    return parsed
  } catch {
    return []
  }
}

function extractAllowedStoreUrls(text) {
  const rawText = String(text || "")
  const seen = new Set()
  const urls = []

  const uddgRegex = /https?:\/\/duckduckgo\.com\/l\/\?uddg=([^&\s)]+)/gi
  let match
  while ((match = uddgRegex.exec(rawText))) {
    const decoded = decodeURIComponent(match[1] || "")
    if (!decoded) continue
    const source = inferSourceFromUrl(decoded)
    const sourceKey = normalizeSourceKey(source.source_key)
    if (!["amazon", "flipkart", "reliance_digital", "snapdeal"].includes(sourceKey)) continue
    const dedupeKey = `${sourceKey}::${decoded}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    urls.push({ url: decoded, sourceKey })
  }

  const directRegex = new RegExp("https?:\\/\\/(?:www\\.)?(amazon\\.in|flipkart\\.com|reliancedigital\\.in|snapdeal\\.com)\\/[^\\s<>)\"]+", "gi")
  while ((match = directRegex.exec(rawText))) {
    const decoded = match[0]
    const source = inferSourceFromUrl(decoded)
    const sourceKey = normalizeSourceKey(source.source_key)
    if (!["amazon", "flipkart", "reliance_digital", "snapdeal"].includes(sourceKey)) continue
    const dedupeKey = `${sourceKey}::${decoded}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    urls.push({ url: decoded, sourceKey })
  }

  return urls
}

async function fetchSearchCandidate(url, sourceKey) {
  const normalizedSourceKey = normalizeSourceKey(sourceKey)
  if (normalizedSourceKey === "amazon") return fetchAmazonProduct({ productUrl: url })
  if (normalizedSourceKey === "flipkart") return fetchFlipkartProduct({ productUrl: url })
  if (normalizedSourceKey === "reliance_digital") return fetchRelianceProduct({ productUrl: url })
  if (normalizedSourceKey === "snapdeal") return fetchSnapdealProduct({ productUrl: url })
  return null
}

async function enrichSearchRows(rows, limit = 3) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : []
  const cappedRows = safeRows.slice(0, Math.max(1, Number(limit) || 3))
  const settled = await Promise.allSettled(
    cappedRows.map((row) =>
      Promise.race([
        fetchSearchCandidate(row.product_url || row.purchase_url || null, row.source_key),
        sleep(2500).then(() => null),
      ]),
    ),
  )
  return cappedRows.map((row, index) => {
    const fetched = settled[index]?.status === "fulfilled" ? settled[index].value : null
    if (!fetched) return row
    return {
      ...row,
      rating: fetched.rating ?? row.rating ?? null,
      availability: fetched.availability ?? row.availability ?? null,
      feature_summary: fetched.feature_summary ?? row.feature_summary ?? null,
      image_url: fetched.image_url ?? row.image_url ?? null,
      brand: fetched.brand ?? row.brand ?? null,
      title: fetched.title || row.title,
      price: Number.isFinite(Number(fetched.price)) ? round2(fetched.price) : row.price,
    }
  })
}

function normalizeSearchAvailability(value) {
  const text = String(value || "").trim().toLowerCase()
  if (!text) return null
  if (text.includes("out of stock") || text.includes("currently unavailable") || text.includes("sold out")) return "out_of_stock"
  if (text.includes("in stock") || text.includes("available") || text.includes("delivery")) return "in_stock"
  return text
}

function tokenizeSearchQuery(query) {
  return Array.from(
    new Set(
      String(query || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length > 1),
    ),
  )
}

function buildSearchQueryVariants(searchTerm) {
  const normalized = cleanText(searchTerm) || ""
  if (!normalized) return []

  const tokens = tokenizeSearchQuery(normalized)
  const stopwords = new Set(["for", "with", "the", "and", "or", "new", "best", "buy", "price"])
  const compactTokens = tokens.filter((token) => !stopwords.has(token))
  const lower = normalized.toLowerCase()

  const heuristics = []
  if (/\bmouse\b/i.test(lower)) {
    heuristics.push("wireless mouse", "gaming mouse", "computer mouse")
  }
  if (/\bphone\b|\bmobile\b|\bsmartphone\b/i.test(lower)) {
    heuristics.push("phones", "smartphone", "mobile")
  }
  if (/\blaptop\b/i.test(lower)) {
    heuristics.push("laptop", "notebook")
  }
  if (/\bearbud(s)?\b|\bearphone(s)?\b/i.test(lower)) {
    heuristics.push("earbuds", "wireless earbuds", "earphones")
  }
  if (/\bheadphone(s)?\b|\bheadset\b/i.test(lower)) {
    heuristics.push("headphones", "headset")
  }
  if (/\bwatch\b/i.test(lower)) {
    heuristics.push("smart watch", "smartwatch")
  }
  if (/\bkeyboard\b/i.test(lower)) {
    heuristics.push("wireless keyboard", "mechanical keyboard")
  }
  if (/\bcharger\b/i.test(lower)) {
    heuristics.push("fast charger", "wall charger")
  }

  if (/\bsamsung\b/i.test(lower)) {
    heuristics.push("samsung phones", "samsung galaxy", "samsung mobile")
  }
  if (/\blogitech\b/i.test(lower)) {
    heuristics.push("logitech wireless mouse", "logitech gaming mouse", "logitech computer mouse")
  }
  if (/\bapple\b/i.test(lower) || /\biphone\b/i.test(lower)) {
    heuristics.push("apple iphone", "iphone", "iphone 15")
  }

  const variants = [
    normalized,
    tokens.join(" "),
    compactTokens.join(" "),
    tokens.slice(0, 2).join(" "),
    tokens.slice(-2).join(" "),
    tokens[0],
    tokens.length > 1 ? tokens[1] : null,
    ...heuristics.map((variant) => `${compactTokens[0] || tokens[0] || normalized} ${variant}`.trim()),
    ...heuristics,
  ]

  return Array.from(new Set(variants.map((value) => cleanText(value)).filter(Boolean)))
}

async function searchBingShoppingSuggestions(searchTerm, limit = 8) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 8, 20)

  try {
    const proxyUrl = toProxyUrl(`https://www.bing.com/shop?q=${encodeURIComponent(q)}`)
    if (!proxyUrl) return []
    const response = await requestWithRetries(proxyUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
    }, { timeoutMs: 5000, retries: 1 })
    if (!response.ok) return []

    const text = await response.text()
    const seen = new Set()
    const suggestions = []
    const regex = /https?:\/\/www\.bing\.com\/shop\?q=([^&\s)]+)&FORM=SHOPA2/gi
    let match

    while ((match = regex.exec(text)) && suggestions.length < safeLimit) {
      const suggestion = cleanText(decodeURIComponent(String(match[1] || "").replace(/\+/g, " ")))
      if (!suggestion) continue
      const key = suggestion.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      suggestions.push(suggestion)
    }

    return suggestions
  } catch {
    return []
  }
}

function parseBingShoppingHtmlResults(html, limit = 3) {
  const rawHtml = String(html || "")
  const rows = []
  const seen = new Set()
  const cardRegex = /<li[^>]*class="[^"]*\bbr-item\b[^"]*"[^>]*>[\s\S]*?<\/li>/gi
  let match

  while ((match = cardRegex.exec(rawHtml)) && rows.length < limit) {
    const cardHtml = match[0] || ""

    const dataUrl = cardHtml.match(/<li[^>]*\bdata-url="([^"]+)"/i)?.[1] || null
    const hrefUrl = cardHtml.match(/<a[^>]*href="([^"]+)"/i)?.[1] || null
    const productPageUrl = cardHtml.match(/<a[^>]*class="[^"]*\bbr-titlelink\b[^"]*"[^>]*href="([^"]+)"/i)?.[1] || null

    const bestRelativeUrl = decodeHtmlEntities(productPageUrl || dataUrl || hrefUrl || "")
    const bestAbsoluteUrl = bestRelativeUrl.startsWith("http")
      ? bestRelativeUrl
      : bestRelativeUrl
        ? `https://www.bing.com${bestRelativeUrl.startsWith("/") ? "" : "/"}${bestRelativeUrl}`
        : ""

    const normalizedUrl = normalizeProductUrl("bing_shopping", bestAbsoluteUrl)
    if (!normalizedUrl) continue

    const imageMatch = cardHtml.match(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/i)
    const imageUrl = normalizeImageUrl(imageMatch ? decodeHtmlEntities(imageMatch[1]) : null)

    const titleFragment =
      cardHtml.match(/<div[^>]*class="[^"]*(?:br-title|br-pdItemName|br-offertitle|b_factrow)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      cardHtml.match(/<span[^>]*class="[^"]*(?:br-title|br-pdItemName|br-offertitle)[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      null

    let title = cleanText(titleFragment ? stripTags(titleFragment) : null)
    if (!title) {
      const altMatch = cardHtml.match(/<img[^>]*\balt="([^"]+)"/i)
      title = cleanText(decodeHtmlEntities(altMatch ? altMatch[1] : null))
    }
    if (!title) {
      title = cleanText(decodeHtmlEntities(cardHtml.match(/<span[^>]*title="([^"]+)"/i)?.[1] || null))
    }
    if (!title) {
      title = cleanText(stripTags(cardHtml))
    }
    if (!title) continue
    if (title.length > 160) continue
    if (/^(Product details|Product Image|New tab icon|Save to wishlist)$/i.test(title)) continue
    if (/(?:bing\.com\/ck\/a|JmltdHM|ptn=3|ver=2|hsh=4|fclid=|u=a1L3Nob3Av)/i.test(title)) continue

    const priceText = decodeHtmlEntities(
      cardHtml.match(/<div[^>]*class="[^\"]*resp-one-line[^\"]*br-max-width[^\"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      cardHtml.match(/<div[^>]*class="[^\"]*br-price[^\"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      "",
    )
    const price = extractFirstCurrencyValue(priceText) ?? extractFirstCurrencyValue(stripTags(cardHtml))
    if (!Number.isFinite(price)) continue

    const sellerFragment = cardHtml.match(/<div[^>]*class="[^\"]*br-seller[^\"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || null
    const sellerText = cleanText(sellerFragment ? stripTags(sellerFragment) : null)
    const ratingText = cleanText(decodeHtmlEntities(cardHtml.match(/\b([0-9](?:\.[0-9])?)\s*·\s*([0-9][0-9K+]*\+?)\b/i)?.[0] || null))
    const rating = ratingText ? Number(ratingText.split("·")[0]) : null
    const featureSummary = sellerText || null
    const dedupeKey = `${title.toLowerCase()}::${normalizedUrl}::${sellerText?.toLowerCase() || ""}::${price}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const row = normalizeSearchRow({
      source_key: "bing_shopping",
      source: getSourceLabel("bing_shopping"),
      title,
      price,
      image_url: imageUrl,
      product_url: normalizedUrl,
      seller: sellerText || "Bing Shopping",
      rating,
      feature_summary: featureSummary,
    })

    if (row) rows.push(row)
  }

  return rows
}

function parseBingShoppingSearchResults(text, limit = 3) {
  const rawText = String(text || "")
  const rows = []
  const seen = new Set()
  const imageRegex = /!\[Image \d+: Product Image\]\((https?:\/\/th\.bing\.com\/th(?:\/|\?)[^)]+)\)/gi
  let match

  while ((match = imageRegex.exec(rawText)) && rows.length < limit) {
    const imageUrl = normalizeImageUrl(match[1])
    const blockWindow = rawText.slice(Math.max(0, match.index - 1200), Math.min(rawText.length, match.index + 4200))
    const clickMatch = blockWindow.match(/\]\((https:\/\/www\.bing\.com\/aclick\?[^)]+)\)/i)
    if (clickMatch) {
      const beforeClick = blockWindow.slice(0, clickMatch.index)
      const title = extractBingShoppingTitle(beforeClick)
      const row = buildBingShoppingRow({
        blockText: beforeClick,
        imageUrl,
        productUrl: clickMatch[1],
        title,
        seen,
      })
      if (row) rows.push(row)
    }
  }

  if (rows.length < limit) {
    const clickRegex = /\]\((https:\/\/www\.bing\.com\/aclick\?[^)]+)\)/gi
    let clickMatch
    while ((clickMatch = clickRegex.exec(rawText)) && rows.length < limit) {
      const blockWindow = rawText.slice(Math.max(0, clickMatch.index - 3600), clickMatch.index)
      const title = extractBingShoppingTitle(blockWindow)
      const imageMatch = blockWindow.match(/!\[Image \d+: Product Image\]\((https?:\/\/th\.bing\.com\/th(?:\/|\?)[^)]+)\)/gi)
      const imageUrl = imageMatch?.length ? normalizeImageUrl(imageMatch[imageMatch.length - 1].match(/\((https?:\/\/th\.bing\.com\/th(?:\/|\?)[^)]+)\)/i)?.[1] || null) : null
      const row = buildBingShoppingRow({
        blockText: blockWindow,
        imageUrl,
        productUrl: clickMatch[1],
        title,
        seen,
      })
      if (row) rows.push(row)
    }
  }

  return rows
}

function extractBingShoppingTitle(blockText) {
  const compact = cleanText(String(blockText || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\]\([^)]*\)/g, " "))
  if (!compact) return null

  if (/why you're seeing this ad|advertiser details|see more ads|ad settings|your current search|microsoft advertising|shopping guide/i.test(compact)) {
    return null
  }

  const priceMatch = compact.match(/(?:Rs\.?|₹|£|€|\$)\s*[0-9][0-9,]*(?:\.[0-9]+)?/i)
  const titleSource = priceMatch ? compact.slice(0, priceMatch.index) : compact
  const segments = titleSource
    .split(/\s{2,}|(?:\|)|(?:·)/)
    .map((segment) => cleanText(segment))
    .filter(Boolean)

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (/^(SALE|Curbside|Product Image|New tab icon|Saved Save to wishlist)$/i.test(segment)) continue
    if (/^(Show filters|Hide filters|Refine by|Related searches for|Shopping)$/i.test(segment)) continue
    if (/(?:bing\.com\/ck\/a|JmltdHM|ptn=3|ver=2|hsh=4|fclid=|u=a1L3Nob3Av)/i.test(segment)) continue
    if (segment.length < 4) continue
    return segment.replace(/^(SALE|Curbside)\s+/i, "").replace(/\s+/g, " ")
  }

  return null
}

function buildBingShoppingRow({ blockText, imageUrl, productUrl, title, seen }) {
  const compact = cleanText(String(blockText || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\]\([^)]*\)/g, " "))
  if (!compact) return null
  if (/why you're seeing this ad|advertiser details|see more ads|ad settings|your current search|microsoft advertising|shopping guide/i.test(compact)) {
    return null
  }

  const price = extractFirstCurrencyValue(compact)
  if (!title) title = extractBingShoppingTitle(compact)
  if (!title) return null
  if (/(?:bing\.com\/ck\/a|JmltdHM|ptn=3|ver=2|hsh=4|fclid=|u=a1L3Nob3Av)/i.test(title)) return null
  if (title.length > 140) return null

  const afterPrice = (() => {
    const priceMatch = compact.match(/(?:Rs\.?|₹|£|€|\$)\s*[0-9][0-9,]*(?:\.[0-9]+)?/i)
    return priceMatch ? compact.slice(priceMatch.index + priceMatch[0].length) : compact
  })()
  const ratingMatch = afterPrice.match(/\b([0-9](?:\.[0-9])?)\s*·\s*([0-9][0-9K+]*\+?)\b/)
  const sellerText = cleanText((afterPrice.slice(0, ratingMatch?.index ?? afterPrice.length) || "").replace(/[•·]/g, " "))
  const availability = /out of stock|currently unavailable|sold out/i.test(compact)
    ? "Out of stock"
    : /\bin stock\b|available/i.test(compact)
      ? "In stock"
      : null
  const seller = sellerText || "Bing Shopping"
  const row = normalizeSearchRow({
    source_key: "bing_shopping",
    source: getSourceLabel("bing_shopping"),
    title,
    price,
    image_url: imageUrl,
    product_url: normalizeProductUrl("bing_shopping", productUrl),
    seller,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    availability,
    feature_summary: sellerText || null,
  })
  if (!row) return null

  const dedupeKey = `${row.title.toLowerCase()}::${row.product_url || ""}::${row.seller.toLowerCase()}::${row.price ?? ""}`
  if (seen) {
    if (seen.has(dedupeKey)) return null
    seen.add(dedupeKey)
  }
  return row
}

async function searchBingShoppingProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)

  try {
    const response = await requestWithRetries(`https://www.bing.com/shop?q=${encodeURIComponent(q)}`, {
      headers: DESKTOP_BROWSER_HEADERS,
    }, { timeoutMs: 12000, retries: 2 })
    if (!response.ok) return []

    const html = await response.text()
    let rows = parseBingShoppingHtmlResults(html, safeLimit)
    if (!rows.length) {
      const cardTagCount = (html.match(/<li[^>]*class=["'][^"']*\bbr-item\b[^"']*["'][^>]*>/gi) || []).length
      const cardCloseCount = (html.match(/<\/li>/gi) || []).length
      const firstCardIndex = html.search(/<li[^>]*class=["'][^"']*\bbr-item\b/gi)
      const aroundFirstCard = firstCardIndex >= 0
        ? html.slice(Math.max(0, firstCardIndex - 120), Math.min(html.length, firstCardIndex + 900)).replace(/\s+/g, " ")
        : null
      console.log("bing html diag", JSON.stringify({
        query: q,
        html_len: html.length,
        card_tag_count: cardTagCount,
        li_close_count: cardCloseCount,
        first_card_index: firstCardIndex,
        around_first_card: aroundFirstCard,
      }))
      const proxyUrl = toProxyUrl(`https://www.bing.com/shop?q=${encodeURIComponent(q)}`)
      if (proxyUrl) {
        const proxyResponse = await requestWithRetries(proxyUrl, {
          headers: { Accept: "text/plain,text/markdown,*/*" },
        }, { timeoutMs: 12000, retries: 1 })
        if (proxyResponse.ok) {
          rows = parseBingShoppingSearchResults(await proxyResponse.text(), safeLimit)
        }
      }
    }
    console.log("search provider=bing_shopping", JSON.stringify({ query: q, rows: rows.length }))
    return rows
  } catch {
    return []
  }
}

function scoreSearchRow(row, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase()
  if (!row || !normalizedQuery) return 0

  const title = String(row.title || "").trim().toLowerCase()
  const featureSummary = String(row.feature_summary || "").trim().toLowerCase()
  const source = String(row.source || row.source_key || "").trim().toLowerCase()
  const haystack = `${title} ${featureSummary} ${source}`.trim()
  const tokens = tokenizeSearchQuery(normalizedQuery)

  let score = 0

  if (title === normalizedQuery) score += 120
  if (title.includes(normalizedQuery)) score += 80
  if (haystack.includes(normalizedQuery)) score += 30

  if (tokens.length) {
    const titleMatches = tokens.filter((token) => title.includes(token)).length
    const haystackMatches = tokens.filter((token) => haystack.includes(token)).length

    score += titleMatches * 20
    score += haystackMatches * 6

    if (titleMatches === tokens.length) score += 40
    if (haystackMatches === tokens.length) score += 10

    const firstToken = tokens[0]
    if (firstToken && title.startsWith(firstToken)) score += 12
  }

  return score
}

function applySearchFilters(rows, filters = {}) {
  const normalizedSource = normalizeSourceKey(filters?.source || "")
  const minRating = Number(filters?.min_rating)
  const availabilityFilter = normalizeSearchAvailability(filters?.availability)

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row) return false
    if (normalizedSource && normalizedSource !== "generic" && normalizedSource !== "" && normalizedSource !== "all") {
      if (normalizeSourceKey(row.source_key) !== normalizedSource) return false
    }

    if (Number.isFinite(minRating) && minRating > 0) {
      const rating = Number(row.rating)
      if (!Number.isFinite(rating) || rating < minRating) return false
    }

    if (availabilityFilter) {
      const rowAvailability = normalizeSearchAvailability(row.availability)
      if (availabilityFilter === "in_stock") {
        if (rowAvailability !== "in_stock") return false
      } else if (availabilityFilter === "out_of_stock") {
        if (rowAvailability !== "out_of_stock") return false
      }
    }

    return true
  })
}

async function searchDuckDuckGoProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)
  const searchQueries = [q, `${q} Amazon`, `${q} Flipkart`, `${q} Reliance Digital`, `${q} Snapdeal`]
  const deadlineMs = Date.now() + 9000

  try {
    const texts = []
    for (const searchQuery of searchQueries) {
      if (Date.now() > deadlineMs) break
      const proxyUrl = toProxyUrl(`https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`)
      if (!proxyUrl) continue
      const response = await requestWithRetries(proxyUrl, {
        headers: { Accept: "text/plain,text/markdown,*/*" },
      }, { timeoutMs: 3500, retries: 1 })
      if (!response.ok) continue
      texts.push(await response.text())
    }

    const snippetRows = []
    for (const text of texts) {
      if (Date.now() > deadlineMs) break
      for (const row of extractDuckDuckGoResultRows(text)) {
        snippetRows.push(row)
        if (snippetRows.length >= safeLimit * 6) break
      }
      if (snippetRows.length >= safeLimit * 6) break
    }

    if (snippetRows.length) {
      const normalizedSnippetRows = dedupeSearchRows(snippetRows)
        .map(normalizeSearchRow)
        .filter(Boolean)
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
        .slice(0, safeLimit)
      if (normalizedSnippetRows.length) {
        console.log("search provider=duckduckgo", JSON.stringify({ query: q, queries: searchQueries.length, rows: normalizedSnippetRows.length, mode: "snippet" }))
        return normalizedSnippetRows
      }
    }
    return []
  } catch {
    return []
  }
}

function extractDuckDuckGoResultRows(text) {
  const rawText = String(text || "")
  const resultRegex = /## \[([^\]]+)\]\((http:\/\/duckduckgo\.com\/l\/\?uddg=[^)]+)\)/gi
  const matches = []
  let match

  while ((match = resultRegex.exec(rawText))) {
    matches.push({ title: cleanText(stripTags(match[1])), wrapperUrl: match[2], index: match.index })
  }

  const rows = []
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]
    const next = matches[index + 1]
    const block = rawText.slice(current.index, next ? next.index : rawText.length)
    const uddgMatch = current.wrapperUrl.match(/[?&]uddg=([^&]+)/i)
    if (!uddgMatch) continue

    const decodedUrl = decodeURIComponent(uddgMatch[1] || "")
    const source = inferSourceFromUrl(decodedUrl)
    const sourceKey = normalizeSourceKey(source.source_key)
    if (!["amazon", "flipkart", "reliance_digital", "snapdeal"].includes(sourceKey)) continue

    const row = normalizeSearchRow({
      source_key: sourceKey,
      source: getSourceLabel(sourceKey),
      title: current.title || source.source,
      price: extractFirstCurrencyValue(block),
      product_url: decodedUrl,
      seller: getSourceLabel(sourceKey),
      external_id: null,
      asin: null,
      brand: null,
    })
    if (row) rows.push(row)
  }

  return rows
}

function parseAmazonProxyProduct(text, asin, productUrl) {
  const raw = String(text || "")
  const title =
    cleanText(raw.match(/^#\s+(.+)$/m)?.[1]) ||
    cleanText(raw.match(/^Title:\s*(.+)$/m)?.[1]) ||
    cleanText(raw.match(/\[##\s*([^\]]+)\]\(/m)?.[1])
  const price = extractFirstCurrencyValue(raw)
  const imageMatch = raw.match(/!\[Image \d+: [^\]]+\]\((https:\/\/m\.media-amazon\.com\/[^)]+)\)/i)
  const imageUrl = normalizeImageUrl(imageMatch ? imageMatch[1] : null)

  if (!title || !Number.isFinite(price)) return null

  return {
    asin,
    title,
    price: round2(price),
    source: getSourceLabel("amazon"),
    image_url: imageUrl,
    brand: null,
    purchase_url: productUrl,
    external_id: asin,
    fetch_method: "scraper_proxy",
  }
}

function parseRelianceProxySearchResults(text) {
  const payload = parseProxyJsonText(text)
  const items = Array.isArray(payload?.items) ? payload.items : []
  const rows = []

  for (const item of items) {
    const parsed = extractRelianceItem(item)
    if (parsed) rows.push(parsed)
  }

  return rows
}

function parseRelianceProxyProduct(text, itemCode, productUrl) {
  const payload = parseProxyJsonText(text)
  const item = payload?.data || null
  if (!item || typeof item !== "object") return null

  const title = cleanText(item.name)
  const brand = cleanText(item?.brand?.name)
  const price = extractPriceValue(item?.price?.effective?.min)
  const medias = Array.isArray(item.medias) ? item.medias : []
  const imageUrl = normalizeImageUrl(medias.find((media) => media && typeof media === "object" && media.url)?.url || null)
  if (!title || !Number.isFinite(price)) return null

  return {
    title,
    price: round2(price),
    image_url: imageUrl,
    brand,
    source_key: "reliance_digital",
    source: getSourceLabel("reliance_digital"),
    purchase_url: productUrl,
    external_id: itemCode,
    fetch_method: "reliance_api_proxy",
  }
}

function extractJsonLdPayloads(html) {
  const payloads = []
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(String(html || ""))) && payloads.length < 30) {
    const raw = match[1].trim()
    if (!raw) continue
    try {
      payloads.push(JSON.parse(raw))
    } catch {
      // ignore invalid JSON-LD blocks
    }
  }
  return payloads
}

function flattenJsonLd(payload) {
  if (payload == null) return []
  if (Array.isArray(payload)) return payload.flatMap(flattenJsonLd)
  if (typeof payload === "object" && payload && "@graph" in payload) {
    return flattenJsonLd(payload["@graph"])
  }
  return [payload]
}

function extractBrandFromJsonLd(payloads) {
  const nodes = payloads.flatMap(flattenJsonLd)
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue
    const nodeType = node["@type"]
    const types = typeof nodeType === "string" ? [nodeType] : Array.isArray(nodeType) ? nodeType : []
    if (!types.some((t) => String(t).toLowerCase() === "product")) continue

    const brand = node.brand
    if (typeof brand === "string") return cleanText(brand)
    if (brand && typeof brand === "object") return cleanText(brand.name)
  }
  return null
}

function extractPriceFromJsonLd(payloads) {
  const nodes = payloads.flatMap(flattenJsonLd)
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue
    const nodeType = node["@type"]
    const types = typeof nodeType === "string" ? [nodeType] : Array.isArray(nodeType) ? nodeType : []
    if (!types.some((t) => String(t).toLowerCase() === "product")) continue

    const offers = node.offers
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : []
    for (const offer of offerList) {
      if (!offer || typeof offer !== "object") continue
      const candidate = offer.price ?? offer.lowPrice ?? offer.highPrice
      const price = extractPriceValue(candidate)
      if (Number.isFinite(price) && price > 0) return price

      const priceSpec = offer.priceSpecification
      const ps = Array.isArray(priceSpec) ? priceSpec : priceSpec ? [priceSpec] : []
      for (const entry of ps) {
        if (!entry || typeof entry !== "object") continue
        const nextPrice = extractPriceValue(entry.price)
        if (Number.isFinite(nextPrice) && nextPrice > 0) return nextPrice
      }
    }
  }
  return null
}

function extractRatingFromJsonLd(payloads) {
  const nodes = payloads.flatMap(flattenJsonLd)
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue
    const nodeType = node["@type"]
    const types = typeof nodeType === "string" ? [nodeType] : Array.isArray(nodeType) ? nodeType : []
    if (!types.some((t) => String(t).toLowerCase() === "product")) continue

    const rating = extractPriceValue(node?.aggregateRating?.ratingValue ?? node?.reviewRating?.ratingValue ?? node?.ratingValue)
    if (Number.isFinite(rating) && rating > 0) return round2(rating)
  }
  return null
}

function extractAvailabilityFromJsonLd(payloads) {
  const nodes = payloads.flatMap(flattenJsonLd)
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue
    const nodeType = node["@type"]
    const types = typeof nodeType === "string" ? [nodeType] : Array.isArray(nodeType) ? nodeType : []
    if (!types.some((t) => String(t).toLowerCase() === "product")) continue

    const offers = node.offers
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : []
    for (const offer of offerList) {
      if (!offer || typeof offer !== "object") continue
      const availability = String(offer.availability || offer.itemCondition || "").trim()
      if (availability) return availability.replace(/^.*\//, "").replace(/_/g, " ")
    }
  }
  return null
}

function extractFeatureSummary(html) {
  return (
    cleanText(extractMetaContent(html, "name", "description")) ||
    cleanText(extractMetaContent(html, "property", "og:description")) ||
    null
  )
}

function extractAvailabilityFromHtml(html) {
  const text = String(html || "")
  const patterns = [
    /\bIn Stock\b/i,
    /\bOnly \d+ left in stock\b/i,
    /\bAvailable\b/i,
    /\bOut of stock\b/i,
    /\bCurrently unavailable\b/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return cleanText(match[0])
  }
  return null
}

function extractMetaContent(html, key, value) {
  const targetKey = String(key || "").toLowerCase()
  const targetValue = String(value || "").toLowerCase()
  const regex = /<meta\b[^>]*>/gi
  let match
  while ((match = regex.exec(String(html || "")))) {
    const tag = match[0]
    const attrs = {}
    const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
    let attr
    while ((attr = attrRegex.exec(tag))) {
      const k = String(attr[1] || "").toLowerCase()
      const v = decodeHtmlEntities(attr[3] || attr[4] || attr[5] || "")
      attrs[k] = v
    }

    const entryKey = String(attrs[targetKey] || "").toLowerCase()
    if (entryKey !== targetValue) continue
    const content = cleanText(attrs.content)
    if (content) return content
  }
  return null
}

function getFetchModeFromRequest(request) {
  const raw = String(request?.headers?.get("X-PricePulse-Fetch-Mode") || "").trim().toLowerCase()
  return raw === "zyte-only" ? "zyte-only" : "auto"
}

function isTelegramConfigured(env) {
  const token = String(readEnvValue(env, ["TELEGRAM_BOT_TOKEN", "PRICEPULSE_TELEGRAM_BOT_TOKEN"], "") || "").trim()
  const chatId = String(readEnvValue(env, ["TELEGRAM_CHAT_ID", "PRICEPULSE_TELEGRAM_CHAT_ID"], "") || "").trim()
  return Boolean(token && chatId)
}

function formatTargetRange(targetPriceMin, targetPriceMax) {
  const low = toNumber(targetPriceMin, null)
  const high = toNumber(targetPriceMax, null)

  if (Number.isFinite(low) && Number.isFinite(high)) {
    if (Math.abs(low - high) < 0.01) return `Rs. ${high.toFixed(2)}`
    return `Rs. ${low.toFixed(2)} - Rs. ${high.toFixed(2)}`
  }
  if (Number.isFinite(high)) return `Up to Rs. ${high.toFixed(2)}`
  if (Number.isFinite(low)) return `From Rs. ${low.toFixed(2)}`
  return "Custom target range"
}

function buildTelegramAlertMessage({ product, alert, currentPrice }) {
  const productName = cleanText(product?.name) || `Product #${product?.id}`
  const priceValue = toNumber(currentPrice, null)
  const targetMin = toNumber(alert?.target_price_min ?? product?.target_price_min, null)
  const targetMax = toNumber(alert?.target_price_max ?? product?.target_price_max, null)
  const dealStatus = cleanText(product?.recommendation) || null
  const dealReason = cleanText(product?.recommendation_reason) || null
  const purchaseUrl = product?.purchase_url || product?.product_url || null
  const historicalLow = toNumber(product?.historical_low, null)

  const lines = [
    "PricePulse alert",
    "",
    `Product: ${productName}`,
    `Current price: Rs. ${(Number.isFinite(priceValue) ? priceValue : 0).toFixed(2)}`,
    `Your target range: ${formatTargetRange(targetMin, targetMax)}`,
    `Product ID: ${product?.id}`,
  ]

  if (dealStatus) {
    lines.splice(3, 0, `Action: ${dealStatus}`)
  }
  if (Number.isFinite(historicalLow)) {
    lines.push(`Historical low: Rs. ${historicalLow.toFixed(2)}`)
  }
  if (purchaseUrl) {
    lines.push(`Link: ${purchaseUrl}`)
  }

  lines.push("")
  lines.push(dealReason || "A tracked product has reached an alert condition.")
  return lines.join("\n")
}

async function sendTelegramMessage(env, text) {
  const token = String(readEnvValue(env, ["TELEGRAM_BOT_TOKEN", "PRICEPULSE_TELEGRAM_BOT_TOKEN"], "") || "").trim()
  const chatId = String(readEnvValue(env, ["TELEGRAM_CHAT_ID", "PRICEPULSE_TELEGRAM_CHAT_ID"], "") || "").trim()
  if (!token || !chatId) {
    return { sent: false, error: "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID." }
  }

  const apiBase = String(readEnvValue(env, ["TELEGRAM_API_BASE", "PRICEPULSE_TELEGRAM_API_BASE"], "https://api.telegram.org") || "https://api.telegram.org")
    .trim()
    .replace(/\/$/, "")
  const url = `${apiBase}/bot${token}/sendMessage`

  let response
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: String(text || "") }),
      },
      15000,
    )
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) }
  }

  if (!response.ok) {
    let description = null
    try {
      const payload = await response.json()
      description = payload?.description || null
    } catch {
      description = null
    }

    if (response.status === 401) {
      return { sent: false, error: "Telegram rejected the bot token. Update TELEGRAM_BOT_TOKEN in the backend environment." }
    }
    if (response.status === 400 || response.status === 403) {
      return {
        sent: false,
        error: description
          ? `Telegram rejected the destination chat: ${description}`
          : "Telegram rejected the destination chat. Check TELEGRAM_CHAT_ID and start the bot chat first.",
      }
    }

    return {
      sent: false,
      error: description ? `Telegram request failed: ${description}` : `Telegram request failed with status ${response.status}.`,
    }
  }

  try {
    const payload = await response.json()
    if (!payload?.ok) {
      const description = payload?.description || "Telegram returned an unexpected response."
      return { sent: false, error: `Telegram request failed: ${description}` }
    }
  } catch {
    // If Telegram responded 200 but payload isn't JSON, treat as failure.
    return { sent: false, error: "Telegram returned an invalid response." }
  }

  return { sent: true, error: null }
}

async function deliverTelegramForAlert(db, env, productWithInsights, alert, currentPrice, timestamp) {
  const message = buildTelegramAlertMessage({ product: productWithInsights, alert, currentPrice })
  const result = await sendTelegramMessage(env, message)

  if (result.sent) {
    await db
      .prepare("UPDATE alerts SET notification_sent_flag = 1, notification_sent_at = ?1, notification_error = NULL WHERE id = ?2")
      .bind(timestamp, alert.id)
      .run()
    return { sent: true, error: null }
  }

  await db
    .prepare("UPDATE alerts SET notification_sent_flag = 0, notification_sent_at = NULL, notification_error = ?1 WHERE id = ?2")
    .bind(result.error || "Telegram delivery failed.", alert.id)
    .run()

  return { sent: false, error: result.error || "Telegram delivery failed." }
}

async function deliverPendingTelegramAlerts(db, env, productId, currentPrice, timestamp) {
  const telegramConfigured = isTelegramConfigured(env)
  const pending = await db
    .prepare(
      "SELECT * FROM alerts WHERE product_id = ?1 AND triggered_flag = 1 AND notification_sent_flag = 0 AND telegram_enabled = 1 ORDER BY created_at DESC",
    )
    .bind(productId)
    .all()

  const alerts = pending.results || []
  if (!alerts.length) return

  const productRow = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
  if (!productRow) return
  const productWithInsights = await attachInsights(db, productRow)

  if (!telegramConfigured) {
    const errorMessage = "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
    for (const alert of alerts) {
      await db
        .prepare("UPDATE alerts SET notification_sent_flag = 0, notification_sent_at = NULL, notification_error = ?1 WHERE id = ?2")
        .bind(errorMessage, alert.id)
        .run()
    }
    return
  }

  for (const alert of alerts) {
    await deliverTelegramForAlert(db, env, productWithInsights, alert, currentPrice, timestamp)
  }
}

function nowIso() {
  return new Date().toISOString()
}

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value))
}

function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  })
}

function toBoolInt(value, fallback = 0) {
  if (value === undefined || value === null) return fallback
  return value ? 1 : 0
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  if (typeof value === "boolean") return value
  const s = String(value).toLowerCase()
  return ["1", "true", "yes", "on"].includes(s)
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim()
  if (!raw) return null
  return raw.replace(/\/$/, "")
}

function readEnvValue(env, keys, fallback = undefined) {
  for (const key of keys) {
    const value = env?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value
    }
  }
  return fallback
}

function getConfig(env) {
  const corsOrigins = parseCsv(readEnvValue(env, ["CORS_ORIGINS", "PRICEPULSE_CORS_ORIGINS", "CORS_ORIGIN"], "*"))
    .map(normalizeOrigin)
    .filter(Boolean)
  const allowAllCors = corsOrigins.includes("*")

  return {
    DEFAULT_REFRESH_MINUTES: clamp(
      1,
      toNumber(readEnvValue(env, ["DEFAULT_REFRESH_MINUTES", "PRICEPULSE_DEFAULT_REFRESH_MINUTES", "PRICEPULSE_DEFAULT_REFRESH_INTERVAL_MINUTES"], 360), 360),
      20160,
    ),
    MIN_REFRESH_MINUTES: clamp(
      1,
      toNumber(readEnvValue(env, ["MIN_REFRESH_MINUTES", "PRICEPULSE_MIN_REFRESH_MINUTES", "PRICEPULSE_SCHEDULER_INTERVAL_MINUTES"], 15), 15),
      20160,
    ),
    MAX_CRON_REFRESHES_PER_RUN: clamp(
      1,
      toNumber(readEnvValue(env, ["MAX_CRON_REFRESHES_PER_RUN", "PRICEPULSE_MAX_CRON_REFRESHES_PER_RUN"], 12), 12),
      100,
    ),
    ALLOW_SYNTHETIC: toBool(readEnvValue(env, ["ALLOW_SYNTHETIC", "PRICEPULSE_ALLOW_SYNTHETIC"], false), false),
    NOTIFICATIONS_CONFIGURED: toBool(env.NOTIFICATIONS_CONFIGURED, false),
    CORS_ORIGINS: corsOrigins.length ? corsOrigins : ["*"],
    CORS_ALLOW_ALL: allowAllCors,
    TELEGRAM_API_BASE: String(readEnvValue(env, ["TELEGRAM_API_BASE", "PRICEPULSE_TELEGRAM_API_BASE"], "https://api.telegram.org") || "https://api.telegram.org")
      .trim()
      .replace(/\/$/, ""),
    SCRAPY_API_BASE: String(readEnvValue(env, ["SCRAPY_API_BASE", "PRICEPULSE_SCRAPY_API_BASE"], "") || "")
      .trim()
      .replace(/\/$/, ""),
  }
}

function formatCurrency(value) {
  if (!Number.isFinite(Number(value))) return "N/A"
  return `Rs. ${Number(value).toFixed(2)}`
}

function isOriginAllowed(requestOrigin, config) {
  if (config?.CORS_ALLOW_ALL) return "*"
  const normalized = normalizeOrigin(requestOrigin)
  if (!normalized) return null
  return config?.CORS_ORIGINS?.includes(normalized) ? normalized : null
}

function corsHeadersForRequest(request, config) {
  const requestOrigin = request?.headers?.get("Origin")
  const allowedOrigin = isOriginAllowed(requestOrigin, config)
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-PricePulse-Fetch-Mode",
    "Access-Control-Max-Age": "86400",
  }

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin
    if (allowedOrigin !== "*") {
      headers.Vary = "Origin"
    }
  }

  return headers
}

async function parseJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    asin TEXT,
    source_key TEXT NOT NULL DEFAULT 'generic',
    external_id TEXT,
    product_url TEXT,
    image_url TEXT,
    brand TEXT,
    source TEXT,
    refresh_interval_minutes INTEGER NOT NULL DEFAULT 360,
    target_price REAL NOT NULL,
    target_price_min REAL NOT NULL,
    target_price_max REAL NOT NULL,
    last_fetch_method TEXT,
    last_updated TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    price REAL NOT NULL,
    fetch_method TEXT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    target_price REAL NOT NULL,
    target_price_min REAL NOT NULL,
    target_price_max REAL NOT NULL,
    telegram_enabled INTEGER NOT NULL DEFAULT 1,
    browser_enabled INTEGER NOT NULL DEFAULT 0,
    alarm_enabled INTEGER NOT NULL DEFAULT 0,
    email_enabled INTEGER NOT NULL DEFAULT 0,
    triggered_flag INTEGER NOT NULL DEFAULT 0,
    triggered_at TEXT,
    notification_sent_flag INTEGER NOT NULL DEFAULT 0,
    notification_sent_at TEXT,
    notification_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_price_history_product_time ON price_history (product_id, timestamp DESC)",
  "CREATE INDEX IF NOT EXISTS idx_alerts_product_created ON alerts (product_id, created_at DESC)",
].map((stmt) => stmt.replace(/\s+/g, " ").trim())

let schemaReadyPromise = null

async function ensureSchema(db) {
  if (schemaReadyPromise) return schemaReadyPromise

  schemaReadyPromise = (async () => {
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.exec(stmt)
    }
  })()

  try {
    await schemaReadyPromise
  } catch (error) {
    schemaReadyPromise = null
    throw error
  }

  return schemaReadyPromise
}

function inferSourceFromUrl(rawUrl) {
  const value = String(rawUrl || "").toLowerCase()
  if (value.includes("amazon.")) return { source_key: "amazon", source: getSourceLabel("amazon") }
  if (value.includes("flipkart.")) return { source_key: "flipkart", source: getSourceLabel("flipkart") }
  if (value.includes("reliancedigital.")) return { source_key: "reliance_digital", source: getSourceLabel("reliance_digital") }
  if (value.includes("snapdeal.")) return { source_key: "snapdeal", source: getSourceLabel("snapdeal") }
  return { source_key: "generic", source: getSourceLabel("generic") }
}

function isPlaceholderProductUrl(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return false
  try {
    const parsed = new URL(normalized)
    return parsed.hostname === "example.com"
  } catch {
    return normalized.includes("example.com/")
  }
}

function isPlaceholderAsin(value) {
  return /^CF\d{8}$/i.test(String(value || "").trim())
}

function buildPurchaseUrl(product) {
  if (product?.product_url && !isPlaceholderProductUrl(product.product_url)) return product.product_url
  if (product?.asin && !isPlaceholderAsin(product.asin)) return `https://www.amazon.in/dp/${product.asin}`
  return null
}

function chooseRecommendation(currentPrice, targetMin, targetMax, historicalLow, avg30, historyCount) {
  if (!Number.isFinite(currentPrice)) {
    return {
      recommendation: "HOLD ON",
      recommendation_reason: "No current price is available yet.",
    }
  }
  if (Number.isFinite(targetMax) && currentPrice > targetMax) {
    return {
      recommendation: "HOLD ON",
      recommendation_reason: `Current price is above your target ceiling (${formatCurrency(targetMax)}).`,
    }
  }
  if (Number.isFinite(targetMin) && Number.isFinite(targetMax) && currentPrice >= targetMin && currentPrice <= targetMax) {
    return {
      recommendation: "GOOD DEAL",
      recommendation_reason: "Current price is within your configured target range.",
    }
  }
  if (Number.isFinite(historicalLow) && historyCount >= 3 && currentPrice <= historicalLow * 1.02) {
    return {
      recommendation: "BUY NOW",
      recommendation_reason: "Current price is at or near the lowest tracked point.",
    }
  }
  if (Number.isFinite(avg30) && currentPrice <= avg30 * 0.95) {
    return {
      recommendation: "GOOD DEAL",
      recommendation_reason: "Current price is a strong discount versus recent average.",
    }
  }
  return {
    recommendation: "HOLD ON",
    recommendation_reason: "Wait for a deeper drop to maximize savings.",
  }
}

function computePrediction(historyAsc) {
  if (!historyAsc.length) return { prediction: null, prediction_confidence: null }
  const last = historyAsc.slice(-5).map((item) => Number(item.price)).filter(Number.isFinite)
  if (last.length < 2) return { prediction: null, prediction_confidence: null }
  const first = last[0]
  const newest = last[last.length - 1]
  if (newest < first * 0.97) return { prediction: "Likely to dip further", prediction_confidence: "medium" }
  if (newest > first * 1.03) return { prediction: "Likely to rebound down soon", prediction_confidence: "low" }
  return { prediction: "Stable range expected", prediction_confidence: "low" }
}

async function getProductHistory(db, productId, { days = null, limit = null, descending = true } = {}) {
  const whereParts = ["product_id = ?1"]
  const bindings = [productId]
  if (days != null) {
    const since = new Date(Date.now() - Number(days) * ONE_DAY_MS).toISOString()
    whereParts.push("timestamp >= ?2")
    bindings.push(since)
  }
  const orderDir = descending ? "DESC" : "ASC"
  const safeLimit = limit != null ? clamp(1, Number(limit), 500) : null
  const limitSql = safeLimit ? ` LIMIT ${safeLimit}` : ""
  const stmt = db
    .prepare(`SELECT id, product_id, price, fetch_method, timestamp FROM price_history WHERE ${whereParts.join(" AND ")} ORDER BY timestamp ${orderDir}${limitSql}`)
    .bind(...bindings)
  const { results } = await stmt.all()
  return results || []
}

async function attachInsights(db, product) {
  const historyDesc = await getProductHistory(db, product.id, { limit: 200, descending: true })
  const historyAsc = [...historyDesc].reverse()
  const prices = historyAsc.map((h) => Number(h.price)).filter(Number.isFinite)

  const latestPrice = prices.length ? prices[prices.length - 1] : null
  const latestEntry = historyDesc[0] || null

  const now = Date.now()
  const prices7d = historyAsc
    .filter((h) => now - Date.parse(h.timestamp) <= 7 * ONE_DAY_MS)
    .map((h) => Number(h.price))
    .filter(Number.isFinite)
  const prices30d = historyAsc
    .filter((h) => now - Date.parse(h.timestamp) <= 30 * ONE_DAY_MS)
    .map((h) => Number(h.price))
    .filter(Number.isFinite)

  const avg = (arr) => (arr.length ? arr.reduce((sum, p) => sum + p, 0) / arr.length : null)
  const average7d = avg(prices7d)
  const average30d = avg(prices30d.length ? prices30d : prices)
  const historicalLow = prices.length ? Math.min(...prices) : null
  const deltaFromAvg = Number.isFinite(latestPrice) && Number.isFinite(average30d) ? latestPrice - average30d : null
  const deltaFromAvgPct =
    Number.isFinite(latestPrice) && Number.isFinite(average30d) && average30d !== 0 ? (latestPrice - average30d) / average30d : null

  const targetMin = toNumber(product.target_price_min, null)
  const targetMax = toNumber(product.target_price_max, null)
  const recommendationBits = chooseRecommendation(latestPrice, targetMin, targetMax, historicalLow, average30d, prices.length)
  const predictionBits = computePrediction(historyAsc)

  return {
    ...product,
    product_url: isPlaceholderProductUrl(product.product_url) ? null : product.product_url,
    latest_price: latestPrice != null ? round2(latestPrice) : null,
    average_7d: average7d != null ? round2(average7d) : null,
    average_30d: average30d != null ? round2(average30d) : null,
    historical_low: historicalLow != null ? round2(historicalLow) : null,
    delta_from_avg: deltaFromAvg != null ? round2(deltaFromAvg) : null,
    delta_from_avg_pct: deltaFromAvgPct != null ? deltaFromAvgPct : null,
    recommendation: recommendationBits.recommendation,
    recommendation_reason: recommendationBits.recommendation_reason,
    prediction: predictionBits.prediction,
    prediction_confidence: predictionBits.prediction_confidence,
    purchase_url: buildPurchaseUrl(product),
    last_updated: product.last_updated || latestEntry?.timestamp || product.created_at,
    deal_status: recommendationBits.recommendation,
    trend: null,
  }
}

function syntheticSearchResults(query, limit) {
  const q = String(query || "").trim()
  const safeLimit = clamp(1, Number(limit) || 9, 15)
  if (!q || safeLimit <= 0) return []
  return []
}

function dedupeSearchRows(rows) {
  const seen = new Set()
  const deduped = []
  for (const row of rows) {
    const key = `${row?.source_key || ""}::${row?.product_url || row?.external_id || row?.asin || row?.title || ""}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }
  return deduped
}

function normalizeSearchRow(row) {
  if (!row || typeof row !== "object") return null

  const sourceKey = normalizeSourceKey(row.source_key)
  const title = cleanText(row.title)
  const price = row.price == null ? null : toNumber(row.price, null)
  const productUrl = normalizeProductUrl(sourceKey, row.product_url)
  if (!title || !productUrl) return null
  if (price != null && (!Number.isFinite(price) || price <= 0)) return null
  if (!isAllowedStoreUrl(sourceKey, productUrl)) return null

  return {
    ...row,
    source_key: sourceKey,
    source: row.source || getSourceLabel(sourceKey),
    title,
    price: price == null ? null : round2(price),
    product_url: productUrl,
    image_url: normalizeImageUrl(row.image_url),
    seller: cleanText(row.seller) || row.source || getSourceLabel(sourceKey),
    external_id: row.external_id != null ? String(row.external_id) : null,
    asin: row.asin != null ? String(row.asin) : null,
    brand: cleanText(row.brand),
    rating: Number.isFinite(Number(row.rating)) ? round2(Number(row.rating)) : null,
    availability: cleanText(row.availability),
    feature_summary: cleanText(row.feature_summary),
  }
}

function extractRelianceItem(item) {
  if (!item || typeof item !== "object") return null
  const title = cleanText(item.name)
  const itemCode = item.item_code
  const slug = item.slug
  const price = item?.price?.effective?.min
  const brand = item?.brand?.name
  const medias = Array.isArray(item.medias) ? item.medias : []
  const imageUrl = medias.find((media) => media && typeof media === "object" && media.url)?.url || null
  if (!title || !itemCode || price == null) return null

  const productUrl = slug ? `https://www.reliancedigital.in/${slug}/p/${itemCode}` : null
  return normalizeSearchRow({
    source_key: "reliance_digital",
    source: getSourceLabel("reliance_digital"),
    title,
    price,
    image_url: imageUrl,
    product_url: productUrl,
    seller: brand || getSourceLabel("reliance_digital"),
    external_id: String(itemCode),
    brand,
  })
}

async function searchRelianceProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)

  try {
    const apiUrl = new URL("https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products")
    apiUrl.searchParams.set("q", q)
    const response = await requestWithRetries(apiUrl.toString(), {
      headers: { ...DESKTOP_BROWSER_HEADERS, Accept: "application/json,text/plain,*/*" },
    })
    if (!response.ok) return []
    const payload = await response.json().catch(() => null)
    const items = Array.isArray(payload?.items) ? payload.items : []
    const rows = []
    for (const item of items) {
      const parsed = extractRelianceItem(item)
      if (parsed) rows.push(parsed)
      if (rows.length >= safeLimit) break
    }
    if (rows.length) return rows
  } catch {
    // Fall through to proxy fallback.
  }

  try {
    const proxyUrl = toProxyUrl(`https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products?q=${encodeURIComponent(q)}`)
    if (!proxyUrl) return []
    const response = await requestWithRetries(proxyUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
    })
    if (!response.ok) return []
    const text = await response.text()
    const parsed = parseRelianceProxySearchResults(text).slice(0, safeLimit)
    console.log("search proxy provider=reliance", JSON.stringify({ query: q, rows: parsed.length }))
    return parsed
  } catch {
    return []
  }
}

function extractSnapdealExternalId(url) {
  const value = String(url || "")
  const match = value.match(/\/product\/(?:[^/]+)\/(\d+)/i)
  return match ? match[1] : null
}

async function searchSnapdealProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)

  try {
    const url = `https://www.snapdeal.com/search?keyword=${encodeURIComponent(q)}`
    const response = await requestWithRetries(url, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return []
    const html = await response.text()

    const results = []
    const seen = new Set()
    const linkRegex = /href=\"(https:\/\/www\.snapdeal\.com\/product\/[^\"]+\/(\d+))\"/gi
    let match

    while ((match = linkRegex.exec(html)) && results.length < safeLimit) {
      const productUrl = match[1]
      const externalId = match[2]
      if (!externalId || seen.has(externalId)) continue
      seen.add(externalId)

      const windowStart = Math.max(0, match.index - 1800)
      const windowEnd = Math.min(html.length, match.index + 3800)
      const snippet = html.slice(windowStart, windowEnd)

      const titleMatch = snippet.match(/<p[^>]*class=\"product-title[^\"]*\"[^>]*title=\"([^\"]+)\"/i)
      const title = titleMatch ? stripTags(titleMatch[1]) : null
      const priceMatch = snippet.match(new RegExp(`id=\\\"display-price-${externalId}[^\\\"]*\\\"[^>]*data-price=\\\"([^\\\"]+)\\\"`, "i"))
      const price = extractPriceValue(priceMatch ? priceMatch[1] : null)
      const imageMatch = snippet.match(/<img[^>]*class=\"product-image[^\"]*\"[^>]*(?:src|data-src)=\"([^\"]+)\"/i)
      const imageUrl = normalizeImageUrl(imageMatch ? imageMatch[1] : null)

      const row = normalizeSearchRow({
        source_key: "snapdeal",
        source: getSourceLabel("snapdeal"),
        title,
        price,
        image_url: imageUrl,
        product_url: productUrl,
        seller: "Snapdeal Marketplace",
        external_id: externalId,
      })
      if (row) results.push(row)
    }

    return results
  } catch {
    return []
  }
}

function extractAmazonTitleFromSegment(segment) {
  const patterns = [
    /<span[^>]*class=\"[^\"]*a-size-medium[^\"]*a-text-normal[^\"]*\"[^>]*>([\s\S]*?)<\/span>/i,
    /<span[^>]*class=\"[^\"]*a-size-base-plus[^\"]*a-text-normal[^\"]*\"[^>]*>([\s\S]*?)<\/span>/i,
    /<span[^>]*class=\"[^\"]*a-size-base[^\"]*a-text-normal[^\"]*\"[^>]*>([\s\S]*?)<\/span>/i,
  ]

  for (const pattern of patterns) {
    const match = String(segment || "").match(pattern)
    if (match) {
      const title = stripTags(match[1])
      if (title) return title
    }
  }
  return null
}

function extractFirstPriceFromHtml(html) {
  const text = String(html || "")
  const matches = Array.from(text.matchAll(/a-offscreen[^>]*>([\s\S]*?)<\/span>/gi))
  for (const match of matches) {
    const price = extractPriceValue(stripTags(match[1]))
    if (Number.isFinite(price) && price > 0) return price
  }

  const wholeMatch = text.match(/a-price-whole[^>]*>([0-9,]+)/i)
  const value = extractPriceValue(wholeMatch ? wholeMatch[1] : null)
  if (Number.isFinite(value) && value > 0) return value
  return null
}

async function searchAmazonProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)

  try {
    const url = `https://www.amazon.in/gp/aw/s?k=${encodeURIComponent(q)}`
    const response = await requestWithRetries(url, { headers: MOBILE_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return []
    const html = await response.text()

    const asinRegex = /data-asin=\"([A-Z0-9]{10})\"/g
    const matches = []
    let match
    while ((match = asinRegex.exec(html)) && matches.length < safeLimit * 4) {
      matches.push({ asin: match[1], index: match.index })
    }

    const rows = []
    const seen = new Set()
    for (let i = 0; i < matches.length && rows.length < safeLimit; i += 1) {
      const { asin, index } = matches[i]
      if (!asin || seen.has(asin)) continue
      seen.add(asin)

      const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(html.length, index + 25000)
      const segment = html.slice(index, end)
      const title = extractAmazonTitleFromSegment(segment)
      const price = extractFirstPriceFromHtml(segment)
      const imageMatch = segment.match(/<img[^>]*src=\"(https:\/\/m\.media-amazon\.com\/[^\"]+)\"/i)
      const imageUrl = normalizeImageUrl(imageMatch ? imageMatch[1] : null)

      const row = normalizeSearchRow({
        source_key: "amazon",
        source: getSourceLabel("amazon"),
        asin,
        external_id: asin,
        title,
        price,
        image_url: imageUrl,
        product_url: `https://www.amazon.in/dp/${asin}`,
        seller: "Amazon Marketplace",
      })
      if (row) rows.push(row)
    }

    if (rows.length) return rows
  } catch {
    // Fall through to proxy fallback.
  }

  try {
    const proxyUrl = toProxyUrl(`https://www.amazon.in/gp/aw/s?k=${encodeURIComponent(q)}`)
    if (!proxyUrl) return []
    const response = await requestWithRetries(proxyUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
    })
    if (!response.ok) return []
    const text = await response.text()
    const parsed = parseAmazonProxySearchResults(text, safeLimit)
    console.log("search proxy provider=amazon", JSON.stringify({ query: q, rows: parsed.length }))
    return parsed
  } catch {
    return []
  }
}

function extractFlipkartSearchTitle(segment) {
  const titleCandidates = [
    segment.match(/aria-label="([^"]+)"/i)?.[1],
    segment.match(/title="([^"]+)"/i)?.[1],
    segment.match(/alt="([^"]+)"/i)?.[1],
  ]

  for (const candidate of titleCandidates) {
    const title = cleanText(stripTags(candidate))
    if (title) return title
  }

  return null
}

async function searchFlipkartProducts(searchTerm, limit = 3) {
  const q = String(searchTerm || "").trim()
  if (!q) return []
  const safeLimit = clamp(1, Number(limit) || 3, 12)

  try {
    const url = `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`
    const response = await requestWithRetries(url, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return []

    const html = await response.text()
    const candidates = []
    const seen = new Set()
    const linkRegex = /href="([^"]*\/p\/[^"]+)"/gi
    let match

    while ((match = linkRegex.exec(html)) && candidates.length < safeLimit * 8) {
      const productUrl = normalizeProductUrl("flipkart", match[1])
      if (!productUrl || seen.has(productUrl)) continue
      seen.add(productUrl)

      const windowStart = Math.max(0, match.index - 1800)
      const windowEnd = Math.min(html.length, match.index + 4200)
      const snippet = html.slice(windowStart, windowEnd)
      const title = extractFlipkartSearchTitle(snippet)
      const price = extractFirstCurrencyValue(snippet)
      const imageMatch = snippet.match(/<img[^>]*(?:src|data-src)="([^"]+)"/i)
      const row = normalizeSearchRow({
        source_key: "flipkart",
        source: getSourceLabel("flipkart"),
        title,
        price,
        image_url: imageMatch ? imageMatch[1] : null,
        product_url: productUrl,
        seller: "Flipkart Marketplace",
      })

      if (row) candidates.push(row)
    }

    if (!candidates.length) return []

    const rankedCandidates = [...candidates]
      .sort((a, b) => scoreSearchRow(b, q) - scoreSearchRow(a, q) || (Number(a.price) || Infinity) - (Number(b.price) || Infinity))
      .slice(0, safeLimit * 2)

    const settled = await Promise.allSettled(
      rankedCandidates.map(async (candidate) => {
        const fetched = await fetchFlipkartProduct({ productUrl: candidate.product_url })
        return fetched || candidate
      }),
    )

    const rows = []
    for (const result of settled) {
      if (result.status !== "fulfilled" || !result.value) continue
      const row = normalizeSearchRow(result.value)
      if (row) rows.push(row)
      if (rows.length >= safeLimit) break
    }

    console.log("search provider=flipkart", JSON.stringify({ query: q, candidates: candidates.length, rows: rows.length }))
    return rows
  } catch {
    return []
  }
}

async function searchMarketplaceProducts(searchTerm, limit, config, filters = {}) {
  const safeLimit = clamp(1, toNumber(limit, 9) || 9, 15)
  const q = String(searchTerm || "").trim()
  if (q.length < 2) return []

  const scrapyBase = String(config?.SCRAPY_API_BASE || "").trim()
  if (!scrapyBase) {
    console.warn("SCRAPY_API_BASE is not configured; returning no live search results")
    return []
  }

  try {
    const apiUrl = new URL(`${scrapyBase}/scrape/search`)
    apiUrl.searchParams.set("q", q)
    apiUrl.searchParams.set("limit", String(safeLimit))
    if (filters?.source) apiUrl.searchParams.set("source", String(filters.source))
    if (filters?.min_rating) apiUrl.searchParams.set("min_rating", String(filters.min_rating))
    if (filters?.availability) apiUrl.searchParams.set("availability", String(filters.availability))

    const response = await requestWithRetries(apiUrl.toString(), {
      headers: { Accept: "application/json,text/plain,*/*" },
    }, { timeoutMs: 12000, retries: 2 })
    if (!response.ok) return []

    const payload = await response.json().catch(() => null)
    const rawRows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : []
    const normalized = rawRows.map(normalizeSearchRow).filter(Boolean)
    const filtered = applySearchFilters(dedupeSearchRows(normalized), filters)
    return filtered.slice(0, safeLimit)
  } catch {
    return []
  }
}

async function fetchRelianceProduct({ externalId = null, productUrl = null } = {}) {
  let itemCode = String(externalId || "").trim()
  if (!itemCode && productUrl) {
    const match = String(productUrl).match(/\/p\/(\d+)/)
    if (match) itemCode = match[1]
  }
  if (!itemCode) return null

  try {
    const url = `https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products/${encodeURIComponent(itemCode)}`
    const response = await requestWithRetries(url, { headers: { ...DESKTOP_BROWSER_HEADERS, Accept: "application/json,text/plain,*/*" } }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    const item = payload?.data || null
    if (!item || typeof item !== "object") return null
    const title = cleanText(item.name)
    const brand = cleanText(item?.brand?.name)
    const price = item?.price?.effective?.min
    const medias = Array.isArray(item.medias) ? item.medias : []
    const imageUrl = normalizeImageUrl(medias.find((media) => media && typeof media === "object" && media.url)?.url || null)
    const slug = item.slug
    const purchaseUrl = productUrl || (slug ? `https://www.reliancedigital.in/${slug}/p/${itemCode}` : null)
    const numericPrice = extractPriceValue(price)
    if (title && Number.isFinite(numericPrice)) {
      return {
        title,
        price: round2(numericPrice),
        image_url: imageUrl,
        brand,
        source_key: "reliance_digital",
        source: getSourceLabel("reliance_digital"),
        purchase_url: purchaseUrl,
        external_id: itemCode,
        fetch_method: "reliance_api",
      }
    }
  } catch {
    // Fall through to proxy fallback.
  }

  try {
    const proxyUrl = toProxyUrl(`https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products/${encodeURIComponent(itemCode)}`)
    if (!proxyUrl) return null
    const response = await requestWithRetries(proxyUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
    })
    if (!response.ok) return null
    const text = await response.text()
    return parseRelianceProxyProduct(text, itemCode, productUrl || null)
  } catch {
    return null
  }
}

async function fetchSnapdealProduct({ productUrl = null } = {}) {
  const normalizedUrl = normalizeProductUrl("snapdeal", productUrl)
  if (!normalizedUrl) return null

  try {
    const response = await requestWithRetries(normalizedUrl, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return null
    const html = await response.text()
    const payloads = extractJsonLdPayloads(html)

    const brand =
      extractBrandFromJsonLd(payloads) ||
      extractMetaContent(html, "property", "product:brand") ||
      extractMetaContent(html, "name", "brand") ||
      extractMetaContent(html, "itemprop", "brand")

    const title = extractMetaContent(html, "property", "og:title") || cleanText(stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || null))

    const priceBlock = html.match(/<span[^>]*class=\"[^\"]*(?:pdp-final-price|payBlkBig)[^\"]*\"[^>]*>([\s\S]*?)<\/span>/i)
    const price = extractPriceValue(priceBlock ? stripTags(priceBlock[1]) : null)
    const imageUrl = normalizeImageUrl(extractMetaContent(html, "property", "og:image"))

    if (!title || !Number.isFinite(price)) return null
    return {
      title,
      price: round2(price),
      image_url: imageUrl,
      brand,
      source_key: "snapdeal",
      source: getSourceLabel("snapdeal"),
      purchase_url: normalizedUrl,
      external_id: extractSnapdealExternalId(normalizedUrl),
      fetch_method: "snapdeal_scraper",
    }
  } catch {
    return null
  }
}

function extractAmazonAsinFromUrl(value) {
  const text = String(value || "")
  const patterns = [/\/dp\/([A-Z0-9]{10})/i, /\/gp\/product\/([A-Z0-9]{10})/i, /asin=([A-Z0-9]{10})/i]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  return null
}

async function fetchAmazonProduct({ asin = null, productUrl = null } = {}) {
  const resolvedAsin = String(asin || "").trim() || extractAmazonAsinFromUrl(productUrl)
  if (!resolvedAsin) return null

  try {
    const url = `https://www.amazon.in/dp/${resolvedAsin}`
    const response = await requestWithRetries(url, { headers: MOBILE_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 3 })
    if (!response.ok) return null
    const html = await response.text()
    const payloads = extractJsonLdPayloads(html)

    const titleMatch = html.match(/<span[^>]*id=\"productTitle\"[^>]*>([\s\S]*?)<\/span>/i)
    const title = cleanText(stripTags(titleMatch ? titleMatch[1] : null)) || extractMetaContent(html, "property", "og:title")
    const price = extractFirstPriceFromHtml(html)
    const imageUrl = normalizeImageUrl(extractMetaContent(html, "property", "og:image"))
    const brand = extractBrandFromJsonLd(payloads)
    const rating = extractRatingFromJsonLd(payloads)
    const availability = extractAvailabilityFromJsonLd(payloads) || extractAvailabilityFromHtml(html)
    const featureSummary = extractFeatureSummary(html)

    if (title && Number.isFinite(price)) {
      return {
        asin: resolvedAsin,
        title,
        price: round2(price),
        image_url: imageUrl,
        brand,
        rating,
        availability,
        feature_summary: featureSummary,
        source_key: "amazon",
        source: getSourceLabel("amazon"),
        purchase_url: url,
        external_id: resolvedAsin,
        fetch_method: "scraper",
      }
    }
  } catch {
    // Fall through to proxy fallback.
  }

  try {
    const proxyUrl = toProxyUrl(`https://www.amazon.in/dp/${resolvedAsin}`)
    if (!proxyUrl) return null
    const response = await requestWithRetries(proxyUrl, {
      headers: { Accept: "text/plain,text/markdown,*/*" },
    })
    if (!response.ok) return null
    const text = await response.text()
    return parseAmazonProxyProduct(text, resolvedAsin, `https://www.amazon.in/dp/${resolvedAsin}`)
  } catch {
    // Fall through to search fallback.
  }

  try {
    const fallbackQuery = (() => {
      try {
        const parsed = new URL(productUrl || `https://www.amazon.in/dp/${resolvedAsin}`)
        return String(parsed.searchParams.get("keywords") || "").trim() || String(parsed.pathname.split("/").filter(Boolean).slice(0, 2).join(" ")).trim() || resolvedAsin
      } catch {
        return resolvedAsin
      }
    })()

    const searchRows = await searchAmazonProducts(fallbackQuery, 5)
    const exactMatch = searchRows.find((row) => String(row.asin || row.external_id || "").toUpperCase() === resolvedAsin.toUpperCase())
    const candidate = exactMatch || searchRows[0] || null
    if (!candidate || !Number.isFinite(Number(candidate.price))) return null

    return {
      asin: resolvedAsin,
      title: candidate.title,
      price: round2(candidate.price),
      image_url: candidate.image_url || null,
      brand: candidate.brand || null,
      rating: candidate.rating || null,
      availability: candidate.availability || null,
      feature_summary: candidate.feature_summary || null,
      source_key: "amazon",
      source: getSourceLabel("amazon"),
      purchase_url: `https://www.amazon.in/dp/${resolvedAsin}`,
      external_id: resolvedAsin,
      fetch_method: "amazon_search_fallback",
    }
  } catch {
    return null
  }
}

async function fetchGenericProduct({ productUrl = null } = {}) {
  const normalizedUrl = normalizeProductUrl("generic", productUrl) || (productUrl ? String(productUrl).trim() : null)
  if (!normalizedUrl || !/^https?:\/\//i.test(normalizedUrl)) return null

  try {
    const response = await requestWithRetries(normalizedUrl, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 2 })
    if (!response.ok) return null
    const html = await response.text()
    const payloads = extractJsonLdPayloads(html)
    const title =
      extractMetaContent(html, "property", "og:title") ||
      extractMetaContent(html, "name", "title") ||
      cleanText(stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || null))
    const brand = extractBrandFromJsonLd(payloads)
    const jsonLdPrice = extractPriceFromJsonLd(payloads)
    const rating = extractRatingFromJsonLd(payloads)
    const availability = extractAvailabilityFromJsonLd(payloads) || extractAvailabilityFromHtml(html)
    const featureSummary = extractFeatureSummary(html)
    const metaPrice =
      extractPriceValue(extractMetaContent(html, "property", "product:price:amount")) ||
      extractPriceValue(extractMetaContent(html, "property", "og:price:amount")) ||
      extractPriceValue(extractMetaContent(html, "name", "price"))
    const price = jsonLdPrice ?? metaPrice
    const imageUrl = normalizeImageUrl(extractMetaContent(html, "property", "og:image"))

    if (!title || !Number.isFinite(price)) return null
    return {
      title,
      price: round2(price),
      image_url: imageUrl,
      brand,
      rating,
      availability,
      feature_summary: featureSummary,
      source_key: "generic",
      source: getSourceLabel("generic"),
      purchase_url: normalizedUrl,
      external_id: null,
      fetch_method: "generic",
    }
  } catch {
    return null
  }
}

async function fetchFlipkartProduct({ productUrl = null } = {}) {
  const normalizedUrl = normalizeProductUrl("flipkart", productUrl)
  if (!normalizedUrl) return null

  try {
    const response = await requestWithRetries(normalizedUrl, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 2 })
    if (!response.ok) return null
    const html = await response.text()
    const title =
      extractMetaContent(html, "property", "og:title") ||
      extractMetaContent(html, "name", "title") ||
      cleanText(stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || null))
    const price =
      extractPriceValue(extractMetaContent(html, "property", "product:price:amount")) ||
      extractPriceValue(extractMetaContent(html, "property", "og:price:amount")) ||
      extractFirstCurrencyValue(html)
    const imageUrl = normalizeImageUrl(extractMetaContent(html, "property", "og:image"))
    const brand = cleanText(extractMetaContent(html, "property", "product:brand") || extractMetaContent(html, "name", "brand"))
    const payloads = extractJsonLdPayloads(html)
    const rating = extractRatingFromJsonLd(payloads)
    const availability = extractAvailabilityFromJsonLd(payloads) || extractAvailabilityFromHtml(html)
    const featureSummary = extractFeatureSummary(html)

    if (!title || !Number.isFinite(price)) return null
    return {
      title,
      price: round2(price),
      image_url: imageUrl,
      brand,
      rating,
      availability,
      feature_summary: featureSummary,
      source_key: "flipkart",
      source: getSourceLabel("flipkart"),
      purchase_url: normalizedUrl,
      external_id: extractFlipkartExternalId(normalizedUrl),
      fetch_method: "flipkart_scraper",
    }
  } catch {
    return null
  }
}

async function fetchPriceRunnerProduct({ productUrl = null } = {}) {
  const normalizedUrl = normalizeProductUrl("pricerunner", productUrl)
  if (!normalizedUrl) return null

  try {
    const response = await requestWithRetries(normalizedUrl, { headers: DESKTOP_BROWSER_HEADERS }, { timeoutMs: 15000, retries: 2 })
    if (!response.ok) return null
    const html = await response.text()
    const title =
      extractMetaContent(html, "property", "og:title") ||
      extractMetaContent(html, "name", "title") ||
      cleanText(stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || null))
    const price =
      extractPriceValue(extractMetaContent(html, "property", "product:price:amount")) ||
      extractPriceValue(extractMetaContent(html, "property", "og:price:amount")) ||
      extractFirstCurrencyValue(html)
    const imageUrl = normalizeImageUrl(extractMetaContent(html, "property", "og:image"))
    const brand = cleanText(extractMetaContent(html, "property", "product:brand") || extractMetaContent(html, "name", "brand"))
    const payloads = extractJsonLdPayloads(html)
    const rating = extractRatingFromJsonLd(payloads)
    const availability = extractAvailabilityFromJsonLd(payloads) || extractAvailabilityFromHtml(html)
    const featureSummary = extractFeatureSummary(html)

    if (!title || !Number.isFinite(price)) return null
    return {
      title,
      price: round2(price),
      image_url: imageUrl,
      brand,
      rating,
      availability,
      feature_summary: featureSummary,
      source_key: "pricerunner",
      source: getSourceLabel("pricerunner"),
      purchase_url: normalizedUrl,
      external_id: extractPriceRunnerExternalId(normalizedUrl),
      fetch_method: "pricerunner_scraper",
    }
  } catch {
    return null
  }
}

function nextSyntheticPrice(productId, lastPrice, targetMax) {
  const baseline = Number.isFinite(lastPrice) ? lastPrice : Number.isFinite(targetMax) ? targetMax * 1.1 : 1999
  const signal = Math.sin((Date.now() / 60000 + Number(productId)) * 0.7)
  const pct = clamp(-0.06, signal * 0.04, 0.06)
  return round2(Math.max(1, baseline * (1 + pct)))
}

async function fetchLiveSnapshot(product, fetchMode = "auto") {
  const sourceKey = normalizeSourceKey(product?.source_key)
  const productUrl = product?.product_url || null
  const asin = product?.asin || null
  const externalId = product?.external_id || null

  if (fetchMode === "zyte-only") {
    return null
  }

  return {
    sourceKey,
    productUrl,
    asin,
    externalId,
  }
}

async function recordPriceSnapshot(db, product, snapshot, timestamp) {
  await db
    .prepare("INSERT INTO price_history (product_id, price, fetch_method, timestamp) VALUES (?1, ?2, ?3, ?4)")
    .bind(product.id, snapshot.price, snapshot.fetch_method || null, timestamp)
    .run()

  await db
    .prepare(
      "UPDATE products SET last_updated = ?1, last_fetch_method = ?2, image_url = COALESCE(image_url, ?3), brand = COALESCE(brand, ?4) WHERE id = ?5",
    )
    .bind(timestamp, snapshot.fetch_method || null, snapshot.image_url || null, snapshot.brand || null, product.id)
    .run()
}

async function seedInitialPrice(db, env, config, product, { fetchMode = "auto" } = {}) {
  const timestamp = nowIso()
  const seedInput = await fetchLiveSnapshot(product, fetchMode)
  const snapshot = await fetchScrapySnapshot(config, seedInput)
  if (fetchMode === "zyte-only" && !snapshot) {
    throw new Error("Zyte-only fetch mode is enabled but Zyte integration is not configured.")
  }
  if (snapshot && Number.isFinite(snapshot.price)) {
    await recordPriceSnapshot(db, product, snapshot, timestamp)
    return snapshot
  }

  if (!config?.ALLOW_SYNTHETIC) {
    return null
  }

  const fallbackPrice = round2(Number(product.target_price_max) * 1.1)
  const seeded = {
    price: Number.isFinite(fallbackPrice) ? fallbackPrice : 1999,
    fetch_method: "seed",
    image_url: product.image_url || null,
    brand: product.brand || null,
  }
  await recordPriceSnapshot(db, product, seeded, timestamp)
  return seeded
}

async function refreshAndTrigger(db, env, config, product, { fetchMode = "auto" } = {}) {
  const latest = await db
    .prepare("SELECT id, price, timestamp FROM price_history WHERE product_id = ?1 ORDER BY timestamp DESC LIMIT 1")
    .bind(product.id)
    .first()

  const timestamp = nowIso()
  const liveInput = await fetchLiveSnapshot(product, fetchMode)
  const snapshot = await fetchScrapySnapshot(config, liveInput)

  if (fetchMode === "zyte-only" && !snapshot) {
    throw new Error("Zyte-only fetch mode is enabled but Zyte integration is not configured.")
  }

  if (snapshot && Number.isFinite(snapshot.price)) {
    await recordPriceSnapshot(db, product, snapshot, timestamp)
  } else if (config?.ALLOW_SYNTHETIC) {
    const price = nextSyntheticPrice(product.id, latest ? Number(latest.price) : null, Number(product.target_price_max))
    await recordPriceSnapshot(
      db,
      product,
      {
        price,
        fetch_method: "synthetic_fallback",
        image_url: product.image_url || null,
        brand: product.brand || null,
      },
      timestamp,
    )
  } else {
    throw new Error("Live price fetch failed for this product and synthetic fallbacks are disabled.")
  }

  const latestEntry = await db
    .prepare("SELECT id, product_id, price, fetch_method, timestamp FROM price_history WHERE product_id = ?1 ORDER BY id DESC LIMIT 1")
    .bind(product.id)
    .first()

  const price = Number(latestEntry?.price)
  if (!Number.isFinite(price)) return latestEntry

  const pendingAlerts = await db
    .prepare("SELECT * FROM alerts WHERE product_id = ?1 AND triggered_flag = 0 ORDER BY created_at DESC")
    .bind(product.id)
    .all()

  const alerts = pendingAlerts.results || []
  for (const alert of alerts) {
    const threshold = Number(alert.target_price_max)
    if (!Number.isFinite(threshold)) continue
    if (price <= threshold) {
      await db
        .prepare("UPDATE alerts SET triggered_flag = 1, triggered_at = ?1, notification_sent_flag = 0, notification_error = ?2 WHERE id = ?3")
        .bind(timestamp, null, alert.id)
        .run()
    }
  }

  await deliverPendingTelegramAlerts(db, env, product.id, price, timestamp)

  return latestEntry
}

async function fetchScrapySnapshot(config, input) {
  const scrapyBase = String(config?.SCRAPY_API_BASE || "").trim()
  if (!scrapyBase || !input || typeof input !== "object") return null

  try {
    const response = await requestWithRetries(
      `${scrapyBase}/scrape/snapshot`,
      {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json,text/plain,*/*" },
        body: JSON.stringify({
          source_key: input.sourceKey,
          product_url: input.productUrl,
          asin: input.asin,
          external_id: input.externalId,
        }),
      },
      { timeoutMs: 12000, retries: 2 },
    )
    if (!response.ok) return null

    const payload = await response.json().catch(() => null)
    const snapshot = payload?.snapshot || payload
    const price = toNumber(snapshot?.price, null)
    if (!Number.isFinite(price) || price <= 0) return null

    return {
      price: round2(price),
      fetch_method: cleanText(snapshot?.fetch_method) || "scrapy_api",
      image_url: normalizeImageUrl(snapshot?.image_url),
      brand: cleanText(snapshot?.brand),
    }
  } catch {
    return null
  }
}

async function routeRequest(request, env) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()
  const db = env.DB
  const config = getConfig(env)

  if (!db) {
    return json({ detail: "D1 binding `DB` is missing. Configure wrangler.toml with a real database_id." }, 500)
  }

  await ensureSchema(db)

  if (path === "/" && method === "GET") {
    return json({ message: "PricePulse Cloudflare API is running." })
  }

  if (path === "/healthz" && method === "GET") {
    return json({ status: "ok" })
  }

  if (path === "/notifications/status" && method === "GET") {
    const telegramConfigured = isTelegramConfigured(env)
    return json({
      telegram_configured: telegramConfigured,
      email_configured: false,
      channels: { telegram: telegramConfigured, email: false },
    })
  }

  if (path === "/notifications/test" && method === "POST") {
    if (!isTelegramConfigured(env)) {
      return json({
        sent: false,
        detail: "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
      })
    }

    const message = [
      "PricePulse test",
      "",
      "If you're reading this, Telegram is configured for PricePulse.",
      `Time: ${nowIso()}`,
    ].join("\n")

    const result = await sendTelegramMessage(env, message)
    return json({
      sent: result.sent,
      detail: result.sent ? "Telegram test sent." : result.error || "Telegram test failed.",
    })
  }

  if (path === "/products/search" && method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim()
    const limit = url.searchParams.get("limit")
    const filters = {
      source: url.searchParams.get("source"),
      min_rating: url.searchParams.get("min_rating"),
      availability: url.searchParams.get("availability"),
    }
    if (q.length < 2) return json([])
    const results = await searchMarketplaceProducts(q, limit, config, filters)
    return json(results)
  }

  if (path === "/products" && method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim()
    const stmt = q
      ? db.prepare("SELECT * FROM products WHERE LOWER(name) LIKE ?1 ORDER BY created_at DESC").bind(`%${q.toLowerCase()}%`)
      : db.prepare("SELECT * FROM products ORDER BY created_at DESC")
    const rows = await stmt.all()
    const products = []
    for (const row of rows.results || []) {
      products.push(await attachInsights(db, row))
    }
    return json(products)
  }

  if (path === "/products" && method === "POST") {
    const body = await parseJson(request)
    const fetchMode = getFetchModeFromRequest(request)
    const productName = String(body?.product_name || "").trim()
    const targetMin = toNumber(body?.target_price_min, null)
    const targetMax = toNumber(body?.target_price_max, null)
    const refreshInterval = clamp(
      config.MIN_REFRESH_MINUTES,
      toNumber(body?.refresh_interval_minutes, config.DEFAULT_REFRESH_MINUTES) || config.DEFAULT_REFRESH_MINUTES,
      20160,
    )

    if (!productName) return json({ detail: "product_name is required" }, 400)
    if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin <= 0 || targetMax <= 0) {
      return json({ detail: "Target prices must be positive numbers." }, 400)
    }
    if (targetMin > targetMax) return json({ detail: "target_price_min must be <= target_price_max" }, 400)

    const timestamp = nowIso()
    const sourceKey = normalizeSourceKey(body?.source_key || "generic")
    const source = body?.source || getSourceLabel(sourceKey)

    const result = await db
      .prepare(
        `INSERT INTO products
          (name, asin, source_key, external_id, product_url, image_url, brand, source, refresh_interval_minutes,
           target_price, target_price_min, target_price_max, last_fetch_method, last_updated, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      )
      .bind(
        productName,
        body?.asin || null,
        sourceKey,
        body?.external_id || null,
        body?.product_url || null,
        body?.image_url || null,
        body?.brand || null,
        source,
        refreshInterval,
        targetMax,
        targetMin,
        targetMax,
        null,
        null,
        timestamp,
      )
      .run()

    const productId = result.meta.last_row_id
    let created = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    try {
      await seedInitialPrice(db, env, config, created, { fetchMode })
    } catch (error) {
      await db.prepare("DELETE FROM products WHERE id = ?1").bind(productId).run()
      return json({ detail: error instanceof Error ? error.message : String(error) }, 400)
    }

    created = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    return json(await attachInsights(db, created), 201)
  }

  if (path === "/products/from-url" && method === "POST") {
    const body = await parseJson(request)
    const fetchMode = getFetchModeFromRequest(request)
    const rawUrl = String(body?.url || "").trim()
    const targetMin = toNumber(body?.target_price_min, null)
    const targetMax = toNumber(body?.target_price_max, null)
    const refreshInterval = clamp(
      config.MIN_REFRESH_MINUTES,
      toNumber(body?.refresh_interval_minutes, config.DEFAULT_REFRESH_MINUTES) || config.DEFAULT_REFRESH_MINUTES,
      20160,
    )

    if (!rawUrl) return json({ detail: "Provide a valid url" }, 400)
    let normalizedUrl = rawUrl
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`
    try {
      new URL(normalizedUrl)
    } catch {
      return json({ detail: "Provide a valid url" }, 400)
    }

    if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin <= 0 || targetMax <= 0) {
      return json({ detail: "Target prices must be positive numbers." }, 400)
    }
    if (targetMin > targetMax) return json({ detail: "target_price_min must be <= target_price_max" }, 400)

    const inferred = inferSourceFromUrl(normalizedUrl)
    const inferredSourceKey = normalizeSourceKey(inferred.source_key)
    const inferredAsin = inferredSourceKey === "amazon" ? extractAmazonAsinFromUrl(normalizedUrl) : null
    const inferredExternalId =
      inferredSourceKey === "reliance_digital"
        ? String(normalizedUrl).match(/\/p\/(\d+)/)?.[1] || null
        : inferredSourceKey === "snapdeal"
          ? extractSnapdealExternalId(normalizedUrl)
          : inferredAsin

    const timestamp = nowIso()
    const suggestedName = (() => {
      try {
        const u = new URL(normalizedUrl)
        const slug = u.pathname.split("/").filter(Boolean).slice(-1)[0] || u.hostname
        return decodeURIComponent(slug).replace(/[-_]+/g, " ").slice(0, 120) || "Tracked product"
      } catch {
        return "Tracked product"
      }
    })()

    const result = await db
      .prepare(
        `INSERT INTO products
          (name, source_key, external_id, product_url, source, refresh_interval_minutes, target_price, target_price_min, target_price_max, last_fetch_method, last_updated, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        suggestedName,
        inferredSourceKey,
        inferredExternalId || `${inferredSourceKey}-${Date.now()}`,
        normalizedUrl,
        getSourceLabel(inferredSourceKey),
        refreshInterval,
        targetMax,
        targetMin,
        targetMax,
        null,
        null,
        timestamp,
      )
      .run()

    const productId = result.meta.last_row_id
    let created = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    if (inferredAsin) {
      await db.prepare("UPDATE products SET asin = ?1 WHERE id = ?2").bind(inferredAsin, productId).run()
      created = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    }

    try {
      await seedInitialPrice(db, env, config, created, { fetchMode })
    } catch (error) {
      await db.prepare("DELETE FROM products WHERE id = ?1").bind(productId).run()
      return json({ detail: error instanceof Error ? error.message : String(error) }, 400)
    }

    created = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    return json(await attachInsights(db, created), 201)
  }

  const productTargetMatch = path.match(/^\/products\/(\d+)\/target$/)
  if (productTargetMatch && method === "PATCH") {
    const productId = Number(productTargetMatch[1])
    const body = await parseJson(request)
    const targetMin = toNumber(body?.target_price_min, null)
    const targetMax = toNumber(body?.target_price_max, null)
    if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin <= 0 || targetMax <= 0) {
      return json({ detail: "Target prices must be positive numbers" }, 400)
    }
    if (targetMin > targetMax) return json({ detail: "target_price_min must be <= target_price_max" }, 400)

    const existing = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    if (!existing) return json({ detail: "Product not found" }, 404)

    await db
      .prepare("UPDATE products SET target_price = ?1, target_price_min = ?2, target_price_max = ?3 WHERE id = ?4")
      .bind(targetMax, targetMin, targetMax, productId)
      .run()
    const updated = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    return json(await attachInsights(db, updated))
  }

  const productRefreshMatch = path.match(/^\/products\/(\d+)\/refresh$/)
  if (productRefreshMatch && method === "POST") {
    const productId = Number(productRefreshMatch[1])
    const existing = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    if (!existing) return json({ detail: "Product not found" }, 404)
    const fetchMode = getFetchModeFromRequest(request)
    const entry = await refreshAndTrigger(db, env, config, existing, { fetchMode })
    return json(entry)
  }

  const productHistoryMatch = path.match(/^\/products\/(\d+)\/history$/)
  if (productHistoryMatch && method === "GET") {
    const productId = Number(productHistoryMatch[1])
    const existing = await db.prepare("SELECT id FROM products WHERE id = ?1").bind(productId).first()
    if (!existing) return json({ detail: "Product not found" }, 404)

    const days = toNumber(url.searchParams.get("days"), null)
    const limit = clamp(1, toNumber(url.searchParams.get("limit"), 200) || 200, 500)
    const rows = await getProductHistory(db, productId, { days, limit, descending: true })
    return json(rows)
  }

  const productIdMatch = path.match(/^\/products\/(\d+)$/)
  if (productIdMatch && method === "GET") {
    const productId = Number(productIdMatch[1])
    const existing = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    if (!existing) return json({ detail: "Product not found" }, 404)
    return json(await attachInsights(db, existing))
  }

  if (productIdMatch && method === "DELETE") {
    const productId = Number(productIdMatch[1])
    const existing = await db.prepare("SELECT id FROM products WHERE id = ?1").bind(productId).first()
    if (!existing) return json({ detail: "Product not found" }, 404)
    await db.prepare("DELETE FROM price_history WHERE product_id = ?1").bind(productId).run()
    await db.prepare("DELETE FROM alerts WHERE product_id = ?1").bind(productId).run()
    await db.prepare("DELETE FROM products WHERE id = ?1").bind(productId).run()
    return json({ deleted: true, product_id: productId })
  }

  if (path === "/alerts" && method === "GET") {
    const triggeredOnly = String(url.searchParams.get("triggered_only") || "").toLowerCase() === "true"
    const productId = toNumber(url.searchParams.get("product_id"), null)
    let sql = "SELECT * FROM alerts"
    const args = []
    const where = []
    if (triggeredOnly) {
      where.push("triggered_flag = 1")
    }
    if (Number.isFinite(productId)) {
      where.push("product_id = ?")
      args.push(productId)
    }
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`
    sql += " ORDER BY created_at DESC"
    const alerts = await db.prepare(sql).bind(...args).all()
    return json(alerts.results || [])
  }

  if (path === "/alerts" && method === "POST") {
    const body = await parseJson(request)
    const productId = toNumber(body?.product_id, null)
    const targetMin = toNumber(body?.target_price_min, null)
    const targetMax = toNumber(body?.target_price_max, null)
    if (!Number.isFinite(productId) || productId <= 0) return json({ detail: "product_id is required" }, 400)
    if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin <= 0 || targetMax <= 0) {
      return json({ detail: "Target prices must be positive numbers" }, 400)
    }
    if (targetMin > targetMax) return json({ detail: "target_price_min must be <= target_price_max" }, 400)

    const product = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(productId).first()
    if (!product) return json({ detail: "Product not found" }, 404)

    const existingPending = await db
      .prepare("SELECT * FROM alerts WHERE product_id = ?1 AND triggered_flag = 0 ORDER BY created_at DESC LIMIT 1")
      .bind(productId)
      .first()
    const timestamp = nowIso()

    let alertId
    if (existingPending) {
      await db
        .prepare(
          `UPDATE alerts
            SET target_price = ?1, target_price_min = ?2, target_price_max = ?3,
                telegram_enabled = ?4, browser_enabled = ?5, alarm_enabled = ?6, email_enabled = ?7,
                notification_sent_flag = 0, notification_sent_at = NULL, notification_error = NULL, created_at = ?8
          WHERE id = ?9`,
        )
        .bind(
          targetMax,
          targetMin,
          targetMax,
          toBoolInt(body?.telegram_enabled, 1),
          toBoolInt(body?.browser_enabled, 0),
          toBoolInt(body?.alarm_enabled, 0),
          toBoolInt(body?.email_enabled, 0),
          timestamp,
          existingPending.id,
        )
        .run()
      alertId = existingPending.id
    } else {
      const created = await db
        .prepare(
          `INSERT INTO alerts
            (product_id, target_price, target_price_min, target_price_max, telegram_enabled, browser_enabled, alarm_enabled, email_enabled, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          productId,
          targetMax,
          targetMin,
          targetMax,
          toBoolInt(body?.telegram_enabled, 1),
          toBoolInt(body?.browser_enabled, 0),
          toBoolInt(body?.alarm_enabled, 0),
          toBoolInt(body?.email_enabled, 0),
          timestamp,
        )
        .run()
      alertId = created.meta.last_row_id
    }

    const latestPriceRow = await db
      .prepare("SELECT price FROM price_history WHERE product_id = ?1 ORDER BY timestamp DESC LIMIT 1")
      .bind(productId)
      .first()
    const latestPrice = toNumber(latestPriceRow?.price, null)
    if (Number.isFinite(latestPrice) && latestPrice <= targetMax) {
      await db
        .prepare("UPDATE alerts SET triggered_flag = 1, triggered_at = ?1, notification_sent_flag = 0, notification_error = ?2 WHERE id = ?3")
        .bind(timestamp, null, alertId)
        .run()

      await deliverPendingTelegramAlerts(db, env, productId, latestPrice, timestamp)
    }

    const alert = await db.prepare("SELECT * FROM alerts WHERE id = ?1").bind(alertId).first()
    return json(alert, existingPending ? 200 : 201)
  }

  const alertIdMatch = path.match(/^\/alerts\/(\d+)$/)
  if (alertIdMatch && method === "PATCH") {
    const alertId = Number(alertIdMatch[1])
    const body = await parseJson(request)
    const targetMin = toNumber(body?.target_price_min, null)
    const targetMax = toNumber(body?.target_price_max, null)

    if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin <= 0 || targetMax <= 0) {
      return json({ detail: "Target prices must be positive numbers" }, 400)
    }
    if (targetMin > targetMax) return json({ detail: "target_price_min must be <= target_price_max" }, 400)

    const existing = await db.prepare("SELECT * FROM alerts WHERE id = ?1").bind(alertId).first()
    if (!existing) return json({ detail: "Alert not found" }, 404)

    await db
      .prepare(
        `UPDATE alerts
         SET target_price = ?1, target_price_min = ?2, target_price_max = ?3,
             telegram_enabled = ?4, browser_enabled = ?5, alarm_enabled = ?6, email_enabled = ?7,
             notification_error = NULL
         WHERE id = ?8`,
      )
      .bind(
        targetMax,
        targetMin,
        targetMax,
        toBoolInt(body?.telegram_enabled, existing.telegram_enabled),
        toBoolInt(body?.browser_enabled, existing.browser_enabled),
        toBoolInt(body?.alarm_enabled, existing.alarm_enabled),
        toBoolInt(body?.email_enabled, existing.email_enabled),
        alertId,
      )
      .run()

    const updated = await db.prepare("SELECT * FROM alerts WHERE id = ?1").bind(alertId).first()
    return json(updated)
  }

  if (alertIdMatch && method === "DELETE") {
    const alertId = Number(alertIdMatch[1])
    const existing = await db.prepare("SELECT id FROM alerts WHERE id = ?1").bind(alertId).first()
    if (!existing) return json({ detail: "Alert not found" }, 404)

    await db.prepare("DELETE FROM alerts WHERE id = ?1").bind(alertId).run()
    return json({ deleted: true, alert_id: alertId })
  }

  return json({ detail: "Not Found" }, 404)
}

async function runScheduledRefresh(env) {
  const db = env.DB
  if (!db) return

  const config = getConfig(env)
  await ensureSchema(db)

  const maxPerRun = config.MAX_CRON_REFRESHES_PER_RUN
  const nowMs = Date.now()

  const rows = await db.prepare("SELECT * FROM products ORDER BY created_at DESC").all()
  const products = rows.results || []

  let refreshed = 0
  for (const product of products) {
    if (refreshed >= maxPerRun) break
    const intervalMinutes = clamp(
      config.MIN_REFRESH_MINUTES,
      toNumber(product.refresh_interval_minutes, config.DEFAULT_REFRESH_MINUTES) || config.DEFAULT_REFRESH_MINUTES,
      20160,
    )
    const lastTs = product.last_updated || product.created_at
    const lastMs = Date.parse(String(lastTs || ""))
    const due = !Number.isFinite(lastMs) || nowMs - lastMs >= intervalMinutes * 60 * 1000
    if (!due) continue

    try {
      await refreshAndTrigger(db, env, config, product, { fetchMode: "auto" })
      refreshed += 1
    } catch (error) {
      console.warn(
        "Scheduled refresh failed",
        JSON.stringify({ product_id: product.id, source_key: product.source_key, error: error instanceof Error ? error.message : String(error) }),
      )
    }
  }

  console.log("Scheduled refresh complete", JSON.stringify({ refreshed, total_products: products.length }))
}

export default {
  async fetch(request, env) {
    const config = getConfig(env)
    const cors = corsHeadersForRequest(request, config)

    if (request.method.toUpperCase() === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      const response = await routeRequest(request, env)
      const headers = new Headers(response.headers)
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value))
      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      return json(
        {
          detail: "Internal server error",
          error: error instanceof Error ? error.message : String(error),
        },
        500,
        cors,
      )
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledRefresh(env))
  },
}
