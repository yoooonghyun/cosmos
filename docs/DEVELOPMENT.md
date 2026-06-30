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
- **The IPC contract is split per-domain behind same-path barrels (ipc-modular-refactor-v1).**
  `src/shared/ipc.ts` and `src/shared/validate.ts` are now thin RE-EXPORT barrels over per-domain
  modules in `src/shared/ipc/` (`common`/`pty`/`ui`/`agent`/`shortcut`/`slack`/`jira`/`confluence`/
  `googleCalendar`/`session`/`settings`, each with a sibling `*.validate.ts`). The barrel paths are
  unchanged, so every consumer keeps importing from `../shared/ipc` / `../shared/validate` (zero
  import churn). Add a new channel/payload to its DOMAIN module (and its validator to the matching
  `*.validate.ts`), NOT to the barrel; shared predicates reused across domains live in
  `common.validate.ts`. `ipc.ts` assembles the `CosmosApi` type; `SESSION_SCHEMA_VERSION` stays in
  the session module. A `channelUniqueness.test.ts` guards against duplicate channel strings.
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
- **The render surface is TWO tools: `get_ui_catalog()` + `render_*_ui(spec)`**
  (ui-catalog-pull-spinner-signal-v1). The A2UI catalog text is single-sourced in
  `src/mcp/uiCatalog.ts` (`A2UI_CATALOG_TEXT` + `registerGetUiCatalogTool`) and registered
  BYTE-IDENTICALLY in all five render servers — the render tool's own description is SLIMMED so
  the agent must pull the catalog first. **A new render server MUST also**: (1) call
  `registerGetUiCatalogTool(server, { onGenerating: () => void bridge.notifyGenerating(<target>) })`,
  (2) add a `BridgeClient.notifyGenerating(target?)` that writes a fire-and-forget
  `{ kind:'generating', callId, target }` frame over the SAME `UiBridge` socket (swallow errors —
  a missing bridge must NOT fail the catalog return), (3) grant its `get_ui_catalog` tool in
  `allowedToolForTarget` and add the catalog-pull clause in `groundingPromptForTarget`. The
  `get_ui_catalog` pull is the EARLY "UI generation has begun" signal: `UiBridge` forwards it as the
  `ui:generatingBegin` IPC (target-only, non-secret) which the renderer uses to turn the originating
  tab's spinner ON (`useGenerativePanelTabs` + `inFlightOnSubmit()` now returns `false`). No new
  server FILE is added for get_ui_catalog (existing servers extend), so NO new rollup input is
  needed. **`window.cosmos.ui.onGeneratingBegin` is a NEW preload method — a full `npm run dev`
  restart is required (HMR leaves it "not a function").**
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
  the `cosmos-confluence` MCP server exposes **model-mediated write tools** (interactive-TUI-only:
  registered via `embeddedMcpConfig` but deliberately NOT in `CONFLUENCE_TOOL_GRANTS`, so the panel
  never gets them) — the agent calls them directly and main attaches the token; there is no Confluence
  surface form or dispatcher. The write set (confluence-mcp-write-v1) is `confluence_create_page`
  (POST `/wiki/api/v2/pages`), `confluence_update_page` (PUT `/wiki/api/v2/pages/{id}`), and
  `confluence_create_comment` (POST `/wiki/api/v2/footer-comments`). Page create/update are gated by
  `write:page:confluence`; the comment tool is gated by a SEPARATE `write:comment:confluence` scope
  (added to `CONFLUENCE_OAUTH_SCOPES` — existing users must disconnect + reconnect to grant it, else
  the tool short-circuits to `write_not_authorized`). **Gotcha — v2 update is optimistic-locked:**
  `ConfluenceClient.updatePage` first reads the page with `body-format=storage&version=true` (NOT the
  public `getPage`, which requests `view` HTML that is not a re-submittable storage body and drops the
  version), then PUTs `version.number + 1`. An omitted/empty body re-sends the read storage body
  (never wipes); a stale-version 409 (or 400 with a version-mismatch body) maps to the new
  `version_conflict` `ConfluenceErrorKind` (recoverable "re-read and retry"). Two write patterns
  therefore coexist: Jira's deterministic action dispatch (UI control → main re-composes) and
  Confluence's model-mediated MCP writes (agent calls a tool).
- **A composer run also carries the active panel's view context (open-prompt-view-context-v1).**
  When a `PromptComposer` utterance is sent, the panel's CURRENT non-secret selection (open Jira
  ticket / Slack channel+thread / Confluence page / Calendar event) rides along as an optional
  `viewContext` on `AgentSubmitPayload` so deictic utterances ("fix **this** ticket") resolve.
  Rules: (1) capture is at SEND time — `useGenerativePanelTabs` calls a per-panel `getViewContext()`
  provider (read through a ref so `submit` stays stable; each panel updates a live-selection ref
  because its nav state comes from `usePerTabNav` defined AFTER the hook). (2) `viewContext` is
  DATA-ONLY non-secret labels (pure mappers in `src/renderer/app/viewContextCapture.ts`); validated
  warn-and-ignore at the main boundary (`validateViewContext`) — an invalid value is DROPPED while
  the run still starts (never `null`s the payload). (3) it is delivered as GROUNDING, not by
  mutating the utterance: `AgentRunner.run`'s 3rd arg feeds `viewContextGroundingClause(target, vc)`
  (`src/main/generative/viewContextGrounding.ts`), which `composeGroundingPrompt` joins with the per-target
  grounding into ONE `--append-system-prompt`; the `-p` utterance stays byte-for-byte. (4) it NEVER
  broadens tool grants — context-only. (5) the visible chip below the textarea is `ContextChip.tsx`
  (Badge/Button/Tooltip composite, NOT a `components/ui/` primitive); dismissing it threads a
  per-compose `contextDismiss` ('none'|'thread'|'all') through `onSubmit(value, { contextDismiss })`,
  and the hook strips the dropped dimension before attaching. generated-ui carries no selection (no
  chip, no `viewContext`). To extend to a new panel: add a mapper + chip case in
  `viewContextCapture.ts`, a clause branch in `viewContextGrounding.ts`, and pass `getViewContext` +
  `contextChip` from the panel — never put a secret on `ViewContext`.
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
  Jira panel registers `src/renderer/jira/jiraCatalog/` this way; catalog components are plain cosmos
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
  `jiraNav.openDetail`) drives panel navigation state in the renderer and returns `true` so it
  is NEVER sent to main as a `ui:action` and never reaches the agent; (2) a **main-dispatched WRITE
  action** (the reserved `jira.*` namespace — transition/comment/create/update) returns `false`, flows
  to main, and is executed deterministically by `JiraActionDispatcher`. Give nav actions a
  NON-`jira.`-prefixed name so they can never be mistaken for the reserved write namespace (a leak to
  main is a safe no-op anyway — `validateJiraBoundAction` returns `null` for an unknown `jira.*` name).
  Per-tab navigation chrome lives OUTSIDE the `A2UIProvider` and is keyed on `activeTabId` (via
  `usePerTabNav`) so it doesn't bleed across tabs; the action carries its target id in `action.context`
  (e.g. `{ issueKey }`) since catalog components have no panel callback prop.
- **Side-dock detail idiom (Jira `JiraDetailDock`, Slack thread, calendar event-detail):** a drill-in
  detail opens in a transient RIGHT-side dock BESIDE the still-visible list, NOT a whole-panel view
  swap. Mechanism (no new IPC channel / fetch / scope): the `jiraNav.openDetail` nav action sets a
  per-tab dock slot (`usePerTabNav` — clicking another card RETARGETS the single dock) and fires the
  existing deterministic detail read; the resulting UNSOLICITED `ui:render` frame is routed to the dock
  slot — not the list — by `useGenerativePanelTabs`'s `onUnsolicitedFrame` hook, discriminating on the
  spec's `surfaceId` (`isDetailSurfaceSpec`, `surfaceId === 'jira-issue-detail'`). The dock body hosts a
  SECOND `A2UIProvider key={`${tab.id}:detail`}` through the SAME catalog, so the detail's write controls
  still flow to main and a write re-pushes a fresh detail into the SAME slot (the dock stays open). Fire
  the read via the hook's `fireOrDefer` (not `requestDefaultInActiveTab`) so it keeps the FR-009
  fire-or-defer discipline WITHOUT marking the list tab `loadingDefault` (which would skeleton the still-
  visible list). The dock is transient — closes on X, scrim click, tab switch (`usePerTabNav` auto-reset),
  and disconnect (`clearAll`). Layout: `@container/jirabody` two-pane, list `min-w-0 flex-1`, dock an
  overlay drawer below `32rem` flipping to side-by-side at `@[32rem]/jirabody`.
- **A renderer-local nav action MAY carry a whole structured object in `action.context` (e.g. Google
  Calendar `calendarNav.openDetail` carries `{ event }`), but the `dispatch` context type is flat
  `Record<string, DynamicValue>` — cast it `as unknown`.** This is safe ONLY because the action is
  renderer-local: the panel's `onAction` intercepts it and returns `true`, so it NEVER crosses IPC or
  is serialized. The SDK's `resolveContext`/`resolveValue` passes a value that is neither a `{ path }`
  binding nor a `FunctionCall` through UNCHANGED, so the structured object reaches the handler intact.
  Do NOT do this for a `false`-return (main-forwarded) action — that one IS serialized to a `ui:action`
  and must stay flat/secret-free.
- **To open an external URL in the system browser from a catalog/panel, render a plain
  `<a target="_blank" rel="noreferrer">` and let `webContents.setWindowOpenHandler` (in `createWindow`)
  route it to `shell.openExternal` + `return { action: 'deny' }` — do NOT add a new `openExternal` IPC
  channel.** The handler guards to `http(s)` (no `file:`/`javascript:`). The per-integration
  `openExternal` you'll see in `index.ts` is the OAuth-flow callback, NOT a renderer-facing channel;
  the window-open handler is standard Electron window config, not IPC, so it honors the one-IPC-contract
  rule while still leaving the app for the link (Google Calendar event-detail "Open in Google
  Calendar"). The URL must be non-secret (the calendar's public `htmlLink`, never a token-bearing URL).
- **To push PANEL-owned state/handlers DOWN into a catalog component, use a React Context, NOT
  surface props.** Catalog components are rendered by `A2UIRenderer` from the surface JSON, so their
  props come from the surface node — the panel cannot hand them a callback or live React state via the
  node. When a catalog component needs panel-owned wiring (e.g. the Google Calendar month/year nav
  cluster needs the panel's per-tab displayed-month intent + nav handlers, which must survive the
  `A2UIProvider key={tab.id}` remount and so cannot live inside the catalog component), define a small
  context (`googleCalendarCatalog/navContext.ts`: `CalendarNavContext` + `useCalendarNav()`), have the
  panel wrap its `<A2UIProvider>` in the `Context.Provider`, and have the catalog component read it with
  the hook. Gate the value to NULL for surfaces that should not get the behavior (the calendar passes a
  non-null value only for the LIVE default view — `isConnected && surface != null && composed === false`
  — so composed snapshots + disconnected states render the plain label with no controls). This keeps the
  surface builder + the agent/MCP render path untouched (no panel-only field bleeds into the surface
  JSON). Distinct from the OUTSIDE-the-provider chrome above: use that when the chrome is NOT part of the
  catalog component; use the context when the panel state must reach INTO a catalog component.
- **The un-bound default view's refresh is panel-driven, not `adapter.refresh`.** `PanelRefreshButton`
  is descriptor-gated — `derivePanelRefreshState` returns `enabled:false` for a surface with no
  `descriptor`/`bindings` (the Google Calendar live default view is un-bound). To make that button
  refresh such a surface, pass the OPTIONAL `onRefresh` override prop (calendar-month-year-nav-v1): when
  supplied it ENABLES the button and the click calls `onRefresh()` (the panel re-issues its own request,
  e.g. `requestDefaultView(toWirePayload(intent))`) instead of dispatching `adapter.refresh`. Composed/
  bound surfaces omit the override and keep the unchanged descriptor path. No second visual control.
- **When a catalog field becomes a click target, its MCP tool description MUST teach the agent that
  field's real semantics.** A generative catalog's rows are AGENT-COMPOSED JSON — the model fills each
  field from the `render_*_ui` tool description, not from the integration's read result directly. So the
  moment a field starts driving a real call (e.g. `SearchResultRow.id` → `getPage(id)`), the tool
  description (`confluenceToolDescription.ts` etc.) must (a) state the field is the REAL id from the read
  tool (`confluence_search_content`), NOT a positional index, (b) use a realistic id-shaped example value
  (a positional `"id": "1"` teaches the model to emit `"1"`, `"2"`, … → an invalid-id API call), and
  (c) drop any stale "DISPLAY-ONLY / no actions" wording. A bad agent id is the cause of the
  `confluence-detail-rich-render-v1` HTTP-500: the native panel never hit it (real ids from a direct
  read), only the agent-composed surface did. A renderer guard can't rescue this (a positional "1" is a
  valid-looking non-empty numeric string) — the fix is the description + a graceful `getPage`-error path.

## Generative adapter — bound surfaces, descriptors & AdapterDispatcher (jira-generative-adapter-v1)

The API→UI generative adapter turns a one-shot composed surface into a **live, refreshable,
paginated** one WITHOUT re-running the agent or re-composing the view. It is **shared infra** —
Slack/Confluence reuse items 1-6 below and supply only their own builders/descriptors/resolvers/
catalog components. Jira is the first concrete cycle; **Slack and Confluence are the two sibling
cycles and the set is now closed — all three integrations ride the shared infra with NO change to
the shared contract.** Slack and Confluence are **read-only** (refresh + pagination only, never the
Jira write-reconciliation path); Confluence is **append-only** for its two lists and `none` for its
detail.

- **One dispatcher, a COMPOSITE resolver (`src/main/index.ts`).** The Slack, Confluence, and Jira
  `dataSource` namespaces are disjoint, so the composite resolver selects the panel resolver by
  source: Slack selector first, then Confluence (`confluenceBindOptionsForSource`), else Jira (the
  fallback also catches an unknown source → a recoverable Jira notice, never a throw). The same
  selector chain drives the lazy re-registration bind-options pick. **Create `confluenceManager`
  BEFORE the `AdapterDispatcher`** so its resolver is available to the composite (it used to be
  constructed after).
- **Confluence specifics (`confluenceAdapter.ts` / `confluenceSurfaceBuilder.ts`).** Sources:
  `defaultFeed` (cursor-ONLY — the personal CQL stays in `ConfluenceClient.defaultFeed`, never in the
  descriptor, FR-007), `searchContent` (`{ query, cursor? }`), `getPage` (`{ pageId }`). ONE bound
  `SearchResultList` backs BOTH the default feed (`/feed`) and search results (`/results`) — the
  builder seeds different descriptor + paths, NOT a second component. The bound `PageDetail`
  (`pagination:'none'`) binds `title`/`space`/`body` to `/page` sub-paths (refresh-only, no
  load-more). NO name-resolution step (Confluence rows carry no user-id, unlike Slack's `getUser`).
  Cursor is the opaque forward `_links.next` (`cursorFromNextLink` → `nextCursor`); `hasMore` =
  `nextCursor` present; `hasPrev` unused; no `PaginationBar` registered in `confluenceCatalog/index.ts`.

- **Bound surface = view composed once, data refreshed in place.** A bound surface's spec carries
  `{path}` bindings (NOT literal data props); its data lives in the A2UI **data model** and is
  updated via `updateDataModel` keyed by `surfaceId` — the view is never re-composed. The composer
  (`jiraSurfaceBuilder.buildBoundIssueListSurface`/`buildBoundIssueDetailSurface`) returns a
  `JiraBoundSurface { spec, dataModel, descriptor }`: the data-free spec, the INITIAL data-model seed
  (first page + flags), and a secret-free descriptor. The detail binds EVERY display value to a
  `/issue` sub-path (`/issue/description`, `/issue/comments`, `/issue/key`, …) so one `/issue`
  update re-renders the whole detail (incl. the post-write reflect) in place — `pagination:'none'`
  but still refreshable.
- **Catalog components must self-resolve `{path}` — the SDK does NOT.** A2UI 0.9's
  `ComponentRenderer` spreads node props verbatim; a `{path}` prop arrives as the literal object.
  Each bound prop must be read through `useDataBinding(surfaceId, source, default)` (passes a
  non-binding literal through unchanged, so the same component serves bound AND static surfaces).
  **Gotcha:** `DynamicValue` does not model object/array literals, so binding an object/array prop
  (issue, issues, comments, availableTransitions) needs a cast — use the `useBound<T>` helper in
  `jiraCatalog/components.tsx` (`source as DynamicValue | undefined`), don't fight the type per-call.
- **`updateDataModel` apply lives in a pure `.ts`, not the `.tsx`.** `ActiveTabSurface.tsx` seeds
  the initial data model after `createSurface`/`updateComponents`, then subscribes to
  `window.cosmos.ui.onDataModel` filtered by `surfaceId` (a push for a sibling tab's surface is
  ignored). The actual data-model mutation is `dataModelApply.ts` (`applyDataModel`) — node-testable,
  malformed entry safely skipped. Keep new apply logic there, not inline in the component.
- **Descriptor `{ dataSource, query }` is SECRET-FREE and persisted.** It is the refetch intent —
  `dataSource` = a manager-call id (`searchIssues`/`getIssue`), `query` = non-secret JQL/cursor/
  issueKey. It is persisted in `GenerativeTabSnapshot` beside `surface.spec` (schema bumped to 2) and
  re-validated + secret-stripped by `validateAdapterDescriptor` at load. NEVER put a token in a
  descriptor, data-model value, or any IPC frame — `validateAdapterDescriptor`/`validateAdapterAction`
  STRIP secret-looking query keys (token/access_token/client_secret/…) and warn.
- **`AdapterDispatcher` (`src/main/generative/adapterDispatcher.ts`) is channel-independent.** It holds the
  per-surface descriptor + accumulated list + cursor/loading state and pushes `updateDataModel`; it
  has NO PtyManager/AgentRunner deps (inject `resolve`/`pushDataModel`/`cancelActive`/`warn`).
  Append pagination writes the FULL accumulated list at the bound path (main holds the accumulation —
  no RFC6901 `-` append); page-replace swaps the list and updates `hasMore`/`hasPrev`.
- **Reserved `adapter.*` action namespace, intercepted at the `ui:action` boundary** (parallel to
  `jira.*`): `adapter.refresh`/`adapter.loadMore`/`adapter.page`. Never returned to the agent.
- **Lazy re-registration on restore.** After a restart main has no registration for a restored tab's
  surface. `ActiveTabSurface` fires `adapter.refresh` carrying the persisted descriptor ONLY when the
  surface's `restored` flag is set (set only in `hydrateGenerativeTabs`); main lazily registers
  (bind options chosen by `descriptor.dataSource`) then refreshes. A FRESHLY composed surface seeds
  its own data model and must NOT re-fetch (SC-008 perf) — that's what the `restored` gate prevents.
  `AdapterActionRequest`'s Refresh variant therefore carries an OPTIONAL `descriptor`; the manual
  RefreshButton fires the same action WITHOUT one (the surface is already registered).
- **`jira.*` writes are reconciled, not replaced.** Registration persists in the dispatcher map, so a
  write's re-read/reflect re-push still refreshes the bound surface; the write execute→re-read→reflect
  path (`JiraActionDispatcher`) is unchanged (SC-008). Refresh triggers (restore, re-activation
  remount, explicit RefreshButton) all funnel through `adapter.refresh`.

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
- **A FRESH terminal tab defers its spawn until a directory is picked (terminal-open-directory-
  picker-v1).** A new tab mounts in an `awaiting` phase showing an `[Open]` empty state and does
  NOT auto-`pty:start`; clicking `[Open]` calls `window.cosmos.pty.pickDirectory()` →
  `ipcMain.handle(PtyChannel.PickDirectory)` → main-only `dialog.showOpenDialog({ properties:
  ['openDirectory'] })` (cancel/error → `{ path: null }`, which keeps the `[Open]` state). The
  picked dir is passed as an OPTIONAL `cwd` on `pty.start(paneId, { cwd })`, boundary-validated in
  main. A RESTORED tab skips the picker and auto-resumes. The fresh-vs-resume cwd rule is the pure
  `resolvePaneSpawn` (`src/main/pty/paneSpawn.ts`): a resume IGNORES any override cwd (the snapshot's
  own cwd wins), a fresh spawn uses `overrideCwd ?? sandboxDir`. `TerminalView` carries the
  `autoStart`/`phase`/`pending` state for this; restored tabs set `autoStart` so they resume
  without a pick.

## Cosmos conversation timeline (cosmos-conversation-panel-v2, step 3)

- **The Cosmos panel is a conversation TIMELINE, not a surface-per-tab strip.** It DELIBERATELY
  does NOT use `useGenerativePanelTabs` (FR-116) — it has its own pure tab state `cosmosTabs.ts`
  (ONE pinned, undeletable `kind:'default'` tab; future `kind:'favorite'` tabs are appended
  additively). The other four generative panels keep `useGenerativePanelTabs` untouched.
- **Rail id `'cosmos'` ≠ wire `UiRenderTarget` `'generated-ui'` — STILL diverged, do NOT "finish
  the rename".** The panel publishes its composer under the RAIL id `'cosmos'`
  (`usePublishComposer('cosmos', …)`) but submits + filters `ui:render` on the WIRE target
  `'generated-ui'`. Renaming the wire target or the persisted snapshot key breaks render routing
  + session restore.
- **Headless `claude -p --session-id <id>` is CREATE-ONLY, NOT create-or-continue.** Once the
  session jsonl exists, re-passing `--session-id <same id>` HARD-rejects `Session ID <id> is already
  in use` (this is the `claude -p` behaviour; do NOT trust the older PTY comments that call
  `--session-id` "create-or-continue"). The persistent default-conversation id is created ONCE and
  CONTINUED with `--resume` thereafter. `AgentRunner` picks the flag via
  `sessionFlagForRun(sessionExists)` (`agentSessionQueue.ts`): seeded from `sessionAlreadyExists:
  !defaultSession.minted` (a persisted id ⇒ session already on disk ⇒ resume from run #1) and flipped
  `true` after the first spawn (create once, resume after). The `planResumeRetry` backoff only frees
  a stale LIVE-pid registry holder — it CANNOT fix an already-existing-on-disk session, so a wrong
  `--session-id` reuse loops forever. Gotcha: `isAlreadyInUseError`'s regex requires the id token
  (`/Session ID\s+\S+\s+is already in use/i`) — a stub stderr missing the id silently skips the retry
  path. Bug `agent-session-id-reuse-resume-v1`.
- **All `~/.claude` access is MAIN-only and CONFINED to one path.** `transcriptReader.ts` resolves
  exactly `~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl` — `<dir-key>` DERIVED from the
  stable sandbox cwd (`resolveSandboxDir()`) by replacing `/`+`.`→`-` (`encodeProjectDirKey`),
  with a `readdirSync` SCAN fallback when the derived file is absent. It NEVER takes a renderer
  path, NEVER reads another session. The renderer touches `~/.claude` never.
- **Pure parse is split for node tests.** `transcriptParse.ts` (`parseTranscript(lines)`) is the
  `.ts` half — no fs/Electron — mapping jsonl lines → the `Conversation` model: a string/`text`
  user line → `user-prompt`; assistant `text` → `assistant-text`; assistant `tool_use` →
  `tool-call`, EXCEPT the render tool (name `mcp__cosmos-render-ui__render_ui`) → a `surface` turn
  carrying `input.spec`; a user `tool_result` correlates to its tool-call by `tool_use_id`. Noise
  (`permission-mode`/`file-history-snapshot`/`attachment`/`queue-operation`), `isSidechain`, and
  malformed/partial lines are skipped (one bad line never blanks the timeline). Tool args/results
  are surfaced ONLY as a bounded (`PREVIEW_MAX_LEN`=200), secret-redacted one-line `previewArgs`.
- **Live trigger = INCREMENTAL transcript poll while in flight + a completion re-read**
  (cosmos-agent-progress-not-streaming-v1). `claude` appends to the default-session jsonl as a run
  progresses, so the timeline must STREAM (not dump every turn on completion). On `agent:status`
  `started`, main arms a `TranscriptWatcher` (`transcriptWatcher.ts`) that POLLS the transcript
  (default 250ms) and pushes an incremental `conversation:update` on each real change (coalesced by
  a cheap change signature — an unchanged poll never re-pushes); on `completed`/`error` it `stop()`s
  and the `completed` path still does the authoritative final re-read (`pushConversationUpdateToRenderer`).
  POLL, not `fs.watch`: the first run's transcript file/dir does not exist at arm time (`claude
  --session-id` creates it mid-run). The watcher MUST be stopped on teardown too —
  `agentRunner.dispose()` detaches the child WITHOUT a terminal status, so reload (`did-start-navigation`)
  and `closed` both call `transcriptWatcher?.stop()` (mirrors `fsExplorer.stopAll()`); a leaked poll
  timer otherwise survives the window. `conversation:fetch` (invoke, no arg) is the mount read. All
  pushes validated by `validateConversationResult` BEFORE send — a malformed/secret frame is dropped.
- **An incremental `conversation:update` must NOT be treated as completion.** `CosmosPanel.onUpdate`
  refreshes `read` ONLY — it must NOT `setLive(null)` (that killed the spinner on every streamed
  step). ONLY `agent:status 'completed'`/'error' clears `live`.
- **Reconciliation: each turn shows EXACTLY ONCE across the live↔transcript overlap.**
  `cosmosConversation.ts` (`reconcileTimeline`) appends the live in-flight entry at the tail, but
  because the transcript now catches up MID-RUN: (a) the provisional `live-generating` prompt bubble
  AND its context chip are suppressed (only the spinner remains) once the transcript carries the
  run's `user-prompt` turn. The PRIMARY signal is a renderer-internal `LiveInFlight.baseline` — the
  transcript turn COUNT `CosmosPanel` captures (from a `readRef` mirror) at run start on BOTH seed
  sites (`onSubmit` + `agent:status 'started'`), re-captured per run: `reconcileTimeline` suppresses
  when `turns.length > live.baseline` (the transcript grew past where the run began, so it carries
  the run's prompt + any streamed turns). This survives the WHOLE stream and the CROSS-PANEL run
  (whose seed has an undefined `promptText` but a set `promptContext`) — the two earlier signals
  (last turn is a `user-prompt`, exact-text match) were NOT enough: once assistant/tool turns stream
  in, the last turn is no longer the user-prompt and `promptText` is undefined, so the provisional
  re-appeared as an EMPTY context-only bubble (cosmos-streaming-duplicate-context-chip-v1). Those two
  remain as belt-and-suspenders for the first poll before the count is captured. NO IPC change —
  `baseline` is renderer-internal. Pre-stream (`turns.length === baseline`, transcript not yet grown)
  none hold, so the provisional shows INSTANTLY on Enter (FR-024). (b) a LIVE
  `surface` stays AUTHORITATIVE over its transcript
  copy (the transcript surface turn with the same `surfaceId` is dropped while `live.phase==='surface'`),
  so a still-pending interactive surface is never replaced by the display-only transcript copy mid-run.
  On `completed` the panel clears `live` (=null) and the transcript turns take over.
  HISTORICAL surfaces are display-only: rendered via the SAME `ActiveTabSurface` host but with
  `requestId:''`, so a control action is a safe no-op (`handleAction` bails on empty requestId) —
  never an error. Only the live in-flight surface carries a real, resolvable `requestId`.
- **PanelTabStrip gained two OPTIONAL, additive props** for the pinned default: `PanelTab.closeable`
  (default true; `false` suppresses the `X` entirely) and `onNewTab` now optional (absent ⇒ no `+`).
  The four other panels omit both ⇒ unchanged behavior.
- **PRELOAD edit**: `window.cosmos.conversation` (`getDefault`/`onUpdate`) is a NEW preload surface —
  a full `npm run dev` restart is required (HMR leaves it `not a function`). The panel guards
  `window.cosmos.conversation` absence → empty state, so an un-restarted dev session degrades calmly.
- **No markdown dep.** Assistant/tool text renders as React TEXT nodes (auto-escaped,
  `whitespace-pre-wrap`), never raw HTML — zero injection surface, zero new dependency. Rich
  markdown is a deferred refinement. Long-history surface virtualization (OQ-V2-perf) is also
  deferred (all historical `A2UIProvider`s currently mount).

## Session persistence (session-persistence-v1)

The working session (all rail panel tabs, composed generated-UI surfaces, terminal `claude`
sessions) is snapshotted to disk in main so a full quit/relaunch restores it. The contract is the
single new `window.cosmos.session` namespace in `src/shared/ipc.ts` (`session:load` via `invoke`,
`session:save` via `send`).

- **Plain UNENCRYPTED JSON, atomic, under `userData`.** The snapshot is `session.json` in
  `app.getPath('userData')`, written by `SessionStore` (`src/main/session/sessionStore.ts`) as
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
  lives in `src/main/session/sessionSnapshot.ts` (NOT `src/shared/validate.ts` — shared cannot import main,
  and snapshot validation is a main-only boundary concern; this is a deliberate deviation from the
  plan's checklist). On `save`, an invalid/old-schema/corrupt payload → warn + ignore + KEEP the
  existing file. On `load`, a missing/corrupt/unknown-version file → warn + clean empty session
  (`emptySnapshot`). Bad individual tabs are dropped, not fatal.
- **`validateSnapshot` is a HARD equality gate on `schemaVersion` — so a purely-ADDITIVE optional
  field MUST NOT bump `SESSION_SCHEMA_VERSION`.** `if (value.schemaVersion !== SESSION_SCHEMA_VERSION)
  return null` makes any version mismatch wipe the ENTIRE restored session to `emptySnapshot` (terminal
  tabs + cwd + open files all gone — the terminal pane resets to the "Open a folder" placeholder).
  Because every per-field validator already defaults gracefully when its field is absent
  (`validateHiddenCalendars(undefined)`→[], `validateOpenFiles`/`validateEnabled` likewise), an
  additive OPTIONAL field needs NO bump — an older snapshot simply restores with that field absent.
  Mirror the established additive pattern: `openFiles` was added to `TerminalTabSnapshot` and
  per-tab `hiddenCalendars` to `GenerativeTabSnapshot`, BOTH without a bump. ONLY bump the version for
  a BREAKING shape change (a field whose absence/old form can't be safely defaulted). A needless bump
  is a regression that silently discards the user's working session (calendar-selection-persistence
  bumped 8→9 for an additive field and wiped the terminal on every refresh — reverted to 8).
- **Per-generative-tab UI selection lives on the tab record, not a top-level snapshot field.** The
  Google Calendar legend's hidden (deselected) calendar ids are persisted PER TAB as the additive
  `GenerativeTabSnapshot.hiddenCalendars` (validated in `validateGenerativeTab` via the shared
  `validateHiddenCalendars`), so each google-calendar tab keeps its own independent selection. The
  renderer keys the set by tab id: `GoogleCalendarPanel` reads the active tab's `GenerativeTab.hiddenCalendars`,
  injects it through `CalendarVisibilityContext`, and writes every toggle back with
  `update(activeTabId, { hiddenCalendars })` so it round-trips through that tab's snapshot
  (build/hydrate in `src/renderer/session/sessionSnapshot.ts`). There is NO global `hiddenCalendars` and NO
  `SessionRegistry.setHiddenCalendars` — a per-tab UI preference rides the tab's own persisted record,
  not a snapshot-wide field, so it can't leak across tabs.
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
- **The live restart seam is the index.ts `PtyChannel.Restart` handler, NOT `PtyManager.restart`.**
  The renderer's `window.cosmos.pty.restart(paneId)` sends `pty:restart` → the index.ts handler, which
  resolves via `paneSpawnFor`→`resolvePaneSpawn`→`ptyManager.start`. `PtyManager.restart`
  (`ptyManager.ts`) is currently UNUSED by any live path (codegraph attributes the renderer bridge to
  it by name only) and still does a plain `{ cwd }` fresh spawn — do NOT wire new behavior there;
  change the handler + the pure resolver instead.
- **Restart RESUMES, it does not mint fresh (terminal-session-unnecessary-restart-v1, ARCHITECTURE.md
  §4.1 continue-don't-restart).** cosmos never respawns a live `claude` on lock/sleep/wake/focus
  (`powerMonitor 'suspend'` is log-only; the renderer has no respawn handler). When the upstream
  `claude` dies on its own (its API/stream connection drops on a lock — an upstream limitation cosmos
  cannot prevent), it falls through `PtyManager.onExit` to the exit banner. The exit-banner Restart
  passes `isExplicitRestart=true` through `paneSpawnFor`→`resolvePaneSpawn`, which for a RECORDED
  session emits `--resume <id>` (resume:true) so the transcript/context is restored and the
  resume-failure + `onSessionInUse`/`planResumeRetry` backoff arms. THE TENSION to respect: a benign
  cwd-less `pty:start` re-issue (React StrictMode mount→dispose→remount) lands in the SAME
  recorded-session branch but MUST keep `--session-id` create-or-continue (`isExplicitRestart` defaults
  false), because its recorded session may be an empty just-minted-then-killed id that `--resume`
  rejects with "No conversation found". The recorded id is NEVER re-minted on either path. Auto-accept
  mode (shift+tab) is process-local TUI state that cannot survive the death; the exit banner is honest
  about that (`exitRecoveryHint` in `terminalExit.ts`) rather than pretending to restore it.
- **KNOWN DEV-ONLY annoyance: lock→wake resets terminal sessions in `npm run dev`
  (terminal-session-unnecessary-restart-v1; NOT fixed — see why).** In dev the renderer runs Vite's
  HMR client; on sleep the dev-server WebSocket drops and on wake `@vite/client` HARD-CODES
  `location.reload()` after a successful reconnect ping (`node_modules/vite/dist/client/client.mjs`
  ≈L863-870, vite 7.3.5 — NO `server.hmr` key and NO listener-cancel hook). That full reload fires
  `did-start-navigation` → `ptyManager.killAll()` → every pane re-mounts + re-`--resume`s, STACKING
  startup banners. A renderer-side guard that overrode `location.reload` was tried (direction A) and
  ROLLED BACK: in a real Chromium/Electron renderer `window.location.reload` is non-configurable, so
  `Object.defineProperty(location, 'reload', …)` THROWS at startup → white screen (jsdom allowed it,
  so the unit test was green — a jsdom-green/runtime-broken trap). There is no clean renderer seam
  (Vite hard-codes the reload; the reload fn is not overridable) and main-side can't distinguish the
  HMR reload from a genuine Cmd+R. **This is DEV-ONLY: a packaged build uses `loadFile` with no
  `@vite/client`, so it never wake-reloads — the shipped app is unaffected.** A real fix would be
  "direction B" (sessions SURVIVE a renderer reload via stable paneIds + a reattach handshake), which
  is feature-sized (own sdd) and was deferred. The orthogonal exit-banner Restart-`--resume` hardening
  (above) stands.
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

- **An `isMounted` ref must be RESET to `true` at the start of the mount effect, not only set
  `false` in cleanup.** StrictMode double-invokes effects mount → cleanup → mount; a ref that is
  flipped `false` in cleanup but never re-asserted on the second mount stays `false` for the
  component's whole life, so any later "ignore if unmounted" guard fires permanently. The Terminal
  `[Open]` picker hit this: `TerminalView`'s mount effect cleanup set `isMountedRef.current = false`
  but the body never reset it, so after the dev double-invoke the post-pick guard
  `if (res.path && isMountedRef.current)` short-circuited — `claude` never spawned and the "Opening…"
  spinner never cleared (terminal-picker-spinner-hang-v1). Fix: `isMountedRef.current = true` as the
  first line of the effect body; keep the `false` in cleanup. Same dev-only-symptom / real-defect
  caveat as above.
- **Any keydown-Enter-to-submit on a text input MUST guard `!event.nativeEvent.isComposing`.**
  With an IME (Korean/Japanese/…), the Enter that COMMITS the composing syllable fires a `keydown`
  with `isComposing === true` (keyCode 229); submitting on it duplicates the just-committed last
  character. `PromptComposer.tsx`'s `handleKeyDown` Enter branch hit this
  (cosmos-composer-ime-enter-duplicate-char-v1) — ASCII-only typing never reproduces it. Ignore the
  composing-Enter; the user presses Enter again (composition ended) to actually send.

## Styling (Tailwind v4 + shadcn)

- **`npx shadcn add` writes to a LITERAL `@/` directory — move the files.** This repo's
  `components.json` aliases are `@/...` but the Vite `@` alias points at `src/renderer`, which the
  shadcn CLI does not resolve; it creates `./@/components/ui/<name>.tsx` at the repo root. After an
  add, `mv` the file(s) into `src/renderer/components/ui/` and `rm -rf '@'`. The CLI already emits
  the repo's `import { X as XPrimitive } from "radix-ui"` unified convention (verified for
  `dialog`/`label`) — no `@radix-ui/*` rewrite needed. Run with `--overwrite` to avoid the
  interactive prompt.
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
- **`cn()` drops a custom `@theme` text-SIZE next to a text-COLOR.** tailwind-merge does not know the
  project's custom font-size tokens (`text-nano…text-title`, DESIGN.md §8), so it classifies e.g.
  `text-body` as a text-COLOR; `cn("text-body text-muted-foreground", …)` then puts both in the color
  group and DROPS `text-body` (the element silently falls back to inherited 16px — the recurring
  "dialog/timeline text size is wrong" defect; jsdom does NOT catch it). `cn` (`lib/utils.ts`)
  therefore uses `extendTailwindMerge` to register the custom names in the `font-size` group. A plain
  className STRING (not via `cn`) is unaffected — only `cn`/`twMerge` merges. When adding a new
  `@theme` `--text-*` token, also add its name to that `extendTailwindMerge` font-size list.
- **Nested Radix triggers collide on `data-state`.** Both `Tabs.Trigger` and `Tooltip.Trigger`
  write a `data-state` attribute; when one wraps the other with `asChild` (e.g. the rail in
  `App.tsx`: `TooltipTrigger asChild` → `TabsTrigger`), the outer trigger's props are spread AFTER
  the inner's explicit `data-state`, so the rendered `<button>` ends up with the *tooltip's*
  state (`closed`/`delayed-open`), NEVER `active`. Every `data-[state=active]:*` class then
  silently never matches (no specificity/`!important` can fix it — the attribute is just wrong).
  Drive such state from React instead (e.g. `surface === id`) and apply the active classes
  conditionally; don't rely on `data-[state=active]` on a tooltip-wrapped tab. Symptom: hover
  styling works (real `:hover`) but the selected/active styling does nothing.
- **lucide stroke icons render optically smaller than brand-fill icons at the same `size-N`.** The
  rail mixes `react-icons/si` brand logos (filled glyphs that fill their viewBox) with lucide
  (thin-stroke, internal padding). At a shared `size-5` the lucide marks (Settings gear, CalendarDays)
  look noticeably smaller — bump lucide rail icons one step (`size-6`) to match. Pure optics, not a box
  size: the `h-10 w-10` button stays identical.
- **A rail `Button` (e.g. the Settings gear) is a shadcn `ghost`, which adds `hover:bg-accent`.** The
  rail tab triggers only brighten the icon on hover (`hover:text-foreground`, no box). To match, the
  gear needs `hover:bg-transparent` so the ghost variant's hover box is neutralized; show the filled
  box (`bg-accent`) only on the active/open state. Symptom when missing: hovering the gear lights a
  square box the other rail icons don't.
- **Tailwind v4 `scale-*`/`translate-*`/`rotate-*` are NOT `transform`.** v4 compiles them to the
  standalone CSS `scale:` / `translate:` / `rotate:` properties, so `transition-[opacity,transform]`
  will NOT animate a scale or translate — only opacity moves and the size/position jumps. List the
  real properties: `transition-[opacity,scale,filter]` (add `filter` for `blur-*`). Symptom when
  wrong: an element fades but its size snaps instantly.
- **Resizable panel columns gate layout on their OWN width via a named container query, NOT a
  viewport `md:` breakpoint.** A panel is one resizable column in a multi-panel workspace, so its
  width is independent of the window. Mark the wrapper `@container/<name>` (e.g.
  `@container/slackbody`) and gate the wide layout on `@[32rem]/<name>:*` — Tailwind v4 emits the
  named container utilities (`container: <name> / inline-size`, `@container <name> (min-width: …)`)
  natively, no plugin/config. The Slack thread dock uses this: `@[32rem]/slackbody` side-by-side
  (thread `clamp(18rem,42%,28rem)`, `border-l`) above the breakpoint, right-drawer overlay below.
  Symptom if you reach for `md:` instead: the thread layout flips on window size, not panel size.
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
- **xterm theme can't take CSS vars — read the token at construct.** xterm's `Terminal({ theme })`
  needs concrete color *strings*, so it can't consume `var(--card)` directly. To keep the terminal
  screen on the same surface as every other panel (`bg-card`), read the computed token once at
  Terminal construction — `terminalThemeFromTokens` (`terminalTheme.ts`, pure + node-tested) maps
  `--card`→background / `--card-foreground`→foreground from a `getComputedStyle(documentElement)`
  reader. Never hardcode the screen hex (it silently desyncs from the token + can't follow a theme).
  cosmos forces `.dark` once at startup (`main.tsx`) with no runtime toggle, so a one-shot read is
  correct; a future toggle would re-read + re-set `term.options.theme`.
- **Theme the xterm scrollbar via `theme.scrollbarSlider*`, NEVER `::-webkit-scrollbar { width }`**
  (terminal-broke-scroll-unify-redo-v1). xterm 6 draws a VS-Code-style OVERLAY scrollbar
  (`.xterm-scrollable-element > .scrollbar > .slider`), styled purely by the `Terminal` theme keys
  `scrollbarSliderBackground` / `scrollbarSliderHoverBackground` / `scrollbarSliderActiveBackground`.
  `terminalTheme.ts` maps `--muted-foreground` into these at the panel scrollbar opacities (45%
  rest / 70% hover via `withAlpha`, node-tested) so the terminal bar matches every panel surface.
  These are COLOUR-only — the slider is `position:absolute`, so they never change the scrollbar
  WIDTH. Critical: do NOT add `.xterm-viewport::-webkit-scrollbar { width: … }` — that switches the
  viewport to a CLASSIC (layout-consuming) bar, shrinking the usable width; xterm's FitAddon also
  reserves a CONSTANT gutter (`overviewRuler?.width || 14`, not the measured bar), so the two
  disagree and cols/rows mis-fit ⇒ the terminal screen renders broken ("화면 깨짐"). The earlier
  width-based attempt was rolled back for exactly this reason — keep scrollbar theming to colour.
- **Rich Confluence HTML renders via `prose-cosmos` + a single sanitized `dangerouslySetInnerHTML`.**
  Confluence page detail carries server-rendered `body-format=view` HTML; the shared `PageDetailBody`
  (`confluenceCatalog/components.tsx`, reused by the native `ConfluencePanel` detail AND the gen-UI
  catalog `PageDetail`) runs `sanitizeConfluenceHtml` (DOMPurify) FIRST — this is the ONE sanctioned
  raw-HTML site — then renders into a scoped `prose prose-sm prose-cosmos` container. `prose-cosmos` is a
  custom `@utility` in `index.css` mapping the `--tw-prose-*` knobs onto existing theme vars (NOT
  `prose-invert`, which hardcodes its own gray scale and ignores cosmos tokens — cosmos is single-mode
  dark so there's no light↔dark toggle to drive). Keep all prose styling inside the Tailwind utilities
  layer (`@plugin "@tailwindcss/typography"` + the `@utility` block); do NOT add any `.prose` rule to the
  unlayered `App.css` or it silently beats the plugin (the cascade-layer rule above). Both detail mount
  points MUST share the one class string + the one sanitize helper or they drift. DOMPurify v3's default
  export is a factory; it needs a DOM `window` — the renderer passes the global, node tests pass a `jsdom`
  window. DOMPurify 3.x ships its own types — do NOT add `@types/dompurify`.
  - **The allow-list must cover the benign rich markup Confluence actually emits, or it renders
    broken.** `body-format=view` carries emoji/emoticons as `<img class="emoticon" src=… alt=… data-emoji-*>`
    and task-list checkboxes as `<input type="checkbox" checked>`. A too-tight `ALLOWED_TAGS`/`ALLOWED_ATTR`
    silently strips them (emoji/checkbox vanish). `img` + `input` (and `src`/`alt`/`class`/`type`/`checked`/
    `disabled`/`data-emoji-*`) are allow-listed for this reason.
  - **DOMPurify permits `data:` URIs on media tags (`img`/`audio`/`video`/…) via its OWN internal
    allow-list, BYPASSING `ALLOWED_URI_REGEXP`.** So allow-listing `<img src>` re-opens the
    `data:image/svg+xml,<svg onload=…>` inline-script XSS vector even though the regexp would block it.
    `sanitize.ts` closes this with an `afterSanitizeAttributes` hook that strips any `src`/`href` whose
    scheme is `data:`. The SAME hook forces `disabled` on every surviving `<input>` so the read-only
    viewer's checkboxes show state but are never toggleable. When widening any media allow-list, re-block
    `data:` explicitly — the regexp is not enough.
  - **Confluence emits emoji TWO ways; handle both.** (1) Emoticon `<img data-emoji-id="1f5d3" …
    src="/wiki/s/…">` whose src is RELATIVE + auth-gated (404s in the renderer) — the hook replaces each
    emoticon `<img>` in place with its real glyph decoded offline from `data-emoji-id` (`emojiIdToGlyph`),
    degrading to shortname/alt. (2) Emoji as the LITERAL escape text `👥` (double-escaped at the
    source so it is plain text, not an `<img>`) — the hook decodes `\uXXXX` in element TEXT nodes via the
    shared `decodeUnicodeEscapes`. Confluence ALSO serializes that literal-escape form into plain
    `title`/`excerpt`/space fields, so the main process (`confluenceClient` `mapSearchResultsPage` +
    `getPage`) applies `decodeUnicodeEscapes` at the data source → the search/feed LIST screen, detail
    header, and gen-UI catalog all show real glyphs. `decodeUnicodeEscapes` lives in `src/shared/types/confluence.ts`
    so main + renderer share one transform; decode HTML body at the text-node level (renderer), never on the
    serialized string (would corrupt attributes).
  - **Provider message text is wire-format, not plain text — decode it at the single client mapping
    point in main, never in the renderer.** Slack message `text` is "mrkdwn": HTML-escaped
    `&amp;`/`&lt;`/`&gt;`, `:shortcode:` emoji, and `<@U|name>`/`<#C|name>`/`<url|label>`/`<!here>`
    angle-bracket tokens — forwarding it verbatim shows literal `:tada:`, escaped entities, and raw
    `<…>` markup. `decodeSlackText` (`src/main/integrations/slackText.ts`, with the curated no-dep
    `slackEmoji.ts` map) is applied at the SOLE mapping point (`slackClient.ts` `toMessages` +
    `search`), so history, replies, search, the native panel AND the MCP render path all decode once.
    Order matters: decode `<…>` tokens on the raw string FIRST (before entity-unescape) so a literal
    `&lt;` in a label can't be mistaken for a token delimiter; preserve `\n` verbatim (the rows are
    `whitespace-pre-wrap`, so real newlines render — the line-break bug was the missing decode, not
    CSS). Mirrors the `atlassianText.ts` flattener / Confluence `decodeUnicodeEscapes` convention:
    pure `.ts`, node-tested, returns `''` for absent input, never throws. No emoji-data npm dep —
    curated map, same no-dep choice as `confluenceCatalog/sanitize.ts`.
- **Radix `ScrollArea` shrink-wraps its content to intrinsic width — long lines overflow instead
  of wrapping.** `@radix-ui/react-scroll-area` wraps the viewport's children in an inner content
  `div` with an INLINE `style={{ minWidth: "100%", display: "table" }}`. A `display: table` box
  fits its content's intrinsic width (and `min-width: 100%` is only a floor), so any
  `whitespace-pre-wrap` text with a long unbroken line expands the table past the panel and
  overflows horizontally — even though the text element already has `whitespace-pre-wrap
  break-words` and its column is `min-w-0 flex-1`. The wrap CSS is fine; its containing block is
  just wider than the panel. The shared `ScrollArea` (`components/ui/scroll-area.tsx`) fixes this
  ONCE for every consumer via `[&>div]:!block [&>div]:!min-w-full` on the viewport: `!block`
  defeats the inline `display: table` (a block box fills available width and lets text wrap),
  `!min-w-full` keeps Radix's `min-width:100%` floor. `!important` is mandatory — Radix sets
  `display: table` as an inline style, which a plain utility can't beat. The class lives in a pure
  `scroll-area.classes.ts` so a node test (`*.classes.test.ts`) can assert the override survives a
  shadcn `--overwrite` re-add (the `.tsx` can't be mounted in node/no-jsdom to observe wrapping).
  Bug `slack-message-overflow-wrap-v1`. NOTE: the agent-composed A2UI catalog surfaces render
  inside a plain `overflow-auto` div (no Radix ScrollArea), so they are NOT affected by the Radix
  `display: table` issue — only native panel read surfaces that wrap content in `<ScrollArea>` are.
- **A2UI standard-catalog `Column`/`Row` shrink-wrap to intrinsic width too — a SECOND, distinct
  overflow source in the GENERATIVE path.** The SDK `standardCatalog.components.Column`/`Row`
  render a `<div>` with a fixed `flex flex-col gap-4` / `flex flex-row gap-3` className and NO
  `min-w-0`. With flex `min-width: auto` that container grows to its content's intrinsic width, so
  when the agent groups a list (e.g. a `Text` header + `MessageList`) inside a `Column`/`Row`, a
  long unbroken message line expands the group past the panel and overflows horizontally — even
  though the leaf `<p>` has `whitespace-pre-wrap break-words` and the list root is `w-full
  max-w-full min-w-0`. The cap fails because the SDK container (the containing block) is already
  wider than the panel. You CANNOT edit the third-party SDK div's className, so register CLAMPED
  wrappers in the catalog (`slackCatalog/layout.tsx`: render the SDK `Column`/`Row` inside a
  `w-full min-w-0 max-w-full` block) INSTEAD of `standardCatalog.components.Column/Row`. The clamp
  class lives in `slackCatalog/logic.ts` (`SLACK_LAYOUT_CLAMP_CLASS`) so a node test asserts it.
  Bug `slack-generative-wrap-v1`. The SAME clamp is applied across ALL THREE generative catalogs
  (`{slack,jira,confluence}Catalog/layout.tsx` + `{SLACK,JIRA,CONFLUENCE}_LAYOUT_CLAMP_CLASS =
  'w-full min-w-0 max-w-full'` in each `logic.ts`; each `index.ts` registers the wrapped
  `./layout` Column/Row instead of the raw `standardCatalog.components.Column/Row`, with a node
  test asserting the raw SDK containers are not registered). Mirror the same wrapper into any new
  catalog that groups data-bearing containers. NOTE: the Slack catalog folded its width clamp into
  `SLACK_LAYOUT_FILL_CLASS` (which still carries the `w-full min-w-0 max-w-full` clamp tokens) as
  part of the v2 height-chain repair below; `SLACK_LAYOUT_CLAMP_CLASS` is retained as an exported
  constant but the wrapper now applies the fill class.
- **Slack catalog MESSAGE lists fill AND scroll independently — repair the height chain at the
  FIRST-PARTY wrapper, not the leaf (`slack-list-scroll-fill-v2`).** When the agent emits one OR
  MORE message lists in a Slack surface, two requirements were mutually exclusive at the leaf: (R2)
  a LONE list must fill to the panel bottom with no dead gap, and (R1) N lists must each scroll
  independently (no shared scrollbar). Two prior leaf-only attempts each failed: `max-h-[70vh]` gave
  R1 but left ~30vh dead gap (fixed `vh` shorter than the panel — R2 broken); `max-h-full` gave R2
  but regressed to shared scroll (R1 broken) because `max-height:100%` resolves against the
  AUTO-height SDK `Column`/`Row` flex div (`flex flex-col gap-4`, no `min-h-0`/`flex-1`/definite
  height) → effectively `none` → every list flows into the ONE panel `overflow-auto` scroller. ROOT
  CAUSE: the height chain from the tabpanel host down to a list root is BROKEN at that SDK flex div
  — neither a definite-height ancestor nor a `flex-1 min-h-0` link, so neither `%` nor a flex-fill
  chain threads through; a leaf class can't fix a break ABOVE it. **v2 fix — repair the chain at the
  one renderer-owned DOM seam**: the Slack catalog does NOT register the raw SDK `Column`/`Row`, it
  registers its OWN `slackCatalog/layout.tsx` wrappers (`<div className={…}><SdkColumn/></div>`,
  the SDK flex div is ALWAYS the wrapper's only child). Thread a definite-height / flex-fill chain
  host → wrapper → list root, all via pure class strings in `slackCatalog/logic.ts` (node-tested):
  (1) HOST — the `SlackPanel.tsx` generative tabpanel `<div role="tabpanel">` carries
  `SLACK_SURFACE_HOST_CLASS = 'flex flex-col min-h-0'` on top of its existing `min-w-0 flex-1
  overflow-auto p-3` (its parent `@container/slackbody relative flex min-h-0 flex-1` gives it a
  resolved height → the host is the definite-height TOP of a flex column). (2) WRAPPER — `layout.tsx`
  `Column`/`Row` carry `SLACK_LAYOUT_FILL_CLASS = 'w-full min-w-0 max-w-full flex flex-col min-h-0
  flex-1 [&>*]:flex [&>*]:flex-col [&>*]:min-h-0 [&>*]:flex-1'` (replaces the old width-only
  `SLACK_LAYOUT_CLAMP_CLASS`). The `[&>*]` POSITIONAL selector repairs the auto-height SDK flex
  child by DOM position (the wrapper's only child), NOT by any SDK class — so an SDK markup change
  can't silently re-break it (FR-005/FR-012; worst-case degrade = lone-fills/multi-may-share, never
  horizontal overflow or white-screen). (3) LIST ROOT — `MessageList`/`SearchResultList` roots
  consume `SLACK_LIST_SCROLL_CLASS = 'min-h-0 flex-1 overflow-y-auto min-w-0 max-w-full
  scrollbar-hover-only'` (definite FLEX sizing, NOT a `%`/`vh` max-height — the `max-h-*` cap is
  GONE). Result: a LONE list is the only flex child → fills (R2); N lists are sibling flex children
  → equal-split the panel height + each scroll internally (R1). R1 and R2 are now the SAME mechanism
  (N=1 is the degenerate split). `cqh` hardening was rejected: `100cqh` has no divide-by-N, so on
  every list root it re-breaks multi-list. Scrollbar visibility unchanged: `scrollbar-hover-only` (a
  Tailwind `@utility` in `index.css`) hides each list's scrollbar by default, reveals it ONLY while
  the pointer is over THAT list, with `scrollbar-gutter: stable` reserving the track so hover causes
  NO horizontal content shift (Electron/Chromium renders `::-webkit-scrollbar`). The `min-w-0
  max-w-full` wrap-safety is preserved across the host/wrapper/list so the vertical chain never
  reintroduces horizontal overflow. The fill chain is applied uniformly (via the wrapper, so
  `ChannelList` benefits too); the per-list scroll class is on the message-bearing lists.
  Presentational containment only — no change to `orderBoundMessages`, load-more placement, the
  shared `SlackMessageRow`, or read-only behavior. All three class strings live in `logic.ts`
  (node-tested in `logic.test.ts`: chain tokens present, `max-h-*`/`70vh` ABSENT) because the
  `.tsx` can't mount in node/no-jsdom to observe computed layout. The SAME SDK-wrapper break
  affects the Jira/Confluence catalogs — applying this chain repair there is future-work parity.
- **Every Slack message row builds its props through the ONE `messageToRowProps()` mapper
  (`slackCatalog/logic.ts`) — never spread `message.*` ad-hoc into `SlackMessageRow`.**
  (slack-search-row-full-parity-v1.) Four render paths feed the canonical `SlackMessageRow`: native
  history (`SlackPanel.tsx` `MessageRow`), native search (`SearchResults` rows), generated history
  (`components.tsx` `MessageRow`), and generated search (`SearchResultRow`). They consume THREE
  different DTOs (`SlackMessage` / `SlackSearchMatch` / bound `MessageRowNode`), so any path that
  hand-spreads fields silently drifts (a dropped field = a row that "looks separately implemented" —
  a recurring user complaint). `messageToRowProps(source, { onOpenThread? })` is the single field
  selector; `searchMatchToRowProps` is a thin wrapper over it. The ONLY per-context piece is the
  `onOpenThread` CLOSURE (native carries a `SlackMessage`; generated dispatches
  `SLACK_OPEN_THREAD_ACTION`) — passed in via `opts`, never built in the pure mapper. Node-tested in
  `logic.test.ts` incl. an explicit "three contexts → identical props" assertion. **Search-row data
  parity is closed at the main mapping point**: `slackClient.search()` now runs the SAME
  `extractImageRefs` history uses (search.messages DOES return `files[]`/`blocks[]` on matches that
  have them) and sets `threadTs = ts` (a message is its own thread root) so a search row shows inline
  images AND is clickable to open its own thread. **Hard limitation: search.messages does NOT return
  `reply_count`**, so a search row carries no `replyCount` and the "N replies" label does not render —
  the one accepted, documented divergence. `SlackSearchMatch.images`/`.threadTs` are additive
  (no breaking change); they are MAIN→renderer response fields (not inbound IPC params), so they need
  no new `validateSlack*` boundary check — they're defensively coerced where main builds them.
- **Slack thread/detail dock is an ALWAYS-overlay floating drawer (matches Jira/Confluence/Calendar
  detail docks).** Both `SlackPanel.tsx` thread-dock regions (the native history dock and the
  generative-surface dock, each driven by the single `openThread` state) render as an absolute
  right-drawer that floats OVER the still-full-width list at EVERY panel width — scrim
  `absolute inset-0 z-10 bg-black/40` (always present, closes on click) + drawer
  `absolute inset-y-0 right-0 z-20 w-full max-w-[28rem] border-l border-border bg-card shadow-lg`
  (plus the entry transition). There is NO `@[32rem]/slackbody` side-by-side branch any more — the
  earlier container-query layout flipped the dock to `relative shrink-0` above 32rem and SQUEEZED
  the list, which diverged from the other panels; the overlay keeps the list full-width and never
  squeezes it. Keep both Slack dock blocks in sync, and match this shape when adding a detail dock
  to any panel.
- **Loading skeletons must match the width-fill of the surface they replace.** When the rendered
  surface fills the panel (e.g. via the `*_LAYOUT_CLAMP_CLASS` wrapper above), a fixed-width
  skeleton placeholder becomes a visible horizontal jump on the skeleton→content swap. Bug
  `jira-skeleton-width-v1`: `KanbanBoardSkeleton`'s `w-64 shrink-0` columns were swapped for
  `flex-1 min-w-0` (equal full-width columns) to match the full-width board.
- **Liquid-glass detail docks use a per-dock generated displacement filter, NOT a global SVG noise
  filter (glass-dock-v2).** The four detail docks (Calendar/Jira/Confluence/Slack) wear the
  reusable `<GlassDock/>` (`src/renderer/glassDock/GlassDock.tsx`) instead of a bare
  `<div className="glass-dock …">`. `<GlassDock/>` keeps the `glass-dock` @utility (translucent
  fill + edge highlight + shadow + `@supports` fallback) but the `backdrop-filter` is now set
  **inline per instance** by `useGlassDockFilter`, which: measures the dock (ResizeObserver,
  debounced), generates a displacement-map PNG **sized to that dock** via an offscreen canvas
  (`generateDisplacementMap.ts` → pure `displacementMap.ts`), and injects a per-instance
  `<svg><filter id="glass-dock-<uid>"><feImage/><feDisplacementMap/><feGaussianBlur/></filter>`.
  The map has a **NEUTRAL interior** (RGB 128,128 = zero displacement → crisp centre) and refraction
  **concentrated in the bezel** (a band along the *exposed* edges only). **Why per-dock + sized:**
  `feImage` does NOT scale to the filter region — a mis-sized map tiles/clips, so the map MUST match
  the element and regenerate on resize. The OLD global `#glass-dock-distortion` feTurbulence filter
  in `index.html` is gone (random noise distorted the WHOLE backdrop → "끊어짐"/wavy/banded). **Edge
  gating:** the docks are flush right-edge drawers, so only the **LEFT** edge refracts
  (`RIGHT_DRAWER_EDGES`); refracting a non-interior edge would draw a box outline. **One tuning
  point:** geometry/strength knobs live ONCE in `glassDock/config.ts` (`GLASS_DOCK_CONFIG`: bezel,
  radius, displacementScale, blur, saturate, mapBlur); colors stay in the `--glass-dock-*` tokens.
  Pure geometry/profile is node-tested in `displacementMap.test.ts`; the canvas + React layers are
  runtime-only (Chromium SVG backdrop-filter, Electron-only — acceptable).

## Testing

- **vitest runs `*.test.ts` in node env (no jsdom).** Catalog component files (`components.tsx`)
  can't be imported by a `.test.ts` without a DOM, so put any unit-testable catalog logic in a
  plain `logic.ts` beside `components.tsx` and test that (`logic.test.ts`). Each catalog dir is
  `components.tsx` + `logic.ts` + `logic.test.ts` + `index.ts`. The same split is why pure tab
  logic lives in `panelTabs.ts` (node-testable) separate from `PanelTabStrip.tsx`.

- **jsdom component tests live in `*.dom.test.tsx` (`npm run test:dom`, `vitest.dom.config.ts`).**
  Two gotchas when a dom test renders a REAL renderer component (not just a hook):
  - **`@/...` alias must be present in `vitest.dom.config.ts`.** The node config doesn't need it
    (pure `.ts` modules avoid `@/`), but a component importing `@/components/ui/*` fails to resolve
    under the dom config unless its `resolve.alias['@'] = src/renderer` mirrors `electron.vite.config.ts`.
    Symptom: `Failed to resolve import "@/components/ui/button"`. (Added for `PromptComposerDocked.dom.test.tsx`.)
  - **jest-dom matcher TYPES.** The runtime matchers load via the `src/test-setup.dom.ts` setupFile,
    but `tsconfig.web.json` (which typechecks `.dom.test.tsx`) does NOT include the jest-dom type
    augmentation by default, so `toBeInTheDocument`/`toBeVisible`/`toHaveFocus`/`toBeDisabled` are
    a typecheck error. Add `import '@testing-library/jest-dom/vitest'` at the top of the test file
    to register the `Assertion` type augmentation. (Most existing dom tests sidestep this by using
    plain `expect(...).toBe(...)`/DOM-property assertions; only use the jest-dom matchers with the import.)

## Terminal key bindings (macOS readline chords)

xterm.js forwards raw arrow keys to the PTY but does NOT translate the macOS Cmd/Option arrow
chords that iTerm/Terminal.app map to readline line/word motion, nor emit a soft newline for
Shift/Option+Enter — so word/line motion + newline-without-submit don't work in the embedded
`claude` prompt by default. The pure mapping lives in `src/renderer/terminal/terminalKeymap.ts`
(`mapTerminalKey(e) → bytes | null`, node-tested in `terminalKeymap.test.ts`) and is wired in
`TerminalView`'s mount effect via `term.attachCustomKeyEventHandler` — a non-null result is written
through the existing `window.cosmos.pty.sendInput` path and returns `false` to suppress xterm's
default; `null` returns `true` so plain typing/Enter-submit/Ctrl-C/paste are untouched. Only keydown
is acted on (keyup would double-send). Table: Cmd+Left `\x01`, Cmd+Right `\x05`, Option+Left `\x1bb`,
Option+Right `\x1bf`, Shift/Option+Enter `\x1b\r`. Add new chords to the pure module + its test, never
inline in the effect.

## Terminal file explorer (terminal-file-explorer-v1)

Per-tab 3-column layout inside each `TerminalView` (`TerminalPanel.tsx`): **terminal LEFT** (kept
mounted/live) | **file viewer MIDDLE** (Monaco text / `cosmos-file://` image, or a calm "Select a file"
placeholder) | **file tree dock RIGHT** (ALWAYS visible — never replaced by the viewer). Two bespoke
resizable dividers (terminal|viewer, viewer|tree). Clicking a tree row opens/retargets the middle
viewer; there is NO "back to tree" affordance and NO tree↔viewer toggle. **Welcome-view gate:** BEFORE
a folder is opened the tab renders ONLY a single centered VS-Code-style welcome view (the [Open a folder]
CTA, reusing the #75 directory-picker IPC) — no split, no dividers, no dock; the 3-pane split renders
ONLY once a folder is open (`isFolderOpen(phase)`, a PURE node-tested predicate in `panelTabs.ts`). The
xterm container stays mounted (hidden) behind the welcome view so the live PTY attaches to the same
element on go-live. Main owns a per-`paneId` filesystem sandbox rooted at the tab's cwd
(`terminalSessionMap`); the renderer addresses everything by `paneId` + root-relative path — NO absolute
path, NO token ever crosses to the renderer.

- **`fs:*` IPC (`src/shared/ipc/fs.ts`).** `fs:list`/`fs:read` (invoke), `fs:watchStart`/
  `fs:watchStop` (send), `fs:changed` (M→R event). Every inbound payload is validated at the main
  boundary (`fs.validate.ts`, re-exported through `src/shared/validate.ts`) — invalid → warn +
  return a denied result / issue no watcher, NEVER crash. `validateFs*` come from the `validate`
  barrel; `FsChannel` comes from the `ipc` barrel (they are different barrels — importing
  `FsChannel` from `./validate` is `undefined` at runtime). The shape validators only check
  `paneId`/`relPath` shape; the security CONFINEMENT (`pathConfine`, real-path canonicalization,
  `..`/absolute/symlink-escape refusal) is a SEPARATE gate applied after the root lookup.
- **`window.cosmos.fs.*` is a NEW preload surface → a full `npm run dev` restart is required**
  (HMR alone leaves the methods `not a function`), like every other new bridge method.
- **`cosmos-file://` privileged image scheme** (mirrors `cosmos-confluence-img://` /
  `cosmos-slack-img://`). Pure codec/validator `src/main/fs/localFileRef.ts` (base64url
  `cosmos-file://file/<paneId>/<base64url(relPath)>`, node-testable, no Electron) + thin wiring
  `src/main/fs/localFileProtocol.ts`. Gotchas: (1) `registerLocalFileScheme()` must run at module load
  BEFORE `app.whenReady` (next to the confluence/slack registrations) or the scheme is silently not
  privileged; `installLocalFileProtocol(getRoot)` runs `protocol.handle` AFTER ready. (2) The handler
  reuses `pathConfine` (confine to the tab's cwd subtree) and NEVER throws — a forged/out-of-root/
  missing ref returns a non-2xx broken-image Response → the viewer's `onError`→`ImageOff` fallback.
  (3) The renderer CSP `img-src` MUST include `cosmos-file:` (in `src/renderer/index.html`) or images
  silently never load. The renderer builds the `<img src>` with the PURE
  `src/renderer/fileExplorer/localFileSrc.ts` (duplicates the scheme/authority constants — a renderer
  module must not import a `src/main` module across the process boundary).
- **Document bytes ride `fs:readBytes` IPC, NOT a `cosmos-file://` fetch (load-bearing gotcha).**
  The `<img>` resource-load path can use `cosmos-file://` (Chromium loads a custom scheme as an
  image SRC), but `fetch()`/XHR to a custom scheme is REFUSED from the http dev-server origin
  ("URL scheme cosmos-file is not supported"). So the byte-consuming viewers (`PdfView`, `DocxView`,
  `SheetView`) — which all need an `ArrayBuffer` — must NOT fetch the scheme. They share
  `src/renderer/fileExplorer/fetchLocalFileBytes.ts`, which calls `window.cosmos.fs.readBytes(paneId,
  relPath)` (channel `FsChannel.ReadBytes`, contract in `src/shared/ipc/fs.ts`) and returns an
  `ArrayBuffer`, throwing on any typed failure so each viewer's existing try/catch shows its calm
  `render-error` block. The main handler delegates to `FsExplorer.readBytes` (`src/main/fs/fsExplorer.ts`),
  which resolves the root by `paneId`, `pathConfine`-checks the target, and enforces the SAME per-format
  `viewerCaps` size cap as `fs:read` BEFORE reading (over-cap → `too-large`). The result carries a
  `Uint8Array` (structured-clone-safe); never raw bytes for text/image (those keep their existing
  paths). DO NOT reintroduce a `cosmos-file://` fetch for documents — it works in the packaged
  app-scheme origin but breaks under `npm run dev`. Caps + confinement are covered at the
  node-integration layer (`src/main/fsExplorer.integration.test.ts`), the bridge at e2e
  (`tests/e2e/app.e2e.spec.ts`).
- **Monaco worker wiring — `?worker`, no plugin.** `src/renderer/fileExplorer/monacoSetup.ts` imports
  `monaco-editor/esm/vs/editor/editor.worker?worker` and sets `self.MonacoEnvironment.getWorker`
  directly. Vite (electron-vite renderer) bundles a `?worker` import as a real worker chunk for BOTH
  dev and packaged builds, so NO `electron.vite.config.ts` change and NO `vite-plugin-monaco-editor`
  is needed (unlike the "MCP server needs a rollup input" gotcha — workers are auto-bundled). The
  `?worker` import needs `src/renderer/vite-env.d.ts` (`/// <reference types="vite/client" />`) to
  typecheck under tsconfig.web. The viewer is READ-ONLY, so only the BASE editor worker is wired (no
  ts/json/css/html LANGUAGE workers — syntax highlighting runs on the main-thread monarch tokenizers).
  The `cosmos-dark` Monaco theme is built from the live CSS tokens (`monacoTheme.ts`, pure +
  node-testable) exactly like `terminalTheme.ts` does for xterm. KNOWN COST: the bare `monaco-editor`
  barrel pulls every language tokenizer + the ts/json/css/html modes/workers into the bundle (~9MB
  main + ~15MB unused language workers); acceptable for a desktop app. The slim `editor.api` subpath
  fights tsc's Bundler moduleResolution (no `exports`-mapped types) — trim later only if size matters.
- **Two dividers + re-fit.** `ResizeDivider.tsx` reports a signed px delta and takes an `ariaLabel`;
  `TerminalPanel` owns the clamp + which COLUMN the delta drives. Divider A (terminal|viewer) drives
  `termWidth`; divider B (viewer|tree) drives `treeWidth` (a rightward drag SUBTRACTS from the dock).
  Mins: terminal 320px, tree dock 256px, middle viewer 240px; the middle viewer is `flex 1 1 0` (the
  remainder). ANY divider drag re-fits the xterm via the existing `safeFit()`+`pty.resize` path
  (exposed through a `pushResizeRef` set inside the mount effect) — divider A changes the terminal
  width; divider B re-fits too (cheap + idempotent). Both column widths are renderer-local (defaults
  ~50% terminal / ~25% dock), NOT persisted. The dividers render ONLY when a folder is open (the
  welcome-view gate above); before that there is no divider to drag.
- **`.ts`/`.test.ts` split holds.** Pure tree state (`tree.ts`), glyph/language map (`fileGlyph.ts`),
  theme (`monacoTheme.ts`), src builder (`localFileSrc.ts`), the viewer-state transitions
  (`viewerState.ts` — `selectFile`/`resolveRead`/`invalidateOpen`), and the folder-open predicate
  (`isFolderOpen` in `panelTabs.ts`) are node-tested; the React/Monaco components
  (`FileExplorer.tsx`/`FileTree.tsx`/`FileViewer.tsx`/`ResizeDivider.tsx`) and the impure
  `monacoSetup.ts` are NOT imported by any `.test.ts` (they need a DOM/worker). `FileExplorer.tsx`
  exports `useExplorerPanes` (one shared `useFileExplorer` instance backing both the viewer + dock).

### Multi-file viewer tabs (terminal-file-tabs-v1)

The MIDDLE viewer column is a VS Code-style **multi-file editor**: a row of file tabs above the
viewer body, one tab per opened file. **Renderer-only** — it changes NO `fs:*` channel, the
`cosmos-file://` scheme, the confinement, or the watcher, so there is **NO preload restart** and no
main edit. (`TerminalPanel.tsx` needs no change either — the strip lives INSIDE `FileViewer`, which
`TerminalView` already places.)

- **`openFiles.ts` — the open-files collection MIRRORS `panelTabs.ts`** (`OpenFilesState` =
  ordered `files: OpenFile[]` + `activeRelPath`), pure + node-tested (`openFiles.test.ts`). The ONE
  delta from `panelTabs.openTab`: `openOrFocus` **FOCUSES** an already-open relPath instead of
  rejecting the duplicate — the strip never holds two tabs for one path. `closeFile` **REUSES**
  `panelTabs.adjacentActiveId` (exported) for the active-close neighbour pick, single-sourced so
  file tabs and terminal tabs close identically. `updateOpenFile` patches one file's `ViewerState`
  in isolation (no cross-wire); the per-file state is still produced by `viewerState.ts`
  (`selectFile`/`resolveRead`/`invalidateOpen`). `activeViewer(state)` is what the body renders.
- **`useFileExplorer` holds the collection** (was a single `viewer`). `openFile` is open-or-focus:
  a fresh open kicks one `fs:read` → `updateOpenFile`; a re-click only activates (reuses the
  resolved viewer — no re-read). The `fs:changed` handler re-reads EVERY open file (the
  `openRelsRef` tracks all open relPaths now, not one) and invalidates only a vanished tab.
- **`FileTabStrip.tsx` is a LIGHT bespoke strip, NOT `PanelTabStrip`.** It replicates
  `PanelTabStrip`'s tokens, focus ring (`ring-[3px] ring-ring/50`), close-`X` reveal idiom,
  truncation+`Tooltip`, and roving-tabindex keymap VERBATIM (copy the few class strings + the
  ~20-line `handleTabKeyDown` — do NOT import the whole component), but drops the `+`/rename/F2/
  status-glyph/terminal-glyph/trailing chrome. Band rests on `bg-card/60` (one notch quieter than
  the panel band's `bg-popover`); active tab = `bg-card` + `font-medium` + 2px `--primary`
  top-accent. The strip **replaces** the #84 single-file header (folds into the active tab — ONE
  `h-8` band; full relPath on the tab tooltip). NO new token, NO new shadcn primitive
  (`components/ui/` + `index.css` untouched). It is NOT a `components/ui/` file (one consumer).
- **Tree highlight follows the active tab** — `useExplorerPanes` passes `selectedRelPath =
  activeRelPath` (was the single open file's relPath); `null` (empty strip) → no open-file selection.
- **Ephemeral, per-`paneId`.** The collection lives in the per-pane `useFileExplorer` instance —
  independent across terminal tabs, **NOT in the session snapshot**, reset to empty on go-live /
  restart (matching the ephemeral split-ratio + viewer state). Failed-read tabs stay NEUTRAL in the
  strip (binary/denied/not-found are calm per #84 — no red glyph); only the body shows the calm
  block. Dirty/modified indicator is OUT (read-only viewer).
