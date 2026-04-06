import { useState } from 'react'
import { AlertCircle, Play, RotateCcw, Square } from 'lucide-react'
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
  const title = isPoolMode ? 'Nomination pool cadence scan' : 'Validator cadence scan'
  const helper = 'Set how many recent eras to check.'
  const modeLabel = isPoolMode ? 'Pool diagnostics' : 'Validator diagnostics'

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
  const actionButtonClass = 'w-full min-h-[3.5rem] text-sm sm:min-h-[3.75rem]'
  const actionButton = isLoading ? (
    <button onClick={handleAction} className={`btn-stop ${actionButtonClass}`} aria-label="Stop running scan">
      <Square size={15} className="fill-white stroke-white" />
      Stop Scan
    </button>
  ) : isResetState ? (
    <button onClick={handleAction} className={`btn-secondary ${actionButtonClass}`} aria-label="Reset scan results">
      <RotateCcw size={15} />
      Reset View
    </button>
  ) : (
    <button onClick={handleAction} disabled={disableAction} className={`btn-primary staking-scan-button ${actionButtonClass}`} aria-label="Start scan">
      <Play size={15} />
      Run Scan
    </button>
  )

  return (
    <div id="scan-controls" className="rounded-[1.5rem] bg-card px-5 py-5 shadow-ambient sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="section-label">Cadence Controls</p>
          <h3 className="font-headline text-3xl font-bold tracking-tight text-text">{title}</h3>
          <p className="max-w-xl section-subtitle">{helper}</p>
        </div>
        <span className="mini-chip">{modeLabel}</span>
      </div>

      <div className="mt-5 rounded-[1.5rem] bg-surface px-5 py-5 shadow-inset-soft sm:px-6 sm:py-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(220px,240px)] xl:items-start">
          <div className="rounded-[1.35rem] bg-card/90 px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="section-label">Scan Range (Eras)</p>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label htmlFor="reward-count" className="sr-only">
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
                className={`w-28 border-none bg-transparent px-0 py-0 font-headline text-5xl font-bold tracking-tight text-primary focus:outline-none disabled:opacity-50 ${error ? 'text-danger' : ''}`}
              />
              <span className="pb-2 text-sm uppercase tracking-[0.18em] text-text-secondary">eras</span>
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

          <div className="rounded-[1.35rem] border border-primary/10 bg-[#05070f] p-4 shadow-inset-soft sm:p-5 xl:self-center">
            <div className="w-full">
              {actionButton}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="metric-card metric-card-left-primary">
            <p className="metric-label">Range Limits</p>
            <p className="metric-value text-2xl text-text">{MIN_ERA_COUNT}-{MAX_ERA_COUNT}</p>
          </div>
          <div className="metric-card metric-card-left-cyan">
            <p className="metric-label">Approx Length</p>
            <p className="metric-value text-2xl text-cyan">1 era ~= 24h</p>
          </div>
        </div>
      </div>
    </div>
  )
}
