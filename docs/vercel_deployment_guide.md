# Vercel Deployment Guide

This project is deployed at:

- https://enjinsight.vercel.app/

The app is a static Vite frontend with a serverless proxy function at `api/[...proxy].js`.

## Prerequisites

- Node.js 18+
- npm
- Vercel account
- Optional: Vercel CLI (`npm i -g vercel`)

## Deploy Steps

1. Push repository to GitHub
2. Import project in Vercel
3. Set framework preset to Vite (or auto-detect)
4. Configure environment variables
5. Deploy

## Required Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

- `SUBSCAN_API_KEY`
  - Required for staking cadence and reward-history Subscan calls
- `PROXY_ALLOWLIST`
  - Comma-separated hostnames allowed through proxy
  - Recommended value: `enjin.api.subscan.io`
- `PROXY_SECRET` (optional but recommended)
  - If set, requests to proxy must include `x-proxy-secret`
- `ETHERSCAN_API_KEY`
  - Required for ENJ Infusion wallet/token detail discovery
- `ALCHEMY_ETH_RPC_URL` (recommended)
  - Used for Ethereum RPC reads and wallet discovery fallback
- `OPENSEA_API_KEY` (recommended)
  - Used server-side for metadata fallback when token URI metadata is unavailable

## OpenSea API Key

`OPENSEA_API_KEY` is a manually-issued key from OpenSea Settings -> Developer (email verification,
an application form, and a reCAPTCHA are required). It does not expire and needs no rotation --
set it once in Vercel Production and redeploy.

Security note:

- Never commit OpenSea keys to source control.
- Keep all API keys server-side only.

## Routing / Proxy Notes

- `vercel.json` already contains rewrite support:
  - `/proxy/:path*` -> `/api/:path*`
- Client production pathing uses encoded upstream URLs (see `src/constants.js` and `src/utils/api.js`)
- Direct external proxy URLs are intentionally disallowed in client logic

## Local Verification

```bash
npm ci
npm run build
npm run preview
```

Optional Vercel local runtime:

```bash
vercel dev
```

## Post-Deploy Checklist

- Open deployed URL and run both scan modes:
  - Validators
  - Nomination Pools
- Confirm phase progress, tables, and summaries load
- Confirm Subscan links open correctly
- Confirm proxy allowlist blocks non-approved hosts

## Troubleshooting

- 403 from proxy:
  - Check `PROXY_ALLOWLIST`
- 401 from proxy:
  - Check `PROXY_SECRET` and request header
- Build failures:
  - Ensure Node 18+ and `npm ci` succeeds locally

## Security References

- Proxy implementation: `api/[...proxy].js`
- Security policy: `docs/SECURITY.md`
