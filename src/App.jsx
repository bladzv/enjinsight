import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { ChevronDown, ChevronUp, Square } from 'lucide-react'
import { DEFAULT_ERA_COUNT } from './constants.js'
import { useValidatorChecker } from './hooks/useValidatorChecker.js'
import { usePoolChecker }      from './hooks/usePoolChecker.js'
import { resolveLatestEra }    from './utils/eraAnalysis.js'

import AppHeader           from './components/AppHeader.jsx'
import StepProgress        from './components/StepProgress.jsx'
import DisclaimerModal, { useFirstVisitDisclaimer } from './components/DisclaimerModal.jsx'
import LandingPage         from './components/LandingPage.jsx'
import ErrorBoundary       from './components/ErrorBoundary.jsx'
import ModeSelector        from './components/ModeSelector.jsx'
import ControlPanel        from './components/ControlPanel.jsx'
import ValidatorCard       from './components/ValidatorCard.jsx'
import PoolCard            from './components/PoolCard.jsx'
import TerminalLog         from './components/TerminalLog.jsx'
import SummarySection      from './components/SummarySection.jsx'
import PoolSummarySection  from './components/PoolSummarySection.jsx'
import PhaseProgressCards  from './components/PhaseProgressCards.jsx'

const BalanceExplorer     = lazy(() => import('./components/BalanceExplorer.jsx'))
const RewardHistoryViewer = lazy(() => import('./components/RewardHistoryViewer.jsx'))
const EraBlockExplorer    = lazy(() => import('./components/EraBlockExplorer.jsx'))
const InfusionChecker     = lazy(() => import('./components/InfusionChecker.jsx'))

/** Suspense fallback for a lazy-loaded tool view — mirrors the spinner used elsewhere. */
function ViewLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  )
}

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

const STAKING_SIMPLE_STEPS = [
  { key: 'mode',    label: 'Mode'    },
  { key: 'options', label: 'Options' },
  { key: 'running', label: 'Running' },
  { key: 'results', label: 'Results' },
]

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
  const [theme, setTheme] = useState(() => {
    const storedTheme = window.localStorage.getItem('enjinsight-theme')
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [simpleMode, setSimpleMode] = useState(() => {
    return window.localStorage.getItem('enjinsight-ui-mode') === 'simple'
  })
  const [stakingPage, setStakingPage] = useState(1)
  const [stakingSimpleRunning, setStakingSimpleRunning] = useState(false)
  const [balanceScanActive, setBalanceScanActive] = useState(false)
  const [rewardScanActive, setRewardScanActive] = useState(false)
  const [infusionScanActive, setInfusionScanActive] = useState(false)
  const [scanToastVisible, setScanToastVisible] = useState(false)
  const scanToastTimerRef = useRef(null)
  const previousNavigationLockRef = useRef(false)
  const previousStakingStatusRef = useRef(null)
  const { show: showFirstVisit, accept: acceptFirstVisit } = useFirstVisitDisclaimer()

  // Sync URL hash when view changes
  useEffect(() => {
    window.history.replaceState(
      null, '',
      view === 'home' ? window.location.pathname : `#${view}`
    )
  }, [view])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.classList.add('theme-switching')
    const timer = window.setTimeout(() => root.classList.remove('theme-switching'), 700)
    window.localStorage.setItem('enjinsight-theme', theme)
    return () => window.clearTimeout(timer)
  }, [theme])

  // Validator hook
  const {
    status: vStatus, validators, logs: vLogs,
    runCheck: vRunCheck, stop: vStop, reset: vReset, retryValidator: vRetryValidator,
    progress: vProgress,
  } = useValidatorChecker()

  // Pool hook
  const {
    status: pStatus, pools, logs: pLogs,
    runCheck: pRunCheck, stop: pStop, reset: pReset, retryPoolValidator: pRetryPoolValidator,
    latestEra: poolLatestEra,
    progress: pProgress,
  } = usePoolChecker()

  // Derive active values based on current mode
  const isValidatorMode = mode === 'validators'
  const status    = isValidatorMode ? vStatus   : pStatus
  const logs      = isValidatorMode ? vLogs     : pLogs
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
  const isNavigationLocked = isLoading || balanceScanActive || rewardScanActive || infusionScanActive
  const headerStatus = isNavigationLocked ? 'loading' : status
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

  function showScanLockToast() {
    window.clearTimeout(scanToastTimerRef.current)
    setScanToastVisible(true)
    scanToastTimerRef.current = window.setTimeout(() => {
      setScanToastVisible(false)
    }, 4200)
  }

  useEffect(() => {
    if (isNavigationLocked && !previousNavigationLockRef.current) {
      showScanLockToast()
    }
    previousNavigationLockRef.current = isNavigationLocked
  }, [isNavigationLocked])

  useEffect(() => {
    return () => {
      window.clearTimeout(scanToastTimerRef.current)
    }
  }, [])

  async function handleRun(eraCount) {
    setLastEraCount(eraCount)
    setStakingSimpleRunning(true)
    if (isValidatorMode) {
      await vRunCheck(eraCount)
    } else {
      await pRunCheck(eraCount)
    }
  }

  function handleReset() {
    if (isValidatorMode) vReset()
    else pReset()
    setStakingPage(1)
    setStakingSimpleRunning(false)
  }

  function handleStop() {
    if (isValidatorMode) vStop()
    else pStop()
  }

  function handleModeChange(newMode) {
    if (isNavigationLocked) {
      showScanLockToast()
      return
    }
    setMode(newMode)
    setSelectedPoolId(null)
  }

  function handleNavigate(dest) {
    if (isNavigationLocked) {
      showScanLockToast()
      return
    }
    if (view === 'staking' && dest !== 'staking') handleReset()
    setView(dest)
    window.scrollTo(0, 0)
  }

  function handleBack() {
    if (isNavigationLocked) {
      showScanLockToast()
      return
    }
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

  function handleToggleTheme() {
    setTheme(current => (current === 'dark' ? 'light' : 'dark'))
  }

  function handleThemeChange(nextTheme) {
    if (nextTheme !== 'dark' && nextTheme !== 'light') return
    setTheme(nextTheme)
  }

  function handleSimpleModeChange(isSimple) {
    setSimpleMode(isSimple)
    window.localStorage.setItem('enjinsight-ui-mode', isSimple ? 'simple' : 'advanced')
  }

  const stakingSimpleStep = (status === 'loading' && stakingSimpleRunning) ? 3
    : ((status === 'done' || status === 'error' || status === 'stopped') && stakingSimpleRunning) ? 4
    : stakingPage

  // safeValidatorPage/safePoolPage already clamp on every render (see their
  // definitions above) — this used to also write the clamped value back into
  // validatorPage/poolPage state, which forced an extra render pass to do
  // nothing render-visible; the clamp-on-read is sufficient on its own, the
  // same pattern BalanceTable.jsx uses for its own page state.

  useEffect(() => {
    setSelectedPoolId(null)
  }, [mode])

  useEffect(() => {
    const prevStatus = previousStakingStatusRef.current
    previousStakingStatusRef.current = status

    if (view !== 'staking') return
    if (!(prevStatus === 'loading' && status === 'done')) return

    const summaryId = isValidatorMode ? 'staking-validator-summary' : 'staking-pool-summary'
    const resultsId = isValidatorMode ? 'validators-panel' : 'pools-panel'
    const target = document.getElementById(summaryId) || document.getElementById(resultsId)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [view, status, isValidatorMode])

  return (
    <div className="app-shell relative min-h-dvh">
      <AppHeader
        status={headerStatus}
        view={view}
        onBack={handleBack}
        onNavigate={handleNavigate}
        onAbout={() => setShowAbout(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onThemeChange={handleThemeChange}
        simpleMode={simpleMode}
        onSimpleModeChange={handleSimpleModeChange}
      />

      <div className="relative flex min-w-0 flex-col">

      {/* ── Era Block Explorer ────────────────────────────────────── */}
      {view === 'era' && (
        <ErrorBoundary label="Era Explorer">
          <Suspense fallback={<ViewLoadingFallback />}>
            <EraBlockExplorer />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* ── Balance Viewer ──────────────────────────────────────────── */}
      {view === 'balance' && (
        <main className="relative z-10 mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-6 pb-24 sm:pb-28">
          <ErrorBoundary label="Balance Viewer">
            <Suspense fallback={<ViewLoadingFallback />}>
              <BalanceExplorer onScanStateChange={setBalanceScanActive} simpleMode={simpleMode} />
            </Suspense>
          </ErrorBoundary>
        </main>
      )}

      {/* ── Reward History Viewer ─────────────────────────────────────────── */}
      {view === 'reward-history' && (
        <main className="relative z-10 mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-6 pb-24 sm:pb-28">
          <ErrorBoundary label="Reward History">
            <Suspense fallback={<ViewLoadingFallback />}>
              <RewardHistoryViewer onScanStateChange={setRewardScanActive} simpleMode={simpleMode} />
            </Suspense>
          </ErrorBoundary>
        </main>
      )}

      {/* ── ENJ Infusion Checker ─────────────────────────────────────────── */}
      {view === 'infusion' && (
        <main className="relative z-10 mx-auto w-full max-w-[100rem] px-4 py-5 sm:px-6 sm:py-6 pb-24 sm:pb-28">
          <ErrorBoundary label="ENJ Infusion Checker">
            <Suspense fallback={<ViewLoadingFallback />}>
              <InfusionChecker onScanStateChange={setInfusionScanActive} simpleMode={simpleMode} />
            </Suspense>
          </ErrorBoundary>
        </main>
      )}

      {/* ── Home / Landing ──────────────────────────────────────────── */}
      {view === 'home' && (
        <main className="relative z-10 mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 sm:py-8 pb-16 sm:pb-20">
          <LandingPage onNavigate={handleNavigate} />
        </main>
      )}

      {/* ── Staking view ────────────────────────────────────────────── */}
      {view === 'staking' && (
      <main className="relative z-10 mx-auto w-full max-w-[100rem] space-y-4 px-3 py-4 pb-32 sm:px-6 sm:py-6 sm:space-y-5">

        <section className="page-hero">
          <div className="relative z-10 flex flex-col gap-2">
            <div className="hero-kicker self-start">
              <span className="hero-dot" />
              STAKING DIAGNOSTICS
            </div>
            <h1 className="hero-title">Staking rewards cadence</h1>
            <p className="hero-copy">Scan validator or pool reward cadence, then drill into the raw detail tables.</p>
          </div>
        </section>

        {/* Simple mode: step progress bar */}
        {simpleMode && (
          <StepProgress
            steps={STAKING_SIMPLE_STEPS}
            currentStep={stakingSimpleStep}
            onReset={stakingSimpleStep > 1 ? handleReset : undefined}
          />
        )}

        {/* Controls: advanced always; simple page 1 (Mode) and page 2 (Options) */}
        {!simpleMode && (
          <div className="grid gap-3 sm:gap-4 xl:grid-cols-3 xl:items-stretch">
            <ModeSelector mode={mode} onModeChange={handleModeChange} disabled={isLoading} />
            <ControlPanel
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
        )}

        {/* Simple page 1: Mode selection */}
        {/* Simple page 1: Mode — ModeSelector is already a data-panel, no wrapper needed */}
        {simpleMode && stakingSimpleStep === 1 && (
          <div className="mx-auto w-full max-w-lg space-y-4">
            <ModeSelector mode={mode} onModeChange={handleModeChange} disabled={false} />
            <div className="flex justify-end">
              <button type="button" onClick={() => setStakingPage(2)} className="btn-primary flex items-center gap-2">
                Next <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}

        {/* Simple page 2: Era count + Run */}
        {simpleMode && stakingSimpleStep === 2 && (
          <div className="mx-auto w-full max-w-[360px] space-y-3">
            <ControlPanel
              status={status}
              onRun={handleRun}
              onStop={handleStop}
              onReset={handleReset}
              compact
            />
            <div className="flex justify-start">
              <button type="button" onClick={() => setStakingPage(1)} className="btn-secondary flex items-center gap-2">
                <span aria-hidden="true">←</span> Back
              </button>
            </div>
          </div>
        )}

        {/* Simple mode step 3: running screen */}
        {simpleMode && stakingSimpleStep === 3 && (
          <div className="mx-auto w-full max-w-md rounded-sm border border-white/[0.06] bg-surface px-6 py-14 text-center shadow-ambient">
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            <h2 className="mb-1 text-base font-semibold text-text">{activePhase?.label ?? 'Running scan…'}</h2>
            {displayProgressMeta && (
              <p className="mb-6 text-sm text-text-secondary">{displayProgressMeta}</p>
            )}
            <button onClick={handleStop} className="btn-stop mx-auto flex items-center gap-2">
              <Square size={14} />
              Stop
            </button>
          </div>
        )}

        {/* Results — hidden during simple step 3 (running) */}
        {(!simpleMode || stakingSimpleStep !== 3) && (
        <>

        {/* ── Validator mode content ──────────────────────────────── */}
        {isValidatorMode && validators.length > 0 && (
          <ResultsPanel
            id="validators-panel"
            heading="Validators"
            headingId="validators-heading"
            count={validators.length}
            countLabel="validator"
            isLoading={isLoading}
            loadingLabel={isLoading ? `${validators.filter(v => v.fetchStatus === 'done').length} / ${validators.length} loaded` : null}
            page={safeValidatorPage}
            pages={validatorPages}
            onPageChange={setValidatorPage}
            open={showValidatorResults}
            onToggleOpen={() => setShowValidatorResults(open => !open)}
          >
            <div className="grid gap-2 sm:gap-3 lg:grid-cols-2 2xl:grid-cols-3">
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
          </ResultsPanel>
        )}

        {isValidatorMode && isDone && validators.length > 0 && (
          <section id="staking-validator-summary">
            <SummarySection
              validators={validators}
              eraCount={lastEraCount}
              latestEra={validatorLatestEra}
              onRetry={vRetryValidator}
            />
          </section>
        )}

        {/* ── Pool mode content ───────────────────────────────────── */}
        {!isValidatorMode && pools.length > 0 && (
          <ResultsPanel
            id="pools-panel"
            heading="Nomination Pools"
            headingId="pools-heading"
            count={pools.length}
            countLabel="pool"
            isLoading={isLoading}
            loadingLabel={isLoading ? `${pools.filter(p => p.fetchStatus === 'done').length} / ${pools.length} loaded` : null}
            page={safePoolPage}
            pages={poolPages}
            onPageChange={(nextPage) => { setSelectedPoolId(null); setPoolPage(nextPage) }}
            open={showPoolResults}
            onToggleOpen={() => setShowPoolResults(open => !open)}
          >
            <div className="grid gap-2 sm:gap-3 lg:grid-cols-2 2xl:grid-cols-3">
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
          </ResultsPanel>
        )}

        {!isValidatorMode && isDone && pools.length > 0 && (
          <section id="staking-pool-summary">
            <PoolSummarySection
              pools={pools}
              eraCount={lastEraCount}
              onPoolSelect={handleSelectPool}
            />
          </section>
        )}

        {/* ── Empty / error states ────────────────────────────────── */}
        {!simpleMode && status === 'idle' && activeRecords.length === 0 && (
          <div className="rounded-sm border border-white/[0.06] bg-surface px-6 py-12 text-center shadow-ambient sm:py-16">
            <div className="w-16 h-16 mx-auto mb-5 rounded-sm bg-card
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
          <div className="rounded-sm border border-white/[0.06] bg-surface px-6 py-10 text-center shadow-ambient">
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

        </> /* /results fragment */
        )}
      </main>
      )}

      </div>{/* /right column */}

      {/* Sticky terminal log — advanced mode only */}
      {view === 'staking' && !simpleMode && (
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

      {scanToastVisible && (
        <div className="pointer-events-none fixed top-6 left-1/2 z-[120] w-[min(92vw,44rem)] -translate-x-1/2 rounded-sm border border-warning/40 bg-card/95 px-4 py-3 shadow-ambient backdrop-blur-sm">
          <p className="text-sm font-medium text-warning">Scan in progress.</p>
          <p className="text-xs text-text-secondary">If you want to open another tool or page, stop the current scan first.</p>
        </div>
      )}

    </div>
  )
}

function ResultsPanel({ id, heading, headingId, count, countLabel, isLoading, loadingLabel, page, pages, onPageChange, open, onToggleOpen, children }) {
  return (
    <section id={id} aria-labelledby={headingId} className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-surface">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center gap-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-surface-high sm:px-4 sm:py-3"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <p className="section-label">Results</p>
          <h2 id={headingId} className="font-headline text-base font-bold text-text sm:text-xl">{heading}</h2>
        </div>
        <span className="hidden text-[11px] font-mono text-muted sm:inline">
          {count.toLocaleString('en')} {countLabel}{count !== 1 ? 's' : ''}
        </span>
        {isLoading && loadingLabel && (
          <span className="text-[11px] text-text-secondary">{loadingLabel}</span>
        )}
        <span className="text-text-secondary" aria-hidden="true">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
          {children}
          {pages > 1 && (
            <ResultsPagination
              page={page}
              totalPages={pages}
              totalItems={count}
              itemLabel={`${countLabel}s`}
              onPageChange={onPageChange}
            />
          )}
        </div>
      )}
    </section>
  )
}

function ResultsPagination({ page, totalPages, totalItems, itemLabel, onPageChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-white/[0.06] bg-card px-4 py-3 text-xs text-text-secondary">
      <span>
        {totalItems.toLocaleString('en')} {itemLabel}
      </span>
      <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
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
