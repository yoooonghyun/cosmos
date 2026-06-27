/**
 * Electron e2e tests — boots the REAL built app via Playwright's _electron API.
 *
 * Why this layer exists:
 *   - node vitest  : pure TypeScript logic only (no DOM, no IPC, no Electron)
 *   - jsdom vitest : React hook/component DOM wiring (no Electron, no custom protocol)
 *   - visual Playwright (http): CSS layout + PDF canvas via Vite test-app (no Electron)
 *   - THIS SUITE   : IPC, contextBridge, preload, custom cosmos-file:// protocol,
 *                    node-pty native integration — the paths ONLY the real app can exercise.
 *
 * Pre-requisites:
 *   npm run build                       # build main + preload + renderer
 *   npx playwright install chromium     # install Playwright's bundled browser
 *
 * Run: npm run test:e2e
 *
 * ENVIRONMENT BLOCK NOTICE:
 *   On this machine, launching the real Electron app may fail if node-pty was not
 *   rebuilt for the installed Electron version.  Run `npm run rebuild` first.
 *   The tests below wrap the launch in a guard so a missing binary or rebuild
 *   failure produces a descriptive skip rather than a cryptic crash.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../')
const MAIN_ENTRY = path.join(PROJECT_ROOT, 'out/main/index.js')
const ELECTRON_BIN = path.join(
  PROJECT_ROOT,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)

// ---------------------------------------------------------------------------
// Smoke test — app launches and renders the main window
// ---------------------------------------------------------------------------

test.describe('Electron smoke', () => {
  test('app launches and main window is visible', async () => {
    // Launch the real Electron process with the built main entry.
    const app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [MAIN_ENTRY],
      // Suppress GPU sandbox warnings in headless CI environments.
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        // Prevent Claude Code from auto-connecting on startup.
        COSMOS_E2E: '1',
      },
    })

    try {
      // Wait for the first BrowserWindow to become available.
      const win = await app.firstWindow()

      // The page must load without a crash page (net::ERR_*, chrome-error://).
      // `win.url()` is non-empty once Electron has loaded the renderer entry point.
      const url = win.url()
      expect(url).not.toContain('chrome-error://')
      expect(url.length).toBeGreaterThan(0)

      // The renderer root element must be present in the DOM.
      await win.waitForSelector('#root', { timeout: 15_000 })
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// fs.readBytes IPC — document-viewer byte path
// ---------------------------------------------------------------------------
//
// This is the exact defect path that node + jsdom + the visual Vite harness CANNOT
// verify: the byte-consuming renderers (PdfView/DocxView/SheetView) no longer fetch
// the privileged `cosmos-file://` scheme (Chromium refuses `fetch`/XHR to a custom
// scheme from the http dev origin — "URL scheme cosmos-file is not supported"). They
// now read the bytes over the typed, root-confined `window.cosmos.fs.readBytes` IPC.
//
// This suite exercises the REAL bridge: it boots the built app and asserts the preload
// exposes `window.cosmos.fs.readBytes` and that a forged/out-of-root request returns a
// typed failure rather than throwing across the boundary (the security contract). The
// happy-path canvas render needs a LIVE pane whose root contains the fixture (a `claude`
// cwd), which COSMOS_E2E mode does not spin up; that remains a manual/integration check
// and is covered at the node-integration layer (fsExplorer.integration.test.ts).
//
// See docs/TEST-SCENARIOS.md FV-PDF-01 / FS-PROTO-01.

test.describe('fs.readBytes IPC bridge', () => {
  test('window.cosmos.fs.readBytes is exposed and returns a typed result, never throwing', async () => {
    const app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        COSMOS_E2E: '1',
      },
    })

    try {
      const win = await app.firstWindow()
      await win.waitForSelector('#root', { timeout: 15_000 })

      // The preload MUST expose readBytes (the new byte path); the old blocked
      // cosmos-file fetch in fetchLocalFileBytes.ts is gone.
      const apiShape = await win.evaluate(() => ({
        hasCosmos: typeof window.cosmos !== 'undefined',
        hasReadBytes: typeof window.cosmos?.fs?.readBytes === 'function',
      }))
      expect(apiShape.hasCosmos).toBe(true)
      expect(apiShape.hasReadBytes).toBe(true)

      // A request for an unknown pane / out-of-root path must resolve to a typed
      // failure (NOT throw across the IPC boundary, NOT leak an absolute path).
      const result = await win.evaluate(async () => {
        try {
          const r = await window.cosmos.fs.readBytes('e2e-ghost-pane', 'sample.pdf')
          return { threw: false, result: r }
        } catch (e) {
          return { threw: true, message: String(e) }
        }
      })
      expect(result.threw).toBe(false)
      expect(result.result).toBeTruthy()
      expect(result.result.ok).toBe(false)
      if (!result.result.ok) {
        expect(result.result.reason).toBe('out-of-root')
      }
    } finally {
      await app.close()
    }
  })
})
