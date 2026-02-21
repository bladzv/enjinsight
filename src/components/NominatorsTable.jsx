import { useState } from 'react'
import { Copy, CheckCircle2 } from 'lucide-react'
import { formatENJ, truncateAddress } from '../utils/format.js'

export default function NominatorsTable({ nominators }) {
  const [page, setPage]     = useState(0)
  const [copied, setCopied] = useState(null)
  const PAGE_SIZE = 10

  if (!nominators || nominators.length === 0) {
    return (
      <p className="text-xs text-dim py-4 text-center">No nominators found.</p>
    )
  }

  const pages     = Math.ceil(nominators.length / PAGE_SIZE)
  const pageItems = nominators.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function copyAddr(addr) {
    try {
      await navigator.clipboard.writeText(addr)
      setCopied(addr)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard access denied */ }
  }

  return (
    <div>
      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="bg-surface border-b border-border">
              <th className="text-left px-3 py-2.5 font-semibold text-dim w-8">#</th>
              <th className="text-left px-3 py-2.5 font-semibold text-dim">Address</th>
              <th className="text-left px-3 py-2.5 font-semibold text-dim">Display Name</th>
              <th className="text-right px-3 py-2.5 font-semibold text-dim">Bonded</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((n, i) => (
              <tr
                key={n.address || i}
                className="border-b border-border/50 hover:bg-surface/50 transition-colors"
              >
                <td className="px-3 py-2.5 text-muted">{page * PAGE_SIZE + i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-text-secondary">
                      {truncateAddress(n.address)}
                    </span>
                    <button
                      onClick={() => copyAddr(n.address)}
                      className="btn-icon !min-w-[28px] !min-h-[28px] opacity-50 hover:opacity-100"
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
        <div className="flex items-center justify-between mt-3 text-xs text-dim">
          <span>{nominators.length} nominators</span>
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
