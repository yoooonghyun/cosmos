/**
 * FileExplorer — the per-tab file explorer for the 3-pane terminal layout
 * (terminal-file-explorer-v1 3-pane rework, design §1/§2/§4/§5.1). One `useFileExplorer` hook
 * instance backs BOTH the middle viewer column and the right tree dock, so a click in the dock
 * retargets the viewer. `TerminalView` owns the two columns (with a divider between each); this
 * module exposes a `useExplorerPanes` hook returning the ready-to-render `viewer` and `tree`
 * elements plus the live-gating, so the layout stays in `TerminalPanel`.
 *
 * The tree dock (RIGHT) is ALWAYS visible once live — it is never replaced by the viewer. The
 * viewer (MIDDLE) shows the selected file or a calm "Select a file" placeholder. The terminal
 * (LEFT) is untouched by anything here.
 */

import { FolderTree } from 'lucide-react'
import { FileTree } from './FileTree'
import { FileViewer } from './FileViewer'
import { useFileExplorer, type RestoredOpenFiles } from './useFileExplorer'

export interface ExplorerPanes {
  /** The MIDDLE column: the file viewer (or the "Select a file" placeholder). */
  viewer: React.JSX.Element
  /** The RIGHT dock: the always-visible file tree (or the awaiting-directory placeholder). */
  tree: React.JSX.Element
}

/**
 * Drive the explorer for one tab and return the two ready-to-place column elements. `live` is the
 * tab's LIVE phase (a chosen cwd); while false both columns show quiet placeholders and the hook
 * issues NO `fs:list`/`fs:watch` (FR-006).
 *
 * persist-workdir-open-files-v1: `restoredOpenFiles` seeds the open-files strip on the first
 * go-live (FR-004); `onOpenFilesChange` reports every change to the session save (FR-013).
 */
export function useExplorerPanes(
  paneId: string,
  live: boolean,
  restoredOpenFiles?: RestoredOpenFiles,
  onOpenFilesChange?: (slice: RestoredOpenFiles) => void
): ExplorerPanes {
  const {
    tree,
    rootError,
    rootLoading,
    openFiles,
    activeRelPath,
    viewer,
    toggleDir,
    openFile,
    setActiveFile,
    closeFile,
    retryRoot
  } = useFileExplorer(paneId, live, restoredOpenFiles, onOpenFilesChange)

  if (!live) {
    // §5.1 awaiting-directory: a quiet placeholder in the dock; the viewer mirrors it (no file yet).
    const placeholder = (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground select-none">
        <FolderTree className="size-6 text-muted-foreground/70" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">Open a folder to browse its files.</p>
      </div>
    )
    return { viewer: placeholder, tree: placeholder }
  }

  return {
    viewer: (
      <FileViewer
        paneId={paneId}
        openFiles={openFiles}
        activeRelPath={activeRelPath}
        viewer={viewer}
        onActivate={setActiveFile}
        onClose={closeFile}
      />
    ),
    tree: (
      <FileTree
        tree={tree}
        rootError={rootError}
        rootLoading={rootLoading}
        // terminal-file-tabs-v1 FR-016: the tree highlight follows the ACTIVE tab's file (was the
        // single open file's relPath). `null` when the strip is empty → no open-file selection.
        selectedRelPath={activeRelPath}
        onToggleDir={toggleDir}
        onOpenFile={openFile}
        onRetry={retryRoot}
      />
    )
  }
}
