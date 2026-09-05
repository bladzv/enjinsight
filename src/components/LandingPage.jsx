import { ArrowUpRight, BarChart3, Gem, LineChart, Layers, TrendingUp } from 'lucide-react'
import Reveal from './Reveal.jsx'

const TOOLS = [
  {
    key: 'era',
    icon: Layers,
    title: 'Era Block Explorer',
    description:
      'Inspect era / session / block live, then resolve any historical era to its boundary blocks and timestamps.',
    source: 'Relaychain WS-RPC · CSV era reference',
  },
  {
    key: 'staking',
    icon: BarChart3,
    title: 'Staking Rewards Cadence',
    description:
      'Scan validators or nomination pools across the last N eras for missed payouts. Surface severity, drill into per-era detail.',
    source: 'Subscan API · Validator / pool list',
  },
  {
    key: 'balance',
    icon: LineChart,
    title: 'Historical Balance Viewer',
    description:
      'Query free / reserved / frozen balances over a block, era, or date range. Chart, decimate, export — encrypted if you need it.',
    source: 'Archive WS-RPC · SS58 address',
  },
  {
    key: 'reward-history',
    icon: TrendingUp,
    title: 'Reward History Viewer',
    description:
      'Compute per-era pool rewards from sENJ balances, plot growth and APY by pool, and export the ledger.',
    source: 'Archive WS-RPC · Subscan reward events',
  },
  {
    key: 'infusion',
    icon: Gem,
    title: 'ENJ Infusion Checker',
    description:
      'Read ERC-20 ENJ infusion for ERC-1155 token IDs or full Ethereum wallets. Bulk scan, retry, download metadata.',
    source: 'Ethereum JSON-RPC · Etherscan',
  },
]

export default function LandingPage({ onNavigate }) {
  return (
    <div className="space-y-8 sm:space-y-10">
      {/* ── Index header ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-white/[0.06] pb-6 sm:pb-7">
        <h1 className="font-headline text-[2.4rem] font-bold leading-[1.04] tracking-tightest text-text sm:text-[3rem] lg:text-[3.4rem]">
          Enjin Chain Telemetry
        </h1>

        <p className="max-w-2xl text-[15px] leading-[1.65] text-text-secondary">
          Five focused inspection tools — era boundaries, staking cadence, archive balances, pool rewards,
          and ERC-20 ENJ infusion.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => onNavigate('era')}
            className="btn-primary"
          >
            Open Era Explorer
          </button>
          <button
            type="button"
            onClick={() => onNavigate('staking')}
            className="btn-secondary"
          >
            Run staking scan
          </button>
        </div>
      </header>

      {/* ── Tool index — list, not card grid ─────────────────────────── */}
      <section aria-labelledby="tools-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="tools-heading" className="section-label">// Tool index</h2>
        </div>

        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-4 lg:gap-4">
          {TOOLS.map((tool, i) => (
            <Reveal as="li" key={tool.key} index={i} className="h-full lg:col-span-2 lg:last:col-start-2">
              <button
                type="button"
                onClick={() => onNavigate(tool.key)}
                className="tool-card group grid h-full w-full grid-cols-[auto_1fr_auto] items-start gap-4 rounded-sm border border-white/[0.06] bg-surface px-4 py-5 text-left transition hover:bg-white/[0.02] sm:gap-6 sm:px-5"
                aria-label={`Open ${tool.title}`}
              >
                {/* code + icon */}
                <div className="flex shrink-0 items-center gap-3 pt-1">
                  <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-white/[0.06] bg-card text-text-secondary transition-colors group-hover:border-primary/40 group-hover:text-primary">
                    <tool.icon size={16} strokeWidth={2} />
                  </span>
                </div>

                {/* title + description */}
                <div className="min-w-0 space-y-1.5">
                  <p className="font-headline text-[18px] font-semibold leading-tight tracking-tight text-primary-glow sm:text-[19px]">
                    {tool.title}
                  </p>
                  <p className="max-w-2xl text-[13.5px] leading-[1.6] text-text-secondary">
                    {tool.description}
                  </p>
                  {/* metadata row */}
                  <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
                    <div className="flex items-center gap-1.5">
                      <dt className="opacity-70">Source</dt>
                      <dd className="text-text-secondary">{tool.source}</dd>
                    </div>
                  </dl>
                </div>

                {/* open arrow */}
                <span className="shrink-0 self-center text-text-secondary transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary">
                  <ArrowUpRight size={18} strokeWidth={2} />
                </span>
              </button>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* ── Trust strip ──────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Operating principles">
        {[
          { label: 'Read-only',   body: 'No wallet, no signing, no transactions.' },
          { label: 'Public data', body: 'From public RPC nodes, indexers, and era references.' },
          { label: 'Verify',      body: 'Confirm outputs against your own records.' },
        ].map((item, i) => (
          <Reveal as="article" key={item.label} index={i} className="flex items-start gap-3 rounded-sm border border-white/[0.06] bg-card p-4">
            <div className="min-w-0 space-y-1">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-text">{item.label}</p>
              <p className="text-[13px] leading-5 text-text-secondary">{item.body}</p>
            </div>
          </Reveal>
        ))}
      </section>
    </div>
  )
}
