import { useState } from 'react'
import { Search, RotateCcw, Square, AlertCircle } from 'lucide-react'
import {
  DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT,
  API_DELAY_MS,
  VALIDATOR_ENDPOINTS_TO_PROBE, POOL_ENDPOINTS_TO_PROBE,
  ERA_VALIDATORS_SAMPLE,
  TYPICAL_VALIDATOR_COUNT, TYPICAL_POOL_COUNT,
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

  // Pre-scan time estimate — hidden during loading, after a run, or when input is invalid.
  // Formula accounts for rate-limiting delay (API_DELAY_MS) per sequential API call.
  // Validator time: (probes + list + N×nominators + N×era-stats) × 1s — era count does not
  //   affect validator scan time (era_stat is one call per validator regardless of era count).
  // Pool time: (probes + list + P×voted + P×eraCount×reward-slash + consensus-samples) × 1s
  //   — era count scales pool scan time linearly.
  const { estCalls, estTimeLabel } = (() => {
    if (!value || validate(value) || isLoading || isResetState) return { estCalls: null, estTimeLabel: null }
    const eraCount = parseInt(value, 10)
    const delayS   = API_DELAY_MS / 1000
    let calls
    if (isPoolMode) {
      const P = TYPICAL_POOL_COUNT
      calls = POOL_ENDPOINTS_TO_PROBE.length + 1 + P + ERA_VALIDATORS_SAMPLE + P * eraCount
    } else {
      const N = TYPICAL_VALIDATOR_COUNT
      calls = VALIDATOR_ENDPOINTS_TO_PROBE.length + 1 + 2 * N
    }
    const secs = Math.round(calls * delayS)
    let label
    if (secs < 60)   label = `~${secs}s`
    else if (secs < 3600) label = `~${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
    else              label = `~${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`
    return { estCalls: calls, estTimeLabel: label }
  })()

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
          Number of recent eras to check
        </label>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3">
        <div className="relative w-full sm:w-[37.5%]">
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
        {/* Time estimate — shown only before a scan starts, when input is valid */}
        {estCalls != null && (
          <span className="text-xs font-mono text-dim flex items-center gap-2 justify-center">
            <span>~{estCalls.toLocaleString('en')} API calls</span>
            <span className="text-muted">·</span>
            <span className="text-cyan/80">{estTimeLabel}</span>
          </span>
        )}
        </div>

        {error && (
          <p id="reward-count-error" role="alert" className="mt-1.5 text-xs text-danger flex items-center gap-1 justify-center">
            <AlertCircle size={11} /> {error}
          </p>
        )}
      </div>

      {/* Hint for large N */}
      {parseInt(value, 10) > 30 && !error && (
        <p className="mt-2 text-xs text-dim flex items-center gap-1 justify-center">
          <AlertCircle size={11} className="text-warning" />
          Checking {value} rewards may take longer. Large scans are batched automatically.
        </p>
      )}
    </div>
  )
}
