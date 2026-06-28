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
  FileWarning,
  FileX2,
  HardDrive,
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
import { PdfView } from './PdfView'
import { DocxView } from './DocxView'
import { SheetView } from './SheetView'
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
function MonacoText({
  relPath,
  text,
  onViewerFocusChange
}: {
  relPath: string
  text: string
  /**
   * Report viewer focus (terminal-tab-nav-monaco-focus-v1, bug #…): Monaco mounts its hidden
   * keyboard-input <textarea> on `document.body` (no `overflowWidgetsDomNode` is set), OUTSIDE this
   * FileViewer subtree, so the editor's focus does NOT bubble to the outer div's `onFocus`. We must
   * therefore drive viewer-focus from Monaco's OWN `onDidFocusEditorText`/`onDidBlurEditorText`
   * rather than DOM `focusin`, or `Cmd+Option+Arrow` mis-routes to the terminal tabs.
   */
  onViewerFocusChange?: (focused: boolean) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  // Keep the latest callback in a ref so the once-on-mount effect's focus listeners always call the
  // current reporter without re-creating the editor when the parent re-renders.
  const focusReporter = useRef(onViewerFocusChange)
  focusReporter.current = onViewerFocusChange

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
    // Route Monaco's own text-input focus/blur to the viewer-focus reporter (see prop docs above):
    // its keyboard <textarea> lives on document.body, so DOM focusin never reaches the FileViewer
    // div. These listeners are the ONLY reliable signal that the editor holds focus.
    const focusSub = ed.onDidFocusEditorText(() => focusReporter.current?.(true))
    const blurSub = ed.onDidBlurEditorText(() => focusReporter.current?.(false))
    return () => {
      focusSub.dispose()
      blurSub.dispose()
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
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto scrollbar-hover-only bg-popover p-4">
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
  viewer,
  onRenderError,
  onViewerFocusChange
}: {
  paneId: string
  viewer: NonNullable<ViewerState>
  /** Flip this tab to the calm `render-error` block when a document renderer threw (FR-008). */
  onRenderError: (relPath: string) => void
  /** Report viewer focus from Monaco's own focus events (see `MonacoText`). */
  onViewerFocusChange?: (focused: boolean) => void
}): React.JSX.Element {
  switch (viewer.kind) {
    case 'loading':
      // The calm dark surface IS the resting state — no spinner over it (design §4.3).
      return <div className="min-h-0 flex-1 bg-card" aria-busy="true" />
    case 'text':
      return (
        <MonacoText
          relPath={viewer.relPath}
          text={viewer.text}
          onViewerFocusChange={onViewerFocusChange}
        />
      )
    case 'image':
      return <ImageView paneId={paneId} relPath={viewer.relPath} />
    case 'pdf':
      return <PdfView paneId={paneId} relPath={viewer.relPath} onRenderError={onRenderError} />
    case 'docx':
      return <DocxView paneId={paneId} relPath={viewer.relPath} onRenderError={onRenderError} />
    case 'sheet':
      return <SheetView paneId={paneId} relPath={viewer.relPath} onRenderError={onRenderError} />
    case 'binary':
    case 'unsupported':
      // FR-006: a sniffed-binary / no-registered-viewer file → the calm "No preview available".
      return (
        <StateBlock
          glyph={FileQuestion}
          title="No preview available"
          reason="Can’t preview this file type."
        />
      )
    case 'render-error':
      // FR-008: a registered renderer threw on a corrupt/malformed file of its own type.
      return (
        <StateBlock
          glyph={FileWarning}
          title="Couldn’t open this file"
          reason="The file may be corrupt or in an unsupported variant."
        />
      )
    case 'too-large':
      // FR-012: a document over its per-format size cap — not loaded.
      return (
        <StateBlock
          glyph={HardDrive}
          title="File too large to preview"
          reason={`${viewer.name} exceeds the preview size limit.`}
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
  onClose,
  onRenderError,
  onViewerFocusChange
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
  /** Flip a document tab to the calm `render-error` block when its renderer threw on a corrupt
   * file (file-viewer-multiformat-v1, FR-008). */
  onRenderError: (relPath: string) => void
  /**
   * Report focus-within of the viewer region (terminal-focus-aware-close-tab-v1, OQ-1). `true` when
   * focus enters the viewer subtree (the tab strip OR the body), `false` when it leaves — so the
   * Terminal panel can route `Ctrl/Cmd+W` to the active file tab while this viewer is focused.
   */
  onViewerFocusChange?: (focused: boolean) => void
}): React.JSX.Element {
  // FR-006/FR-007: track focus-within on the SHARED outer container so it covers BOTH the populated
  // (tab strip + body) and the empty "Select a file" branches. `onFocus`/`onBlur` bubble as
  // focusin/focusout; `relatedTarget` staying inside this node means focus only moved WITHIN the
  // viewer (e.g. tab → body), so we don't flap the boolean. `outline-none` keeps the wrapper itself
  // from drawing a focus ring; `tabIndex={-1}` lets the empty placeholder receive focus on click.
  const handleFocus = (): void => onViewerFocusChange?.(true)
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    onViewerFocusChange?.(false)
  }

  if (openFiles.length === 0 || viewer === null) {
    // §5.1 empty state: a calm, low-emphasis placeholder, FULL column height (no strip). The tree
    // dock (RIGHT) is already visible, so this is purely "you haven't picked a file yet".
    return (
      <div
        tabIndex={-1}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-card px-4 text-center text-muted-foreground outline-none select-none"
      >
        <MousePointerClick className="size-6 text-muted-foreground/70" aria-hidden="true" />
        <p className="text-xs">Select a file to preview it here.</p>
      </div>
    )
  }
  // ≥1 file open: the FileTabStrip REPLACES the #84 single-file header (design §4 — the header folds
  // into the active tab; one `h-8` band). The body renders the ACTIVE file's ViewerState unchanged.
  return (
    <div
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card outline-none"
    >
      <FileTabStrip
        tabs={openFiles}
        activeRelPath={activeRelPath}
        onActivate={onActivate}
        onClose={onClose}
        ariaLabel="Open files"
      />
      <ViewerBody
        paneId={paneId}
        viewer={viewer}
        onRenderError={onRenderError}
        onViewerFocusChange={onViewerFocusChange}
      />
    </div>
  )
}
