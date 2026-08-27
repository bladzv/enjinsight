import { describe, it, expect } from 'vitest'
import { canActivate, clickSource, hasHeldLongEnough } from './HoldButton.jsx'

// canActivate is the safety contract of the hover-intent gate: it decides
// whether a Stop or Reset click is honoured. Every case below is a way the
// gate could lock a real user out of aborting a running scan.
describe('canActivate', () => {
  it('gates a pointer click that has not finished charging', () => {
    expect(canActivate({ instant: false, armed: false, source: 'pointer' })).toBe(false)
  })

  it('honours a pointer click once the charge completed', () => {
    expect(canActivate({ instant: false, armed: true, source: 'pointer' })).toBe(true)
  })

  it('never gates the keyboard, even mid-charge', () => {
    // Enter/Space have no hover phase. Gating them would make Stop
    // unreachable without a mouse.
    expect(canActivate({ instant: false, armed: false, source: 'keyboard' })).toBe(true)
  })

  it('lifts the gate when there is no hover-capable pointer', () => {
    // The touch case. A finger cannot rest on a control to charge it, so a
    // gate here would leave Stop permanently dead on a phone.
    expect(canActivate({ instant: true, armed: false, source: 'pointer' })).toBe(true)
  })

  it('lifts the gate under reduced motion', () => {
    // The charge animation is the only affordance telling the user to wait.
    // With motion suppressed there is nothing to wait for, so enforcing the
    // delay would just look like an unresponsive button.
    expect(canActivate({ instant: true, armed: false, source: 'pointer' })).toBe(true)
  })
})

// clickSource is the other half of the contract: it decides which path a
// click is judged against. A click that never came from a pointer must not be
// measured against a hover charge nobody could have performed.
describe('clickSource', () => {
  it('treats a real mouse click as pointer-driven', () => {
    expect(clickSource({ detail: 1 })).toBe('pointer')
  })

  it('treats a double click as pointer-driven', () => {
    expect(clickSource({ detail: 2 })).toBe('pointer')
  })

  it('treats a synthesised click as keyboard-equivalent', () => {
    // Assistive tech activation and element.click() both report detail 0.
    // Without this, Stop would silently no-op for a screen-reader user: the
    // gate would wait on a charge they have no way to perform.
    expect(clickSource({ detail: 0 })).toBe('keyboard')
  })

  it('defaults to keyboard-equivalent when detail is absent', () => {
    // Fail open, not closed. An unrecognised activation path should still be
    // able to abort a running scan.
    expect(clickSource({})).toBe('keyboard')
    expect(clickSource(undefined)).toBe('keyboard')
  })
})

// The composed behaviour, stated as the invariant that matters: there is no
// combination of inputs where a non-pointer activation fails to fire.
describe('gate never blocks a non-pointer activation', () => {
  for (const instant of [true, false]) {
    for (const armed of [true, false]) {
      it(`fires for a synthesised click (instant=${instant}, armed=${armed})`, () => {
        const source = clickSource({ detail: 0 })
        expect(canActivate({ instant, armed, source })).toBe(true)
      })
    }
  }
})

// hasHeldLongEnough decouples the decision from the arming timer. The bug it
// exists for: under a heavy scan the main thread is saturated, so setTimeout
// runs late while the compositor-driven CSS charge finishes on time — the
// button looks ready but refuses the click.
describe('hasHeldLongEnough', () => {
  it('rejects a click before the hold has elapsed', () => {
    expect(hasHeldLongEnough(1000, 1500, 700)).toBe(false)
  })

  it('accepts a click exactly at the threshold', () => {
    expect(hasHeldLongEnough(1000, 1700, 700)).toBe(true)
  })

  it('accepts a click once the hold has elapsed', () => {
    expect(hasHeldLongEnough(1000, 2400, 700)).toBe(true)
  })

  it('accepts a hold the arming timer was too busy to report', () => {
    // The regression: 900ms of real hover, but the timer has not run yet so
    // `armed` is still false. The clock says the user earned it.
    expect(hasHeldLongEnough(1000, 1900, 700)).toBe(true)
  })

  it('rejects when the pointer was never over the control', () => {
    // enterAt is nulled on leave/blur, so a stale charge cannot be reused.
    expect(hasHeldLongEnough(null, 99999, 700)).toBe(false)
  })
})
