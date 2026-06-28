/**
 * viewerKind — PURE routing of a file to the multi-format viewer's renderer KIND
 * (file-viewer-multiformat-v1, FR-005/FR-011). No Electron, no React, no DOM import (the
 * `.ts`/`.test.ts` split) so the extension→viewer decision is node-unit-testable in
 * isolation. This GENERALIZES `fileKind.classifyFile` (image / text / binary) into the full
 * viewer registry the multi-format viewer routes on.
 *
 * The decision is deterministic and single-sourced (FR-005): a file's EXTENSION picks a
 * registered document renderer (pdf / docx / sheet) or the image set; everything else falls
 * to the existing text-vs-binary byte SNIFF (`looksLikeText`) — text → `text` (Monaco),
 * binary → `unsupported` (the calm "No preview available" block, FR-006). Legacy/binary
 * office formats (`.doc`/`.ppt`/`.pptx`/…) have NO v1 renderer, so they land on `unsupported`
 * via the sniff (FR-016).
 *
 * Bytes never ride here — only the file NAME (for the extension) and a precomputed boolean
 * `sniffText` (the caller runs `looksLikeText` once on the bytes). This keeps the registry
 * pure and lets `fileKind` own the sniff.
 */

import { extensionOf, isImageExtension } from './fileKind'

/**
 * The viewer renderer KIND a file routes to (FR-005). Each maps to one renderer branch in the
 * `FileViewer` body:
 *  - `text`        → read-only Monaco (unchanged path),
 *  - `image`       → `<img>` over `cosmos-file://` (unchanged path),
 *  - `pdf`         → the PDF page viewer (react-pdf / pdf.js),
 *  - `docx`        → the DOCX viewer (docx-preview),
 *  - `sheet`       → the spreadsheet viewer (SheetJS → HTML grid),
 *  - `unsupported` → the calm "No preview available" fallback (FR-006).
 */
export type ViewerKind = 'text' | 'image' | 'pdf' | 'docx' | 'sheet' | 'unsupported'

/**
 * Document extensions with a registered v1 renderer (FR-001/FR-002/FR-003). Lower-case, no
 * dot. `xls` (legacy OOXML-readable by SheetJS) joins `xlsx` on the `sheet` renderer; legacy
 * binary `.doc` is deliberately ABSENT (it takes the `unsupported` fallback, FR-016).
 */
const DOCUMENT_VIEWERS: ReadonlyMap<string, ViewerKind> = new Map([
  ['pdf', 'pdf'],
  ['docx', 'docx'],
  ['xlsx', 'sheet'],
  ['xls', 'sheet']
])

/**
 * Resolve a file to its viewer KIND (FR-005/FR-011). Pure; deterministic; never throws.
 *
 * Order (single deterministic decision per file):
 *   1. a registered DOCUMENT extension (`pdf`/`docx`/`xlsx`/`xls`) → that renderer,
 *   2. a supported IMAGE extension → `image` (the existing `<img>` path),
 *   3. otherwise the precomputed text SNIFF: `true` → `text` (Monaco), `false` →
 *      `unsupported` (the calm "No preview available" block — sniffed binary, no viewer).
 *
 * @param name      the file name / root-relative path (for the extension lookup).
 * @param sniffText the result of `looksLikeText(bytes)` — `true` iff the bytes are
 *                  plausibly UTF-8 text. Consulted ONLY when the extension matches no
 *                  registered viewer (document or image). Defaults to `false` (a missing
 *                  sniff routes an extension-less unknown to `unsupported`, the safe block).
 */
export function resolveViewerKind(name: unknown, sniffText: boolean = false): ViewerKind {
  const doc = DOCUMENT_VIEWERS.get(extensionOf(name))
  if (doc) {
    return doc
  }
  if (isImageExtension(name)) {
    return 'image'
  }
  return sniffText === true ? 'text' : 'unsupported'
}

/** True iff `name`'s extension routes to a registered DOCUMENT renderer (pdf/docx/sheet) —
 * i.e. NOT image, NOT text/sniff. Used by the protocol/marker layer to know a file is a
 * "document" without re-deriving the registry. Pure. */
export function isDocumentExtension(name: unknown): boolean {
  return DOCUMENT_VIEWERS.has(extensionOf(name))
}
