/**
 * eraRpc — resolve era block boundaries for eras missing from relay-era-reference.csv.
 *
 * Opens a temporary WebSocket to the archive node, binary-searches
 * Staking.ActiveEra to find era start blocks, and fetches Timestamp.Now
 * for UTC date strings. Used when the CSV is outdated and recent eras
 * are not yet included.
 *
 * Performance: era binary searches and per-era timestamp fetches are run in
 * parallel (bounded by SubstrateRPC's concurrency semaphore, cap=3) rather than
 * the previous fully-sequential approach.  For N missing eras this cuts wall-clock
 * time from O(N × log(chainHead)) to roughly O(log(chainHead)) for the dominant
 * era while the others interleave.
 *
 * Security: caller must validate archiveWss with validateWsEndpoint() before use.
 *           No user-supplied data flows into storage key construction here;
 *           all keys are hardcoded Substrate well-known keys.
 */
import { SubstrateRPC } from './rpc.js'

// twox128("Staking") + twox128("ActiveEra") — verified on Enjin relay chain
const STAKING_ACTIVE_ERA_KEY = '0x5f3e4907f716ac89b6347d15ececedca487df464e44a534ba6b0cbb32407b587'
// twox128("Timestamp") + twox128("Now")
const TIMESTAMP_NOW_KEY = '0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb'

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
    const bh  = await rpc.call('chain_getBlockHash', [mid]).catch(() => null)
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
    const pv  = await rpc.call('state_getStorage', [STAKING_ACTIVE_ERA_KEY, pbh]).catch(() => null)
    if (decodeActiveEra(pv) !== targetEra) break
    result -= 1
  }
  return result
}

// ── Exported function ──────────────────────────────────────────────────────

/**
 * Fetch block boundaries for eras not covered by relay-era-reference.csv.
 *
 * Opens a temporary WebSocket to archiveWss using a SubstrateRPC client
 * (concurrency cap = 3), runs binary searches for all requested eras in
 * parallel, then fetches block hashes and timestamps in parallel.
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
  const rpc = new SubstrateRPC(archiveWss, { concurrency: 3 })
  try {
    await rpc.connect()
    if (signal?.aborted) throw new Error('Aborted')

    const hdr = await rpc.call('chain_getHeader', [])
    const chainHead = parseInt(hdr?.number, 16)
    if (!Number.isFinite(chainHead) || chainHead <= 0)
      throw new Error('Could not determine chain head from archive node')

    // Resolve start blocks for requested eras + the one after the last (to derive endBlock).
    // All binary searches run concurrently — the semaphore (cap=3) keeps the node responsive.
    const toFind     = [...new Set([...eras, Math.max(...eras) + 1])]
    const startBlocks = {}

    await Promise.all(toFind.map(async era => {
      if (signal?.aborted) throw new Error('Aborted')
      const sb = await binarySearchEraStart(rpc, era, chainHead, signal)
      if (sb != null) startBlocks[era] = sb
    }))

    // For each requested era, fetch the block hashes and timestamps for both the
    // start and end blocks concurrently — within an era, hash→storage is sequential
    // but start and end can overlap; across eras everything is parallelised.
    const result = {}

    await Promise.all(eras.map(async era => {
      const sb = startBlocks[era]
      if (sb == null) return

      const endBlock = startBlocks[era + 1] != null ? startBlocks[era + 1] - 1 : null

      // Fetch start-block hash and end-block hash in parallel
      const [hash, eh] = await Promise.all([
        rpc.call('chain_getBlockHash', [sb]).catch(() => null),
        endBlock != null
          ? rpc.call('chain_getBlockHash', [endBlock]).catch(() => null)
          : Promise.resolve(null),
      ])

      // Fetch both timestamps in parallel (each depends on its hash, not each other)
      const [tsRaw, etsRaw] = await Promise.all([
        hash ? rpc.call('state_getStorage', [TIMESTAMP_NOW_KEY, hash]).catch(() => null)
             : Promise.resolve(null),
        eh   ? rpc.call('state_getStorage', [TIMESTAMP_NOW_KEY, eh]).catch(() => null)
             : Promise.resolve(null),
      ])

      const tsMs    = tsRaw    ? decodeTimestampMs(tsRaw)  : null
      const endTsMs = etsRaw   ? decodeTimestampMs(etsRaw) : null

      result[era] = {
        startBlock:     sb,
        endBlock,
        startBlockHash: hash,
        startTs:        tsMs    != null ? Math.floor(tsMs    / 1000) : null,
        endTs:          endTsMs != null ? Math.floor(endTsMs / 1000) : null,
        startDateUtc:   tsMs    != null ? msToUtcString(tsMs)    : null,
        endDateUtc:     endTsMs != null ? msToUtcString(endTsMs) : null,
      }
    }))

    return result
  } finally {
    rpc.close()
  }
}
