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

  // A provisional era used to be exempt, which hid pools that genuinely were
  // not being paid until the payout window closed. It is now reported like any
  // other gap; the row is labelled provisional in the UI instead.
  it('flags an unpaid provisional era as missed', () => {
    const missed = computePoolMissedEras(rewards([1170, 1169]), 1171, 4)
    expect(missed).toContain(1171)
    expect(missed).toEqual([1171, 1168])
  })

  it('does not flag a provisional era that has already paid', () => {
    const missed = computePoolMissedEras(rewards([1171, 1170]), 1171, 3)
    expect(missed).toEqual([1169])
  })

  it('flags genuinely missed eras alongside an unpaid provisional one', () => {
    const missed = computePoolMissedEras(rewards([1170]), 1171, 4)
    expect(missed).toEqual([1171, 1169, 1168])
  })
})
