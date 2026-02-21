import { describe, it, expect } from 'vitest'
import { parseCommission, determineActive } from './useValidatorChecker.js'

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
