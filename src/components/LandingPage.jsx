import { ArrowUpRight, BarChart3, Gem, LineChart, Layers, TrendingUp } from 'lucide-react'

const TOOLS = [
  {
    key: 'era',
    code: '01',
    icon: Layers,
    title: 'Era Block Explorer',
    description:
      'Inspect era / session / block live, then resolve any historical era to its boundary blocks and timestamps.',
    inputs: ['Relaychain WS-RPC', 'CSV era reference'],
    output: 'Era boundary metadata',
  },
  {
    key: 'staking',
    code: '02',
    icon: BarChart3,
    title: 'Staking Rewards Cadence',
    description:
      'Scan validators or nomination pools across the last N eras for missed payouts. Surface severity, drill into per-era detail.',
    inputs: ['Subscan API', 'Validator / pool list'],
    output: 'Cadence report + severity',
  },
  {
    key: 'balance',
    code: '03',
    icon: LineChart,
    title: 'Historical Balance Viewer',
    description:
      'Query free / reserved / frozen balances over a block, era, or date range. Chart, decimate, export — encrypted if you need it.',
    inputs: ['Archive WS-RPC', 'SS58 address'],
    output: 'JSON · CSV · XML (AES-GCM)',
  },
  {
    key: 'reward-history',
    code: '04',
    icon: TrendingUp,
    title: 'Reward History Viewer',
    description:
      'Compute per-era pool rewards from sENJ balances, plot growth and APY by pool, and export the ledger.',
    inputs: ['Archive WS-RPC', 'Subscan reward events'],
    output: 'Per-era ledger + APY',
  },
  {
    key: 'infusion',
    code: '05',
    icon: Gem,
    title: 'ENJ Infusion Checker',
    description:
      'Read ERC-20 ENJ infusion for ERC-1155 token IDs or full Ethereum wallets. Bulk scan, retry, download metadata.',
    inputs: ['Ethereum JSON-RPC', 'Etherscan'],
    output: 'Infusion table per token',
  },
]

export default function LandingPage({ onNavigate }) {
  return (
    <div className="space-y-8 sm:space-y-10">
      {/* ── Index header ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-white/[0.06] pb-6 sm:pb-7">
        <h1 className="font-headline text-[2.4rem] font-bold leading-[1.04] tracking-tightest text-text sm:text-[3rem] lg:text-[3.4rem]">
          Read-only telemetry<br className="hidden sm:block" /> for the Enjin chain.
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
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{TOOLS.length} entries</span>
        </div>

        <ul className="divide-y divide-white/[0.05] border-y border-white/[0.05]">
          {TOOLS.map(tool => (
            <li key={tool.key}>
              <button
                type="button"
                onClick={() => onNavigate(tool.key)}
                className="group grid w-full grid-cols-[auto_1fr_auto] items-start gap-4 px-1 py-5 text-left transition-colors hover:bg-white/[0.02] sm:grid-cols-[auto_1fr_auto_auto] sm:gap-6 sm:px-2"
                aria-label={`Open ${tool.title}`}
              >
                {/* code + icon */}
                <div className="flex shrink-0 items-center gap-3 pt-1">
                  <span className="font-mono text-[11px] tabular-nums text-muted">{tool.code}</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-white/[0.06] bg-card text-text-secondary transition-colors group-hover:border-primary/40 group-hover:text-primary">
                    <tool.icon size={16} strokeWidth={2} />
                  </span>
                </div>

                {/* title + description */}
                <div className="min-w-0 space-y-1.5">
                  <p className="font-headline text-[18px] font-semibold leading-tight tracking-tight text-text sm:text-[19px]">
                    {tool.title}
                  </p>
                  <p className="max-w-2xl text-[13.5px] leading-[1.6] text-text-secondary">
                    {tool.description}
                  </p>
                  {/* metadata row */}
                  <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
                    <div className="flex items-center gap-1.5">
                      <dt className="opacity-70">Input</dt>
                      <dd className="text-text-secondary">{tool.inputs.join(' · ')}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="opacity-70">Out</dt>
                      <dd className="text-text-secondary">{tool.output}</dd>
                    </div>
                  </dl>
                </div>

                {/* status pill (desktop only) */}
                <span className="hidden self-center rounded-sm border border-success/35 bg-success/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-success sm:inline-flex">
                  Online
                </span>

                {/* open arrow */}
                <span className="shrink-0 self-center text-text-secondary transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary">
                  <ArrowUpRight size={18} strokeWidth={2} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Trust strip ──────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Operating principles">
        {[
          { tag: 'A', label: 'Read-only',   body: 'Holds no keys, signs no transactions, runs no backend store.' },
          { tag: 'B', label: 'Public data', body: 'Powered entirely by public Substrate / Subscan / Etherscan endpoints.' },
          { tag: 'C', label: 'Verify',      body: 'Treat every output as a research aid — reconcile against your own records.' },
        ].map(item => (
          <article key={item.label} className="flex items-start gap-3 rounded-sm border border-white/[0.06] bg-card p-4">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-white/[0.08] font-mono text-[10px] text-muted">
              {item.tag}
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-text">{item.label}</p>
              <p className="text-[13px] leading-5 text-text-secondary">{item.body}</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
