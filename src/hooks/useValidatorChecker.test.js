import { describe, it, expect } from 'vitest'
import { parseCommission, determineActive, enrichValidators } from './useValidatorChecker.js'

// Helper to wrap raw object
function makeRaw(obj) {
  return obj
}

describe('parseCommission', () => {
  it('returns 0 for undefined or zero input', () => {
    expect(parseCommission(undefined)).toBe(0)
    expect(parseCommission(null)).toBe(0)
    expect(parseCommission(0)).toBe(0)
  })

  it('converts parts-per-billion to percent correctly', () => {
    // 5% -> 50,000,000
    expect(parseCommission('50000000')).toBe(5)
    // 2.345% -> 23,450,000
    expect(parseCommission(23450000)).toBe(2.35)
    // rounding should keep two decimal places
    expect(parseCommission(12345678)).toBe(1.23)
  })
})

describe('determineActive', () => {
  it('handles boolean statuses', () => {
    expect(determineActive(makeRaw({ status: true }))).toBe(true)
    expect(determineActive(makeRaw({ status: false }))).toBe(false)
  })

  it('handles numeric statuses', () => {
    expect(determineActive(makeRaw({ status: 1 }))).toBe(true)
    expect(determineActive(makeRaw({ status: 0 }))).toBe(false)
  })

  it('parses string statuses', () => {
    expect(determineActive(makeRaw({ status: 'active' }))).toBe(true)
    expect(determineActive(makeRaw({ status: 'validator' }))).toBe(true)
    expect(determineActive(makeRaw({ status: 'inactive' }))).toBe(false)
    expect(determineActive(makeRaw({ status: 'chilled' }))).toBe(false)
    expect(determineActive(makeRaw({ status: '1' }))).toBe(true)
    expect(determineActive(makeRaw({ status: '0' }))).toBe(false)
  })

  it('falls back to rank_validator or latest_mining for truthiness', () => {
    expect(determineActive(makeRaw({ rank_validator: '5' }))).toBe(true)
    expect(determineActive(makeRaw({ rank_validator: 0, latest_mining: '3' }))).toBe(true)
    expect(determineActive(makeRaw({ rank_validator: 0, latest_mining: 0 }))).toBe(false)
  })

  it('returns false for unknown or empty values', () => {
    expect(determineActive(makeRaw({ status: '' }))).toBe(false)
    expect(determineActive(makeRaw({}))).toBe(false)
  })
})

// The missed-era window is "the last N eras the user asked for". Deriving N
// from the responses instead makes the window shrink to fit the data, which
// hides the very gaps the tool exists to find.
describe('enrichValidators', () => {
  const v = (address, eras) => ({ address, eraStat: eras.map(era => ({ era })) })

  it('measures each validator against the requested window', () => {
    // Asked for 7 eras; this validator only reported 3 of them.
    const [only] = enrichValidators([v('A', [1000, 999, 998])], 7)
    expect(only.missedEras).toEqual([997, 996, 995, 994])
  })

  it('does not let a partial scan shrink another validator\'s gap list', () => {
    // Mid-scan: A has loaded with 3 eras, B has not resolved yet. A's result
    // must already be final rather than widening when B arrives.
    const midScan = enrichValidators([v('A', [1000, 999, 998]), { address: 'B' }], 7)
    const complete = enrichValidators([v('A', [1000, 999, 998]), v('B', [1000, 999, 998, 997, 996, 995, 994])], 7)
    expect(midScan[0].missedEras).toEqual(complete[0].missedEras)
  })

  it('reports gaps every validator shares', () => {
    // The pre-existing bug this pins down: with the window derived from the
    // data, two validators that both returned only 5 of 7 eras would define a
    // 5-era window, match it exactly, and report zero missed eras.
    const enriched = enrichValidators(
      [v('A', [1000, 999, 998, 997, 996]), v('B', [1000, 999, 998, 997, 996])],
      7,
    )
    expect(enriched[0].missedEras).toEqual([995, 994])
    expect(enriched[1].missedEras).toEqual([995, 994])
  })

  it('falls back to the data-derived window when no request count is known', () => {
    // Imported/legacy state has no requested count to pin against.
    const enriched = enrichValidators([v('A', [1000, 999, 998])], 0)
    expect(enriched[0].missedEras).toEqual([])
  })

  it('leaves validators whose era stats have not loaded untouched', () => {
    const enriched = enrichValidators([v('A', [1000, 999]), { address: 'B' }], 7)
    expect(enriched[1].missedEras).toBeUndefined()
  })
})
