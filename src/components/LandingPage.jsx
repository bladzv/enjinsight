/**
 * LandingPage — entry screen shown when view === 'home'.
 * Renders two feature cards: Staking Rewards Cadence and Historical Balance Viewer.
 */
import { BarChart3, LineChart, Layers } from 'lucide-react'

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
]

export default function LandingPage({ onNavigate }) {
  return (
    <div className="pt-5 pb-12 sm:pt-8 sm:pb-20">
      {/* Hero */}
      <div className="text-center mb-10 px-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-5 rounded-full
                        bg-primary/10 border border-primary/25 text-xs font-semibold
                        tracking-widest uppercase text-primary">
          Enjin Blockchain
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold text-text mb-4 leading-tight">
          EnjinSight
        </h2>
        <p className="text-sm sm:text-base text-dim max-w-md mx-auto leading-relaxed">
          Monitoring and analytics utilities for the Enjin Blockchain ecosystem.<br className="hidden sm:block" />
          <br className="hidden sm:block" />
          Choose a tool to get started.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 max-w-5xl mx-auto">
        {FEATURES.map(({ key, icon: Icon, title, description, label, resource }) => (
          <div key={key} className="card flex flex-col gap-5 p-6 sm:p-7 hover:border-primary/40 transition-colors">
            {/* Icon + title */}
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary/15 border border-primary/30
                              flex items-center justify-center">
                <Icon size={20} className="text-primary" />
              </div>
              <h3 className="text-base font-semibold text-text pt-1.5 leading-snug">{title}</h3>
            </div>

            {/* Description */}
            <p className="text-sm text-dim leading-relaxed flex-1 text-justify">{description}</p>

            {/* Resource chip + CTA */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => onNavigate(key)}
                className="btn-primary focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label={label}
              >
                {label}
              </button>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                               bg-surface border border-border text-[11px] font-medium text-muted
                               tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan/60 flex-shrink-0" />
                Data Source: {resource}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
