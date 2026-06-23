# Plan: Focus-Aware Ctrl+W in the Terminal Panel — v1

**Status**: Draft
**Created**: 2026-06-23
**Last updated**: 2026-06-23
**Spec**: .sdd/specs/terminal-focus-aware-close-tab-v1.md

---

## Grounding

> Same investigation as the spec's Grounding section (see it for the full query list + takeaways).
> Key load-bearing findings driving this plan:
> - `tab:close` already arrives in the renderer via `useTabShortcuts` (the single per-panel
>   `onTrigger` consumer, gated by `active`), mapping `tab:close → onCloseTab(activeTabId)`.
>   **No new IPC, no main change.**
> - The focus + open-file state lives PER `TerminalView` (per pane), but `useTabShortcuts` lives
>   one level up in `TerminalPanel`, which only knows the active `paneId`. So the **active pane's**
>   `{ viewerFocused, openFileCount }` must be lifted up to the panel to feed the routing.
> - The pure next-active rule already exists: `useFileExplorer.closeFile` → `openFiles.ts`
>   `closeFile`/`adjacentActiveId`. Reuse it verbatim (FR-003/FR-011) — do NOT re-derive adjacency.
> - The `FileViewer` root is one `outline-none` container wrapping both the tab strip and the body,
>   so a single `focus-within` boolean cleanly means "viewer focused".

## Summary

Make the Terminal panel's `tab:close` shortcut focus-aware: when the **active pane's** file
viewer holds focus and has ≥1 open file, close the viewer's active open-file tab; otherwise keep
closing the active terminal panel tab. The decision is a pure predicate (`resolveCloseTarget`) in
a node-tested `.ts`. Focus is tracked as a `focus-within` boolean on the `FileViewer` container
inside each `TerminalView`; the **active** pane lifts its `{ viewerFocused, openFileCount }` plus a
`closeActiveFile()` callback up to `TerminalPanel`, where `useTabShortcuts` already runs — so the
panel chooses the route at command time. No new IPC; no main-process change; the other rail
panels are untouched.

## Technical Context

| Item              | Value                                                                                                  |
|-------------------|--------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (renderer, React 19)                                                                         |
| Key dependencies  | Existing `useTabShortcuts`, `useFileExplorer`/`useExplorerPanes`, `openFiles.ts` (`closeFile`/`adjacentActiveId`) — all reused; no new deps |
| Files to create   | `src/renderer/closeTabRouting.ts` (pure predicate), `src/renderer/closeTabRouting.test.ts`             |
| Files to modify   | `src/renderer/fileExplorer/FileViewer.tsx`, `src/renderer/fileExplorer/FileExplorer.tsx` (`useExplorerPanes`), `src/renderer/TerminalPanel.tsx`, `src/renderer/useTabShortcuts.ts` |

### Approach / data flow

1. **Pure predicate** `resolveCloseTarget({ viewerFocused, openFileCount }): 'file-tab' | 'panel-tab'`
   — returns `'file-tab'` iff `viewerFocused && openFileCount > 0`, else `'panel-tab'`
   (encodes FR-002/FR-004/FR-005, OQ-2 default). Node-testable, no DOM (FR-008).

2. **Viewer focus tracking** (in `FileViewer.tsx`): add an `onViewerFocusChange?: (focused: boolean)
   => void` prop. Attach `onFocus`/`onBlur` (which bubble as focusin/focusout) to the existing root
   container so it reports `true` when focus enters the viewer subtree and `false` when it leaves —
   a `focus-within` boolean (OQ-1). The container ALSO must be focusable enough to receive the
   placeholder case: the empty-state placeholder branch should report focus too IF the user can
   focus it; the simplest correct contract is to track focus-within on the OUTER element that both
   branches share. (Implementation note: the two return branches currently differ; either hoist a
   single focus-tracking wrapper around both, or attach the same handlers to each branch's root.)

3. **Lift active-pane state** (in `useExplorerPanes` + `TerminalView`): surface the open-file count
   and a `closeActiveFile()` from the explorer hook (it already has `openFiles`, `activeRelPath`,
   `closeFile`). `useExplorerPanes` returns them alongside `{ viewer, tree }`; `TerminalView`
   forwards, for the **active** pane only, `{ viewerFocused, openFileCount, closeActiveFile }` up via
   a new `onViewerStateChange?(paneId, state)` callback (or a ref the panel reads). Only the active
   pane's report matters (FR-012); an inactive pane reports nothing or is ignored by the panel.

4. **Route in the panel** (in `TerminalPanel.tsx` + `useTabShortcuts.ts`): `TerminalPanel` holds the
   active pane's `{ viewerFocused, openFileCount, closeActiveFile }` (state/ref keyed by active
   `paneId`). Extend `useTabShortcuts`'s `TabShortcutOps` with an OPTIONAL
   `resolveClose?: () => 'file-tab' | 'panel-tab'` and `onCloseFileTab?: () => void`. In the
   `tab:close` case: if `resolveClose?.() === 'file-tab'` and `onCloseFileTab` is wired, call it;
   else fall back to the existing `onCloseTab(activeTabId)`. The `active` rail gate is unchanged, so
   non-Terminal panels (which don't pass `resolveClose`) keep today's behavior (FR-010).

### Why this shape

- Keeping the decision in `TerminalPanel`/`useTabShortcuts` (where the command already lands) avoids
  a second `onTrigger` subscription and keeps ALL tab routing in one place.
- Lifting only the **active** pane's small state avoids subscribing the panel to every pane's
  explorer; the panel already tracks `activeTabId`, so it just keys the report by active `paneId`.
- Reusing `closeFile`/`adjacentActiveId` means Ctrl+W and the `X`/Delete close are literally the
  same op → identical next-active + identical persisted-open-files reporting (FR-011).

---

## Implementation Checklist

### Phase 1 — Interface

- [ ] Read the spec; confirm OQ-1/OQ-2/OQ-3 are resolved (defaults accepted) before coding.
- [ ] Create `src/renderer/closeTabRouting.ts` exporting `resolveCloseTarget(input: { viewerFocused:
      boolean; openFileCount: number }): 'file-tab' | 'panel-tab'`.
- [ ] Extend `TabShortcutOps` in `useTabShortcuts.ts` with optional `resolveClose?: () =>
      'file-tab' | 'panel-tab'` and `onCloseFileTab?: () => void` (documented; other panels omit them).
- [ ] Add `onViewerFocusChange?: (focused: boolean) => void` to `FileViewer`'s props.
- [ ] Extend `useExplorerPanes`'s return with `openFileCount` + `closeActiveFile` (derived from the
      existing `openFiles`/`activeRelPath`/`closeFile`); add an `onViewerStateChange` plumbing path
      from `TerminalView` → `TerminalPanel`.
- [ ] Review the new types against the spec — no invented properties (no persistence, no new IPC).

### Phase 2 — Testing

- [ ] `src/renderer/closeTabRouting.test.ts`: viewer-focused + count>0 → `'file-tab'`;
      viewer-focused + count===0 → `'panel-tab'` (OQ-2); not-focused + count>0 → `'panel-tab'`;
      not-focused + count===0 → `'panel-tab'`. (Pure, no DOM.)
- [ ] (If practical without a DOM harness) a small unit around the `useTabShortcuts` `tab:close`
      branch asserting it calls `onCloseFileTab` vs `onCloseTab` per `resolveClose()` — only if it
      can be exercised purely; otherwise cover via the predicate test + manual QA notes.

### Phase 3 — Implementation

- [ ] `FileViewer.tsx`: wire `onFocus`/`onBlur` (focus-within) on the shared root so it reports
      viewer focus for BOTH the populated and the "Select a file" placeholder branches.
- [ ] `FileExplorer.tsx` (`useExplorerPanes`): compute `openFileCount = openFiles.length` and a
      stable `closeActiveFile = () => activeRelPath && closeFile(activeRelPath)`; pass
      `onViewerFocusChange` into `FileViewer`; expose the lifted state to `TerminalView`.
- [ ] `TerminalView`: for the ACTIVE pane only, report `{ viewerFocused, openFileCount,
      closeActiveFile }` up to `TerminalPanel` (callback or ref keyed by `paneId`); inactive panes
      do not influence routing (FR-012).
- [ ] `TerminalPanel.tsx`: hold the active pane's reported state; pass `resolveClose` (calls
      `resolveCloseTarget`) and `onCloseFileTab` (calls the active pane's `closeActiveFile`) into the
      existing `useTabShortcuts({ … })` call.
- [ ] `useTabShortcuts.ts`: in `case 'tab:close'`, branch on `resolveClose?.()` → `onCloseFileTab`
      vs `onCloseTab(activeTabId)`; preserve the `active` gate and all other commands unchanged.
- [ ] Verify: file-viewer focus + open files → Ctrl/Cmd+W closes the active file tab; terminal
      focus → closes the panel tab; closing the last file returns the "Select a file" placeholder.
- [ ] `npm run typecheck` + `npm test` pass; no new channel in `src/shared/ipc.ts`.

### Phase 4 — Docs

- [ ] Update `docs/DEVELOPMENT.md` shortcut/terminal-file-explorer sections with the focus-aware
      routing note (where the decision lives + the lifted active-pane state contract).
- [ ] `docs/ARCHITECTURE.md`: only if the shortcut-routing model materially changes. **Recommended:
      a one-line addition** under the Terminal panel (§4.2) noting that `tab:close` is focus-aware in
      the Terminal panel (viewer-focused → close the active open-file tab), since this is a small but
      real refinement of the established "map the command onto the active surface's tab ops" model.
      Architect to apply this edit at wrap-up.
- [ ] Mark items in `TODO.md` / update this plan's Deviations with anything that differed.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-23**: Initial plan authored. Open questions OQ-1 (focus via focus-within tracking lifted
  to the active pane), OQ-2 (empty viewer → fall through to panel tab), OQ-3 (tree focus → panel
  tab) carry recommended defaults; implementation assumes these unless the user overrides.
