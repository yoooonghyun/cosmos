# cosmos — Project Structure

The authoritative design lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md); this document is
the detailed file-by-file map of the source tree. See `ARCHITECTURE.md` §4.6 for how the
four Electron process roles map to the tree, and the per-component sections (§4.1–§4.11)
for the design rationale behind each piece.

The `src/main/`, `src/renderer/`, and `src/shared/` trees are grouped into **per-domain /
feature subfolders** (directory-restructure-v1). Test files (`*.test.ts`,
`*.dom.test.tsx`, `*.integration.test.ts`) stay co-located in the same folder as the source
module they exercise. Cross-process imports are relative (`../shared`, `../main`, `../renderer`);
the `@/` alias resolves to `src/renderer` and is depth-independent (used for `@/components/ui/*`
and `@/lib/utils`).

## Source tree

### `src/main/` — Electron main process

Grouped into per-domain folders; cross-cutting files stay at the root.

- root: `index.ts` (window + IPC wiring; the largest importer of the rest), `mcpConfig.ts`
  (per-target MCP config + grounding), `clientConfigResolver.ts` / `clientConfigMutate.ts`
  (settings/OAuth client config), `shortcutMatch.ts` (global-shortcut matching) — each with a
  sibling `*.test.ts`
- `integrations/` — the integration foundation (PKCE OAuth, token store, per-provider clients,
  text/config helpers) — UNCHANGED grouping
- `slack/` — `slackBridge.ts`, `slackManager.ts`, `slackAdapter.ts`, `slackSurfaceBuilder.ts`,
  `slackImageRef.ts`, `slackImageProtocol.ts`
- `jira/` — `jiraBridge.ts`, `jiraManager.ts`, `jiraAdapter.ts`, `jiraActionDispatcher.ts`
  (deterministic write path), `jiraSurfaceBuilder.ts`
- `confluence/` — `confluenceBridge.ts`, `confluenceManager.ts`, `confluenceAdapter.ts`,
  `confluenceSurfaceBuilder.ts`, `confluenceImageRef.ts`, `confluenceImageProtocol.ts`,
  `confluenceComments.integration.test.ts`
- `calendar/` — `googleCalendarBridge.ts`, `googleCalendarManager.ts`,
  `googleCalendarSurfaceBuilder.ts`, `googleCalendarWindow.ts`
- `pty/` — `ptyManager.ts` (PTY lifecycle), `paneSpawn.ts`, `processGroupKill.ts`,
  `orphanReaper.ts`, `sessionLockRecovery.ts`
- `agent/` — `agentRunner.ts` (headless `claude` for utterance→generative-UI runs),
  `agentSessionStore.ts`, `agentSessionQueue.ts`, `sandboxClaudeMd.ts` (provisions the embedded
  agent's sandbox-cwd `CLAUDE.md` documenting the `<cosmos:context>` marker) (+
  `agentRunner.integration.test.ts`, `sandboxClaudeMd.test.ts`)
- `session/` — `sessionStore.ts`, `sessionSnapshot.ts`
- `fs/` — the per-tab file-explorer filesystem sandbox (`fsExplorer.ts` list/read/watch,
  `pathConfine.ts` real-path confinement, `fileKind.ts` text/binary/image classification,
  `viewerKind.ts` / `viewerCaps.ts`) + the `cosmos-file://` privileged image scheme
  (`localFileRef.ts` pure codec/validator + `localFileProtocol.ts` Electron wiring) + transcript
  reading (`transcriptReader.ts` / `transcriptParse.ts`) (+ `fsExplorer.integration.test.ts`,
  `localFileProtocol.integration.test.ts`)
- `generative/` — the descriptor/adapter engine: `uiBridge.ts` (UI socket bridge),
  `descriptorShell.ts`, `descriptorRegistration.ts`, `adapterDispatcher.ts`,
  `adapterBindingRegistry.ts`, `specRebinder.ts`, `dataBearingWarning.ts`, `pendingCalls.ts`,
  `viewContextGrounding.ts` (+ `refreshRepaintIntegration.test.ts`, the cross-tree main↔renderer
  integration test)

### `src/preload/`

`contextBridge` preload exposing only the per-channel surfaces as `window.cosmos.*`
(`pty`, `fs`, `ui`, `slack`, `jira`, `confluence`, `googleCalendar`).

### `src/renderer/` — React renderer

Entry/shell files stay at the root; everything else is grouped by domain/feature.
`components/ui/` (shadcn primitives) and `lib/` are untouched.

- root: `App.tsx` (app shell — left icon-rail **single-surface switcher**, all surfaces kept
  mounted), `main.tsx`, `index.html`, `index.css`, `App.css`, `vite-env.d.ts`
- `app/` — app-shell pieces: `railVisibility.ts`, `CosmosMark.tsx`, `CosmosSpinner.tsx`,
  `SurfaceSpinner.tsx`, `PanelFooter.tsx`, `SettingsDialog.tsx`, `settingsStatusDot.ts`,
  `ContextChip.tsx`, `viewContextCapture.ts`, `contextChipIcons.ts` (the shared per-kind item
  glyph/noun maps reused by `ContextChip` + the timeline `PromptContextChip`), `surfaceIcons.tsx`
- `session/` — `SessionProvider.tsx`, `sessionRegistry.ts`, `sessionSnapshot.ts`
- `tabs/` — VS Code-style tab/nav plumbing: `panelTabs.ts` (pure open/close/label logic),
  `usePanelTabs.ts` (generic controller), `PanelTabStrip.tsx` (reusable strip),
  `useGenerativePanelTabs.ts` (originating-tab correlation), `perTabNav.ts` / `usePerTabNav.ts`
  (per-tab native-base browser nav), `closeTabRouting.ts`, `useTabShortcuts.ts`,
  `TerminalTabNavRouting.dom.test.tsx`
- `composer/` — open-prompt composer: `PromptComposer.tsx`, `promptComposerLogic.ts`,
  `activeComposer.ts`, `ActiveComposerProvider.tsx`, `OpenPromptPositionProvider.tsx`,
  `openPromptPosition.ts` (+ `PromptComposerDocked.dom.test.tsx`)
- `generative/` — per-tab generative host: `ActiveTabSurface.tsx` (per-tab A2UI host),
  `activeTabSurfaceRefresh.ts`, `panelRefreshLogic.ts`, `PanelRefreshButton.tsx`,
  `dataModelApply.ts` (renderer-PURE; cross-listed in `tsconfig.node.json` for the main
  integration test), and the shared catalog primitives `catalogShared/`
- `terminal/` — `TerminalPanel.tsx` (+ `TerminalPanel.css`), `terminalTheme.ts`, `terminalKeymap.ts`
- `slack/` — `SlackPanel.tsx`, the renderer-side Slack logic (`slackComposerLogic.ts`,
  `slackThreadPanelLogic.ts`, `slackChannelSearchLogic.ts`, `slackScrollToLatest.ts` /
  `useSlackScrollToLatest.ts`, `slackScrollPaginate.ts` / `useSlackScrollPaginate.ts`), and the
  nested A2UI custom catalog `slackCatalog/`
- `jira/` — `JiraPanel.tsx` + nested `jiraCatalog/`
- `confluence/` — `ConfluencePanel.tsx` + nested `confluenceCatalog/`
- `atlassian/` — `atlassianPanelBits.tsx` (shared Jira + Confluence panel bits)
- `calendar/` — `GoogleCalendarPanel.tsx`, `calendarNavLogic.ts` + nested `googleCalendarCatalog/`
- `cosmos/` — `CosmosPanel.tsx`, `cosmosConversation.ts`, `cosmosTabs.ts`, `CosmosTimelineEntry.tsx`,
  `PromptContextChip.tsx` (the read-only timeline prompt-context breadcrumb chip), `PanelTabTree.tsx`
  (the cross-panel tab survey + right-click Pin/Unpin menu), and the Home-favorites trio
  (cosmos-home-favorite-tabs-v1): `homeFavorites.ts` (pure: `findLiveTab`/`reconcileFavorites`/
  `toFavoriteStripTab`/`toHomeFavorites`/`favoritesToTabs`, re-exports the shared `validateFavorites`),
  `favoriteCatalogHosts.tsx` (`panelId → {catalog,catalogId,panelName}` + the swallow-local-actions
  `favoriteOnAction`), `FavoriteSurface.tsx` (the inline live mirror + waiting/gone/error states)
- `confirm/` — `confirmLogic.ts`, `useConfirm.ts`
- `fileExplorer/` — the per-tab 3-column terminal/viewer/tree layout (the `useExplorerPanes` hook +
  `FileTree`/`FileViewer`/`FileTabStrip`/`ResizeDivider` components, the `useFileExplorer` hook, the
  pure node-tested `tree.ts`/`fileGlyph.ts`/`monacoTheme.ts`/`localFileSrc.ts`/`viewerState.ts`/
  `openFiles.ts`, and the impure `monacoSetup.ts` Monaco-worker wiring) — UNCHANGED internals
- `glassDock/` — the glass-dock filter/config + `GlassDock` component — UNCHANGED
- `components/ui/` — the shadcn primitive set — UNTOUCHED (Phase 2, deferred)
- `lib/` — `utils.ts` (the `cn` helper) — UNTOUCHED

### `src/mcp/` — standalone stdio MCP entry scripts

Left flat (high coupling to rollup input keys + `mcpConfig.ts` output-filename lookups):
`renderUiServer.ts`, `jiraRenderUiServer.ts`, `slackRenderUiServer.ts`,
`confluenceRenderUiServer.ts`, `googleCalendarRenderUiServer.ts`, `jiraMcpServer.ts`,
`slackMcpServer.ts`, `confluenceMcpServer.ts`, `googleCalendarMcpServer.ts`, plus `uiCatalog.ts`
and `confluenceToolDescription.ts`. Each render/tool server relays over a Unix-domain socket to
the matching bridge in main. The bundles emit to `out/main/mcp/<name>.js` with names that must
stay stable (rollup input keys + `mcpConfig.ts` runtime `join(__dirname, 'mcp/<name>.js')`).

### `src/shared/` — code shared across processes

- root barrels: `ipc.ts` (typed IPC contract — single source of truth for channel names +
  payload types), `validate.ts` (pure IPC payload validators), `bridge.ts` (NDJSON socket
  framing) (+ `bridge.test.ts` and the top-level `validate*.test.ts` files that exercise the
  `ipc/` barrels next to `validate.ts`)
- `ipc/` — the per-domain IPC contract modules behind the same-path barrels
  (`common`/`pty`/`ui`/`agent`/`shortcut`/`slack`/`jira`/`confluence`/`googleCalendar`/`session`/
  `settings`/`conversation`, each with a sibling `*.validate.ts`) — UNCHANGED grouping
- `types/` — per-integration + generative-contract types: `jira.ts`, `slack.ts`, `confluence.ts`,
  `googleCalendar.ts`, `googleCalendarColor.ts`, `adapter.ts`, `conversation.ts`
  (`UserPromptTurn.context` carries the parsed prompt-context), `dataBearingSpec.ts`
- `promptContext/` — the pure, shared prompt-context contract + codec
  (`cosmos-timeline-prompt-context-v1`): `promptContext.ts` (the `PromptContext` type — `panel`/
  `tab`/`dock`, extends `ViewContext`), `promptContextMarker.ts` (serialize/parse+strip the trailing
  `<cosmos:context>` marker, `MARKER_RE`, `DOCK_KIND_BY_PANEL`), `buildAgentSubmit.ts`
  (`buildAgentSubmitWithMarker` — the one-source-two-channels submit chokepoint) (+
  `promptContextMarker.test.ts`, `buildAgentSubmit.test.ts`). No renderer/Electron/`Buffer` deps —
  imported by main, preload, and renderer.
