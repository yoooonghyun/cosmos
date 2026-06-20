# cosmos — Project Structure

The authoritative design lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md); this document is
the detailed file-by-file map of the source tree. See `ARCHITECTURE.md` §4.6 for how the
four Electron process roles map to the tree, and the per-component sections (§4.1–§4.11)
for the design rationale behind each piece.

## Source tree

- `src/main/` — Electron main process: `index.ts` (window + IPC wiring), `ptyManager.ts` (PTY
  lifecycle), `agentRunner.ts` (headless `claude` for utterance→generative-UI runs), socket
  bridges (`uiBridge.ts`, `slackBridge.ts`, `jiraBridge.ts`, `confluenceBridge.ts`), integration
  managers (`jiraManager.ts`, `slackManager.ts`, `confluenceManager.ts`) + `integrations/`, and the
  deterministic `jira.*` write path (`jiraActionDispatcher.ts` + `jiraSurfaceBuilder.ts`); the
  per-tab file-explorer filesystem sandbox (`fsExplorer.ts` list/read/watch manager,
  `pathConfine.ts` real-path confinement, `fileKind.ts` text/binary/image classification) + the
  `cosmos-file://` privileged image scheme (`localFileRef.ts` pure codec/validator +
  `localFileProtocol.ts` Electron wiring), each with a sibling `*.test.ts`
- `src/preload/` — `contextBridge` preload exposing only the per-channel surfaces as `window.cosmos.*`
  (`pty`, `fs`, `ui`, `slack`, `jira`, `confluence`)
- `src/renderer/` — React renderer; `App.tsx` is the app shell (left icon-rail **single-surface
  switcher** — one surface visible full-width, all kept mounted); `TerminalPanel.tsx` is the xterm.js
  terminal (one xterm per terminal tab); `GeneratedUiPanel.tsx`/`JiraPanel.tsx`/`SlackPanel.tsx`/
  `ConfluencePanel.tsx` are the rail surfaces (Jira/Slack/Confluence are all generative custom-catalog
  A2UI panels); each rail surface hosts its own **VS Code-style tabs** via `panelTabs.ts` (pure
  open/close/label logic) + `usePanelTabs.ts` (generic controller) + `PanelTabStrip.tsx` (reusable
  strip), and the generative panels share `useGenerativePanelTabs.ts` (originating-tab correlation) +
  `ActiveTabSurface.tsx` (per-tab A2UI host) + `perTabNav.ts`/`usePerTabNav.ts` (per-tab native-base
  browser nav); `jiraCatalog/`, `slackCatalog/`, `confluenceCatalog/`
  are the per-panel A2UI custom catalogs; `fileExplorer/` is the per-tab 3-column terminal/viewer/tree
  layout (the `useExplorerPanes` hook + `FileTree`/`FileViewer`/`FileTabStrip`/`ResizeDivider` components, the
  `useFileExplorer` hook, the pure node-tested `tree.ts`/`fileGlyph.ts`/`monacoTheme.ts`/`localFileSrc.ts`/
  `viewerState.ts`/`openFiles.ts` (the multi-file open-files collection, terminal-file-tabs-v1), and the
  impure `monacoSetup.ts` Monaco-worker wiring); `components/ui/` is the shadcn set
- `src/mcp/` — standalone stdio MCP entry scripts (`renderUiServer.ts`, `jiraRenderUiServer.ts`,
  `slackRenderUiServer.ts`, `confluenceRenderUiServer.ts`, `jiraMcpServer.ts`, `slackMcpServer.ts`,
  `confluenceMcpServer.ts`) relaying to the main bridges
- `src/shared/` — code shared across processes: `ipc.ts` (typed IPC contract), `bridge.ts` (NDJSON
  socket framing), `validate.ts` (pure IPC payload validators), per-integration types (`jira.ts` etc.)
