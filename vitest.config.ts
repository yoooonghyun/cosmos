import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The renderer/main code imports Electron/node-pty natives; unit tests here
    // target the pure shared modules only (validators, contract). Keep them fast.
    globals: false
  }
})
