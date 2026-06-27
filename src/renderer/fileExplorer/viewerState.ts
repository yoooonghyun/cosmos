/**
 * viewerState — PURE state for the middle file-viewer column (terminal-file-explorer-v1, 3-pane
 * rework). No React/DOM (node env), so the open/retarget/invalidate transitions are node-tested.
 *
 * 3-pane layout: terminal (left) | file viewer (MIDDLE) | file tree dock (RIGHT). The tree is
 * ALWAYS visible — it is never replaced by the viewer. Clicking a file OPENS or RETARGETS the
 * middle viewer; there is NO "back to tree" transition (the tree never went away). `null` is the
 * calm "no file selected yet" placeholder, NOT "the tree is showing".
 */

import type { FsReadResult } from '../../shared/ipc'

/**
 * The middle viewer column's state.
 *  - `null`        — no file selected yet (calm "Select a file" placeholder; §4 empty state),
 *  - `loading`     — `fs:read` outstanding (the header is shown immediately on click),
 *  - `text`/`image`— the previewable content (existing paths),
 *  - `pdf`/`docx`/`sheet` — a rendered DOCUMENT (file-viewer-multiformat-v1 FR-001/002/003);
 *    the per-format renderer fetches the bytes from `cosmos-file://` (no bytes in this state),
 *  - `binary`      — calm "preview not available" block (NOT a red error),
 *  - `unsupported` — calm "No preview available" — no registered viewer (FR-006); shares the
 *    binary copy (a sniffed-binary / unknown-format file). Kept distinct for routing clarity.
 *  - `render-error`— a registered renderer threw on a corrupt/malformed file of its own type
 *    (FR-008) — the calm "Couldn't open this file" block; never a crash / sibling-tab bleed.
 *    Set by the renderer COMPONENT (try/catch / error boundary), not by `resolveRead`.
 *  - `too-large`   — a document over its per-format cap (FR-012) — calm "File too large to
 *    preview" block; the bytes are NOT loaded.
 *  - `denied`      — calm "no permission" block (NOT a red error),
 *  - `not-found`   — "file no longer available" (deleted while open, FR-017).
 */
export type ViewerState =
  | { kind: 'loading'; relPath: string; name: string }
  | { kind: 'text'; relPath: string; name: string; text: string }
  | { kind: 'image'; relPath: string; name: string }
  | { kind: 'pdf'; relPath: string; name: string }
  | { kind: 'docx'; relPath: string; name: string }
  | { kind: 'sheet'; relPath: string; name: string }
  | { kind: 'binary'; relPath: string; name: string }
  | { kind: 'unsupported'; relPath: string; name: string }
  | { kind: 'render-error'; relPath: string; name: string }
  | { kind: 'too-large'; relPath: string; name: string }
  | { kind: 'denied'; relPath: string; name: string }
  | { kind: 'not-found'; relPath: string; name: string }
  | null

/** The basename of a root-relative path (`a/b/c.ts` → `c.ts`; `''` → `''`). */
export function baseName(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i < 0 ? relPath : relPath.slice(i + 1)
}

/** The relPath of the open file, or `null` when the placeholder is showing. */
export function openRelPath(viewer: ViewerState): string | null {
  return viewer ? viewer.relPath : null
}

/**
 * The state for clicking a file row: a `loading` viewer for that file. Opening a file when none
 * is selected, OR retargeting from another open file, are the SAME transition — there is no
 * tree↔viewer toggle, only "the middle column now targets this file".
 */
export function selectFile(relPath: string): NonNullable<ViewerState> {
  return { kind: 'loading', relPath, name: baseName(relPath) }
}

/**
 * The viewer state once `fs:read` resolves for `relPath`. Maps a successful read to its
 * content/marker state — `text` carries the body; `image`/`pdf`/`docx`/`sheet` are MARKERS
 * (the per-format renderer fetches the bytes from `cosmos-file://`, FR-007). Benign failures
 * map to their calm blocks: `binary` → "preview not available", `too-large` → "File too large
 * to preview" (FR-012), `denied` → "no permission". Out-of-root / not-found / unknown reasons
 * fall through to `not-found` (the calm "no longer available" block, FR-017).
 *
 * NOTE: `render-error` is NOT produced here — a corrupt-but-readable document reads OK (its
 * marker) and the renderer COMPONENT flips to `render-error` when parsing throws (FR-008).
 */
export function resolveRead(relPath: string, res: FsReadResult): NonNullable<ViewerState> {
  const name = baseName(relPath)
  if (res.ok) {
    switch (res.kind) {
      case 'text':
        return { kind: 'text', relPath, name, text: res.text }
      case 'image':
        return { kind: 'image', relPath, name }
      case 'pdf':
        return { kind: 'pdf', relPath, name }
      case 'docx':
        return { kind: 'docx', relPath, name }
      case 'sheet':
        return { kind: 'sheet', relPath, name }
    }
  }
  if (res.reason === 'denied') {
    return { kind: 'denied', relPath, name }
  }
  if (res.reason === 'binary') {
    return { kind: 'unsupported', relPath, name }
  }
  if (res.reason === 'too-large') {
    return { kind: 'too-large', relPath, name }
  }
  return { kind: 'not-found', relPath, name }
}

/** The state for a renderer that threw on a corrupt/malformed file of its own type (FR-008):
 * the calm "Couldn't open this file" block. Set by the per-format renderer component's
 * try/catch / error boundary, never by `resolveRead`. Pure. */
export function renderError(relPath: string): NonNullable<ViewerState> {
  return { kind: 'render-error', relPath, name: baseName(relPath) }
}

/** The state for a file that vanished while open (watch re-read, FR-017): the calm not-found block. */
export function invalidateOpen(relPath: string): NonNullable<ViewerState> {
  return { kind: 'not-found', relPath, name: baseName(relPath) }
}
