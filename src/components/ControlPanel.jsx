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
  const actionButtonClass = 'w-full min-h-[3.15rem] text-base font-semibold sm:min-h-[3.5rem]'
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
    <div id="scan-controls" className="h-full rounded-[1.35rem] bg-card px-5 py-5 shadow-ambient sm:px-6 sm:py-5">
      <div className="space-y-1">
        <h3 className="font-headline text-xl font-bold tracking-tight text-text sm:text-[1.65rem]">{title}</h3>
        <p className="max-w-xl section-subtitle">{helper}</p>
        <p className="mt-2 text-xs font-mono">
          <span className="text-muted">Range:</span>{' '}
          <span className="text-text">{MIN_ERA_COUNT}–{MAX_ERA_COUNT} eras</span>
        </p>
        <p className="mt-1 text-xs font-mono">
          <span className="text-muted">Approximate Length:</span>{' '}
          <span className="text-text">1 era ≈ 24h</span>
        </p>
      </div>

      <div className="mt-4 rounded-[1.35rem] bg-surface px-4 py-4 shadow-inset-soft sm:px-5 sm:py-5">
        <div className="rounded-[1.15rem] bg-card/90 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-center gap-4">
            <label htmlFor="reward-count" className="section-label whitespace-nowrap flex-shrink-0">
              Scan Range (Eras)
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
              className={`w-24 border-none bg-transparent px-0 py-0 font-headline text-4xl font-bold tracking-tight text-center text-primary focus:outline-none disabled:opacity-50 sm:text-[2.8rem] ${error ? 'text-danger' : ''}`}
            />
          </div>

          {(error || showWarning) && (
            <p
              id="reward-count-error"
              role={error ? 'alert' : undefined}
              className={`mt-4 flex items-start gap-2 text-sm leading-6 ${helperTone}`}
            >
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{helperMessage}</span>
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-center">
          {actionButton}
        </div>
      </div>
    </div>
  )
}
