import { describe, it, expect } from 'vitest'
import { buildEraRangeMap, selectCheckableEras } from './usePoolChecker.js'

// Minimal stand-in for rows returned by loadEraCsvRows()
function csvRow(era, start, end) {
  return {
    era: String(era),
    start_block: String(start),
    end_block: end == null ? '' : String(end),
  }
}

// Build a contiguous era range map: eras [from..to] closed, 14400 blocks each.
function contiguous(from, to, { openLast = false } = {}) {
  const map = new Map()
  for (let era = from; era <= to; era++) {
    const start = 1_000_000 + (era - from) * 14_400
    const isLast = era === to
    map.set(era, { start, end: openLast && isLast ? 0 : start + 14_399 })
  }
  return map
}

describe('buildEraRangeMap', () => {
  it('indexes rows that have a complete block range', () => {
    const map = buildEraRangeMap([csvRow(1, 14401, 28800), csvRow(2, 28801, 43200)])
    expect(map.size).toBe(2)
    expect(map.get(1)).toEqual({ start: 14401, end: 28800 })
    expect(map.get(2)).toEqual({ start: 28801, end: 43200 })
  })

  it('skips the trailing in-progress row that has no end_block', () => {
    // This is the real shape of the CSV's last line.
    const map = buildEraRangeMap([csvRow(1, 14401, 28800), csvRow(2, 28801, null)])
    expect(map.size).toBe(1)
    expect(map.has(2)).toBe(false)
  })

  it('does not invent an end_block for the open era', () => {
    // Era lengths vary (14398-14400 observed), so guessing is unsafe.
    const map = buildEraRangeMap([csvRow(9, 100, null)])
    expect(map.size).toBe(0)
  })

  it('ignores malformed, zero and missing values', () => {
    const map = buildEraRangeMap([
      csvRow(0, 100, 200),        // era 0
      csvRow(3, 0, 200),          // no start
      { era: 'abc', start_block: 'x', end_block: 'y' },
      {},
      null,
    ])
    expect(map.size).toBe(0)
  })

  it('returns an empty map for empty or nullish input', () => {
    expect(buildEraRangeMap([]).size).toBe(0)
    expect(buildEraRangeMap(null).size).toBe(0)
    expect(buildEraRangeMap(undefined).size).toBe(0)
  })
})

describe('selectCheckableEras', () => {
  it('excludes the newest closed era, since it is the payout window', () => {
    // Eras 100..110 closed. Era 110's blocks are where era 109's reward lands,
    // so 109 is the newest checkable era, not 110.
    const { maxClosedEra, completedEras } = selectCheckableEras(contiguous(100, 110), 3)
    expect(maxClosedEra).toBe(110)
    expect(completedEras).toEqual([109, 108, 107])
  })

  it('returns eras newest-first and honours eraCount', () => {
    const { completedEras } = selectCheckableEras(contiguous(1, 200), 5)
    expect(completedEras).toEqual([199, 198, 197, 196, 195])
  })

  it('treats an open final era as not closed', () => {
    // Era 110 in progress (end = 0) -> newest closed is 109 -> newest checkable 108.
    const { maxClosedEra, completedEras } = selectCheckableEras(
      contiguous(100, 110, { openLast: true }), 2,
    )
    expect(maxClosedEra).toBe(109)
    expect(completedEras).toEqual([108, 107])
  })

  it('reports an era as skipped when its payout window is missing', () => {
    const map = contiguous(100, 110)
    map.delete(108)   // era 107's payout window is now unknown
    const { completedEras, skipped } = selectCheckableEras(map, 4)
    expect(completedEras).toEqual([109, 108, 106])
    expect(skipped).toEqual([107])
  })

  it('does not widen the window past eraCount when eras are skipped', () => {
    // A hole must reduce the count, not reach further into the past.
    const map = contiguous(100, 110)
    map.delete(108)
    const { completedEras } = selectCheckableEras(map, 3)
    expect(completedEras).toEqual([109, 108])
    expect(completedEras).not.toContain(106)
  })

  it('never returns more eras than exist above era 0', () => {
    const { completedEras } = selectCheckableEras(contiguous(1, 3), 50)
    expect(completedEras).toEqual([2, 1])
  })

  it('returns an empty result when nothing is closed', () => {
    const open = new Map([[10, { start: 100, end: 0 }]])
    expect(selectCheckableEras(open, 5)).toEqual({
      maxClosedEra: 0, completedEras: [], skipped: [],
    })
    expect(selectCheckableEras(new Map(), 5).maxClosedEra).toBe(0)
  })

  it('yields nothing checkable when only one era is closed', () => {
    const { maxClosedEra, completedEras } = selectCheckableEras(contiguous(7, 7), 5)
    expect(maxClosedEra).toBe(7)
    expect(completedEras).toEqual([6])   // era 6 checkable only if 7 is closed
  })

  it('every returned era has a fully-known payout range', () => {
    // The core invariant Step 4 relies on: eraRangeMap.get(era + 1) is always usable.
    const map = contiguous(500, 600)
    map.delete(590)
    const { completedEras } = selectCheckableEras(map, 90)
    for (const era of completedEras) {
      const payout = map.get(era + 1)
      expect(payout).toBeDefined()
      expect(payout.start).toBeGreaterThan(0)
      expect(payout.end).toBeGreaterThan(0)
    }
  })
})
