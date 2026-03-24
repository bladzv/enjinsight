/**
 * RewardHistoryViewer — Reward history computation for Enjin staking pools.
 * Mirrors the staking-rewards-rpc.py script in the browser.
 */
import { useState, useCallback } from 'react'
import { TrendingUp, Play, Square, RotateCcw, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { useRewardHistory, RH_STATUS } from '../hooks/useRewardHistory.js'
import TerminalLog from './TerminalLog.jsx'
import { PLANCK_PER_ENJ } from '../constants.js'

const ARCHIVE_DEFAULT = 'wss://archive.relay.blockchain.enjin.io'

// ── Formatting helpers ─────────────────────────────────────────────────────
function fmtEnj(planck) {
  if (planck === 0n) return '0.000000'
  const whole = planck / PLANCK_PER_ENJ
  const frac  = String(planck % PLANCK_PER_ENJ).padStart(18, '0').slice(0, 6)
  return `${whole.toLocaleString()}.${frac}`
}
function fmtApy(apy) {
  if (!Number.isFinite(apy) || apy <= 0) return '—'
  return `${apy.toFixed(2)}%`
}

// ── PoolResultTable ─────────────────────────────────────────────────────────
function PoolResultTable({ rows }) {
  const [open, setOpen] = useState(true)
  if (!rows.length) return null
  const pool        = rows[0]
  const poolTotal   = rows.reduce((s, r) => s + r.reward, 0n)
  const avgApy      = rows.reduce((s, r) => s + r.apy, 0) / rows.length
  const hasDateUtc  = rows.some(r => r.eraStartDateUtc)

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface/80 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
          <TrendingUp size={15} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text">{pool.poolLabel}</p>
          <p className="text-xs text-dim">
            {rows.length} era(s) · Total {fmtEnj(poolTotal)} ENJ · Avg APY {fmtApy(avgApy)}
          </p>
        </div>
        {open ? <ChevronUp size={14} className="text-dim flex-shrink-0" /> : <ChevronDown size={14} className="text-dim flex-shrink-0" />}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border bg-term">
                <th className="px-3 py-2 text-left text-dim font-semibold">Era</th>
                {hasDateUtc && <th className="px-3 py-2 text-left text-dim font-semibold">Date (UTC)</th>}
                <th className="px-3 py-2 text-right text-dim font-semibold">Start Block</th>
                <th className="px-3 py-2 text-right text-dim font-semibold">Member sENJ</th>
                <th className="px-3 py-2 text-right text-dim font-semibold">Reinvested ENJ</th>
                <th className="px-3 py-2 text-right text-dim font-semibold">Reward ENJ</th>
                <th className="px-3 py-2 text-right text-dim font-semibold">Cumulative ENJ</th>
                <th className="px-3 py-2 text-right text-dim font-semibold">APY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.era} className={`border-b border-border/50 ${i % 2 ? 'bg-surface/30' : ''}`}>
                  <td className="px-3 py-2 text-cyan font-bold">{r.era}</td>
                  {hasDateUtc && <td className="px-3 py-2 text-dim">{(r.eraStartDateUtc ?? '').slice(0, 10) || '—'}</td>}
                  <td className="px-3 py-2 text-right text-muted">{r.eraStartBlock?.toLocaleString() ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-text">{fmtEnj(r.memberBalance)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmtEnj(r.reinvested)}</td>
                  <td className="px-3 py-2 text-right text-success font-semibold">{fmtEnj(r.reward)}</td>
                  <td className="px-3 py-2 text-right text-cyan">{fmtEnj(r.accumulated)}</td>
                  <td className="px-3 py-2 text-right text-primary">{fmtApy(r.apy)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-primary/30 bg-term">
                <td colSpan={hasDateUtc ? 5 : 4} className="px-3 py-2 text-right text-dim font-semibold text-xs">
                  Pool total ({rows.length} eras)
                </td>
                <td className="px-3 py-2 text-right text-success font-bold">{fmtEnj(poolTotal)}</td>
                <td className="px-3 py-2 text-right text-cyan font-bold">{fmtEnj(poolTotal)}</td>
                <td className="px-3 py-2 text-right text-primary">{fmtApy(avgApy)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export default function RewardHistoryViewer() {
  const { status, results, logs, progress, csvCount, errorMsg, run, stop, reset } = useRewardHistory()

  const [address,   setAddress]   = useState('')
  const [startEra,  setStartEra]  = useState('')
  const [endEra,    setEndEra]    = useState('')
  const [endpoint,  setEndpoint]  = useState(ARCHIVE_DEFAULT)
  const [addrError, setAddrError] = useState('')
  const [eraError,  setEraError]  = useState('')
  const [showAdv,   setShowAdv]   = useState(false)

  const isLoading = status === RH_STATUS.LOADING
  const isDone    = status === RH_STATUS.DONE
  const isStopped = status === RH_STATUS.STOPPED
  const isError   = status === RH_STATUS.ERROR

  // ── Validation ──────────────────────────────────────────────────────────
  function validate() {
    let ok = true
    if (!address.trim().startsWith('en')) {
      setAddrError('Enjin Relaychain addresses start with "en".')
      ok = false
    } else {
      setAddrError('')
    }
    const s = parseInt(startEra, 10)
    const e = parseInt(endEra, 10)
    if (isNaN(s) || isNaN(e) || s < 1 || e < s) {
      setEraError('Enter valid start and end era numbers (start ≤ end).')
      ok = false
    } else {
      setEraError('')
    }
    return ok
  }

  // ── Handle run ──────────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (!validate()) return
    let ep = ARCHIVE_DEFAULT
    try { if (endpoint.trim()) ep = new URL(endpoint.trim()).href } catch {}
    run({
      address:  address.trim(),
      startEra: parseInt(startEra, 10),
      endEra:   parseInt(endEra, 10),
      endpoint: ep,
    })
  }, [address, startEra, endEra, endpoint, run])

  // ── Export CSV ──────────────────────────────────────────────────────────
  const exportCsv = useCallback(() => {
    if (!results.length) return
    const hasDate = results.some(r => r.eraStartDateUtc)
    const hdr = ['era','pool_id','pool_label','era_start_block',...(hasDate ? ['era_start_date_utc'] : []),'member_senj','pool_supply_senj','reinvested_enj','reward_enj','cumulative_enj','apy_pct'].join(',')
    const rows = results.map(r => [
      r.era, r.poolId, `"${r.poolLabel.replace(/"/g, '""')}"`,
      r.eraStartBlock ?? '',
      ...(hasDate ? [(r.eraStartDateUtc ?? '').slice(0, 10)] : []),
      String(r.memberBalance), String(r.poolSupply), String(r.reinvested),
      String(r.reward), String(r.accumulated),
      r.apy.toFixed(4),
    ].join(','))
    const csv = [hdr, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: `reward-history-${address.slice(0, 10)}.csv` })
    document.body.appendChild(a); a.click()
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 5000)
  }, [results, address])

  // ── Group results by pool for display ───────────────────────────────────
  const byPool = {}
  for (const r of results) {
    if (!byPool[r.poolId]) byPool[r.poolId] = []
    byPool[r.poolId].push(r)
  }
  const grandTotal = results.reduce((s, r) => s + r.reward, 0n)

  // ── Progress state ──────────────────────────────────────────────────────
  const phases      = progress?.phases ?? []
  const activePhase = phases.find(p => p.status === 'in_progress') ?? phases[phases.length - 1]
  const phasePct    = activePhase && activePhase.total > 0
    ? Math.min(100, Math.round(activePhase.completed / activePhase.total * 100))
    : 0

  return (
    <div className="space-y-4">
      {/* ── Input form ── */}
      <div className="card p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-text">Reward History Viewer</h2>
          {csvCount > 0 && (
            <span className="ml-auto text-xs text-muted font-mono">{csvCount} eras in CSV</span>
          )}
        </div>

        <p className="text-xs text-dim leading-relaxed">
          Computes staking rewards per era for pools you are currently staked in,
          using the archive node RPC + Subscan API. Mirrors the <code className="text-primary">staking-rewards-rpc.py</code> script.
        </p>

        {/* Address */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-dim uppercase tracking-widest">Wallet Address</label>
          <input
            type="text"
            value={address}
            onChange={e => { setAddress(e.target.value); setAddrError('') }}
            placeholder="en…"
            disabled={isLoading}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            aria-label="Wallet address"
            maxLength={60}
          />
          {addrError && <p className="text-xs text-danger">{addrError}</p>}
        </div>

        {/* Era range */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-dim uppercase tracking-widest">Start Era</label>
            <input
              type="number" min="1" step="1"
              value={startEra}
              onChange={e => { setStartEra(e.target.value); setEraError('') }}
              placeholder="e.g. 1"
              disabled={isLoading}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              aria-label="Start era"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-dim uppercase tracking-widest">End Era</label>
            <input
              type="number" min="1" step="1"
              value={endEra}
              onChange={e => { setEndEra(e.target.value); setEraError('') }}
              placeholder="e.g. 100"
              disabled={isLoading}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              aria-label="End era"
            />
          </div>
        </div>
        {eraError && <p className="text-xs text-danger">{eraError}</p>}

        {/* Advanced: custom endpoint */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdv(v => !v)}
            className="text-xs text-muted hover:text-dim transition-colors flex items-center gap-1"
          >
            {showAdv ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Advanced options
          </button>
          {showAdv && (
            <div className="mt-2 space-y-1.5">
              <label className="text-xs font-semibold text-dim uppercase tracking-widest">Archive RPC Endpoint</label>
              <input
                type="text"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                disabled={isLoading}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                aria-label="Archive RPC endpoint"
                maxLength={200}
              />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {!isLoading ? (
            <button
              onClick={handleRun}
              className="btn-primary gap-1.5 px-5"
              disabled={!address.trim() || !startEra || !endEra}
            >
              <Play size={14} />
              Compute Rewards
            </button>
          ) : (
            <button onClick={stop} className="btn-danger gap-1.5 px-5">
              <Square size={14} />
              Stop
            </button>
          )}
          {(isDone || isStopped || isError) && (
            <button onClick={reset} className="btn-secondary gap-1.5 px-4">
              <RotateCcw size={14} />
              Reset
            </button>
          )}
          {isDone && results.length > 0 && (
            <button onClick={exportCsv} className="btn-secondary gap-1.5 px-4 ml-auto">
              <Download size={14} />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* ── Progress ── */}
      {isLoading && phases.length > 0 && (
        <section className="card p-4 space-y-3" aria-live="polite">
          <div className="flex items-center justify-between text-xs">
            <p className="text-dim">{activePhase?.label ?? 'Computing…'}</p>
            <p className="font-mono text-text">{activePhase?.completed ?? 0} / {activePhase?.total ?? 0} ({phasePct}%)</p>
          </div>
          <div className="h-1.5 rounded-full bg-surface overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-primary/60 via-primary to-cyan transition-all duration-300"
                 style={{ width: `${phasePct}%` }} />
          </div>
          <div className="space-y-1.5">
            {phases.map((ph, i) => {
              const cls = ph.status === 'completed' ? 'text-success'
                        : ph.status === 'in_progress' ? 'text-cyan'
                        : 'text-dim'
              const lbl = ph.status === 'completed' ? 'Done'
                        : ph.status === 'in_progress' ? 'Running'
                        : 'Pending'
              return (
                <div key={ph.key} className="flex items-center justify-between text-[11px] bg-surface/40 rounded border border-border px-2.5 py-1.5">
                  <span className={`font-medium ${cls}`}>Phase {i}: {ph.label}</span>
                  <span className={`font-semibold ${cls}`}>{lbl}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Error ── */}
      {isError && errorMsg && (
        <div className="card p-4 border-danger/30 bg-danger/5">
          <p className="text-sm text-danger">{errorMsg}</p>
        </div>
      )}

      {/* ── Stopped ── */}
      {isStopped && (
        <div className="card p-4 border-warning/30 bg-warning/5">
          <p className="text-sm text-warning">Computation stopped.</p>
        </div>
      )}

      {/* ── Results ── */}
      {isDone && results.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-dim">No rewards found for the given address and era range.</p>
          <p className="text-xs text-muted mt-2">
            If you have exited your pool(s), rewards from those eras will not appear
            since membership is checked at the current block only.
          </p>
        </div>
      )}

      {isDone && results.length > 0 && (
        <>
          {/* Per-pool tables */}
          {Object.entries(byPool).map(([poolId, rows]) => (
            <PoolResultTable key={poolId} rows={rows} />
          ))}

          {/* Grand summary */}
          {Object.keys(byPool).length > 1 && (
            <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-xs font-bold tracking-widest uppercase text-dim mb-1">Grand Total</p>
                <p className="text-2xl font-bold font-mono text-success">{fmtEnj(grandTotal)} ENJ</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-dim">{results.length} era+pool record(s)</p>
                <p className="text-xs text-muted">{Object.keys(byPool).length} pool(s)</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Terminal log ── */}
      {(isLoading || isDone || isStopped || isError) && logs.length > 0 && (
        <TerminalLog logs={logs} sticky={false} />
      )}
    </div>
  )
}
