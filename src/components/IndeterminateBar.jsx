/**
 * Indeterminate progress bar — work is happening, but the total is unknown
 * or not worth quantifying. A 40%-wide segment sweeps the full track.
 *
 * Deliberately carries no aria-valuenow: a progressbar with a value implies
 * a measurable fraction, and assistive tech renders "0%" for a missing one.
 * `aria-valuetext` carries the human-readable state instead.
 *
 * The segment opts into `.motion-essential` (defined in index.css) rather
 * than being frozen by the reduced-motion block. A scan bar that stops
 * moving is indistinguishable from a hung one, which is the exact failure
 * the escape hatch was added for; under reduced motion it slows to a 2.4s
 * non-oscillating sweep and is always paired with the label below it.
 */
export default function IndeterminateBar({ label = 'Working', className = '' }) {
  return (
    <div
      role="progressbar"
      aria-valuetext={label}
      aria-busy="true"
      className={`indeterminate-bar ${className}`}
    >
      <span className="indeterminate-bar__seg motion-essential" />
    </div>
  )
}
