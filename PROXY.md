# CORS Proxy Setup (Cloudflare Worker)

> **Do you actually need this?**
>
> | Scenario | Proxy needed? |
> |---|---|
> | Local development (`npm run dev`) | **No** — the Vite dev-server proxy in `vite.config.js` handles all Subscan requests and API-key injection automatically. |
> | Deployed to **Vercel** (including the live demo at [enjinsight.vercel.app](https://enjinsight.vercel.app)) | **No** — the serverless function at `api/[...proxy].js` acts as the proxy. No external Worker required. |
> | Deployed to a **static-only host** (GitHub Pages, plain Nginx, Cloudflare Pages without a Worker, etc.) that cannot run serverless functions | **Yes** — set up the Cloudflare Worker below so the app has a proxy endpoint to route Subscan requests through. |
>
> If you are running the app locally or deploying to Vercel, stop here — you do not need this file.

---

The Subscan API restricts cross-origin requests to `https://enjin.subscan.io`. This
Cloudflare Worker forwards requests from a statically-hosted app and rewrites the `Origin` header.

> **Note:** This guide has not been validated end-to-end with the current codebase. It serves as a reasonable starting point based on Cloudflare Workers documentation and the app's proxy interface, but you may need to adapt the worker code and URL routing to match `api/[...proxy].js` expectations. Treat it as a baseline — test thoroughly before relying on it in production.

## Step 1 — Create the Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/) → Workers & Pages → Create.
2. Name it e.g. `enjin-subscan-proxy`.
3. Paste the code below into the editor and **Save & Deploy**.

```js
/**
 * Enjin Subscan CORS Proxy — Cloudflare Worker
 *
 * Security controls:
 *  - Only forwards to the whitelisted Subscan host
 *  - Only allows whitelisted paths
 *  - Validates request method (POST only)
 *  - Enforces HTTPS upstream
 *  - Strips server-identifying response headers
 *  - Validates Origin against your app domain
 */

// ── CONFIGURE THESE ─────────────────────────────────────────────────────────
const ALLOWED_ORIGIN  = 'https://your-deployed-domain.example'  // your app's domain
const UPSTREAM_BASE   = 'https://enjin.api.subscan.io'

const ALLOWED_PATHS = new Set([
  '/api/scan/staking/validators',
  '/api/scan/staking/nominators',
  '/api/scan/staking/era_stat',
])
// ────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, origin)
    }

    // Only accept POST
    if (request.method !== 'POST') {
      return corsResponse('Method Not Allowed', 405, origin)
    }

    // Validate Origin
    if (origin !== ALLOWED_ORIGIN) {
      return corsResponse('Forbidden: origin not allowed', 403, origin)
    }

    // Validate path
    const url  = new URL(request.url)
    const path = url.pathname
    if (!ALLOWED_PATHS.has(path)) {
      return corsResponse('Forbidden: path not allowed', 403, origin)
    }

    // Validate Content-Type
    const ct = request.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      return corsResponse('Bad Request: expected application/json', 400, origin)
    }

    // Forward the request upstream
    const upstreamUrl = `${UPSTREAM_BASE}${path}`
    let upstreamRes
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'Origin':       'https://enjin.subscan.io',
          'Referer':      'https://enjin.subscan.io/',
        },
        body: request.body,
        redirect: 'error',  // never follow redirects
      })
    } catch (e) {
      return corsResponse('Bad Gateway', 502, origin)
    }

    // Validate upstream content type before forwarding
    const upCT = upstreamRes.headers.get('content-type') || ''
    if (!upCT.includes('application/json')) {
      return corsResponse('Bad Gateway: unexpected upstream response', 502, origin)
    }

    const body = await upstreamRes.text()

    return corsResponse(body, upstreamRes.status, origin, {
      'Content-Type': 'application/json',
    })
  },
}

function corsResponse(body, status, origin, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin':      origin || '*',
      'Access-Control-Allow-Methods':     'POST, OPTIONS',
      'Access-Control-Allow-Headers':     'Content-Type, Accept',
      'Access-Control-Allow-Credentials': 'false',
      'Vary':                             'Origin',
      ...extraHeaders,
    },
  })
}
```

## Step 2 — Set your app domain

Replace `https://your-deployed-domain.example` in the `ALLOWED_ORIGIN` constant
with your actual deployed domain (e.g. `https://app.example.com`).

If you've deployed to a custom domain, use that instead.

## Step 3 — Copy the Worker URL

After deploying, your Worker URL will look like:
```
https://enjin-subscan-proxy.YOUR_SUBDOMAIN.workers.dev
```

## Step 4 — Paste it in the app

Open the app, click the ⚙ gear icon in the control panel, paste the Worker URL, and save.
The URL is stored in your browser's `localStorage` and persists across page reloads.

## Notes

- The free Cloudflare Workers tier allows **100,000 requests/day** — more than enough.
- The Worker validates Origin on every request; it cannot be abused as an open relay.
- No data is stored or logged by the Worker beyond Cloudflare's standard access logs.
