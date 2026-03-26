/**
 * eraRpc — resolve era block boundaries for eras missing from relay-era-reference.csv.
 *
 * Opens a temporary WebSocket to the archive node, binary-searches
 * Staking.ActiveEra to find era start blocks, and fetches Timestamp.Now
 * for UTC date strings. Used when the CSV is outdated and recent eras
 * are not yet included.
 *
 * Security: caller must validate archiveWss with validateWsEndpoint() before use.
 *           No user-supplied data flows into storage key construction here;
 *           all keys are hardcoded Substrate well-known keys.
 */
import { WS_CONNECT_TIMEOUT_MS, WS_CALL_TIMEOUT_MS } from '../constants.js'

// twox128("Staking") + twox128("ActiveEra")
const STAKING_ACTIVE_ERA_KEY = '0x5f3e4907f716ac89b6347d15ececedca686dcf6300e60d5d7bce8b49c965bc6d'
// twox128("Timestamp") + twox128("Now")
const TIMESTAMP_NOW_KEY = '0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb'

// ── Minimal one-shot WS-RPC client ─────────────────────────────────────────
class MinRPC {
  constructor(ep) {
    this.ep   = ep
    this.ws   = null
    this.pend = new Map()
    this.id   = 0
    this.dead = false
  }

  connect() {
    return new Promise((res, rej) => {
      let ws
      try { ws = new WebSocket(this.ep) }
      catch (e) { return rej(new Error(`Cannot open WebSocket: ${e.message}`)) }
      this.ws = ws
      const tout = setTimeout(() => {
        try { ws.close() } catch {}
        rej(new Error('Connection timed out'))
      }, WS_CONNECT_TIMEOUT_MS)
      ws.onopen  = () => { clearTimeout(tout); res() }
      ws.onerror = () => { clearTimeout(tout); rej(new Error('WebSocket connection failed')) }
      ws.onclose = () => {
        this.pend.forEach(p => p.rej(new Error('Connection closed')))
        this.pend.clear()
      }
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(ev.data) } catch { return }
        if (!msg?.id) return
        const p = this.pend.get(msg.id)
        if (!p) return
        this.pend.delete(msg.id)
        msg.error ? p.rej(new Error(String(msg.error?.message ?? 'RPC error'))) : p.res(msg.result)
      }
    })
  }

  call(method, params = []) {
    return new Promise((res, rej) => {
      if (this.dead || !this.ws || this.ws.readyState !== WebSocket.OPEN)
        return rej(new Error('Not connected'))
      const id = ++this.id
      const t = setTimeout(() => {
        this.pend.delete(id)
        rej(new Error(`Timeout: ${method}`))
      }, WS_CALL_TIMEOUT_MS)
      this.pend.set(id, {
        res: v => { clearTimeout(t); res(v) },
        rej: e => { clearTimeout(t); rej(e) },
      })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  close() {
    this.dead = true
    this.pend.forEach(p => p.rej(new Error('Closed')))
    this.pend.clear()
    try { this.ws?.close(1000, 'done') } catch {}
  }
}

// ── SCALE decoders ─────────────────────────────────────────────────────────

function decodeActiveEra(hex) {
  if (!hex || hex === '0x') return null
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  if (s.length < 8) return null
  const read32 = off => {
    const i = off * 2
    if (s.length < i + 8) return null
    return (
      parseInt(s.slice(i,     i + 2), 16)        |
      parseInt(s.slice(i + 2, i + 4), 16) <<  8  |
      parseInt(s.slice(i + 4, i + 6), 16) << 16  |
      parseInt(s.slice(i + 6, i + 8), 16) * 16777216
    ) >>> 0
  }
  if (parseInt(s.slice(0, 2), 16) === 0x01) {
    const v = read32(1)
    if (v != null) return v
  }
  return read32(0)
}

/** Decode Timestamp.Now (u64 LE) → milliseconds since epoch as a Number. */
function decodeTimestampMs(hex) {
  if (!hex || hex === '0x') return null
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  if (s.length < 16) return null
  let v = 0n
  for (let i = 0; i < 8; i++)
    v |= BigInt(parseInt(s.slice(i * 2, i * 2 + 2), 16)) << BigInt(i * 8)
  return Number(v)
}

function msToUtcString(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

// ── Binary search ──────────────────────────────────────────────────────────

async function binarySearchEraStart(rpc, targetEra, chainHead, signal) {
  let lo = 1, hi = chainHead, result = null
  while (lo <= hi) {
    if (signal?.aborted) throw new Error('Aborted')
    const mid = Math.floor((lo + hi) / 2)
    const bh = await rpc.call('chain_getBlockHash', [mid]).catch(() => null)
    if (!bh || /^0x0+$/.test(bh)) { lo = mid + 1; continue }
    const raw = await rpc.call('state_getStorage', [STAKING_ACTIVE_ERA_KEY, bh]).catch(() => null)
    const midEra = decodeActiveEra(raw)
    if (midEra == null) { lo = mid + 1; continue }
    if      (midEra < targetEra) lo = mid + 1
    else if (midEra > targetEra) hi = mid - 1
    else                         { result = mid; hi = mid - 1 }
  }
  if (result == null) return null
  // Walk leftward to find the exact first block of the era
  while (result > 1) {
    if (signal?.aborted) throw new Error('Aborted')
    const pbh = await rpc.call('chain_getBlockHash', [result - 1]).catch(() => null)
    if (!pbh) break
    const pv = await rpc.call('state_getStorage', [STAKING_ACTIVE_ERA_KEY, pbh]).catch(() => null)
    if (decodeActiveEra(pv) !== targetEra) break
    result -= 1
  }
  return result
}

// ── Exported function ──────────────────────────────────────────────────────

/**
 * Fetch block boundaries for eras not covered by relay-era-reference.csv.
 *
 * Opens a temporary WebSocket to archiveWss, binary-searches Staking.ActiveEra
 * for each requested era, fetches Timestamp.Now for UTC dates, then closes.
 *
 * The caller should also request era N+1 implicitly so that era N's endBlock
 * can be derived; this is handled internally.
 *
 * @param {string}      archiveWss  Archive node WSS endpoint (pre-validated)
 * @param {number[]}    eras        Sorted array of era numbers to resolve
 * @param {AbortSignal} [signal]    Optional abort signal
 * @returns {Promise<Record<number, {
 *   startBlock: number, endBlock: number|null,
 *   startBlockHash: string|null,
 *   startTs: number|null, endTs: number|null,
 *   startDateUtc: string|null, endDateUtc: string|null
 * }>>}
 */
export async function fetchEraBoundariesFromRpc(archiveWss, eras, signal) {
  if (!eras.length) return {}
  const rpc = new MinRPC(archiveWss)
  try {
    await rpc.connect()
    if (signal?.aborted) throw new Error('Aborted')

    const hdr = await rpc.call('chain_getHeader', [])
    const chainHead = parseInt(hdr?.number, 16)
    if (!Number.isFinite(chainHead) || chainHead <= 0)
      throw new Error('Could not determine chain head from archive node')

    // Resolve start blocks for requested eras + the one after the last (to derive endBlock)
    const toFind = [...new Set([...eras, Math.max(...eras) + 1])]
    const startBlocks = {}
    for (const era of toFind) {
      if (signal?.aborted) throw new Error('Aborted')
      const sb = await binarySearchEraStart(rpc, era, chainHead, signal)
      if (sb != null) startBlocks[era] = sb
    }

    const result = {}
    for (const era of eras) {
      const sb = startBlocks[era]
      if (sb == null) continue

      const hash = await rpc.call('chain_getBlockHash', [sb]).catch(() => null)
      const tsRaw = hash
        ? await rpc.call('state_getStorage', [TIMESTAMP_NOW_KEY, hash]).catch(() => null)
        : null
      const tsMs = tsRaw ? decodeTimestampMs(tsRaw) : null

      const endBlock = startBlocks[era + 1] != null ? startBlocks[era + 1] - 1 : null
      let endTsMs = null
      if (endBlock != null) {
        const eh = await rpc.call('chain_getBlockHash', [endBlock]).catch(() => null)
        const etsRaw = eh
          ? await rpc.call('state_getStorage', [TIMESTAMP_NOW_KEY, eh]).catch(() => null)
          : null
        endTsMs = etsRaw ? decodeTimestampMs(etsRaw) : null
      }

      result[era] = {
        startBlock:     sb,
        endBlock,
        startBlockHash: hash,
        startTs:        tsMs    != null ? Math.floor(tsMs    / 1000) : null,
        endTs:          endTsMs != null ? Math.floor(endTsMs / 1000) : null,
        startDateUtc:   tsMs    != null ? msToUtcString(tsMs)    : null,
        endDateUtc:     endTsMs != null ? msToUtcString(endTsMs) : null,
      }
    }
    return result
  } finally {
    rpc.close()
  }
}
