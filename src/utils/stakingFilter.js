/**
 * Search / filter / sort for the Staking Cadence result lists.
 *
 * Pure and mode-agnostic: `ResultsFilterBar` renders the controls, `App.jsx`
 * owns the state, and everything that decides *which* records survive lives
 * here so it can be tested without rendering anything — the same split
 * `eraAnalysis.js` and `rewardMath.js` already use.
 *
 * The one rule every caller depends on: `applyStakingFilter` never mutates
 * its input. `validators` / `pools` are reducer state read by the summary
 * sections and by `buildScanExport`, so an in-place `.sort()` here would
 * reorder the exported scan as a side effect of touching a dropdown. Every
 * sort below runs on a copy.
 */
import { poolLabel } from './format.js'

/** Neutral filter state — nothing typed, nothing narrowed, scan order kept. */
export const EMPTY_STAKING_FILTER = Object.freeze({
  search: '',
  status: 'all',
  missedMin: '',
  missedMax: '',
  sortKey: 'default',
  sortDir: 'desc',
})

/**
 * Status choices per mode. The first four are shared; the rest describe a
 * dimension only that mode has (a validator is active or not, a pool is in
 * one of the chain's pool states).
 */
const SHARED_STATUSES = [
  { key: 'all',    label: 'All' },
  { key: 'missed', label: 'Has missed eras' },
  { key: 'clean',  label: 'Clean' },
  { key: 'errors', label: 'Errors' },
]

export const VALIDATOR_STATUSES = [
  ...SHARED_STATUSES,
  { key: 'active',   label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
]

export const POOL_STATUSES = [
  ...SHARED_STATUSES,
  { key: 'open',       label: 'Open' },
  { key: 'blocked',    label: 'Blocked' },
  { key: 'destroying', label: 'Destroying' },
]

export const VALIDATOR_SORTS = [
  { key: 'default',    label: 'Scan order' },
  { key: 'missed',     label: 'Missed eras' },
  { key: 'bonded',     label: 'Bonded total' },
  { key: 'holders',    label: 'Nominators' },
  { key: 'commission', label: 'Commission' },
]

export const POOL_SORTS = [
  { key: 'default',    label: 'Scan order' },
  { key: 'missed',     label: 'Missed eras' },
  { key: 'bonded',     label: 'Bonded total' },
  { key: 'holders',    label: 'Members' },
  { key: 'commission', label: 'Commission' },
]

export function statusesFor(mode) {
  return mode === 'validators' ? VALIDATOR_STATUSES : POOL_STATUSES
}

export function sortsFor(mode) {
  return mode === 'validators' ? VALIDATOR_SORTS : POOL_SORTS
}

/** True when the filter would narrow or reorder anything. */
export function isStakingFilterActive(filter) {
  if (!filter) return false
  return Boolean(
    filter.search?.trim()
    || (filter.status && filter.status !== 'all')
    || filter.missedMin !== ''
    || filter.missedMax !== ''
    || (filter.sortKey && filter.sortKey !== 'default'),
  )
}

/** Every field a free-text search should match, lowercased and joined. */
function searchHaystack(row, mode) {
  const parts = mode === 'validators'
    ? [row?.display, row?.address]
    : [poolLabel(row), row?.metadata, row?.stashAddress, `#${row?.poolId ?? ''}`, String(row?.poolId ?? '')]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

const missedCount = row => (Array.isArray(row?.missedEras) ? row.missedEras.length : 0)

/** Whether a row carries any per-era data at all — what "clean" needs to mean. */
function hasEraData(row, mode) {
  const series = mode === 'validators' ? row?.eraStat : row?.eraRewards
  return Array.isArray(series) && series.length > 0
}

const isErrored = row => row?.fetchStatus === 'error' || row?.fetchStatus === 'failed'

/**
 * Does this row pass the status choice?
 *
 * `clean` mirrors the definition the summary sections already use (no missed
 * eras *and* era data actually present), so the "N clean" chip and the Clean
 * filter never disagree about the same scan.
 */
function matchesStatus(row, mode, status) {
  switch (status) {
    case 'missed':     return missedCount(row) > 0
    case 'clean':      return missedCount(row) === 0 && hasEraData(row, mode)
    case 'errors':     return isErrored(row)
    case 'active':     return row?.isActive === true
    case 'inactive':   return row?.isActive !== true
    case 'open':       return row?.state === 'Open'
    case 'blocked':    return row?.state === 'Blocked'
    case 'destroying': return row?.state === 'Destroying'
    default:           return true
  }
}

/** A blank or unparseable bound means "unbounded", not zero. */
function bound(raw) {
  if (raw === '' || raw === null || raw === undefined) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * Sort key → comparable value. Bonded totals are BigInt Planck and must stay
 * BigInt: `Number()` on a whole-chain bonded figure loses precision well
 * before it loses magnitude, so two pools a few Planck apart would compare
 * equal and the order would wobble between renders.
 */
function sortValue(row, mode, sortKey) {
  switch (sortKey) {
    case 'missed':     return missedCount(row)
    case 'bonded':     return toBigInt(mode === 'validators' ? row?.bondedTotal : row?.totalBonded)
    case 'holders':    return mode === 'validators'
      ? (row?.nominators?.length ?? row?.countNominators ?? 0)
      : (Number.isFinite(row?.memberCount) ? row.memberCount : 0)
    case 'commission': return Number.isFinite(row?.commission) ? row.commission : 0
    default:           return 0
  }
}

function toBigInt(v) {
  if (typeof v === 'bigint') return v
  if (v === null || v === undefined || v === '') return 0n
  try { return BigInt(v) } catch { return 0n }
}

/**
 * Compare two already-extracted sort values. Written to work for BigInt and
 * Number alike — relational operators handle both, and mixing the two only
 * happens if a row's field type is inconsistent, where this still orders
 * sensibly rather than throwing the way arithmetic subtraction would.
 */
export function compareSortValues(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Filter, then sort, a validator or pool list.
 *
 * @param {object[]} rows - reducer state; never mutated.
 * @param {'validators'|'pools'} mode
 * @param {object} filter - shape of EMPTY_STAKING_FILTER.
 * @returns {object[]} a new array, even when nothing is filtered out.
 */
export function applyStakingFilter(rows, mode, filter) {
  const list = Array.isArray(rows) ? rows : []
  if (!isStakingFilterActive(filter)) return list

  const needle = filter.search?.trim().toLowerCase() ?? ''
  const min = bound(filter.missedMin)
  const max = bound(filter.missedMax)

  let out = list.filter(row => {
    if (needle && !searchHaystack(row, mode).includes(needle)) return false
    if (!matchesStatus(row, mode, filter.status)) return false
    const missed = missedCount(row)
    if (min !== null && missed < min) return false
    if (max !== null && missed > max) return false
    return true
  })

  if (filter.sortKey && filter.sortKey !== 'default') {
    const direction = filter.sortDir === 'asc' ? 1 : -1
    // `.filter()` above already returned a fresh array, but sorting the input
    // directly when no predicate narrowed it would mutate reducer state — so
    // copy unconditionally rather than relying on what ran before.
    out = out.slice().sort((a, b) =>
      direction * compareSortValues(sortValue(a, mode, filter.sortKey), sortValue(b, mode, filter.sortKey)))
  }

  return out
}

/**
 * The filter, flattened for `meta.filter` in an export.
 *
 * Exporting a filtered view writes a file that is otherwise structurally
 * identical to a full scan, so the file records what narrowed it and how many
 * records the scan actually held. Returns `null` when nothing is filtered,
 * keeping the common case's envelope unchanged.
 */
export function describeStakingFilter(filter, { totalRecords = 0, exportedRecords = 0 } = {}) {
  if (!isStakingFilterActive(filter)) return null
  return {
    search: filter.search?.trim() ?? '',
    status: filter.status ?? 'all',
    missedMin: filter.missedMin === '' ? null : Number(filter.missedMin),
    missedMax: filter.missedMax === '' ? null : Number(filter.missedMax),
    sortKey: filter.sortKey ?? 'default',
    sortDir: filter.sortDir ?? 'desc',
    totalRecords,
    exportedRecords,
  }
}
