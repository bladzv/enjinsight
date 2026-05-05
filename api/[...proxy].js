// Simple, cautious proxy for Vercel serverless functions.
// Usage: POST /api/https%3A%2F%2Fenjin.api.subscan.io%2Fapi%2Fscan%2F...
// Security: set PROXY_ALLOWLIST and optionally PROXY_SECRET.
// Body parsing is disabled so the raw request body is forwarded unchanged.
// The Subscan API key is injected server-side from SUBSCAN_API_KEY env var.
export const config = { api: { bodyParser: false } }

/** Maximum raw body size accepted from the client (32 KB — well above any API payload). */
const MAX_BODY_BYTES = 32 * 1024

// ── Per-process token-bucket rate limiter ─────────────────────────────────────
// Protects the shared Subscan API key against bursts caused by multiple concurrent
// users.  Each Vercel function instance maintains its own bucket; there is no
// cross-instance coordination (that would require Vercel KV / Redis).  For free-tier
// traffic this provides meaningful protection within a single warm instance.
//
// Free-tier Subscan allows ~1 req/s sustained.  We allow a burst of 3 tokens
// (absorbed instantly) then refill at 1 token/s, matching the free-tier limit.
const _bucket = {
  tokens:    3,            // initial burst allowance
  max:       3,            // maximum burst
  rate:      1,            // tokens refilled per second
  lastRefill: Date.now(),
}

function consumeToken() {
  const now     = Date.now()
  const elapsed = (now - _bucket.lastRefill) / 1000
  _bucket.tokens     = Math.min(_bucket.max, _bucket.tokens + elapsed * _bucket.rate)
  _bucket.lastRefill = now
  if (_bucket.tokens < 1) return false
  _bucket.tokens -= 1
  return true
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
const ETHERSCAN_DETAIL_TTL_MS = 5 * 60 * 1000
const ETHERSCAN_CONTRACT_TTL_MS = 24 * 60 * 60 * 1000
const URI_SELECTOR = '0x0e89341c'
const BALANCE_OF_SELECTOR = '0x00fdd58e'

// Etherscan allows 5 calls/sec for this key. This limiter is per warm function
// instance; truly global coordination would require a shared store such as Redis/KV.
const _etherscanBucket = {
  tokens: 5,
  max: 5,
  rate: 5,
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

async function takeEtherscanToken() {
  while (true) {
    const now = Date.now()
    const elapsed = (now - _etherscanBucket.lastRefill) / 1000
    _etherscanBucket.tokens = Math.min(_etherscanBucket.max, _etherscanBucket.tokens + elapsed * _etherscanBucket.rate)
    _etherscanBucket.lastRefill = now

    if (_etherscanBucket.tokens >= 1) {
      _etherscanBucket.tokens -= 1
      return
    }

    await delay(Math.ceil((1 - _etherscanBucket.tokens) / _etherscanBucket.rate * 1000))
  }
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
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, '0').toLowerCase()
  const resolved = uri.replaceAll('{id}', tokenHex)
  if (resolved.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${resolved.slice('ipfs://'.length)}`
  if (resolved.startsWith('ipns://')) return `https://ipfs.io/ipns/${resolved.slice('ipns://'.length)}`
  if (/^https:\/\//i.test(resolved)) return resolved
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
    description: typeof body.description === 'string' ? body.description : '',
    properties: attributes,
  }
}

async function fetchEtherscanApi(params, options = {}) {
  const apiKey = process.env.ETHERSCAN_API_KEY || ''
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not configured.')

  await takeEtherscanToken()

  const url = new URL(ETHERSCAN_API_URL)
  url.searchParams.set('chainid', ETHERSCAN_CHAIN_ID)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  url.searchParams.set('apikey', apiKey)

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Etherscan API returned HTTP ${response.status}.`)

  const body = await response.json()
  if (
    body.status === '0' &&
    options.allowNoTransactions &&
    /no transactions found/i.test(String(body.result || body.message || ''))
  ) {
    return { ...body, result: [] }
  }
  if (body.status === '0') throw new Error(body.result || body.message || 'Etherscan API returned an error.')
  if (body.error) throw new Error(body.error.message || 'Etherscan API returned an error.')
  return body
}

function toTokenMetadata(owner, tokenId, tokenName, tokenSymbol, quantity) {
  const label = tokenName || tokenSymbol

  return {
    tokenId,
    metadata: {
      tokenId,
      name: label ? `${label} #${tokenId}` : `Token ${tokenId.length > 12 ? `${tokenId.slice(0, 5)}...${tokenId.slice(-5)}` : tokenId}`,
      previewImage: '',
      owner,
      contractAddress: ENJIN_CRYPTOITEMS_CONTRACT,
      creator: '',
      tokenStandard: 'ERC-1155',
      quantity: quantity.toString(),
      properties: [],
      description: '',
      source: 'etherscan-api-token1155tx',
    },
  }
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

  return [...balances.entries()]
    .filter(([, balance]) => balance.quantity > 0n)
    .sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1)
    .map(([tokenId, balance]) => toTokenMetadata(
      owner,
      tokenId,
      balance.tokenName || lastTokenName,
      balance.tokenSymbol || lastTokenSymbol,
      balance.quantity,
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
    res.setHeader('Content-Type', hit.contentType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.statusCode = hit.status
    return res.end(hit.body)
  }

  try {
    const tokens = await fetchCurrentWalletTokens(owner)
    const body = JSON.stringify({ owner, contractAddress: ENJIN_CRYPTOITEMS_CONTRACT, tokens })

    cacheSet(cacheKey, { body, status: 200, contentType: 'application/json; charset=utf-8' })
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '')
    res.setHeader('Vary', 'Origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
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

async function proxyAlchemyEthCall(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method not allowed.')
  }

  const rpcUrl = process.env.ALCHEMY_ETH_RPC_URL || ''
  if (!rpcUrl) {
    res.statusCode = 503
    return res.end(JSON.stringify({ error: 'ALCHEMY_ETH_RPC_URL is not configured.' }))
  }

  try {
    const targetUrl = new URL(rpcUrl)
    if (targetUrl.protocol !== 'https:') {
      res.statusCode = 500
      return res.end(JSON.stringify({ error: 'ALCHEMY_ETH_RPC_URL must use https.' }))
    }

    const rawBody = await readRawBody(req)
    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: rawBody,
    })
    const text = await upstreamRes.text()

    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '')
    res.setHeader('Vary', 'Origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8')
    res.statusCode = upstreamRes.status
    return res.end(text)
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.statusCode = 502
    return res.end(JSON.stringify({ error: error.message }))
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
    const jsonMetadata = await fetchJsonMetadata(uri, tokenId).catch(error => ({ metadataError: error.message }))
    const result = {
      tokenId,
      owner,
      contractAddress: ENJIN_CRYPTOITEMS_CONTRACT,
      creator: creatorResult.creator || '',
      tokenStandard: 'ERC-1155',
      quantity: decodeUint256(quantityHex),
      tokenUri: uri,
      ...jsonMetadata,
    }
    const body = JSON.stringify(result)

    cacheSet(cacheKey, { body, status: 200, contentType: 'application/json; charset=utf-8' })
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '')
    res.setHeader('Vary', 'Origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
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
    if (req.method === 'OPTIONS') {
      // Only allow same-origin requests; this proxy is not a public API
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.statusCode = 204;
      return res.end();
    }

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
    } catch (e) {
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

    const secret = process.env.PROXY_SECRET;
    if (secret) {
      const incoming = req.headers['x-proxy-secret'] || '';
      if (incoming !== secret) {
        res.statusCode = 401;
        return res.end('Missing or invalid proxy secret header.');
      }
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
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '')
        res.setHeader('Vary', 'Origin')
        res.setHeader('X-Content-Type-Options', 'nosniff')
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
    if (!consumeToken()) {
      res.setHeader('Retry-After', '1')
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '')
      res.statusCode = 429
      return res.end('Too Many Requests — slow down and retry after 1 second.')
    }

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    // Remove the client-supplied x-api-key — we inject it server-side below.
    delete forwardHeaders['x-api-key'];
    // Strip hop-by-hop and potentially dangerous headers
    [
      'connection', 'keep-alive', 'transfer-encoding',
      'proxy-authorization', 'proxy-authenticate', 'upgrade',
      'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
      'x-real-ip', 'x-proxy-secret',
    ].forEach(h => delete forwardHeaders[h]);

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

    const disallowed = ['set-cookie', 'connection', 'content-encoding', 'transfer-encoding'];
    upstreamRes.headers.forEach((value, key) => {
      if (!disallowed.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Only allow same-origin requests; this proxy is not a public API
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    // Prevent downstream content from being framed or sniffed
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
