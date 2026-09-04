import { describe, it, expect } from 'vitest'
import { buildEraRows } from './PoolRewardTable.jsx'

const rewards = map => Object.entries(map).map(([era, amount]) => ({ era, amount }))

describe('buildEraRows', () => {
  it('builds the expected era window newest-first', () => {
    const rows = buildEraRows({ eraRewards: [], missedEras: [], eraCount: 3, latestEra: 1170 })
    expect(rows.map(r => r.era)).toEqual([1170, 1169, 1168])
  })

  it('sums multiple reward events for the same era', () => {
    const rows = buildEraRows({
      eraRewards: [{ era: 1170, amount: '100' }, { era: 1170, amount: '250' }],
      missedEras: [], eraCount: 1, latestEra: 1170,
    })
    expect(rows[0].rewardTotal).toBe(350n)
  })

  it('marks an era with no reward as missed', () => {
    const rows = buildEraRows({
      eraRewards: rewards({ 1170: '100' }), missedEras: [1169], eraCount: 2, latestEra: 1170,
    })
    expect(rows[1]).toMatchObject({ era: 1169, missed: true, provisional: false, pending: false })
  })

  // The three provisional states. Getting these wrong either invents a missed
  // payout or shows a green all-clear for a window that is still filling.
  it('marks an unpaid provisional era as both provisional and missed', () => {
    const rows = buildEraRows({
      eraRewards: [], missedEras: [1171], eraCount: 2, latestEra: 1171, provisionalEra: 1171,
    })
    expect(rows[0]).toMatchObject({ era: 1171, provisional: true, missed: true, pending: false })
  })

  it('shows a provisional era that has already paid as not pending', () => {
    const rows = buildEraRows({
      eraRewards: rewards({ 1171: '500' }), missedEras: [], eraCount: 1,
      latestEra: 1171, provisionalEra: 1171,
    })
    expect(rows[0]).toMatchObject({ provisional: true, pending: false, missed: false })
    expect(rows[0].rewardTotal).toBe(500n)
  })

  // `pending` is what survives the change: provisional, present in the reward
  // list so not missed, but summing to zero. Also covers the window where
  // missedEras has not been computed yet.
  it('marks a provisional era with a zero-amount reward as pending, not missed', () => {
    const rows = buildEraRows({
      eraRewards: rewards({ 1171: '0' }), missedEras: [], eraCount: 1,
      latestEra: 1171, provisionalEra: 1171,
    })
    expect(rows[0]).toMatchObject({ provisional: true, pending: true, missed: false })
  })

  it('marks a provisional era as pending while missedEras is still unset', () => {
    const rows = buildEraRows({
      eraRewards: [], missedEras: null, eraCount: 1, latestEra: 1171, provisionalEra: 1171,
    })
    expect(rows[0]).toMatchObject({ provisional: true, pending: true, missed: false })
  })

  it('leaves non-provisional eras in the window unaffected', () => {
    const rows = buildEraRows({
      eraRewards: rewards({ 1171: '500' }), missedEras: [1169], eraCount: 3,
      latestEra: 1171, provisionalEra: 1171,
    })
    expect(rows.map(r => r.provisional)).toEqual([true, false, false])
    expect(rows.find(r => r.era === 1169).missed).toBe(true)
    expect(rows.find(r => r.era === 1171).missed).toBe(false)
  })

  it('returns nothing without a latest era or era count', () => {
    expect(buildEraRows({ eraRewards: [], missedEras: [], eraCount: 0, latestEra: 1170 })).toEqual([])
    expect(buildEraRows({ eraRewards: [], missedEras: [], eraCount: 3, latestEra: 0 })).toEqual([])
  })

  it('ignores malformed reward rows rather than throwing', () => {
    const rows = buildEraRows({
      eraRewards: [{ era: 'abc', amount: '1' }, { era: 1170, amount: 'not-a-number' }],
      missedEras: [], eraCount: 1, latestEra: 1170,
    })
    expect(rows[0].rewardTotal).toBe(0n)
  })
})
