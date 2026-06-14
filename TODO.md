# TODO

Living checklist of outstanding work for cosmos. Maintained by the **wrap-up** skill at
the end of each iteration: completed items are checked off and newly surfaced work is added.
For the authoritative design see `docs/ARCHITECTURE.md`.

## In progress

- [ ] **Confirm the `UiBridge.settle` null-deref crash is gone after a CLEAN `npm run dev` restart**
  (bug `jira-refreshable-detail-nav-crash-and-empty-v1`, Defect A). The fix IS in the compiled
  `out/main/index.js` (the `if (!call) return` guard + captured-`call` settle; `settle` is now ~line
  1050). A crash re-reported on 2026-06-14 still showed the OLD stack (`settle` at `index.js:966`,
  `onMessage` at `:958`) → it came from a STALE electron main process that started before the
  rebuild (electron-vite main HMR can leave a zombie). Kill the running dev server and relaunch, then
  re-run kanban → ticket detail → Back and confirm no uncaught exception.

## Next

- [ ] **Confluence generated-UI list → page detail on click** (`/sdd`, requested 2026-06-14): clicking
  a document row in a Confluence gen-UI list opens that page's detail in place (the Jira ticket-detail
  precedent: a renderer-local nav action → `confluence:requestPageDetail` → `getPage` →
  unsolicited `target:'confluence'` frame into the active tab + a "← Back" row restoring the list).
- [ ] **Loading skeleton UI** (requested 2026-06-14): show a skeleton placeholder while a surface /
  list is loading (in place of blank/spinner-only), across the generative panels.

- [ ] **Wire a descriptor-emitting compose path for the generative adapter** (the seam flagged by all
  three adapter cycles): the bound builders / resolvers / catalogs are built + unit-tested, but no live
  trigger yet composes a *bound* surface carrying its `{dataSource,query}` descriptor — surfaces are
  still composed agent-side (`render_*_ui`) with literal data, so refresh / load-more / detail-refresh
  cannot fire at runtime. Decide + build the compose path (e.g. extend `render_*_ui` to emit the bound
  spec + descriptor, or a native main compose trigger) so `AdapterDispatcher` re-execution actually
  runs end-to-end. Until then the adapter is dormant. See `docs/ARCHITECTURE.md` §4g "Known seam".
- [ ] Manual GUI verification of the **generative adapter** (Jira → Slack → Confluence) once the
  compose path above exists: a composed surface refreshes its data on tab restore / panel
  re-activation / explicit refresh without re-composing the view; append "load more" grows the bound
  list (Slack/Confluence opaque forward cursor; Jira list); Jira page-replace prev/next where
  applicable; the `loading` flag spins only the active control with rows kept (`aria-busy`, no skeleton
  flash); empty/last-page hides load-more; fetch error shows a recoverable Notice above un-corrupted
  prior data; no secrets in any descriptor / data model / payload. Builders + dispatch logic locked by
  node tests (`jira/slack/confluenceAdapter.test.ts`, `*SurfaceBuilder.test.ts`, `dataModelApply`);
  the bound renderer was NOT live-exercised (no composing trigger yet).
- [ ] Manual GUI verification of the **multi-region kanban refresh** (`refreshable-custom-generative-ui`
  multi-region) via `npm run dev`: have the agent compose a partitioned Jira board (one bound column per
  status), move a card to a different status server-side (e.g. CSMS-6 `To Do → In Review`), hit the panel
  refresh, and confirm the card moves to its new column in place (no re-compose); confirm an EMPTY column
  still refreshes (its identity comes from its narrowed JQL, not its rows). Locked by node tests
  (`specRebinder.test.ts` + multi-region `adapterDispatcher.test.ts`) but the per-region fan-out was NOT
  live-exercised.
- [ ] Manual verification of the **bindings-first teaching** (`bindings-first-generative-ui-v1`,
  descriptions-only) via `npm run dev`: confirm the agent now composes a data surface with LITERAL
  seed rows + a declared `binding` per data container (not hand-authored `{path}` props) and the
  surface paints instantly then refreshes in place, across Jira/Slack/Confluence/generic. The
  mechanism + the no-binding dev warning are locked by node tests (`dataBearingWarning.test.ts`,
  `uiBridge.test.ts`); only the model's adherence to the reframed tool descriptions needs a live run.
- [ ] Manual GUI verification of **composer send animation v1** + **unified tab naming** via
  `npm run dev` (renderer-only, HMR is enough — but the StrictMode counter behavior only manifests in
  dev): in all four generative panels a successful Send grows-and-vanishes the composer (`scale-[2.6]`
  launch, not the old shrink-to-logo), the panel blanks to JUST the surface spinner, and the
  cosmos-logo button stays hidden until the generated surface lands (reappears on land/error);
  Esc/click-outside still does the gentle dismiss; Jira's JQL search box disappears on a generated-UI
  surface but stays for the default board / search results. Tab naming: each panel's FIRST tab reads
  the bare panel name (`Terminal`, `Generated UI`, `Jira`, `Slack`, `Confluence`), the next `+` reads
  `<Panel> 2` then `<Panel> 3` (no skip, no renumber on close); a generative compose relabels its tab
  from the utterance. Logic locked by `panelTabs.test.ts` + `promptComposerLogic.test.ts`; live launch
  not exercised by the agent (Electron window, not browser-automatable).

- [ ] Manual GUI verification of **collapsible prompt composer v1** via `npm run dev` (renderer-only,
  HMR is enough): in all four generative panels (under their composer-visible condition) the default is
  a single bottom-center cosmos-logo button and no textarea; clicking it morphs/expands into a centered
  `max-w-2xl` composer with focus in the textarea; Enter submits + auto-collapses, Shift+Enter newlines,
  empty submit is a no-op; Esc and click-outside collapse without a run and return focus to the logo;
  the draft is preserved across dismiss and cleared only on a successful submit; run/error status still
  shows via the tab strip + footer glyphs after auto-collapse; the open/close animation plays both ways.

- [ ] Manual GUI verification of **Jira ticket detail on click v1** via `npm run dev` (**requires a
  full restart, not HMR — preload changed**: new `jira:requestIssueDetail` channel): clicking a ticket
  card opens that ticket's detail in place in the active tab; the card shows a hover/focus affordance
  and is keyboard-activatable (Enter/Space), while a `—`/no-key card is inert (no cursor/hover/tab
  stop); a native "← Back to list" row returns to the originating list (default view, or the prior JQL
  search if that's where it was opened from); a failed `getIssue` shows a recoverable Notice; a
  reconnect-needed routes to native Connect/Reconnect; clicking a ticket WHILE an NL compose is
  awaiting a frame defers correctly; a transition/comment on the opened detail still re-pushes a detail
  and the back row remains. **Plus (bug `jira-detail-back-loses-generated-ui-v1`):** compose a generated
  UI, click a ticket card in it, press Back → the GENERATED UI is restored (not the default board /
  search list), no skeleton flash, and the JQL search box stays hidden.

- [ ] Manual GUI verification of **Jira JQL search box v1** via `npm run dev` (**requires a full
  restart, not HMR — preload changed**: new `jira:requestSearchView` channel): the box placeholder
  shows the my-tickets JQL `assignee = currentUser() ORDER BY updated DESC`; a valid JQL submit
  filters the ACTIVE tab; an empty/whitespace submit returns the default view; an invalid JQL shows a
  recoverable Notice (no crash); a search submitted WHILE an NL compose is awaiting a frame defers and
  both results land in the right tab; the NL composer still works unchanged.

- [ ] Manual GUI verification of **new-tab-base-view v1** via `npm run dev` (renderer-only, HMR is
  enough — no preload restart): a fresh `+` tab in every generative panel shows the panel's BASE, not
  a blank panel (Slack/Confluence native browser, Generated UI idle placeholder, Jira default board
  view); an errored tab shows its error, never the base; the composer stays mounted. Jira-specific:
  `+` (and first rail activation) reloads the my-tickets default view with a PER-TAB skeleton — a
  second loading tab still shows its own skeleton while another tab already holds a surface; a `+`
  pressed WHILE a compose is awaiting a frame DEFERS the default-view request (new tab shows base, no
  stuck skeleton) and flushes it once the run completes/errors; closing a default-loading tab does not
  crash. All unverified at runtime.
- [ ] Manual GUI verification of **confluence-default-feed v1** via `npm run dev` (OAuth-gated,
  preload restart already done): with Confluence connected and the search box empty, the panel base
  shows the personal feed (pages you're mentioned on / watching / favorited, newest first) instead of
  a blank panel; typing a query swaps to search and clearing it returns to the feed; an empty feed
  shows "No mentions, watched, or favorited pages yet."; cursor "load more" pagination works;
  reconnect_needed recovery. Unverified at runtime.
- [ ] Manual GUI verification of **panel-tabs v1** via `npm run dev` (requires the preload
  restart, not HMR): open ≥2 generated-UI tabs in a generative panel and switch between them
  with each surface preserved; `+` opens a tab, utterance fills the ACTIVE tab, submit with
  zero tabs auto-creates the first; close active tab → adjacent-tab activation, close last tab
  → native base (Slack/Jira/Confluence) or idle placeholder (Generated UI); open ≥2 Terminal
  tabs each a distinct live `claude` session, switch + rail-switch without teardown, close →
  PTY disposed, always ≥1 terminal; a generative run in flight lands in its originating tab
  after a tab switch and errors surface in the originating tab; Jira default-view-on-activation
  and `jira.*` write re-push file into the right tab; PanelTabStrip keyboard a11y. All
  unverified at runtime.

- [ ] Manual GUI verification of **terminal tab numbering** (bug `terminal-tab-index-skip-v1`) via
  `npm run dev` (renderer-only, HMR — but the StrictMode double-invoke only manifests in dev): seed
  tab reads "Terminal" (unified naming), first `+` → "Terminal 2" (NOT "Terminal 3"), next `+` →
  "Terminal 3"; close a middle terminal and the counter still climbs monotonically (no renumber).
  Logic is locked by the idempotence cases in `panelTabs.test.ts`; the live dev launch was not
  exercised by the agent. (Folds into the unified-tab-naming verification above.)
- [ ] Manual GUI verification of **per-tab native-base nav** (bug `panel-shared-tab-nav-state-v1`) via
  `npm run dev` (renderer-only, HMR — OAuth-gated): with Slack/Confluence connected, drill into a
  channel/page/search in one tab, open a `+` tab → the new tab shows its own fresh base (channel list /
  default feed), NOT the first tab's drill-in; two tabs hold independent nav simultaneously; a
  generated Slack channel-row click opens that channel IN the current tab; disconnect/reconnect resets
  all tabs' base. Logic is locked by `perTabNav.test.ts`; the connected flow is unverified at runtime.
- [ ] Manual GUI verification of the **Slack + Confluence generative panels** via `npm run dev`
  (OAuth-gated): utterance → composed A2UI surface from REAL fetched data (channels/history/threads
  for Slack; content search/page detail for Confluence); not-connected → single Notice; the spinner
  stops once the surface renders; REPLACE-ON-COMPOSE (composed surface replaces the native browser,
  "Clear generated view" returns to idle); cleared on disconnect.
- [ ] Manual verification of the **`confluence_create_page` MCP write tool** in the interactive
  Claude Code TUI (after registering `write:confluence-content` in the Atlassian console and
  reconnecting Confluence): the agent calls the tool → page created (spaceKey resolved to spaceId,
  body wrapped to storage); a token lacking the write scope returns `write_not_authorized`, not a
  hang/crash.
- [ ] Remove the temporary diagnostic logs once the Jira generative fixes are verified live:
  `[agent] run closed` (`agentRunner.ts`), `[ui] render received` (`uiBridge.ts`), `[jira] bridge
  call` + `summarizeJiraResult` (`jiraBridge.ts`).
- [ ] Manual GUI verification of the **Jira generative panel** via `npm run dev`: default view on
  rail switch; reconnect prompt when the token lacks `write:jira-work`; utterance → Jira surface
  (real fetched tickets, no hallucinated/placeholder data); spinner stops once the board renders;
  transition / comment / **create / update** → write applied + surface re-renders with the real
  post-write state; a generic (non-Jira) utterance stays in the Generated-UI panel.
- [ ] Finish manual GUI verification of the **Jira + Confluence panels** via `npm run dev`:
  browser OAuth **consent is user-verified working** (after registering the exact
  `http://127.0.0.1:7421/callback` and adding all classic read scopes in the Atlassian console).
  Still to confirm live: JQL issue search + issue detail, Confluence content search + page detail,
  refresh-on-expiry, and reconnect_needed recovery.

- [ ] Manual GUI verification of Terminal Panel SC-001..SC-003 via `npm run dev` (live
  `claude` TUI appears within seconds; keystrokes/colors render; resize reflows). Requires a
  human at a desktop session.
- [ ] Broader manual verification of the Slack panel beyond Connect (channel list paging,
  history/threads, search availability, reconnect_needed recovery). Connect via browser OAuth
  is user-verified working.

## Deferred / future

- [ ] Decide whether session control stays purely interactive (PTY) or adds the Claude Agent
  SDK for background/headless work (ARCHITECTURE §7).
- [ ] `codegraph init` once the codebase has enough real source to index (ARCHITECTURE §7).
- [ ] Optionally surface `confluence_create_page` in the **generative** Confluence panel (add it to
  `CONFLUENCE_TOOL_GRANTS` + relax the grounding prompt to permit the write) — deliberately deferred
  to keep the generative panel read-only; the create tool is interactive-TUI-only for now.
- [ ] Confluence writes beyond create (edit/delete/labels).

## Done

- [x] **Jira refreshable detail-nav crash + empty board** (bug
  `jira-refreshable-detail-nav-crash-and-empty-v1`) — two defects on the now-refreshable Jira
  generated UI (kanban). **A (main crash):** `UiBridge.settle` null-deref — the bindings branch's
  first-refresh kick (`registerAgentSurfaceBindings` → `adapterDispatcher.refresh` →
  `cancelActive`) NULLS `this.active` synchronously mid-`onMessage`, so the display-only
  immediate-settle passed `null`. Fixed by settling a CAPTURED `call` local (never `this.active`) +
  a defensive `settle(OutstandingCall|null)` guard. **B (empty board on Back):** a bound kanban's
  rows live only in live A2UI SDK state (`surface.dataModel` undefined — seed pushed separately), so
  restoring the snapshot spec on Back repainted empty `{path}` bindings. Fixed in
  `src/renderer/jiraBackNav.ts`: a bound composed snapshot restores with `restored: true`, firing
  `ActiveTabSurface`'s restore-refresh (re-registers regions + re-fetches). 986 tests green (+2
  regression describes), typecheck clean. Bug report
  `.sdd/bugs/jira-refreshable-detail-nav-crash-and-empty-v1.md`; `docs/ARCHITECTURE.md` §4.3 + §4h
  invariants. **Refresh itself confirmed working live** (dev log: kanban composes 3 bound columns,
  per-status `searchIssues`, regions registered). Not committed.
- [x] **Bindings-first ENFORCEMENT v3 — dataSource enum tightening** (`bindings-first-generative-ui-v1`)
  — v2 still failed live: the model set `descriptor.dataSource` to the MCP READ-TOOL name
  (`jira_search_issues`) not the adapter source id (`searchIssues`), so main's cross-target check
  dropped the binding → surface landed un-refreshable + refresh button disabled. Tightened each
  `render_*_ui` `DESCRIPTOR_SCHEMA.dataSource` from `z.string()` to a `.refine` against that target's
  `*AdapterSource` enum (jira `searchIssues`/`getIssue`; slack `listChannels`/`getHistory`/`search`;
  confluence `defaultFeed`/`searchContent`/`getPage`; generic = union) so a wrong value is rejected
  AT the render tool (MCP SDK validates inputSchema pre-handler → model resubmits). Added the
  "adapter source id, NOT the read-tool name" caveat to all four tool descriptions + `BINDINGS_FIRST_STEERING`.
  typecheck clean; vitest green; bundles re-emitted. `docs/ARCHITECTURE.md` §4h. Not committed.

- [x] **Bindings-first generative UI** (`bindings-first-generative-ui-v1`) — reframed all four
  `render_*_ui` tool descriptions (jira/slack/confluence/generic) bindings-first: the agent composes
  the layout and declares one secret-free `binding` per data-bearing container (single → one,
  partitioned → many); literal fetched rows are a valid first-paint **seed** (main's `rebindAgentSurface`
  overwrites the data prop regardless), `descriptor` = degenerate single-binding form. Removed the
  obsolete "author `{path}` yourself / no literal rows / literals never repaint" teaching. Added a pure
  main-side dev warning (`src/main/dataBearingWarning.ts` → `UiBridge.onMessage`) that warns once when a
  data-bearing surface carries neither `bindings` nor `descriptor`. Mechanism unchanged (§4h); no IPC
  contract change. 959 tests green, typecheck clean. Spec/plan at
  `.sdd/{specs,plans}/bindings-first-generative-ui-v1.md`; `docs/ARCHITECTURE.md` §4h note. Not committed.

- [x] **Bindings-first ENFORCEMENT (v2)** (`bindings-first-generative-ui-v1`) — the description
  reframe did not make the model comply at runtime (it fetched broadly, split client-side, rendered
  literal rows with no binding → refresh disabled, reload repaints stale rows). Added (a) uniform
  bindings-first **grounding steering** to every data-bearing target (`groundingPromptForTarget` in
  `src/main/mcpConfig.ts`) forcing a per-container narrowed-query binding; (b) **tool-level
  rejection** — each `render_*_ui` handler runs `BindingsFirstEnforcer` (`src/shared/dataBearingSpec.ts`)
  and returns an `isError` for an unbound data spec so the model resubmits with bindings; static /
  already-bound calls render. Reject loop bounded (`ENFORCEMENT_REJECT_CAP = 2`, in-memory per render
  server process) → render-anyway after the cap. Moved `LIST_SOURCE_DATA_PROP` + the
  `specHasUnboundDataContainer` heuristic into `src/shared/` so the MCP bundles import it (main keeps a
  thin re-export); MCP rollup bundles verified. No IPC/contract change. typecheck clean; 980 tests
  green. Not committed.
- [x] **API→UI generative adapter — three-cycle set** (`jira/slack/confluence-generative-adapter-v1`) —
  composed surfaces gain refreshable, paginated data via A2UI 0.9's view/data split: `{path}` +
  `TemplateBinding` bound surfaces seeded by an initial `updateDataModel`, a persisted **secret-free**
  descriptor `{dataSource,query}` beside the view spec, a channel-independent main-side
  **`AdapterDispatcher`** (`src/main/adapterDispatcher.ts` + `dataModelApply.ts`) that on refresh /
  reserved `adapter.*` action re-executes the descriptor (tokens stay in main) and pushes
  `updateDataModel` keyed by `surfaceId` — never a full re-push. Shared catalog controls extracted to
  `src/renderer/catalogShared/controls.tsx` (`useBound`/`RefreshButton`/`LoadMoreButton`/
  `PaginationBar`). **Jira** built the shared infra + page-replace + reconciled `jira.*` writes into the
  generalized path; **Slack** + **Confluence** reuse it verbatim as read-only **append-only** lists
  (opaque forward cursors, no `hasPrev`) via `{slack,confluence}Adapter.ts`/`*SurfaceBuilder.ts` joined
  by a composite resolver in `index.ts`; Confluence page-detail is refresh-only (`pagination:'none'`).
  Shared contract unchanged across all three. 871 tests green (+88), typecheck clean. Specs/plans/
  designs at `.sdd/{specs,plans,designs}/{jira,slack,confluence}-generative-adapter-v1.md`;
  `docs/ARCHITECTURE.md` §4g, `docs/DEVELOPMENT.md` "Generative adapter". **Not yet runtime-wired** — no
  live compose trigger emits a bound surface + descriptor yet (see Next); bound renderer not
  live-exercised. Not committed.
- [x] **Jira back-nav loses pinned generated UI** (bug `jira-detail-back-loses-generated-ui-v1`) — Back
  from a ticket detail opened on top of a PINNED generated-UI (`composed`) surface returned to the
  default board / last search instead of restoring the generated UI. Cause: the unsolicited detail
  frame OVERWRITES the active tab's surface (flips `composed`→`false`) and the back-nav origin had no
  `composed` variant, so the generated UI could not be recovered. Fixed renderer-only with a pure
  helper `src/renderer/jiraBackNav.ts` (`JiraBackOrigin` adds a `composed` variant carrying a
  `TabSurface` snapshot; `backNavTarget` → `restore-surface`/`read-search`/`read-default`, malformed
  composed safe-falls-back, never throws); `JiraPanel.tsx` snapshots the surface AT detail-open time in
  `handleSurfaceAction` and `goBackToList` restores it verbatim via `update(tab,{surface,composed:true,
  loadingDefault:false})` (no read, no skeleton). 698 tests green (new `jiraBackNav.test.ts`), typecheck
  clean. Bug report `.sdd/bugs/jira-detail-back-loses-generated-ui-v1.md`; `docs/ARCHITECTURE.md` §4.9
  back-row gotcha added. GUI verification pending.
- [x] **Composer send animation v1** (`composer-send-animation-v1`) — Send now animates the shared
  composer GROWING to fill and fading out (`launching` flag → `scale-[2.6]`,
  `transition-[opacity,scale,filter]`) instead of shrinking into the logo; Esc/click-outside stays a
  gentle `scale-95` dismiss. During a run the composer takes a `busy` prop (= the panel's surface-
  spinner gate) that hides BOTH composer states INCLUDING the cosmos-logo button — the logo reappears
  only when the run's surface lands/errors (supersedes the spec's "re-open mid-run"). New
  `SurfaceSpinner`/`CosmosSpinner` render in the active tab's content region, gated by
  `surfaceSpinnerVisible` (`inFlight && !surface && !error && !loadingDefault`); submit sets
  `surface:null` so the panel blanks to just the spinner. Added a per-tab `composed` flag so Jira
  hides its JQL search box on generated surfaces but keeps it for ticket browsing; Jira's default-load
  effect gained an `!inFlight` guard. Renderer-only, no contract change; typecheck clean, 693 tests
  green. Spec/plan/design at `.sdd/{specs,plans,designs}/composer-send-animation-v1.md`;
  `docs/ARCHITECTURE.md` §4 composer + originating-tab sections updated. GUI verification pending.
- [x] **Unified seed-tab naming** — one convention across every rail panel via
  `panelTabLabel(panelName, index)`: the bare panel name for the first tab, then `<Panel> N`
  (`Terminal`/`Terminal 2`; `Jira`/`Jira 2`; etc.). `terminalLabel` delegates to it; the generative
  hook mints labels from a per-panel monotonic `everOpened` counter (no renumber on close, advanced
  off render-phase so StrictMode can't double-count). Replaced the old `Untitled` placeholder + the
  `Terminal 1` first-tab label. `docs/ARCHITECTURE.md` originating-tab section updated; 693 tests green.
- [x] **Sidebar selected-panel highlight** (`sidebar-selected-panel-highlight-v1`) — the active item
  in the left icon rail (`App.tsx`) now reads as clearly selected via three redundant cues: a
  `--secondary` (`#3a3a3c`) filled pill behind the icon, the icon at full `--foreground` brightness,
  and a 3px full-height `--primary` left bar. ROOT CAUSE of the long-running "highlight never shows"
  failure (no CSS/`!important` attempt worked): each `TabsTrigger` is wrapped by `TooltipTrigger
  asChild`, and the Tooltip's `data-state` is spread AFTER the Tabs `data-state` onto the same
  `<button>`, so its `data-state` is never `"active"` — every `data-[state=active]:*` class was dead.
  Fixed by driving the highlight from React state (`isActive = surface === id`) and applying the cues
  conditionally; `bg-secondary!`/`text-foreground!` keep the trailing-`!` to beat the line variant's
  `bg-transparent` and the `dark:text-muted-foreground` idle color. Uses existing theme tokens (no new
  token, no inline hex). Renderer-only, no contract change; typecheck clean; GUI-verified by the user.
  Corrected spec FR-008's wrong assumption. Spec/plan/design at
  `.sdd/{specs,plans,designs}/sidebar-selected-panel-highlight-v1.md`; gotcha in `docs/DEVELOPMENT.md`
  (Styling "Nested Radix triggers"), `docs/ARCHITECTURE.md` §3.
- [x] **Collapsible prompt composer v1** (`collapsible-prompt-composer-v1`) — replaced the always-on,
  full-width composer in all four generative panels (Generated UI · Jira · Slack · Confluence) with ONE
  shared `src/renderer/PromptComposer.tsx` that defaults COLLAPSED to a bottom-center cosmos-logo button
  (`CosmosMark`, pastel pink→purple) and EXPANDS to a centered `max-w-2xl` overlay card (zero-height
  in-flow slot + `absolute bottom-0`, transparent `pointer-events-none` surround so tickets behind stay
  visible; card itself opaque `bg-popover`). Open-only logo; collapses on submit / Esc / click-outside;
  draft preserved until a successful submit; mid-run collapse allowed (status persists via tab-strip +
  footer glyphs, OQ-1). Both states stay mounted + cross-fade via `expanded` (hidden one `inert` +
  `pointer-events-none` + `tabIndex=-1`) so the 400ms `cubic-bezier(0.16,1,0.3,1)` morph fires both
  ways: the COMPOSER carries the size motion (scales from `scale-[0.08]` at `origin-bottom` = the
  button's point), the LOGO only opacity-fades with a `delay-150` collapse stagger. Pure logic in
  `promptComposerLogic.ts` (21 node tests). Added a reusable `cosmos` Button variant + single-sourced
  brand tokens `--brand-pink`/`--brand-purple`/`--brand-foreground` (index.css), consumed by the
  variant and `CosmosMark`. Renderer-only, no contract change. 682 tests green, typecheck clean.
  Hit + recorded a Tailwind-v4 gotcha (`scale-*` is the standalone `scale:` prop, not `transform`).
  Spec/plan/design at `.sdd/{specs,plans,designs}/collapsible-prompt-composer-v1.md`; see
  `docs/ARCHITECTURE.md` §3 (renderer) + `docs/DEVELOPMENT.md` Styling. GUI verification pending.
- [x] **Terminal tab index skip** (bug `terminal-tab-index-skip-v1`) — the Terminal panel's first `+`
  tab opened as "Terminal 3" instead of "Terminal 2". NOT the user's hypothesized background gen-UI
  terminal (the Generated UI surface is a headless `AgentRunner`, not a PTY — nothing consumes an
  index); the real cause was an IMPURE `useState` lazy initializer that advanced the monotonic
  `everOpened` ref, which React StrictMode double-invokes in dev (the ref advanced twice for one seed
  tab). Fixed by making the seed referentially pure: new pure helper `seedTerminalIndex()`→1 in
  `panelTabs.ts`, counter initialized AT the seed index (`useRef(seedTerminalIndex())`), seed tab
  labelled directly via `terminalLabel(seedTerminalIndex())` with no `mintTab()` in the initializer;
  `mintTab()` advances only from event handlers / the empty-refill effect. Pure helpers untouched;
  monotonic close/reopen numbering preserved. Renderer-only, no contract change. 649 tests green (3
  new idempotence cases in `panelTabs.test.ts`), typecheck clean. Bug report
  `.sdd/bugs/terminal-tab-index-skip-v1.md`; CLAUDE.md StrictMode-purity gotcha added. GUI
  verification pending (dev-only manifestation).
- [x] **Per-tab native-base nav** (bug `panel-shared-tab-nav-state-v1`) — Slack & Confluence panels
  shared ONE native-base browser nav across all tabs (a drill-in in one tab bled into every other);
  fixed by holding the nav PER-TAB keyed by tab id via a new pure helper `src/renderer/perTabNav.ts`
  (`getNav`/`setNav`/`dropNav`/`clearAllNav`, node-tested) + `usePerTabNav.ts` hook, reused by both
  panels. Connection transitions `clearAllNav()` (reset all tabs); tab-close drops the entry; Slack's
  generated channel-row click now opens the channel IN the current tab (set view + clear surface)
  instead of close-active-tab. Renderer-only, no contract change. 646 tests green (11 new
  `perTabNav.test.ts`), typecheck clean. Bug report `.sdd/bugs/panel-shared-tab-nav-state-v1.md`;
  CLAUDE.md gotcha added. GUI verification pending (OAuth-gated).
- [x] **`bugfix` skill** — added `.claude/skills/bugfix/SKILL.md` + `bug_report_template.md`: a defect
  cycle parallel to `sdd` (triage → scope-gate → classify & route to designer/developer/architect →
  root-cause → fix → regression test → verify → wrap-up). After triage a scope-gate escalates large
  fixes to `sdd`. Bug reports live at `.sdd/bugs/<bug>-v<N>.md`. CLAUDE.md Workflow updated.
- [x] **Jira ticket detail on click v1** (`jira-ticket-detail-v1`) — clicking a `TicketCard` in the
  Jira `IssueList` opens that ticket's full detail IN-PLACE in the active tab, with a native
  "← Back to list" row (Confluence `ChevronLeft` precedent) that re-runs the originating read (default
  view / last JQL search). Deterministic + read-only: the clickable card emits a renderer-local nav
  action (`jiraNav.openDetail`, non-`jira.*`) intercepted by the panel's `onAction` (returns `true`,
  never forwarded to main/agent — the Slack open-channel seam); the new sibling channel
  `jira:requestIssueDetail { issueKey }` runs `getIssue` → `JiraSurfaceBuilder.buildIssueDetailSurface`
  → unsolicited `target:'jira'` frame into the active tab (reuses the §4.11 fire-or-defer
  `requestDefaultInActiveTab` seam). No new OAuth scope, no token on payload/surface; `jira.*` write
  actions still flow to main (`onAction` returns `false`). No new tokens/components. 619/619 tests
  green, typecheck clean. GUI verification pending (preload restart). See `docs/ARCHITECTURE.md` §4.9.
- [x] **Jira JQL search box v1** (`jira-jql-search-v1`) — a native deterministic JQL search box on the
  connected Jira panel, kept ALONGSIDE the NL composer. Placeholder = the my-tickets JQL `assignee =
  currentUser() ORDER BY updated DESC`; empty/whitespace submit ⇒ default view, non-empty ⇒ a native
  `jira:searchIssues` read (NOT an `AgentRunner` run) → `JiraSurfaceBuilder` `IssueList` → an
  unsolicited `target:'jira'` frame replacing the ACTIVE tab. New sibling channel
  `jira:requestSearchView` `{ jql }` (the zero-payload `requestDefaultView` trigger was NOT
  overloaded); main shares one `handleJiraView(jql)` helper between default-view and search (helper
  does empty⇒default fallback); renderer reuses the unsolicited-frame fire-or-defer correlation-slot
  discipline in place via a new hook method `requestDefaultInActiveTab` (in-place analog of
  `newTabWithDefault`, sharing a private `fireOrDeferDefault` core). Read-only — no new OAuth scope, no
  token on payload/surface. 603/603 tests green (11 new `validateRequestSearchView` cases), typecheck
  clean. GUI verification pending (preload restart). See `docs/ARCHITECTURE.md` §4.9.
- [x] **Equipped the SDD agents with codegraph + agentmemory** — added the `codegraph_*` +
  agentmemory `memory_*` MCP tools to `.claude/agents/{architect,developer,designer}.md` `tools:`
  frontmatter (they previously lacked them, so the architect fell back to raw Read/Grep), plus a
  grounding principle in each agent file, a CLAUDE.md Workflow rule, and an sdd skill Step 0
  clarification: SDD subagents ground their OWN investigation via codegraph/agentmemory — the
  orchestrator delegates the investigation, NOT pre-gathered context embedded in the prompt.
- [x] **Confluence default feed v1** — the Confluence panel's idle base (native search box empty) now
  shows a **default personal feed** instead of a blank panel: a deterministic native read
  (`ConfluenceClient.defaultFeed` → `ConfluenceManager.defaultFeed` → new `confluence:defaultFeed` IPC
  channel, NOT an `AgentRunner` run, no bridge/MCP) over the fixed CQL `(mention = currentUser() or
  watcher = currentUser() or favourite = currentUser()) and type = page order by lastmodified desc` —
  the closest 3LO-reachable approximation of the notification/bell feed (Confluence Cloud exposes no
  OAuth-3LO notifications API/scope). Generalized `ContentList` in `ConfluencePanel.tsx` to take a
  `fetcher`/`reloadKey`/`emptyLabel`, reused by both idle-feed and search branches; reuses the v1
  search endpoint + opaque-cursor pagination + `ConfluenceResult<…>` shape. 592 tests green, typecheck
  clean. See `docs/ARCHITECTURE.md` §4.9.
- [x] **New tab base view v1** — a fresh `+` tab (or any empty/uncomposed active tab) now shows the
  panel's base screen instead of a blank panel. Generalized each generative panel's base gate from
  `tabs.length === 0` to "active tab is empty" (`!activeTab || (!activeTab.surface && !activeTab.error)`);
  the A2UI host is gated on `activeTab && (activeTab.surface || activeTab.error)`. Per-panel base:
  Slack/Confluence native browser, Generated UI idle placeholder, Jira the agent-generated my-tickets
  default board view. For Jira each new tab (first activation + `+`) requests one `requestDefaultView()`
  via a new generic shared-hook seam `newTabWithDefault(request)`, with PER-TAB `loadingDefault` (fixed
  a panel-wide-flag bug where a second loading tab showed no skeleton). The unsolicited default-view
  frame is fired-when-idle / DEFERRED-while-a-compose-awaits-a-frame to protect the shared
  `originatingTabIdRef` slot (OQ-1); two pure decision helpers (`defaultRequestDecision`,
  `shouldFlushDeferredDefault`) live in `panelTabs.ts`. Renderer-only — no IPC/main/MCP change. 576
  tests green, typecheck clean. See `docs/ARCHITECTURE.md` §4.11 / §4.9.
- [x] **Panel tabs v1** — each rail panel (Terminal · Generated UI · Slack · Jira · Confluence)
  now hosts its own independent, session-only set of VS Code-style tabs (side-by-side
  variable-width tabs, click-to-switch, per-tab `X`, trailing `+`, overflow scroll). New
  renderer modules: `panelTabs.ts` (pure logic), `usePanelTabs.ts`, `PanelTabStrip.tsx` (bespoke,
  not shadcn `Tabs`), `useGenerativePanelTabs.ts` (renderer-only originating-tab correlation —
  `UiRenderPayload` unchanged; valid only while runs are sequential), `ActiveTabSurface.tsx`
  (per-tab A2UI host). Utterance fills the ACTIVE tab (auto-creates the first when zero open);
  the one main/IPC change is multi-PTY: `PtyManager` is now `Map<paneId, IPty>` with renderer-minted
  `paneId`, new `pty:start`/`pty:dispose`, per-pane restart, `killAll()`, and the single-PTY
  auto-start removed. 570 tests green, typecheck + build clean. See `docs/ARCHITECTURE.md` §3 /
  §4.1 / §4.2 / §4.4 / §4.11.
- [x] **Confluence create-page write tool** — added a single model-mediated `confluence_create_page`
  tool to the existing `cosmos-confluence` MCP server (NOT a deterministic dispatcher/surface form):
  `ConfluenceClient.createPage` resolves the space KEY → numeric `spaceId` via `GET
  /wiki/api/v2/spaces` then POSTs `/wiki/api/v2/pages` with the body wrapped to storage XHTML by the
  new `plainTextToStorage`. Added the `write:confluence-content` scope + `getWriteCapability()`
  scope-gap short-circuit (`write_not_authorized`) mirroring Jira. Registered for the interactive PTY
  via `embeddedMcpConfig` but deliberately kept OUT of `CONFLUENCE_TOOL_GRANTS`, so the generative
  Confluence panel stays read-only. 484 tests green, typecheck + build clean. See
  `docs/ARCHITECTURE.md` §4.9.
- [x] Milestone 1 — Terminal Panel (node-pty + xterm.js, typed IPC, 29/29 tests, build green).
- [x] Milestone 2 — render_ui MCP server + A2UI Generated-UI panel (server + panel built, tests green).
- [x] Slack integration v1 — read-only Slack (channels/history/threads/search/user lookup) over a
  native panel + read-only MCP tools, one main-managed connection. Connects via cosmos's own
  desktop PKCE OAuth (no secret, no per-user bot); single user token, encrypted main-only.
- [x] Consolidated `.sdd/design.md` into `docs/ARCHITECTURE.md` as the single design reference.
- [x] Atlassian integration v1 — two **fully separate** read-only integrations (Jira: JQL search +
  issue detail; Confluence: content search + page detail), each its own browser PKCE OAuth +
  encrypted token (access+refresh, cloudId), native panel, and read-only MCP server. Self-build
  over Atlassian REST (chosen over the Rovo remote MCP). Atlassian Cloud requires a `client_secret`
  (env, main-only); tokens refresh on expiry, reconnect_needed only on refresh failure. 244/244
  tests green, typecheck + build clean. See `docs/ARCHITECTURE.md` §4.9.
- [x] Wired codegraph (consult hooks in the `sdd` skill) and agentmemory (recall at cycle start,
  `memory_save` at wrap-up) as the canonical cross-session memory for the SDD workflow.
- [x] Sidebar **single-surface switcher** — the left icon rail (Terminal · Generated UI · Slack ·
  Jira · Confluence) now shows exactly one surface full-width; Terminal joined the rail and is the
  default. All surfaces stay mounted (forceMount) so the live PTY + pending render_ui survive
  switching. Renderer-only (`App.tsx`/`App.css`); typecheck + build green. Fixed a latent
  Tailwind-v4 cascade-layer bug (unlayered CSS beat the `data-[state=inactive]:hidden` utility) and
  a vertical-Tabs icon-centering issue along the way. Confluence/Jira OAuth consent verified live.
  See `docs/ARCHITECTURE.md` §3 / §4.2.
- [x] **Generative-UI foundation v1** — prompt input + run-status UI in the Generated-UI tab; an
  utterance is sent to a headless `AgentRunner` (`src/main/agentRunner.ts`) that invokes `claude`
  programmatically with the `render_ui` tool granted, so an utterance produces generative UI.
- [x] **Jira generative-UI v1** — made Jira surfaces actionable via deterministic `jira.*` action
  binding (`JiraActionDispatcher`): main executes the write without re-invoking Claude, then
  re-reads + re-pushes the surface with a fresh requestId. Added the `write:jira-work` scope and the
  `jira_transition_issue` + `jira_add_comment` write MCP tools.
- [x] **Jira generative-UI v2** — turned the native Jira rail panel into a generative custom-catalog
  A2UI surface: target-routed render frames (`UiRenderPayload.target`) feeding per-panel
  `<A2UIProvider>`s, a single `AgentRunner` granting only the target's render tool, a Jira-scoped
  `render_jira_ui` entry script, the `src/renderer/jiraCatalog/` custom catalog, and a per-switch
  default view (`jira:requestDefaultView`). 365 tests green.
- [x] **Jira write-extend v1** — ticket **create + update**: `jira_create_issue` + `jira_update_issue`
  MCP tools (same `cosmos-jira` server, no new rollup input), `CreateIssueForm` + `EditIssueForm` in
  the jira catalog, and `jira.create` / `jira.update` deterministic bound actions. Minimal fixed
  create fields (no createmeta); update sends only changed fields. No new OAuth scope
  (`write:jira-work` covers it). 422 tests green, typecheck + build clean. See
  `docs/ARCHITECTURE.md` §4.9.
- [x] **Slack + Confluence generative-UI v1** — gave the Slack and Confluence rail panels the same
  generative-view UX as Jira: a `PromptComposer` utterance drives a target-routed headless
  `AgentRunner` run that fetches REAL data via the integration's READ tools and composes its own
  read-only A2UI surface in that panel via a per-panel custom catalog (`slackCatalog/`,
  `confluenceCatalog/`). Extended `UiRenderTarget` to `slack`/`confluence`; added scoped render MCP
  servers (`slackRenderUiServer`/`confluenceRenderUiServer`) + rollup inputs + `embeddedMcpConfig`
  wiring; per-target `mcpConfig` branches (render + read tools + anti-fabrication grounding prompt).
  Both stay READ-ONLY (no writes/dispatcher). Also fixed two cross-cutting bugs: the headless run's
  Jira surfaces hallucinated tickets (→ grounding prompt) and the panel spinner never stopped (→
  `UiBridge` settles any `target !== 'generated-ui'` render immediately). 459 tests green, typecheck
  + build clean. See `docs/ARCHITECTURE.md` §4.8/§4.9/§4.10.
