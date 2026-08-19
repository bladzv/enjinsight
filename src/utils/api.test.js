import { describe, it, expect, vi } from 'vitest'
import { fetchPaged, subscanPost, probeEndpoint, resetSubscanRequestCount, readSubscanRequestCount } from './api.js'
import { ENDPOINTS, SUBSCAN_MAX_ROW, SUBSCAN_MAX_PAGES } from '../constants.js'

// Build a fake `post` that serves `total` records from a synthetic dataset,
// honouring the page/row it is given so offset bugs surface.
function makePost(total, { count = null, shape = 'list' } = {}) {
  const records = Array.from({ length: total }, (_, i) => ({ id: i }))
  const post = vi.fn(async (_path, body) => {
    const start = body.page * body.row
    const slice = records.slice(start, start + body.row)
    const payload = shape === 'list' ? { list: slice } : { extrinsics: slice }
    if (count !== null) payload.count = count
    return { data: payload }
  })
  return post
}

// delayMs: 0 keeps the tests off the real 1s inter-page delay.
const opts = extra => ({ delayMs: 0, ...extra })

describe('fetchPaged', () => {
  it('returns a single short page without asking for a second', async () => {
    const post = makePost(10)
    const out = await fetchPaged(ENDPOINTS.nominators, { address: 'x' }, '', {}, opts({ post }))
    expect(out).toHaveLength(10)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('pages until a short page terminates the walk', async () => {
    const post = makePost(60)   // 25 + 25 + 10
    const out = await fetchPaged(ENDPOINTS.nominators, {}, '', {}, opts({ post }))
    expect(out).toHaveLength(60)
    expect(out.map(r => r.id)).toEqual([...Array(60).keys()])
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('stops on `count` rather than probing an empty page', async () => {
    // Exactly 50 records = two full pages. Without `count` this needs a third
    // (empty) request to learn it is done.
    const post = makePost(50, { count: 50 })
    const out = await fetchPaged(ENDPOINTS.pools, {}, '', {}, opts({ post }))
    expect(out).toHaveLength(50)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('probes one extra page when the endpoint reports no count', async () => {
    const post = makePost(50)
    const out = await fetchPaged(ENDPOINTS.pools, {}, '', {}, opts({ post }))
    expect(out).toHaveLength(50)
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('caps the result at `max` and stops paging once reached', async () => {
    const post = makePost(500)
    const out = await fetchPaged(ENDPOINTS.eraStat, {}, '', {}, opts({ post, max: 31 }))
    expect(out).toHaveLength(31)
    expect(out[30].id).toBe(30)
    expect(post).toHaveBeenCalledTimes(2)   // 25 + 25, sliced to 31
  })

  it('holds `row` constant across pages so offsets stay aligned', async () => {
    const post = makePost(500)
    await fetchPaged(ENDPOINTS.eraStat, {}, '', {}, opts({ post, max: 31 }))
    for (const call of post.mock.calls) {
      expect(call[1].row).toBe(SUBSCAN_MAX_ROW)
    }
    expect(post.mock.calls.map(c => c[1].page)).toEqual([0, 1])
  })

  it('does not send page/row from the caller-supplied body', async () => {
    const post = makePost(10)
    await fetchPaged(ENDPOINTS.eraStat, { address: 'abc' }, '', {}, opts({ post }))
    expect(post.mock.calls[0][1]).toEqual({ address: 'abc', page: 0, row: SUBSCAN_MAX_ROW })
  })

  it('aborts mid-loop when the signal fires', async () => {
    const ctrl = new AbortController()
    const post = vi.fn(async (_p, body) => {
      if (body.page === 1) ctrl.abort()
      return { data: { list: Array.from({ length: SUBSCAN_MAX_ROW }, (_, i) => ({ i })) } }
    })
    await expect(
      fetchPaged(ENDPOINTS.nominators, {}, '', { signal: ctrl.signal }, opts({ post })),
    ).rejects.toThrow('Aborted')
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('never issues a request when the signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const post = makePost(10)
    await expect(
      fetchPaged(ENDPOINTS.nominators, {}, '', { signal: ctrl.signal }, opts({ post })),
    ).rejects.toThrow('Aborted')
    expect(post).not.toHaveBeenCalled()
  })

  it('reports each page through onPage', async () => {
    const post = makePost(30)
    const seen = []
    await fetchPaged(ENDPOINTS.pools, {}, '', {}, opts({ post, onPage: (p, n) => seen.push([p, n]) }))
    expect(seen).toEqual([[0, 25], [1, 5]])
  })

  it('supports endpoints that return a differently-named list', async () => {
    const post = makePost(30, { shape: 'extrinsics' })
    const out = await fetchPaged(
      ENDPOINTS.extrinsics, {}, '', {},
      opts({ post, listOf: d => d?.data?.extrinsics ?? [] }),
    )
    expect(out).toHaveLength(30)
  })

  it('stops at the page cap and warns instead of looping forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const post = makePost(SUBSCAN_MAX_ROW * (SUBSCAN_MAX_PAGES + 10))
    const out = await fetchPaged(ENDPOINTS.rewardSlash, {}, '', {}, opts({ post }))
    expect(post).toHaveBeenCalledTimes(SUBSCAN_MAX_PAGES)
    expect(out).toHaveLength(SUBSCAN_MAX_ROW * SUBSCAN_MAX_PAGES)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('truncated'))
    warn.mockRestore()
  })

  it('tolerates a malformed response by treating it as a short page', async () => {
    const post = vi.fn(async () => ({}))
    const out = await fetchPaged(ENDPOINTS.nominators, {}, '', {}, opts({ post }))
    expect(out).toEqual([])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('forwards subscanPost options (attempts/onRetry) unchanged to every page', async () => {
    const post = makePost(30)
    const onRetry = () => {}
    await fetchPaged(ENDPOINTS.nominators, {}, '', { attempts: 5, onRetry }, opts({ post }))
    for (const call of post.mock.calls) {
      expect(call[3]).toMatchObject({ attempts: 5, onRetry })
    }
  })
})

describe('subscan request counter', () => {
  const okResponse = (body = { code: 0, data: { list: [] } }) => ({
    ok: true,
    status: 200,
    headers: { get: h => (h === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  })
  const errResponse = status => ({
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({}),
  })

  it('starts at zero after a reset', () => {
    resetSubscanRequestCount()
    expect(readSubscanRequestCount()).toBe(0)
  })

  it('counts each real subscanPost attempt', async () => {
    resetSubscanRequestCount()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    await subscanPost(ENDPOINTS.eraStat, { address: 'x', page: 0, row: 25 }, '', { signal: new AbortController().signal })
    await subscanPost(ENDPOINTS.eraStat, { address: 'y', page: 0, row: 25 }, '', { signal: new AbortController().signal })
    expect(readSubscanRequestCount()).toBe(2)
    fetchSpy.mockRestore()
  })

  it('counts probeEndpoint requests too', async () => {
    resetSubscanRequestCount()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ code: 400, message: 'EOF' }))
    await probeEndpoint(ENDPOINTS.validators, null, new AbortController().signal)
    expect(readSubscanRequestCount()).toBe(1)
    fetchSpy.mockRestore()
  })

  it('counts every retry attempt, not just the final one', async () => {
    resetSubscanRequestCount()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(okResponse())
    await subscanPost(
      ENDPOINTS.eraStat, { address: 'x', page: 0, row: 25 }, '',
      { signal: new AbortController().signal, attempts: 3, retryBaseMs: 1 },
    )
    expect(readSubscanRequestCount()).toBe(3)
    fetchSpy.mockRestore()
  })

  it('resetting mid-run does not throw and rebases the count', async () => {
    resetSubscanRequestCount()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    await subscanPost(ENDPOINTS.eraStat, { address: 'x', page: 0, row: 25 }, '', { signal: new AbortController().signal })
    resetSubscanRequestCount()
    expect(readSubscanRequestCount()).toBe(0)
    fetchSpy.mockRestore()
  })
})
