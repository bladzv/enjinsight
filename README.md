# EnjinSight

<p align="center">
  <a href="https://enjinsight.vercel.app/"><img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-Vercel-111111?style=flat-square&logo=vercel" /></a>
  <a href="https://enjinsight.vercel.app/"><img alt="enjinsight.vercel.app" src="https://img.shields.io/badge/enjin--status--checker.vercel.app-online-00C7B7?style=flat-square" /></a>
  <a href="https://github.com/bladzv/enjinsight/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bladzv/enjinsight/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/bladzv/enjinsight?style=flat-square" /></a>
</p>

A read-only, static-frontend monitoring suite for the Enjin Blockchain. It bundles four independent on-chain tools:

1. **Era Block Explorer** — real-time era/session/block metrics + historical era lookup with UTC/local time toggle.
2. **Staking Rewards Cadence** — scans validators and nomination pools for missing reward payouts using the Subscan API.
3. **Historical Balance Viewer** — queries any address balance over a block or date range via archive-node WebSocket RPC, with chart visualisation and encrypted export/import.
4. **Reward History Viewer** — computes per-era staking rewards across all nomination pools for a given relaychain address, with interactive table, chart, and encrypted export/import.

## Live Site

https://enjinsight.vercel.app/

## What It Does

### Era Block Explorer

- Real-time display of active era, session, current block, era start/end block, blocks remaining, and era progress
- EKG canvas animation that pulses on each new block
- **Relaychain** badge in the status bar
- Past Era Lookup: enter any era number → instant start/end block, timestamps, block hash from the bundled CSV; toggle UTC ↔ local time
- Powered by `relay-era-reference.csv` covering 1,007+ eras (era 1, June 2023, onwards)
- Sticky terminal log at page bottom

### Staking Rewards Cadence

**Validator mode**
- Step 0 — probes all required Subscan endpoints to verify reachability and API key validity before the scan begins
- Step 1 — fetches the full active validator list, ordered by total bonded
- Step 2 — fetches up to 100 nominators per validator
- Step 3 — fetches era statistics for each validator and computes missed eras, consecutive gaps, and severity ratings
- Displays expandable validator cards with per-era tables, a summary section, and a terminal-style log

**Nomination pool mode**
- Step 0 — endpoint probe (same as validator mode)
- Step 1 — fetches all nomination pools (multi-page, up to 100 per page)
- Step 2 — resolves the validators nominated by each pool
- Step 3 — derives era block-range boundaries by sampling a subset of validators
- Step 4 — fetches `reward_slash` events for each pool and confirms or explains missing reward eras
- Explains expected no-reward cases (e.g. pool has no nominated validators, pool is in waiting state)

### Historical Balance Viewer

- Connects to preset archive-node WebSocket endpoints (Matrixchain, Relaychain, Canary Matrixchain, Canary Relaychain)
- Address prefix validation: `ef`=Matrixchain, `en`=Relaychain, `cx`=Canary Matrixchain, `cn`=Canary Relaychain
- Queries `System.Account` storage at each sampled block via `state_getStorageAt`
- SCALE-decodes both the legacy (misc+fee frozen) and the new (frozen+flags) `AccountInfo` formats
- **Block range mode** — enter start/end block numbers + step
- **Date range mode** (Relaychain, auto-selected) — pick UTC dates; resolved to blocks via era CSV; step in "every N days"
- **Quick date presets** — 1 week, 1 month, 3 months, 6 months, 1 year (highlighted when active; cleared on manual edit)
- Real-time table population during query; table visible immediately as records stream in
- Stacked bar / per-field line chart with crosshair, smart tooltip, and height zoom
- Paginated, sortable balance history table (10/25/50/100/250 rows per page; text-size zoom)
- Export to **JSON / CSV / XML** (plain or **AES-256-GCM encrypted**); re-import offline; import stays on import tab
- Progress bar and activity log during query; cancellable at any time

### Reward History Viewer

- Computes per-era staking rewards for an Enjin Relaychain address (`en…`) across all nomination pools
- Input: era range (manual) or date range (quick presets: 1 week / 1 month / 3 months / 6 months / 1 year)
- Queries member sENJ balance and pool supply at each era's start block via archive-node WebSocket RPC
- Fetches reinvested ENJ amounts from Subscan `reward_slash` events for the pool stash in post-era blocks
- **Unified interactive table**: all eras × all pools, filterable by pool and era range, sortable columns, paginated
- **Line chart** reactive to table filter state (one line per pool)
- **Summary section**: total reward, avg APY, era range, eras with rewards, pool count, best APY era, best pool
- Export to **JSON / CSV / XML** (plain or **AES-256-GCM encrypted**); re-import offline
- Sticky terminal log always visible
- See `docs/reward-history-computation.md` for APY formula analysis and known limitations

### UI/UX
- Landing page: 4-column card grid on desktop (xl+), 2-column on tablet, 1-column on mobile
- In-app navigation with breadcrumb and back button
- **URL hash routing** — active tool persists across page refreshes (`#staking`, `#balance`, `#era`, `#reward-history`)
- Gradient progress bar + phase step list on all scanning tools
- Sticky terminal log drawer always visible at the bottom of tool pages
- Expandable cards, paginated tables, terminal-style log with timestamps
- Mobile and desktop responsive; fully static — no back-end server required
- WCAG AA-compliant colour contrast throughout

## Tech Stack

| Layer | Package |
|---|---|
| UI framework | React 18 |
| Build tool | Vite 7 |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React (tree-shaken) |
| Charts | Chart.js (lazy-loaded) |
| Fonts | Sora (body) + JetBrains Mono (code/table) |
| Crypto | @noble/hashes (blake2b), Web Crypto API (AES-256-GCM) |
| Address utils | @polkadot/util-crypto (SS58 encode/decode) |
| Unit tests | Vitest |
| Proxy (production) | Vercel serverless (`api/[...proxy].js`) |
| Proxy (development) | Vite dev-server proxy (`vite.config.js`) |

## Project Structure

```txt
.
├── api/
│   └── [...proxy].js       # Vercel serverless proxy — injects API key server-side,
│                           # enforces PROXY_ALLOWLIST, 32 KB body limit
├── docs/
│   ├── SECURITY.md                              # Security policy and vulnerability reporting
│   ├── enjin_reward_tracker_PRD_v3.1.md         # PRD v3.1 — per-era ENJ reward tracker
│   ├── enjin_reward_tracker_prototype.jsx        # UI prototype reference for reward tracker PRD
│   ├── nomination_pool_api_reference.md          # Nomination pool API guide (concept + endpoints)
│   ├── nomination_pool_scan_sample_data.md       # Captured sample responses from a full pool scan
│   ├── ui_design_system.md                       # Dark-tech UI/UX design system reference
│   ├── validator_reward_checker_PRD_v1.md        # PRD v1 — validator reward checker (original)
│   └── vercel_deployment_guide.md               # Step-by-step Vercel deployment instructions
├── public/
│   ├── era-explorer.html   # Standalone era block explorer page (iframe target)
│   ├── era-reference.csv   # Era → block/timestamp/hash reference dataset (era 1–1006)
│   └── site.webmanifest
├── src/
│   ├── components/
│   │   ├── AppHeader.jsx           # Sticky header with breadcrumb navigation
│   │   ├── LandingPage.jsx         # Tool selection home screen
│   │   ├── ModeSelector.jsx        # Validators / Nomination Pools tab bar
│   │   ├── ControlPanel.jsx        # Era-count input + CHECK/STOP/RESET button
│   │   ├── ValidatorCard.jsx       # Expandable per-validator result card
│   │   ├── PoolCard.jsx            # Expandable per-pool result card
│   │   ├── SummarySection.jsx      # Aggregate staking-scan summary
│   │   ├── PoolSummarySection.jsx  # Aggregate pool-scan summary
│   │   ├── EraStatTable.jsx        # Per-era missed-reward table
│   │   ├── NominatorsTable.jsx     # Nominator exposure table
│   │   ├── PoolRewardTable.jsx     # Pool reward events table
│   │   ├── PoolValidatorsTable.jsx # Validators nominated by a pool
│   │   ├── TerminalLog.jsx         # Timestamped activity log
│   │   ├── BalanceExplorer.jsx     # Historical Balance Viewer — main container
│   │   ├── BalanceChart.jsx        # Chart.js balance history chart
│   │   ├── BalanceTable.jsx        # Sortable balance history table
│   │   ├── BalanceExportPanel.jsx  # JSON / CSV / XML export (with encryption)
│   │   ├── BalanceImportPanel.jsx  # Drag-and-drop file import (with decryption)
│   │   ├── EraBlockExplorer.jsx    # Era Block Explorer — real-time metrics + past era lookup
│   │   └── RewardHistoryViewer.jsx # Reward History Viewer — compute/import/export rewards
│   ├── hooks/
│   │   ├── useValidatorChecker.js  # State machine for validator scanning
│   │   ├── usePoolChecker.js       # State machine for pool scanning
│   │   ├── useBalanceExplorer.js   # State machine for balance queries
│   │   ├── useEraExplorer.js       # State machine for era block explorer
│   │   └── useRewardHistory.js     # State machine for reward history computation
│   ├── utils/
│   │   ├── api.js          # Fetch wrapper, request queue, typed helpers, allowlist
│   │   ├── eraAnalysis.js  # Missed-era detection, consecutive-gap grouping, severity
│   │   ├── format.js       # BigInt ENJ formatting, address truncation, explorer URLs
│   │   ├── substrate.js    # SS58 decode, storage-key builder, SCALE AccountInfo decoder
│   │   ├── balanceExport.js# Export serialisers (JSON/CSV/XML), AES-256-GCM, safe filenames
│   │   └── probeProxy.js   # Endpoint probe utility
│   ├── App.jsx             # Root component — view routing, mode switching, layout
│   ├── constants.js        # All config values: endpoints, timeouts, batch sizes, networks
│   └── main.jsx
├── .env.example            # Environment variable template
├── vercel.json             # Vercel function config + security response headers
├── vite.config.js          # Build config + dev-server proxy
└── package.json
```

## Local Development

### Prerequisites

- Node.js ≥ 18
- A [Subscan API key](https://support.subscan.io/hc/en-us/articles/900004171346) (required for the Staking scanner — Subscan enforces `x-api-key` on all requests; not required for the Balance Viewer which uses public RPC)

### Setup

```bash
git clone https://github.com/bladzv/enjinsight.git
cd enjinsight
npm ci
cp .env.example .env
# edit .env and set SUBSCAN_API_KEY=<your key>
npm run dev
```

Open `http://localhost:5173`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUBSCAN_API_KEY` | Yes (staking scanner) | Subscan API key. **Never use `VITE_` prefix** — this key must not appear in the browser bundle. In dev it is read by `vite.config.js` at config time and injected into Vite's dev-server proxy. In production it is set as a Vercel Environment Variable and injected by the serverless proxy. |
| `PROXY_ALLOWLIST` | No | Comma-separated hostnames the proxy may forward to. Defaults to `enjin.api.subscan.io` if unset (SSRF-safe). |
| `PROXY_SECRET` | No | If set, the proxy requires an `x-proxy-secret` request header matching this value. |

### Scripts

```bash
npm run dev      # Vite HMR dev server (http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # preview production build locally
npm run lint     # ESLint
npm run test     # Vitest unit tests
```

## How the Proxy Works

All Subscan requests are routed through a same-origin proxy so the API key is **never exposed in the browser bundle**.

```
Browser
  └── POST /api/<encodeURIComponent(https://enjin.api.subscan.io/...)>
        │
        ├── Local dev (npm run dev):
        │         Vite dev-server proxy (vite.config.js)
        │         decodes target, rewrites path, injects x-api-key from SUBSCAN_API_KEY
        │         ──→ no external proxy server required
        │
        └── Production on Vercel (https://enjinsight.vercel.app):
                  Vercel serverless function (api/[...proxy].js)
                  decodes target, validates hostname against PROXY_ALLOWLIST,
                  enforces 32 KB body limit, injects x-api-key from SUBSCAN_API_KEY,
                  strips client-supplied x-api-key and forwarding headers
                  ──→ no external proxy server required
```

`buildUrl()` in `api.js` always constructs `/api/<encodedUrl>` — direct Subscan requests are never made from the browser regardless of environment.

**The Cloudflare Worker proxy described in [`PROXY.md`](./PROXY.md) is only needed if you deploy this app to a static-only host** (e.g. GitHub Pages, plain Nginx, Cloudflare Pages without a Worker) that cannot run serverless functions. For local development and for Vercel deployments, the proxy is handled automatically — no external proxy setup is required.

The Balance Viewer connects via WebSocket **directly** from the browser to public archive nodes (no proxy needed); those connections never carry any secret.

## Scan Phases (Step 0–N)

### Validator scan (4 steps)

| Step | Phase key | Description |
|---|---|---|
| 0 | `probe` | Probe all 3 required endpoints with an empty `{}` body. HTTP 200 (even Subscan code 400 "EOF") = pass. HTTP 404 = wrong path. HTTP 401/403 = invalid API key. |
| 1 | `list` | `POST /api/scan/staking/validators` — fetch all active validators |
| 2 | `nominators` | `POST /api/scan/staking/nominators` — fetch up to 100 nominators per validator |
| 3 | `eras` | `POST /api/scan/staking/era_stat` — fetch era stats, compute missed eras and gaps |

### Pool scan (5 steps)

| Step | Phase key | Description |
|---|---|---|
| 0 | `probe` | Probe all 3 required endpoints |
| 1 | `list` | `POST /api/scan/nomination_pool/pools` — paginate all pools |
| 2 | `validators` | `POST /api/scan/staking/voted` — resolve nominated validators per pool |
| 3 | `ranges` | Sample up to 3 validators with `era_stat` to derive era block-range boundaries |
| 4 | `rewards` | `POST /api/v2/scan/account/reward_slash` — confirm reward events per pool era |

### Balance query (single operation)

| Phase | Description |
|---|---|
| Connect | Opens a WebSocket to the selected archive-node endpoint with a 10 s timeout |
| Query | Iterates over the block range at the given step, calling `state_getStorageAt` per block; capped at 2 000 RPC calls |
| Decode | SCALE-decodes `AccountInfo` per block, detecting legacy vs new frozen-flags format |
| Done / Cancel | Closes WebSocket cleanly; cancellation mid-query still saves partial results |

## Security Notes

- **Read-only** — no wallet connection, no transaction signing, no user data stored
- **API key never in bundle** — `SUBSCAN_API_KEY` has no `VITE_` prefix; the browser JS never contains the key
- **Path allowlist** — `buildUrl()` throws if the requested path is not in `ENDPOINTS`; the proxy also validates the decoded hostname against `PROXY_ALLOWLIST` (defaults to `enjin.api.subscan.io` — not open SSRF)
- **Body size limit** — the Vercel proxy rejects request bodies larger than 32 KB, preventing DoS via memory exhaustion
- **Raw body forwarding** — the Vercel proxy uses `bodyParser: false` and buffers the raw body unchanged to prevent double-serialisation
- **Header stripping** — the proxy removes `x-api-key`, forwarding headers (`x-forwarded-for`, `x-real-ip`, etc.) and hop-by-hop headers before forwarding to upstream
- **BigInt arithmetic** — all ENJ values use `BigInt` throughout; conversion to human-readable strings only happens in `format.js` at render time, preventing IEEE 754 precision loss on Planck values (10¹⁸ per ENJ)
- **No `dangerouslySetInnerHTML`** — all output is rendered through React's JSX escaping
- **External links** — all `<a>` tags to Subscan explorer use `rel="noopener noreferrer"`
- **Export encryption** — AES-256-GCM with PBKDF2-SHA-256 (100,000 iterations) via the browser's Web Crypto API
- **Import validation** — file size capped at 10 MB; extension checked against an allowlist; all parsed fields sanitised before use
- **WCAG AA contrast** — all text colours meet the 4.5:1 minimum contrast ratio against their backgrounds
- **Security headers** — `vercel.json` sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy` on every response
- **Touch security** — `touch-action: manipulation` on interactive elements prevents double-tap exploits and the 300 ms iOS tap delay

## Deployment

- Live production is deployed on Vercel.
- Full deployment notes: [`docs/vercel_deploy.md`](./docs/vercel_deploy.md)
- Security policy: [`docs/SECURITY.md`](./docs/SECURITY.md)

### Required Vercel environment variables

| Variable | Notes |
|---|---|
| `SUBSCAN_API_KEY` | Set in Vercel dashboard → Project → Settings → Environment Variables |
| `PROXY_ALLOWLIST` | Optional; defaults to `enjin.api.subscan.io` if not set |

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `main`:
1. Install dependencies (`npm ci`)
2. Audit dependencies (`npm audit --audit-level=high`)
3. Lint (`npm run lint`)
4. Test (`npm run test`)
5. Build (`npm run build`)

## License

MIT. See [`LICENSE`](./LICENSE).

