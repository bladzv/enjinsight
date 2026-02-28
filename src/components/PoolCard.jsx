import { useState } from 'react'
import {
  ChevronDown, ChevronUp, Shield, Clock,
  Users, BarChart3, Copy, ExternalLink,
  CheckCircle2, AlertTriangle, Loader2,
} from 'lucide-react'
import PoolValidatorsTable from './PoolValidatorsTable.jsx'
import PoolRewardTable     from './PoolRewardTable.jsx'
import { formatENJ, poolExplorerUrl, poolLabel } from '../utils/format.js'

/**
 * Expandable card for a single nomination pool.
 * Collapsed: state badge, display name, member count, bonded, commission, icons.
 * Expanded: two-tab layout — nominated validators + era reward status.
 */
export default function PoolCard({ pool, eraCount, latestEra }) {
  const [open,      setOpen]      = useState(false)
  const [activeTab,  setActiveTab] = useState('rewards') // 'rewards' | 'validators'
  const [copied,    setCopied]    = useState(false)

  const {
    poolId, state: poolState, stashDisplay, stashAddress,
    memberCount, totalBonded, commission,
    nominatedValidators, eraRewards, missedEras, eraValidatorBreakdown,
    fetchStatus,
  } = pool

  const hasMissed   = missedEras?.length > 0
  const loading     = fetchStatus === 'loading'
  const hasError    = fetchStatus === 'error'
  const displayName = poolLabel(pool)

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(stashAddress)
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
        aria-label={`${open ? 'Collapse' : 'Expand'} pool ${displayName}`}
        className="flex items-center gap-2 sm:gap-3 px-4 py-3 cursor-pointer
                   hover:bg-surface/40 transition-colors select-none min-h-[56px]"
      >
        {/* State badge */}
        {loading
          ? <span className="badge-waiting flex-shrink-0"><Clock size={10} />Loading</span>
          : poolState === 'Open'
            ? <span className="badge-active flex-shrink-0"><Shield size={10} />Open</span>
            : <span className="badge-waiting flex-shrink-0"><Clock size={10} />{poolState}</span>
        }

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-sm text-text truncate" title={stashAddress}>{displayName}</span>
            {hasMissed && (
              <AlertTriangle size={13} className="text-warning flex-shrink-0" aria-label={`${missedEras.length} missed era(s)`} />
            )}
            {loading && (
              <Loader2 size={12} className="text-dim animate-spin flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-dim">
              Members: <span className="text-text-secondary">{memberCount}</span>
            </span>
            <span className="text-xs text-dim">
              Validators: <span className="text-text-secondary">{nominatedValidators?.length ?? '—'}</span>
            </span>
            {commission > 0 && (
              <span className="text-xs text-dim">
                Commission: <span className="text-text-secondary">{commission}%</span>
              </span>
            )}
            <span className="text-xs text-dim hidden sm:inline">
              Bonded: <span className="font-mono text-text-secondary">{formatENJ(totalBonded, 2)}</span>
            </span>
          </div>
        </div>

        {/* Icon actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={copyAddress}
            className="btn-icon !min-w-[36px] !min-h-[36px]"
            aria-label={`Copy stash address of ${displayName}`}
          >
            {copied ? <CheckCircle2 size={13} className="text-success" /> : <Copy size={13} />}
          </button>
          <a
            href={poolExplorerUrl(poolId)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon !min-w-[36px] !min-h-[36px]"
            aria-label={`Open ${displayName} on Subscan`}
          >
            <ExternalLink size={13} />
          </a>
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
              active={activeTab === 'rewards'}
              onClick={() => setActiveTab('rewards')}
              icon={<BarChart3 size={13} />}
              label="Era Rewards"
              badge={
                missedEras?.length
                  ? `${missedEras.length} missed`
                  : eraRewards?.length
                    ? `${eraRewards.length} eras`
                    : null
              }
              badgeVariant={missedEras?.length ? 'warn' : 'neutral'}
            />
            <TabButton
              active={activeTab === 'validators'}
              onClick={() => setActiveTab('validators')}
              icon={<Users size={13} />}
              label="Validators"
              badge={nominatedValidators ? String(nominatedValidators.length) : null}
              badgeVariant="neutral"
            />
          </div>

          <div className="p-3 sm:p-4">
            {activeTab === 'rewards' && (
              <>
                {loading && !eraRewards
                  ? <LoadingPlaceholder label="Fetching reward data…" />
                  : hasError && !eraRewards
                    ? <ErrorPlaceholder label="Reward data fetch failed." />
                    : (
                      <PoolRewardTable
                        eraRewards={eraRewards}
                        missedEras={missedEras}
                        eraCount={eraCount}
                        latestEra={latestEra}
                        eraValidatorBreakdown={eraValidatorBreakdown}
                      />
                    )
                }
              </>
            )}

            {activeTab === 'validators' && (
              <>
                {loading && !nominatedValidators
                  ? <LoadingPlaceholder label="Fetching nominated validators…" />
                  : hasError && !nominatedValidators
                    ? <ErrorPlaceholder label="Validator list fetch failed." />
                    : <PoolValidatorsTable validators={nominatedValidators} />
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

function ErrorPlaceholder({ label }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-xs text-danger">
      <p>{label}</p>
    </div>
  )
}
