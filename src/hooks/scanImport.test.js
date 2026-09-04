/**
 * Does an imported scan derive the same conclusions as the live one it came from?
 *
 * The export deliberately omits derived values — validator `missedEras`, and the
 * whole `eraValidatorBreakdown` Map — on the grounds that they are recomputable.
 * These tests are the check on that reasoning: they run the real derivation over
 * live state, round-trip the state through the file format, run the same
 * derivation again, and require the results to match exactly.
 */
import { describe, it, expect } from 'vitest'
import {
  exportValidatorScan, importValidatorScan,
  exportPoolScan, importPoolScan,
} from '../utils/scanExport.js'
import { enrichValidators } from './useValidatorChecker.js'
import { buildEraValidatorBreakdown } from './usePoolChecker.js'
import { computePoolMissedEras, resolveLatestEra } from '../utils/eraAnalysis.js'

const eraStat = eras => eras.map(era => ({
  era,
  reward: 1_000_000_000_000_000_000n,
  validatorStake: 500n,
  nominatorStake: 250n,
  startBlock: era * 100,
  endBlock: era * 100 + 99,
  rewardPoint: 40,
  blocksProduced: 3,
}))

describe('validator scan: derived state survives a round-trip', () => {
  // Two validators over a 4-era window: one complete, one missing two eras.
  const liveValidators = [
    {
      address: 'enFull', display: 'Full', commission: 5, bondedTotal: 10n,
      countNominators: 2, isActive: true, fetchStatus: 'done', lastError: null,
      nominators: [{ address: 'enN1', display: '', bonded: 3n }],
      eraStat: eraStat([1170, 1169, 1168, 1167]), missedEras: [],
    },
    {
      address: 'enGappy', display: 'Gappy', commission: 2.5, bondedTotal: 20n,
      countNominators: 1, isActive: false, fetchStatus: 'done', lastError: null,
      nominators: [], eraStat: eraStat([1170, 1167]), missedEras: [],
    },
  ]
  const requestedEraCount = 4

  it('recomputes the identical missed-era lists', () => {
    const live = enrichValidators(liveValidators, requestedEraCount)
    expect(live.find(v => v.address === 'enGappy').missedEras).toEqual([1169, 1168])

    const back = importValidatorScan(exportValidatorScan({ validators: liveValidators, requestedEraCount }))
    const imported = enrichValidators(back.validators, back.requestedEraCount)

    expect(imported.map(v => v.missedEras)).toEqual(live.map(v => v.missedEras))
    expect(resolveLatestEra(imported)).toBe(resolveLatestEra(live))
  })

  // The whole reason requestedEraCount is in the envelope.
  //
  // Without it, enrichValidators falls back to the widest loaded eraStat — which
  // is only right when at least one validator was paid in every requested era.
  // When they all missed the same eras, the fallback shrinks the window to the
  // eras that *were* paid, and the shared gap disappears.
  it('loses a gap that every validator shares if requestedEraCount is lost', () => {
    // A 4-era request in which both validators were paid only in the newest two.
    const allMissedSame = [
      { ...liveValidators[0], eraStat: eraStat([1170, 1169]) },
      { ...liveValidators[1], eraStat: eraStat([1170, 1169]) },
    ]
    const live = enrichValidators(allMissedSame, 4)
    expect(live[0].missedEras).toEqual([1168, 1167])

    const back = importValidatorScan(exportValidatorScan({ validators: allMissedSame, requestedEraCount: 4 }))
    expect(enrichValidators(back.validators, back.requestedEraCount)[0].missedEras).toEqual([1168, 1167])
    // The counterfactual: the same data with the count dropped reports a clean
    // record for a pair of validators that missed two eras each.
    expect(enrichValidators(back.validators, 0)[0].missedEras).toEqual([])
  })
})

describe('pool scan: the breakdown Map rebuilds exactly', () => {
  const completedEras = [1171, 1170, 1169]
  const nominatedValidators = [
    { address: 'enVA', display: 'A', bonded: 100n, isActive: true, fetchStatus: 'done', retryAttempts: 0, lastError: null },
    { address: 'enVB', display: 'B', bonded: 200n, isActive: false, fetchStatus: 'done', retryAttempts: 0, lastError: null },
  ]
  // Era 1171 paid by both (A twice, so the sum matters), 1170 by A only,
  // 1169 by nobody.
  const eraRewards = [
    { era: 1171, amount: '700', blockTimestamp: 1, eventIndex: '1-1', validatorStash: 'enVA' },
    { era: 1171, amount: '300', blockTimestamp: 2, eventIndex: '1-2', validatorStash: 'enVA' },
    { era: 1171, amount: '50',  blockTimestamp: 3, eventIndex: '1-3', validatorStash: 'enVB' },
    { era: 1170, amount: '900', blockTimestamp: 4, eventIndex: '2-1', validatorStash: 'enVA' },
  ]

  const livePool = {
    poolId: 14, metadata: 'Pool 14', state: 'Open',
    stashAddress: 'enStash', stashDisplay: '', rewardAddress: 'enRew', rewardDisplay: '',
    memberCount: 5, totalBonded: 300n, commission: 1, fetchStatus: 'done',
    nominatedValidators, eraRewards,
    missedEras: computePoolMissedEras(eraRewards, 1171, completedEras.length),
    eraValidatorBreakdown: buildEraValidatorBreakdown(eraRewards, nominatedValidators, completedEras),
  }

  const file = () => exportPoolScan({
    pools: [livePool], requestedEraCount: 3, provisionalEra: 1171,
    completedEras, latestCompletedEra: 1171,
  })

  it('produces a Map deep-equal to the live one, BigInt amounts included', () => {
    const back = importPoolScan(file())
    const rebuilt = buildEraValidatorBreakdown(
      back.pools[0].eraRewards, back.pools[0].nominatedValidators, back.completedEras,
    )
    expect(rebuilt).toBeInstanceOf(Map)
    expect([...rebuilt.keys()]).toEqual([...livePool.eraValidatorBreakdown.keys()])
    expect(rebuilt).toEqual(livePool.eraValidatorBreakdown)
    // Spot-check the summed amount, which a float round-trip would not preserve
    // and a naive rebuild could drop.
    expect(rebuilt.get(1171).rewarded.find(v => v.address === 'enVA').amount).toBe(1000n)
    expect(rebuilt.get(1169).rewarded).toEqual([])
    expect(rebuilt.get(1169).unrewarded.map(v => v.address)).toEqual(['enVA', 'enVB'])
  })

  // completedEras keys the Map, so without it the breakdown comes back empty
  // and every era's expansion panel renders blank.
  it('rebuilds an empty Map if completedEras is lost', () => {
    const back = importPoolScan(file())
    const rebuilt = buildEraValidatorBreakdown(
      back.pools[0].eraRewards, back.pools[0].nominatedValidators, [],
    )
    expect(rebuilt.size).toBe(0)
  })

  it('carries the persisted missedEras through unchanged', () => {
    expect(livePool.missedEras).toEqual([1169])
    expect(importPoolScan(file()).pools[0].missedEras).toEqual([1169])
  })

  it('keeps provisionalEra, which the table needs to label the row', () => {
    expect(importPoolScan(file()).provisionalEra).toBe(1171)
  })
})
