import { useId, useRef } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// Controls whose own UI chrome (a native date picker, a number spinner, a
// select's chevron) means the browser either never reports :placeholder-shown
// or reports it inconsistently. These fall back to the data-filled attribute,
// which is derived from the value instead.
const PLACEHOLDER_UNRELIABLE = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'number'])

/**
 * Whether the label should sit lifted regardless of :placeholder-shown.
 *
 * Exported for its own test: it is the one piece of logic that decides
 * whether a filled date or number field looks filled, and it is invisible
 * from the outside until it is wrong.
 */
export function isFilled({ as, type, value }) {
  if (as === 'select') return true
  if (as === 'input' && !PLACEHOLDER_UNRELIABLE.has(type)) return false
  return String(value ?? '').length > 0
}

/**
 * A labelled form control with a floating label.
 *
 * Replaces the .input-label + .input-field pairing that was repeated ad hoc
 * across every tool form. The control is rendered *before* the label so the
 * CSS can reach the label from the control with `+`; the label's lifted state
 * is deliberately styled as the app's old .input-label treatment, so a
 * focused field lands on the existing design language rather than beside it.
 *
 * A caller-supplied `placeholder` is passed through as an example value
 * (e.g. "1000") rather than dropped: :placeholder-shown fires for any
 * non-empty placeholder, not specifically a single space, so real hint text
 * works exactly like the empty-field fallback. The CSS keeps it invisible
 * until the field is focused, otherwise it would sit directly under the
 * resting (unlifted) label and the two would overlap.
 *
 * A number field gets its own chevron stepper in place of the native spinner
 * — see the .field__stepper block in index.css for why the native one cannot
 * be centred here. Staking Cadence is unaffected: its inputs go through
 * Stepper.jsx as type="text", not through this component.
 */
export default function Field({
  label,
  id,
  as = 'input',
  type = 'text',
  value,
  placeholder = ' ',
  error,
  hint,
  icon,
  variant,
  className = '',
  controlClassName = '',
  children,
  ...rest
}) {
  const generatedId = useId()
  const inputRef = useRef(null)
  const controlId = id ?? generatedId
  const messageId = `${controlId}-message`
  const message = error || hint

  const filled = isFilled({ as, type, value })
  const controlClass = as === 'select' ? 'select-field' : 'input-field'
  const hasStepper = as === 'input' && type === 'number' && !rest.disabled && !rest.readOnly

  /**
   * Step the value by one `step` unit.
   *
   * stepUp/stepDown do the clamping against min/max/step natively, but they
   * write straight to the DOM node — React's controlled-input value tracker
   * still holds the old value, so the change event it synthesises would be
   * discarded as a no-op and onChange would never fire. Re-applying the
   * result through the prototype's own setter resets that tracker, which is
   * what makes the dispatched event reach the caller.
   */
  function step(direction) {
    const el = inputRef.current
    if (!el) return
    try {
      if (direction > 0) el.stepUp()
      else el.stepDown()
    } catch {
      // stepUp/stepDown throw on a value the control cannot parse. Fall back
      // to the floor of the range so a click still does something sensible.
      el.value = el.min !== '' ? el.min : '0'
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, el.value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const shared = {
    id: controlId,
    value,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': message ? messageId : undefined,
    className: `${controlClass} ${controlClassName}`,
    ...rest,
  }

  return (
    <div
      className={`field ${className}`}
      data-filled={filled ? 'true' : 'false'}
      data-invalid={error ? 'true' : 'false'}
      data-icon={icon ? 'true' : 'false'}
      data-stepper={hasStepper ? 'true' : 'false'}
      data-variant={variant}
    >
      {/* The label is positioned against this box rather than against
          .field, so that it stays anchored to the control. Anchoring it to
          .field instead makes its resting position depend on whether an
          error message is rendered below — the message grows .field, and a
          `top: 50%` label slides down onto the input's own text. */}
      <div className="field__box">
        {icon && <span className="field__icon">{icon}</span>}

        {as === 'select' ? (
          <select {...shared}>{children}</select>
        ) : as === 'textarea' ? (
          <textarea {...shared} />
        ) : (
          <input {...shared} ref={inputRef} type={type} />
        )}

        <label htmlFor={controlId} className="field__label">
          {label}
        </label>

        {/* Pointer affordance only. The input's own ArrowUp/ArrowDown already
            covers keyboard and screen-reader users, so these stay out of the
            tab order and out of the accessibility tree rather than adding two
            extra stops to every number field in the app. onMouseDown is
            suppressed so a click doesn't pull focus off the input and drop
            the floating label back down mid-edit. */}
        {hasStepper && (
          <span className="field__stepper" aria-hidden="true">
            <button
              type="button"
              tabIndex={-1}
              className="field__stepper-btn"
              onMouseDown={e => e.preventDefault()}
              onClick={() => step(1)}
            >
              <ChevronUp size={11} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="field__stepper-btn"
              onMouseDown={e => e.preventDefault()}
              onClick={() => step(-1)}
            >
              <ChevronDown size={11} strokeWidth={2.5} />
            </button>
          </span>
        )}
      </div>

      {message && (
        <p
          id={messageId}
          className={`field__message ${error ? 'text-danger' : 'text-text-secondary'}`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
