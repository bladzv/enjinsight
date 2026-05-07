import { useState } from 'react'
import { Copy, CheckCircle2, Shield, Clock, ExternalLink } from 'lucide-react'
import { formatENJ, truncateAddress, validatorExplorerUrl } from '../utils/format.js'

/**
 * Paginated table showing the validators nominated by a pool.
 * Columns: #, Address (truncated + copy), Display, Bonded, Status, Explorer link.
 * Bonded column hidden below md breakpoint.
 */
export default function PoolValidatorsTable({ validators, onRetry }) {
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
      <div className="data-toolbar">
        <div className="flex items-center gap-1">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
            className="select-compact"
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

      <div className="space-y-1.5 sm:hidden">
        {pageItems.map((v, i) => (
          <article key={`m-${v.address || i}`} className="rounded-sm border border-[var(--hairline)] bg-card p-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted">#{page * pageSize + i + 1}</span>
              <span className="break-all font-mono text-[11px] text-text-secondary">{truncateAddress(v.address)}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={() => copyAddr(v.address)}
                  className="btn-icon h-7 w-7"
                  aria-label={`Copy validator address ${v.address}`}
                >
                  {copied === v.address
                    ? <CheckCircle2 size={12} className="text-success" />
                    : <Copy size={12} />
                  }
                </button>
                <a
                  href={validatorExplorerUrl(v.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-icon h-7 w-7"
                  aria-label={`Open ${v.display || 'validator'} on Subscan`}
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="truncate text-[11px] text-text-secondary">{v.display || <span className="text-muted">—</span>}</p>
              {v.isActive
                ? <span className="badge-active"><Shield size={10} />Active</span>
                : <span className="badge-waiting"><Clock size={10} />Inactive</span>
              }
            </div>
            <p className="mt-1 text-[11px] text-text-secondary">
              Bonded <span className="font-mono text-text">{formatENJ(v.bonded, 2)}</span>
            </p>
            {(v.fetchStatus === 'failed' || v.fetchStatus === 'error') && onRetry && (
              <button
                onClick={() => onRetry(v.address)}
                className="btn-secondary mt-2 px-2 py-1 text-[11px]"
                aria-label={`Retry fetch for ${v.address}`}
              >
                Retry
              </button>
            )}
          </article>
        ))}
      </div>
      <div className="hidden sm:block data-table-wrap">
        <table className="data-table min-w-[480px]">
          <thead>
            <tr className="data-table-head">
              <th className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold w-8">#</th>
              <th className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Address</th>
              <th className="sticky top-0 bg-surface-high text-left px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Display Name</th>
              <th className="sticky top-0 bg-surface-high text-right px-3 py-2.5 text-[10px] uppercase text-muted font-bold hidden md:table-cell">Bonded</th>
              <th className="sticky top-0 bg-surface-high text-center px-3 py-2.5 text-[10px] uppercase text-muted font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((v, i) => (
              <tr
                key={v.address || i}
                className="data-table-row"
              >
                <td className="px-3 py-2.5 text-muted">{page * pageSize + i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-text-secondary">
                      {truncateAddress(v.address)}
                    </span>
                    <button
                      onClick={() => copyAddr(v.address)}
                      className="btn-icon"
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
                      className="btn-icon text-dim hover:text-cyan"
                      aria-label={`Open ${v.display || 'validator'} on Subscan`}
                    >
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-text-secondary">
                  <div className="space-y-0.5">
                    <span>{v.display || <span className="text-muted italic">—</span>}</span>
                    <p className="text-[11px] text-text-secondary md:hidden">
                      Bonded: <span className="font-mono text-text">{formatENJ(v.bonded, 2)}</span>
                    </p>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-text hidden md:table-cell">
                  {formatENJ(v.bonded, 2)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="flex items-center gap-2">
                      {v.isActive
                        ? <span className="badge-active"><Shield size={10} />Active</span>
                        : <span className="badge-waiting"><Clock size={10} />Inactive</span>
                      }
                      {v.fetchStatus === 'queued' && (
                        <span className="text-xs px-2 py-0.5 rounded bg-surface-bright text-dim">Queued</span>
                      )}
                      {(v.fetchStatus === 'failed' || v.fetchStatus === 'error') && onRetry && (
                        <button
                          onClick={() => onRetry(v.address)}
                          className="btn-secondary px-3 py-1.5 text-xs"
                          aria-label={`Retry fetch for ${v.address}`}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
