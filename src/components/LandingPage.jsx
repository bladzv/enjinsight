import { ArrowRight, BarChart3, LineChart, Layers, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react'

const FEATURES = [
  {
    key: 'era',
    icon: Layers,
    title: 'Era Block Explorer',
    description:
      'Explore historical era and session boundaries on the Enjin Relaychain. Look up start and end blocks, UTC timestamps, and archival references without leaving the app.',
    label: 'Launch Explorer',
    resource: 'Relaychain RPC Endpoint',
    accent: 'text-primary',
    glow: 'from-primary/20 to-transparent',
  },
  {
    key: 'staking',
    icon: BarChart3,
    title: 'Staking Rewards Cadence',
    description:
      'Scan validators and nomination pools for missing reward payouts across recent eras, surface severity, and inspect nominator exposure with live logs.',
    label: 'View Cadence',
    resource: 'Subscan API Endpoint',
    accent: 'text-cyan',
    glow: 'from-cyan/20 to-transparent',
  },
  {
    key: 'balance',
    icon: LineChart,
    title: 'Historical Balance Viewer',
    description:
      'Query any Enjin address against archive-node RPC, then visualize free, reserved, and frozen balances over block, era, or date ranges.',
    label: 'Track Address',
    resource: 'Archive RPC Endpoint',
    accent: 'text-warning',
    glow: 'from-warning/20 to-transparent',
  },
  {
    key: 'reward-history',
    icon: TrendingUp,
    title: 'Reward History Viewer',
    description:
      'Compute pool reward history per era, inspect cumulative growth, and export structured reports for analysis, bookkeeping, and audit trails.',
    label: 'Audit History',
    resource: 'Archive RPC + Subscan',
    accent: 'text-success',
    glow: 'from-success/20 to-transparent',
  },
]

const SIGNALS = [
  { label: 'Tool Modules', value: '4', tone: 'text-primary' },
  { label: 'Access Mode', value: 'Read-only', tone: 'text-cyan' },
  { label: 'Wallet Required', value: 'None', tone: 'text-success' },
  { label: 'Sources', value: 'RPC + Subscan', tone: 'text-text' },
]

export default function LandingPage({ onNavigate }) {
  return (
    <div className="space-y-8 pb-12 pt-8 sm:space-y-10 sm:pb-16 sm:pt-10 lg:space-y-12 lg:pt-14">
      <section className="page-hero">
        <div className="relative z-10 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-end">
          <div className="space-y-6">
            <div className="space-y-5 max-w-2xl">
              <h2 className="hero-title text-balance">
                Enjin blockchain analytics with a sharper lens.
              </h2>
              <p className="hero-copy">
                Read-only monitoring utilities for the Enjin ecosystem, designed to make dense on-chain data feel legible.
                Jump straight into era tracking, staking diagnostics, balance archaeology, or reward audits.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[360px]">
            {SIGNALS.map(signal => (
              <div
                key={signal.label}
                className="metric-card p-4 backdrop-blur-sm text-sm flex flex-col justify-center"
              >
                <p className="metric-label">{signal.label}</p>
                <p className={`metric-value text-lg ${signal.tone}`}>{signal.value}</p>
              </div>
            ))}
          </div>
          
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-label">Toolset</p>
            <h3 className="section-title">Choose an analytics workflow</h3>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map(({ key, icon: Icon, title, description, label, resource, accent, glow }) => (
            <article
              key={key}
              className="group relative overflow-hidden rounded-[1.5rem] border border-white/6 bg-surface p-6 shadow-ambient transition-transform duration-200 hover:-translate-y-1"
            >
              <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${glow} opacity-80`} />
              <div className="relative z-10 flex h-full flex-col gap-5">
                <div className="flex items-start justify-between gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-card ${accent}`}>
                    <Icon size={22} />
                  </div>
                  <span className="mini-chip">{resource}</span>
                </div>

                <div className="space-y-3">
                  <h4 className="font-headline text-2xl font-bold leading-tight text-text">{title}</h4>
                  <p className="text-sm leading-6 text-text-secondary">{description}</p>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-text-secondary">
                    <ShieldCheck size={12} className="text-success" />
                    No Wallet Required
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(key)}
                    className="btn-secondary px-4 py-2 text-xs"
                    aria-label={label}
                  >
                    {label}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
