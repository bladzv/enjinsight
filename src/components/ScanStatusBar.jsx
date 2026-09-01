import { Square } from 'lucide-react'
import HoldButton from './HoldButton.jsx'
import IndeterminateBar from './IndeterminateBar.jsx'

/**
 * The status strip shown above a tool's results while a scan is running:
 * an indeterminate bar, the current phase, and a guarded Stop.
 *
 * Replaces the four near-identical "running screen" panels the guided mode
 * used to render *instead of* results. Sitting above the results rather than
 * in place of them is the point — the results populate underneath it as the
 * scan proceeds.
 *
 * Sticky by default so it stays reachable while scrolling a long result
 * table; the offset clears the mobile header, which is itself sticky.
 * Callers inside an `overflow: hidden` container must pass sticky={false},
 * since a clipped ancestor silently disables position: sticky.
 */
export default function ScanStatusBar({
  label = 'Working…',
  meta,
  onStop,
  stopLabel = 'Stop',
  sticky = true,
  className = '',
}) {
  return (
    <section
      aria-label="Scan status"
      className={`${sticky ? 'sticky top-[var(--status-h)] z-20 lg:top-0' : ''}
        overflow-hidden rounded-sm border border-[var(--hairline)] bg-surface/95 backdrop-blur-md ${className}`}
    >
      <IndeterminateBar label={label} className="rounded-none" />

      <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          {/* One polite live region for the phase line. The per-item counter
              in `meta` changes several times a second during a scan; folding
              it into the same region rather than giving it its own keeps a
              screen reader announcing one coherent status instead of two
              interleaved ones. */}
          <p className="truncate text-sm font-semibold text-text" role="status" aria-live="polite">
            {label}
            {meta && <span className="ml-2 font-normal text-text-secondary">{meta}</span>}
          </p>
        </div>

        {onStop && (
          <HoldButton
            onActivate={onStop}
            className="btn-stop shrink-0"
            aria-label={`${stopLabel} the running scan`}
          >
            <Square size={14} className="fill-white stroke-white" />
            {stopLabel}
          </HoldButton>
        )}
      </div>
    </section>
  )
}
