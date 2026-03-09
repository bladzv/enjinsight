import {
  SUBSCAN_BASE, ENDPOINTS, REQUEST_TIMEOUT_MS,
  NOMINATORS_ROW, POOLS_PAGE_SIZE, REWARD_SLASH_ROW,
  MAX_RETRIES, API_DELAY_MS, MAX_RETRY_ATTEMPTS, RETRY_BASE_MS,
} from '../constants.js'

// Exact allowlist of permitted upstream path suffixes
const ALLOWED_PATHS = new Set(Object.values(ENDPOINTS))

/**
 * Validate that the proxy URL is a safe HTTPS URL.
 * Guards against javascript: URIs and other injection attempts.
 */
function validateProxyUrl(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') return false
  try {
    const u = new URL(proxyUrl)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Build the full request URL.
 * - If proxyUrl is provided and valid, prepend it.
 * - Enforce the path is in the allowlist to prevent path traversal / SSRF.
 */
function buildUrl(proxyUrl, path) {
  if (!ALLOWED_PATHS.has(path)) {
    throw new Error(`Blocked: path "${path}" is not in the allowlist.`)
  }
  if (proxyUrl) {
    // If proxyUrl looks like a same-origin path (e.g. '/api' or '/api/'),
    // treat it as a serverless proxy that expects the full upstream URL
    // encoded in the path: `/api/<encodeURIComponent(fullUpstreamUrl)>`.
    if (proxyUrl.startsWith('/')) {
      const base = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl
      return `${base}/${encodeURIComponent(`${SUBSCAN_BASE}${path}`)}`
    }

    // Otherwise expect a full HTTPS proxy root (external proxy service).
    if (!validateProxyUrl(proxyUrl)) {
      throw new Error('Invalid proxy URL: must be a valid HTTPS URL.')
    }
    const base = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl
    return `${base}${path}`
  }
  return `${SUBSCAN_BASE}${path}`
}

const delay = ms => new Promise(r => setTimeout(r, ms))

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
export async function subscanPost(path, body, proxyUrl, options = {}) {
  const url = buildUrl(proxyUrl, path)
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
  while (true) {
    const data = await subscanPost(
      ENDPOINTS.pools,
      { multi_state: ['Open', 'Blocked'], page, row: POOLS_PAGE_SIZE },
      proxyUrl,
      { signal },
    )
    const list = data?.data?.list ?? []
    allPools.push(...list)
    if (onPage) onPage(page, list.length)
    if (list.length < POOLS_PAGE_SIZE) break
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
