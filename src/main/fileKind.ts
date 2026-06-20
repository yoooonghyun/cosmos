/**
 * fileKind — PURE classification of a file's previewability for the read-only viewer
 * (terminal-file-explorer-v1, FR-009/FR-010/FR-011). No Electron, no React import (the
 * `.ts`/`.test.ts` split) — node-unit-testable in isolation.
 *
 * There is NO file-content size cap (FR-012, OQ-3 resolved): a file is classified by its
 * EXTENSION (image) and, for non-images, by a binary-vs-text sniff of its bytes — never
 * by size. A huge text or image file is still `text`/`image`, never refused for size.
 *
 * - A supported image extension → `image` (the renderer loads the `cosmos-file://` URL).
 * - Otherwise, sniff the bytes: a NUL byte (or invalid UTF-8) → `binary`
 *   ("preview not available"); else `text` (rendered read-only in Monaco).
 */

/** The image extensions the viewer renders as an image (FR-010). Lower-case, no dot. */
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico'
])

/** How a file is classified for the viewer. `image` → `cosmos-file://`; `text` → Monaco;
 * `binary` → "preview not available" (FR-011). */
export type FileKind = 'image' | 'text' | 'binary'

/**
 * Lower-case extension (no dot) of a path/name, or `''` when there is none. A leading-dot
 * dotfile (`.gitignore`) has NO extension (returns `''`), matching shell/editor behavior.
 * Pure.
 */
export function extensionOf(name: unknown): string {
  if (typeof name !== 'string') {
    return ''
  }
  // Basename only — a directory component must not be mistaken for an extension.
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    // No dot, or a leading-dot dotfile (`.env`) — no extension.
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

/** True iff `name`'s extension is a supported image type (FR-010). Pure. */
export function isImageExtension(name: unknown): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name))
}

/**
 * Sniff raw bytes as text-vs-binary (FR-011). Returns `true` for plausibly-UTF-8 text,
 * `false` for binary. Heuristic, mirroring common editors: a NUL byte (`0x00`) anywhere
 * is a strong binary signal; otherwise validate the bytes decode as UTF-8 (an invalid
 * sequence → binary). An empty buffer is text (an empty file previews as empty text).
 * Pure; never throws.
 *
 * NO size cap (FR-012): the caller may pass the whole file, or a prefix slice for the
 * sniff — this function does not bound the input.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array)) {
    return false
  }
  if (bytes.length === 0) {
    return true
  }
  // A NUL byte never appears in UTF-8 text (it would be the C string terminator); its
  // presence is the classic binary tell.
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x00) {
      return false
    }
  }
  // Strict UTF-8 validation: `fatal` throws on any malformed sequence → binary.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Classify a file for the viewer (FR-009/FR-010/FR-011): a supported image EXTENSION →
 * `image` (regardless of bytes — the `cosmos-file://` stream + the `<img>` handle it);
 * otherwise sniff the bytes → `text` or `binary`. NO size cap (FR-012). Pure.
 *
 * @param name  the file name (for the extension check).
 * @param bytes the file's bytes (or a leading slice) for the text-vs-binary sniff; only
 *              consulted when the extension is not a supported image.
 */
export function classifyFile(name: string, bytes: Uint8Array): FileKind {
  if (isImageExtension(name)) {
    return 'image'
  }
  return looksLikeText(bytes) ? 'text' : 'binary'
}
