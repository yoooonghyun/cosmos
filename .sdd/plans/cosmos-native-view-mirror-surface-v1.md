# Plan: Native-view mirror surface for Home favorites — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-native-view-mirror-surface-v1.md`

---

## Grounding

> Direct investigation for THIS plan (the LLM-wiki / agentmemory MCP tools are NOT exposed in this
> session — grounded via codegraph + the committed specs/source, same gap the spec recorded).

**codegraph_explore queries run (one-line takeaways):**

- `LivePanelTab TabSurface buildBound* surface` → the six bound-surface builders are pure
  `{spec, dataModel, descriptor}` transforms; live in MAIN (`src/main/{confluence,slack}/*SurfaceBuilder.ts`).
- `confluenceResultRow confluenceAdapter slackChannelRow slackMessageRow slackSearchRow row mappers imports`
  → the builders' only non-shared deps are the **pure** row mappers + path constants in the MAIN adapter
  files (`confluenceAdapter.ts` / `slackAdapter.ts`); those files' main-only imports
  (`adapterDispatcher` types) are **`import type`** (erased), so the pure pieces are relocatable to shared.
- `ConfluencePanel ContentList PageDetail genUiPage query showNativeBase` → native list data lives in the
  `ContentList` child's local `useState` (`items`/`cursor`); page detail in `PageDetail`'s `detail`;
  `genUiPage` is **panel-level** state (the active tab's open page); `showNativeBase = !activeTab.surface`.
- `SlackPanel setView usePerTabNav view native base` → per-tab `view: {kind:'channels'|'history'|'search'}`
  via `usePerTabNav`; opening a channel clears `update(tabId,{surface:null})` (mutual exclusivity already
  holds); list data lives in native child components.
- `buildGenerativePanel hydrateGenerativeTabs GenerativeTab TabSurface` → `buildGenerativeTab` persists a
  WHITELIST (composed surface/descriptor/bindings/hiddenCalendars); a NEW per-tab field is **not persisted
  unless explicitly added** (so FR-013 is satisfied for free). `TabSurface = {requestId, spec, dataModel?,
  descriptor?, bindings?, restored?, error?}`.
- `favoriteCatalogHosts` → confluence + slack entries EXIST and are correct (`confluenceCatalog`/
  `CONFLUENCE_CATALOG_ID`, `slackCatalog`/`SLACK_CATALOG_ID`) — FR-010 needs NO change there.

---

## Summary

Native-first panels (Confluence, Slack) publish an additional, favorite-only **mirror surface** of their
CURRENT native view so a Home favorite renders that view instead of "Waiting…". The mirror is a
`TabSurface` built in the RENDERER (per OQ-2) by the six existing-but-dead bound-surface builders, which
move to a shared module. Each panel lifts its active tab's native-view data (feed/search/page; channel-
list/history/search) up from its native child components, builds the mirror, and stores it on a new
per-tab `mirrorSurface` field — but ONLY while that tab is **pinned** (per OQ-3 gate, via a small reverse
"pinned sources" channel added to `PanelTabsProvider`). The publish memo carries `mirrorSurface` per tab
with the mutual-exclusivity rule `t.surface ? null : t.mirrorSurface` (per OQ-4), and `FavoriteSurface`
resolves `mirrorSurface ?? surface`. The source panels' own rendering (native dock / `ContentList`) is
untouched (FR-002); the mirror is never persisted (FR-013) and never crosses IPC (FR-006).

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron renderer + shared) |
| Key dependencies | `@a2ui-sdk/react/0.9`, the six bound builders, `PanelTabsProvider`, `ActiveTabSurface`, `favoriteCatalogHosts` |
| Files to create | `src/shared/surfaceBuilders/confluenceSurfaceBuilder.ts`, `src/shared/surfaceBuilders/slackSurfaceBuilder.ts`, `src/renderer/cosmos/nativeMirror.ts` (+ `nativeMirror.test.ts`), `src/renderer/cosmos/livePanelProjection.ts` (+ `.test.ts`) |
| Files to modify | `src/renderer/tabs/useGenerativePanelTabs.ts`, `src/renderer/panelTabs/panelTabs.ts`, `src/renderer/panelTabs/PanelTabsProvider.tsx`, `src/renderer/cosmos/FavoriteSurface.tsx`, `src/renderer/cosmos/CosmosPanel.tsx`, `src/renderer/confluence/ConfluencePanel.tsx`, `src/renderer/slack/SlackPanel.tsx`, `src/main/confluence/confluenceSurfaceBuilder.ts` + `confluenceAdapter.ts` (re-exports), `src/main/slack/slackSurfaceBuilder.ts` + `slackAdapter.ts` (re-exports), `src/renderer/cosmos/ConfluenceFavoriteWaiting.dom.test.tsx`, `docs/ARCHITECTURE.md` §4.14 |

---

## HARD SEQUENCING (Phase 0 — read before any code)

- **This feature lands AFTER `cosmos-terminal-favorite-multiplex-v1` merges.** Both extend `LivePanelTab`
  (this adds `mirrorSurface?: TabSurface | null`; that adds `serialize?: () => string`) and both touch
  `FavoriteSurface`'s state resolution. The additions are non-conflicting BUT must be reconciled on the
  same `LivePanelTab` / `FavoriteSurface`. Concretely after the merge:
  - `LivePanelTab` carries BOTH `serialize?` (terminal) and `mirrorSurface?` (this). Additive, no clash.
  - `FavoriteSurface` already branches `source.panelId === 'terminal'` → terminal mirror BEFORE the A2UI
    path. This feature's `mirrorSurface ?? surface` change lives ONLY on the A2UI (non-terminal) path —
    do NOT touch the terminal branch.
  - If the terminal feature has NOT merged when this starts, STOP and surface it (do not re-implement the
    terminal field).

## Decisions

### D1 — Contract: a per-tab `mirrorSurface` stored on the tab record, published via the existing memo (OQ-1)

`GenerativeTab` and `LivePanelTab` each gain `mirrorSurface?: TabSurface | null`. The native-first panel
WRITES the mirror onto its active pinned tab with the existing `update(tabId, { mirrorSurface })`; the
existing publish memo in `useGenerativePanelTabs` (currently `tabs.map((t) => ({id, label, surface}))`)
gains `mirrorSurface`. Reusing the tab record means: (a) no new hook option, (b) the mirror SURVIVES a
source-panel tab switch (last-known stays on the inactive tab record, like composed `surface` does), and
(c) `buildGenerativeTab` persists a whitelist that does NOT include `mirrorSurface`, so FR-013 (no
persistence) holds with zero extra work.

### D2 — Mutual exclusivity in the publish projection (OQ-4)

Extract the per-tab projection into a PURE node-testable helper `projectLivePanelTab(t): LivePanelTab` in
`src/renderer/cosmos/livePanelProjection.ts`:

```
{ id: t.id, label: t.label, surface: t.surface ?? null,
  mirrorSurface: t.surface ? null : (t.mirrorSurface ?? null) }
```

So a composed surface (`t.surface` present) publishes `mirrorSurface: null` → `FavoriteSurface`'s
`mirrorSurface ?? surface` resolves to the composed surface; a native view (`t.surface` null) publishes
the stored mirror → resolves to the mirror. The two are mutually exclusive on screen by construction —
robust even if a stale `t.mirrorSurface` lingers from before a compose.

### D3 — Build in the renderer; relocate the pure builders to shared (OQ-2)

Create `src/shared/surfaceBuilders/{confluence,slack}SurfaceBuilder.ts` holding the six builders + their
`{Confluence,Slack}BoundSurface` interfaces, plus the **pure row mappers + path constants** they need
(`confluenceResultRow`; `slackChannelRow`/`slackMessageRow`/`slackSearchRow`; `CONFLUENCE_*_PATH` /
`SLACK_*_PATH`). The MAIN `*SurfaceBuilder.ts` and `*Adapter.ts` files **re-export** the relocated symbols
(single source of truth — main's resolver/dispatcher imports keep working unchanged). Main-only helpers
(`buildConfluenceBoundShell`, bind options, the resolvers) STAY in main. Move the existing
`confluenceSurfaceBuilder.test.ts` (and the slack analog, if present) to point at the shared module.

> The path constants derive from `AdapterSourcePath` (already in `src/shared/types/adapter.ts`) and the
> descriptor builders are already in `src/shared/types/{confluence,slack}.ts`, so the shared builders have
> NO main dependency after the row-mapper/path-constant relocation.

### D4 — `nativeMirror.ts`: select-the-view + wrap-to-`TabSurface` (renderer, pure)

`src/renderer/cosmos/nativeMirror.ts` exposes the per-panel "current native view → `TabSurface | null`":

- `buildConfluenceMirror(view, mintId): TabSurface | null` where `view` is the lifted active-tab native
  state: `{ kind: 'page', detail } | { kind: 'search', query, page } | { kind: 'feed', page } | null`.
  Maps to `buildBoundPageDetailSurface` / `buildBoundSearchResultsSurface` / `buildBoundDefaultFeedSurface`,
  then wraps `{spec, dataModel, descriptor}` → `{ requestId: mintId(), spec, dataModel, descriptor }`.
- `buildSlackMirror(view, mintId): TabSurface | null` for
  `{ kind:'channels', page } | { kind:'history', channelId, page } | { kind:'search', query, page } | null`
  → `buildBoundChannelListSurface` / `buildBoundMessageListSurface` / `buildBoundSearchResultListSurface`.
- Returns `null` when there is no native data yet (→ favorite shows WAITING, FR-008). A FRESH `requestId`
  per build (the mirror is a DISPLAY-ONLY re-projection per OQ-3 — each rebuild is a new surface instance,
  NOT a live-updated bound surface; no main-side region registration is implied).

### D5 — Lift native data via child `onData` callbacks; rebuild only when pinned (OQ-3 gate)

Native list/detail data lives in child components. Add an optional `onData` callback to each native child
so the panel can hold the active tab's current native data:

- Confluence `ContentList` → `onData?(page: ConfluencePage<ConfluenceSearchResult>)` (called whenever it
  sets `items`/`cursor`); `PageDetail` → `onData?(detail: ConfluencePageDetail)`.
- Slack native channel-list / history / search children → `onData?(page)` with the matching `SlackPage<…>`.

The panel keeps the active tab's native data in a ref/state, derives the current view kind (Confluence:
`genUiPage ? 'page' : query ? 'search' : 'feed'`; Slack: `view.kind` + `view.channel?.id` / `view.query`),
and in a `useEffect` (deps: the lifted data + view selector + `activeTabId` + pinned flag) calls
`update(activeTabId, { mirrorSurface: built })` — ONLY when `isPinned('<panelId>', activeTabId)` (D6).
Guard against redundant writes (skip the `update` when the new mirror is deep-equal-by-surfaceId+rows to
the stored one) to avoid a publish/persist-report loop.

### D6 — The OQ-3 gate: a reverse "pinned sources" channel on `PanelTabsProvider`

`PanelTabsProvider` already wraps both the panels (publishers of tabs) and Cosmos (consumer). Add a SECOND
tiny channel in the SAME provider (no new file): a `pinnedSourcesRef: Set<string>` of `"panelId:tabId"`
keys + `publishPins(keys)` + a `usePinnedSources()` reader (versioned read like `useAllPanelTabs`).
`CosmosPanel` calls `publishPins(new Set(favorites.map(f => `${f.source.panelId}:${f.source.tabId}`)))`
whenever its favorite set changes (derive from the existing favorite `CosmosTab`s / `toHomeFavorites`).
Native-first panels read it and gate the mirror build (D5). When the active tab is NOT pinned, the panel
clears any stale mirror (`update(activeTabId, { mirrorSurface: null })`) so it never publishes a mirror
nobody pinned.

> Why a reverse channel and not always-build: gating avoids the per-native-view-change `update()` churn
> (tab-state re-render + re-publish + persist-report) for tabs no favorite points at — the real cost OQ-3
> targets. Re-fetching for the mirror (instead of lifting on-screen data) is REJECTED: OQ-2 mandates
> building from on-screen native data; a refetch could differ and adds flicker/latency.

### D7 — `FavoriteSurface` resolution (OQ-4)

`const mirror = live.mirrorSurface ?? live.surface`. WAITING when `!mirror` (was `!live.surface`); POPULATED
renders `mirror` through the unchanged `ActiveTabSurface` + `favoriteCatalogHosts[panelId]` path. GONE
(`!live || !host`) unchanged. Single-line semantic change; everything else in `FavoriteSurface` stays.

---

## OQ-5 verification (do FIRST in Phase 1 — characterize per builder before reuse)

Each native view's lifted data MUST match the builder's expected input; verify + add a thin adapter where
drifted. Findings from grounding (confirm in code, then lock with a builder unit test):

| Builder | Expected input | Native source (lifted) | Risk / adapter |
|---------|----------------|------------------------|----------------|
| `buildBoundDefaultFeedSurface` | `ConfluencePage<ConfluenceSearchResult>` | `ContentList` `{items, cursor}` | LOW — wrap as `{items, nextCursor: cursor}` |
| `buildBoundSearchResultsSurface` | `query` + same page | panel `query` + `ContentList` page | LOW |
| `buildBoundPageDetailSurface` | `ConfluencePageDetail` | `PageDetail` `detail` | LOW — same DTO; binds title/space/body/webUrl |
| `buildBoundChannelListSurface` | `SlackPage<SlackChannel>` | native channel-list `{items, cursor}` | LOW — but mirror the **displayed (name-filtered)** items, not a raw refetch |
| `buildBoundMessageListSurface` | `channelId` + `SlackPage<SlackMessage>` | `view.channel.id` + history `{items, cursor}` | **VERIFY**: native history must already carry resolved `userName`/`customEmoji`/`images` (the builder does NOT resolve names — the main resolver does). If the native IPC read does not resolve author names, the mirror rows show ids → add a name-resolution step or accept ids (flag to user). |
| `buildBoundSearchResultListSurface` | `query` + `SlackPage<SlackSearchMatch>` | panel search query + results `{items, cursor}` | VERIFY same resolved-fields concern as history |

---

## Implementation Checklist

### Phase 0 — Sequencing & guards
- [x] Confirm `cosmos-terminal-favorite-multiplex-v1` has merged; reconcile `LivePanelTab` + `FavoriteSurface` additively (do not touch the terminal branch). STOP if not merged.

### Phase 1 — Interface & relocation
- [x] Re-read spec; confirm no open questions remain (all 5 resolved).
- [x] Relocate the six builders + pure row mappers + path constants to `src/shared/surfaceBuilders/{confluence,slack}SurfaceBuilder.ts`; re-export from the main `*SurfaceBuilder.ts` + `*Adapter.ts` files (single source of truth). Run `npm run typecheck` — main imports unchanged.
- [x] OQ-5: verify each builder's input vs the lifted native data (table above); add thin adapters where drifted; resolve the Slack name-resolution question (VERIFY rows) — record the finding here.
- [x] Add `mirrorSurface?: TabSurface | null` to `GenerativeTab` (`useGenerativePanelTabs.ts`) and to `LivePanelTab` (`panelTabs.ts`) — additive, documented as renderer-only / non-secret / non-persisted, compatible with terminal `serialize?`.
- [x] Add `nativeMirror.ts` (`buildConfluenceMirror` / `buildSlackMirror` → `TabSurface | null`) and `livePanelProjection.ts` (`projectLivePanelTab`) — pure, no React/DOM import.
- [x] Add the reverse pinned-sources channel to `PanelTabsProvider` (`pinnedSourcesRef`, `publishPins`, `usePinnedSources`).
- [x] Review new types vs spec — no invented properties.

### Phase 2 — Testing (write before/with implementation)
- [x] Node-unit `nativeMirror.test.ts`: each view kind → the right surfaceId + seeded rows; `null` for no-data.
- [x] Node-unit `livePanelProjection.test.ts`: composed `surface` present → `mirrorSurface:null`; native `mirrorSurface` present + no surface → carried; both absent → both null.
- [x] Node-unit for the relocated builders (moved `confluenceSurfaceBuilder.test.ts` + slack analog) — green from shared.
- [x] jsdom: extend `ConfluenceFavoriteWaiting.dom.test.tsx` — a published confluence tab carrying a `mirrorSurface` (native feed) renders POPULATED (stub `ActiveTabSurface` prints `confluence-feed`) instead of WAITING; keep Test B's null→WAITING case.
- [x] jsdom: a Slack analog (a tab with `mirrorSurface` for a channel list / history renders POPULATED).
- [x] jsdom (gate): a tab whose source is NOT pinned publishes `mirrorSurface:null` (favorite WAITING); pinning flips it to POPULATED. (May be exercised at the projection/provider level if a full panel mount is too heavy.)

### Phase 3 — Implementation
- [x] Publish memo in `useGenerativePanelTabs` uses `projectLivePanelTab` (carries `mirrorSurface`).
- [x] `FavoriteSurface`: `mirror = live.mirrorSurface ?? live.surface`; WAITING on `!mirror`.
- [x] `CosmosPanel`: `publishPins` from the current favorite set.
- [x] `ConfluencePanel`: lift `ContentList`/`PageDetail` data via `onData`; effect builds+stores mirror on the active PINNED tab on native-view change; clears when unpinned/composed.
- [x] `SlackPanel`: same for channel-list/history/search children, keyed off per-tab `view`.
- [x] Confirm `favoriteCatalogHosts` confluence/slack entries are correct (no change expected).
- [x] All tests pass; `npm run typecheck` (node + web) green; manual `npm run dev` smoke (pin a Confluence page + a Slack channel → favorite mirrors, not WAITING; switch source view → mirror follows; compose a surface → favorite shows composed; close source → GONE).

### Phase 4 — Docs
- [x] Update `docs/ARCHITECTURE.md` §4.14: the seam now publishes `surface` + `mirrorSurface`; native-first panels (Confluence/Slack) project their current native view for favorites (gated on pinned, renderer-only, non-secret, non-persisted); `FavoriteSurface` resolves `mirrorSurface ?? surface`; note the reverse pinned-sources channel on `PanelTabsProvider`. Jira unchanged.
- [x] Note the shared `surfaceBuilders/` relocation in `docs/PROJECT-STRUCTURE.md` (developer/wrap-up may own this).
- [x] Record deviations below.

---

## Needs confirmation before dev

1. **Reverse pinned-sources channel (D6).** OQ-3's gate is implemented as a small SECOND channel on
   `PanelTabsProvider` (Cosmos → panels). This is the minimal additive way to let a panel know one of its
   tabs is pinned. Confirm this seam (vs. always-build, which ignores the gate, or a separate provider).
2. **Slack row name-resolution (OQ-5 VERIFY).** If the native Slack history/search reads do NOT pre-resolve
   author display names, the mirror rows would show user ids. Confirm: add a resolution step for the mirror,
   or accept ids in the favorite mirror for v1.
3. **Confluence multi-tab `genUiPage` scope.** `genUiPage` is panel-level (the active tab's open page). The
   mirror is therefore built for the ACTIVE tab's current view; a favorite of an INACTIVE source tab shows
   its last-known mirror (or WAITING) until that tab is re-activated in the source panel. Confirm this
   "active-tab-fresh, inactive-tab-last-known" behavior is acceptable for v1 (it mirrors how composed
   surfaces already behave).

---

## Deviations & Notes

- **2026-06-30**: Plan authored. No code written (SDD Step 2 — stops here for approval).
- **2026-06-30 (implement)**: Steps 3–5 implemented per plan. All checklist items done; suites green
  (`npm run typecheck` node+web, `npm test` 2739, `npm run test:dom` 116, `npm run build`).
- **OQ-5 finding — Slack name resolution: RESOLVED data REUSED (no ids-v1 fallback needed).** Verified
  in `SlackPanel.tsx`: the native `MessageList` calls `resolveNames(result.data.items)` and the native
  `SearchResults` calls `resolveMatchNames(...)` BEFORE `setItems`, so the on-screen `items` already
  carry `userName` (and `customEmoji`/`images`). The mirror lifts those RESOLVED `items` via `onData`,
  so `buildBoundMessageListSurface`/`buildBoundSearchResultListSurface` emit rows with real author
  names — NOT raw ids. Locked by `nativeMirror.test.ts` (asserts `userName:'Ada'`/`'Bo'` on mirror rows).
  Confluence feed/search/page were low-risk (DTO shapes match) as predicted.
- **Minor deviations from the plan's sketch:**
  - The reverse channel uses a SEPARATE `pinsVersion` counter (not the shared tab `version`) so a
    pin-reading panel re-reads ONLY on a `publishPins`, never on every unrelated tab publish (less churn).
  - The redundant-write guard (D5) is a per-panel CONTENT key (`{confluence,slack}MirrorKey`) that
    ignores the per-build requestId, in a `lastMirrorKeyRef`; the effect skips `update()` when the key
    is unchanged (prevents a publish loop from the fresh-requestId-per-build).
  - When a Confluence page is OPEN (`genUiPage`) the mirror takes the page (FR-003) but is `null` (→
    WAITING) until `PageDetail`'s `onData` resolves — calm, per FR-008.
  - Shared `confluenceSurfaceBuilder` exports `boundListSpec`/`boundPageDetailSpec` (and slack's
    `boundListSpec`) so the main `build*BoundShell` helpers stay in main while reusing them.
  - The builder tests were MOVED to `src/shared/surfaceBuilders/*.test.ts` (deleted the `src/main`
    copies); byte-identical builder output keeps the main `*Adapter.test.ts` re-export callers green.
