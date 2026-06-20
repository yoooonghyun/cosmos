# Plan: Jira Tab-Switch Auto-Refresh + Loading Skeleton — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: `.sdd/specs/jira-tab-switch-auto-refresh-v1.md`

---

## Grounding

> Tools I ran directly for THIS plan (architect protocol). The spec's grounding stands; the
> queries below re-confirmed the exact symbols + line ranges this plan edits and verified the
> concurrent Slack-parity overlap.

**codegraph_explore**
- `"ActiveTabSurface restored descriptor bindings restore refresh effect onDataModel updateDataModel surfaceId requestId"` — confirmed the restore-refresh effect (`ActiveTabSurface.tsx:121-141`) is keyed on **`surface?.requestId`** and gated `!surface.restored`; the in-place apply effect (`:148-160`) repaints by `surfaceId`. `AdapterDispatcher.refresh` (`adapterDispatcher.ts:224`) clears to the base cursor and runs `'replace-fresh'`, then `push`es `updateDataModel`. Critical finding: a plain tab switch does NOT change `requestId`, so the existing effect alone will not re-fire on re-activation by virtue of `restored` — the gate must be generalized to "bound surface on (re)mount," see Approach.
- `"useGenerativePanelTabs TabSurface GenerativeTab loadingDefault restored activeTab"` — confirmed `TabSurface.restored` is set ONLY by snapshot-hydrate + back-nav; `GenerativeTab.loadingDefault` is the existing Jira-only per-tab skeleton flag, cleared when a surface/error lands. A freshly composed/landed surface is deliberately NOT `restored`.
- `"usePanelTabs PanelTabsController setActive activeTabId open close update"` — confirmed `setActive` only flips `activeTabId` (pure `setActiveTab`); the remount of `ActiveTabSurface` on switch comes from `<A2UIProvider key={activeTab.id}>` in `JiraPanel.tsx:451`, not from a record change. So a re-activation that remounts is observable in `ActiveTabSurface` as a fresh effect run, but NOT as a `requestId` change.

**Read (verbatim)**
- `JiraPanel.tsx` (full) — the skeleton gate is `activeTab?.loadingDefault || navLoading` (`:431`) wrapping the `<A2UIProvider>` branch (`:450-459`); `navLoading` is the existing 350ms in-place-nav floor (`beginNavLoad`, `:194-200`); `DefaultViewSkeleton` (`:64-80`) is the data-region skeleton already used.
- `jiraBackNav.ts` — `backNavTarget` marks a BOUND restored surface `restored:true` (the exact precedent this feature generalizes from back-nav to plain re-activation).

**memory_recall / memory_smart_search**
- `"Jira tab switch auto refresh restored bindings descriptor blank board repaint skeleton tab re-activation"` — empty. No prior decision; net-new behavior on existing machinery. Will `memory_save` the keying decision (below) on plan acceptance.

**Concurrent-feature overlap check** — read `.sdd/specs/slack-generative-message-parity-v1.md` (its plan is not yet authored). Its FR-014/FR-015 touch **`slackCatalog/logic.ts`** (`showEmptyState`) + `slackCatalog/components.tsx` (`MessageList`/`SearchResultList`) for empty-vs-skeleton gating, and it MAY extract a shared row touching `SlackPanel.tsx`/`ActiveTabSurface` only at the Slack layer. See the explicit file-overlap section below.

---

## Summary

Make a BOUND Jira generative surface (a kanban with `bindings`, or a single-region `descriptor`
list) auto-refresh and repaint itself when its tab is switched away from and back to — today it
comes back blank until the user clicks the manual refresh control — and show the existing
data-region skeleton over the board/list area while that auto-refresh is in flight. The approach
**generalizes the existing `restored`-driven restore-refresh** in `ActiveTabSurface` from
"snapshot/back-nav restore" to "any bound surface (re)mounted on tab re-activation": because
`<A2UIProvider key={activeTab.id}>` remounts `ActiveTabSurface` on every switch-back, the
restore-refresh effect already re-runs on mount — we widen its firing gate from `surface.restored`
alone to a **pure, node-testable predicate** (`shouldAutoRefreshOnMount`) that is true for any bound
surface on (re)mount, extract the bound-region dispatch values into the same `.ts`, and add a
**per-tab `autoRefreshing` skeleton flag** driven by that fire + cleared by the matching
`onDataModel` land (reusing Jira's `navLoading` floor and `DefaultViewSkeleton` data-region
treatment). It is renderer-only: it reuses the existing `adapter.refresh` dispatch and `updateDataModel`
repaint — NO new typed IPC channel, NO main-process change, NO new error contract. The shared
trigger/skeleton predicate is **target-agnostic in shape** but **wired only for Jira in v1**;
Slack/Confluence/Generated-UI behavior is unchanged.

## Technical Context

| Item              | Value                                                                                                  |
|-------------------|--------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (React renderer); pure logic in plain `.ts` (vitest node env)                                |
| Key dependencies  | Existing `ActiveTabSurface` restore-refresh + `onDataModel` apply; `AdapterDispatcher.refresh` (main, unchanged); `window.cosmos.ui.sendAction` `adapter.refresh`; `useGenerativePanelTabs`/`usePanelTabs` records; `DefaultViewSkeleton` + `navLoading` floor in `JiraPanel.tsx` |
| Files to create   | `src/renderer/activeTabSurfaceRefresh.ts` (pure trigger/dispatch-values logic) + `.test.ts`            |
| Files to modify   | `src/renderer/ActiveTabSurface.tsx`, `src/renderer/JiraPanel.tsx` (Jira wiring only). NO main/IPC/shared/preload edits. |

## Approach & key design decisions

1. **Keying the trigger on remount, not on `requestId`/`restored` alone.** The existing effect is keyed
   on `surface?.requestId`, which does NOT change on a plain tab switch — so widening only the `restored`
   guard would still not re-fire on re-activation. The fix relies on the FACT that
   `<A2UIProvider key={activeTab.id}>` remounts `ActiveTabSurface` on every switch-back: the effect
   re-runs on mount with a fresh `requestIdRef`. We replace the `!surface.restored` guard with a pure
   predicate `shouldAutoRefreshOnMount(surface)` = "surface present, not error, and bound (`bindings` OR
   `descriptor`)". `restored` is no longer required to fire — it becomes redundant with bound-ness for
   the auto-refresh, while snapshot/back-nav still set it harmlessly (the one-shot is per mount via the
   effect's dependency, see #3). A NON-bound surface returns `false` → no auto-refresh, repaints from
   stored spec/seed verbatim (FR-005, SC-004). This is the generalization the spec commits to (FR-002).
2. **Reuse the existing dispatch path verbatim.** When the predicate is true, fire the SAME
   `window.cosmos.ui.sendAction({ requestId, action: { type:'submit', actionId:'adapter.refresh',
   values } })` the effect already fires, with `values` = `{ surfaceId, bindings }` for multi-region or
   `{ surfaceId, descriptor }` for single-region (mutually exclusive — extracted into the pure helper
   `autoRefreshValues(surface)`). Main lazily re-registers (idempotent) + re-fetches + pushes
   `updateDataModel` → the existing `:148-160` apply effect repaints in place (FR-003). No new IPC, no
   main change (FR-014 — renderer-only path satisfies FR-001–FR-008).
3. **One-shot per re-activation (FR-004).** The effect keeps a single dependency that is stable for the
   life of one mount (the surface's `requestId`), so it fires once per mount and not on every
   `updateDataModel` push. Because `ActiveTabSurface` remounts on each switch-back (keyed provider), each
   re-activation is a fresh mount → one fire. While the tab STAYS active (no remount) it does not re-fire
   (FR-004, edge "re-activation that does not remount" — covered because we key on the mount/effect, not
   on a polling/active interval).
4. **No double-fire on fresh compose / detail→Back / snapshot-restore (FR-012, edge cases).** A freshly
   composed surface that just landed in the ACTIVE tab is a normal mount of a bound surface — to avoid a
   redundant first-page re-fetch on top of the live seed, the predicate must NOT fire for the surface's
   FIRST mount after a live compose. We distinguish "first live mount" from "re-activation remount" with a
   per-tab/`requestId` **seen-set ref** in `ActiveTabSurface` (mirrors the existing `submittedRef`
   one-shot pattern): the auto-refresh fires only when this mount's `requestId` has been SEEN mounted
   before — i.e. the surface is being RE-mounted, not first-mounted. The first mount records the
   `requestId` and skips; the next remount (a real re-activation, same `requestId`, fresh component
   instance but the ref persists across remounts only if hoisted — see note) fires. Because the keyed
   provider gives each mount a fresh `ActiveTabSurface` instance, the seen-set must live ABOVE the keyed
   remount boundary: it is owned by `JiraPanel` (or the tab record) and passed in, OR — simpler and
   target-agnostic — the auto-refresh decision is computed in `JiraPanel` from tab activation, not inside
   the remounting child. **Decision: drive the trigger from the surviving parent.** See #5.
5. **Trigger owned by the surviving parent (`JiraPanel`), skeleton flag on the tab — target-agnostic in
   shape (FR-015).** Rather than fire from inside the remounting `ActiveTabSurface`, `JiraPanel` runs one
   effect keyed on `activeTabId` (which survives the child remount) that, when a bound active surface is
   re-activated, (a) sets the tab's `autoRefreshing` flag (the skeleton), (b) dispatches the
   `adapter.refresh` via the pure `autoRefreshValues`, and (c) starts the `navLoading` floor. The
   "is this a re-activation (not the first paint of this surface)?" decision is the pure
   `shouldAutoRefreshOnActivation({ surface, alreadyPaintedRequestId })` — `JiraPanel` keeps a ref of the
   last surface `requestId` it auto-handled so a compose/land's first activation is skipped but a true
   switch-back fires. The skeleton flag is per-tab (`autoRefreshing?: boolean` on `GenerativeTab`),
   cleared by the existing render/`onDataModel` land path, so a sibling tab's auto-refresh never drives
   the active tab's skeleton (FR-011). The predicate + values helpers live in the shared
   `activeTabSurfaceRefresh.ts` and key on bound-ness, NOT `target === 'jira'` (FR-015 target-agnostic
   shape); only `JiraPanel` calls them in v1.
   > NOTE: keep `ActiveTabSurface`'s existing `restored`-driven effect intact for the snapshot/back-nav
   > restore paths it already serves, BUT ensure it does not ALSO double-fire when `JiraPanel` now drives
   > the same refresh for a re-activation. The clean reconciliation: the parent-driven trigger fires for
   > plain re-activation (no `restored` flag), and the child effect continues to fire ONLY for
   > `restored:true` (snapshot/back-nav) — the two are mutually exclusive because a plain switch-back does
   > not set `restored`. This preserves FR-012/edge "must not double-fire for restore" while adding the
   > re-activation case. Confirm this split during interface (Phase 1) and encode it in the pure predicate
   > so it is unit-tested.
6. **Skeleton = data-region only (resolved OQ).** Reuse `DefaultViewSkeleton` (the board/list skeleton)
   gated by `activeTab?.autoRefreshing || activeTab?.loadingDefault || navLoading` at `JiraPanel.tsx:431`.
   The panel chrome (tab strip, JQL search row, footer, composer) stays mounted OUTSIDE that gate — they
   already render above/around the content `<div>` — so the skeleton covers ONLY the data area (FR-009,
   resolved as data-region-only). The exact visual treatment (whether `DefaultViewSkeleton` is reused
   as-is or gets a kanban-column variant) is the design step's call.
7. **Floor + warm/instant re-fetch (FR-010).** Start `beginNavLoad()` (existing 350ms floor) when the
   auto-refresh fires, so an instant warm re-fetch still shows the skeleton for a perceptible minimum —
   reusing Jira's existing in-place-nav timing model, no new timing primitive.
8. **Failure (edge: failed refresh).** A failed auto-refresh resolves through the existing refresh error
   handling — `autoRefreshing` is cleared by the same render/land path that already clears
   `loadingDefault` on a Notice/error frame, so the skeleton never hangs; it resolves to the surface's
   existing failure presentation (no new error contract).
9. **Late land after the user leaves again (edge).** A late `updateDataModel` for a now-sibling surface
   is already ignored by the `surfaceId`-matched apply (`:153-157`); the `autoRefreshing` flag is per-tab,
   so it does not paint the wrong tab.

## File-overlap with concurrent `slack-generative-message-parity-v1` (sequencing note)

> The Slack-parity plan is NOT yet authored; this section lists the precise surface so the orchestrator
> can sequence implementation and avoid merge conflicts.

- **This feature touches (exhaustive):**
  - CREATE `src/renderer/activeTabSurfaceRefresh.ts` + `src/renderer/activeTabSurfaceRefresh.test.ts`
    (pure predicate `shouldAutoRefreshOnActivation` / `autoRefreshValues`). NEW files — no overlap.
  - MODIFY `src/renderer/ActiveTabSurface.tsx` — only the restore-refresh effect block (`:121-141`):
    confirm/keep it firing for `restored:true` only, so the parent-driven re-activation path does not
    double-fire. No edits to the apply effect (`:148-160`), the mount/seed effect (`:87-111`), or
    `handleAction`.
  - MODIFY `src/renderer/JiraPanel.tsx` — add the parent-driven auto-refresh effect (keyed on
    `activeTabId`), the `autoRefreshing` skeleton flag wiring at the `:431` gate, and the `beginNavLoad`
    call on fire. Jira-only.
  - MODIFY `src/renderer/useGenerativePanelTabs.ts` — add the optional `autoRefreshing?: boolean` field
    to `GenerativeTab` (Jira-only flag, like `loadingDefault`; never set by Slack/Confluence/Generated).
- **Slack-parity is expected to touch:** `slackCatalog/logic.ts` (`showEmptyState` gating),
  `slackCatalog/components.tsx` (`MessageList`/`SearchResultList`), `SlackPanel.tsx`, `slackAdapter.ts`,
  and possibly `ipc.ts`/`render_slack_ui` schema. **It does NOT touch `JiraPanel.tsx` or
  `activeTabSurfaceRefresh.ts`.**
- **The one true shared-file risk is `useGenerativePanelTabs.ts` and `ActiveTabSurface.tsx`:**
  - `useGenerativePanelTabs.ts`: this plan adds ONE optional field to the `GenerativeTab` interface.
    Slack-parity's FR-020 says reply/expand state is renderer-LOCAL (not on the tab record), so it should
    NOT add competing `GenerativeTab` fields — but flag this for the orchestrator to confirm before
    parallelizing. If both must edit this file, sequence them (this feature's one-field add is trivial to
    land first or rebase).
  - `ActiveTabSurface.tsx`: this feature edits ONLY the restore-refresh effect; Slack-parity's empty-vs-
    skeleton work lives in the Slack CATALOG (`slackCatalog/*`), not in `ActiveTabSurface`, so overlap is
    unlikely. If Slack-parity does end up touching `ActiveTabSurface` (e.g. a shared loading-state seam),
    sequence the two — they edit disjoint effect blocks, so a non-overlapping merge is feasible but should
    be confirmed.
- **Recommended sequencing:** land this feature's trivial `GenerativeTab.autoRefreshing` field +
  `JiraPanel` wiring first (small, Jira-scoped), then Slack-parity rebases. Both can otherwise proceed in
  parallel since their primary files are disjoint.

## Design step (follows this plan)

This is a UI-bearing feature → a **design** step (designer, `design` skill) follows this plan, before
interface/test/implement. Its scope: the **data-region loading-skeleton visual treatment** for the
bound surface — specifically whether `DefaultViewSkeleton` is reused as-is for a kanban/list or gets a
column-aware variant, its density/animation, and confirmation that it covers ONLY the data region
(panel chrome stays visible, per resolved OQ FR-009). No new theme tokens are expected; this should
extend the existing skeleton family.

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 1 — Interface

- [x] Re-read the spec; confirm both Open Questions are resolved (FR-015 = Jira-only wiring of a
      target-agnostic mechanism; FR-009 = data-region-only skeleton) — no open questions remain.
- [x] Create `src/renderer/activeTabSurfaceRefresh.ts` with pure, React-free, target-agnostic helpers:
  - [x] `shouldAutoRefreshOnActivation(input)` — true iff the activated tab has a surface, it is not in
        error, it is BOUND (`bindings` or `descriptor`), and this is a RE-activation. **Deviation: keyed
        on a boolean `hasPaintedBefore` (parent owns a Set of seen requestIds), not a single
        `alreadyPaintedRequestId` slot** — a single slot breaks multi-tab (A→B→A would no longer see A as
        already-painted). Set membership is the correct semantics (FR-001/FR-004/FR-005/FR-011/FR-012).
        Keys on bound-ness, never on `target`.
  - [x] `autoRefreshValues(surface)` — returns `{ surfaceId, bindings }` (multi-region) or
        `{ surfaceId, descriptor }` (single-region), or `null` when non-bound (mirrors the existing
        `ActiveTabSurface.tsx:128-132` selection, extracted for reuse + test). Also returns null for an
        errored / empty-surfaceId surface (safe fallback).
  - [x] No token/secret in any value (it carries only the already-secret-free `descriptor`/`bindings`) — FR-013.
- [x] Add `autoRefreshing?: boolean` to `GenerativeTab` in `useGenerativePanelTabs.ts`, documented as the
      per-tab auto-refresh skeleton flag (Jira-only, like `loadingDefault`; never set by other panels) — FR-011.
- [x] Confirm the `ActiveTabSurface` restore-refresh effect stays gated on `restored:true` only (it
      returns early on `!surface.restored` at `:123`), so the new parent-driven re-activation path does not
      double-fire with it (FR-012). No new effect added to the child — UNCHANGED.
- [x] Review types vs spec — no invented properties; nothing crosses an IPC boundary; no new typed IPC.

### Phase 2 — Testing (`activeTabSurfaceRefresh.test.ts`, vitest node env)

- [x] BOUND multi-region surface re-activated (already painted once) → `shouldAutoRefreshOnActivation`
      true; `autoRefreshValues` returns `{ surfaceId, bindings }` (SC-001/SC-002).
- [x] BOUND single-region descriptor surface re-activated → true; `autoRefreshValues` returns
      `{ surfaceId, descriptor }`.
- [x] NON-bound (no `bindings`/`descriptor`) surface re-activated → false; `autoRefreshValues` null
      (SC-004 / FR-005). Also: empty-bindings-array → false.
- [x] FIRST live paint of a bound surface (`hasPaintedBefore:false`) → false (no double-fire on fresh
      compose, FR-012/SC-005).
- [x] No surface / surface in error / malformed (missing requestId) → false (FR-006).
- [x] Returned values carry no secret/token field; exactly the two expected keys (FR-013).
- [x] 14 tests pass; verified they FAIL when the first-paint guard is broken (regression-proof).

### Phase 3 — Implementation

- [x] In `JiraPanel.tsx`, add the parent-driven effect keyed on `[activeTabId, activeSurface?.requestId]`:
      when `shouldAutoRefreshOnActivation` is true for the now-active tab, set that tab `autoRefreshing:true`
      (via `update`), call `window.cosmos.ui.sendAction` with `autoRefreshValues(...)` as an
      `adapter.refresh` submit, record the surface's `requestId` in `paintedRequestIdsRef` (a Set), and call
      `beginNavLoad()` for the floor (FR-001/FR-002/FR-003/FR-004/FR-010).
- [x] Widen the content skeleton gate to `activeTab?.loadingDefault || navLoading ||
      activeTab?.autoRefreshing`; panel chrome (strip/search/footer/composer) stays mounted outside the gate
      (FR-007/FR-009). Added `KanbanBoardSkeleton` (multi-region `bindings`) vs `DefaultViewSkeleton` (list/
      detail) variant selection per design §Variant B; both share a new `SkeletonCard` unit.
- [x] Clear `autoRefreshing` on land. **Deviation: the auto-refresh repaints via an in-place
      `updateDataModel` push (not a fresh `ui:render` frame), so the render-subscription clear does NOT
      run for it.** Instead a second `JiraPanel` effect clears `autoRefreshing:false` when the `navLoading`
      floor ends (the floor governs the min show time; the in-place repaint lands beneath the skeleton). The
      render subscription ALSO clears `autoRefreshing:false` on a surface/error frame (added beside the
      `loadingDefault:false` clear) for the compose/default-read path + as a belt-and-suspenders. Skeleton
      never hangs on a failed refresh (FR-008).
- [x] Confirmed the `onDataModel` apply (`ActiveTabSurface.tsx:148-160`) repaints in place — no view
      re-compose, no agent round-trip (FR-003); unchanged.
- [x] No double-fire by construction: a plain switch-back never sets `restored`, so the child effect
      (gated on `restored:true`) does not fire for it; detail→Back / snapshot-restore set `restored` and
      fire via the child once; a fresh compose has `hasPaintedBefore:false` so the parent skips it. **GUI
      smoke (SC-001/SC-002/SC-003/SC-005) left to the user — renderer behavior not auto-verifiable here.**
- [x] All new + existing tests pass (`npm test` → 70 files / 1300 tests); typecheck clean (`npm run
      typecheck`, node + web). Reused shared helpers — no duplicated dispatch logic.

### Phase 4 — Docs & wrap-up

- [ ] `TODO.md`: check off / add the tab-switch auto-refresh item (handled by `wrap-up`).
- [x] Updated this plan's Deviations with the `hasPaintedBefore`-set keying + the floor-based
      `autoRefreshing` clear (in-place push, not render frame).
- [ ] `docs/ARCHITECTURE.md`: NOT edited by this plan (concurrent edits in flight). If the
      generalized "bound-surface-remount auto-refresh" becomes a system-wide pattern (Slack/Confluence
      adopt it later), the architect updates the doc THEN, in a separate pass.
- [x] `memory_save`d the keying + clear-path decisions for the future Slack/Confluence adoption.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-18**: Plan authored. Open design decision flagged for interface step: parent-driven trigger
  (in `JiraPanel`, surviving the keyed `ActiveTabSurface` remount) vs. child-driven (inside
  `ActiveTabSurface`). Plan recommends parent-driven because the keyed `<A2UIProvider key={activeTab.id}>`
  remounts the child on every switch, so a "was this surface already painted once?" seen-set must live
  ABOVE the remount boundary — only the parent (or the tab record) survives. Implementation should confirm
  and, if it deviates, ensure the no-double-fire contract (FR-012) and the one-shot-per-reactivation
  contract (FR-004) still hold.
- **2026-06-18 (implementation)**: Built parent-driven as recommended. Two deviations from the plan's
  literal shape, both confirmed to preserve FR-004/FR-011/FR-012:
  1. **Seen-set, not a single slot.** The pure predicate takes `hasPaintedBefore: boolean`; `JiraPanel`
     owns `paintedRequestIdsRef: Set<string>`. A single `alreadyPaintedRequestId` slot (the plan's
     §5 wording) breaks the A→B→A case (re-activating A after visiting B would forget A was painted), so
     set membership is the correct semantics for multi-tab (FR-011). First activation records + skips;
     a switch-back re-presents the same requestId → fires once.
  2. **`autoRefreshing` cleared by the nav floor, not (only) the render subscription.** The auto-refresh
     repaints via an in-place `updateDataModel` push — there is NO new `ui:render` frame on an
     auto-refresh land, so the render-subscription clear the plan assumed does not run for it. A second
     `JiraPanel` effect clears `autoRefreshing:false` when the `navLoading` 350ms floor ends (reusing the
     existing floor timing model, FR-010); the render subscription ALSO clears it on a surface/error frame
     for the compose/default path. Net: the skeleton shows for ≥ the floor and never hangs on a failed
     refresh (FR-008). No new IPC, no main change — still renderer-only.
  - Skeleton variant: added `KanbanBoardSkeleton` (multi-region `bindings`) beside the reused
    `DefaultViewSkeleton` (single-region list/detail), both sharing a new `SkeletonCard` unit, per design
    §Variant B. Data-region-only — chrome stays mounted outside the `:431`-area gate.
  - GUI behavior (SC-001/SC-002/SC-003/SC-005) left to the user for manual smoke — the renderer
    tab-switch/skeleton flow is not auto-verifiable from the node test env.
