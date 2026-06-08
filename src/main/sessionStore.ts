/**
 * On-disk session snapshot store (session-persistence-v1, D1).
 *
 * Persists the working-session snapshot as PLAIN, UNENCRYPTED JSON under
 * `app.getPath('userData')` (the snapshot is non-secret structure — FR-006). Built
 * on the same injectable-fs + defensive-load shape as `tokenStore.ts`, MINUS
 * `safeStorage`, PLUS an atomic write (write tmp → rename) so a crash mid-write
 * never corrupts a previously-good snapshot (FR-001/FR-007).
 *
 * `load()` is defensive: a missing / unparizable / wrong-shape file resolves to
 * `null`, and the caller falls back to a clean empty session (FR-005). `save()`
 * validates + normalizes via `validateSnapshot` and SILENTLY ignores an invalid
 * payload rather than overwriting the good file (FR-004/FR-007).
 *
 * fs is injected behind a small interface so the store is unit-testable without
 * Electron, and the on-disk bytes can be asserted to contain no secret (SC-004).
 */

import type { SessionSnapshot } from '../shared/ipc'
import { validateSnapshot, type WarnFn } from './sessionSnapshot'

/** The slice of `fs` the store needs (injectable for tests). Adds atomic rename. */
export interface SessionFsLike {
  existsSync(path: string): boolean
  readFileSync(path: string): Buffer
  writeFileSync(path: string, data: Buffer): void
  mkdirSync(path: string, opts: { recursive: true }): void
  renameSync(oldPath: string, newPath: string): void
  rmSync(path: string, opts: { force: true }): void
}

export interface SessionStoreDeps {
  /** Absolute path of the snapshot JSON (e.g. `<userData>/session.json`). */
  filePath: string
  /** Directory of `filePath`, created on save. */
  dirPath: string
  fs: SessionFsLike
  /** Optional warning sink (defaults to console.warn). */
  warn?: WarnFn
}

export class SessionStore {
  private readonly deps: SessionStoreDeps

  constructor(deps: SessionStoreDeps) {
    this.deps = deps
  }

  private get warn(): WarnFn {
    return this.deps.warn ?? ((m, ...r) => console.warn(m, ...r))
  }

  /**
   * Read + validate the persisted snapshot, or `null` when absent / corrupt /
   * wrong-version (FR-001/FR-002/FR-005). Never throws.
   */
  load(): SessionSnapshot | null {
    const { fs, filePath } = this.deps
    if (!fs.existsSync(filePath)) {
      return null
    }
    try {
      const raw = fs.readFileSync(filePath).toString('utf8')
      const parsed: unknown = JSON.parse(raw)
      return validateSnapshot(parsed, this.warn)
    } catch (err) {
      this.warn('[session] failed to read/parse snapshot; treating as empty', err)
      return null
    }
  }

  /**
   * Validate + atomically persist the snapshot (FR-001/FR-004/FR-007). An invalid
   * payload is ignored WITHOUT overwriting the existing good file. Writes to a
   * sibling tmp path then renames over the target so a partial write is never seen.
   */
  save(snapshot: SessionSnapshot): void {
    const validated = validateSnapshot(snapshot, this.warn)
    if (validated === null) {
      this.warn('[session] refusing to persist invalid snapshot; keeping existing file')
      return
    }
    const { fs, filePath, dirPath } = this.deps
    const tmpPath = `${filePath}.tmp`
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      fs.writeFileSync(tmpPath, Buffer.from(JSON.stringify(validated), 'utf8'))
      fs.renameSync(tmpPath, filePath)
    } catch (err) {
      this.warn('[session] failed to write snapshot', err)
      // Best-effort cleanup of a stray tmp file.
      try {
        fs.rmSync(tmpPath, { force: true })
      } catch {
        // ignore
      }
    }
  }
}
