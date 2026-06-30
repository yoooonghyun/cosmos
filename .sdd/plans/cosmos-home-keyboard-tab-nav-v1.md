# Plan: Home keyboard tab navigation — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-home-keyboard-tab-nav-v1.md`

---

## Grounding

> Direct investigation by the architect (codegraph + reads). The LLM-wiki tool (`wiki_query`) was
> **not available** in this environment ("No such tool"); grounding used codegraph + direct reads.

**codegraph_explore queries run (one-line takeaways):**

- `useTabShortcuts TabShortcutOps onTrigger tab:next tab:prev tab:jump tab:new tab:close active focus-aware composer guard cycleActiveId panelTabs cycle`
  → `useTabShortcuts(ops: TabShortcutOps)` (`src/renderer/tabs/useTabShortcuts.ts`) already takes a PLAIN
  ops object — `{ active, tabs: {id}[], activeTabId, onActivate, onNewTab, onCloseTab, +optional resolvers }`
  — NOT the `useGenerativePanelTabs` controller. It binds the `shortcuts.onTrigger` listener once, reads
  ops through a ref, gates EVERY command on `active`, and computes next/prev with `(from+delta+len)%len`
  wrap, jump with an `index < tabs.length` guard, and last as `tabs[len-1]` — i.e. the same order/wrap math
  as the pure `cycleActiveId` (`src/renderer/tabs/panelTabs.ts`).
- `CosmosPanel cosmosTabs setActiveCosmosTab appendFavorite closeCosmosTab PanelTabStrip useGenerativePanelTabs`
  → `CosmosPanel({ active })` already holds `tabsState` (`{tabs, activeTabId}` from `cosmosTabs.ts`) and
  already wires `onActivate={(id) => setTabsState((s) => setActiveCosmosTab(s, id))}` into its
  `PanelTabStrip`. `cosmosTabs` tabs are `{id, label, kind, source?}` → already satisfy `{id: string}[]`.
  `closeCosmosTab` hands an unpinned active favorite back to the default tab. **`CosmosPanel` does NOT call
  `useTabShortcuts`** (confirmed) — that is the entire gap.
- App.tsx / railVisibility → exactly one rail surface is `active` at a time; `'cosmos'` is labelled "Home".

**Direct reads:** `useTabShortcuts.ts` (full), `cosmosTabs.ts` (full), `CosmosPanel.tsx` (strip wiring),
`panelTabs.ts` `cycleActiveId`, ARCHITECTURE §4.12.

---

## Summary

Wire `CosmosPanel` into the EXISTING shared per-panel consumer `useTabShortcuts`, gated on Home's
`active` prop, so the Home panel reacts to `tab:next` / `tab:prev` / `tab:jump` / `tab:last` exactly like
every other rail panel — moving the active Home tab over `cosmosTabs` order (default first, then favorites
in pin order, wrap-around) via the panel's existing `setActiveCosmosTab` handler. This is **renderer-only**:
the shortcut is already matched + `preventDefault`'d in main and delivered over `shortcut:trigger`, so no
main / IPC / preload / new-keychord work is needed, and a focused composer/textarea cannot emit a stray
character (main consumes the keystroke before the DOM sees it). The cycle/wrap/jump math is reused from the
hook (which already mirrors the pure `cycleActiveId`) — **no parallel helper is authored**. The only hook
touch is a tiny, backward-compatible generalization: make `onNewTab` / `onCloseTab` OPTIONAL so Home can
omit them and get the v1 no-op semantics for `tab:new` (Q5) and `tab:close` (Q4) structurally.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (renderer, React 19) |
| Key dependencies  | `useTabShortcuts` (`src/renderer/tabs/useTabShortcuts.ts`), `cosmosTabs.ts` (`setActiveCosmosTab`/`closeCosmosTab`), `cycleActiveId` (`src/renderer/tabs/panelTabs.ts`), `window.cosmos.shortcuts.onTrigger` (already wired) |
| Files to create   | `src/renderer/cosmos/CosmosKeyboardTabNav.dom.test.tsx` (jsdom) |
| Files to modify   | `src/renderer/cosmos/CosmosPanel.tsx` (call `useTabShortcuts`); `src/renderer/tabs/useTabShortcuts.ts` (make `onNewTab`/`onCloseTab` optional); `src/renderer/cosmos/cosmosTabs.test.ts` (node-unit coverage for cycle-over-order + unpin reconcile — create if absent); `docs/ARCHITECTURE.md` §4.12 (one-line reconciliation — Phase 4 only) |

### Chosen approach (decided concretely)

**Reuse `useTabShortcuts` as-is for the navigation logic — no new pure nav helper.** The hook already
contains the single implementation of next/prev wrap + jump-guard + last, equivalent to `cycleActiveId`.
`CosmosPanel` calls it with the plain ops derived from its own `tabsState`:

```
useTabShortcuts({
  active,                                   // Home's active rail-surface prop (FR-005/FR-006)
  tabs: tabsState.tabs,                     // {id,label,kind,source?} ⊇ {id:string}[] (FR-002 order)
  activeTabId: tabsState.activeTabId,
  onActivate: (id) => setTabsState((s) => setActiveCosmosTab(s, id))  // FR-001/FR-007
  // onNewTab / onCloseTab OMITTED → no-op for tab:new (Q5/FR-013) and tab:close (Q4)
})
```

This satisfies FR-001..FR-006 + FR-014 with the *same* order/wrap logic the rest of the app uses, by
construction — there is no parallel cosmosTabs nav helper to drift. Adding `cosmosTabNav` helpers was
considered and **rejected**: it would duplicate the hook's inline logic (the exact "parallel logic" the
spec/coordinator want to avoid).

**Minimal hook generalization (confirmed shape question):** `TabShortcutOps` currently requires
`onNewTab` and `onCloseTab`. For Home both are v1 no-ops. Make them OPTIONAL (`onNewTab?`, `onCloseTab?`)
and guard the two call sites (`onNewTab?.()`, and the close branch already gates on `activeTabId` — also
guard `onCloseTab?.(activeTabId)`). This is backward-compatible: the four generative panels + terminal
keep passing their callbacks unchanged, so their behavior is untouched. Home omits both → `tab:new` /
`tab:close` are intrinsic no-ops (self-documenting, no magic empty closures). The optional
`resolveClose`/`onCloseFileTab`/`resolveNav`/`onNavFileTab` terminal-only props stay as-is; Home omits them.

> Fallback if the reviewer prefers zero hook change: pass explicit no-op closures for
> `onNewTab`/`onCloseTab` from `CosmosPanel`. Functionally identical; the optional-props route is preferred
> only for clarity. Either keeps the change minimal.

---

## Implementation Checklist

> Update as work progresses. Add inline notes on any deviation.

### Phase 0 — Sequencing gate (HARD)

- [x] **Do NOT start until `cosmos-home-favorite-tabs-v1` has landed.** A developer is CONCURRENTLY
  refining Home favorites in `CosmosPanel.tsx` + `cosmosTabs.ts` (favorite ordering, unpin reconciliation).
  Both features edit the same two files; this work must build on the FINAL favorites shape to avoid a merge
  conflict and stale assumptions. Confirm that feature is merged, then re-read `CosmosPanel.tsx` +
  `cosmosTabs.ts` before touching them.

### Phase 1 — Interface (hook generalization)

- [x] Re-read the spec; confirm all 5 OQs are resolved (Q1 same keychord, Q2 global + keep roving, Q3
  include jump/last, Q4 mod+W no-op, Q5 mod+T no-op).
- [x] In `src/renderer/tabs/useTabShortcuts.ts`: change `onNewTab` and `onCloseTab` in `TabShortcutOps` to
  OPTIONAL; guard their invocations (`onNewTab?.()`; in the `tab:close` branch, `onCloseTab?.(activeTabId)`).
  Update the hook's doc comment to note panels MAY omit them (→ no-op). No other behavior change.
- [x] Confirm existing callers (generative panels via their wiring + terminal) still type-check — they all
  pass `onNewTab`/`onCloseTab`, so they are unaffected (`npm run typecheck` clean).

### Phase 2 — Testing

- [x] **node-unit** `src/renderer/cosmos/cosmosTabs.test.ts` (create if absent): assert the pure pieces the
  Home cycle relies on — (a) `cycleActiveId` over `cosmosTabs` order: single-tab (default only) `tab:next`
  is a no-op (returns same id), forward/back wrap across `[default, favA, favB]`; (b) `closeCosmosTab`
  reconciles an unpinned ACTIVE favorite back to `DEFAULT_TAB_ID` (FR-010 unpin-while-active). Reuse the
  existing `cycleActiveId` — do NOT author a new helper.
- [x] **jsdom** `src/renderer/cosmos/CosmosKeyboardTabNav.dom.test.tsx` (new): render `CosmosPanel` with a
  stubbed `window.cosmos.shortcuts.onTrigger` (capture the callback). With `active={true}` and ≥2 tabs:
  - `tab:next` / `tab:prev` move the active Home tab with wrap (FR-001/FR-003).
  - `tab:jump` {index} activates that tab; out-of-range index is a no-op (FR-014/jump guard).
  - `tab:last` activates the final tab (FR-014).
  - `tab:new` and `tab:close` cause NO membership change and NO active-tab error (Q4/Q5/FR-013).
  - With `active={false}`, NONE of the commands change the Home active tab (FR-005).
  - Note in a comment: composer-focus "no stray character" (FR-008) is guaranteed by main-side
    `preventDefault` (§4.12) and is therefore NOT re-tested in jsdom (the renderer never receives the
    keystroke as input) — assert only the cycle effect.

### Phase 3 — Implementation

- [x] In `src/renderer/cosmos/CosmosPanel.tsx`: call `useTabShortcuts({ active, tabs: tabsState.tabs,
  activeTabId: tabsState.activeTabId, onActivate: (id) => setTabsState((s) => setActiveCosmosTab(s, id)) })`.
  Reuse the SAME `setActiveCosmosTab` handler already used by the `PanelTabStrip` `onActivate` (no second
  source of truth). Place the hook call near the other Home hooks; import from `../tabs/useTabShortcuts`.
- [x] Verify the existing roving-tabindex strip nav on the Home `PanelTabStrip` (plain Arrow/Enter/Space/
  Delete/F2) is untouched — the global gesture is purely additive (FR-012). (PanelTabStrip keymap unchanged.)
- [x] All tests pass (`npm test` 2710/2710, `npm run test:dom` 104/104); `npm run typecheck` clean.
- [x] Confirm no duplicated cycle/jump logic was introduced (the hook + `cycleActiveId` remain the single
  source — FR reuse). (CosmosPanel passes ops only; node-unit reuses `cycleActiveId` directly.)

### Phase 4 — Docs

- [ ] **`docs/ARCHITECTURE.md` §4.12** (architect-owned): add a one-line reconciliation that the Home
  (`cosmos`) panel is now also a `tab:next`/`tab:prev`/`tab:jump`/`tab:last` participant via `useTabShortcuts`
  (it currently lists only the generative panels + terminal), and that `tab:new`/`tab:close` are no-ops in
  Home for v1. **Flag now, edit during wrap-up — NOT in this planning step.**
- [ ] Update this plan with any deviations.

---

## Edge cases → coverage map (traceability)

| Spec edge case | Covered by |
|----------------|-----------|
| Single tab (default only) → no-op (FR-009) | node-unit (`cycleActiveId` single-tab) + jsdom |
| Wrap-around (FR-003) | node-unit (`cycleActiveId`) + jsdom |
| Jump out-of-range no-op (FR-014) | jsdom (hook `index < tabs.length` guard) |
| Unpin-while-active reconcile (FR-010) | node-unit (`closeCosmosTab` → default) |
| Gated on active surface (FR-005) | jsdom (`active={false}` → no change) |
| Composer focus, no stray char (FR-008) | architectural (main `preventDefault`, §4.12) — noted, not jsdom-testable |
| mod+W / mod+T no-op (Q4/Q5, FR-013) | jsdom (no membership change) + omitted ops |
| No collision w/ surface:* or other panels' tab:* (FR-011) | unchanged `active` gate + App.tsx owns surface:* — existing tests stay green |

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-30**: Plan authored. Decided to REUSE `useTabShortcuts` (no new nav helper) and make
  `onNewTab`/`onCloseTab` optional as the minimal, backward-compatible generalization. Gated behind
  `cosmos-home-favorite-tabs-v1` (Phase 0). §4.12 update flagged for wrap-up, not edited.
- **2026-06-30 (impl, developer)**: Implemented Steps 3-5 exactly as planned (no design divergence).
  `TabShortcutOps.onNewTab?/onCloseTab?` optionalized + `onNewTab?.()` / `onCloseTab?.(activeTabId)`
  guarded; `CosmosPanel` calls `useTabShortcuts` with the omitted-ops shape. **Deviation (test harness
  only):** wiring `CosmosPanel` to the `window.cosmos.shortcuts` preload surface meant every EXISTING
  jsdom test that mounts the real `CosmosPanel` needed `shortcuts: { onTrigger: () => () => {} }` added to
  its `window.cosmos` stub (it subscribes on mount) — 5 sibling tests updated additively
  (`CosmosCrossPanelLiveContext`, `CosmosHistoricalContext`, `CosmosLiveBubble`, `CosmosPanelTabList`,
  `CosmosStreamingProgress`) plus `CosmosFavoriteTabs`. No production behavior change; same pattern as the
  existing `conversation`/`agent`/`ui`/`session` stub keys. **Bundled Task B (coordinator):** default
  Cosmos tab now carries `icon: SURFACE_ICON.cosmos`; `PanelTabStrip` reserves the `icon-xs`/`size-6`
  close-slot via an inert trailing spacer when `closeable === false`. DESIGN.md D-19 additive note added.
  All suites green (node 2710, dom 104, typecheck clean).
