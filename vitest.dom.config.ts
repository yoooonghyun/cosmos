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

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'dom',
    environment: 'jsdom',
    include: ['src/**/*.dom.test.tsx'],
    setupFiles: ['src/test-setup.dom.ts'],
    globals: true,
  },
})
