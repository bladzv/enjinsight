<p align="center">
  <img src="./public/assets/brand/enjinsight-logo.png" alt="EnjinSight logo" width="96" height="96" />
  <br />
  <img src="./public/assets/brand/enjinsight-wordmark-512.png" alt="EnjinSight" width="320" />
</p>

<p align="center">
  <a href="https://enjinsight.vercel.app/"><img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-enjinsight.vercel.app-00C7B7?style=flat-square&logo=vercel&logoColor=white" /></a>
  <a href="https://github.com/bladzv/enjinsight/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bladzv/enjinsight/ci.yml?branch=main&style=flat-square&label=CI&logo=github-actions&logoColor=white" /></a>
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/bladzv/enjinsight?style=flat-square" /></a>
</p>

<p align="center">
  <strong>A read-only, no-wallet analytics suite for the Enjin ecosystem.</strong><br />
  Era metrics · Staking cadence · Historical balances · Reward history · ERC-20 ENJ infusion checks
</p>

> **Disclaimer:** EnjinSight is unofficial, third-party tooling and is not developed by or affiliated with the Enjin development team. It is a read-only research aid assembled from public chain data and indexer APIs. Verify important operational, accounting, or tax decisions against your own records.

---

## Overview

EnjinSight is a React/Vite monitoring suite for Enjin-related chain research. It provides five browser tools and an offline Python CLI. The web app never connects a wallet and never signs a transaction.

| Tool | Description |
|------|-------------|
| **Era Block Explorer** | Live relaychain era/session/block metrics and past-era lookup from bundled era CSV data |
| **Staking Rewards Cadence** | Validator and nomination-pool reward cadence scans with missed-era severity analysis |
| **Historical Balance Viewer** | Archive-node balance history over block, era, or date ranges with charts and export/import |
| **Reward History Viewer** | Per-era nomination-pool reward estimates for a relaychain address |
| **ENJ Infusion Checker** | ERC-20 ENJ infusion lookup for Ethereum ERC-1155 token IDs or wallet holdings |
| **EnjinSight CLI** | Offline Python CLI for era lookup, staking cadence, balances, rewards, ENJ Infusion, and exports |

Data comes from:

- Enjin archive WebSocket RPC nodes for balances, era context, and reward-history computation
- Subscan API through a same-origin proxy for staking cadence and reward-event lookups
- Etherscan API and optional Alchemy Ethereum RPC through same-origin serverless routes for ENJ Infusion checks
- Bundled era reference CSV files for fast date/era/block mapping

**Live site: <https://enjinsight.vercel.app/>**

## Quick Start

### Prerequisites

- Node.js `>=20.12.0 <25` (CI builds on Node 22)
- Subscan API key for staking cadence and reward-history Subscan calls
- Etherscan API key for ENJ Infusion wallet discovery, token metadata, and Etherscan RPC fallback
- Optional Alchemy Ethereum RPC URL for ENJ Infusion's preferred server-side `eth_call` provider
- Optional OpenSea API key for ENJ Infusion token images, descriptions, and traits

```bash
git clone https://github.com/bladzv/enjinsight.git
cd enjinsight
npm ci
cp .env.example .env
# Edit .env — see Configuration below.
npm run dev
```

Open `http://localhost:5173`. Era Explorer, Historical Balance Viewer, and Reward History work without any API key, because they talk to public archive WebSocket RPC directly.

## Browser Tools

### Era Block Explorer

- Subscribes to Enjin Relaychain block updates.
- Displays active era, session, current block, era boundaries, blocks remaining, timestamps, and progress.
- Includes a live EKG-style canvas that reacts to new blocks.
- Looks up past eras from `public/relay-era-reference.csv`, deriving each era's end block from the next era's start.
- Supports UTC/local timestamp toggling.
- Includes a sticky terminal log.

### Staking Rewards Cadence

Validator mode:

- Probes required Subscan endpoints before scanning.
- Fetches active validators ordered by total bonded.
- Fetches nominators per validator.
- Fetches era stats and computes missed eras, consecutive gaps, and severity.
- Shows expandable validator cards, per-era reward tables, and aggregate summaries.

Nomination pool mode:

- Paginates all nomination pools.
- Resolves nominated validators per pool.
- Samples validator era stats to derive era block ranges, with an archive-RPC fallback.
- Fetches `reward_slash` events and explains missing pool reward eras.
- Provides expandable pool cards, nominated-validator detail tables, and pool summaries.
- Filters results by severity and status through the shared results filter bar.

### Historical Balance Viewer

- Supports Enjin Matrixchain, Enjin Relaychain, Canary Matrixchain, Canary Relaychain, and custom endpoints.
- Validates SS58 address prefixes for known networks.
- Supports block-range and date-range queries where era references are available.
- Queries `System.Account` at historical block hashes and SCALE-decodes legacy and current account formats.
- Streams rows into the table while the query runs.
- Provides Chart.js visualizations, sortable/paginated tables, text-size controls, and chart height zoom.
- Exports and imports JSON, CSV, and XML, with optional AES-256-GCM encryption.

### Reward History Viewer

- Computes per-era staking reward estimates for an Enjin Relaychain address.
- Supports manual era ranges and date presets.
- Queries member sENJ balance and pool supply at era start blocks through archive RPC.
- Scans `NominationPools` reward events over archive RPC, net of pool operator commission.
- Provides a unified filterable/sortable/paginated table and a chart that reacts to filters.
- Summarizes total reward, average APY, reward eras, pool count, best APY era, and best pool.
- Exports and imports JSON, CSV, and XML with optional encryption.
- See [`docs/reward-history-computation.md`](./docs/reward-history-computation.md) for formula details and limitations, and [`docs/nomination_pool_reward_accounting_fix.md`](./docs/nomination_pool_reward_accounting_fix.md) for the commission accounting rules.

### ENJ Infusion Checker

- Reads ERC-20 ENJ infusion for Ethereum ERC-1155 token IDs from contract `0xfaafdc07907ff5120a76b34b731b278c38d6043c`.
- Accepts either a raw token ID or an Etherscan NFT URL.
- Supports wallet scans by reconstructing current token holdings from Etherscan ERC-1155 transfer history.
- Uses a same-origin Ethereum RPC route that tries Alchemy first when `ALCHEMY_ETH_RPC_URL` is configured, then falls back to Etherscan `proxy/eth_call`.
- Falls back to public Ethereum RPC endpoints from the browser when the same-origin route cannot answer.
- Shows process cards, a sticky terminal log, per-token retry for failed reads, sortable/filterable bulk results, token detail modals, and Etherscan links.
- Wallet token lists can be incomplete; use Token ID scan when a token is missing.

## Shared Tool UI and Export/Import

Every tool except Era Block Explorer shares one UI spine:

- [`src/components/ToolModeStrip.jsx`](./src/components/ToolModeStrip.jsx) renders the `Query | Import` tabs.
- [`src/components/ImportDropPanel.jsx`](./src/components/ImportDropPanel.jsx) is the drop zone, extension/size check, and decrypt flow behind `BalanceImportPanel`, `RewardImportPanel`, and `ScanImportPanel`. A new import format is added by writing an `inspect` / `onFile` / `onDecrypt` trio for this panel, not a new panel from scratch.
- [`src/components/ToolInfoSection.jsx`](./src/components/ToolInfoSection.jsx) renders the explanatory strip shown above the tabs in both modes.

Every export from all five tools carries the shared header defined in [`src/utils/scanEnvelope.js`](./src/utils/scanEnvelope.js):

```json
{ "tool": "enjinsight", "schema": "...", "schemaVersion": 1, "appVersion": "...", "exportedAt": "..." }
```

| Tool | Payload shape | Module | Import cap |
|------|---------------|--------|------------|
| Staking Cadence, ENJ Infusion | Header plus nested `meta` / `data` | `src/utils/scanExport.js` | `MAX_SCAN_IMPORT_MB` — 64 MB |
| Balance Viewer, Reward History | Header spread across the existing flat shape (`_rpcConfig` / `_meta` plus `records`) | `src/utils/balanceExport.js` | `MAX_IMPORT_MB` — 10 MB |

Notes:

- The flat shape is deliberate: a build predating the header still reads a newer file.
- A file with no header at all falls back to a legacy content sniff instead of being refused, so old exports keep working.
- Export controls are hidden whenever `dataSource === 'import'` — an import is a snapshot of a past run, and a re-export would be indistinguishable from an original.
- All formats support optional AES-256-GCM encryption with PBKDF2-SHA-256 key derivation.

## Configuration

Copy `.env.example` to `.env` for local development, and set the same values as Vercel project environment variables for deployment. **Do not prefix these with `VITE_`** — they must never be embedded into the browser bundle.

| Variable | Required for | Scope | Description |
|----------|--------------|-------|-------------|
| `SUBSCAN_API_KEY` | Staking cadence, reward-history Subscan calls | Local + Vercel | Injected server-side into Subscan requests. |
| `ETHERSCAN_API_KEY` | ENJ Infusion wallet scan, token details, Etherscan RPC fallback | Local + Vercel | Used server-side for Etherscan V2 API calls. |
| `ALCHEMY_ETH_RPC_URL` | Recommended for ENJ Infusion reliability and wallet-scan fallback coverage | Local + Vercel | Full HTTPS Alchemy Mainnet RPC URL, e.g. `https://eth-mainnet.g.alchemy.com/v2/<key>`. |
| `OPENSEA_API_KEY` | ENJ Infusion token image, description, and traits | Local + Vercel | OpenSea is the primary source for those fields and a fallback name source; on-chain `typeData` remains primary for name and quantity. Without it the app still resolves names and quantities on-chain, but images and descriptions stay blank. |
| `PROXY_ALLOWLIST` | Optional proxy hardening | Local + Vercel | Comma-separated allowed upstream hostnames for encoded Subscan proxy targets. Defaults to `enjin.api.subscan.io`. |
| `ALLOWED_ORIGINS` | Optional, only for a custom domain | Vercel | Comma-separated extra origins allowed to call the proxy cross-origin. The deployment's own Vercel URLs and localhost (outside production) are added automatically. An unlisted origin gets a hard 403 on every route. |
| `PROXY_SECRET` | Optional proxy hardening | Local + Vercel | If set, every proxy request requires a matching `x-proxy-secret` header. Leave unset for the browser app — it gates every route and no in-repo client sends the header. |

## Proxy and API Routes

The browser never receives Subscan, Etherscan, Alchemy, or OpenSea secrets. Local development uses Vite middleware/proxy behavior; production uses `api/[...proxy].js` on Vercel.

| Browser Route | Purpose | Upstream |
|---------------|---------|----------|
| `POST /api/<encoded-url>` | Encoded Subscan proxy for staking and reward-history API calls | `https://enjin.api.subscan.io` |
| `GET /api/enj-wallet-tokens?address=...` | Current ERC-1155 token discovery for ENJ Infusion wallet scans | Etherscan `account/token1155tx`, Alchemy `alchemy_getAssetTransfers` fallback |
| `GET /api/enj-token-details?owner=...&tokenId=...` | Token creator, owner quantity, URI, and metadata enrichment with OpenSea fallback | Etherscan `proxy/eth_call`, `contract/getcontractcreation`, token URI JSON, OpenSea NFT API |
| `POST /api/eth-call` | Same-origin `eth_call` for ENJ Infusion contract reads | Alchemy when configured, then Etherscan fallback |
| `GET /__enj-wallet-tokens` | Local dev equivalent | Vite middleware |
| `GET /__enj-token-details` | Local dev equivalent | Vite middleware |
| `POST /__eth-call` | Local dev equivalent | Vite middleware |

The encoded Subscan proxy:

- Validates target hostnames against `PROXY_ALLOWLIST`
- Enforces a 32 KB request body limit
- Injects `SUBSCAN_API_KEY` server-side
- Strips client-supplied API key, forwarding, and hop-by-hop headers
- Applies lightweight per-process rate limiting and response caching for selected Subscan paths

The ENJ Infusion Ethereum RPC route:

- Accepts only JSON-RPC `eth_call`
- Restricts calls to the configured ERC-1155 contract
- Uses Alchemy first when configured, falling back to Etherscan `proxy/eth_call`
- Returns an `X-RPC-Provider` header so the terminal log can show which provider answered

The ENJ Infusion metadata path:

- Uses on-chain `uri(tokenId)` and token URI JSON as the first source
- Falls back to OpenSea metadata when on-chain URI metadata is empty or unreachable
- Applies provider throttles in the serverless runtime: 3 req/s for Etherscan/Alchemy paths, 1 req/s for OpenSea metadata requests

Balance and era archive queries use WebSocket RPC directly from the browser because they require no secrets.

Full proxy notes: [`PROXY.md`](./PROXY.md)

## Architecture

### Design rules

- No global state — each tool is isolated in its own `useReducer` hook.
- The API key never reaches the browser; it is injected server-side by the proxy.
- New Subscan endpoints go into `ENDPOINTS` in `src/constants.js`, which auto-allowlists them in the proxy.
- No `innerHTML` — all user content flows through React JSX.
- ENJ amounts are always `BigInt` Planck values, formatted only for display.
- Every async scan is cancellable through an `AbortController`, and every WebSocket is closed in a `finally` block.

### Tech stack

| Layer | Package / Platform |
|-------|--------------------|
| UI framework | React 18 |
| Build tool | Vite 8 |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React |
| Charts | Chart.js |
| Fonts | Inter, Inter Tight, JetBrains Mono |
| Crypto | `@noble/hashes`, Web Crypto API AES-256-GCM |
| Address utilities | `@polkadot/util-crypto` |
| Chain APIs | `@polkadot/api`, archive WebSocket RPC, Subscan, Etherscan, optional Alchemy |
| Unit tests | Vitest |
| Lint | ESLint 10 with `react-hooks` and `jsx-a11y` |
| Production hosting | Vercel static build + serverless function |
| Local development | Vite dev server + dev middleware/proxy |

### Project structure

```text
.
├── api/[...proxy].js          # Vercel serverless proxy: Subscan, Etherscan, Ethereum RPC
├── docs/                      # Security policy, research notes, API references, deployment guide
├── public/
│   ├── assets/brand/          # Eye mark, wordmark, and combined lockup
│   ├── relay-era-reference.csv        # Era boundary reference loaded at startup
│   ├── canary-relay-era-reference.csv
│   ├── rewards-era-reference.csv
│   ├── era-explorer.html      # Standalone legacy explorer page
│   └── favicon / manifest / nft-placeholder assets
├── scripts/                   # Python CLI, data-maintenance and educational explorer scripts
├── src/
│   ├── components/
│   │   ├── AppHeader.jsx  LandingPage.jsx  DisclaimerModal.jsx
│   │   ├── EraBlockExplorer.jsx  BalanceExplorer.jsx
│   │   ├── RewardHistoryViewer.jsx  InfusionChecker.jsx
│   │   ├── ToolModeStrip.jsx  ImportDropPanel.jsx  ToolInfoSection.jsx
│   │   ├── TerminalLog.jsx  PhaseProgressCards.jsx  ResultsFilterBar.jsx
│   │   └── ...                # Cards, tables, charts, export/import panels, primitives
│   ├── hooks/                 # One hook per tool: useEraExplorer, useValidatorChecker,
│   │                          # usePoolChecker, useBalanceExplorer, useRewardHistory
│   ├── utils/
│   │   ├── api.js  rpc.js  eraRpc.js  eraCache.js  probeProxy.js
│   │   ├── substrate.js       # SS58/SCALE utilities, storage keys, balance decoders
│   │   ├── scanEnvelope.js    # Shared export header + validation (imports nothing)
│   │   ├── scanExport.js  balanceExport.js
│   │   ├── eraAnalysis.js  rewardMath.js  stakingFilter.js  infusionPhases.js
│   │   └── format.js  chainInfo.js  navigationLock.js
│   ├── App.jsx  constants.js  index.css  main.jsx
│   └── **/*.test.js(x)        # Vitest suites colocated with the code under test
├── .env.example  index.html  package.json
├── eslint.config.js  tailwind.config.js  vercel.json  vite.config.js
└── CLAUDE.md  AGENTS.md  DESIGN.md  PROXY.md
```

## Scan Phases

### Validator scan

| Step | Phase | Description |
|------|-------|-------------|
| 0 | Probe endpoints | Verifies API path and key behavior before scanning |
| 1 | Fetch validators | Loads active validators |
| 2 | Fetch nominators | Loads nominators for validator context |
| 3 | Fetch era stats | Computes missed eras, consecutive gaps, and severity |

### Nomination pool scan

| Step | Phase | Description |
|------|-------|-------------|
| 0 | Probe endpoints | Verifies API path and key behavior |
| 1 | Fetch pools | Paginates nomination pools |
| 2 | Fetch nominated validators | Resolves validators per pool |
| 3 | Resolve era ranges | Samples validator era stats for block ranges |
| 4 | Confirm rewards | Fetches reward/slash events per pool era |

### Balance query

| Phase | Description |
|-------|-------------|
| Connect | Opens an archive WebSocket connection |
| Query | Iterates blocks and calls historical storage RPC |
| Decode | SCALE-decodes account data |
| Done / Cancel | Closes cleanly and preserves partial results when stopped |

### ENJ Infusion scan

| Step | Phase | Description |
|------|-------|-------------|
| 0 | Validate token / fetch wallet tokens | Parses a token ID or discovers current wallet token IDs |
| 1 | Fetch metadata | Reads token URI metadata, then OpenSea fallback if needed |
| 2 | Read infusions | Calls `typeData(uint256)` through Ethereum RPC providers |
| 3 | Review results | Displays totals, raw values, retry controls, and detail modals |

## Python Scripts

The `scripts/` directory holds a full offline CLI and maintenance utilities.

### Requirements

```bash
pip install requests websockets python-dotenv rich
pip install certifi              # optional TLS improvement
pip install cryptography         # optional encrypted export support
pip install substrate-interface  # required by staking-rewards-rpc.py
```

### Main CLI

```bash
python scripts/enjinsight_cli.py
```

The CLI offers interactive access to era lookup, staking cadence scans, balance history, reward-history workflows, and ENJ Infusion token or wallet scans. It supports cancellation, rich terminal output, provider logs, and JSON/CSV/XML exports.

### Data maintenance

| Script | Purpose |
|--------|---------|
| `relay-era-range-fetch.py` | Updates `public/relay-era-reference.csv` (also run weekly by CI) |
| `canary-era-range-fetch.py` | Updates `public/canary-relay-era-reference.csv` |
| `staking-rewards-rpc.py` | Legacy interactive per-era reward lookup |
| `relay-pool-interactions.py` | Nomination-pool interaction research helper |
| `find_era_start.py` | Era boundary research helper |
| `matrixchain-media-downloader.py` | Matrixchain media download helper |

### Educational explorers

| Script | Purpose |
|--------|---------|
| `balance-lookup-explorer.py` | Prints each step of SS58 decoding, storage-key construction, and account storage decoding |
| `token-lookup-explorer.py` | Prints storage-key construction and token discovery steps for relay and matrix workflows |

## Development

```bash
npm run dev      # Vite HMR dev server on http://localhost:5173
npm run build    # Production build to dist/
npm run preview  # Preview the production build locally
npm run test     # Vitest unit tests
npm run lint     # eslint . --max-warnings=0
```

### Testing

Vitest suites live next to the code they cover (`*.test.js`, `*.test.jsx`, `*.dom.test.jsx`) and run in a jsdom environment with Testing Library. Coverage focuses on SCALE decoding and storage keys (`substrate`), reward math and era analysis, export/import envelopes and round-trips, the proxy request layer, and the shared UI primitives (`ToolModeStrip`, `ImportDropPanel`, `TerminalLog`, `StepProgress`, `HoldButton`, `PillSwitch`).

Lint runs with zero tolerance for warnings, so a warning fails CI the same way an error does.

## Security

| Concern | Mitigation |
|---------|------------|
| API key exposure | Secrets are read server-side only; no `VITE_` secret variables |
| Subscan SSRF | Encoded target validation plus hostname allowlist |
| Etherscan / Alchemy / OpenSea exposure | Browser calls same-origin routes; API keys remain in Vercel or the local Node context |
| Generic RPC abuse | `/api/eth-call` validates `eth_call` and restricts the target contract |
| Body size abuse | Serverless proxy rejects request bodies over 32 KB |
| Header injection | Proxy strips API key, forwarding, and hop-by-hop headers |
| XSS | React JSX escaping; no `dangerouslySetInnerHTML` in app UI |
| BigInt precision | ENJ values are held as BigInt base units and formatted only for display |
| Export encryption | AES-256-GCM with PBKDF2-SHA-256 |
| Import validation | File size and extension checks plus field sanitization |
| Browser hardening | Security headers in `vercel.json` |

Full security policy: [`docs/SECURITY.md`](./docs/SECURITY.md)

## Deployment

The app is deployed on Vercel as a static Vite build plus one serverless catch-all API function. Set the variables from [Configuration](#configuration) as Vercel project environment variables.

Vercel config:

- `api/[...proxy].js` max duration: 10 seconds
- Global security headers
- Immutable cache headers for built assets
- Special `SAMEORIGIN` frame header for `public/era-explorer.html`

Full deployment notes: [`docs/vercel_deployment_guide.md`](./docs/vercel_deployment_guide.md)

## CI

Two GitHub Actions workflows:

**`.github/workflows/ci.yml`** — runs on pushes and pull requests to `main` and `master`, on Node 22:

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npm run lint`
4. `npm run test`
5. `npm run build`

**`.github/workflows/update-era-reference.yml`** — weekly cron (Monday 00:00 UTC) plus manual dispatch. Runs `scripts/relay-era-range-fetch.py` against `wss://archive.relay.blockchain.enjin.io` and commits any change to `public/relay-era-reference.csv`.

## License

MIT — see [`LICENSE`](./LICENSE).
