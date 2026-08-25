/**
 * Stroke-drawn checkmark, replacing the instant-appear lucide `Check` icon
 * wherever a step or phase flips to "done". `pathLength="1"` normalizes the
 * dash units regardless of the path's real length, so the draw-on animation
 * needs no measurement. Always decorative — every caller already has a
 * visible adjacent text label ("Complete", a step's own label) carrying the
 * same state, so this is aria-hidden rather than announced.
 */
export default function SuccessCheck({ size = 14, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`success-check ${className}`}
      aria-hidden="true"
    >
      <path pathLength="1" d="M5 13l4 4L19 7" />
    </svg>
  )
}
