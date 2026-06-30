# Plan: Home favorites render the LIVE source panel (reparenting portal) — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-favorite-live-panel-portal-v1.md` (approved; OQ-1..OQ-6 resolved)

---

## Grounding

> Direct investigation by the architect for THIS plan (the `wiki_query` MCP tool is absent in this
> session — grounding is codegraph + in-repo source/specs, flagged as in the spec).

**codegraph_explore / Grep queries run (one-line takeaways):**

- `App.tsx forceMount rail panel active prop` → all six panels are force-mounted in `AppShell` inside
  `<TabsContent value=id forceMount className="...data-[state=inactive]:hidden">` with `active={surface
  === id}`; one `surface` state, one visible surface at a time. This is the InPortal/OutPortal seam.
- `CosmosPanel FavoriteSurface activeFavoriteSource favoriteComposerConfig usePublishPins` → Home's
  active favorite renders `<FavoriteSurface>` full-width; CosmosPanel already computes
  `activeFavoriteSource`, publishes a null `'cosmos'` composer config, re-renders the source panel's
  composer as a floating composer, and publishes pinned-source keys via `usePublishPins`.
- `FavoriteSurface generative branch ActiveTabSurface mirrorSurface favoriteCatalogHosts` →
  `FavoriteSurface` resolves `live.mirrorSurface ?? live.surface` and mounts it via `ActiveTabSurface`
  under `favoriteCatalogHosts[panelId]` — the surface re-projection to be REPLACED; terminal branch
  (`source.panelId === 'terminal'` → `TerminalFavoriteSurface`) is KEPT.
- `livePanelProjection projectLivePanelTab nativeMirror usePinnedSources isActivePinned` → the publish
  projection carries `surface` + mutually-exclusive `mirrorSurface`; `nativeMirror.ts` builds the
  mirror; Confluence/Slack build it in a `usePinnedSources`-gated effect; Calendar reuses the pinned
  gate as `active || isActivePinned` for its default-view fetch.
- **Deletion-safety check (Grep `buildBound*Surface(` in `src/main` + adapter imports):** the
  Confluence/Slack `buildBound*Surface` functions are called ONLY by `nativeMirror.ts` (no `src/main`
  call sites). BUT `src/shared/surfaceBuilders/{confluence,slack}SurfaceBuilder.ts` ALSO export live
  path constants (`CONFLUENCE_FEED_PATH`/`_RESULTS_PATH`/`_PAGE_PATH`, `confluenceResultRow`) that
  `confluenceAdapter.ts`/`slackAdapter.ts` import + re-export for the REAL bound-data resolver. ⇒ **the
  shared `surfaceBuilders/` modules are NOT "only for the mirror" and MUST NOT be deleted** — only the
  now-dead `buildBound*Surface` functions inside them are mirror-only. (Corrects the coordinator's
  premise — see OPEN ITEM A.)

---

## Summary

Invert how a Home favorite of a generative panel (Jira/Slack/Confluence/Google Calendar) renders:
instead of re-projecting the tab's A2UI **data surface** (which carries no chrome), **render the live
source panel instance itself** by relocating it with a reparenting portal. We adopt
**`react-reverse-portal`**: each generative panel is rendered ONCE through an `InPortal` into a stable
detached node (always mounted at App root, so it never unmounts/resets), and an `OutPortal` mounts that
node at exactly one location — the panel's **rail slot** (`App.tsx`) by default, or the **Home favorite
slot** (`FavoriteSurface`) when a favorite of it is the active Home tab. A deterministic `hostFor(panelId)`
selector over (visible rail surface, active Home favorite) guarantees exactly one `OutPortal` per node.
Moving the OutPortal reparents the DOM node WITHOUT remounting the panel, so all state (tabs, MCP/IPC
subscriptions, in-flight surfaces, native chrome, scroll) survives — giving the favorite full working
chrome (search box / date+month nav / legend) for free ("그대로"). On favorite activation we focus the
panel to the pinned source tab (initial-focus-then-free); while a favorite is active the global `tab:*`
shortcuts target the inner panel (Home cedes them). The just-shipped surface-mirror
(`cosmos-native-view-mirror-surface-v1`) is removed for these panels. The terminal favorite (xterm
multiplex) is unchanged.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (React renderer) |
| New dependency | `react-reverse-portal` (`createHtmlPortalNode` / `InPortal` / `OutPortal`) — developer/main runs `npm install` (Phase 1); small, focused, purpose-built for reparent-without-remount |
| Files to create | `src/renderer/panelHost/PanelHostProvider.tsx` (stable nodes + `hostFor` selector + visible-surface/active-favorite signals + one-shot focus channel); `src/renderer/panelHost/panelHostLogic.ts` (PURE `hostFor` + `panelVisible` selectors, node-testable); `src/renderer/panelHost/index.ts`; tests (see Phase 2) |
| Files to modify | `src/renderer/App.tsx` (InPortals at App root + rail OutPortals); `src/renderer/cosmos/CosmosPanel.tsx` (publish active-favorite, focus-on-activation, cede `tab:*`); `src/renderer/cosmos/FavoriteSurface.tsx` (generative branch → OutPortal); `src/renderer/calendar/GoogleCalendarPanel.tsx`, `src/renderer/confluence/ConfluencePanel.tsx`, `src/renderer/slack/SlackPanel.tsx` (redefined `active`=visible; DELETE mirror/pins wiring); `src/renderer/tabs/useGenerativePanelTabs.ts` + `src/renderer/cosmos/livePanelProjection.ts` + `src/renderer/panelTabs/*` (remove mirror/surface publish + pins channel) |
| Files to delete | see OQ-6 DELETION LIST below |

---

## Architecture: InPortal / OutPortal placement + the one-claimer selector

### Stable nodes + the host registry (`PanelHostProvider`, App root)

A new App-root provider (sibling to `PanelTabsProvider`/`ActiveComposerProvider`) owns:

- **Four stable portal nodes**, one per generative panel id (`jira`/`slack`/`confluence`/`google-calendar`),
  created once via `useMemo(() => createHtmlPortalNode(), [])` (or a small record). `useNode(panelId)`
  reads one. Terminal + Cosmos get NO node (not portaled).
- **Two host signals, both React state (synchronous — NOT effect-published refs):**
  - `visibleSurface: SurfaceId` — lifted from `AppShell` (today's `surface` state moves into / is mirrored
    by the provider so both the rail OutPortals AND `FavoriteSurface` read ONE consistent value per render).
  - `activeFavoriteSource: { panelId: CrossPanelId; tabId: string } | null` — set by `CosmosPanel` in the
    SAME state path that switches the active Home tab (click / `useTabShortcuts` onActivate / reconcile),
    so it is consistent with `visibleSurface` in a single render pass.
- **`hostFor(panelId): 'rail' | 'favorite'`** — a PURE selector (`panelHostLogic.ts`):
  `favorite` iff `visibleSurface === 'cosmos' && activeFavoriteSource?.panelId === panelId`; else `rail`.
- **`panelVisible(surface, activeFavoriteSource, panelId): boolean`** — PURE: `surface === panelId ||
  (surface === 'cosmos' && activeFavoriteSource?.panelId === panelId)`. Feeds the panel's `active` prop
  (redefined as "visible", below).
- **A one-shot focus channel** — `focusSourceTab(panelId, tabId)` (called by CosmosPanel on favorite
  activation) → each panel registers `onFocusTab(panelId, (tabId) => setActive(tabId))`. Renderer-only ref
  + version bump (mirrors the existing pins channel it replaces); no IPC.

### Placement

- **App root (always mounted, off-DOM):** `<InPortal node={node.jira}><JiraPanel active={panelVisible(...)} /></InPortal>`
  and the same for slack/confluence/google-calendar. The panels LIVE here now — mounted once, never
  unmounted by surface/favorite changes — so their state is permanent. (Terminal + Cosmos stay rendered
  directly in their `TabsContent` as today — not portaled.)
- **Rail slot (`App.tsx`, each generative `TabsContent forceMount`):** renders `<OutPortal node={node[id]} />`
  **iff `hostFor(id) === 'rail'`**. The `data-[state=inactive]:hidden` hide stays on the TabsContent so a
  rail-hosted-but-inactive panel is hidden exactly as today.
- **Home favorite slot (`FavoriteSurface`, generative branch):** renders `<OutPortal node={node[source.panelId]} />`
  **iff `hostFor(source.panelId) === 'favorite'`** (always true when this favorite is the active Home tab,
  by construction). Wrapped in the same full-width container; the GONE/calm states stay.

### The one-claimer invariant (THE correctness risk)

For each node, **exactly one** OutPortal may render at a time. Because both render sites compute `hostFor`
from the SAME synchronously-shared `(visibleSurface, activeFavoriteSource)` state, they always agree:
when a favorite of X is active in Home, the rail slot for X renders NO OutPortal and the favorite slot
renders it; otherwise the rail slot renders it and the favorite does not. The rail↔favorite handoff is a
single relocation that `react-reverse-portal` is purpose-built to perform without remount (it moves the
detached node between OutPortals; the InPortal keeps the children mounted throughout). This invariant is
**explicitly tested** (Phase 2) — a node is mounted by exactly one OutPortal across a rail↔favorite switch,
and the panel's state survives the move.

---

## active / visibility reconciliation (+ calendar gate revert)

- The panel prop `active` is **redefined to mean "visible"** = `panelVisible(surface, activeFavoriteSource,
  id)` (rail surface OR hosted in the active Home favorite). One value drives: render/auto-scroll/resize,
  the default-view fetch gate, and the panel's own `useTabShortcuts`. Documented at each panel's prop site.
- **Calendar default-view gate reverts** from `(active || isActivePinned)` to plain `active`: with the
  portal, a favorited Calendar tab is now `active`/visible when shown, so the default-view effect fires
  naturally — the `isActivePinned` + `usePinnedSources` hack (calendar-favorite-waiting-v1) is no longer
  needed and is DELETED. Same reasoning removes Confluence/Slack's pinned-gated mirror effects entirely.
- **Keyboard `tab:*` ownership (OQ-3):** while a generative favorite is active, the inner panel owns the
  global tab shortcuts and Home cedes them. Mechanically: the inner panel's `useTabShortcuts({active})`
  becomes true (it is visible); **CosmosPanel gates its own `useTabShortcuts` to `active && !favoriteActive`**
  so Home stops binding `tab:*` while a favorite shows the inner panel. When `surface === 'jira'` (rail) Home
  is hidden and already inactive; when `surface === 'cosmos'` + no favorite, Home owns them and the inner
  panel is not visible → no double-bind in any state.
- **Focus the pinned tab (FR-006, initial-focus-then-free):** CosmosPanel runs an effect keyed on
  `activeFavoriteSource` (panelId+tabId) → `focusSourceTab(panelId, tabId)`; the panel's registered handler
  calls `setActive(tabId)` ONCE. No continuous re-pin — the user then navigates the live panel freely
  (FR-007). GONE guard: if the panel has no tab with that id, `setActive` no-ops (safe) and FavoriteSurface
  shows the calm "no longer open" state.

---

## Composer + footer (retained wiring — OQ-4)

- The relocated panel body brings its OWN `PanelFooter` (it is inside the panel `<section>` → travels with
  the OutPortal). No change needed — strict improvement over the footer-less surface-mirror.
- The hoisted App-level Open-Prompt composer (`SharedComposer`) does NOT travel inside the OutPortal, so
  **CosmosPanel keeps today's behavior**: publish a null `'cosmos'` composer config (hide the docked Cosmos
  composer) and render the source panel's published composer config as a floating `PromptComposer` over the
  favorite, routing to the source target. This block in `CosmosPanel.tsx` is UNCHANGED.

---

## OQ-6 DELETION LIST (revert the surface-mirror; keep what's live)

> Remove ONLY what is truly dead after the portal. Each item verified against current callers.

**Delete outright (mirror-only):**

1. `src/renderer/cosmos/nativeMirror.ts` + `nativeMirror.test.ts` — the mirror builder; sole caller of the
   Confluence/Slack `buildBound*Surface`.
2. `src/renderer/cosmos/livePanelProjection.ts` + `livePanelProjection.test.ts` — the
   `surface`/`mirrorSurface` publish projection; favorites no longer read a published surface.
3. The pinned-sources REVERSE channel in `src/renderer/panelTabs/PanelTabsProvider.tsx`: `PinnedSourceKey`,
   `pinnedSourceKey`, `pinnedSourcesRef`, `publishPins`, `pinsVersion`, `usePublishPins`, `usePinnedSources`
   (+ their re-exports in `src/renderer/panelTabs/index.ts`). It existed ONLY to gate mirror-building.
4. `src/renderer/cosmos/favoriteCatalogHosts.tsx` (`favoriteCatalogHosts`, `favoriteOnAction`) — used ONLY
   by FavoriteSurface's generative branch (verify no other importer first). The generative favorite no
   longer mounts `ActiveTabSurface`/`A2UIProvider` under a per-panel catalog.

**Edit (strip mirror wiring, keep the file):**

5. `src/renderer/tabs/useGenerativePanelTabs.ts` — remove the `mirrorSurface` field on `GenerativeTab`; the
   publish memo stops calling `projectLivePanelTab` and maps tabs to label-only (`{id,label}`) — verify the
   tree consumer (`toPanelTabGroups`) and `findLiveTab` only need `{id,label}` (they do; GONE detection is by
   existence). Keep `surface` ON the tab record (the panel renders it itself) but STOP publishing it on
   `LivePanelTab`.
6. `src/renderer/panelTabs/panelTabs.ts` — drop the `surface` + `mirrorSurface` fields from `LivePanelTab`
   (now-unused by every consumer; keep `serialize` for terminal). Update the doc comments.
7. `src/renderer/cosmos/FavoriteSurface.tsx` — replace the generative branch (`mirrorSurface ?? surface` +
   `A2UIProvider`/`ActiveTabSurface`/`favoriteCatalogHosts`) with `<OutPortal node={useNode(panelId)} />`;
   KEEP the terminal branch and the GONE/calm "no longer open" + Unpin states (GONE = panel has no tab with
   the pinned id, read from the registry).
8. `src/renderer/confluence/ConfluencePanel.tsx` — delete the mirror effect (`update(tab,{mirrorSurface:
   buildConfluenceMirror(view)})`), `confluenceMirrorKey`, `lastMirrorKeyRef`, the `buildConfluenceMirror`/
   `ConfluenceMirrorView` import, and `usePinnedSources`/`pinnedSourceKey`/`isActivePinned`.
9. `src/renderer/slack/SlackPanel.tsx` — symmetric deletion (mirror effect, `slackMirrorKey`,
   `buildSlackMirror`/`SlackMirrorView` import, pins wiring).
10. `src/renderer/calendar/GoogleCalendarPanel.tsx` — remove `usePinnedSources`/`pinnedSourceKey`/
    `isActivePinned`; revert the default-view gate to `active`; update the comment block.
11. `src/renderer/cosmos/CosmosPanel.tsx` — remove the `publishPins` effect (the pinned-source key set).

**KEEP — verified still used (do NOT delete; corrects the coordinator's premise):**

- `src/shared/surfaceBuilders/{confluence,slack}SurfaceBuilder.ts` — they export LIVE path constants
  (`CONFLUENCE_FEED_PATH`/`_RESULTS_PATH`/`_PAGE_PATH`, `confluenceResultRow`) imported + re-exported by
  `src/main/{confluence,slack}/*Adapter.ts` for the REAL bound-data resolver. Only the now-dead
  `buildBound*Surface` functions (+ the `*BoundSurface` types + their `.test.ts` describe blocks + the
  main re-export passthroughs) are mirror-only; pruning those is OPTIONAL cleanup gated on a per-export
  caller check — see OPEN ITEM A.
- Terminal favorite: `TerminalFavoriteSurface`, the multiplex, the `serialize` ref on `LivePanelTab`, the
  explorer-share `OpenFilesProvider` — UNCHANGED.
- Jira: pushes a real default-view surface (`jira:requestDefaultView`) the panel renders itself — never used
  the mirror/pins — UNCHANGED.
- The favorites tab model / persistence (`SessionSnapshot.favorites` by reference) / pin-unpin / keyboard
  tab-nav / the footer — UNCHANGED.

**Tests that assert the OLD mechanism (must be rewritten or removed — see OPEN ITEM B):**

- `src/renderer/cosmos/ConfluenceFavoriteWaiting.dom.test.tsx`,
  `src/renderer/cosmos/CalendarFavoriteWaiting.dom.test.tsx` — they assert the mirror/WAITING behavior the
  portal supersedes; replace with the new "favorite renders the live panel chrome" tests.

---

## Implementation Checklist

### Phase 1 — Interface + dependency

- [ ] Read the approved spec; confirm OQ-1..OQ-6 resolutions are reflected here (no open questions remain
      except OPEN ITEMS A/B flagged for the user).
- [ ] **Developer/main runs `npm install react-reverse-portal`** (designer has no Bash); confirm it bundles
      in the renderer rollup (no new MCP `input` needed — renderer dep only).
- [ ] Create `src/renderer/panelHost/panelHostLogic.ts` — PURE `hostFor` + `panelVisible` selectors (node-testable, no React import).
- [ ] Create `src/renderer/panelHost/PanelHostProvider.tsx` — stable nodes, `visibleSurface` +
      `activeFavoriteSource` state, `hostFor`/`useNode`, and the one-shot `focusSourceTab`/`onFocusTab`
      channel. Add `index.ts`.
- [ ] Wrap `AppShell` in `PanelHostProvider` (sibling to `PanelTabsProvider`); move/mirror `surface` state so
      the provider holds `visibleSurface`.
- [ ] Review the new types/selectors vs spec — no invented properties; non-secret renderer-only (no IPC).

### Phase 2 — Testing (write before/with implementation)

- [ ] **node-unit (`panelHostLogic.test.ts`):** `hostFor` returns `favorite` only when `visibleSurface ===
      'cosmos'` and the active favorite points at that panel; `panelVisible` truth table for rail/favorite/hidden.
- [ ] **jsdom — relocation preserves state (THE CRUX):** mount a stub generative panel via InPortal with an
      internal counter / input value; move its OutPortal from a "rail" host to a "favorite" host; assert the
      DOM node moved AND the state value survived (no remount).
- [ ] **jsdom — one-claimer invariant:** across a rail↔favorite switch, assert exactly ONE OutPortal mounts a
      given node at every committed state (never zero in steady state, never two).
- [ ] **jsdom — which-tab focus:** activating a favorite calls `focusSourceTab(panelId, pinnedTabId)` and the
      panel's handler calls `setActive(pinnedTabId)` exactly once; subsequent inner navigation is not re-pinned.
- [ ] **jsdom — favorite shows live chrome, not a static surface:** a Confluence (or Calendar) favorite renders
      the panel's interactive chrome (search box / date-nav controls present + wired), proving it is the live
      panel — the regression this feature exists to fix.
- [ ] **jsdom — keyboard ownership:** while a generative favorite is active, a `tab:*` shortcut acts on the
      inner panel's strip and NOT on Home's strip (Home cedes).
- [ ] Rewrite `ConfluenceFavoriteWaiting`/`CalendarFavoriteWaiting` dom tests to the new behavior (or remove
      per OPEN ITEM B).
- [ ] Confirm existing favorites + terminal-favorite + per-panel tests still pass unchanged.

### Phase 3 — Implementation

- [ ] `App.tsx`: render the four generative `<InPortal>`s at App root with `active={panelVisible(...)}`; in
      each generative `TabsContent`, render `<OutPortal>` gated on `hostFor(id) === 'rail'`.
- [ ] `CosmosPanel.tsx`: publish `activeFavoriteSource` to the provider in the active-tab paths; add the
      focus-on-activation effect; gate Home's `useTabShortcuts` to `active && !favoriteActive`; remove the
      `publishPins` effect. (Composer/footer block unchanged.)
- [ ] `FavoriteSurface.tsx`: generative branch → `<OutPortal>`; keep terminal branch + GONE/calm states.
- [ ] Panels (Calendar/Confluence/Slack): adopt the redefined `active`=visible; delete the mirror/pins wiring
      (DELETION LIST 8–10); revert the calendar default-view gate to `active`.
- [ ] Remove dead modules/fields (DELETION LIST 1–7, 11); strip `surface`/`mirrorSurface` from `LivePanelTab`
      + the publish; verify the tree consumer compiles label-only.
- [ ] `npm run typecheck` + `npm test` green; verify no dead import of `react-reverse-portal` left unbundled
      and `npm run dev` shows a favorite with working chrome and a clean rail↔favorite switch (no flicker/reset).

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §3 (Home favorites = reparented live panel via InPortal/OutPortal; the
      one-claimer invariant; `active` redefined as visible) and §4.14 (the `surface`/`mirrorSurface` seam
      evolutions SUPERSEDED for generative panels — publish reverts toward label-only; terminal multiplex +
      `serialize` unchanged; pins channel removed). (Note here; the architect edits ARCHITECTURE in wrap-up.)
- [ ] Update `docs/PROJECT-STRUCTURE.md` (new `panelHost/`; deleted `nativeMirror.ts`/`livePanelProjection.ts`/
      `favoriteCatalogHosts.tsx`).
- [ ] Update this plan's Deviations with anything that differed.

---

## Edge cases carried from the spec (verify during implementation)

- **Disabled integration favorite:** the panel stays force-mounted via its InPortal even when filtered from
  the rail; a favorite of its still-existing tab renders the live (disabled-state) panel chrome.
- **Dev Fast-Refresh / StrictMode:** create the portal nodes via lazy `useMemo`/`useState` init (never a
  render-phase side effect) so a double-invoke/remount does not orphan or duplicate a node.
- **GONE vs focus:** focus-on-activation must no-op safely when the pinned tab id is absent (panel still has
  the favorite's GONE placeholder via the registry existence check).

## Open items needing your confirmation (before dev)

- [ ] **OPEN ITEM A — surfaceBuilders are NOT mirror-only.** Contrary to the deletion brief, the shared
  `surfaceBuilders/{confluence,slack}SurfaceBuilder.ts` modules export LIVE path constants/row mappers used by
  main's adapters — I will NOT delete the modules. The now-dead `buildBound*Surface` functions (+ types +
  their test describes + the main re-export passthroughs) MAY be pruned as a follow-up, gated on a per-export
  caller check. **Recommend: keep the modules, prune the dead functions only if verified unreferenced.**
  Confirm you're OK leaving the shared modules in place.
- [ ] **OPEN ITEM B — the two FavoriteWaiting dom tests** assert the superseded mirror/WAITING path.
  **Recommend: replace them** with the new "favorite renders live panel chrome" test (Phase 2) rather than
  delete silently. Confirm replace-vs-remove.

## Deviations & Notes

- **2026-06-30**: Plan authored. Correction logged vs the deletion brief: `src/shared/surfaceBuilders/` is
  retained (live constants used by main adapters); only the mirror's consumers are deleted (OPEN ITEM A).
- **2026-06-30 (implementation)**: Built per plan. Deviations from the approved spec, both from in-session
  user feedback during implementation (require architect spec/§3/§4.14 reconciliation):
  - **OQ-1 REVERSED — body-only favorite (was "show the inner strip as-is").** User: "탭 안에 탭목록이
    하나 더 보이는데 … 내부만 렌더링" + "footer도 중첩돼서 보이는데 … Home footer만". So a relocated panel
    SUPPRESSES its OWN `PanelTabStrip` AND its OWN `PanelFooter` while `hostFor==='favorite'` (each panel
    gates both on `!favoriteHosted`). The favorite shows the active tab's BODY only; Home shows only its own
    docked footer.
  - **OQ-3 COLLAPSES — Home keeps `tab:*` (was "cede to the inner panel").** With the inner strip
    suppressed there is nothing to navigate inside the favorite, so the inner panel's `useTabShortcuts` is
    gated `active && hostFor!=='favorite'` (rail surface only) and `CosmosPanel` KEEPS its `tab:*`
    (the `active && !favoriteActive` cede-gate was reverted to plain `active`). FR-006 focus-on-activation
    is kept (the suppressed-strip body still opens on the pinned tab).
  - OPEN ITEM A honored: `src/shared/surfaceBuilders/` kept; the now-unreferenced `buildBound*Surface`
    functions left in place (their tests stay green) — pruning deferred.
  - OPEN ITEM B honored: `ConfluenceFavoriteWaiting`/`CalendarFavoriteWaiting` dom tests REPLACED in place
    with the new live-panel-chrome / gate-revert tests (filenames kept).
  - Ripple: `CosmosPanel`/`FavoriteSurface`/the four panels now require `PanelHostProvider`; 7 existing
    cosmos dom tests were wrapped in it (no behavior change). `FavoriteSurface` split so the terminal
    branch needs no provider.
  - **Architect TODO (not done here — architect-owned):** reconcile `docs/ARCHITECTURE.md` §3
    (force-mount → reparenting portal host; `active`=visible; the one-claimer invariant) + §4.14 (favorites
    = live-panel portal supersedes the surface-mirror; pins channel removed; terminal multiplex unchanged),
    and update the spec OQ-1/OQ-3/FR-007/FR-010/FR-012/SC-001 to the body-only resolution.
  - Verified GREEN: `npm run typecheck`, `npm test` (2749), `npm run test:dom` (142), `npm run build`.
