import { useEffect, useRef, useState } from 'react'

/**
 * True once the returned ref's element has entered the viewport. Disconnects
 * after the first hit by default — for a one-shot entrance animation there is
 * no reason to keep observing an element that has already appeared.
 *
 * @param {{ threshold?: number, rootMargin?: string, once?: boolean }} [opts]
 * @returns {[React.RefObject, boolean]} [ref, inView]
 */
export function useInView({ threshold = 0.1, rootMargin = '0px', once = true } = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    // IntersectionObserver is unavailable in some test/SSR environments;
    // degrade to "already visible" rather than never rendering at all.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return undefined
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        if (once) observer.disconnect()
      } else if (!once) {
        setInView(false)
      }
    }, { threshold, rootMargin })

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, rootMargin, once])

  return [ref, inView]
}
