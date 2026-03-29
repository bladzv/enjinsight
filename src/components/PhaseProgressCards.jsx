import { Check } from 'lucide-react'

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getPhasePercent(phase) {
  if (phase?.status === 'completed') return 100
  const total = Number(phase?.total) || 0
  const completed = Math.max(0, Number(phase?.completed) || 0)
  if (total <= 0) return 0
  return clampPercent((Math.min(completed, total) / total) * 100)
}

function getStatusMeta(status) {
  if (status === 'completed') {
    return {
      label: 'Complete',
      cardClass: 'border-success/20 bg-success/5',
      statusClass: 'text-success',
      ringClass: 'text-success',
      trackClass: 'text-success/10',
    }
  }
  if (status === 'in_progress') {
    return {
      label: 'Running',
      cardClass: 'border-cyan/20 bg-card',
      statusClass: 'text-cyan',
      ringClass: 'text-cyan',
      trackClass: 'text-cyan/10',
    }
  }
  return {
    label: 'Queued',
    cardClass: 'border-white/5 bg-card/80',
    statusClass: 'text-text-secondary',
    ringClass: 'text-muted/45',
    trackClass: 'text-muted/20',
  }
}

function PhaseRing({ percent, phaseStatus }) {
  const size = 72
  const strokeWidth = 6
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - ((phaseStatus === 'completed' ? 100 : percent) / 100) * circumference
  const meta = getStatusMeta(phaseStatus)

  return (
    <div className="relative h-[4.5rem] w-[4.5rem] flex-shrink-0">
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
          <Check size={20} className="text-success" />
        ) : phaseStatus === 'in_progress' ? (
          <span className="font-mono text-sm font-semibold text-text">{percent}%</span>
        ) : (
          <span className="text-lg leading-none text-text-secondary">...</span>
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

  const detail = phase?.status === 'completed'
    ? (total > 0 ? `${completed} / ${total} complete` : 'Complete')
    : phase?.status === 'in_progress'
      ? (total > 0 ? `${completed} / ${total} complete` : 'Running')
      : 'Waiting to start'

  return (
    <article className={`rounded-[1.25rem] border px-4 py-4 shadow-inset-soft transition-colors ${meta.cardClass}`}>
      <div className="flex items-start gap-4">
        <PhaseRing percent={percent} phaseStatus={phase?.status} />

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            {indexLabel} {index}
          </p>
          <h4 className="mt-2 text-sm font-semibold text-text">{phase?.label ?? 'Untitled Phase'}</h4>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${meta.statusClass}`}>{meta.label}</span>
            <span className="text-xs text-text-secondary">{detail}</span>
          </div>
          {phase?.status === 'in_progress' && (
            <p className="mt-2 font-mono text-[11px] text-text-secondary">{percent}% complete</p>
          )}
        </div>
      </div>
    </article>
  )
}

export default function PhaseProgressCards({
  title,
  summary,
  meta,
  phases = [],
  eyebrow = 'Progress',
  indexLabel = 'Phase',
  ariaLabel = 'Progress',
  className = '',
}) {
  if (!phases.length) return null
  const fallbackMeta = `${phases.filter(phase => phase?.status === 'completed').length} / ${phases.length} complete`

  return (
    <section
      className={`rounded-[1.5rem] bg-surface p-5 shadow-ambient ${className}`}
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="section-label">{eyebrow}</p>
          <h3 className="font-headline text-2xl font-bold text-text">{title}</h3>
          {summary && (
            <p className="max-w-3xl text-sm leading-6 text-text-secondary">{summary}</p>
          )}
        </div>

        <span className="mini-chip self-start">{meta || fallbackMeta}</span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
