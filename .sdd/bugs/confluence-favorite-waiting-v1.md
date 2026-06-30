# Bug: Confluence Home favorite renders WAITING forever — confluence-favorite-waiting-v1

## Symptom

A Confluence tab pinned as a Home favorite shows the WAITING placeholder
("Waiting for this tab's view…") forever instead of mirroring the source page.
Jira favorites always work; Slack favorites appear to work.

## Triage / scope

- Layer: renderer (favorites mirror seam + the generative-panel publish path).
- Files in play: `src/renderer/cosmos/FavoriteSurface.tsx`,
  `src/renderer/cosmos/homeFavorites.ts`, `src/renderer/cosmos/favoriteCatalogHosts.tsx`,
  `src/renderer/tabs/useGenerativePanelTabs.ts`,
  `src/renderer/panelTabs/PanelTabsProvider.tsx`, `src/renderer/panelTabs/panelTabs.ts`,
  `src/renderer/confluence/ConfluencePanel.tsx`.
- Outcome: triage DISPROVED the hypothesized publish/memo defect and revealed a
  cross-cutting DESIGN GAP. The minimal in-scope deliverable here is the verified
  root cause + a regression/characterization test that locks the seam; the SOURCE
  fix is net-new feature/contract scope and is ESCALATED to `architect`.

## Grounding (queries run)

- `codegraph_explore`: "FavoriteSurface findLiveTab favoriteCatalogHosts
  useGenerativePanelTabs usePublishPanelTabs LivePanelTab surface" — found the publish
  memo (`useGenerativePanelTabs.ts:319-332`) carries `surface: t.surface` for ALL four
  generative panels identically; `FavoriteSurface` WAITING branch is purely
  `!live.surface`.
- `codegraph_explore`: "ConfluencePanel GenerativeTab TabSurface confluence catalog page
  detail surface" — Confluence page detail renders via the native `PageDetail` dock
  (`genUiPage`), not a surface.
- `codegraph_explore`: "requestDefaultView jira default view surface unsolicited
  confluence defaultFeed searchContent surface builder" — Confluence native feed/search
  use native `ContentList` (`window.cosmos.confluence.defaultFeed`/`searchContent`).
- `codegraph_callers` on `buildBoundDefaultFeedSurface`, `buildBoundPageDetailSurface`,
  `buildBoundChannelListSurface`, `buildBoundMessageListSurface`,
  `buildBoundSearchResultsSurface` — **NO callers** (dead except the panel-refresh
  `buildXShell` path). Confluence & Slack never push these as default views.
- grep: only `jira:requestDefaultView` exists as a default-view push IPC; no
  `confluence:*`/`slack:*` equivalent.
- (LLM wiki tool not exposed in this session; grounded via codegraph + source.)

## Root cause (file:line)

The favorite mirror reads the source tab's `surface` out of the cross-panel registry and
renders WAITING when it is null:

- `src/renderer/cosmos/FavoriteSurface.tsx:64` — `if (!live.surface) { …WAITING… }`.
- `src/renderer/cosmos/homeFavorites.ts:35` — `findLiveTab` returns the published
  `LivePanelTab` (incl. its `surface`).

The published `surface` is `t.surface`, carried identically for every generative panel by:

- `src/renderer/tabs/useGenerativePanelTabs.ts:319-332` — the publish memo
  `tabs.map((t) => ({ id, label, surface: t.surface }))` → `usePublishPanelTabs`.

This seam is CORRECT. The actual cause is upstream: **Confluence renders its native
browsing views as native React and NEVER writes a `TabSurface` into the tab record**, so
`t.surface` stays null:

- `src/renderer/confluence/ConfluencePanel.tsx:673-704` — the default feed & search list
  render via the native `ContentList` (calling `window.cosmos.confluence.defaultFeed` /
  `searchContent`), not a surface.
- `src/renderer/confluence/ConfluencePanel.tsx:756-800` — an opened page renders via the
  native `PageDetail` inside the `genUiPage` dock (reads `window.cosmos.confluence.getPage`),
  not a surface. (The dock is the deliberate `confluence-page-detail-dock-v1` design that
  REPLACED the old surface-based full-region page view; `buildBoundPageDetailSurface` in
  `src/main/confluence/confluenceSurfaceBuilder.ts:147` is the now-dead fossil of it.)

`t.surface` is therefore non-null for Confluence ONLY after an agent compose (a solicited
`ui:render` frame). Jira never shows WAITING because its default view IS a pushed bound
surface (`jira:requestDefaultView`, `src/shared/ipc/jira.ts:51`). **Slack shares
Confluence's gap** — its native channel/history views also leave `t.surface` null
(`SlackPanel.tsx` even clears it on open-channel, line ~1293); Slack "works" only when the
pinned tab holds a composed surface. So the real asymmetry is not Confluence-specific in
the publish path — it is *Jira pushes a default surface; Slack & Confluence are
native-first*.

Net: the favorite-mirror feature (cosmos-home-favorite-tabs-v1) assumes a panel's
pinnable view IS its `tab.surface`, but two of the four panels are native-first for their
base views. WAITING is the *correct* render for a genuinely-null surface (do NOT band-aid
`FavoriteSurface`).

## Proof (regression test, GREEN with no code change)

`src/renderer/cosmos/ConfluenceFavoriteWaiting.dom.test.tsx` (scenario CF-FAVORITE-WAITING-01):

- **Test A** drives the REAL `useGenerativePanelTabs` for `target:'confluence'`: a composed
  `ui:render` confluence frame lands in `t.surface`, publishes through the real
  `PanelTabsProvider`, and `FavoriteSurface` renders POPULATED (the stubbed
  `ActiveTabSurface` prints `confluence-search`) — **GREEN with no source change**, which is
  itself the evidence that the publish/memo path is not the defect.
- **Test B** publishes a confluence tab whose `surface` is null (the native-browsing state)
  and asserts the favorite shows WAITING — the documented root-cause state.

Because the task's own requested regression (a Confluence tab WITH a surface → POPULATED)
is GREEN without any fix, there is no RED→GREEN code fix at the publish layer; the bug is
the upstream native-view gap.

`favoriteCatalogHosts['confluence']` (`favoriteCatalogHosts.tsx:48-52`) is correct —
`catalog: confluenceCatalog`, `catalogId: CONFLUENCE_CATALOG_ID` (`'confluence'`,
`confluenceCatalog/index.ts:39`), matching `ConfluencePanel`'s own host — so POPULATED
renders fine once `surface` is non-null (verified; rules out a GONE/catalog mismatch).

## Fix

NOT applied here — it is net-new feature/contract scope, ESCALATED to `architect`. Options
the architect should weigh (the publish contract is the gap → `docs/ARCHITECTURE.md` §4.14):

1. **Decouple the mirror channel** (recommended): add a published "mirror surface" to
   `LivePanelTab` distinct from `tab.surface`, so Confluence can build a bound
   page/feed surface (reusing `buildBoundPageDetailSurface` / `buildBoundDefaultFeedSurface`,
   which already exist) for the favorite WITHOUT flipping the panel's own
   `showNativeBase` (which keys off `tab.surface`) or disturbing the native dock. Apply the
   same to Slack's native views for parity.
2. **Default-view surface push** (Jira-style): give Confluence/Slack a
   `confluence:requestDefaultView` that pushes a bound default surface into `tab.surface`.
   Larger — it changes the panels' own rendering away from native `ContentList`/dock and
   conflicts with `confluence-page-detail-dock-v1`.
3. **Accept the limitation**: document that native-first panels' favorites only mirror
   composed surfaces; WAITING is expected for native browsing.

## Verification

- `npm run typecheck` — green (exit 0).
- `npm run test:dom` (`ConfluenceFavoriteWaiting.dom.test.tsx`) — 2/2 green.
- `npm test` — see run notes.
- Manual `npm run dev` (pin a Confluence page → favorite still shows WAITING) — NOT
  exercised in this session; expected to still WAIT until the source fix lands (this report
  is intentionally the investigation + escalation, not the feature).
