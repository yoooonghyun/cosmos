import { describe, it, expect } from 'vitest'
import {
  decodeBase64Url,
  decodeLocalFileRef,
  encodeBase64Url,
  encodeLocalFileRef,
  safePaneId,
  safeRelPath,
  COSMOS_FILE_SCHEME,
  COSMOS_FILE_AUTHORITY
} from './localFileRef'

/*
 * localFileRef — the PURE `cosmos-file://` codec/validator (terminal-file-explorer-v1,
 * FR-027/FR-028, SC-004/SC-008). Mirrors confluenceImageRef.test.ts. No Electron; the
 * real-path/symlink containment is exercised by pathConfine.test.ts (the protocol reuses
 * pathConfine), so here we prove the URL codec + the cheap first SSRF gate.
 *
 * The renderer's encoder (`localFileSrc.ts`) is replicated here byte-for-byte so decode is
 * proven to be its exact inverse; a divergence would surface as a failing round-trip.
 */

/** Encode a relPath exactly as the renderer's `localFileSrc.encodeRelPath` does. */
function rendererEncodeRelPath(relPath: string): string {
  return Buffer.from(relPath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Build the opaque URL the renderer's `buildLocalFileSrc` produces. */
const rendererUrl = (paneId: string, relPath: string): string =>
  `${COSMOS_FILE_SCHEME}://${COSMOS_FILE_AUTHORITY}/${paneId}/${rendererEncodeRelPath(relPath)}`

describe('base64url round-trip', () => {
  it('encode→decode round-trips a path with separators + unicode', () => {
    const p = 'src/assets/café/日本.png'
    expect(decodeBase64Url(encodeBase64Url(p))).toBe(p)
  })
  it('main encoder matches the renderer encoder byte-for-byte', () => {
    const p = 'a/b/c d.png?x=1'
    expect(encodeBase64Url(p)).toBe(rendererEncodeRelPath(p))
  })
  it('decode returns null for empty / non-base64url input', () => {
    expect(decodeBase64Url('')).toBeNull()
    expect(decodeBase64Url('not base64!')).toBeNull()
    expect(decodeBase64Url('has/slash')).toBeNull()
  })
})

describe('decodeLocalFileRef — happy path (renderer round-trip)', () => {
  it('decodes a renderer-built URL to { paneId, relPath }', () => {
    const url = rendererUrl('pane-123', 'src/img/logo.png')
    expect(decodeLocalFileRef(url)).toEqual({ paneId: 'pane-123', relPath: 'src/img/logo.png' })
  })
  it('round-trips a UUID paneId + a deep relative path', () => {
    const paneId = '7f3a1c2e-0000-4444-8888-abcdef012345'
    const relPath = 'a/b/c/pic.jpeg'
    const url = encodeLocalFileRef(paneId, relPath)
    expect(url).not.toBeNull()
    expect(decodeLocalFileRef(url as string)).toEqual({ paneId, relPath })
  })
})

describe('decodeLocalFileRef — rejects forged / escaping refs (FR-028)', () => {
  it('rejects a wrong scheme', () => {
    expect(decodeLocalFileRef('cosmos-confluence-img://file/p/' + rendererEncodeRelPath('a.png'))).toBeNull()
    expect(decodeLocalFileRef('https://file/p/' + rendererEncodeRelPath('a.png'))).toBeNull()
  })
  it('rejects a wrong authority', () => {
    expect(decodeLocalFileRef(`${COSMOS_FILE_SCHEME}://evil/p/${rendererEncodeRelPath('a.png')}`)).toBeNull()
  })
  it('rejects a missing paneId or missing encoded segment', () => {
    expect(decodeLocalFileRef(`${COSMOS_FILE_SCHEME}://file/onlypane`)).toBeNull()
    expect(decodeLocalFileRef(`${COSMOS_FILE_SCHEME}://file/`)).toBeNull()
    expect(decodeLocalFileRef(`${COSMOS_FILE_SCHEME}://file`)).toBeNull()
  })
  it('rejects an absolute path inside the ref', () => {
    expect(decodeLocalFileRef(rendererUrl('p', '/etc/passwd'))).toBeNull()
  })
  it('rejects a `..` traversal inside the ref', () => {
    expect(decodeLocalFileRef(rendererUrl('p', '../secret.png'))).toBeNull()
    expect(decodeLocalFileRef(rendererUrl('p', 'a/../../b.png'))).toBeNull()
  })
  it('rejects a backslash / control char in the path', () => {
    expect(decodeLocalFileRef(rendererUrl('p', 'a\\b.png'))).toBeNull()
    expect(decodeLocalFileRef(rendererUrl('p', 'a\nb.png'))).toBeNull()
  })
  it('rejects a protocol-relative //host inside the path', () => {
    expect(decodeLocalFileRef(rendererUrl('p', '//evil/x.png'))).toBeNull()
  })
  it('rejects a paneId carrying a separator / dot-dot', () => {
    // A forged ref smuggling a slash into the paneId splits differently and is rejected.
    expect(decodeLocalFileRef(`${COSMOS_FILE_SCHEME}://file/..%2f/${rendererEncodeRelPath('a.png')}`)).toBeNull()
  })
  it('rejects a non-string / empty input', () => {
    expect(decodeLocalFileRef(undefined)).toBeNull()
    expect(decodeLocalFileRef('')).toBeNull()
  })
})

describe('encodeLocalFileRef — guards inputs', () => {
  it('returns null for a forged paneId or escaping relPath', () => {
    expect(encodeLocalFileRef('bad/pane', 'a.png')).toBeNull()
    expect(encodeLocalFileRef('p', '../a.png')).toBeNull()
    expect(encodeLocalFileRef('p', '/abs.png')).toBeNull()
    expect(encodeLocalFileRef('', 'a.png')).toBeNull()
  })
  it('produces a decodable URL for clean inputs', () => {
    const url = encodeLocalFileRef('p1', 'dir/a.png')
    expect(url).toBe(rendererUrl('p1', 'dir/a.png'))
  })
})

describe('safeRelPath / safePaneId', () => {
  it('safeRelPath accepts a clean relative path, rejects escapes', () => {
    expect(safeRelPath('src/a.png')).toBe('src/a.png')
    expect(safeRelPath('')).toBeNull()
    expect(safeRelPath('/abs')).toBeNull()
    expect(safeRelPath('a/../b')).toBeNull()
    expect(safeRelPath('a\\b')).toBeNull()
  })
  it('safePaneId rejects separators, whitespace, dots', () => {
    expect(safePaneId('abc-123')).toBe('abc-123')
    expect(safePaneId('a/b')).toBeNull()
    expect(safePaneId('a b')).toBeNull()
    expect(safePaneId('..')).toBeNull()
    expect(safePaneId('')).toBeNull()
  })
})
