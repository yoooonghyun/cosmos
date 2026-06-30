/**
 * fileExplorer barrel — the per-tab 3-pane terminal/viewer/tree layout (terminal-file-explorer-v1).
 * `TerminalPanel` imports `useExplorerPanes` (the viewer + tree column elements) + `ResizeDivider`
 * from here; everything else is internal to the feature folder.
 */

export { useExplorerPanes } from './FileExplorer'
export type { RestoredOpenFiles, FileExplorerOptions } from './useFileExplorer'
export { ResizeDivider } from './ResizeDivider'
// cosmos-terminal-favorite-explorer-share-v1 (FR-002): the App-root SHARED open-files store. Exported
// here so the App shell wraps `<OpenFilesProvider>` (this module is Monaco-FREE — it imports only the
// pure `openFiles.ts` transitions — so importing it never drags Monaco into a Monaco-free graph).
export { OpenFilesProvider, useSharedOpenFiles, type PaneOpenFilesEntry } from './OpenFilesProvider'
