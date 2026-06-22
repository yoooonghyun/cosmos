# Spec: Draggable Open-Prompt Button (global shared position) — v1

**Status**: Draft
**Created**: 2026-06-22
**Supersedes**: —
**Related plan**: .sdd/plans/draggable-open-prompt-button-v1.md

---

## Grounding

Direct investigation run for this spec (tools invoked by the architect, per CLAUDE.md):

**codegraph_explore**
- `PromptComposer collapsed logo expanded card overlay button open prompt` → the collapsed
  logo + expanded card share ONE zero-height in-flow overlay slot anchored above the footer
  (`PromptComposer.tsx` ~line 299–451): the surround is `pointer-events-none absolute inset-x-0
  bottom-0 … justify-center`; the logo is `absolute bottom-3 left-1/2 -translate-x-1/2`; pure
  decision logic lives in `promptComposerLogic.ts` (the `.ts`/`.test.ts` split). Click opens via
  `onClick={() => setExpanded(true)}`.
- `SessionSnapshot SESSION_SCHEMA_VERSION session snapshot validation` → `SessionSnapshot`
  (`src/shared/ipc/session.ts:239`) is `{ schemaVersion, panels{…}, enabled }`; the schema is at
  v8; the `calendar-selection-persistence` precedent (session.ts ~line 78) added an additive
  OPTIONAL field with NO bump (validators default when absent).
- `validateSnapshot SessionProvider useSession sessionRegistry` → `validateSnapshot`
  (`sessionSnapshot.ts:328`) normalizes at the main boundary and returns `null` on wrong version;
  `SessionRegistry` (`sessionRegistry.ts`) merges per-panel + non-panel contributions
  (`setEnabled` is the non-panel precedent) and debounce-saves; `SessionProvider` exposes the
  restored snapshot via context.

**Grep** `PromptComposer` across `src/renderer/*.tsx` → rendered by SIX panels:
`GeneratedUiPanel`, `JiraPanel`, `SlackPanel`, `ConfluencePanel`, `GoogleCalendarPanel` (and the
component file). Confirms "every panel" — the shared position must be one value across all six.

**memory_recall / memory_smart_search** `session snapshot persistence global UI state PromptComposer
position additive optional field` → no prior decision recorded for this feature. Saved the new
architecture decision (normalized-fraction global position, additive optional snapshot field, app-root
context store) via `memory_save` after settling it.

---

## Overview

The collapsed Open-Prompt button (the cosmos-logo affordance that every generative panel's
`PromptComposer` shows when collapsed) is fixed at bottom-center and sometimes covers the panel
content behind it. This feature lets the user **drag** that button to reposition it, and makes the
chosen position **globally shared** — one position used by every panel's Open-Prompt button — and
**persisted** so it survives an app restart.

## User Scenarios

### Reposition the Open-Prompt button by dragging · P1

**As a** cosmos user whose panel content is obscured by the centered Open-Prompt button
**I want to** drag the button to a less-obstructive spot
**So that** I can see and interact with the content behind it while keeping the composer reachable

**Acceptance criteria:**

- Given the collapsed Open-Prompt button is shown, when I press on it and move the pointer past a
  small movement threshold, then the button follows the pointer and lands where I release it.
- Given I press and release on the button WITHOUT moving past the threshold, then the composer
  opens (the existing click-to-open behavior is preserved — a drag must not also open it).
- Given I drag toward an edge, when I release, then the button is clamped to stay fully within the
  panel content area (it can never be dragged off-screen or out of the panel).

### One shared position across every panel · P1

**As a** user who works across the Terminal, Generated UI, Jira, Slack, Confluence, and Calendar
surfaces
**I want to** set the button position once and have it apply everywhere
**So that** the affordance is consistent no matter which panel I am on

**Acceptance criteria:**

- Given I drag the button in one panel, when I switch to another generative panel, then its
  Open-Prompt button is already at the same moved position (the position is global, not per-panel
  and not per-tab).
- Given two generative panels are mounted (all stay mounted, §3), when I drag the button in one,
  then any visible Open-Prompt button reflects the new position live (shared state updates all).

### Position survives restart · P1

**As a** returning user
**I want** my chosen button position remembered
**So that** I don't have to reposition it every launch

**Acceptance criteria:**

- Given I moved the button and quit, when I relaunch cosmos, then the Open-Prompt button restores
  to the position I left it at.
- Given I never moved the button, when I launch (or relaunch after upgrading from a snapshot that
  predates this feature), then the button is at its default centered-bottom position (no migration
  surprise, no schema invalidation).

### Off-screen recovery after a resize · P2

**As a** user who resizes the window smaller than when I positioned the button
**I want** the button to stay reachable
**So that** I never lose access to the composer

**Acceptance criteria:**

- Given a persisted position that would land outside the current (smaller) panel area, when the
  panel renders, then the position is clamped back into view before paint (the button is always
  fully visible and clickable).

### Reset to default · P3 (see OQ-2)

**As a** user who moved the button somewhere I no longer want
**I want** a way to return it to the default centered-bottom spot
**So that** I don't have to nudge it back by hand.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                                                                                 |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The collapsed Open-Prompt button MUST be draggable via pointer/mouse to reposition it within the panel content area.                                                                                                          |
| FR-002 | A drag MUST be disambiguated from a click by a movement threshold: a press-release with travel below the threshold MUST open the composer (preserving existing click-to-open); travel at/above the threshold MUST move it, NOT open it. |
| FR-003 | The position MUST be GLOBALLY SHARED — a single value used by every panel's Open-Prompt button (not per-panel, not per-tab). Dragging in one panel MUST update the position seen by all panels.                                |
| FR-004 | While the user is dragging in one panel, every mounted Open-Prompt button MUST reflect the new position live (shared state, no reload).                                                                                       |
| FR-005 | The position MUST be clamped so the button stays fully within the panel content bounds — it MUST NOT be possible to drag (or restore) the button off-screen or out of the panel.                                              |
| FR-006 | The position representation MUST be robust to window/panel resize — a position set at one size MUST map sensibly to a different size without drifting off-screen (see OQ-1; normalized fraction is the recommended default).   |
| FR-007 | The position MUST be persisted across app restart and restored on load.                                                                                                                                                      |
| FR-008 | Persistence MUST be an ADDITIVE, OPTIONAL field on the session snapshot — `SESSION_SCHEMA_VERSION` MUST NOT be bumped (validators default when the field is absent), following the `calendar-selection-persistence` precedent. |
| FR-009 | The persisted position MUST be validated/normalized at the main-process boundary: a malformed or out-of-range value MUST be coerced to a safe value (clamped) or treated as absent (default), never crash, never overwrite a good file. |
| FR-010 | The persisted position MUST be NON-secret structure only (a pair of numbers); it MUST carry no token, path, or other sensitive data (the snapshot is non-secret, §4.6 / FR-006 of session-persistence).                       |
| FR-011 | When no position has ever been set (clean session or a pre-feature snapshot), the button MUST default to the current centered-bottom position.                                                                                |
| FR-012 | A restored off-screen position (panel now smaller) MUST be clamped back into view before the button is shown, with no flicker of an off-screen button.                                                                        |
| FR-013 | The expanded composer card MUST remain anchored sensibly relative to the moved logo (it MUST NOT open off-screen). See OQ-4 for whether the card follows the logo or stays centered.                                          |
| FR-014 | The clamp + resize-mapping logic MUST live in a pure, node-testable helper (the `.ts`/`.test.ts` split used by `promptComposerLogic.ts`), with no DOM dependency in the pure layer.                                            |
| FR-015 | The busy/inert and collapsed/expanded behavior of the composer (it hides while `busy`, click opens, Esc/outside-click collapses) MUST be unchanged by this feature — only the collapsed logo's POSITION becomes user-controlled. |
| FR-016 | The drag MUST be keyboard/AX-safe: dragging is a pointer enhancement; the button MUST remain a focusable, click-activatable control (the existing tooltip + `aria-label` preserved). Keyboard repositioning is OUT of scope (OQ-2/OQ-5). |

## Edge Cases & Constraints

- **Pre-feature snapshot.** A v8 snapshot written before this field exists MUST restore cleanly to
  the default position (additive optional, no bump) — never invalidate the session.
- **Out-of-range / malformed persisted value.** `{xFrac: 5, yFrac: -2}`, a non-number, a missing
  field, or a non-object MUST normalize to clamped-in-range or default at the boundary.
- **Resize to a smaller panel.** A normalized position is always in-range, but a fixed minimum
  button inset still requires a clamp so the whole button body (not just its anchor point) stays
  inside; the clamp MUST account for the button's own size.
- **Drag started on the button but released outside the panel.** The release position MUST clamp to
  the nearest in-bounds spot, not vanish.
- **Multiple panels mounted at once.** All panels read the one shared store; a drag in the active
  panel updates inactive (hidden) panels' buttons too, so switching shows the moved button with no
  jump.
- **Out of scope:** per-panel or per-tab positions (explicitly global only); dragging the EXPANDED
  composer card itself (only the collapsed logo is draggable; the card anchors relative to it);
  resizing the button; multi-monitor-specific behavior beyond clamp; keyboard-driven repositioning;
  touch-gesture niceties beyond basic pointer drag.

## Success Criteria

| ID     | Criterion                                                                                                                            |
|--------|------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | A pointer drag past the threshold moves the button and lands it where released; a sub-threshold press still opens the composer.      |
| SC-002 | After dragging in one panel, every other panel's Open-Prompt button shows the same position (verified across all six panels).        |
| SC-003 | The moved position survives an app restart and restores to the same spot.                                                           |
| SC-004 | A snapshot predating the field restores with the button at the default centered-bottom position and no schema invalidation (still v8).|
| SC-005 | The pure clamp + normalized-mapping helper passes node tests: in-range round-trips, out-of-range inputs clamp, button-size inset honored, default returned for absent input. |
| SC-006 | The persisted on-disk snapshot bytes for the position contain only two numbers (no secret), and an invalid persisted value is ignored without overwriting the good file. |
| SC-007 | A persisted position that is off-screen at the current (smaller) panel size is clamped into view before the button paints (no off-screen flash). |

---

## Open Questions

- [ ] **OQ-1 — Position representation.** RECOMMENDED: a **normalized fraction** `{ xFrac, yFrac }`
  in `[0,1]` of the panel content area (origin top-left), because it is panel-size-independent and
  survives window/panel resize without drifting (a pixel offset would, and an explicit corner+offset
  needs corner bookkeeping). Confirm normalized fraction vs corner+offset.
- [ ] **OQ-2 — Reset affordance (P3).** Whether to ship a reset-to-default control in v1 (e.g. a
  small "reset position" item, or double-click to recenter), or defer. RECOMMENDED: defer to a
  follow-up; FR set works without it. If included, a double-click-to-recenter is the lightest touch.
- [ ] **OQ-3 — Drag handle vs whole-button drag (designer-owned).** Whether the whole logo button is
  the drag surface (with a threshold separating click from drag) or a distinct drag handle appears.
  RECOMMENDED: whole-button drag with a threshold (no extra chrome); designer confirms the cursor and
  any hover affordance in the design step.
- [ ] **OQ-4 — Does the expanded card follow the moved logo?** RECOMMENDED: the expanded composer
  card stays **centered** (its current `max-w-2xl` centered overlay) regardless of logo position —
  simplest, never opens off-screen, and the card is transient. Only the collapsed logo moves. Confirm
  vs anchoring the card to the logo.
- [ ] **OQ-5 — Keyboard repositioning.** Out of scope for v1 (pointer-only). Confirm this is
  acceptable for accessibility, or flag for a follow-up (arrow-key nudge while focused).
