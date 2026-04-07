/**
 * eraCache — fetch and localStorage-cache the era reference CSV files.
 *
 * The relay-era-reference.csv (and canary equivalent) updates at most once
 * per week via a GitHub Actions workflow.  Fetching it on every page load is
 * wasteful and wastes archive-node quota if the RPC binary-search fallback is
 * ever triggered.  This module keeps a 1-hour TTL cache in localStorage so
 * returning users pay the network cost at most once per hour.
 *
 * Two exports:
 *  - loadEraCsvRows(csvPath)  — fetch + cache raw CSV rows (array of plain objects)
 *  - buildEraHashMap(rows)    — build Map<blockNumber, blockHash> for O(1) pre-lookup
 */

const CACHE_TTL_MS = 60 * 60 * 1000   // 1 hour — matches weekly update cadence
const LS_PREFIX    = 'era-ref-v2:'    // bump version suffix if schema changes

/**
 * Fetch an era reference CSV, returning the parsed rows as plain objects whose
 * keys are the original CSV column names (e.g. start_block, start_block_hash).
 *
 * On first call the CSV is fetched from the network; the result is stored in
 * localStorage keyed by path + version prefix.  Subsequent calls within the TTL
 * window return the cached rows without any network request.
 *
 * If localStorage is unavailable (private-browsing restrictions, storage-quota
 * errors) the fetch still succeeds — caching is silently skipped.
 *
 * @param {string} csvPath  Absolute path, e.g. '/relay-era-reference.csv'
 * @returns {Promise<Array<object>>} Raw CSV rows; empty array on any failure.
 */
export async function loadEraCsvRows(csvPath) {
  // ── 1. Try localStorage cache ─────────────────────────────────────────────
  try {
    const hit = localStorage.getItem(LS_PREFIX + csvPath)
    if (hit) {
      const { ts, rows } = JSON.parse(hit)
      if (typeof ts === 'number' && Array.isArray(rows) && Date.now() - ts < CACHE_TTL_MS) {
        return rows
      }
    }
  } catch {
    // localStorage unavailable or corrupted entry — fall through to network fetch.
  }

  // ── 2. Network fetch ──────────────────────────────────────────────────────
  let text
  try {
    // Try the leading-slash path first, then without (handles some dev-server quirks)
    for (const path of [csvPath, csvPath.replace(/^\//, '')]) {
      const resp = await fetch(path, { credentials: 'same-origin' })
      if (!resp.ok) continue
      const t = await resp.text()
      if (t.trimStart().startsWith('era,')) { text = t; break }
    }
  } catch {}

  if (!text) return []

  // ── 3. Parse CSV ──────────────────────────────────────────────────────────
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  // Strip BOM from first header cell if present
  const header = lines[0].split(',').map(s => s.trim().replace(/^\uFEFF/, ''))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 2) continue
    const row = {}
    header.forEach((h, j) => { row[h] = (cols[j] ?? '').trim() })
    rows.push(row)
  }

  // ── 4. Persist to localStorage (best-effort) ──────────────────────────────
  try {
    localStorage.setItem(LS_PREFIX + csvPath, JSON.stringify({ ts: Date.now(), rows }))
  } catch {
    // Quota exceeded or storage unavailable — the data is still returned to the
    // caller; only future sessions will pay the network cost again.
  }

  return rows
}

/**
 * Build a Map<blockNumber, blockHash> from era CSV rows for O(1) lookup.
 *
 * Only start_block entries with a valid start_block_hash are indexed.  This
 * covers era boundary blocks — the subset most likely to be queried in the
 * Balance Viewer when the user picks a date-aligned range.
 *
 * @param {Array<object>} rows  Raw rows from loadEraCsvRows()
 * @returns {Map<number, string>}
 */
export function buildEraHashMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const blk  = parseInt(row.start_block, 10)
    const hash = row.start_block_hash || ''
    if (!isNaN(blk) && blk > 0 && /^0x[0-9a-f]{64}$/i.test(hash)) {
      map.set(blk, hash)
    }
  }
  return map
}
