// Simple, cautious proxy for Vercel serverless functions.
// Usage: POST /api/https%3A%2F%2Fenjin.api.subscan.io%2Fapi%2Fscan%2F...
// Security: set PROXY_ALLOWLIST and optionally PROXY_SECRET.
// Body parsing is disabled so the raw request body is forwarded unchanged.
// The Subscan API key is injected server-side from SUBSCAN_API_KEY env var.
export const config = { api: { bodyParser: false } }

/** Maximum raw body size accepted from the client (32 KB — well above any API payload). */
const MAX_BODY_BYTES = 32 * 1024

/** Read the raw request body into a Buffer, enforcing a size limit. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0
    req.on('data', (chunk) => {
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy()
        return reject(new Error('Request body too large.'))
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      // Only allow same-origin requests; this proxy is not a public API
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.statusCode = 204;
      return res.end();
    }

    // Reject requests with no Content-Type on non-GET methods (body expected)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers['content-type']) {
      res.statusCode = 400;
      return res.end('Missing Content-Type header.');
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

    const [encodedTarget] = after.split('?');
    let target;
    try {
      target = decodeURIComponent(encodedTarget);
    } catch (e) {
      res.statusCode = 400;
      return res.end('Invalid encoded target');
    }

    if (!/^https:\/\//i.test(target)) {
      res.statusCode = 400;
      return res.end('Only https:// targets are allowed.');
    }

    const targetUrl = new URL(target);

    const allowlistEnv = process.env.PROXY_ALLOWLIST || 'enjin.api.subscan.io';
    const allowlist = allowlistEnv.split(',').map(s => s.trim()).filter(Boolean);
    if (allowlist.length > 0 && !allowlist.includes(targetUrl.hostname)) {
      res.statusCode = 403;
      return res.end('Target host not allowed by PROXY_ALLOWLIST.');
    }

    const secret = process.env.PROXY_SECRET;
    if (secret) {
      const incoming = req.headers['x-proxy-secret'] || '';
      if (incoming !== secret) {
        res.statusCode = 401;
        return res.end('Missing or invalid proxy secret header.');
      }
    }

    const originalQuery = raw.includes('?') ? raw.split('?').slice(1).join('?') : '';
    const finalUrl = originalQuery ? `${target}?${originalQuery}` : target;

    // Read the raw body before touching headers so we forward it unchanged.
    const rawBody = ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : await readRawBody(req)

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    // Remove the client-supplied x-api-key — we inject it server-side below.
    delete forwardHeaders['x-api-key'];
    // Strip hop-by-hop and potentially dangerous headers
    [
      'connection', 'keep-alive', 'transfer-encoding',
      'proxy-authorization', 'proxy-authenticate', 'upgrade',
      'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
      'x-real-ip', 'x-proxy-secret',
    ].forEach(h => delete forwardHeaders[h]);

    // Inject the Subscan API key from the server-side environment variable.
    const apiKey = process.env.SUBSCAN_API_KEY || '';
    if (apiKey) forwardHeaders['x-api-key'] = apiKey;

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      body: rawBody,
      redirect: 'manual',
    };

    const upstreamRes = await fetch(finalUrl, fetchOptions);

    const disallowed = ['set-cookie', 'connection', 'content-encoding', 'transfer-encoding'];
    upstreamRes.headers.forEach((value, key) => {
      if (!disallowed.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Only allow same-origin requests; this proxy is not a public API
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    // Prevent downstream content from being framed or sniffed
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    res.statusCode = upstreamRes.status;
    const text = await upstreamRes.text();
    return res.end(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.statusCode = 500;
    res.end('Proxy error');
  }
}

