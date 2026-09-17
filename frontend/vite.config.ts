import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Quick Tunnel hostnames are random subdomains under this controlled suffix.
    allowedHosts: ['.trycloudflare.com'],
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
