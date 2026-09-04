import { describe, it, expect } from 'vitest'
import { countAppended, findRowAt, sizeHint } from './TerminalLog.jsx'

const entry = id => ({ id, ts: '00:00:00', level: 'INFO', message: `line ${id}` })
const logs = (...ids) => ids.map(entry)

describe('countAppended', () => {
  it('counts a single appended line', () => {
    expect(countAppended(logs(1, 2, 3), logs(1, 2, 3, 4))).toBe(1)
  })

  it('counts a bulk flush', () => {
    expect(countAppended(logs(1), logs(1, 2, 3, 4, 5, 6, 7))).toBe(6)
  })

  it('returns 0 when nothing was appended', () => {
    const same = logs(1, 2, 3)
    expect(countAppended(same, same)).toBe(0)
  })

  it('treats a first-ever fill as fully appended', () => {
    expect(countAppended(logs(), logs(1, 2, 3))).toBe(3)
  })

  // The reason this walks ids instead of diffing lengths: `logs` is replaced
  // wholesale in several places, so a delta would misreport those. Same length,
  // one line appended and an older one gone — a delta says 0.
  it('counts an append even when the array length did not change', () => {
    expect(countAppended(logs(1, 2, 3), logs(2, 3, 4))).toBe(1)
  })

  it('reports a full replacement when no shared tail remains', () => {
    expect(countAppended(logs(1, 2, 3), logs(7, 8, 9))).toBe(3)
  })

  // A reset empties the log; an import swaps a finished scan's lines for one
  // provenance line. Neither should be mistaken for a large append.
  it('reports nothing appended when the log is emptied', () => {
    expect(countAppended(logs(1, 2, 3), logs())).toBe(0)
  })

  it('reports one line when an import replaces the whole log', () => {
    expect(countAppended(logs(1, 2, 3), logs(99))).toBe(1)
  })
})

/**
 * Row lookup for the virtualized drawer. Rows wrap, so heights differ and the
 * offsets are not a multiple of a fixed row height — getting this wrong shows
 * the wrong slice of the log at a given scroll position.
 */
describe('findRowAt', () => {
  // Three rows of 20px, then one wrapped row of 40px: 0 | 20 | 40 | 60 | 100
  const offsets = Float64Array.from([0, 20, 40, 60, 100])

  it('returns the first row at the top', () => {
    expect(findRowAt(offsets, 0)).toBe(0)
  })

  it('returns the row containing an offset inside it', () => {
    expect(findRowAt(offsets, 25)).toBe(1)
    expect(findRowAt(offsets, 39)).toBe(1)
  })

  it('returns the next row exactly on a boundary', () => {
    expect(findRowAt(offsets, 20)).toBe(1)
    expect(findRowAt(offsets, 60)).toBe(3)
  })

  it('stays inside the taller wrapped row across its whole span', () => {
    expect(findRowAt(offsets, 61)).toBe(3)
    expect(findRowAt(offsets, 99)).toBe(3)
  })

  it('clamps past the end rather than running off the array', () => {
    expect(findRowAt(offsets, 100)).toBe(4)
    expect(findRowAt(offsets, 10_000)).toBe(4)
  })

  it('agrees with a linear scan across a large uneven list', () => {
    const n = 5000
    const arr = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + (i % 7 === 0 ? 41 : 19)
    const linear = y => {
      let last = 0
      for (let i = 0; i < arr.length; i++) if (arr[i] <= y) last = i
      return last
    }
    for (const y of [0, 1, 19, 41, 500, 1234, 40_000, arr[n] - 1, arr[n]]) {
      expect(findRowAt(arr, y)).toBe(linear(y))
    }
  })
})

/**
 * The size hint on the count chip. Logs are uncapped, so past a threshold the
 * chip also shows the approximate memory cost — otherwise a very long session
 * grows silently.
 */
describe('sizeHint', () => {
  it('shows nothing below the threshold', () => {
    expect(sizeHint(0)).toBe('')
    expect(sizeHint(49_999)).toBe('')
  })

  it('shows an estimate at and above the threshold', () => {
    expect(sizeHint(50_000)).toMatch(/^ \(≈[\d.]+ MB\)$/)
  })

  it('uses one decimal place below 10 MB', () => {
    expect(sizeHint(50_000)).toBe(' (≈5.2 MB)')
  })

  it('rounds to a whole number at and above 10 MB', () => {
    // 100,000 * 110 bytes ≈ 10.5 MB
    expect(sizeHint(100_000)).toBe(' (≈10 MB)')
  })

  it('grows with the log, not just past the threshold', () => {
    const at50k = sizeHint(50_000)
    const at500k = sizeHint(500_000)
    expect(parseFloat(at500k.match(/[\d.]+/)[0])).toBeGreaterThan(parseFloat(at50k.match(/[\d.]+/)[0]))
  })
})
