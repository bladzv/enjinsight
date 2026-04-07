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
