<p align="center">
  <img src="./public/android-chrome-192x192.png" alt="EnjinSight logo" width="96" height="96" />
  <br />
  <img src="./public/assets/brand/enjinsight_brand.png" alt="EnjinSight" width="320" />
</p>

> **Disclaimer:** EnjinSight is unofficial, third-party tooling and is not developed by or affiliated with the Enjin development team. It is a read-only research aid assembled from public chain data and indexer APIs. Verify important operational, accounting, or tax decisions against your own records.

<p align="center">
  <a href="https://enjinsight.vercel.app/"><img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-enjinsight.vercel.app-00C7B7?style=flat-square&logo=vercel&logoColor=white" /></a>
  <a href="https://github.com/bladzv/enjinsight/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bladzv/enjinsight/ci.yml?branch=main&style=flat-square&label=CI&logo=github-actions&logoColor=white" /></a>
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/bladzv/enjinsight?style=flat-square" /></a>
</p>

<p align="center">
  <strong>A read-only, no-wallet analytics suite for the Enjin ecosystem.</strong><br />
  Era metrics · Staking cadence · Historical balances · Reward history · ERC-20 ENJ infusion checks
</p>

---

## Overview

EnjinSight is a React/Vite monitoring suite for Enjin-related chain research. It provides five browser tools and an offline Python CLI. The web app does not require a wallet connection or transaction signing.

Data comes from:

- Enjin archive WebSocket RPC nodes for balances, era context, and reward-history computation
- Subscan API through a same-origin proxy for staking cadence and reward-event lookups
- Etherscan API and optional Alchemy Ethereum RPC through same-origin serverless routes for ENJ Infusion checks
- Bundled era reference CSV files for fast date/era/block mapping

| Tool | Description |
|------|-------------|
| **Era Block Explorer** | Live relaychain era/session/block metrics and past-era lookup from bundled era CSV data |
| **Staking Rewards Cadence** | Validator and nomination-pool reward cadence scans with missed-era severity analysis |
| **Historical Balance Viewer** | Archive-node balance history over block, era, or date ranges with charts and export/import |
| **Reward History Viewer** | Per-era nomination-pool reward estimates for a relaychain address |
| **ENJ Infusion Checker** | ERC-20 ENJ infusion lookup for Ethereum ERC-1155 token IDs or wallet holdings |
| **EnjinSight CLI** | Offline Python CLI for era lookup, staking cadence, balances, rewards, ENJ Infusion, and exports |

## Live Site

**<https://enjinsight.vercel.app/>**

## Browser Tools

### Era Block Explorer

- Subscribes to Enjin Relaychain block updates.
- Displays active era, session, current block, era boundaries, blocks remaining, timestamps, and progress.
- Includes a live EKG-style canvas that reacts to new blocks.
- Looks up past eras from `public/relay-era-reference.csv`.
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
- Samples validator era stats to derive era block ranges.
- Fetches `reward_slash` events and explains missing pool reward eras.
- Provides expandable pool cards, nominated-validator detail tables, and pool summaries.

### Historical Balance Viewer

- Supports Enjin Matrixchain, Enjin Relaychain, Canary Matrixchain, Canary Relaychain, and custom endpoints.
- Validates SS58 address prefixes for known networks.
- Supports block-range and date-range queries where era references are available.
- Queries `System.Account` at historical block hashes and SCALE-decodes legacy and current account formats.
- Streams rows into the table while the query runs.
- Provides Chart.js visualizations, sortable/paginated tables, text-size controls, and chart height zoom.
- Exports and imports JSON, CSV, and XML.
- Supports optional AES-256-GCM encrypted exports/imports.

### Reward History Viewer

- Computes per-era staking reward estimates for an Enjin Relaychain address.
- Supports manual era ranges and date presets.
- Queries member sENJ balance and pool supply at era start blocks through archive RPC.
- Fetches reinvested reward events from Subscan `reward_slash`.
- Provides a unified filterable/sortable/paginated table and a chart that reacts to filters.
- Summarizes total reward, average APY, reward eras, pool count, best APY era, and best pool.
- Exports and imports JSON, CSV, and XML with optional encryption.
- See [`docs/reward-history-computation.md`](./docs/reward-history-computation.md) for formula details and limitations.

### ENJ Infusion Checker

- Reads ERC-20 ENJ infusion for Ethereum ERC-1155 token IDs from contract `0xfaafdc07907ff5120a76b34b731b278c38d6043c`.
- Accepts either a raw token ID or an Etherscan NFT URL.
- Supports wallet scans by reconstructing current token holdings from Etherscan ERC-1155 transfer history.
- Uses a same-origin Ethereum RPC route that tries Alchemy first when `ALCHEMY_ETH_RPC_URL` is configured, then falls back to Etherscan `proxy/eth_call`.
- Falls back to public Ethereum RPC endpoints from the browser when the same-origin route cannot answer.
- Shows process cards, a sticky terminal log, per-token retry for failed reads, sortable/filterable bulk results, token detail modals, and Etherscan links.
- Notes that wallet token lists can be incomplete; use Token ID scan when a token is missing.

## Tech Stack

| Layer | Package / Platform |
|-------|--------------------|
| UI framework | React 18 |
| Build tool | Vite 7 |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React |
| Charts | Chart.js |
| Fonts | Space Grotesk, Inter, JetBrains Mono |
| Crypto | `@noble/hashes`, Web Crypto API AES-256-GCM |
| Address utilities | `@polkadot/util-crypto` |
| Chain APIs | `@polkadot/api`, archive WebSocket RPC, Subscan, Etherscan, optional Alchemy |
| Unit tests | Vitest |
| Production hosting | Vercel static build + serverless function |
| Local development | Vite dev server + dev middleware/proxy |

## Project Structure

```text
.
├── api/
│   └── [...proxy].js             # Vercel serverless proxy for Subscan, Etherscan, and Ethereum RPC calls
├── docs/
│   ├── SECURITY.md
│   ├── STAKING_REWARDS_RESEARCH.md
│   ├── STAKING_RPC_DOCS.md
│   ├── STAKING_SCRIPT_DOCS.md
│   ├── nomination_pool_api_reference.md
│   ├── nomination_pool_scan_sample_data.md
│   ├── reward-history-computation.md
│   ├── technical_reference.md
│   ├── validator_reward_checker_PRD_v1.md
│   ├── vercel_deployment_guide.md
├── public/
│   ├── relay-era-reference.csv
│   ├── canary-relay-era-reference.csv
│   ├── era-explorer.html
│   ├── assets/brand/enjinsight_brand.png
│   ├── android-chrome-192x192.png
│   ├── android-chrome-512x512.png
│   ├── apple-touch-icon.png
│   ├── enjin-logo.png
│   ├── nft-placeholder.svg
│   └── favicon / manifest assets
├── scripts/
│   ├── enjinsight_cli.py
│   ├── staking-rewards-rpc.py
│   ├── relay-era-range-fetch.py
│   ├── canary-era-range-fetch.py
│   ├── balance-lookup-explorer.py
│   ├── token-lookup-explorer.py
│   ├── relay-pool-interactions.py
│   ├── find_era_start.py
│   └── matrixchain-media-downloader.py
├── src/
│   ├── components/
│   │   ├── AppHeader.jsx
│   │   ├── LandingPage.jsx
│   │   ├── DisclaimerModal.jsx
│   │   ├── DetailModal.jsx
│   │   ├── PhaseProgressCards.jsx
│   │   ├── TerminalLog.jsx
│   │   ├── EraBlockExplorer.jsx
│   │   ├── BalanceExplorer.jsx
│   │   ├── RewardHistoryViewer.jsx
│   │   ├── InfusionChecker.jsx
│   │   ├── ValidatorCard.jsx / PoolCard.jsx
│   │   └── supporting tables, charts, import, and export panels
│   ├── hooks/
│   │   ├── useValidatorChecker.js
│   │   ├── usePoolChecker.js
│   │   ├── useBalanceExplorer.js
│   │   ├── useEraExplorer.js
│   │   └── useRewardHistory.js
│   ├── utils/
│   │   ├── api.js
│   │   ├── substrate.js
│   │   ├── rpc.js
│   │   ├── eraRpc.js
│   │   ├── eraCache.js
│   │   ├── eraAnalysis.js
│   │   ├── balanceExport.js
│   │   ├── chainInfo.js
│   │   ├── format.js
│   │   └── probeProxy.js
│   ├── App.jsx
│   ├── constants.js
│   ├── index.css
│   └── main.jsx
├── .env.example
├── index.html
├── package.json
├── tailwind.config.js
├── vercel.json
└── vite.config.js
```

## Local Development

### Prerequisites

- Node.js `>=18 <25`
- Subscan API key for staking cadence and reward-history Subscan calls
- Etherscan API key for ENJ Infusion wallet discovery, token metadata, and Etherscan RPC fallback
- Optional Alchemy Ethereum RPC URL for ENJ Infusion's preferred server-side `eth_call` provider

### Setup

```bash
git clone https://github.com/bladzv/enjinsight.git
cd enjinsight
npm ci
cp .env.example .env
# Edit .env with the server-side API values you need.
npm run dev
```

Open `http://localhost:5173`.

### Environment Variables

Do not prefix these values with `VITE_`; they must not be embedded into the browser bundle.

| Variable | Required For | Description |
|----------|--------------|-------------|
| `SUBSCAN_API_KEY` | Staking cadence, reward-history Subscan calls | Injected server-side into Subscan requests. |
| `ETHERSCAN_API_KEY` | ENJ Infusion wallet scan, token details, Etherscan RPC fallback | Used server-side for Etherscan V2 API calls. |
| `ALCHEMY_ETH_RPC_URL` | Optional ENJ Infusion preferred RPC and wallet-scan fallback | Full HTTPS Alchemy Mainnet RPC URL, for example `https://eth-mainnet.g.alchemy.com/v2/<key>`. |
| `OPENSEA_API_KEY` | ENJ Infusion metadata fallback when on-chain URI is empty/unreachable | Server-side OpenSea API key used only by `api/[...proxy].js`. |
| `OPENSEA_API_KEY_EXPIRES_AT` | Optional operations metadata | ISO-8601 timestamp used for ops visibility and rotation checks. |
| `PROXY_ALLOWLIST` | Optional proxy hardening | Comma-separated allowed upstream hostnames for encoded Subscan proxy targets. Defaults to `enjin.api.subscan.io`. |
| `PROXY_SECRET` | Optional proxy hardening | If set, encoded-target proxy calls require matching `x-proxy-secret`. Browser app flows generally leave this unset. |

### NPM Scripts

```bash
npm run dev      # Vite HMR dev server
npm run build    # Production build to dist/
npm run preview  # Preview production build locally
npm run test     # Vitest unit tests
npm run lint     # Placeholder lint script
```

## Proxy and API Routes

The browser never receives Subscan, Etherscan, or Alchemy secrets. Local development uses Vite middleware/proxy behavior; production uses `api/[...proxy].js` on Vercel.

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
- Uses Alchemy first when configured
- Falls back to Etherscan `proxy/eth_call`
- Returns an `X-RPC-Provider` header so the terminal log can show whether Alchemy or Etherscan answered

The ENJ Infusion metadata path:

- Uses on-chain `uri(tokenId)` and token URI JSON as the first source
- Falls back to OpenSea metadata when on-chain URI metadata is empty/unreachable
- Applies provider throttles in serverless runtime: 3 req/s for Etherscan/Alchemy paths, 1 req/s for OpenSea metadata requests

Balance and era archive queries use WebSocket RPC directly from the browser because they do not require secrets.

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

The `scripts/` directory includes a full CLI and maintenance utilities.

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

### Data Maintenance

| Script | Purpose |
|--------|---------|
| `relay-era-range-fetch.py` | Updates `public/relay-era-reference.csv` |
| `canary-era-range-fetch.py` | Updates `public/canary-relay-era-reference.csv` |
| `staking-rewards-rpc.py` | Legacy interactive per-era reward lookup |
| `relay-pool-interactions.py` | Nomination-pool interaction research helper |
| `find_era_start.py` | Era boundary research helper |
| `matrixchain-media-downloader.py` | Matrixchain media download helper |

### Educational Explorers

| Script | Purpose |
|--------|---------|
| `balance-lookup-explorer.py` | Prints each step of SS58 decoding, storage-key construction, and account storage decoding |
| `token-lookup-explorer.py` | Prints storage-key construction and token discovery steps for relay and matrix workflows |

## Security

| Concern | Mitigation |
|---------|------------|
| API key exposure | Secrets are read server-side only; no `VITE_` secret variables |
| Subscan SSRF | Encoded target validation plus hostname allowlist |
| Etherscan / Alchemy exposure | Browser calls same-origin routes; API keys remain in Vercel or local Node context |
| Generic RPC abuse | `/api/eth-call` validates `eth_call` and restricts target contract |
| Body size abuse | Serverless proxy rejects request bodies over 32 KB |
| Header injection | Proxy strips API key, forwarding, and hop-by-hop headers |
| XSS | React JSX escaping; no `dangerouslySetInnerHTML` in app UI |
| BigInt precision | ENJ values are held as BigInt base units and formatted only for display |
| Export encryption | AES-256-GCM with PBKDF2-SHA-256 |
| Import validation | File size and extension checks plus field sanitization |
| Browser hardening | Security headers in `vercel.json` |

Full security policy: [`docs/SECURITY.md`](./docs/SECURITY.md)

## Deployment

The app is deployed on Vercel as a static Vite build plus one serverless catch-all API function.

### Vercel Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `SUBSCAN_API_KEY` | Yes for staking and reward-history Subscan calls | Set in Vercel project environment variables |
| `ETHERSCAN_API_KEY` | Yes for ENJ Infusion wallet scan/details and Etherscan RPC fallback | Set in Vercel project environment variables |
| `ALCHEMY_ETH_RPC_URL` | Recommended for ENJ Infusion reliability and wallet fallback coverage | Full HTTPS Ethereum Mainnet Alchemy RPC URL |
| `OPENSEA_API_KEY` | Recommended for ENJ Infusion metadata enrichment | Server-side only; used for metadata fallback when URI metadata is empty/unreachable |
| `OPENSEA_API_KEY_EXPIRES_AT` | Optional but recommended | Track key expiry for operations and scheduled rotation visibility |
| `PROXY_ALLOWLIST` | Optional | Defaults to `enjin.api.subscan.io` |
| `PROXY_SECRET` | Optional | Usually unset for the browser app |

Vercel config:

- `api/[...proxy].js` max duration: 10 seconds
- Global security headers
- Immutable cache headers for built assets
- Special `SAMEORIGIN` frame header for `public/era-explorer.html`

Full deployment notes: [`docs/vercel_deployment_guide.md`](./docs/vercel_deployment_guide.md)

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes and pull requests to `main` and `master`:

1. Install dependencies with `npm ci`
2. Run `npm run lint`
3. Run `npm run test`
4. Run `npm run build`

## License

MIT — see [`LICENSE`](./LICENSE).
