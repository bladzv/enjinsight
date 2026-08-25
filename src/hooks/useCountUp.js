import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.js'

// Mirrors the --m-count token in index.css. A rAF loop can't read that token
// and react to its reduced-motion override the way CSS transitions do, which
// is exactly why usePrefersReducedMotion exists — this hook checks it directly
// rather than trying to read the custom property back out of computed style.
const DEFAULT_DURATION_MS = 1100

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Animates a displayed number toward `target` with an ease-out curve, and
 * formats it through `format` on every frame — so callers can reuse an
 * existing formatter (formatENJ, toLocaleString, ...) instead of this hook
 * inventing its own number formatting.
 *
 * Under reduced motion, or on the first render, jumps straight to the final
 * formatted value with no animation.
 *
 * @param {number} target
 * @param {{ format?: (n: number) => string, durationMs?: number }} [opts]
 * @returns {string}
 */
export function useCountUp(target, { format = (n) => String(Math.round(n)), durationMs = DEFAULT_DURATION_MS } = {}) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const isFirstRunRef = useRef(true)

  useEffect(() => {
    const from = fromRef.current

    // No animation on mount (nothing to count up from) or under reduced motion.
    if (isFirstRunRef.current || prefersReducedMotion || from === target) {
      isFirstRunRef.current = false
      fromRef.current = target
      setDisplay(target)
      return undefined
    }

    let raf
    let start = null
    function tick(now) {
      if (start === null) start = now
      const t = Math.min(1, (now - start) / durationMs)
      setDisplay(from + (target - from) * easeOutCubic(t))
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, prefersReducedMotion])

  return format(display)
}
