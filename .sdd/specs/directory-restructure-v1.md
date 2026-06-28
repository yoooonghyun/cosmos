# Spec: Directory Restructure (Phase 1) — v1

**Status**: Draft
**Created**: 2026-06-28
**Supersedes**: (none)
**Related plan**: .sdd/plans/directory-restructure-v1.md (to follow)

---

## Grounding

Investigated directly via codegraph + agentmemory + targeted Read/Grep before authoring
(per architect operating principles). The proposed tree below is derived from the real,
current source layout — not invented.

**agentmemory (prior decisions):**
- `memory_recall` "directory structure restructure renderer folders organization" → empty.
  No prior decision recorded about source-tree layout. (No conflicting precedent to honor;
  this spec establishes the convention.)

**codegraph / Glob / Grep / Read (code structure — what is actually on disk):**
- Read `docs/PROJECT-STRUCTURE.md` and `docs/ARCHITECTURE.md` §4.6 — the authoritative
  file-by-file map and the four-process→tree mapping. Confirms intended grouping language
  (per-integration: slack/jira/confluence/googleCalendar; terminal/pty; fileExplorer;
  composer/cosmos panel; fs; ipc; integrations) but the actual `src/renderer/` top level is
  flat.
- `Glob src/renderer/*` — **~75 loose files sit directly in `src/renderer/`** (panels:
  `TerminalPanel/JiraPanel/SlackPanel/ConfluencePanel/GoogleCalendarPanel/CosmosPanel`;
  composer: `PromptComposer*/promptComposerLogic/activeComposer*/ActiveComposerProvider/
  OpenPromptPositionProvider/openPromptPosition*`; tabs/nav: `panelTabs*/usePanelTabs/
  PanelTabStrip/useGenerativePanelTabs/perTabNav*/usePerTabNav/closeTabRouting*/
  useTabShortcuts*/cosmosTabs*`; session: `SessionProvider/sessionRegistry*/sessionSnapshot*/
  cosmosConversation*/CosmosTimelineEntry`; slack-renderer logic: `slackComposerLogic*/
  slackThreadPanelLogic*/slackChannelSearchLogic*/slackScroll*/useSlackScroll*`; calendar:
  `calendarNavLogic*`; terminal: `terminalTheme*/terminalKeymap*/TerminalPanel.css`; misc:
  `dataModelApply*/panelRefreshLogic*/PanelRefreshButton/activeTabSurfaceRefresh*/
  ActiveTabSurface/viewContextCapture*/ContextChip/settingsStatusDot*/SettingsDialog/
  confirmLogic*/useConfirm/railVisibility*/CosmosMark/CosmosSpinner/SurfaceSpinner/
  PanelFooter/atlassianPanelBits` + shell `App.tsx/App.css/main.tsx/index.css/index.html`).
  **Existing well-grouped subfolders already present:** `jiraCatalog/`, `slackCatalog/`,
  `confluenceCatalog/`, `googleCalendarCatalog/`, `fileExplorer/`, `catalogShared/`,
  `components/ui/`, `lib/`. These are the proof-of-pattern the loose files should follow.
- `Glob src/main/*` — ~95 files flat at `src/main/` top level, BUT one subfolder already
  groups well: `integrations/` (OAuth/clients/text/config helpers). The rest (per-integration
  managers/bridges/surface-builders/adapters, pty/process lifecycle, fs/file-explorer/local-
  file-protocol, session/agent stores, descriptor/adapter dispatch engine) are loose.
- `Glob src/shared/*` — `ipc/` subfolder already groups the per-domain IPC contract
  (`ipc-modular-refactor-v1`); the rest (`bridge`, `validate`, `adapter`, `conversation`,
  `dataBearingSpec`, per-integration type files `jira.ts/slack.ts/confluence.ts/
  googleCalendar.ts/googleCalendarColor.ts`, and many top-level `validate*.test.ts`) are loose.
- `Glob src/mcp/*` — 13 flat entry/helper files. **High-coupling finding (see Edge Cases):**
  `electron.vite.config.ts` rollup input KEYS (`'mcp/renderUiServer'` …) and `mcpConfig.ts`
  runtime args (`join(__dirname, 'mcp/renderUiServer.js')`) must agree on each server's OUTPUT
  filename. Reorganizing `src/mcp/` source does NOT have to change those output names.
- Grep import-style audit (the blast-radius evidence):
  - **`@/` alias → `src/renderer` only** (`electron.vite.config.ts`, `tsconfig.web.json`,
    `vitest.dom.config.ts`). It is used today ONLY for `@/components/ui/*` and `@/lib/utils`.
    These imports are **depth-independent** — moving an importer into a nested renderer
    subfolder does NOT break them. This is the key lever: the more we route via `@/`, the
    fewer relative paths break.
  - **Cross-process imports are RELATIVE** (`from '../shared/...'`): 32 occurrences across 28
    renderer files; 40 occurrences across 11 `src/mcp/` files (mcp → `../shared`, `../main`).
    These ARE depth-sensitive and MUST be rewritten when the importer's depth changes.
  - No renderer file imports `@/<non-component>` today (e.g. no `@/sessionRegistry`); intra-
    renderer imports are relative.
- Read config touch-points: `electron.vite.config.ts`, `tsconfig.web.json`,
  `tsconfig.node.json`, `vitest.config.ts`, `vitest.dom.config.ts`, `package.json` scripts.
  Glob coupling: node test glob `src/**/*.test.ts` and dom glob `src/**/*.dom.test.tsx` are
  **recursive** (safe under nesting); BUT `package.json` `test:integration` is
  `src/main/*.integration.test.ts` — **NOT recursive** — and `tsconfig.node.json` /
  `tsconfig.web.json` each hardcode the single cross-tree file path
  `src/renderer/dataModelApply.ts`. Both break if those files move.
- Read `.sdd/specs/design-foundation-v1.md` — the **in-flight** design-system foundation work
  that owns `src/renderer/components/ui/` (16 shadcn primitives, the token/scale system). This
  is the Phase-2 dependency: restructuring `components/ui/` now would collide with it, so
  Phase 2 is deferred until that work lands.

---

## Overview

The cosmos source tree is too flat: ~75 renderer files, ~95 main files, and the loose
`src/shared/` files all sit directly at their package top level, making it hard to find the
code for a given domain (e.g. "where is the Slack panel?"). This feature reorganizes the
loose top-level files of `src/renderer/`, `src/main/`, `src/shared/`, and `src/mcp/` into
sensible domain/feature subfolders, as a **pure file-move + import-path refactor with zero
behavior change**. The shadcn UI primitives under `src/renderer/components/` are explicitly
deferred to a later Phase 2 (after `design-foundation-v1` lands); this Phase-1 structure is
shaped to leave room for that.

## User Scenarios

> Each scenario is independently verifiable. Audience = developers working in this repo.

### Find a panel's code by domain folder · P1

**As a** developer working on cosmos
**I want to** find all the code for one surface/integration grouped under a single domain folder
**So that** I stop scanning ~75 sibling files at the renderer top level to locate a feature

**Acceptance criteria:**
- Given the restructured tree, when I look for the Slack panel, then `SlackPanel.tsx` and its
  renderer-side Slack logic (`slackComposerLogic`, `slackThreadPanelLogic`,
  `slackChannelSearchLogic`, `slackScroll*`, `useSlackScroll*`) and the existing `slackCatalog/`
  live together under one Slack folder.
- Given the restructured tree, when I look for terminal code, then `TerminalPanel.tsx`,
  `terminalTheme`, `terminalKeymap`, and `TerminalPanel.css` are grouped under one terminal folder.
- Given the restructured tree, when I look for tab/navigation plumbing, then `panelTabs`,
  `usePanelTabs`, `PanelTabStrip`, `useGenerativePanelTabs`, `perTabNav`, `usePerTabNav`,
  `closeTabRouting`, `useTabShortcuts`, `cosmosTabs` are grouped together.

### Identical behavior after the move · P1

**As a** developer (and the end user)
**I want to** the app to behave exactly as before the restructure
**So that** a pure reorganization never introduces a regression

**Acceptance criteria:**
- Given the restructured tree, when I run `npm run typecheck`, then it passes (node + web).
- Given the restructured tree, when I run `npm test` (and `test:dom`, `test:integration`), then
  all suites pass with the same set of tests as before.
- Given the restructured tree, when I run `npm run dev` / `npm run build`, then the app launches
  and every surface (terminal, file explorer, Slack, Jira, Confluence, Google Calendar, cosmos
  panel, settings, open-prompt composer) works identically, and all embedded MCP servers spawn.

### Test files stay beside their source · P1

**As a** developer
**I want to** each `*.test.ts` / `*.dom.test.tsx` / `*.integration.test.ts` to stay co-located
with the module it tests after the move
**So that** the established node/dom/integration test split and co-location convention is preserved

**Acceptance criteria:**
- Given a moved source module, when I look in its new folder, then its sibling test file is in
  the same folder.
- Given the move, when the test runner globs run, then they discover exactly the same test files
  as before (no test silently dropped).

### Up-to-date map · P2

**As a** developer
**I want to** `docs/PROJECT-STRUCTURE.md` to describe the new tree
**So that** the file-by-file map never drifts from reality

**Acceptance criteria:**
- Given the restructure is complete, when I read `docs/PROJECT-STRUCTURE.md`, then it reflects
  the new folder layout, and `docs/ARCHITECTURE.md` §4.6 still accurately maps the four process
  roles to the (now-nested) tree.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                 |
|--------|---------------------------------------------------------------------------------------------|
| FR-001 | The restructure MUST be **pure file moves + import-path updates ONLY**. No logic edits, no renamed exported symbols, no changed function signatures, no behavior change, no new runtime dependency. |
| FR-002 | The system MUST group the loose top-level `src/renderer/` files into domain/feature subfolders (see Proposed Structure). Existing well-grouped subfolders (`jiraCatalog/`, `slackCatalog/`, `confluenceCatalog/`, `googleCalendarCatalog/`, `fileExplorer/`, `catalogShared/`, `lib/`) MUST be preserved (and MAY be relocated under their domain folder if it reduces nesting confusion). |
| FR-003 | The system MUST NOT touch `src/renderer/components/` (the shadcn UI primitives). That is Phase 2, deferred (see Out of Scope). |
| FR-004 | The system MUST group the loose `src/main/` and `src/shared/` files into domain/feature subfolders, preserving the existing `src/main/integrations/` and `src/shared/ipc/` groupings. |
| FR-005 | Each test file (`*.test.ts`, `*.dom.test.tsx`, `*.integration.test.ts`) MUST move together with the source module it tests and remain co-located (same folder) with it. |
| FR-006 | All import paths affected by a move MUST be updated so the project compiles. Relative cross-process imports (`../shared/...`, `../main/...`) MUST be re-pathed to the moved file's new depth; intra-renderer imports MUST be updated (relative or, where it removes brittle `../../`, via the `@/` alias). |
| FR-007 | The `@/` alias MUST continue to resolve to `src/renderer`. The restructure MUST NOT break `@/components/ui/*` or `@/lib/utils` imports (these are depth-independent and need no change). The restructure MAY additionally route intra-renderer imports through `@/` where it improves clarity, but MUST NOT introduce new alias prefixes (e.g. no `@main`, `@shared`) — that is out of scope. |
| FR-008 | The system MUST update every build/test config file whose globs or hardcoded paths are invalidated by the move: `electron.vite.config.ts` (mcp rollup inputs + renderer root/alias), `tsconfig.web.json` / `tsconfig.node.json` (the `@/*` path, the `include` globs, and the hardcoded `src/renderer/dataModelApply.ts` cross-tree listing), `vitest.config.ts`, `vitest.dom.config.ts`, and `package.json` (`test:integration` glob). |
| FR-009 | If any `src/mcp/` entry script is relocated within `src/mcp/`, the system MUST keep each MCP server's **emitted output filename stable** (the rollup input KEY and the `mcpConfig.ts` runtime `join(__dirname, 'mcp/<name>.js')` lookup must continue to agree), OR update both in lockstep. The set of MCP servers that get bundled MUST be unchanged. |
| FR-010 | The `.ts` vs `.test.ts` node-env split and the `*.dom.test.tsx` / `*.integration.test.ts` extensions MUST be preserved exactly (no file renamed across the split). |
| FR-011 | After the restructure, the system MUST regenerate `docs/PROJECT-STRUCTURE.md` to match the new tree and reconcile `docs/ARCHITECTURE.md` §4.6 if its tree references changed. |
| FR-012 | The restructure SHOULD land on a clean working tree (no other in-flight edits) to avoid wide merge churn; sequencing relative to other in-flight specs is for the plan/orchestrator to decide (see Open Questions). |

## Edge Cases & Constraints

- **Relative cross-process imports break on depth change.** 32 renderer-side `../shared/...`
  and 40 mcp-side `../shared`/`../main` relative imports must be re-pathed to the new nesting
  depth. The `@/` alias (renderer-only) does NOT cover shared, so renderer→shared stays
  relative — every renderer file that moves one level deeper needs its `../shared` → `../../shared`.
- **`@/` is depth-independent and only spans renderer.** `@/components/ui/*` and `@/lib/utils`
  survive any renderer move unchanged. This is the safe lever; prefer it for intra-renderer
  imports that would otherwise become deep `../../`.
- **Non-recursive config globs are the trap.** `package.json` `test:integration` is
  `src/main/*.integration.test.ts` (single-level). If an integration test moves into a
  `src/main/<domain>/` subfolder, this glob silently stops finding it → update to a recursive
  glob (`src/main/**/*.integration.test.ts`) or keep integration tests at a known path.
- **tsconfig hardcoded single-file cross-tree listing.** `tsconfig.node.json` lists
  `src/renderer/dataModelApply.ts` (so the refresh-repaint integration test typechecks across
  the main/renderer composite boundary). If `dataModelApply.ts` moves, that exact path string
  must be updated; the `include` globs in both tsconfigs must still cover all moved sources.
- **MCP output-name coupling.** `electron.vite.config.ts` rollup input keys
  (`'mcp/renderUiServer'`) define the emitted `out/main/mcp/<name>.js`; `mcpConfig.ts` looks
  those up by exact filename. Source reorg inside `src/mcp/` must not change the emitted names
  (or must change both sides together). Adding/removing a server is out of scope.
- **Preload restart gotcha.** No new `window.cosmos.*` method is added (pure move), but if
  `src/preload/index.ts` imports move, the dev run must be fully restarted (not HMR) per
  CLAUDE.md. The plan should note this for the implementing session.
- **`index.html` / Vite entry.** `src/renderer/index.html` and `main.tsx` are the renderer
  entry; `electron.vite.config.ts` `renderer.root` and the rollup `input.index` point at them.
  These SHOULD stay at the renderer root (moving them invites config churn for no grouping win).
- **`vite-env.d.ts` / `App.css` / `index.css`** are shell/ambient files; they SHOULD stay at
  the renderer root.
- **Co-located non-`.ts` assets.** `TerminalPanel.css` must move with `TerminalPanel.tsx`.
- **Out of scope (this cycle):** Phase 2 — restructuring `src/renderer/components/` (the shadcn
  primitives). Deferred until `design-foundation-v1` lands so the two don't collide. Phase 1
  intentionally leaves `components/` untouched and at the renderer root, so Phase 2 can later
  introduce a `components/<grouping>` scheme without re-doing Phase-1 moves.
- **Out of scope:** any logic change, symbol rename, API change, new dependency, new path
  alias, or change to which MCP servers bundle. The `src/shared/ipc/` per-domain barrel scheme
  is already correct and is NOT re-litigated (its public barrel paths `../shared/ipc` /
  `../shared/validate` stay stable).

## Proposed Structure

> Concrete target tree. Folder NAMES and nesting depth are the architect's recommendation;
> see Open Questions for the one genuinely-open naming/aggressiveness decision. The grouping
> is by domain/feature, mirroring the existing well-grouped subfolders.

### `src/renderer/` (Phase 1 — `components/` untouched)

```
src/renderer/
  index.html  main.tsx  index.css  App.tsx  App.css  vite-env.d.ts   ← shell/entry stay at root
  components/ui/            ← UNTOUCHED (Phase 2)
  lib/                      ← UNTOUCHED (utils.ts)
  app/                      ← app-shell pieces: railVisibility(.test), CosmosMark, CosmosSpinner,
                              SurfaceSpinner, PanelFooter, SettingsDialog, settingsStatusDot(.test),
                              ContextChip, viewContextCapture(.test)
  session/                  ← SessionProvider, sessionRegistry(.test), sessionSnapshot(.test),
                              cosmosConversation(.test), CosmosTimelineEntry
  tabs/                     ← panelTabs(.test), usePanelTabs, PanelTabStrip, useGenerativePanelTabs,
                              perTabNav(.test), usePerTabNav, closeTabRouting(.test),
                              useTabShortcuts(+.dom.test), cosmosTabs(.test),
                              TerminalTabNavRouting.dom.test
  composer/                 ← PromptComposer, PromptComposerDocked.dom.test, promptComposerLogic(.test),
                              activeComposer(.test), ActiveComposerProvider, OpenPromptPositionProvider,
                              openPromptPosition(.test)
  generative/               ← ActiveTabSurface, activeTabSurfaceRefresh(.test), dataModelApply(.test),
                              panelRefreshLogic(.test), PanelRefreshButton, catalogShared/
  terminal/                 ← TerminalPanel(.tsx + .css), terminalTheme(.test), terminalKeymap(.test)
  fileExplorer/             ← MOVED AS-IS (already grouped)
  slack/                    ← SlackPanel, slackComposerLogic(.test), slackThreadPanelLogic(.test),
                              slackChannelSearchLogic(.test), slackScrollToLatest(.test),
                              useSlackScrollToLatest(+.dom.test), slackScrollPaginate(.test),
                              useSlackScrollPaginate.dom.test, + slackCatalog/ (nested or sibling)
  jira/                     ← JiraPanel, atlassianPanelBits, + jiraCatalog/
  confluence/               ← ConfluencePanel, + confluenceCatalog/   (atlassianPanelBits is shared
                              Jira+Confluence — keep in jira/ or a shared atlassian/; see OQ)
  calendar/                 ← GoogleCalendarPanel, calendarNavLogic(.test), + googleCalendarCatalog/
  cosmos/                   ← CosmosPanel  (+ cosmosConversation if not in session/; see OQ)
  confirm/                  ← confirmLogic(.test), useConfirm   (or fold into app/)
```

### `src/main/` (preserve `integrations/`)

```
src/main/
  index.ts                 ← stays at root (main entry; rollup input.index)
  integrations/            ← UNTOUCHED (already grouped)
  pty/                     ← ptyManager(.test), paneSpawn(.test), processGroupKill(.test),
                              orphanReaper(.test), sessionLockRecovery(.test)
  agent/                   ← agentRunner(.test), agentSessionStore(.test), agentSessionQueue(.test)
  session/                 ← sessionStore(.test), sessionSnapshot(.test)
  fs/                      ← fsExplorer(.test), pathConfine(.test), fileKind(.test),
                              localFileRef(.test), localFileProtocol(+.integration.test),
                              viewerKind(.test), viewerCaps(.test), transcriptReader(.test),
                              transcriptParse(.test)
  generative/              ← uiBridge(.test), descriptorShell(.test), descriptorRegistration(.test),
                              adapterDispatcher(.test), adapterBindingRegistry, specRebinder(.test),
                              dataBearingWarning(.test), pendingCalls(.test),
                              refreshRepaintIntegration.test, viewContextGrounding(.test)
  mcpConfig(.test)         ← stays near index.ts (or in a small config/ folder)
  clientConfig*            ← clientConfigResolver(.test), clientConfigMutate(.test)  (settings/oauth)
  shortcutMatch(.test)     ← (fold into app/ or a small util/)
  slack/                   ← slackBridge(.test), slackManager(.test), slackAdapter(.test),
                              slackSurfaceBuilder(.test), slackImageRef(.test), slackImageProtocol
  jira/                    ← jiraBridge(.test), jiraManager(.test), jiraAdapter(.test),
                              jiraActionDispatcher(.test), jiraSurfaceBuilder(.test)
  confluence/              ← confluenceBridge(.test), confluenceAdapter(.test),
                              confluenceSurfaceBuilder(.test), confluenceImageRef(.test),
                              confluenceImageProtocol
  calendar/                ← googleCalendarBridge(.test), googleCalendarManager(.test),
                              googleCalendarSurfaceBuilder(.test), googleCalendarWindow(.test)
```

### `src/shared/` (preserve `ipc/`)

```
src/shared/
  ipc.ts  validate.ts      ← barrels stay at root (consumers import '../shared/ipc')
  ipc/                     ← UNTOUCHED (per-domain modules)
  bridge(.test)            ← socket framing (stays at root or core/)
  adapter.ts  dataBearingSpec(.test)  conversation.ts   ← generative contract types
  types/ (or per-domain)   ← jira.ts, slack.ts, confluence.ts, googleCalendar.ts,
                              googleCalendarColor(.test)
  validate*.test.ts        ← the many top-level validator tests stay beside what they exercise
                              (most exercise the ipc/ barrels — keep at shared root next to validate.ts)
```

### `src/mcp/`

```
src/mcp/
  renderUiServer.ts, jiraRenderUiServer.ts, slackRenderUiServer.ts,
  confluenceRenderUiServer.ts, googleCalendarRenderUiServer.ts,
  jiraMcpServer.ts, slackMcpServer.ts, confluenceMcpServer.ts, googleCalendarMcpServer.ts,
  uiCatalog(.test), confluenceToolDescription(.test)
```

`src/mcp/` is only 13 files and is tightly coupled to rollup-input keys + `mcpConfig.ts`
output-filename lookups. **Recommendation: leave `src/mcp/` flat** (low file count, high config
coupling, low confusion benefit). If grouped, the entry-script output names MUST stay stable
(FR-009). This is captured as an Open Question, not a hard requirement.

## Success Criteria

| ID     | Criterion                                                                                   |
|--------|---------------------------------------------------------------------------------------------|
| SC-001 | `npm run typecheck` passes (both `typecheck:node` and `typecheck:web`).                      |
| SC-002 | `npm test`, `npm run test:dom`, and `npm run test:integration` all pass, running the **same set of tests** (same count) as before the move. |
| SC-003 | `npm run build` succeeds and all expected MCP server bundles are emitted to `out/main/mcp/` with their original filenames. |
| SC-004 | `npm run dev` launches; every surface (terminal, file explorer, Slack, Jira, Confluence, Google Calendar, cosmos panel, settings, open-prompt composer) behaves identically to pre-restructure. |
| SC-005 | `git diff` shows **only** file relocations + import-path/config edits — no logic diffs, no symbol renames, no signature changes, no dependency changes (verifiable by reviewing the diff). |
| SC-006 | `src/renderer/components/` is byte-for-byte unchanged (Phase 2 untouched).                   |
| SC-007 | `docs/PROJECT-STRUCTURE.md` is regenerated to match the new tree; `docs/ARCHITECTURE.md` §4.6 still maps the four process roles to the (nested) tree accurately. |
| SC-008 | Every test file remains co-located in the same folder as its source module.                 |

---

## Open Questions

> Each lists the architect's recommended default so this does not block planning.

- [ ] **Folder-name + nesting taxonomy for renderer.** The tree above is the recommendation
  (domain folders: `app/ session/ tabs/ composer/ generative/ terminal/ slack/ jira/
  confluence/ calendar/ cosmos/`). **Recommended default: adopt as-is.** Sub-question: should
  the existing catalog folders (`slackCatalog/`, `jiraCatalog/`, etc.) be **nested inside**
  their domain folder (`slack/slackCatalog/`) or sit as **siblings**? *Recommendation: nest
  them under the domain folder* (e.g. `slack/catalog/` or keep `slack/slackCatalog/`) so a
  domain is one self-contained folder — but renaming `slackCatalog`→`catalog` is a folder
  rename only, still pure. Lowest-risk fallback: keep catalog folders as siblings to minimize
  churn.

- [ ] **Where does shared Jira+Confluence renderer code live?** `atlassianPanelBits.tsx` is
  used by both `JiraPanel` and `ConfluencePanel`. *Recommendation: a small `atlassian/` folder
  (or keep in `jira/` and import across).* Either is pure.

- [ ] **How aggressively to nest `src/main/` and group tiny one-off files** (`shortcutMatch`,
  `clientConfig*`, `mcpConfig`). *Recommendation: group the clear domain clusters
  (slack/jira/confluence/calendar/pty/agent/fs/generative) and leave a thin set of cross-
  cutting files (`index.ts`, `mcpConfig`, `shortcutMatch`, `clientConfig*`) near the root or in
  a small `config/`+`util/` folder rather than over-engineering folders for single files.*

- [ ] **Restructure `src/mcp/` or leave flat?** *Recommendation: leave flat* (13 files, high
  config coupling per FR-009, minimal find-ability benefit).

- [ ] **Sequencing vs other in-flight work.** This is a working-tree-wide move; landing it on a
  dirty tree causes wide conflicts. *Recommendation (for orchestrator, not decided here): land
  this on a clean tree and pause concurrent edits to `src/**` for the duration; in particular
  coordinate with `design-foundation-v1`, which is the Phase-2 dependency and also edits
  renderer files.*
