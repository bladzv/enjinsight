/**
 * LandingPage — entry screen shown when view === 'home'.
 * Renders four feature cards: Era Block Explorer, Staking Rewards Cadence,
 * Historical Balance Viewer, and Reward History Viewer.
 */
import { BarChart3, LineChart, Layers, TrendingUp } from 'lucide-react'

const FEATURES = [
  {
    key: 'era',
    icon: Layers,
    title: 'Era Block Explorer',
    description:
      'Explore historical era and session boundaries on the Enjin Relaychain. ' +
      'Look up start/end blocks and UTC timestamps for any past era.',
    label: 'Open Era Explorer',
    resource: 'Relaychain RPC Endpoint',
  },
  {
    key: 'staking',
    icon: BarChart3,
    title: 'Staking Rewards Cadence',
    description:
      'Scan validators and nomination pools for missing reward payouts across recent eras on the Enjin Relaychain. ' +
      'Identify risk severity and track nominator exposure at a glance.',
    label: 'Open Staking Checker',
    resource: 'Subscan API Endpoint',
  },
  {
    key: 'balance',
    icon: LineChart,
    title: 'Historical Balance Viewer',
    description:
      'Query any Enjin Blockchain address directly via archive-node WebSocket RPC. ' +
      'Visualise free, reserved, and frozen balances over any block range across Matrixchain or Relaychain. Export or import data offline.',
    label: 'Open Balance Viewer',
    resource: 'Archive RPC Endpoint',
  },
  {
    key: 'reward-history',
    icon: TrendingUp,
    title: 'Reward History Viewer',
    description:
      'Track staking reward payouts over time for any Relaychain wallet address. ' +
      'Visualise reward trends, identify patterns, and export historical reward data for analysis and record-keeping.',
    label: 'Open Reward Viewer',
    resource: 'Subscan API / Archive RPC Endpoint',
  },
]

export default function LandingPage({ onNavigate }) {
  return (
    <div className="pt-8 pb-12 sm:pt-12 sm:pb-20">
      {/* Hero */}
      <div className="text-center mb-12 px-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-5 rounded
                        bg-primary/10 text-[10px] font-bold
                        tracking-widest uppercase text-primary">
          Enjin Blockchain
        </div>
        <h2 className="text-3xl sm:text-5xl font-bold font-headline text-text mb-4 leading-tight tracking-tight">
          EnjinSight
        </h2>
        <p className="text-sm sm:text-base text-text-secondary max-w-md mx-auto leading-relaxed">
          Monitoring and analytics utilities for the Enjin Blockchain ecosystem.<br className="hidden sm:block" />
          <br className="hidden sm:block" />
          Choose a tool to get started.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 max-w-7xl mx-auto">
        {FEATURES.map(({ key, icon: Icon, title, description, label, resource, disabled }) => (
          <div key={key} className={`bg-surface rounded-xl p-6 sm:p-7 flex flex-col gap-4 transition-colors group
            ${disabled ? 'opacity-60' : 'hover:bg-card cursor-pointer'}
          `}>
            {/* Icon + title */}
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 flex-shrink-0 rounded bg-card flex items-center justify-center
                              text-primary group-hover:bg-surface-bright transition-colors">
                <Icon size={22} />
              </div>
              <h3 className="text-base font-semibold font-headline text-text pt-2 leading-snug">{title}</h3>
            </div>

            {/* Description */}
            <p className="text-sm text-text-secondary leading-relaxed">{description}</p>

            {/* Resource chip + CTA */}
            <div className="mt-auto flex flex-col gap-3">
              <button
                onClick={() => !disabled && onNavigate(key)}
                disabled={disabled}
                className={`btn-primary w-full ${
                  disabled ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                aria-label={label}
              >
                {label}
              </button>
              <span className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded
                               bg-card px-2.5 text-[10px] font-bold text-muted leading-tight
                               tracking-widest uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan/60 flex-shrink-0" />
                <span className="text-center">{resource}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
