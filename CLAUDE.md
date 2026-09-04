# CLAUDE.md — EnjinSight

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
6. **Logs uncapped** — log arrays grow without limit; `TerminalLog` virtualizes the drawer so only the visible window is in the DOM
7. **AbortController** — every async scan must be cancellable
8. **WebSocket cleanup** — always `rpc.close()` in `finally`; set `dead = true` to reject in-flight calls; use `WS_CONNECT_TIMEOUT_MS` / `WS_CALL_TIMEOUT_MS` from `constants.js`

## Key Files

| File | Purpose |
|------|---------|
| `src/constants.js` | All API endpoints, network config, tuning constants |
| `src/utils/api.js` | `subscanPost`, `buildUrl`, `RequestQueue`, typed helpers |
| `src/utils/substrate.js` | SS58/SCALE utilities, storage key builders, balance decoders |
| `src/utils/balanceExport.js` | Balance Viewer JSON/CSV/XML serialization + AES-256-GCM encryption; also carries `parseBigInt`/`splitCsvRow`, reused by Reward History |
| `src/utils/scanEnvelope.js` | Leaf module: the `{tool, schema, schemaVersion, appVersion, exportedAt}` header shared by every export format, and its validation. Imports nothing, so `scanExport.js` and `balanceExport.js` can both depend on it without a cycle |
| `src/utils/scanExport.js` | Staking Cadence + Infusion scan export/import — nested `meta`/`data` payloads built on `scanEnvelope.js` |
| `src/utils/eraAnalysis.js` | Missed-era detection, severity classification |
| `src/components/ToolModeStrip.jsx` | Shared `Query \| Import` tab strip used by all four tools that support import |
| `src/components/ImportDropPanel.jsx` | Shared drop-zone/size-check/decrypt shell behind every import panel (`BalanceImportPanel`, `RewardImportPanel`, `ScanImportPanel`) |
| `src/hooks/use*.js` | One hook per tool — WS state machines, `useReducer` logic |
| `api/[...proxy].js` | Vercel serverless proxy — injects API key, enforces allowlist |
| `public/relay-era-reference.csv` | 1000+ era boundary records loaded at startup by multiple tools |

## Export / Import

Every export (all five tools) carries the shared header from `scanEnvelope.js`:
`{tool: 'enjinsight', schema, schemaVersion, appVersion, exportedAt}`.

- **Staking Cadence and Infusion** nest their payload under `meta`/`data` (`scanExport.js`). Import cap: `MAX_SCAN_IMPORT_MB` (64 MB) in `constants.js` — these payloads are nested and scale with real usage (a large validator scan measured ~9 MB).
- **Balance Viewer and Reward History** spread the header across their existing flat shape (`{..., _rpcConfig, records}` / `{..., _meta, records}`) instead of wrapping it, so a build predating the header still reads a new file. Import cap: `MAX_IMPORT_MB` (10 MB).
- An import with **no header at all** (an export written before this existed) falls back to the legacy content sniff (`sniffBalance` / `sniffReward`) rather than being refused — see `readLegacyHeader` in `scanEnvelope.js`. Do not remove this fallback without confirming no one still has old exports.
- All four tools with import share one UI: `ToolModeStrip` (the `Query | Import` tabs) + `ImportDropPanel` (drop zone, size/extension checks, decrypt flow). Add a new import format by writing an `inspect`/`onFile`/`onDecrypt` trio for `ImportDropPanel`, not a new panel from scratch.
- Export is always hidden for `dataSource === 'import'` — an import is a snapshot of a past run, and a re-export would be indistinguishable from an original.

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
- [ ] Log entries carry a stable `id` (never an array index) — the drawer keys its virtual window on it
- [ ] WebSocket closed in cleanup
- [ ] AbortController wired for all cancellable async chains
