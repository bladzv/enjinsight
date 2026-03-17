import { useState, useEffect } from 'react'
import { DEFAULT_ERA_COUNT } from './constants.js'
import { useValidatorChecker } from './hooks/useValidatorChecker.js'
import { usePoolChecker }      from './hooks/usePoolChecker.js'
import { resolveLatestEra }    from './utils/eraAnalysis.js'

import AppHeader           from './components/AppHeader.jsx'
import LandingPage         from './components/LandingPage.jsx'
import BalanceExplorer     from './components/BalanceExplorer.jsx'
import ModeSelector        from './components/ModeSelector.jsx'
import ControlPanel        from './components/ControlPanel.jsx'
import ValidatorCard       from './components/ValidatorCard.jsx'
import PoolCard            from './components/PoolCard.jsx'
import TerminalLog         from './components/TerminalLog.jsx'
import SummarySection      from './components/SummarySection.jsx'
import PoolSummarySection  from './components/PoolSummarySection.jsx'

export default function App() {
  const [view,       setView]       = useState('home')      // 'home' | 'staking' | 'balance'
  const [mode,       setMode]       = useState('validators') // 'validators' | 'pools'
  const [lastEraCount, setLastEraCount] = useState(DEFAULT_ERA_COUNT)

  // Validator hook
  const {
    status: vStatus, validators, logs: vLogs,
    proxyUrl: vProxyUrl, setProxy: vSetProxy,
    runCheck: vRunCheck, stop: vStop, reset: vReset, retryValidator: vRetryValidator,
    progress: vProgress,
  } = useValidatorChecker()

  // Pool hook
  const {
    status: pStatus, pools, logs: pLogs,
    proxyUrl: pProxyUrl, setProxy: pSetProxy,
    runCheck: pRunCheck, stop: pStop, reset: pReset, retryPoolValidator: pRetryPoolValidator,
    latestEra: poolLatestEra,
    progress: pProgress,
  } = usePoolChecker()

  // Derive active values based on current mode
  const isValidatorMode = mode === 'validators'
  const status    = isValidatorMode ? vStatus   : pStatus
  const logs      = isValidatorMode ? vLogs     : pLogs
  const proxyUrl  = isValidatorMode ? vProxyUrl : pProxyUrl
  const isLoading = status === 'loading'
  const isDone    = status === 'done'
  const activeProgress = isValidatorMode ? vProgress : pProgress
  const phases = activeProgress?.phases ?? []
  const activePhase = phases.find(p => p.status === 'in_progress') ?? phases.find(p => p.status === 'pending') ?? phases[phases.length - 1]
  const activePhasePct = activePhase && activePhase.total > 0
    ? Math.round((Math.min(activePhase.completed, activePhase.total) / activePhase.total) * 100)
    : 0

  const allCompleted = phases.length > 0 && phases.every(p => p.status === 'completed')
  const topLabel = allCompleted
    ? 'Scan successful!'
    : (status === 'stopped'
      ? 'Scan stopped'
      : (activePhase ? `Step ${phases.findIndex(p => p.key === activePhase.key)}: ${activePhase.label}` : 'Scanning'))

  const validatorLatestEra = resolveLatestEra(validators)

  // Dynamically load Vercel Analytics React component if the package is installed.
  // This lets the app run without the dependency during development; install
  // `@vercel/analytics` (or the React integration) to enable page view tracking.
  const [AnalyticsComponent, setAnalyticsComponent] = useState(null)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        // use a variable for the path so Rollup doesn’t try to resolve it at build
        const path = '@vercel/analytics/react'
        // Suppress Vite's dynamic-import analysis warning -- resolved at runtime if package installed
        const mod = await import(/* @vite-ignore */ path)
        if (mounted && mod && mod.Analytics) setAnalyticsComponent(() => mod.Analytics)
      } catch (err) {
        // Package not installed or failed to load — skip analytics silently.
      }
    })()
    return () => { mounted = false }
  }, [])

  // Proxy configuration removed from UI; hooks retain a no-op `setProxy` for compatibility.

  async function handleRun(eraCount) {
    setLastEraCount(eraCount)
    if (isValidatorMode) {
      await vRunCheck(eraCount)
    } else {
      await pRunCheck(eraCount)
    }
  }

  function handleReset() {
    if (isValidatorMode) vReset()
    else pReset()
  }

  function handleStop() {
    if (isValidatorMode) vStop()
    else pStop()
  }

  function handleModeChange(newMode) {
    if (status === 'loading') return // block switch during scan
    setMode(newMode)
  }

  function handleNavigate(dest) {
    if (status === 'loading') return // block navigation during active scan
    setView(dest)
  }

  function handleBack() {
    if (status === 'loading') return
    setView('home')
  }

  return (
    <div className="min-h-dvh bg-ink bg-grid">
      <AppHeader status={status} view={view} onBack={handleBack} />

      {/* ── Balance Viewer ──────────────────────────────────────────── */}
      {view === 'balance' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-16 sm:pb-20">
          <BalanceExplorer />
        </main>
      )}

      {/* ── Home / Landing ──────────────────────────────────────────── */}
      {view === 'home' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 sm:pb-20">
          <LandingPage onNavigate={handleNavigate} />
        </main>
      )}

      {/* ── Staking view ────────────────────────────────────────────── */}
      {view === 'staking' && (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-16 sm:pb-20 space-y-4 sm:space-y-5">

        {/* Mode selector tabs + scan controls (no gap between them) */}
        <div className="space-y-0">
          <ModeSelector mode={mode} onModeChange={handleModeChange} disabled={isLoading} />
          <ControlPanel
            mode={mode}
            status={status}
            onRun={handleRun}
            onStop={handleStop}
            onReset={handleReset}
          />
        </div>

        {/* Proxy setup removed from UI (use serverless proxy in production). */}

        {/* Scan progress */}
        {status !== 'idle' && phases.length > 0 && (
          <section className="card w-full max-w-xl mx-auto p-3 sm:p-4" aria-live="polite" aria-label="Scan progress">
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="text-dim">{topLabel}</p>
              <p className="font-mono text-text-secondary">
                {activePhase?.completed ?? 0} / {activePhase?.total ?? 0} ({activePhasePct}%)
              </p>
            </div>
            <div className="mt-2 h-2 rounded-full bg-border overflow-hidden">
              <div
                className="h-full bg-cyan transition-all duration-300"
                style={{ width: `${activePhasePct}%` }}
              />
            </div>
            <div className="mt-3 w-full space-y-1.5">
              {phases.map((phase, index) => {
                const statusClass = phase.status === 'completed'
                  ? 'text-success'
                  : phase.status === 'in_progress'
                    ? 'text-cyan'
                    : 'text-dim'
                const statusLabel = phase.status === 'completed'
                  ? 'Done'
                  : phase.status === 'in_progress'
                    ? 'Running'
                    : 'Pending'
                return (
                  <div key={phase.key} className="w-full rounded-md border border-border bg-surface/40 px-2.5 py-2">
                    <div className="flex items-center justify-between text-[11px] gap-3">
                        <p className={`font-medium ${statusClass}`}>
                        Step {index}: {phase.label}
                      </p>
                      <p className={`font-semibold ${statusClass}`}>{statusLabel}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Terminal log */}
        {(logs.length > 0 || isLoading) && (
          <TerminalLog logs={logs} />
        )}

        {/* ── Validator mode content ──────────────────────────────── */}
        {isValidatorMode && validators.length > 0 && (
          <section id="validators-panel" aria-labelledby="validators-heading">
            <div className="flex items-center gap-2 mb-3">
              <h2 id="validators-heading" className="text-base font-semibold text-text">
                Validators
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs bg-border text-dim font-semibold">
                {validators.length}
              </span>
              <span className="h-px flex-1 bg-border" />
              {isLoading && (
                <span className="text-xs text-dim">
                  {validators.filter(v => v.fetchStatus === 'done').length} / {validators.length} loaded
                </span>
              )}
            </div>

            <div className="space-y-2">
              {validators.map(v => (
                <ValidatorCard
                  key={v.address}
                  validator={v}
                  eraCount={lastEraCount}
                  latestEra={validatorLatestEra}
                  onRetry={vRetryValidator}
                />
              ))}
            </div>
          </section>
        )}

        {isValidatorMode && isDone && validators.length > 0 && (
          <SummarySection
            validators={validators}
            eraCount={lastEraCount}
          />
        )}

        {/* ── Pool mode content ───────────────────────────────────── */}
        {!isValidatorMode && pools.length > 0 && (
          <section id="pools-panel" aria-labelledby="pools-heading">
            <div className="flex items-center gap-2 mb-3">
              <h2 id="pools-heading" className="text-base font-semibold text-text">
                Nomination Pools
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs bg-border text-dim font-semibold">
                {pools.length}
              </span>
              <span className="h-px flex-1 bg-border" />
              {isLoading && (
                <span className="text-xs text-dim">
                  {pools.filter(p => p.fetchStatus === 'done').length} / {pools.length} loaded
                </span>
              )}
            </div>

            <div className="space-y-2">
              {pools.map(p => (
                <PoolCard
                  key={p.poolId}
                  pool={p}
                  eraCount={lastEraCount}
                  latestEra={poolLatestEra}
                  onRetry={pRetryPoolValidator}
                />
              ))}
            </div>
          </section>
        )}

        {!isValidatorMode && isDone && pools.length > 0 && (
          <PoolSummarySection
            pools={pools}
            eraCount={lastEraCount}
          />
        )}

        {/* ── Empty / error states ────────────────────────────────── */}
        {status === 'idle' && (
          <div className="text-center py-16 sm:py-24">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-primary/10 border border-primary/30
                            flex items-center justify-center">
              <svg viewBox="0 0 32 32" className="w-8 h-8 fill-primary/60">
                <circle cx="16" cy="16" r="4"/>
                <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="16" y1="2"  x2="16" y2="7"  stroke="#00D4FF" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="16" y1="25" x2="16" y2="30" stroke="#00D4FF" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="2"  y1="16" x2="7"  y2="16" stroke="#00D4FF" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="25" y1="16" x2="30" y2="16" stroke="#00D4FF" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text mb-2">Ready to Scan</h2>
            <p className="text-sm text-dim max-w-lg mx-auto mb-5">
              Choose a mode, set how many recent eras to check, then run the scan to review missing rewards and risk severity.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-12">
            <p className="text-sm text-danger mb-3">
              {isValidatorMode ? 'Failed to fetch validator list.' : 'Failed to fetch nomination pools.'}
            </p>
            <p className="text-xs text-dim mb-4">
              Verify network connectivity and retry the same era window.
            </p>
            <button onClick={() => handleRun(lastEraCount)} className="btn-primary">
              Retry Scan
            </button>
          </div>
        )}
      </main>
      )}

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-ink/95 backdrop-blur py-2.5 text-center text-xs text-muted">
        EnjinSight | Read-only | No wallet required
      </footer>
      {/* Vercel Analytics (lazy-loaded if dependency installed) */}
      {AnalyticsComponent && <AnalyticsComponent />}
    </div>
  )
}
