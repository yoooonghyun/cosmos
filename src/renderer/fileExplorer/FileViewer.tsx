/**
 * FileViewer — the read-only file viewer that fills the MIDDLE column of one terminal tab
 * (terminal-file-explorer-v1 3-pane rework, FR-008..FR-011/FR-017, design §4). A header (name) is
 * shown the instant a file is clicked; the body is one of: read-only Monaco (text), an
 * `<img>` via the `cosmos-file://` opaque src (image), or a calm centered block
 * (not-previewable / denied / not-found / image-broken). NEVER raw bytes, NEVER a red Notice
 * for a benign denied/not-found — those are calm blocks (design §4.3).
 *
 * The viewer NO LONGER replaces the tree (the tree dock is always visible on the RIGHT) — so there
 * is no "back to tree" affordance. When no file is selected (`viewer === null`) it shows a calm
 * "Select a file" placeholder. Clicking another row simply retargets this column. The terminal
 * (left) stays mounted + live throughout — opening/retargeting a file never touches it (FR-013).
 */

import { useEffect, useRef, useState } from 'react'
import {
  File,
  FileQuestion,
  FileX2,
  ImageOff,
  Lock,
  MousePointerClick
} from 'lucide-react'
import type { editor } from 'monaco-editor'
import { monacoLanguageOf } from './fileGlyph'
import { FileTabStrip, type FileTab } from './FileTabStrip'
import { buildLocalFileSrc } from './localFileSrc'
import { setupMonaco } from './monacoSetup'
import { buildViewerEditorOptions, COSMOS_MONACO_THEME } from './monacoTheme'
import type { ViewerState } from './viewerState'

/** A calm centered state block (design §4.3) — glyph + title + reason. One shared layout. */
function StateBlock({
  glyph: Glyph,
  title,
  reason,
  action
}: {
  glyph: typeof File
  title: string
  reason?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
      <Glyph className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm">{title}</p>
      {reason ? <p className="text-xs">{reason}</p> : null}
      {action}
    </div>
  )
}

/** Read-only Monaco editor mounting the file text (design §4.2). Themed to cosmos-dark. */
function MonacoText({ relPath, text }: { relPath: string; text: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  // Create the editor ONCE on mount; subsequent text/lang changes update the model in place.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const monaco = setupMonaco()
    const ed = monaco.editor.create(container, {
      value: text,
      theme: COSMOS_MONACO_THEME,
      // file-viewer-color-wrap-v1 (#94): the editor options (incl. `wordWrap: 'on'` for soft
      // word-wrap so long lines wrap to the viewport instead of forcing a horizontal scrollbar)
      // come from the PURE, node-tested `buildViewerEditorOptions`. The `h-full min-h-0 w-full`
      // container below adds no overflow-x of its own.
      ...buildViewerEditorOptions(relPath)
    })
    editorRef.current = ed
    return () => {
      ed.dispose()
      editorRef.current = null
    }
    // Mount once; the effect below handles relPath/text changes without re-creating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A different file opened into the SAME viewer instance — swap the model value + language.
  useEffect(() => {
    const ed = editorRef.current
    const monaco = setupMonaco()
    if (!ed) {
      return
    }
    const model = ed.getModel()
    if (model) {
      model.setValue(text)
      monaco.editor.setModelLanguage(model, monacoLanguageOf(relPath))
    }
  }, [relPath, text])

  return <div ref={containerRef} className="h-full min-h-0 w-full" />
}

/** The `<img>` image state with an `onError` → ImageOff fallback (design §4.3). */
function ImageView({ paneId, relPath }: { paneId: string; relPath: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return <StateBlock glyph={ImageOff} title="Image unavailable" />
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-popover p-4">
      <img
        src={buildLocalFileSrc(paneId, relPath)}
        alt={relPath}
        onError={() => setBroken(true)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}

function ViewerBody({
  paneId,
  viewer
}: {
  paneId: string
  viewer: NonNullable<ViewerState>
}): React.JSX.Element {
  switch (viewer.kind) {
    case 'loading':
      // The calm dark surface IS the resting state — no spinner over it (design §4.3).
      return <div className="min-h-0 flex-1 bg-card" aria-busy="true" />
    case 'text':
      return <MonacoText relPath={viewer.relPath} text={viewer.text} />
    case 'image':
      return <ImageView paneId={paneId} relPath={viewer.relPath} />
    case 'binary':
      return (
        <StateBlock
          glyph={FileQuestion}
          title="Preview not available"
          reason="Can’t preview this file type."
        />
      )
    case 'denied':
      return (
        <StateBlock
          glyph={Lock}
          title="Preview not available"
          reason="You don’t have permission to read this file."
        />
      )
    case 'not-found':
      return (
        <StateBlock
          glyph={FileX2}
          title="This file is no longer available"
          reason="It may have been moved or deleted."
        />
      )
    default:
      return <div className="min-h-0 flex-1 bg-card" />
  }
}

export function FileViewer({
  paneId,
  openFiles,
  activeRelPath,
  viewer,
  onActivate,
  onClose
}: {
  paneId: string
  /** The ordered open files (terminal-file-tabs-v1) — empty → the "Select a file" placeholder. */
  openFiles: FileTab[]
  /** The active file's relPath, or `null` when no file is open. */
  activeRelPath: string | null
  /** The ACTIVE file's viewer state, or `null` for the placeholder (FR-008). */
  viewer: ViewerState
  /** Activate a tab (click / Enter / Space). */
  onActivate: (relPath: string) => void
  /** Close a tab (X / Delete/Backspace). */
  onClose: (relPath: string) => void
}): React.JSX.Element {
  if (openFiles.length === 0 || viewer === null) {
    // §5.1 empty state: a calm, low-emphasis placeholder, FULL column height (no strip). The tree
    // dock (RIGHT) is already visible, so this is purely "you haven't picked a file yet".
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-card px-4 text-center text-muted-foreground select-none">
        <MousePointerClick className="size-6 text-muted-foreground/70" aria-hidden="true" />
        <p className="text-xs">Select a file to preview it here.</p>
      </div>
    )
  }
  // ≥1 file open: the FileTabStrip REPLACES the #84 single-file header (design §4 — the header folds
  // into the active tab; one `h-8` band). The body renders the ACTIVE file's ViewerState unchanged.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card outline-none">
      <FileTabStrip
        tabs={openFiles}
        activeRelPath={activeRelPath}
        onActivate={onActivate}
        onClose={onClose}
        ariaLabel="Open files"
      />
      <ViewerBody paneId={paneId} viewer={viewer} />
    </div>
  )
}
