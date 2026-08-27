import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Segmented switch with an indicator pill that glides between options.
 *
 * The pill's geometry is measured off the active button rather than derived
 * from an index, so options may be different widths ("Dark" vs "Advanced")
 * without the pill drifting.
 *
 * Two failure modes the reference implementation in
 * docs/motion-examples-full.md does not handle, both of which are live here:
 *
 *  - Resize. The switch sits in a 240px rail that becomes a full-width
 *    mobile drawer, so a measurement taken once on mount goes stale.
 *    A ResizeObserver on the container re-measures.
 *  - First paint. Without suppressing the transition for the initial
 *    measurement the pill animates in from left:0 every time the component
 *    mounts, which on the mobile drawer is every time it opens.
 *
 * `semantics` picks the ARIA shape: 'group' keeps the aria-pressed toggle
 * pair the rail already used; 'tablist' is for switches that actually
 * control a panel.
 */
export default function PillSwitch({
  options,
  value,
  onChange,
  ariaLabel,
  semantics = 'group',
  disabled = false,
  className = '',
  optionClassName = '',
}) {
  const containerRef = useRef(null)
  const optionRefs = useRef(new Map())
  const [geometry, setGeometry] = useState(null)
  // Held false until a first successful measurement lands, which is what
  // suppresses the mount-time slide. See .pill-switch[data-init='false'].
  const [initialised, setInitialised] = useState(false)

  const measure = useCallback(() => {
    const el = optionRefs.current.get(value)
    if (!el) return
    const width = el.offsetWidth
    // A zero width means the switch is laid out but not visible (a
    // display:none ancestor, or a drawer mid-open). Keeping the last known
    // good geometry avoids collapsing the pill to nothing and then having
    // it grow back into place once the container is shown.
    if (width === 0) return
    setGeometry({ left: el.offsetLeft, width })
    setInitialised(true)
  }, [value])

  useLayoutEffect(measure, [measure])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const isTablist = semantics === 'tablist'

  return (
    <div
      ref={containerRef}
      role={isTablist ? 'tablist' : 'group'}
      aria-label={ariaLabel}
      data-init={initialised ? 'true' : 'false'}
      className={`pill-switch flex items-center rounded-sm border p-1 ${className}`}
      style={{ borderColor: 'var(--hairline)', background: 'var(--card)' }}
    >
      {geometry && (
        <span className="pill-switch__pill" aria-hidden="true" style={geometry} />
      )}

      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) optionRefs.current.set(option.value, el)
              else optionRefs.current.delete(option.value)
            }}
            type="button"
            role={isTablist ? 'tab' : undefined}
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            aria-pressed={isTablist ? undefined : active}
            aria-selected={isTablist ? active : undefined}
            aria-controls={isTablist ? option.controls : undefined}
            tabIndex={isTablist && !active ? -1 : undefined}
            className={`pill-switch__option inline-flex min-h-[2rem] flex-1 items-center justify-center gap-1 rounded-sm px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-40
              ${active ? 'text-primary' : 'text-text-secondary hover:text-text'} ${optionClassName}`}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
