import { PLANCK_PER_ENJ } from '../constants.js'

// ── ENJ formatting ────────────────────────────────────────────────────────
/**
 * Convert a Planck BigInt value to a human-readable ENJ string.
 * Uses BigInt to avoid IEEE 754 precision loss on large values.
 */
export function formatENJ(rawValue, decimals = 4) {
  if (rawValue === null || rawValue === undefined) return '—'
  let planck
  try {
    planck = typeof rawValue === 'bigint' ? rawValue : BigInt(String(rawValue).replace(/[^0-9]/g, '') || '0')
  } catch {
    return '—'
  }
  if (planck < 0n) planck = 0n
  const whole     = planck / PLANCK_PER_ENJ
  const remainder = planck % PLANCK_PER_ENJ
  const decStr    = remainder.toString().padStart(18, '0').slice(0, decimals)
  // Format whole (BigInt) without converting to Number to avoid precision loss
  const wholeStr = whole.toString()
  const withCommas = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // decStr is empty when decimals <= 0 — omit the separator rather than
  // leaving a bare trailing dot ("5,000. ENJ").
  return decStr ? `${withCommas}.${decStr} ENJ` : `${withCommas} ENJ`
}

// ── Address formatting ────────────────────────────────────────────────────
export function truncateAddress(address = '', start = 8, end = 6) {
  if (!address || typeof address !== 'string') return '—'
  const clean = address.replace(/[^a-zA-Z0-9]/g, '') // strip non-alphanumeric
  if (clean.length <= start + end + 3) return clean
  return `${clean.slice(0, start)}…${clean.slice(-end)}`
}

// ── Timestamp ─────────────────────────────────────────────────────────────
export function nowHHMMSS() {
  return new Date().toTimeString().slice(0, 8)
}

/**
 * Render an ISO-8601 timestamp as an explicit UTC date/time for a scan export's
 * provenance banner.
 *
 * `exportedAt` is already written in UTC (`new Date().toISOString()`), but
 * `toLocaleString()` renders it in the *viewer's* timezone with no indication
 * that it did — showing a Manila user a Manila-local time with no "UTC" label
 * looks correct and is not. Falls back to the raw string rather than
 * "Invalid Date" if a hand-edited file carries junk.
 */
export function formatExportedAtUTC(iso) {
  if (iso === null || iso === undefined || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
}

// ── Number formatting ─────────────────────────────────────────────────────
export function safeInt(value, fallback = 0) {
  const n = parseInt(String(value), 10)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Convert Substrate commission (parts-per-billion) to a percentage.
 * e.g. 100_000_000 → 10, 50_000_000 → 5, 23_450_000 → 2.35
 */
export function parseCommission(rawPref) {
  const raw = safeInt(rawPref)
  if (raw === 0) return 0
  return Number((raw / 1e7).toFixed(2))
}

// ── Subscan explorer URLs ─────────────────────────────────────────────────
import { EXPLORER_BASE } from '../constants.js'
export function validatorExplorerUrl(address) {
  // Address is sourced from API, not user input, but we still sanitise
  const safe = encodeURIComponent(String(address).replace(/[^a-zA-Z0-9]/g, ''))
  return `${EXPLORER_BASE}/validator/${safe}`
}

/**
 * Build a safe Subscan explorer URL for a nomination pool.
 * @param {number|string} poolId — numeric pool identifier from the API
 * @returns {string}
 */
export function poolExplorerUrl(poolId) {
  const id = Math.max(0, Math.floor(Number(poolId) || 0))
  return `${EXPLORER_BASE}/nomination_pool/${id}`
}

/**
 * Derive a human-readable label for a pool.
 * Prefers `metadata` (the actual pool name) when it is a non-empty string.
 *
 * @param {{ metadata?: string, stashDisplay?: string, poolId: number }} pool
 * @returns {string}
 */
export function poolLabel(pool) {
  const meta  = (pool?.metadata ?? '').trim()
  const stash = pool?.stashDisplay || `Pool #${pool?.poolId ?? '?'}`
  if (!meta) return stash
  return `${stash} — ${meta}`
}
