import { useState } from 'react'
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { formatENJ, truncateAddress } from '../utils/format.js'

/**
 * Paginated table showing per-era reward status for a nomination pool.
 * Merges received rewards with expected eras to highlight missed eras.
 * Shows which nominated validators sent rewards per era and which did not.
 */
export default function PoolRewardTable({
  eraRewards, missedEras, eraCount, latestEra,
  eraValidatorBreakdown,
}) {
  const [page, setPage]         = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [expandedEra, setExpandedEra] = useState(null)

  if (!latestEra || !eraCount) {
    return <p className="text-xs text-dim py-4 text-center">No reward data available.</p>
  }

  const missedSet = new Set(missedEras ?? [])

  // Build a lookup from era → reward record
  const rewardMap = new Map()
  if (Array.isArray(eraRewards)) {
    for (const r of eraRewards) {
      const era = parseInt(String(r.era), 10)
      if (Number.isFinite(era)) rewardMap.set(era, r)
    }
  }

  // Build merged rows: all expected eras (descending), with reward data or gap marker
  const allEras = Array.from({ length: eraCount }, (_, i) => latestEra - i)
  const rows = allEras.map(era => ({
    era,
    reward: rewardMap.get(era) ?? null,
    missed: missedSet.has(era),
  }))

  const pages     = Math.ceil(rows.length / pageSize)
  const pageItems = rows.slice(page * pageSize, (page + 1) * pageSize)

  const hasBreakdown = eraValidatorBreakdown instanceof Map

  function toggleEra(era) {
    setExpandedEra(prev => prev === era ? null : era)
  }

  return (
    <div>
      {/* Pagination controls */}
      <div className="flex items-center justify-between mb-2 text-xs text-dim">
        <div className="flex items-center gap-1">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
            className="text-xs bg-surface border border-border rounded px-2 py-1"
          >
            {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-ghost disabled:opacity-30"
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span className="px-2">{page + 1} / {pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="btn-ghost disabled:opacity-30"
              aria-label="Next page"
            >
              Next ›
            </button>
          </div>
        )}
      </div>

      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full text-xs min-w-[400px]">
          <thead>
            <tr className="bg-surface border-b border-border">
              <th className="text-left px-3 py-2.5 font-semibold text-dim w-16">Era</th>
              <th className="text-right px-3 py-2.5 font-semibold text-dim">Reward</th>
              <th className="text-center px-3 py-2.5 font-semibold text-dim hidden md:table-cell w-20">Rewarded</th>
              <th className="text-center px-3 py-2.5 font-semibold text-dim hidden md:table-cell w-20">No Reward</th>
              <th className="text-center px-3 py-2.5 font-semibold text-dim w-20">Status</th>
              {hasBreakdown && (
                <th className="text-center px-2 py-2.5 font-semibold text-dim w-8" aria-label="Expand" />
              )}
            </tr>
          </thead>
          <tbody>
            {pageItems.map(({ era, reward, missed }) => {
              const bd = hasBreakdown ? eraValidatorBreakdown.get(era) : null
              const isExpanded = expandedEra === era
              return missed ? (
                <MissedRow
                  key={`miss-${era}`}
                  era={era}
                  bd={bd}
                  hasBreakdown={hasBreakdown}
                  isExpanded={isExpanded}
                  onToggle={() => toggleEra(era)}
                />
              ) : (
                <RewardedRow
                  key={`era-${era}`}
                  era={era}
                  reward={reward}
                  bd={bd}
                  hasBreakdown={hasBreakdown}
                  isExpanded={isExpanded}
                  onToggle={() => toggleEra(era)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Rewarded era row with optional validator breakdown expansion. */
function RewardedRow({ era, reward, bd, hasBreakdown, isExpanded, onToggle }) {
  const rewardedCount = bd?.rewarded?.length ?? 0
  // Exclude inactive validators from "no reward" count
  const activeUnrewarded = bd?.unrewarded?.filter(v => v.isActive) ?? []
  const noRewardCount = activeUnrewarded.length

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-surface/50 transition-colors">
        <td className="px-3 py-2.5 font-mono text-text-secondary">{era}</td>
        <td className="px-3 py-2.5 text-right font-mono text-text">
          {reward ? formatENJ(BigInt(String(reward.amount ?? '0').replace(/[^0-9]/g, '') || '0'), 4) : '—'}
        </td>
        <td className="px-3 py-2.5 text-center hidden md:table-cell">
          <span className="font-mono text-xs text-success">{rewardedCount}</span>
        </td>
        <td className="px-3 py-2.5 text-center hidden md:table-cell">
          {noRewardCount > 0
            ? <span className="font-mono text-xs text-warning">{noRewardCount}</span>
            : <span className="font-mono text-xs text-dim">0</span>
          }
        </td>
        <td className="px-3 py-2.5 text-center">
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 size={12} />
            <span className="text-[11px] font-semibold">Rewarded</span>
          </span>
        </td>
        {hasBreakdown && (
          <td className="px-2 py-2.5 text-center">
            <button
              onClick={onToggle}
              className="btn-icon !min-w-[24px] !min-h-[24px]"
              aria-label={isExpanded ? 'Collapse validator detail' : 'Expand validator detail'}
            >
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </td>
        )}
      </tr>
      {isExpanded && bd && (
        <BreakdownDetail era={era} bd={bd} colSpan={hasBreakdown ? 6 : 5} />
      )}
    </>
  )
}

/** Missed era row with optional expansion showing all unrewarded validators. */
function MissedRow({ era, bd, hasBreakdown, isExpanded, onToggle }) {
  // Exclude inactive validators from "no reward" count
  const activeUnrewarded = bd?.unrewarded?.filter(v => v.isActive) ?? []
  const noRewardCount = activeUnrewarded.length

  return (
    <>
      <tr className="bg-danger/5 border-b border-danger/20">
        <td className="px-3 py-2.5 font-mono text-danger font-semibold">{era}</td>
        <td className="px-3 py-2.5 text-right text-danger">—</td>
        <td className="px-3 py-2.5 text-center hidden md:table-cell">
          <span className="font-mono text-xs text-dim">0</span>
        </td>
        <td className="px-3 py-2.5 text-center hidden md:table-cell">
          {noRewardCount > 0
            ? <span className="font-mono text-xs text-danger">{noRewardCount}</span>
            : <span className="font-mono text-xs text-dim">0</span>
          }
        </td>
        <td className="px-3 py-2.5 text-center">
          <span className="inline-flex items-center gap-1 text-danger">
            <XCircle size={12} />
            <span className="text-[11px] font-semibold">No Reward</span>
          </span>
        </td>
        {hasBreakdown && (
          <td className="px-2 py-2.5 text-center">
            <button
              onClick={onToggle}
              className="btn-icon !min-w-[24px] !min-h-[24px]"
              aria-label={isExpanded ? 'Collapse validator detail' : 'Expand validator detail'}
            >
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </td>
        )}
      </tr>
      {isExpanded && bd && (
        <BreakdownDetail era={era} bd={bd} colSpan={hasBreakdown ? 6 : 5} />
      )}
    </>
  )
}

/** Inline detail rows showing rewarded / unrewarded / inactive validators for an era. */
function BreakdownDetail({ era, bd, colSpan }) {
  const activeUnrewarded  = bd.unrewarded.filter(v => v.isActive)
  const inactiveUnrewarded = bd.unrewarded.filter(v => !v.isActive)

  return (
    <tr className="bg-surface/30">
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {/* Rewarded validators */}
          {bd.rewarded.length > 0 && (
            <div>
              <p className="text-success font-semibold mb-1 flex items-center gap-1">
                <CheckCircle2 size={11} /> Rewarded ({bd.rewarded.length})
              </p>
              <ul className="space-y-0.5 ml-4">
                {bd.rewarded.map(v => (
                  <li key={`${era}-r-${v.address}`} className="text-text-secondary font-mono text-[11px] truncate">
                    {v.display || truncateAddress(v.address)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Active unrewarded validators */}
          {activeUnrewarded.length > 0 && (
            <div>
              <p className="text-warning font-semibold mb-1 flex items-center gap-1">
                <XCircle size={11} /> No Reward ({activeUnrewarded.length})
              </p>
              <ul className="space-y-0.5 ml-4">
                {activeUnrewarded.map(v => (
                  <li key={`${era}-u-${v.address}`} className="text-text-secondary font-mono text-[11px] truncate">
                    {v.display || truncateAddress(v.address)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Inactive validators */}
          {inactiveUnrewarded.length > 0 && (
            <div>
              <p className="text-dim font-semibold mb-1 flex items-center gap-1">
                <XCircle size={11} /> Inactive ({inactiveUnrewarded.length})
              </p>
              <ul className="space-y-0.5 ml-4">
                {inactiveUnrewarded.map(v => (
                  <li key={`${era}-i-${v.address}`} className="text-muted font-mono text-[11px] truncate">
                    {v.display || truncateAddress(v.address)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
