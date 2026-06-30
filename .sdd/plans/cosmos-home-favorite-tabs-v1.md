# Plan: Home Favorites (Pin / Unpin tabs) — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-home-favorite-tabs-v1.md`

---

## Grounding

> Same direct investigation as the spec, extended for the LIVE-shared-surface mechanism the user
> chose (option **a**, not the snapshot). `wiki_query`/`memory_*` MCP tools were not present in
> this session; prior decisions grounded from in-repo specs/designs + `docs/ARCHITECTURE.md`.

- `codegraph_explore` (per-panel catalog wiring) → every generative panel mounts
  `<A2UIProvider catalog={xCatalog}>` + `<ActiveTabSurface surface={…} catalogId={X_CATALOG_ID} onAction={…}>`.
  The catalogs live per panel: `jiraCatalog`/`JIRA_CATALOG_ID`, `slackCatalog`/`SLACK_CATALOG_ID`,
  `confluenceCatalog`/`CONFLUENCE_CATALOG_ID`, `googleCalendarCatalog`/`CATALOG_ID`, and the Cosmos
  timeline reuses `<A2UIProvider>` + `catalogId="standard"`. The ONLY per-panel difference is the
  catalog + `catalogId` (+ an optional renderer-local `onAction`).
- `ActiveTabSurface` already: re-processes a `surface` spec on change (so a re-publish repaints),
  subscribes to `window.cosmos.ui.onDataModel` matched by `surfaceId` (so two mounted instances of
  the SAME surfaceId both receive live `updateDataModel` pushes — the live-mirror mechanism), and
  round-trips actions via `window.cosmos.ui.sendAction({ requestId, action })`. Its one-shot guard is
  per-instance, but main's `UiBridge.resolveAction` warn-ignores an already-settled requestId, so a
  duplicate mirror is safe.
- `useGenerativePanelTabs` builds `livePanelTabs = { tabs: tabs.map(t => ({id,label})), activeTabId }`
  and publishes via `usePublishPanelTabs(target, …)`. Generative tab ids are PERSISTED as-is
  (`hydrateGenerativeTabs: tab.id = t.id`) → **stable across relaunch** (key for re-bind).
- Persistence: `SessionRegistry` merges per-panel `report()` + non-panel paths (`setEnabled`,
  `setOpenPromptPosition`) → `assembleSnapshot` → `window.cosmos.session.save`; main
  `validateSnapshot` drops malformed pieces. `SESSION_SCHEMA_VERSION = 8`. `openPromptPosition` is a
  **top-level additive-optional field with NO schema bump** — the precedent this plan follows.
- Glob `components/ui/*` → no `dropdown-menu`/`context-menu` primitive exists (radix-ui already a dep).

---

## Summary

Make the Home (Cosmos) panel a small multi-tab container: the undeletable default "Cosmos"
conversation tab plus user-pinned **favorite** tabs. A favorite is a **live shortcut** to another
panel's open tab — right-click a tab row in Home's cross-panel tree → **Pin**, and a favorite tab
appears in Home's strip; click it and Home renders that source tab's **CURRENT LIVE** A2UI surface
inline through the **same `ActiveTabSurface` host**, sharing the source surface's live `requestId`
so it is a true mirror (not a snapshot): it reflects the source tab's state in real time and bound
controls round-trip through the existing `UiBridge`. The cross-panel publish seam
(`PanelTabsProvider`) is expanded so each published tab carries its LIVE `TabSurface` (a
renderer-only, non-secret ref pass). Favorites persist across relaunch by reference
(`{panelId, tabId, label}`) and **re-bind** to the restored source tab; a favorite whose source is
gone shows a calm "this tab is no longer open" state and is never auto-dropped. Terminal tabs are
not pinnable (no A2UI surface). This is UI-bearing → a **design step (2.5)** adds the shared
right-click menu primitive + the favorite-tab/inline visuals.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (React 19 renderer; main-process validation in node) |
| Key dependencies | `@a2ui-sdk/react`, `radix-ui` (already present — ContextMenu primitive to be added), existing `ActiveTabSurface`/`PanelTabsProvider`/`SessionRegistry` |
| Files to create | `src/renderer/cosmos/FavoriteSurface.tsx`, `src/renderer/cosmos/favoriteCatalogHosts.tsx`, `src/renderer/cosmos/homeFavorites.ts` (pure), `src/renderer/components/ui/context-menu.tsx` (designer), `+ .test.ts/.dom.test.tsx` peers |
| Files to modify | `src/renderer/panelTabs/panelTabs.ts`, `src/renderer/tabs/useGenerativePanelTabs.ts`, `src/renderer/cosmos/cosmosTabs.ts`, `src/renderer/cosmos/CosmosPanel.tsx`, `src/renderer/cosmos/PanelTabTree.tsx`, `src/renderer/tabs/PanelTabStrip.tsx`, `src/shared/ipc/session.ts`, `src/renderer/session/sessionRegistry.ts`, `src/renderer/session/SessionProvider.tsx`, `src/main/session/sessionSnapshot.ts`, `docs/ARCHITECTURE.md` (§3/§4.14 — after build) |

---

## Technical Approach (decisions)

### D1 — Expanded `PanelTabsProvider` payload (the crux: LIVE shared surface)

Extend the published per-tab shape to carry the tab's **live** surface:

```ts
// src/renderer/panelTabs/panelTabs.ts
export interface LivePanelTab {
  id: string
  label: string
  /**
   * The tab's CURRENT live A2UI surface (cosmos-home-favorite-tabs-v1): the same TabSurface the
   * source panel renders — spec + live requestId + descriptor/bindings/dataModel. NON-SECRET by the
   * A2UI render contract (never a token/path/transcript). Renderer-only ref pass (PanelTabsProvider
   * is in-renderer, no IPC) so carrying it is cheap. Absent/`null` for a tab with no surface yet
   * (untitled/in-flight) and for terminal tabs (no A2UI surface).
   */
  surface?: TabSurface | null
}
```

- `useGenerativePanelTabs` changes its `livePanelTabs` memo to `tabs.map(t => ({ id: t.id, label: t.label, surface: t.surface }))` (re-publishes on any tab change — already its dep set). The Terminal panel keeps publishing `{id,label}` with no `surface`.
- The tree grouping (`toPanelTabGroups`) stays label-only — it does NOT need the surface, so `PanelTabGroup`/the survey are unchanged. A NEW pure reader `findLiveTab(registry, panelId, tabId): LivePanelTab | null` (in `homeFavorites.ts`) returns the live tab (incl. surface) for a favorite to mirror; defensive (malformed → null, never throws).
- **Security:** `TabSurface` is non-secret by the render contract; it is a renderer-only reference and is **never** persisted or sent over IPC by this seam. Reaffirm §4.14 FR-011's whitelist in the doc comment.

### D2 — Favorite `CosmosTab` shape + pure reducer (`homeFavorites.ts` + `cosmosTabs.ts`)

Extend `CosmosTab` with the favorite's source reference; keep the existing pure-ops style:

```ts
export interface CosmosTab {
  id: string
  label: string
  kind: 'default' | 'favorite'
  /** Favorite-only: the source panel+tab this favorite mirrors. Absent on the default tab. */
  source?: { panelId: CrossPanelId; tabId: string }
}
export function favoriteId(source: { panelId: CrossPanelId; tabId: string }): string // `fav:${panelId}:${tabId}`
```

- `appendFavorite(state, { source, label })` → appends a `favorite` tab whose `id = favoriteId(source)`; **idempotent/de-duped by source** (existing id ⇒ no-op, return same state), and activates the favorite. Default stays first.
- `closeCosmosTab` (unchanged semantics) doubles as **unpin**: a favorite is closeable, the default is not; closing the active favorite returns focus to `DEFAULT_TAB_ID`.
- `isPinned(state, source): boolean` — drives the menu's Pin vs Unpin label.
- `reconcileFavorites(tabs, groups): CosmosTab[]` (pure, mirrors `reconcileSelectedContext` discipline) — **relabels** a favorite when its source tab's label changed; **does NOT drop** a favorite whose source is gone (graceful degrade is the user's decision — the inline render handles the gone state). Returns the SAME array reference when nothing changed (no-op render).

### D3 — Inline render in Home (`FavoriteSurface.tsx` + `favoriteCatalogHosts.tsx`)

- `favoriteCatalogHosts.tsx` exports a map `CrossPanelId → { catalog, catalogId, panelName, onAction? }` for the four generative panels (terminal absent — not pinnable). This is the one accepted new coupling: Home imports the four panel catalogs (jira/slack/confluence/calendar) + reuses each panel's `*_CATALOG_ID`.
- `FavoriteSurface({ source })`:
  1. reads `useAllPanelTabs()` + `findLiveTab(registry, source.panelId, source.tabId)`.
  2. **found with a surface** → mounts `<A2UIProvider catalog={host.catalog}><ActiveTabSurface surface={liveSurface} catalogId={host.catalogId} panelName={host.panelName} onAction={favoriteOnAction(host)} /></A2UIProvider>`. Because it shares the source `surface.requestId` + `surfaceId`, it receives the same live `updateDataModel` pushes and bound/deterministic actions (`adapter.*`, `jira.*`) round-trip through `UiBridge` exactly as in the source panel (no new contract).
  3. **found but `surface == null`** (untitled/in-flight source) → a calm "Waiting for this tab's view…" placeholder; flips to the surface the moment one is published (live).
  4. **not found** (gone source) → a calm "This tab is no longer open" empty state (FR-031); favorite stays in the strip (no auto-drop).
- **Renderer-local actions** (Slack open-channel nav, Calendar open-detail dock) are panel-internal and have no meaning in Home. v1: `favoriteOnAction` **swallows** the known renderer-local action ids (returns `true` so they are not forwarded/mis-routed) — see Confirm #1. Bound/deterministic + terminal-`submit` semantics are unchanged.

### D4 — CosmosPanel wiring

- The content area switches on the active tab: `activeTab.kind === 'default'` → the existing timeline; `=== 'favorite'` → `<FavoriteSurface source={activeTab.source} />`. The cross-panel **tree stays visible** on every tab (user decision); the **docked composer behaves normally** (no special-casing).
- Strip: map favorites to `PanelTab`s with a leading **panel glyph** (`SURFACE_ICON[source.panelId]`) + the source label; default tab unchanged (`closeable: false`). `onClose` for a favorite = unpin. Add a right-click **Unpin** menu on favorite strip tabs.
- Pin/Unpin handlers passed down to the tree; `reconcileFavorites` runs in a `useEffect` over `groups` (mirrors the existing `reconcileSelectedContext` effect).

### D5 — Right-click menu (`PanelTabTree.tsx` + strip) — DESIGN STEP

- Add a shared shadcn/Radix **ContextMenu** primitive (`src/renderer/components/ui/context-menu.tsx`) — recommended over DropdownMenu because radix ContextMenu gives native right-click + built-in keyboard (`Shift+F10` / context-menu key) when the trigger is focused (satisfies FR-003 without bespoke keyboard code). **Owned by the designer (Step 2.5).**
- Each `TabRow` in `PanelTabTree` becomes a `ContextMenuTrigger`; the menu shows **Pin** (when `!isPinned`) or **Unpin** (when pinned). For `group.panelId === 'terminal'` the menu item is **disabled** with a hint ("Terminal tabs can't be pinned") — FR-040. Roving-tabindex behavior is preserved (the trigger is the existing focusable row).
- Favorite **strip** tabs get a ContextMenu with **Unpin**.

### D6 — Persistence (re-bind + gone-source)

- Add a **top-level additive-optional** field to `SessionSnapshot` (NO schema bump — mirrors `openPromptPosition`):

```ts
favorites?: HomeFavorite[]            // HomeFavorite = { panelId: CrossPanelId; tabId: string; label: string }
```

- `SessionRegistry.setFavorites(favorites)` (non-panel path, mirrors `setOpenPromptPosition`) + include in `assembleSnapshot` (omit when none). CosmosPanel reports on every favorites change and on label reconcile.
- Main `validateSnapshot` gains `validateFavorites`: keep only entries whose `panelId` is a valid `CrossPanelId`, `tabId`/`label` are non-empty strings; **drop** malformed/secret-bearing entries with a warn (FR-033). Never fatal.
- `SessionProvider` exposes `useRestoredFavorites()`; CosmosPanel seeds its favorite tabs from it on mount, then **re-binds** by `{panelId, tabId}` against the live registry once panels restore their tabs (ids are stable across relaunch). NO surface persisted — the surface is re-acquired live.
- **NO schema bump** (additive-optional) — see Confirm #2.

### D7 — Architecture doc (note, do not edit yet)

After build, update `docs/ARCHITECTURE.md` §4.14 (the seam changes from **labels-only** to **labels + live surface**, and Home gains favorite live-mirror tabs) and §3 (Home is now a multi-tab container: default timeline + favorite mirrors). Flagged here; not edited during Specify/Plan.

---

## Implementation Checklist

### Phase 1 — Interface (types + pure contracts)

- [x] Read spec; confirm no open questions remain (Confirms #1–#4 resolved).
- [x] `panelTabs.ts`: add `surface?: TabSurface | null` to `LivePanelTab` (+ import type) with the non-secret doc comment; export `findLiveTab` signature.
- [x] `cosmosTabs.ts`: extend `CosmosTab.source`; add `favoriteId`, `isPinned`; widen `appendFavorite(state, { source, label })` (idempotent/de-duped).
- [x] `homeFavorites.ts` (new, pure): `findLiveTab`, `reconcileFavorites`, `toFavoriteStripTab` (glyph + label), defensive guards.
- [x] `session.ts`: add top-level optional `favorites?: HomeFavorite[]` + `HomeFavorite` type; document non-secret + additive (no bump).
- [x] Review types vs spec — no invented properties (every field traces to FR-010/014/020/023/030).

### Phase 2.5 — Design (designer, `design` skill)

- [x] Add `src/renderer/components/ui/context-menu.tsx` (shadcn/Radix ContextMenu) + theme tokens, per DESIGN.md.
- [x] Design spec `.sdd/designs/cosmos-home-favorite-tabs-v1.md`: the Pin/Unpin menu (states, disabled terminal item), the favorite tab visual (panel glyph + label, close `X`), and the favorite inline/empty/waiting states.

### Phase 2 — Tests (TDD; `.ts` node-unit + `.dom.test.tsx` jsdom)

- [x] node-unit `cosmosTabs.test.ts` (extend): `appendFavorite` dedup/idempotent + appends after default + activates; `closeCosmosTab` unpins favorite + active→default; `favoriteId` determinism; `isPinned`.
- [x] node-unit `homeFavorites.test.ts`: `findLiveTab` (found/with-surface, found/null-surface, missing → null, malformed registry → null); `reconcileFavorites` (relabel on source rename, KEEP on source-close, same-ref no-op).
- [x] node-unit `sessionSnapshot.test.ts` / `sessionRegistry.test.ts` (extend): `validateFavorites` drops malformed/secret-ish + keeps good; `assembleSnapshot` includes/omits `favorites`; assert `SESSION_SCHEMA_VERSION` STILL `8` (no bump) — update the two existing "schema is 8" assertions' comments to cover favorites being additive.
- [x] jsdom `PanelTabTree.dom.test.tsx` (extend): right-click a generative tab row → Pin; pinned row → Unpin; terminal row → Pin disabled.
- [x] jsdom `CosmosFavoriteTabs.dom.test.tsx` (new): pin → favorite appears in strip after default; click favorite → source surface renders inline (assert the live surface's content via a stub catalog); unpin from strip `X` + from context menu; closing active favorite → default focus.
- [x] jsdom live-mirror test: publish a NEW source surface into the registry → the open favorite re-renders to reflect it (proves live, not snapshot); gone-source → calm empty state.

### Phase 3 — Implementation

- [x] `useGenerativePanelTabs.ts`: include `surface: t.surface` in the `livePanelTabs` memo.
- [x] `cosmosTabs.ts` + `homeFavorites.ts`: implement the pure ops.
- [x] `favoriteCatalogHosts.tsx` (new): the `CrossPanelId → { catalog, catalogId, panelName, onAction }` map + `favoriteOnAction` (swallow renderer-local-only ids).
- [x] `FavoriteSurface.tsx` (new): live mirror + waiting/gone states.
- [x] `PanelTabTree.tsx`: wrap `TabRow` in `ContextMenu`; Pin/Unpin (state-aware, terminal disabled); thread `isPinned`/`onPin`/`onUnpin` from CosmosPanel.
- [x] `PanelTabStrip.tsx`: minimal additive support for a favorite leading glyph (`icon?`/`kind:'favorite'`) + an optional per-tab context-menu slot (Unpin); the four generative panels + terminal unaffected.
- [x] `CosmosPanel.tsx`: favorites state seeded from `useRestoredFavorites`; content switch default↔favorite; strip favorites; pin/unpin handlers; `reconcileFavorites` effect; report via `setFavorites`.
- [x] Persistence: `session.ts`, `sessionRegistry.ts` (`setFavorites` + assemble), `SessionProvider.tsx` (`useRestoredFavorites`), `main/session/sessionSnapshot.ts` (`validateFavorites`).
- [x] All tests pass; `npm run typecheck` clean; reuse `ActiveTabSurface`/`SURFACE_ICON`/existing pure-op style — no duplicated logic.

### Phase 4 — Docs

- [x] Update `docs/ARCHITECTURE.md` §4.14 (labels → labels+live-surface; Home multi-tab favorites) + §3 (Home container).
- [x] Reconcile `docs/PROJECT-STRUCTURE.md` (new files) + `TODO.md`.
- [x] Record deviations below.

---

## Risks & Edge Cases

- **Catalog coupling (D3):** Home importing all four catalogs is the accepted cost of a true live mirror. Mitigated by a single `favoriteCatalogHosts` registry (one import site). Confirm #4.
- **Renderer-local actions (D3):** v1 swallows panel-internal navigation in the favorite; full parity is future work. Confirm #1.
- **Duplicate one-shot resolve:** two mounted instances of a one-shot `generated-ui`-style surface — main warn-ignores the second; benign. (Generative panels' display-only targets are settled-on-push anyway.)
- **Disabled source panel on relaunch:** disabled panels stay mounted + still publish, so a favorite still mirrors; if a panel truly clears its registry entry, the favorite shows the gone state.
- **`A2UIProvider key` remount:** the favorite uses its own provider instance keyed by the source tab id, so switching Home tabs remounts cleanly (matches the panels' `key={tab.id}` idiom).

## Open Questions / Needs Confirmation (before design + dev)

1. **Renderer-local actions in a favorite** — confirm v1 **swallows** panel-internal navigation actions (Slack open-channel, Calendar open-detail) in Home (the favorite mirrors the surface + supports bound/deterministic round-trips), rather than attempting cross-panel navigation. Recommended.
2. **Persistence shape** — confirm a **top-level additive-optional `favorites?`** with **NO schema bump** (mirrors `openPromptPosition`), rather than a schema bump or a dedicated Home slice. Recommended.
3. **Menu primitive** — confirm **shadcn/Radix ContextMenu** (native right-click + keyboard) over DropdownMenu, for the designer to add.
4. **Catalog coupling** — confirm it is acceptable for the Home panel to import the four generative-panel catalogs (via `favoriteCatalogHosts`) to render foreign surfaces inline.

---

## Deviations & Notes

- **2026-06-30**: Plan authored. Inline-surface mechanism is the user-chosen **(a) live shared surface** (shared `requestId`/`surfaceId` via the existing `ActiveTabSurface` + `UiBridge`), NOT the spec's originally-recommended snapshot. Favorites persist by reference + re-bind; gone-source degrades gracefully (no auto-drop).
- **2026-06-30 (implemented, Steps 3–5)**: Built interface + tests + implementation; `typecheck` + `npm test` (2706) + `npm run test:dom` (new suites) + `npm run build` all green.
  - **`validateFavorites` lives in `src/shared/ipc/session.ts`, not `homeFavorites.ts`** (deviation from the Phase-1 wording). Reason: the main project (`tsconfig.node.json`) does NOT include `src/renderer/**`, so the main `validateSnapshot` boundary cannot import a renderer module. Putting the pure validator in the shared `ipc/session.ts` (already imported by BOTH main and renderer) keeps it a single source with no boundary violation; `homeFavorites.ts` RE-EXPORTS it so its node-unit test + the renderer code still import `validateFavorites` from `./homeFavorites`.
  - **`HomeFavorite.panelId` + `CosmosTab.source.panelId` typed as `GateableIntegration`** (= cross-panel ids minus `terminal`), not the broader `CrossPanelId` — terminal is not pinnable, so this is the precise type and lets `HomeFavorite` live cleanly in shared without importing the renderer `CrossPanelId`.
  - **`PanelTabStrip` additive props**: `icon?: RailIcon` (favorite leading glyph) + `contextMenu?: (trigger)=>node` (strip Unpin wrapper). The four generative panels + terminal omit both ⇒ unchanged.
  - **Radix `ContextMenu` jsdom gotcha** (recorded in `docs/DEVELOPMENT.md`): the dom tests stub `scrollIntoView`/pointer-capture and must NOT manually wipe `document.body` (it races Radix portal removal). The pre-existing `CosmosCrossPanelLiveContext.dom.test.tsx` failure (asserts no "Cosmos" text while the strip's default tab is labeled "Cosmos") is RED on clean `HEAD` too — unrelated to this feature.
  - **Manual `npm run dev` check NOT exercised** (no GUI in this environment) — flagged in the wrap-up report.
- **2026-06-30 (corrections — user feedback, Step 5)**: "A favorite is literally a shortcut showing the SOURCE tab AS-IS." Two changes, both **contained renderer wiring** (decided NOT to escalate — see below):
  - **(1) The cross-panel tab tree renders ONLY on the default tab.** A favorite tab is a single FULL-WIDTH pane (no tree, no `ResizeDivider`); the timeline|tree split applies only to the default tab. Contained in `CosmosPanel` (the favorite branch renders `FavoriteSurface` full-width; the default branch keeps the timeline + divider + tree).
  - **(2) A favorite shows the source view "as-is", INCLUDING its Open Prompt — routing to the SOURCE target.** While a favorite tab is active, `CosmosPanel` publishes a **null `'cosmos'` composer config** (so the App-level `SharedComposer` hides the docked Cosmos composer + footer) and renders the **SOURCE panel's already-published composer config** (read by key via `useActiveComposerConfig(source.panelId)`) as a floating `PromptComposer` overlaid on the full-width favorite pane. The submit routes to the source target through the source panel's OWN `onSubmit`.
  - **SCOPE-GUARD DECISION: implemented, did NOT escalate.** The scope guard flagged "if the App-level composer routing keys off the active rail surface, a favorite-active-on-Home submit can't reach the source target without a new mechanism → escalate." Investigation found NO new mechanism is needed: the four generative panels publish their composer config **unconditionally** (gated on `isConnected`, NOT on being the active rail surface — verified in `JiraPanel`/`SlackPanel`/`ConfluencePanel`/`GoogleCalendarPanel`), so the source config is always in the `ActiveComposerProvider` registry; `selectActiveComposerConfig` is a plain by-key read; and the submit goes through the source panel's OWN `onSubmit` (the right layer — NOT a fabricated cross-target submit). No IPC/agent/persistence change; no `App.tsx`/`SharedComposer`/`ActiveComposerProvider` change. The App-level "one hoisted composer routes to the active rail surface" invariant is PRESERVED (Home's null config → `SharedComposer` renders nothing; the favorite's floating composer is a second, Home-scoped instance only while a favorite is active). This matches the coordinator's described contained path.
  - **Tests**: `CosmosFavoriteTabs.dom.test.tsx` extended — a favorite tab hides the tree (`queryByRole('tree')` absent) + hides the docked composer (probe `useActiveComposerConfig('cosmos')` is null) and shows the SOURCE Open Prompt (stubbed `PromptComposer` captures props: `ariaLabel` is the Jira config's; clicking fires the JIRA `onSubmit` spy); the default tab still shows the tree + a non-null cosmos config; switch-back restores both. `typecheck` + `npm test` (2706) + `npm run test:dom` (18 files / 98) + `npm run build` all green.
