import { RotateCcw } from 'lucide-react'
import SuccessCheck from './SuccessCheck.jsx'
import HoldButton from './HoldButton.jsx'

/**
 * Per-circle state for one step.
 *
 * `complete` is what distinguishes "finished the run" from "sitting on the
 * last step": currentStep is clamped to steps.length by every caller, so
 * `stepNum < currentStep` alone can never mark the final step done and a
 * settled scan rendered its Results circle as a still-active number.
 *
 * Only a *successful* terminal state may set `complete` — a canceled or
 * errored run must keep the final circle un-checked, the same honesty rule
 * the phase cards follow (see utils/infusionPhases.js).
 */
export function getStepState({ index, currentStep, total, complete = false }) {
  const stepNum = index + 1
  const isLast = stepNum === total
  return {
    stepNum,
    isDone: stepNum < currentStep || (complete && isLast),
    isActive: stepNum === currentStep && !(complete && isLast),
  }
}

/**
 * Horizontal step-progress bar.
 *
 * Props:
 *   steps       – [{key, label}]  numbered steps
 *   currentStep – 1-indexed active step number
 *   complete    – true once the run has *successfully* finished; checks the
 *                 final step instead of leaving it rendered as active
 *   onReset     – optional callback; renders a Reset button when provided
 *   className   – extra classes on the root element
 */
export default function StepProgress({
  steps,
  currentStep,
  complete = false,
  onReset,
  className = '',
}) {
  const total = steps.length

  // Fill fraction: 0 at step 1, 1 at last step
  const progress = complete
    ? 1
    : total > 1 ? Math.max(0, Math.min(1, (currentStep - 1) / (total - 1))) : 1

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-start gap-4 py-1">
        <div className="relative flex-1">
          {/* Track — inset 16 px each side to align with circle centres */}
          <div className="absolute top-4 left-4 right-4 h-px bg-white/[0.08]">
            <div
              className="progress-fill absolute inset-y-0 left-0 w-full origin-left bg-primary/40"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>

          {/* All circles in one justify-between row */}
          <div className="relative flex justify-between">

            {/* ── Numbered steps ── */}
            {steps.map((step, index) => {
              const { stepNum, isDone, isActive } = getStepState({ index, currentStep, total, complete })

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
                      {isDone ? <SuccessCheck size={13} /> : stepNum}
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
          // Guarded: every wizard passes a callback here that discards the
          // scan's results, and it sits inline with the step markers where a
          // stray click is easy.
          <HoldButton
            onActivate={onReset}
            className="mt-0.5 shrink-0 btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RotateCcw size={12} />
            Reset
          </HoldButton>
        )}
      </div>
    </div>
  )
}
