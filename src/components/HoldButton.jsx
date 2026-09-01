import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js'
import { useHoverCapable } from '../hooks/useHoverCapable.js'

// Mirrors the --m-intent token in index.css. Following the same convention as
// useCountUp: a JS timer cannot react to that token's reduced-motion override
// the way a CSS transition does, so the preference is checked directly (below)
// rather than read back out of computed style.
const HOLD_MS = 700
const NUDGE_MS = 220
// The pulse is a 220ms flinch; four words need longer than that to be read.
// Separate timer so the two cues can each run at their own natural pace.
const HINT_MS = 1600

/**
 * Decides whether an interaction should fire the button's action.
 *
 * Pulled out as a pure function because it is the whole safety contract of
 * this component: gate the pointer path, never gate the keyboard path.
 *
 *  - keyboard  — always fires. Enter/Space have no hover phase, so gating
 *                them would make the control unreachable without a mouse.
 *  - instant   — no hover-capable pointer, or reduced motion is on. Both
 *                mean the charge affordance cannot be perceived or
 *                completed, so the gate is lifted rather than enforced
 *                invisibly.
 *  - armed     — the hover charge ran to completion.
 */
export function canActivate({ instant, armed, source }) {
  if (source === 'keyboard') return true
  return Boolean(instant || armed)
}

/**
 * Classifies a click event as pointer-driven or not.
 *
 * A click synthesised by assistive tech, or by element.click(), arrives with
 * no preceding pointerdown and reports detail 0 — a real mouse click always
 * reports at least 1. Without this check such a click would be judged against
 * a charge the user had no way to perform, and Stop would silently do nothing
 * for a screen-reader user.
 */
export function clickSource(event) {
  return event?.detail > 0 ? 'pointer' : 'keyboard'
}

/**
 * Whether the pointer has genuinely rested on the control long enough.
 *
 * Checked against the clock rather than trusting the arming timer to have
 * fired. The CSS charge is driven by the compositor and completes on time
 * even while the main thread is saturated, but a setTimeout on a busy thread
 * runs late — and a scan heavy enough to make someone reach for Stop is
 * exactly when the main thread is busiest. Without this the charge would look
 * full while the click was still being refused.
 */
export function hasHeldLongEnough(enterAt, now, holdMs) {
  return enterAt != null && now - enterAt >= holdMs
}

/**
 * A button that only honours a pointer click after the pointer has rested on
 * it for --m-intent, with the charge drawn as a fill sweeping across it.
 *
 * Used for Stop and Reset. The gate exists to make an accidental click on a
 * long-running scan hard, not to make a deliberate one hard — which is why
 * every path that cannot express "rest here for 700ms" (keyboard, touch,
 * reduced motion) bypasses it entirely rather than degrading.
 */
export default function HoldButton({
  onActivate,
  children,
  className = '',
  hintId,
  holdMs = HOLD_MS,
  disabled = false,
  ...rest
}) {
  const reducedMotion = usePrefersReducedMotion()
  const hoverCapable = useHoverCapable()
  const instant = reducedMotion || !hoverCapable

  const [armed, setArmed] = useState(false)
  const [nudge, setNudge] = useState(false)
  // Shown only after a click this component actually refused — the one
  // moment a user has demonstrated they don't know the control is guarded.
  // Explaining on hover instead would tax everyone who was already waiting.
  const [hint, setHint] = useState(false)
  const armTimerRef = useRef(null)
  const nudgeTimerRef = useRef(null)
  const hintTimerRef = useRef(null)
  // A hybrid laptop reports `hover: hover` because its *primary* pointer is a
  // mouse, so a finger tap on one would otherwise hit the gate and do
  // nothing. The pointer type of the actual interaction settles it.
  const pointerTypeRef = useRef('mouse')
  // When the pointer arrived, so the click can be judged against the clock
  // rather than against whether the arming timer has run yet.
  const enterAtRef = useRef(null)
  const generatedHintId = useId()
  const describedBy = hintId ?? generatedHintId

  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
  }, [])

  // Drop the hint the moment the wait is over, even if its timer has not run
  // out — telling someone to hold a button that is already armed is worse
  // than saying nothing.
  useEffect(() => {
    if (!armed) return
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    setHint(false)
  }, [armed])

  const disarm = useCallback(() => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    armTimerRef.current = null
    enterAtRef.current = null
    setArmed(false)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    setHint(false)
  }, [])

  function handlePointerEnter() {
    if (instant || disabled) return
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    enterAtRef.current = performance.now()
    // Nothing user-facing depends on this timer landing on time: whether a
    // click is honoured is decided from enterAtRef against the clock, and the
    // armed *look* is a CSS animation off :hover (see .hold-btn__charge in
    // index.css). `armed` remains only to clear the hint below and as a
    // handle for tests, both of which tolerate running late.
    armTimerRef.current = setTimeout(() => setArmed(true), holdMs)
  }

  function handlePointerDown(e) {
    pointerTypeRef.current = e.pointerType || 'mouse'
  }

  function handleClick(e) {
    const touched = pointerTypeRef.current === 'touch' || pointerTypeRef.current === 'pen'
    pointerTypeRef.current = 'mouse'

    const held = hasHeldLongEnough(enterAtRef.current, performance.now(), holdMs)

    if (canActivate({ instant: instant || touched, armed: armed || held, source: clickSource(e) })) {
      onActivate?.(e)
      return
    }

    // Clicked early. Pulse rather than reset the charge — resetting would
    // punish the impatient click, and the charge is already most of the way
    // there by the time anyone reaches for it.
    setNudge(true)
    setHint(true)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(false), HINT_MS)
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    nudgeTimerRef.current = setTimeout(() => setNudge(false), NUDGE_MS)
  }

  function handleKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    // Holding a key repeats keydown. Without this guard, resting on Space
    // would fire the action dozens of times a second.
    if (e.repeat) return
    // preventDefault stops the browser synthesising the click that would
    // otherwise follow (on keydown for Enter, on keyup for Space), so the
    // action fires exactly once via this path.
    e.preventDefault()
    onActivate?.(e)
  }

  return (
    <button
      type="button"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={disarm}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onBlur={disarm}
      disabled={disabled}
      data-armed={armed ? 'true' : 'false'}
      data-nudge={nudge ? 'true' : 'false'}
      aria-describedby={instant ? undefined : describedBy}
      className={`hold-btn ${className}`}
      {...rest}
    >
      <span className="hold-btn__charge" aria-hidden="true" />
      <span className="hold-btn__body">{children}</span>
      {/* Absolutely positioned so it cannot resize the button, and
          aria-hidden because the describedby text below already explains
          the interaction to anyone not using a pointer — and a keyboard
          user never reaches this path at all. */}
      {hint && <span className="hold-btn__hint" aria-hidden="true">Hold</span>}
      {!instant && (
        <span id={describedBy} className="sr-only">
          Hold the pointer here briefly to enable, or press Enter to act immediately.
        </span>
      )}
    </button>
  )
}
