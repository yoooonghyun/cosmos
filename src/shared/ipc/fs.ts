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
  /** R->M (invoke): read one DOCUMENT file's raw BYTES for a byte-consuming renderer
   * (pdf/docx/sheet). file-viewer-multiformat-v1 FR-007. Replaces the cross-scheme
   * `cosmos-file://` fetch that Chromium blocks from the http dev origin: the bytes ride
   * THIS validated, root-confined IPC instead. Per-format size caps (FR-012) are enforced
   * in main before the read; the result carries a `Uint8Array` or an `FsFailureReason`. */
  ReadBytes: 'fs:readBytes',
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
 *  - `too-large`   — (read only, file-viewer-multiformat-v1 FR-012) a DOCUMENT file
 *    (pdf/docx/xlsx) over its per-format byte cap → the calm "File too large to preview"
 *    block, parsed without loading the bytes. Images/text deliberately have NO cap.
 */
export type FsFailureReason = 'denied' | 'not-found' | 'out-of-root' | 'binary' | 'too-large'

/**
 * M->R response to `fs:list` (FR-004). `ok: true` carries the directory's entries
 * (already sorted dirs-first, alphabetical case-insensitive — FR-005); `ok: false`
 * carries a reason so the explorer shows the right state (denied / not-found /
 * out-of-root) instead of a crash (FR-023). The read-only `binary` / `too-large` reasons
 * never occur on a list (they classify a FILE's content/size, not a directory listing).
 */
export type FsListResult =
  | { ok: true; entries: FsEntry[] }
  | { ok: false; reason: Exclude<FsFailureReason, 'binary' | 'too-large'> }

/**
 * M->R response to `fs:read` (FR-008/FR-009/FR-010/FR-011; file-viewer-multiformat-v1
 * FR-005/FR-007/FR-012). Discriminated; bytes NEVER ride this channel — every non-text
 * payload is a MARKER and the renderer streams the bytes out-of-band from `cosmos-file://`:
 *  - `{ ok: true, kind: 'text', text }` — a UTF-8 text file, rendered read-only in
 *    Monaco (FR-009). No size cap — the whole text rides this channel.
 *  - `{ ok: true, kind: 'image' }` — a MARKER ONLY (FR-010/FR-028). The renderer loads the
 *    `cosmos-file://` URL into an `<img>`; NO bytes / no `data:` URL cross this channel.
 *  - `{ ok: true, kind: 'pdf' | 'docx' | 'sheet' }` — DOCUMENT MARKERS (file-viewer-
 *    multiformat-v1 FR-001/FR-002/FR-003). Like the image marker, the renderer fetches the
 *    bytes from `cosmos-file://` and hands them to the per-format renderer; no bytes ride IPC.
 *  - `{ ok: false, reason }` — `binary` (sniffed binary, no registered viewer →
 *    "preview not available", FR-006), `too-large` (a document over its per-format cap,
 *    FR-012), `denied` (OS permission), `not-found` (deleted), or `out-of-root` (escaped the
 *    root — refused, FR-019). NEVER raw bytes (FR-011).
 *
 * Per-format size caps (FR-012) apply ONLY to the document markers (pdf/docx/sheet) — the
 * parse-into-memory formats; `text`/`image` keep their deliberate NO-cap stance.
 */
export type FsReadResult =
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'image' }
  | { ok: true; kind: 'pdf' }
  | { ok: true; kind: 'docx' }
  | { ok: true; kind: 'sheet' }
  | { ok: false; reason: FsFailureReason }

/**
 * M->R response to `fs:readBytes` (file-viewer-multiformat-v1 FR-007). Carries the DOCUMENT
 * file's RAW BYTES on success — the bytes the pdf/docx/sheet renderer parses. Unlike `fs:read`
 * (which returns markers only), this channel DOES carry bytes, because the byte-consuming
 * renderers cannot fetch the privileged `cosmos-file://` scheme via `fetch`/XHR from the http
 * dev origin (Chromium refuses the cross-scheme request). The bytes are the user's own in-root
 * file, already shown in the viewer, bounded by the same per-format size cap (FR-012):
 *  - `{ ok: true, bytes }` — the file's bytes (a `Uint8Array`; structured-clone-safe over IPC).
 *  - `{ ok: false, reason }` — `too-large` (over the per-format cap, FR-012), `out-of-root`
 *    (forged / escaped / no live root), `not-found` (vanished), or `denied` (OS permission).
 *    `binary` never occurs here (the caller only requests bytes for a routed document). NEVER
 *    throws across the boundary — every failure is a typed reason.
 */
export type FsReadBytesResult =
  | { ok: true; bytes: Uint8Array }
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
  /** R->M (invoke). Read a routed DOCUMENT file's raw BYTES for a byte-consuming renderer
   * (pdf/docx/sheet) — file-viewer-multiformat-v1 FR-007. Resolves to `{ ok: true, bytes }`
   * (a `Uint8Array`) or a typed failure (`too-large`/`out-of-root`/`not-found`/`denied`);
   * never throws. This REPLACES the blocked `cosmos-file://` cross-scheme fetch — the bytes
   * ride this validated, root-confined, size-capped boundary instead. */
  readBytes(paneId: string, relPath: string): Promise<FsReadBytesResult>
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
