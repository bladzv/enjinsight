import { useState } from 'react'
import { AlertCircle, Square } from 'lucide-react'
import {
  DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT,
} from '../constants.js'
import Stepper from './Stepper.jsx'

export default function ControlPanel({
  status,
  onRun,
  onStop,
  onReset,
  compact = false,
}) {
  const [value, setValue] = useState(String(DEFAULT_ERA_COUNT))
  const [error, setError] = useState('')

  const isLoading = status === 'loading'
  const isResetState = status === 'done' || status === 'stopped' || status === 'error'
  const title = 'Scan Range'
  const helper = 'Set how many recent eras to check.'

  function validate(raw) {
    const trimmed = String(raw).trim()
    if (!/^\d+$/.test(trimmed)) return 'Please enter a whole number.'
    const n = parseInt(trimmed, 10)
    if (n < MIN_ERA_COUNT) return `Minimum is ${MIN_ERA_COUNT}.`
    if (n > MAX_ERA_COUNT) return `Maximum is ${MAX_ERA_COUNT}.`
    return ''
  }

  function handleValueChange(raw) {
    setValue(raw)
    setError(validate(raw))
  }

  function handleAction() {
    if (isLoading) {
      onStop?.()
      return
    }

    if (isResetState) {
      onReset?.()
      return
    }

    const nextError = validate(value)
    if (nextError) {
      setError(nextError)
      return
    }

    setError('')
    onRun(parseInt(value, 10))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleAction()
  }

  const disableAction = !isLoading && !isResetState && !!error
  const helperTone = 'text-danger'
  const actionButtonClass = 'w-full min-h-[2.8rem] text-sm font-semibold sm:min-h-[3.15rem] sm:text-base'
  const actionButton = isLoading ? (
    <button onClick={handleAction} className={`btn-stop ${actionButtonClass}`} aria-label="Stop running scan">
      <Square size={15} className="fill-white stroke-white" />
      Stop Scan
    </button>
  ) : isResetState ? (
    <button onClick={handleAction} className={`btn-secondary ${actionButtonClass}`} aria-label="Reset scan results">
      Reset View
    </button>
  ) : (
    <button onClick={handleAction} disabled={disableAction} className={`btn-primary staking-scan-button ${actionButtonClass}`} aria-label="Start scan">
      Run Scan
    </button>
  )

  return (
    <div id="scan-controls" className="data-panel h-full">
      <h3 className="font-headline text-lg font-bold tracking-tight text-text sm:text-xl">{title}</h3>
      <p className="mt-1 text-xs leading-snug text-text-secondary sm:text-sm">{helper}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono">
        <span><span className="text-muted">Range:</span> <span className="text-text">{MIN_ERA_COUNT}–{MAX_ERA_COUNT}</span></span>
        <span><span className="text-muted">~</span> <span className="text-text">1 era ≈ 24h</span></span>
      </div>

      <div className="mt-3 rounded-sm border border-[var(--hairline)] bg-card px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex items-center justify-center">
          <label htmlFor="reward-count" className="sr-only">
            Scan Range
          </label>
          <Stepper
            inputId="reward-count"
            value={value}
            onChange={handleValueChange}
            onKeyDown={handleKeyDown}
            placeholder={String(DEFAULT_ERA_COUNT)}
            min={MIN_ERA_COUNT}
            max={MAX_ERA_COUNT}
            disabled={isLoading}
            ariaDescribedBy="reward-count-error"
            ariaInvalid={!!error}
            compact={compact}
          />
        </div>

        {error && (
          <p
            id="reward-count-error"
            role="alert"
            className={`mt-3 flex items-start gap-1.5 text-xs leading-snug ${helperTone}`}
          >
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="mt-3">
        {actionButton}
      </div>
    </div>
  )
}
