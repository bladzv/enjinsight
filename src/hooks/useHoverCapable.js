import { useEffect, useState } from 'react'

const QUERY = '(hover: hover)'

/**
 * True when the primary pointer can hover — i.e. a mouse or trackpad.
 *
 * Needed by any control gated on hover: on a touch screen there is no hover
 * state to enter, so a hover-gated button would be permanently unreachable.
 * Callers arm such controls immediately when this returns false.
 *
 * Kept separate from a CSS `@media (hover: none)` rule because the gate is
 * enforced in JS (a click handler), and CSS cannot reach that decision.
 */
export function useHoverCapable() {
  const [hoverCapable, setHoverCapable] = useState(
    () => typeof window === 'undefined' || window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = (e) => setHoverCapable(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return hoverCapable
}
