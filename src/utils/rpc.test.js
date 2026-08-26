import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SubstrateRPC, CancelledError, isCancelled } from './rpc.js'

// Minimal controllable WebSocket double. Nothing connects on its own — each test
// drives the handshake explicitly so timing races are deterministic.
class FakeWebSocket {
  static OPEN = 1
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.closed = null
    FakeWebSocket.instances.push(this)
  }
  send(payload) { this.sent.push(payload) }
  close(code, reason) {
    this.closed = { code, reason }
    this.readyState = 3
    this.onclose?.()
  }
  // helpers
  open() { this.readyState = 1; this.onopen?.() }
  reply(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

describe('isCancelled', () => {
  it('recognises CancelledError and AbortError but not arbitrary messages', () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    expect(isCancelled(new CancelledError())).toBe(true)
    expect(isCancelled(abortErr)).toBe(true)
    // A plain Error whose text happens to read "Cancelled" must NOT pass:
    // that is exactly the string-matching this type replaces.
    expect(isCancelled(new Error('Cancelled'))).toBe(false)
    expect(isCancelled(undefined)).toBe(false)
  })
})

describe('SubstrateRPC.connect', () => {
  it('closes the socket when the connection times out', async () => {
    const rpc = new SubstrateRPC('wss://example.invalid', { connectTimeoutMs: 1000 })
    const p = rpc.connect()
    const ws = latest()
    expect(ws.closed).toBeNull()

    // Attach the rejection handler before advancing timers: the rejection fires
    // inside advanceTimersByTimeAsync, and a handler attached afterwards would
    // register as an unhandled rejection.
    const assertion = expect(p).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1001)
    await assertion

    // The regression: a timed-out socket used to be abandoned, so it could still
    // finish its handshake later and stay open for the lifetime of the page.
    expect(ws.closed).not.toBeNull()
    expect(rpc.dead).toBe(true)
  })

  it('marks the client dead when the socket closes', async () => {
    const rpc = new SubstrateRPC('wss://example.invalid')
    const p = rpc.connect()
    const ws = latest()
    ws.open()
    await p
    expect(rpc.dead).toBe(false)

    ws.close(1006, 'dropped')
    expect(rpc.dead).toBe(true)
  })

  it('rejects in-flight calls when the socket drops', async () => {
    const rpc = new SubstrateRPC('wss://example.invalid')
    const p = rpc.connect()
    latest().open()
    await p

    const call = rpc.call('chain_getBlockHash', [1])
    // call() awaits the semaphore first, so let the microtask queue drain until
    // the request is genuinely registered in `pend` — otherwise the socket is
    // already shut by the time _rawCall runs and we'd exercise the wrong branch.
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc.pend.size).toBe(1)

    latest().close(1006, 'dropped')
    await expect(call).rejects.toThrow(/Connection closed/)
  })
})

describe('SubstrateRPC.cancel', () => {
  it('rejects in-flight calls with a typed CancelledError', async () => {
    const rpc = new SubstrateRPC('wss://example.invalid')
    const p = rpc.connect()
    latest().open()
    await p

    const call = rpc.call('chain_getBlockHash', [1])
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc.pend.size).toBe(1)

    rpc.cancel()
    await expect(call).rejects.toSatisfy(isCancelled)
  })

  it('fails subsequent calls immediately once cancelled', async () => {
    const rpc = new SubstrateRPC('wss://example.invalid')
    const p = rpc.connect()
    latest().open()
    await p

    rpc.cancel()
    await expect(rpc.call('chain_getBlockHash', [1])).rejects.toSatisfy(isCancelled)
  })
})
