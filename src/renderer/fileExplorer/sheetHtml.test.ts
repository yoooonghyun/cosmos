import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import ExcelJS from 'exceljs'
import { parseWorkbookSheets, type ParsedSheet } from './sheetHtml'

/*
 * sheetHtml — the parse + SANITIZE step for the read-only spreadsheet viewer (file-viewer-
 * multiformat-v1, FR-003, SC-003). Node-env test: DOMPurify needs a DOM `window`, so we pass a
 * jsdom window (the SAME helper the renderer calls with the global `window`). A real workbook is
 * built in-memory with ExcelJS, written to an array buffer, then parsed back — proving the
 * round-trip + that each sheet becomes a sanitized `<table>`. `parseWorkbookSheets` is async
 * (ExcelJS `workbook.xlsx.load` is async), so every assertion awaits it.
 */

const { window } = new JSDOM('')
const win = window as unknown as Parameters<typeof parseWorkbookSheets>[1]

/** Build a workbook as an ArrayBuffer from rows-per-sheet, for the parse round-trip. */
async function makeWorkbookBuffer(
  sheets: { name: string; rows: (string | number)[][] }[]
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    for (const row of s.rows) {
      ws.addRow(row)
    }
  }
  // ExcelJS writes to a Node Buffer; return its underlying ArrayBuffer slice for `xlsx.load`.
  const out = await wb.xlsx.writeBuffer()
  const u8 = new Uint8Array(out as ArrayBuffer)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
}

/** Build a 2-sheet workbook (Alpha, Beta) as an ArrayBuffer for the parse round-trip. */
function makeWorkbook(): Promise<ArrayBuffer> {
  return makeWorkbookBuffer([
    { name: 'Alpha', rows: [['Name', 'Qty'], ['Widget', 7]] },
    { name: 'Beta', rows: [['x', 'y'], [1, 2]] }
  ])
}

describe('parseWorkbookSheets — happy path (FR-003)', () => {
  let sheets: ParsedSheet[]
  it('returns one entry per sheet, in workbook order, each a <table>', async () => {
    sheets = await parseWorkbookSheets(await makeWorkbook(), win)
    expect(sheets.map((s) => s.name)).toEqual(['Alpha', 'Beta'])
    for (const s of sheets) {
      expect(s.html).toMatch(/<table/i)
    }
  })
  it('preserves the cell values in the rendered table', async () => {
    sheets = await parseWorkbookSheets(await makeWorkbook(), win)
    expect(sheets[0].html).toContain('Widget')
    expect(sheets[0].html).toContain('7')
    expect(sheets[1].html).toContain('1')
  })
})

describe('parseWorkbookSheets — multi-sheet & empty sheet', () => {
  it('emits a table for an empty sheet without throwing', async () => {
    const buf = await makeWorkbookBuffer([
      { name: 'Full', rows: [['a', 'b']] },
      { name: 'Empty', rows: [] }
    ])
    const sheets = await parseWorkbookSheets(buf, win)
    expect(sheets.map((s) => s.name)).toEqual(['Full', 'Empty'])
    // The empty sheet still renders a (possibly empty) <table>, never undefined.
    expect(sheets[1].html).toMatch(/<table/i)
  })
})

describe('parseWorkbookSheets — sanitization (SC-003, plan "sheet content is untrusted")', () => {
  it('strips a <script> smuggled into a cell value (no executable XSS)', async () => {
    // A hostile cell whose value is a script tag. We read the cell as plain TEXT and HTML-escape
    // it when building the table, so the visible text is the inert string and no LIVE <script>
    // element survives; DOMPurify is a second defensive gate.
    const buf = await makeWorkbookBuffer([
      { name: 'Evil', rows: [['<script>alert(1)</script>']] }
    ])
    const [sheet] = await parseWorkbookSheets(buf, win)
    // No live <script> element.
    expect(sheet.html).not.toMatch(/<script/i)
    // Inject the sanitized HTML into a real DOM and assert NO <script> node exists.
    const probe = window.document.createElement('div')
    probe.innerHTML = sheet.html
    expect(probe.querySelectorAll('script').length).toBe(0)
    // The visible cell text is the escaped, inert string (proves it round-tripped as TEXT).
    expect(probe.textContent).toContain('<script>alert(1)</script>')
  })
})

describe('parseWorkbookSheets — corrupt/garbage input (FR-008)', () => {
  it('rejects on a tiny garbage buffer so the component shows the calm render-error block', async () => {
    // ExcelJS rejects on undecodable bytes (it cannot find the zip/xlsx structure). The SheetView
    // try/catch maps that rejection to the FR-008 calm "Couldn't open this file" block. This test
    // pins that `parseWorkbookSheets` rejects (rather than silently returning) so the component's
    // try/catch shape is right.
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer
    await expect(parseWorkbookSheets(garbage, win)).rejects.toBeDefined()
  })
})
