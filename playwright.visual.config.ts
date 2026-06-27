/**
 * Playwright config for cosmos visual/layout tests.
 *
 * Uses Option B: a Vite-served test page that mounts renderer components with
 * fixture data. No live Electron app, no Slack tokens, no agent required.
 * Run with: npm run test:visual
 *
 * Kept separate from the default vitest suite (npm test) because it requires
 * a browser and a running Vite dev server.
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.visual.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:5174',
    // Chromium is sufficient; we're testing CSS computed layout, not browser-specific rendering.
    ...devices['Desktop Chrome'],
    headless: true,
    // Give the Vite dev server enough time to serve the first request.
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Vite test-app server before running tests; tear it down after.
  webServer: {
    command: 'npx vite --config tests/visual/vite.config.ts',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
