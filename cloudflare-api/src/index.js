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
  generic: "Website",
}

const ALLOWED_DOMAINS = {
  amazon: ["amazon.in", "www.amazon.in"],
  flipkart: ["flipkart.com", "www.flipkart.com"],
  reliance_digital: ["reliancedigital.in", "www.reliancedigital.in"],
  snapdeal: ["snapdeal.com", "www.snapdeal.com"],
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
    ALLOW_SYNTHETIC: toBool(readEnvValue(env, ["ALLOW_SYNTHETIC", "PRICEPULSE_ALLOW_SYNTHETIC"], true), true),
    NOTIFICATIONS_CONFIGURED: toBool(env.NOTIFICATIONS_CONFIGURED, false),
    CORS_ORIGINS: corsOrigins.length ? corsOrigins : ["*"],
    CORS_ALLOW_ALL: allowAllCors,
    TELEGRAM_API_BASE: String(readEnvValue(env, ["TELEGRAM_API_BASE", "PRICEPULSE_TELEGRAM_API_BASE"], "https://api.telegram.org") || "https://api.telegram.org")
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

function buildPurchaseUrl(product) {
  if (product?.product_url) return product.product_url
  if (product?.asin) return `https://www.amazon.in/dp/${product.asin}`
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
  const marketplaces = [
    { source: getSourceLabel("amazon"), source_key: "amazon" },
    { source: getSourceLabel("flipkart"), source_key: "flipkart" },
    { source: getSourceLabel("reliance_digital"), source_key: "reliance_digital" },
    { source: getSourceLabel("snapdeal"), source_key: "snapdeal" },
  ]
  const base = 1200 + Math.abs(Array.from(q).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 2500)
  const rows = []
  for (let i = 0; i < safeLimit; i += 1) {
    const m = marketplaces[i % marketplaces.length]
    const price = round2(base * (0.9 + ((i % 5) + 1) * 0.03))
    rows.push({
      title: `${q} - ${m.source} option ${i + 1}`,
      price,
      source: m.source,
      source_key: m.source_key,
      seller: m.source,
      asin: m.source_key === "amazon" ? `CF${String(100000000 + i).slice(0, 8)}` : null,
      external_id: `${m.source_key}-${q.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i + 1}`,
      product_url: `https://example.com/${m.source_key}/${encodeURIComponent(q)}-${i + 1}`,
      image_url: null,
      brand: null,
    })
  }
  return rows
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
  const price = toNumber(row.price, null)
  const productUrl = normalizeProductUrl(sourceKey, row.product_url)
  if (!title || !Number.isFinite(price) || price <= 0 || !productUrl) return null
  if (!isAllowedStoreUrl(sourceKey, productUrl)) return null

  return {
    ...row,
    source_key: sourceKey,
    source: row.source || getSourceLabel(sourceKey),
    title,
    price: round2(price),
    product_url: productUrl,
    image_url: normalizeImageUrl(row.image_url),
    seller: cleanText(row.seller) || row.source || getSourceLabel(sourceKey),
    external_id: row.external_id != null ? String(row.external_id) : null,
    asin: row.asin != null ? String(row.asin) : null,
    brand: cleanText(row.brand),
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
    return rows
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

    return rows
  } catch {
    return []
  }
}

async function searchMarketplaceProducts(searchTerm, limit, config) {
  const safeLimit = clamp(1, toNumber(limit, 9) || 9, 15)
  const q = String(searchTerm || "").trim()
  if (q.length < 2) return []

  const providers = [searchAmazonProducts, searchRelianceProducts, searchSnapdealProducts]
  const perSource = Math.max(1, Math.ceil(safeLimit / providers.length))

  const settled = await Promise.allSettled(providers.map((provider) => provider(q, perSource)))
  const rows = []
  for (const result of settled) {
    if (result.status !== "fulfilled") continue
    if (Array.isArray(result.value)) rows.push(...result.value)
  }

  const ranked = dedupeSearchRows(rows)
    .map(normalizeSearchRow)
    .filter(Boolean)
    .sort((a, b) => (a.price || Infinity) - (b.price || Infinity))
    .slice(0, safeLimit)

  if (ranked.length) return ranked
  if (config?.ALLOW_SYNTHETIC) return syntheticSearchResults(q, safeLimit)
  return []
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
    if (!title || !Number.isFinite(numericPrice)) return null
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

    if (!title || !Number.isFinite(price)) return null
    return {
      asin: resolvedAsin,
      title,
      price: round2(price),
      image_url: imageUrl,
      brand,
      source_key: "amazon",
      source: getSourceLabel("amazon"),
      purchase_url: url,
      external_id: resolvedAsin,
      fetch_method: "scraper",
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
    // Zyte integration is optional and wired later; treat this as a strict mode.
    return null
  }

  if (sourceKey === "reliance_digital") {
    return fetchRelianceProduct({ externalId, productUrl })
  }

  if (sourceKey === "snapdeal") {
    return fetchSnapdealProduct({ productUrl })
  }

  if (sourceKey === "amazon") {
    return fetchAmazonProduct({ asin, productUrl })
  }

  return fetchGenericProduct({ productUrl })
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
  const snapshot = await fetchLiveSnapshot(product, fetchMode)
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
  const snapshot = await fetchLiveSnapshot(product, fetchMode)

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
    if (q.length < 2) return json([])
    const results = await searchMarketplaceProducts(q, limit, config)
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
