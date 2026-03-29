/**
 * EraBlockExplorer — React-native era block explorer.
 *
 * Shows live Enjin Relay era / session / block data via a persistent WebSocket,
 * with an EKG canvas, an era progress bar, and a past-era lookup tool.
 * Network: Enjin Relaychain only.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Search, Globe, Clock, Copy, CheckCircle2 } from 'lucide-react'
import { useEraExplorer, ERA_STATUS } from '../hooks/useEraExplorer.js'
import TerminalLog from './TerminalLog.jsx'

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

// ── EraEKG sub-component ─────────────────────────────────────────────────────
function EraEKG({ strokeColor, pulseKey }) {
  return <HeartbeatLine strokeColor={strokeColor} pulseKey={pulseKey} />
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ERA_LEN = 14400
const STATUS_CONFIG = {
  [ERA_STATUS.IDLE]:        { dot: 'bg-muted',     label: 'Idle' },
  [ERA_STATUS.CONNECTING]:  { dot: 'bg-warning animate-pulse', label: 'Connecting to live node…' },
  [ERA_STATUS.DISCOVERING]: { dot: 'bg-cyan animate-pulse',    label: 'Syncing from archive node…' },
  [ERA_STATUS.LIVE]:        { dot: 'bg-success',  label: 'Live' },
  [ERA_STATUS.DISCONNECTED]:{ dot: 'bg-danger',   label: 'Disconnected — reconnecting…' },
}
function fmt(n) { return n != null ? n.toLocaleString() : '—' }

/** Format a UTC date string into human-readable local time */
function fmtDateLocal(utcStr) {
  if (!utcStr) return null
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) return null
    return d.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short',
    })
  } catch { return null }
}

function fmtDateUtc(utcStr) {
  if (!utcStr) return null
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) return null
    return d.toUTCString().replace(' GMT', ' UTC')
  } catch { return null }
}

/** Format unix timestamp (seconds) to UTC ISO string */
function unixToUtcStr(unix) {
  if (!unix) return null
  return new Date(unix * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function StatCard({ label, value, accent = false, sub = null }) {
  return (
    <div className="metric-card text-left">
      <p className="metric-label">{label}</p>
      <p className={`metric-value text-3xl break-all ${accent ? 'text-cyan' : 'text-text'}`}>{value}</p>
      {sub && <p className="mt-2 truncate font-mono text-[10px] leading-tight text-muted" title={sub}>{sub}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EraBlockExplorer() {
  const {
    status, era, session, block, eraStart, csvCount,
    lookup, lookupLoading, lookupError, logs, debug,
    lookupEra, resetLookup,
  } = useEraExplorer()

  const [eraInput, setEraInput]     = useState('')
  const [showDebug, setShowDebug]   = useState(false)
  const [localTime, setLocalTime]   = useState(false)   // toggle for lookup dates
  const [hashCopied, setHashCopied] = useState(false)
  const [pulseKey, setPulseKey]     = useState(0)
  const lastSeenBlock = useRef(null)

  const eraEnd   = eraStart != null ? eraStart + ERA_LEN - 1 : null
  const remaining = eraEnd != null && block != null ? Math.max(0, eraEnd - block) : null
  const pct = eraStart != null && block != null
    ? Math.min(100, Math.round(Math.max(0, block - eraStart) / ERA_LEN * 100))
    : 0

  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG[ERA_STATUS.IDLE]

  // stroke color for the EKG line depending on status
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
      setPulseKey(k => k + 1)
    }
  }, [block])

  // Derive human-readable start/end labels for active era
  const eraStartLabel = eraStart != null ? eraStart.toLocaleString() : '—'
  const eraEndLabel   = eraEnd   != null ? eraEnd.toLocaleString()   : '—'

  // Real-time validation for era lookup input
  const eraInputNum = eraInput.trim() === '' ? null : parseInt(eraInput.trim(), 10)
  const eraInputErr = eraInput.trim() === '' ? '' :
    (isNaN(eraInputNum) || eraInputNum <= 0) ? 'Era number must be greater than 0.' :
    (era != null && eraInputNum >= era) ? `Era ${eraInputNum} is still active or hasn't ended yet (current: ${era}).` :
    ''

  const onLookup = useCallback(e => {
    e.preventDefault()
    const n = parseInt(eraInput.trim(), 10)
    if (!isNaN(n) && !eraInputErr) lookupEra(n)
  }, [eraInput, eraInputErr, lookupEra])

  return (
    <main className="relative z-10 mx-auto max-w-[92rem] space-y-6 px-4 py-6 pb-32 sm:px-6 sm:py-8">

      <section className="page-hero">
        <div className="relative z-10 space-y-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-4">
              <div className="hero-kicker">
                <div className="inline-flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${statusCfg.dot}`} />
                  <span>{statusCfg.label}</span>
                </div>
              </div>
              <div className="space-y-4">
                    <h1 className="hero-title text-balance">Active Blockchain State</h1>
                <p className="hero-copy">
                  Live relaychain heartbeat, current era telemetry, and archival lookup for any completed era from the same explorer surface.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[360px]">
              <div className="metric-card">
                <p className="metric-label">Relaychain</p>
                <p className="metric-value text-primary">Live</p>
              </div>
              <div className="metric-card">
                <p className="metric-label">Cached Eras</p>
                <p className="metric-value text-cyan">{fmt(csvCount)}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_320px]">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label="Active Era" value={fmt(era)} accent />
              <StatCard label="Session" value={fmt(session)} />
              <StatCard label="Current Block" value={fmt(block)} accent />
              <StatCard label="Era Starts" value={eraStartLabel} />
              <StatCard label="Era Ends" value={eraEndLabel} />
              <StatCard label="Blocks Left" value={fmt(remaining)} />
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-[1.25rem] bg-card/90 p-4 shadow-ambient" style={{ minHeight: '130px' }}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="metric-label">System Heartbeat</p>
                    <p className="mt-2 text-sm text-text-secondary">Block activity monitor</p>
                  </div>
                  <span className="mini-chip">Relaychain</span>
                </div>
                <div className="h-16">
                  <EraEKG pulseKey={pulseKey} strokeColor={strokeColor} />
                </div>
              </div>

              <div className="rounded-[1.25rem] bg-card/90 p-5 shadow-ambient">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="metric-label">Era Progress</p>
                    <p className="mt-2 text-sm text-text-secondary">Target completion within the active era window</p>
                  </div>
                  <span className="font-mono text-lg text-text">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary-dim via-primary to-cyan transition-[width] duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Past Era Lookup ── */}
      <div className="data-panel space-y-4">
        {/* Header: label + CSV count + timezone toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <div>
              <h2 className="font-headline text-2xl font-bold text-text">Past Era Lookup</h2>
            </div>
          {csvCount > 0 && (
            <span className="mini-chip">
              {csvCount} eras cached
            </span>
          )}
              <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLocalTime(v => !v)}
              title={localTime ? 'Showing local timezone — click for UTC' : 'Showing UTC — click for local timezone'}
              className={`enlarge-60 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors
                ${localTime
                  ? 'bg-cyan/10 text-cyan'
                  : 'bg-card text-text-secondary hover:text-text'}`}
              aria-pressed={localTime}
            >
              {localTime ? <Globe size={11} /> : <Clock size={11} />}
              {localTime ? 'Local' : 'UTC'}
            </button>
          </div>
        </div>

        <form onSubmit={onLookup} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="1"
              value={eraInput}
              onChange={e => { setEraInput(e.target.value); resetLookup() }}
              placeholder="Era number"
              className={`w-40 bg-card rounded-2xl px-4 py-3 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary
                ${eraInputErr ? 'ring-1 ring-danger' : ''}`}
              aria-label="Era number to look up"
            />
            <button
              type="submit"
              className="btn-primary gap-1.5 px-5 py-3 text-sm"
              disabled={lookupLoading || !eraInput || !!eraInputErr}
              aria-label="Look up era"
            >
              {lookupLoading
                ? <span className="animate-pulse">Searching…</span>
                : <><Search size={14} />Look Up</>}
            </button>
          </div>
          {eraInputErr && (
            <p className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle size={11} className="flex-shrink-0" />{eraInputErr}
            </p>
          )}
        </form>

        {lookupError && (
          <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">
            {lookupError}
          </p>
        )}

        {lookup && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-in">
            {/* Era number */}
            <div className="metric-card col-span-2 sm:col-span-1 text-center">
              <p className="metric-label">Era</p>
              <p className="metric-value text-2xl text-cyan">{lookup.era}</p>
            </div>
            {/* Start Block */}
            <div className="metric-card text-center">
              <p className="metric-label">Start Block</p>
              <p className="mt-3 text-base font-mono text-text">{lookup.startBlock.toLocaleString()}</p>
            </div>
            {/* End Block */}
            <div className="metric-card text-center">
              <p className="metric-label">End Block</p>
              <p className="mt-3 text-base font-mono text-text">{lookup.endBlock.toLocaleString()}</p>
            </div>
            {/* Source */}
            <div className="metric-card text-center">
              <p className="metric-label">Source</p>
              <p className="mt-3 text-xs text-muted">{lookup.source}</p>
            </div>

            {/* Start date — human-readable */}
            {lookup.startDateUtc && (() => {
              const raw = lookup.startDateUtc
              const display = localTime
                ? (fmtDateLocal(raw) ?? raw)
                : (fmtDateUtc(raw) ?? raw)
              return (
                <div className="metric-card col-span-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[10px] font-bold tracking-widest uppercase text-muted">Start</p>
                    <span className="text-[9px] text-muted uppercase">({localTime ? 'Local' : 'UTC'})</span>
                  </div>
                  <p className="text-xs font-mono text-text leading-snug">{display}</p>
                </div>
              )
            })()}

            {/* End date — human-readable */}
            {lookup.endDateUtc && (() => {
              const raw = lookup.endDateUtc
              const display = localTime
                ? (fmtDateLocal(raw) ?? raw)
                : (fmtDateUtc(raw) ?? raw)
              return (
                <div className="metric-card col-span-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[10px] font-bold tracking-widest uppercase text-muted">End</p>
                    <span className="text-[9px] text-muted uppercase">({localTime ? 'Local' : 'UTC'})</span>
                  </div>
                  <p className="text-xs font-mono text-text leading-snug">{display}</p>
                </div>
              )
            })()}

            {lookup.startBlockHash && (
              <div className="metric-card col-span-2 sm:col-span-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[10px] font-bold tracking-widest uppercase text-muted">Start Block Hash</p>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lookup.startBlockHash)
                        setHashCopied(true)
                        setTimeout(() => setHashCopied(false), 2000)
                      } catch {}
                    }}
                    className="btn-icon"
                    aria-label="Copy start block hash"
                  >
                    {hashCopied
                      ? <CheckCircle2 size={12} className="text-success" />
                      : <Copy size={12} />}
                  </button>
                </div>
                <p className="text-xs font-mono text-text break-all">{lookup.startBlockHash}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Debug panel ── */}
      <div className="overflow-hidden rounded-[1.5rem] border border-white/6 bg-term">
        <button
          onClick={() => setShowDebug(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-[#05070f] hover:bg-surface-high transition-colors text-left"
          aria-expanded={showDebug}
          aria-label={showDebug ? 'Collapse debug panel' : 'Expand debug panel'}
        >
          <span className="text-text-secondary text-[10px] font-bold uppercase tracking-widest">Debug</span>
          <span className="flex-1" />
          {showDebug ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
        </button>
        {showDebug && (
          <div className="bg-term px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-xs font-mono animate-slide-down">
            {[
              ['WS state',       debug.wsState],
              ['Staking pallet', debug.stakingPallet],
              ['Session pallet', debug.sessionPallet],
              ['Block hex',      debug.blockHex],
              ['Block dec',      debug.blockDec],
              ['Era hex',        debug.eraHex],
              ['Era raw',        debug.eraRaw],
              ['Session hex',    debug.sessHex],
              ['Session raw',    debug.sessRaw],
              ['Last error',     debug.lastError],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 py-0.5">
                <span className="text-muted">{k}</span>
                <span className="text-text truncate max-w-[60%] text-right">{v}</span>
              </div>
            ))}
            <div className="col-span-2 mt-1">
              <p className="text-muted mb-0.5">Era key</p>
              <p className="text-text break-all leading-relaxed">{debug.eraKey}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky activity log ── */}
      <TerminalLog logs={logs} sticky />

    </main>
  )
}
