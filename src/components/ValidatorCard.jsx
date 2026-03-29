import { useState } from 'react'
import {
  ChevronDown, ChevronUp, Shield, Clock,
  Users, BarChart3, Copy, ExternalLink,
  CheckCircle2, AlertTriangle, RefreshCw, Loader2,
} from 'lucide-react'
import NominatorsTable from './NominatorsTable.jsx'
import EraStatTable    from './EraStatTable.jsx'
import { formatENJ, truncateAddress, validatorExplorerUrl } from '../utils/format.js'

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
  const hasError    = fetchStatus === 'error' || fetchStatus === 'failed'
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
      className={`overflow-hidden rounded-[1.5rem] bg-surface shadow-ambient transition-all duration-200
        ${hasMissed ? 'border-l-2 border-l-warning' : ''}
        ${hasError  ? 'border-l-2 border-l-danger'  : ''}
      `}
      style={{ borderColor: !hasMissed && !hasError ? 'rgba(70,71,82,0.10)' : undefined,
               borderWidth: !hasMissed && !hasError ? '1px' : undefined,
               borderStyle: !hasMissed && !hasError ? 'solid' : undefined }}
    >
      {/* ── Collapsed header row ────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} validator ${displayName}`}
        className="flex min-h-[72px] cursor-pointer select-none items-center gap-3 px-5 py-5 transition-colors hover:bg-card sm:px-6"
      >
        {/* Pool ID box */}
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-card text-primary font-bold font-mono text-xs">
          {loading
            ? <Loader2 size={14} className="animate-spin text-dim" />
            : isActive
              ? <Shield size={14} className="text-success" />
              : <Clock size={14} className="text-dim" />
          }
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-headline text-base font-bold text-text truncate" title={displayName}>{displayName}</span>
            {hasMissed && (
              <span className="sev-high flex-shrink-0">{missedEras.length} MISSED</span>
            )}
            {loading && !hasMissed && (
              <span className="badge-waiting flex-shrink-0">Loading</span>
            )}
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 mt-0.5 flex-wrap text-xs text-text-secondary">
            <span>Commission: {commission}%</span>
            <span>Bonded: <span className="font-mono">{formatENJ(bondedTotal, 2)}</span></span>
          </div>
        </div>

        {/* Icon actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={copyAddress}
            className="btn-icon"
            aria-label={`Copy address of ${displayName}`}
          >
            {copied ? <CheckCircle2 size={13} className="text-success" /> : <Copy size={13} />}
          </button>
          <a
            href={validatorExplorerUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
            aria-label={`Open ${displayName} on Subscan`}
          >
            <ExternalLink size={13} />
          </a>
          {fetchStatus === 'queued' && (
            <span className="px-2 py-1 text-xs bg-card text-muted rounded">Queued</span>
          )}
          {hasError && (
            <button
              onClick={() => onRetry?.(address)}
              className="btn-icon"
              aria-label={`Retry fetching data for ${displayName}`}
            >
              <RefreshCw size={13} className="text-danger" />
            </button>
          )}
        </div>

        {/* Expand toggle */}
        <div className="text-muted flex-shrink-0">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* ── Expanded body ───────────────────────────────────────────── */}
      {open && (
        <div className="animate-fade-in">
          {/* Tab bar */}
          <div className="flex bg-[#05070f] px-2 pt-2">
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

          <div className="bg-term/30 p-4 sm:p-5">
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
                  : <NominatorsTable
                      nominators={nominators}
                      onRetry={onRetry}
                      validatorAddress={address}
                      validatorFetchStatus={fetchStatus}
                    />
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
      className={`flex items-center px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors w-full
        ${active ? 'rounded-t-2xl bg-card text-primary' : 'rounded-t-2xl text-text-secondary hover:bg-surface-high'}`}
      aria-selected={active}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {icon}
        <span className="truncate" title={label}>{label}</span>
      </span>
      {badge && (
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0
          ${badgeVariant === 'warn' ? 'bg-warning/15 text-warning' : 'bg-card text-muted'}`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

function LoadingPlaceholder({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-text-secondary">
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
