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
          className="btn-icon bg-card"
          aria-label={`Copy stash address of ${displayName}`}
        >
          {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
        </button>
        <a
          href={poolExplorerUrl(poolId)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-icon bg-card"
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
        className={`group relative overflow-hidden rounded-[1.5rem] bg-surface p-5 shadow-ambient transition-all duration-200 hover:-translate-y-1 hover:bg-card sm:p-6 ${
          hasMissed ? 'border-l-2 border-l-warning' : ''
        } ${hasError ? 'border-l-2 border-l-danger' : ''}`}
        style={{
          borderColor: !hasMissed && !hasError ? 'rgba(70,71,82,0.10)' : undefined,
          borderWidth: !hasMissed && !hasError ? '1px' : undefined,
          borderStyle: !hasMissed && !hasError ? 'solid' : undefined,
        }}
        aria-label={`Open details for pool ${displayName}`}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-card font-mono text-sm font-bold text-primary">
            {loading ? <Loader2 size={16} className="animate-spin text-dim" /> : `#${poolId}`}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words font-headline text-lg font-bold text-text" title={displayName}>{displayName}</h3>
              {hasMissed && <span className="sev-high">{missedEras.length} missed</span>}
              {!loading && !hasMissed && poolState === 'Open' && <span className="badge-active">Open</span>}
              {!loading && !hasMissed && poolState && poolState !== 'Open' && <span className="badge-waiting">{poolState}</span>}
              {loading && !hasMissed && <span className="badge-waiting">Loading</span>}
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-text-secondary">{stashAddress}</p>
          </div>

          <div className="flex items-center gap-1.5" onClick={event => event.stopPropagation()}>
            {renderActions()}
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-white/6 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mini-chip">{poolState || 'Unknown state'}</span>
            {commission > 0 ? <span className="mini-chip">Commission: {commission}%</span> : null}
          </div>
          <p className={`text-sm ${hasError ? 'text-danger' : hasMissed ? 'text-warning' : 'text-text-secondary'}`}>
            {latestStatus}
          </p>
          <div className="grid gap-2">
            <PreviewMetric label="Members" value={memberCountLabel} accent="text-text" />
            <PreviewMetric label="Validators" value={validatorCountLabel} accent="text-primary" />
            <PreviewMetric label="Bonded" value={bondedLabel} accent="text-cyan" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-text-secondary">View rewards and validator details</p>
            <span className="mini-chip group-hover:text-text">View details</span>
          </div>
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

          <div className="flex rounded-[1rem] bg-[#05070f] p-2">
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

function PreviewMetric({ label, value, accent = 'text-text' }) {
  return (
    <div className="rounded-[1.15rem] bg-card/85 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">{label}</p>
      <p className={`mt-2 font-headline text-xl font-bold ${accent}`}>{value}</p>
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
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-text-secondary">
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
