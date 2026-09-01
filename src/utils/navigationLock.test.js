import { describe, it, expect } from 'vitest'
import { isNavigationLocked } from './navigationLock.js'

const idle = {
  isLoading: false,
  balanceScanActive: false,
  rewardScanActive: false,
  infusionScanActive: false,
}

describe('isNavigationLocked', () => {
  it('is unlocked when nothing is running', () => {
    expect(isNavigationLocked(idle)).toBe(false)
  })

  it('locks for the staking tool, which reports through isLoading directly', () => {
    expect(isNavigationLocked({ ...idle, isLoading: true })).toBe(true)
  })

  it('locks for each of the three lazy-loaded tools independently', () => {
    expect(isNavigationLocked({ ...idle, balanceScanActive: true })).toBe(true)
    expect(isNavigationLocked({ ...idle, rewardScanActive: true })).toBe(true)
    expect(isNavigationLocked({ ...idle, infusionScanActive: true })).toBe(true)
  })

  it('stays locked while any one flag is still true, not just when all are', () => {
    // The regression this guards: a naive rewrite (e.g. `.every` instead of
    // implicit OR, or an early return keyed on just one flag) could silently
    // stop covering a second concurrent-in-spirit tool.
    expect(isNavigationLocked({ ...idle, balanceScanActive: true, rewardScanActive: false })).toBe(true)
  })
})
