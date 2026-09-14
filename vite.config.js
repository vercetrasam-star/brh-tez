import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { settleSurfacePlugin } from './vite.settle-proxy.js'

function apiProxy(api) {
  return {
    '/health': { target: api, changeOrigin: true, secure: true },
    '/api': {
      target: api,
      changeOrigin: true,
      secure: true,
      bypass(req) {
        const path = String(req.url || '').split('?')[0]
        if (path === '/api/v1/settle/surface' || path === '/api/v1/settle/native-intent') {
          return path
        }
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const api = (env.BACKEND_URL || env.VITE_API_URL || '').replace(/\/+$/, '')
  if (!api) {
    throw new Error('Set BACKEND_URL in page/.env')
  }

  return {
    envPrefix: ['VITE_'],
    plugins: [react(), settleSurfacePlugin(api)],
    server: {
      port: 5176,
      host: true,
      proxy: apiProxy(api),
    },
    preview: {
      port: 4176,
      host: true,
      proxy: apiProxy(api),
    },
  }
})
