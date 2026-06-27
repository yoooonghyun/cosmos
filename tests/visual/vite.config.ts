/**
 * Vite config for the visual test harness.
 * Serves the test-app at localhost:5173 (default Vite port).
 * Uses the same React + Tailwind plugins as the main renderer so the
 * production CSS classes are generated identically.
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname, 'test-app'),
  // Serve project root as the public dir so /tests/visual/fixtures/sample.pdf
  // is reachable at http://localhost:5174/tests/visual/fixtures/sample.pdf
  publicDir: resolve(__dirname, '../../'),
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src/renderer'),
    },
  },
  plugins: [react(), tailwindcss()],
  // Silence Electron-only modules that are imported transitively.
  // None of the scenes import main-process code, but just in case.
  optimizeDeps: {
    exclude: ['electron'],
  },
})
