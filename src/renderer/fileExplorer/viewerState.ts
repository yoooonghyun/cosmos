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
 *  - `text`/`image`— the previewable content,
 *  - `binary`      — calm "preview not available" block (NOT a red error),
 *  - `denied`      — calm "no permission" block (NOT a red error),
 *  - `not-found`   — "file no longer available" (deleted while open, FR-017).
 */
export type ViewerState =
  | { kind: 'loading'; relPath: string; name: string }
  | { kind: 'text'; relPath: string; name: string; text: string }
  | { kind: 'image'; relPath: string; name: string }
  | { kind: 'binary'; relPath: string; name: string }
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
 * The viewer state once `fs:read` resolves for `relPath`. Maps a successful read to text/image and
 * the benign failures to their calm blocks (binary/denied/not-found). Out-of-root/unknown reasons
 * fall through to `not-found` (the calm "no longer available" block, FR-017).
 */
export function resolveRead(relPath: string, res: FsReadResult): NonNullable<ViewerState> {
  const name = baseName(relPath)
  if (res.ok) {
    return res.kind === 'text'
      ? { kind: 'text', relPath, name, text: res.text }
      : { kind: 'image', relPath, name }
  }
  if (res.reason === 'denied') {
    return { kind: 'denied', relPath, name }
  }
  if (res.reason === 'binary') {
    return { kind: 'binary', relPath, name }
  }
  return { kind: 'not-found', relPath, name }
}

/** The state for a file that vanished while open (watch re-read, FR-017): the calm not-found block. */
export function invalidateOpen(relPath: string): NonNullable<ViewerState> {
  return { kind: 'not-found', relPath, name: baseName(relPath) }
}
