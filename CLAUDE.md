# CLAUDE.md — EnjinSight

## Project Overview

EnjinSight is a read-only React/Vite web app for Enjin Blockchain monitoring. It provides four tools:
1. **Era Block Explorer** — real-time era/session/block metrics + historical era lookup
2. **Staking Rewards Cadence** — validator/pool missing-reward detection
3. **Historical Balance Viewer** — archive-node balance history with charts & export
4. **Reward History Viewer** — per-era staking reward computation (mirrors `staking-rewards-rpc.py`)

**No wallet required. Read-only. No backend database.**

---

## Development Commands

```bash
npm run dev       # Vite dev server → http://localhost:5173 (with Subscan proxy)
npm run build     # Production build → dist/
npm run preview   # Preview production build → http://localhost:4173
npm run test      # Vitest unit tests
npm run lint      # (no-op — eslint not yet configured)
```

Set `SUBSCAN_API_KEY=<key>` in `.env` for Subscan API access during development.

---

## Architecture Rules

1. **No global state** — each tool is isolated in its own `useReducer` hook
2. **API key never in browser** — always injected server-side via the proxy
3. **Path allowlist enforced** — `buildUrl()` in `api.js` blocks any unlisted path
4. **No `innerHTML`** — all user content rendered via React JSX or manually escaped
5. **BigInt for balances** — ENJ amounts are always `BigInt` Planck; never `Number`
6. **Log cap 500** — all log arrays are capped at 500 entries to prevent memory growth
7. **AbortController for cancellation** — every async scan is abortable
8. **WebSocket cleanup** — always close WS and clear timers in cleanup/destroy

---

## Key Files

| File | Purpose |
|------|---------|
| `src/constants.js` | All API endpoints, network config, tuning constants |
| `src/utils/api.js` | Subscan HTTP client: `subscanPost`, `buildUrl`, `RequestQueue`, typed helpers |
| `src/utils/substrate.js` | SS58/SCALE utilities, storage key builders, balance decoders |
| `src/utils/balanceExport.js` | Serialize/deserialize records (JSON/CSV/XML) + AES-256-GCM encryption |
| `src/utils/eraAnalysis.js` | Missed-era detection, severity classification |
| `src/utils/format.js` | Address truncation, ENJ formatting, timestamp helpers |
| `src/utils/chainInfo.js` | One-shot WS query to fetch era/block/timestamp chain metadata |
| `src/utils/eraRpc.js` | Binary-search for era start blocks via archive-node RPC |
| `src/hooks/useEraExplorer.js` | Era Explorer WS state machine |
| `src/hooks/useBalanceExplorer.js` | Balance Viewer WS + query logic |
| `src/hooks/useRewardHistory.js` | Reward History computation hook |
| `src/hooks/useValidatorChecker.js` | Validator cadence scan logic |
| `src/hooks/usePoolChecker.js` | Pool cadence scan logic |
| `src/components/PhaseProgressCards.jsx` | SVG ring-progress cards displayed during multi-phase scans |
| `api/[...proxy].js` | Vercel serverless proxy (injects API key, enforces allowlist) |
| `public/relay-era-reference.csv` | 1007+ era boundary records (era, blocks, hashes, timestamps) |
| `docs/new_design/stitch/enjinsight_obsidian/DESIGN.md` | Kinetic Ledger design system specification |
| `tailwind.config.js` | Design-system tokens (colors, typography, shadows, border radii) |

---

## Adding a New Tool

1. Create `src/hooks/useMytool.js` with a `useReducer` + async run function
2. Create `src/components/MytoolViewer.jsx`
3. Add the tool key to the `FEATURES` array in `LandingPage.jsx`
4. Add the view case in `App.jsx` (check valid views array + render block)
5. If the tool needs a new Subscan endpoint, add it to `ENDPOINTS` in `constants.js` and `ALLOWED_PATHS` in `api.js`

---

## Storage Key Construction

To query Substrate storage from the browser:

```js
import { buildTokenAccountKey, buildTokenKey, decodeCompactFirst } from './utils/substrate.js'

// MultiTokens.TokenAccounts(collectionId=1n, tokenId=poolId, address)
const key = buildTokenAccountKey(1n, BigInt(poolId), address)
const raw = await rpc.call('state_getStorage', [key, blockHash])
const balance = decodeCompactFirst(raw)  // BigInt (SCALE compact-encoded)

// MultiTokens.Tokens(collectionId=1n, tokenId=poolId)
const tkey = buildTokenKey(1n, BigInt(poolId))
const traw = await rpc.call('state_getStorage', [tkey, blockHash])
const supply = decodeCompactFirst(traw)  // BigInt (SCALE compact-encoded)
```

For System.Account (balance viewer):
```js
import { buildStorageKey, decodeAccountInfo } from './utils/substrate.js'
const key = buildStorageKey(address)   // uses SYS_ACCT_PREFIX from constants
const raw = await rpc.call('state_getStorageAt', [key, blockHash])
const { free, reserved, miscFrozen, feeFrozen } = decodeAccountInfo(raw)
```

---

## Subscan API Calls

Always use `subscanPost` via the proxy — never call Subscan directly:

```js
import { subscanPost, fetchAllPools, fetchRewardSlash } from './utils/api.js'

// Generic post
const data = await subscanPost('/api/scan/staking/validators', { order: 'desc' }, '', { signal })

// Typed helpers
const pools   = await fetchAllPools('', signal)
const rewards = await fetchRewardSlash(stashAddress, '1000-1040', '', signal)
```

Adding a new endpoint:
1. Add path to `ENDPOINTS` in `constants.js`
2. It is automatically added to `ALLOWED_PATHS` in `api.js` (via `Object.values(ENDPOINTS)`)

---

## WebSocket Pattern

All tools that connect to Substrate nodes use this minimal WS-RPC pattern:

```js
class ArchiveRPC {
  connect()    // returns Promise, sets up onmessage/onclose
  call(method, params)  // returns Promise, 15 s timeout
  close()      // cleans up pend map + closes WS
}
```

Key rules:
- Always call `rpc.close()` in `finally` blocks
- Track `dead = true` flag to reject in-flight calls on close
- Use `WS_CONNECT_TIMEOUT_MS` and `WS_CALL_TIMEOUT_MS` from `constants.js`

---

## Era Reference CSV

`public/relay-era-reference.csv` is the offline era boundary database.

- Columns: `era, start_block, end_block, start_block_hash, start_timestamp_unix, start_datetime_utc, end_timestamp_unix, end_datetime_utc`
- Updated weekly (Monday 00:00 UTC) via `.github/workflows/update-era-reference.yml`
- All tools that need era boundaries load it at startup via `fetch('/relay-era-reference.csv')`
- The Relaychain has ~1 era/day; 1000 rows ≈ 3 years of history

To regenerate manually:
```bash
cd scripts && python era-range-fetch.py
```

---

## Python Scripts

| Script | Command | Output |
|--------|---------|--------|
| `staking-rewards-rpc.py` | `python staking-rewards-rpc.py` | Interactive CLI → reward table |
| `era-range-fetch.py` | `python era-range-fetch.py` | Updates `public/relay-era-reference.csv` |

Both require: `pip install substrate-interface`
Optional: `pip install python-dotenv` (reads `RPC_ENDPOINT` from `.env`)

---

## Deployment

Deployed on Vercel. Required env vars:
- `SUBSCAN_API_KEY` — Subscan API key (injected by the proxy)
- `PROXY_ALLOWLIST` — (optional) comma-separated hostnames, defaults to `enjin.api.subscan.io`
- `PROXY_SECRET` — (optional) shared secret for `x-proxy-secret` header validation
- `RPC_ENDPOINT` — (optional, for scripts only) archive node WS URL

The `vite.config.js` dev proxy reads `SUBSCAN_API_KEY` from `.env` at build time.

---

## Testing

```bash
npm run test          # run all tests
npm run test -- --ui  # open Vitest UI
```

Test files: `src/**/*.test.js`
Test runner: Vitest with jsdom environment.

---

## Security Checklist

Before adding new features:
- [ ] No user input in `innerHTML`, `eval`, `dangerouslySetInnerHTML`
- [ ] New Subscan endpoints added to `ENDPOINTS` (auto-allowlisted)
- [ ] Custom WS endpoints validated with `validateWsEndpoint()`
- [ ] User addresses validated via `ss58Decode()` before storage key construction
- [ ] Export filenames sanitised via `safeFilename()`
- [ ] Log arrays capped at 500 entries
- [ ] WebSocket closed in cleanup
- [ ] AbortController used for cancellable async chains
