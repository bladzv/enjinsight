import { describe, it, expect } from 'vitest'
import { resolvePillGeometry } from './PillSwitch.jsx'

// resolvePillGeometry is what stops the pill from collapsing to nothing and
// growing back — the failure mode confirmed live in the mobile drawer, where
// the rail's hidden PillSwitch instance measures 0 while off-screen.
describe('resolvePillGeometry', () => {
  it('accepts a real measurement', () => {
    const geo = resolvePillGeometry({ left: 4, width: 103 }, null)
    expect(geo).toEqual({ left: 4, width: 103 })
  })

  it('discards a zero-width reading and keeps the last known good geometry', () => {
    const previous = { left: 4, width: 103 }
    const geo = resolvePillGeometry({ left: 0, width: 0 }, previous)
    expect(geo).toBe(previous)
  })

  it('has nothing to fall back to on first mount, so a zero-width reading yields null', () => {
    const geo = resolvePillGeometry({ left: 0, width: 0 }, null)
    expect(geo).toBeNull()
  })

  it('updates once a hidden instance becomes visible again', () => {
    const stale = { left: 4, width: 103 }
    const hidden = resolvePillGeometry({ left: 0, width: 0 }, stale)
    const visible = resolvePillGeometry({ left: 119, width: 115 }, hidden)
    expect(visible).toEqual({ left: 119, width: 115 })
  })
})
