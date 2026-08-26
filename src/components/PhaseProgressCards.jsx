import SuccessCheck from './SuccessCheck.jsx'
import { useCountUp } from '../hooks/useCountUp.js'

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function getPhasePercent(phase) {
  if (phase?.status === 'completed') return 100
  if (phase?.status === 'skipped' || phase?.status === 'canceled') return 0
  const total = Number(phase?.total) || 0
  const completed = Math.max(0, Number(phase?.completed) || 0)
  if (total <= 0) return 0
  return clampPercent((Math.min(completed, total) / total) * 100)
}

export function getStatusMeta(status) {
  if (status === 'completed') {
    return {
      cardClass: 'border-success/20 bg-success/5',
      ringClass: 'text-success',
      trackClass: 'text-success/10',
    }
  }
  if (status === 'in_progress') {
    return {
      cardClass: 'border-cyan/20 bg-card',
      ringClass: 'text-cyan',
      trackClass: 'text-cyan/10',
    }
  }
  if (status === 'failed') {
    return {
      cardClass: 'border-danger/20 bg-danger/5',
      ringClass: 'text-danger',
      trackClass: 'text-danger/10',
    }
  }
  if (status === 'skipped' || status === 'canceled') {
    return {
      cardClass: 'border-white/5 bg-card/80',
      ringClass: 'text-muted/45',
      trackClass: 'text-muted/20',
    }
  }
  return {
    cardClass: 'border-white/5 bg-card/80',
    ringClass: 'text-muted/45',
    trackClass: 'text-muted/20',
  }
}

function PhaseRing({ percent, phaseStatus }) {
  const size = 44
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - ((phaseStatus === 'completed' ? 100 : percent) / 100) * circumference
  const meta = getStatusMeta(phaseStatus)
  // Animated for display only — aria-hidden, so it never gets announced
  // frame-by-frame by the section's aria-live="polite". The sr-only sibling
  // below carries the one, final, stable value a screen reader picks up.
  const animatedPercent = useCountUp(percent)

  return (
    <div className="relative h-11 w-11 flex-shrink-0">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className={meta.trackClass}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`${meta.ringClass} transition-all duration-300`}
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        {phaseStatus === 'completed' ? (
          <SuccessCheck size={14} className="text-success" />
        ) : phaseStatus === 'in_progress' ? (
          <>
            <span className="sr-only">{percent}%</span>
            <span aria-hidden="true" className="font-mono text-[10px] font-semibold text-text">
              {animatedPercent}%
            </span>
          </>
        ) : phaseStatus === 'failed' ? (
          <span aria-hidden="true" className="text-xs font-bold leading-none text-danger">✕</span>
        ) : phaseStatus === 'skipped' ? (
          <span aria-hidden="true" className="text-xs leading-none text-muted/60">—</span>
        ) : phaseStatus === 'canceled' ? (
          <span aria-hidden="true" className="text-xs leading-none text-muted/60">⊘</span>
        ) : (
          <span className="text-xs leading-none text-text-secondary">…</span>
        )}
      </div>
    </div>
  )
}

function PhaseCard({ phase, index, indexLabel }) {
  const percent = getPhasePercent(phase)
  const total = Number(phase?.total) || 0
  const completed = total > 0
    ? Math.min(Number(phase?.completed) || 0, total)
    : Math.max(0, Number(phase?.completed) || 0)
  const meta = getStatusMeta(phase?.status)

  const counter = (phase?.status === 'completed' || phase?.status === 'in_progress') && total > 0
    ? `${completed} / ${total} complete`
    : null
  const detail = phase?.reason ?? counter
  const detailClass = phase?.status === 'failed' ? 'text-danger' : 'text-text-secondary'

  return (
    <article className={`h-full rounded-sm border px-2.5 py-2 transition-colors ${meta.cardClass}`}>
      <div className="flex items-center gap-3">
        <PhaseRing percent={percent} phaseStatus={phase?.status} />

        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted" style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
            {indexLabel} {index}
          </p>
          <h4 className="mt-0.5 line-clamp-2 text-xs font-semibold text-text sm:text-[13px]" title={phase?.label ?? 'Untitled Phase'}>{phase?.label ?? 'Untitled Phase'}</h4>
          {detail && (
            <span
              className={`mt-1 line-clamp-2 block text-[10px] ${detailClass}`}
              title={phase?.reason ? detail : undefined}
            >
              {detail}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

export default function PhaseProgressCards({
  title,
  summary,
  phases = [],
  indexLabel = 'Phase',
  ariaLabel = 'Progress',
  className = '',
}) {
  if (!phases.length) return null

  return (
    <section
      className={`data-panel ${className}`}
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <h3 className="font-headline text-lg font-bold text-text sm:text-xl">{title}</h3>
      {summary && (
        <p className="mt-1 text-xs leading-snug text-text-secondary sm:text-sm">{summary}</p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {phases.map((phase, index) => (
          <PhaseCard
            key={phase.key ?? `${indexLabel}-${index}`}
            phase={phase}
            index={index}
            indexLabel={indexLabel}
          />
        ))}
      </div>
    </section>
  )
}
