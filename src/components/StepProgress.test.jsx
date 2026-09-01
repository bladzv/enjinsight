import { describe, it, expect } from 'vitest'
import { getStepState } from './StepProgress.jsx'

// The four wizards in the app: 4-step (staking/balance/infusion) and 5-step
// (reward history). Callers clamp currentStep to steps.length, which is why
// `complete` has to exist at all.
const TOTAL = 4

function state(index, currentStep, complete = false) {
  return getStepState({ index, currentStep, total: TOTAL, complete })
}

describe('getStepState', () => {
  it('numbers a step the run has not reached yet', () => {
    const { isDone, isActive } = state(2, 2) // step 3, sitting on step 2
    expect(isDone).toBe(false)
    expect(isActive).toBe(false)
  })

  it('checks a step the run has moved past', () => {
    const { isDone, isActive } = state(0, 3) // step 1, sitting on step 3
    expect(isDone).toBe(true)
    expect(isActive).toBe(false)
  })

  it('marks the step the run is currently on as active, not done', () => {
    const { isDone, isActive } = state(1, 2)
    expect(isDone).toBe(false)
    expect(isActive).toBe(true)
  })

  it('leaves the final step active while the run is unfinished', () => {
    // The regression this whole prop exists for: currentStep is clamped to
    // total, so without `complete` the last circle could never be checked.
    const { isDone, isActive } = state(TOTAL - 1, TOTAL, false)
    expect(isDone).toBe(false)
    expect(isActive).toBe(true)
  })

  it('checks the final step once the run completes successfully', () => {
    const { isDone, isActive } = state(TOTAL - 1, TOTAL, true)
    expect(isDone).toBe(true)
    expect(isActive).toBe(false)
  })

  it('does not check earlier steps just because the run completed', () => {
    // `complete` must only ever promote the *last* circle — a mid-list step
    // still has to earn its state from currentStep.
    const current = state(1, 2, true) // step 2 of 4, sitting on step 2
    expect(current.isDone).toBe(false)
    expect(current.isActive).toBe(true)

    const notReached = state(2, 2, true) // step 3 of 4, not reached yet
    expect(notReached.isDone).toBe(false)
    expect(notReached.isActive).toBe(false)
  })

  it('reports 1-indexed step numbers for display', () => {
    expect(state(0, 1).stepNum).toBe(1)
    expect(state(TOTAL - 1, TOTAL).stepNum).toBe(TOTAL)
  })

  it('handles a 5-step wizard, where complete applies to step 5', () => {
    const onFive = getStepState({ index: 4, currentStep: 5, total: 5, complete: true })
    expect(onFive.isDone).toBe(true)
    const onFour = getStepState({ index: 3, currentStep: 5, total: 5, complete: true })
    expect(onFour.isDone).toBe(true)   // passed
    expect(onFour.isActive).toBe(false)
  })

  it('defaults complete to false so callers that omit it keep old behaviour', () => {
    const { isDone, isActive } = getStepState({ index: TOTAL - 1, currentStep: TOTAL, total: TOTAL })
    expect(isDone).toBe(false)
    expect(isActive).toBe(true)
  })
})
