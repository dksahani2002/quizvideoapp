import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const configDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Use config directory so frontend/.env loads when npm is run from repo root
  const env = loadEnv(mode, configDir, '')
  const apiTarget =
    env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:3000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
