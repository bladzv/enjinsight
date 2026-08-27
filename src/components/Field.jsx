import { useId } from 'react'

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
  const controlId = id ?? generatedId
  const messageId = `${controlId}-message`
  const message = error || hint

  const filled = isFilled({ as, type, value })
  const controlClass = as === 'select' ? 'select-field' : 'input-field'

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
          <input {...shared} type={type} />
        )}

        <label htmlFor={controlId} className="field__label">
          {label}
        </label>
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
