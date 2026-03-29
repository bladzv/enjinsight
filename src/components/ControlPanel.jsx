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
  const helper = isPoolMode
    ? 'Inspect recent pool payout eras and highlight where rewards were missed or expected to be absent.'
    : 'Inspect recent validator payout eras and highlight where rewards were missed across the selected window.'

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
  const helperTone = error ? 'text-danger' : showWarning ? 'text-warning' : 'text-text-secondary'

  return (
    <div id="scan-controls" className="rounded-[1.5rem] bg-card px-5 py-5 shadow-ambient sm:px-6 sm:py-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="section-label">Cadence Controls</p>
            <h3 className="font-headline text-3xl font-bold tracking-tight text-text">{title}</h3>
            <p className="max-w-2xl text-sm leading-6 text-text-secondary">{helper}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(176px,224px)_minmax(0,1fr)] md:items-end">
            <div className="rounded-[1.25rem] bg-surface px-4 py-4">
              <label htmlFor="reward-count" className="section-label block">
                Scan Range (Eras)
              </label>
              <div className="mt-3 flex items-end gap-3">
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
                  className={`w-28 border-none bg-transparent px-0 py-0 font-headline text-5xl font-bold tracking-tight text-primary focus:outline-none disabled:opacity-50 ${error ? 'text-danger' : ''}`}
                />
                <span className="pb-2 text-sm uppercase tracking-[0.18em] text-text-secondary">eras</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="metric-card">
                <p className="metric-label">Range Limits</p>
                <p className="metric-value text-2xl text-text">{MIN_ERA_COUNT}-{MAX_ERA_COUNT}</p>
              </div>
              <div className="metric-card">
                <p className="metric-label">Approx Length</p>
                <p className="metric-value text-2xl text-cyan">1 era ~= 24h</p>
              </div>
              <div className="metric-card">
                <p className="metric-value text-2xl text-text">{isPoolMode ? 'Pools' : 'Validators'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:min-w-[220px] xl:items-stretch">
          {isLoading ? (
            <button onClick={handleAction} className="btn-stop w-full" aria-label="Stop running scan">
              <Square size={15} className="fill-white stroke-white" />
              Stop Scan
            </button>
          ) : isResetState ? (
            <button onClick={handleAction} className="btn-secondary w-full" aria-label="Reset scan results">
              <RotateCcw size={15} />
              Reset View
            </button>
          ) : (
            <button onClick={handleAction} disabled={disableAction} className="btn-primary w-full" aria-label="Start scan">
              <Play size={15} />
              Run Scan
            </button>
          )}
          <p className={`min-h-[1.25rem] text-xs leading-5 ${helperTone}`} id="reward-count-error" role={error ? 'alert' : undefined}>
            {error ? (
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle size={12} />
                {error}
              </span>
            ) : showWarning ? (
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle size={12} />
                Larger windows take longer, but scanning is still batched automatically.
              </span>
            ) : (
              'Use recent eras for a faster health snapshot, or expand the range for broader cadence analysis.'
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
