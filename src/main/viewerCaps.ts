/**
 * viewerCaps — PURE per-format size caps for the multi-format document viewer
 * (file-viewer-multiformat-v1, FR-012). No Electron/React import (the `.ts`/`.test.ts` split)
 * so the cap decision is node-unit-testable.
 *
 * Only the parse-into-memory DOCUMENT formats (pdf / docx / sheet) carry a cap — a file over
 * its ceiling shows the calm "File too large to preview" block instead of loading. `text` and
 * `image` deliberately keep NO cap (the existing terminal-file-explorer stance, FR-012), so
 * they never appear here. The caller (main `fsExplorer.read`) learns the size from `statSync`
 * BEFORE reading the bytes — the whole document is never loaded just to refuse it.
 *
 * ponytail defaults (OQ-2 resolved): PDF 50 MB, DOCX 25 MB, XLSX/sheet 15 MB — generous for a
 * disk-loaded desktop app yet a guard against an accidental multi-hundred-MB parse hang.
 */

import type { ViewerKind } from './viewerKind'

/** Byte cap per DOCUMENT viewer kind (FR-012). Only the parse-into-memory kinds are capped. */
const VIEWER_SIZE_CAPS: Partial<Record<ViewerKind, number>> = {
  pdf: 50 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  sheet: 15 * 1024 * 1024
}

/** The byte cap for a viewer kind, or `null` when that kind is uncapped (text/image/unsupported). */
export function capForViewerKind(kind: ViewerKind): number | null {
  return VIEWER_SIZE_CAPS[kind] ?? null
}

/**
 * True iff a file of `kind` at `sizeBytes` exceeds its per-format cap (FR-012) → the renderer
 * shows "File too large to preview". Uncapped kinds (text/image/unsupported) are NEVER too
 * large. A non-finite/negative size is treated as NOT too large (the read proceeds and fails
 * benignly downstream rather than refusing a file we could not measure). Pure; never throws.
 */
export function isTooLarge(kind: ViewerKind, sizeBytes: number): boolean {
  const cap = capForViewerKind(kind)
  if (cap === null) {
    return false
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return false
  }
  return sizeBytes > cap
}
