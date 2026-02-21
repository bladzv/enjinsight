import { useState } from 'react'

export default function EraStatTable({ eraStat, missedEras, eraCount, latestEra }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  if (!eraStat || eraStat.length === 0) {
    return <p className="text-xs text-dim py-4 text-center">No era stat data available.</p>
  }

  const missedSet = new Set(missedEras ?? [])

  // Build the merged display list: received eras + gap rows, sorted descending
  const eraMap = new Map(eraStat.map(e => [e.era, e]))
  const allEras = latestEra
    ? Array.from({ length: eraCount }, (_, i) => latestEra - i)
    : eraStat.map(e => e.era).sort((a, b) => b - a)

  const rows = allEras.map(era => ({
    era,
    data:   eraMap.get(era) ?? null,
    missed: missedSet.has(era),
  }))

  const pages = Math.ceil(rows.length / pageSize)
  const pageItems = rows.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div>
      {/* pagination controls */}
      <div className="flex items-center justify-between mb-2 text-xs text-dim">
        <div className="flex items-center gap-1">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
            className="text-xs bg-surface border border-border rounded px-2 py-1"
          >
            {[5,10,20,50].map(n => <option key={n} value={n}>{n}</option>)}
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
      <table className="w-full text-xs min-w-[520px]">
        <thead>
          <tr className="bg-surface border-b border-border">
            <th className="text-left px-3 py-2.5 font-semibold text-dim w-16">Era</th>
            <th className="text-right px-3 py-2.5 font-semibold text-dim">Start Block</th>
            <th className="text-right px-3 py-2.5 font-semibold text-dim">End Block</th>
            <th className="text-right px-3 py-2.5 font-semibold text-dim">Reward Point</th>
            <th className="text-right px-3 py-2.5 font-semibold text-dim">Blocks Produced</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map(({ era, data, missed }) =>
            missed ? (
              // Gap row
              <tr key={`miss-${era}`} className="bg-danger/5 border-b border-danger/20">
                <td className="px-3 py-2.5 font-mono text-danger font-semibold">{era}</td>
                <td className="px-3 py-2.5 text-right text-danger" colSpan={4}>
                  <span className="hidden md:inline">— No era stat recorded —</span>
                  <span className="inline md:hidden">No data</span>
                </td>
              </tr>
            ) : (
              // Normal row
              <tr key={`era-${era}`} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                <td className="px-3 py-2.5 font-mono text-text-secondary">{era}</td>
                <td className="px-3 py-2.5 font-mono text-text-secondary text-right">
                  {data?.startBlock?.toLocaleString() ?? '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-text-secondary text-right">
                  {data?.endBlock?.toLocaleString() ?? '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-text-secondary text-right">
                  {data?.rewardPoint?.toLocaleString() ?? '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-text-secondary text-right">
                  {data?.blocksProduced ?? 0}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
