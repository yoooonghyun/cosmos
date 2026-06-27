/**
 * PdfView — the read-only PDF renderer for the multi-format file viewer (file-viewer-
 * multiformat-v1, FR-001). Renders every page of the document in a continuous, vertically
 * scrollable column via `react-pdf` (pdf.js under the hood), fetching the bytes itself over
 * the confined `cosmos-file://` URL (FR-007 — pdf.js fetches the `file` URL internally; the
 * CSP `connect-src cosmos-file:` permits it). Fully LOCAL: no network, no cloud viewer (FR-010).
 *
 * Errors are contained (FR-008): a corrupt/malformed PDF triggers `onLoadError` → the parent's
 * `onRenderError` flips THIS tab to the calm "Couldn't open this file" block, never a crash or
 * a sibling-tab bleed.
 *
 * Worker (FR-013, the classic pdf.js gotcha): `pdf.worker.min.mjs` is wired ONCE here via the
 * Vite-native `new URL(..., import.meta.url)` asset pattern (emits a hashed same-origin asset
 * for BOTH `npm run dev` and the packaged build — like Monaco's `?worker`, so NO
 * electron.vite.config rollup `input` is needed). The two react-pdf CSS files are imported or
 * the text/annotation layers render unstyled.
 */

import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { fetchLocalFileBytes } from './fetchLocalFileBytes'
// Vite resolves bare package specifiers with `?url` to a hashed same-origin asset URL in BOTH
// dev and packaged builds. The `new URL('pdfjs-dist/...', import.meta.url)` pattern does NOT
// work for bare specifiers in Vite — Vite only rewrites relative paths inside `new URL()`.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Wire the pdf.js worker ONCE at module load (idempotent — assigning the same URL twice is
// harmless). The `?url` import is resolved by Vite to a hashed bundled asset URL.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export function PdfView({
  paneId,
  relPath,
  onRenderError
}: {
  paneId: string
  relPath: string
  /** Report a parse/load failure so the parent flips this tab to the calm `render-error`
   * block (FR-008). Called once per failed document. */
  onRenderError: (relPath: string) => void
}): React.JSX.Element {
  const [numPages, setNumPages] = useState(0)
  // Measure the scroll container so each page renders at the column width (responsive, no
  // horizontal scrollbar). `null` until measured → pages render at their intrinsic size first.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      // Subtract a little so the page never touches the scrollbar edge; clamp to a sane min.
      if (typeof w === 'number' && w > 0) {
        setWidth(Math.max(120, Math.floor(w - 16)))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // react-pdf must NOT fetch the cosmos-file:// URL itself: pdf.js loads it via XMLHttpRequest,
  // which Chromium CORS-blocks for non-standard schemes ("cross origin requests are only
  // supported for chrome/http/https/data" → ResponseException, blank PDF). So fetch the bytes
  // ourselves over the privileged fetch() (the SAME path docx/xlsx use) and hand pdf.js an
  // in-memory { data } source — no cross-scheme XHR. The state object is stable until the file
  // changes, so Document loads it once.
  const [pdfFile, setPdfFile] = useState<{ data: Uint8Array } | null>(null)
  // Read onRenderError through a ref so a fresh closure from the parent never re-triggers the fetch.
  const onRenderErrorRef = useRef(onRenderError)
  onRenderErrorRef.current = onRenderError
  useEffect(() => {
    let cancelled = false
    setPdfFile(null)
    void fetchLocalFileBytes(paneId, relPath).then(
      (buf) => {
        if (!cancelled) setPdfFile({ data: new Uint8Array(buf) })
      },
      () => {
        if (!cancelled) onRenderErrorRef.current(relPath)
      }
    )
    return () => {
      cancelled = true
    }
  }, [paneId, relPath])

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-auto bg-popover p-4"
      data-testid="pdf-view"
    >
      {pdfFile ? (
        <Document
          file={pdfFile}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={() => onRenderError(relPath)}
          loading={<div className="h-full min-h-0 w-full" aria-busy="true" />}
          error={<></>}
          className="flex flex-col items-center gap-4"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={`page-${i + 1}`}
              pageNumber={i + 1}
              width={width ?? undefined}
              className="shadow-md"
              renderAnnotationLayer
              renderTextLayer
            />
          ))}
        </Document>
      ) : (
        <div className="h-full min-h-0 w-full" aria-busy="true" />
      )}
    </div>
  )
}
