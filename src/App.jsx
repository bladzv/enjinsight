import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { DEFAULT_ERA_COUNT } from './constants.js'
import { useValidatorChecker } from './hooks/useValidatorChecker.js'
import { usePoolChecker }      from './hooks/usePoolChecker.js'
import { resolveLatestEra }    from './utils/eraAnalysis.js'

import AppHeader           from './components/AppHeader.jsx'
import DisclaimerModal, { useFirstVisitDisclaimer } from './components/DisclaimerModal.jsx'
import LandingPage         from './components/LandingPage.jsx'
import BalanceExplorer     from './components/BalanceExplorer.jsx'
import RewardHistoryViewer from './components/RewardHistoryViewer.jsx'
import EraBlockExplorer    from './components/EraBlockExplorer.jsx'
import InfusionChecker     from './components/InfusionChecker.jsx'
import ModeSelector        from './components/ModeSelector.jsx'
import ControlPanel        from './components/ControlPanel.jsx'
import ValidatorCard       from './components/ValidatorCard.jsx'
import PoolCard            from './components/PoolCard.jsx'
import TerminalLog         from './components/TerminalLog.jsx'
import SummarySection      from './components/SummarySection.jsx'
import PoolSummarySection  from './components/PoolSummarySection.jsx'
import PhaseProgressCards  from './components/PhaseProgressCards.jsx'
import PointerAura         from './components/PointerAura.jsx'

const VALIDATOR_PREVIEW_PHASES = [
  { key: 'probe', label: 'Check API Endpoints', total: 1, completed: 0, status: 'pending' },
  { key: 'list', label: 'Fetch Validators', total: 1, completed: 0, status: 'pending' },
  { key: 'nominators', label: 'Fetch Nominators', total: 1, completed: 0, status: 'pending' },
  { key: 'eras', label: 'Fetch Era Stats', total: 1, completed: 0, status: 'pending' },
]

const POOL_PREVIEW_PHASES = [
  { key: 'probe', label: 'Check API Endpoints', total: 1, completed: 0, status: 'pending' },
  { key: 'list', label: 'Fetch Pools', total: 1, completed: 0, status: 'pending' },
  { key: 'validators', label: 'Fetch Nominated Validators', total: 1, completed: 0, status: 'pending' },
  { key: 'ranges', label: 'Resolve Era Ranges', total: 1, completed: 0, status: 'pending' },
  { key: 'rewards', label: 'Confirm Rewards', total: 1, completed: 0, status: 'pending' },
]
const STAKING_RESULTS_PAGE_SIZE = 10

export default function App() {
  // Persist active view in URL hash so page refresh stays on current tool
  const [view, setView] = useState(() => {
    const hash = window.location.hash.slice(1)
    return ['home', 'staking', 'balance', 'era', 'reward-history', 'infusion'].includes(hash) ? hash : 'home'
  })
  const [mode,       setMode]       = useState('validators') // 'validators' | 'pools'
  const [lastEraCount, setLastEraCount] = useState(DEFAULT_ERA_COUNT)
  const [showAbout, setShowAbout] = useState(false)
  const [showValidatorResults, setShowValidatorResults] = useState(true)
  const [showPoolResults, setShowPoolResults] = useState(true)
  const [validatorPage, setValidatorPage] = useState(1)
  const [poolPage, setPoolPage] = useState(1)
  const [selectedPoolId, setSelectedPoolId] = useState(null)
  const { show: showFirstVisit, accept: acceptFirstVisit } = useFirstVisitDisclaimer()

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
  const previewPhases = isValidatorMode ? VALIDATOR_PREVIEW_PHASES : POOL_PREVIEW_PHASES
  const phases = activeProgress?.phases ?? []
  const displayPhases = phases.length > 0 ? phases : previewPhases
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
      : (activePhase ? `Step ${phases.findIndex(p => p.key === activePhase.key) + 1}: ${activePhase.label}` : 'Scanning'))
  const progressMeta = activePhase && activePhase.total > 0
    ? `${activePhase.completed ?? 0} / ${activePhase.total} (${activePhasePct}%)`
    : `${completedPhaseCount} / ${phases.length} steps complete`
  const progressSummary = allCompleted
    ? 'All scan phases completed successfully.'
    : status === 'stopped'
      ? 'The scan was stopped before every phase completed.'
      : null
  const displayProgressTitle = 'Scan Progress'
  const displayProgressMeta = phases.length > 0 ? progressMeta : null
  const displayProgressSummary = phases.length > 0
    ? progressSummary
    : null

  const validatorLatestEra = resolveLatestEra(validators)
  const activeRecords = isValidatorMode ? validators : pools
  const validatorPages = Math.max(1, Math.ceil(validators.length / STAKING_RESULTS_PAGE_SIZE))
  const safeValidatorPage = Math.min(validatorPage, validatorPages)
  const visibleValidators = validators.slice(
    (safeValidatorPage - 1) * STAKING_RESULTS_PAGE_SIZE,
    safeValidatorPage * STAKING_RESULTS_PAGE_SIZE,
  )
  const poolPages = Math.max(1, Math.ceil(pools.length / STAKING_RESULTS_PAGE_SIZE))
  const safePoolPage = Math.min(poolPage, poolPages)
  const visiblePools = pools.slice(
    (safePoolPage - 1) * STAKING_RESULTS_PAGE_SIZE,
    safePoolPage * STAKING_RESULTS_PAGE_SIZE,
  )

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
    setSelectedPoolId(null)
  }

  function handleNavigate(dest) {
    if (status === 'loading') return // block navigation during active scan
    if (view === 'staking' && dest !== 'staking') handleReset()
    setView(dest)
    window.scrollTo(0, 0)
  }

  function handleBack() {
    if (status === 'loading') return
    if (view === 'staking') handleReset()
    setView('home')
    window.scrollTo(0, 0)
  }

  function handleSelectPool(poolId) {
    const index = pools.findIndex(pool => pool.poolId === poolId)
    if (index === -1) return
    setShowPoolResults(true)
    setPoolPage(Math.floor(index / STAKING_RESULTS_PAGE_SIZE) + 1)
    setSelectedPoolId(poolId)
  }

  useEffect(() => {
    if (safeValidatorPage !== validatorPage) setValidatorPage(safeValidatorPage)
  }, [safeValidatorPage, validatorPage])

  useEffect(() => {
    if (safePoolPage !== poolPage) setPoolPage(safePoolPage)
  }, [safePoolPage, poolPage])

  useEffect(() => {
    setSelectedPoolId(null)
  }, [mode])

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-ink">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10rem] top-[8rem] h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute right-[-8rem] top-[20rem] h-[22rem] w-[22rem] rounded-full bg-cyan/10 blur-[120px]" />
        <PointerAura />
      </div>

      <AppHeader status={status} view={view} onBack={handleBack} onNavigate={handleNavigate} onAbout={() => setShowAbout(true)} />

      {/* ── Era Block Explorer ────────────────────────────────────── */}
      {view === 'era' && <EraBlockExplorer />}

      {/* ── Balance Viewer ──────────────────────────────────────────── */}
      {view === 'balance' && (
        <main className="relative z-10 mx-auto max-w-[104rem] px-4 py-6 sm:px-6 sm:py-8 pb-24 sm:pb-28">
          <BalanceExplorer />
        </main>
      )}

      {/* ── Reward History Viewer ─────────────────────────────────────────── */}
      {view === 'reward-history' && (
        <main className="relative z-10 mx-auto max-w-[104rem] px-4 py-6 sm:px-6 sm:py-8 pb-24 sm:pb-28">
          <RewardHistoryViewer />
        </main>
      )}

      {/* ── ENJ Infusion Checker ─────────────────────────────────────────── */}
      {view === 'infusion' && (
        <main className="relative z-10 mx-auto max-w-[104rem] px-4 py-6 sm:px-6 sm:py-8 pb-24 sm:pb-28">
          <InfusionChecker />
        </main>
      )}

      {/* ── Home / Landing ──────────────────────────────────────────── */}
      {view === 'home' && (
        <main className="relative z-10 mx-auto max-w-[104rem] px-4 py-6 sm:px-6 sm:py-8 pb-16 sm:pb-20">
          <LandingPage onNavigate={handleNavigate} />
        </main>
      )}

      {/* ── Staking view ────────────────────────────────────────────── */}
      {view === 'staking' && (
      <main className="relative z-10 mx-auto max-w-[104rem] px-4 py-5 sm:px-6 sm:py-7 pb-32 space-y-5">

        <section className="page-hero">
          <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)] xl:items-end">
            <div className="space-y-4">
              <div className="hero-kicker">
                <span className="hero-dot" />
                STAKING DIAGNOSTICS
              </div>
              <div className="max-w-3xl space-y-3">
                <h1 className="hero-title text-balance">
                  Staking rewards cadence with live operator context.
                </h1>
                <p className="hero-copy">
                  Scan validator or pool reward cadence, then inspect the raw detail tables below without burning space on duplicate summary blocks.
                </p>
              </div>

            </div>

          </div>
        </section>

        {/* Mode selector tabs + scan controls */}
        <div className="grid gap-4 xl:grid-cols-3 xl:items-stretch">
          <ModeSelector mode={mode} onModeChange={handleModeChange} disabled={isLoading} />
          <ControlPanel
            mode={mode}
            status={status}
            onRun={handleRun}
            onStop={handleStop}
            onReset={handleReset}
          />

          <PhaseProgressCards
            className="h-full"
            ariaLabel="Scan progress"
            indexLabel="Step"
            title={displayProgressTitle}
            summary={displayProgressSummary}
            meta={displayProgressMeta}
            phases={displayPhases}
          />
        </div>

        {/* ── Validator mode content ──────────────────────────────── */}
        {isValidatorMode && validators.length > 0 && (
          <section id="validators-panel" aria-labelledby="validators-heading">
            <div className="overflow-hidden rounded-[1.35rem] bg-surface shadow-ambient">
              <button
                type="button"
                onClick={() => setShowValidatorResults(open => !open)}
                className="flex w-full flex-wrap items-center gap-3 bg-card px-4 py-3.5 text-left transition-colors hover:bg-surface-high sm:px-5"
                aria-expanded={showValidatorResults}
              >
                <div>
                  <p className="section-label">Results</p>
                  <h2 id="validators-heading" className="section-title">Validators</h2>
                </div>
                {isLoading && (
                  <span className="text-xs text-text-secondary">
                    {validators.filter(v => v.fetchStatus === 'done').length} / {validators.length} loaded
                  </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <span className="text-xs font-mono text-muted">
                    {validators.length} validator{validators.length !== 1 ? 's' : ''} scanned
                  </span>
                  {validatorPages > 1 && (
                    <div className="flex items-center gap-1 text-xs" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setValidatorPage(1)} disabled={safeValidatorPage === 1} className="btn-ghost disabled:opacity-30" aria-label="First page">«</button>
                      <button type="button" onClick={() => setValidatorPage(Math.max(1, safeValidatorPage - 1))} disabled={safeValidatorPage === 1} className="btn-ghost disabled:opacity-30" aria-label="Previous page">‹ Prev</button>
                      <span className="px-2">{safeValidatorPage} / {validatorPages}</span>
                      <button type="button" onClick={() => setValidatorPage(Math.min(validatorPages, safeValidatorPage + 1))} disabled={safeValidatorPage === validatorPages} className="btn-ghost disabled:opacity-30" aria-label="Next page">Next ›</button>
                      <button type="button" onClick={() => setValidatorPage(validatorPages)} disabled={safeValidatorPage === validatorPages} className="btn-ghost disabled:opacity-30" aria-label="Last page">»</button>
                    </div>
                  )}
                </div>
                <span className="text-text-secondary" aria-hidden="true">
                  {showValidatorResults ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              </button>

              {showValidatorResults && (
                <div className="space-y-4 px-4 py-4 sm:px-5">
                  <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                    {visibleValidators.map(v => (
                      <ValidatorCard
                        key={v.address}
                        validator={v}
                        eraCount={lastEraCount}
                        latestEra={validatorLatestEra}
                        onRetry={vRetryValidator}
                      />
                    ))}
                  </div>
                  {validatorPages > 1 && (
                    <ResultsPagination
                      page={safeValidatorPage}
                      totalPages={validatorPages}
                      totalItems={validators.length}
                      itemLabel="validators"
                      onPageChange={setValidatorPage}
                    />
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {isValidatorMode && isDone && validators.length > 0 && (
          <SummarySection
            validators={validators}
            eraCount={lastEraCount}
            latestEra={validatorLatestEra}
            onRetry={vRetryValidator}
          />
        )}

        {/* ── Pool mode content ───────────────────────────────────── */}
        {!isValidatorMode && pools.length > 0 && (
          <section id="pools-panel" aria-labelledby="pools-heading">
            <div className="overflow-hidden rounded-[1.35rem] bg-surface shadow-ambient">
              <button
                type="button"
                onClick={() => setShowPoolResults(open => !open)}
                className="flex w-full flex-wrap items-center gap-3 bg-card px-4 py-3.5 text-left transition-colors hover:bg-surface-high sm:px-5"
                aria-expanded={showPoolResults}
              >
                <div>
                  <p className="section-label">Results</p>
                  <h2 id="pools-heading" className="section-title">Nomination Pools</h2>
                </div>
                {isLoading && (
                  <span className="text-xs text-text-secondary">
                    {pools.filter(p => p.fetchStatus === 'done').length} / {pools.length} loaded
                  </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <span className="text-xs font-mono text-muted">
                    {pools.length} pool{pools.length !== 1 ? 's' : ''} scanned
                  </span>
                  {poolPages > 1 && (
                    <div className="flex items-center gap-1 text-xs" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setPoolPage(1)} disabled={safePoolPage === 1} className="btn-ghost disabled:opacity-30" aria-label="First page">«</button>
                      <button type="button" onClick={() => setPoolPage(Math.max(1, safePoolPage - 1))} disabled={safePoolPage === 1} className="btn-ghost disabled:opacity-30" aria-label="Previous page">‹ Prev</button>
                      <span className="px-2">{safePoolPage} / {poolPages}</span>
                      <button type="button" onClick={() => setPoolPage(Math.min(poolPages, safePoolPage + 1))} disabled={safePoolPage === poolPages} className="btn-ghost disabled:opacity-30" aria-label="Next page">Next ›</button>
                      <button type="button" onClick={() => setPoolPage(poolPages)} disabled={safePoolPage === poolPages} className="btn-ghost disabled:opacity-30" aria-label="Last page">»</button>
                    </div>
                  )}
                </div>
                <span className="text-text-secondary" aria-hidden="true">
                  {showPoolResults ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              </button>

              {showPoolResults && (
                <div className="space-y-4 px-4 py-4 sm:px-5">
                  <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                    {visiblePools.map(p => (
                      <PoolCard
                        key={p.poolId}
                        pool={p}
                        eraCount={lastEraCount}
                        latestEra={poolLatestEra}
                        onRetry={pRetryPoolValidator}
                        open={selectedPoolId === p.poolId}
                        onOpenChange={next => setSelectedPoolId(next ? p.poolId : null)}
                      />
                    ))}
                  </div>
                  {poolPages > 1 && (
                    <ResultsPagination
                      page={safePoolPage}
                      totalPages={poolPages}
                      totalItems={pools.length}
                      itemLabel="pools"
                      onPageChange={nextPage => {
                        setSelectedPoolId(null)
                        setPoolPage(nextPage)
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {!isValidatorMode && isDone && pools.length > 0 && (
          <PoolSummarySection
            pools={pools}
            eraCount={lastEraCount}
            onPoolSelect={handleSelectPool}
          />
        )}

        {/* ── Empty / error states ────────────────────────────────── */}
        {status === 'idle' && activeRecords.length > 0 && (
          <div className="rounded-[1.35rem] bg-surface px-6 py-12 text-center shadow-ambient sm:py-16">
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
          <div className="rounded-[1.35rem] bg-surface px-6 py-10 text-center shadow-ambient">
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

      {/* First-visit disclaimer */}
      {showFirstVisit && (
        <DisclaimerModal mode="first-visit" onClose={acceptFirstVisit} />
      )}

      {/* About modal */}
      {showAbout && (
        <DisclaimerModal mode="about" onClose={() => setShowAbout(false)} />
      )}

      {/* Vercel Analytics (lazy-loaded if dependency installed) */}
      {AnalyticsComponent && <AnalyticsComponent />}
    </div>
  )
}

function ResultsPagination({ page, totalPages, totalItems, itemLabel, onPageChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.15rem] bg-card px-4 py-3 text-xs text-text-secondary">
      <span>
        {totalItems.toLocaleString('en')} {itemLabel}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className="btn-ghost disabled:opacity-30"
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="btn-ghost disabled:opacity-30"
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        <span className="px-2">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="btn-ghost disabled:opacity-30"
          aria-label="Next page"
        >
          Next ›
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className="btn-ghost disabled:opacity-30"
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
  )
}
