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

// ── EKG canvas factory ────────────────────────────────────────────────────────
function createEKGInstance(canvas) {
  const BASELINE_F = 0.60, MAX_AMP_F = 0.42, SCROLL_PPS = 60
  const GLOW_COLOR = '#00D4FF', GLOW_DIM = 'rgba(0,212,255,0.55)'
  const BEAT = [
    0, 0, 0,
    0.06, 0.12, 0.10, 0.06, 0,
    0, -0.12,
    0.55, 1.0, 0.96, 0.60, 0.12,
    -0.28, -0.30, -0.20, -0.08, 0, 0,
    0, 0.12, 0.22, 0.20, 0.14, 0.07, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ]
  const BEAT_PX = 90
  let ctx = canvas.getContext('2d'), W = 0, H = 0
  let pixBuf = [], writeHead = 0, lastTime = 0
  let beatQueue = [], sampleIdx = 0, inBeat = false
  let rafId = null

  function resize() {
    const r = canvas.getBoundingClientRect()
    W = Math.max(1, Math.floor(r.width  * devicePixelRatio))
    H = Math.max(1, Math.floor(r.height * devicePixelRatio))
    canvas.width = W; canvas.height = H
    pixBuf = new Array(W).fill(null).map(() => ({ y: Math.round(H * BASELINE_F), bright: false }))
    writeHead = 0
  }
  function writeSample(amp, bright) {
    const baseY = Math.round(H * BASELINE_F)
    const y = Math.max(2, Math.min(H - 2, baseY - amp * H * MAX_AMP_F))
    pixBuf[writeHead] = { y, bright }; writeHead = (writeHead + 1) % W
  }
  function frame(ts) {
    rafId = requestAnimationFrame(frame)
    if (!ctx || W <= 0 || H <= 0) return
    const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.1) : 0; lastTime = ts
    const newSamples = Math.round(dt * SCROLL_PPS * devicePixelRatio)
    for (let s = 0; s < newSamples; s++) {
      if (!inBeat && beatQueue.length > 0) { beatQueue.shift(); inBeat = true; sampleIdx = 0 }
      if (inBeat) {
        const amp = BEAT[Math.min(Math.floor((sampleIdx / BEAT_PX) * (BEAT.length - 1)), BEAT.length - 1)]
        writeSample(amp, Math.abs(amp) > 0.08); sampleIdx++
        if (sampleIdx >= BEAT_PX) { inBeat = false; sampleIdx = 0 }
      } else { writeSample(0, false) }
    }
    ctx.fillStyle = '#050508'; ctx.fillRect(0, 0, W, H)
    ctx.save(); ctx.strokeStyle = 'rgba(0,212,255,0.07)'; ctx.lineWidth = 0.5 * devicePixelRatio
    for (let i = 1; i < 5; i++) { const gx=Math.round(W*i/5); ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,H); ctx.stroke() }
    const baseY=Math.round(H*BASELINE_F); ctx.beginPath(); ctx.moveTo(0,baseY); ctx.lineTo(W,baseY); ctx.stroke()
    ctx.restore()
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=1.5*devicePixelRatio
    let px=null,py=null
    for(let col=0;col<W;col++){
      const p=pixBuf[(writeHead-W+col+W*4)%W]; if(!p)continue
      if(px!==null){ ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(col,p.y); ctx.strokeStyle=p.bright?GLOW_COLOR:'rgba(0,212,255,0.45)'; ctx.shadowColor=p.bright?GLOW_DIM:'transparent'; ctx.shadowBlur=p.bright?6*devicePixelRatio:0; ctx.stroke() }
      px=col; py=p.y
    }
    ctx.restore()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas); resize(); rafId = requestAnimationFrame(frame)
  return {
    beat(blockNum) { beatQueue.push(blockNum); if (beatQueue.length > 3) beatQueue.shift() },
    destroy() { cancelAnimationFrame(rafId); ro.disconnect() },
  }
}

// ── EraEKG sub-component ─────────────────────────────────────────────────────
function EraEKG({ block }) {
  const canvasRef = useRef(null); const ekgRef = useRef(null)
  useEffect(() => {
    if (!canvasRef.current) return
    const ekg = createEKGInstance(canvasRef.current); ekgRef.current = ekg
    return () => { ekgRef.current?.destroy(); ekgRef.current = null }
  }, [])
  const prevBlock = useRef(null)
  useEffect(() => {
    if (block != null && block !== prevBlock.current) { prevBlock.current = block; ekgRef.current?.beat(block) }
  }, [block])
  return <canvas ref={canvasRef} className="block w-full h-full rounded" aria-label="Block activity monitor" />
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ERA_LEN = 14400
const STATUS_CONFIG = {
  [ERA_STATUS.IDLE]:        { dot: 'bg-dim',     label: 'Idle' },
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
    <div className="card p-3 text-center overflow-hidden">
      <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono leading-tight break-all ${accent ? 'text-cyan' : 'text-text'}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted mt-0.5 font-mono leading-tight truncate" title={sub}>{sub}</p>}
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

  const eraEnd   = eraStart != null ? eraStart + ERA_LEN - 1 : null
  const remaining = eraEnd != null && block != null ? Math.max(0, eraEnd - block) : null
  const pct = eraStart != null && block != null
    ? Math.min(100, Math.round(Math.max(0, block - eraStart) / ERA_LEN * 100))
    : 0

  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG[ERA_STATUS.IDLE]

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
    <main className="px-4 py-5 max-w-4xl mx-auto space-y-4 pb-24">

      {/* ── Status bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusCfg.dot}`} />
        <span className="text-sm text-dim">{statusCfg.label}</span>
        {/* Relaychain badge */}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                         bg-cyan/10 border border-cyan/25 text-[10px] font-semibold
                         tracking-widest uppercase text-cyan ml-1">
          Relaychain
        </span>
      </div>

      {/* ── Stats + EKG ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 grid grid-cols-3 gap-2">
          <StatCard label="Active Era"     value={fmt(era)}           accent />
          <StatCard label="Era Starts"     value={eraStartLabel} />
          <StatCard label="Era Ends"       value={eraEndLabel}  />
          <StatCard label="Session"        value={fmt(session)} />
          <StatCard label="Current Block"  value={fmt(block)}         accent />
          <StatCard label="Blocks Left"    value={fmt(remaining)} />
        </div>
        <div className="sm:w-64 flex flex-col gap-2">
          <div className="card flex-1 p-2 flex flex-col" style={{ minHeight: '80px' }}>
            <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">Block Activity</p>
            <div className="flex-1">
              <EraEKG block={block} />
            </div>
          </div>
          {/* Era progress — same style used across the app */}
          <div className="card p-3 flex flex-col justify-center">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-dim">Era progress</span>
              <span className="font-mono text-text">{pct}%</span>
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

      {/* ── Past Era Lookup ── */}
      <div className="card p-4 space-y-3">
        {/* Header: label + CSV count + timezone toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-text">Past Era Lookup</h2>
          {csvCount > 0 && (
            <span className="text-xs text-muted font-mono bg-surface px-2 py-0.5 rounded-full border border-border">
              {csvCount} eras cached
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLocalTime(v => !v)}
              title={localTime ? 'Showing local timezone — click for UTC' : 'Showing UTC — click for local timezone'}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors
                ${localTime
                  ? 'bg-cyan/10 border-cyan/30 text-cyan'
                  : 'bg-surface border-border text-dim hover:text-text'}`}
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
              className={`w-36 bg-surface border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                ${eraInputErr ? 'border-danger/50' : 'border-border'}`}
              aria-label="Era number to look up"
            />
            <button
              type="submit"
              className="btn-primary gap-1.5 px-4 py-2 text-sm"
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
          <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
            {lookupError}
          </p>
        )}

        {lookup && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-fade-in">
            {/* Era number */}
            <div className="card p-3 text-center col-span-2 sm:col-span-1">
              <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">Era</p>
              <p className="text-lg font-bold font-mono text-cyan">{lookup.era}</p>
            </div>
            {/* Start Block */}
            <div className="card p-3 text-center">
              <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">Start Block</p>
              <p className="text-base font-mono text-text">{lookup.startBlock.toLocaleString()}</p>
            </div>
            {/* End Block */}
            <div className="card p-3 text-center">
              <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">End Block</p>
              <p className="text-base font-mono text-text">{lookup.endBlock.toLocaleString()}</p>
            </div>
            {/* Source */}
            <div className="card p-3 text-center">
              <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">Source</p>
              <p className="text-xs text-muted">{lookup.source}</p>
            </div>

            {/* Start date — human-readable */}
            {lookup.startDateUtc && (() => {
              const raw = lookup.startDateUtc
              const display = localTime
                ? (fmtDateLocal(raw) ?? raw)
                : (fmtDateUtc(raw) ?? raw)
              return (
                <div className="card p-3 col-span-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[10px] font-bold tracking-widest uppercase text-dim">Start</p>
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
                <div className="card p-3 col-span-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[10px] font-bold tracking-widest uppercase text-dim">End</p>
                    <span className="text-[9px] text-muted uppercase">({localTime ? 'Local' : 'UTC'})</span>
                  </div>
                  <p className="text-xs font-mono text-text leading-snug">{display}</p>
                </div>
              )
            })()}

            {lookup.startBlockHash && (
              <div className="card p-3 col-span-2 sm:col-span-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[10px] font-bold tracking-widest uppercase text-dim">Start Block Hash</p>
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
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowDebug(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 bg-term hover:bg-surface/80 transition-colors text-left"
          aria-expanded={showDebug}
          aria-label={showDebug ? 'Collapse debug panel' : 'Expand debug panel'}
        >
          <span className="text-dim text-[11px] font-semibold uppercase tracking-widest">Debug</span>
          <span className="flex-1" />
          {showDebug ? <ChevronUp size={13} className="text-dim" /> : <ChevronDown size={13} className="text-dim" />}
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
              <div key={k} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
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
