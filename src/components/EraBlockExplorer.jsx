/**
 * EraBlockExplorer — React-native era block explorer.
 *
 * Shows live Enjin Relay era / session / block data via a persistent WebSocket,
 * with an EKG canvas, an era progress bar, and a past-era lookup tool.
 * Network: Enjin Relaychain only.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Search, Globe, Clock } from 'lucide-react'
import { useEraExplorer, ERA_STATUS } from '../hooks/useEraExplorer.js'
import { useCountUp } from '../hooks/useCountUp.js'
import TerminalLog from './TerminalLog.jsx'
import CopyButton from './CopyButton.jsx'
import Field from './Field.jsx'
import ScanStatusBar from './ScanStatusBar.jsx'
import Skeleton, { SkeletonSwap } from './Skeleton.jsx'

const HEARTBEAT_PATH = 'M0 20 L20 20 L25 10 L30 30 L35 20 L100 20'

function HeartbeatLine({ strokeColor, pulseKey, compact = false }) {
  const wrapperClass = compact ? 'heartbeat-svg heartbeat-svg-compact' : 'heartbeat-monitor'

  return (
    <div className={wrapperClass} aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 40" preserveAspectRatio="none">
        {pulseKey > 0 && (
          <path key={pulseKey} className="heartbeat-line-live" d={HEARTBEAT_PATH} fill="none" stroke={strokeColor} />
        )}
      </svg>
    </div>
  )
}

const ERA_LEN = 14400
const STATUS_CONFIG = {
  [ERA_STATUS.IDLE]: { dot: 'bg-muted', label: 'Idle' },
  [ERA_STATUS.CONNECTING]: { dot: 'bg-warning animate-pulse', label: 'Connecting…' },
  [ERA_STATUS.DISCOVERING]: { dot: 'bg-cyan animate-pulse', label: 'Syncing…' },
  [ERA_STATUS.LIVE]: { dot: 'bg-success', label: 'Live' },
  [ERA_STATUS.DISCONNECTED]: { dot: 'bg-danger', label: 'Disconnected — reconnecting…' },
}

function fmt(n) {
  return n != null ? n.toLocaleString() : '—'
}

const _DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function _p2(n) { return String(n).padStart(2, '0') }

function fmtDateLocal(utcStr) {
  if (!utcStr) return null
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) return null
    const day = _DAYS[d.getDay()]
    const dd = _p2(d.getDate())
    const mmm = _MONTHS[d.getMonth()]
    const yyyy = d.getFullYear()
    const hh = _p2(d.getHours())
    const mm = _p2(d.getMinutes())
    const ss = _p2(d.getSeconds())
    const off = -d.getTimezoneOffset()
    const sign = off >= 0 ? '+' : '-'
    const absH = Math.floor(Math.abs(off) / 60)
    const absM = Math.abs(off) % 60
    const tz = off === 0 ? 'UTC' : (absM === 0 ? `UTC${sign}${absH}` : `UTC${sign}${absH}:${_p2(absM)}`)
    return `${day}, ${dd} ${mmm} ${yyyy} ${hh}:${mm}:${ss} ${tz}`
  } catch {
    return null
  }
}

function fmtDateUtc(utcStr) {
  if (!utcStr) return null
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) return null
    const day = _DAYS[d.getUTCDay()]
    const dd = _p2(d.getUTCDate())
    const mmm = _MONTHS[d.getUTCMonth()]
    const yyyy = d.getUTCFullYear()
    const hh = _p2(d.getUTCHours())
    const mm = _p2(d.getUTCMinutes())
    const ss = _p2(d.getUTCSeconds())
    return `${day}, ${dd} ${mmm} ${yyyy} ${hh}:${mm}:${ss} UTC`
  } catch {
    return null
  }
}

function StatCard({ label, value, accent = false, sub = null, loading = false }) {
  return (
    <div className="metric-card text-left">
      <p className="metric-label">{label}</p>
      <SkeletonSwap
        loading={loading}
        skeleton={<Skeleton.Block width="5rem" height="1.75rem" className="mt-2" />}
      >
        <p className={`metric-value break-all ${accent ? 'text-cyan' : 'text-text'}`}>{value}</p>
      </SkeletonSwap>
      {sub ? <p className="mt-2 whitespace-normal break-all font-mono text-[10px] leading-tight text-muted" title={sub}>{sub}</p> : null}
    </div>
  )
}

export default function EraBlockExplorer() {
  const {
    status, era, session, block, eraStart, csvCount,
    lookup, lookupLoading, lookupError, logs, debug,
    lookupEra, resetLookup,
  } = useEraExplorer()

  const [eraInput, setEraInput] = useState('')
  const [showDebug, setShowDebug] = useState(false)
  const [localTime, setLocalTime] = useState(false)
  const [pulseKey, setPulseKey] = useState(0)
  const lastSeenBlock = useRef(null)

  const eraEnd = eraStart != null ? eraStart + ERA_LEN - 1 : null
  const remaining = eraEnd != null && block != null ? Math.max(0, eraEnd - block) : null
  const pct = eraStart != null && block != null
    ? Math.min(100, Math.round(Math.max(0, block - eraStart) / ERA_LEN * 100))
    : 0

  // One-shot lookup results, not a continuously-ticking live value like the
  // telemetry tiles above — a discrete count-up on arrival reads as a real
  // reveal instead of fighting a live ticker. Target falls back to 0 so the
  // hook can be called unconditionally before `lookup` exists.
  const startBlockCount = useCountUp(lookup?.startBlock ?? 0, { format: n => Math.round(n).toLocaleString() })
  const endBlockCount = useCountUp(lookup?.endBlock ?? 0, { format: n => Math.round(n).toLocaleString() })

  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG[ERA_STATUS.IDLE]
  const strokeColor = status === ERA_STATUS.LIVE
    ? 'var(--cyan)'
    : status === ERA_STATUS.DISCONNECTED
      ? 'var(--danger)'
      : (status === ERA_STATUS.CONNECTING || status === ERA_STATUS.DISCOVERING)
        ? 'var(--primary-dim)'
        : 'rgba(255,255,255,0.06)'

  useEffect(() => {
    if (block == null) return
    if (lastSeenBlock.current == null) {
      lastSeenBlock.current = block
      return
    }
    if (block !== lastSeenBlock.current) {
      lastSeenBlock.current = block
      setPulseKey(key => key + 1)
    }
  }, [block])

  const eraStartLabel = eraStart != null ? eraStart.toLocaleString() : '—'
  const eraEndLabel = eraEnd != null ? eraEnd.toLocaleString() : '—'

  const eraInputNum = eraInput.trim() === '' ? null : parseInt(eraInput.trim(), 10)
  const eraInputErr = eraInput.trim() === '' ? '' :
    (isNaN(eraInputNum) || eraInputNum <= 0) ? 'Era number must be greater than 0.' :
    (era != null && eraInputNum >= era) ? `Era ${eraInputNum} is still active or hasn't ended yet (current: ${era}).` :
    ''

  const onLookup = useCallback((event) => {
    event.preventDefault()
    const n = parseInt(eraInput.trim(), 10)
    if (!isNaN(n) && !eraInputErr) lookupEra(n)
  }, [eraInput, eraInputErr, lookupEra])

  return (
    <main id="main-content" className="relative z-10 mx-auto w-full max-w-[100rem] space-y-4 px-3 py-4 pb-32 sm:space-y-5 sm:px-6 sm:py-6">
      {/* Hero */}
      <section className="page-hero">
        <div className="relative z-10 flex flex-col gap-2 sm:gap-3">
          <div className="hero-kicker self-start">
            <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
            <span>{statusCfg.label}</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="space-y-1.5">
              <h1 className="hero-title">Relaychain State</h1>
              <p className="hero-copy">Live era telemetry plus archival lookup for any past era.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mini-chip">
                <span className="hero-dot" /> Relaychain
              </span>
              <span className="mini-chip text-success">
                <SkeletonSwap
                  loading={csvCount === 0}
                  skeleton={<Skeleton.Block width="3rem" height="0.5rem" className="inline-block" />}
                  className="inline-grid"
                >
                  <span>{csvCount} eras cached</span>
                </SkeletonSwap>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Live telemetry grid */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          <StatCard label="Active Era" value={fmt(era)} accent loading={era == null} />
          <StatCard label="Session" value={fmt(session)} loading={session == null} />
          <StatCard label="Current Block" value={fmt(block)} accent loading={block == null} />
          <StatCard label="Era Starts" value={eraStartLabel} loading={eraStart == null} />
          <StatCard label="Era Ends" value={eraEndLabel} loading={eraEnd == null} />
          <StatCard label="Blocks Left" value={fmt(remaining)} loading={remaining == null} />
        </div>

        {/* Side: heartbeat + era progress */}
        <div className="flex flex-col gap-3">
          <div className="data-panel">
            <div className="flex items-center justify-between gap-2">
              <p className="metric-label">System Heartbeat</p>
              <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Block activity</span>
            </div>
            <div className="mt-3 h-14">
              <HeartbeatLine pulseKey={pulseKey} strokeColor={strokeColor} />
            </div>
          </div>

          <div className="data-panel" style={{ boxShadow: 'inset 2px 0 0 var(--primary)' }}>
            <div className="flex items-center justify-between gap-2">
              <p className="metric-label">Era Progress</p>
              <span className="font-mono text-xl font-bold text-primary">{pct}%</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden bg-surface-high">
              <div
                className="h-full bg-gradient-to-r from-primary-dim via-primary to-cyan transition-[width] duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Era lookup */}
      <section className="data-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline)] pb-3">
          <div>
            <p className="section-label">Tool</p>
            <h2 className="font-headline text-lg font-bold text-text sm:text-xl">Past Era Lookup</h2>
          </div>
          <div
            className="inline-flex items-center rounded-sm border border-[var(--hairline)] bg-card p-0.5"
            role="group"
            aria-label="Timezone selector"
          >
            <button
              type="button"
              onClick={() => setLocalTime(false)}
              className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                !localTime ? 'bg-primary/15 text-primary-glow' : 'text-text-secondary hover:text-text'
              }`}
              aria-pressed={!localTime}
            >
              <Clock size={11} /> UTC
            </button>
            <button
              type="button"
              onClick={() => setLocalTime(true)}
              className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                localTime ? 'bg-cyan/20 text-cyan' : 'text-text-secondary hover:text-text'
              }`}
              aria-pressed={localTime}
            >
              <Globe size={11} /> Local
            </button>
          </div>
        </div>

        <form onSubmit={onLookup} className="mt-4 space-y-2">
          <div className="flex flex-wrap items-start gap-2">
            <Field
              label="Era number"
              id="era-lookup-input"
              className="w-32 sm:w-40"
              controlClassName={`font-mono ${eraInputErr ? 'error-shake ring-1 ring-danger' : ''}`}
              type="number"
              min="0"
              step="1"
              value={eraInput}
              onChange={event => { setEraInput(event.target.value); resetLookup() }}
              error={eraInputErr}
            />
            <button
              type="submit"
              className="btn-primary btn-push gap-1.5"
              disabled={lookupLoading || !eraInput || !!eraInputErr}
              aria-label="Look up era"
            >
              {lookupLoading ? <span className="animate-pulse">Searching…</span> : <><Search size={14} />Look Up</>}
            </button>
          </div>
        </form>

        {lookupError ? (
          <p className="mt-3 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {lookupError}
          </p>
        ) : null}

        {lookupLoading && (
          <ScanStatusBar label="Looking up era…" sticky={false} className="mt-4" />
        )}

        {(lookupLoading || lookup) && (
          /* The skeleton represents the steady-state shape (2 block tiles +
             2 date tiles) rather than whatever the previous 2-tile skeleton
             happened to hardcode — the loaded state can show up to 5 tiles
             (block hash included), so a 2-tile skeleton visibly grew once
             data landed. Date/hash tiles are still genuinely conditional on
             what the lookup returns, so the skeleton covers the common case
             rather than every possible combination. */
          <SkeletonSwap
            loading={lookupLoading}
            skeleton={
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="metric-card">
                  <p className="metric-label">Start Block</p>
                  <Skeleton.Block width="5rem" height="1.5rem" className="mt-2" />
                </div>
                <div className="metric-card">
                  <p className="metric-label">End Block</p>
                  <Skeleton.Block width="5rem" height="1.5rem" className="mt-2" />
                </div>
                <div className="metric-card col-span-2 sm:col-span-1">
                  <p className="metric-label">Start ({localTime ? 'Local' : 'UTC'})</p>
                  <Skeleton.Line width="80%" className="mt-2" />
                </div>
                <div className="metric-card col-span-2 sm:col-span-1">
                  <p className="metric-label">End ({localTime ? 'Local' : 'UTC'})</p>
                  <Skeleton.Line width="80%" className="mt-2" />
                </div>
              </div>
            }
          >
            {lookup && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="metric-card">
                <p className="metric-label">Start Block</p>
                <p className="metric-value text-base">
                  <span className="sr-only">{lookup.startBlock.toLocaleString()}</span>
                  <span aria-hidden="true">{startBlockCount}</span>
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-label">End Block</p>
                <p className="metric-value text-base">
                  <span className="sr-only">{lookup.endBlock.toLocaleString()}</span>
                  <span aria-hidden="true">{endBlockCount}</span>
                </p>
              </div>

              {lookup.startDateUtc ? (() => {
                const raw = lookup.startDateUtc
                const display = localTime ? (fmtDateLocal(raw) ?? raw) : (fmtDateUtc(raw) ?? raw)
                return (
                  <div className="metric-card col-span-2 sm:col-span-1">
                    <p className="metric-label">Start ({localTime ? 'Local' : 'UTC'})</p>
                    <p className="mt-1.5 text-xs leading-snug text-text font-mono break-all">{display}</p>
                  </div>
                )
              })() : null}

              {lookup.endDateUtc ? (() => {
                const raw = lookup.endDateUtc
                const display = localTime ? (fmtDateLocal(raw) ?? raw) : (fmtDateUtc(raw) ?? raw)
                return (
                  <div className="metric-card col-span-2 sm:col-span-1">
                    <p className="metric-label">End ({localTime ? 'Local' : 'UTC'})</p>
                    <p className="mt-1.5 text-xs leading-snug text-text font-mono break-all">{display}</p>
                  </div>
                )
              })() : null}

              {lookup.startBlockHash ? (
                <div className="metric-card col-span-2 sm:col-span-2 lg:col-span-4">
                  <div className="flex items-center gap-2">
                    <p className="metric-label">Start Block Hash</p>
                    <CopyButton value={lookup.startBlockHash} label="Copy start block hash" size={12} />
                  </div>
                  <p className="mt-1.5 break-all font-mono text-xs text-text">{lookup.startBlockHash}</p>
                </div>
              ) : null}
            </div>
            )}
          </SkeletonSwap>
        )}
      </section>

      {/* Debug */}
      <section className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-term">
        <button
          type="button"
          onClick={() => setShowDebug(value => !value)}
          className="flex w-full items-center gap-2 bg-surface-high px-4 py-2.5 text-left transition-colors hover:bg-surface-highest"
          aria-expanded={showDebug}
          aria-controls="era-debug-panel"
          aria-label={showDebug ? 'Collapse debug panel' : 'Expand debug panel'}
        >
          <span className="section-label">Debug</span>
          <span className="flex-1" />
          {showDebug ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
        </button>
        {/* grid-rows accordion — stays mounted so it animates closed too,
            unlike the old mount/unmount-on-maxHeight version, which never
            had a close transition and thrashed layout while opening. */}
        <div
          id="era-debug-panel"
          className={`accordion-rows ${showDebug ? 'accordion-rows-open' : ''}`}
          aria-hidden={!showDebug}
        >
          <div className="accordion-rows-inner">
            {/* Padding lives here, one level in from -inner — padding on
                the animated grid item itself would add to its rendered
                height regardless of the track's animated size, so the
                panel would never collapse below ~2 * py. */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 bg-term px-4 py-3 font-mono text-xs sm:grid-cols-2">
              {[
                ['WS state', debug.wsState],
                ['Staking pallet', debug.stakingPallet],
                ['Session pallet', debug.sessionPallet],
                ['Block hex', debug.blockHex],
                ['Block dec', debug.blockDec],
                ['Era hex', debug.eraHex],
                ['Era raw', debug.eraRaw],
                ['Session hex', debug.sessHex],
                ['Session raw', debug.sessRaw],
                ['Last error', debug.lastError],
              ].map(([key, value]) => (
                <div key={key} className="flex flex-col gap-0.5 py-0.5 sm:flex-row sm:justify-between sm:gap-2">
                  <span className="text-muted">{key}</span>
                  <span className="whitespace-normal break-all text-left text-text sm:max-w-[60%] sm:text-right">{value}</span>
                </div>
              ))}
              <div className="col-span-2 mt-1">
                <p className="mb-0.5 text-muted">Era key</p>
                <p className="break-all leading-relaxed text-text">{debug.eraKey}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <TerminalLog logs={logs} sticky />
    </main>
  )
}
