import { useState } from 'react'
import { Copy, CheckCircle2 } from 'lucide-react'
import { formatENJ, truncateAddress } from '../utils/format.js'

export default function NominatorsTable({ nominators, onRetry, validatorAddress, validatorFetchStatus }) {
  const [page, setPage]         = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [copied, setCopied]     = useState(null)

  if (!nominators || nominators.length === 0) {
    return (
      <p className="text-xs text-dim py-4 text-center">No nominators found.</p>
    )
  }

  const pages     = Math.ceil(nominators.length / pageSize)
  const pageItems = nominators.slice(page * pageSize, (page + 1) * pageSize)

  async function copyAddr(addr) {
    try {
      await navigator.clipboard.writeText(addr)
      setCopied(addr)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard access denied */ }
  }

  return (
    <div>
      {(validatorFetchStatus === 'failed' || validatorFetchStatus === 'error') && onRetry && (
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={() => onRetry?.(validatorAddress)}
            className="text-xs bg-yellow-600 text-white px-2 py-1 rounded"
            aria-label={`Retry fetching nominators for ${validatorAddress}`}
          >
            Retry nominators
          </button>
        </div>
      )}
      <div className="sm:hidden space-y-2">
        {pageItems.map((n, i) => (
          <article key={`m-${n.address || i}`} className="rounded-xl bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">#{page * pageSize + i + 1}</span>
              <span className="font-mono text-text-secondary text-xs truncate">{truncateAddress(n.address)}</span>
              <button
                onClick={() => copyAddr(n.address)}
                className="btn-icon"
                aria-label={`Copy address ${n.address}`}
              >
                {copied === n.address
                  ? <CheckCircle2 size={13} className="text-success" />
                  : <Copy size={13} />
                }
              </button>
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              <p>Display: <span className="text-text-secondary">{n.display || '—'}</span></p>
              <p>Bonded: <span className="font-mono text-text">{formatENJ(n.bonded, 2)}</span></p>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden sm:block scroll-x rounded-xl">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="bg-surface-high">
              <th className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold w-8">#</th>
              <th className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Address</th>
              <th className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Display Name</th>
              <th className="sticky top-0 bg-surface-high text-right px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Bonded</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((n, i) => (
              <tr
                key={n.address || i}
                className="hover:bg-surface-bright transition-colors"
              >
                <td className="px-3 py-2.5 text-muted">{page * pageSize + i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-text-secondary">
                      {truncateAddress(n.address)}
                    </span>
                    <button
                      onClick={() => copyAddr(n.address)}
                      className="btn-icon"
                      aria-label={`Copy address ${n.address}`}
                    >
                      {copied === n.address
                        ? <CheckCircle2 size={11} className="text-success" />
                        : <Copy size={11} />
                      }
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-text-secondary">
                  {n.display || <span className="text-muted italic">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-text">
                  {formatENJ(n.bonded, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <span>{nominators.length} nominators</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
              className="bg-card rounded px-1.5 py-0.5 text-xs text-text cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label="Rows per page"
            >
              {[5, 10, 20, 50].map(s => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
          </div>
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
        </div>
      )}
    </div>
  )
}
