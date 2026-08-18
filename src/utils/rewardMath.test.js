import { describe, it, expect } from 'vitest'
import { netReinvested, poolRate, memberEraReward } from './rewardMath.js'

// Real on-chain figures for pool 98, era 1126 (pinned identically in the Enjin indexer's
// tests/reward-math.test.ts, so both projects assert the same ground truth).
const reward = 201_003_300_000_000_000_000n // 201.0033 ENJ gross
const commission = 14_077_200_000_000_000_000n // 14.0772 ENJ, ≈7.0035%
const changeInRate = 532_539_618_873_000n
const poolPoints = 351_008_796350609579401932n

const toEnj = (value) => Number(value) / 1e18

describe('netReinvested', () => {
  it('subtracts commission from the gross reward', () => {
    const net = netReinvested(reward, commission)
    expect(Math.abs(toEnj(net) - 186.9261)).toBeLessThanOrEqual(0.01)
  })

  it('is exactly 2x commission away from the old buggy reward + commission', () => {
    const net = netReinvested(reward, commission)
    const buggy = reward + commission
    expect(Math.abs(toEnj(buggy) - 215.0805)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(toEnj(buggy - net) - 2 * toEnj(commission))).toBeLessThanOrEqual(0.001)
  })

  it('clamps at zero when commission exceeds reward', () => {
    expect(netReinvested(10n, 20n)).toBe(0n)
  })
})

describe('memberEraReward', () => {
  it('agrees with netReinvested via the rate-movement route', () => {
    const compounded = memberEraReward(poolPoints, changeInRate)
    expect(Math.abs(toEnj(compounded) - 186.9261)).toBeLessThanOrEqual(0.05)
  })

  it('clamps at zero for a negative rate change (e.g. a slash era)', () => {
    expect(memberEraReward(poolPoints, -changeInRate)).toBe(0n)
  })
})

describe('poolRate', () => {
  it('computes ENJ-per-point scaled by 1e18', () => {
    expect(poolRate(1_050_000n, 1_000_000n)).toBe(1_050_000_000_000_000_000n)
  })

  it('returns 0n when pool supply is zero', () => {
    expect(poolRate(1_000n, 0n)).toBe(0n)
  })
})
