# Spec: Collapsible Prompt Composer — v1

**Status**: Draft
**Created**: 2026-06-07
**Supersedes**: none
**Related plan**: .sdd/plans/collapsible-prompt-composer-v1.md (to be authored)

---

## Overview

Across the four generative rail panels (Generated UI, Jira, Slack, Confluence) the
bottom-docked prompt composer is always visible and spans the full panel width. This
feature replaces that always-on, full-width composer with a single element that has two
mutually-exclusive states: a **collapsed** state showing a small cosmos logo button at
the bottom-center of the panel, and an **expanded** state showing a center-aligned,
constrained-width prompt composer. The element animates between the two states. The goal
is to reclaim vertical space and reduce visual weight until the user actually wants to
prompt the agent.

---

## User Scenarios

> Each scenario must be independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Open the composer from the logo · P1

**As a** user of a generative panel (Generated UI, Jira, Slack, or Confluence)
**I want to** click the cosmos logo at the bottom-center of the panel
**So that** the prompt composer expands and I can type an utterance

**Acceptance criteria:**

- Given a generative panel where the composer is collapsed, the bottom-center shows a single cosmos logo button and NO composer/textarea is rendered.
- Given the collapsed logo, when I click it, then the element animates from the logo into the expanded composer (the logo disappears in the same motion).
- Given the composer has just expanded, then keyboard focus is placed in the textarea so I can type immediately.
- Given the composer is expanded, then the cosmos logo button is no longer present (the two states are never shown at the same time).

### Submit collapses back to the logo · P1

**As a** user who has typed an utterance
**I want to** the composer to send my prompt and then collapse back to the logo
**So that** the panel returns to its compact state once my request is on its way

**Acceptance criteria:**

- Given the expanded composer with non-empty (non-whitespace) text, when I submit (Enter or the Send control), then the utterance is sent exactly as today (same `onSubmit(utterance)` behavior) and the composer animates back into the logo.
- Given a submit occurred, when the run is in flight, then the run/error status remains visible somewhere persistent in the panel even though the composer is now collapsed (see Edge Cases / FR-009).
- Given the composer is empty or whitespace-only, when I press Enter, then no run starts and the composer does NOT collapse (unchanged no-op submit behavior).

### Dismiss without submitting · P1

**As a** user who opened the composer but changed my mind
**I want to** dismiss it with Esc or by clicking outside it
**So that** it collapses back to the logo without sending anything

**Acceptance criteria:**

- Given the expanded composer is focused, when I press Esc, then the composer animates back into the logo and no run starts.
- Given the expanded composer is open, when I click outside the composer (elsewhere in the panel), then the composer animates back into the logo and no run starts.
- Given I dismissed via Esc or click-outside, then focus moves to a sensible target — the logo button it collapsed into (see FR-012).

### Consistent across all four generative panels · P1

**As a** user moving between the Generated UI, Jira, Slack, and Confluence panels
**I want to** the collapse/expand behavior to be identical in each
**So that** the interaction is predictable everywhere

**Acceptance criteria:**

- Given any of the four generative panels, then the collapsed logo + expand/collapse behavior is the same (one shared mechanism, not four divergent implementations).
- Given the Jira/Slack/Confluence panels which only show the composer when connected, then the collapsed logo appears only under the same condition the composer appears today (i.e. connected); when not connected, neither the logo nor the composer is shown.

### Center-aligned, constrained-width when expanded · P2

**As a** user
**I want to** the expanded composer to be a centered, constrained-width panel rather than full-width
**So that** the input reads as a focused element rather than a full-width bar

**Acceptance criteria:**

- Given the composer is expanded, then it is horizontally centered and does not span the full panel width.
- Given the panel is resized narrower than the composer's constrained width, then the composer remains usable (it may shrink to fit; exact responsive behavior is the designer's call).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST default each generative panel's prompt input to a COLLAPSED state showing a single cosmos logo button at the bottom-center of the panel, with no composer/textarea rendered.                                  |
| FR-002 | The collapsed logo and the expanded composer MUST be mutually exclusive — exactly one of the two states is present at any time. The system MUST NOT render both simultaneously.                                               |
| FR-003 | Clicking the collapsed logo button MUST transition the element to the EXPANDED composer. The logo is open-only (NOT a toggle); when expanded there is no logo to click.                                                       |
| FR-004 | The transition between collapsed (logo) and expanded (composer) MUST be animated in both directions (logo→composer on open, composer→logo on collapse). The specific motion is the designer's call.                          |
| FR-005 | The expanded composer MUST preserve today's compose behavior unchanged: a textarea, Enter submits, Shift+Enter inserts a newline, empty/whitespace submit is a no-op, and submit is ignored while a run is in flight.        |
| FR-006 | On a SUCCESSFUL submit (non-empty utterance sent), the composer MUST collapse back to the logo automatically.                                                                                                                |
| FR-007 | The expanded composer MUST collapse back to the logo when the user presses Esc while the composer is focused/open, without starting a run.                                                                                   |
| FR-008 | The expanded composer MUST collapse back to the logo when the user clicks outside the composer, without starting a run.                                                                                                      |
| FR-009 | Run/error status for a submitted utterance MUST remain reachable while the composer is collapsed. The default resolution is to rely on the already-persistent per-tab status surfaces (the tab strip status glyph and the `PanelFooter` run-status glyph), which are visible regardless of composer state. See OQ-1. |
| FR-010 | The expanded composer MUST be horizontally CENTERED and constrained in width (NOT full-width across the panel bottom).                                                                                                       |
| FR-011 | On expand, the system MUST move keyboard focus into the composer's textarea.                                                                                                                                                  |
| FR-012 | On collapse (via submit, Esc, or click-outside), the system MUST return focus to a sensible target — the cosmos logo button the composer collapsed into — so keyboard users are not stranded.                                |
| FR-013 | The collapsed logo button MUST have an accessible name (e.g. "Open prompt") so assistive tech announces its purpose.                                                                                                          |
| FR-014 | The expand/collapse state change SHOULD be conveyed to assistive technology (e.g. an appropriate expanded/collapsed semantic and focus management), so a screen-reader user understands the composer opened or closed.       |
| FR-015 | The collapse/expand mechanism MUST be implemented ONCE and reused by all four generative panels (Generated UI, Jira, Slack, Confluence), not re-inlined per panel. The four panels currently duplicate the `PromptComposer`; this feature MUST NOT preserve four divergent copies of the collapse behavior. |
| FR-016 | The collapsed/expanded state MUST be session-only/ephemeral (no persistence), consistent with the rest of the panel tab state. A panel MAY start each session collapsed.                                                      |
| FR-017 | The logo + composer MUST only be present under the SAME condition the composer is present today: always for the Generated UI panel; only when connected for Jira, Slack, and Confluence. When that condition is false, neither the logo nor the composer is shown. |
| FR-018 | In-progress typed text behavior on dismissal (Esc / click-outside) MUST be defined; the system SHOULD preserve the draft so re-opening the composer restores what was typed (see OQ-2 for the discard alternative).          |
| FR-019 | Whether the composer can be collapsed mid-run MUST be defined. The system SHOULD allow collapsing the composer (via Esc / click-outside) while a run is in flight, since run status remains visible via FR-009 and the textarea is already disabled during a run. See OQ-3. |

## Edge Cases & Constraints

- **Status after auto-collapse (FR-009 / OQ-1):** Today the composer shows `Generating…` and inline error text. After a successful submit the composer collapses, hiding that inline feedback. The per-tab status already surfaces independently in two always-visible places — the `PanelTabStrip` tab (`in-flight` / `error` glyph) and the `PanelFooter` run-status glyph — so collapsing does not actually lose the signal. Proposed default: rely on those existing surfaces and drop the composer's inline status/error block, OR re-expand/annotate the logo on error. Flagged for the designer (OQ-1).
- **Draft preservation on dismiss (FR-018 / OQ-2):** If the user types, then dismisses via Esc / click-outside without submitting, the typed text is either preserved (restored on re-open) or discarded. Proposed default: preserve the draft. Note the existing composer clears `value` only on a successful submit, so preserve-on-dismiss is the lower-surprise behavior.
- **Collapse mid-run (FR-019 / OQ-3):** A run can still be in flight when the user collapses. Because the textarea is disabled during a run and status persists via FR-009, allowing collapse mid-run is proposed as the default.
- **Click-outside boundary:** "Outside the composer" must be scoped to the owning panel's region; clicks on the panel's tab strip, content, search box, or footer all count as outside and collapse the composer. Clicks INSIDE the composer (textarea, Send control, status area) must NOT collapse it.
- **Esc inside a panel with other Esc handlers:** Esc must collapse the composer when the composer is open/focused; it must NOT also trigger unrelated panel behavior in a way that surprises the user (the composer's Esc handling should take precedence while it is the focused, open element).
- **Per-panel placeholder/aria text:** Each panel keeps its existing composer placeholder and aria-label copy (e.g. "Describe the UI you want…", "Ask about your Jira issues…", "Ask about Slack", "Ask about Confluence"). The shared mechanism must allow per-panel copy.
- **Asset wiring:** A cosmos symbol mark already exists at `assets/logo/cosmos-symbol.svg` (and variants), but it is not yet imported into the renderer (only main uses a logo today). Making it available to the renderer is build/asset wiring for the implementing session — out of scope for this spec's behavior.
- **Out of scope:** Visual design of the logo button and the open/close animation (owned by the `designer`). The Terminal panel (no `PromptComposer`) and any non-generative panels. Changing what `onSubmit` does, target routing, per-tab correlation, or the agent run lifecycle. Persisting collapsed/expanded state across sessions.

## Success Criteria

| ID     | Criterion                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | In all four generative panels (under their composer-visible condition), the default state shows a single bottom-center logo and no textarea. |
| SC-002 | Clicking the logo reveals a focused, center-aligned, constrained-width composer, and the logo is no longer present.                       |
| SC-003 | A successful submit sends the utterance (identical to today) and the composer auto-collapses to the logo.                                 |
| SC-004 | Esc and click-outside each collapse the composer to the logo without starting a run.                                                      |
| SC-005 | Run/error status for an in-flight or failed run remains visible after auto-collapse (via the tab strip and/or footer).                    |
| SC-006 | Keyboard focus lands in the textarea on expand and returns to the logo button on collapse; the logo button has an accessible name.        |
| SC-007 | The logo + composer never appear at the same time, in any panel, in any state.                                                            |

---

## Open Questions

- [ ] **OQ-1 (designer / product):** Where exactly should in-flight and error status surface once the composer auto-collapses after submit? Proposed default: rely on the existing always-visible per-tab surfaces (`PanelTabStrip` status glyph + `PanelFooter` run-status glyph) and remove the composer's inline status/error block. Alternative: surface error state on the collapsed logo itself (e.g. an error affordance that re-expands or annotates the logo). Needs a designer/product call because it changes whether the composer's inline error text survives at all.
- [ ] **OQ-2 (designer / product):** On dismiss via Esc / click-outside without submitting, preserve the typed draft (restore on re-open) or discard it? Proposed default: preserve.
- [ ] **OQ-3 (designer / product):** Confirm collapsing is allowed while a run is in flight (proposed: yes), since status persists elsewhere and the textarea is disabled during a run.
