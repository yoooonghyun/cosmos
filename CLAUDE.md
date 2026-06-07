# CLAUDE.md

cosmos is a Conductor-style Electron app that embeds Claude Code as its engine: it shows
the real Claude Code TUI (node-pty + xterm.js) and renders agent-generated UI (A2UI).
See `docs/ARCHITECTURE.md` for the authoritative design.

## Commands

| Task | Command |
|------|---------|
| Install (auto-rebuilds node-pty) | `npm install` |
| Dev (launch app w/ HMR) | `npm run dev` |
| Build | `npm run build` |
| Typecheck (node + web) | `npm run typecheck` |
| Tests | `npm test` (vitest); `npm run test:watch` |
| Rebuild native module | `npm run rebuild` |

## Project structure

- `src/main/` — Electron main process: `index.ts` (window + IPC wiring), `ptyManager.ts` (PTY
  lifecycle), `agentRunner.ts` (headless `claude` for utterance→generative-UI runs), socket
  bridges (`uiBridge.ts`, `slackBridge.ts`, `jiraBridge.ts`, `confluenceBridge.ts`), integration
  managers (`jiraManager.ts`, `slackManager.ts`, `confluenceManager.ts`) + `integrations/`, and the
  deterministic `jira.*` write path (`jiraActionDispatcher.ts` + `jiraSurfaceBuilder.ts`)
- `src/preload/` — `contextBridge` preload exposing only the per-channel surfaces as `window.cosmos.*`
  (`pty`, `ui`, `slack`, `jira`, `confluence`)
- `src/renderer/` — React renderer; `App.tsx` is the app shell (left icon-rail **single-surface
  switcher** — one surface visible full-width, all kept mounted); `TerminalPanel.tsx` is the xterm.js
  terminal (one xterm per terminal tab); `GeneratedUiPanel.tsx`/`JiraPanel.tsx`/`SlackPanel.tsx`/
  `ConfluencePanel.tsx` are the rail surfaces (Jira/Slack/Confluence are all generative custom-catalog
  A2UI panels); each rail surface hosts its own **VS Code-style tabs** via `panelTabs.ts` (pure
  open/close/label logic) + `usePanelTabs.ts` (generic controller) + `PanelTabStrip.tsx` (reusable
  strip), and the generative panels share `useGenerativePanelTabs.ts` (originating-tab correlation) +
  `ActiveTabSurface.tsx` (per-tab A2UI host); `jiraCatalog/`, `slackCatalog/`, `confluenceCatalog/`
  are the per-panel A2UI custom catalogs; `components/ui/` is the shadcn set
- `src/mcp/` — standalone stdio MCP entry scripts (`renderUiServer.ts`, `jiraRenderUiServer.ts`,
  `slackRenderUiServer.ts`, `confluenceRenderUiServer.ts`, `jiraMcpServer.ts`, `slackMcpServer.ts`,
  `confluenceMcpServer.ts`) relaying to the main bridges
- `src/shared/` — code shared across processes: `ipc.ts` (typed IPC contract), `bridge.ts` (NDJSON
  socket framing), `validate.ts` (pure IPC payload validators), per-integration types (`jira.ts` etc.)

## Conventions & gotchas

- **node-pty is a native addon** — it must be rebuilt for Electron's ABI. `postinstall`
  runs `electron-rebuild -f -w node-pty`; if PTY fails to load, run `npm run rebuild`.
- **`claude` not found does NOT throw.** On macOS `node-pty`'s `spawn` does not throw
  synchronously for a missing binary — it spawns and exits with code 1 (no stderr). Pre-check
  the executable on PATH before spawning to surface a meaningful error.
- **Vite is pinned to 7**, not 8 — electron-vite 5 peer-requires `vite ^5||^6||^7`.
- **Preload changes need a full app restart, not HMR.** Vite HMR reloads only the renderer; the
  `contextBridge` preload bundle is loaded once when the BrowserWindow is created. So adding a new
  `window.cosmos.*` method (e.g. a new `pty.*` channel) while `npm run dev` is running makes the
  HMR'd renderer call a method the stale in-memory preload doesn't have yet → `window.cosmos.X is
  not a function`. Restart `npm run dev` to pick up preload edits; the error is not a code bug.
- **Window security baseline:** `contextIsolation: true`, `nodeIntegration: false`. `sandbox`
  is intentionally `false` so the preload can use `ipcRenderer` reliably; the renderer still
  only sees the `pty` channels.
- All cross-process IPC payloads are validated at the main-process boundary; invalid payloads
  log a warning and are safely ignored (never crash).
- **Adding an MCP server** (stdio entry under `src/mcp/`) requires a matching rollup `input`
  in `electron.vite.config.ts` so it builds to `out/main/mcp/<name>.js` — the path
  `embeddedMcpConfig` registers. Without the input the server silently never gets bundled.
- **Provider OAuth differs per IdP.** Slack permits secret-less public-client PKCE; **Atlassian
  Cloud 3LO is a confidential client and requires a `client_secret`** at token+refresh exchange.
  Integrations attempt secret-less first, then fall back to an env-var secret (main-process only,
  never logged or sent off-process). Don't assume a new provider works secret-less.
- **Tailwind v4 utilities lose to unlayered plain CSS.** Tailwind v4 emits utilities into
  `@layer utilities`; any *unlayered* rule (e.g. plain CSS in `App.css`) beats a layered utility
  **regardless of specificity**. So a Tailwind class like `data-[state=inactive]:hidden` cannot
  override `.app__ui { display: flex }` from a plain stylesheet — do the conflicting toggle in the
  same unlayered CSS (e.g. `.app__ui[data-state='inactive'] { display: none }`) instead.
- **shadcn vertical `Tabs` re-aligns triggers.** `TabsTrigger` base includes
  `group-data-[orientation=vertical]/tabs:justify-start` + `:w-full`. An unprefixed `justify-center`
  won't win (tailwind-merge can't dedupe a variant-prefixed vs unprefixed class, and the variant
  rule applies at runtime) — override with the **same** vertical variant
  (`group-data-[orientation=vertical]/tabs:justify-center`) to center icons in a vertical rail.
- **A2UI `Action.context` is typed narrower than the runtime.** The SDK types an action's
  `context` as `Record<string, DynamicValue>`, and `DynamicValue` only models primitives,
  `{ path }` bindings, and `FunctionCall` — NOT a nested literal object. But the runtime
  (`resolveContext`→`resolveValue`) passes any non-binding literal through verbatim, so a nested
  literal (e.g. the `jira.update` changed-`fields` diff object) DOES reach main intact. When a
  bound action must carry structured non-binding data, emit the literal and use a narrow,
  documented cast at the dispatch site — don't flatten it to satisfy the type.
- **A2UI custom catalogs are per-`<A2UIProvider>`, not global.** A `Catalog`
  (`{ components: Record<typeName, ReactComponentType>, functions: {} }`) is passed via the
  `catalog=` prop, so two panels can host different catalogs in independent React subtrees. The
  Jira panel registers `src/renderer/jiraCatalog/` this way; catalog components are plain cosmos
  React (they receive `{ surfaceId, componentId, ...nodeProps }`) and may use any Tailwind class
  incl. the `--status-*` tokens. Inputs bind via `useFormBinding`; actions emit via
  `useDispatchAction`. Render frames are **target-routed** (`UiRenderPayload.target`): each panel
  filters `ui:render` by its `target` so one render channel feeds multiple A2UI panels. The Jira,
  Slack, and Confluence panels each register their own catalog (`jiraCatalog/`, `slackCatalog/`,
  `confluenceCatalog/`).
- **Generative-UI panels are target-routed end to end.** A panel (Jira/Slack/Confluence) is
  generative when a `PromptComposer` utterance drives a headless `AgentRunner` run for that
  `target`. The per-target policy lives in `mcpConfig.ts` (`renderMcpConfigJsonForTarget`,
  `allowedToolForTarget`, `groundingPromptForTarget`): the run registers ONLY that target's render
  MCP server + that integration's READ tools (+ Jira writes for jira), grants only those via
  `--allowedTools`, and appends an anti-fabrication grounding prompt via `--append-system-prompt`
  (render only REAL fetched data; on not-connected/error render a single Notice). To add a panel:
  extend the `UiRenderTarget` union, add a scoped render entry under `src/mcp/` (+ rollup input +
  `embeddedMcpConfig` wiring), add `mcpConfig.ts` branches, add a `src/renderer/<x>Catalog/`, and
  give the panel a composer + target-filtered `SurfaceBridge`. **The Slack and Confluence generative
  panels are READ-ONLY** — their generative runs grant only read tools and have no deterministic
  action dispatcher (only Jira's panel writes). Confluence is read-only *as a generative panel* but
  the `cosmos-confluence` MCP server still exposes one **model-mediated write tool**,
  `confluence_create_page` (interactive-TUI-only: registered via `embeddedMcpConfig` but deliberately
  NOT in `CONFLUENCE_TOOL_GRANTS`, so the panel never gets it), gated by the `write:confluence-content`
  scope — the agent calls the tool directly and main attaches the token; there is no Confluence
  surface form or dispatcher. Two write patterns therefore coexist: Jira's deterministic action
  dispatch (UI control → main re-composes) and Confluence's model-mediated MCP write (agent calls a
  tool).
- **Display-only A2UI renders must be settled immediately by `UiBridge`.** A `render_*_ui` tool
  call blocks awaiting a user action; for a display-only surface the one-shot headless run would
  then hang forever and the panel spinner never stops. So `UiBridge.onMessage` settles any render
  whose `target !== 'generated-ui'` (`{ type: 'cancel' }`) right after `pushRender` — the run emits
  `completed`, the spinner stops, and the surface stays rendered. Only `'generated-ui'` keeps
  blocking to await the user's action on its control. Safe for Jira because `jira.*` actions are
  dispatched deterministically by main (`JiraActionDispatcher`), never returned to the render call.
- **vitest runs `*.test.ts` in node env (no jsdom).** Catalog component files (`components.tsx`)
  can't be imported by a `.test.ts` without a DOM, so put any unit-testable catalog logic in a
  plain `logic.ts` beside `components.tsx` and test that (`logic.test.ts`). Each catalog dir is
  `components.tsx` + `logic.ts` + `logic.test.ts` + `index.ts`. The same split is why pure tab
  logic lives in `panelTabs.ts` (node-testable) separate from `PanelTabStrip.tsx`.
- **Per-tab render routing is renderer-only and assumes sequential runs.** `UiRenderPayload` has
  NO tab/run field. Render frames still route panel→panel by `target`; the *tab* dimension is added
  entirely in the renderer (`useGenerativePanelTabs.ts`): the panel records the originating tab at
  submit, files the next matching `ui:render` for that `target` into it, and discards if that tab
  was closed. An UNSOLICITED frame (Jira's default-view request, the deterministic `jira.*`
  write re-push) has no originating tab → lands in the active tab / auto-creates one. **This is only
  correct because headless `AgentRunner` runs are sequential (one run app-wide, the §4.10 single-run
  guard).** If cosmos ever allows concurrent runs, this breaks — you'd need a per-run id on
  `UiRenderPayload` + `AgentSubmitPayload` to correlate. A fresh `+` tab shows the panel's BASE, not a
  blank panel — each generative panel gates its base on the active tab being empty
  (`!activeTab || (!activeTab.surface && !activeTab.error)`), not on zero tabs. For Jira the base IS the
  default board view, so each new Jira tab (first activation AND the `+` button) requests one
  `requestDefaultView()` through the shared hook's `newTabWithDefault(request)`. That request is ALSO an
  unsolicited frame, so it is fired immediately only when correlation is idle and DEFERRED (single slot,
  flushed on the next `agent:status` completed/error) while a compose is awaiting a frame — otherwise it
  races the in-flight compose for the shared `originatingTabIdRef` slot. Per-tab load state is
  `GenerativeTab.loadingDefault` (NOT a panel-wide flag — a panel-wide flag bugged out when a second tab
  loaded); the pure fire/flush decisions are `defaultRequestDecision`/`shouldFlushDeferredDefault` in
  `panelTabs.ts`. `cancelOnClose` nuance: only `'generated-ui'`
  render_ui calls block in main awaiting a user action, so closing that tab sends `{type:'cancel'}`;
  the other three targets are settled immediately by `UiBridge`, so they pass `cancelOnClose:false`.
- **The panel tab strip is bespoke, not the shadcn `Tabs` primitive.** `PanelTabStrip.tsx` is a
  hand-rolled variable-width strip (click-to-switch, per-tab `X`, trailing `+`, horizontal overflow
  scroll). The shadcn `Tabs` primitive is an equal-width segmented control already used by the left
  icon-rail switcher — don't reach for it here. Pure tab-collection logic (`openTab`/`closeTab` with
  right-else-left adjacent activation, label helpers, monotonic `nextTerminalIndex`) is in
  `panelTabs.ts`; `usePanelTabs.ts` is the generic controller hook; `useGenerativePanelTabs.ts` adds
  the originating-tab correlation; `ActiveTabSurface.tsx` is the shared per-tab A2UI host.
- **PTY is multi-session, keyed by a renderer-minted `paneId`.** `PtyManager` is `Map<paneId, IPty>`;
  every `pty:*` IPC payload carries a `paneId`. `pty:start` (R→M, spawn a pane) and `pty:dispose`
  (R→M, kill on tab close) are explicit channels; `pty:restart` is per-pane; `killAll()` runs on
  teardown. **There is NO single-PTY auto-start at window creation** — each Terminal tab issues its
  own `pty:start`. The Terminal panel mounts one xterm `Terminal` per tab (all kept mounted so live
  sessions + scrollback survive tab/rail switches) and always keeps ≥1 terminal (closing the last
  opens a fresh one).

## Workflow

- Feature work follows the **`sdd`** skill (specify → plan → [design] → interface → test → implement → wrap-up).
- Specs/plans and `docs/ARCHITECTURE.md` are owned by the **`architect`** agent;
  implementation (interface/tests/code) by the **`developer`** agent. The **`wrap-up`**
  skill propagates end-of-iteration learnings into the living docs and reconciles `TODO.md`.
- **UI-bearing features add a design step** (the **`design`** skill, owned by the
  **`designer`** agent) between plan and interface: it establishes/extends the Tailwind +
  shadcn/ui design system and produces a design spec (`.sdd/designs/<feature>-v<N>.md`) so
  every surface stays visually uniform. Skip it for purely non-visual (main/IPC/MCP) work.
  The designer owns the theme tokens + `src/renderer/components/ui/`; build wiring (installs,
  shadcn CLI) is done by the developer/main session since the designer has no Bash.
- `TODO.md` is the living, milestone-level checklist of outstanding work; the `wrap-up` skill
  keeps it current (checks off completed items, adds newly surfaced work).
- Do not commit unless explicitly asked.
