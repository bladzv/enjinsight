# Enjin Status Checker

<p align="center">
  <a href="https://enjin-status-checker.vercel.app/"><img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-Vercel-111111?style=flat-square&logo=vercel" /></a>
  <a href="https://enjin-status-checker.vercel.app/"><img alt="enjin-status-checker.vercel.app" src="https://img.shields.io/badge/enjin--status--checker.vercel.app-online-00C7B7?style=flat-square" /></a>
  <a href="https://github.com/bladzv/enjin-status-checker/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bladzv/enjin-status-checker/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <img alt="Node >=18" src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js" />
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/bladzv/enjin-status-checker?style=flat-square" /></a>
</p>

A read-only monitoring app for Enjin Relaychain staking status. It scans validator and nomination pool reward data from Subscan, highlights missing rewards, and provides per-validator/per-pool drill-down with summary risk indicators.

## Live Site

- https://enjin-status-checker.vercel.app/

## What It Does

- Validator mode:
  - Scans validator list
  - Fetches nominators and era stats
  - Flags missed rewards and consecutive gaps
- Nomination pool mode:
  - Scans pools and nominated validators
  - Resolves era payout windows
  - Confirms reward events and explains expected no-reward cases (for pools with no nominated validators)
- UI/UX:
  - Single `CHECK -> STOP -> RESET` action flow
  - Phase-aware scan progress
  - Expandable cards, paginated tables, terminal-style logs
  - Mobile and desktop responsive views

## Tech Stack

- React 18 + Vite 7
- Tailwind CSS 3
- Lucide icons
- Vercel serverless proxy (`api/[...proxy].js`)

## Project Structure

```txt
.
├── api/                    # Vercel serverless proxy
├── docs/                   # Security, deployment, product docs
├── public/                 # Static assets (logo, favicons)
├── src/
│   ├── components/
│   ├── hooks/
│   ├── utils/
│   ├── App.jsx
│   └── constants.js
├── vercel.json
├── vite.config.js
└── README.md
```

## Local Development

```bash
git clone https://github.com/bladzv/enjin-status-checker.git
cd enjin-status-checker
npm ci
npm run dev
```

Open `http://localhost:5173`.

### Scripts

```bash
npm run dev      # start dev server
npm run build    # production build
npm run preview  # preview build output
npm run test     # unit tests
```

## Deployment

- Live production is on Vercel.
- Deployment notes: [`docs/vercel_deploy.md`](./docs/vercel_deploy.md)
- Security policy: [`docs/SECURITY.md`](./docs/SECURITY.md)

## Security Notes

- Read-only app, no wallet connection, no transaction signing
- Upstream paths are allowlisted in client constants
- Proxy enforces HTTPS target validation and hostname allowlist via `PROXY_ALLOWLIST`
- BigInt-based ENJ formatting to avoid precision loss in staking values

## License

MIT. See [`LICENSE`](./LICENSE).
