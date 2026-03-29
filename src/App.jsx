import { useState, useEffect } from 'react'
import { DEFAULT_ERA_COUNT } from './constants.js'
import { useValidatorChecker } from './hooks/useValidatorChecker.js'
import { usePoolChecker }      from './hooks/usePoolChecker.js'
import { resolveLatestEra }    from './utils/eraAnalysis.js'

import AppHeader           from './components/AppHeader.jsx'
import LandingPage         from './components/LandingPage.jsx'
import BalanceExplorer     from './components/BalanceExplorer.jsx'
import RewardHistoryViewer from './components/RewardHistoryViewer.jsx'
import EraBlockExplorer    from './components/EraBlockExplorer.jsx'
import ModeSelector        from './components/ModeSelector.jsx'
import ControlPanel        from './components/ControlPanel.jsx'
import ValidatorCard       from './components/ValidatorCard.jsx'
import PoolCard            from './components/PoolCard.jsx'
import TerminalLog         from './components/TerminalLog.jsx'
import SummarySection      from './components/SummarySection.jsx'
import PoolSummarySection  from './components/PoolSummarySection.jsx'
import PhaseProgressCards  from './components/PhaseProgressCards.jsx'

export default function App() {
  // Persist active view in URL hash so page refresh stays on current tool
  const [view, setView] = useState(() => {
    const hash = window.location.hash.slice(1)
    return ['home', 'staking', 'balance', 'era', 'reward-history'].includes(hash) ? hash : 'home'
  })
  const [mode,       setMode]       = useState('validators') // 'validators' | 'pools'
  const [lastEraCount, setLastEraCount] = useState(DEFAULT_ERA_COUNT)

  // Sync URL hash when view changes
  useEffect(() => {
    window.history.replaceState(
      null, '',
      view === 'home' ? window.location.pathname : `#${view}`
    )
  }, [view])

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
  const completedPhaseCount = phases.filter(p => p.status === 'completed').length
  const topLabel = allCompleted
    ? 'Scan successful!'
    : (status === 'stopped'
      ? 'Scan stopped'
      : (activePhase ? `Step ${phases.findIndex(p => p.key === activePhase.key)}: ${activePhase.label}` : 'Scanning'))
  const progressMeta = activePhase && activePhase.total > 0
    ? `${activePhase.completed ?? 0} / ${activePhase.total} (${activePhasePct}%)`
    : `${completedPhaseCount} / ${phases.length} steps complete`
  const progressSummary = allCompleted
    ? 'All scan phases completed successfully.'
    : status === 'stopped'
      ? 'The scan was stopped before every phase completed.'
      : null

  const validatorLatestEra = resolveLatestEra(validators)
  const activeRecords = isValidatorMode ? validators : pools
  const gapCount = activeRecords.filter(item => item.missedEras?.length > 0).length
  const errorCount = activeRecords.filter(item => item.fetchStatus === 'error' || item.fetchStatus === 'failed').length
  const cleanCount = activeRecords.filter(item =>
    (isValidatorMode ? Array.isArray(item.eraStat) : Array.isArray(item.eraRewards)) &&
    (item.missedEras?.length ?? 0) === 0
  ).length

  // Dynamically load Vercel Analytics React component if the package is installed.
  const [AnalyticsComponent, setAnalyticsComponent] = useState(null)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const path = '@vercel/analytics/react'
        const mod = await import(/* @vite-ignore */ path)
        if (mounted && mod && mod.Analytics) setAnalyticsComponent(() => mod.Analytics)
      } catch (err) {
        // Package not installed or failed to load — skip analytics silently.
      }
    })()
    return () => { mounted = false }
  }, [])

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
    if (view === 'staking' && dest !== 'staking') handleReset()
    setView(dest)
  }

  function handleBack() {
    if (status === 'loading') return
    if (view === 'staking') handleReset()
    setView('home')
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-ink">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10rem] top-[8rem] h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute right-[-8rem] top-[20rem] h-[22rem] w-[22rem] rounded-full bg-cyan/10 blur-[120px]" />
      </div>

      <AppHeader status={status} view={view} onBack={handleBack} onNavigate={handleNavigate} />

      {/* ── Era Block Explorer ────────────────────────────────────── */}
      {view === 'era' && <EraBlockExplorer />}

      {/* ── Balance Viewer ──────────────────────────────────────────── */}
      {view === 'balance' && (
        <main className="relative z-10 mx-auto max-w-[92rem] px-4 py-6 sm:px-6 sm:py-8 pb-24 sm:pb-28">
          <BalanceExplorer />
        </main>
      )}

      {/* ── Reward History Viewer ─────────────────────────────────────────── */}
      {view === 'reward-history' && (
        <main className="relative z-10 mx-auto max-w-[92rem] px-4 py-6 sm:px-6 sm:py-8 pb-24 sm:pb-28">
          <RewardHistoryViewer />
        </main>
      )}

      {/* ── Home / Landing ──────────────────────────────────────────── */}
      {view === 'home' && (
        <main className="relative z-10 mx-auto max-w-[92rem] px-4 pb-16 sm:px-6 sm:pb-20">
          <LandingPage onNavigate={handleNavigate} />
        </main>
      )}

      {/* ── Staking view ────────────────────────────────────────────── */}
      {view === 'staking' && (
      <main className="relative z-10 mx-auto max-w-[92rem] px-4 py-6 sm:px-6 sm:py-8 pb-32 space-y-6">

        <section className="page-hero">
          <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:items-end">
            <div className="space-y-5">
              <div className="hero-kicker">
                <span className="hero-dot" />
                STAKING DIAGNOSTICS
              </div>
              <div className="space-y-4">
                <h1 className="hero-title text-balance">
                  Staking rewards cadence with live operator context.
                </h1>
                <p className="hero-copy">
                  Run the staking reward scan workflow to review missing rewards and risk severity.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="metric-card">
                <p className="metric-label">Scanned Records</p>
                <p className="metric-value text-cyan">{activeRecords.length}</p>
              </div>
              <div className="metric-card">
                <p className="metric-label">Gaps Detected</p>
                <p className={`metric-value ${gapCount > 0 ? 'text-danger' : 'text-success'}`}>{gapCount}</p>
              </div>
              <div className="metric-card">
                <p className="metric-label">Clean Results</p>
                <p className="metric-value text-success">{cleanCount}</p>
              </div>
              <div className="metric-card">
                <p className="metric-label">Fetch Errors</p>
                <p className={`metric-value ${errorCount > 0 ? 'text-warning' : 'text-text'}`}>{errorCount}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Mode selector tabs + scan controls */}
        <div className="space-y-4">
          <ModeSelector mode={mode} onModeChange={handleModeChange} disabled={isLoading} />
          <ControlPanel
            mode={mode}
            status={status}
            onRun={handleRun}
            onStop={handleStop}
            onReset={handleReset}
          />
        </div>

        {/* Scan progress */}
        {status !== 'idle' && phases.length > 0 && (
          <PhaseProgressCards
            className="mx-auto w-full max-w-6xl"
            ariaLabel="Scan progress"
            eyebrow="Scan Progress"
            indexLabel="Step"
            title={topLabel}
            summary={progressSummary}
            meta={progressMeta}
            phases={phases}
          />
        )}

        {/* ── Validator mode content ──────────────────────────────── */}
        {isValidatorMode && validators.length > 0 && (
          <section id="validators-panel" aria-labelledby="validators-heading">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <p className="section-label">Results</p>
                <h2 id="validators-heading" className="section-title">
                  Validators
                </h2>
              </div>
              <span className="text-xs text-muted font-mono">
                {validators.length} total
              </span>
              {isLoading && (
                <span className="text-xs text-text-secondary ml-auto">
                  {validators.filter(v => v.fetchStatus === 'done').length} / {validators.length} loaded
                </span>
              )}
            </div>

            <div className="space-y-3">
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
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <p className="section-label">Results</p>
                <h2 id="pools-heading" className="section-title">
                  Nomination Pools
                </h2>
              </div>
              <span className="text-xs text-muted font-mono">
                {pools.length} total
              </span>
              {isLoading && (
                <span className="text-xs text-text-secondary ml-auto">
                  {pools.filter(p => p.fetchStatus === 'done').length} / {pools.length} loaded
                </span>
              )}
            </div>

            <div className="space-y-3">
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
        {status === 'idle' && activeRecords.length > 0 && (
          <div className="rounded-[1.5rem] bg-surface px-6 py-16 text-center shadow-ambient sm:py-24">
            <div className="w-16 h-16 mx-auto mb-5 rounded-xl bg-card
                            flex items-center justify-center">
              <svg viewBox="0 0 32 32" className="w-8 h-8 fill-primary/60">
                <circle cx="16" cy="16" r="4"/>
                <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="16" y1="2"  x2="16" y2="7"  stroke="#00eefc" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="16" y1="25" x2="16" y2="30" stroke="#00eefc" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="2"  y1="16" x2="7"  y2="16" stroke="#00eefc" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="25" y1="16" x2="30" y2="16" stroke="#00eefc" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold font-headline text-text mb-2">Ready to Scan</h2>
            <p className="text-sm text-text-secondary max-w-lg mx-auto mb-5">
              Choose a mode, set how many recent eras to check, then run the scan to review missing rewards and risk severity.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-[1.5rem] bg-surface px-6 py-12 text-center shadow-ambient">
            <p className="text-sm text-danger mb-3">
              {isValidatorMode ? 'Failed to fetch validator list.' : 'Failed to fetch nomination pools.'}
            </p>
            <p className="text-xs text-text-secondary mb-4">
              Verify network connectivity and retry the same era window.
            </p>
            <button onClick={() => handleRun(lastEraCount)} className="btn-primary">
              Retry Scan
            </button>
          </div>
        )}
      </main>
      )}

      {/* Sticky terminal log — always shown on staking view */}
      {view === 'staking' && (
        <TerminalLog logs={logs} sticky />
      )}

      {/* Vercel Analytics (lazy-loaded if dependency installed) */}
      {AnalyticsComponent && <AnalyticsComponent />}
    </div>
  )
}
