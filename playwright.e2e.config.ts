/**
 * Playwright config for Electron e2e tests.
 *
 * Boots the REAL built Electron app via Playwright's _electron API so that
 * IPC, custom-protocol handlers (cosmos-file://), preload contextBridge, and
 * native node-pty are exercised — paths that neither the node vitest suite nor
 * the jsdom DOM suite can reach.
 *
 * Pre-requisites (one-time, on developer machine):
 *   1.  npx playwright install chromium   # installs the bundled browser Playwright uses
 *   2.  npm run build                     # produces out/main/index.js (already done if
 *                                         #   out/ exists)
 *
 * Run with: npm run test:e2e
 *
 * CI note: requires a display (Xvfb on Linux) and the node-pty native module
 * to be rebuilt for the current Electron version (`npm run rebuild`).
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.spec.ts',
  // Electron tests cannot run in parallel — one app instance at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',

  // No `use.browserName` — each test launches Electron manually via _electron.launch().
  // Timeout is generous because Electron cold-start + node-pty init can be slow.
  timeout: 60_000,
})
