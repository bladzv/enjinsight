import { useState } from 'react'
import {
  Users,
  BarChart3,
  Copy,
  ExternalLink,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import DetailModal from './DetailModal.jsx'
import PoolValidatorsTable from './PoolValidatorsTable.jsx'
import PoolRewardTable from './PoolRewardTable.jsx'
import { formatENJ, poolExplorerUrl, poolLabel } from '../utils/format.js'

export default function PoolCard({ pool, eraCount, latestEra, onRetry, open: controlledOpen, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('rewards')
  const [copied, setCopied] = useState(false)

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
  const bondedLabel = formatENJ(totalBonded, 2)
  const latestStatus = loading
    ? 'Loading pool details'
    : hasError
      ? 'Some pool details could not be loaded'
      : hasMissed
        ? `${missedEras.length} missed payout era${missedEras.length !== 1 ? 's' : ''}`
        : 'No missed payout eras detected'

  function setOpen(next) {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(stashAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied.
    }
  }

  function renderActions() {
    return (
      <>
        <button
          type="button"
          onClick={copyAddress}
          className="btn-icon bg-card/75"
          aria-label={`Copy stash address of ${displayName}`}
        >
          {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
        </button>
        <a
          href={poolExplorerUrl(poolId)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-icon bg-card/75"
          aria-label={`Open ${displayName} on Subscan`}
        >
          <ExternalLink size={14} />
        </a>
      </>
    )
  }

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`group relative overflow-hidden rounded-[1.35rem] border bg-surface px-4 py-4 shadow-ambient transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan/20 hover:bg-card sm:px-5 sm:py-5 ${
          hasError ? 'border-danger/35' : hasMissed ? 'border-warning/30' : 'border-white/6'
        }`}
        aria-label={`Open details for pool ${displayName}`}
      >
        <div className="flex items-start gap-3.5">
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card font-mono text-xs font-bold text-primary sm:text-sm">
              {loading ? <span className="skeleton h-5 w-5 rounded-md" aria-hidden="true" /> : `#${poolId}`}
            </div>
            {poolState && (
              <span className={`text-[9px] font-bold uppercase tracking-[0.15em] px-2 py-0.5 rounded-full ${
                poolState === 'Open' ? 'bg-success/10 text-success' :
                poolState === 'Blocked' ? 'bg-warning/10 text-warning' :
                poolState === 'Destroying' ? 'bg-danger/10 text-danger' :
                'bg-surface-high text-text-secondary'
              }`}>{poolState}</span>
            )}
            {hasMissed && <span className="sev-high">{missedEras.length} missed</span>}
            {loading && !hasMissed && <span className="skeleton skeleton-pill" aria-hidden="true" />}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="break-words font-headline text-base font-bold text-text sm:text-lg" title={displayName}>{displayName}</h3>
            <p className="mt-1 break-all font-mono text-[11px] text-text-secondary">{stashAddress}</p>
          </div>

          <div className="flex flex-col items-center gap-1" onClick={event => event.stopPropagation()}>
            {renderActions()}
          </div>
        </div>

        <div className="mt-4 divide-y divide-white/5 rounded-[1rem] bg-card/85 overflow-hidden">
          <MetricRow label="Members" value={memberCountLabel} accent="text-text" loading={loading} />
          <MetricRow label="Validators" value={validatorCountLabel} accent="text-primary" loading={loading} />
          <MetricRow label="Bonded" value={bondedLabel} accent="text-cyan" loading={loading} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-3">
          <p className={`text-sm ${hasError ? 'text-danger' : hasMissed ? 'text-warning' : 'text-text-secondary'}`}>
            {latestStatus}
          </p>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary group-hover:bg-primary/20 transition-colors">View Details</span>
        </div>
      </article>

      <DetailModal
        open={open}
        onClose={() => setOpen(false)}
        title={displayName}
        subtitle={`Pool #${poolId} · ${latestStatus}`}
        actions={renderActions()}
      >
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <PreviewMetric label="Members" value={memberCountLabel} accent="text-text" />
            <PreviewMetric label="Validators" value={validatorCountLabel} accent="text-primary" />
            <PreviewMetric label="Bonded" value={bondedLabel} accent="text-cyan" />
            <PreviewMetric
              label="Commission"
              value={commission > 0 ? `${commission}%` : '0%'}
              accent={commission > 0 ? 'text-warning' : 'text-success'}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-[1rem] bg-[#05070f] p-2 sm:flex-row">
            <TabButton
              active={activeTab === 'rewards'}
              onClick={() => setActiveTab('rewards')}
              icon={<BarChart3 size={14} />}
              label="Era Rewards"
              badge={
                missedEras?.length
                  ? `${missedEras.length} missed`
                  : eraRewards?.length
                    ? `${eraRewards.length} rewards`
                    : null
              }
              badgeVariant={missedEras?.length ? 'warn' : 'neutral'}
            />
            <TabButton
              active={activeTab === 'validators'}
              onClick={() => setActiveTab('validators')}
              icon={<Users size={14} />}
              label="Validators"
              badge={nominatedValidators ? String(nominatedValidators.length) : null}
              badgeVariant="neutral"
            />
          </div>

          <div className="rounded-[1.25rem] bg-term/40 p-4 sm:p-5">
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
                    : <PoolValidatorsTable validators={nominatedValidators} onRetry={addr => onRetry?.(pool.poolId, addr)} />
                }
              </>
            )}
          </div>
        </div>
      </DetailModal>
    </>
  )
}

function MetricRow({ label, value, accent = 'text-text', loading = false }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-xs text-text-secondary">{label}</span>
      {loading
        ? <span className="skeleton skeleton-value" aria-hidden="true" />
        : <span className={`text-sm font-bold font-headline ${accent}`}>{value}</span>
      }
    </div>
  )
}

function PreviewMetric({ label, value, accent = 'text-text' }) {
  return (
    <div className="min-w-0 rounded-[1rem] bg-card/85 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-secondary">{label}</p>
      <p className={`mt-1.5 font-headline text-lg font-bold ${accent}`}>{value}</p>
    </div>
  )
}

function TabButton({ active, onClick, icon, label, badge, badgeVariant }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-[0.85rem] px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${
        active ? 'bg-card text-primary' : 'text-text-secondary hover:bg-surface-high'
      }`}
      aria-selected={active}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="whitespace-normal break-words text-left">{label}</span>
      </span>
      {badge && (
        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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
    <div className="space-y-3 py-2">
      <p className="text-xs text-text-secondary">{label}</p>
      <div className="skeleton skeleton-line" aria-hidden="true" />
      <div className="skeleton skeleton-line w-11/12" aria-hidden="true" />
      <div className="skeleton skeleton-line w-4/5" aria-hidden="true" />
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
