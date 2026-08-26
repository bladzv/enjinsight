// Simple, cautious proxy for Vercel serverless functions.
// Usage: POST /api/https%3A%2F%2Fenjin.api.subscan.io%2Fapi%2Fscan%2F...
// Security: set PROXY_ALLOWLIST and optionally PROXY_SECRET.
// Body parsing is disabled so the raw request body is forwarded unchanged.
// The Subscan API key is injected server-side from SUBSCAN_API_KEY env var.
export const config = { api: { bodyParser: false } }

/** Maximum raw body size accepted from the client (32 KB — well above any API payload). */
const MAX_BODY_BYTES = 32 * 1024

// ── CORS origin allowlist ─────────────────────────────────────────────────────
// This proxy injects server-side API keys (Subscan, Etherscan, Alchemy, OpenSea)
// into upstream requests, so it must never serve arbitrary cross-origin callers.
// Reflecting the request's `Origin` — the previous behaviour — is the most
// permissive CORS policy possible, and made this a public, credential-lending
// API that any website could use to burn the deployment's API quota.
//
// Allowed origins are derived from the deployment itself (Vercel supplies these
// as bare hosts), plus an optional ALLOWED_ORIGINS list for custom domains, plus
// localhost outside production. No domain is hardcoded.
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

const ALLOWED_ORIGINS = (() => {
  const origins = new Set()
  const add = (value) => {
    const trimmed = String(value || '').trim().replace(/\/+$/, '')
    if (trimmed) origins.add(trimmed)
  }

  const explicit = (process.env.ALLOWED_ORIGINS || '').split(',')
  explicit.forEach(add)

  // Vercel system env vars carry a bare host; the deployment is always https.
  const vercelHosts = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]
  vercelHosts.forEach((host) => {
    if (host) add(`https://${String(host).replace(/^https?:\/\//, '')}`)
  })

  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
  if (!isProd) DEV_ORIGINS.forEach(add)

  return origins
})()

/**
 * Classify the request's Origin.
 *   'same-origin' — no Origin header. Browsers omit it for same-origin GET/HEAD
 *                   and non-browser clients never send it; there is nothing to grant.
 *   'allowed'     — cross-origin and on the allowlist.
 *   'denied'      — cross-origin and not on the allowlist.
 */
function classifyOrigin(req) {
  const raw = req.headers.origin
  if (!raw) return { kind: 'same-origin', origin: null }
  const origin = String(raw).trim().replace(/\/+$/, '')
  return { kind: ALLOWED_ORIGINS.has(origin) ? 'allowed' : 'denied', origin }
}

/**
 * Apply CORS and hardening headers. Emits Access-Control-Allow-Origin only for an
 * allowlisted cross-origin caller and omits it entirely otherwise — it never
 * reflects an arbitrary Origin.
 */
function applyCors(req, res) {
  const { kind, origin } = classifyOrigin(req)
  res.setHeader('Vary', 'Origin')
  if (kind === 'allowed') res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

/**
 * Refuse cross-origin callers that are not allowlisted.
 * Withholding the CORS header alone would still let the request reach upstream and
 * spend the API key — the browser would only stop the caller from *reading* the
 * response. Refusing outright is what actually protects the quota.
 * Returns true when the request should continue.
 */
function enforceOrigin(req, res) {
  if (classifyOrigin(req).kind !== 'denied') return true
  applyCors(req, res)
  res.statusCode = 403
  res.end('Cross-origin requests are not permitted by this proxy.')
  return false
}

/**
 * Optional shared-secret gate (PROXY_SECRET), applied to every route rather than
 * the Subscan branch alone. Returns true when the request should continue.
 */
function enforceProxySecret(req, res) {
  const secret = process.env.PROXY_SECRET
  if (!secret) return true
  if ((req.headers['x-proxy-secret'] || '') === secret) return true
  applyCors(req, res)
  res.statusCode = 401
  res.end('Missing or invalid proxy secret header.')
  return false
}

// Exact Subscan paths this proxy will forward to. MUST stay in sync with ENDPOINTS
// in src/constants.js — api.test.js asserts the two are identical. Host-only
// allowlisting is not sufficient: without this, every path on the allowlisted host
// (including expensive ones) is reachable with the injected API key.
// Request headers forwarded upstream. Anything not listed here is dropped —
// notably `cookie`, `authorization` and `referer`, which must never leave the
// deployment, and `x-api-key`, which is injected server-side instead.
const FORWARDABLE_REQUEST_HEADERS = ['content-type', 'accept', 'accept-encoding', 'user-agent']

export const SUBSCAN_PATH_ALLOWLIST = new Set([
  '/api/scan/staking/validators',
  '/api/scan/staking/nominators',
  '/api/scan/staking/era_stat',
  '/api/scan/nomination_pool/pools',
  '/api/scan/staking/voted',
  '/api/v2/scan/account/reward_slash',
  '/api/v2/scan/extrinsics',
  '/api/scan/extrinsic/params',
  '/api/v2/scan/events',
])

// ── Per-process token-bucket rate limiter ─────────────────────────────────────
// Protects the shared Subscan API key against bursts caused by multiple concurrent
// users.  Each Vercel function instance maintains its own bucket; there is no
// cross-instance coordination (that would require Vercel KV / Redis).  For free-tier
// traffic this provides meaningful protection within a single warm instance.
//
// Free-tier Subscan allows ~2 req/s sustained.  We allow a burst of 4 tokens
// (absorbed instantly) then refill at 2 tokens/s, matching the free-tier limit.
const _bucket = {
  tokens:    4,            // initial burst allowance
  max:       4,            // maximum burst
  rate:      2,            // tokens refilled per second
  lastRefill: Date.now(),
}

// ── In-process response cache ─────────────────────────────────────────────────
// Historical Subscan data (era stats, reward/slash events, extrinsic params) is
// immutable once indexed.  Caching it in the function instance avoids redundant
// upstream calls when two users (or two components in the same session) request
// the same data within the same warm-instance window.
//
// Cache key = Subscan path + raw request body (guarantees different queries never
// collide).  Entries expire after CACHE_TTL_MS (5 minutes).  Cache is bounded at
// MAX_CACHE_ENTRIES to prevent unbounded memory growth across long-lived instances.
const CACHE_TTL_MS     = 5 * 60 * 1000   // 5 minutes
const MAX_CACHE_ENTRIES = 200
const ALCHEMY_ETH_CALL_PATH = '/api/eth-call'
const ENJ_WALLET_TOKENS_PATH = '/api/enj-wallet-tokens'
const ENJ_TOKEN_DETAILS_PATH = '/api/enj-token-details'
const ENJIN_CRYPTOITEMS_CONTRACT = '0xfaafdc07907ff5120a76b34b731b278c38d6043c'
const ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api'
const ETHERSCAN_CHAIN_ID = '1'
const OPENSEA_API_URL = 'https://api.opensea.io/api/v2'
const ETHERSCAN_DETAIL_TTL_MS = 5 * 60 * 1000
const ETHERSCAN_CONTRACT_TTL_MS = 24 * 60 * 60 * 1000
const URI_SELECTOR = '0x0e89341c'
const BALANCE_OF_SELECTOR = '0x00fdd58e'
const ALCHEMY_TRANSFER_SELECTOR = 'alchemy_getAssetTransfers'

// Etherscan and Alchemy are capped at 3 calls/sec per warm function instance.
// Truly global coordination would require a shared store such as Redis/KV.
const _etherscanBucket = {
  tokens: 3,
  max: 3,
  rate: 3,
  lastRefill: Date.now(),
}
const _alchemyBucket = {
  tokens: 3,
  max: 3,
  rate: 3,
  lastRefill: Date.now(),
}
const _openSeaBucket = {
  tokens: 1,
  max: 1,
  rate: 1,
  lastRefill: Date.now(),
}
let _contractCreatorPromise = null

// Paths whose responses are immutable once indexed by Subscan.
const IMMUTABLE_PATHS = new Set([
  '/api/scan/staking/era_stat',
  '/api/v2/scan/account/reward_slash',
  '/api/v2/scan/events',
  '/api/scan/extrinsic/params',
])

// Paths that return slowly-changing state (validators, pools) — short TTL.
const SLOW_PATHS = new Set([
  '/api/scan/staking/validators',
  '/api/scan/staking/nominators',
  '/api/scan/nomination_pool/pools',
  '/api/scan/staking/voted',
  '/api/v2/scan/extrinsics',
])
const SLOW_TTL_MS = 5 * 60 * 1000   // 5 minutes (same as default; distinct for clarity)

const _cache = new Map()   // key → { ts, body, status, contentType }

function cacheGet(key, ttl) {
  const hit = _cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > ttl) { _cache.delete(key); return null }
  return hit
}

function cacheSet(key, entry) {
  // Evict the oldest entry when the cache is full to bound memory usage.
  if (_cache.size >= MAX_CACHE_ENTRIES) {
    let oldest = null, oldestTs = Infinity
    for (const [k, v] of _cache) {
      if (v.ts < oldestTs) { oldest = k; oldestTs = v.ts }
    }
    if (oldest) _cache.delete(oldest)
  }
  _cache.set(key, { ts: Date.now(), ...entry })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// `maxWaitMs` bounds how long a caller will block for a token before giving up.
// Every caller passes a finite bound; the Infinity default exists only so a future
// caller must opt into unbounded waiting explicitly. Returns false on timeout.
async function takeApiToken(bucket, maxWaitMs = Infinity) {
  const deadline = Date.now() + maxWaitMs
  while (true) {
    const now = Date.now()
    const elapsed = (now - bucket.lastRefill) / 1000
    bucket.tokens = Math.min(bucket.max, bucket.tokens + elapsed * bucket.rate)
    bucket.lastRefill = now

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    const waitMs = Math.ceil((1 - bucket.tokens) / bucket.rate * 1000)
    if (Number.isFinite(maxWaitMs) && now + waitMs > deadline) return false
    await delay(waitMs)
  }
}

// Vercel caps this function at 10s (vercel.json maxDuration). An unbounded token
// wait therefore blocks until the platform kills the request, billing the full
// duration; bound it well inside that ceiling and fail with a clear error instead.
const API_TOKEN_WAIT_MS = 5000

function takeEtherscanToken() {
  return takeApiToken(_etherscanBucket, API_TOKEN_WAIT_MS)
}

function takeAlchemyToken() {
  return takeApiToken(_alchemyBucket, API_TOKEN_WAIT_MS)
}

function takeOpenSeaToken() {
  return takeApiToken(_openSeaBucket, API_TOKEN_WAIT_MS)
}

// Subscan bucket: block briefly for a token rather than failing fast, since a
// token refills in well under a second at the 2 req/s free-tier rate — but cap
// the wait so a request can never hang the function indefinitely.
const SUBSCAN_TOKEN_WAIT_MS = 2000
function takeSubscanToken() {
  return takeApiToken(_bucket, SUBSCAN_TOKEN_WAIT_MS)
}

async function fetchWithRetries(url, options, retryOptions = {}) {
  const {
    attempts = 3,
    baseDelayMs = 400,
    allowStatuses = [],
  } = retryOptions

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options)
    if (allowStatuses.includes(response.status)) return response

    const retryable = response.status === 429 || (response.status >= 500 && response.status < 600)
    if (!retryable || attempt === attempts) return response

    const retryAfter = Number(response.headers.get('retry-after') || '')
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.round(baseDelayMs * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.2))
    await delay(delayMs)
  }

  return fetch(url, options)
}

function encodeUint256(value) {
  return BigInt(value).toString(16).padStart(64, '0')
}

function encodeAddress(address) {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function decodeAbiString(hex) {
  if (!hex || hex === '0x') return ''
  const payload = hex.startsWith('0x') ? hex.slice(2) : hex
  if (payload.length < 128) return ''
  const offset = Number(BigInt(`0x${payload.slice(0, 64)}`))
  const lengthStart = offset * 2
  const length = Number(BigInt(`0x${payload.slice(lengthStart, lengthStart + 64)}`))
  const data = payload.slice(lengthStart + 64, lengthStart + 64 + length * 2)
  return Buffer.from(data, 'hex').toString('utf8')
}

function decodeUint256(hex) {
  if (!hex || hex === '0x') return ''
  return BigInt(hex).toString()
}

function normalizeMetadataUrl(uri, tokenId) {
  if (!uri) return ''
  const tokenHex = tokenId && /^\d+$/.test(String(tokenId))
    ? BigInt(tokenId).toString(16).padStart(64, '0').toLowerCase()
    : ''
  const resolved = uri.replaceAll('{id}', tokenHex)
  if (resolved.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${resolved.slice('ipfs://'.length)}`
  if (resolved.startsWith('ipns://')) return `https://ipfs.io/ipns/${resolved.slice('ipns://'.length)}`
  if (/^https:\/\//i.test(resolved)) return resolved
  return ''
}

function parseBigIntValue(raw, defaultValue = 0n) {
  if (raw == null) return defaultValue
  const value = String(raw).trim()
  if (!value) return defaultValue
  if (/^0x[0-9a-f]+$/i.test(value)) return BigInt(value)
  if (/^\d+$/.test(value)) return BigInt(value)
  return defaultValue
}

function normalizeTokenId(raw) {
  if (raw == null) return ''
  const value = String(raw).trim().toLowerCase()
  if (!value) return ''
  if (/^0x[0-9a-f]+$/.test(value)) return BigInt(value).toString()
  if (/^\d+$/.test(value)) return value
  return ''
}

function normalizeMetadataJson(body, tokenId) {
  if (!body || typeof body !== 'object') return {}
  const attributes = Array.isArray(body.attributes)
    ? body.attributes.map(item => ({
      trait: String(item.trait_type ?? item.trait ?? item.name ?? '').trim(),
      value: String(item.value ?? '').trim(),
      rarity: String(item.rarity ?? item.frequency ?? '').trim(),
    })).filter(item => item.trait || item.value || item.rarity)
    : []

  return {
    tokenId,
    name: typeof body.name === 'string' ? body.name : '',
    previewImage: normalizeMetadataUrl(typeof body.image === 'string' ? body.image : '', tokenId),
    imageUrl: normalizeMetadataUrl(typeof body.image === 'string' ? body.image : '', tokenId),
    description: typeof body.description === 'string' ? body.description : '',
    properties: attributes,
  }
}

async function fetchEtherscanApi(params, options = {}) {
  const apiKey = process.env.ETHERSCAN_API_KEY || ''
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not configured.')

  const url = new URL(ETHERSCAN_API_URL)
  url.searchParams.set('chainid', ETHERSCAN_CHAIN_ID)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  url.searchParams.set('apikey', apiKey)

  const attempts = options.attempts ?? 3
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!(await takeEtherscanToken())) throw new Error('Timed out waiting for an Etherscan request slot.')
    const response = await fetchWithRetries(url, undefined, { attempts: 1 })

    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        const retryAfter = Number(response.headers.get('retry-after') || '')
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.round(500 * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.25))
        await delay(waitMs)
        continue
      }
      throw new Error(`Etherscan API returned HTTP ${response.status}.`)
    }

    const body = await response.json()
    if (
      body.status === '0' &&
      options.allowNoTransactions &&
      /no transactions found/i.test(String(body.result || body.message || ''))
    ) {
      return { ...body, result: [] }
    }

    if (body.status === '0') {
      const message = body.result || body.message || 'Etherscan API returned an error.'
      if (attempt < attempts && /rate limit|max rate|too many/i.test(String(message))) {
        await delay(Math.round(500 * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.25)))
        continue
      }
      throw new Error(message)
    }

    if (body.error) throw new Error(body.error.message || 'Etherscan API returned an error.')
    return body
  }

  throw new Error('Etherscan API retries exhausted.')
}

function toTokenMetadata(owner, tokenId, tokenName, tokenSymbol, quantity, creator = '', source = 'etherscan-api-token1155tx') {
  const label = tokenName || tokenSymbol

  return {
    tokenId,
    metadata: {
      tokenId,
      name: label ? `${label} #${tokenId}` : `Token ${tokenId.length > 12 ? `${tokenId.slice(0, 5)}...${tokenId.slice(-5)}` : tokenId}`,
      previewImage: '',
      imageUrl: '',
      owner,
      contractAddress: ENJIN_CRYPTOITEMS_CONTRACT,
      creator,
      tokenStandard: 'ERC-1155',
      quantity: quantity.toString(),
      properties: [],
      description: '',
      source,
    },
  }
}

async function alchemyRpcCall(method, params) {
  const rpcUrl = process.env.ALCHEMY_ETH_RPC_URL || ''
  if (!rpcUrl) throw new Error('ALCHEMY_ETH_RPC_URL is not configured.')

  const targetUrl = new URL(rpcUrl)
  if (targetUrl.protocol !== 'https:') {
    throw new Error('ALCHEMY_ETH_RPC_URL must use https.')
  }

  const attempts = 3
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!(await takeAlchemyToken())) throw new Error('Timed out waiting for an Alchemy request slot.')
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })

    if ((response.status === 429 || (response.status >= 500 && response.status < 600)) && attempt < attempts) {
      const retryAfter = Number(response.headers.get('retry-after') || '')
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.round(500 * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.25))
      await delay(waitMs)
      continue
    }

    if (!response.ok) throw new Error(`Alchemy RPC returned HTTP ${response.status}.`)
    const body = await response.json()
    if (body.error) throw new Error(body.error.message || 'Alchemy RPC returned an error.')
    return body.result
  }

  throw new Error('Alchemy RPC retries exhausted.')
}

async function fetchWalletTokensViaAlchemy(owner) {
  const balances = new Map()
  const directions = ['incoming', 'outgoing']
  const maxPagesPerDirection = 20

  for (const direction of directions) {
    let pageKey = ''
    for (let page = 0; page < maxPagesPerDirection; page += 1) {
      const payload = {
        fromBlock: '0x0',
        toBlock: 'latest',
        category: ['erc1155'],
        withMetadata: false,
        excludeZeroValue: false,
        maxCount: '0x3e8',
        contractAddresses: [ENJIN_CRYPTOITEMS_CONTRACT],
      }
      if (direction === 'incoming') payload.toAddress = owner
      else payload.fromAddress = owner
      if (pageKey) payload.pageKey = pageKey

      const result = await alchemyRpcCall(ALCHEMY_TRANSFER_SELECTOR, [payload])
      const transfers = Array.isArray(result?.transfers) ? result.transfers : []

      for (const transfer of transfers) {
        const tokenEntries = Array.isArray(transfer?.erc1155Metadata) ? transfer.erc1155Metadata : []
        for (const entry of tokenEntries) {
          const tokenId = normalizeTokenId(entry?.tokenId)
          if (!tokenId) continue

          const quantity = parseBigIntValue(entry?.value, 1n)
          const current = balances.get(tokenId) || 0n
          balances.set(tokenId, direction === 'incoming' ? current + quantity : current - quantity)
        }
      }

      pageKey = String(result?.pageKey || '')
      if (!pageKey) break
      if (page === maxPagesPerDirection - 1) {
        throw new Error('Alchemy transfer history exceeded pagination limit for wallet scan.')
      }
    }
  }

  const creatorResult = await getContractCreator().catch(() => ({ creator: '' }))
  return [...balances.entries()]
    .filter(([, quantity]) => quantity > 0n)
    .sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1))
    .map(([tokenId, quantity]) => toTokenMetadata(
      owner,
      tokenId,
      '',
      '',
      quantity,
      creatorResult.creator || '',
      'alchemy-asset-transfers',
    ))
}

async function fetchCurrentWalletTokens(owner) {
  const balances = new Map()
  const pageSize = 1000
  const maxPages = 25
  let lastTokenName = ''
  let lastTokenSymbol = ''

  for (let page = 1; page <= maxPages; page += 1) {
    const body = await fetchEtherscanApi(
      {
        module: 'account',
        action: 'token1155tx',
        contractaddress: ENJIN_CRYPTOITEMS_CONTRACT,
        address: owner,
        page: String(page),
        offset: String(pageSize),
        startblock: '0',
        endblock: '9999999999',
        sort: 'asc',
      },
      { allowNoTransactions: true },
    )
    const transfers = Array.isArray(body.result) ? body.result : []
    if (!transfers.length) break

    transfers.forEach(transfer => {
      const tokenId = String(transfer.tokenID ?? transfer.tokenId ?? '').trim()
      if (!/^\d+$/.test(tokenId)) return

      lastTokenName = transfer.tokenName || lastTokenName
      lastTokenSymbol = transfer.tokenSymbol || lastTokenSymbol

      const value = BigInt(String(transfer.tokenValue || '1'))
      const current = balances.get(tokenId) || {
        quantity: 0n,
        tokenName: transfer.tokenName || '',
        tokenSymbol: transfer.tokenSymbol || '',
      }
      const from = String(transfer.from || '').toLowerCase()
      const to = String(transfer.to || '').toLowerCase()
      const normalizedOwner = owner.toLowerCase()

      if (from === normalizedOwner) current.quantity -= value
      if (to === normalizedOwner) current.quantity += value
      current.tokenName = transfer.tokenName || current.tokenName
      current.tokenSymbol = transfer.tokenSymbol || current.tokenSymbol
      balances.set(tokenId, current)
    })

    if (transfers.length < pageSize) break
    if (page === maxPages) {
      throw new Error(`Wallet transfer history exceeds ${maxPages * pageSize} rows; unable to compute a complete current token list.`)
    }
  }

  const creatorResult = await getContractCreator().catch(() => ({ creator: '' }))
  return [...balances.entries()]
    .filter(([, balance]) => balance.quantity > 0n)
    .sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1)
    .map(([tokenId, balance]) => toTokenMetadata(
      owner,
      tokenId,
      balance.tokenName || lastTokenName,
      balance.tokenSymbol || lastTokenSymbol,
      balance.quantity,
      creatorResult.creator || '',
      'etherscan-api-token1155tx',
    ))
}

async function proxyEnjWalletTokens(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    return res.end('Method not allowed.')
  }

  const requestUrl = new URL(req.url || '', `https://${req.headers.host || 'localhost'}`)
  const owner = requestUrl.searchParams.get('address') || ''

  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    res.statusCode = 400
    return res.end(JSON.stringify({ error: 'Missing or invalid address.' }))
  }

  const cacheKey = `etherscan:enj-wallet-tokens:${owner.toLowerCase()}`
  const hit = cacheGet(cacheKey, ETHERSCAN_DETAIL_TTL_MS)
  if (hit) {
    // Cache hits must carry the same CORS headers as a miss, or an allowlisted
    // cross-origin caller sees failures that depend purely on cache state.
    applyCors(req, res)
    res.setHeader('Content-Type', hit.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.statusCode = hit.status
    return res.end(hit.body)
  }

  try {
    let tokens = []
    let provider = 'etherscan'

    try {
      tokens = await fetchCurrentWalletTokens(owner)
    } catch {
      tokens = await fetchWalletTokensViaAlchemy(owner)
      provider = 'alchemy'
    }
    const body = JSON.stringify({ owner, contractAddress: ENJIN_CRYPTOITEMS_CONTRACT, tokens })

    cacheSet(cacheKey, { body, status: 200, contentType: 'application/json; charset=utf-8' })
    applyCors(req, res)
    res.setHeader('X-Token-List-Provider', provider)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.statusCode = 200
    return res.end(body)
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.statusCode = 502
    return res.end(JSON.stringify({ error: error.message }))
  }
}

function parseInfusionEthCall(rawBody) {
  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch (error) {
    throw new Error('Invalid JSON-RPC body.', { cause: error })
  }

  if (payload?.method !== 'eth_call') throw new Error('Only eth_call is allowed.')
  const call = payload.params?.[0] || {}
  if (String(call.to || '').toLowerCase() !== ENJIN_CRYPTOITEMS_CONTRACT) {
    throw new Error('Only the configured Enjin ERC-1155 contract calls are allowed.')
  }
  if (!/^0x[0-9a-fA-F]+$/.test(String(call.data || ''))) {
    throw new Error('Missing or invalid eth_call data.')
  }

  return { id: payload.id ?? 1, data: call.data }
}

async function proxyEtherscanEthCallFallback(rawBody) {
  const { id, data } = parseInfusionEthCall(rawBody)
  const result = await etherscanEthCall(data)
  return JSON.stringify({ jsonrpc: '2.0', id, result })
}

async function proxyAlchemyEthCall(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method not allowed.')
  }

  const rawBody = await readRawBody(req)
  const rpcUrl = process.env.ALCHEMY_ETH_RPC_URL || ''
  const finish = (status, body, contentType = 'application/json; charset=utf-8', provider = '') => {
    applyCors(req, res)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', contentType)
    if (provider) res.setHeader('X-RPC-Provider', provider)
    res.statusCode = status
    return res.end(body)
  }

  if (!rpcUrl) {
    try {
      return finish(200, await proxyEtherscanEthCallFallback(rawBody), 'application/json; charset=utf-8', 'Etherscan')
    } catch (error) {
      return finish(503, JSON.stringify({ error: `No Ethereum RPC provider available. ${error.message}` }))
    }
  }

  try {
    const targetUrl = new URL(rpcUrl)
    if (targetUrl.protocol !== 'https:') {
      throw new Error('ALCHEMY_ETH_RPC_URL must use https.')
    }

    if (!(await takeAlchemyToken())) throw new Error('Timed out waiting for an Alchemy request slot.')
    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: rawBody,
    })
    const text = await upstreamRes.text()

    if (upstreamRes.ok) {
      return finish(upstreamRes.status, text, upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8', 'Alchemy')
    }
  } catch {
    // Fall back to Etherscan below.
  }

  try {
    return finish(200, await proxyEtherscanEthCallFallback(rawBody), 'application/json; charset=utf-8', 'Etherscan')
  } catch (error) {
    return finish(502, JSON.stringify({ error: error.message }))
  }
}

async function etherscanEthCall(data) {
  const body = await fetchEtherscanApi({
    module: 'proxy',
    action: 'eth_call',
    to: ENJIN_CRYPTOITEMS_CONTRACT,
    data,
    tag: 'latest',
  })
  return body.result || ''
}

async function fetchOpenSeaTokenMetadata(tokenId, owner) {
  const apiKey = process.env.OPENSEA_API_KEY || ''
  if (!apiKey) throw new Error('OPENSEA_API_KEY is not configured.')

  const cacheKey = `opensea:token:${tokenId}`
  const hit = cacheGet(cacheKey, ETHERSCAN_DETAIL_TTL_MS)
  if (hit) return JSON.parse(hit.body)

  const url = `${OPENSEA_API_URL}/chain/ethereum/contract/${ENJIN_CRYPTOITEMS_CONTRACT}/nfts/${tokenId}`
  const attempts = 3

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!(await takeOpenSeaToken())) throw new Error('Timed out waiting for an OpenSea request slot.')
    const response = await fetchWithRetries(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
    }, { attempts: 1 })

    if (!response.ok) {
      if ((response.status === 429 || (response.status >= 500 && response.status < 600)) && attempt < attempts) {
        const retryAfter = Number(response.headers.get('retry-after') || '')
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.round(1000 * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.25))
        await delay(waitMs)
        continue
      }
      throw new Error(`OpenSea API returned HTTP ${response.status}.`)
    }

    const body = await response.json()
    const nft = body?.nft || {}
    const owners = Array.isArray(nft.owners) ? nft.owners : []
    const ownerEntry = owners.find(item => String(item.address || '').toLowerCase() === owner.toLowerCase())
    const quantity = ownerEntry ? parseBigIntValue(ownerEntry.quantity, 0n).toString() : ''
    const properties = Array.isArray(nft.traits)
      ? nft.traits.map(item => ({
        trait: String(item?.trait_type ?? '').trim(),
        value: String(item?.value ?? '').trim(),
        rarity: String(item?.display_type ?? '').trim(),
      })).filter(item => item.trait || item.value || item.rarity)
      : []

    const result = {
      tokenId,
      owner,
      tokenUri: normalizeMetadataUrl(String(nft.metadata_url || ''), tokenId),
      name: String(nft.name || '').trim(),
      previewImage: normalizeMetadataUrl(String(nft.display_image_url || nft.image_url || ''), tokenId),
      imageUrl: normalizeMetadataUrl(String(nft.image_url || nft.original_image_url || ''), tokenId),
      description: String(nft.description || '').trim(),
      properties,
      creator: String(nft.creator || '').trim(),
      tokenStandard: String(nft.token_standard || 'erc1155').toUpperCase(),
      quantity,
      source: 'opensea-api',
    }

    cacheSet(cacheKey, {
      body: JSON.stringify(result),
      status: 200,
      contentType: 'application/json; charset=utf-8',
    })
    return result
  }

  throw new Error('OpenSea API retries exhausted.')
}

async function fetchJsonMetadata(uri, tokenId) {
  const url = normalizeMetadataUrl(uri, tokenId)
  if (!url) return {}

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`metadata URI returned HTTP ${response.status}`)
    return normalizeMetadataJson(await response.json(), tokenId)
  } finally {
    clearTimeout(timeout)
  }
}

async function getContractCreator() {
  const cacheKey = `etherscan:contract-creator:${ENJIN_CRYPTOITEMS_CONTRACT}`
  const hit = cacheGet(cacheKey, ETHERSCAN_CONTRACT_TTL_MS)
  if (hit) return JSON.parse(hit.body)
  if (_contractCreatorPromise) return _contractCreatorPromise

  _contractCreatorPromise = (async () => {
    try {
      const body = await fetchEtherscanApi({
        module: 'contract',
        action: 'getcontractcreation',
        contractaddresses: ENJIN_CRYPTOITEMS_CONTRACT,
      })
      const creator = body.result?.[0]?.contractCreator || ''
      const result = { creator }
      cacheSet(cacheKey, { body: JSON.stringify(result), status: 200, contentType: 'application/json' })
      return result
    } finally {
      _contractCreatorPromise = null
    }
  })()

  return _contractCreatorPromise
}

async function proxyEnjTokenDetails(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    return res.end('Method not allowed.')
  }

  const requestUrl = new URL(req.url || '', `https://${req.headers.host || 'localhost'}`)
  const tokenId = requestUrl.searchParams.get('tokenId') || ''
  const owner = requestUrl.searchParams.get('owner') || ''

  if (!/^\d+$/.test(tokenId)) {
    res.statusCode = 400
    return res.end('Missing or invalid tokenId.')
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    res.statusCode = 400
    return res.end('Missing or invalid owner.')
  }

  const cacheKey = `etherscan:enj-token-details:${owner.toLowerCase()}:${tokenId}`
  const hit = cacheGet(cacheKey, ETHERSCAN_DETAIL_TTL_MS)
  if (hit) {
    // Cache hits must carry the same CORS headers as a miss, or an allowlisted
    // cross-origin caller sees failures that depend purely on cache state.
    applyCors(req, res)
    res.setHeader('Content-Type', hit.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.statusCode = hit.status
    return res.end(hit.body)
  }

  try {
    const encodedTokenId = encodeUint256(tokenId)
    const [creatorResult, uriHex, quantityHex] = await Promise.all([
      getContractCreator().catch(error => ({ creator: '', error: error.message })),
      etherscanEthCall(`${URI_SELECTOR}${encodedTokenId}`).catch(() => ''),
      etherscanEthCall(`${BALANCE_OF_SELECTOR}${encodeAddress(owner)}${encodedTokenId}`).catch(() => ''),
    ])
    const uri = decodeAbiString(uriHex)
    const uriMetadata = await fetchJsonMetadata(uri, tokenId).catch(error => ({ metadataError: error.message }))
    const shouldTryOpenSea = !uri || !uriMetadata.name || uriMetadata.metadataError
    const openSeaMetadata = shouldTryOpenSea
      ? await fetchOpenSeaTokenMetadata(tokenId, owner).catch(error => ({ metadataError: error.message }))
      : {}

    const metadata = {
      ...uriMetadata,
      ...openSeaMetadata,
      name: openSeaMetadata.name || uriMetadata.name || '',
      previewImage: openSeaMetadata.previewImage || uriMetadata.previewImage || '',
      imageUrl: openSeaMetadata.imageUrl || uriMetadata.imageUrl || '',
      description: openSeaMetadata.description || uriMetadata.description || '',
      properties: openSeaMetadata.properties?.length ? openSeaMetadata.properties : (uriMetadata.properties || []),
    }

    const metadataError = !metadata.name && !metadata.previewImage
      ? (openSeaMetadata.metadataError || uriMetadata.metadataError || null)
      : null
    const result = {
      tokenId,
      owner,
      contractAddress: ENJIN_CRYPTOITEMS_CONTRACT,
      creator: creatorResult.creator || openSeaMetadata.creator || '',
      tokenStandard: openSeaMetadata.tokenStandard || 'ERC-1155',
      quantity: decodeUint256(quantityHex) || openSeaMetadata.quantity || '',
      tokenUri: openSeaMetadata.tokenUri || uri,
      source: openSeaMetadata.source || 'etherscan-api-eth-call',
      ...metadata,
      metadataError,
    }
    const body = JSON.stringify(result)

    cacheSet(cacheKey, { body, status: 200, contentType: 'application/json; charset=utf-8' })
    applyCors(req, res)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.statusCode = 200
    return res.end(body)
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.statusCode = 502
    return res.end(JSON.stringify({ error: error.message }))
  }
}

/** Read the raw request body into a Buffer, enforcing a size limit. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0
    req.on('data', (chunk) => {
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy()
        return reject(new Error('Request body too large.'))
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  try {
    // Gate every route on the origin allowlist before any upstream work happens.
    if (!enforceOrigin(req, res)) return;

    if (req.method === 'OPTIONS') {
      // Preflight is answered with a fixed policy. The previous code echoed back
      // whatever Access-Control-Request-Headers the caller asked for, which grants
      // any header the caller wants. Preflights cannot carry x-proxy-secret, so the
      // secret gate below deliberately runs after this branch.
      applyCors(req, res);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type,accept,x-proxy-secret');
      res.setHeader('Access-Control-Max-Age', '600');
      res.statusCode = 204;
      return res.end();
    }

    // Optional shared-secret gate, applied to every route (not just Subscan).
    if (!enforceProxySecret(req, res)) return;

    // Reject requests with no Content-Type on non-GET methods (body expected)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers['content-type']) {
      res.statusCode = 400;
      return res.end('Missing Content-Type header.');
    }

    const requestPath = (req.url || '').split('?')[0]
    if (requestPath === ALCHEMY_ETH_CALL_PATH) {
      return proxyAlchemyEthCall(req, res)
    }
    if (requestPath === ENJ_WALLET_TOKENS_PATH) {
      return proxyEnjWalletTokens(req, res)
    }
    if (requestPath === ENJ_TOKEN_DETAILS_PATH) {
      return proxyEnjTokenDetails(req, res)
    }

    const prefix = '/api/';
    const raw = req.url || '';
    if (!raw.startsWith(prefix)) {
      res.statusCode = 400;
      return res.end('Invalid proxy path');
    }

    const after = raw.slice(prefix.length);
    if (!after) {
      res.statusCode = 400;
      return res.end('Missing target URL path (encodeURIComponent target).');
    }

    const [encodedTarget] = after.split('?');
    let target;
    try {
      target = decodeURIComponent(encodedTarget);
    } catch {
      res.statusCode = 400;
      return res.end('Invalid encoded target');
    }

    if (!/^https:\/\//i.test(target)) {
      res.statusCode = 400;
      return res.end('Only https:// targets are allowed.');
    }

    const targetUrl = new URL(target);

    const allowlistEnv = process.env.PROXY_ALLOWLIST || 'enjin.api.subscan.io';
    const allowlist = allowlistEnv.split(',').map(s => s.trim()).filter(Boolean);
    if (allowlist.length > 0 && !allowlist.includes(targetUrl.hostname)) {
      res.statusCode = 403;
      return res.end('Target host not allowed by PROXY_ALLOWLIST.');
    }

    // Host-only allowlisting leaves every path on that host reachable with the
    // injected API key. The exact-path list is the real control; the client-side
    // allowlist in src/utils/api.js is a convenience, not a security boundary.
    if (!SUBSCAN_PATH_ALLOWLIST.has(targetUrl.pathname)) {
      res.statusCode = 403;
      return res.end('Target path not allowed by this proxy.');
    }

    const originalQuery = raw.includes('?') ? raw.split('?').slice(1).join('?') : '';
    const finalUrl = originalQuery ? `${target}?${originalQuery}` : target;

    // Read the raw body before touching headers so we forward it unchanged.
    const rawBody = ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : await readRawBody(req)

    const targetPath = targetUrl.pathname

    // ── In-process cache lookup ───────────────────────────────────────────
    const isImmutable = IMMUTABLE_PATHS.has(targetPath)
    const isSlow      = SLOW_PATHS.has(targetPath)
    const cacheable   = (isImmutable || isSlow) && req.method === 'POST' && rawBody

    if (cacheable) {
      const cacheKey = targetPath + '\x00' + rawBody.toString('utf8')
      const ttl      = isImmutable ? CACHE_TTL_MS : SLOW_TTL_MS
      const hit      = cacheGet(cacheKey, ttl)
      if (hit) {
        applyCors(req, res)
        res.setHeader('X-Frame-Options', 'DENY')
        res.setHeader('Content-Type', hit.contentType)
        res.setHeader('X-Cache', 'HIT')
        if (isImmutable) {
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
        } else {
          res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
        }
        res.statusCode = hit.status
        return res.end(hit.body)
      }
    }

    // ── Token-bucket rate limiter ─────────────────────────────────────────
    // Applied after cache hits so cached responses are never throttled.
    // Blocks briefly for a token (see takeSubscanToken); only 429s if the wait
    // exceeds SUBSCAN_TOKEN_WAIT_MS, which the client's own backoff already expects.
    if (!(await takeSubscanToken())) {
      applyCors(req, res)
      res.setHeader('Retry-After', '1')
      res.statusCode = 429
      return res.end('Too Many Requests — slow down and retry after 1 second.')
    }

    // Forward an explicit allowlist rather than stripping a denylist. The previous
    // denylist did not cover `cookie`, `authorization` or `referer`, so any cookie
    // scoped to this app's domain was sent upstream to Subscan on every request.
    const forwardHeaders = {};
    for (const name of FORWARDABLE_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (value) forwardHeaders[name] = value;
    }

    // Inject the Subscan API key from the server-side environment variable.
    const apiKey = process.env.SUBSCAN_API_KEY || '';
    if (apiKey) forwardHeaders['x-api-key'] = apiKey;

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      body: rawBody,
      redirect: 'manual',
    };

    const upstreamRes = await fetch(finalUrl, fetchOptions);

    // `content-length` must be dropped alongside `content-encoding`: fetch has
    // already gunzipped the body, so the upstream (compressed) length is shorter
    // than what we write and Node would silently truncate the response.
    const disallowed = ['set-cookie', 'connection', 'content-encoding', 'transfer-encoding', 'content-length'];
    upstreamRes.headers.forEach((value, key) => {
      if (!disallowed.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // CORS is granted only to allowlisted origins (see applyCors); this proxy is
    // not a public API and never reflects an arbitrary Origin.
    applyCors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    // Prevent downstream content from being framed or sniffed
    res.setHeader('X-Frame-Options', 'DENY');

    // ── Cache-Control headers ─────────────────────────────────────────────
    // Immutable historical data: Subscan never revises indexed era / event data.
    // Slowly-changing state: validators and pools update at most once per era (~1 day).
    // These headers enable browser-level caching and Vercel edge caching for GET-like
    // patterns; for POST the primary benefit is the in-process cache above.
    if (upstreamRes.ok) {
      if (isImmutable) {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
      } else if (isSlow) {
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
      }
    }

    res.statusCode = upstreamRes.status;
    const text = await upstreamRes.text();

    // ── Store successful responses in the in-process cache ────────────────
    if (cacheable && upstreamRes.ok) {
      const cacheKey   = targetPath + '\x00' + rawBody.toString('utf8')
      const contentType = upstreamRes.headers.get('content-type') || 'application/json'
      cacheSet(cacheKey, { body: text, status: upstreamRes.status, contentType })
    }

    return res.end(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.statusCode = 500;
    res.end('Proxy error');
  }
}
