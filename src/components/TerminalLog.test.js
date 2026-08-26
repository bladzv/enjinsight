import { describe, it, expect } from 'vitest'
import { countAppended } from './TerminalLog.jsx'

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

  // The reason this walks ids instead of diffing lengths: the reducers cap
  // logs at 500 entries, so once the cap is reached the array stops growing
  // even though lines keep arriving. A length delta would report 0 here and
  // the stream-in would silently stop after the 500th line.
  it('still counts appends after the cap has rotated entries out', () => {
    const prev = logs(1, 2, 3)
    const next = logs(2, 3, 4)   // same length, one appended, one dropped
    expect(countAppended(prev, next)).toBe(1)
  })

  it('reports a full replacement when no shared tail remains', () => {
    expect(countAppended(logs(1, 2, 3), logs(7, 8, 9))).toBe(3)
  })
})
