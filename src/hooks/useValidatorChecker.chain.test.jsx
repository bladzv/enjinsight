// @vitest-environment jsdom
/**
 * Scan → export → import, driven through the real hook.
 *
 * `scanImport.test.js` proves the derivations survive a round-trip, but it
 * builds hook state by hand. This file starts one step earlier: it feeds
 * Subscan-shaped fixtures through `runCheck`, so the mapping from an API
 * response into reducer state is part of what gets round-tripped. That mapping
 * is where an export schema drifts from reality — a renamed Subscan field or a
 * changed type would pass every hand-built test and still break a real file.
 *
 * The Subscan responses are mocked; a live round-trip is deliberately out of
 * scope. If a real scan ever fails to round-trip, the fixtures below are the
 * first thing to compare against an actual API response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mocked before the hook is imported, so runCheck never touches the network.
vi.mock('../utils/api.js', () => ({
  probeEndpoint: vi.fn(async () => ({ ok: true })),
  fetchValidators: vi.fn(),
  fetchNominators: vi.fn(),
  fetchEraStat: vi.fn(),
  resetSubscanRequestCount: vi.fn(),
  readSubscanRequestCount: vi.fn(() => 0),
  enqueueRequest: vi.fn(arg => (typeof arg === 'function' ? arg() : arg.fn())),
  delay: vi.fn(async () => {}),
}))

import { fetchValidators, fetchNominators, fetchEraStat } from '../utils/api.js'
import { useValidatorChecker, enrichValidators } from './useValidatorChecker.js'
import { exportValidatorScan, importValidatorScan } from '../utils/scanExport.js'

const ERA_COUNT = 4
const WINDOW = [1170, 1169, 1168, 1167]

/** A Subscan `staking/validators` row, in the shape the hook actually reads. */
const validatorRow = (addr, display, opts = {}) => ({
  stash_account_display: { address: addr, display },
  validator_prefs_value: opts.prefs ?? '50000000',   // parts-per-billion → 5%
  bonded_total: opts.bonded ?? '123456789012345678901234',
  count_nominators: opts.count ?? 2,
  status: opts.status ?? 'active',
})

/** A Subscan `staking/era_stat` row. */
const eraStatRow = era => ({
  era,
  validator_reward_total: '1000000000000000000',
  validator_stash_amount: '500000000000000000',
  nominator_stash_amount: '250000000000000000',
  start_block_num: era * 100,
  end_block_num: era * 100 + 99,
  reward_point: 40,
  block_produced: [`${era}-1`, `${era}-2`],
})

/** A Subscan `staking/nominators` row. */
const nominatorRow = (addr, bonded) => ({
  account_display: { address: addr, display: `Nom ${addr}` },
  bonded,
})

const FULL = 'enFullValidatorAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const GAPPY = 'enGappyValidatorBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

beforeEach(() => {
  vi.clearAllMocks()
  fetchValidators.mockResolvedValue([
    validatorRow(FULL, 'Full Validator'),
    validatorRow(GAPPY, 'Gappy Validator', { prefs: '25000000', bonded: '999', count: 1, status: 'inactive' }),
  ])
  fetchNominators.mockImplementation(async address =>
    address === FULL ? [nominatorRow('enNom1', '5000'), nominatorRow('enNom2', '6000')] : [])
  // Gappy was only paid in the newest and oldest era of the window.
  fetchEraStat.mockImplementation(async address =>
    address === FULL ? WINDOW.map(eraStatRow) : [eraStatRow(1170), eraStatRow(1167)])
})

async function runScan() {
  const { result } = renderHook(() => useValidatorChecker())
  await act(async () => { await result.current.runCheck(ERA_COUNT) })
  await waitFor(() => expect(result.current.status).toBe('done'))
  return result
}

describe('scan → export → import', () => {
  it('maps a Subscan response into state the exporter can serialise', async () => {
    const result = await runScan()

    expect(result.current.validators).toHaveLength(2)
    const full = result.current.validators.find(v => v.address === FULL)
    expect(full).toMatchObject({
      display: 'Full Validator',
      commission: 5,          // 50_000_000 ppb
      countNominators: 2,
      isActive: true,
      fetchStatus: 'done',
    })
    expect(full.bondedTotal).toBe(123456789012345678901234n)
    expect(full.eraStat.map(e => e.era)).toEqual(WINDOW)
    expect(full.eraStat[0].reward).toBe(1_000_000_000_000_000_000n)
    // block_produced is an array of ids; the hook counts the unique ones.
    expect(full.eraStat[0].blocksProduced).toBe(2)
  })

  it('detects the gap in the scanned data', async () => {
    const result = await runScan()
    const gappy = result.current.validators.find(v => v.address === GAPPY)
    expect(gappy.missedEras).toEqual([1169, 1168])
  })

  // The whole point: what the exporter writes must derive the same conclusions
  // once read back, without the export having stored those conclusions.
  it('round-trips to identical derived values', async () => {
    const result = await runScan()
    const live = result.current.validators
    const requestedEraCount = result.current.requestedEraCount
    expect(requestedEraCount).toBe(ERA_COUNT)

    const file = exportValidatorScan({ validators: live, requestedEraCount })
    const back = importValidatorScan(file)
    const imported = enrichValidators(back.validators, back.requestedEraCount)

    expect(back.requestedEraCount).toBe(ERA_COUNT)
    expect(imported.map(v => v.address)).toEqual(live.map(v => v.address))
    expect(imported.map(v => v.missedEras)).toEqual(live.map(v => v.missedEras))
    expect(imported.map(v => v.bondedTotal)).toEqual(live.map(v => v.bondedTotal))
    expect(imported.map(v => v.commission)).toEqual(live.map(v => v.commission))
    expect(imported.map(v => v.isActive)).toEqual(live.map(v => v.isActive))

    // Every BigInt in the era rows, exact.
    const liveFull = live.find(v => v.address === FULL)
    const backFull = imported.find(v => v.address === FULL)
    expect(backFull.eraStat).toEqual(liveFull.eraStat)
    expect(backFull.nominators).toEqual(liveFull.nominators)
  })

  it('loads back through the hook itself, not just the parser', async () => {
    const result = await runScan()
    const file = exportValidatorScan({
      validators: result.current.validators,
      requestedEraCount: result.current.requestedEraCount,
    })
    const liveMissed = result.current.validators.map(v => v.missedEras)

    // A fresh hook, as if the app had been reloaded.
    const { result: fresh } = renderHook(() => useValidatorChecker())
    await act(async () => { fresh.current.importScan(importValidatorScan(file), 'scan.json') })

    await waitFor(() => expect(fresh.current.status).toBe('done'))
    expect(fresh.current.dataSource).toBe('import')
    expect(fresh.current.importMeta.fileName).toBe('scan.json')
    expect(fresh.current.validators.map(v => v.missedEras)).toEqual(liveMissed)
    // The source file's log is not replayed — one provenance line instead.
    expect(fresh.current.logs).toHaveLength(1)
    expect(fresh.current.logs[0].message).toMatch(/^Imported 2 validator\(s\) from scan\.json/)
    // Nothing was fetched by the import.
    expect(fetchValidators).toHaveBeenCalledTimes(1)   // the original scan only
  })

  it('reports the scan as complete after an import, not as never run', async () => {
    const result = await runScan()
    const file = exportValidatorScan({
      validators: result.current.validators,
      requestedEraCount: result.current.requestedEraCount,
    })

    const { result: fresh } = renderHook(() => useValidatorChecker())
    await act(async () => { fresh.current.importScan(importValidatorScan(file), 'scan.json') })

    const phases = fresh.current.progress.phases
    expect(phases.every(p => p.status === 'completed')).toBe(true)
    expect(phases.map(p => p.key)).toEqual(['probe', 'list', 'nominators', 'eras'])
  })

  it('clears import provenance when a fresh scan starts', async () => {
    const { result } = renderHook(() => useValidatorChecker())
    await act(async () => {
      result.current.importScan({ validators: [], requestedEraCount: 4, exportedAt: '' }, 'old.json')
    })
    await waitFor(() => expect(result.current.dataSource).toBe('import'))

    await act(async () => { await result.current.runCheck(ERA_COUNT) })
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.dataSource).toBe('scan')
    expect(result.current.importMeta).toBeNull()
  })
})
