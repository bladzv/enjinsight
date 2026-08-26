import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SUBSCAN_PATH_ALLOWLIST } from './[...proxy].js'
import { ENDPOINTS } from '../src/constants.js'

// The serverless proxy cannot import src/constants.js: that module reads
// `import.meta.env.PROD`, which is a Vite construct and throws in the Node
// runtime the function actually executes in. The proxy therefore keeps its own
// copy of the path list, and this test is what stops the two from drifting.
describe('Subscan proxy path allowlist', () => {
  it('matches ENDPOINTS in src/constants.js exactly', () => {
    const fromConstants = [...new Set(Object.values(ENDPOINTS))].sort()
    const fromProxy = [...SUBSCAN_PATH_ALLOWLIST].sort()
    expect(fromProxy).toEqual(fromConstants)
  })

  it('contains only absolute /api paths with no traversal', () => {
    for (const path of SUBSCAN_PATH_ALLOWLIST) {
      expect(path.startsWith('/api/')).toBe(true)
      expect(path).not.toContain('..')
    }
  })
})

// ── Request gates ────────────────────────────────────────────────────────────
// Both gates run at the top of the handler, before any route dispatch, and both
// refuse outright rather than merely withholding CORS headers. These tests are
// what stops a refactor from silently reopening the proxy (or, in PROXY_SECRET's
// case, from being quietly widened past every route).
//
// IMPORTANT: ALLOWED_ORIGINS is built once in a module-scope IIFE, so it is frozen
// at import time. Each case must set process.env BEFORE importing, then reset the
// module registry — a beforeEach that mutates process.env after import would pass
// for the wrong reason and lock in a false guarantee.
describe('proxy request gates', () => {
  const GATE_ENV_KEYS = [
    'ALLOWED_ORIGINS',
    'VERCEL_PROJECT_PRODUCTION_URL',
    'VERCEL_BRANCH_URL',
    'VERCEL_URL',
    'VERCEL_ENV',
    'PROXY_SECRET',
  ]

  let saved

  beforeEach(() => {
    saved = Object.fromEntries(GATE_ENV_KEYS.map(k => [k, process.env[k]]))
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    vi.resetModules()
  })

  /** Load a fresh copy of the proxy module with exactly `env` applied. */
  async function loadGates(env = {}) {
    for (const k of GATE_ENV_KEYS) delete process.env[k]
    for (const [k, v] of Object.entries(env)) process.env[k] = v
    vi.resetModules()
    return import('./[...proxy].js')
  }

  const req = (headers = {}) => ({ headers })

  const makeRes = () => ({
    statusCode: 200,
    body: undefined,
    ended: false,
    _headers: {},
    setHeader(k, v) { this._headers[k.toLowerCase()] = v },
    getHeader(k) { return this._headers[k.toLowerCase()] },
    end(body) { this.ended = true; this.body = body },
  })

  describe('origin gate', () => {
    it('treats a missing Origin as same-origin and lets it through', async () => {
      const { classifyOrigin, enforceOrigin } = await loadGates({
        VERCEL_PROJECT_PRODUCTION_URL: 'enjinsight.vercel.app',
      })
      expect(classifyOrigin(req())).toEqual({ kind: 'same-origin', origin: null })
      const res = makeRes()
      expect(enforceOrigin(req(), res)).toBe(true)
      expect(res.ended).toBe(false)
    })

    it('allows the origin derived from VERCEL_PROJECT_PRODUCTION_URL', async () => {
      const { classifyOrigin, enforceOrigin } = await loadGates({
        VERCEL_PROJECT_PRODUCTION_URL: 'enjinsight.vercel.app',
      })
      const r = req({ origin: 'https://enjinsight.vercel.app' })
      expect(classifyOrigin(r).kind).toBe('allowed')
      expect(enforceOrigin(r, makeRes())).toBe(true)
    })

    it('derives origins from VERCEL_BRANCH_URL and VERCEL_URL too', async () => {
      const { classifyOrigin } = await loadGates({
        VERCEL_BRANCH_URL: 'enjinsight-git-main.vercel.app',
        VERCEL_URL: 'enjinsight-abc123.vercel.app',
      })
      expect(classifyOrigin(req({ origin: 'https://enjinsight-git-main.vercel.app' })).kind).toBe('allowed')
      expect(classifyOrigin(req({ origin: 'https://enjinsight-abc123.vercel.app' })).kind).toBe('allowed')
    })

    it('refuses an unlisted origin with 403 and grants it no CORS header', async () => {
      const { enforceOrigin } = await loadGates({
        VERCEL_PROJECT_PRODUCTION_URL: 'enjinsight.vercel.app',
      })
      const res = makeRes()
      expect(enforceOrigin(req({ origin: 'https://evil.example' }), res)).toBe(false)
      expect(res.statusCode).toBe(403)
      expect(res.ended).toBe(true)
      // The whole point: the Origin is never reflected back.
      expect(res.getHeader('access-control-allow-origin')).toBeUndefined()
      expect(res.getHeader('vary')).toBe('Origin')
    })

    it('honours ALLOWED_ORIGINS, including comma lists and trailing slashes', async () => {
      const { classifyOrigin } = await loadGates({
        ALLOWED_ORIGINS: 'https://app.example.com/,https://alt.example.com',
      })
      expect(classifyOrigin(req({ origin: 'https://app.example.com' })).kind).toBe('allowed')
      expect(classifyOrigin(req({ origin: 'https://alt.example.com' })).kind).toBe('allowed')
      // A trailing slash on the *request* Origin is stripped before comparison.
      expect(classifyOrigin(req({ origin: 'https://app.example.com/' })).kind).toBe('allowed')
      expect(classifyOrigin(req({ origin: 'https://other.example.com' })).kind).toBe('denied')
    })

    it('allows localhost outside production but denies it in production', async () => {
      const dev = await loadGates({ VERCEL_PROJECT_PRODUCTION_URL: 'enjinsight.vercel.app' })
      expect(dev.classifyOrigin(req({ origin: 'http://localhost:5173' })).kind).toBe('allowed')
      expect(dev.classifyOrigin(req({ origin: 'http://127.0.0.1:5173' })).kind).toBe('allowed')

      const prod = await loadGates({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'enjinsight.vercel.app',
      })
      expect(prod.classifyOrigin(req({ origin: 'http://localhost:5173' })).kind).toBe('denied')
    })
  })

  describe('shared-secret gate', () => {
    it('is inert when PROXY_SECRET is unset', async () => {
      const { enforceProxySecret } = await loadGates()
      const res = makeRes()
      expect(enforceProxySecret(req(), res)).toBe(true)
      expect(res.ended).toBe(false)
    })

    it('401s a request with no x-proxy-secret when the secret is set', async () => {
      // This is the documented trap: no in-repo client sends the header, so
      // setting PROXY_SECRET rejects every request.
      const { enforceProxySecret } = await loadGates({ PROXY_SECRET: 's3cret' })
      const res = makeRes()
      expect(enforceProxySecret(req(), res)).toBe(false)
      expect(res.statusCode).toBe(401)
      expect(res.ended).toBe(true)
    })

    it('401s a mismatched secret and passes a matching one', async () => {
      const { enforceProxySecret } = await loadGates({ PROXY_SECRET: 's3cret' })
      const bad = makeRes()
      expect(enforceProxySecret(req({ 'x-proxy-secret': 'wrong' }), bad)).toBe(false)
      expect(bad.statusCode).toBe(401)

      const good = makeRes()
      expect(enforceProxySecret(req({ 'x-proxy-secret': 's3cret' }), good)).toBe(true)
      expect(good.ended).toBe(false)
    })
  })
})
