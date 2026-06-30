# Plan: Cosmos tree tab Rename + Delete — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: .sdd/specs/cosmos-tree-tab-rename-delete-v1.md

---

## Grounding

> Investigated directly with codegraph; the OMC wiki tool (`wiki_query`) is NOT available in this
> session, so prior decisions came from `ARCHITECTURE.md` §4.11/§4.14 + `DESIGN.md` D-15/D-19 and the
> verbatim source codegraph returned.

**codegraph_explore queries run (takeaways):**
- `TabRow / PanelTabTree menu trigger / renderRowMenu` — `TabRow` renders `<span>{label}</span>`; a `menu` prop nests `ContextMenuTrigger asChild` onto the row div. `renderRowMenu({panelId,pinned,onPin,onUnpin})` emits only the Pin/Unpin item. `menuEnabled = Boolean(onPin && onUnpin)`. The tree owns roving focus + an `onKeyDown` keymap on the `role="tree"` container.
- `PanelTabStrip onRename ... renameCommitDecision` — the strip's inline-rename idiom is fully reusable: lifted `editingTabId`+`draft`, `beginEdit/commitEdit/cancelEdit`, focus-select-once effect, cancel-on-vanish effect, refocus-after-edit effect; commit routes through the PURE `renameCommitDecision(draft)` (empty/whitespace ⇒ `{commit:false}`).
- `PanelTabsProvider usePublishPanelTabs useAllPanelTabs` — the forward read seam: a ref-backed registry + `version` counter, `publish(panelId, tabs|null)` (cleared on unmount), `useAllPanelTabs()` re-reads on version bump. The reverse command channel mirrors this exactly.
- `useGenerativePanelTabs / TerminalPanel usePanelTabs update close` — both expose stable `update`/`close` useCallbacks; `update(id,{label,renamed:true})` is the existing rename path (generative AND terminal — `TerminalTab.renamed` exists); `close(id)` is the existing close path. The 4 generative panels share ONE `useGenerativePanelTabs`; Terminal is its own site.
- `CosmosPanel onPin onUnpin isPinned useAllPanelTabs` — `CosmosPanel` already reads the registry and passes `onPin`/`onUnpin`/`isPinned` into the tree; favorites kept on gone source via `reconcileFavorites` (FR-031).

---

## Summary

Add a renderer-only **reverse command channel** to `PanelTabsProvider` (sibling to the existing
forward read seam) so the Cosmos Home tree can drive Rename + Delete on a source tab in its OWN panel.
The four generative panels (via the shared `useGenerativePanelTabs`) and the Terminal panel each
publish `{ onRename(id,label), onClose(id) }` bound to their existing `update`/`close`. The tree's row
`ContextMenu` gains **Rename** (enters an inline editor on the row, reusing the strip's
`renameCommitDecision` + borderless-input idiom) and **Delete** (immediate close). No IPC, no new
persistence, no secret crosses the channel; Rename and Delete reuse each panel's existing tab ops, so
last-tab and gone-source-favorite (FR-031) semantics fall out unchanged.

## Technical Context

| Item              | Value                                                                                  |
|-------------------|----------------------------------------------------------------------------------------|
| Language          | TypeScript (React renderer only)                                                       |
| Key dependencies  | existing `radix-ui` `ContextMenu` (D-19), existing pure `renameCommitDecision`, `PanelTabsProvider` |
| Files to create   | `src/renderer/cosmos/PanelTabTreeTabEdit.dom.test.tsx`; `src/renderer/panelTabs/tabCommands.dom.test.tsx` (provider round-trip) |
| Files to modify   | `src/renderer/panelTabs/panelTabs.ts`, `src/renderer/panelTabs/PanelTabsProvider.tsx`, `src/renderer/cosmos/PanelTabTree.tsx`, `src/renderer/cosmos/CosmosPanel.tsx`, `src/renderer/tabs/useGenerativePanelTabs.ts`, `src/renderer/terminal/TerminalPanel.tsx`, `docs/TEST-SCENARIOS.md`, `docs/ARCHITECTURE.md` §4.14/§4.11, `docs/DESIGN.md` D-19/D-15 |

---

## Technical approach

### 1. Reverse command channel — `PanelTabsProvider` (renderer-only, non-secret)

In `panelTabs.ts` (the shared data-contract module), add the command shapes alongside the existing
`LivePanelTab`/`PanelTabsRegistry`:

```ts
/** A panel's tree-invokable tab commands (renderer-only function refs — NEVER IPC/persisted). */
export interface TabCommands {
  /** Rename a tab: set its label + the `renamed` flag (so generative auto-relabel won't clobber). */
  onRename: (tabId: string, label: string) => void
  /** Close a tab in its own panel (the same path as the strip `X`). */
  onClose: (tabId: string) => void
}
export type TabCommandsRegistry = Partial<Record<CrossPanelId, TabCommands | null>>
```

In `PanelTabsProvider.tsx`, add a SECOND ref-backed registry + version counter inside the SAME
provider (a `commandsRef` + reuse one `version`, or a parallel counter — implementer's call), exactly
mirroring the forward `publish`:

- `publishTabCommands(panelId: CrossPanelId, commands: TabCommands | null)` — sets/clears the entry,
  bumps the version.
- `usePublishTabCommands(panelId: CrossPanelId | null, commands: TabCommands | null)` — publisher
  hook mirroring `usePublishPanelTabs`: publishes on mount / when the memoized `commands` change,
  clears on unmount; a `null` panelId (the `'generated-ui'` cosmos wire target) publishes nothing.
- `useAllTabCommands(): TabCommandsRegistry` — consumer hook mirroring `useAllPanelTabs` (re-reads on
  version bump).

> **Naming deviation from the brief** (`useTabCommands(panelId)` → `useAllTabCommands()`): the consumer
> (CosmosPanel) must look commands up across the VARIABLE-length `order` list, so a per-panel
> `useTabCommands(panelId)` cannot be called in a loop (rules of hooks) — it reads the whole registry
> at once, identical to `useAllPanelTabs`. The PUBLISHER stays per-panel (`usePublishTabCommands`).
> Flagged for confirmation (§ Confirm before dev).

Security: the channel carries only function refs invoked with a non-secret `tabId` + trimmed `label`;
it is in-renderer (no IPC, no serialization), never persisted — the same standard as the forward
seam's `serialize` ref. No token/path/credential can cross it.

### 2. Publish sites (2 total — the 5 panels)

- **`useGenerativePanelTabs.ts`** (covers Slack/Jira/Confluence/Calendar at ONE site, beside the
  existing `usePublishPanelTabs`):

  ```ts
  const tabCommands = useMemo<TabCommands | null>(
    () => panelTabsPanelId === null ? null : {
      onRename: (id, label) => update(id, { label, renamed: true }),
      onClose: (id) => close(id)
    },
    [panelTabsPanelId, update, close]   // update/close are stable useCallbacks ⇒ publishes once
  )
  usePublishTabCommands(panelTabsPanelId, tabCommands)
  ```

  `renamed: true` satisfies FR-004 (the panel's `shouldApplyAutoLabel` then skips the auto-relabel,
  tab-rename-v1 FR-008).

- **`TerminalPanel.tsx`** publishes the same shape against its own `usePanelTabs` `update`/`close`
  (`onRename: (id,label)=>update(id,{label,renamed:true})`, `onClose: (id)=>close(id)`); panelId
  `'terminal'`. Terminal's own last-tab "keep ≥1 / re-open default" logic is unchanged — Delete just
  calls `close`, and the panel re-picks per its existing semantics (FR-005, spec P2).

### 3. The tree — inline editor + Rename/Delete menu items (`PanelTabTree.tsx`)

**Lift edit state into `PanelTabTree`** (mirror the strip): `editingKey: string | null` (the row key
`tabKey(panelId,tabId)`) + `draft: string`, with `beginEdit(key,label)`, `commitEdit(key)`,
`cancelEdit(key)`. Reuse the three strip effects: focus-select-once on entering edit (delegated to
`TabRow`), cancel-on-vanish (the edited row no longer in `rows`), refocus-the-row after edit ends
(set the roving `activeKey` back to the row). At most ONE editor at a time (FR-007).

**Commit pipeline (reuse the pure decision):**

```ts
const commitEdit = (group, tab) => {
  const decision = renameCommitDecision(draft)       // pure, already node-tested
  if (decision.commit && decision.label !== undefined) onRenameTab(group, tab, decision.label)
  // refocus + clear editing; empty/whitespace ⇒ no call (FR-006)
}
```

**Widen `renderRowMenu`** to `{ panelId, pinned, onPin, onUnpin, onRename, onDelete, canEdit }`:
emit Pin/Unpin (unchanged), then — when `canEdit` — a `ContextMenuSeparator`, a **Rename** item
(`onSelect={onRename}` → `beginEdit`) and a **Delete** item (`onSelect={onDelete}` → `onDeleteTab`).
Both are label-only, dense `text-caption` items (D-19); Delete is `variant="default"` (benign /
reopenable — close == unpin precedent, no confirm, NOT `destructive`).

**`menuEnabled`** widens: the menu renders when pin handlers OR edit handlers are wired. In practice a
tree row only exists when its panel published its tab list (forward seam), and the SAME hook also
publishes commands (co-mounted), so a visible row always has commands — `canEdit(panelId)` (computed
in CosmosPanel from the command registry, mirroring `isPinned`) guards the Rename/Delete items so a
panel that somehow lacks commands shows only Pin/Unpin (FR-011).

**`TabRow`** gains edit props (`editing`, `draft`, `onDraftChange`, `onCommit`, `onCancel`): when
`editing`, replace the label `<span>` with a borderless input reusing the strip's classes/idiom
(`field-sizing:content`, focus+select once via a local effect keyed on `editing`, `stopPropagation`
on click/keydown so the row's activate/keymap never fires, Enter→commit, Escape→cancel, blur→commit).
Non-editing rows are byte-unchanged.

**Keyboard parity (SHOULD):** add `F2` on a focused TAB row in the tree's `onKeyDown` → `beginEdit`,
matching the strip's F2 (the menu is the primary path; F2 is parity). Flagged for confirmation.

### 4. CosmosPanel wiring (mirror onPin/onUnpin)

Read the command registry once (`const tabCommands = useAllTabCommands()`), then pass into the tree:

```ts
const canEditTab = useCallback((panelId) => Boolean(tabCommands[panelId]), [tabCommands])
const handleRenameTab = useCallback((group, tab, label) =>
  tabCommands[group.panelId]?.onRename(tab.id, label), [tabCommands])   // safe no-op if absent (FR-011)
const handleDeleteTab = useCallback((group, tab) =>
  tabCommands[group.panelId]?.onClose(tab.id), [tabCommands])
```

Delete routes to the source panel's `close`, so a deleted-but-PINNED source falls through the EXISTING
`reconcileFavorites` path (FR-009/FR-031: the favorite stays as a gone-source entry) — NO new favorites
logic. Selection reconciliation (a renamed/closed selected tab) is the existing
`reconcileSelectedContext` driven by the forward groups re-read — NO new reconcile logic (FR-010).

### 5. Pure-logic note (the `.ts`/`.test.ts` split)

NO new pure module is required. The only non-trivial decision — trim/empty→cancel — is the EXISTING
pure `renameCommitDecision` (reused, already node-tested). The command registry is a mechanical
ref-map publish/subscribe with no reducer (exactly like the forward seam, which has no separate pure
module). The publish/subscribe wiring is asserted in jsdom (it is hook/render behavior, invisible to
node-unit).

---

## Implementation Checklist

### Phase 1 — Interface

- [x] Read spec; confirm all 6 OQs resolved (they are) + the Confirm-before-dev items below.
- [x] `panelTabs.ts`: add `TabCommands` + `TabCommandsRegistry` (renderer-only function-ref contract; doc-comment the non-secret/never-IPC/never-persisted rule).
- [x] `PanelTabsProvider.tsx`: add `publishTabCommands` + `usePublishTabCommands(panelId, commands)` + `useAllTabCommands()` (ref+version sibling to the forward seam; clear on unmount; null panelId publishes nothing). Barrel re-exports the two hooks + the two types.
- [x] Review types vs spec — no invented fields; nothing serialized.

### Phase 2 — Testing (write before/with impl)

- [x] Read `docs/TEST-SCENARIOS.md`; scan for tree / panel-tab / favorites tensions before adding.
- [x] jsdom (`tabCommands.dom.test.tsx`): a publisher mounts → `useAllTabCommands()` exposes its `{onRename,onClose}`; unmount clears the entry; a `null` panelId publishes nothing.
- [x] jsdom (`PanelTabTreeTabEdit.dom.test.tsx`):
  - row `ContextMenu` shows **Pin/Unpin + separator + Rename + Delete** (Delete `data-variant=default`).
  - **Rename** → row enters inline edit; type + Enter calls the `onRenameTab` spy with the **trimmed** label; an empty/whitespace commit → spy NOT called (reverts); Escape → spy NOT called (reverts).
  - **Delete** → calls the `onDeleteTab` spy with the right group/tab (immediate, no confirm).
  - a **terminal** row shows both Rename + Delete; **F2** on a focused row begins rename.
  - a tab that **vanishes mid-rename** (re-render without it) → edit ends, no throw, no spy call.
  - a panel without commands (`canEditTab`→false) shows only Pin/Unpin (FR-011 degrade).
- [x] Pinned-source Delete: covered by the existing `reconcileFavorites` gone-source flow (CosmosFavoriteTabs.dom — unchanged + still green). The tree Delete routes through the SAME `close`, so no NEW favorites assertion was required (FR-009/FR-031 fall out).
- [x] Confirm NO node-integration test is needed (renderer-only; no IPC/protocol touched) — stated in the TREE-TAB-EDIT-01 test doc row.

### Phase 3 — Implementation

- [x] `useGenerativePanelTabs.ts`: memoize + `usePublishTabCommands(panelTabsPanelId, {onRename→update(...,{renamed:true}), onClose→close})`.
- [x] `TerminalPanel.tsx`: publish the same command shape against its `usePanelTabs`.
- [x] `PanelTabTree.tsx`: lift edit state + 3 strip-parity effects; widen `renderRowMenu` (Rename/Delete after Pin/Unpin, separator, Delete `variant="default"`); `TabRow` inline-input branch; F2; reuse `renameCommitDecision`. (Menu Rename defers `beginEdit` one tick — see Deviations.)
- [x] `CosmosPanel.tsx`: `useAllTabCommands()` + `canEditTab`/`handleRenameTab`/`handleDeleteTab`; pass into the tree.
- [x] All tests + `npm run typecheck` + `npm run build` green; reused `renameCommitDecision` + existing close/reconcile paths (no duplicated logic).

### Phase 4 — Docs

- [x] `docs/TEST-SCENARIOS.md`: add `TREE-TAB-EDIT-01` (tree row Rename routes to source `update({renamed})` with trimmed label, empty→no-op; Delete routes to source `close`; terminal row has both; pinned-source Delete leaves the favorite gone-source) — jsdom layer.
- [x] `docs/ARCHITECTURE.md` §4.14: noted the renderer-only **reverse command channel** on `PanelTabsProvider`; §4.11: noted tab rename/close are now ALSO invokable cross-panel from the tree (the panel ops themselves unchanged).
- [x] `docs/DESIGN.md` D-19: the tree row menu now carries Rename + Delete (label-only dense items; Delete `variant="default"`); D-15: a survey-tree row supports an in-row inline edit reusing the strip idiom.
- [x] Update this plan's Deviations with anything that differed.

---

## Design step call

**LIGHT — no separate design spec / designer-agent pass needed.** The surface reuses two
already-canonized idioms: the shared Radix `ContextMenu` (D-19) for the two new label-only items, and
the `PanelTabStrip` inline-rename idiom (D-15) for the in-row editor. The only net-new visual choices
(menu item order: Pin/Unpin → separator → Rename → Delete; Delete `variant="default"`) are small and
codified inline above. The developer adds the light D-19/D-15 notes during Phase 4; no `.sdd/designs/`
doc is warranted. (If the user prefers a designer pass for the menu grouping/separator, it is a quick
add — see Confirm below.)

## Confirm before dev (non-blocking)

- **Consumer hook name** `useAllTabCommands()` (vs the brief's `useTabCommands(panelId)`) — needed
  because the tree consumer reads ALL panels over a variable `order` (rules of hooks). OK to proceed?
- **F2-in-tree** rename parity on a focused tab row — include (recommended, matches the strip) or drop
  to keep scope to the menu only?
- **Menu grouping** — a `ContextMenuSeparator` between the Pin/Unpin toggle and the Rename/Delete pair
  (recommended for the dense menu). Confirm, or keep one flat list of 3 items.

## Deviations & Notes

- 2026-06-30: Plan authored. No code written.
- 2026-06-30: Implemented (interface + tests + impl + docs). All three Confirm-before-dev items taken
  as recommended: consumer hook is `useAllTabCommands()`; **F2-in-tree** included; a `ContextMenuSeparator`
  groups Pin/Unpin from Rename/Delete.
- **DEVIATION (menu Rename focus race):** opening the inline editor straight from the Radix
  `ContextMenuItem` `onSelect` lost the input immediately — Radix restores focus to the row trigger on
  menu close, which BLURRED the freshly-focused editor input → premature `onBlur` commit (the F2 path is
  unaffected, it has no menu-close). FIX: the menu's Rename `onSelect` defers `beginEdit` one tick
  (`setTimeout(…,0)`) so the focus-restoration settles BEFORE the editor mounts. Documented inline in
  `PanelTabTree.tsx` + DESIGN.md D-15. No spec/contract change.
- **NOTE (TabRow focus guard):** the row's existing `if (focused) ref.focus()` effect was guarded with
  `&& !editing` so it never steals focus from the inline input.
- **NOTE (menuEnabled widened):** `menuEnabled = Boolean((onPin && onUnpin) || (onRenameTab && onDeleteTab))`
  and `renderRowMenu` guards Pin/Unpin behind `pinnable` and Rename/Delete behind `canEdit`, so a panel
  wired for only one of the two still renders a coherent menu (FR-011 degrade path).
- **NO new favorites/last-tab code:** Delete routes to the source `close`; the pinned-source gone-source
  favorite (FR-009/FR-031) + terminal keep-≥1 + generative reach-zero semantics all fall out of the
  EXISTING `reconcileFavorites`/panel logic. Verified by the unchanged, still-green CosmosFavoriteTabs +
  PanelTabsProvider suites.
- Suites green: `npm run typecheck` (node+web), `npm test` (145 files / 2743), `npm run test:dom`
  (31 files / 163), `npm run build`.
