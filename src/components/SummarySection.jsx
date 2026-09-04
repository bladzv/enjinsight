import { useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { ValidatorDetailsModal } from './ValidatorCard.jsx'
import Skeleton from './Skeleton.jsx'
import { findConsecutiveGroups, getSeverity } from '../utils/eraAnalysis.js'
import { truncateAddress, validatorExplorerUrl } from '../utils/format.js'
import { useCountUp } from '../hooks/useCountUp.js'

export default function SummarySection({ validators, eraCount, latestEra, onRetry, provisional = false, progressLabel }) {
  const [showClean, setShowClean] = useState(false)
  const [gapPage,     setGapPage]     = useState(0)
  const [gapPageSize, setGapPageSize] = useState(10)
  const [selectedValidator, setSelectedValidator] = useState(null)

  // Before the first validator has resolved there is nothing to summarize yet,
  // but the scan is running — show the steady-state shape rather than nothing,
  // so the section doesn't pop into existence once data lands.
  if (!validators.length) {
    if (!provisional) return null
    return (
      <section aria-labelledby="summary-heading" className="space-y-3 animate-fade-in sm:space-y-4" aria-busy="true">
        <div>
          <p className="section-label">Summary</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="summary-heading" className="font-headline text-lg font-bold text-text sm:text-xl">Validator Overview</h2>
            <span className="mini-chip text-warning">{progressLabel ? `${progressLabel} · provisional` : 'Provisional'}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatChipSkeleton label="Total Scanned" />
          <StatChipSkeleton label="Clean Record" />
          <StatChipSkeleton label="Has Gaps" />
        </div>
      </section>
    )
  }

  const withGaps   = validators.filter(v => v.missedEras?.length > 0)
  const clean      = validators.filter(v => Array.isArray(v.eraStat) && v.missedEras?.length === 0 && v.eraStat.length > 0)
  const errorCards = validators.filter(v => v.fetchStatus === 'error' || v.fetchStatus === 'failed')

  // Find validators with consecutive misses ≥ 3
  const critical = withGaps
    .map(v => ({ v, groups: findConsecutiveGroups(v.missedEras) }))
    .filter(({ groups }) => groups.length > 0)

  // Gap table pagination. Clamp on read (safeGapPage), not via a sync-back
  // effect — the previous version sliced/displayed with the *raw* gapPage,
  // so if withGaps shrank (e.g. a re-scan) after gapPage had advanced past
  // its new range, gapPageItems briefly rendered empty and the counter showed
  // an out-of-range page until the effect caught up a render later. Genuinely
  // fixing that also resolves a real Rules of Hooks bug: this component
  // returns early above when validators is empty, so that effect was being
  // called conditionally across renders.
  const gapPages     = Math.max(1, Math.ceil(withGaps.length / gapPageSize))
  const safeGapPage  = Math.min(gapPage, gapPages - 1)
  const gapPageItems = withGaps.slice(safeGapPage * gapPageSize, (safeGapPage + 1) * gapPageSize)

  function openValidator(validator) {
    setSelectedValidator(validator)
  }

  function handleOpenKey(event, validator) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openValidator(validator)
    }
  }

  return (
    <section aria-labelledby="summary-heading" className="space-y-3 animate-fade-in sm:space-y-4">
      <div>
        <p className="section-label">Summary</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="summary-heading" className="font-headline text-lg font-bold text-text sm:text-xl">Validator Overview</h2>
          {provisional && (
            /* These figures are aggregates over whatever has loaded so far, so
               they climb as the scan proceeds. Said plainly rather than left
               for the reader to infer from numbers that keep moving. */
            <span className="mini-chip text-warning">
              {progressLabel ? `${progressLabel} · provisional` : 'Provisional'}
            </span>
          )}
        </div>
      </div>

      {/* ── Overview stat chips (bento grid) ────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
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
                role="button"
                tabIndex={0}
                onClick={() => openValidator(v)}
                onKeyDown={event => handleOpenKey(event, v)}
                className="flex cursor-pointer gap-3 px-4 py-3 rounded-sm bg-danger/10 animate-fade-in transition-colors hover:bg-danger/15 focus:outline-none focus:ring-2 focus:ring-danger/40"
                aria-label={`Open details for validator ${v.display || truncateAddress(v.address)}`}
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
                  onClick={event => event.stopPropagation()}
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
        <div className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-surface">
          <div className="flex items-center gap-2 border-b border-[var(--hairline)] bg-card px-3 py-2.5 sm:px-4">
            <XCircle size={14} className="text-warning" />
            <h3 className="font-headline text-sm font-bold text-text">Validators with Missing Rewards</h3>
            <span className="ml-auto rounded-sm bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">
              {withGaps.length}
            </span>
          </div>
          <div className="space-y-1.5 px-2 py-2 sm:hidden">
            {gapPageItems.map(v => {
              const sev      = getSeverity(v.missedEras.length)
              const missed   = v.missedEras.length
              const rewarded = Math.max(0, eraCount - missed)
              return (
                <div
                  key={`m-${v.address}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openValidator(v)}
                  onKeyDown={event => handleOpenKey(event, v)}
                  className="cursor-pointer rounded-sm border border-[var(--hairline)] bg-card p-2.5 transition-colors hover:bg-surface-high focus:outline-none focus:ring-1 focus:ring-primary"
                  aria-label={`Open details for validator ${v.display || truncateAddress(v.address)}`}
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm text-text break-words">
                      {v.display || truncateAddress(v.address)}
                    </p>
                    <a
                      href={validatorExplorerUrl(v.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-text-secondary hover:text-cyan"
                      aria-label="Open on Subscan"
                      onClick={event => event.stopPropagation()}
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
                    <p className="font-mono text-[11px] text-muted break-all">
                      {v.missedEras.slice(0, 8).join(', ')}{v.missedEras.length > 8 ? '…' : ''}
                    </p>
                    <SeverityBadge sev={sev} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden sm:block data-table-wrap">
            <table className="data-table min-w-[520px]">
              <caption className="sr-only">Validators with missing rewards</caption>
              <thead>
                <tr className="data-table-head">
                  <th scope="col" className="text-left px-4 py-3">Validator</th>
                  <th scope="col" className="text-center px-3 py-3">Checked</th>
                  <th scope="col" className="text-center px-3 py-3">Rewarded</th>
                  <th scope="col" className="text-center px-3 py-3">Missed</th>
                  <th scope="col" className="text-left px-3 py-3 hidden sm:table-cell">Missing Eras</th>
                  <th scope="col" className="text-center px-3 py-3">Severity</th>
                </tr>
              </thead>
              <tbody>
                {gapPageItems.map((v) => {
                  const sev      = getSeverity(v.missedEras.length)
                  const missed   = v.missedEras.length
                  const rewarded = Math.max(0, eraCount - missed)
                  return (
                    <tr
                      key={v.address}
                      role="button"
                      tabIndex={0}
                      onClick={() => openValidator(v)}
                      onKeyDown={event => handleOpenKey(event, v)}
                      className="data-table-row cursor-pointer hover:bg-card/80 focus:outline-none focus:ring-2 focus:ring-cyan/35"
                      aria-label={`Open details for validator ${v.display || truncateAddress(v.address)}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="max-w-[220px] whitespace-normal break-words font-medium text-text">
                            {v.display || truncateAddress(v.address)}
                          </span>
                          <a
                            href={validatorExplorerUrl(v.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-secondary hover:text-cyan flex-shrink-0"
                            aria-label={`Open on Subscan`}
                            onClick={event => event.stopPropagation()}
                          >
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary">{eraCount}</td>
                      <td className="px-3 py-3 text-center text-success">{rewarded}</td>
                      <td className="px-3 py-3 text-center text-danger font-semibold">{missed}</td>
                      <td className="hidden max-w-[220px] whitespace-normal break-all px-3 py-3 font-mono text-[11px] text-muted sm:table-cell">
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
            <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-card px-3 py-2 text-xs text-text-secondary sm:px-4">
              <div className="flex items-center gap-2">
                <span>{withGaps.length} validators</span>
                <select
                  value={gapPageSize}
                  onChange={e => { setGapPageSize(Number(e.target.value)); setGapPage(0) }}
                  className="select-compact"
                  aria-label="Rows per page"
                >
                  {[5, 10, 20].map(s => (
                    <option key={s} value={s}>{s} / page</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setGapPage(Math.max(0, safeGapPage - 1))}
                  disabled={safeGapPage === 0}
                  className="btn-ghost disabled:opacity-30"
                  aria-label="Previous page"
                >‹ Prev</button>
                <span className="px-2">{safeGapPage + 1} / {gapPages}</span>
                <button
                  onClick={() => setGapPage(Math.min(gapPages - 1, safeGapPage + 1))}
                  disabled={safeGapPage >= gapPages - 1}
                  className="btn-ghost disabled:opacity-30"
                  aria-label="Next page"
                >Next ›</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="data-panel flex items-center gap-3" style={{ boxShadow: 'inset 2px 0 0 var(--success)' }}>
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
        <div className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-surface" style={{ boxShadow: 'inset 2px 0 0 var(--success)' }}>
          <button
            onClick={() => setShowClean(s => !s)}
            className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-card sm:px-4 sm:py-4"
            aria-expanded={showClean}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm bg-success/10 text-success">
              <CheckCircle2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="section-label text-success">Validator Review</p>
              <h3 className="mt-1 font-headline text-base font-bold text-text sm:text-lg">Perfect Record</h3>
              <p className="mt-1 text-xs leading-snug text-text-secondary sm:text-sm">
                Received rewards in every era across the current scan window.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mini-chip">{eraCount} era window</span>
                <span className="mini-chip text-success">{clean.length} clean</span>
              </div>
            </div>
            <span className="text-muted" aria-hidden="true">
              {showClean ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>
          {showClean && (
            <div className="grid grid-cols-1 gap-2 border-t border-[var(--hairline)] px-3 py-3 animate-fade-in sm:grid-cols-2 sm:gap-3 sm:px-4 2xl:grid-cols-4">
              {clean.map(v => (
                <div key={v.address} className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-2.5 transition-colors hover:bg-surface-high">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-success/10 text-success">
                      <CheckCircle2 size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-text">{v.display || truncateAddress(v.address)}</p>
                      <p className="mt-0.5 break-all font-mono text-[10px] text-muted">{truncateAddress(v.address)}</p>
                    </div>
                    <a
                      href={validatorExplorerUrl(v.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-icon"
                      aria-label="Open on Subscan"
                      onClick={event => event.stopPropagation()}
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ValidatorDetailsModal
        open={Boolean(selectedValidator)}
        onClose={() => setSelectedValidator(null)}
        validator={selectedValidator}
        eraCount={eraCount}
        latestEra={latestEra}
        onRetry={onRetry}
      />
    </section>
  )
}

function StatChipSkeleton({ label }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <Skeleton.Block width="3rem" height="1.8rem" className="mt-2" />
    </div>
  )
}

function StatChip({ value, label, colour }) {
  // Ticks up as more validators resolve mid-scan rather than jumping straight
  // to the running total. aria-hidden + a stable sr-only sibling so a screen
  // reader gets one final read, never the animated frames.
  const animatedValue = useCountUp(value)
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <div className={`metric-value ${colour}`}>
        <span className="sr-only">{value}</span>
        <span aria-hidden="true">{animatedValue}</span>
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
