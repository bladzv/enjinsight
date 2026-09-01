import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js'

/**
 * Quantity stepper: −/+ buttons flanking a still-typeable numeric input.
 * `value` is the raw string the caller owns (kept as a string so an
 * in-progress/empty edit doesn't force a premature "0"); `onChange` is
 * called with the next raw string for both button presses and typing.
 */
export default function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  disabled = false,
  inputId,
  ariaDescribedBy,
  ariaInvalid = false,
  compact = false,
  onKeyDown,
  placeholder,
}) {
  const [bump, setBump] = useState(false)
  const bumpTimerRef = useRef(null)
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => () => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
  }, [])

  const parsed = parseInt(value, 10)
  const current = Number.isFinite(parsed) ? parsed : (Number.isFinite(min) ? min : 0)
  const atMin = current <= min
  const atMax = current >= max
  // Derived from `max` so the field can't hold more digits than the ceiling
  // allows — keeps typing bounded without a second constant to maintain.
  const maxDigits = Number.isFinite(max) ? String(Math.floor(max)).length : 3

  function step(delta) {
    if (disabled) return
    const next = Math.min(max, Math.max(min, current + delta))
    if (next === current) return

    if (!prefersReducedMotion) {
      setBump(true)
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current)
      bumpTimerRef.current = setTimeout(() => setBump(false), 350)
    }

    onChange(String(next))
  }

  function handleInputChange(e) {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, maxDigits)
    onChange(raw)
  }

  const btnClass = 'step-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--hairline)] bg-card text-text-secondary transition-colors duration-150 hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--hairline)] disabled:hover:text-text-secondary'

  return (
    <div className="flex items-center justify-center gap-2.5">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled || atMin}
        aria-label="Decrease"
        className={btnClass}
      >
        <Minus size={14} />
      </button>

      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleInputChange}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        maxLength={maxDigits}
        style={{ width: `${Math.max(2, maxDigits + 1)}ch` }}
        className={`step-val tabular border-none bg-transparent px-0 py-0 text-center font-mono font-bold tracking-tight text-primary focus:outline-none disabled:opacity-50
          ${compact ? 'text-[2.5rem]' : 'text-3xl sm:text-4xl'}
          ${ariaInvalid ? 'text-danger' : ''}
          ${bump ? 'bump' : ''}`}
      />

      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled || atMax}
        aria-label="Increase"
        className={btnClass}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
