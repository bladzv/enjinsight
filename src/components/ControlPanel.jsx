import { useState } from 'react'
import { Search, RotateCcw, Square, AlertCircle } from 'lucide-react'
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
  const [value, setValue]   = useState(String(DEFAULT_ERA_COUNT))
  const [error, setError]   = useState('')

  const isLoading = status === 'loading'
  const isResetState = status === 'done' || status === 'stopped' || status === 'error'
  const isPoolMode = mode === 'pools'
  const title = isPoolMode ? 'Check Pool Rewards' : 'Check Validator Rewards'
  const helper = isPoolMode
    ? 'Enter the number of recent eras (1 era approx 24 hours) to scan for pool payouts.'
    : 'Enter the number of recent eras (1 era approx 24 hours) to scan for validator rewards.'

  function validate(raw) {
    const trimmed = String(raw).trim()
    if (!/^\d+$/.test(trimmed)) return 'Please enter a whole number.'
    const n = parseInt(trimmed, 10)
    if (n < MIN_ERA_COUNT) return `Minimum is ${MIN_ERA_COUNT}.`
    if (n > MAX_ERA_COUNT) return `Maximum is ${MAX_ERA_COUNT}.`
    return ''
  }

  function handleChange(e) {
    // Only allow digits — prevent injection of special characters
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

    const err = validate(value)
    if (err) { setError(err); return }
    setError('')
    onRun(parseInt(value, 10))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleAction()
  }

  const btnLabel = isLoading ? 'STOP' : isResetState ? 'RESET' : 'CHECK'
  const btnAria = isLoading
    ? 'Stop running scan'
    : isResetState
      ? 'Reset scan results'
      : 'Start scan'
  const disableAction = !isLoading && !isResetState && !!error

  const showWarning = !error && parseInt(value, 10) > 30
  const helperTextClass = error ? 'text-danger' : showWarning ? 'text-warning' : 'text-text-secondary'

  return (
    <div id="scan-controls" className="bg-surface rounded-b-xl w-full p-5 sm:p-6">
      {/* Title row */}
      <div className="mb-5 text-center">
        <h2 className="text-base font-semibold font-headline text-text">{title}</h2>
        <p className="text-xs text-text-secondary mt-1">{helper}</p>
      </div>

      {/* Input row */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="reward-count" className="text-[10px] uppercase font-bold text-muted tracking-widest">
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
            aria-describedby={error ? 'reward-count-error' : undefined}
            aria-invalid={!!error}
            maxLength={3}
            className={`w-24 h-10 bg-card text-primary font-mono rounded px-3 text-center text-lg
                        focus:outline-none focus:ring-1 focus:ring-primary transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${error ? 'ring-1 ring-danger' : ''}`}
          />
        </div>

        <div className="flex gap-2 mt-4 sm:mt-5">
          {isLoading ? (
            <button onClick={handleAction} className="btn-stop px-5 py-2 text-sm" aria-label={btnAria}>
              <Square size={14} className="fill-white stroke-white" />
              <span>STOP</span>
            </button>
          ) : isResetState ? (
            <button onClick={handleAction} className="btn-secondary px-5 py-2 text-sm" aria-label={btnAria}>
              <RotateCcw size={14} />
              <span>RESET</span>
            </button>
          ) : (
            <button
              onClick={handleAction}
              disabled={disableAction}
              className="btn-primary px-5 py-2 text-sm"
              aria-label={btnAria}
            >
              <Search size={14} />
              <span>RUN</span>
            </button>
          )}
        </div>
      </div>

      <p
        id="reward-count-helper"
        role={error ? 'alert' : undefined}
        aria-hidden={!error && !showWarning}
        className={`mt-3 text-xs flex items-center gap-1 justify-center min-h-[1.25rem] ${helperTextClass}`}
      >
        {error ? (
          <>
            <AlertCircle size={11} /> {error}
          </>
        ) : showWarning ? (
          <>
            <AlertCircle size={11} className="text-warning" />
            Checking {value} rewards may take longer. Large scans are batched automatically.
          </>
        ) : (
          <span className="invisible">placeholder</span>
        )}
      </p>
    </div>
  )
}
