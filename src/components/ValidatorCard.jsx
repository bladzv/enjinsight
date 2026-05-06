import { useState } from 'react'
import {
  Shield,
  Clock,
  Users,
  BarChart3,
  Copy,
  ExternalLink,
  CheckCircle2,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import DetailModal from './DetailModal.jsx'
import NominatorsTable from './NominatorsTable.jsx'
import EraStatTable from './EraStatTable.jsx'
import { formatENJ, truncateAddress, validatorExplorerUrl } from '../utils/format.js'

export default function ValidatorCard({ validator, eraCount, latestEra, onRetry }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const {
    address, display, commission, bondedTotal,
    isActive, nominators, eraStat, missedEras,
    fetchStatus, countNominators,
  } = validator

  const hasMissed = missedEras?.length > 0
  const loading = fetchStatus === 'loading'
  const hasError = fetchStatus === 'error' || fetchStatus === 'failed'
  const displayName = display || truncateAddress(address)
  const nominatorCount = nominators?.length ?? countNominators ?? 0
  const latestStatus = loading
    ? 'Loading validator details'
    : hasError
      ? 'Needs retry'
      : hasMissed
        ? `${missedEras.length} missed era${missedEras.length !== 1 ? 's' : ''}`
        : 'No missed eras detected'

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied.
    }
  }

  function renderActions() {
    return (
      <>
        {hasError && (
          <button
            type="button"
            onClick={() => onRetry?.(address)}
            className="btn-icon bg-card/75"
            aria-label={`Retry fetching data for ${displayName}`}
          >
            <RefreshCw size={14} className="text-danger" />
          </button>
        )}
        <button
          type="button"
          onClick={copyAddress}
          className="btn-icon bg-card/75"
          aria-label={`Copy address of ${displayName}`}
        >
          {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
        </button>
        <a
          href={validatorExplorerUrl(address)}
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
        aria-label={`Open details for validator ${displayName}`}
      >
        <div className="flex items-start gap-3.5">
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card text-primary">
              {loading
                ? <Loader2 size={16} className="animate-spin text-dim" />
                : isActive
                  ? <Shield size={16} className="text-success" />
                  : <Clock size={16} className="text-text-secondary" />
              }
            </div>
            {hasMissed && <span className="sev-high">{missedEras.length} missed</span>}
            {!hasMissed && !hasError && loading && <span className="badge-waiting">Loading</span>}
            {!loading && !hasMissed && !hasError && isActive && <span className="badge-active">Active</span>}
            {!loading && !hasMissed && !hasError && !isActive && <span className="badge-waiting">Inactive</span>}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="break-words font-headline text-base font-bold text-text sm:text-lg" title={displayName}>{displayName}</h3>
            <p className="mt-1 break-all font-mono text-[11px] text-text-secondary">{address}</p>
          </div>

          <div className="flex flex-col items-center gap-1" onClick={event => event.stopPropagation()}>
            {renderActions()}
          </div>
        </div>

        <div className="mt-4 divide-y divide-white/5 rounded-[1rem] bg-card/85 overflow-hidden">
          <MetricRow label="Commission" value={`${commission}%`} accent="text-primary" />
          <MetricRow label="Bonded" value={formatENJ(bondedTotal, 2)} accent="text-cyan" />
          <MetricRow label="Nominators" value={nominatorCount.toLocaleString('en')} accent="text-text" />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-3">
          <p className={`text-sm ${hasError ? 'text-danger' : hasMissed ? 'text-warning' : 'text-text-secondary'}`}>
            {latestStatus}
          </p>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-primary group-hover:bg-primary/20 transition-colors">View Details</span>
        </div>
      </article>

      <ValidatorDetailsModal
        open={open}
        onClose={() => setOpen(false)}
        validator={validator}
        eraCount={eraCount}
        latestEra={latestEra}
        onRetry={onRetry}
      />
    </>
  )
}

export function ValidatorDetailsModal({ open, onClose, validator, eraCount, latestEra, onRetry }) {
  const [activeTab, setActiveTab] = useState('era')
  const [copied, setCopied] = useState(false)

  if (!validator) return null

  const {
    address, display, commission, bondedTotal,
    isActive, nominators, eraStat, missedEras,
    fetchStatus, countNominators,
  } = validator

  const hasMissed = missedEras?.length > 0
  const loading = fetchStatus === 'loading'
  const hasError = fetchStatus === 'error' || fetchStatus === 'failed'
  const displayName = display || truncateAddress(address)
  const nominatorCount = nominators?.length ?? countNominators ?? 0
  const latestStatus = loading
    ? 'Loading validator details'
    : hasError
      ? 'Needs retry'
      : hasMissed
        ? `${missedEras.length} missed era${missedEras.length !== 1 ? 's' : ''}`
        : 'No missed eras detected'

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied.
    }
  }

  function renderActions() {
    return (
      <>
        {hasError && (
          <button
            type="button"
            onClick={() => onRetry?.(address)}
            className="btn-icon bg-card/75"
            aria-label={`Retry fetching data for ${displayName}`}
          >
            <RefreshCw size={14} className="text-danger" />
          </button>
        )}
        <button
          type="button"
          onClick={copyAddress}
          className="btn-icon bg-card/75"
          aria-label={`Copy address of ${displayName}`}
        >
          {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
        </button>
        <a
          href={validatorExplorerUrl(address)}
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
    <DetailModal
      open={open}
      onClose={onClose}
      title={displayName}
      subtitle={`Validator ${truncateAddress(address)} · ${latestStatus}`}
      actions={renderActions()}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <PreviewMetric label="Commission" value={`${commission}%`} accent="text-primary" />
          <PreviewMetric label="Bonded" value={formatENJ(bondedTotal, 2)} accent="text-cyan" />
          <PreviewMetric label="Nominators" value={nominatorCount.toLocaleString('en')} accent="text-text" />
          <PreviewMetric
            label="Reward Gaps"
            value={hasMissed ? missedEras.length.toLocaleString('en') : '0'}
            accent={hasMissed ? 'text-warning' : 'text-success'}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-[1rem] bg-[#05070f] p-2 sm:flex-row">
          <TabButton
            active={activeTab === 'era'}
            onClick={() => setActiveTab('era')}
            icon={<BarChart3 size={14} />}
            label="Era Rewards"
            badge={missedEras?.length ? `${missedEras.length} missed` : eraStat?.length ? `${eraStat.length} eras` : null}
            badgeVariant={missedEras?.length ? 'warn' : 'neutral'}
          />
          <TabButton
            active={activeTab === 'nom'}
            onClick={() => setActiveTab('nom')}
            icon={<Users size={14} />}
            label="Nominators"
            badge={nominators ? String(nominators.length) : countNominators ? String(countNominators) : null}
            badgeVariant="neutral"
          />
        </div>

        <div className="rounded-[1.25rem] bg-term/40 p-4 sm:p-5">
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
                  : (
                    <NominatorsTable
                      nominators={nominators}
                      onRetry={onRetry}
                      validatorAddress={address}
                      validatorFetchStatus={fetchStatus}
                    />
                  )
              }
            </>
          )}
        </div>
      </div>
    </DetailModal>
  )
}

function MetricRow({ label, value, accent = 'text-text' }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className={`text-sm font-bold font-headline ${accent}`}>{value}</span>
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
        <button type="button" onClick={onRetry} className="btn-ghost gap-1 text-danger hover:text-danger">
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  )
}
