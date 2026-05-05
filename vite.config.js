import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const ENJIN_CRYPTOITEMS_CONTRACT = '0xfaafdc07907ff5120a76b34b731b278c38d6043c'
const ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api'
const URI_SELECTOR = '0x0e89341c'
const BALANCE_OF_SELECTOR = '0x00fdd58e'

function encodeUint256(value) {
  return BigInt(value).toString(16).padStart(64, '0')
}

function encodeAddress(address) {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function decodeAbiString(hex) {
  if (!hex || hex === '0x') return ''
  const payload = hex.startsWith('0x') ? hex.slice(2) : hex
  if (payload.length < 128) return ''
  const offset = Number(BigInt(`0x${payload.slice(0, 64)}`))
  const lengthStart = offset * 2
  const length = Number(BigInt(`0x${payload.slice(lengthStart, lengthStart + 64)}`))
  const data = payload.slice(lengthStart + 64, lengthStart + 64 + length * 2)
  return Buffer.from(data, 'hex').toString('utf8')
}

function decodeUint256(hex) {
  if (!hex || hex === '0x') return ''
  return BigInt(hex).toString()
}

function normalizeMetadataUrl(uri, tokenId) {
  if (!uri) return ''
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, '0').toLowerCase()
  const resolved = uri.replaceAll('{id}', tokenHex)
  if (resolved.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${resolved.slice('ipfs://'.length)}`
  if (resolved.startsWith('ipns://')) return `https://ipfs.io/ipns/${resolved.slice('ipns://'.length)}`
  if (/^https:\/\//i.test(resolved)) return resolved
  return ''
}

function normalizeMetadataJson(body, tokenId) {
  if (!body || typeof body !== 'object') return {}
  const properties = Array.isArray(body.attributes)
    ? body.attributes.map(item => ({
      trait: String(item.trait_type ?? item.trait ?? item.name ?? '').trim(),
      value: String(item.value ?? '').trim(),
      rarity: String(item.rarity ?? item.frequency ?? '').trim(),
    })).filter(item => item.trait || item.value || item.rarity)
    : []

  return {
    tokenId,
    name: typeof body.name === 'string' ? body.name : '',
    previewImage: normalizeMetadataUrl(typeof body.image === 'string' ? body.image : '', tokenId),
    description: typeof body.description === 'string' ? body.description : '',
    properties,
  }
}

function createEtherscanDevDetailsPlugin(apiKey) {
  const bucket = { tokens: 5, max: 5, rate: 5, lastRefill: Date.now() }
  const contractCreatorCache = { value: null }
  let contractCreatorPromise = null

  async function takeToken() {
    while (true) {
      const now = Date.now()
      const elapsed = (now - bucket.lastRefill) / 1000
      bucket.tokens = Math.min(bucket.max, bucket.tokens + elapsed * bucket.rate)
      bucket.lastRefill = now
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        return
      }
      await new Promise(resolve => setTimeout(resolve, Math.ceil((1 - bucket.tokens) / bucket.rate * 1000)))
    }
  }

  async function etherscanApi(params) {
    if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not configured.')
    await takeToken()
    const url = new URL(ETHERSCAN_API_URL)
    url.searchParams.set('chainid', '1')
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
    url.searchParams.set('apikey', apiKey)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Etherscan API returned HTTP ${response.status}.`)
    const body = await response.json()
    if (body.status === '0') throw new Error(body.result || body.message || 'Etherscan API returned an error.')
    if (body.error) throw new Error(body.error.message || 'Etherscan API returned an error.')
    return body
  }

  async function ethCall(data) {
    const body = await etherscanApi({
      module: 'proxy',
      action: 'eth_call',
      to: ENJIN_CRYPTOITEMS_CONTRACT,
      data,
      tag: 'latest',
    })
    return body.result || ''
  }

  async function getCreator() {
    if (contractCreatorCache.value) return contractCreatorCache.value
    if (contractCreatorPromise) return contractCreatorPromise

    contractCreatorPromise = (async () => {
      try {
        const body = await etherscanApi({
          module: 'contract',
          action: 'getcontractcreation',
          contractaddresses: ENJIN_CRYPTOITEMS_CONTRACT,
        })
        contractCreatorCache.value = body.result?.[0]?.contractCreator || ''
        return contractCreatorCache.value
      } finally {
        contractCreatorPromise = null
      }
    })()

    return contractCreatorPromise
  }

  async function fetchJsonMetadata(uri, tokenId) {
    const url = normalizeMetadataUrl(uri, tokenId)
    if (!url) return {}
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`metadata URI returned HTTP ${response.status}`)
    return normalizeMetadataJson(await response.json(), tokenId)
  }

  return {
    name: 'enj-token-details-dev',
    configureServer(server) {
      server.middlewares.use('/__enj-token-details', async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost')
          const owner = requestUrl.searchParams.get('owner') || ''
          const tokenId = requestUrl.searchParams.get('tokenId') || ''
          if (!/^0x[a-fA-F0-9]{40}$/.test(owner) || !/^\d+$/.test(tokenId)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing or invalid owner/tokenId.' }))
            return
          }

          const encodedTokenId = encodeUint256(tokenId)
          const [creator, uriHex, quantityHex] = await Promise.all([
            getCreator().catch(() => ''),
            ethCall(`${URI_SELECTOR}${encodedTokenId}`).catch(() => ''),
            ethCall(`${BALANCE_OF_SELECTOR}${encodeAddress(owner)}${encodedTokenId}`).catch(() => ''),
          ])
          const tokenUri = decodeAbiString(uriHex)
          const metadata = await fetchJsonMetadata(tokenUri, tokenId).catch(error => ({ metadataError: error.message }))
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            tokenId,
            owner,
            contractAddress: ENJIN_CRYPTOITEMS_CONTRACT,
            creator,
            tokenStandard: 'ERC-1155',
            quantity: decodeUint256(quantityHex),
            tokenUri,
            ...metadata,
          }))
        } catch (error) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with empty prefix loads ALL .env vars at config time, so SUBSCAN_API_KEY
  // is available here without accidentally baking it into the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.SUBSCAN_API_KEY || ''
  const etherscanApiKey = env.ETHERSCAN_API_KEY || ''

  return {
    plugins: [react(), createEtherscanDevDetailsPlugin(etherscanApiKey)],
    // './' base makes the app work at any subdirectory path,
    // including use in relative subdirectories for static hosts
    base: './',
    build: {
      outDir: 'dist',
      sourcemap: false, // never expose source maps in production
      // @polkadot/api + related packages ~985 kB minified — unavoidable given the library size
      chunkSizeWarningLimit: 1050,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor:   ['react', 'react-dom'],
            icons:    ['lucide-react'],
            chart:    ['chart.js'],
            // Split heavy polkadot packages into their own chunk to keep
            // the main app bundle below 500 kB.
            polkadot: ['@polkadot/api', '@polkadot/util-crypto', '@polkadot/util', '@polkadot/networks'],
          },
        },
      },
    },
    // Dev server proxy: forward `/api/<encoded-target>` to the decoded target
    // and inject `x-api-key` from local `SUBSCAN_API_KEY` to avoid CORS issues.
    server: {
      proxy: {
        '/etherscan-nft-holdings': {
          target: 'https://etherscan.io',
          changeOrigin: true,
          secure: true,
          headers: {
            origin: 'https://etherscan.io',
            referer: 'https://etherscan.io/address-nft-holding',
            'x-requested-with': 'XMLHttpRequest',
          },
          rewrite: () => '/address-nft-holding.aspx/GetNftDetails',
        },
        '/api': {
          target: 'https://enjin.api.subscan.io',
          changeOrigin: true,
          secure: true,
          // Inject the API key as a request header to the upstream server.
          // The browser bundle never contains the key — it lives only in .env (dev)
          // or Vercel environment variables (production).
          headers: apiKey ? { 'x-api-key': apiKey } : {},
          // Rewrite the path by decoding the encoded target and using its pathname+search
          rewrite: (path) => {
            try {
              const encoded = path.replace(/^\/api\//, '')
              const decoded = decodeURIComponent(encoded)
              const u = new URL(decoded)
              return u.pathname + u.search
            } catch (e) {
              return path
            }
          },
        },
      },
    },
  }
})
