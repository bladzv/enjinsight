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
  const helperTextClass = error ? 'text-danger' : showWarning ? 'text-warning' : 'text-dim'

  return (
    <div id="scan-controls" className="card w-full p-4 sm:p-5 text-center">
      {/* Title row */}
      <div className="mb-4">
        <div>
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <p className="text-xs text-dim mt-0.5">
            {helper}
          </p>
        </div>
      </div>

      {/* Proxy status hint removed — use the built-in serverless proxy in production. */}

      {/* Input row */}
      <div>
        <label htmlFor="reward-count" className="block text-xs font-medium text-dim mb-1.5">
          Number of recent eras to check (max 100)
        </label>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3">
        <div className="relative w-full sm:w-[25%]">
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
            className={`w-full h-12 pl-0 pr-[108px] rounded-lg bg-surface border text-text text-lg font-mono leading-none text-center
                        focus:outline-none focus:ring-2 focus:ring-primary transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${error ? 'border-danger focus:ring-danger' : 'border-border focus:border-primary'}`}
          />

          <button
            onClick={handleAction}
            disabled={disableAction}
            aria-label={btnAria}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 h-9 min-w-[104px] px-3 text-sm ${isLoading ? 'btn-stop' : 'btn-primary'}`}
          >
            {isLoading ? (
              <>
                <Square size={14} className="fill-white stroke-white" />
                <span>STOP</span>
              </>
            ) : isResetState ? (
              <>
                <RotateCcw size={14} />
                <span>RESET</span>
              </>
            ) : (
              <>
                <Search size={14} />
                <span>CHECK</span>
              </>
            )}
          </button>
        </div>
        </div>

        <p
          id="reward-count-helper"
          role={error ? 'alert' : undefined}
          aria-hidden={!error && !showWarning}
          className={`mt-2 text-xs flex items-center gap-1 justify-center min-h-[1.25rem] ${helperTextClass}`}
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
    </div>
  )
}
