# Spec: Native-view mirror surface for Home favorites — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: — (extends `cosmos-home-favorite-tabs-v1`; closes the gap escalated by `confluence-favorite-waiting-v1`)
**Related plan**: `.sdd/plans/cosmos-native-view-mirror-surface-v1.md` (not yet written)

---

## Grounding

> Direct investigation run for THIS spec. The LLM-wiki / agentmemory MCP tools (`wiki_query` /
> `memory_*`) are **not present in this session's toolset** (confirmed — same gap the
> `confluence-favorite-waiting-v1` and `cosmos-terminal-favorite-multiplex-v1` authors hit), so
> prior-decision grounding came from reading the committed bug report, specs, and `docs/ARCHITECTURE.md`
> §4.14 in-repo (the material the wiki was seeded from) plus codegraph. Flagged so the gap is visible.

**codegraph_explore queries run (one-line takeaways):**

- `LivePanelTab TabSurface mirrorSurface surface buildBoundPageDetailSurface buildBoundDefaultFeedSurface buildBoundChannelListSurface buildBoundMessageListSurface`
  → the four named bound-surface builders exist and are pure transforms over DTOs
  (`ConfluencePage`/`ConfluencePageDetail`, `SlackPage<…>` + a `channelId`/`query`) emitting a
  `{spec, dataModel, descriptor}` BOUND surface; **secret-free by construction** (descriptors carry only
  cursors / a non-secret channelId / a query). They live in MAIN
  (`src/main/{confluence,slack}/…SurfaceBuilder.ts`).
- `FavoriteSurface findLiveTab homeFavorites LivePanelTab usePublishPanelTabs PanelTabsProvider ActiveTabSurface favoriteCatalogHosts useGenerativePanelTabs publish memo`
  → `FavoriteSurface` mounts `live.surface` via `ActiveTabSurface` under `favoriteCatalogHosts[panelId]`;
  states gate purely on `findLiveTab` + `live.surface` (GONE / WAITING / POPULATED). The publish memo
  (`useGenerativePanelTabs.ts:319-332`) carries `surface: t.surface` identically for all four generative
  panels. `PanelTabsProvider` is a renderer-only ref registry (NO IPC).
- `ConfluencePanel ContentList PageDetail genUiPage defaultFeed searchContent getPage native view`
  → Confluence default feed/search render via native `ContentList` (local `items`/`cursor` state from
  `confluence.defaultFeed`/`searchContent`); an opened page renders via the native `PageDetail` dock
  (`genUiPage` → `confluence.getPage`). Neither writes a `TabSurface` → `t.surface` stays null on native
  browsing. This is the deliberate `confluence-page-detail-dock-v1` dock.
- `SlackPanel setView native open-channel surface null` → Slack holds a per-tab native-base nav
  (`view: {kind:'channels'|'history'|'search'}`); opening a channel calls `setView({kind:'history'})`
  and **explicitly clears the tab surface** (`update(activeTabId, {surface:null})`, `SlackPanel.tsx:~1293`)
  so the native base shows. Same native-first gap as Confluence.

**Architecture cross-refs read:** §4.14 (the cross-panel publish contract + Home favorites; the
"labels → labels + LIVE surface" seam evolution), the Confluence + Slack integration render paths,
§5a (utterance → surface). Prior docs read: bug `confluence-favorite-waiting-v1` (the escalation +
root cause), spec `cosmos-home-favorite-tabs-v1` (FR-020/FR-023/FR-031 mirror idiom), spec
`cosmos-terminal-favorite-multiplex-v1` (the CONCURRENT feature also extending `LivePanelTab` with a
`serialize?` ref — this spec's new field MUST be additive/compatible with it).

---

## Overview

Let a Home favorite that mirrors a **Confluence or Slack** tab reflect that tab's **native browsing view**
(the open page, the feed/search list, the channel list, the message history) — not only an agent-composed
surface. Today only agent-composed surfaces populate `tab.surface`, so a favorite of a natively-browsing
Confluence/Slack tab shows "Waiting for this tab's view…" forever (`confluence-favorite-waiting-v1`). This
feature has those native-first panels publish an **additional, favorite-only mirror projection** of their
current native view, leaving the source panel's own rendering (the native dock / `ContentList`) untouched.

---

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice).

### Pin a natively-browsing Confluence page and see it mirrored · P1

**As a** Home user who pinned a Confluence tab that is showing a page (or the feed)
**I want to** open that favorite
**So that** I see the same page/feed inside Home, not a "waiting" placeholder

**Acceptance criteria:**

- Given a Confluence tab is showing the default feed (native `ContentList`, no agent compose), when I open its favorite, then the favorite renders that feed's current results (not WAITING).
- Given a Confluence tab has a page open in its detail dock, when I open its favorite, then the favorite renders that page's detail (title/space/body), not WAITING.
- Given I open a different page in the source tab, when I look at the favorite, then it updates to mirror the newly-opened page.
- Given the source tab is on a search result list, when I open the favorite, then it mirrors the search results.

### Pin a natively-browsing Slack channel/history and see it mirrored · P1

**As a** Home user who pinned a Slack tab that is showing a channel's history (or the channel list)
**I want to** open that favorite
**So that** I see the same Slack view inside Home

**Acceptance criteria:**

- Given a Slack tab is showing the channel list (native base), when I open its favorite, then the favorite renders that channel list, not WAITING.
- Given a Slack tab is showing a channel's message history, when I open its favorite, then the favorite renders that history.
- Given I switch the source tab to another channel, when I look at the favorite, then it updates to mirror the new channel's history.

### The favorite follows the source between native and composed views · P1

**As a** Home user viewing a Confluence/Slack favorite
**I want** the favorite to always show whatever the source tab is currently showing
**So that** the mirror never lies about the source's state

**Acceptance criteria:**

- Given the source tab is showing a native view and I open its favorite, then the favorite shows the native view (mirror).
- Given the source tab then composes an agent surface (the panel swaps its native base for the composed surface), when I look at the favorite, then the favorite shows the composed surface (composed view wins when the source is showing it).
- Given the source tab returns to native browsing (e.g. opens a page / a channel), when I look at the favorite, then the favorite returns to the native mirror.

### Native view with no data yet stays calm · P1

**As a** Home user whose pinned source tab has not loaded its native view yet
**I want** a calm waiting state, not a crash or stale frame
**So that** the favorite is trustworthy

**Acceptance criteria:**

- Given the source tab is a fresh Confluence/Slack tab whose native list/page has not finished its first load (or has zero results), when I open the favorite, then it shows the calm WAITING placeholder and flips to the mirror the instant the native data is available.
- Given the source panel is disconnected / not connected, when I open the favorite, then it shows WAITING (no mirror is published while disconnected) and never a secret or an error frame.

### Jira and the existing composed-surface favorites are unaffected · P2

**As a** maintainer
**I want** the change to be additive
**So that** Jira favorites and existing composed-surface mirroring keep working exactly as before

**Acceptance criteria:**

- Given a Jira favorite (Jira already pushes a default-view bound surface into `tab.surface`), when I open it, then it behaves exactly as today (no regression).
- Given any panel's favorite of an agent-composed surface, when I open it, then it still mirrors the composed surface as today.

### Relaunch · P2

**As a** user who pinned a Confluence/Slack favorite of a native view and quit
**I want** it back after relaunch, re-acquiring the live native view
**So that** my workspace is stable

**Acceptance criteria:**

- Given I pinned a Confluence/Slack favorite and quit, when I relaunch, then the favorite is present in pinned order (persisted by reference only — native views are NOT persisted, matching today).
- Given the source panel re-publishes its native view after relaunch, when I open the favorite, then it shows WAITING until the native view is live, then mirrors it.
- Given the source tab is gone on relaunch, when I open the favorite, then it shows the calm "no longer open" + Unpin state (never auto-dropped).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Traces reference
> `cosmos-home-favorite-tabs-v1` (v1-FR-…), `docs/ARCHITECTURE.md` §4.14, and the named builders.

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-001 | Native-first panels (Confluence, Slack) MUST publish a **mirror surface** representing their CURRENT native view, on a published field DISTINCT from `tab.surface`. RECOMMENDED contract: a new optional `mirrorSurface?: TabSurface \| null` on `LivePanelTab` (Option (a) — see Open Questions). The field MUST be additive and compatible with the concurrently-added `serialize?` field (`cosmos-terminal-favorite-multiplex-v1`) — both extend `LivePanelTab` non-conflictingly. | §4.14 seam; OQ-1 |
| FR-002 | Publishing the mirror surface MUST NOT change how the SOURCE panel renders: the native `PageDetail` dock, the native `ContentList`, the Slack native-base browser, and the per-tab native nav MUST stay exactly as they are today. The mirror surface is an ADDITIONAL, favorite-only projection — `tab.surface` and the source's `showNativeBase` logic are untouched. | confluence-page-detail-dock-v1; v1-FR-020 |
| FR-003 | Confluence MUST build its `mirrorSurface` from the current native view's data the panel ALREADY holds: a page-detail surface when a page is open in the dock (REUSE `buildBoundPageDetailSurface`), else a feed surface for the default feed (REUSE `buildBoundDefaultFeedSurface`), else a search-results surface while a search query is active (REUSE `buildBoundSearchResultsSurface`). | bug §Fix; reuse |
| FR-004 | Slack MUST build its `mirrorSurface` symmetrically from its current native view: a channel-list surface for the channel-list base (REUSE `buildBoundChannelListSurface`), a message-history surface for an open channel (REUSE `buildBoundMessageListSurface` with the non-secret `channelId`), or a search-results surface for an active search (REUSE `buildBoundSearchResultListSurface`). | bug §Fix; reuse; Slack symmetry |
| FR-005 | The mirror surface MUST be (re)built whenever the source panel's native view changes: a page open/close, a feed first-load / load-more, a search submit, a channel switch, a history first-load / load-more, a connection transition. The published `mirrorSurface` MUST reflect the source's CURRENT native data (a true live mirror, not a pin-time snapshot). | v1-FR-024 (live, not stale); §4.14 |
| FR-006 | The mirror surface MUST be **NON-SECRET**, reusing the named builders' secret-free output (an A2UI spec + a secret-free descriptor + a non-secret data-model seed) — never a token, OAuth secret, credential, file path, `~/.claude` location, or transcript line. It MUST remain a renderer-only REFERENCE pass through `PanelTabsProvider` (no IPC) and MUST NEVER be persisted (favorites persist by reference only — `{panelId,tabId,label}`, unchanged). | v1-FR-023/FR-033; §4.14; CLAUDE.md secrets rule |
| FR-007 | `FavoriteSurface` MUST resolve the surface to render as **`mirrorSurface ?? surface`** for these panels (the mirror, when present, else the composed surface). To keep this unambiguous (the favorite always shows what the source shows), the source panel MUST publish a non-null `mirrorSurface` ONLY while it is displaying a native view, and MUST publish `null` while it is displaying a composed agent surface — so `mirrorSurface` and the composed `surface` are **mutually exclusive on screen** (see OQ-4). | bug §Fix; OQ-4 |
| FR-008 | When neither a mirror surface nor a composed surface is available (the native view has not loaded data yet, or the panel is disconnected), the favorite MUST show the existing calm WAITING placeholder and flip to the mirror on the next publish. | v1 WAITING idiom; FavoriteSurface:64 |
| FR-009 | A favorite whose source tab/panel is GONE (closed / absent on relaunch) MUST keep showing the existing calm "no longer open" + Unpin state — unchanged. The mirror surface MUST NOT change the GONE detection (`findLiveTab` returning null). | v1-FR-031; FavoriteSurface GONE |
| FR-010 | The mirror surface MUST render through the SAME `ActiveTabSurface` host + `favoriteCatalogHosts[panelId]` catalog the source panel uses (Confluence under `confluenceCatalog`, Slack under the Slack catalog), so the existing favorite render path is reused with NO new render host. | v1-FR-022; FavoriteSurface |
| FR-011 | Jira MUST be unaffected: it already pushes a default-view bound surface into `tab.surface` (`jira:requestDefaultView`), so it MUST NOT publish a `mirrorSurface`; its favorites keep using `surface`. The generic Generated-UI panel (no native browsing) likewise publishes no mirror. | bug §root cause; no regression |
| FR-012 | The mirror surface published for a favorite glance MAY be **display-only** (the seeded rows / page body from the source's current native data), and is re-projected from the source on every native-view change (FR-005). Independent pagination/refresh INSIDE the favorite (its own working "load more") is NOT required for v1 — the favorite reflects the source's current dataset and rebuilds as the source grows it (see OQ-3). | OQ-3; perf |
| FR-013 | Native views MUST NOT be persisted (matching today): on relaunch the favorite re-acquires the live `mirrorSurface` once the source panel re-publishes its native view; until then it shows WAITING. `SessionSnapshot.favorites` stays `{panelId,tabId,label}` only. | v1-FR-030; FR-006 |

## Edge Cases & Constraints

- **Where the build runs (main vs renderer).** The four named builders live in MAIN; the native data
  the mirror projects (Confluence `ContentList` items/cursor, `PageDetail` detail; Slack channel/history
  rows) lives in the RENDERER's local component state. Reusing the builders renderer-side (relocating the
  PURE, secret-free transforms to a shared/renderer-importable module) vs. having main compose-and-push is
  a PLAN decision — flagged in OQ-2. The contract chosen here (Option (a): a renderer-only ref-pass field)
  favors building in the renderer from the data already on screen, with NO new IPC.
- **Mutual exclusivity drives precedence (OQ-4).** The source panel shows EITHER its native base OR a
  composed surface at a time (gated by `showNativeBase` / `activeTab.surface`). FR-007 makes the favorite
  follow that by publishing `mirrorSurface` only while native is on screen and `null` while composed is on
  screen, so `mirrorSurface ?? surface` resolves to exactly what the source shows. (The alternative —
  publish the mirror always and prefer composed via `surface ?? mirrorSurface` — is the inverse and is the
  open question to confirm.)
- **Builder/data-shape drift.** The builders are fossils from before the native dock (`confluence-page-detail-dock-v1`).
  Whether their expected input (`ConfluencePage<ConfluenceSearchResult>` / `ConfluencePageDetail` /
  `SlackPage<…>` + channelId/query) still matches the CURRENT native view's data shape must be re-verified
  before reuse (OQ-5) — they may need a thin adapter from the panel's current local state.
- **Rebuild cost.** FR-005 rebuilds the mirror on every native-view change. For a list this is a map over
  the current rows; for a page it is a single transform — cheap, and only the pinned-source panel pays it.
  Whether to additionally throttle/memo (e.g. only rebuild when the favorite of that source is actually
  pinned) is a perf refinement (OQ-3), not a correctness requirement.
- **Bound-surface interactivity in the favorite.** A bound surface's working refresh/load-more depends on
  MAIN-side region registration that only happens on a real `ui:render` push. A renderer-built mirror that
  was never pushed through main will render its seeded rows but its load-more would be warn-ignored. FR-012
  scopes the v1 mirror to display-only for exactly this reason (the favorite re-projects on source change
  rather than paginating itself). Making the favorite's pagination independently live is OUT OF SCOPE v1.
- **Explicitly out of scope (v1):** changing how the source panels render (no flipping to a pushed default
  surface — that is contract Option (b), rejected); independent pagination/refresh inside the favorite;
  mirroring the Slack right-docked thread or the Confluence comments composer beyond what the page/history
  builder already emits; persisting native views; a `confluence:requestDefaultView`/`slack:requestDefaultView`
  IPC (Jira-style push).

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | A favorite of a natively-browsing Confluence tab (feed / search / open page) renders that view inside Home instead of WAITING. |
| SC-002 | A favorite of a natively-browsing Slack tab (channel list / message history / search) renders that view inside Home instead of WAITING. |
| SC-003 | As the source tab changes its native view (open another page, switch channel, run a search, load more), the favorite updates to mirror the new view. |
| SC-004 | When the source tab shows a composed agent surface, the favorite shows the composed surface; when it returns to native, the favorite returns to the native mirror (no stale frame, no double render). |
| SC-005 | A native view with no data yet, or a disconnected source, shows the calm WAITING state and flips live on the next publish; a gone source shows "no longer open" + Unpin (never auto-dropped). |
| SC-006 | The source panel's own rendering (native dock, `ContentList`, Slack native base, per-tab nav) is byte-for-byte unchanged; Jira and existing composed-surface favorites do not regress. |
| SC-007 | The published mirror surface carries no token/secret/path/transcript and is never sent over IPC or persisted; `SessionSnapshot.favorites` remains `{panelId,tabId,label}`. |

---

## Open Questions

- [ ] **[NEEDS CLARIFICATION — OQ-1] Contract Option (a) vs (b). RECOMMEND (a).** Add a SEPARATE
  `mirrorSurface?: TabSurface \| null` on `LivePanelTab` (favorite-only projection; the source keeps its
  native dock/`ContentList`), built via the dead builders, and `FavoriteSurface` resolves `mirrorSurface ??
  surface`. Rationale: the native dock was a DELIBERATE replacement of the surface view
  (`confluence-page-detail-dock-v1`); populating `tab.surface` for native views (Option (b)) risks changing
  the source panel's own rendering (its `showNativeBase`/dock logic keys off `tab.surface`) and re-opens a
  closed design decision. (a) is additive, source-untouched, and composes cleanly with the concurrent
  `serialize?` field. **Confirm (a), or specify (b) if you want native views to become real pushed surfaces.**
- [ ] **[NEEDS CLARIFICATION — OQ-2] Where the mirror is built (main vs renderer).** The named builders live
  in MAIN; the native data lives in the RENDERER. Recommended for Option (a): relocate the PURE, secret-free
  builders to a shared/renderer-importable module and build the mirror in the renderer from the on-screen
  data (NO new IPC). Confirm this, vs. a main-side compose-and-push (which drifts toward Option (b)).
- [ ] **[NEEDS CLARIFICATION — OQ-3] Display-only mirror + rebuild perf.** Recommended: the favorite mirror
  is DISPLAY-ONLY (seeded rows / page body), re-projected on every source native-view change (FR-005/FR-012);
  the favorite does NOT paginate/refresh itself (its bound load-more would be warn-ignored without main-side
  region registration). Confirm display-only is acceptable for v1, and whether to gate the rebuild on "this
  source is actually pinned" to avoid paying it when no favorite exists.
- [ ] **[NEEDS CLARIFICATION — OQ-4] Composed-vs-mirror precedence.** Recommended: the source publishes
  `mirrorSurface` ONLY while showing native and `null` while showing a composed surface, so `mirrorSurface ??
  surface` always equals what the source shows (FR-007). Confirm this mutual-exclusivity rule, vs. always
  publishing the mirror and preferring the composed surface (`surface ?? mirrorSurface`).
- [ ] **[NEEDS CLARIFICATION — OQ-5] Do the dead builders still match the current native data shape?** The
  builders predate the native dock. Before reuse, verify their inputs (`ConfluencePage<ConfluenceSearchResult>` /
  `ConfluencePageDetail`; `SlackPage<…>` + channelId/query) still match the data the native views hold today,
  or whether a thin adapter from the panel's current local state is needed. (Plan must characterize this.)

---

## Notes for the architecture doc (do NOT edit yet)

- **§4.14 seam evolution.** The "labels → labels + LIVE surface" note becomes "labels + LIVE composed
  `surface` + an optional native-view `mirrorSurface`": native-first panels (Confluence, Slack) publish an
  additional favorite-only mirror projection of their CURRENT native view (built via the bound-surface
  builders, secret-free, renderer-only ref-pass, never persisted). The Home favorite resolves
  `mirrorSurface ?? surface`, so a favorite mirrors native browsing too — not only agent-composed surfaces.
- **§4.14 Home favorites.** "Terminal tabs are not pinnable" is being relaxed by the concurrent
  terminal-favorite feature; this feature additionally records that Confluence/Slack favorites mirror their
  NATIVE views via `mirrorSurface`, with Jira unchanged (it already pushes a default-view surface).
- **Confluence/Slack integration sections.** Note that each native-first panel now publishes a mirror
  projection of its current native view for favorites, WITHOUT changing its own native dock/`ContentList`
  rendering.

## Sequencing note

Implementation MUST land AFTER the in-flight `cosmos-terminal-favorite-multiplex-v1` feature: both extend
`LivePanelTab` (this adds `mirrorSurface?`, that adds `serialize?`) and both touch `FavoriteSurface`'s
state resolution. This is a SPEC document only — no code conflict — but the field additions and the
`FavoriteSurface` branch ordering must be reconciled additively when this implements (the terminal mirror
branches on `panelId === 'terminal'` BEFORE the A2UI path; this feature's `mirrorSurface ?? surface`
resolution lives on the A2UI path for Confluence/Slack).
