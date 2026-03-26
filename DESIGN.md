# EnjinSight — Design Document

## Overview

EnjinSight is a read-only monitoring and analytics web application for the Enjin Blockchain ecosystem. It provides four specialized tools that allow anyone — without a wallet or account — to inspect staking health, historical balances, era block boundaries, and staking reward history directly from Enjin's public infrastructure.

The app is built with React 18 + Vite + Tailwind CSS and deployed as a static site on Vercel, with a thin serverless proxy that injects the Subscan API key server-side so it never appears in the browser bundle.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  Era     │  │ Staking  │  │ Balance  │  │Reward  │  │
│  │ Explorer │  │ Cadence  │  │ Viewer   │  │History │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │              │              │     │
│  WS (RPC)      Subscan API    WS (RPC)        WS+API    │
└───────┼──────────────┼──────────────┼──────────────┼───┘
        │              │              │              │
        ▼              ▼              ▼              ▼
  Enjin Relay    /api/[proxy]   Enjin Archive   Archive
  live + archive  (Vercel fn)    node WS         + Subscan
  node WS
```

### Data Sources

| Tool | Primary | Secondary |
|------|---------|-----------|
| Era Block Explorer | Enjin Relay RPC (`wss://rpc.relay.blockchain.enjin.io`) | Archive node for binary-search era start blocks |
| Staking Rewards Cadence | Subscan API (`enjin.api.subscan.io`) via same-origin proxy | — |
| Historical Balance Viewer | Archive node WS (`wss://archive.*.blockchain.enjin.io`) | relay-era-reference.csv for date-mode |
| Reward History Viewer | Archive node WS + Subscan API | relay-era-reference.csv for era boundaries |

### Request Flow (Subscan)

```
Browser → /api/<encoded-url> → Vercel serverless fn → Subscan API
                                  (injects x-api-key)
```

The API key is never exposed in the browser bundle. The proxy enforces:
- HTTPS-only targets
- Hostname allowlist (defaults to `enjin.api.subscan.io`)
- Path allowlist (only whitelisted Subscan endpoints)
- 32 KB body limit
- Hop-by-hop header stripping

---

## Tools

### 0. Landing Page

The home screen presents all four tools as a responsive card grid:
- Desktop (xl+): 4 columns (one per tool in a single row)
- Tablet (sm–xl): 2 columns
- Mobile: 1 column

Each card includes an icon, name, and description. No navigation occurs during an active scan.

---

### 1. Era Block Explorer

**Purpose:** Real-time monitoring of Enjin Relaychain era/session boundaries plus instant lookup of any historical era.

**Capabilities:**
- Connects to both the live RPC node (for real-time block subscription) and the archive node (for binary-search era start block discovery)
- Displays a **Relaychain** badge (cyan pill) in the header bar
- Stat cards: ERA, SESSION, CURRENT BLOCK — each in a distinct card; CURRENT BLOCK renamed from BLOCK
- ERA STARTS and ERA ENDS values wrapped in individual stat cards
- EKG canvas animation that beats on each new block
- Gradient progress bar: `bg-gradient-to-r from-primary-dim via-primary to-cyan`
- Past Era Lookup: enter any era number → returns start block, end block, human-readable dates in UTC or local time; timezone toggle (UTC ↔ Local) in the section header; CSV row count shown beside the heading
- Pre-loads 1,007+ eras from `relay-era-reference.csv` for instant offline lookups
- Debug panel showing raw WS state, pallet keys, decoded hex values
- Sticky terminal log drawer (always visible at page bottom)
- Automatic reconnection with 5 s backoff; periodic 12 s polling as keepalive

**Key Hook:** `useEraExplorer.js`
**Key Component:** `EraBlockExplorer.jsx`

---

### 2. Staking Rewards Cadence

**Purpose:** Scan all active validators or nomination pools for missing reward payouts and identify risk severity.

**Modes:**
- **Validator mode:** Fetches all active validators → nominators per validator → era stats. Detects gaps in era reward history, groups consecutive misses (3+ = critical), calculates severity per validator.
- **Pool mode:** Fetches all nomination pools → each pool's nominated validators → era block ranges (via validator consensus) → reward/slash events per pool. Identifies pools with no active nominees, inactive state, or missing rewards.

**Capabilities:**
- Configurable era window (1–100 eras, default 14)
- Phased progress: gradient progress bar + phase step list (matching Era Block Explorer style)
- Per-validator / per-pool expandable cards with era reward tables
- Retry individual validators/pools on failure
- Summary section: sorted by severity, totals, nominator exposure
- Sticky terminal log
- Abortable scans with graceful stop

**Key Hooks:** `useValidatorChecker.js`, `usePoolChecker.js`
**Key Components:** `ValidatorCard.jsx`, `PoolCard.jsx`, `SummarySection.jsx`, `PoolSummarySection.jsx`

---

### 3. Historical Balance Viewer

**Purpose:** Query and visualize any wallet's free/reserved/frozen balances over a block range or date range, directly from the archive node.

**Capabilities:**
- Multi-network support: Enjin Matrixchain, Enjin Relaychain, Canary Matrixchain, Canary Relaychain (no custom endpoint — preset networks only)
- Address prefix validation: `ef`=Matrixchain, `en`=Relaychain, `cx`=Canary Matrixchain, `cn`=Canary Relaychain
- Block-range mode: enter start/end block numbers + step size
- Date-range mode (Relaychain only — auto-selected, no manual toggle): enter UTC dates → mapped to era boundaries via `relay-era-reference.csv`; step expressed in "every N days" converted to blocks via average blocks-per-era
- Quick date presets (1 day, 1 week, 1 month, 3 months, 6 months, 1 year): highlighted when active, cleared on manual date edit
- Queries `System.Account` storage at each block using `state_getStorageAt`
- SCALE-decodes `AccountInfo` supporting both legacy (misc+fee frozen) and new frozen-flags format
- Real-time table population during query (table shown immediately as records stream in, with "Populating…" indicator)
- Decimation: charts limited to 250 points regardless of query range
- Chart modes: Total (stacked bar), Free, Reserved, Misc Frozen, Fee Frozen (line)
- Chart height zoom (60%–200%)
- Sortable, paginated balance history table (10/25/50/100/250 rows per page; text-size zoom S/M/L)
- Export: JSON, CSV, XML with optional AES-256-GCM encryption (PBKDF2-SHA-256, 100k iterations)
- Import: re-load previously exported data (with optional decryption); stays on import tab showing imported results without switching tab
- WCAG AA colour contrast in all chart colours

**Key Hook:** `useBalanceExplorer.js`
**Key Components:** `BalanceExplorer.jsx`, `BalanceChart.jsx`, `BalanceTable.jsx`, `BalanceExportPanel.jsx`, `BalanceImportPanel.jsx`

---

### 4. Reward History Viewer

**Purpose:** Compute per-era staking rewards for a wallet address across all nomination pools it is a member of. Mirrors the `staking-rewards-rpc.py` script in the browser.

**Address validation:** Requires an Enjin Relaychain address (prefix `en`).

**Input modes:**
- **Era range** — enter start/end era numbers directly
- **Date range** — pick UTC dates from quick presets (1 week, 1 month, 3 months, 6 months, 1 year) or custom dates; resolved to era range via `relay-era-reference.csv`

**Algorithm (replicates staking-rewards-rpc.py):**
```
reward_per_era = (member_sENJ_balance / pool_total_sENJ) × pool_reinvested_ENJ

APY = ((pool_total_sENJ + reinvested) / pool_total_sENJ)^365 − 1
     ⚠ Note: unit mismatch — pool_total_sENJ (sENJ) ≠ reinvested (ENJ).
       See docs/reward-history-computation.md for analysis and corrected formula.
```

**Computation phases:**
1. **Load Era Reference** — fetch `relay-era-reference.csv` for era → {startBlock, blockHash, timestamps}
2. **Connect to Archive Node** — WebSocket to `wss://archive.relay.blockchain.enjin.io`
3. **Discover Pool Membership** — fetch all pools from Subscan; check `MultiTokens.TokenAccounts(collection=1, token=pool_id, address)` at current head to find pools with non-zero sENJ balance
4. **Query Era Balances** — for each era × member pool: read member sENJ and pool total sENJ at era start block hash via `state_getStorage`
5. **Fetch Reinvested Amounts** — query Subscan `reward_slash` for the pool stash address in the event block range (era end block +1 to +41); sum all reward amounts = reinvested ENJ
6. **Compute & Display** — apply the reward formula, compute APY, accumulate totals

**Storage Keys (SCALE, Blake2_128Concat):**
- `MultiTokens.TokenAccounts(u128, u128, AccountId)` → member sENJ balance (first u128 field)
- `MultiTokens.Tokens(u128, u128)` → pool total sENJ supply (first u128 field)

**Capabilities:**
- Era range or date range input with quick presets
- Unified interactive table (all eras × all pools): filter by pool and era range, sortable columns (era, date, pool, member sENJ, reinvested, reward, cumulative, APY), paginated (10/25/50/100 rows)
- Line chart reactive to table filter state: one dataset per pool
- Summary section: total reward, avg APY, era range, eras with reward, pool count, best APY era, best pool
- Export: JSON / CSV / XML with optional AES-256-GCM encryption (same crypto as Balance Viewer)
- Import: drag-and-drop JSON/CSV, encrypted file decryption; imported results shown on the compute tab
- Sticky terminal log always visible at bottom of page
- Abortable at any phase (Stop button)
- No custom endpoint — always uses `wss://archive.relay.blockchain.enjin.io`

**Key Hook:** `useRewardHistory.js`
**Key Component:** `RewardHistoryViewer.jsx`
**Reference:** `docs/reward-history-computation.md` — formula analysis, known APY limitation, corrected approach

---

## Python Scripts

| Script | Purpose |
|--------|---------|
| `staking-rewards-rpc.py` | CLI: compute per-era pool rewards via direct archive RPC. Interactive prompts for address, era range, historic pool data. |
| `era-range-fetch.py` | Builds/maintains `public/relay-era-reference.csv`. Incremental: reads latest era from CSV, appends new eras, back-fills missing hashes/timestamps. |
| `staking-rewards-indexer.py` | Alternative: compute rewards via GraphQL indexer (not RPC). |
| `relay-pool-bulk-extrinsics.py` | Download Subscan extrinsics CSV for a wallet (for historic pool IDs). |
| `find_era_start_temp.py` | Utility: binary-search for a single era's start block. |

---

## Storage Key Construction

Substrate storage keys follow this format:
```
key = twox128(pallet_name) + twox128(storage_item) + [hasher(key1) + key1] + ...
```

The app implements:
- `twox128` via pure BigInt xxHash64 (no external dependency)
- `Blake2_128Concat` via `@noble/hashes` blake2b with 16-byte digest + raw key
- `System.Account` key: `SYS_ACCT_PREFIX + blake2b128(pubkey) + pubkey`
- `MultiTokens.TokenAccounts` key: two u128 keys + AccountId, all Blake2_128Concat
- `MultiTokens.Tokens` key: two u128 keys, Blake2_128Concat

---

## Era Reference CSV

`public/relay-era-reference.csv` covers all Enjin Relaychain eras from era 1 (2023-06-04) onward.

Columns: `era, start_block, end_block, start_block_hash, start_timestamp_unix, start_datetime_utc, end_timestamp_unix, end_datetime_utc`

Updated automatically via GitHub Actions (`update-era-reference.yml`) every Monday at 00:00 UTC.

---

## Security Model

| Concern | Mitigation |
|---------|-----------|
| API key exposure | Injected server-side only; never in browser bundle |
| SSRF / path traversal | Proxy allowlist enforcement; path allowlist in `buildUrl()` |
| XSS | No `innerHTML`; React JSX escaping; manual XML entity escaping in export |
| Injection | All inputs validated/sanitised before use; JSON-serialised bodies |
| CORS abuse | Proxy reflects `Origin`; `Vary: Origin` header |
| Framing | `X-Frame-Options: DENY` globally; `SAMEORIGIN` for era-explorer.html |
| Content sniffing | `X-Content-Type-Options: nosniff` |
| Transport | HSTS (`max-age=63072000; includeSubDomains; preload`) |
| CSP | Strict CSP restricting scripts, styles, fonts, connect-src |
| AES encryption | AES-256-GCM with PBKDF2-SHA-256 (100k iterations) for export data |
| Blob URLs | Revoked after 60 s to avoid memory leaks |

---

## State Management

Each tool is a self-contained React feature using `useReducer` for predictable state transitions. No global state library. Patterns:

- `useReducer` + action dispatch for all async state
- Mutable refs (`useRef`) for WebSocket connections, abort controllers, timers
- `useCallback` for stable function references
- Log arrays capped at 500 entries to prevent memory growth
- `AbortController` for cancellable fetch chains
- WebSocket lifecycle: connect → query → subscribe → periodic poll → reconnect on close

---

## File Structure

```
/
├── api/
│   └── [...proxy].js        # Vercel serverless proxy
├── public/
│   ├── relay-era-reference.csv
│   ├── era-explorer.html    # Standalone era explorer (no React)
│   └── ...
├── scripts/
│   ├── staking-rewards-rpc.py
│   ├── era-range-fetch.py
│   ├── staking-rewards-indexer.py
│   └── relay-pool-bulk-extrinsics.py
├── src/
│   ├── App.jsx              # Root: view routing (home/staking/balance/era/reward-history)
│   ├── constants.js         # API endpoints, network config, tuning constants
│   ├── components/          # UI components (one per tool + shared)
│   ├── hooks/               # Business logic hooks (one per tool)
│   └── utils/               # Shared utilities (api, substrate, format, export)
├── .github/
│   ├── workflows/
│   │   ├── ci.yml           # Build/lint/test on push
│   │   └── update-era-reference.yml  # Weekly CSV update
│   └── custom-prompts.md
├── vercel.json              # Headers, function config
├── vite.config.js           # Build + dev proxy config
└── tailwind.config.js
```

---

## ENJ Precision

All ENJ amounts are represented internally as `BigInt` Planck units:

```
1 ENJ = 10^18 Planck (PLANCK_PER_ENJ = 1_000_000_000_000_000_000n)
```

Displayed with 6 decimal places: `{whole}.{frac6}`

---

## Performance Notes

- Chart decimation: max 250 points regardless of query size
- Log caps: 200 entries (Era Explorer), 500 entries (all other hooks)
- Archive RPC calls rate-limited via `API_DELAY_MS = 1000ms` between sequential requests
- Subscan API: exponential backoff on 429/5xx; max 5 retry attempts
- Blob URLs revoked after 60 s
- Chart.js instances destroyed on component unmount (prevents canvas memory leaks)
- WebSocket keepalive: 12 s polling + 30 s stale-block reconnect trigger
