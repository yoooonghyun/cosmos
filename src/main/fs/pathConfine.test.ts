import { describe, it, expect } from 'vitest'
import { sep } from 'node:path'
import { confine, isWithin, type ConfineFs } from './pathConfine'

/*
 * pathConfine — the PURE confinement guard (terminal-file-explorer-v1, FR-019/020/021,
 * SC-004/SC-008). No Electron, no real disk: a fake `realpath` models the filesystem
 * (identity for in-root paths; a remapping for symlinks; `null` for missing paths) so the
 * containment + symlink-escape logic is exercised deterministically.
 *
 * Tests use POSIX-style absolute paths; `path.resolve`/`isAbsolute`/`sep` are POSIX on the
 * CI/dev runner (darwin/linux). The boundary logic is OS-shape-agnostic (a prefix test on
 * canonical paths).
 */

const ROOT = '/home/user/project'

/** A fake `ConfineFs` whose `realpath` returns identity for any path under `known`, applies
 * `symlinks` remaps, and returns `null` for anything in `missing`. Mirrors real
 * `fs.realpathSync` (canonicalize) without touching disk. */
function fakeFs(opts?: {
  symlinks?: Record<string, string>
  missing?: string[]
}): ConfineFs {
  const symlinks = opts?.symlinks ?? {}
  const missing = new Set(opts?.missing ?? [])
  return {
    realpath(p: string): string | null {
      if (missing.has(p)) {
        return null
      }
      // A symlink remaps to its (canonical) target.
      if (p in symlinks) {
        return symlinks[p]
      }
      // Apply a symlinked-ANCESTOR remap: if a known symlink is a prefix of `p`, rewrite it.
      for (const [link, target] of Object.entries(symlinks)) {
        if (p.startsWith(link + sep)) {
          return target + p.slice(link.length)
        }
      }
      return p
    }
  }
}

describe('isWithin', () => {
  it('accepts the root itself and a child under it', () => {
    expect(isWithin(ROOT, ROOT)).toBe(true)
    expect(isWithin(ROOT, `${ROOT}/src/index.ts`)).toBe(true)
  })
  it('rejects a sibling whose name shares the root prefix', () => {
    expect(isWithin(ROOT, `${ROOT}EVIL/secret`)).toBe(false)
    expect(isWithin('/home/user/proj', '/home/user/project/x')).toBe(false)
  })
  it('rejects a path above the root', () => {
    expect(isWithin(ROOT, '/home/user')).toBe(false)
    expect(isWithin(ROOT, '/etc/passwd')).toBe(false)
  })
})

describe('confine — happy path (in-root)', () => {
  it('accepts the root itself (empty relPath)', () => {
    expect(confine(ROOT, '', fakeFs())).toEqual({ ok: true, abs: ROOT })
  })
  it('accepts a nested in-root file', () => {
    expect(confine(ROOT, 'src/index.ts', fakeFs())).toEqual({
      ok: true,
      abs: `${ROOT}/src/index.ts`
    })
  })
  it('accepts a path with a harmless `.` segment', () => {
    expect(confine(ROOT, './src/./a.ts', fakeFs())).toEqual({
      ok: true,
      abs: `${ROOT}/src/a.ts`
    })
  })
})

describe('confine — traversal & absolute escape (FR-020)', () => {
  it('refuses a `..` that escapes the root', () => {
    expect(confine(ROOT, '../other/secret', fakeFs())).toEqual({
      ok: false,
      reason: 'out-of-root'
    })
  })
  it('refuses a layered `..` traversal', () => {
    expect(confine(ROOT, 'src/../../etc/passwd', fakeFs())).toEqual({
      ok: false,
      reason: 'out-of-root'
    })
  })
  it('allows an in-root `..` that stays within the root', () => {
    // src/sub/../a.ts === src/a.ts — still in-root.
    expect(confine(ROOT, 'src/sub/../a.ts', fakeFs())).toEqual({
      ok: true,
      abs: `${ROOT}/src/a.ts`
    })
  })
  it('refuses an absolute relPath (escape attempt)', () => {
    expect(confine(ROOT, '/etc/passwd', fakeFs())).toEqual({ ok: false, reason: 'out-of-root' })
  })
  it('refuses a NUL-bearing relPath', () => {
    expect(confine(ROOT, 'a\0b', fakeFs())).toEqual({ ok: false, reason: 'out-of-root' })
  })
})

describe('confine — symlink escape (FR-021)', () => {
  it('refuses a symlink whose real target is outside the root', () => {
    const fs = fakeFs({ symlinks: { [`${ROOT}/link`]: '/etc/secrets' } })
    expect(confine(ROOT, 'link', fs)).toEqual({ ok: false, reason: 'out-of-root' })
  })
  it('refuses a path THROUGH a symlinked ancestor pointing outside the root', () => {
    const fs = fakeFs({ symlinks: { [`${ROOT}/escape`]: '/var/other' } })
    expect(confine(ROOT, 'escape/inner/file.txt', fs)).toEqual({
      ok: false,
      reason: 'out-of-root'
    })
  })
  it('accepts a symlink whose real target stays inside the root', () => {
    const fs = fakeFs({ symlinks: { [`${ROOT}/alias`]: `${ROOT}/real/dir` } })
    expect(confine(ROOT, 'alias', fs)).toEqual({ ok: true, abs: `${ROOT}/real/dir` })
  })
  it('refuses when the ROOT itself canonicalizes outside (root realpath escapes)', () => {
    // The root is a symlink to elsewhere; both root and target canonicalize together, so an
    // in-"root" path resolves under the canonical root — still accepted by containment, but
    // a MISSING root realpath is refused:
    const fs = fakeFs({ missing: [ROOT] })
    expect(confine(ROOT, 'src/a.ts', fs)).toEqual({ ok: false, reason: 'out-of-root' })
  })
})

describe('confine — not-found vs out-of-root (FR-017/FR-023)', () => {
  it('reports not-found for an in-root path that does not exist on disk', () => {
    const fs = fakeFs({ missing: [`${ROOT}/gone.txt`] })
    expect(confine(ROOT, 'gone.txt', fs)).toEqual({ ok: false, reason: 'not-found' })
  })
  it('still reports out-of-root (not not-found) for a missing OUT-of-root path', () => {
    // Never leak existence of an out-of-root path: an escaping target is out-of-root even
    // when absent.
    const fs = fakeFs({ missing: ['/etc/passwd'] })
    expect(confine(ROOT, '../../etc/passwd', fs)).toEqual({ ok: false, reason: 'out-of-root' })
  })
})

describe('confine — malformed root', () => {
  it('refuses an empty / relative / non-string root', () => {
    expect(confine('', 'a', fakeFs())).toEqual({ ok: false, reason: 'out-of-root' })
    expect(confine('relative/root', 'a', fakeFs())).toEqual({ ok: false, reason: 'out-of-root' })
    // @ts-expect-error — exercise the runtime guard against a non-string root.
    expect(confine(undefined, 'a', fakeFs())).toEqual({ ok: false, reason: 'out-of-root' })
  })
  it('refuses a non-string relPath', () => {
    expect(confine(ROOT, 123, fakeFs())).toEqual({ ok: false, reason: 'out-of-root' })
  })
})
