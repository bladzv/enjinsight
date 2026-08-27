/**
 * The app's one spinner. Previously copy-pasted as an inline
 * `animate-spin rounded-full border-2 border-primary/30 border-t-primary`
 * div in eight places, which meant eight chances for the sizes to drift.
 *
 * Decorative by default: it is always rendered next to a text status line,
 * so announcing it as well would just duplicate that line. Pass a `label`
 * when it is genuinely the only signal that work is happening.
 *
 * `tone` picks the track colour: 'primary' on a normal surface, 'on-primary'
 * inside a filled button, where a violet spinner on a violet background is
 * invisible.
 */
const TONE = {
  primary: 'border-primary/30 border-t-primary',
  'on-primary': 'border-black/30 border-t-black',
}

export default function Spinner({ size = 40, tone = 'primary', label, className = '' }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      className={`inline-block animate-spin rounded-full border-2 ${TONE[tone]} ${className}`}
      style={{ width: size, height: size }}
    >
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
