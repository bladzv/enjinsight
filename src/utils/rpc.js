/**
 * SubstrateRPC — shared WebSocket JSON-RPC 2.0 client for Substrate nodes.
 *
 * Replaces the per-hook inline RPC classes (MinRPC, ArchiveRPC, EnjinRPC) with a
 * single implementation that adds a concurrency semaphore — limiting the number of
 * calls in-flight at once so a single user session cannot overwhelm shared archive
 * nodes or trigger node-side per-connection rate limits.
 *
 * Features over the inline variants:
 *  - Concurrency semaphore: at most `concurrency` calls in-flight simultaneously.
 *    Calls beyond the cap are queued and dispatched as slots free up.
 *  - Handles both batch (array) and individual JSON-RPC responses in onmessage,
 *    enabling forward-compat with future JSON-RPC batch optimisations.
 *  - Unified cancel() / close() semantics: cancel() drains the semaphore queue and
 *    rejects all in-flight calls; close() then shuts the socket.
 *
 * Security: endpoint must be pre-validated with validateWsEndpoint() before use.
 *           No user-supplied data flows into storage-key construction here.
 */
import { WS_CONNECT_TIMEOUT_MS, WS_CALL_TIMEOUT_MS } from '../constants.js'

// ── Semaphore ─────────────────────────────────────────────────────────────────

/**
 * Promise-based counting semaphore.
 *
 * Acquiring a slot when `count < max` resolves immediately.
 * Acquiring when `count === max` enqueues the caller; it is resolved when a
 * running holder calls release().
 *
 * Important: if acquire() is rejected (via drainWithError), the slot was never
 * granted, so release() must NOT be called for that acquirer.
 */
class Semaphore {
  constructor(max) {
    this._max   = max
    this._count = 0
    this._queue = []    // Array<{ resolve, reject }>
  }

  acquire() {
    if (this._count < this._max) {
      this._count++
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      this._queue.push({ resolve, reject })
    })
  }

  release() {
    if (this._queue.length > 0) {
      // Hand the slot directly to the next waiter; count stays the same.
      this._queue.shift().resolve()
    } else {
      this._count = Math.max(0, this._count - 1)
    }
  }

  /** Reject all enqueued acquirers (used during cancel to unblock waiting callers). */
  drainWithError(err) {
    const q = this._queue.splice(0)
    for (const { reject } of q) reject(err)
  }
}

// ── SubstrateRPC ──────────────────────────────────────────────────────────────

export class SubstrateRPC {
  /**
   * @param {string} ep   WebSocket endpoint (pre-validated by caller)
   * @param {object} [opts]
   * @param {number} [opts.concurrency=3]    Max simultaneous in-flight calls.
   *   A value of 3 keeps the archive node responsive to other users while still
   *   delivering a 3× throughput gain over fully serial dispatch.
   * @param {number} [opts.callTimeoutMs]    Per-call timeout (default: WS_CALL_TIMEOUT_MS)
   * @param {number} [opts.connectTimeoutMs] Connection timeout (default: WS_CONNECT_TIMEOUT_MS)
   */
  constructor(ep, { concurrency = 3, callTimeoutMs, connectTimeoutMs } = {}) {
    this.ep               = ep
    this.ws               = null
    this.pend             = new Map()   // id → { res, rej }
    this.id               = 0
    this.dead             = false
    this.callTimeoutMs    = callTimeoutMs    ?? WS_CALL_TIMEOUT_MS
    this.connectTimeoutMs = connectTimeoutMs ?? WS_CONNECT_TIMEOUT_MS
    this._sem             = new Semaphore(concurrency)
  }

  /** Open the WebSocket and wait for the connection to be established. */
  connect() {
    return new Promise((res, rej) => {
      let ws
      try { ws = new WebSocket(this.ep) }
      catch (e) { return rej(new Error(`Cannot open WebSocket: ${e.message}`)) }
      this.ws = ws

      const tout = setTimeout(
        () => rej(new Error(`Connection timed out (${this.connectTimeoutMs / 1000} s)`)),
        this.connectTimeoutMs,
      )

      ws.onopen  = () => { clearTimeout(tout); res() }
      ws.onerror = () => {
        clearTimeout(tout)
        rej(new Error('WebSocket connection failed — check endpoint'))
      }
      ws.onclose = () => {
        // Reject any calls that are still in-flight when the socket drops.
        const err = new Error('Connection closed')
        this.pend.forEach(p => p.rej(err))
        this.pend.clear()
      }
      // Handle both individual responses and batch (array) responses so the
      // message handler is forward-compatible with JSON-RPC batch mode.
      ws.onmessage = ev => {
        let msgs
        try {
          const parsed = JSON.parse(ev.data)
          msgs = Array.isArray(parsed) ? parsed : [parsed]
        } catch { return }
        for (const msg of msgs) {
          if (typeof msg !== 'object' || msg === null) continue
          const p = this.pend.get(msg.id)
          if (!p) continue
          this.pend.delete(msg.id)
          msg.error
            ? p.rej(new Error(String(msg.error?.message || 'RPC error')))
            : p.res(msg.result)
        }
      }
    })
  }

  /**
   * Make a JSON-RPC call.  Acquires a semaphore slot before sending and releases
   * it when the response (or error) arrives.  Callers that arrive when all slots
   * are busy are queued and dispatched in FIFO order.
   */
  async call(method, params = []) {
    await this._sem.acquire()
    try {
      return await this._rawCall(method, params)
    } finally {
      this._sem.release()
    }
  }

  /** Send a single JSON-RPC request and await its response.  Internal use only. */
  _rawCall(method, params) {
    return new Promise((res, rej) => {
      if (this.dead || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return rej(new Error('Cancelled'))
      }
      const id = ++this.id
      const t  = setTimeout(() => {
        this.pend.delete(id)
        rej(new Error(`Timeout: ${method}`))
      }, this.callTimeoutMs)
      this.pend.set(id, {
        res: v => { clearTimeout(t); res(v) },
        rej: e => { clearTimeout(t); rej(e) },
      })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /**
   * Cancel all in-flight and queued calls (user-initiated abort).
   * Sets the dead flag so subsequent call() invocations fail immediately.
   * The semaphore queue is drained so callers waiting for a slot unblock.
   */
  cancel() {
    this.dead = true
    const err = new Error('Cancelled')
    this._sem.drainWithError(err)
    this.pend.forEach(p => p.rej(err))
    this.pend.clear()
  }

  /** Cancel all calls then close the WebSocket. */
  close() {
    this.cancel()
    try { this.ws?.close(1000, 'done') } catch {}
  }
}
