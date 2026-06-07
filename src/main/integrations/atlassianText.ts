/**
 * Plain-text flatteners for Atlassian rich content (Atlassian integration v1).
 *
 * v1 renders no macros, panels, or formatting — it maps the two rich body formats
 * cosmos reads into plain, readable strings for the panel and MCP tool results:
 *
 *   - Jira ADF (Atlassian Document Format): a JSON doc tree. `adfToPlainText`
 *     walks the tree and concatenates every `text` leaf, inserting newlines at
 *     block boundaries (paragraph, heading, list item, etc.) — design Q1.
 *   - Confluence "storage" format: an XHTML-ish string. `storageToPlainText`
 *     strips tags, decodes the handful of common entities, and collapses runs of
 *     blank lines — design Q2.
 *
 * Both are pure, return '' for empty/absent input, and never throw on malformed
 * input (a read must degrade gracefully — SC-010).
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** ADF node types that introduce a block boundary (a newline after their text). */
const ADF_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'codeBlock',
  'rule',
  'panel',
  'tableRow'
])

/**
 * Flatten a Jira ADF document (or any ADF node) to plain text (design Q1).
 * Concatenates `text` leaves; a `hardBreak` becomes a newline; block nodes are
 * separated by newlines. Returns '' for absent/empty/non-ADF input.
 */
export function adfToPlainText(adf: unknown): string {
  if (typeof adf === 'string') {
    // Some payloads already carry a plain string (e.g. a renderedFields fallback).
    return adf.trim()
  }
  if (!isRecord(adf)) {
    return ''
  }
  const out: string[] = []
  walkAdf(adf, out)
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

function walkAdf(node: Record<string, unknown>, out: string[]): void {
  const type = typeof node.type === 'string' ? node.type : ''
  if (type === 'text' && typeof node.text === 'string') {
    out.push(node.text)
    return
  }
  if (type === 'hardBreak') {
    out.push('\n')
    return
  }
  const content = Array.isArray(node.content) ? node.content : []
  for (const child of content) {
    if (isRecord(child)) {
      walkAdf(child, out)
    }
  }
  if (ADF_BLOCK_TYPES.has(type)) {
    out.push('\n')
  }
}

/** The handful of XML/HTML entities worth decoding for readable text. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

/**
 * Flatten a Confluence "storage" (XHTML-ish) body to plain text (design Q2).
 * Inserts newlines for block-level close tags, strips all remaining tags, decodes
 * common entities, and collapses excess blank lines. Returns '' for empty input.
 */
export function storageToPlainText(storage: unknown): string {
  if (typeof storage !== 'string' || storage === '') {
    return ''
  }
  return storage
    // Block boundaries -> newline before stripping tags.
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|br|hr)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Drop every remaining tag.
    .replace(/<[^>]+>/g, '')
    // Decode the common entities.
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? m)
    // Collapse runs of blank lines + trim each line's trailing space.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Wrap a plain-text comment body in the minimal Atlassian Document Format (ADF)
 * doc the Jira Cloud `POST /issue/{key}/comment` endpoint accepts (Jira
 * generative-UI v1, FR-011). One paragraph per line so multi-line comments keep
 * their breaks; an empty body still yields a valid (empty-paragraph) doc — though
 * callers reject empty/whitespace bodies before reaching here (FR-006). Pure; never
 * throws. Returns the ADF object (the inverse of {@link adfToPlainText}).
 */
export function plainTextToAdf(text: string): {
  type: 'doc'
  version: 1
  content: { type: 'paragraph'; content: { type: 'text'; text: string }[] }[]
} {
  const lines = text.split('\n')
  const content = lines.map((line) => ({
    type: 'paragraph' as const,
    // An ADF paragraph with no text leaf renders an empty line.
    content: line.length > 0 ? [{ type: 'text' as const, text: line }] : []
  }))
  return { type: 'doc', version: 1, content }
}

/**
 * Wrap a plain-text body in the Confluence "storage" (XHTML-ish) format the v2
 * `POST /wiki/api/v2/pages` endpoint accepts — one `<p>…</p>` per line so multi-line
 * bodies keep their breaks, with the text HTML-escaped so `<`, `&`, etc. cannot break
 * the markup or inject elements. An empty body yields a single empty paragraph
 * (`<p></p>`) — still valid storage. Pure; never throws. The inverse of
 * {@link storageToPlainText}.
 */
export function plainTextToStorage(text: string): string {
  const lines = typeof text === 'string' && text.length > 0 ? text.split('\n') : ['']
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

/** Escape the five XML/HTML special characters so plain text is safe inside storage XHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
