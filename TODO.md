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

- [ ] Manual GUI verification (full `npm run dev` restart — main/preload changed) of the
  **Home-timeline batch**: agent-progress STREAMING (multi-step prompt → tool calls + assistant
  messages appear progressively, spinner until done, no duplicate/empty context bubble incl. a
  cross-panel submit); the **Cosmos→Home** rename (rail tooltip/footer = Home, default tab = Cosmos,
  breadcrumb "Home > Cosmos"); the rail **divider** (Home↔Terminal); the **combined context box**
  (header→divider→body), **bubble = primary**, **assistant logo avatar** + alignment, **tool-call
  indent**, 2/3 width caps; the **disconnect modal** (crimson destructive button, 14px description);
  and the **panel-tab tree** (click a tab → composer context). Logic/render is covered by
  node/jsdom/integration; the live pixel + wake/stream behavior was NOT exercised headless.
- [ ] Manual GUI verification of the **panel-switch shortcut** (`panel-switch-shortcut-v1`, #90) via
  `npm run dev` (HMR is enough — no preload/IPC change): Cmd+Opt+Down advances the left-rail panel one
  step with wrap-around (Confluence → Terminal), Cmd+Opt+Up retreats with wrap-around (Terminal →
  Confluence); the shortcut still fires with the embedded terminal FOCUSED (panel switches, no stray
  chars reach xterm); and the pre-existing bindings are unchanged — Cmd+Shift+]/[ still switches panels
  and Cmd+Opt+Left/Right still cycles tabs. Matcher logic is locked by `shortcutMatch.test.ts`; the live
  rail switch / xterm-focus behavior was NOT exercised headless.
- [ ] Manual GUI verification of the **terminal file explorer split** (`terminal-file-explorer-v1`,
  #84) via `npm run dev` (**full restart — NEW preload `window.cosmos.fs.*` + NEW `cosmos-file://`
  protocol**): in a started terminal tab, the right pane shows a file tree rooted at the tab's cwd;
  drag the bespoke divider (or ArrowLeft/Right on it) and confirm the terminal re-fits (no clipped
  xterm) with the 20rem/16rem mins honored; expand a dir (skeleton only on FIRST list, none on a
  watch re-list); create/delete a file on disk and confirm the tree refreshes SEAMLESSLY (no flash);
  click a text/code file → read-only Monaco viewer REPLACES the tree with a Back affordance (Esc /
  Backspace / ChevronLeft all return); click an image → it streams via `cosmos-file://` (broken ref
  → calm ImageOff block, never a red Notice); a binary/denied/not-found file → calm centered state
  block. Logic locked by node tests (`tree.test.ts`, `fsExplorer`, `fileKind`, `localFileRef`,
  `pathConfine`); the rendered tree/viewer/divider/image-stream were NOT live-exercised headless.
- [ ] **DECISION (user): calendar month/year label language** — the nav cluster currently shows the
  English label `"June 2026"` (designer override of spec FR-001's Korean `YYYY년 M월`, on the grounds
  that the whole app carries zero Korean strings / no i18n). Confirm English, or request the Korean form.
- [ ] Manual GUI verification of the **generative-UI line-break clamp** (`slack-generative-wrap-v1` +
  Jira/Confluence follow-up) via `npm run dev` (OAuth-gated): compose a Slack/Jira/Confluence surface
  whose data has a long unbroken token, in BOTH `Column`- and `Row`-grouped layouts — confirm the line
  wraps within the panel with NO horizontal scroll. Logic locked by the catalog `logic.test.ts` clamp
  assertions; the rendered wrap was NOT live-exercised.
- [ ] Manual GUI verification of **calendar month/year navigation** (`calendar-month-year-nav-v1`) via
  `npm run dev` (**full restart — preload changed**; OAuth-gated): prev/next month (incl Dec↔Jan), prev/
  next year, and Today all re-read the right month; a tab round-trip keeps the displayed month; refresh
  re-reads the displayed (not current) month; the nav cluster shows only on the live default view (not on
  a composed snapshot / disconnected). Logic locked by `calendarNavLogic.test.ts`; not live-exercised.
- [ ] Manual GUI verification of the **terminal [Open] directory picker** (`terminal-open-directory-
  picker-v1`) via `npm run dev` (**full restart — preload changed**): a new tab shows the `[Open]` empty
  state with NO auto-spawn; picking a dir starts `claude` in that cwd; cancelling keeps `[Open]`; a
  restored session auto-resumes without a pick. Logic locked by `paneSpawn` tests; not live-exercised.
- [ ] Manual GUI verification of **pinnable terminal favorites** (`cosmos-terminal-favorite-multiplex-v1`)
  via `npm run dev`: right-click a Terminal tree row in Home → Pin → a terminal favorite appears after
  the default; click it → it mirrors the live source terminal (seeded scrollback then live output, in
  sync with the source view); typing in either view drives the SAME PTY (each char once per view);
  closing the source tab / unpinning / switching Home tabs NEVER kills the source terminal; switching
  surfaces re-fits the on-screen view only. xterm-in-jsdom is not exercised by tests, so the live
  mirror + input fan-out + resize-on-switch are a MANUAL check (the non-owning lifecycle gates +
  resize-guard predicate + favorite branch states ARE locked by tests).
- [ ] Manual GUI verification of the **terminal favorite's SHARED file explorer** (`cosmos-terminal-
  favorite-explorer-share-v1`) via `npm run dev`: in a live terminal open a few files (a text file +
  another), then open its Home favorite → the favorite shows the SAME open-file tabs + active file +
  tree at the same cwd BESIDE the mirrored terminal; open/close/activate a file in EITHER view reflects
  in BOTH (one shared open-files store); the same text file shows identical content in both while
  cursor/scroll stay independent per view; an on-disk change to an open file updates both at once;
  closing the source tab degrades the WHOLE favorite (terminal + explorer) to the calm "no longer open"
  state with no explorer against a dead pane. v1 is READ-ONLY (no edit/save). Monaco-in-jsdom is not
  exercised by tests, so the live two-view render is a MANUAL check (the shared-store/registry refcount,
  resolver, single-mount no-regression, and two-mount content-sync ARE locked by tests —
  TERM-EXPLORER-SHARE-01).
- [ ] Manual GUI verification of **native-view favorite mirrors** (`cosmos-native-view-mirror-surface-v1`)
  via `npm run dev`: pin a Confluence tab showing a page (and one showing the feed/search) + a Slack tab
  showing a channel's history (and one on the channel list) → each favorite renders the LIVE native view
  inline (NOT "Waiting…"); switching the source view (open another page, switch channel, run a search)
  updates the favorite; composing an agent surface in the source flips the favorite to the composed
  surface, returning to native restores the mirror; closing the source → GONE. The mirror build +
  projection + pins gate + builder relocation ARE locked by tests; the live A2UI render of the mirror in
  Home is the MANUAL check (the SDK render is stubbed in the dom tests).
- [ ] Manual GUI verification of the **terminal picker spinner-hang fix** (`terminal-picker-spinner-
  hang-v1`) via `npm run dev` (StrictMode dev): open a fresh terminal tab → click `[Open a folder]` →
  pick a directory → confirm `claude` spawns in that cwd and the "Opening…" spinner clears (no infinite
  spin); cancelling keeps `[Open]`. This was the reproduce-in-dev defect; verify it no longer hangs.
- [ ] Manual GUI verification of the **Jira skeleton-width fix** (`jira-skeleton-width-v1`) via
  `npm run dev` (OAuth-gated): trigger a Jira default-view load (rail switch / tab-switch refresh) and
  a multi-region kanban load — confirm the loading skeleton fills the panel width and the swap to the
  rendered surface does NOT jump horizontally. Renderer/CSS-only; not live-exercised headless.
- [ ] Manual GUI verification of the **Slack rich message render** (`slack-rich-message-render-v1`)
  via `npm run dev` (**full restart — CSP `img-src` widened; reconnect Slack once to grant the new
  `emoji:read` + `files:read` scopes**; OAuth-gated, needs a connected workspace): open a channel whose
  history has a `<@U…>` mention, a standard `:tada:` emoji, a workspace custom emoji, and an image
  attachment — confirm the mention shows `@DisplayName` (not the ID), the standard emoji shows its glyph,
  the custom emoji + attachment render as inline images, and a broken ref degrades. **Mentions + standard
  + custom emoji CONFIRMED working** post-reconnect (2026-06-20); attachment images pending the
  `files:read` reconnect (`slack-attachment-image-broken-v1`) (literal `:shortcode:` / browser broken-
  image) without crashing — on BOTH the native panel and an agent-composed Slack surface. Logic locked by
  node tests (`slackImageRef`, `slackImageExtract`, `slackEmoji`, `slackEmojiList`, `messageContent`,
  `slackText`); rows NOT live-exercised. **Also decide two cosmetic design-spec deviations** (developer
  shipped lazy variants): attachment thumbnails use `flex-wrap max-h-40 max-w-[12rem] object-cover` vs the
  design spec's `grid grid-cols-2 gap-1.5 max-h-60 object-contain`; resolved mentions render as plain text
  vs the spec's `font-medium text-primary` accent. Keep as-is or align to `.sdd/designs/slack-rich-message-render-v1.md`.
- [ ] Manual GUI verification of the **Slack text-rendering fix** (`slack-text-rendering-v1`) via
  `npm run dev` (OAuth-gated — needs a connected Slack workspace): open a channel whose history has a
  multi-line message and an emoji (e.g. `:tada:`) — confirm newlines render on separate lines and the
  emoji shows as the glyph (not literal `:tada:` / escaped entities / raw `<@U…>` markup), on both the
  native panel and an agent-composed Slack surface. Decode logic locked by `slackText.test.ts`; the
  rendered rows were NOT live-exercised (no Slack workspace in the build env).
- [ ] Manual GUI verification of **Google Calendar integration** (`google-calendar-v1`, `/sdd`,
  requested 2026-06-15) via `npm run dev` (**requires a full restart, not HMR — new preload
  `googleCalendar` sub-API**): the rail shows the `CalendarDays` icon LAST; with the Google client
  configured + connected, activating the surface fires the default **month grid** of the current month
  (today chip, all-day tinted bars vs timed dot+time chips, `+N more` overflow, spillover days muted,
  empty-month note); not-connected/connecting/reconnect states + connect/disconnect via the footer
  reuse the shared treatments; Settings → Google Calendar section saves client id/secret, a changed
  id/secret while connected force-disconnects Google ONLY (Slack/Atlassian untouched), secret shows
  configured/source only. Real OAuth needs a Google Cloud client (id+secret) registered with the
  runtime loopback redirect. Logic locked by node tests (`googleCalendarCatalog/logic.test.ts`,
  `validateGoogleCalendar.test.ts`, `clientConfigResolver.test.ts`); GUI NOT live-exercised.
- [ ] **Loading skeleton UI** (requested 2026-06-14): show a skeleton placeholder while a surface /
  list is loading (in place of blank/spinner-only), across the generative panels.
- [ ] Manual GUI verification of **Confluence page detail on click v1** (`confluence-page-detail-nav-v1`,
  NATIVE-REUSE approach — renderer-only, HMR is enough, NO preload restart): in a generated Confluence
  list, clicking an id-bearing document row opens that page's detail in place via the EXISTING native
  `PageDetail` component (title / space / body), with hover/focus affordance, while a no-id row is inert
  (no cursor/hover/wrapping button); a native "← Back" row clears the overlay and restores the generated
  list verbatim (live A2UI host underneath, no re-fetch); an empty body shows the calm muted line (not an
  error); a `getPage` failure shows `PageDetail`'s recoverable error; reconnect-needed routes to native
  Connect/Reconnect; switching tabs clears an open detail. Logic locked by `confluenceCatalog/logic.test.ts`;
  the click-to-open / back overlay flow was NOT live-exercised (Electron window, not browser-automatable).

- [ ] Manual GUI verification of **Confluence detail rich render + real-id open** (`confluence-detail-rich-render-v1`,
  via `npm run dev` — renderer + main, HMR enough for the renderer, preload unchanged): open a Confluence
  page detail with headings / lists / a table / a code block from the NATIVE panel — confirm it renders as
  rich themed content (cosmos prose colors WIN the cascade), not plain text; an empty-body page shows "This
  page has no readable body."; the gen-UI overlay renders IDENTICALLY to the native panel; clicking an
  agent-composed search-result row opens the correct page with NO "HTTP 500"; wide tables/code scroll
  horizontally and the panel stays responsive. Sanitize/validator/catalog logic locked by node tests; the
  rich render + cascade-layer win were NOT live-exercised (Electron window).
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

## Design-foundation migration (deferred)

> Source: `design-foundation-v1` (FR-082). The named foundation scales now exist as tokens +
> utilities in `src/renderer/index.css` (§7–§14 of `docs/DESIGN.md`); the foundation cycle was
> strictly ADDITIVE and did NOT migrate any existing surface. The items below move shipped surfaces
> off their raw arbitrary values onto the named scales, incrementally — they are NOT done this cycle.
> File paths are as-of 2026-06-28 (the new restructured `src/renderer/**` tree); a separate in-flight
> `src/` restructure may move `components/` later, so re-resolve paths against the then-current tree
> before migrating. Each migration must stay appearance-neutral (the tokens reconcile the shipped
> values) UNLESS the row calls out a value reconciliation — verify against the running app.

- [ ] **Typography → named ramp (§8).** Replace the 58 raw `text-[Npx]` occurrences across 21 files
  with the named step (`text-[10px]`→`text-nano`, `text-[11px]`→`text-micro`, `text-[12px]`→
  `text-caption`/`text-xs`, `text-[13px]`→`text-body-sm`). Hotspots by count:
  `calendar/googleCalendarCatalog/components.tsx` (15), `slack/SlackPanel.tsx` (6),
  `jira/jiraCatalog/components.tsx` (4), `calendar/GoogleCalendarPanel.tsx` (4),
  `cosmos/CosmosTimelineEntry.tsx` (3), `cosmos/CosmosPanel.tsx` (3), `confluence/ConfluencePanel.tsx`
  (3), `composer/PromptComposer.tsx` (3), `atlassian/atlassianPanelBits.tsx` (3),
  `tabs/PanelTabStrip.tsx` (2), `confluence/confluenceCatalog/components.tsx` (2); plus single
  occurrences in `slack/slackCatalog/{SlackMessageRow,components}.tsx`, `jira/JiraPanel.tsx`,
  `generative/ActiveTabSurface.tsx`, `fileExplorer/{FileTree,FileTabStrip}.tsx`,
  `confluence/confluenceCatalog/CommentsSection.tsx`, `app/{SurfaceSpinner,PanelFooter}.tsx`, `App.tsx`.
- [ ] **Z-index → named ladder (§13).** Replace the 20 literal `z-10`/`z-20`/`z-50` occurrences with
  the named rung (`z-10`→`z-raised`, `z-20`→`z-dock`, `z-50`→`z-overlay`, and the floating composer
  layer → `z-composer`). Sites: `slack/SlackPanel.tsx` (4), `composer/PromptComposer.tsx` (3),
  `jira/JiraPanel.tsx` (2), `confluence/ConfluencePanel.tsx` (2), `calendar/GoogleCalendarPanel.tsx`
  (2), `components/ui/{tooltip,dialog}.tsx` (2 each), `components/ui/{select,avatar}.tsx` (1 each),
  `fileExplorer/ResizeDivider.tsx` (1).
- [ ] **Motion → named duration/easing (§12).** Replace the 18 raw motion values with the named
  tokens: `duration-[400ms]`→`duration-slow`, `duration-[450ms]`→`duration-slower`,
  `ease-[cubic-bezier(0.16,1,0.3,1)]`→`ease-launch`, the 12 `duration-200` dock/overlay transitions →
  `duration-fast`, `duration-150`→`duration-micro` (or `duration-fast` — pick the nearest named step
  per usage). Sites: `composer/PromptComposer.tsx` (5: the launch fade/scale + dock),
  `slack/SlackPanel.tsx` (4), `confluence/ConfluencePanel.tsx` (2), `calendar/GoogleCalendarPanel.tsx`
  (2), `slack/slackCatalog/SlackMessageImage.tsx` (1), `components/ui/dialog.tsx` (1). Keep every usage
  `prefers-reduced-motion`-gated.
- [ ] **Elevation → named ramp (§11).** Replace the 19 ad-hoc `shadow-xs/sm/md/lg` with the named
  tier (`shadow-xs`→`shadow-control`, `shadow-sm`/`shadow-md`→`shadow-raised`, `shadow-lg`→
  `shadow-overlay`; align any dock shadow to the `glass-dock` floating-dock tier). Sites:
  `composer/PromptComposer.tsx` (3), `slack/SlackPanel.tsx` (2), `components/ui/{switch,select,button}.tsx`
  (2 each), `jira/JiraPanel.tsx` (1), `fileExplorer/PdfView.tsx` (1), `confluence/ConfluencePanel.tsx`
  (1), `components/ui/{textarea,tabs,input,dialog,card}.tsx` (1 each). NOTE: mapping `shadow-md`→
  `shadow-raised` collapses two old tiers into one — confirm appearance per site.
- [ ] **Spacing → rhythm / density (§9).** Audit the ~93 `*-1.5`/`*-2.5` dense pads (top files:
  `slack/SlackPanel.tsx` 18, `jira/jiraCatalog/components.tsx` 15, `calendar/googleCalendarCatalog/
  components.tsx` 8, `confluence/ConfluencePanel.tsx` 7, `app/SettingsDialog.tsx` 6,
  `slack/slackCatalog/components.tsx` 5, `confluence/confluenceCatalog/CommentsSection.tsx` 5, …):
  the `p-1.5`/`p-2.5` etc. stay on the Tailwind 4px grid (already sanctioned — only adopt
  `p-density-1`/`p-density-2` where the doc names dense-row pad-y / dense-control pad-x as a
  *semantic* density step, not blanket). Migrate the few genuinely off-grid arbitrary spacings
  (`p-[3px]`, `my-[7px]`, the `h-[64px]/72/80/96px` event blocks) onto a grid step or a named density
  token. **Calendar hour cell:** the catalog still sets a raw inline `--cal-hour-h: 2.5rem` (40px) on
  three rows of `googleCalendarCatalog/components.tsx`; migrate to the `--space-cal-hour` token /
  `h-cal-hour` utility. CAVEAT: the new `--space-cal-hour` is **48px** (DESIGN.md §9) but the live
  inline value is **40px** — this migration is NOT appearance-neutral; confirm the intended hour-cell
  height with the designer before swapping (either change the token to 2.5rem or accept the 48px bump).
- [ ] **Primitive ring flip — D-7 (§14).** Flip `focus-visible:ring-[3px]` → the canonical thin
  `ring-[1.5px]` (matches Textarea/Input) on the primitives + chrome that still ship the thick ring:
  `components/ui/button.tsx`, `components/ui/badge.tsx`, `components/ui/{tabs,switch,select}.tsx`,
  `components/ui/scroll-area.classes.ts`, `tabs/PanelTabStrip.tsx`, `fileExplorer/FileTabStrip.tsx`
  (2), `fileExplorer/ResizeDivider.tsx`. Deliberately NOT flipped in the foundation cycle (DESIGN.md
  D-7) so the appearance-unchanged guarantee held; this is the tracked follow-up.

## Deferred / future

- [ ] **Cross-calendar dedup of shared meetings** (product decision → architect). A meeting on two
  subscribed calendars renders as two overlapping copies (Google reuses one event id); hiding one
  calendar leaves the other copy — correct membership, but reads as "hidden event still there".
  Decide whether/how to dedup (which copy, color, whether hiding one hides both). NOT a filter bug
  (guarded by `CalendarHiddenOverlap.dom.test.tsx`).
- [ ] **Dev-only Vite HMR wake-reload kills terminal sessions** (`terminal-session-unnecessary-restart-v1`).
  Direction A (suppress the reconnect-reload) is unworkable (`location.reload` non-configurable in
  Electron → white screen, rolled back). A real fix is **direction B** — sessions SURVIVE a renderer
  reload via stable paneIds + a reattach handshake — its own sdd. DEV-ONLY; packaged build unaffected.
- [ ] **Disconnect modal in-flight "Disconnecting…" state** (architecture). `useConfirm.confirm()`
  fires the disconnect fire-and-forget and closes immediately; a true loading state needs the confirm
  state machine to await the disconnect — out of designer scope.
- [ ] Decide whether session control stays purely interactive (PTY) or adds the Claude Agent
  SDK for background/headless work (ARCHITECTURE §7).
- [ ] `codegraph init` once the codebase has enough real source to index (ARCHITECTURE §7).
- [ ] Optionally surface `confluence_create_page` in the **generative** Confluence panel (add it to
  `CONFLUENCE_TOOL_GRANTS` + relax the grounding prompt to permit the write) — deliberately deferred
  to keep the generative panel read-only; the create tool is interactive-TUI-only for now.
- [ ] Confluence writes beyond create (edit/delete/labels).
- [ ] **Trim the Monaco bundle** (`terminal-file-explorer-v1` follow-up): the read-only viewer
  imports the `monaco-editor` BARREL, which pulls every basic-language monarch tokenizer + the
  ts/json/css/html language modes/workers (~9MB main chunk + ~15MB unused language workers). Only the
  base `editor.worker` is ever instantiated. Trim later (slim `monaco-editor/esm/vs/editor/editor.api`
  + per-language `*.contribution` + custom worker resolution) ONLY if bundle size becomes a real
  problem — the slim path fights tsc's Bundler `moduleResolution` (no `exports`-mapped types), so it's
  not free. Acceptable today: desktop app loads from disk, not the network. See the ponytail comment
  in `src/renderer/fileExplorer/monacoSetup.ts`.
- [ ] **File-explorer fs-watch on Linux** (`terminal-file-explorer-v1` follow-up): the main-side watch
  uses Node `fs.watch`, which is non-recursive on Linux (recursive only on macOS/Windows). Nested-dir
  changes there won't auto-refresh until the dir is re-listed. Add `chokidar` (or per-expanded-dir
  watchers) only if Linux is targeted.
- [ ] **File-explorer search / write ops** (`terminal-file-explorer-v1` follow-up): the explorer is
  read-only browse + view today (no rename/create/delete/move, no name filter/search). Add when needed.

## Done

- [x] **Calendar event detail dock** (`calendar-event-detail-v1`, `/sdd`, #85) — clicking a calendar
  event chip opens a right-side **detail dock beside the still-mounted grid** (reuses the Slack thread
  side-dock: `@container/calbody` two-pane, side-by-side ≥32rem / drawer-overlay + click-away scrim
  when narrow, X dismiss, single dock retargets, transient — resets on tab switch / disconnect / month
  nav). `EventChip` became an interactive `<button>` (hover/focus-ring/`aria-pressed`, inert when no
  id) emitting renderer-local `calendarNav.openDetail` (the whole event in `action.context`, cast
  `as unknown`, never crosses IPC) intercepted by `GoogleCalendarPanel.onAction`. NO new fetch (detail
  renders from the clicked chip's props), NO new IPC channel, NO new OAuth scope: enriched the existing
  `events.list` mapping (`toEvent` adds non-secret `description`/`attendees`/`htmlLink`/`recurring`,
  omit-when-absent) + `eventRow` passthrough. New `eventDetailLogic.ts` pure helpers (timed/all-day,
  multi-day inclusive-range w/ Google exclusive-end correction, attendee normalization, title degrade,
  external-link http(s) guard). External "Open in Google Calendar" opens the system browser via a new
  `webContents.setWindowOpenHandler` (window config, NOT IPC) → `shell.openExternal`. Selected-chip
  marker flows via new `CalendarDetailContext`. typecheck (node+web) + 1591 tests green (56 in the 3
  Calendar suites). **Live GUI not exercised** (needs a real connected Google Calendar). Spec/plan/
  design `.sdd/{specs,plans,designs}/calendar-event-detail-v1.md`. Not committed. ARCHITECTURE.md §4i
  update pending architect.
- [x] **Terminal file explorer split** (`terminal-file-explorer-v1`, #84) — each started terminal tab
  now hosts a right-pane READ-ONLY file explorer beside the live terminal, split by a bespoke
  resizable `role="separator"` divider (pointer + ArrowLeft/Right keyboard, default 60%/40%, terminal
  min 20rem / explorer min 16rem; drag re-fits the xterm FitAddon + `pty.resize`). Main-side per-pane
  fs sandbox (`fsExplorer.ts` list/read/watch, `pathConfine.ts` real-path confinement to the tab's
  cwd subtree — no `..` escape, never throws, `fileKind.ts` text/binary/image classify) over ONE typed
  IPC contract (`fs:*` channels in `src/shared/ipc.ts`, `validateFs*` validators in
  `src/shared/validate.ts` — invalid payloads warn + ignore, never crash). Tree (`tree.ts` pure state
  + `FileTree.tsx`): role=tree/treeitem, roving tabindex + ARIA keymap, dirs-first
  case-insensitive sort, lazy expand with skeleton only on FIRST list, SEAMLESS watch-driven re-list
  (node identity + expansion preserved, no flash). Click a file → read-only **Monaco** viewer
  (`FileViewer.tsx`, cosmos-dark theme from CSS vars, `?worker` auto-bundled for dev + packaged, no
  electron.vite config change) that REPLACES the tree with a Back affordance (ChevronLeft / Esc /
  Backspace); images stream over a NEW privileged `cosmos-file://` scheme (`localFileRef.ts` pure
  codec + `localFileProtocol.ts` Electron wiring, reuses `pathConfine`; renderer builds URLs via
  `localFileSrc.ts`; `cosmos-file:` added to the renderer CSP `img-src`). Binary/denied/not-found/
  broken-image are calm centered state blocks (never a red Notice). No image/text size cap. 1591 tests
  green (incl. `tree.test.ts`, `fsExplorer`, `fileKind`, `localFileRef`, `pathConfine`); the
  feature's typecheck is clean and it builds (editor.worker chunk emitted). Spec/plan/design at
  `.sdd/{specs,plans,designs}/terminal-file-explorer-v1.md`; `docs/PROJECT-STRUCTURE.md` +
  `docs/DEVELOPMENT.md` ("Terminal file explorer") updated. **ARCHITECTURE.md §4.x Terminal File
  Explorer addition still owed (architect-owned — flagged, not written by developer).** GUI
  verification pending (see Next). Not committed.

- [x] **Confluence attachment images still broken — downloadLink normalization gap**
  (`confluence-attachment-scope-v1`, `/bugfix`, #71) — the v2-attachments-API fix was correct in
  approach but had a second live blocker: the v2 metadata `downloadLink` comes back rooted at the
  SITE (`/rest/api/content/.../download`), and `buildDownloadUrl` only normalized a `/download/...`
  prefix to `/wiki/...`, so the `/rest/...` link failed the `/wiki/`-anchored `safeWikiPath` guard
  → `bytesUrl=null` → 502. Fix (`src/main/confluenceImageRef.ts`): prefix `/wiki` to ANY non-`/wiki/`
  site-root path (still rejects `//host`, `..`). Regression test (`confluenceImageRef.test.ts`:
  normalizes a `/rest/...` link). Temp diagnostics removed from `confluenceImageProtocol.ts`.
  typecheck + 20 ref-tests green. **Live GUI-confirmed 2026-06-20** (both `.svg` attachments render,
  bytes 200 `image/svg+xml`). Bug report `.sdd/bugs/confluence-attachment-scope-v1.md`. Not committed.
- [x] **Shared calendars — all accessible calendars** (`shared-calendars-v1`, `/sdd`, #76) — extended
  Google Calendar from PRIMARY-only to **all accessible calendars**: a `calendarList` read
  (`GET /users/me/calendarList`, existing `calendar.readonly` scope — no new scope/re-consent;
  `toCalendar` maps items, drops malformed) supplies the calendar set; `googleCalendarManager`
  default-view handler fans out a BOUNDED per-calendar `listEvents` over the month window (≤25
  calendars, ≤6-concurrent `Promise.allSettled` so one failure never blanks the grid) and MERGES,
  tagging each event with its `calendarId`. `EventList` root gained additive optional `calendars[]`
  (non-secret legend: id/name/resolved color-token/`selected`) + per-event `calendarId`; the catalog
  renders the per-calendar legend/toggle as a self-suppressing left-sidebar `<aside>`
  (`calendar-legend-sidebar-v1`, returns null at ≤1 calendar; renderer-only `hiddenCalendarIds`).
  Events colored by owning calendar (deterministic palette-hex→`--event-*` token, else stable-hash,
  else gray; resolved once in the surface builder so no raw hex reaches a component). Still read-only;
  additive optional fields → no `SESSION_SCHEMA_VERSION` bump. Spec/plan/design at
  `.sdd/{specs,plans,designs}/shared-calendars-v1.md`; `docs/ARCHITECTURE.md` §4i (flipped planned→built).
  Tests green. **GUI verification pending** (folded into the Google Calendar manual-verify item under
  Next). Not committed.
- [x] **Slack replies affordance trim** (`slack-replies-affordance-trim-v1`, `/bugfix`) — two cosmetic
  removals on the shared canonical row: (1) thread side-panel ROOT message no longer shows a redundant
  "N replies" label — `SlackThreadPanel` (`SlackPanel.tsx`) omits `replyCount` from the reconstructed
  `parent` so `RepliesAffordance` §3.3 returns null; (2) removed the `MessageSquare` icon before the
  "replies" text in the body affordance (`SlackMessageRow.tsx`, dropped now-unused import). Renderer-only
  JSX, no logic/contract change → visual-only, no node regression test. Typecheck clean, 1467 tests green.
  GUI-verify pending (Task #82). Not committed.
- [x] **Terminal panel tone mismatch** (`terminal-panel-tone-mismatch-v1`, `/bugfix`) — terminal screen
  background read darker than other panels. Root cause: `TerminalPanel` constructed xterm `Terminal` with
  a hardcoded `theme:{ background:'#1e1e1e' (=--background), foreground:'#e0e0e0' }`, but every panel
  `<section>` wrapper is `bg-card` = `--card` `#1b1b1c` — so the screen (`#1e1e1e`) and its container
  (`#1b1b1c`) mismatched. Fix: new pure helper `terminalThemeFromTokens(read)` (`src/renderer/terminalTheme.ts`,
  node-tested) maps `--card`→background / `--card-foreground`→foreground from a `getComputedStyle(documentElement)`
  reader, read ONCE at Terminal construction; `TerminalPanel.css` `.terminal-panel` bg `#1e1e1e`→`var(--card)`;
  awaiting empty-state comment updated. xterm theme can't take CSS vars (needs concrete strings) — gotcha in
  `docs/DEVELOPMENT.md` (Styling). cosmos forces `.dark` once at startup with no toggle, so a one-shot read is
  correct (`ponytail:` comment names the re-read ceiling). +4 cases (`terminalTheme.test.ts`, fails on old
  hardcoded theme). typecheck clean, 1467 tests green. **GUI-verified by the user 2026-06-20.** Not committed.
- [x] **Slack attachment images broken** (`slack-attachment-image-broken-v1`, `/bugfix`) — after
  `slack-rich-message-render-v1` + reconnect, custom emoji rendered but image attachments stayed broken.
  Root cause: `SLACK_USER_OAUTH_SCOPES` omitted `files:read`, so auth-gated `files.slack.com`
  `url_private`/`thumb_*` downloads through the `cosmos-slack-img://` proxy got a non-image response
  (the public `*.slack-edge.com` emoji CDN needs no scope, which isolated the defect). Fix: add
  `files:read` (read-only) to the requested `user_scope`; regression test `slackConfig.test.ts` asserts
  the scope list (+ no `:write`). Typecheck + 1447 tests green; needs a Slack reconnect to grant the
  scope, then GUI verify (see Next).
- [x] **Slack rich message render** (`slack-rich-message-render-v1`, `/sdd` — escalated from
  `.sdd/bugs/slack-image-emoji-mention-broken-v1.md`) — mentions/emoji/attachment-images were broken on
  BOTH Slack surfaces. Fix across 5 tracks: (A) `SlackMessage`/`SlackSearchMatch` DTOs carry attachment
  image refs + a custom-emoji shortcode→ref map (no new IPC channel — they ride the existing trusted
  main→renderer response); (B) `toMessages` is async, mentions resolve `<@U…>` → `@DisplayName` via a
  per-session cached `users.info`; (C) curated emoji table replaced by `node-emoji` (`glyphFor` adapter)
  + `emoji.list` custom-emoji resolver (new `emoji:read` scope); (D) new SSRF-safe `cosmos-slack-img://`
  privileged protocol (`slackImageRef.ts` codec + `slackImageProtocol.ts` wiring, 2-host allowlist
  `files.slack.com` + `*.slack-edge.com`, token stays in main); (E) `SlackMessageRow` renders text/glyph/
  custom-emoji runs (`messageContent.ts`) + an attachment thumbnail strip. Typecheck + 1443 tests green;
  NOT GUI-exercised (see Next). Plan `.sdd/plans/slack-rich-message-render-v1.md`.
- [x] **Jira loading skeleton width** (`jira-skeleton-width-v1`, `/bugfix`) — after the generative-wrap
  clamp (#79) made the rendered Jira surface full-width, the loading skeleton stayed narrower, so the
  skeleton→content swap jumped the data region horizontally. Root cause: `KanbanBoardSkeleton`
  (`src/renderer/JiraPanel.tsx`) used fixed `w-64 shrink-0` columns in an `overflow-x-auto` container,
  vs the real board's width-clamped `Column` wrapper (`JIRA_LAYOUT_CLAMP_CLASS`). Fix: board-skeleton
  container `flex gap-3 overflow-x-auto` → `flex w-full min-w-0 gap-3`, columns `w-64 shrink-0` →
  `flex-1 min-w-0` (3 equal full-width columns); `DefaultViewSkeleton` + `SkeletonCard` roots gained
  `w-full min-w-0` for parity. Renderer/CSS-only; typecheck + 1391 tests green; no node unit test
  (Tailwind layout isn't node/no-jsdom-testable). Bug report `.sdd/bugs/jira-skeleton-width-v1.md`.
  **GUI verification pending — see Next.** Not committed.
- [x] **Terminal [Open] picker spinner hang** (`terminal-picker-spinner-hang-v1`, `/bugfix`) — a fresh
  terminal tab's `[Open a folder]` left the "Opening…" spinner spinning forever and never spawned
  `claude` after a folder pick. Root cause: `TerminalView`'s mount effect cleanup set
  `isMountedRef.current = false` but the body never reset it to `true`; under React StrictMode (dev)
  the mount→cleanup→mount double-invoke left the ref stuck `false`, so the post-pick guard
  `if (res.path && isMountedRef.current)` and the `finally` `setPending(false)` both short-circuited.
  Fix: set `isMountedRef.current = true` as the first line of the mount effect (keep `false` in
  cleanup). Renderer-only (`src/renderer/TerminalPanel.tsx`); typecheck + 1391 tests green; no node
  unit test (a StrictMode effect/ref lifecycle isn't node/no-jsdom-testable). `docs/DEVELOPMENT.md`
  (React renderer) gotcha added. **GUI verification pending — see Next.** Not committed.
- [x] **Jira generative-UI empty-state flash** (`jira-empty-flash-v1`, `/bugfix`) — `IssueList`
  briefly flashed "No issues found." between the skeleton and first paint. Root cause: a `{path}`-bound
  `issues` prop resolves through `useBound` to `undefined` until main seeds the surface dataModel, and
  `Array.isArray(rows)?rows:[]` collapsed `undefined` to `[]` — indistinguishable from a genuinely
  empty list — so `items.length===0` rendered the empty state during the seed gap. Fix: added pure
  `shouldShowIssueEmptyState(rows, isLoading)` in `jiraCatalog/logic.ts` (true ONLY when rows is a
  SEEDED array AND empty AND not loading); `IssueList` gates the empty block on it. +4 logic tests;
  typecheck + 1391 tests green. Not committed.
- [x] **Generative-UI line-break clamp — Slack + Jira + Confluence** (`slack-generative-wrap-v1` +
  follow-up) — long unbroken message/text lines overflowed horizontally in agent-composed surfaces.
  Root cause was UPSTREAM of the leaf `break-words`: the SDK standard-catalog `Column`/`Row` render a
  flex `<div>` with NO `min-w-0`, so the container kept `min-width:auto` and grew to its content's
  intrinsic width before the leaf wrap could bite. Fixed by registering CLAMPED wrappers
  (`{slack,jira,confluence}Catalog/layout.tsx`: the SDK container inside a `w-full min-w-0 max-w-full`
  block; `{SLACK,JIRA,CONFLUENCE}_LAYOUT_CLAMP_CLASS` in each `logic.ts`) in place of the raw
  `standardCatalog.components.Column/Row` in each `index.ts`; node tests assert the raw SDK containers
  are not registered. Slack done first (US-001), then mirrored to Jira/Confluence. typecheck + tests
  green. `docs/DEVELOPMENT.md` (Styling) + `docs/ARCHITECTURE.md` §4.6. **GUI verification pending**
  (OAuth-gated — see Next). Not committed.
- [x] **Slack generated-UI message parity** (`slack-generative-message-parity-v1`, `/sdd`) — unified
  the Slack message-row presentation across the native panel and the generated catalog into ONE
  canonical `slackCatalog/SlackMessageRow.tsx` (avatar · name · timestamp · wrapped body · replies
  affordance) so wrap/author/timestamp/reply rendering can never silently diverge; the native row is a
  thin adapter, the catalog row supplies `onOpenThread` only when thread coords are present. Added a
  loading skeleton (`MessageSkeleton.tsx`). +24 parity tests. Not committed.
- [x] **IPC modular refactor** (`ipc-modular-refactor-v1`, `/sdd`, #78) — split the monolithic
  `src/shared/ipc.ts` + `validate.ts` into per-domain modules in `src/shared/ipc/` (`common`/`pty`/
  `ui`/`agent`/`shortcut`/`slack`/`jira`/`confluence`/`googleCalendar`/`session`/`settings`, each with
  a sibling `*.validate.ts`), keeping `ipc.ts`/`validate.ts` as same-path RE-EXPORT barrels so all 48/13
  consumers import unchanged (zero churn). Shared predicates promoted to `common.validate.ts`;
  `SESSION_SCHEMA_VERSION` unchanged (6); `channelUniqueness.test.ts` guards duplicate channel strings.
  typecheck + tests green. `docs/ARCHITECTURE.md` §4.6 + `docs/DEVELOPMENT.md`. Not committed.
- [x] **Calendar month/year navigation** (`calendar-month-year-nav-v1`, `/sdd`, US-006) — the Google
  Calendar default month view gained prev/next month (Dec↔Jan year carry), prev/next year (month
  preserved), and a Today control. Per-tab displayed-month INTENT `Map` in `GoogleCalendarPanel.tsx`
  (survives the `A2UIProvider key={tab.id}` remount); pure arithmetic in `calendarNavLogic.ts` (0-based
  internally); 1-based `{year,month}` wire param with the single 0→1 conversion in `toWirePayload`; new
  `validateGoogleCalendarRequestDefaultView` ({}-fallback for absent/invalid, null only for non-object);
  a context seam (`navContext.ts`) reaches into the catalog and REPLACES the in-grid `<h2>` (gated to the
  live default view only); `PanelRefreshButton` `onRefresh` override refreshes the un-bound view; a
  latest-wins stale-read gate rejects out-of-order landed surfaces. +37 tests. Spec/plan/design at
  `.sdd/{specs,plans,designs}/calendar-month-year-nav-v1.md`; `docs/ARCHITECTURE.md` §4i +
  `docs/DEVELOPMENT.md`. **PRELOAD CHANGED → full restart.** **GUI verification pending** + the
  **English-vs-Korean label decision is PENDING USER** (designer kept English "June 2026" over the
  spec's Korean `YYYY년 M월` — see Next). Not committed.
- [x] **Terminal [Open] directory picker** (`terminal-open-directory-picker-v1`, `/sdd`, #75) — a fresh
  terminal tab now defers its spawn until a working directory is picked: it mounts in an `awaiting` phase
  showing an `[Open]` empty state (no auto-`pty:start`), and spawns only after the new `pty:pickDirectory`
  channel (main-only `dialog.showOpenDialog({ properties:['openDirectory'] })`; cancel/error → `{path:
  null}`) returns a dir, passed as an optional boundary-validated `cwd` on `pty:start`. Fresh-vs-resume
  cwd policy is the pure `resolvePaneSpawn` (`src/main/paneSpawn.ts`): resume ignores override cwd, fresh
  uses `overrideCwd ?? sandboxDir`; restored tabs skip the picker and auto-resume. +14 tests.
  Spec/plan at `.sdd/{specs,plans}/terminal-open-directory-picker-v1.md`; `docs/ARCHITECTURE.md` §4.1 +
  `docs/DEVELOPMENT.md`. **PRELOAD CHANGED → full restart.** **GUI verification pending** (see Next).
  Not committed.
- [x] **Google Calendar legend → left sidebar + grid fill** (`calendar-legend-sidebar-v1`, `/sdd`,
  requested 2026-06-18) — moved the per-calendar legend/toggle from a top strip to a self-suppressing
  left-sidebar `<aside w-44>` rail (returns `null` at ≤1 calendar). Then per live user feedback the
  month grid was made to fill ALL remaining width AND height: dropped the `max-w-[34rem]` cap, built an
  `h-full` chain (EventList `items-stretch` → grid wrapper `flex-1 flex-col` → CalendarMonthGrid
  `h-full min-h-0` → day-cells `flex-1 auto-rows-fr`), dropped the fixed cell height for a `min-h-[64px]`
  floor (tabpanel `p-3` supplies right/bottom margin). className-only in
  `src/renderer/googleCalendarCatalog/components.tsx`; typecheck green. GUI verify pending (folded into
  the Google Calendar manual-verification item under **Next**). Gotcha: A2UIProvider/SurfaceErrorBoundary/
  A2UIRenderer add no wrapper DOM, so an `h-full` chain reaches the surface root.
- [x] **Slack message rendering — line breaks + emoji** (bug `slack-text-rendering-v1`, `/bugfix`,
  requested 2026-06-18) — Slack message `text` rendered wrong: multi-line collapsed and `:emoji:`/
  entities/`<…>` tokens shown verbatim. Root cause was a missing decode at the SINGLE Slack text
  mapping point (`slackClient.ts` `toMessages` `:370` + `search` `:325` did `String(m.text ?? '')`).
  Fixed with one shared pure decoder `decodeSlackText` (new `src/main/integrations/slackText.ts` +
  curated no-dep `slackEmoji.ts`): decode `<…>` mention/channel/link/broadcast tokens FIRST, then
  unescape Slack's `&amp;`/`&lt;`/`&gt;` (+`&quot;`/`&#39;`, NOT a broad HTML unescape), then map
  `:shortcode:`→glyph (skin-tone dropped, unknown left verbatim); `\n` preserved (rows are already
  `whitespace-pre-wrap`, so the line-break loss was the missing decode, not CSS). Covers history,
  replies, search across the native panel AND the MCP render path (one mapping point). Mirrors the
  `atlassianText.ts` / Confluence `decodeUnicodeEscapes` convention. 25-case regression test
  (`slackText.test.ts`, fails without the fix); typecheck + **1229 tests** green. Bug report
  `.sdd/bugs/slack-text-rendering-v1.md`; gotcha in `docs/DEVELOPMENT.md` (Styling). **GUI verification
  pending** (no live Slack workspace in this env — eyeball a multi-line + emoji row in the panel). Not committed.
- [x] **Google Calendar integration** (`google-calendar-v1`, `/sdd` + `/ralph`, requested 2026-06-15) —
  a fourth concrete integration, first non-Atlassian/Slack provider. **Confidential-client** Google
  OAuth 2.0 (auth-code, client id + secret like Atlassian, `access_type=offline` + `prompt=consent`
  for a refresh token) over the §4.7 loopback foundation; **read-only** v1 (`calendar.readonly`, the
  user's PRIMARY calendar only — no write scope/tool/dispatcher). New `GoogleCalendarManager` +
  encrypted main-only token store, `googleCalendar:` IPC namespace + validators, a third logical
  Settings client (`google`, `COSMOS_GOOGLE_CLIENT_ID`/`COSMOS_GOOGLE_CLIENT_SECRET`, write-only
  secret, Settings-over-env, INDEPENDENT force-disconnect — not coupled to the one Atlassian client).
  New rail surface + render target `'google-calendar'` (lucide `CalendarDays`, appended LAST so cycle
  indices stay stable), scoped render MCP server + rollup input + `embeddedMcpConfig`, custom
  `googleCalendarCatalog/`, and a deterministic main-composed **default month view** (bounded
  `events.list` → `EventList` surface → `target:'google-calendar'` push, Jira default-view pattern).
  Design (`.sdd/designs/google-calendar-v1.md`) resolved month-over-week; GCal 11 `colorId`s collapse
  onto a 6-token `--event-*` family (no raw hex). `SESSION_SCHEMA_VERSION` bumped for the new panel.
  Built as two tracks behind a design gate (Track A main/IPC/OAuth/MCP, Track B renderer). typecheck
  clean, **1204/1204** tests green, production build green. Spec/plan/design at
  `.sdd/{specs,plans,designs}/google-calendar-v1.md`; `docs/ARCHITECTURE.md` §7 4i. **GUI verification
  pending** (full restart — preload changed; real OAuth needs a registered Google Cloud client). Not committed.
- [x] **Settings gear polish** — pinned the Settings gear to the rail bottom (`h-full!` list +
  `flex-1` spacer), centered/spaced it as a direct rail child (`h-10 w-10 flex-none`), matched its
  hover to the other icons (`hover:bg-transparent` neutralizes the ghost `hover:bg-accent` box), and
  sized its lucide glyph (`size-6`) to optically match the brand-fill rail icons. Renderer-only,
  user-iterated live via HMR. Gotchas in `docs/DEVELOPMENT.md` (Styling).
- [x] **Confluence content/attachment images fail to load** (`confluence-content-images-v1`, `/bugfix`→`/sdd`,
  requested 2026-06-15) — content/attachment images in the Confluence page-detail body 404'd (relative,
  auth-gated `/wiki/…` src; token main-only). Implemented the `cosmos-confluence-img://` privileged streaming
  protocol (`src/main/confluenceImageProtocol.ts` Electron wiring + `confluenceImageRef.ts` pure SSRF-safe
  base64url ref codec): main resolves the live bearer via `ConfluenceManager.currentAuth()`, `net.fetch`es the
  gateway asset, streams it back — token never leaves main, renderer holds only the opaque scheme. Renderer
  half is a pure classify + src-rewrite (`confluenceCatalog/contentImageSrc.ts`) invoked from the single
  sanitize gate. Added `read:attachment:confluence` scope (one-time reconnect). CSP `img-src` widened to
  `'self' data: https: cosmos-confluence-img:` — `cosmos-confluence-img:` for the proxied auth-gated assets,
  `https:` so public external-CDN embeds (e.g. `dam-cdn.atl.orangelogic.com`, classified `external` + left
  untouched per FR-008) load directly; images are non-executable so `https:` does not reopen the XSS surface
  that `script-src 'self'` + DOMPurify close. typecheck + 1075 tests green (`confluenceImageRef.test.ts`,
  `contentImageSrc.test.ts`). **GUI-verified by the user 2026-06-15** (clean `npm run dev` relaunch — CSP meta
  is not HMR-hot-swapped). Spec/plan `.sdd/{specs,plans}/confluence-content-images-v1.md`; `docs/ARCHITECTURE.md`
  §2 protocol + CSP note.
- [x] **Confluence emoji/checkbox render — re-open #2** (bug `confluence-detail-emoji-checkbox-stripped-v1`,
  `/bugfix`, 2026-06-15) — after the emoticon-`<img>`→glyph fix, 👥 (U+1F465) still showed as literal
  double-escaped `👥` text (it is literal text in element content, NOT an emoticon img), and the
  same literal-escape form leaked into the document LIST screen. Fixed with a shared `decodeUnicodeEscapes`
  (`src/shared/confluence.ts`): the sanitize hook decodes `\uXXXX` in direct text-node children of each
  visited element (surrogate pairs re-form the glyph via UTF-16), and main decodes plain `title`/`excerpt`/
  `space` at the data source (`confluenceClient.ts` `mapSearchResultsPage` + `getPage`) so the list screen is
  fixed too. **GUI-verified by the user 2026-06-15.** Locked by `sanitize.test.ts` + `confluenceClient.test.ts`.
  (If emoji sizing / checkbox styling looks off, route the `prose-cosmos` polish to the designer.)
- [x] **Confluence detail — emoji/checkbox stripped by sanitizer** (bug
  `confluence-detail-emoji-checkbox-stripped-v1`, `/bugfix`, requested 2026-06-15) — emojis + task-list
  checkboxes rendered broken in the shared Confluence `PageDetailBody` (both native + gen-UI). Regression
  from `confluence-detail-rich-render-v1`: `SANITIZE_CONFIG` (`confluenceCatalog/sanitize.ts`) allow-list
  omitted `<img>` (emoji = `<img class="emoticon">`) and `<input>` (task checkboxes), so DOMPurify dropped
  them. Fixed by widening `ALLOWED_TAGS` (+`img`,`input`) + `ALLOWED_ATTR` (+`src`,`alt`,`class`,`width`,
  `height`,`type`,`checked`,`disabled`,`data-emoji-*`) and adding an `afterSanitizeAttributes` hook that
  (a) forces `disabled` on every `<input>` (display-only checkboxes, no write path) and (b) strips
  `data:`-scheme `src`/`href` — closing the DOMPurify media-tag `data:` bypass that lets a
  `data:image/svg+xml` SVG carry inline script PAST `ALLOWED_URI_REGEXP` (the key security finding).
  Regression tests (`sanitize.test.ts`): emoji/checkbox survive, input forced inert, `javascript:`/
  `onerror=`/`data:image/svg+xml`/`<script>`/`<iframe>` still stripped. typecheck green, 1026 tests green.
  Bug report `.sdd/bugs/confluence-detail-emoji-checkbox-stripped-v1.md`; gotcha in `docs/DEVELOPMENT.md`
  (Styling, DOMPurify `data:` bypass + allow-list coverage). **GUI verification pending** (renderer-only,
  HMR enough). Possible `prose-cosmos` design follow-up if emoji sizing/checkbox styling still looks off.
- [x] **Confluence detail — real-id open + rich render** (`confluence-detail-rich-render-v1`, `/sdd`,
  requested 2026-06-14) — fixed two bundled defects in the shared Confluence `PageDetail`. **(1) HTTP 500
  on gen-UI row click:** root cause was the `render_confluence_ui` catalog (`confluenceToolDescription.ts`)
  still declaring rows "DISPLAY-ONLY: NO actions" and seeding the `SearchResultRow` example with the
  POSITIONAL `"id": "1"`; once `confluence-page-detail-nav-v1` made the row id the `getPage` click target,
  the agent copied positional ids → `getPage("1")` → Atlassian 500 (native panel was fine — it uses real
  ids from `confluence_search_content`). Fixed by rewriting the catalog description: row id MUST be the
  real page id from `confluence_search_content`, rows are actionable, example uses a realistic numeric id
  (`"131073"`). A strict-numeric renderer guard was REJECTED (a positional "1" is itself numeric) — the
  existing non-empty `isOpenDetailEmittable` + the `mapConfluenceError`→Notice path already degrade a bad
  id safely. **(2) Plain-text readability:** `getPage` flattened storage XHTML to plain text (design Q2);
  now requests `?body-format=view` (server-rendered HTML), returns RAW HTML through the unchanged
  `ConfluencePageDetail.body` string (sanitize is a renderer concern). New shared `PageDetailBody`
  (`confluenceCatalog/components.tsx`) — used by BOTH the native `ConfluencePanel.tsx` detail and the
  gen-UI catalog `PageDetail` (one class string + one sanitize call so they stay identical) — sanitizes
  via `sanitizeConfluenceHtml` (DOMPurify, the ONE sanctioned `dangerouslySetInnerHTML` site) then renders
  in a scoped `prose prose-sm prose-cosmos` container; empty-after-sanitize → "This page has no readable
  body." Added `@plugin "@tailwindcss/typography"` + a custom `@utility prose-cosmos` (maps `--tw-prose-*`
  onto existing theme vars — NOT `prose-invert`, since cosmos is single-mode dark) in `index.css`. New deps
  `dompurify` (ships own types — no `@types/dompurify`) + dev `jsdom`/`@tailwindcss/typography`. typecheck +
  build clean, 1020 tests green (sanitize/validator/catalog/`pageViewBody`). Spec/plan/design at
  `.sdd/{specs,plans,designs}/confluence-detail-rich-render-v1.md`; `docs/ARCHITECTURE.md` page-read line.
  **GUI verification pending** (renderer + main; HMR enough for renderer, preload unchanged).
- [x] **Confluence generated-UI list → page detail on click** (`confluence-page-detail-nav-v1`, `/sdd`,
  requested 2026-06-14) — clicking an id-bearing document row in a Confluence gen-UI list opens that
  page's detail in place. **DESIGN PIVOT (user-directed):** the originally-specced surface-push design
  (new `confluence:requestPageDetail` IPC channel + main `getPage` compose + `buildPageDetailSurface` +
  unsolicited `target:'confluence'` frame + `confluenceBackNav.ts`, mirroring Jira) was rejected as
  overengineered — *"왜 gen ui를 그리는거지? 그냥 confluence list component 재활용했으면…"*. SHIPPED
  approach REUSES the EXISTING native `PageDetail` component: an id-gated `SearchResultRow` becomes a
  clickable `<button>` (dispatch in container `SearchResultList`, carries `{pageId,title}`) emitting a
  renderer-local nav action `CONFLUENCE_OPEN_DETAIL_ACTION='confluenceNav.openDetail'` that
  `ConfluencePanel.handleSurfaceAction` intercepts via `ActiveTabSurface` `onAction` (returns `true`,
  never forwarded); no-id rows stay inert. The intercept sets renderer-local overlay state
  `genUiPage={pageId,title}` → panel renders a native `ChevronLeft` back row + the existing `PageDetail`
  keyed on `pageId` (which reads `window.cosmos.confluence.getPage` DIRECTLY in the renderer — its own
  loading/empty-body/error/reconnect states apply). Back clears `genUiPage` (generated list restored
  verbatim, live A2UI host underneath); `useEffect` resets it on `activeTabId` change. **NO main / preload
  / IPC / shared / surface-builder changes** (the originally-touched files reverted to HEAD; net-new
  `confluenceBackNav.ts`/`.test.ts` removed). Read-only, no new scope, no token on any payload/surface.
  Files: `confluenceCatalog/{logic,components}.tsx?`, `ConfluencePanel.tsx`. typecheck + build clean, 990
  tests green (`confluenceCatalog/logic.test.ts`). Spec "As Built" + obsolete plan/design notes at
  `.sdd/{specs,plans,designs}/confluence-page-detail-nav-v1.md`. **GUI verification pending** (renderer-only,
  HMR is enough — NO preload restart needed).
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
