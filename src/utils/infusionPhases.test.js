import { describe, it, expect } from 'vitest'
import { derivePhases, BULK_PROGRESS_PHASES, SINGLE_PROGRESS_PHASES } from './infusionPhases.js'

// Base "not started" state for each mode — individual tests override only what they need.
const idleWallet = {
  mode: 'wallet',
  outcome: null,
  isLoading: false,
  bulkStarted: false,
  bulkExpectedTotal: 0,
  rowCount: 0,
  metadataProgress: { total: 0, completed: 0 },
  retryProgress: { total: 0, completed: 0, active: false },
}
const idleSingle = {
  mode: 'single',
  outcome: null,
  isLoading: false,
  singleStarted: false,
  singleSucceeded: false,
}

const byKey = (phases, key) => phases.find(p => p.key === key)

describe('derivePhases — wallet mode, no outcome yet (live progress)', () => {
  it('returns all-pending phases before a scan starts', () => {
    const phases = derivePhases(idleWallet)
    expect(phases).toHaveLength(4) // no retries phase until a retry pass exists
    expect(phases.every(p => p.status === 'pending')).toBe(true)
  })

  it('marks wallet fetch completed and infusion reading in_progress mid-scan', () => {
    const phases = derivePhases({
      ...idleWallet,
      isLoading: true,
      bulkStarted: true,
      bulkExpectedTotal: 10,
      rowCount: 3,
    })
    expect(byKey(phases, 'wallet').status).toBe('completed')
    expect(byKey(phases, 'infusions').status).toBe('in_progress')
    expect(byKey(phases, 'infusions').completed).toBe(3)
    expect(byKey(phases, 'infusions').total).toBe(10)
  })

  it('adds the retries phase only once a retry pass has a total', () => {
    const withoutRetry = derivePhases(idleWallet)
    expect(byKey(withoutRetry, 'retries')).toBeUndefined()

    const withRetry = derivePhases({
      ...idleWallet,
      bulkStarted: true,
      retryProgress: { total: 2, completed: 1, active: true },
    })
    expect(byKey(withRetry, 'retries')).toMatchObject({ status: 'in_progress', total: 2, completed: 1 })
  })
})

describe('derivePhases — wallet mode, empty-result outcome (the original bug)', () => {
  const phases = derivePhases({
    ...idleWallet,
    bulkStarted: true,
    outcome: { kind: 'empty', stage: 'wallet', mode: 'wallet' },
  })

  it('marks the wallet-fetch phase completed with a reason, not queued', () => {
    const wallet = byKey(phases, 'wallet')
    expect(wallet.status).toBe('completed')
    expect(wallet.reason).toMatch(/no matching token ids found/i)
  })

  it('marks every later phase skipped with a reason instead of queued', () => {
    expect(byKey(phases, 'infusions')).toMatchObject({ status: 'skipped' })
    expect(byKey(phases, 'metadata')).toMatchObject({ status: 'skipped' })
    expect(byKey(phases, 'infusions').reason).toMatch(/skipped/i)
    expect(byKey(phases, 'metadata').reason).toMatch(/skipped/i)
  })

  it('marks Review completed — this is the exact case that used to render a false green 1/1', () => {
    expect(byKey(phases, 'review').status).toBe('completed')
  })
})

describe('derivePhases — wallet mode, error outcome (the false-green Review bug)', () => {
  it('fails the phase that actually threw, using its message as the reason', () => {
    const phases = derivePhases({
      ...idleWallet,
      bulkStarted: true,
      outcome: { kind: 'error', stage: 'wallet', message: 'Etherscan returned HTTP 502.', mode: 'wallet' },
    })
    expect(byKey(phases, 'wallet')).toMatchObject({ status: 'failed', reason: 'Etherscan returned HTTP 502.' })
    expect(byKey(phases, 'infusions').status).toBe('skipped')
    expect(byKey(phases, 'metadata').status).toBe('skipped')
    // This is the regression this whole test file exists to lock in: before the fix,
    // `reviewDone` went true on any zero-row terminal state, including failures.
    expect(byKey(phases, 'review').status).not.toBe('completed')
    expect(byKey(phases, 'review').status).toBe('skipped')
  })

  it('credits phases that finished before a later failure as completed, not skipped', () => {
    const phases = derivePhases({
      ...idleWallet,
      bulkStarted: true,
      bulkExpectedTotal: 5,
      outcome: { kind: 'error', stage: 'metadata', message: 'Metadata fetch failed.', mode: 'wallet' },
    })
    // wallet + infusions ran to completion before the scan died in metadata.
    expect(byKey(phases, 'wallet').status).toBe('completed')
    expect(byKey(phases, 'infusions').status).toBe('completed')
    expect(byKey(phases, 'metadata')).toMatchObject({ status: 'failed', reason: 'Metadata fetch failed.' })
    expect(byKey(phases, 'review').status).toBe('skipped')
  })

  it('falls back to stage index 0 if the outcome names an unknown stage', () => {
    const phases = derivePhases({
      ...idleWallet,
      bulkStarted: true,
      outcome: { kind: 'error', stage: 'nonexistent', message: 'boom', mode: 'wallet' },
    })
    expect(byKey(phases, 'wallet')).toMatchObject({ status: 'failed', reason: 'boom' })
  })
})

describe('derivePhases — wallet mode, canceled outcome', () => {
  it('marks the in-flight phase canceled and every later phase canceled, not skipped/queued', () => {
    const phases = derivePhases({
      ...idleWallet,
      bulkStarted: true,
      bulkExpectedTotal: 5,
      outcome: { kind: 'canceled', stage: 'infusions', mode: 'wallet' },
    })
    expect(byKey(phases, 'wallet').status).toBe('completed')
    expect(byKey(phases, 'infusions')).toMatchObject({ status: 'canceled', reason: 'Canceled by user' })
    expect(byKey(phases, 'metadata').status).toBe('canceled')
    expect(byKey(phases, 'review').status).toBe('canceled')
  })
})

describe('derivePhases — wallet mode, done outcome is a no-op overlay', () => {
  it('leaves the live-derived phases untouched', () => {
    const liveState = {
      ...idleWallet,
      bulkStarted: true,
      bulkExpectedTotal: 5,
      rowCount: 5,
      metadataProgress: { total: 5, completed: 5 },
    }
    const withoutOutcome = derivePhases(liveState)
    const withDoneOutcome = derivePhases({ ...liveState, outcome: { kind: 'done', stage: 'review', mode: 'wallet' } })
    expect(withDoneOutcome).toEqual(withoutOutcome)
  })
})

describe('derivePhases — mode gating', () => {
  it('ignores an outcome recorded for a different mode than the one being rendered', () => {
    // A single-mode failure must never bleed into the wallet cards after a tab switch.
    const phases = derivePhases({
      ...idleWallet,
      bulkStarted: true,
      outcome: { kind: 'error', stage: 'input', message: 'Token ID must contain digits only.', mode: 'single' },
    })
    expect(phases.every(p => p.status === 'pending')).toBe(true)
  })
})

describe('derivePhases — single mode', () => {
  it('returns all-pending phases before a check starts', () => {
    const phases = derivePhases(idleSingle)
    expect(phases).toHaveLength(3)
    expect(phases.every(p => p.status === 'pending')).toBe(true)
  })

  it('marks Validate Token completed and Read Contract in_progress mid-check', () => {
    const phases = derivePhases({ ...idleSingle, isLoading: true, singleStarted: true })
    expect(byKey(phases, 'input').status).toBe('completed')
    expect(byKey(phases, 'rpc').status).toBe('in_progress')
    expect(byKey(phases, 'decode').status).toBe('pending')
  })

  it('fails Validate Token on a validation error instead of leaving it green (the single-mode false-green bug)', () => {
    const phases = derivePhases({
      ...idleSingle,
      outcome: { kind: 'error', stage: 'input', message: 'Token ID must contain digits only.', mode: 'single' },
    })
    expect(byKey(phases, 'input')).toMatchObject({ status: 'failed', reason: 'Token ID must contain digits only.' })
    expect(byKey(phases, 'rpc').status).toBe('skipped')
    expect(byKey(phases, 'decode').status).toBe('skipped')
  })

  it('credits Validate Token as completed when the RPC read is what actually failed', () => {
    const phases = derivePhases({
      ...idleSingle,
      outcome: { kind: 'error', stage: 'rpc', message: 'All RPC endpoints failed.', mode: 'single' },
    })
    expect(byKey(phases, 'input').status).toBe('completed')
    expect(byKey(phases, 'rpc')).toMatchObject({ status: 'failed', reason: 'All RPC endpoints failed.' })
    expect(byKey(phases, 'decode').status).toBe('skipped')
  })

  it('marks canceled phases as canceled, not failed', () => {
    const phases = derivePhases({
      ...idleSingle,
      outcome: { kind: 'canceled', stage: 'rpc', mode: 'single' },
    })
    expect(byKey(phases, 'input').status).toBe('completed')
    expect(byKey(phases, 'rpc').status).toBe('canceled')
    expect(byKey(phases, 'decode').status).toBe('canceled')
  })
})

describe('phase templates', () => {
  it('bulk phase labels carry no redundant "Step N:" prefix', () => {
    BULK_PROGRESS_PHASES.forEach(phase => expect(phase.label).not.toMatch(/^Step \d+:/))
  })

  it('single and bulk templates start every phase pending', () => {
    expect(SINGLE_PROGRESS_PHASES.every(p => p.status === 'pending')).toBe(true)
    expect(BULK_PROGRESS_PHASES.every(p => p.status === 'pending')).toBe(true)
  })
})
