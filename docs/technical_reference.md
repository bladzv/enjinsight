# EnjinSight — Technical Reference

> Complete technical documentation: process flows, data sources, computation logic, component behaviour, state management, and all hidden workings of the web app. UI-design specifics are intentionally excluded; this document is intended to inform a redesign.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Routing & Navigation](#4-routing--navigation)
5. [Configuration & Constants](#5-configuration--constants)
6. [Security Architecture](#6-security-architecture)
7. [API Proxy Layer](#7-api-proxy-layer)
8. [Utility Modules](#8-utility-modules)
9. [Tool: Era Block Explorer](#9-tool-era-block-explorer)
10. [Tool: Staking Rewards Cadence](#10-tool-staking-rewards-cadence)
11. [Tool: Historical Balance Viewer](#11-tool-historical-balance-viewer)
12. [Tool: Reward History Viewer](#12-tool-reward-history-viewer)
13. [Shared Components](#13-shared-components)
14. [Data Export & Import](#14-data-export--import)
15. [Era Reference CSV](#15-era-reference-csv)
16. [Python Scripts](#16-python-scripts)
17. [Build & Deployment](#17-build--deployment)
18. [Testing](#18-testing)

---

## 1. Project Overview

EnjinSight is a **read-only, static-frontend** React/Vite web application for monitoring and analytics on the Enjin Blockchain. It provides four independent tools:

| Tool | Key | Data Source |
|------|-----|-------------|
| Era Block Explorer | `era` | Relaychain RPC (WebSocket) |
| Staking Rewards Cadence | `staking` | Subscan API (HTTP) |
| Historical Balance Viewer | `balance` | Archive RPC (WebSocket) |
| Reward History Viewer | `reward-history` | Archive RPC + Subscan API |

**Core constraints:**
- No wallet required
- No backend database
- No global state (each tool is isolated)
- API key never exposed to the browser
- All user content rendered via JSX (no `innerHTML`)
- BigInt used for all ENJ/Planck values
- Log arrays capped at 500 entries
- Every async scan is abortable via `AbortController`
- Every WebSocket is closed in a `finally` block

---

## 2. Technology Stack

| Layer | Package | Version |
|-------|---------|---------|
| UI Framework | React | 18.3.1 |
| Build Tool | Vite | 7.3.1 |
| Styling | Tailwind CSS | 3.4.14 |
| Icons | Lucide React | 0.263.1 |
| Charts | Chart.js | 4.5.1 |
| Crypto | @noble/hashes (blake2b) + Web Crypto API (AES-256-GCM) | 1.8.0 |
| Substrate encoding | @polkadot/api, @polkadot/util-crypto | 16.5.6 / 14.0.2 |
| Testing | Vitest | 4.0.18 |
| Serverless proxy | Vercel Serverless (`api/[...proxy].js`) | — |

---

## 3. Project Structure

```
enjinsight/
├── src/
│   ├── App.jsx                    # Main shell: routing, layout, active-scan guard
│   ├── main.jsx                   # React entry point
│   ├── constants.js               # Endpoints, network presets, tuning constants
│   ├── utils/
│   │   ├── api.js                 # Subscan HTTP client, RequestQueue, typed helpers
│   │   ├── substrate.js           # SS58 decode, SCALE decoders, storage key builders
│   │   ├── balanceExport.js       # Serialize/parse JSON/CSV/XML, AES-256-GCM
│   │   ├── eraAnalysis.js         # Missed-era detection, severity classification
│   │   ├── format.js              # ENJ formatting, address truncation, timestamps
│   │   ├── eraRpc.js              # Minimal WS-RPC for era boundary binary-search
│   │   ├── chainInfo.js           # One-shot WS query: current era, block, timestamp
│   │   └── probeProxy.js          # Lightweight proxy health check
│   ├── hooks/
│   │   ├── useEraExplorer.js      # Era Explorer state machine (WS + CSV)
│   │   ├── useValidatorChecker.js # Validator cadence scan
│   │   ├── usePoolChecker.js      # Pool cadence scan
│   │   ├── useBalanceExplorer.js  # Balance history query
│   │   └── useRewardHistory.js    # Per-era reward computation
│   └── components/
│       ├── LandingPage.jsx        # Home screen: 4 feature cards
│       ├── EraBlockExplorer.jsx   # Era Explorer tool UI
│       ├── BalanceExplorer.jsx    # Balance Viewer tool UI
│       ├── RewardHistoryViewer.jsx# Reward History tool UI
│       ├── ControlPanel.jsx       # Run/Stop/Reset + era count input
│       ├── ValidatorCard.jsx      # Expandable validator row
│       ├── PoolCard.jsx           # Expandable pool row
│       ├── BalanceChart.jsx       # Stacked bar / line chart (Chart.js)
│       ├── BalanceTable.jsx       # Paginated sortable table
│       ├── PoolRewardTable.jsx    # Pool reward summary table
│       ├── TerminalLog.jsx        # Sticky activity log panel
│       ├── ModeSelector.jsx       # Validators ↔ Pools tab switcher
│       ├── SummarySection.jsx     # Validator scan aggregate stats
│       └── PoolSummarySection.jsx # Pool scan aggregate stats
├── api/
│   └── [...proxy].js             # Vercel proxy: allowlist + API key injection
├── public/
│   ├── relay-era-reference.csv   # 1000+ Relaychain era boundaries
│   └── canary-relay-era-reference.csv
├── scripts/
│   ├── staking-rewards-rpc.py    # CLI mirror of reward computation
│   └── relay-era-range-fetch.py  # Regenerates relay-era-reference.csv
├── docs/
│   └── (various reference docs)
├── vite.config.js
├── tailwind.config.js
└── CLAUDE.md
```

---

## 4. Routing & Navigation

Navigation is implemented via **URL hash** (`window.location.hash`). There is no React Router.

| Hash | View rendered |
|------|--------------|
| `#home` or empty | `LandingPage` |
| `#era` | `EraBlockExplorer` |
| `#staking` | Staking Cadence (validators or pools) |
| `#balance` | `BalanceExplorer` |
| `#reward-history` | `RewardHistoryViewer` |

`App.jsx` reads `location.hash` on mount and listens for `hashchange` events. Navigation is **blocked while a scan is in progress** — the hash change is prevented and the user sees a warning.

Within the `#staking` view, a second level of tab state switches between **Validators** and **Pools** modes. This state is local to `App.jsx`.

---

## 5. Configuration & Constants

All tuning constants live in `src/constants.js`.

### API & Endpoints

```
SUBSCAN_BASE = 'https://enjin.api.subscan.io'

ENDPOINTS = {
  validators:  '/api/scan/staking/validators',
  nominators:  '/api/scan/staking/nominators',
  eraStat:     '/api/scan/staking/era_stat',
  pools:       '/api/scan/nomination_pool/pools',
  voted:       '/api/scan/nomination_pool/voted',
  rewardSlash: '/api/v2/scan/account/reward_slash',
  extrinsics:  '/api/v2/scan/extrinsics',
  events:      '/api/v2/scan/events',
}
```

All paths in `ENDPOINTS` are automatically added to the proxy allowlist in `api.js`.

### Request Tuning

| Constant | Value | Purpose |
|----------|-------|---------|
| `REQUEST_TIMEOUT_MS` | 15 000 ms | Abort stalled HTTP requests |
| `MAX_RETRIES` | 3 | 429 rate-limit retries |
| `MAX_RETRY_ATTEMPTS` | 5 | General transient error retries |
| `RETRY_BASE_MS` | 1 000 ms | Exponential back-off base |
| `API_DELAY_MS` | 1 000 ms | Throttle between sequential Subscan calls |
| `WS_CONNECT_TIMEOUT_MS` | 10 000 ms | WebSocket connection timeout |
| `WS_CALL_TIMEOUT_MS` | 15 000 ms | Per-RPC-call timeout |

### Network Presets

| Network | Archive WS | SS58 prefix | Address prefix |
|---------|-----------|-------------|----------------|
| Enjin Matrixchain | `wss://archive.matrix.blockchain.enjin.io` | 1110 | `ef` |
| Enjin Relaychain | `wss://archive.relay.blockchain.enjin.io` | 2135 | `en` |
| Canary Matrixchain | `wss://archive.matrix.canary.enjin.io` | 9030 | `cx` |
| Canary Relaychain | `wss://archive.relay.canary.enjin.io` | 69 | `cn` |

Relaychain networks also have a `supportDateRange: true` flag, enabling date-based query in the Balance Viewer and Reward History tools.

### ENJ Precision

```
PLANCK_PER_ENJ = 10^18  (stored as BigInt)
```

All ENJ values are stored as **BigInt Planck** throughout the app. Conversion to decimal only happens at display time.

---

## 6. Security Architecture

### API Key

- **Development:** Vite proxy reads `SUBSCAN_API_KEY` from `.env` and injects it as `x-api-key` on every proxied request.
- **Production:** Vercel serverless reads `SUBSCAN_API_KEY` from environment variables and injects it server-side.
- **Result:** The API key never appears in the browser bundle, localStorage, or network responses.

### Path Allowlist

`buildUrl(path)` in `api.js` validates the path against `ALLOWED_PATHS` (populated from `Object.values(ENDPOINTS)`). Any path not in the allowlist throws immediately — the request never reaches the proxy.

The Vercel proxy additionally enforces `PROXY_ALLOWLIST` (default: `enjin.api.subscan.io`) as a hostname allowlist.

### Input Validation

| Input | Validator |
|-------|-----------|
| SS58 address | `ss58Decode()` — validates length, prefix, checksum |
| Block hash | regex `0x[0-9a-fA-F]{64}` |
| Block numbers | `clampInt()` — safe integer range |
| WebSocket endpoints | `validateWsEndpoint()` — `wss://` only (or `ws://` in dev) |
| Content-Type | JSON only (proxy rejects other types) |
| File imports | max `MAX_IMPORT_MB` (10 MB) |

### XSS Prevention

- No `innerHTML`, no `eval`, no `dangerouslySetInnerHTML` anywhere
- All user-supplied content rendered via React JSX
- XML export uses manual entity escaping (`&`, `<`, `>`, `"`, `'`)
- Export filenames sanitised to alphanumeric + dash + underscore

### Memory Limits

- All log arrays capped at 500 entries via slice in reducers
- Chart decimation: max 250 rendered points
- Max RPC block queries: 2 000

---

## 7. API Proxy Layer

### `api/[...proxy].js` — Vercel Serverless

**Request flow:**

1. Browser calls `/api/<encodeURIComponent(target-url)>`
2. Proxy decodes the target URL
3. Validates that `target` starts with `https://`
4. Validates that the target hostname is in `PROXY_ALLOWLIST`
5. Optionally validates `x-proxy-secret` header
6. Injects `x-api-key: <SUBSCAN_API_KEY>` from server env
7. Strips hop-by-hop request headers (`connection`, `upgrade`, `x-forwarded-for`, etc.)
8. Forwards request body (raw, max 32 KB) and method
9. Returns upstream response, stripping `set-cookie`, `content-encoding`, `transfer-encoding`
10. Adds security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
11. Sets CORS to same-origin only

### `utils/api.js` — HTTP Client

**`buildUrl(path)`**

Validates path against allowlist. On success, returns:
```
/api/<encodeURIComponent('https://enjin.api.subscan.io' + path)>
```

**`subscanPost(path, body, proxyUrl, options)`**

1. Calls `buildUrl(path)` to get proxied URL
2. Sets 15 s abort timeout via `AbortController`
3. `fetch()` with `Content-Type: application/json`, body serialised via `JSON.stringify`
4. On 429: waits `retry-after` header value (or back-off), retries up to `MAX_RETRIES`
5. On 5xx: exponential back-off, retries up to `MAX_RETRY_ATTEMPTS`
6. Validates `Content-Type: application/json` on response
7. Returns parsed JSON `data` field

**`RequestQueue`**

Global FIFO queue enforcing `API_DELAY_MS` (1 s) between sequential requests. Every `subscanPost` goes through `requestQueue.enqueue()`.

**Typed helpers (wrap `subscanPost`):**

| Function | Subscan endpoint | Returns |
|----------|-----------------|---------|
| `fetchValidators(page, signal)` | `/api/scan/staking/validators` | validator list page |
| `fetchNominators(address, page, signal)` | `/api/scan/staking/nominators` | nominator list page |
| `fetchEraStat(address, eraRange, signal)` | `/api/scan/staking/era_stat` | era stat array |
| `fetchAllPools(proxyUrl, signal)` | `/api/scan/nomination_pool/pools` | all active pools |
| `fetchVoted(poolStash, signal)` | `/api/scan/nomination_pool/voted` | voted validators |
| `fetchRewardSlash(addr, blockRange, proxyUrl, signal)` | `/api/v2/scan/account/reward_slash` | reward events |
| `fetchExtrinsics(addr, page, signal)` | `/api/v2/scan/extrinsics` | extrinsic list |
| `fetchEvents(module, event, page, signal)` | `/api/v2/scan/events` | event list |

---

## 8. Utility Modules

### `utils/substrate.js`

**SS58 decoding:**
- `ss58Decode(addr)` → 32-byte `Uint8Array` public key. Validates multi-byte prefix, checksum (blake2b-512), and expected byte length (25–50 bytes depending on prefix).
- `base58Decode(str)` → `Uint8Array` (pure base58, no prefix handling)

**Storage key construction:**

All storage keys use `twox128(palletName) + twox128(itemName) + [per-key suffix]`.

| Function | Storage item | Suffix encoding |
|----------|-------------|----------------|
| `buildStorageKey(addr)` | System.Account | `blake2b_128(pubkey) + pubkey` |
| `buildTokenAccountKey(collId, tokenId, addr)` | MultiTokens.TokenAccounts | `blake2b_128(encode(collId,tokenId,addr)) + encode(...)` |
| `buildTokenKey(collId, tokenId)` | MultiTokens.Tokens | `blake2b_128(encode(collId,tokenId)) + encode(...)` |
| `buildStakingLedgerKey(accountHex)` | Staking.Ledger | `blake2b_128(accountId) + accountId` |
| `buildBondedPoolsPrefix()` | NominationPools.BondedPools | pallet+item prefix only |

**Pool bonded account derivation (`computePoolBondedAccountId`):**
```
accountId = blake2_256(SCALE_encode(("modl", b"py/nopo\0", 0, poolId)))
```
This matches the Substrate pallet-nomination-pools account derivation.

**SCALE decoders:**

| Function | Input | Output |
|----------|-------|--------|
| `decodeAccountInfo(hex)` | System.Account raw | `{nonce, free, reserved, miscFrozen, feeFrozen, newFormat}` all BigInt balances |
| `decodeU128First(hex)` | Any raw | Fixed 128-bit LE integer as BigInt |
| `decodeCompactFirst(hex)` | Any raw | SCALE compact-encoded integer as BigInt |
| `decodeCompactAt(bytes, offset)` | Uint8Array + offset | `{value: BigInt, bytesRead: number}` |
| `decodeStakingLedgerActive(hex)` | Staking.Ledger raw | active staked ENJ as BigInt |
| `poolIdFromBondedPoolsKey(keyHex)` | NominationPools key | u32 pool ID as number |

**SCALE compact encoding modes** (used by MultiTokens balances):
- `0b00` (low 2 bits): single-byte, value = byte >> 2 (range 0–63)
- `0b01`: two-byte LE, value = uint16 >> 2 (range 64–16383)
- `0b10`: four-byte LE, value = uint32 >> 2 (up to ~1 billion)
- `0b11`: big integer — next `(header >> 2) + 4` bytes are little-endian magnitude

**`decodeAccountInfo` dual-format handling:**

Substrate has two System.Account formats:
- **Legacy:** `nonce(u32) + consumers(u32) + providers(u32) + free(u128) + reserved(u128) + miscFrozen(u128) + feeFrozen(u128)` — 68 bytes
- **New (Matrixchain):** same but last field is `flags(u128)` with high bit set; `miscFrozen`/`feeFrozen` derive from a single `frozen` field. The decoder checks the high bit of the flags field to determine format.

**Hashing:**
- `xxh64(data, seed)` — pure-JS XXHash64 implementation (used in `twox128`)
- `twox128(text)` — two concatenated xxh64 hashes (seed 0 and seed 1) → 16-byte prefix

### `utils/format.js`

| Function | Purpose |
|----------|---------|
| `formatENJ(planck, decimals)` | BigInt Planck → `"X,XXX.0000 ENJ"` without floating-point loss |
| `truncateAddress(address, start, end)` | `"address"` → `"start…end"` |
| `parseCommission(rawPref)` | Parts-per-billion → percentage string |
| `nowHHMMSS()` | Current time `HH:MM:SS` |
| `safeInt(value, fallback)` | Safe `parseInt` with default |
| `validatorExplorerUrl(address)` | Returns sanitised Subscan URL for address |
| `poolExplorerUrl(poolId)` | Returns sanitised Subscan URL for pool |
| `poolLabel(pool, opts)` | Prefers pool metadata name over `"Pool #N"` |

### `utils/eraRpc.js`

**Purpose:** Binary-search a Substrate archive node for era start block numbers.

**`MinRPC` class:**
- `connect()` — opens WebSocket, sets up message/close handlers, times out at `WS_CONNECT_TIMEOUT_MS`
- `call(method, params)` — sends JSON-RPC 2.0 request, resolves on matching `id`, times out at `WS_CALL_TIMEOUT_MS`
- `close()` — sets `dead = true`, rejects all pending calls, closes WS

**`fetchEraBoundariesFromRpc(archiveWss, erasToFetch)`:**
1. Opens `MinRPC` connection
2. For each era in `erasToFetch`:
   - Fetches `Staking.ActiveEra` at various block hashes via binary search
   - Locates the exact block where the era number changed
   - Records `{startBlock, startBlockHash}`
   - Fetches `Timestamp.Now` at that block hash → `startTs`
3. Closes WS
4. Returns `{[era]: {startBlock, startBlockHash, startTs, endTs}}`

### `utils/chainInfo.js`

**`fetchLiveChainInfo(endpoint)`:** One-shot WS query returning `{era, block, timestamp}`.
1. Opens WS to `endpoint`
2. Calls `chain_getHeader` → current block number
3. Calls `state_getStorage` for `Timestamp.Now` → unix ms
4. Calls `state_getStorage` for `Staking.ActiveEra` → current era number
5. Immediately closes WS
6. All three values are nullable (any can fail independently)

Used by the Balance Viewer and Reward History Viewer "get current era/block" buttons.

### `utils/eraAnalysis.js`

| Function | Purpose |
|----------|---------|
| `computeMissedEras(eraStat, latestEra, eraCount)` | Finds eras in expected set but absent from eraStat |
| `findConsecutiveGroups(missedEras)` | Groups consecutive gaps, keeps groups ≥ 3 |
| `getSeverity(count)` | `none` (0) / `low` (1–2) / `medium` (3–5) / `high` (6+) |
| `resolveLatestEra(validators)` | Max era number across all validator eraStat arrays |
| `computePoolMissedEras(eraRewards, latestEra, eraCount)` | Same logic for pool reward events |

### `utils/balanceExport.js`

See [Section 14](#14-data-export--import) for full detail.

---

## 9. Tool: Era Block Explorer

### What it does

Connects to the Enjin Relaychain via WebSocket and shows:
- **Live:** current era number, current session, current block number, blocks-until-era-end, era progress %
- **Historical lookup:** user enters any past era number → returns start block, end block, start/end UTC timestamps, start block hash

### Data flow

**Boot sequence (EraExplorerController):**
1. Connect to **archive** node (`wss://archive.relay.blockchain.enjin.io`)
2. Discover storage keys for `Staking.ActiveEra` and `Session.CurrentIndex` by computing `twox128("Staking") + twox128("ActiveEra")` etc.
3. Read current era number from `Staking.ActiveEra`
4. Binary-search from genesis to current block to find the exact start block of the current era
5. Record `eraStart` and `eraStartMethod`
6. Close archive connection
7. Connect to **live** node (`wss://rpc.relay.blockchain.enjin.io`)
8. Subscribe to `chain_subscribeNewHead` for real-time block notifications
9. On each new block: update block/session/era display
10. On era change: re-open archive, binary-search new era start, close archive

**CSV lookup (past eras):**
- Loads `public/relay-era-reference.csv` at startup
- On user input: find matching row → return blocks and timestamps instantly
- Falls back to archive RPC binary-search for eras not yet in the CSV

**Output displayed:**
- Era number, session number, block number
- Blocks remaining in era, era progress percentage
- EKG canvas animation (heartbeat pulse on each new block)
- Per-block activity log
- Past era lookup result: start block, end block, start hash, start/end UTC dates

### State shape (`useEraExplorer`)

```
{
  status: 'idle' | 'connecting' | 'discovering' | 'live' | 'disconnected',
  era: number,
  session: number,
  block: number,
  eraStart: number,
  eraStartMethod: 'archive' | 'failed',
  csvCount: number,          // eras loaded from CSV
  lookup: {
    era, startBlock, endBlock, source,
    startDateUtc, endDateUtc, startBlockHash
  },
  lookupLoading: boolean,
  lookupError: string | null,
  logs: [{id, ts, message}],
  debug: {wsState, stakingPallet, sessionPallet, ...},
}
```

### WebSocket RPC methods used

| Method | Purpose |
|--------|---------|
| `chain_getHeader` | Get block number from header |
| `state_getStorage(key)` | Read storage slot at current block |
| `state_getStorageAt(key, blockHash)` | Read storage at specific block |
| `chain_subscribeNewHead` | Real-time block notifications |

---

## 10. Tool: Staking Rewards Cadence

### What it does

Scans recent eras on the Enjin Relaychain to find validators or nomination pools that missed reward payouts. Results are classified by severity.

### Two modes

**Validators mode** (`useValidatorChecker`):

Phase 0 — Probe API endpoints
Phase 1 — Fetch validator list from Subscan (paginated, ordered by `bonded_total` descending)
Phase 2 — Fetch nominators for each validator (multi-page, up to 100 per request)
Phase 3 — Fetch era stats for each validator; compute missed eras + severity

**Pools mode** (`usePoolChecker`):

Phase 0 — Probe API endpoints
Phase 1 — Fetch all nomination pools (multi-page, 100 per page)
Phase 2 — Fetch voted validators for each pool
Phase 3 — Sample 3 validators (Fisher-Yates shuffle) → derive era block boundaries via Subscan `era_stat` consensus
Phase 4 — Fetch reward/slash events for each pool stash address; confirm missing eras

### Era count input

User sets era count (1–100, default 14). This defines the lookback window for missed-era detection.

### Missed-era classification

`computeMissedEras()` builds the expected set of eras `[latestEra - eraCount + 1 ... latestEra]` and returns eras where no reward event was found.

`getSeverity(count)`:
- `none` — 0 missed
- `low` — 1–2 missed
- `medium` — 3–5 missed
- `high` — 6+ missed

Consecutive groups of ≥ 3 consecutive missed eras are highlighted separately.

### State shape (`useValidatorChecker`)

```
{
  status: 'idle' | 'loading' | 'done' | 'stopped' | 'error',
  validators: [{
    address, name, commission, active, rank,
    fetchStatus: 'pending' | 'loading' | 'done' | 'error',
    eraStat: [{era, reward, bonded, ...}],
    missedEras: [era, ...],
    consecutiveGroups: [[era, era, era], ...],
    error: null | string,
  }],
  logs: [{id, ts, level, message}],
  progress: {phases: [{key, label, total, completed, status}]},
}
```

### Output rendered

- `SummarySection` / `PoolSummarySection`: aggregate counts (total validators/pools, missed %, high-severity count)
- `ValidatorCard` / `PoolCard`: one expandable card per entity
  - Status badge (pending / loading / done / error)
  - Missed era count and severity badge
  - Expandable per-era table (era → reward / bonded / status)
  - Consecutive-group highlight
  - Retry button on error
- `TerminalLog`: real-time activity messages (level: INFO / OK / WARN / ERR)
- `ControlPanel`: Run / Stop / Reset buttons + era count input

---

## 11. Tool: Historical Balance Viewer

### What it does

Connects to an Enjin Blockchain archive node via WebSocket and queries `System.Account` storage at multiple historical block hashes. Returns free, reserved, miscFrozen, and feeFrozen ENJ balances at each sampled block, rendered as a chart and table.

### Input modes

**Query tab:**
- Network selector: Matrixchain, Relaychain, Canary Matrixchain, Canary Relaychain
- SS58 address input (validated against selected network's prefix)
- Range type: **Block range** or **Date range** (date range available only for networks with `supportDateRange: true`)
- Optional: custom WS endpoint override

**Block range inputs:** start block, end block, step (every N blocks)

**Date range inputs:** start date, end date. Converted to block numbers via `relay-era-reference.csv` (for Relaychain) or via binary-search RPC (for Matrixchain).

**Quick presets:** 1 week / 1 month / 3 months / 6 months / 1 year (from current date, backwards)

**Import tab:** JSON / CSV / XML file upload. Optionally decrypt AES-256-GCM encrypted exports. Re-populates the chart and table with previously exported data.

### Query flow (`useBalanceExplorer`)

1. Validate address via `ss58Decode()` (rejects invalid or wrong-prefix addresses)
2. Validate endpoint via `validateWsEndpoint()` (rejects non-`wss://` endpoints)
3. Connect to archive node (EnjinRPC class — same WS-RPC pattern as eraRpc.js)
4. Build `System.Account` storage key via `buildStorageKey(address)`
5. For each block in the sampled range:
   - `state_getStorageAt(storageKey, blockHash)` → raw hex
   - `decodeAccountInfo(raw)` → `{free, reserved, miscFrozen, feeFrozen, nonce}`
   - Append record to `state.records`
6. Close WS in `finally`
7. Emit progress updates throughout

### State shape (`useBalanceExplorer`)

```
{
  status: 'idle' | 'connecting' | 'querying' | 'done' | 'cancelled' | 'error',
  records: [{
    block, blockHash,
    free, reserved, miscFrozen, feeFrozen,  // all BigInt
    nonce, newFormat
  }],
  logs: [{level, msg, ts}],
  progress: {pct: 0–100, text: string},
  dataSource: 'none' | 'query' | 'import',
  errorMsg: string | null,
}
```

### Output rendered

- **Progress bar** during query
- **`BalanceChart`** (lazy-loaded Chart.js):
  - Default: stacked bar chart — `free` (cyan), `reserved` (orange), `miscFrozen` (orange-red), `feeFrozen` (pink)
  - Alternate: separate line per field
  - Crosshair tooltip showing all four fields at hover point
  - Zoom slider for chart height
  - Max 250 chart points (decimation applied for large ranges)
- **`BalanceTable`**:
  - Columns: block, date/time, free, reserved, miscFrozen, feeFrozen, nonce
  - Paginated: 10 / 25 / 50 / 100 / 250 rows per page
  - Sortable: click any column header
  - Populates in real-time during query
  - Text-size zoom slider
- **Export controls**: JSON / CSV / XML + optional AES-256-GCM password

---

## 12. Tool: Reward History Viewer

### What it does

Computes per-era staking rewards for all nomination pools a wallet address participated in over a specified era range. Mirrors the logic of `scripts/staking-rewards-rpc.py`.

### Inputs

- **Wallet address** (SS58, Relaychain format)
- **Era range mode**: direct era numbers OR date range with quick presets (1 week / 1 month / 3 months / 6 months / 1 year)
- **History mode toggle**: when enabled, also fetches historical pool memberships from Subscan extrinsics (for addresses that left pools before the current chain state)
- **Archive node endpoint** (defaults to Enjin Relaychain archive)

### Computation phases (`useRewardHistory`)

**Phase 1 — Load era boundaries**
- Load `public/relay-era-reference.csv` → parse into `{era, startBlock, endBlock, startTs, endTs}` map
- For eras not in CSV: binary-search archive node via `fetchEraBoundariesFromRpc()`

**Phase 2 — Discover pool memberships**
- Enumerate `NominationPools.BondedPools` storage (page through all keys)
- For each pool: `computePoolBondedAccountId(poolId)` → bonded account address
- `MultiTokens.TokenAccounts(collectionId=1, tokenId=poolId, address)` → member sENJ balance at current block
- If history mode enabled: fetch Subscan extrinsics (`nominationPools.joinPool`, `nominationPools.bondExtra`) for the address to find historical memberships

**Phase 3 — For each era × pool with non-zero balance**

For each era × pool combination where the member had non-zero sENJ at the era start:

1. Fetch `MultiTokens.TokenAccounts` at `eraStartBlock` hash → `memberBalance` (sENJ, BigInt)
2. Fetch `MultiTokens.Tokens` at `eraStartBlock` hash → `poolSupply` (total sENJ, BigInt)
3. Compute event window: `eventStart = endBlock + 1`, `eventEnd = eventStart + 40` (41-block window)
4. `fetchRewardSlash(poolStashAddress, blockRange)` → sum all reward events → `reinvested` (ENJ planck, BigInt)

**Phase 4 — Compute results**

```
reward      = (memberBalance × reinvested) / poolSupply
accumulated[pool] += reward
apy         = ((poolSupply + reinvested) / poolSupply) ^ 365 − 1  × 100
```

APY calculation uses scaled BigInt arithmetic to avoid `Number.MAX_SAFE_INTEGER` precision loss:
```js
const RATIO_PREC = 1_000_000_000n
const perEraGainScaled = (reinvested * RATIO_PREC) / poolSupply
const ratio = 1 + Number(perEraGainScaled) / Number(RATIO_PREC)
const apy   = (Math.pow(ratio, 365) - 1) * 100
```

### sENJ vs ENJ distinction

Enjin nomination pools issue **sENJ** (share tokens) in MultiTokens collection ID 1, token ID = pool ID.

```
exchangeRate = activeStake (ENJ) / totalSENJSupply (sENJ)
```

A new pool starts at rate ≈ 1.0. As the pool earns rewards and compounds, the rate grows (e.g. 1.5 after several years). The reward formula `memberBalance/poolSupply` produces a dimensionless ratio that is valid regardless of the exchange rate, because both values are in sENJ.

### State shape (`useRewardHistory`)

```
{
  status: 'idle' | 'loading' | 'done' | 'stopped' | 'error',
  results: [{
    era, poolId, poolLabel,
    memberBalance,   // sENJ planck (BigInt)
    poolSupply,      // sENJ planck (BigInt)
    reinvested,      // ENJ planck (BigInt)
    reward,          // ENJ planck (BigInt)
    accumulated,     // ENJ planck (BigInt)
    apy,             // number (%)
    eraStartBlock,   // number
    eraStartDateUtc, // ISO string
  }],
  logs: [{id, ts, level, message}],
  progress: {phases: [...]},
  csvCount: number,
  errorMsg: string | null,
}
```

### Output rendered

- **Line chart** (Chart.js): one line per pool, X-axis = era, Y-axis = reward ENJ
  - Reactive to table filters (pool filter and era range filter)
- **Unified table** (all eras × pools):
  - Columns: era, pool, era date, member sENJ, pool supply, reinvested ENJ, reward ENJ, cumulative ENJ, APY
  - Filterable by pool (multi-select dropdown) and era range (start/end sliders)
  - Sortable (click column header)
  - Paginated (10/25/50/100/250 rows per page)
- **Summary section:**
  - Total reward earned
  - Average APY across all eras
  - Era range covered
  - Eras with at least one reward
  - Number of pools
  - Best APY era + value
  - Best pool (by total reward)
- **Export controls**: JSON / CSV / XML + optional AES-256-GCM password
- **Import**: accepts previously exported reward JSON/CSV
- **Sticky terminal log**

### Reinvested accuracy notes

- Multiple validator payout events per era are summed — this is correct (each validator fires a separate event)
- Subscan indexing lag may cause zero results for very recent eras (logged as warning)
- Legacy chains (pre-v1060): `NominationPools.RewardPaid` per validator; Modern (v1061+): `NominationPools.EraRewardsProcessed` once per pool. Both are captured by Subscan `reward_slash` endpoint; summing is correct either way.

---

## 13. Shared Components

### `ControlPanel.jsx`

Rendered in the staking cadence view. Contains:
- **Run** button: calls `handleRun(eraCount)` on the hook
- **Stop** button: calls `abort()` which signals the AbortController
- **Reset** button: dispatches reset action to useReducer
- **Era count input**: integer 1–100 (default 14); validated before run

### `TerminalLog.jsx`

- Displays timestamped log entries from the hook's `logs` array
- Level-based colouring: INFO (default), OK (green), WARN (yellow), ERR (red)
- Sticky positioning — always visible without scrolling past the result cards
- Auto-scrolls to latest entry on update
- Log entries cap at 500; oldest entries dropped automatically

### `ValidatorCard.jsx`

Expandable card for a single validator:
- Header: truncated address, name, commission, active status badge, fetch status badge
- Collapsed: missed era count + severity badge
- Expanded: per-era table (era number, reward planck, bonded planck, status indicator), consecutive-group annotations

### `PoolCard.jsx`

Expandable card for a single nomination pool:
- Header: pool ID, metadata name, stash address, fetch status badge
- Collapsed: missed era count + severity badge
- Expanded: voted validators list + per-era reward events table

### `BalanceChart.jsx`

- Lazy-loads Chart.js via dynamic `import()` on first render
- Two chart types switchable via toggle:
  - **Stacked bar** (default): all four balance fields stacked per block
  - **Line**: one line per field
- Chart height adjustable via zoom slider
- Crosshair tooltip via Chart.js plugin showing all fields on hover
- Max 250 data points rendered (decimation for large query ranges)

### `BalanceTable.jsx`

- Renders `records` array from balance hook
- Columns: block number, UTC timestamp, free, reserved, miscFrozen, feeFrozen, nonce
- Pagination: 10/25/50/100/250 rows per page
- Sort: click any column header → ascending → descending → reset
- Text size zoom slider (affects font-size class)
- Real-time population during query (`isLoading` prop adds skeleton rows)

### `ModeSelector.jsx`

Tab switcher between Validators and Pools modes within the staking cadence view. Emits `onMode(key)` callback to `App.jsx`.

### `SummarySection.jsx` / `PoolSummarySection.jsx`

Aggregate stats panels rendered after scan completion:
- Total entities scanned
- Entities with any missed era
- High / medium / low severity counts
- Entities with consecutive missed groups

---

## 14. Data Export & Import

### `utils/balanceExport.js` — Balance Viewer formats

**Export:**

| Format | Function | Notes |
|--------|----------|-------|
| JSON | `toJSON(data, rpcMeta)` | BigInt fields as strings, `_rpcConfig` metadata section |
| CSV | `toCSV(data, rpcMeta)` | RFC 4180, header comment lines with `# key: value` |
| XML | `toXML(data, rpcMeta)` | Manual entity escaping, no library used |

**Import (`parseImport(text, ext)`):**
- Detects format by `ext` (`json`/`csv`/`xml`)
- Normalises all numeric fields to correct types (BigInt for balances, Number for block numbers)
- Validates block hashes against `0x[0-9a-fA-F]{64}` regex

**Encryption (`aesEncrypt` / `aesDecrypt`):**
- AES-256-GCM mode
- Key derivation: PBKDF2-SHA-256 with 100 000 iterations, random 16-byte salt
- Random 12-byte IV per export
- Authentication tag included — tamper detection
- Encrypted payload stored as JSON: `{salt, iv, ciphertext, tag}` (all hex-encoded)
- Uses Web Crypto API (`window.crypto.subtle`) — no third-party crypto library

**Utilities:**
- `safeFilename(s)` — replaces unsafe characters, caps at 160 chars
- `defaultFilename()` — `enjin_balance_<unix-timestamp>`
- `downloadFile(content, filename, type)` — creates `<a>` element, triggers download, immediately revokes object URL
- `planckToFloat(p)` — BigInt → Number for chart rendering
- `fmtENJ(v)` — Planck → localized decimal string (display only)

### `RewardHistoryViewer.jsx` — Reward History formats

Uses its own inline export functions (not `balanceExport.js`):

**Export object per row:**
```
era, pool_id, pool_label, era_start_block, era_date_utc,
member_senj, pool_supply_senj, reinvested_enj, reward_enj,
cumulative_enj, apy_pct, rolling_apy_pct
```

**Import (`parseRewardImport(text, ext)`):**
- Accepts JSON with `records: []` or bare array
- Accepts CSV with `# address:` comment header
- Coerces BigInt fields from strings
- `rollingApy` field is optional

---

## 15. Era Reference CSV

### File: `public/relay-era-reference.csv`

**Columns:**
```
era, start_block, end_block, start_block_hash,
start_timestamp_unix, start_datetime_utc,
end_timestamp_unix, end_datetime_utc
```

- Timestamps stored as **Unix milliseconds** in the CSV file
- All tools that read this CSV convert to Unix **seconds** on load (`Math.floor(ms / 1000)`)
- 1000+ rows covering era 1 (June 2023) to present
- One era ≈ one day on the Enjin Relaychain

**Who uses it:**
- **Era Block Explorer** — instant lookup for past eras
- **Balance Viewer** — converts date range to block range
- **Reward History Viewer** — provides era boundary block hashes for archive RPC queries

**Update cadence:** Weekly via GitHub Actions (`.github/workflows/update-era-reference.yml`), automated Monday 00:00 UTC.

**Manual regeneration:**
```bash
SSL_CERT_FILE="$(python3 -c 'import certifi; print(certifi.where())')" \
  python3 scripts/relay-era-range-fetch.py
```

**Also present:** `public/canary-relay-era-reference.csv` for Canary Relaychain.

---

## 16. Python Scripts

### `scripts/staking-rewards-rpc.py`

Interactive CLI that mirrors the Reward History Viewer computation. Connects directly to the Enjin Relaychain archive node via `substrate-interface`. Outputs a per-era × per-pool reward table.

Verified against the React hook: 0/18 mismatches for test address `enDr55GTVDWok78KBZgt5N86WNEy55bmMMeC9JsKAaPtiQnct`, eras 1000–1002, pools [14, 17, 18, 21, 23, 26].

### `scripts/relay-era-range-fetch.py`

Queries the Enjin Relaychain archive node to regenerate `public/relay-era-reference.csv`. Fetches era boundaries by reading `Staking.ActiveEra` and `Timestamp.Now` from archive blocks.

**Requires:**
```bash
pip install substrate-interface
pip install certifi  # macOS SSL fix
```

**macOS SSL fix (required):**
```bash
SSL_CERT_FILE="$(python3 -c 'import certifi; print(certifi.where())')" python3 <script.py>
```

**Also requires symlink:**
```
scripts/era-reference.csv → public/relay-era-reference.csv
```

---

## 17. Build & Deployment

### Development

```bash
npm run dev       # Vite dev server → http://localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview production build → http://localhost:4173
```

Set `SUBSCAN_API_KEY=<key>` in `.env` for Subscan API access.

### Vite config (`vite.config.js`)

- **Dev proxy:** `/api/<encoded-target>` → Subscan, injecting `x-api-key` from `SUBSCAN_API_KEY` env var
- **Build:** output to `dist/`, source maps disabled
- **Chunk splitting:** vendor (React/DOM), icons (Lucide), chart (Chart.js), polkadot (@polkadot/*)
- **Base path:** `./` (works in subdirectories)
- **Chunk size warning threshold:** raised to 1 050 kB (Polkadot bundle is ~985 kB)

### Vercel deployment

**Required env vars:**

| Variable | Purpose |
|----------|---------|
| `SUBSCAN_API_KEY` | Subscan API key (server-side only) |
| `PROXY_ALLOWLIST` | Allowed proxy hostnames (default: `enjin.api.subscan.io`) |
| `PROXY_SECRET` | Optional: validates `x-proxy-secret` header |

**Serverless function:** `api/[...proxy].js` catches all `/api/*` requests.

---

## 18. Testing

**Runner:** Vitest with jsdom environment

```bash
npm run test          # run all tests
npm run test -- --ui  # open Vitest UI
```

**Test files:**

| File | What is tested |
|------|---------------|
| `src/hooks/useValidatorChecker.test.js` | `determineActive()`, `parseCommission()` |
| `src/utils/substrate.test.js` | SCALE decoders: `decodeCompactFirst`, `decodeAccountInfo`, storage key builders |

---

## Appendix: Key Data Flows

### A. End-to-end: balance query

```
User inputs address + block range
    ↓
useBalanceExplorer.run()
    ↓
ss58Decode(address) [validate]
    ↓
validateWsEndpoint(endpoint) [validate]
    ↓
EnjinRPC.connect() [WS open]
    ↓
buildStorageKey(address) [SCALE + blake2b]
    ↓
for each block:
    state_getStorageAt(key, blockHash) [WS call]
        ↓
    decodeAccountInfo(raw) [SCALE decode]
        ↓
    dispatch({type:'ADD_RECORD', record}) [state update]
        ↓
    BalanceTable re-renders new row in real-time
        ↓
    BalanceChart re-renders with new data point
    ↓
EnjinRPC.close() [WS close]
    ↓
status → 'done'
```

### B. End-to-end: reward history

```
User inputs address + era range
    ↓
useRewardHistory.run()
    ↓
Load relay-era-reference.csv [fetch]
    ↓
fetchEraBoundariesFromRpc() for missing eras [WS binary-search]
    ↓
ArchiveRPC.connect() [WS open]
    ↓
Enumerate NominationPools.BondedPools [WS calls]
    ↓
for each pool:
    computePoolBondedAccountId(poolId) [SCALE hash]
    MultiTokens.TokenAccounts at current block [WS call]
    [if history mode] fetchExtrinsics() [Subscan API]
    ↓
for each era × pool:
    MultiTokens.TokenAccounts at eraStartBlock [WS call] → memberBalance
    MultiTokens.Tokens at eraStartBlock [WS call] → poolSupply
    ↓
ArchiveRPC.close() [WS close]
    ↓
for each era × pool:
    fetchRewardSlash(stash, blockRange) [Subscan API] → reinvested
    ↓
reward = (memberBalance × reinvested) / poolSupply
accumulated[pool] += reward
apy = ((poolSupply + reinvested) / poolSupply)^365 - 1
    ↓
dispatch({type:'SET_RESULTS', results}) [state update]
    ↓
RewardTable + LineChart + Summary render
```

### C. End-to-end: staking cadence scan (validators)

```
User clicks Run, era count = 14
    ↓
useValidatorChecker.run(14)
    ↓
Phase 0: probeEndpoint() × 3 [health check]
    ↓
Phase 1: fetchValidators() [Subscan API, paginated]
    dispatch {type:'SET_VALIDATORS', validators} → ValidatorCard list renders (pending badges)
    ↓
Phase 2: for each validator:
    fetchNominators(address) [Subscan API, paginated]
    dispatch {type:'SET_NOMINATORS', address, nominators}
    ↓
Phase 3: for each validator:
    fetchEraStat(address, eraRange) [Subscan API]
    computeMissedEras(eraStat, latestEra, 14)
    getSeverity(missedCount)
    dispatch {type:'SET_ERA_STAT', address, ...}
    → ValidatorCard updates: shows missed count, severity badge, era table
    ↓
status → 'done'
→ SummarySection renders aggregate stats
```

---

*EnjinSight — read-only, no wallet required | Last updated: March 2026*
