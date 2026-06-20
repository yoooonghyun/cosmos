/**
 * fsExplorer — the MAIN-side, Electron-FREE manager for the Terminal File Explorer
 * (terminal-file-explorer-v1, FR-004/FR-008/FR-014/FR-016/FR-019). It orchestrates the
 * `fs:list` / `fs:read` reads and the per-`paneId` `fs.watch` lifecycle, confining every
 * access with `pathConfine` and classifying reads with `fileKind`. It takes its
 * dependencies (the root lookup, the change sink, and the node `fs` surface) by INJECTION
 * so it stays node-unit-testable with no Electron/IPC import (the `.ts`/`.test.ts` split);
 * `index.ts` wires the real `terminalSessionMap` lookup, the `webContents.send` sink, and
 * `node:fs`.
 *
 * Security (the headline risk): the renderer NEVER supplies a root — it sends only a
 * `paneId` + a root-relative `relPath`. The manager looks the root up via the injected
 * `getRoot(paneId)` (FR-022), then `pathConfine` real-paths both root and target and
 * refuses any `..`/absolute/symlink escape (FR-019/020/021). A pane with no live root, or
 * any out-of-root/missing/denied target, yields a denied/empty result — never an
 * out-of-root read, never a throw (FR-023).
 *
 * Watching (FR-014/FR-015/FR-016/FR-018/FR-018a): one `fs.watch(root, { recursive: true })`
 * per watched pane; any event is DEBOUNCED then emitted as ONE coarse `onChanged(paneId)`
 * (re-list-on-event — the renderer re-lists, not trusting per-event granularity). A watcher
 * is released on `stopWatch`, on `getRoot` returning nothing, and via `stopAll` at teardown
 * — no leak across tab close or window teardown. v1 targets macOS/Windows; recursive
 * `fs.watch` on Linux is a known limitation (deferred follow-up).
 */

import { confine, type ConfineFs } from './pathConfine'
import { classifyFile } from './fileKind'
import type { FsEntry, FsListResult, FsReadResult } from '../shared/ipc'

/**
 * Deterministic list order (FR-005): directories first, then files, each alphabetical
 * case-insensitive with a stable case-sensitive tiebreak. Mirrors the renderer's
 * `tree.compareEntries` byte-for-byte (both sort the same way so the rendered order is
 * stable across a re-list). Kept local so main imports nothing renderer-side.
 */
function compareEntries(a: FsEntry, b: FsEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === 'dir' ? -1 : 1
  }
  const an = a.name.toLowerCase()
  const bn = b.name.toLowerCase()
  if (an < bn) return -1
  if (an > bn) return 1
  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

/** Resolve a pane's absolute root directory (its `claude` cwd), or `undefined` when the
 * pane has no live session (awaiting-directory, disposed, or exited). Injected so the
 * manager never reaches into `terminalSessionMap` directly (FR-022/D-5). */
export type RootResolver = (paneId: string) => string | undefined

/** Emit a coarse change for a pane (the renderer re-lists). Injected so the manager never
 * touches `webContents` (FR-015). */
export type ChangeSink = (paneId: string) => void

/** A watcher handle the manager can close. Mirrors `fs.FSWatcher`'s `close()`. */
export interface FsWatcher {
  close(): void
}

/**
 * The minimal node-`fs` surface the manager needs, INJECTED so the manager is unit-testable
 * without the real disk. `index.ts` wires these to `node:fs` (sync variants + `fs.watch`).
 * Every probe MUST be total — it returns a sentinel on error rather than throwing (the
 * manager turns those into denied/not-found results, never a crash).
 */
export interface ExplorerFs extends ConfineFs {
  /** `realpath` is inherited from {@link ConfineFs}: canonical path or `null` if missing. */
  /** Directory entries (names + dirent flags) of `absDir`, or an error sentinel. */
  readDir(absDir: string): { name: string; isDir: boolean; isSymlink: boolean }[] | { error: 'denied' | 'not-found' }
  /** The file's bytes at `absFile`, or an error sentinel. NO size cap (FR-012). */
  readFileBytes(absFile: string): Uint8Array | { error: 'denied' | 'not-found' }
  /** Start watching `absRoot` recursively; `onEvent` fires on any change. Returns a handle. */
  watch(absRoot: string, onEvent: () => void): FsWatcher | null
}

/** Debounce window (ms) coalescing a burst of `fs.watch` events into one `onChanged`
 * (FR-018). Small enough to feel live, large enough to absorb a save-storm. */
const WATCH_DEBOUNCE_MS = 120

interface WatchState {
  watcher: FsWatcher
  /** The absolute root being watched — so a cwd change can be detected + re-watched. */
  root: string
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Create the file-explorer manager. Pure factory over injected deps (no global state) so a
 * test constructs one with fakes and the app constructs one with the real wiring.
 */
export function createFsExplorer(deps: {
  getRoot: RootResolver
  onChanged: ChangeSink
  fs: ExplorerFs
  /** Debounce override for tests (default {@link WATCH_DEBOUNCE_MS}). */
  debounceMs?: number
}): FsExplorer {
  const { getRoot, onChanged, fs } = deps
  const debounceMs = deps.debounceMs ?? WATCH_DEBOUNCE_MS
  const watches = new Map<string, WatchState>()

  /** Look up + canonicalize a pane's root, or `null` when there is no live root. */
  function rootOf(paneId: string): string | null {
    const root = getRoot(paneId)
    if (typeof root !== 'string' || root === '') {
      return null
    }
    return root
  }

  function list(paneId: string, relPath: string): FsListResult {
    const root = rootOf(paneId)
    if (root === null) {
      return { ok: false, reason: 'out-of-root' }
    }
    const c = confine(root, relPath, fs)
    if (!c.ok) {
      // `not-found` (in-root but absent) maps straight through; `out-of-root` is refused.
      return { ok: false, reason: c.reason }
    }
    const result = fs.readDir(c.abs)
    if ('error' in result) {
      return { ok: false, reason: result.error }
    }
    const entries: FsEntry[] = result
      .map((e) => ({
        name: e.name,
        kind: e.isDir ? ('dir' as const) : ('file' as const),
        isSymlink: e.isSymlink
      }))
      .sort(compareEntries)
    return { ok: true, entries }
  }

  function read(paneId: string, relPath: string): FsReadResult {
    const root = rootOf(paneId)
    if (root === null) {
      return { ok: false, reason: 'out-of-root' }
    }
    const c = confine(root, relPath, fs)
    if (!c.ok) {
      return { ok: false, reason: c.reason }
    }
    const bytes = fs.readFileBytes(c.abs)
    if (bytes instanceof Uint8Array) {
      const kind = classifyFile(relPath, bytes)
      if (kind === 'image') {
        // Image bytes do NOT ride IPC — the renderer loads the `cosmos-file://` URL
        // (FR-010/FR-028). Return only the marker.
        return { ok: true, kind: 'image' }
      }
      if (kind === 'text') {
        return { ok: true, kind: 'text', text: new TextDecoder('utf-8').decode(bytes) }
      }
      // Binary / non-text, not a supported image — "preview not available" (FR-011).
      return { ok: false, reason: 'binary' }
    }
    return { ok: false, reason: bytes.error }
  }

  function startWatch(paneId: string): void {
    const root = rootOf(paneId)
    if (root === null) {
      // No live root (awaiting-directory / disposed) — no watcher (FR-006/FR-016).
      return
    }
    const existing = watches.get(paneId)
    if (existing) {
      if (existing.root === root) {
        return // already watching this root — no double-watch (idempotent).
      }
      // The pane's cwd changed — release the stale watcher before re-watching (FR-016).
      stopWatch(paneId)
    }
    // Confine the root to itself (real-path it) so a vanished/symlinked root is refused
    // before we hand it to `fs.watch`.
    const c = confine(root, '', fs)
    if (!c.ok) {
      return
    }
    const fire = (): void => {
      const state = watches.get(paneId)
      if (!state) {
        return
      }
      if (state.timer) {
        clearTimeout(state.timer)
      }
      state.timer = setTimeout(() => {
        const cur = watches.get(paneId)
        if (cur) {
          cur.timer = null
        }
        onChanged(paneId)
      }, debounceMs)
    }
    const watcher = fs.watch(c.abs, fire)
    if (!watcher) {
      return
    }
    watches.set(paneId, { watcher, root, timer: null })
  }

  function stopWatch(paneId: string): void {
    const state = watches.get(paneId)
    if (!state) {
      return
    }
    if (state.timer) {
      clearTimeout(state.timer)
    }
    try {
      state.watcher.close()
    } catch {
      // A watcher whose root vanished can throw on close; the handle is dropped regardless.
    }
    watches.delete(paneId)
  }

  function stopAll(): void {
    for (const paneId of [...watches.keys()]) {
      stopWatch(paneId)
    }
  }

  /** Test/introspection helper: paneIds currently being watched. */
  function watchedPanes(): string[] {
    return [...watches.keys()]
  }

  return { list, read, startWatch, stopWatch, stopAll, watchedPanes }
}

/** The manager surface (see {@link createFsExplorer}). */
export interface FsExplorer {
  list(paneId: string, relPath: string): FsListResult
  read(paneId: string, relPath: string): FsReadResult
  startWatch(paneId: string): void
  stopWatch(paneId: string): void
  stopAll(): void
  watchedPanes(): string[]
}
