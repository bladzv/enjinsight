import { useState } from 'react'
import {
  ChevronDown, ChevronUp, Shield, Clock,
  Users, BarChart3, Copy, ExternalLink,
  CheckCircle2, AlertTriangle, RefreshCw, Loader2,
} from 'lucide-react'
import NominatorsTable from './NominatorsTable.jsx'
import EraStatTable    from './EraStatTable.jsx'
import { formatENJ, truncateAddress, validatorExplorerUrl } from '../utils/format.js'
import { resolveLatestEra } from '../utils/eraAnalysis.js'

export default function ValidatorCard({ validator, eraCount, latestEra, onRetry }) {
  const [open,         setOpen]         = useState(false)
  const [activeTab,    setActiveTab]    = useState('era') // 'era' | 'nom'
  const [copied,       setCopied]       = useState(false)

  const {
    address, display, commission, bondedTotal,
    isActive, nominators, eraStat, missedEras,
    fetchStatus, countNominators,
  } = validator

  const hasMissed   = missedEras?.length > 0
  const loading     = fetchStatus === 'loading'
  const hasError    = fetchStatus === 'error'
  const displayName = display || truncateAddress(address)

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* denied */ }
  }

  return (
    <div
      className={`card overflow-hidden transition-all duration-200
        ${hasMissed ? 'border-l-2 border-l-warning' : ''}
        ${hasError  ? 'border-l-2 border-l-danger'  : ''}
      `}
    >
      {/* ── Collapsed header row ────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} validator ${displayName}`}
        className="flex items-center gap-2 sm:gap-3 px-4 py-3 cursor-pointer
                   hover:bg-surface/40 transition-colors select-none min-h-[56px]"
      >
        {/* Status badge */}
        {loading
          ? <span className="badge-waiting flex-shrink-0"><Clock size={10} />Waiting</span>
          : isActive
            ? <span className="badge-active flex-shrink-0"><Shield size={10} />Active</span>
            : <span className="badge-waiting flex-shrink-0"><Clock size={10} />Waiting</span>
        }

        {/* Name */}
        <div className="flex-1 min-w-0">
          {/* Line 1 — name */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-sm text-text truncate">{displayName}</span>
            {hasMissed && (
              <AlertTriangle size={13} className="text-warning flex-shrink-0" aria-label={`${missedEras.length} missed era(s)`} />
            )}
            {loading && (
              <Loader2 size={12} className="text-dim animate-spin flex-shrink-0" />
            )}
          </div>
          {/* Line 2 — commission + bonded (mobile only wraps here) */}
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-dim">
              Commission: <span className="text-text-secondary">{commission}%</span>
            </span>
            <span className="text-xs text-dim hidden sm:inline">Bonded: <span className="font-mono text-text-secondary">{formatENJ(bondedTotal, 2)}</span></span>
          </div>
        </div>


        {/* Icon actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={copyAddress}
            className="btn-icon !min-w-[36px] !min-h-[36px]"
            aria-label={`Copy address of ${displayName}`}
          >
            {copied ? <CheckCircle2 size={13} className="text-success" /> : <Copy size={13} />}
          </button>
          <a
            href={validatorExplorerUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon !min-w-[36px] !min-h-[36px]"
            aria-label={`Open ${displayName} on Subscan`}
          >
            <ExternalLink size={13} />
          </a>
          {hasError && (
            <button
              onClick={() => onRetry?.(address)}
              className="btn-icon !min-w-[36px] !min-h-[36px]"
              aria-label={`Retry fetching data for ${displayName}`}
            >
              <RefreshCw size={13} className="text-danger" />
            </button>
          )}
        </div>

        {/* Expand toggle */}
        <div className="text-dim flex-shrink-0">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* ── Expanded body ───────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-border animate-fade-in">
          {/* Tab bar */}
          <div className="flex border-b border-border bg-surface/50">
            <TabButton
              active={activeTab === 'era'}
              onClick={() => setActiveTab('era')}
              icon={<BarChart3 size={13} />}
              label="Era Rewards"
              badge={missedEras?.length ? `${missedEras.length} missed` : eraStat?.length ? `${eraStat.length} eras` : null}
              badgeVariant={missedEras?.length ? 'warn' : 'neutral'}
            />
            <TabButton
              active={activeTab === 'nom'}
              onClick={() => setActiveTab('nom')}
              icon={<Users size={13} />}
              label="Nominators"
              badge={nominators ? String(nominators.length) : countNominators ? String(countNominators) : null}
              badgeVariant="neutral"
            />
          </div>

          <div className="p-3 sm:p-4">
            {activeTab === 'era' && (
              <>
                {loading && !eraStat
                  ? <LoadingPlaceholder label="Fetching era stats…" />
                  : hasError && !eraStat
                  ? <ErrorPlaceholder label="Era stat fetch failed." onRetry={() => onRetry?.(address)} />
                  : (
                    <EraStatTable
                      eraStat={eraStat}
                      missedEras={missedEras}
                      eraCount={eraCount}
                      latestEra={latestEra}
                    />
                  )
                }
              </>
            )}

            {activeTab === 'nom' && (
              <>
                {loading && !nominators
                  ? <LoadingPlaceholder label="Fetching nominators…" />
                  : hasError && !nominators
                  ? <ErrorPlaceholder label="Nominator fetch failed." onRetry={() => onRetry?.(address)} />
                  : <NominatorsTable nominators={nominators} />
                }
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label, badge, badgeVariant }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors
        ${active
          ? 'border-primary text-primary'
          : 'border-transparent text-dim hover:text-text'}`}
      aria-selected={active}
    >
      {icon}
      {label}
      {badge && (
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold
          ${badgeVariant === 'warn'
            ? 'bg-warning/20 text-warning'
            : 'bg-border text-dim'}`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

function LoadingPlaceholder({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-dim">
      <Loader2 size={14} className="animate-spin" />
      {label}
    </div>
  )
}

function ErrorPlaceholder({ label, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-xs text-danger">
      <p>{label}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost text-danger hover:text-danger gap-1">
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  )
}
