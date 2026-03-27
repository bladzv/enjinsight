/**
 * chainInfo.js — lightweight one-shot WebSocket query helper.
 *
 * Opens a WS connection to a Substrate node, fetches the current era,
 * block number and timestamp, then immediately closes the connection.
 * No subscriptions, no persistent state — fire-and-forget.
 */

// ── Tiny Substrate helpers ─────────────────────────────────────────────────
const TIMESTAMP_KEY = '0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb'
const STAKING_PALLETS = ['Staking','EnjinStaking','ParachainStaking','RelayStaking','PoAStaking']
const ERA_ITEMS = ['ActiveEra','CurrentEra','active_era','current_era']

function xxh64(data, seed) {
  const P1=11400714785074694791n,P2=14029467366897019727n,
        P3=1609587929392839161n, P4=9650029242287828579n,
        P5=2870177450012600261n, M=(1n<<64n)-1n
  const lo=x=>x&M, mul=(a,b)=>lo(a*b), add=(a,b)=>lo(a+b)
  const rotl=(x,r)=>lo((x<<r)|(x>>(64n-r)))
  const round=(acc,inp)=>mul(rotl(add(acc,mul(inp,P2)),31n),P1)
  const merge=(acc,val)=>add(mul(lo(acc^round(0n,val)),P1),P4)
  const s=BigInt(seed),dv=new DataView(data.buffer,data.byteOffset,data.byteLength),n=data.length
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
function palletKey(pallet, item) { return '0x'+twox128(pallet)+twox128(item) }

function decodeEra(hex) {
  if (!hex) return null
  const b = new Uint8Array((hex.replace('0x','')).match(/.{2}/g).map(x=>parseInt(x,16)))
  if (b.length>=5 && b[0]===0x01) {
    const v = (b[1]|b[2]<<8|b[3]<<16|b[4]*16777216)>>>0; if (v<1000000) return v
  }
  if (b.length>=4) {
    const v = (b[0]|b[1]<<8|b[2]<<16|b[3]*16777216)>>>0; if (v<1000000) return v
  }
  return null
}
function decodeTsMs(hex) {
  if (!hex || hex==='0x') return null
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  if (s.length < 16) return null
  let v = 0n
  for (let i=0;i<8;i++) v |= BigInt(parseInt(s.slice(i*2,i*2+2),16)) << BigInt(i*8)
  return Number(v)
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Open a short-lived WebSocket to `endpoint`, fetch the current era, block
 * number and timestamp, then close immediately.
 *
 * Resolves with { era, block, timestamp } (all nullable).
 * Rejects on connect timeout or unrecoverable WS errors.
 */
export function fetchLiveChainInfo(endpoint) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws
    try { ws = new WebSocket(endpoint) } catch (e) { return reject(e) }

    const pending = {}, reqId = { v: 1 }
    const call = (method, params=[]) => new Promise((res, rej) => {
      const id = reqId.v++
      const t = setTimeout(() => { delete pending[id]; rej(new Error(`timeout: ${method}`)) }, 12000)
      pending[id] = {
        resolve: v => { clearTimeout(t); res(v) },
        reject:  x => { clearTimeout(t); rej(x) },
      }
      ws.send(JSON.stringify({ jsonrpc:'2.0', id, method, params }))
    })

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg?.id && pending[msg.id]) {
          msg.error
            ? pending[msg.id].reject(new Error(msg.error?.message || 'rpc error'))
            : pending[msg.id].resolve(msg.result)
          delete pending[msg.id]
        }
      } catch {}
    }
    ws.onerror = () => {}

    const openTimeout = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close() } catch {}; reject(new Error('connect timeout')) }
    }, 12000)

    ws.onclose = () => {
      clearTimeout(openTimeout)
      if (!settled) { settled = true; reject(new Error('WS closed unexpectedly')) }
    }

    ws.onopen = async () => {
      clearTimeout(openTimeout)
      try {
        const header = await call('chain_getHeader')
        const block = header?.number ? parseInt(header.number, 16) : null

        const tsRaw = await call('state_getStorage', [TIMESTAMP_KEY]).catch(() => null)
        const tsMs = tsRaw ? decodeTsMs(tsRaw) : null

        let era = null
        outer: for (const pallet of STAKING_PALLETS) {
          for (const item of ERA_ITEMS) {
            try {
              const raw = await call('state_getStorage', [palletKey(pallet, item)])
              if (raw) { const e = decodeEra(raw); if (e != null) { era = e; break outer } }
            } catch {}
          }
        }

        settled = true
        try { ws.close() } catch {}
        resolve({ era, block, timestamp: tsMs })
      } catch (e) {
        if (!settled) { settled = true; try { ws.close() } catch {}; reject(e) }
      }
    }
  })
}
