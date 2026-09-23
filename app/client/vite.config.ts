/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // The portal runs in Naoero (UTC+12). Pinning the suite there means a
    // UTC-versus-local date bug fails here rather than in production, where
    // every such bug is off by a full day.
    env: { TZ: 'Pacific/Nauru' },
  },
})
