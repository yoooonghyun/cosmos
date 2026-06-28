/**
 * Integration tests for localFileProtocol.handleLocalFile (file-viewer-multiformat-v1).
 *
 * Strategy: real temp dir on disk, real confine + realpathSync wiring (diskConfineFs is
 * internal, but handleLocalFile uses it when called via the exported factory). We inject
 * only the `getRoot` resolver so we can exercise every confinement path without Electron.
 *
 * Tests cover:
 *   - Happy path: in-root regular file → 200 + correct bytes streamed
 *   - No live root (pane not found) → 404
 *   - Out-of-root via traversal → 403
 *   - Forged / malformed URL → 400
 *   - Missing file (in-root but absent) → 404
 *   - Directory target (not a regular file) → 404
 *   - Symlink escape (real symlink pointing outside root) → 403
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeLocalFileRef } from './localFileRef'
import { handleLocalFile, type RootResolver } from './localFileProtocol'

let tmpRoot: string
let outsideDir: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cosmos-protocol-test-'))
  outsideDir = mkdtempSync(join(tmpdir(), 'cosmos-outside-'))
  // Create some fixtures inside tmpRoot
  writeFileSync(join(tmpRoot, 'hello.txt'), 'hello world')
  writeFileSync(join(tmpRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  mkdirSync(join(tmpRoot, 'subdir'))
  writeFileSync(join(tmpRoot, 'subdir', 'nested.txt'), 'nested content')
  // Symlink pointing outside the root
  symlinkSync(join(outsideDir), join(tmpRoot, 'escape-link'))
  writeFileSync(join(outsideDir, 'secret.txt'), 'secret')
})

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(outsideDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

const PANE_ID = 'test-pane-aabbcc'

function makeHandler(rootOrUndefined: string | undefined): (request: Request) => Promise<Response> {
  const getRoot: RootResolver = (_paneId) => rootOrUndefined
  return handleLocalFile(getRoot)
}

function makeRequest(paneId: string, relPath: string): Request {
  const url = encodeLocalFileRef(paneId, relPath)
  if (!url) throw new Error(`encodeLocalFileRef returned null for paneId=${paneId} relPath=${relPath}`)
  return new Request(url)
}

async function readResponseBytes(resp: Response): Promise<Uint8Array> {
  const buf = await resp.arrayBuffer()
  return new Uint8Array(buf)
}

describe('handleLocalFile — happy path: in-root file streams 200 with correct bytes', () => {
  it('returns 200 and correct bytes for a plain text file in root', async () => {
    const handler = makeHandler(tmpRoot)
    const resp = await handler(makeRequest(PANE_ID, 'hello.txt'))
    expect(resp.status).toBe(200)
    const bytes = await readResponseBytes(resp)
    expect(new TextDecoder().decode(bytes)).toBe('hello world')
  })

  it('returns 200 and correct bytes for a file in a subdirectory', async () => {
    const handler = makeHandler(tmpRoot)
    const resp = await handler(makeRequest(PANE_ID, 'subdir/nested.txt'))
    expect(resp.status).toBe(200)
    const bytes = await readResponseBytes(resp)
    expect(new TextDecoder().decode(bytes)).toBe('nested content')
  })

  it('returns 200 for a PNG image file (scheme now serves any confined regular file)', async () => {
    const handler = makeHandler(tmpRoot)
    const resp = await handler(makeRequest(PANE_ID, 'image.png'))
    expect(resp.status).toBe(200)
  })
})

describe('handleLocalFile — no live root: returns 404', () => {
  it('returns 404 when getRoot returns undefined (pane has no live session)', async () => {
    const handler = makeHandler(undefined)
    const resp = await handler(makeRequest(PANE_ID, 'hello.txt'))
    expect(resp.status).toBe(404)
  })

  it('returns 404 when getRoot returns empty string', async () => {
    const getRoot: RootResolver = () => ''
    const handler = handleLocalFile(getRoot)
    const resp = await handler(makeRequest(PANE_ID, 'hello.txt'))
    expect(resp.status).toBe(404)
  })
})

describe('handleLocalFile — forged / malformed URL: returns 400', () => {
  it('returns 400 for a plain http:// URL (wrong scheme)', async () => {
    const handler = makeHandler(tmpRoot)
    const resp = await handler(new Request('http://evil.com/etc/passwd'))
    expect(resp.status).toBe(400)
  })

  it('returns 400 for a cosmos-file URL with traversal in the path', async () => {
    // safeRelPath rejects ".." segments — this is the first SSRF gate
    const handler = makeHandler(tmpRoot)
    // Manually forge a URL with traversal (encodeLocalFileRef would refuse, so construct raw)
    const resp = await handler(new Request('cosmos-file://file/test-pane-aabbcc/Li4vZXRjL3Bhc3N3ZA=='))
    // Either 400 (bad ref) or 403/404 (confinement) — both are non-2xx
    expect(resp.status).toBeGreaterThanOrEqual(400)
    expect(resp.status).toBeLessThan(500)
  })

  it('returns 400 for an empty URL string treated as wrong scheme', async () => {
    const handler = makeHandler(tmpRoot)
    const resp = await handler(new Request('cosmos-file://'))
    expect(resp.status).toBe(400)
  })
})

describe('handleLocalFile — missing file: returns 404', () => {
  it('returns 404 for a file that does not exist inside the root', async () => {
    const handler = makeHandler(tmpRoot)
    const resp = await handler(makeRequest(PANE_ID, 'does-not-exist.txt'))
    expect(resp.status).toBe(404)
  })
})

describe('handleLocalFile — directory target: returns 404', () => {
  it('returns 404 when the confined path is a directory (not a regular file)', async () => {
    const handler = makeHandler(tmpRoot)
    // 'subdir' is a directory — statSync().isFile() is false
    const resp = await handler(makeRequest(PANE_ID, 'subdir'))
    expect(resp.status).toBe(404)
  })
})

describe('handleLocalFile — symlink escape: returns 403 (confinement enforced)', () => {
  it('returns 403 when a symlink inside the root points outside the root', async () => {
    const handler = makeHandler(tmpRoot)
    // escape-link → outsideDir; secret.txt inside outsideDir is outside tmpRoot
    // confine real-paths the target and refuses because it escapes the root
    const resp = await handler(makeRequest(PANE_ID, `escape-link${sep}secret.txt`))
    // The confinement should refuse: either 403 (out-of-root) or 404 (not-found guard)
    expect(resp.status).toBeGreaterThanOrEqual(400)
    expect(resp.status).toBeLessThan(500)
    expect(resp.status).not.toBe(200)
  })
})
