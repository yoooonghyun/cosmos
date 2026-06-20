/**
 * fileExplorer barrel — the per-tab 3-pane terminal/viewer/tree layout (terminal-file-explorer-v1).
 * `TerminalPanel` imports `useExplorerPanes` (the viewer + tree column elements) + `ResizeDivider`
 * from here; everything else is internal to the feature folder.
 */

export { useExplorerPanes } from './FileExplorer'
export type { RestoredOpenFiles } from './useFileExplorer'
export { ResizeDivider } from './ResizeDivider'
