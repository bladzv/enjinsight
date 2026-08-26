import { useState } from 'react'
import {
  Users,
  BarChart3,
  ExternalLink,
} from 'lucide-react'
import DetailModal from './DetailModal.jsx'
import CopyButton from './CopyButton.jsx'
import PoolValidatorsTable from './PoolValidatorsTable.jsx'
import PoolRewardTable from './PoolRewardTable.jsx'
import { formatENJ, poolExplorerUrl, poolLabel } from '../utils/format.js'

export default function PoolCard({ pool, eraCount, latestEra, onRetry, open: controlledOpen, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('rewards')

  const {
    poolId, state: poolState, stashAddress,
    memberCount, totalBonded, commission,
    nominatedValidators, eraRewards, missedEras, eraValidatorBreakdown,
    fetchStatus,
  } = pool

  const hasMissed = missedEras?.length > 0
  const loading = fetchStatus === 'loading'
  const hasError = fetchStatus === 'error' || fetchStatus === 'failed'
  const displayName = poolLabel(pool)
  const validatorCount = nominatedValidators?.length ?? 0
  const isControlled = typeof controlledOpen === 'boolean'
  const open = isControlled ? controlledOpen : internalOpen
  const memberCountLabel = Number.isFinite(memberCount) ? memberCount.toLocaleString('en') : '—'
  const validatorCountLabel = validatorCount.toLocaleString('en')
  const bondedLabel = formatENJ(totalBonded, 0)
  const bondedFullLabel = formatENJ(totalBonded, 2)
  const latestStatus = loading
    ? 'Loading'
    : hasError
      ? 'Some details unavailable'
      : hasMissed
        ? `${missedEras.length} missed payout era${missedEras.length !== 1 ? 's' : ''}`
        : 'No missed payout eras'

  function setOpen(next) {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  function renderActions() {
    return (
      <>
        <CopyButton
          value={stashAddress}
          label={`Copy stash address of ${displayName}`}
          onClick={event => event.stopPropagation()}
        />
        <a
          href={poolExplorerUrl(poolId)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-icon"
          onClick={event => event.stopPropagation()}
          aria-label={`Open ${displayName} on Subscan`}
        >
          <ExternalLink size={14} />
        </a>
      </>
    )
  }

  const stateColorClass = poolState === 'Open' ? 'text-success' :
    poolState === 'Blocked' ? 'text-warning' :
    poolState === 'Destroying' ? 'text-danger' : 'text-text-secondary'
  const borderClass = hasError ? 'border-danger/40' : hasMissed ? 'border-warning/35' : 'border-[var(--hairline)]'
  const accentShadow = hasError
    ? 'inset 2px 0 0 var(--danger)'
    : hasMissed
      ? 'inset 2px 0 0 var(--warning)'
      : 'inset 2px 0 0 var(--primary)'

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`group relative flex min-w-0 cursor-pointer flex-col rounded-sm border ${borderClass} bg-card px-3 py-3 transition-colors hover:bg-surface-high sm:px-4 sm:py-4`}
        style={{ boxShadow: accentShadow }}
        aria-label={`Open details for pool ${displayName}`}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-high font-mono text-[11px] font-bold text-primary">
            {loading ? <span className="skeleton h-4 w-4" aria-hidden="true" /> : `#${poolId}`}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="break-words font-headline text-sm font-bold leading-snug text-text sm:text-base" title={displayName}>{displayName}</h3>
            <p className="mt-0.5 break-all font-mono text-[10px] text-muted sm:text-[11px]">{stashAddress}</p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {renderActions()}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MetricCell label="Members" value={memberCountLabel} accent="text-text" loading={loading} />
          <MetricCell label="Validators" value={validatorCountLabel} accent="text-primary" loading={loading} />
          <MetricCell label="Bonded" value={bondedLabel} accent="text-cyan" loading={loading} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hairline)] pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {poolState && (
              <span className={`mini-chip ${stateColorClass}`}>{poolState}</span>
            )}
            {hasMissed && <span className="sev-high">{missedEras.length} missed</span>}
            {hasError && <span className="badge-error">Error</span>}
            <span className={`text-[11px] ${hasError ? 'text-danger' : hasMissed ? 'text-warning' : 'text-text-secondary'}`}>
              {latestStatus}
            </span>
          </div>
          <span className="mini-chip text-primary">View →</span>
        </div>
      </div>

      <DetailModal
        open={open}
        onClose={() => setOpen(false)}
        title={displayName}
        subtitle={`Pool #${poolId} · ${latestStatus}`}
        eyebrow="Nomination Pool"
        actions={renderActions()}
      >
        <div className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <PreviewMetric label="Members" value={memberCountLabel} accent="text-text" />
            <PreviewMetric label="Validators" value={validatorCountLabel} accent="text-primary" />
            <PreviewMetric label="Bonded" value={bondedFullLabel} accent="text-cyan" />
            <PreviewMetric
              label="Commission"
              value={commission > 0 ? `${commission}%` : '0%'}
              accent={commission > 0 ? 'text-warning' : 'text-success'}
            />
          </div>

          <div className="flex gap-1 rounded-sm border border-[var(--hairline)] bg-card p-1">
            <TabButton
              active={activeTab === 'rewards'}
              onClick={() => setActiveTab('rewards')}
              icon={<BarChart3 size={13} />}
              label="Rewards"
              badge={
                missedEras?.length
                  ? `${missedEras.length}!`
                  : eraRewards?.length
                    ? String(eraRewards.length)
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

          <div className="rounded-sm border border-[var(--hairline)] bg-surface p-2 sm:p-4">
            {activeTab === 'rewards' && (
              loading && !eraRewards
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
            )}

            {activeTab === 'validators' && (
              loading && !nominatedValidators
                ? <LoadingPlaceholder label="Fetching nominated validators…" />
                : hasError && !nominatedValidators
                  ? <ErrorPlaceholder label="Validator list fetch failed." />
                  : <PoolValidatorsTable validators={nominatedValidators} onRetry={addr => onRetry?.(pool.poolId, addr)} />
            )}
          </div>
        </div>
      </DetailModal>
    </>
  )
}

function MetricCell({ label, value, accent = 'text-text', loading = false }) {
  return (
    <div className="min-w-0 rounded-sm border border-[var(--hairline)] bg-surface-high px-2 py-1.5">
      <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-muted" style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{label}</p>
      {loading
        ? <span className="skeleton mt-1 block h-4 w-12" aria-hidden="true" />
        : <p className={`mt-0.5 truncate font-mono text-xs font-bold ${accent}`} title={value}>{value}</p>
      }
    </div>
  )
}

function PreviewMetric({ label, value, accent = 'text-text' }) {
  return (
    <div className="min-w-0 rounded-sm border border-[var(--hairline)] bg-card px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted" style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{label}</p>
      <p className={`mt-1 break-words font-mono text-base font-bold sm:text-lg ${accent}`}>{value}</p>
    </div>
  )
}

function TabButton({ active, onClick, icon, label, badge, badgeVariant }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors sm:gap-2 sm:px-3 sm:text-xs ${
        active ? 'bg-primary/15 text-primary-glow' : 'text-text-secondary hover:bg-surface-high'
      }`}
      style={active ? { boxShadow: 'inset 0 0 0 1px rgba(124, 58, 237, 0.35)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' } : { fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
      aria-pressed={active}
    >
      {icon}
      <span className="truncate">{label}</span>
      {badge && (
        <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-bold ${
          badgeVariant === 'warn' ? 'bg-warning/15 text-warning' : 'bg-surface-high text-text-secondary'
        }`}>
          {badge}
        </span>
      )}
    </button>
  )
}

function LoadingPlaceholder({ label }) {
  return (
    <div className="space-y-2 py-2">
      <p className="text-xs text-text-secondary">{label}</p>
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton skeleton-line w-11/12" aria-hidden="true" />
      <div className="skeleton skeleton-line w-4/5" aria-hidden="true" />
    </div>
  )
}

function ErrorPlaceholder({ label }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-xs text-danger">
      <p>{label}</p>
    </div>
  )
}
