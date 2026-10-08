import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const publicHost = process.env.NAVI_PUBLIC_HOST?.trim()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local access and the configured public tunnel are the only accepted hosts.
    allowedHosts: ['.trycloudflare.com', 'democracy-moody-good.ngrok-free.dev', ...(publicHost ? [publicHost] : [])],
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
      },
      '/runtime': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
