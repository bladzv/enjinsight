import { describe, it, expect } from 'vitest'
import {
  EMPTY_STAKING_FILTER,
  isStakingFilterActive,
  applyStakingFilter,
  compareSortValues,
  describeStakingFilter,
  statusesFor,
  sortsFor,
} from './stakingFilter.js'

const validators = [
  {
    address: 'enAAA', display: 'Alpha Validator', isActive: true,
    fetchStatus: 'done', missedEras: [], eraStat: [{ era: 1 }],
    bondedTotal: 100n, nominators: [{ address: 'n1' }, { address: 'n2' }], commission: 5,
  },
  {
    address: 'enBBB', display: 'Beta Validator', isActive: false,
    fetchStatus: 'done', missedEras: [1170, 1169], eraStat: [{ era: 1 }],
    bondedTotal: 300n, nominators: [{ address: 'n1' }], commission: 2,
  },
  {
    address: 'enCCC', display: 'Gamma Validator', isActive: true,
    fetchStatus: 'error', missedEras: [], eraStat: [],
    bondedTotal: 200n, nominators: [], commission: 8,
  },
]

const pools = [
  {
    poolId: 7, metadata: 'Dragons', stashAddress: 'enPoolA', state: 'Open',
    fetchStatus: 'done', missedEras: [], eraRewards: [{ era: 1 }],
    totalBonded: 1_000_000n, memberCount: 10, commission: 3,
  },
  {
    poolId: 21, metadata: '', stashAddress: 'enPoolB', state: 'Blocked',
    fetchStatus: 'done', missedEras: [1170], eraRewards: [{ era: 1 }],
    totalBonded: 500_000n, memberCount: 4, commission: 1,
  },
  {
    poolId: 42, metadata: 'Destroy Me', stashAddress: 'enPoolC', state: 'Destroying',
    fetchStatus: 'error', missedEras: [], eraRewards: [],
    totalBonded: 2_000_000n, memberCount: 50, commission: 9,
  },
]

describe('isStakingFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isStakingFilterActive(EMPTY_STAKING_FILTER)).toBe(false)
  })

  it('is false for null/undefined', () => {
    expect(isStakingFilterActive(null)).toBe(false)
    expect(isStakingFilterActive(undefined)).toBe(false)
  })

  it('is true when any single field is set', () => {
    expect(isStakingFilterActive({ ...EMPTY_STAKING_FILTER, search: 'x' })).toBe(true)
    expect(isStakingFilterActive({ ...EMPTY_STAKING_FILTER, status: 'missed' })).toBe(true)
    expect(isStakingFilterActive({ ...EMPTY_STAKING_FILTER, missedMin: '1' })).toBe(true)
    expect(isStakingFilterActive({ ...EMPTY_STAKING_FILTER, missedMax: '5' })).toBe(true)
    expect(isStakingFilterActive({ ...EMPTY_STAKING_FILTER, sortKey: 'bonded' })).toBe(true)
  })

  it('ignores whitespace-only search', () => {
    expect(isStakingFilterActive({ ...EMPTY_STAKING_FILTER, search: '   ' })).toBe(false)
  })
})

describe('applyStakingFilter — no-op', () => {
  it('returns the same list unfiltered (no active filter)', () => {
    const out = applyStakingFilter(validators, 'validators', EMPTY_STAKING_FILTER)
    expect(out).toEqual(validators)
  })

  it('never mutates the input array or its rows', () => {
    const copy = validators.map(v => ({ ...v }))
    applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'bonded' })
    expect(validators).toEqual(copy)
    // Order of the original array is untouched even though a sort ran.
    expect(validators.map(v => v.address)).toEqual(['enAAA', 'enBBB', 'enCCC'])
  })

  it('handles a non-array input', () => {
    expect(applyStakingFilter(null, 'validators', EMPTY_STAKING_FILTER)).toEqual([])
    expect(applyStakingFilter(undefined, 'validators', { ...EMPTY_STAKING_FILTER, search: 'x' })).toEqual([])
  })
})

describe('applyStakingFilter — text search', () => {
  it('matches validator display name, case-insensitively', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, search: 'BETA' })
    expect(out.map(v => v.address)).toEqual(['enBBB'])
  })

  it('matches validator address', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, search: 'enccc' })
    expect(out.map(v => v.address)).toEqual(['enCCC'])
  })

  it('matches pool metadata, id and stash address', () => {
    expect(applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, search: 'dragons' }).map(p => p.poolId)).toEqual([7])
    expect(applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, search: '#21' }).map(p => p.poolId)).toEqual([21])
    expect(applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, search: 'enpoolc' }).map(p => p.poolId)).toEqual([42])
  })

  it('matches a pool with empty metadata by its generated label', () => {
    // pool 21 has metadata: '' — poolLabel falls back to stashDisplay/poolId
    const out = applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, search: '21' })
    expect(out.map(p => p.poolId)).toEqual([21])
  })
})

describe('applyStakingFilter — status', () => {
  it('missed: only rows with missedEras', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, status: 'missed' })
    expect(out.map(v => v.address)).toEqual(['enBBB'])
  })

  it('clean: no missed eras AND era data present', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, status: 'clean' })
    // enCCC has no missed eras either, but empty eraStat disqualifies it —
    // it errored out, not "clean".
    expect(out.map(v => v.address)).toEqual(['enAAA'])
  })

  it('errors: fetchStatus error or failed', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, status: 'errors' })
    expect(out.map(v => v.address)).toEqual(['enCCC'])
  })

  it('active / inactive (validators only)', () => {
    expect(applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, status: 'active' }).map(v => v.address))
      .toEqual(['enAAA', 'enCCC'])
    expect(applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, status: 'inactive' }).map(v => v.address))
      .toEqual(['enBBB'])
  })

  it('open / blocked / destroying (pools only)', () => {
    expect(applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, status: 'open' }).map(p => p.poolId)).toEqual([7])
    expect(applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, status: 'blocked' }).map(p => p.poolId)).toEqual([21])
    expect(applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, status: 'destroying' }).map(p => p.poolId)).toEqual([42])
  })
})

describe('applyStakingFilter — missed-era range', () => {
  it('minimum bound only', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, missedMin: '1' })
    expect(out.map(v => v.address)).toEqual(['enBBB'])
  })

  it('maximum bound only', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, missedMax: '0' })
    expect(out.map(v => v.address)).toEqual(['enAAA', 'enCCC'])
  })

  it('both bounds together', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, missedMin: '1', missedMax: '2' })
    expect(out.map(v => v.address)).toEqual(['enBBB'])
  })

  it('a blank bound is unbounded, not zero', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, missedMin: '' })
    expect(out).toEqual(validators)
  })

  it('an unparseable bound is ignored rather than excluding everything', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, missedMin: 'abc' })
    expect(out).toEqual(validators)
  })
})

describe('applyStakingFilter — sort', () => {
  it('sorts by missed-era count', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'missed', sortDir: 'desc' })
    expect(out.map(v => v.address)).toEqual(['enBBB', 'enAAA', 'enCCC'])
  })

  it('sorts by BigInt bonded total without precision loss', () => {
    // Values differ by far less than float64 could distinguish at this
    // magnitude if compared via Number(); BigInt comparison must stay exact.
    const huge1 = 10_000_000_000_000_000_000n
    const huge2 = huge1 + 1n
    const rows = [
      { address: 'a', bondedTotal: huge2, missedEras: [] },
      { address: 'b', bondedTotal: huge1, missedEras: [] },
    ]
    const asc = applyStakingFilter(rows, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'bonded', sortDir: 'asc' })
    expect(asc.map(r => r.address)).toEqual(['b', 'a'])
    const desc = applyStakingFilter(rows, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'bonded', sortDir: 'desc' })
    expect(desc.map(r => r.address)).toEqual(['a', 'b'])
  })

  it('sorts pools by bonded total (totalBonded field)', () => {
    const out = applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, sortKey: 'bonded', sortDir: 'asc' })
    expect(out.map(p => p.poolId)).toEqual([21, 7, 42])
  })

  it('sorts by holders (nominators for validators, memberCount for pools)', () => {
    const vOut = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'holders', sortDir: 'desc' })
    expect(vOut.map(v => v.address)).toEqual(['enAAA', 'enBBB', 'enCCC'])

    const pOut = applyStakingFilter(pools, 'pools', { ...EMPTY_STAKING_FILTER, sortKey: 'holders', sortDir: 'asc' })
    expect(pOut.map(p => p.poolId)).toEqual([21, 7, 42])
  })

  it('sorts by commission', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'commission', sortDir: 'asc' })
    expect(out.map(v => v.address)).toEqual(['enBBB', 'enAAA', 'enCCC'])
  })

  it('defaults to descending direction when sortDir is unset', () => {
    const out = applyStakingFilter(validators, 'validators', { ...EMPTY_STAKING_FILTER, sortKey: 'commission' })
    expect(out.map(v => v.address)).toEqual(['enCCC', 'enAAA', 'enBBB'])
  })
})

describe('applyStakingFilter — combined filter + sort', () => {
  it('filters first, then sorts only the surviving rows', () => {
    const out = applyStakingFilter(pools, 'pools', {
      ...EMPTY_STAKING_FILTER, status: 'errors', sortKey: 'bonded', sortDir: 'asc',
    })
    // Only pool 42 has fetchStatus 'error'; sort must not reintroduce others.
    expect(out.map(p => p.poolId)).toEqual([42])
  })
})

describe('compareSortValues', () => {
  it('orders numbers', () => {
    expect(compareSortValues(1, 2)).toBe(-1)
    expect(compareSortValues(2, 1)).toBe(1)
    expect(compareSortValues(5, 5)).toBe(0)
  })

  it('orders BigInts', () => {
    expect(compareSortValues(1n, 2n)).toBe(-1)
    expect(compareSortValues(2n, 1n)).toBe(1)
    expect(compareSortValues(5n, 5n)).toBe(0)
  })
})

describe('statusesFor / sortsFor', () => {
  it('validators get isActive-specific options, pools get pool-state options', () => {
    const vKeys = statusesFor('validators').map(s => s.key)
    const pKeys = statusesFor('pools').map(s => s.key)
    expect(vKeys).toContain('active')
    expect(vKeys).toContain('inactive')
    expect(vKeys).not.toContain('open')
    expect(pKeys).toContain('open')
    expect(pKeys).toContain('blocked')
    expect(pKeys).toContain('destroying')
    expect(pKeys).not.toContain('active')
  })

  it('both share the same base sort keys', () => {
    expect(sortsFor('validators').map(s => s.key)).toEqual(['default', 'missed', 'bonded', 'holders', 'commission'])
    expect(sortsFor('pools').map(s => s.key)).toEqual(['default', 'missed', 'bonded', 'holders', 'commission'])
  })
})

describe('describeStakingFilter', () => {
  it('returns null when nothing is filtered', () => {
    expect(describeStakingFilter(EMPTY_STAKING_FILTER, { totalRecords: 10, exportedRecords: 10 })).toBeNull()
  })

  it('flattens an active filter with the record counts', () => {
    const desc = describeStakingFilter(
      { ...EMPTY_STAKING_FILTER, search: '  dragons  ', missedMin: '2' },
      { totalRecords: 27, exportedRecords: 1 },
    )
    expect(desc).toMatchObject({
      search: 'dragons', // trimmed
      status: 'all',
      missedMin: 2,
      missedMax: null,
      sortKey: 'default',
      sortDir: 'desc',
      totalRecords: 27,
      exportedRecords: 1,
    })
  })
})
