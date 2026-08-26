import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Mirrors the OS reduced-motion preference for JS-driven (rAF) animation,
 * which the CSS-only reduce block in index.css cannot reach — a count-up or
 * typewriter effect runs its own frame loop rather than an animated CSS
 * property, so it needs its own check.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
