# TODO

Living checklist of outstanding work for cosmos. Maintained by the **wrap-up** skill at
the end of each iteration: completed items are checked off and newly surfaced work is added.
For the authoritative design see `docs/ARCHITECTURE.md`.

## In progress

_None._

## Next

- [ ] Manual GUI verification of **Jira ticket detail on click v1** via `npm run dev` (**requires a
  full restart, not HMR — preload changed**: new `jira:requestIssueDetail` channel): clicking a ticket
  card opens that ticket's detail in place in the active tab; the card shows a hover/focus affordance
  and is keyboard-activatable (Enter/Space), while a `—`/no-key card is inert (no cursor/hover/tab
  stop); a native "← Back to list" row returns to the originating list (default view, or the prior JQL
  search if that's where it was opened from); a failed `getIssue` shows a recoverable Notice; a
  reconnect-needed routes to native Connect/Reconnect; clicking a ticket WHILE an NL compose is
  awaiting a frame defers correctly; a transition/comment on the opened detail still re-pushes a detail
  and the back row remains.

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
