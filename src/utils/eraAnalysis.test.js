import { describe, it, expect } from 'vitest'
import { computePoolMissedEras } from './eraAnalysis.js'

const rewards = eras => eras.map(era => ({ era, amount: '1000' }))

describe('computePoolMissedEras', () => {
  it('reports eras with no reward event', () => {
    expect(computePoolMissedEras(rewards([1170, 1168]), 1170, 4)).toEqual([1169, 1167])
  })

  it('reports nothing when every expected era paid out', () => {
    expect(computePoolMissedEras(rewards([1170, 1169, 1168, 1167]), 1170, 4)).toEqual([])
  })

  it('treats an empty reward list as every era missed', () => {
    expect(computePoolMissedEras([], 1170, 3)).toEqual([1170, 1169, 1168])
  })

  // The provisional era's payout window is still open, so a pool that has not
  // been paid yet is not missing anything. Counting it raised a "missed payout"
  // alert that cleared itself a few hours later.
  it('never flags the provisional era as missed', () => {
    const missed = computePoolMissedEras(rewards([1170, 1169]), 1171, 4, 1171)
    expect(missed).not.toContain(1171)
    expect(missed).toEqual([1168])
  })

  it('still flags genuinely missed eras alongside a provisional one', () => {
    const missed = computePoolMissedEras(rewards([1170]), 1171, 4, 1171)
    expect(missed).toEqual([1169, 1168])
  })

  it('flags the newest era when no provisional era is given', () => {
    expect(computePoolMissedEras(rewards([1170, 1169]), 1171, 4)).toEqual([1171, 1168])
  })

  it('is unaffected by a provisional era outside the window', () => {
    expect(computePoolMissedEras(rewards([1170]), 1170, 2, 1999)).toEqual([1169])
  })
})
