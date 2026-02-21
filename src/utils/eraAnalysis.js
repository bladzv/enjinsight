import { CONSECUTIVE_MISS_THRESHOLD } from '../constants.js'

/**
 * Compute which era numbers are missing from a validator's era_stat response.
 *
 * @param {Array}  eraStat   - array of { era: number, ... } from Subscan
 * @param {number} latestEra - the global latest era (max across all validators)
 * @param {number} eraCount  - user's requested N
 * @returns {number[]} sorted descending list of missing era numbers
 */
export function computeMissedEras(eraStat, latestEra, eraCount) {
  if (!Array.isArray(eraStat) || !latestEra || !eraCount) return []
  const expected = new Set(
    Array.from({ length: eraCount }, (_, i) => latestEra - i)
  )
  const received = new Set(eraStat.map(e => safeEraNum(e.era)))
  return [...expected]
    .filter(era => !received.has(era))
    .sort((a, b) => b - a)
}

/**
 * Find groups of consecutive missed eras.
 * Only returns groups with length >= CONSECUTIVE_MISS_THRESHOLD (default 3).
 *
 * @param {number[]} missedEras - descending sorted list of missed era numbers
 * @returns {number[][]} array of consecutive groups, each sorted descending
 */
export function findConsecutiveGroups(missedEras) {
  if (!missedEras?.length) return []
  const sorted = [...missedEras].sort((a, b) => b - a)
  const groups = []
  let group = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1] - sorted[i] === 1) {
      group.push(sorted[i])
    } else {
      if (group.length >= CONSECUTIVE_MISS_THRESHOLD) groups.push(group)
      group = [sorted[i]]
    }
  }
  if (group.length >= CONSECUTIVE_MISS_THRESHOLD) groups.push(group)
  return groups
}

/**
 * Severity classification for the summary table.
 * @param {number} missedCount
 * @returns {'none'|'low'|'medium'|'high'}
 */
export function getSeverity(missedCount) {
  if (missedCount === 0) return 'none'
  if (missedCount <= 2)  return 'low'
  if (missedCount <= 5)  return 'medium'
  return 'high'
}

/**
 * Determine the global latest era from all validators' era_stat data.
 * @param {ValidatorRecord[]} validators
 * @returns {number}
 */
export function resolveLatestEra(validators) {
  let max = 0
  for (const v of validators) {
    if (!Array.isArray(v.eraStat)) continue
    for (const e of v.eraStat) {
      const n = safeEraNum(e.era)
      if (n > max) max = n
    }
  }
  return max
}

function safeEraNum(val) {
  const n = parseInt(String(val), 10)
  return Number.isFinite(n) ? n : 0
}
