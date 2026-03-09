// Simple, cautious proxy for Vercel serverless functions.
// Usage: GET /api/https%3A%2F%2Fapi.subscan.io%2Fapi%2Fscan%2F...
// Security: set PROXY_ALLOWLIST and optionally PROXY_SECRET.

export default async function handler(req, res) {
  try {
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

    const allowlistEnv = process.env.PROXY_ALLOWLIST || '';
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

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    ['connection', 'keep-alive', 'transfer-encoding', 'proxy-authorization', 'proxy-authenticate', 'upgrade'].forEach(h => delete forwardHeaders[h]);

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body || undefined,
      redirect: 'manual',
    };

    const upstreamRes = await fetch(finalUrl, fetchOptions);

    const disallowed = ['set-cookie', 'connection', 'content-encoding', 'transfer-encoding'];
    upstreamRes.headers.forEach((value, key) => {
      if (!disallowed.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

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
