import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dataMode = env.VITE_DATA_MODE

  if (dataMode !== 'demo' && dataMode !== 'api') {
    throw new Error(`VITE_DATA_MODE must be "demo" or "api", got "${dataMode}" (mode "${mode}").`)
  }
  // The production build must never ship mock users, the user switcher or demo data.
  if (command === 'build' && mode === 'production' && dataMode !== 'api') {
    throw new Error('The production build must use VITE_DATA_MODE=api. Use `npm run build:demo` for a demo build.')
  }

  return {
    plugins: [react(), tailwindcss()],
    server:
      dataMode === 'api'
        ? {
            // Same-origin /api in development, as behind Nginx in production, so the session
            // and XSRF-TOKEN cookies work without CORS.
            proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8080' } },
          }
        : {},
  }
})
