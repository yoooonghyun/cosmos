# cosmos-tree-rename-not-working-v1

**Status:** fixed (renderer-only) — manual `npm run dev` confirmation recommended (real-browser timing).
**Area:** `src/renderer/cosmos/PanelTabTree.tsx` (Home panel-tab tree row Rename).
**Feature shipped against:** cosmos-tree-tab-rename-delete-v1 (TREE-TAB-EDIT-01).
**Classification:** jsdom-green / runtime-broken focus-timing defect. Renderer-only, no IPC/contract/protocol change.

## Symptom

Right-clicking a Home panel-tab tree row → **Rename** appears to do nothing: the inline editor
flashes open and immediately closes, so the user can never type a new label. The jsdom tests were
GREEN throughout (false confidence).

## Root cause (confirmed)

The row's right-click menu is a Radix `ContextMenu`. Choosing **Rename** runs
`onRename: () => setTimeout(() => beginEdit(rowKey, tab.label), 0)` — deferred one tick to let the
menu close. `beginEdit` sets `editingKey`, the `TabRow` swaps its label `<span>` for an `<input>`,
and a focus-once effect (`editInputRef`) auto-focuses + selects it. The input's
`onBlur={() => onCommit()}` commits on **any** blur.

When the Radix menu closes, its `DismissableLayer`/`FocusScope` RESTORES focus to the menu trigger
(the row button) by default — `onCloseAutoFocus`. That focus-restore runs on a LATER tick than the
`setTimeout(0)` defer, so it lands AFTER the input has mounted + auto-focused → it BLURS the input →
`onBlur` → `commitEdit` → `renameCommitDecision(draft)` (draft equals the current label, so it
"commits" the same label, a visual no-op) → `setEditingKey(null)` → the editor closes before any
keystroke. Hence "Rename does nothing / flashes and closes". The `setTimeout(0)` defer is
insufficient because the close-auto-focus runs after the deferred mount, not before it.

### Why the jsdom tests stayed green

The original `PanelTabTreeTabEdit.dom.test.tsx` Rename tests query the input via `findByRole`'s
polling IMMEDIATELY after the menuitem click. jsdom lets the deferred input-mount win the macrotask
race, and the polling finds the input before (or instead of) observing the close→blur→commit, so
the test never reproduces the real-browser ordering.

## Commit route (traced end-to-end — INTACT, no fix needed there)

Once the editor stays open, the typed-Enter commit routes correctly:

`TabRow` input Enter → `onCommit` → `commitEdit(group, tab)` →
`renameCommitDecision(draft)` (gates empty/whitespace → revert) →
`onRenameTab(group, tab, label)` → `CosmosPanel.handleRenameTab` →
`tabCommands[group.panelId]?.onRename(tab.id, label)` (`useAllTabCommands()` registry) →
the source panel's published command. For the four generative panels
(`useGenerativePanelTabs`): `onRename: (id, label) => update(id, { label, renamed: true })` (the
`renamed:true` flag makes `shouldApplyAutoLabel` skip the generative auto-relabel). Terminal
publishes the same way. So the label updates the source tab in BOTH the tree and the source panel's
strip. The only break was the editor closing before the user could type — not the route.

## Fix (source-of-truth, Radix-idiomatic, minimal)

In `renderRowMenu`, set `onCloseAutoFocus={(e) => e.preventDefault()}` on the `ContextMenuContent`.
Closing the menu then does NOT yank focus back to the trigger, so the freshly-mounted inline input
keeps focus and the user can type. The component already owns roving focus itself (`refocusKeyRef`
+ the after-edit `setActiveKey` effect), so Radix's auto-focus-restore is redundant; the
Pin/Unpin/Delete paths open no input, so the no-op restore there is harmless (the roving row stays
in the tree).

The `setTimeout(0)` defer is KEPT as belt-and-suspenders: it lets the closing menu's `FocusScope`
fully unmount before the input mounts + auto-focuses, so the two never race. The F2 keyboard path
has no menu-close and enters edit synchronously (no defer needed there). The input `onBlur` is left
UNCHANGED (no first-blur suppression band-aid) — the focus-steal is fixed at the source.

## Regression test (TREE-TAB-EDIT-01)

`src/renderer/cosmos/PanelTabTree.dom.test.tsx` (new `describe`):
- **Deterministic wiring guard (load-bearing):** `renderRowMenu(...).props.onCloseAutoFocus` is a
  function that calls `preventDefault` — RED when the prop is absent, GREEN with the fix. (Exported
  `renderRowMenu` for this assertion.)
- **Behavioral guards:** open the editor from the menu, add an explicit `await setTimeout(0)`
  macrotask flush after the menuitem click (which deterministically reproduces the close→commit in
  jsdom — verified RED without the fix: the input is gone), then assert a typed Enter routes a
  TRIMMED label to `onRename` end-to-end, and a blank/whitespace commit reverts (no `onRename`).

Verified RED→GREEN by toggling the `onCloseAutoFocus` prop off (3 failures) and back on (all pass).
`TEST-SCENARIOS.md` TREE-TAB-EDIT-01 updated with the focus-steal root cause + guard + manual note.

## Manual verification (recommended — real-browser timing)

`npm run dev` → Home → right-click a tree tab row → **Rename** → the inline input STAYS open +
focused → type a new label + Enter → the tab relabels in BOTH the tree row AND the source panel's
tab strip; **Esc** or a blank/whitespace commit reverts to the source label; Pin/Unpin/Delete still
work.

## Verification

`npm run typecheck` ✓ · `npm test` (2746) ✓ · `npm run test:dom` (166) ✓ · `npm run build` ✓.
