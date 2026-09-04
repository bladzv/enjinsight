import { describe, it, expect } from 'vitest'
import { formatENJ, formatExportedAtUTC } from './format.js'

describe('formatENJ', () => {
  it('formats with the default 4 decimals', () => {
    expect(formatENJ(1_500_000_000_000_000_000n)).toBe('1.5000 ENJ')
  })

  it('formats zero with the default decimals', () => {
    expect(formatENJ(0n)).toBe('0.0000 ENJ')
  })

  // decStr is the empty string once decimals <= 0, so the separator must be
  // omitted — the previous implementation appended it unconditionally and
  // produced a bare trailing dot ("5,000. ENJ").
  it('omits the decimal separator entirely when decimals is 0', () => {
    expect(formatENJ(5_000_000_000_000_000_000_000n, 0)).toBe('5,000 ENJ')
  })

  it('adds thousands separators to the whole part at 0 decimals', () => {
    expect(formatENJ(1_234_567n * 10n ** 18n, 0)).toBe('1,234,567 ENJ')
  })

  it('rounds down (truncates) rather than rounding at 0 decimals', () => {
    expect(formatENJ(1_999_999_999_999_999_999n, 0)).toBe('1 ENJ')
  })

  it('accepts a numeric-looking string', () => {
    expect(formatENJ('2000000000000000000')).toBe('2.0000 ENJ')
  })

  it('returns an em dash for null or undefined', () => {
    expect(formatENJ(null)).toBe('—')
    expect(formatENJ(undefined)).toBe('—')
  })

  it('clamps a negative value to zero rather than throwing', () => {
    expect(formatENJ(-5n)).toBe('0.0000 ENJ')
  })
})

describe('formatExportedAtUTC', () => {
  it('renders an ISO timestamp as an explicit UTC date/time', () => {
    expect(formatExportedAtUTC('2026-09-03T12:34:56.000Z')).toBe('2026-09-03 12:34:56 UTC')
  })

  it('zero-pads single-digit components', () => {
    expect(formatExportedAtUTC('2026-01-02T03:04:05.000Z')).toBe('2026-01-02 03:04:05 UTC')
  })

  // The whole point: a non-UTC viewer timezone must not shift the rendered
  // clock time, unlike toLocaleString().
  it('does not shift the time for the environment timezone', () => {
    const iso = '2026-06-15T23:59:59.000Z'
    const rendered = formatExportedAtUTC(iso)
    expect(rendered).toContain('23:59:59')
    expect(rendered).toContain('2026-06-15')
  })

  it('falls back to the raw string for an unparseable value', () => {
    expect(formatExportedAtUTC('not a date')).toBe('not a date')
  })

  it('falls back to an empty string for a missing value', () => {
    expect(formatExportedAtUTC(undefined)).toBe('')
    expect(formatExportedAtUTC(null)).toBe('')
  })
})
