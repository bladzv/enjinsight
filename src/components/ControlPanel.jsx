import { useState } from 'react'
import { AlertCircle, Square } from 'lucide-react'
import {
  DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT,
} from '../constants.js'

export default function ControlPanel({
  mode,
  status,
  onRun,
  onStop,
  onReset,
}) {
  const [value, setValue] = useState(String(DEFAULT_ERA_COUNT))
  const [error, setError] = useState('')

  const isLoading = status === 'loading'
  const isResetState = status === 'done' || status === 'stopped' || status === 'error'
  const isPoolMode = mode === 'pools'
  const title = 'Cadence Controls'
  const helper = 'Set how many recent eras to check.'

  function validate(raw) {
    const trimmed = String(raw).trim()
    if (!/^\d+$/.test(trimmed)) return 'Please enter a whole number.'
    const n = parseInt(trimmed, 10)
    if (n < MIN_ERA_COUNT) return `Minimum is ${MIN_ERA_COUNT}.`
    if (n > MAX_ERA_COUNT) return `Maximum is ${MAX_ERA_COUNT}.`
    return ''
  }

  function handleChange(e) {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
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
  const showWarning = !error && parseInt(value, 10) > 30
  const helperTone = error ? 'text-danger' : 'text-warning'
  const helperMessage = error
    ? error
    : 'Longer range selected. Expect a slower scan.'
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
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="reward-count" className="section-label">
            Scan Range
          </label>
          <input
            id="reward-count"
            type="text"
            inputMode="numeric"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={String(DEFAULT_ERA_COUNT)}
            aria-describedby="reward-count-error"
            aria-invalid={!!error}
            maxLength={3}
            className={`w-20 border-none bg-transparent px-0 py-0 font-mono text-3xl font-bold tracking-tight text-right text-primary focus:outline-none disabled:opacity-50 sm:text-4xl ${error ? 'text-danger' : ''}`}
          />
        </div>

        {(error || showWarning) && (
          <p
            id="reward-count-error"
            role={error ? 'alert' : undefined}
            className={`mt-3 flex items-start gap-1.5 text-xs leading-snug ${helperTone}`}
          >
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{helperMessage}</span>
          </p>
        )}
      </div>

      <div className="mt-3">
        {actionButton}
      </div>
    </div>
  )
}
