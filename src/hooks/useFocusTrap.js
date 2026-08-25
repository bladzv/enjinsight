import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Traps Tab/Shift+Tab focus within `containerRef` while `active` is true,
 * moves focus into the container on activation, and restores focus to
 * whatever had it beforehand on deactivation/unmount.
 *
 * Without this, a keyboard user could Tab straight through a modal into the
 * rest of the page, and closing the modal left focus wherever the DOM removal
 * happened to leave it rather than back on the control that opened it.
 */
export function useFocusTrap(containerRef, active) {
  const returnFocusRef = useRef(null)

  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    returnFocusRef.current = document.activeElement

    const focusables = () => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    // Prefer the first focusable control; fall back to the container itself
    // (given tabIndex={-1} by the caller) so focus always lands inside.
    const initial = focusables()[0] ?? container
    // Deferred one tick so the panel's own mount/paint has already happened —
    // focusing during the same synchronous pass can be a no-op in some browsers.
    const raf = requestAnimationFrame(() => initial.focus())

    function onKeyDown(event) {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      container.removeEventListener('keydown', onKeyDown)
      const toRestore = returnFocusRef.current
      // Only refocus something still attached — the trigger could have been
      // removed by whatever state change is closing the modal.
      if (toRestore && document.contains(toRestore)) toRestore.focus()
    }
  }, [active, containerRef])
}
