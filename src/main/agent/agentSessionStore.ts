/**
 * On-disk persistent session-id store for the default-agent conversation
 * (cosmos-conversation-panel-v1, step 2).
 *
 * Persists ONE non-secret value — the default conversation's `claude` session id —
 * as plain JSON under `app.getPath('userData')`, so the SAME session id is reused
 * on every run AND after app relaunch (the conversation continues; `claude` appends
 * to the same `~/.claude/projects/<cwd-hash>/<session-id>.jsonl` transcript).
 *
 * Built on the same injectable-fs + defensive-load + atomic-write shape as
 * `sessionStore.ts` (write tmp → rename so a crash mid-write never corrupts a good
 * file). `load()` is defensive: a missing / unparsable / wrong-shape file resolves
 * to `null`, and the caller MINTS a fresh id. The session id is NOT a secret, but it
 * is never logged as a token and never crosses to the renderer.
 *
 * fs is injected behind a small interface so the store is unit-testable without
 * Electron.
 */

/** Optional structured warning sink (defaults to console.warn). */
export type WarnFn = (message: string, ...rest: unknown[]) => void

/** The slice of `fs` the store needs (injectable for tests). Atomic rename like sessionStore. */
export interface AgentSessionFsLike {
  existsSync(path: string): boolean
  readFileSync(path: string): Buffer
  writeFileSync(path: string, data: Buffer): void
  mkdirSync(path: string, opts: { recursive: true }): void
  renameSync(oldPath: string, newPath: string): void
  rmSync(path: string, opts: { force: true }): void
}

export interface AgentSessionStoreDeps {
  /** Absolute path of the JSON file (e.g. `<userData>/agent-session.json`). */
  filePath: string
  /** Directory of `filePath`, created on save. */
  dirPath: string
  fs: AgentSessionFsLike
  /** Optional warning sink (defaults to console.warn). */
  warn?: WarnFn
}

/** The persisted shape — one non-secret id (additive store, no schema version needed). */
export interface AgentSessionRecord {
  /** The default conversation's stable `claude` session id (a uuid). */
  defaultSessionId: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export class AgentSessionStore {
  private readonly deps: AgentSessionStoreDeps

  constructor(deps: AgentSessionStoreDeps) {
    this.deps = deps
  }

  private get warn(): WarnFn {
    return this.deps.warn ?? ((m, ...r) => console.warn(m, ...r))
  }

  /**
   * Read the persisted default session id, or `null` when absent / corrupt /
   * wrong-shape. Never throws — the caller treats `null` as "mint a fresh id".
   */
  loadDefaultSessionId(): string | null {
    const { fs, filePath } = this.deps
    if (!fs.existsSync(filePath)) {
      return null
    }
    try {
      const raw = fs.readFileSync(filePath).toString('utf8')
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed &&
        typeof parsed === 'object' &&
        isNonEmptyString((parsed as Record<string, unknown>).defaultSessionId)
      ) {
        return (parsed as AgentSessionRecord).defaultSessionId
      }
      this.warn('[agent-session] persisted record missing/blank defaultSessionId; treating as absent')
      return null
    } catch (err) {
      this.warn('[agent-session] failed to read/parse session id; treating as absent', err)
      return null
    }
  }

  /**
   * Atomically persist the default session id (write tmp → rename). A blank id is
   * refused (never overwrite a good file with garbage). Best-effort: a write failure
   * is warned, never thrown, and a stray tmp is cleaned up.
   */
  saveDefaultSessionId(sessionId: string): void {
    if (!isNonEmptyString(sessionId)) {
      this.warn('[agent-session] refusing to persist a blank session id')
      return
    }
    const { fs, filePath, dirPath } = this.deps
    const tmpPath = `${filePath}.tmp`
    const record: AgentSessionRecord = { defaultSessionId: sessionId }
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      fs.writeFileSync(tmpPath, Buffer.from(JSON.stringify(record), 'utf8'))
      fs.renameSync(tmpPath, filePath)
    } catch (err) {
      this.warn('[agent-session] failed to write session id', err)
      try {
        fs.rmSync(tmpPath, { force: true })
      } catch {
        // ignore
      }
    }
  }
}
