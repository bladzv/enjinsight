<h1 align="center">EnjinSight</h1>

<p align="center">
  <a href="https://enjinsight.vercel.app/"><img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-enjinsight.vercel.app-00C7B7?style=flat-square&logo=vercel&logoColor=white" /></a>
  <a href="https://github.com/bladzv/enjinsight/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bladzv/enjinsight/ci.yml?branch=main&style=flat-square&label=CI&logo=github-actions&logoColor=white" /></a>
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/bladzv/enjinsight?style=flat-square" /></a>
</p>

<p align="center">
  <strong>A read-only, no-wallet blockchain analytics suite for the Enjin ecosystem.</strong><br />
  Real-time era metrics · Staking cadence detection · Historical balance queries · Per-era reward computation
</p>

---

## Overview

EnjinSight is a static-frontend monitoring suite for the Enjin Blockchain. It bundles four independent on-chain tools that require no wallet, no account, and no backend database. All data is fetched directly from Enjin's public infrastructure — archive-node WebSocket RPC for balance and reward data, and the Subscan API (via a same-origin serverless proxy) for staking analytics.

| Tool | Description |
|------|-------------|
| **Era Block Explorer** | Real-time era/session/block metrics + historical era lookup with UTC/local time toggle |
| **Staking Rewards Cadence** | Scans validators and nomination pools for missing reward payouts |
| **Historical Balance Viewer** | Queries any address balance over a block or date range via archive-node WebSocket RPC |
| **Reward History Viewer** | Computes per-era staking rewards across all nomination pools for a given address |

---

## Live Site

**<https://enjinsight.vercel.app/>**

---

## Tools

### Era Block Explorer

- Connects to the live Enjin Relaychain RPC node for real-time block subscription
- Displays active era, session, current block, era start/end block, blocks remaining, and progress
- EKG canvas animation that pulses on each new block
- **Past Era Lookup** — enter any era number → instant start block, end block, timestamps, and block hash from the bundled CSV; toggle UTC ↔ local time
- Covers 1,007+ eras (era 1, June 2023, onwards) via `relay-era-reference.csv`
- Sticky terminal log at page bottom

### Staking Rewards Cadence

**Validator mode:**
- Probes all required Subscan endpoints before the scan begins
- Fetches the full active validator list, ordered by total bonded
- Fetches up to 100 nominators per validator
- Fetches era statistics and computes missed eras, consecutive gaps, and severity ratings
- Expandable validator cards with per-era reward tables and a summary section

**Nomination pool mode:**
- Fetches all nomination pools (multi-page, up to 100 per page)
- Resolves the validators nominated by each pool
- Derives era block-range boundaries by sampling a subset of validators
- Fetches `reward_slash` events per pool and explains missing reward eras (no nominees, waiting state, etc.)

### Historical Balance Viewer

- Multi-network: Enjin Matrixchain, Enjin Relaychain, Canary Matrixchain, Canary Relaychain
- Address prefix validation: `ef`=Matrixchain, `en`=Relaychain, `cx`=Canary Matrixchain, `cn`=Canary Relaychain
- **Block-range mode** — enter start/end block + step
- **Date-range mode** (Relaychain, auto-selected) — pick UTC dates; resolved to blocks via era CSV; step in "every N days"
- **Quick date presets** — 1 week, 1 month, 3 months, 6 months, 1 year
- Queries `System.Account` storage at each block via `state_getStorageAt`; SCALE-decodes both legacy and new `AccountInfo` formats
- Real-time table population as records stream in
- Stacked bar / per-field line chart with crosshair, smart tooltip, and height zoom
- Paginated, sortable balance history table (10/25/50/100/250 rows per page; text-size zoom)
- Export to **JSON / CSV / XML** (plain or **AES-256-GCM encrypted**); re-import offline

### Reward History Viewer

- Computes per-era staking rewards for an Enjin Relaychain address (`en…`) across all nomination pools
- Input: era range (manual) or date range (quick presets: 1 week / 1 month / 3 months / 6 months / 1 year)
- Queries member sENJ balance and pool supply at each era's start block via archive-node WebSocket RPC
- Fetches reinvested ENJ amounts from Subscan `reward_slash` events for the pool stash in post-era blocks
- **Unified interactive table** — all eras × all pools; filterable, sortable, paginated
- **Line chart** reactive to table filter state (one line per pool)
- **Summary section** — total reward, avg APY, era range, eras with rewards, pool count, best APY era, best pool
- Export to **JSON / CSV / XML** (plain or **AES-256-GCM encrypted**); re-import offline
- See `docs/reward-history-computation.md` for APY formula analysis and known limitations

---

## Tech Stack

| Layer | Package |
|-------|---------|
| UI framework | React 18 |
| Build tool | Vite 7 |
| Styling | Tailwind CSS 3 (Kinetic Ledger design system) |
| Icons | Lucide React (tree-shaken) |
| Charts | Chart.js (lazy-loaded) |
| Fonts | Space Grotesk (headlines) · Inter (body) · JetBrains Mono (code/table) |
| Crypto | @noble/hashes (blake2b) · Web Crypto API (AES-256-GCM) |
| Address utils | @polkadot/util-crypto (SS58 encode/decode) |
| Unit tests | Vitest |
| Proxy (production) | Vercel serverless (`api/[...proxy].js`) |
| Proxy (development) | Vite dev-server proxy (`vite.config.js`) |

---

## Project Structure

```
.
├── api/
│   └── [...proxy].js          # Vercel serverless proxy — injects API key, enforces PROXY_ALLOWLIST, 32 KB body limit
├── docs/
│   ├── SECURITY.md
│   ├── new_design/stitch/     # Kinetic Ledger design mockups and reference HTML
│   ├── reward-history-computation.md
│   ├── technical_reference.md
│   ├── ui_design_system.md
│   └── vercel_deployment_guide.md
├── public/
│   ├── relay-era-reference.csv  # 1,007+ era boundary records (era, blocks, hashes, timestamps)
│   ├── era-explorer.html        # Standalone era explorer (no React)
│   └── site.webmanifest
├── scripts/
│   ├── staking-rewards-rpc.py   # CLI: per-era pool reward computation via archive RPC
│   └── relay-era-range-fetch.py # Builds / updates relay-era-reference.csv
├── src/
│   ├── components/
│   │   ├── AppHeader.jsx           # Sticky header with breadcrumb navigation
│   │   ├── LandingPage.jsx         # Tool selection home screen (4-column card grid)
│   │   ├── ModeSelector.jsx        # Validators / Nomination Pools tab bar
│   │   ├── ControlPanel.jsx        # Era-count input + Run/Stop/Reset buttons
│   │   ├── PhaseProgressCards.jsx  # SVG ring-progress cards for scan phases
│   │   ├── ValidatorCard.jsx       # Expandable per-validator result card
│   │   ├── PoolCard.jsx            # Expandable per-pool result card
│   │   ├── SummarySection.jsx      # Aggregate staking-scan summary
│   │   ├── PoolSummarySection.jsx  # Aggregate pool-scan summary
│   │   ├── TerminalLog.jsx         # Timestamped activity log (500-entry cap)
│   │   ├── BalanceExplorer.jsx     # Historical Balance Viewer — main container
│   │   ├── BalanceChart.jsx        # Chart.js balance history chart
│   │   ├── BalanceTable.jsx        # Sortable balance history table
│   │   ├── BalanceExportPanel.jsx  # JSON / CSV / XML export (with AES-256-GCM encryption)
│   │   ├── BalanceImportPanel.jsx  # File import (with decryption)
│   │   ├── EraBlockExplorer.jsx    # Era Block Explorer — real-time metrics + past era lookup
│   │   └── RewardHistoryViewer.jsx # Reward History Viewer — compute / import / export
│   ├── hooks/
│   │   ├── useValidatorChecker.js  # State machine for validator scanning
│   │   ├── usePoolChecker.js       # State machine for pool scanning
│   │   ├── useBalanceExplorer.js   # State machine for balance queries
│   │   ├── useEraExplorer.js       # State machine for era block explorer
│   │   └── useRewardHistory.js     # State machine for reward history computation
│   ├── utils/
│   │   ├── api.js          # Fetch wrapper, request queue, typed helpers, allowlist
│   │   ├── substrate.js    # SS58 decode, storage-key builder, SCALE AccountInfo decoder
│   │   ├── format.js       # BigInt ENJ formatting, address truncation, explorer URLs
│   │   ├── eraAnalysis.js  # Missed-era detection, consecutive-gap grouping, severity
│   │   ├── balanceExport.js# Serialisers (JSON/CSV/XML), AES-256-GCM, safe filenames
│   │   ├── chainInfo.js    # One-shot WS query for era/block/timestamp metadata
│   │   ├── eraRpc.js       # Binary-search for era start blocks via archive RPC
│   │   └── probeProxy.js   # Lightweight endpoint probe
│   ├── App.jsx             # Root: view routing, mode switching, layout
│   ├── constants.js        # All config: endpoints, timeouts, batch sizes, networks
│   └── main.jsx
├── .env.example            # Environment variable template
├── vercel.json             # Vercel function config + security response headers
├── vite.config.js          # Build config + dev-server proxy
└── package.json
```

---

## Local Development

### Prerequisites

- Node.js ≥ 18
- A [Subscan API key](https://support.subscan.io/hc/en-us/articles/900004171346) (required for the Staking scanner; not required for the Balance or Reward History viewers, which use public archive-node RPC)

### Setup

```bash
git clone https://github.com/bladzv/enjinsight.git
cd enjinsight
npm ci
cp .env.example .env
# Edit .env and set SUBSCAN_API_KEY=<your key>
npm run dev
```

Open `http://localhost:5173`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUBSCAN_API_KEY` | Yes (staking scanner) | Subscan API key. **Never use the `VITE_` prefix** — this key must not appear in the browser bundle. In dev it is read by `vite.config.js` and injected into the Vite dev-server proxy. In production it is set as a Vercel Environment Variable and injected by the serverless proxy. |
| `PROXY_ALLOWLIST` | No | Comma-separated hostnames the proxy may forward to. Defaults to `enjin.api.subscan.io` if unset (SSRF-safe). |
| `PROXY_SECRET` | No | If set, the proxy requires an `x-proxy-secret` request header matching this value. |

### Scripts

```bash
npm run dev      # Vite HMR dev server → http://localhost:5173
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
npm run test     # Vitest unit tests
npm run lint     # ESLint
```

---

## How the Proxy Works

All Subscan requests are routed through a same-origin proxy so the API key is **never exposed in the browser bundle**.

```
Browser
  └── POST /api/<encodeURIComponent(https://enjin.api.subscan.io/...)>
        │
        ├── Local dev (npm run dev):
        │         Vite dev-server proxy (vite.config.js)
        │         decodes target, rewrites path, injects x-api-key from SUBSCAN_API_KEY
        │
        └── Production on Vercel (https://enjinsight.vercel.app):
                  Vercel serverless function (api/[...proxy].js)
                  decodes target, validates hostname against PROXY_ALLOWLIST,
                  enforces 32 KB body limit, injects x-api-key from SUBSCAN_API_KEY,
                  strips client-supplied x-api-key and forwarding headers
```

`buildUrl()` in `api.js` always constructs `/api/<encodedUrl>` — direct Subscan requests are never made from the browser regardless of environment.

The Balance Viewer and Reward History Viewer connect via WebSocket **directly** from the browser to public archive nodes — no proxy needed, no secrets involved.

---

## Scan Phases

### Validator scan (4 steps)

| Step | Phase | Description |
|------|-------|-------------|
| 0 | `probe` | Probe all required endpoints. HTTP 200 = pass; HTTP 401/403 = invalid API key; HTTP 404 = wrong path. |
| 1 | `list` | Fetch all active validators |
| 2 | `nominators` | Fetch up to 100 nominators per validator |
| 3 | `eras` | Fetch era stats, compute missed eras, consecutive gaps, and severity ratings |

### Pool scan (5 steps)

| Step | Phase | Description |
|------|-------|-------------|
| 0 | `probe` | Probe all required endpoints |
| 1 | `list` | Paginate all nomination pools (up to 100 per page) |
| 2 | `validators` | Resolve nominated validators per pool |
| 3 | `ranges` | Sample up to 3 validators with `era_stat` to derive era block-range boundaries |
| 4 | `rewards` | Fetch `reward_slash` events and confirm reward events per pool era |

### Balance query (single operation)

| Phase | Description |
|-------|-------------|
| Connect | Opens a WebSocket to the selected archive-node endpoint (10 s timeout) |
| Query | Iterates over the block range at the given step, calling `state_getStorageAt` per block; capped at 2,000 RPC calls |
| Decode | SCALE-decodes `AccountInfo` per block, detecting legacy vs new frozen-flags format |
| Done / Cancel | Closes WebSocket cleanly; cancellation mid-query still saves partial results |

---

## Security

| Concern | Mitigation |
|---------|-----------|
| API key exposure | Injected server-side only; never in browser bundle (`VITE_` prefix forbidden) |
| SSRF / path traversal | `buildUrl()` allowlist + proxy hostname allowlist |
| XSS | No `innerHTML`, no `dangerouslySetInnerHTML`; React JSX escaping throughout |
| Body size abuse | Vercel proxy rejects bodies > 32 KB |
| Header injection | Proxy strips `x-api-key`, forwarding headers, and hop-by-hop headers |
| BigInt precision | All ENJ values use `BigInt` Planck units; IEEE 754 conversion only at render time |
| Export encryption | AES-256-GCM with PBKDF2-SHA-256 (100,000 iterations) via Web Crypto API |
| Import validation | File size capped at 10 MB; extension allowlisted; all fields sanitised |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS |
| WCAG AA contrast | All text colours meet the 4.5:1 minimum contrast ratio |

Full security policy: [`docs/SECURITY.md`](./docs/SECURITY.md)

---

## Deployment

Deployed on Vercel. Full deployment notes: [`docs/vercel_deployment_guide.md`](./docs/vercel_deployment_guide.md)

### Required Vercel Environment Variables

| Variable | Notes |
|----------|-------|
| `SUBSCAN_API_KEY` | Set in Vercel dashboard → Project → Settings → Environment Variables |
| `PROXY_ALLOWLIST` | Optional; defaults to `enjin.api.subscan.io` if not set |

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `main`:

1. Install dependencies (`npm ci`)
2. Audit dependencies (`npm audit --audit-level=high`)
3. Lint (`npm run lint`)
4. Test (`npm run test`)
5. Build (`npm run build`)

---

## License

MIT — see [`LICENSE`](./LICENSE).
