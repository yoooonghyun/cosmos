# cosmos — Development Conventions & Gotchas

Detailed development policy for the cosmos codebase. The authoritative design is
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (architect-owned); this document is the developer-facing
catalogue of conventions and hard-won gotchas. The file-by-file source map lives in
[`PROJECT-STRUCTURE.md`](./PROJECT-STRUCTURE.md).

## Build, native modules & dev loop

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
- **Run only ONE `npm run dev` at a time.** A second instance binds the next port (`5173` →
  `5174`) and opens its OWN Electron window wired to its OWN Vite server. If two are running, the
  window you're looking at may be the stale one, so HMR edits appear to "do nothing" no matter what
  you change. Symptom: code/CSS clearly correct but the app never updates. Check `lsof -iTCP:5173-5174
  -sTCP:LISTEN` / `ps aux | grep electron-vite`, kill the extras, keep a single instance.

## Security & IPC boundary

- **Window security baseline:** `contextIsolation: true`, `nodeIntegration: false`. `sandbox`
  is intentionally `false` so the preload can use `ipcRenderer` reliably; the renderer still
  only sees the `pty` channels.
- All cross-process IPC payloads are validated at the main-process boundary; invalid payloads
  log a warning and are safely ignored (never crash).
- **Provider OAuth differs per IdP.** Slack permits secret-less public-client PKCE; **Atlassian
  Cloud 3LO is a confidential client and requires a `client_secret`** at token+refresh exchange.
  Integrations attempt secret-less first, then fall back to an env-var secret (main-process only,
  never logged or sent off-process). Don't assume a new provider works secret-less.
- **Integration tokens live only in main, encrypted at rest** (`safeStorage`), and are never
  exposed to the renderer or the embedded `claude` sandbox in plaintext — never placed in any IPC
  payload, bridge frame, MCP result, or A2UI surface. The Atlassian Cloud 3LO `client_secret`
  (`COSMOS_ATLASSIAN_CLIENT_SECRET`) is read from a gitignored `.env` in the **main process only**,
  stays strictly within main alongside the encrypted tokens, and is **never logged, never placed in
  any IPC payload, bridge frame, or MCP result**.

## MCP servers & bridges

- **Adding an MCP server** (stdio entry under `src/mcp/`) requires a matching rollup `input`
  in `electron.vite.config.ts` so it builds to `out/main/mcp/<name>.js` — the path
  `embeddedMcpConfig` registers. Without the input the server silently never gets bundled.
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

## A2UI catalogs & action routing

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
- **A catalog action is routed by the panel's `onAction` return value: `true` = handled
  renderer-locally (never forwarded), `false` = forward to main.** A catalog component emits a bound
  action via `useDispatchAction`; the SDK pipes it `A2UIRenderer onAction → ActiveTabSurface →` the
  panel's `onAction` handler. There are TWO kinds of action and the boundary is the return value:
  (1) a **renderer-local NAV action** (e.g. Slack `SLACK_OPEN_CHANNEL_ACTION`, Jira
  `jiraNav.openDetail`) drives panel `view`/navigation state in the renderer and returns `true` so it
  is NEVER sent to main as a `ui:action` and never reaches the agent; (2) a **main-dispatched WRITE
  action** (the reserved `jira.*` namespace — transition/comment/create/update) returns `false`, flows
  to main, and is executed deterministically by `JiraActionDispatcher`. Give nav actions a
  NON-`jira.`-prefixed name so they can never be mistaken for the reserved write namespace (a leak to
  main is a safe no-op anyway — `validateJiraBoundAction` returns `null` for an unknown `jira.*` name).
  Panel `view` chrome (e.g. a back row) lives OUTSIDE the `A2UIProvider` and resets on `activeTabId`
  change so it doesn't bleed across tabs; the action carries its target id in `action.context` (e.g.
  `{ issueKey }`) since catalog components have no panel callback prop.

## Panel tabs & per-tab render routing

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
  (`!activeTab || (!activeTab.surface && !activeTab.error)`), not on zero tabs. **The native-base
  browser's own nav must be held PER-TAB, never panel-level `useState`** — Slack's `view`/`searchText`
  and Confluence's `view`/`searchText`/`query` are kept in a `Record<tabId, N>` via `perTabNav.ts`
  (pure: `getNav`/`setNav`/`dropNav`/`clearAllNav`) + the `usePerTabNav.ts` hook, so each tab navigates
  independently (a single shared `useState` made every tab show the same drill-in). Drop a tab's entry
  on close; `clearAllNav()` on a connection transition (connect/disconnect/refresh) resets all tabs.
  For Jira the base IS the
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

## Session persistence (session-persistence-v1)

The working session (all rail panel tabs, composed generated-UI surfaces, terminal `claude`
sessions) is snapshotted to disk in main so a full quit/relaunch restores it. The contract is the
single new `window.cosmos.session` namespace in `src/shared/ipc.ts` (`session:load` via `invoke`,
`session:save` via `send`).

- **Plain UNENCRYPTED JSON, atomic, under `userData`.** The snapshot is `session.json` in
  `app.getPath('userData')`, written by `SessionStore` (`src/main/sessionStore.ts`) as
  `session.json.tmp` then `renameSync` over the target (atomic, never a half-written file). NO
  `safeStorage` — the snapshot is non-secret by construction (decision D1). `SessionStore` takes an
  injectable `SessionFsLike` (the tokenStore `FsLike` shape + `renameSync`) so it is node-testable.
- **No secrets in the snapshot, EVER — enforced structurally, not by a filter.** The schema
  (`SessionSnapshot`, `schemaVersion = SESSION_SCHEMA_VERSION`) only has fields for non-secret
  tab/terminal structure + composed-surface specs. A generative tab's surface is persisted ONLY when
  `composed === true` (the structural discriminator): live integration-data views (`composed:false`,
  Jira/Slack/Confluence default/search) are NOT a storable shape, so they rehydrate to base and
  re-fetch. Tokens, the Atlassian `client_secret`, and OAuth material live only in main's tokenStore
  and never enter any session payload. `sessionStore.test.ts` SC-004 asserts no
  `accessToken`/`refreshToken`/`client_secret`/`Authorization` ever reaches disk.
- **Validate at BOTH boundaries; never crash, never clobber a good snapshot.** `validateSnapshot`
  lives in `src/main/sessionSnapshot.ts` (NOT `src/shared/validate.ts` — shared cannot import main,
  and snapshot validation is a main-only boundary concern; this is a deliberate deviation from the
  plan's checklist). On `save`, an invalid/old-schema/corrupt payload → warn + ignore + KEEP the
  existing file. On `load`, a missing/corrupt/unknown-version file → warn + clean empty session
  (`emptySnapshot`). Bad individual tabs are dropped, not fatal.
- **Main owns the terminal session id (decision D2).** The renderer never mints or sees the `claude`
  session UUID. Main keeps `terminalSessionMap` (paneId → `{sessionId, cwd}`) and `terminalResumeMap`
  (paneId → queued resume). `paneSpawnFor(paneId, sandboxDir)`: if a resume is queued (re-seeded from
  the loaded snapshot's terminal tabs) it spawns `claude --resume <id>` with `resume:true`; otherwise
  it mints `randomUUID()` and spawns `claude --session-id <uuid>`. On `session:save` the renderer
  sends terminal tabs WITHOUT sessionId/cwd; `enrichSnapshotForSave` fills them from
  `terminalSessionMap`, DROPS tabs whose pane has no live session (not resumable), prunes a dangling
  `activeTabId`, then runs `validateSnapshot`. (Renderer-can't-know-the-id is why enrichment is a
  second deviation from the plan's "renderer assembles the whole snapshot" wording.)
- **Resume-failure fallback (OQ-1).** If a `--resume`d pane exits abnormally inside
  `RESUME_FAILURE_WINDOW_MS` (4s), `PtyManager` suppresses the normal `onExit` and calls
  `onResumeFailure(paneId)`; main re-mints a fresh `--session-id` and restarts ONCE. The restored
  read-only scrollback stays visible. `PtyManager` takes injectable `spawn`/`now` for testing.
- **Scrollback via `@xterm/addon-serialize`, capped 256KB (D4/D5).** Each `TerminalView` registers a
  serializer (`() => capScrollback(serializeAddon.serialize())`); `capScrollback` keeps the
  most-recent ≤256KB on a UTF-8 boundary. On restore, scrollback is pre-written before `pty:start`.
- **Renderer save coordinator.** `SessionProvider.tsx` builds one `SessionRegistry`
  (`sessionRegistry.ts`): each panel calls a stable `report(key, contribution)` (`useReportPanel`);
  contributions are merged by `assembleSnapshot` and trailing-debounced (`SAVE_DEBOUNCE_MS=600`)
  before `window.cosmos.session.save`. `flush()` forces an immediate save on `pagehide`/`beforeunload`.
  Panels read their slice via `useRestoredGenerativePanel(key)` / `useRestoredTerminalPanel()`; App
  loads once via `useLoadSession()` and shows a `CosmosSpinner` ("Restoring your session…") while
  loading (decision D3).
- **Restore seeding must stay StrictMode-pure.** Tabs are seeded from the snapshot via the lazy
  `useState`/`useRef` initializers only — `hydrateGenerativeTabs`/`hydrateTerminalTabs` are pure, and
  the monotonic `everOpened` counter is initialized AT `seedEverOpenedFrom(everOpened, tabCount)`
  (pure: floors to `max(tabCount, n≥0)`), never advanced in a render-phase initializer (see the
  terminal-tab-index-skip-v1 invariant below). `hydrateGenerativeTabs` re-instates each composed
  surface with a FRESH `requestId` (FR-013).

## React renderer

- **Never mutate persistent state from a render-phase `useState`/`useMemo`/`useReducer` lazy
  initializer.** The renderer runs under React **StrictMode** (`src/renderer/main.tsx`), which
  double-invokes component bodies AND lazy initializers in dev to surface impurity: the second result
  is discarded, but any side effect (e.g. a `useRef` mutation) PERSISTS. The Terminal panel seeded its
  first tab by calling an impure `mintTab()` that advanced the monotonic `everOpened` ref *inside* the
  `useState` initializer, so the ref advanced twice for one seed tab and the first `+` skipped to
  "Terminal 3" (terminal-tab-index-skip-v1). Keep the initializer referentially pure — derive the seed
  from a pure helper (`seedTerminalIndex()` → label via `terminalLabel`) and initialize the counter AT
  the seed index; advance the monotonic counter ONLY from event handlers / effects, which StrictMode
  does not double-invoke for this purpose. (Note: this is dev-only, but the impurity is a real defect.)

## Styling (Tailwind v4 + shadcn)

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
- **Nested Radix triggers collide on `data-state`.** Both `Tabs.Trigger` and `Tooltip.Trigger`
  write a `data-state` attribute; when one wraps the other with `asChild` (e.g. the rail in
  `App.tsx`: `TooltipTrigger asChild` → `TabsTrigger`), the outer trigger's props are spread AFTER
  the inner's explicit `data-state`, so the rendered `<button>` ends up with the *tooltip's*
  state (`closed`/`delayed-open`), NEVER `active`. Every `data-[state=active]:*` class then
  silently never matches (no specificity/`!important` can fix it — the attribute is just wrong).
  Drive such state from React instead (e.g. `surface === id`) and apply the active classes
  conditionally; don't rely on `data-[state=active]` on a tooltip-wrapped tab. Symptom: hover
  styling works (real `:hover`) but the selected/active styling does nothing.
- **Tailwind v4 `scale-*`/`translate-*`/`rotate-*` are NOT `transform`.** v4 compiles them to the
  standalone CSS `scale:` / `translate:` / `rotate:` properties, so `transition-[opacity,transform]`
  will NOT animate a scale or translate — only opacity moves and the size/position jumps. List the
  real properties: `transition-[opacity,scale,filter]` (add `filter` for `blur-*`). Symptom when
  wrong: an element fades but its size snaps instantly.
- **CSS enter/exit transitions need a persistent element.** Conditionally mounting/unmounting a node
  skips its transition (there is no "before" frame to animate from). To animate open/close, keep
  BOTH states always mounted in one slot and toggle classes via a flag; make the hidden one
  non-interactive and a11y-inert with `inert` + `pointer-events-none` + `tabIndex={-1}` +
  `aria-hidden` so focus/clicks/AT only reach the visible state (see `PromptComposer.tsx`).
- **Inline-SVG gradient ids must be per-instance.** A `<linearGradient id="…">` with a static id
  collides when the SVG is mounted more than once (all four panels mount `CosmosMark` at once);
  `url(#id)` resolves to the first/hidden def and the visible mark paints transparent. Derive the id
  from React `useId()`.
- **Brand pastel is a token, not inline hex.** The cosmos pink→purple identity lives in
  `--brand-pink` / `--brand-purple` / `--brand-foreground` (index.css); consume via `brand-*`
  utilities or `var(--brand-…)` (the `cosmos` Button variant, `CosmosMark`). Colors, type sizes, and
  z-order are design-system foundations — define them in the theme, never as one-off hex/arbitrary
  values in a component.

## Testing

- **vitest runs `*.test.ts` in node env (no jsdom).** Catalog component files (`components.tsx`)
  can't be imported by a `.test.ts` without a DOM, so put any unit-testable catalog logic in a
  plain `logic.ts` beside `components.tsx` and test that (`logic.test.ts`). Each catalog dir is
  `components.tsx` + `logic.ts` + `logic.test.ts` + `index.ts`. The same split is why pure tab
  logic lives in `panelTabs.ts` (node-testable) separate from `PanelTabStrip.tsx`.
