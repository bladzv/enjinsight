/**
 * useEraExplorer — manages the Era Block Explorer live state.
 *
 * Boot sequence:
 *  1. Connect to archive node — discover Staking + Session pallet keys,
 *     read the current ActiveEra, binary-search its first block. Close archive.
 *  2. Connect to live node — subscribe to chain_newHead for real-time block
 *     updates. Periodically re-verify era. On era change: open a fresh archive
 *     WS to binary-search the new era start.
 */
import { useReducer, useCallback, useRef, useEffect } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────
const WSS            = 'wss://rpc.relay.blockchain.enjin.io'
const ARCHIVE_WSS    = 'wss://archive.relay.blockchain.enjin.io'
const ERA_LEN        = 14400
const SESSION_LEN    = 2400
const HISTORY_DEPTH  = 84
const ERA_START_ITEM = 'ErasStartSessionIndex'
const CSV_PATH       = '/relay-era-reference.csv'

const STAKING_CANDIDATES = ['Staking','EnjinStaking','ParachainStaking','RelayStaking','PoAStaking']
const STAKING_ERA_ITEM   = ['ActiveEra','CurrentEra','active_era','current_era']
const SESSION_CANDIDATES = ['Session','EnjinSession','ParachainSession']
const SESSION_IDX_ITEM   = ['CurrentIndex','current_index','Index']

// ── xxHash64 (pure BigInt JS) ─────────────────────────────────────────────────
function xxh64(data, seed) {
  const P1=11400714785074694791n,P2=14029467366897019727n,
        P3=1609587929392839161n, P4=9650029242287828579n,
        P5=2870177450012600261n, M=(1n<<64n)-1n
  const lo=x=>x&M, mul=(a,b)=>lo(a*b), add=(a,b)=>lo(a+b)
  const rotl=(x,r)=>lo((x<<r)|(x>>(64n-r)))
  const round=(acc,inp)=>mul(rotl(add(acc,mul(inp,P2)),31n),P1)
  const merge=(acc,val)=>add(mul(lo(acc^round(0n,val)),P1),P4)
  const s=BigInt(seed), dv=new DataView(data.buffer,data.byteOffset,data.byteLength), n=data.length
  let p=0, h
  if(n>=32){
    let v1=add(add(s,P1),P2),v2=add(s,P2),v3=s,v4=lo(s-P1)
    while(p<=n-32){v1=round(v1,dv.getBigUint64(p,true));p+=8;v2=round(v2,dv.getBigUint64(p,true));p+=8;v3=round(v3,dv.getBigUint64(p,true));p+=8;v4=round(v4,dv.getBigUint64(p,true));p+=8}
    h=add(add(add(rotl(v1,1n),rotl(v2,7n)),rotl(v3,12n)),rotl(v4,18n))
    h=merge(merge(merge(merge(h,v1),v2),v3),v4)
  } else { h=add(s,P5) }
  h=add(h,BigInt(n))
  while(p<=n-8){h=add(mul(rotl(lo(h^round(0n,dv.getBigUint64(p,true))),27n),P1),P4);p+=8}
  if(p<=n-4){h=add(mul(rotl(lo(h^mul(BigInt(dv.getUint32(p,true)),P1)),23n),P2),P3);p+=4}
  while(p<n){h=mul(rotl(lo(h^mul(BigInt(data[p]),P5)),11n),P1);p++}
  h=mul(lo(h^(h>>33n)),P2);h=mul(lo(h^(h>>29n)),P3);return lo(h^(h>>32n))
}
function twox128(text) {
  const b=new TextEncoder().encode(text)
  const leHex=h=>{let s='';for(let i=0;i<8;i++)s+=Number((h>>(8n*BigInt(i)))&0xFFn).toString(16).padStart(2,'0');return s}
  return leHex(xxh64(b,0))+leHex(xxh64(b,1))
}
function storageKey(pallet,item){ return '0x'+twox128(pallet)+twox128(item) }

// ── SCALE mini-decoders ────────────────────────────────────────────────────────
function h2b(hex){ hex=hex.replace('0x','');const b=new Uint8Array(hex.length/2);for(let i=0;i<hex.length;i+=2)b[i/2]=parseInt(hex.substr(i,2),16);return b }
function u32LE(b,o=0){ return (b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]*16777216)>>>0 }
function hexToNum(h){ return parseInt(h,16) }
function decodeActiveEra(hex){
  if(!hex) return null
  const b=h2b(hex)
  if(b.length>=5&&b[0]===0x01){const v=u32LE(b,1);if(v<1000000)return v}
  if(b.length>=4){const v=u32LE(b,0);if(v<1000000)return v}
  return null
}
function decodeU32(hex){ if(!hex)return null;const b=h2b(hex);return b.length>=4?u32LE(b,0):null }

// ── Status enum ───────────────────────────────────────────────────────────────
export const ERA_STATUS = {
  IDLE:        'idle',
  CONNECTING:  'connecting',
  DISCOVERING: 'discovering',
  LIVE:        'live',
  DISCONNECTED:'disconnected',
}

// ── Reducer ───────────────────────────────────────────────────────────────────
const initialState = {
  status:       ERA_STATUS.IDLE,
  era:          null,
  session:      null,
  block:        null,
  eraStart:     null,
  eraStartMethod: null,   // 'archive' | 'failed'
  csvCount:     0,
  lookup:       null,     // { era, startBlock, endBlock, source, startDateUtc, endDateUtc, startBlockHash }
  lookupLoading:false,
  lookupError:  null,
  logs:         [],
  debug: {
    wsState:       '—',
    stakingPallet: 'searching…',
    sessionPallet: 'searching…',
    eraKey:        '—',
    eraHex:        '—',
    eraRaw:        '—',
    sessKey:       '—',
    sessHex:       '—',
    sessRaw:       '—',
    blockHex:      '—',
    blockDec:      '—',
    lastError:     '—',
  },
}

function reducer(state, action) {
  switch(action.type) {
    case 'STATUS':       return { ...state, status: action.payload }
    case 'CHAIN_UPDATE': return { ...state, ...action.patch }
    case 'ERA_START':    return { ...state, eraStart: action.eraStart, eraStartMethod: action.method }
    case 'CSV_LOADED':   return { ...state, csvCount: action.count }
    case 'DEBUG':        return { ...state, debug: { ...state.debug, ...action.patch } }
    case 'LOOKUP_START': return { ...state, lookupLoading: true, lookupError: null, lookup: null }
    case 'LOOKUP_DONE':  return { ...state, lookupLoading: false, lookup: action.result }
    case 'LOOKUP_ERROR': return { ...state, lookupLoading: false, lookupError: action.error }
    case 'RESET_LOOKUP': return { ...state, lookup: null, lookupLoading: false, lookupError: null }
    case 'LOG': {
      const next = [...state.logs, action.payload]
      return { ...state, logs: next.length > 200 ? next.slice(-200) : next }
    }
    default: return state
  }
}

// ── Controller (manages all WS + async chain state) ──────────────────────────
class EraExplorerController {
  constructor(dispatch) {
    this.dispatch  = dispatch
    this.ws        = null        // live WS
    this._archiveWs = null       // archive WS (tracked for cleanup)
    this.pending   = {}
    this.reqId     = 1
    this.keys      = { activeEra: null, sessionIdx: null, eraStartPrefix: null }
    this.chain     = { era: null, session: null, block: null }
    this.csvCache  = {}
    this.eraBlockCache = {}
    this.eraSessionKeys = null
    this.lockedEra  = null
    this.lockedStart = null
    this.killed     = false
    this.reconnTimer = null
    this.beatCallback = null
  }

  log(level, message) {
    this.dispatch({
      type: 'LOG',
      payload: {
        id:      Date.now() + Math.random(),
        ts:      new Date().toTimeString().slice(0, 8),
        level:   level.toUpperCase(),
        message: String(message),
      },
    })
  }

  // RPC call over main live WS
  rpc(method, params = [], ms = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('not connected'))
      }
      const id = this.reqId++
      const timer = setTimeout(() => { delete this.pending[id]; reject(new Error(`timeout: ${method}`)) }, ms)
      this.pending[id] = {
        resolve: v => { clearTimeout(timer); resolve(v) },
        reject:  e => { clearTimeout(timer); reject(e) },
      }
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || [] }))
    })
  }

  // One-shot WS to the archive node — fn(callFn) runs inside an open session
  archiveRpc(fn) {
    return new Promise((resolve, reject) => {
      let ws
      try { ws = new WebSocket(ARCHIVE_WSS) } catch(e) { return reject(e) }
      this._archiveWs = ws
      const pending = {}, reqIdA = { v: 1 }
      const call = (method, params = [], ms = 30000) =>
        new Promise((r, e) => {
          if (this.killed) return e(new Error('destroyed'))
          if (!ws || ws.readyState !== WebSocket.OPEN) return e(new Error('archive not open'))
          const id = reqIdA.v++
          const t = setTimeout(() => { delete pending[id]; e(new Error(`timeout: ${method}`)) }, ms)
          pending[id] = { resolve: v => { clearTimeout(t); r(v) }, reject: x => { clearTimeout(t); e(x) } }
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || [] }))
        })
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg?.id && pending[msg.id]) {
            msg.error
              ? pending[msg.id].reject(new Error(String(msg.error?.message || 'rpc error')))
              : pending[msg.id].resolve(msg.result)
            delete pending[msg.id]
          }
        } catch {}
      }
      ws.onerror = () => {}
      let settled = false
      const openTimeout = setTimeout(() => {
        try { ws.close() } catch {}
        if (!settled) { settled = true; reject(new Error('archive open timeout')) }
      }, 10000)
      const finish = cb => {
        settled = true
        clearTimeout(openTimeout)
        this._archiveWs = null
        try { ws.close() } catch {}
        cb()
      }
      ws.onclose = () => {
        if (settled) return
        clearTimeout(openTimeout)
        this._archiveWs = null
        reject(new Error('archive WS closed unexpectedly'))
      }
      ws.onopen  = () => {
        clearTimeout(openTimeout)
        fn(call)
          .then(v => finish(() => resolve(v)))
          .catch(e => finish(() => reject(e)))
      }
    })
  }

  // Pure binary search helper — works with any call function (archive or live)
  async _binarySearch(callFn, key, targetEra, chainHead) {
    let lo = 1, hi = chainHead, result = null
    while (lo <= hi) {
      if (this.killed) throw new Error('controller destroyed')
      const mid = Math.floor((lo + hi) / 2)
      const bh = await callFn('chain_getBlockHash', [mid]).catch(() => null)
      if (!bh) { lo = mid + 1; continue }
      const val = await callFn('state_getStorage', [key, bh]).catch(() => null)
      const midEra = decodeActiveEra(val)
      if (midEra == null) { lo = mid + 1; continue }
      if (midEra < targetEra)      lo = mid + 1
      else if (midEra > targetEra) hi = mid - 1
      else                         { result = mid; hi = mid - 1 }
    }
    if (result == null) return null
    while (result > 1) {
      if (this.killed) throw new Error('controller destroyed')
      const pbh = await callFn('chain_getBlockHash', [result - 1]).catch(() => null)
      if (!pbh) break
      const pv = await callFn('state_getStorage', [key, pbh]).catch(() => null)
      if (decodeActiveEra(pv) !== targetEra) break
      result -= 1
    }
    return result
  }

  // Discover pallet keys using the supplied call function (archive or live)
  async discoverKeys(callFn) {
    const query = callFn || ((m, p) => this.rpc(m, p))
    this.log('info', 'Discovering pallet storage keys…')
    let foundStaking = false
    outer:
    for (const pallet of STAKING_CANDIDATES) {
      for (const item of STAKING_ERA_ITEM) {
        if (this.killed) throw new Error('controller destroyed')
        const key = storageKey(pallet, item)
        try {
          const val = await query('state_getStorage', [key])
          if (val != null) {
            this.keys.activeEra      = key
            this.keys.eraStartPrefix = '0x' + twox128(pallet) + twox128(ERA_START_ITEM)
            const dec = decodeActiveEra(val)
            if (dec != null) { this.chain.era = dec; this.dispatch({ type: 'CHAIN_UPDATE', patch: { era: dec } }) }
            this.log('ok', `Staking key: ${pallet}.${item}`)
            this.dispatch({ type: 'DEBUG', patch: { stakingPallet: `${pallet}.${item}`, eraKey: key, eraHex: val, eraRaw: dec != null ? String(dec) : '?' } })
            foundStaking = true
            break outer
          }
        } catch(e) { if (e.message === 'controller destroyed') throw e }
      }
    }
    if (!foundStaking) {
      this.log('warn', 'Staking pallet not found')
      this.dispatch({ type: 'DEBUG', patch: { stakingPallet: 'NOT FOUND' } })
    }
    let foundSession = false
    for (const pallet of SESSION_CANDIDATES) {
      if (foundSession) break
      for (const item of SESSION_IDX_ITEM) {
        if (this.killed) throw new Error('controller destroyed')
        const key = storageKey(pallet, item)
        try {
          const val = await query('state_getStorage', [key])
          if (val != null) {
            this.keys.sessionIdx = key
            const dec = decodeU32(val)
            if (dec != null) { this.chain.session = dec; this.dispatch({ type: 'CHAIN_UPDATE', patch: { session: dec } }) }
            this.log('ok', `Session key: ${pallet}.${item}`)
            this.dispatch({ type: 'DEBUG', patch: { sessionPallet: `${pallet}.${item}`, sessKey: key, sessHex: val, sessRaw: dec != null ? String(dec) : '?' } })
            foundSession = true
            break
          }
        } catch(e) { if (e.message === 'controller destroyed') throw e }
      }
    }
    if (!foundSession) {
      this.log('warn', 'Session pallet not found')
      this.dispatch({ type: 'DEBUG', patch: { sessionPallet: 'NOT FOUND' } })
    }
  }

  // Phase 1: connect to archive, discover keys, binary-search era start — then close
  async archiveInit() {
    this.log('info', `Connecting to archive node (${ARCHIVE_WSS})…`)
    await this.archiveRpc(async callFn => {
      // 1. Discover pallet keys via archive
      await this.discoverKeys(callFn)

      if (!this.keys.activeEra || this.chain.era == null) {
        this.log('warn', 'Staking pallet not found on archive — will fall back to live node')
        return
      }

      // 2. Get chain head from archive for binary search bounds
      const hdr = await callFn('chain_getHeader', []).catch(() => null)
      if (!hdr?.number) { this.log('warn', 'Archive: could not read chain head'); return }
      const head = hexToNum(hdr.number)
      this.log('info', `Archive: era=${this.chain.era}, head=${head.toLocaleString()} — binary searching era start…`)

      // 3. Binary search for exact first block of current era
      const start = await this._binarySearch(callFn, this.keys.activeEra, this.chain.era, head)
      if (start != null) {
        this.eraBlockCache[this.chain.era] = start
        this.lockedEra   = this.chain.era
        this.lockedStart = start
        this.log('ok', `Era ${this.chain.era} starts at block ${start.toLocaleString()}`)
        this.dispatch({ type: 'ERA_START', eraStart: start, method: 'archive' })
      } else {
        this.log('warn', 'Archive binary search returned no result')
        this.dispatch({ type: 'ERA_START', eraStart: null, method: 'failed' })
      }
    })
  }

  // Re-run binary search on a fresh archive WS (for era-change events)
  async findEraStart(targetEra, head) {
    const key = this.keys.activeEra
    if (!key || !head) return null
    this.log('info', `Archive binary search: era=${targetEra} head=${head.toLocaleString()}`)
    try {
      return await this.archiveRpc(async callFn => this._binarySearch(callFn, key, targetEra, head))
    } catch (e) {
      this.log('warn', `Binary search: ${e.message}`)
      return null
    }
  }

  // Re-verify era start after an era change (uses already-known block, not live RPC)
  async resolveEraStart() {
    if (!this.keys.activeEra || this.chain.era == null) return
    if (this.chain.era === this.lockedEra && this.lockedStart != null) return
    const head = this.chain.block
    if (!head) return
    try {
      const start = await this.findEraStart(this.chain.era, head)
      if (start != null) {
        this.eraBlockCache[this.chain.era] = start
        this.lockedEra   = this.chain.era
        this.lockedStart = start
        this.log('ok', `Era ${this.chain.era} starts at ${start.toLocaleString()} (archive)`)
        this.dispatch({ type: 'ERA_START', eraStart: start, method: 'archive' })
      } else {
        this.log('warn', 'Archive era start lookup failed')
        this.dispatch({ type: 'ERA_START', eraStart: null, method: 'failed' })
      }
    } catch (e) { this.log('warn', `resolveEraStart: ${e.message}`) }
  }

  // Periodic live-node refresh: block header + era/session re-check
  async queryChain() {
    // Block header (live node always supports chain_getHeader)
    try {
      const hdr = await this.rpc('chain_getHeader', [])
      if (hdr?.number) {
        const bn = hexToNum(hdr.number)
        this.chain.block = bn
        this.dispatch({ type: 'CHAIN_UPDATE', patch: { block: bn } })
        this.dispatch({ type: 'DEBUG', patch: { blockHex: hdr.number, blockDec: bn.toLocaleString() } })
      }
    } catch (e) { this.log('warn', `getHeader: ${e.message}`) }

    const { activeEra, sessionIdx } = this.keys
    if (!activeEra && !sessionIdx) {
      // Archive init failed — fall back to live node for discovery
      this.log('info', 'Falling back to live node for pallet discovery…')
      await this.discoverKeys()
      if (this.chain.block) await this.resolveEraStart()
      this.dispatch({ type: 'STATUS', payload: ERA_STATUS.LIVE })
      return
    }

    // Re-check era/session from live node (errors caught gracefully)
    try {
      const eraRawP  = activeEra  ? this.rpc('state_getStorage', [activeEra]).catch(() => null)  : Promise.resolve(null)
      const sessRawP = sessionIdx ? this.rpc('state_getStorage', [sessionIdx]).catch(() => null) : Promise.resolve(null)
      const [eraRaw, sessRaw] = await Promise.all([eraRawP, sessRawP])
      let eraChanged = false
      if (eraRaw != null) {
        const d = decodeActiveEra(eraRaw)
        if (d != null && d !== this.chain.era) {
          this.chain.era = d
          this.dispatch({ type: 'CHAIN_UPDATE', patch: { era: d } })
          this.dispatch({ type: 'DEBUG', patch: { eraRaw: String(d) } })
          eraChanged = true
        }
      }
      if (sessRaw != null) {
        const d = decodeU32(sessRaw)
        if (d != null) {
          this.chain.session = d
          this.dispatch({ type: 'CHAIN_UPDATE', patch: { session: d } })
          this.dispatch({ type: 'DEBUG', patch: { sessRaw: String(d) } })
        }
      }
      if (eraChanged) await this.resolveEraStart()
    } catch (e) { this.log('warn', `queryChain: ${e.message}`) }

    // Block-number-based era rollover detection (works even if live node lacks state_getStorage)
    if (this.lockedStart != null && this.chain.block != null
        && this.chain.block > this.lockedStart + ERA_LEN
        && this.chain.era === this.lockedEra) {
      this.log('info', 'Block passed era boundary — refreshing via archive')
      this.chain.era = (this.chain.era || 0) + 1
      this.dispatch({ type: 'CHAIN_UPDATE', patch: { era: this.chain.era } })
      await this.resolveEraStart()
    }
  }

  // Load relay-era-reference.csv for instant past-era lookup
  async loadCsv() {
    for (const path of [CSV_PATH, CSV_PATH.replace(/^\//, '')]) {
      try {
        const resp = await fetch(path, { credentials: 'same-origin' })
        if (!resp.ok) continue
        const text = await resp.text()
        if (!text.trimStart().startsWith('era,')) continue
        const lines = text.trim().split(/\r?\n/)
        if (lines.length < 2) continue
        const header = lines[0].split(',').map(s => s.trim())
        let count = 0
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',')
          if (cols.length < 2) continue
          const row = {}; header.forEach((h, j) => { row[h] = (cols[j] ?? '').trim() })
          const era = parseInt(row.era, 10); if (isNaN(era)) continue
          const sb  = parseInt(row.start_block, 10); if (isNaN(sb)) continue
          const eb  = row.end_block ? parseInt(row.end_block, 10) : NaN
          this.csvCache[era] = {
            start_block:        sb,
            end_block:          isNaN(eb) ? null : eb,
            start_block_hash:   row.start_block_hash   || null,
            start_datetime_utc: row.start_datetime_utc || null,
            end_datetime_utc:   row.end_datetime_utc   || null,
          }
          this.eraBlockCache[era] = sb
          if (!isNaN(eb)) this.eraBlockCache[era + 1] = eb + 1
          count++
        }
        if (count === 0) continue
        this.log('ok', `Preloaded ${count} eras from relay-era-reference.csv`)
        this.dispatch({ type: 'CSV_LOADED', count })
        return
      } catch {}
    }
    this.log('info', 'No relay-era-reference.csv — RPC / math fallback')
  }

  // Phase 2: connect to live node for block subscriptions only
  connect() {
    if (this.killed) return
    this.dispatch({ type: 'STATUS', payload: ERA_STATUS.CONNECTING })
    this.dispatch({ type: 'DEBUG', patch: { wsState: 'CONNECTING' } })
    this.log('info', `Connecting to live node (${WSS})…`)
    let ws
    try { ws = new WebSocket(WSS) } catch (e) {
      this.log('warn', `WS init failed: ${e.message} — retry in 5 s`)
      this.dispatch({ type: 'STATUS', payload: ERA_STATUS.DISCONNECTED })
      if (!this.killed) this.reconnTimer = setTimeout(() => this.connect(), 5000)
      return
    }
    this.ws = ws

    ws.onopen = async () => {
      this.log('ok', 'Live node connected')
      this.dispatch({ type: 'DEBUG', patch: { wsState: 'OPEN' } })
      // Pallet keys, lockedEra and lockedStart are carried over from archiveInit
      // — do NOT reset them here so reconnects don't lose the era start data.
      await this.queryChain()
      try {
        await this.rpc('chain_subscribeNewHeads', [], 10000)
        this.log('info', 'Subscribed to new heads')
      } catch (e) { this.log('warn', `subscribeNewHeads: ${e.message}`) }
      this.dispatch({ type: 'STATUS', payload: ERA_STATUS.LIVE })
    }

    ws.onmessage = ev => {
      let msg; try { msg = JSON.parse(ev.data) } catch { return }
      if (!msg || typeof msg !== 'object') return
      if (msg.id != null && this.pending[msg.id]) {
        msg.error
          ? this.pending[msg.id].reject(new Error(String(msg.error?.message || 'RPC error')))
          : this.pending[msg.id].resolve(msg.result)
        delete this.pending[msg.id]
        return
      }
      if (msg.method === 'chain_newHead' && msg.params?.result) {
        const bn = hexToNum(msg.params.result.number)
        if (bn !== this.chain.block) {
          this.chain.block = bn
          this.dispatch({ type: 'CHAIN_UPDATE', patch: { block: bn } })
          this.dispatch({ type: 'DEBUG', patch: { blockHex: msg.params.result.number, blockDec: bn.toLocaleString() } })
          if (this.beatCallback) this.beatCallback(bn)
          if (bn % 20 === 0) this.queryChain()
        }
      }
    }

    ws.onerror = () => {
      this.log('warn', 'WebSocket error')
      this.dispatch({ type: 'DEBUG', patch: { wsState: 'ERROR', lastError: 'WS error' } })
    }

    ws.onclose = e => {
      this.log('warn', `Disconnected (code=${e.code}) — reconnecting in 5 s…`)
      this.dispatch({ type: 'STATUS', payload: ERA_STATUS.DISCONNECTED })
      this.dispatch({ type: 'DEBUG', patch: { wsState: 'CLOSED' } })
      Object.values(this.pending).forEach(p => p.reject(new Error('WS closed')))
      this.pending = {}
      this.ws = null
      if (!this.killed) this.reconnTimer = setTimeout(() => this.connect(), 5000)
    }
  }

  // Past-era lookup — CSV first, then ErasStartSessionIndex, then math
  async lookupEra(targetEra) {
    const { era: currentEra } = this.chain
    if (!Number.isFinite(targetEra) || targetEra < 0) {
      this.dispatch({ type: 'LOOKUP_ERROR', error: 'Enter a valid era number.' })
      return
    }
    if (currentEra == null) {
      this.dispatch({ type: 'LOOKUP_ERROR', error: 'Still syncing — try again shortly.' })
      return
    }
    if (targetEra > currentEra) {
      this.dispatch({ type: 'LOOKUP_ERROR', error: `Era ${targetEra} is in the future (current: ${currentEra}).` })
      return
    }
    if (targetEra === currentEra) {
      this.dispatch({ type: 'LOOKUP_ERROR', error: `Era ${targetEra} is the current era — see metrics above.` })
      return
    }
    this.dispatch({ type: 'LOOKUP_START' })
    const csvRow = this.csvCache[targetEra] || null
    if (csvRow && !isNaN(csvRow.start_block)) {
      this.dispatch({
        type: 'LOOKUP_DONE',
        result: {
          era: targetEra,
          startBlock: csvRow.start_block,
          endBlock:   csvRow.end_block ?? (csvRow.start_block + ERA_LEN - 1),
          source: 'preloaded',
          startDateUtc:   csvRow.start_datetime_utc ?? null,
          endDateUtc:     csvRow.end_datetime_utc   ?? null,
          startBlockHash: csvRow.start_block_hash   ?? null,
        },
      })
      return
    }
    const withinHistory = targetEra >= currentEra - HISTORY_DEPTH
    let rpcStart = null
    if (withinHistory && this.keys.eraStartPrefix) {
      try {
        if (!this.eraSessionKeys) {
          const keys = await this.rpc('state_getKeys', [this.keys.eraStartPrefix])
          if (keys?.length) this.eraSessionKeys = keys
          else this.log('warn', 'ErasStartSessionIndex: no keys returned')
        }
        if (this.eraSessionKeys) {
          for (const k of this.eraSessionKeys) {
            const raw = k.replace('0x', '')
            if (u32LE(h2b('0x' + raw.slice(-8))) === targetEra) {
              const val = await this.rpc('state_getStorage', [k])
              if (val) {
                const si = decodeU32(val)
                if (si != null) { rpcStart = si * SESSION_LEN + 1; this.log('info', `ErasStartSessionIndex: era=${targetEra} → si=${si} → start=${rpcStart}`) }
              }
              break
            }
          }
        }
      } catch (e) { this.log('warn', `ErasStartSessionIndex: ${e.message}`) }
    }
    const mathStart =
      this.eraBlockCache[targetEra] ??
      (this.lockedStart != null ? this.lockedStart - (currentEra - targetEra) * ERA_LEN : null)
    if (rpcStart == null && mathStart == null) {
      this.dispatch({ type: 'LOOKUP_ERROR', error: 'Cannot compute. Ensure live data is synced.' })
      return
    }
    const fStart = rpcStart ?? mathStart
    this.dispatch({
      type: 'LOOKUP_DONE',
      result: {
        era: targetEra,
        startBlock: fStart,
        endBlock:   fStart + ERA_LEN - 1,
        source: rpcStart != null ? 'ErasStartSessionIndex' : (withinHistory ? 'math (key not found)' : 'math · beyond history'),
        startDateUtc: null, endDateUtc: null, startBlockHash: null,
      },
    })
  }

  start() {
    this.loadCsv()
    // Phase 1: archive sync (discover keys + era start via binary search)
    this.dispatch({ type: 'STATUS', payload: ERA_STATUS.DISCOVERING })
    this.archiveInit()
      .catch(e => this.log('warn', `Archive init: ${e.message}`))
      .finally(() => { if (!this.killed) this.connect() })
  }

  destroy() {
    this.killed = true
    clearTimeout(this.reconnTimer)
    // Close archive WS if still open during init
    try { this._archiveWs?.close() } catch {}
    this._archiveWs = null
    Object.values(this.pending).forEach(p => p.reject(new Error('unmounted')))
    this.pending = {}
    try { this.ws?.close(1000, 'unmount') } catch {}
    this.ws = null
    this.beatCallback = null
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useEraExplorer() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const ctrlRef = useRef(null)

  // Stable dispatch ref so the controller always calls the current dispatch
  const dispatchRef = useRef(dispatch)
  useEffect(() => { dispatchRef.current = dispatch }, [dispatch])

  useEffect(() => {
    const ctrl = new EraExplorerController((action) => dispatchRef.current(action))
    ctrlRef.current = ctrl
    ctrl.start()
    return () => { ctrl.destroy(); ctrlRef.current = null }
  }, []) // run once on mount

  const lookupEra = useCallback(async (targetEra) => {
    ctrlRef.current?.lookupEra(targetEra)
  }, [])

  const resetLookup = useCallback(() => {
    dispatch({ type: 'RESET_LOOKUP' })
  }, [])

  // Expose a way for the EKG canvas to register its beat callback
  const setBeatCallback = useCallback((fn) => {
    if (ctrlRef.current) ctrlRef.current.beatCallback = fn
  }, [])

  return { ...state, lookupEra, resetLookup, setBeatCallback }
}
