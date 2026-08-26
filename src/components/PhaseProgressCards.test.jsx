import { describe, it, expect } from 'vitest'
import { getStatusMeta, getPhasePercent } from './PhaseProgressCards.jsx'

const ALL_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'skipped', 'canceled']

describe('getStatusMeta', () => {
  it('gives failed a treatment distinct from every other status', () => {
    // failed must stand apart from every other status — it is the only "something went
    // wrong" treatment and must never be confused with a normal pending/queued card.
    const failedMeta = getStatusMeta('failed')
    expect(failedMeta.ringClass).toContain('danger')
    ALL_STATUSES.filter(s => s !== 'failed').forEach(status => {
      expect(getStatusMeta(status).ringClass).not.toEqual(failedMeta.ringClass)
    })
  })

  it('gives completed and in_progress distinct treatments from each other', () => {
    expect(getStatusMeta('completed').ringClass).not.toEqual(getStatusMeta('in_progress').ringClass)
  })

  it('gives skipped and canceled the same muted treatment as pending (distinct from failed)', () => {
    const pending = getStatusMeta('pending')
    expect(getStatusMeta('skipped')).toEqual(pending)
    expect(getStatusMeta('canceled')).toEqual(pending)
  })

  it('falls back to the pending treatment for an unrecognized status', () => {
    expect(getStatusMeta('bogus')).toEqual(getStatusMeta('pending'))
    expect(getStatusMeta(undefined)).toEqual(getStatusMeta('pending'))
  })
})

describe('getPhasePercent', () => {
  it('is 100 for completed regardless of total/completed counts', () => {
    expect(getPhasePercent({ status: 'completed', total: 0, completed: 0 })).toBe(100)
    expect(getPhasePercent({ status: 'completed', total: 5, completed: 1 })).toBe(100)
  })

  it('is 0 for skipped and canceled regardless of total/completed counts', () => {
    expect(getPhasePercent({ status: 'skipped', total: 5, completed: 3 })).toBe(0)
    expect(getPhasePercent({ status: 'canceled', total: 5, completed: 3 })).toBe(0)
  })

  it('computes a proportional percent for in_progress', () => {
    expect(getPhasePercent({ status: 'in_progress', total: 4, completed: 2 })).toBe(50)
    expect(getPhasePercent({ status: 'in_progress', total: 3, completed: 1 })).toBe(33)
  })

  it('is 0 when total is missing or zero, even mid-flight', () => {
    expect(getPhasePercent({ status: 'in_progress', total: 0, completed: 0 })).toBe(0)
    expect(getPhasePercent({ status: 'pending' })).toBe(0)
  })

  it('clamps completed above total instead of exceeding 100', () => {
    expect(getPhasePercent({ status: 'in_progress', total: 2, completed: 9 })).toBe(100)
  })
})
