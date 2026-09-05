import { useState } from 'react'
import {
  Shield,
  Clock,
  Users,
  BarChart3,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import DetailModal from './DetailModal.jsx'
import CopyButton from './CopyButton.jsx'
import NominatorsTable from './NominatorsTable.jsx'
import EraStatTable from './EraStatTable.jsx'
import { formatENJ, truncateAddress, validatorExplorerUrl } from '../utils/format.js'
import Skeleton, { SkeletonSwap } from './Skeleton.jsx'

export default function ValidatorCard({ validator, eraCount, latestEra, onRetry }) {
  const [open, setOpen] = useState(false)

  const {
    address, display, commission, bondedTotal,
    isActive, nominators, missedEras,
    fetchStatus, countNominators,
  } = validator

  const hasMissed = missedEras?.length > 0
  const loading = fetchStatus === 'loading'
  const hasError = fetchStatus === 'error' || fetchStatus === 'failed'
  const displayName = display || truncateAddress(address)
  const nominatorCount = nominators?.length ?? countNominators ?? 0
  const latestStatus = loading
    ? 'Loading'
    : hasError
      ? 'Needs retry'
      : hasMissed
        ? `${missedEras.length} missed era${missedEras.length !== 1 ? 's' : ''}`
        : 'No missed eras'

  function renderActions() {
    return (
      <>
        {hasError && onRetry && (
          <button
            type="button"
            onClick={event => { event.stopPropagation(); onRetry(address) }}
            className="btn-icon"
            aria-label={`Retry fetching data for ${displayName}`}
          >
            <RefreshCw size={14} className="text-danger" />
          </button>
        )}
        <CopyButton
          value={address}
          label={`Copy address of ${displayName}`}
          onClick={event => event.stopPropagation()}
        />
        <a
          href={validatorExplorerUrl(address)}
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
        aria-label={`Open details for validator ${displayName}`}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-high text-primary">
            <SkeletonSwap loading={loading} skeleton={<Skeleton.Block width="1rem" height="1rem" />}>
              {isActive
                ? <Shield size={14} className="text-success" />
                : <Clock size={14} className="text-text-secondary" />
              }
            </SkeletonSwap>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="break-words font-headline text-sm font-bold leading-snug text-text sm:text-base" title={displayName}>{displayName}</h3>
            <p className="mt-0.5 break-all font-mono text-[10px] text-muted sm:text-[11px]">{address}</p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {renderActions()}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MetricCell label="Commission" value={`${commission}%`} accent="text-primary" loading={loading} />
          <MetricCell label="Bonded" value={formatENJ(bondedTotal, 0)} accent="text-cyan" loading={loading} />
          <MetricCell label="Nominators" value={nominatorCount.toLocaleString('en')} accent="text-text" loading={loading} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hairline)] pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {hasMissed && <span className="sev-high">{missedEras.length} missed</span>}
            {!loading && !hasMissed && !hasError && isActive && <span className="badge-active">Active</span>}
            {!loading && !hasMissed && !hasError && !isActive && <span className="badge-waiting">Inactive</span>}
            {hasError && <span className="badge-error">Error</span>}
            <span className={`text-[11px] ${hasError ? 'text-danger' : hasMissed ? 'text-warning' : 'text-text-secondary'}`}>
              {latestStatus}
            </span>
          </div>
          <span className="mini-chip text-primary">View →</span>
        </div>
      </div>

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

  if (!validator) return null

  const {
    address, display, commission, bondedTotal,
    nominators, eraStat, missedEras,
    fetchStatus, countNominators,
  } = validator

  const hasMissed = missedEras?.length > 0
  const loading = fetchStatus === 'loading'
  const hasError = fetchStatus === 'error' || fetchStatus === 'failed'
  const displayName = display || truncateAddress(address)
  const nominatorCount = nominators?.length ?? countNominators ?? 0
  const latestStatus = loading
    ? 'Loading…'
    : hasError
      ? 'Needs retry'
      : hasMissed
        ? `${missedEras.length} missed era${missedEras.length !== 1 ? 's' : ''}`
        : 'No missed eras detected'

  function renderActions() {
    return (
      <>
        {hasError && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(address)}
            className="btn-icon"
            aria-label={`Retry fetching data for ${displayName}`}
          >
            <RefreshCw size={14} className="text-danger" />
          </button>
        )}
        <CopyButton value={address} label={`Copy address of ${displayName}`} />
        <a
          href={validatorExplorerUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-icon"
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
      subtitle={`${truncateAddress(address)} · ${latestStatus}`}
      eyebrow="Validator"
      actions={renderActions()}
    >
      <div className="space-y-3 sm:space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <PreviewMetric label="Commission" value={`${commission}%`} accent="text-primary" />
          <PreviewMetric label="Bonded" value={formatENJ(bondedTotal, 2)} accent="text-cyan" />
          <PreviewMetric label="Nominators" value={nominatorCount.toLocaleString('en')} accent="text-text" />
          <PreviewMetric
            label="Reward Gaps"
            value={hasMissed ? missedEras.length.toLocaleString('en') : '0'}
            accent={hasMissed ? 'text-warning' : 'text-success'}
          />
        </div>

        <div className="flex gap-1 rounded-sm border border-[var(--hairline)] bg-card p-1">
          <TabButton
            active={activeTab === 'era'}
            onClick={() => setActiveTab('era')}
            icon={<BarChart3 size={13} />}
            label="Eras"
            badge={missedEras?.length ? `${missedEras.length}!` : eraStat?.length ? String(eraStat.length) : null}
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

        <div className="rounded-sm border border-[var(--hairline)] bg-surface p-2 sm:p-4">
          {activeTab === 'era' && (
            loading && !eraStat
              ? <LoadingPlaceholder label="Fetching era stats…" />
              : hasError && !eraStat
                ? <ErrorPlaceholder label="Era stat fetch failed." onRetry={onRetry && (() => onRetry(address))} />
                : (
                  <EraStatTable
                    eraStat={eraStat}
                    missedEras={missedEras}
                    eraCount={eraCount}
                    latestEra={latestEra}
                  />
                )
          )}

          {activeTab === 'nom' && (
            loading && !nominators
              ? <LoadingPlaceholder label="Fetching nominators…" />
              : hasError && !nominators
                ? <ErrorPlaceholder label="Nominator fetch failed." onRetry={onRetry && (() => onRetry(address))} />
                : (
                  <NominatorsTable
                    nominators={nominators}
                    onRetry={onRetry}
                    validatorAddress={address}
                    validatorFetchStatus={fetchStatus}
                  />
                )
          )}
        </div>
      </div>
    </DetailModal>
  )
}

function MetricCell({ label, value, accent = 'text-text', loading = false }) {
  return (
    <div className="min-w-0 rounded-sm border border-[var(--hairline)] bg-surface-high px-2 py-1.5">
      <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-muted" style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{label}</p>
      <SkeletonSwap loading={loading} skeleton={<Skeleton.Block width="3rem" height="1rem" className="mt-1" />}>
        <p className={`mt-0.5 truncate font-mono text-xs font-bold ${accent}`} title={value}>{value}</p>
      </SkeletonSwap>
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
      <Skeleton.Line />
      <Skeleton.Line width="91.666667%" />
      <Skeleton.Line width="80%" />
    </div>
  )
}

function ErrorPlaceholder({ label, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-xs text-danger">
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
