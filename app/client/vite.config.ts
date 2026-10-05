/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // NOT `dist`: nginx bind-mounts app/client/dist, so building straight
    // into it empties the live site for the length of the build. Builds land
    // here, and scripts/publish-frontend.sh moves them across safely.
    outDir: 'build',
  },
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
