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
import {
  installMonacoModelFactory,
  sharedMonacoModelRegistry,
  type ModelLike
} from './monacoModelRegistry'
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

// cosmos-terminal-favorite-explorer-share-v1 (FR-003): install the Monaco-backed model factory into
// the shared registry once (lazily — the functions call `setupMonaco()` on first use, so importing
// this module never eagerly touches Monaco). The registry owns the canonical `cosmos-file://` KEY
// (Monaco-free); the factory only turns that key into / looks it up as a real `ITextModel`. READ-ONLY
// (OQ-1): the model is shared so two read-only views render one buffer — it is the seam a future
// editability feature would build on, NOT that feature.
installMonacoModelFactory({
  getModel: (uri: string): ModelLike | null => {
    const monaco = setupMonaco()
    return monaco.editor.getModel(monaco.Uri.parse(uri))
  },
  createModel: (text: string, language: string, uri: string): ModelLike => {
    const monaco = setupMonaco()
    return monaco.editor.createModel(text, language, monaco.Uri.parse(uri))
  }
})

/**
 * Read-only Monaco editor VIEW over a file's SHARED `ITextModel` (design §4.2; cosmos-terminal-
 * favorite-explorer-share-v1 FR-003/FR-004/FR-007). The editor attaches (`setModel`) to a per-file
 * model held in the shared {@link sharedMonacoModelRegistry} keyed by `(paneId, relPath)`, so the
 * source viewer and a Home favorite viewer render the SAME buffer (content + language stay identical
 * + live) while cursor/scroll stay per-view (view state lives on the editor, not the model). READ-
 * ONLY: the editor keeps `readOnly`/`domReadOnly` (OQ-1) — the shared model is content-sync only.
 */
function MonacoText({
  paneId,
  relPath,
  text,
  onViewerFocusChange
}: {
  paneId: string
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
  // The (paneId, relPath) this editor currently has a model ATTACHED for — so a file-switch / unmount
  // detaches the RIGHT model from the shared registry's refcount (FR-007). null until first attach.
  const attachedRef = useRef<{ paneId: string; relPath: string } | null>(null)
  // Keep the latest callback in a ref so the once-on-mount effect's focus listeners always call the
  // current reporter without re-creating the editor when the parent re-renders.
  const focusReporter = useRef(onViewerFocusChange)
  focusReporter.current = onViewerFocusChange

  // Create the editor ONCE on mount with NO initial model; the attach effect below sets the SHARED
  // model. Keeps `readOnly`/`domReadOnly` (OQ-1). On unmount, detach the shared model (NEVER dispose
  // it directly — the registry owns disposal via refcount, FR-007) then dispose the editor VIEW.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const monaco = setupMonaco()
    const ed = monaco.editor.create(container, {
      theme: COSMOS_MONACO_THEME,
      // file-viewer-color-wrap-v1 (#94): the editor options (incl. `wordWrap: 'on'` for soft
      // word-wrap so long lines wrap to the viewport instead of forcing a horizontal scrollbar)
      // come from the PURE, node-tested `buildViewerEditorOptions` (incl. `readOnly`/`domReadOnly`).
      // The `h-full min-h-0 w-full` container below adds no overflow-x of its own.
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
      // Detach THIS view from the shared model (decrement refcount) BEFORE disposing the editor — the
      // registry disposes the model only when no view remains AND the file is closed (FR-007).
      const attached = attachedRef.current
      if (attached) {
        sharedMonacoModelRegistry.detach(attached.paneId, attached.relPath)
        attachedRef.current = null
      }
      ed.dispose()
      editorRef.current = null
    }
    // Mount once; the attach effect below handles paneId/relPath/text changes without re-creating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach the SHARED model for the active (paneId, relPath); on a file-switch detach the old model +
  // acquire+attach the new; on a text change (a watch re-read of the SAME file) sync the shared buffer
  // (read-only content-sync — no edit path, OQ-1). Two editors on one model keep independent cursor/
  // scroll (FR-004); per-file view-state persistence across switches is NOT required (OQ-5).
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) {
      return
    }
    const attached = attachedRef.current
    if (!attached || attached.paneId !== paneId || attached.relPath !== relPath) {
      if (attached) {
        sharedMonacoModelRegistry.detach(attached.paneId, attached.relPath)
      }
      const model = sharedMonacoModelRegistry.acquire(paneId, relPath, text, monacoLanguageOf(relPath))
      // Acquire may return an EXISTING shared model (the other view opened this file first); make sure
      // it carries the freshest text before this view shows it.
      sharedMonacoModelRegistry.syncText(model, text)
      ed.setModel(model as unknown as editor.ITextModel)
      attachedRef.current = { paneId, relPath }
    } else {
      // Same file, new text (an `fs:changed` re-read landed) — push it into the one shared model so
      // BOTH views update at once (FR-003, Scenario 4), each keeping its own cursor/scroll.
      const model = ed.getModel()
      if (model) {
        sharedMonacoModelRegistry.syncText(model as unknown as ModelLike, text)
      }
    }
  }, [paneId, relPath, text])

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
          paneId={paneId}
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

  // viewer-keyboard-shortcut-nonmonaco-focus-v1: the dedicated viewers (image/PDF/docx/sheet/state
  // blocks) have NO focusable child, so clicking them never moves DOM focus into the viewer subtree
  // and the focus-aware `Ctrl/Cmd+W` / `Cmd+Opt+Arrow` routing (which keys off focus-within) never
  // engages. Monaco (`text`) owns its OWN focus via the body-mounted <textarea> + its
  // onDidFocusEditorText path, so we must NOT steal focus from it. For every NON-editor kind we make
  // the body wrapper itself the focus target (`tabIndex={-1}`) and focus it when that file becomes
  // active, establishing focus-within so the shortcuts route — exactly as Monaco's textarea does.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const isEditorViewer = viewer?.kind === 'text'
  const activeRelKey = viewer?.relPath ?? null
  useEffect(() => {
    if (isEditorViewer) {
      // Monaco focuses its own textarea; focusing the wrapper here would yank focus away from it.
      return
    }
    bodyRef.current?.focus()
  }, [isEditorViewer, activeRelKey])

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
  // A click on a dedicated viewer (image/PDF/docx/sheet/state block — none have a focusable child)
  // after focus left the subtree re-establishes focus-within so the shortcuts keep routing. Monaco
  // (`text`) owns its own textarea focus, so we never grab focus for the editor.
  const handleBodyMouseDown = (): void => {
    if (isEditorViewer) {
      return
    }
    const root = bodyRef.current
    if (root && !root.contains(document.activeElement)) {
      root.focus()
    }
  }

  return (
    <div
      ref={bodyRef}
      tabIndex={-1}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseDown={handleBodyMouseDown}
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
