import {
  SUBSCAN_BASE, ENDPOINTS, REQUEST_TIMEOUT_MS,
  NOMINATORS_ROW, POOLS_PAGE_SIZE, REWARD_SLASH_ROW,
  MAX_RETRIES, API_DELAY_MS, MAX_RETRY_ATTEMPTS, RETRY_BASE_MS,
} from '../constants.js'

// Exact allowlist of permitted upstream path suffixes
const ALLOWED_PATHS = new Set(Object.values(ENDPOINTS))

/**
 * Build the full request URL, always routing through the same-origin proxy.
 * - In dev: Vite's devServer proxy at /api/ intercepts and forwards to Subscan,
 *   injecting the API key from the server-side SUBSCAN_API_KEY env var.
 * - In production: the Vercel serverless function at api/[...proxy].js handles it,
 *   also injecting SUBSCAN_API_KEY server-side.
 * The API key is NEVER placed in the browser bundle.
 * Enforce the path allowlist to prevent path traversal / SSRF.
 */
function buildUrl(path) {
  if (!ALLOWED_PATHS.has(path)) {
    throw new Error(`Blocked: path "${path}" is not in the allowlist.`)
  }
  // Always use the same-origin proxy — avoids CORS issues and keeps the
  // API key entirely server-side.
  return `/api/${encodeURIComponent(`${SUBSCAN_BASE}${path}`)}`
}

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── In-flight request deduplication ──────────────────────────────────────────
// If two callers request the exact same Subscan endpoint + body simultaneously,
// the second call joins the first Promise rather than issuing a duplicate HTTP
// request.  This is especially important when multiple components (e.g. pool list
// + reward history) both trigger the same fetches within the same render cycle,
// and protects the shared API key on free-tier plans.
// The Map is keyed on path + serialised body so different queries are never merged.
const _inflight = new Map()

function deduplicated(path, body, fn) {
  const key = path + '\x00' + JSON.stringify(body)
  if (_inflight.has(key)) return _inflight.get(key)
  const p = fn().finally(() => _inflight.delete(key))
  _inflight.set(key, p)
  return p
}

// Simple FIFO request queue to serialize top-level requests and enforce a
// delay between them to avoid hitting rate limits when manual retries are invoked.
class RequestQueue {
  constructor(delayMs = 1000) {
    this.delayMs = delayMs
    this.queue = []
    this.running = false
  }

  add(item) {
    // item can be a function (legacy) or an object { fn, onStart }
    return new Promise((resolve, reject) => {
      const entry = typeof item === 'function' ? { fn: item } : { fn: item.fn, onStart: item.onStart }
      this.queue.push({ ...entry, resolve, reject })
      if (!this.running) this._runNext()
    })
  }

  async _runNext() {
    if (this.running) return
    this.running = true
    while (this.queue.length) {
      const { fn, onStart, resolve, reject } = this.queue.shift()
      try {
        if (typeof onStart === 'function') {
          try { onStart() } catch (e) { /* ignore */ }
        }
        const result = await fn()
        resolve(result)
      } catch (err) {
        reject(err)
      }
      // wait between requests to avoid bursts
      await delay(this.delayMs)
    }
    this.running = false
  }
}

export const requestQueue = new RequestQueue(API_DELAY_MS)
export const enqueueRequest = (fn) => requestQueue.add(fn)

/**
 * Core fetch wrapper.
 * - Enforces timeout via AbortController
 * - Validates Content-Type of response
 * - Retries up to MAX_RETRIES times on 429 (rate-limit) responses
 * - Reads retry-after header for precise back-off timing
 * - Never surfaces raw server errors to the UI
 * - Input body values are serialised as JSON (no eval, no injection)
 */
export async function subscanPost(path, body, _proxyUrl, options = {}) {
  // Abort signals are caller-specific and must not be shared across deduplicated
  // requests, so we dedup only when there is no signal (or the signal is the same
  // reference across callers, which never happens in practice for different users).
  // We also skip dedup when options has a custom onRetry callback since those callers
  // expect private state.  The common high-frequency paths (pool lists, era stats)
  // are signal-free and benefit most from deduplication.
  if (!options.signal && !options.onRetry) {
    return deduplicated(path, body, () => _subscanPost(path, body, options))
  }
  return _subscanPost(path, body, options)
}

async function _subscanPost(path, body, options = {}) {
  const url = buildUrl(path)
  const external = options.signal
  const serialisedBody = JSON.stringify(body)
  const attempts = Number.isFinite(options.attempts) ? options.attempts : MAX_RETRY_ATTEMPTS
  const retryBase = Number.isFinite(options.retryBaseMs) ? options.retryBaseMs : RETRY_BASE_MS

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    if (external) {
      if (external.aborted) controller.abort()
      else external.addEventListener('abort', onExternalAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let response
    try {
      response = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
        body:   serialisedBody,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      if (external) external.removeEventListener('abort', onExternalAbort)
      if (err.name === 'AbortError') {
        // If external aborted, propagate immediately
        if (external && external.aborted) throw new Error('Request aborted.')
        // Otherwise treat as timeout
        if (attempt < attempts) {
          const waitMs = Math.round(retryBase * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.2))
          if (typeof options.onRetry === 'function') options.onRetry(attempt, err, waitMs)
          await delay(waitMs)
          continue
        }
        throw new Error('Request timed out after 15 s.')
      }
      if (attempt < attempts) {
        const waitMs = Math.round(retryBase * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.2))
        if (typeof options.onRetry === 'function') options.onRetry(attempt, err, waitMs)
        await delay(waitMs)
        continue
      }
      throw new Error('Network error — check your connection or proxy URL.')
    } finally {
      clearTimeout(timer)
      if (external) external.removeEventListener('abort', onExternalAbort)
    }

    // Retry on 429 or 5xx
    if ((response.status === 429 || (response.status >= 500 && response.status < 600)) && attempt < attempts) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '', 10)
      const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0)
        ? retryAfter * 1000
        : Math.round(retryBase * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.2))
      if (typeof options.onRetry === 'function') options.onRetry(attempt, { status: response.status }, waitMs)
      await delay(waitMs)
      continue
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Subscan.`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error('Unexpected response format from server.')
    }

    let data
    try {
      data = await response.json()
    } catch {
      throw new Error('Failed to parse server response.')
    }

    if (data?.code !== 0) {
      throw new Error(`Subscan API error (code ${data?.code ?? '?'})`)
    }

    return data
  }

  // All retries exhausted
  throw new Error('Retries exhausted while contacting Subscan.')
}

// ── Typed helpers ──────────────────────────────────────────────────────────

export async function fetchValidators(proxyUrl, signal) {
  const data = await subscanPost(
    ENDPOINTS.validators,
    { order: 'desc', order_field: 'bonded_total' },
    proxyUrl,
    { signal },
  )
  return data?.data?.list ?? []
}

export async function fetchNominators(address, proxyUrl, options = {}) {
  // Support legacy signature where a signal may be passed as the third arg
  if (options && typeof options === 'object' && typeof options.addEventListener === 'function') {
    options = { signal: options }
  }
  const { signal } = options
  const data = await subscanPost(
    ENDPOINTS.nominators,
    { page: 0, row: NOMINATORS_ROW, address, order: 'desc', order_field: 'bonded' },
    proxyUrl,
    options,
  )
  return data?.data?.list ?? []
}

export async function fetchEraStat(address, row, proxyUrl, options = {}) {
  // Support legacy signature where the fourth param is an AbortSignal
  if (options && typeof options === 'object' && typeof options.addEventListener === 'function') {
    options = { signal: options }
  }
  const data = await subscanPost(
    ENDPOINTS.eraStat,
    { address, row, page: 0 },
    proxyUrl,
    options,
  )
  return data?.data?.list ?? []
}

/** Re-export the delay utility for hooks. */
export { delay }

/**
 * Probe a single endpoint to verify it is reachable and the API key is accepted.
 * Sends an empty JSON body ({}) — Subscan returns HTTP 200 with code 400 ("EOF")
 * when the body is missing required fields, which is enough to confirm:
 *   - the endpoint URL is correct (404 = wrong path)
 *   - the API key is valid (401/403 = auth failure)
 *   - the network and proxy are working
 * Returns { ok, status, code, error }.
 */
export async function probeEndpoint(path, _body, signal) {
  if (!ALLOWED_PATHS.has(path)) {
    return { ok: false, status: null, code: null, error: 'Path not in allowlist' }
  }
  const url = buildUrl(path)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) return { ok: false, status: null, code: null, error: 'Aborted' }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      // Empty body: deliberately omits required fields so Subscan replies with
      // HTTP 200 + code 400 ("EOF"). This is the lightest possible valid probe.
      body: '{}',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)

    // Try to parse any JSON body — some endpoints return HTTP 400 with
    // a JSON payload like { code: 400, message: 'EOF' } when required
    // fields are absent. We accept that as a successful probe.
    let data = null
    try { data = await response.json() } catch { /* ignore parse errors */ }

    // 401/403 = API key rejected
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, code: data?.code ?? null, error: `HTTP ${response.status} — API key may be invalid or missing` }
    }
    // 404 = wrong endpoint path
    if (response.status === 404) {
      return { ok: false, status: 404, code: data?.code ?? null, error: 'HTTP 404 — endpoint not found' }
    }

    // HTTP 200 — endpoint reachable and API key accepted.
    if (response.ok) {
      return { ok: true, status: response.status, code: data?.code ?? null, error: null }
    }

    // Some Subscan endpoints respond with HTTP 400 and a body of
    // `{ code: 400, message: 'EOF' }` when the request body is empty.
    // Treat that specific case as a successful probe.
    if (response.status === 400 && data?.code === 400) {
      return { ok: true, status: response.status, code: data.code, error: null }
    }

    // Any other non-2xx response is a failure.
    return { ok: false, status: response.status, code: data?.code ?? null, error: `HTTP ${response.status}` }
  } catch (err) {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    if (err.name === 'AbortError') {
      if (signal && signal.aborted) return { ok: false, status: null, code: null, error: 'Aborted' }
      return { ok: false, status: null, code: null, error: 'Request timed out' }
    }
    return { ok: false, status: null, code: null, error: 'Network error — check proxy or connection' }
  }
}

// ── Pool-specific helpers ──────────────────────────────────────────────────

/**
 * Fetch all nomination pools using multi-page loop.
 * Continues fetching until a page returns fewer items than POOLS_PAGE_SIZE.
 * @param {string} proxyUrl
 * @param {AbortSignal} signal
 * @param {function} [onPage] - optional callback(pageNum, itemsInPage) for logging
 * @returns {Promise<Array>} concatenated pool list
 */
export async function fetchAllPools(proxyUrl, signal, onPage) {
  const allPools = []
  let page = 0
  let totalCount = null
  while (true) {
    const data = await subscanPost(
      ENDPOINTS.pools,
      { multi_state: ['Open', 'Blocked'], page, row: POOLS_PAGE_SIZE },
      proxyUrl,
      { signal },
    )
    const list = data?.data?.list ?? []
    // Capture the total count from the first page so we can stop as soon
    // as we have fetched all pools, even if each page returns exactly POOLS_PAGE_SIZE items.
    if (totalCount === null && data?.data?.count != null) {
      totalCount = data.data.count
    }
    allPools.push(...list)
    if (onPage) onPage(page, list.length)
    if (list.length < POOLS_PAGE_SIZE) break
    if (totalCount !== null && allPools.length >= totalCount) break
    page++
    await delay(API_DELAY_MS)
  }
  return allPools
}

/**
 * Fetch the validators a pool stash has nominated.
 * @param {string} address - pool stash address
 * @param {string} proxyUrl
 * @param {AbortSignal} signal
 * @returns {Promise<Array>}
 */
export async function fetchVoted(address, proxyUrl, signal) {
  const data = await subscanPost(
    ENDPOINTS.voted,
    { address },
    proxyUrl,
    { signal },
  )
  return data?.data?.list ?? []
}

/**
 * Fetch staking reward/slash events for an address within a block range.
 * @param {string} address - pool stash address
 * @param {string} blockRange - e.g. "14379991-14396787"
 * @param {string} proxyUrl
 * @param {AbortSignal} signal
 * @returns {Promise<Array>}
 */
export async function fetchRewardSlash(address, blockRange, proxyUrl, signal) {
  const data = await subscanPost(
    ENDPOINTS.rewardSlash,
    {
      address,
      is_stash: true,
      category: 'Reward',
      block_range: blockRange,
      page: 0,
      row: REWARD_SLASH_ROW,
    },
    proxyUrl,
    { signal },
  )
  return data?.data?.list ?? []
}

// Module-level cache: address → Set<number>. Persists across runs for the same address.
const _histPoolCache = new Map()

/** Clear the cached pool-ID set for a specific address (call when address changes). */
export function clearHistPoolCache(address) {
  _histPoolCache.delete(address)
}

/**
 * Fetch nomination-pool IDs a wallet address has interacted with via
 * bond/unbond/withdraw-style nominationpools extrinsics on Subscan.
 * Flow mirrors relay-pool-bulk-extrinsics.py:
 *  - fetch extrinsics pages
 *  - enrich with /api/scan/extrinsic/params
 *  - extract pool_id from params
 *
 * Results are cached in memory by address; a second call for the same address
 * returns immediately without any network requests.
 *
 * @param {string} address - Relaychain wallet address
 * @param {AbortSignal} signal
 * @param {function} [onPage] - optional callback(page, count) for progress logging
 * @returns {Promise<Set<number>>} set of pool IDs
 */
export async function fetchHistoricalPoolIds(address, signal, onPage) {
  if (_histPoolCache.has(address)) return _histPoolCache.get(address)
  const poolIds = new Set()
  let page = 0
  const rowPerPage = 100
  const allowedCalls = new Set([
    'bond',
    'unbond',
    'withdraw_unbonded',
    'withdraw_unbonded_kill',
  ])

  while (true) {
    if (signal?.aborted) throw new Error('Aborted')

    const data = await subscanPost(
      ENDPOINTS.extrinsics,
      {
        row:         rowPerPage,
        signed:      'signed',
        module_call: [{ module: 'nominationpools', call: '' }],
        address,
        page,
      },
      '',
      { signal },
    )

    const records = (data?.data?.extrinsics) ?? []
    if (!records.length) break

    // Attempt to enrich records with decoded call params via the params endpoint
    const indices = records
      .filter(r => r.extrinsic_index)
      .map(r => r.extrinsic_index)

    if (indices.length) {
      try {
        const paramsResp = await subscanPost(
          ENDPOINTS.extrinsicParams,
          { extrinsic_index: indices },
          '',
          { signal },
        )
        // Response shape can vary: data.data (array) or data (array)
        const paramsArr = Array.isArray(paramsResp?.data) ? paramsResp.data
                        : Array.isArray(paramsResp)       ? paramsResp
                        : []
        const paramsByIdx = {}
        for (const item of paramsArr) {
          if (item?.extrinsic_index) paramsByIdx[item.extrinsic_index] = item.params ?? []
        }
        for (const rec of records) {
          const idx = rec.extrinsic_index
          if (idx && paramsByIdx[idx]) rec._params = paramsByIdx[idx]
        }
      } catch { /* params enrichment is best-effort */ }
    }

    for (const rec of records) {
      const callName = String(
        rec?.call_module_function
        ?? rec?.call_module?.function
        ?? rec?.call_name
        ?? '',
      ).toLowerCase()
      // Keep only explicit pool interaction calls; if the API doesn't provide
      // call metadata, fall back to processing the record.
      if (callName && !allowedCalls.has(callName)) continue

      // Use enriched params first, then fall back to inline params field
      let params = rec._params ?? rec.params
      if (typeof params === 'string') {
        try { params = JSON.parse(params) } catch { params = [] }
      }
      if (Array.isArray(params)) {
        for (const p of params) {
          if (p?.name === 'pool_id') {
            try { poolIds.add(Number(p.value)) } catch {}
          }
        }
      }
    }

    if (onPage) onPage(page, records.length)

    if (records.length < rowPerPage) break
    page++
    await delay(API_DELAY_MS)
  }

  _histPoolCache.set(address, poolIds)
  return poolIds
}
