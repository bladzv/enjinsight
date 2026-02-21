import { useState } from 'react'
import { Search, RotateCcw, AlertCircle, Settings } from 'lucide-react'
import { DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT } from '../constants.js'

export default function ControlPanel({
  status,
  proxyUrl,
  onRun,
  onReset,
  onOpenProxy,
}) {
  const [value, setValue]   = useState(String(DEFAULT_ERA_COUNT))
  const [error, setError]   = useState('')

  const isLoading = status === 'loading'
  const isDone    = status === 'done'

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

  function handleRun() {
    const err = validate(value)
    if (err) { setError(err); return }
    setError('')
    onRun(parseInt(value, 10))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleRun()
  }

  return (
    <div className="card p-4 sm:p-6">
      {/* Title row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-text">Check Validator Rewards</h2>
          <p className="text-xs text-dim mt-0.5">
            Enter the number of recent eras (1 era ≈ 24 hours) to scan.
          </p>
        </div>
        <button
          onClick={onOpenProxy}
          className="btn-icon !min-w-[40px] !min-h-[40px]"
          aria-label="Configure proxy URL"
          title="Proxy settings"
        >
          <Settings size={16} className={proxyUrl ? 'text-success' : 'text-warning'} />
        </button>
      </div>

      {/* Proxy status hint */}
      {!proxyUrl && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning">
          <AlertCircle size={13} />
          <span>No proxy configured — requests may be blocked by CORS.</span>
          <button onClick={onOpenProxy} className="ml-auto underline hover:no-underline">Configure</button>
        </div>
      )}

      {/* Input row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label htmlFor="era-count" className="block text-xs font-medium text-dim mb-1.5">
            Last N eras to check
          </label>
          <input
            id="era-count"
            type="text"
            inputMode="numeric"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={String(DEFAULT_ERA_COUNT)}
            aria-describedby={error ? 'era-count-error' : undefined}
            aria-invalid={!!error}
            maxLength={3}
            className={`w-full h-12 px-4 rounded-lg bg-surface border text-text text-lg font-mono leading-none
                        focus:outline-none focus:ring-2 focus:ring-primary transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${error ? 'border-danger focus:ring-danger' : 'border-border focus:border-primary'}`}
          />
          {error && (
            <p id="era-count-error" role="alert" className="mt-1.5 text-xs text-danger flex items-center gap-1">
              <AlertCircle size={11} /> {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 sm:items-end">
          {isDone || isLoading ? (
            <button
              onClick={onReset}
              className="btn-ghost flex-1 sm:flex-none h-12 gap-2"
              aria-label="Reset and start over"
            >
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          ) : null}

          <button
            onClick={handleRun}
            disabled={isLoading || !!error}
            className="btn-primary flex-1 sm:flex-none h-12 min-w-[120px]"
            aria-label={isLoading ? 'Scanning in progress' : 'Start validator reward check'}
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Scanning…
              </>
            ) : (
              <>
                <Search size={15} />
                CHECK
              </>
            )}
          </button>
        </div>
      </div>

      {/* Hint for large N */}
      {parseInt(value, 10) > 30 && !error && (
        <p className="mt-2 text-xs text-dim flex items-center gap-1">
          <AlertCircle size={11} className="text-warning" />
          Checking {value} eras may take longer. Large scans are batched automatically.
        </p>
      )}
    </div>
  )
}
