import { SUBSCAN_BASE, ENDPOINTS, REQUEST_TIMEOUT_MS } from '../constants.js'

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
    if (!validateProxyUrl(proxyUrl)) {
      throw new Error('Invalid proxy URL: must be a valid HTTPS URL.')
    }
    // Proxy is expected to forward requests by path: append the allowed path
    // to the worker root (see PROXY.md). Do not attempt to interpolate
    // user-supplied path parts beyond the allowlist to avoid SSRF.
    const base = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl
    return `${base}${path}`
  }
  return `${SUBSCAN_BASE}${path}`
}

/**
 * Core fetch wrapper.
 * - Enforces timeout via AbortController
 * - Validates Content-Type of response
 * - Never surfaces raw server errors to the UI
 * - Input body values are serialised as JSON (no eval, no injection)
 */
export async function subscanPost(path, body, proxyUrl, options = {}) {
  const url = buildUrl(proxyUrl, path)

  const controller = new AbortController()
  let external = options.signal
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
      body:   JSON.stringify(body),  // safe serialisation, never eval
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
    if (err.name === 'AbortError') throw new Error('Request timed out after 15 s.')
    throw new Error('Network error — check your connection or proxy URL.')
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
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
    // Avoid surface upstream error messages to the UI — keep generic but include code for debugging
    throw new Error(`Subscan API error (code ${data?.code ?? '?'})`)
  }

  return data
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

export async function fetchNominators(address, proxyUrl, signal) {
  const data = await subscanPost(
    ENDPOINTS.nominators,
    { page: 0, row: 100, address, order: 'desc', order_field: 'bonded' },
    proxyUrl,
    { signal },
  )
  return data?.data?.list ?? []
}

export async function fetchEraStat(address, row, proxyUrl, signal) {
  const data = await subscanPost(
    ENDPOINTS.eraStat,
    { address, row, page: 0 },
    proxyUrl,
    { signal },
  )
  return data?.data?.list ?? []
}

/**
 * Run a list of async tasks in serial batches.
 * @param {Array<() => Promise>} tasks
 * @param {number} batchSize
 * @returns {Promise<PromiseSettledResult[]>}
 */
export async function runInBatches(tasks, batchSize) {
  const results = []
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize)
    const settled = await Promise.allSettled(batch.map(fn => fn()))
    results.push(...settled)
  }
  return results
}
