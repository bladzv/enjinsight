import { useState } from 'react'
import { DEFAULT_ERA_COUNT } from './constants.js'
import { useValidatorChecker } from './hooks/useValidatorChecker.js'
import { usePoolChecker }      from './hooks/usePoolChecker.js'
import { resolveLatestEra }    from './utils/eraAnalysis.js'

import AppHeader           from './components/AppHeader.jsx'
import ModeSelector        from './components/ModeSelector.jsx'
import ControlPanel        from './components/ControlPanel.jsx'
import ProxySetup          from './components/ProxySetup.jsx'
import ValidatorCard       from './components/ValidatorCard.jsx'
import PoolCard            from './components/PoolCard.jsx'
import TerminalLog         from './components/TerminalLog.jsx'
import SummarySection      from './components/SummarySection.jsx'
import PoolSummarySection  from './components/PoolSummarySection.jsx'

export default function App() {
  const [mode,       setMode]       = useState('validators') // 'validators' | 'pools'
  const [showProxy,  setShowProxy]  = useState(false)
  const [lastEraCount, setLastEraCount] = useState(DEFAULT_ERA_COUNT)

  // Validator hook
  const {
    status: vStatus, validators, logs: vLogs,
    proxyUrl: vProxyUrl, setProxy: vSetProxy,
    runCheck: vRunCheck, reset: vReset,
  } = useValidatorChecker()

  // Pool hook
  const {
    status: pStatus, pools, logs: pLogs,
    proxyUrl: pProxyUrl, setProxy: pSetProxy,
    runCheck: pRunCheck, reset: pReset,
    latestEra: poolLatestEra,
  } = usePoolChecker()

  // Derive active values based on current mode
  const isValidatorMode = mode === 'validators'
  const status    = isValidatorMode ? vStatus   : pStatus
  const logs      = isValidatorMode ? vLogs     : pLogs
  const proxyUrl  = isValidatorMode ? vProxyUrl : pProxyUrl
  const isLoading = status === 'loading'
  const isDone    = status === 'done'

  const validatorLatestEra = resolveLatestEra(validators)

  function handleSetProxy(url) {
    // Keep both hooks in sync
    const ok1 = vSetProxy(url)
    const ok2 = pSetProxy(url)
    return ok1 !== false && ok2 !== false
  }

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

  function handleModeChange(newMode) {
    if (status === 'loading') return // block switch during scan
    setMode(newMode)
  }

  return (
    <div className="min-h-dvh bg-ink bg-grid">
      <AppHeader status={status} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-5">

        {/* Mode selector tabs */}
        <ModeSelector mode={mode} onModeChange={handleModeChange} disabled={isLoading} />

        {/* Proxy setup (inline or modal-like) */}
        {showProxy && (
          <ProxySetup
            proxyUrl={proxyUrl}
            onSave={(url) => {
              const ok = handleSetProxy(url)
              if (ok !== false) setShowProxy(false)
              return ok !== false
            }}
            onDismiss={() => setShowProxy(false)}
          />
        )}

        {/* Control panel */}
        <ControlPanel
          status={status}
          proxyUrl={proxyUrl}
          onRun={handleRun}
          onReset={handleReset}
          onOpenProxy={() => setShowProxy(s => !s)}
        />

        {/* Terminal log */}
        {(logs.length > 0 || isLoading) && (
          <TerminalLog logs={logs} />
        )}

        {/* ── Validator mode content ──────────────────────────────── */}
        {isValidatorMode && validators.length > 0 && (
          <section aria-labelledby="validators-heading">
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
          <section aria-labelledby="pools-heading">
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
            <p className="text-sm text-dim max-w-sm mx-auto">
              Configure your proxy URL (gear icon), enter the number of eras to check, then press <strong className="text-text">CHECK</strong>.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-12">
            <p className="text-sm text-danger mb-3">
              {isValidatorMode ? 'Failed to fetch validator list.' : 'Failed to fetch nomination pools.'}
            </p>
            <p className="text-xs text-dim">Check your proxy URL and try again.</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-6 text-center text-xs text-muted">
        <p>
          Enjin Validator Reward Checker · Data via{' '}
          <a
            href="https://enjin.subscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-dim hover:text-cyan transition-colors"
          >
            Subscan
          </a>
          {' '}· Read-only · No wallet connection required
        </p>
      </footer>
    </div>
  )
}
