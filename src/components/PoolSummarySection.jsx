import { useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { findConsecutiveGroups, getSeverity } from '../utils/eraAnalysis.js'
import { poolExplorerUrl, poolLabel } from '../utils/format.js'

const GAP_PAGE_SIZES = [5, 10, 20]

export default function PoolSummarySection({ pools, eraCount }) {
  const [showClean, setShowClean] = useState(false)
  const [gapPage, setGapPage]     = useState(0)
  const [gapPageSize, setGapPageSize] = useState(10)

  if (!pools.length) return null

  const withGaps   = pools.filter(p => p.missedEras?.length > 0)
  const clean      = pools.filter(p => Array.isArray(p.eraRewards) && p.missedEras?.length === 0 && p.eraRewards.length > 0)
  const errorCards = pools.filter(p => p.fetchStatus === 'error')

  // Find pools with consecutive misses >= 3
  const critical = withGaps
    .map(p => ({ p, groups: findConsecutiveGroups(p.missedEras) }))
    .filter(({ groups }) => groups.length > 0)

  // Gap table pagination
  const gapPages     = Math.max(1, Math.ceil(withGaps.length / gapPageSize))
  const gapPageItems = withGaps.slice(gapPage * gapPageSize, (gapPage + 1) * gapPageSize)
  const safeGapPage  = Math.min(gapPage, gapPages - 1)
  if (safeGapPage !== gapPage) setGapPage(safeGapPage)

  return (
    <section aria-labelledby="pool-summary-heading" className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <h2 id="pool-summary-heading" className="text-base font-semibold text-text">Pool Summary</h2>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* ── Overview stat chips ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <StatChip value={pools.length}  label="Total Pools" colour="text-text"    bg="bg-border/40" />
        <StatChip value={clean.length}  label="All Rewarded" colour="text-success" bg="bg-success/10" />
        <StatChip
          value={withGaps.length}
          label="Has Gaps"
          colour={withGaps.length > 0 ? 'text-warning' : 'text-success'}
          bg={withGaps.length > 0 ? 'bg-warning/10' : 'bg-success/10'}
        />
      </div>

      {/* ── Critical alerts ───────────────────────────────────────── */}
      {critical.length > 0 && (
        <div className="space-y-2">
          {critical.map(({ p, groups }) =>
            groups.map((g, gi) => (
              <div
                key={`${p.poolId}-${gi}`}
                role="alert"
                className="flex gap-3 px-4 py-3 rounded-xl bg-danger/10 border border-danger/30 animate-fade-in"
              >
                <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-semibold text-danger">Critical: </span>
                  <span className="text-text">
                    Pool{' '}
                    <span className="font-semibold">{poolLabel(p)}</span>
                    {' '}has missed <span className="font-semibold text-danger">{g.length} consecutive era{g.length > 1 ? 's' : ''}</span>
                    {' '}(eras {g[g.length - 1]}–{g[0]}).
                    Pool operators should investigate immediately.
                  </span>
                </div>
                <a
                  href={poolExplorerUrl(p.poolId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex-shrink-0 btn-icon !min-w-[32px] !min-h-[32px] text-danger"
                  aria-label={`Open Pool #${p.poolId} on Subscan`}
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Reward gap table (paginated) ──────────────────────────── */}
      {withGaps.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-surface/50 flex items-center gap-2">
            <XCircle size={14} className="text-warning" />
            <h3 className="text-sm font-semibold text-text">Pools with Missing Rewards</h3>
            <span className="ml-auto px-2 py-0.5 rounded-full text-xs bg-warning/20 text-warning font-semibold">
              {withGaps.length}
            </span>
          </div>
          <div className="scroll-x">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-4 py-2.5 font-semibold text-dim">Pool</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-dim">Checked</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-dim">Rewarded</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-dim">Missed</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-dim hidden sm:table-cell">Missing Eras</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-dim">Severity</th>
                </tr>
              </thead>
              <tbody>
                {gapPageItems.map((p, i) => {
                  const sev      = getSeverity(p.missedEras.length)
                  const missed   = p.missedEras.length
                  const rewarded = Math.max(0, eraCount - missed)
                  return (
                    <tr key={p.poolId} className={`border-b border-border/50 ${i % 2 === 0 ? 'bg-surface/20' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-text truncate max-w-[140px]">
                            {poolLabel(p)}
                          </span>
                          <a
                            href={poolExplorerUrl(p.poolId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-dim hover:text-cyan flex-shrink-0"
                            aria-label="Open on Subscan"
                          >
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary">{eraCount}</td>
                      <td className="px-3 py-3 text-center text-success">{rewarded}</td>
                      <td className="px-3 py-3 text-center text-danger font-semibold">{missed}</td>
                      <td className="px-3 py-3 font-mono text-muted text-[11px] hidden sm:table-cell max-w-[160px] truncate">
                        {p.missedEras.slice(0, 8).join(', ')}
                        {p.missedEras.length > 8 ? '…' : ''}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <SeverityBadge sev={sev} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Gap table pagination */}
          {gapPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-dim">
              <div className="flex items-center gap-2">
                <span>{withGaps.length} pools</span>
                <select
                  value={gapPageSize}
                  onChange={e => { setGapPageSize(Number(e.target.value)); setGapPage(0) }}
                  className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-text cursor-pointer"
                  aria-label="Rows per page"
                >
                  {GAP_PAGE_SIZES.map(s => (
                    <option key={s} value={s}>{s} / page</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setGapPage(p => Math.max(0, p - 1))}
                  disabled={gapPage === 0}
                  className="btn-ghost disabled:opacity-30"
                  aria-label="Previous page"
                >‹ Prev</button>
                <span className="px-2">{gapPage + 1} / {gapPages}</span>
                <button
                  onClick={() => setGapPage(p => Math.min(gapPages - 1, p + 1))}
                  disabled={gapPage >= gapPages - 1}
                  className="btn-ghost disabled:opacity-30"
                  aria-label="Next page"
                >Next ›</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card px-4 py-5 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          <p className="text-sm text-text">
            All pools received rewards for every era in the last <span className="font-semibold">{eraCount}</span> eras. ✨
          </p>
        </div>
      )}

      {/* ── Error cards ───────────────────────────────────────────── */}
      {errorCards.length > 0 && (
        <p className="text-xs text-dim flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-warning" />
          {errorCards.length} pool(s) had fetch errors and are excluded from gap analysis.
        </p>
      )}

      {/* ── Clean pools (collapsed) ──────────────────────────────── */}
      {clean.length > 0 && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowClean(s => !s)}
            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surface/50 transition-colors text-left"
            aria-expanded={showClean}
          >
            <CheckCircle2 size={14} className="text-success" />
            <span className="text-sm font-semibold text-text">
              Perfect Record ({clean.length} pool{clean.length !== 1 ? 's' : ''})
            </span>
            <span className="ml-auto text-dim">
              {showClean ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          {showClean && (
            <div className="border-t border-border px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2 animate-fade-in">
              {clean.map(p => (
                <div key={p.poolId} className="flex items-center gap-2 text-xs text-text-secondary">
                  <CheckCircle2 size={12} className="text-success flex-shrink-0" />
                  <span className="truncate">{poolLabel(p)}</span>
                  <a
                    href={poolExplorerUrl(p.poolId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-dim hover:text-cyan flex-shrink-0"
                    aria-label="Open on Subscan"
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function StatChip({ value, label, colour, bg }) {
  return (
    <div className={`${bg} rounded-xl p-3 sm:p-4 text-center`}>
      <div className={`text-2xl sm:text-3xl font-bold ${colour} leading-none`}>{value}</div>
      <div className="text-xs text-dim mt-1">{label}</div>
    </div>
  )
}

function SeverityBadge({ sev }) {
  if (sev === 'low')    return <span className="sev-low">Low</span>
  if (sev === 'medium') return <span className="sev-medium">Medium</span>
  if (sev === 'high')   return <span className="sev-high">High</span>
  return null
}
