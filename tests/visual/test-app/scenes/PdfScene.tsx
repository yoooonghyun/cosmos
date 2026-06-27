/**
 * PdfScene — mounts a stripped-down PDF viewer with a fixture PDF so Playwright
 * can assert a page canvas appears with non-zero size.
 *
 * PdfView.tsx normally receives a cosmos-file:// URL built by buildLocalFileSrc.
 * In the test harness the Vite dev server serves the fixture file at a plain
 * http:// URL, so we bypass PdfView entirely and render the react-pdf Document
 * + Page directly — same underlying stack, but with a URL the browser can fetch
 * without the Electron custom protocol.
 *
 * The pdf.js worker is wired identically to PdfView.tsx via the same
 * `pdfjs-dist/build/pdf.worker.min.mjs?url` Vite import pattern.
 */

import React, { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
// Same worker wiring as PdfView.tsx — Vite resolves this to a hashed asset URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// The fixture PDF is served by the Vite dev server at this path.
// Vite serves files from the project root, so /tests/visual/fixtures/sample.pdf is reachable.
const FIXTURE_PDF_URL = '/tests/visual/fixtures/sample.pdf'

export function PdfScene() {
  const [numPages, setNumPages] = useState(0)
  const [error, setError] = useState<string | null>(null)

  return (
    <div
      data-testid="pdf-container"
      style={{ width: 600, height: 800, overflow: 'auto', background: '#1e1e1e', padding: 16 }}
    >
      {error && (
        <div data-testid="pdf-error" style={{ color: 'red' }}>
          {error}
        </div>
      )}
      <Document
        file={FIXTURE_PDF_URL}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(e) => setError(String(e))}
        loading={
          <div data-testid="pdf-loading" aria-busy="true">
            Loading…
          </div>
        }
        error={<div data-testid="pdf-load-error">Failed to load PDF</div>}
        className="flex flex-col items-center gap-4"
      >
        {numPages > 0 &&
          Array.from({ length: numPages }, (_, i) => (
            <Page
              key={`page-${i + 1}`}
              pageNumber={i + 1}
              width={560}
              data-testid={`pdf-page-${i + 1}`}
              renderAnnotationLayer
              renderTextLayer
            />
          ))}
      </Document>
      {/* Signal that the document loaded (numPages set) so Playwright can wait for it */}
      {/* Sentinel: visible 0-height element (not display:none) so Playwright waitForSelector works) */}
      {numPages > 0 && (
        <div data-testid="pdf-loaded" data-pages={numPages} style={{ height: 0, overflow: 'hidden' }} />
      )}
    </div>
  )
}
