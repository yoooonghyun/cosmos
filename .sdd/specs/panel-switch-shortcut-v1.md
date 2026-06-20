# Spec: Panel-switch keyboard shortcut (Cmd+Opt+Up/Down) — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/panel-switch-shortcut-v1.md
**Issue**: #90

---

## Grounding

Investigated directly with codegraph + agentmemory before writing.

**codegraph_explore queries run:**

- `useTabShortcuts useGenerativePanelTabs PanelTabStrip sessionRegistry tab switch keyboard shortcut Cmd Option Left Right` → tab commands are matched in MAIN and delivered to the renderer via `window.cosmos.shortcuts.onTrigger`; `useTabShortcuts` only maps `tab:*` onto the active rail surface's tab ops, with wrap-around `(from + delta + len) % len`. `surface:*` is explicitly NOT handled there.
- `ShortcutCommand surface:next surface:prev shortcuts onTrigger ... App.tsx left rail surface switching activeSurface` → `App.tsx` `AppShell` already owns left-rail surface switching: it subscribes to `shortcuts.onTrigger`, handles `surface:next`/`surface:prev`, and wraps around `RAIL_ITEMS` with functional `setSurface`. The active surface lives in `useState<SurfaceId>('terminal')`.
- `shortcutMatch before-input-event matchShortcut Cmd+Shift+] surface:next BracketRight BracketLeft ArrowUp ArrowDown` → `src/main/shortcutMatch.ts` `matchShortcut(input, platform)` is a PURE, node-tested matcher keyed on physical `input.code`. Today `surface:next`/`prev` = `mod+Shift+BracketRight`/`BracketLeft`; tab cycle = `mod+Alt+ArrowRight`/`ArrowLeft`. Covered by `src/main/shortcutMatch.test.ts`.
- `ShortcutCommand shortcutMatch accelerator menu ...` → the command vocabulary `ShortcutCommand` lives in `src/shared/ipc/shortcut.ts` (re-exported via the `src/shared/ipc.ts` barrel); doc comment enumerates the key map. Shortcuts are matched in main via `before-input-event` so they fire regardless of DOM focus (incl. an xterm-focused terminal) and are `preventDefault`'d before the renderer sees them.

**memory_recall / memory_smart_search queries run:**

- `keyboard shortcut tab switch panel navigation Cmd Option active panel` → no results.
- `panel surface left rail switching keyboard shortcut accelerator main process` → no results.

(No prior decisions persisted; this spec establishes the baseline.)

---

## Overview

The app already switches between the **tabs inside a panel** with Cmd+Opt+Left/Right, and
already switches between **panels** (the left icon-rail surfaces — Terminal, Generated UI,
Slack, Jira, Confluence) with Cmd+Shift+]/[. This feature adds a **second, more discoverable
shortcut to switch panels** — **Cmd+Opt+Down → next panel, Cmd+Opt+Up → previous panel** — so
panel navigation feels symmetric with the existing Left/Right tab navigation (one mental model:
Opt+Arrows move you around, horizontal = tabs, vertical = panels). The existing Cmd+Shift+]/[
remains valid (additive, not a replacement).

## Terminology (grounded in the code, not assumed)

- **Panel** = one of the five **left icon-rail surfaces** in `App.tsx` `RAIL_ITEMS`, in this
  exact order: `terminal`, `generated-ui`, `slack`, `jira`, `confluence`. Exactly one is the
  active surface at a time. Active-panel state = `AppShell`'s `useState<SurfaceId>('terminal')`,
  switched today by `surface:next`/`surface:prev` (Cmd+Shift+]/[). This is what Up/Down moves
  between.
- **Tab** = a VS Code-style tab WITHIN a panel (§4.11). Tab navigation = Cmd+Opt+Left/Right
  (`tab:next`/`tab:prev`), handled per-panel by `useTabShortcuts`. Out of scope for this feature.

## User Scenarios

### Switch to the next panel · P1

**As a** cosmos user
**I want to** press Cmd+Opt+Down to move to the next panel down the icon rail
**So that** I can change surfaces without reaching for the mouse or the less-obvious bracket combo

**Acceptance criteria:**

- Given the active panel is Terminal (top of the rail), when I press Cmd+Opt+Down, then Generated UI (the next rail item) becomes the active panel.
- Given the active panel is Confluence (bottom of the rail), when I press Cmd+Opt+Down, then it wraps to Terminal (the first rail item).
- Given a panel is switched, then that panel's live state (Terminal PTY, pending surfaces, tab set) is preserved exactly as it is for the existing rail switch — switching only toggles visibility.

### Switch to the previous panel · P1

**As a** cosmos user
**I want to** press Cmd+Opt+Up to move to the previous panel up the icon rail
**So that** panel navigation is symmetric with the Cmd+Opt+Down forward direction

**Acceptance criteria:**

- Given the active panel is Generated UI, when I press Cmd+Opt+Up, then Terminal (the previous rail item) becomes the active panel.
- Given the active panel is Terminal (top of the rail), when I press Cmd+Opt+Up, then it wraps to Confluence (the last rail item).

### Works while the terminal (xterm) is focused · P1

**As a** cosmos user with the embedded Claude Code terminal focused
**I want** Cmd+Opt+Up/Down to still switch panels (not be swallowed by xterm)
**So that** the shortcut behaves like every other cosmos global shortcut

**Acceptance criteria:**

- Given keyboard focus is inside the xterm terminal, when I press Cmd+Opt+Down, then the panel switches (the keystroke is matched in main before the renderer/terminal sees it, identical to the existing tab + surface shortcuts).
- Given keyboard focus is in any normal text input, when I press Cmd+Opt+Up/Down, then the panel switches without inserting a character or moving the caret (the combo carries Cmd, so it is not destructive typing — same posture as Cmd+Opt+Left/Right today).

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | Cmd+Opt+Down (mac) / Ctrl+Alt+Down (other) MUST resolve to the existing `surface:next` command — activate the next left-rail panel. |
| FR-002 | Cmd+Opt+Up (mac) / Ctrl+Alt+Up (other) MUST resolve to the existing `surface:prev` command — activate the previous left-rail panel. |
| FR-003 | Panel selection MUST wrap around the rail in both directions, matching the existing `surface:next`/`surface:prev` (and the tab `tab:next`/`tab:prev`) wrap behavior — next from the last panel goes to the first; previous from the first goes to the last. |
| FR-004 | The new combos MUST be matched in MAIN via the same `before-input-event` → `matchShortcut` path as every other cosmos shortcut, so they fire regardless of DOM focus (including an xterm-focused terminal) and are `preventDefault`'d before the renderer/window sees them. No new global key mechanism. |
| FR-005 | The new combos MUST reuse the existing `surface:next`/`surface:prev` `ShortcutCommand`s and the existing `AppShell` `surfaces.onTrigger` handler — no new IPC command, no new renderer subscription, no change to the active-panel state location. |
| FR-006 | Matching MUST key on the physical `input.code` (`ArrowUp`/`ArrowDown`), layout-independent, consistent with the existing matcher. |
| FR-007 | The new combos MUST NOT collide with or alter any existing shortcut: `mod+Alt+ArrowLeft/Right` (tab cycle) and `mod+Shift+Bracket` (existing surface switch) MUST keep their exact current behavior. |
| FR-008 | When only one panel exists or none is active, the command MUST be a no-op / harmless — the existing wrap math already degenerates safely (with the fixed 5-panel `RAIL_ITEMS` this is not reachable today, but the behavior MUST remain a no-op rather than an error). |
| FR-009 | The existing Cmd+Shift+]/[ surface switch MUST remain valid and unchanged (the new shortcut is additive, not a replacement). |
| FR-010 | The newly added match arms MUST be covered by `shortcutMatch.test.ts` (the matcher is the single tested unit; the renderer handler is unchanged and already exercised by the existing surface switch). |

## Edge Cases & Constraints

- **Focus in the xterm terminal.** Handled by FR-004 — matching is in main via `before-input-event`, so the terminal never swallows the combo. No renderer-side focus guard is needed or added (mirrors the existing tab/surface shortcuts, which have no DOM-level typing guard precisely because main intercepts first).
- **Focus in a text input / the prompt composer.** The combo carries Cmd(mac)/Ctrl, so it is not a plain printable keystroke; main intercepts and `preventDefault`s it before the input sees it, identical to Cmd+Opt+Left/Right today. No special-casing.
- **A modal / settings dialog open.** Out of scope to change behavior. Whatever the existing `surface:next`/`prev` (Cmd+Shift+]/[) does with a dialog open, Cmd+Opt+Up/Down does identically, because they resolve to the same command and handler. No divergence introduced.
- **Single panel / empty rail.** Not reachable with the fixed 5-item `RAIL_ITEMS`, but FR-008 keeps it a safe no-op via the existing wrap math.
- **Out of scope:** any change to tab navigation, the per-panel tab strips, the active-panel state location, IPC contracts/scopes, main process integrations, or visual design beyond confirming the existing active-panel indicator suffices (it does — see SC-005).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | On macOS, Cmd+Opt+Down advances the active rail panel one step (wrapping), and Cmd+Opt+Up retreats one step (wrapping), matching the direction/feel of Cmd+Opt+Right/Left tab navigation. |
| SC-002 | The shortcut fires while the embedded terminal is focused (panel switches; no stray characters reach the terminal). |
| SC-003 | All pre-existing shortcuts (tab new/close/cycle/jump/last, the bracket surface switch) behave exactly as before — `shortcutMatch.test.ts` stays green and gains passing cases for the four new arms (Up/Down × darwin/other). |
| SC-004 | No IPC contract, preload method, main integration, or scope is added or changed — the diff is confined to the pure matcher (and its test) plus a doc/comment update. |
| SC-005 | The user can always see which panel is active after switching — the existing rail indicator (the `--secondary` filled pill + 3px `--primary` left bar, driven by `surface` state) already provides this, so no new visual feedback is required. |

---

## Open Questions

- None blocking. Defaults chosen: Down = next (move down the rail), Up = previous (move up the rail), matching the vertical orientation of the icon rail and the existing Right=next / Left=previous tab convention. The existing Cmd+Shift+]/[ is kept as an additional alias rather than removed (least-surprise, no regression for anyone relying on it).
