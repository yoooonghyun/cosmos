# Plan: Panel-switch keyboard shortcut (Cmd+Opt+Up/Down) — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/panel-switch-shortcut-v1.md
**Issue**: #90

---

## Grounding

See the spec's Grounding section for the full list of codegraph_explore / memory queries run.
Load-bearing findings for this plan:

- The keyboard-shortcut subsystem is **matched-in-main**: Electron `before-input-event` →
  `matchShortcut(input, platform)` (`src/main/shortcutMatch.ts`, pure + node-tested) →
  `ShortcutTriggerPayload` forwarded over the `shortcut:trigger` channel → `window.cosmos.shortcuts.onTrigger`.
- `surface:next` / `surface:prev` **already exist** as `ShortcutCommand`s and are already handled
  by `AppShell` in `src/renderer/App.tsx` (the `surfaces.onTrigger` effect that wraps around
  `RAIL_ITEMS` with functional `setSurface`). Active-panel state = that `useState<SurfaceId>`.
- Today those commands are bound to `mod+Shift+BracketRight/Left`. Tab cycling is `mod+Alt+ArrowRight/Left`.
- Therefore this feature is **additive in exactly one pure function**: add `mod+Alt+ArrowDown → surface:next`
  and `mod+Alt+ArrowUp → surface:prev` to `matchShortcut`. The command, IPC channel, preload, and
  renderer handler are all already in place and need NO change.

## Summary

Add two arms to the pure `matchShortcut` matcher so Cmd+Opt+Down resolves to the existing
`surface:next` command and Cmd+Opt+Up resolves to `surface:prev`. Because surface switching is
already a matched-in-main command with a live renderer handler (`AppShell`), no IPC, preload,
renderer, or scope change is needed — the entire behavioral change is a four-line addition to one
node-testable function plus new cases in its existing test. Wrap-around, the xterm-focus
robustness, and the active-panel indicator all come for free from the existing path. The existing
Cmd+Shift+]/[ binding is left intact (additive alias).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main; pure node-side matcher) |
| Key dependencies  | None new. Reuses `ShortcutCommand` (`src/shared/ipc/shortcut.ts`), the `before-input-event` wiring in `src/main/index.ts`, and the existing `AppShell` `surface:*` handler in `src/renderer/App.tsx`. |
| Files to create   | None |
| Files to modify   | `src/main/shortcutMatch.ts` (2 new match arms + doc comment); `src/main/shortcutMatch.test.ts` (4 new cases); `docs/ARCHITECTURE.md` (record the shortcut map / note the new alias). |

### Exact change in `src/main/shortcutMatch.ts`

The existing `mod+Alt+Arrow` block currently handles only Left/Right (tab cycle). Extend it (or
add a sibling arm in the same `input.alt && !input.shift` branch) so the same `mod+Alt` modifier
set maps the vertical arrows to surface switching:

- `input.code === 'ArrowDown'` → `payload('surface:next')`
- `input.code === 'ArrowUp'`   → `payload('surface:prev')`

Keep this inside the existing `if (input.alt && !input.shift) { … }` guard (no Shift), AFTER the
`mod` short-circuit (`if (!mod) return null`), and keyed on physical `input.code` for layout
independence (FR-006). This sits alongside the existing `ArrowRight → tab:next` / `ArrowLeft →
tab:prev` lines, so horizontal arrows stay tabs and vertical arrows become surfaces — symmetric and
non-colliding (FR-007). Update the function's doc-comment key map (lines ~50-58) to list
`mod+Alt+Down → surface:next` and `mod+Alt+Up → surface:prev` next to the existing
`mod+Shift+]/[` aliases.

### Active-panel index read + set (no change — reused)

`AppShell` (`src/renderer/App.tsx`) already owns the read+set: on `surface:next`/`surface:prev`
it computes `i = RAIL_ITEMS.findIndex(it => it.id === prev)` and sets
`RAIL_ITEMS[(i + delta + len) % len].id` via functional `setSurface`. The new keystrokes resolve
to the SAME two commands, so this handler is exercised verbatim — no renderer edit.

### Guard approach

No renderer-side typing/focus guard is added or needed (FR-004). The matcher lives in main and is
applied via `before-input-event`, which fires before the renderer/DOM (and before xterm) sees the
keystroke, and the resolved command is `preventDefault`'d there. This is exactly how the existing
tab + bracket-surface shortcuts already dodge xterm capture and text-input insertion; mirroring it
is the whole point of reusing the path. The combo carries Cmd(mac)/Ctrl, so it is never a printable
character a text input would consume.

## Design step needed?

**No.** This is purely keyboard navigation onto an existing surface state with an existing,
clearly-visible active indicator (the rail's `--secondary` filled pill + 3px `--primary` left bar,
driven by `surface` state — ARCHITECTURE.md §3 / SC-005). There is already adequate visual feedback
for which panel is active, so no `design` skill / designer pass is warranted. (If, during
implementation, the active indicator were found missing — it is not — a tiny design touch would be
flagged; it is not.)

## IPC / scope check

Confirmed renderer-local + main-pure only: no new `ShortcutCommand`, no new channel, no preload
method (so **no `npm run dev` restart caveat applies** — this does not add a `window.cosmos.*`
method), no main integration or OAuth scope touched. The diff is the pure matcher + its test +
docs. This satisfies SC-004.

---

## Implementation Checklist

### Phase 1 — Interface

- [x] Re-read the spec; confirm no open questions remain (Down=next / Up=prev decided).
- [x] Confirm `ShortcutCommand` already includes `surface:next` / `surface:prev` (it does — `src/shared/ipc/shortcut.ts`); confirm NO new command or IPC field is required.
- [x] Confirm `AppShell`'s `surface:*` handler is untouched and already wraps `RAIL_ITEMS`.

### Phase 2 — Testing

- [x] In `src/main/shortcutMatch.test.ts`, add: darwin `meta+alt+ArrowDown` → `{ command: 'surface:next' }`.
- [x] Add: darwin `meta+alt+ArrowUp` → `{ command: 'surface:prev' }`.
- [x] Add: other-platform `control+alt+ArrowDown` → `surface:next`, `control+alt+ArrowUp` → `surface:prev`.
- [x] Add a regression assertion that `mod+Alt+ArrowLeft/Right` still map to `tab:prev`/`tab:next` and `mod+Shift+Bracket*` still map to `surface:*` (FR-007/FR-009) — verify they were not perturbed.
- [x] Add a negative case: `meta+alt+shift+ArrowDown` (with Shift) does NOT resolve to `surface:next` (the arm requires `!input.shift`). Also added bare `mod+Down`/`mod+Up` (no Alt) negative case.
- [x] Confirmed the new behavioral cases FAIL before the fix (only the 2 new arms; regression/negative cases passed).

### Phase 3 — Implementation

- [x] Add the two `ArrowDown`/`ArrowUp` arms inside the existing `input.alt && !input.shift` block in `matchShortcut`, returning `payload('surface:next')` / `payload('surface:prev')`.
- [x] Update the `matchShortcut` doc-comment key map to list the two new aliases beside the bracket ones.
- [x] `npm run typecheck` clean; `npm test` (vitest `shortcutMatch.test.ts`) green.
- [ ] Manual smoke (`npm run dev`): Cmd+Opt+Down/Up cycles the rail with wrap-around; works with the terminal focused; Cmd+Shift+]/[ still works; Cmd+Opt+Left/Right still cycles tabs. (Deferred to manual GUI verification — tracked in TODO.md.)

### Phase 4 — Docs

- [x] Update `docs/ARCHITECTURE.md`: recorded the authoritative global keyboard-shortcut key map in a new §4.12 (matched-in-main `before-input-event` → `shortcutMatch` → `surface:*`/`tab:*`), explicitly noting Cmd+Opt+Up/Down as a panel-switch alias of Cmd+Shift+[/].
- [x] Added a #90 manual-verification entry in `TODO.md` (no pre-existing #90 checklist item to tick).
- [x] Record any deviation below.

---

## Deviations & Notes

- **2026-06-20**: Plan authored. Key realization: panel switching already exists as
  `surface:next`/`surface:prev` (Cmd+Shift+]/[) with a live `AppShell` handler — issue #90 is NOT a
  new feature mechanism, only a second key binding. Scope reduced to two arms in the pure matcher +
  test. Up=prev / Down=next chosen to match the rail's vertical orientation and the existing
  Right=next / Left=previous tab convention; existing bracket binding kept as an additive alias.
- **2026-06-20 (implementation, developer)**: Implemented exactly as planned — two arms added to the
  `input.alt && !input.shift` block in `src/main/shortcutMatch.ts` (`ArrowDown → surface:next`,
  `ArrowUp → surface:prev`) plus the doc-comment key-map update. Tests written FIRST and confirmed to
  fail (only the 2 new behavioral cases) before the fix, then green after. `npm run typecheck` clean;
  full `npm test` green. **Doc deviation (within plan's intent):** the shortcut subsystem had NO
  authoritative section in `docs/ARCHITECTURE.md` (only an oblique mention), so rather than a one-line
  note I added a full **§4.12 "Global keyboard shortcuts (matched in main)"** with the authoritative
  key-map table — broader than "one line" but the plan explicitly called for an authoritative map and
  there was no existing section to append to. **TODO deviation:** there was no pre-existing #90 line to
  tick, so I ADDED a #90 manual-GUI-verification entry under "Next" instead. No code outside the matcher
  changed (no IPC/preload/renderer) — SC-004 holds.
