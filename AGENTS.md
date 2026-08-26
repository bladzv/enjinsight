# AGENTS.md — EnjinSight

Read-only React/Vite Enjin Blockchain monitoring app. No wallet, no backend DB. Five tools: Era Explorer, Staking Cadence, Balance Viewer, Reward History, ENJ Infusion Checker.

## Commands

```bash
npm run dev    # dev server → http://localhost:5173 (set SUBSCAN_API_KEY in .env)
npm run build  # production build → dist/
npm run test   # Vitest unit tests
```

## Architecture Rules

1. **No global state** — each tool is isolated in its own `useReducer` hook
2. **API key never in browser** — always injected server-side via the proxy (`api/[...proxy].js`)
3. **Path allowlist** — add new Subscan endpoints to `ENDPOINTS` in `constants.js`; they are auto-allowlisted via `Object.values(ENDPOINTS)` in `api.js`
4. **No `innerHTML`** — all user content via React JSX or manually escaped
5. **BigInt for balances** — ENJ amounts always `BigInt` Planck; never `Number`
6. **Log cap 500** — all log arrays capped at 500 entries
7. **AbortController** — every async scan must be cancellable
8. **WebSocket cleanup** — always `rpc.close()` in `finally`; set `dead = true` to reject in-flight calls; use `WS_CONNECT_TIMEOUT_MS` / `WS_CALL_TIMEOUT_MS` from `constants.js`

## Key Files

| File | Purpose |
|------|---------|
| `src/constants.js` | All API endpoints, network config, tuning constants |
| `src/utils/api.js` | `subscanPost`, `buildUrl`, `RequestQueue`, typed helpers |
| `src/utils/substrate.js` | SS58/SCALE utilities, storage key builders, balance decoders |
| `src/utils/balanceExport.js` | JSON/CSV/XML serialization + AES-256-GCM encryption |
| `src/utils/eraAnalysis.js` | Missed-era detection, severity classification |
| `src/hooks/use*.js` | One hook per tool — WS state machines, `useReducer` logic |
| `api/[...proxy].js` | Vercel serverless proxy — injects API key, enforces allowlist |
| `public/relay-era-reference.csv` | 1000+ era boundary records loaded at startup by multiple tools |

## Critical Patterns

**Subscan** — always via `subscanPost`, never direct fetch:
```js
const data = await subscanPost('/api/scan/staking/validators', { order: 'desc' }, '', { signal })
```

**MultiTokens storage** — balances are SCALE compact-encoded; use `decodeCompactFirst`, NOT `decodeU128OptionFirst`:
```js
const key = buildTokenAccountKey(1n, BigInt(poolId), address)  // substrate.js
const balance = decodeCompactFirst(await rpc.call('state_getStorage', [key, blockHash]))
```

**System.Account storage**:
```js
const key = buildStorageKey(address)
const { free, reserved, miscFrozen, feeFrozen } = decodeAccountInfo(await rpc.call('state_getStorageAt', [key, blockHash]))
```

## Adding a New Tool

1. `src/hooks/useMytool.js` (`useReducer` + async run) + `src/components/MytoolViewer.jsx`
2. Add to `FEATURES` in `LandingPage.jsx`; add view case in `App.jsx`
3. New Subscan endpoint → `ENDPOINTS` in `constants.js` (auto-allowlisted)

## Security Checklist

Before shipping any feature:
- [ ] No user input in `innerHTML`, `eval`, `dangerouslySetInnerHTML`
- [ ] New Subscan endpoints in `ENDPOINTS` (not hardcoded strings)
- [ ] Custom WS URLs validated with `validateWsEndpoint()`
- [ ] Addresses validated via `ss58Decode()` before storage key construction
- [ ] Export filenames sanitised via `safeFilename()`
- [ ] Log arrays capped at 500
- [ ] WebSocket closed in cleanup
- [ ] AbortController wired for all cancellable async chains
