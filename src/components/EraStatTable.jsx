import { useState, useMemo } from 'react'

export default function EraStatTable({ eraStat, missedEras, eraCount, latestEra }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  // Rebuilds a Set, a Map, and the full row array from scratch. Previously ran
  // on every render (e.g. a page-size change) even when eraStat/missedEras/
  // eraCount/latestEra had not changed.
  const rows = useMemo(() => {
    const missedSet = new Set(missedEras ?? [])
    const eraMap = new Map((eraStat ?? []).map(e => [e.era, e]))
    const allEras = latestEra
      ? Array.from({ length: eraCount }, (_, i) => latestEra - i)
      : (eraStat ?? []).map(e => e.era).sort((a, b) => b - a)

    return allEras.map(era => ({
      era,
      data:   eraMap.get(era) ?? null,
      missed: missedSet.has(era),
    }))
  }, [eraStat, missedEras, eraCount, latestEra])

  if (!eraStat || eraStat.length === 0) {
    return <p className="text-xs text-dim py-4 text-center">No era stat data available.</p>
  }

  const pages = Math.ceil(rows.length / pageSize)
  const pageItems = rows.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div>
      <div className="data-toolbar">
        <div className="flex items-center gap-1">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
            className="select-compact"
            aria-label="Rows per page"
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

      {/* Mobile: stacked cards */}
      <div className="space-y-1.5 sm:hidden">
        {pageItems.map(({ era, data, missed }) => missed ? (
          <div key={`miss-${era}`} className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-danger">Era {era}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-danger">No data</span>
            </div>
          </div>
        ) : (
          <div key={`era-${era}`} className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-text">Era {era}</span>
              <span className="font-mono text-[11px] text-text-secondary">RP {data?.rewardPoint?.toLocaleString() ?? '—'}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
              <span>Blocks: <span className="font-mono text-text">{data?.startBlock?.toLocaleString() ?? '—'}–{data?.endBlock?.toLocaleString() ?? '—'}</span></span>
              <span>Produced: <span className="font-mono text-text">{data?.blocksProduced ?? 0}</span></span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block data-table-wrap">
        <table className="data-table min-w-[520px]">
          <caption className="sr-only">Era statistics for the scanned validator</caption>
          <thead>
            <tr className="data-table-head">
              <th scope="col" className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold w-16">Era</th>
              <th scope="col" className="sticky top-0 bg-surface-high text-right px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Start Block</th>
              <th scope="col" className="sticky top-0 bg-surface-high text-right px-3 py-2.5 text-[10px] uppercase text-muted font-bold">End Block</th>
              <th scope="col" className="sticky top-0 bg-surface-high text-right px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Reward Point</th>
              <th scope="col" className="sticky top-0 bg-surface-high text-right px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Blocks Produced</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map(({ era, data, missed }) =>
              missed ? (
                <tr key={`miss-${era}`} className="data-table-row-danger">
                  <td className="px-3 py-2.5 font-mono text-danger font-semibold">{era}</td>
                  <td className="px-3 py-2.5 text-right text-danger" colSpan={4}>
                    <span>— No era stat recorded —</span>
                  </td>
                </tr>
              ) : (
                <tr key={`era-${era}`} className="data-table-row">
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
