import { BarChart3, Gem, LineChart, Layers, TrendingUp } from 'lucide-react'

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
  },
  {
    key: 'infusion',
    icon: Gem,
    title: 'ENJ Infusion Checker',
    description:
      'Check ERC-20 ENJ infusion on Ethereum ERC-1155 tokens by token ID, or scan a wallet and total the infused amount across holdings.',
    label: 'Check Infusion',
    resource: 'Ethereum RPC + Etherscan',
    accent: 'text-primary',
  },
]

export default function LandingPage({ onNavigate }) {
  return (
    <div className="space-y-8 pb-12 sm:space-y-10 sm:pb-16 lg:space-y-12">
      <section className="max-w-3xl">
        <p className="text-sm leading-6 text-text-secondary sm:text-base sm:leading-7">
          Read-only monitoring utilities for the Enjin ecosystem, designed to make dense on-chain data feel legible.
          Jump straight into era tracking, staking diagnostics, balance archaeology, reward audits, or ERC-20 ENJ infusion checks.
        </p>
      </section>

      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">Toolset</h3>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {FEATURES.map(({ key, icon: Icon, title, description, label, resource, accent }) => (
            <article
              key={key}
              className="group flex min-h-[19rem] min-w-0 flex-col rounded-[1.25rem] border border-white/6 bg-surface p-5 shadow-ambient transition-all duration-200 hover:-translate-y-1 hover:border-cyan/20 hover:bg-card"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card ${accent}`}>
                  <Icon size={20} />
                </div>
                <h4 className="min-w-0 break-words font-headline text-xl font-bold leading-tight text-text">
                  {title}
                </h4>
              </div>

              <p className="mt-4 text-xs font-semibold leading-5 text-text-secondary">
                <span className="text-text">Source:</span> {resource}
              </p>

              <p className="mt-4 text-sm leading-6 text-text-secondary">
                {description}
              </p>

              <div className="mt-auto flex justify-center pt-6">
                <button
                  type="button"
                  onClick={() => onNavigate(key)}
                  className="btn-secondary px-4 py-2 text-xs"
                  aria-label={label}
                >
                  {label}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
