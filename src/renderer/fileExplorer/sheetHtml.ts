/**
 * sheetHtml — the parse + SANITIZE step for the read-only spreadsheet viewer (file-viewer-
 * multiformat-v1, FR-003). Parses an `.xlsx`/`.xls` `ArrayBuffer` with ExcelJS into a list of
 * `{ name, html }` per sheet, where `html` is a sanitized standalone `<table>`. Pulled into a
 * thin `.ts` (no React/JSX) so the parse + sanitize decisions are node-testable under the
 * node-env vitest config (the `.ts`/`.test.ts` split); the `SheetView.tsx` component owns only
 * the React chrome (sheet selector + injection).
 *
 * Why ExcelJS (was `xlsx`/SheetJS): the npm `xlsx` package carries prototype-pollution / ReDoS
 * advisories and only publishes an old 0.18.5 build to npm. ExcelJS (MIT, actively maintained)
 * reads `.xlsx` in the browser via `workbook.xlsx.load(ArrayBuffer)`. Unlike SheetJS there is no
 * `sheet_to_html`, so we build the `<table>` OURSELVES from the cell grid — every cell value is
 * read as `cell.text` (a plain string) and HTML-ESCAPED before it enters the markup, so no raw
 * cell value can smuggle live markup. The assembled HTML is STILL run through DOMPurify (the same
 * gate the Confluence path uses) as a defensive second layer BEFORE the component injects it via
 * `dangerouslySetInnerHTML`. The renderer `script-src 'self'` already blocks inline-script
 * execution. Fully LOCAL (FR-010) — ExcelJS parses client-side, no network.
 *
 * `workbook.xlsx.load` is ASYNC, so `parseWorkbookSheets` returns a `Promise`; `SheetView`
 * already awaits it inside an async effect.
 */

import ExcelJS from 'exceljs'
import DOMPurify, { type WindowLike } from 'dompurify'

/** One parsed sheet: its tab name + its sanitized standalone `<table>` HTML. */
export interface ParsedSheet {
  name: string
  html: string
}

/**
 * DOMPurify allow-list for the table we BUILD: only the benign table structure + the
 * layout attributes we emit (colspan/rowspan for merged cells). No scripts, no event handlers,
 * no foreign tags — DOMPurify's defaults strip those regardless; this pins the output to a
 * read-only grid.
 */
const SHEET_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'br', 'b', 'i'],
  ALLOWED_ATTR: ['colspan', 'rowspan']
}

function purifierFor(win?: WindowLike): ReturnType<typeof DOMPurify> {
  const root = win ?? (typeof window !== 'undefined' ? (window as unknown as WindowLike) : undefined)
  return root ? DOMPurify(root) : DOMPurify
}

/** HTML-escape a cell's text so a hostile value (e.g. `<script>…`) becomes inert text content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A merged region (1-based, inclusive bounds) parsed from `worksheet.model.merges`. */
interface MergeRegion {
  top: number
  left: number
  bottom: number
  right: number
}

/** Parse ExcelJS merge strings (e.g. `"A1:B2"`) into 1-based numeric regions. Skips unparseable. */
function parseMerges(merges: string[] | undefined): MergeRegion[] {
  if (!Array.isArray(merges)) {
    return []
  }
  const out: MergeRegion[] = []
  for (const m of merges) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m)
    if (!match) {
      continue
    }
    const left = colLetterToNumber(match[1])
    const top = Number(match[2])
    const right = colLetterToNumber(match[3])
    const bottom = Number(match[4])
    out.push({
      top: Math.min(top, bottom),
      left: Math.min(left, right),
      bottom: Math.max(top, bottom),
      right: Math.max(left, right)
    })
  }
  return out
}

/** Convert a spreadsheet column letter (`A`, `Z`, `AA`) to its 1-based index. */
function colLetterToNumber(letters: string): number {
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64)
  }
  return n
}

/** The text of a cell, as a plain string. ExcelJS `cell.text` flattens rich-text/formula/date. */
function cellText(cell: ExcelJS.Cell): string {
  const t = cell.text
  return typeof t === 'string' ? t : t == null ? '' : String(t)
}

/**
 * Render a single worksheet's cell grid to a standalone `<table>` HTML string. Cell text is
 * HTML-escaped; merged regions emit `colspan`/`rowspan` on the top-left cell and skip the cells
 * they cover. The result is sanitized by the caller.
 */
function worksheetToTableHtml(ws: ExcelJS.Worksheet): string {
  const merges = parseMerges(ws.model?.merges)
  const rowCount = ws.rowCount ?? 0
  const colCount = ws.columnCount ?? 0

  // Cells that are covered by (but are not the master of) a merge — skip emitting a <td> for them.
  const covered = new Set<string>()
  const masterSpan = new Map<string, { colspan: number; rowspan: number }>()
  for (const r of merges) {
    masterSpan.set(`${r.top}:${r.left}`, {
      colspan: r.right - r.left + 1,
      rowspan: r.bottom - r.top + 1
    })
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) {
        if (row === r.top && col === r.left) {
          continue
        }
        covered.add(`${row}:${col}`)
      }
    }
  }

  const rows: string[] = []
  for (let row = 1; row <= rowCount; row++) {
    const cells: string[] = []
    for (let col = 1; col <= colCount; col++) {
      const key = `${row}:${col}`
      if (covered.has(key)) {
        continue
      }
      const cell = ws.getCell(row, col)
      const span = masterSpan.get(key)
      const attrs: string[] = []
      if (span && span.colspan > 1) {
        attrs.push(`colspan="${span.colspan}"`)
      }
      if (span && span.rowspan > 1) {
        attrs.push(`rowspan="${span.rowspan}"`)
      }
      const open = attrs.length ? `<td ${attrs.join(' ')}>` : '<td>'
      cells.push(`${open}${escapeHtml(cellText(cell))}</td>`)
    }
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table><tbody>${rows.join('')}</tbody></table>`
}

/**
 * Parse an `.xlsx`/`.xls` workbook `ArrayBuffer` into its sheets, each as a SANITIZED standalone
 * `<table>` HTML string (FR-003). Returns one entry per sheet (preserving workbook order) so the
 * component can offer a sheet selector. A CORRUPT/undecodable workbook REJECTS from
 * `workbook.xlsx.load` (the caller's try/catch flips the tab to the calm `render-error` block,
 * FR-008).
 *
 * @param buf  the workbook bytes.
 * @param win  optional DOM window (jsdom in node tests); defaults to the renderer's `window`.
 */
export async function parseWorkbookSheets(
  buf: ArrayBuffer,
  win?: WindowLike
): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const purify = purifierFor(win)
  return wb.worksheets.map((ws) => {
    const rawHtml = worksheetToTableHtml(ws)
    return { name: ws.name, html: purify.sanitize(rawHtml, SHEET_SANITIZE_CONFIG) }
  })
}
