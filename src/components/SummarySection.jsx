import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { findConsecutiveGroups, getSeverity } from '../utils/eraAnalysis.js'
import { truncateAddress, validatorExplorerUrl } from '../utils/format.js'

export default function SummarySection({ validators, eraCount }) {
  const [showClean, setShowClean] = useState(false)
  const [gapPage,     setGapPage]     = useState(0)
  const [gapPageSize, setGapPageSize] = useState(10)

  if (!validators.length) return null

  const withGaps   = validators.filter(v => v.missedEras?.length > 0)
  const clean      = validators.filter(v => Array.isArray(v.eraStat) && v.missedEras?.length === 0 && v.eraStat.length > 0)
  const errorCards = validators.filter(v => v.fetchStatus === 'error' || v.fetchStatus === 'failed')

  // Find validators with consecutive misses ≥ 3
  const critical = withGaps
    .map(v => ({ v, groups: findConsecutiveGroups(v.missedEras) }))
    .filter(({ groups }) => groups.length > 0)

  // Gap table pagination
  const gapPages     = Math.max(1, Math.ceil(withGaps.length / gapPageSize))
  const gapPageItems = withGaps.slice(gapPage * gapPageSize, (gapPage + 1) * gapPageSize)
  const safeGapPage  = Math.min(gapPage, gapPages - 1)
  useEffect(() => {
    if (safeGapPage !== gapPage) setGapPage(safeGapPage)
  }, [safeGapPage, gapPage])

  return (
    <section aria-labelledby="summary-heading" className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 border-l-4 border-primary pl-4">
        <h2 id="summary-heading" className="text-lg font-bold font-headline text-text uppercase tracking-tight">Summary</h2>
      </div>

      {/* ── Overview stat chips (bento grid) ────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatChip
          value={validators.length}
          label="Total Scanned"
          colour="text-text"
          icon="travel_explore"
        />
        <StatChip
          value={clean.length}
          label="Clean Record"
          colour="text-success"
          icon="check_circle"
        />
        <StatChip
          value={withGaps.length}
          label="Has Gaps"
          colour={withGaps.length > 0 ? 'text-danger' : 'text-success'}
          icon="warning"
        />
      </div>

      {/* ── Critical alerts ───────────────────────────────────────── */}
      {critical.length > 0 && (
        <div className="space-y-2">
          {critical.map(({ v, groups }) =>
            groups.map((g, gi) => (
              <div
                key={`${v.address}-${gi}`}
                role="alert"
                className="flex gap-3 px-4 py-3 rounded-xl bg-danger/10 animate-fade-in"
              >
                <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-semibold text-danger">Critical: </span>
                  <span className="text-text">
                    Validator{' '}
                    <span className="font-semibold">{v.display || truncateAddress(v.address)}</span>
                    {' '}has missed <span className="font-semibold text-danger">{g.length} consecutive era{g.length > 1 ? 's' : ''}</span>
                    {' '}(eras {g[g.length - 1]}–{g[0]}).
                    Pool operators backing this validator should investigate immediately.
                  </span>
                </div>
                <a
                  href={validatorExplorerUrl(v.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex-shrink-0 btn-icon text-danger"
                  aria-label={`Open ${v.display || 'validator'} on Subscan`}
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Reward gap table ──────────────────────────────────────── */}
      {withGaps.length > 0 ? (
        <div className="bg-surface rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-card flex items-center gap-2">
            <XCircle size={14} className="text-warning" />
            <h3 className="text-sm font-semibold font-headline text-text">Validators with Missing Rewards</h3>
            <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold bg-warning/15 text-warning">
              {withGaps.length}
            </span>
          </div>
          <div className="sm:hidden px-3 py-3 space-y-2">
            {gapPageItems.map(v => {
              const sev      = getSeverity(v.missedEras.length)
              const missed   = v.missedEras.length
              const rewarded = Math.max(0, eraCount - missed)
              return (
                <article key={`m-${v.address}`} className="rounded-lg bg-card p-3">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm text-text truncate">
                      {v.display || truncateAddress(v.address)}
                    </p>
                    <a
                      href={validatorExplorerUrl(v.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-text-secondary hover:text-cyan"
                      aria-label="Open on Subscan"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <p className="text-text-secondary">Checked <span className="text-text">{eraCount}</span></p>
                    <p className="text-text-secondary">Rewarded <span className="text-success">{rewarded}</span></p>
                    <p className="text-text-secondary">Missed <span className="text-danger font-semibold">{missed}</span></p>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="font-mono text-[11px] text-muted truncate">
                      {v.missedEras.slice(0, 8).join(', ')}{v.missedEras.length > 8 ? '…' : ''}
                    </p>
                    <SeverityBadge sev={sev} />
                  </div>
                </article>
              )
            })}
          </div>
          <div className="hidden sm:block scroll-x">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="bg-surface-high text-[10px] uppercase text-muted font-bold">
                  <th className="text-left px-4 py-3">Validator</th>
                  <th className="text-center px-3 py-3">Checked</th>
                  <th className="text-center px-3 py-3">Rewarded</th>
                  <th className="text-center px-3 py-3">Missed</th>
                  <th className="text-left px-3 py-3 hidden sm:table-cell">Missing Eras</th>
                  <th className="text-center px-3 py-3">Severity</th>
                </tr>
              </thead>
              <tbody>
                {gapPageItems.map((v, i) => {
                  const sev      = getSeverity(v.missedEras.length)
                  const missed   = v.missedEras.length
                  const rewarded = Math.max(0, eraCount - missed)
                  return (
                    <tr key={v.address} className="hover:bg-surface-bright transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-text truncate max-w-[140px]">
                            {v.display || truncateAddress(v.address)}
                          </span>
                          <a
                            href={validatorExplorerUrl(v.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-secondary hover:text-cyan flex-shrink-0"
                            aria-label={`Open on Subscan`}
                          >
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary">{eraCount}</td>
                      <td className="px-3 py-3 text-center text-success">{rewarded}</td>
                      <td className="px-3 py-3 text-center text-danger font-semibold">{missed}</td>
                      <td className="px-3 py-3 font-mono text-muted text-[11px] hidden sm:table-cell max-w-[160px] truncate">
                        {v.missedEras.slice(0, 8).join(', ')}
                        {v.missedEras.length > 8 ? '…' : ''}
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
            <div className="flex items-center justify-between px-4 py-2.5 bg-card text-xs text-text-secondary">
              <div className="flex items-center gap-2">
                <span>{withGaps.length} validators</span>
                <select
                  value={gapPageSize}
                  onChange={e => { setGapPageSize(Number(e.target.value)); setGapPage(0) }}
                  className="bg-surface-bright rounded px-1.5 py-0.5 text-xs text-text cursor-pointer"
                  aria-label="Rows per page"
                >
                  {[5, 10, 20].map(s => (
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
        <div className="bg-surface rounded-xl px-5 py-5 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          <p className="text-sm text-text">
            All validators received rewards for every era in the last <span className="font-semibold">{eraCount}</span> eras.
          </p>
        </div>
      )}

      {/* ── Error cards ───────────────────────────────────────────── */}
      {errorCards.length > 0 && (
        <p className="text-xs text-text-secondary flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-warning" />
          {errorCards.length} validator(s) had fetch errors and are excluded from gap analysis.
        </p>
      )}

      {/* ── Clean validators (collapsed) ─────────────────────────── */}
      {clean.length > 0 && (
        <div className="bg-surface rounded-xl overflow-hidden">
          <button
            onClick={() => setShowClean(s => !s)}
            className="w-full flex items-center gap-2 px-5 py-3 hover:bg-card transition-colors text-left"
            aria-expanded={showClean}
          >
            <CheckCircle2 size={14} className="text-success" />
            <span className="text-sm font-semibold text-text">
              Perfect Record ({clean.length} validator{clean.length !== 1 ? 's' : ''})
            </span>
            <span className="ml-auto text-muted">
              {showClean ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          {showClean && (
            <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2 animate-fade-in">
              {clean.map(v => (
                <div key={v.address} className="flex items-center gap-2 text-xs text-text-secondary">
                  <CheckCircle2 size={12} className="text-success flex-shrink-0" />
                  <span className="truncate">{v.display || truncateAddress(v.address)}</span>
                  <a
                    href={validatorExplorerUrl(v.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-text-secondary hover:text-cyan flex-shrink-0"
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

function StatChip({ value, label, colour }) {
  return (
    <div className="bg-card p-6 rounded-xl flex flex-col justify-between group hover:bg-surface-bright transition-colors">
      <span className="text-muted text-[10px] uppercase font-bold tracking-widest">{label}</span>
      <div className="mt-3">
        <div className={`text-3xl sm:text-4xl font-headline font-bold ${colour} leading-none`}>{value}</div>
      </div>
    </div>
  )
}

function SeverityBadge({ sev }) {
  if (sev === 'low')    return <span className="sev-low">Low</span>
  if (sev === 'medium') return <span className="sev-medium">Medium</span>
  if (sev === 'high')   return <span className="sev-high">High</span>
  return null
}
