# Spec: Sidebar Surface Switch — v1

**Status**: Draft
**Created**: 2026-06-05
**Supersedes**: none
**Related plan**: .sdd/plans/sidebar-surface-switch-v1.md (to be authored)

---

## Overview

Make the left icon rail a single-surface switcher: clicking a rail icon shows exactly one
surface filling the entire main content area, instead of today's permanent split between a
pinned Terminal and one auxiliary panel. The Terminal becomes one of the rail surfaces.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice).

### Switch to a single full-width surface · P1

**As a** cosmos user
**I want to** click an icon in the left rail and have only that surface fill the main area
**So that** I can focus on one surface at a time and use its full available width

**Acceptance criteria:**

- Given the app shell is open, when I view the rail, then it lists five surfaces in order:
  Terminal, Generated UI, Slack, Jira, Confluence.
- Given any surface is selected, when I click a different rail icon, then the previously
  shown surface is hidden and only the newly selected surface fills the entire main content
  area (no second pane is visible beside it).
- Given a surface is selected, when I look at the rail, then that surface's icon shows the
  existing active indicator (foreground icon + primary left indicator bar).

### Terminal is a rail surface, not a pinned pane · P1

**As a** cosmos user
**I want to** the Terminal to be selectable from the rail like the other surfaces
**So that** the main area is never permanently split and each surface gets full width

**Acceptance criteria:**

- Given the app shell, when I look at the rail, then a Terminal entry with a terminal icon is
  present as the first item.
- Given a non-Terminal surface is selected, when I look at the main area, then the Terminal is
  not visible anywhere on screen.
- Given the Terminal is selected, when I look at the main area, then the Terminal fills the
  entire main content area.

### Terminal session survives switching · P1

**As a** cosmos user with a running `claude` TUI session
**I want to** switch to another surface and back without losing my terminal
**So that** my live PTY session, scrollback, and TUI state are preserved

**Acceptance criteria:**

- Given a live PTY/`claude` session in the Terminal, when I switch to another surface and back,
  then the same session is still running with its prior scrollback and state intact (the PTY is
  not torn down or respawned).
- Given a live PTY session, when I switch away from the Terminal, then the PTY connection stays
  open in the background.

### Pending Generated UI surface survives switching · P1

**As a** cosmos user
**I want to** a render_ui (A2UI) surface that arrived while I was on another surface to still be
present when I open Generated UI
**So that** I never lose a pending agent-rendered UI because of where I was looking

**Acceptance criteria:**

- Given the Generated UI panel holds an active/pending surface, when I switch to another surface
  and back to Generated UI, then the same pending surface is still displayed (not cleared or
  re-requested).
- Given I am on a non-Generated-UI surface, when Claude pushes a render_ui surface, then opening
  Generated UI shows that surface (the panel received it while hidden because it stayed mounted).

### Default surface on launch · P2

**As a** cosmos user
**I want to** the app to open on a sensible default surface
**So that** I land on the primary engine without having to click

**Acceptance criteria:**

- Given a fresh app launch, when the shell renders, then the Terminal surface is selected by
  default and fills the main content area.

### Accessibility preserved · P2

**As a** keyboard or assistive-technology user
**I want to** the rail to remain labelled and keyboard-navigable
**So that** the switcher is usable without a mouse

**Acceptance criteria:**

- Given the rail, when I inspect each icon, then it has a tooltip and an `aria-label` equal to
  the surface's display name (including the new Terminal entry).
- Given focus is on a rail item, when I use the keyboard arrow navigation, then I can move
  between and activate rail items as before (Radix vertical Tabs behavior is retained).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The left icon rail MUST present exactly five surfaces in this order: Terminal, Generated UI, Slack, Jira, Confluence.                                          |
| FR-002 | The rail MUST include a Terminal entry as the first item, with a suitable lucide terminal icon (e.g. `SquareTerminal` or `Terminal`).                          |
| FR-003 | The set of selectable surfaces MUST be Terminal, Generated UI, Slack, Jira, Confluence; the surface identifier set MUST be extended to include the Terminal.    |
| FR-004 | At any time exactly one surface MUST be visible, and it MUST fill the entire main content area (full width and height).                                         |
| FR-005 | Clicking a rail icon MUST select its surface, hide the previously selected surface, and show only the newly selected surface.                                   |
| FR-006 | The main content area MUST NOT show a permanent Terminal pane beside other surfaces; the prior Terminal-plus-panel split MUST be removed.                        |
| FR-007 | The default selected surface on launch MUST be Terminal.                                                                                                       |
| FR-008 | Switching surfaces MUST toggle visibility only (CSS hidden); it MUST NOT mount or unmount any surface. All five surfaces MUST stay mounted while hidden.        |
| FR-009 | The Terminal MUST remain mounted when another surface is selected so its live PTY/`claude` session, scrollback, and state are preserved (never torn down).      |
| FR-010 | The Generated UI panel MUST remain mounted when another surface is selected so a pending render_ui (A2UI) surface survives a switch.                            |
| FR-011 | The implementation MUST keep the existing `forceMount` + `data-[state=inactive]:hidden` idiom and extend it to the Terminal surface.                            |
| FR-012 | Each rail item, including Terminal, MUST retain a tooltip and an `aria-label` matching its display name.                                                        |
| FR-013 | The rail MUST remain keyboard-navigable via the existing Radix vertical Tabs behavior.                                                                         |
| FR-014 | The active rail item MUST display the existing active-state styling (foreground icon + primary left indicator bar).                                             |
| FR-015 | This change MUST be renderer-only: no new IPC channels, no main-process changes, no MCP changes.                                                               |

## Edge Cases & Constraints

- Switching away from the Terminal mid-session MUST NOT drop or respawn the PTY; the session
  keeps running in the background (FR-009).
- Switching to Generated UI MUST show any surface that became pending while the panel was hidden,
  because the panel stayed mounted and kept receiving `ui:render` (FR-010).
- A new render_ui arriving while Generated UI is hidden follows the panel's existing
  single-active-surface rule (a new surface replaces the current one); this spec does not change
  that behavior, only ensures the panel stays mounted to receive it.
- The full-width surface MUST honor each surface's own internal scrolling/overflow; making a
  surface full-width MUST NOT break its existing inner layout.
- Out of scope: resizable splits; showing more than one surface at once; persisting the selected
  surface across app restarts; any new IPC, main-process, or MCP work; changes to the surfaces'
  internal content beyond filling the available area.

## Success Criteria

| ID     | Criterion                                                                                                                   |
|--------|---------------------------------------------------------------------------------------------------------------------------|
| SC-001 | On launch, only the Terminal surface is visible and fills the main content area.                                            |
| SC-002 | Clicking each of the five rail icons shows only that surface, full-width, with no other surface visible.                    |
| SC-003 | Starting a `claude` session, switching to another surface, and switching back leaves the same session running with intact scrollback. |
| SC-004 | A render_ui surface pushed while Generated UI is hidden is shown when Generated UI is later selected.                       |
| SC-005 | All five surfaces remain mounted throughout switching (no unmount/remount), verifiable by preserved PTY and pending A2UI state. |
| SC-006 | Every rail item, including Terminal, exposes a tooltip and an `aria-label` matching its name, and the rail stays keyboard-navigable. |

---

## Open Questions

- None. The current code (`src/renderer/App.tsx`, `App.css`, `TerminalPanel.tsx`,
  `GeneratedUiPanel.tsx`) and the confirmed target behavior fully determine this spec.
