import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with empty prefix loads ALL .env vars at config time, so SUBSCAN_API_KEY
  // is available here without accidentally baking it into the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.SUBSCAN_API_KEY || ''

  return {
    plugins: [react()],
    // './' base makes the app work at any subdirectory path,
    // including use in relative subdirectories for static hosts
    base: './',
    build: {
      outDir: 'dist',
      sourcemap: false, // never expose source maps in production
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            icons: ['lucide-react'],
            chart: ['chart.js'],
          },
        },
      },
    },
    // Dev server proxy: forward `/api/<encoded-target>` to the decoded target
    // and inject `x-api-key` from local `SUBSCAN_API_KEY` to avoid CORS issues.
    server: {
      proxy: {
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
