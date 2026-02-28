import { useState } from 'react'
import { Copy, CheckCircle2, Shield, Clock, ExternalLink } from 'lucide-react'
import { formatENJ, truncateAddress, validatorExplorerUrl } from '../utils/format.js'

/**
 * Paginated table showing the validators nominated by a pool.
 * Columns: #, Address (truncated + copy), Display, Bonded, Status, Explorer link.
 * Bonded column hidden below md breakpoint.
 */
export default function PoolValidatorsTable({ validators }) {
  const [page, setPage]         = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [copied, setCopied]     = useState(null)

  if (!validators || validators.length === 0) {
    return <p className="text-xs text-dim py-4 text-center">No nominated validators found.</p>
  }

  const pages     = Math.ceil(validators.length / pageSize)
  const pageItems = validators.slice(page * pageSize, (page + 1) * pageSize)

  async function copyAddr(addr) {
    try {
      await navigator.clipboard.writeText(addr)
      setCopied(addr)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard access denied */ }
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
            {[5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
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
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="bg-surface border-b border-border">
              <th className="text-left px-3 py-2.5 font-semibold text-dim w-8">#</th>
              <th className="text-left px-3 py-2.5 font-semibold text-dim">Address</th>
              <th className="text-left px-3 py-2.5 font-semibold text-dim">Display Name</th>
              <th className="text-right px-3 py-2.5 font-semibold text-dim hidden md:table-cell">Bonded</th>
              <th className="text-center px-3 py-2.5 font-semibold text-dim">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((v, i) => (
              <tr
                key={v.address || i}
                className="border-b border-border/50 hover:bg-surface/50 transition-colors"
              >
                <td className="px-3 py-2.5 text-muted">{page * pageSize + i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-text-secondary">
                      {truncateAddress(v.address)}
                    </span>
                    <button
                      onClick={() => copyAddr(v.address)}
                      className="btn-icon !min-w-[28px] !min-h-[28px] opacity-50 hover:opacity-100"
                      aria-label={`Copy validator address ${v.address}`}
                    >
                      {copied === v.address
                        ? <CheckCircle2 size={11} className="text-success" />
                        : <Copy size={11} />
                      }
                    </button>
                    <a
                      href={validatorExplorerUrl(v.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-icon !min-w-[28px] !min-h-[28px] opacity-50 hover:opacity-100 text-dim hover:text-cyan"
                      aria-label={`Open ${v.display || 'validator'} on Subscan`}
                    >
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-text-secondary">
                  {v.display || <span className="text-muted italic">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-text hidden md:table-cell">
                  {formatENJ(v.bonded, 2)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {v.isActive
                    ? <span className="badge-active"><Shield size={10} />Active</span>
                    : <span className="badge-waiting"><Clock size={10} />Inactive</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
