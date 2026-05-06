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

function EraEKG({ strokeColor, pulseKey }) {
  return <HeartbeatLine strokeColor={strokeColor} pulseKey={pulseKey} />
}

const ERA_LEN = 14400
const STATUS_CONFIG = {
  [ERA_STATUS.IDLE]: { dot: 'bg-muted', label: 'Idle' },
  [ERA_STATUS.CONNECTING]: { dot: 'bg-warning animate-pulse', label: 'Connecting to live node…' },
  [ERA_STATUS.DISCOVERING]: { dot: 'bg-cyan animate-pulse', label: 'Syncing from archive node…' },
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
      {loading
        ? <div className="skeleton h-9 w-20" aria-hidden="true" />
        : <p className={`metric-value break-all text-3xl ${accent ? 'text-cyan' : 'text-text'}`}>{value}</p>
      }
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
  const [hashCopied, setHashCopied] = useState(false)
  const [pulseKey, setPulseKey] = useState(0)
  const lastSeenBlock = useRef(null)

  const eraEnd = eraStart != null ? eraStart + ERA_LEN - 1 : null
  const remaining = eraEnd != null && block != null ? Math.max(0, eraEnd - block) : null
  const pct = eraStart != null && block != null
    ? Math.min(100, Math.round(Math.max(0, block - eraStart) / ERA_LEN * 100))
    : 0

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
    <main className="relative z-10 mx-auto max-w-[92rem] space-y-6 px-4 py-6 pb-32 sm:px-6 sm:py-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.52fr)_minmax(260px,0.48fr)] xl:items-start">
        <div className="space-y-6">
          <section className="page-hero">
            <div className="relative z-10 space-y-8">
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:items-start">
                <div className="space-y-5">
                  <div className="hero-kicker">
                    <span className={`h-2 w-2 rounded-full ${statusCfg.dot}`} />
                    <span>{statusCfg.label}</span>
                  </div>
                  <div className="space-y-4">
                    <h1 className="hero-title text-balance">Relaychain State</h1>
                    <p className="hero-copy">
                      Live relaychain heartbeat, current era telemetry, and archival lookup for any completed era from the same explorer surface.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_320px]">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <StatCard label="Active Era" value={fmt(era)} accent loading={era == null} />
                  <StatCard label="Session" value={fmt(session)} loading={session == null} />
                  <StatCard label="Current Block" value={fmt(block)} accent loading={block == null} />
                  <StatCard label="Era Starts" value={eraStartLabel} loading={eraStart == null} />
                  <StatCard label="Era Ends" value={eraEndLabel} loading={eraEnd == null} />
                  <StatCard label="Blocks Left" value={fmt(remaining)} loading={remaining == null} />
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

                  <div
                    className="rounded-[1.25rem] border-l-[3px] border-l-primary bg-card/90 p-5 shadow-ambient"
                    style={{
                      borderTop: '1px solid rgba(70,71,82,0.08)',
                      borderRight: '1px solid rgba(70,71,82,0.08)',
                      borderBottom: '1px solid rgba(70,71,82,0.08)',
                    }}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="metric-label">Era Progress</p>
                        <p className="mt-2 text-sm text-text-secondary">Completion within the active era window</p>
                      </div>
                      <span className="font-mono text-2xl font-bold text-primary">{pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface">
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

          <div className="overflow-hidden rounded-[1.5rem] border border-border/40 bg-term">
            <button
              type="button"
              onClick={() => setShowDebug(value => !value)}
              className="flex w-full items-center gap-2 bg-surface-high px-4 py-3 text-left transition-colors hover:bg-surface-highest"
              aria-expanded={showDebug}
              aria-label={showDebug ? 'Collapse debug panel' : 'Expand debug panel'}
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Debug</span>
              <span className="flex-1" />
              {showDebug ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
            </button>
            {showDebug ? (
              <div className="grid grid-cols-1 gap-x-8 gap-y-1 bg-term px-4 py-3 font-mono text-xs animate-slide-down sm:grid-cols-2">
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
            ) : null}
          </div>
        </div>

        <div className="data-panel space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <h2 className="font-headline text-2xl font-bold text-text">Past Era Lookup</h2>
              {csvCount > 0 ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" style={{ boxShadow: '0 0 6px rgba(142,255,113,0.7)' }} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-success">{csvCount} Eras Cached</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-card px-3 py-1">
                  <span className="skeleton h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                  <span className="skeleton h-3 w-24 rounded-full" aria-hidden="true" />
                </div>
              )}
            </div>

            <div
              className="inline-flex items-center rounded-full border border-white/10 bg-card p-1"
              role="group"
              aria-label="Timezone selector"
            >
              <button
                type="button"
                onClick={() => setLocalTime(false)}
                className={`inline-flex min-h-[1.9rem] items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                  !localTime
                    ? 'bg-primary/20 text-primary'
                    : 'text-text-secondary hover:text-text'
                }`}
                aria-pressed={!localTime}
              >
                <Clock size={11} />
                UTC
              </button>
              <button
                type="button"
                onClick={() => setLocalTime(true)}
                className={`inline-flex min-h-[1.9rem] items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                  localTime
                    ? 'bg-cyan/20 text-cyan'
                    : 'text-text-secondary hover:text-text'
                }`}
                aria-pressed={localTime}
              >
                <Globe size={11} />
                Local
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
                onChange={event => { setEraInput(event.target.value); resetLookup() }}
                placeholder="Era number"
                className={`w-40 input-field font-mono ${eraInputErr ? 'ring-1 ring-danger' : ''}`}
                aria-label="Era number to look up"
              />
              <button
                type="submit"
                className="btn-primary gap-1.5 px-5 py-3 text-sm"
                disabled={lookupLoading || !eraInput || !!eraInputErr}
                aria-label="Look up era"
              >
                {lookupLoading ? <span className="animate-pulse">Searching…</span> : <><Search size={14} />Look Up</>}
              </button>
            </div>
            {eraInputErr ? (
              <p className="flex items-center gap-1 text-xs text-danger">
                <AlertTriangle size={11} className="flex-shrink-0" />
                {eraInputErr}
              </p>
            ) : null}
          </form>

          {lookupError ? (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {lookupError}
            </p>
          ) : null}

          {lookup ? (
            <div className="grid animate-fade-in grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="metric-card text-center">
                <p className="metric-label">Start Block</p>
                <p className="mt-3 text-base font-mono text-text">{lookup.startBlock.toLocaleString()}</p>
              </div>
              <div className="metric-card text-center">
                <p className="metric-label">End Block</p>
                <p className="mt-3 text-base font-mono text-text">{lookup.endBlock.toLocaleString()}</p>
              </div>

              {lookup.startDateUtc ? (() => {
                const raw = lookup.startDateUtc
                const display = localTime ? (fmtDateLocal(raw) ?? raw) : (fmtDateUtc(raw) ?? raw)
                return (
                  <div className="metric-card">
                    <div className="mb-1 flex items-center gap-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Start</p>
                      <span className="text-[9px] uppercase text-muted">({localTime ? 'Local' : 'UTC'})</span>
                    </div>
                    <p className="text-xs leading-snug text-text font-mono">{display}</p>
                  </div>
                )
              })() : null}

              {lookup.endDateUtc ? (() => {
                const raw = lookup.endDateUtc
                const display = localTime ? (fmtDateLocal(raw) ?? raw) : (fmtDateUtc(raw) ?? raw)
                return (
                  <div className="metric-card">
                    <div className="mb-1 flex items-center gap-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">End</p>
                      <span className="text-[9px] uppercase text-muted">({localTime ? 'Local' : 'UTC'})</span>
                    </div>
                    <p className="text-xs leading-snug text-text font-mono">{display}</p>
                  </div>
                )
              })() : null}

              {lookup.startBlockHash ? (
                <div className="metric-card">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Start Block Hash</p>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(lookup.startBlockHash)
                          setHashCopied(true)
                          setTimeout(() => setHashCopied(false), 2000)
                        } catch {
                          // Clipboard access denied.
                        }
                      }}
                      className="btn-icon"
                      aria-label="Copy start block hash"
                    >
                      {hashCopied ? <CheckCircle2 size={12} className="text-success" /> : <Copy size={12} />}
                    </button>
                  </div>
                  <p className="break-all font-mono text-xs text-text">{lookup.startBlockHash}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <TerminalLog logs={logs} sticky />
    </main>
  )
}
