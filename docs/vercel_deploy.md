Deploying Enjin Status Checker to Vercel

This guide walks a beginner through deploying the Enjin Status Checker static app to Vercel and adding a secure serverless proxy function. It includes exact commands, code snippets for `api/[...proxy].js`, an optional `vercel.json`, and the `src/constants.js` change using `import.meta.env.PROD`. Follow each step carefully.

## Prerequisites
- Node.js (v18+ recommended)
- npm (or yarn)
- Vercel account: https://vercel.com
- Vercel CLI (optional but recommended for local testing): `npm i -g vercel`

## Relevant repository layout
- `public/` — static assets
- `src/` — React app (Vite)
- `api/` — serverless functions (we will add `api/[...proxy].js`)
- `docs/vercel_deploy.md` — this file

## High-level plan
1. Add a secure serverless proxy function at `api/[...proxy].js`.
2. Update `src/constants.js` to use `import.meta.env.PROD` for proxy switching.
3. Add optional `vercel.json` rewrites (nice `/proxy/...` URLs).
4. Add environment variables in Vercel (allowlist + secret).
5. Test locally with `vercel dev`.
6. Deploy and verify.

---

## 1) Serverless proxy function: `api/[...proxy].js`

Place this file at `api/[...proxy].js` (top-level `api` folder at repo root). It is a Node-compatible serverless function for Vercel. It expects the client to call `/api/<encodedUrl>` where `<encodedUrl>` is `encodeURIComponent(fullTargetUrl)`.

```js
// api/[...proxy].js
export default async function handler(req, res) {
  try {
    // Handle CORS preflight quickly
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.statusCode = 204;
      return res.end();
    }

    const prefix = '/api/';
    const raw = req.url || '';
    if (!raw.startsWith(prefix)) {
      res.statusCode = 400;
      return res.end('Invalid proxy path');
    }

    const after = raw.slice(prefix.length);
    if (!after) {
      res.statusCode = 400;
      return res.end('Missing target URL path (encodeURIComponent target).');
    }

    // The encoded target may include its own querystring. We decode only the first path segment.
    const [encodedTarget] = after.split('?');
    const target = decodeURIComponent(encodedTarget);
    if (!/^https:\/\//i.test(target)) {
      res.statusCode = 400;
      return res.end('Only https:// targets are allowed.');
    }

    const targetUrl = new URL(target);

    // Allowlist check
    const allowlistEnv = process.env.PROXY_ALLOWLIST || '';
    const allowlist = allowlistEnv.split(',').map(s => s.trim()).filter(Boolean);
    if (allowlist.length > 0 && !allowlist.includes(targetUrl.hostname)) {
      res.statusCode = 403;
      return res.end('Target host not allowed by PROXY_ALLOWLIST.');
    }

    // Optional secret header verification (recommended)
    const secret = process.env.PROXY_SECRET;
    if (secret) {
      const incoming = req.headers['x-proxy-secret'] || '';
      if (incoming !== secret) {
        res.statusCode = 401;
        return res.end('Missing or invalid proxy secret header.');
      }
    }

    // Rebuild target URL with original query string if present
    const originalQuery = raw.includes('?') ? raw.split('?').slice(1).join('?') : '';
    const finalUrl = originalQuery ? `${target}?${originalQuery}` : target;

    // Forward headers (sanitized)
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    ['connection', 'keep-alive', 'transfer-encoding', 'proxy-authorization', 'proxy-authenticate', 'upgrade'].forEach(h => delete forwardHeaders[h]);

    // Build fetch options
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body || undefined,
      redirect: 'manual',
    };

    const upstreamRes = await fetch(finalUrl, fetchOptions);

    // Copy allowed headers from upstream to client response
    const disallowed = ['set-cookie', 'connection', 'content-encoding', 'transfer-encoding'];
    upstreamRes.headers.forEach((value, key) => {
      if (!disallowed.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Set conservative CORS response header (echo origin if present)
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

    res.statusCode = upstreamRes.status;
    const text = await upstreamRes.text();
    return res.end(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.statusCode = 500;
    res.end('Proxy error');
  }
}
```

Notes:
- This function enforces HTTPS only, validates a host allowlist, and optionally requires `x-proxy-secret`.
- Vercel serverless environment supports `fetch`.

## 2) Optional `vercel.json`

Add `vercel.json` at the repo root to map `/proxy/:path*` to `/api/:path*` and to size the function.

```json
{
  "version": 2,
  "rewrites": [
    { "source": "/proxy/:path*", "destination": "/api/:path*" }
  ],
  "functions": {
    "api/[...proxy].js": {
      "memory": 256,
      "maxDuration": 10
    }
  }
}
```

## 3) Update `src/constants.js` to use `buildProxyUrl()`

Add a small helper to `src/constants.js` that detects production and returns a proxied path in production, or the raw upstream URL in development.

```js
// consts snippet for src/constants.js
export const IS_PROD = import.meta.env.PROD === true;
export function buildProxyUrl(fullUrl) {
  if (IS_PROD) return `/api/${encodeURIComponent(fullUrl)}`;
  return fullUrl;
}
```

Use `buildProxyUrl()` in places that call external APIs so the app routes requests through the serverless proxy when deployed to Vercel.

## 4) Environment variables (Vercel dashboard or CLI)
- `PROXY_ALLOWLIST` — comma-separated hostnames allowed (e.g., `api.subscan.io`).
- `PROXY_SECRET` — strong secret token (optional, recommended).

## 5) Local testing

Install and run locally:

```bash
npm install
npm run dev
# In another terminal, run:
vercel dev
```

Example curl (local `vercel dev`):

```bash
TARGET='https://api.subscan.io/api/scan/someEndpoint?param=1'
ENCODED=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$TARGET")
curl -v "http://localhost:3000/api/$ENCODED" -H "x-proxy-secret: $PROXY_SECRET" -H "Accept: application/json"
```

## 6) Deploy

Interactive:

```bash
vercel
```

Non-interactive (when linked):

```bash
vercel --prod
```

After deploy, test the deployed URL as in the local example.

## 7) Security & production notes
- Use `PROXY_ALLOWLIST` to limit proxied hostnames.
- Prefer not to expose `PROXY_SECRET` on public clients; prefer server-side callers or short-lived tokens.
- Consider caching or external rate-limiters for heavy workloads.

---

If you'd like, I can add `api/[...proxy].js` and `vercel.json` to the repo now and patch `src/constants.js` to include `buildProxyUrl()`. Reply or let me proceed.
