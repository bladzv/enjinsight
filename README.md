# Enjin Status Checker

<p align="center">
  <a href="https://enjin-status-checker.vercel.app/"><img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-Vercel-111111?style=flat-square&logo=vercel" /></a>
  <a href="https://enjin-status-checker.vercel.app/"><img alt="enjin-status-checker.vercel.app" src="https://img.shields.io/badge/enjin--status--checker.vercel.app-online-00C7B7?style=flat-square" /></a>
  <a href="https://github.com/bladzv/enjin-status-checker/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/bladzv/enjin-status-checker?style=flat-square" /></a>
</p>

A read-only monitoring app for Enjin Relaychain staking status. It scans validator and nomination pool reward data from Subscan, highlights missing rewards, and provides per-validator/per-pool drill-down with summary risk indicators.

## Live Site

https://enjin-status-checker.vercel.app/

## What It Does

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

**UI/UX**
- Single `CHECK → STOP → RESET` action cycle
- Step-numbered progress bar with per-phase status and item counts
- Expandable cards, paginated tables, terminal-style log with timestamps
- Mobile and desktop responsive; fully static — no back-end server required

## Tech Stack

| Layer | Package |
|---|---|
| UI framework | React 18 |
| Build tool | Vite 7 |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React (tree-shaken) |
| Unit tests | Vitest |
| Proxy (production) | Vercel serverless (`api/[...proxy].js`) |
| Proxy (development) | Vite dev-server proxy (`vite.config.js`) |

## Project Structure

```txt
.
├── api/
│   └── [...proxy].js       # Vercel serverless proxy — injects API key server-side
├── docs/                   # Security policy, deployment notes, product docs
├── public/                 # Static assets (logo, favicons, site.webmanifest)
├── src/
│   ├── components/         # AppHeader, ControlPanel, ModeSelector, ValidatorCard,
│   │                       # PoolCard, SummarySection, PoolSummarySection,
│   │                       # EraStatTable, NominatorsTable, PoolRewardTable,
│   │                       # PoolValidatorsTable, TerminalLog
│   ├── hooks/
│   │   ├── useValidatorChecker.js   # state machine for validator scanning
│   │   └── usePoolChecker.js        # state machine for pool scanning
│   ├── utils/
│   │   ├── api.js          # fetch wrapper, request queue, typed helpers, probeEndpoint
│   │   ├── eraAnalysis.js  # missed-era detection, consecutive-gap grouping, severity
│   │   └── format.js       # BigInt ENJ formatting, address truncation, explorer URLs
│   ├── App.jsx             # root component — mode switching, progress bar, layout
│   ├── constants.js        # all config values: endpoints, timeouts, batch sizes, limits
│   └── main.jsx
├── .env.example            # environment variable template
├── vercel.json             # Vercel function config (256 MB, 10 s max duration)
├── vite.config.js
└── package.json
```

## Local Development

### Prerequisites

- Node.js ≥ 18
- A [Subscan API key](https://support.subscan.io/hc/en-us/articles/900004171346) (required — Subscan now enforces `x-api-key` on all requests)

### Setup

```bash
git clone https://github.com/bladzv/enjin-status-checker.git
cd enjin-status-checker
npm ci
cp .env.example .env
# edit .env and set SUBSCAN_API_KEY=<your key>
npm run dev
```

Open `http://localhost:5173`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUBSCAN_API_KEY` | Yes | Subscan API key. **Never use `VITE_` prefix** — this key must not appear in the browser bundle. In dev it is read by `vite.config.js` at config time and injected into Vite's dev-server proxy. In production it is set as a Vercel Environment Variable and injected by the serverless proxy. |
| `PROXY_ALLOWLIST` | No | Comma-separated hostnames the proxy may forward to. Defaults to `enjin.api.subscan.io`. |

### Scripts

```bash
npm run dev      # Vite HMR dev server (http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # preview production build locally
npm run test     # Vitest unit tests
```

## How the Proxy Works

All Subscan requests are routed through a same-origin proxy so the API key is **never exposed in the browser bundle**.

```
Browser
  └── POST /api/<encodeURIComponent(https://enjin.api.subscan.io/...)>
        │
        ├── Dev:  Vite dev-server proxy (vite.config.js)
        │         decodes target, rewrites path, injects x-api-key from SUBSCAN_API_KEY
        │
        └── Prod: Vercel serverless function (api/[...proxy].js)
                  decodes target, validates hostname against PROXY_ALLOWLIST,
                  buffers raw body unchanged, injects x-api-key from SUBSCAN_API_KEY,
                  strips any client-supplied x-api-key header
```

`buildUrl()` in `api.js` always constructs `/api/<encodedUrl>` — direct Subscan requests are never made from the browser regardless of environment.

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

## Security Notes

- **Read-only** — no wallet connection, no transaction signing, no user data stored
- **API key never in bundle** — `SUBSCAN_API_KEY` has no `VITE_` prefix; the browser JS never contains the key
- **Path allowlist** — `buildUrl()` throws if the requested path is not in `ENDPOINTS`; the proxy also validates the decoded hostname against `PROXY_ALLOWLIST`
- **Raw body forwarding** — the Vercel proxy uses `bodyParser: false` and streams the raw body buffer unchanged to prevent double-serialisation
- **BigInt arithmetic** — all ENJ values use `BigInt` throughout; conversion to human-readable strings only happens in `format.js` at render time, preventing IEEE 754 precision loss on Planck values (10¹⁸ per ENJ)
- **No `dangerouslySetInnerHTML`** — all output is rendered through React's JSX escaping
- **External links** — all `<a>` tags to Subscan explorer use `rel="noopener noreferrer"`

## Deployment

- Live production is deployed on Vercel.
- Full deployment notes: [`docs/vercel_deploy.md`](./docs/vercel_deploy.md)
- Security policy: [`docs/SECURITY.md`](./docs/SECURITY.md)

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `main`:
1. Install dependencies (`npm ci`)
2. Lint (`npm run lint`)
3. Test (`npm run test`)
4. Build (`npm run build`)

## License

MIT. See [`LICENSE`](./LICENSE).
