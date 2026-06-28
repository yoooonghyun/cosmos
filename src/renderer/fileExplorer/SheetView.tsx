/**
 * SheetView — the read-only spreadsheet renderer for the multi-format file viewer (file-viewer-
 * multiformat-v1, FR-003). Fetches the `.xlsx`/`.xls` bytes from the confined `cosmos-file://`
 * stream (FR-007), parses + SANITIZES every sheet to a `<table>` via the pure `sheetHtml`
 * helper, and shows the active sheet as a read-only grid with a sheet selector when the workbook
 * has more than one sheet. Fully LOCAL (FR-010) — ExcelJS parses client-side, no network.
 *
 * Errors are contained (FR-008): a corrupt workbook rejects from `parseWorkbookSheets`; the
 * try/catch reports it so the parent flips THIS tab to the calm "Couldn't open this file" block
 * — never a crash or a sibling-tab bleed. The injected HTML is pre-sanitized in `sheetHtml`
 * (and `script-src 'self'` blocks inline-script execution besides).
 */

import { useEffect, useState } from 'react'
import { fetchLocalFileBytes } from './fetchLocalFileBytes'
import { parseWorkbookSheets, type ParsedSheet } from './sheetHtml'

export function SheetView({
  paneId,
  relPath,
  onRenderError
}: {
  paneId: string
  relPath: string
  /** Report a parse failure so the parent flips this tab to the calm `render-error` block. */
  onRenderError: (relPath: string) => void
}): React.JSX.Element {
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    let cancelled = false
    setSheets(null)
    setActive(0)
    void (async () => {
      try {
        const buf = await fetchLocalFileBytes(paneId, relPath)
        const parsed = await parseWorkbookSheets(buf)
        if (!cancelled) {
          setSheets(parsed)
        }
      } catch {
        if (!cancelled) {
          onRenderError(relPath)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paneId, relPath, onRenderError])

  if (sheets === null) {
    // Calm resting surface while fetching + parsing (consistent with the loading state).
    return <div className="min-h-0 flex-1 bg-card" aria-busy="true" data-testid="sheet-view" />
  }

  const current = sheets[active] ?? sheets[0]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card" data-testid="sheet-view">
      {sheets.length > 1 ? (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex shrink-0 items-center gap-1 overflow-x-auto scrollbar-hover-only border-b border-border bg-muted/40 px-2 py-1"
        >
          {sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={
                i === active
                  ? 'rounded px-2 py-0.5 text-xs bg-background text-foreground'
                  : 'rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto scrollbar-hover-only bg-white p-2 text-black [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-300 [&_th]:px-2 [&_th]:py-1">
        {/* Pre-sanitized in `sheetHtml` (DOMPurify) + `script-src 'self'` blocks inline script. */}
        <div dangerouslySetInnerHTML={{ __html: current ? current.html : '' }} />
      </div>
    </div>
  )
}
