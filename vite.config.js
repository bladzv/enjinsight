import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
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
        },
      },
    },
  },
})
