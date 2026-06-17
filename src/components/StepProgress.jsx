import { useState } from 'react'
import { Check, Info, RotateCcw } from 'lucide-react'

/**
 * Horizontal step-progress bar.
 *
 * Props:
 *   steps       – [{key, label}]  numbered steps
 *   currentStep – 1-indexed active step number
 *   onReset     – optional callback; renders a Reset button when provided
 *   infoContent – optional ReactNode; when provided renders a cyan (i) circle
 *                 as the zeroth item. Clicking it toggles an info panel below.
 *   className   – extra classes on the root element
 */
export default function StepProgress({
  steps,
  currentStep,
  onReset,
  infoContent,
  infoOpen: infoOpenProp,
  onInfoOpenChange,
  className = '',
}) {
  const [infoOpenState, setInfoOpenState] = useState(false)
  const isControlled = infoOpenProp !== undefined
  const infoOpen = isControlled ? infoOpenProp : infoOpenState
  const total    = steps.length
  const hasInfo  = !!infoContent

  function handleToggle() {
    const next = !infoOpen
    if (!isControlled) setInfoOpenState(next)
    onInfoOpenChange?.(next)
  }

  // Fill fraction:
  //   • Without info circle: (currentStep-1) / (total-1)   — 0 at step 1, 1 at last step
  //   • With    info circle: currentStep / total             — fills to each step's column
  const progress = hasInfo
    ? total > 0 ? Math.max(0, Math.min(1, currentStep / total)) : 1
    : total > 1 ? Math.max(0, Math.min(1, (currentStep - 1) / (total - 1))) : 1

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-start gap-4 py-1">
        <div className="relative flex-1">
          {/* Track — inset 16 px each side to align with circle centres */}
          <div className="absolute top-4 left-4 right-4 h-px bg-white/[0.08]">
            {progress > 0 && (
              <div
                className="absolute inset-y-0 left-0 bg-primary/40 transition-all duration-500"
                style={{ width: `${progress * 100}%` }}
              />
            )}
          </div>

          {/* All circles in one justify-between row */}
          <div className="relative flex justify-between">

            {/* ── (i) info circle ── */}
            {hasInfo && (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggle}
                  aria-label={infoOpen ? 'Hide info' : 'Show info'}
                  aria-expanded={infoOpen}
                  className={[
                    'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300 overflow-hidden',
                    infoOpen
                      ? 'border-cyan bg-card text-cyan'
                      : 'border-cyan/40 bg-card text-cyan/60 hover:border-cyan hover:text-cyan',
                  ].join(' ')}
                >
                  {infoOpen && (
                    <span className="absolute inset-0 bg-cyan/15" aria-hidden="true" />
                  )}
                  <span className="relative"><Info size={13} /></span>
                </button>
                <span className="hidden sm:block text-[9px] font-bold uppercase tracking-[0.16em] whitespace-nowrap text-muted">
                  Info
                </span>
              </div>
            )}

            {/* ── Numbered steps ── */}
            {steps.map((step, index) => {
              const stepNum  = index + 1
              const isDone   = stepNum < currentStep
              const isActive = stepNum === currentStep

              return (
                <div key={step.key} className="flex flex-col items-center gap-1.5">
                  <div
                    className={[
                      'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300 overflow-hidden',
                      isDone   && 'border-primary bg-primary text-white',
                      isActive && 'border-primary bg-card text-primary shadow-[0_0_0_4px_rgba(124,58,237,0.15)]',
                      !isDone && !isActive && 'border-white/15 bg-card text-text-secondary',
                    ].filter(Boolean).join(' ')}
                  >
                    {isActive && (
                      <span className="absolute inset-0 bg-primary/20" aria-hidden="true" />
                    )}
                    <span className="relative">
                      {isDone ? <Check size={13} /> : stepNum}
                    </span>
                  </div>
                  <span
                    className={[
                      'hidden sm:block text-[9px] font-bold uppercase tracking-[0.16em] whitespace-nowrap',
                      isActive  && 'text-primary',
                      isDone    && 'text-text-secondary',
                      !isDone && !isActive && 'text-muted',
                    ].filter(Boolean).join(' ')}
                  >
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="mt-0.5 shrink-0 btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      {/* ── Collapsible info panel ── */}
      {hasInfo && infoOpen && (
        <div className="mx-auto max-w-2xl animate-fade-in overflow-hidden rounded-sm border border-cyan/20 bg-card">
          <div className="px-3 py-3 text-xs leading-relaxed text-text-secondary sm:px-4 sm:text-sm sm:leading-6">
            {infoContent}
          </div>
        </div>
      )}
    </div>
  )
}
