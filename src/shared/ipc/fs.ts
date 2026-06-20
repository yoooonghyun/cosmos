/**
 * Terminal File Explorer (terminal-file-explorer-v1) IPC contract — `fs:*` channels
 * + payloads. Spec: .sdd/specs/terminal-file-explorer-v1.md. Re-exported (unchanged)
 * through the `src/shared/ipc.ts` barrel.
 *
 * A per-tab read-only file explorer rooted at the tab's MAIN-owned cwd
 * (`terminalSessionMap`). The renderer addresses everything by `paneId` + a
 * root-RELATIVE path (`relPath`); main resolves the root itself (FR-022) and
 * confines every list/read/watch to the tab's cwd subtree (FR-019/020/021). The
 * renderer NEVER sends an absolute path and main NEVER returns one (D-2).
 *
 * Image bytes do NOT ride this contract: a supported image is delivered out-of-band
 * via the privileged `cosmos-file://` streaming scheme (FR-010/FR-028); `fs:read`
 * only returns a `kind: 'image'` MARKER, after which the renderer loads the
 * `cosmos-file://` URL (see `localFileRef.ts` / the renderer URL builder).
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

/**
 * Channel name constants (FR-025). Centralized so main, preload, and renderer never
 * disagree on a string literal. New channels: list directory, read file, start/stop
 * watch, and the watch-change event.
 */
export const FsChannel = {
  /** R->M (invoke): list one directory's entries (root-relative). FR-004/FR-005. */
  List: 'fs:list',
  /** R->M (invoke): read one file for the viewer (text marker / image marker /
   * not-previewable). FR-008/FR-009/FR-011. Image BYTES never ride this channel. */
  Read: 'fs:read',
  /** R->M (send): begin watching that pane's root. FR-015/FR-016. */
  WatchStart: 'fs:watchStart',
  /** R->M (send): release that pane's watcher. FR-016. */
  WatchStop: 'fs:watchStop',
  /** M->R (on): coarse "something under your root changed; re-list" — debounced in
   * main (FR-014/FR-018). Carries only `paneId`. */
  Changed: 'fs:changed'
} as const

export type FsChannelName = (typeof FsChannel)[keyof typeof FsChannel]

/**
 * One directory entry the renderer renders as a tree row (FR-004/FR-005). NO absolute
 * path leaks to the renderer (D-2) — the renderer addresses the entry by joining its
 * `name` onto the parent's `relPath`. `kind` distinguishes a file from a directory
 * (a symlink reports the kind of its target when known, else `'file'`); `isSymlink`
 * flags a symlink so the row can show the symlink affordance (design §2.2).
 */
export interface FsEntry {
  /** The entry's basename (no path separators). */
  name: string
  /** Whether the entry is a directory or a (regular/other) file. */
  kind: 'file' | 'dir'
  /** True when the entry itself is a symbolic link. */
  isSymlink: boolean
}

/**
 * Why a list/read was refused or could not complete (FR-011/FR-019/FR-023). Shared
 * by `FsListResult` and `FsReadResult`:
 *  - `denied`      — the OS refused the read (permission). A benign, expected outcome.
 *  - `not-found`   — the target does not exist (e.g. deleted while open, FR-017).
 *  - `out-of-root` — the resolved path escaped the tab's root (`..`/absolute/symlink
 *    escape) or the pane has no live root; refused without reading (FR-019/020/021).
 *  - `binary`      — (read only) the file is binary/non-text and not a supported image
 *    → "preview not available", never raw bytes (FR-011).
 */
export type FsFailureReason = 'denied' | 'not-found' | 'out-of-root' | 'binary'

/**
 * M->R response to `fs:list` (FR-004). `ok: true` carries the directory's entries
 * (already sorted dirs-first, alphabetical case-insensitive — FR-005); `ok: false`
 * carries a reason so the explorer shows the right state (denied / not-found /
 * out-of-root) instead of a crash (FR-023). A `binary` reason never occurs on a list.
 */
export type FsListResult =
  | { ok: true; entries: FsEntry[] }
  | { ok: false; reason: Exclude<FsFailureReason, 'binary'> }

/**
 * M->R response to `fs:read` (FR-008/FR-009/FR-010/FR-011). Discriminated:
 *  - `{ ok: true, kind: 'text', text }` — a UTF-8 text file, rendered read-only in
 *    Monaco (FR-009). No size cap (FR-012) — the whole text rides this channel.
 *  - `{ ok: true, kind: 'image' }` — a MARKER ONLY (FR-010/FR-028). The renderer then
 *    loads the `cosmos-file://` URL; NO bytes / no `data:` URL cross this channel.
 *  - `{ ok: false, reason }` — `binary` (not text, not a supported image →
 *    "preview not available"), `denied` (OS permission), `not-found` (deleted), or
 *    `out-of-root` (escaped the root — refused, FR-019). NEVER raw bytes (FR-011).
 * There is deliberately NO `too-large` reason — there is no file-content size cap
 * (FR-012, OQ-3 resolved).
 */
export type FsReadResult =
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'image' }
  | { ok: false; reason: FsFailureReason }

/**
 * R->M payload for `fs:list` / `fs:read` (FR-022/FR-025). Carries the `paneId` so main
 * resolves the root itself and the root-RELATIVE `relPath` of the directory/file. The
 * renderer NEVER sends a root or an absolute path; `relPath === ''` addresses the root
 * directory itself. Main joins `relPath` onto the looked-up root then confines it
 * (FR-019/020/021).
 */
export interface FsPathPayload {
  /** Which terminal tab's root to resolve against (FR-022). */
  paneId: string
  /** Root-relative path of the target directory (list) or file (read); `''` = root. */
  relPath: string
}

/**
 * R->M payload for `fs:watchStart` / `fs:watchStop` (FR-015/FR-016). Carries only the
 * `paneId` — main watches that pane's looked-up root; the renderer never names a path.
 */
export interface FsWatchPayload {
  /** Which terminal tab's root to start/stop watching (FR-016). */
  paneId: string
}

/**
 * M->R payload for `fs:changed` (FR-014/FR-018). Coarse: only the `paneId` whose root
 * saw a change. The renderer re-lists its expanded directories and merges seamlessly
 * (design §6) — it does NOT trust per-event path granularity (re-list-on-event, FR-018a).
 */
export interface FsChangedPayload {
  /** The terminal tab whose root changed; the renderer re-lists (FR-014). */
  paneId: string
}

/**
 * The API surface exposed to the renderer via `contextBridge` as `window.cosmos.fs`
 * (FR-025/FR-026). Reads are request/response (`invoke`); watch start/stop are
 * fire-and-forget (`send`); `onChanged` is an M->R subscription returning an
 * unsubscribe fn.
 *
 * NEW preload surface — adding `window.cosmos.fs.*` requires a FULL `npm run dev`
 * restart; HMR alone leaves the methods as "not a function" (FR-026, CLAUDE.md).
 *
 * No token/secret crosses this surface (FR-024); file contents are the user's own
 * local files inside the chosen root and ride only this typed, validated boundary.
 */
export interface FsApi {
  /** R->M (invoke). List a root-relative directory's entries (FR-004). `relPath: ''`
   * lists the root. Resolves to a denied/empty result on any out-of-root/missing
   * path — never throws (FR-023). */
  list(paneId: string, relPath: string): Promise<FsListResult>
  /** R->M (invoke). Read a root-relative file for the viewer (FR-008). Resolves to a
   * text marker, an image marker, or a not-previewable reason — never raw bytes on a
   * binary, never throws (FR-011/FR-023). */
  read(paneId: string, relPath: string): Promise<FsReadResult>
  /** R->M (send). Begin watching this pane's root (FR-015/FR-016). A pane with no live
   * root creates no watcher (FR-006). */
  watchStart(paneId: string): void
  /** R->M (send). Release this pane's watcher (FR-016) — on unmount / cwd-change. */
  watchStop(paneId: string): void
  /** M->R. Subscribe to coarse change events for ALL panes; each payload carries its
   * own `paneId` so the renderer re-lists only the matching tab (FR-014). Returns an
   * unsubscribe fn. */
  onChanged(listener: (payload: FsChangedPayload) => void): () => void
}
