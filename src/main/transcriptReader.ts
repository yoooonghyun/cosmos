/**
 * Main-process DEFAULT-SESSION transcript reader (cosmos-conversation-panel-v2, step 3).
 * Spec: FR-105/FR-108.
 *
 * Owns ALL `~/.claude` access for the Cosmos conversation timeline, CONFINED to the ONE
 * known default-session transcript path:
 *
 *   `~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl`
 *
 * where `<dir-key>` is claude's encoding of the sandbox cwd (`resolveSandboxDir()` =
 * `<userData>/sandbox`) — the absolute path with `/` and `.` replaced by `-` — and
 * `<defaultSessionId>` is the persisted id (`AgentSessionStore`). It NEVER accepts a
 * renderer-supplied path, NEVER reads any other session/project, and NEVER exposes
 * arbitrary `~/.claude` reads (FR-105). The renderer never touches `~/.claude`.
 *
 * The read is resilient (FR-108): a missing file → `{ ok:false, reason:'empty' }`; an
 * unreadable/corrupt file → `{ ok:false, reason:'unreadable' }`; a single malformed line →
 * skipped by the pure parser. It NEVER throws across the IPC boundary.
 *
 * Pure line→model normalization lives in `transcriptParse.ts` (node-tested); this module is
 * the thin fs shell (path derivation + read + delegate).
 */

import type { ConversationResult } from '../shared/ipc/conversation'
import type { Conversation } from '../shared/types/conversation'
import { parseTranscript } from './transcriptParse'

/** The slice of `fs` the reader needs (injectable for tests; no write surface). */
export interface TranscriptFsLike {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
  /** List a directory's entries (for the scan fallback). Returns [] on any error. */
  readdirSync?(path: string): string[]
}

export interface TranscriptReaderDeps {
  /** The user's home directory (`~`), e.g. `app.getPath('home')`. */
  homeDir: string
  /** The stable sandbox cwd the default session runs in (`resolveSandboxDir()`). */
  sandboxDir: string
  /** Resolve the persisted default session id (or null when none yet). */
  loadDefaultSessionId(): string | null
  fs: TranscriptFsLike
  /** Optional warning sink (defaults to console.warn). */
  warn?: (message: string, ...rest: unknown[]) => void
}

/**
 * Encode a cwd to claude's `~/.claude/projects/<dir-key>` folder name (OQ-V2-pathkey):
 * the absolute path with every `/` and `.` replaced by `-`. PURE + exported so the
 * transform is pinned by a test against a real on-disk dir.
 */
export function encodeProjectDirKey(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

/** Join path segments with `/` (the reader runs on macOS/posix paths under `~/.claude`). */
function joinPath(...parts: string[]): string {
  return parts.join('/')
}

export class TranscriptReader {
  private readonly deps: TranscriptReaderDeps

  constructor(deps: TranscriptReaderDeps) {
    this.deps = deps
  }

  private get warn(): (message: string, ...rest: unknown[]) => void {
    return this.deps.warn ?? ((m, ...r) => console.warn(m, ...r))
  }

  /**
   * Resolve the ONE confined transcript path for the persisted default session, or `null`
   * when there is no persisted id yet. Tries the DERIVED `<dir-key>` first (FR-105 /
   * OQ-V2-pathkey); if that file is absent, falls back to SCANNING `~/.claude/projects/*`
   * for the dir containing `<sessionId>.jsonl` (documented fallback — claude's encoding
   * could differ for special characters). Returns only a path UNDER `~/.claude/projects`.
   */
  resolveTranscriptPath(): string | null {
    const sessionId = this.deps.loadDefaultSessionId()
    if (!sessionId) {
      return null
    }
    const projectsRoot = joinPath(this.deps.homeDir, '.claude', 'projects')
    const fileName = `${sessionId}.jsonl`

    // Primary: derive <dir-key> from the sandbox cwd.
    const derived = joinPath(projectsRoot, encodeProjectDirKey(this.deps.sandboxDir), fileName)
    if (this.deps.fs.existsSync(derived)) {
      return derived
    }

    // Fallback: scan project dirs for the one holding <sessionId>.jsonl.
    const readdir = this.deps.fs.readdirSync
    if (readdir && this.deps.fs.existsSync(projectsRoot)) {
      let dirs: string[]
      try {
        dirs = readdir(projectsRoot)
      } catch {
        dirs = []
      }
      for (const dir of dirs) {
        const candidate = joinPath(projectsRoot, dir, fileName)
        if (this.deps.fs.existsSync(candidate)) {
          return candidate
        }
      }
    }

    // No transcript file exists yet — the EMPTY state (the session has not been exercised).
    return derived // returned for diagnostics; the caller's existsSync makes it 'empty'.
  }

  /**
   * Read + normalize the default-session conversation (FR-105/FR-108). NEVER throws:
   *  - no persisted id / no transcript file → `{ ok:false, reason:'empty' }`
   *  - read/parse failure → `{ ok:false, reason:'unreadable' }`
   *  - otherwise → `{ ok:true, conversation }` (which may itself be `state:'empty'` when the
   *    file held no conversational turns).
   */
  read(): ConversationResult {
    const sessionId = this.deps.loadDefaultSessionId()
    const path = this.resolveTranscriptPath()
    if (!path || !this.deps.fs.existsSync(path)) {
      return { ok: false, reason: 'empty' } // FR-108: missing file ⇒ empty, not error.
    }
    let raw: string
    try {
      raw = this.deps.fs.readFileSync(path, 'utf8')
    } catch (err) {
      this.warn('[conversation] failed to read default-session transcript', err)
      return { ok: false, reason: 'unreadable' }
    }
    let turns
    try {
      turns = parseTranscript(raw.split('\n'))
    } catch (err) {
      // The pure parser is defensive (skips bad lines), so a throw here is unexpected —
      // surface it as the calm recoverable error state rather than crashing main.
      this.warn('[conversation] failed to parse default-session transcript', err)
      return { ok: false, reason: 'unreadable' }
    }
    const conversation: Conversation = {
      ...(sessionId ? { sessionId } : {}),
      turns,
      state: turns.length > 0 ? 'populated' : 'empty'
    }
    return { ok: true, conversation }
  }
}
