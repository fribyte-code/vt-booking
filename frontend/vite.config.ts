import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin /api in development, as behind Nginx in production, so the session
    // and XSRF-TOKEN cookies work without CORS.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:8080' } },
  },
})
