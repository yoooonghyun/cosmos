/**
 * DocxView — the read-only DOCX renderer for the multi-format file viewer (file-viewer-
 * multiformat-v1, FR-002). Fetches the `.docx` bytes from the confined `cosmos-file://` stream
 * (FR-007) and hands them to `docx-preview.renderAsync`, which builds high-fidelity DOM
 * (headings, paragraphs, lists, tables, inline styles) inside a scoped container. Fully LOCAL
 * (FR-010) — `docx-preview` + its `jszip` dep render client-side with no network.
 *
 * Errors are contained (FR-008): a corrupt/legacy/non-OOXML file (a `.doc` never reaches here —
 * it routes to `unsupported`) throws in `renderAsync`; the try/catch reports it so the parent
 * flips THIS tab to the calm "Couldn't open this file" block — never a crash or a sibling bleed.
 */

import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { fetchLocalFileBytes } from './fetchLocalFileBytes'

export function DocxView({
  paneId,
  relPath,
  onRenderError
}: {
  paneId: string
  relPath: string
  /** Report a parse failure so the parent flips this tab to the calm `render-error` block. */
  onRenderError: (relPath: string) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) {
      return
    }
    // Clear any prior render (a tab re-read / file change re-runs this effect).
    container.replaceChildren()
    setLoading(true)
    void (async () => {
      try {
        const buf = await fetchLocalFileBytes(paneId, relPath)
        if (cancelled || !containerRef.current) {
          return
        }
        await renderAsync(buf, containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true
        })
        if (!cancelled) {
          setLoading(false)
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

  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-hover-only bg-popover p-4" data-testid="docx-view">
      {loading ? <div className="h-full min-h-0 w-full" aria-busy="true" /> : null}
      {/* docx-preview injects its DOM here; a white document surface on the dark popover. */}
      <div ref={containerRef} className="mx-auto bg-white text-black [&_*]:max-w-full" />
    </div>
  )
}
