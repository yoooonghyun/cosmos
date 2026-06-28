/**
 * Vitest project config for JSDOM / React component tests.
 *
 * Kept separate from vitest.config.ts (node env, existing pure-logic tests)
 * so those tests are never broken by DOM globals.
 *
 * Run with: npm run test:dom
 * Glob: src/**\/*.dom.test.tsx  (separate extension so the node suite cannot
 *       accidentally pick them up via its own include glob).
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Mirror the renderer build's `@` → src/renderer alias (electron.vite.config.ts) so a dom
  // test can render real renderer components that import shadcn primitives via `@/components/*`.
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    name: 'dom',
    environment: 'jsdom',
    include: ['src/**/*.dom.test.tsx'],
    setupFiles: ['src/test-setup.dom.ts'],
    globals: true,
  },
})
