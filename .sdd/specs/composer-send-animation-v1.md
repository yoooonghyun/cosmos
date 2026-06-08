# Spec: Composer Send Animation — v1

**Status**: Draft
**Created**: 2026-06-08
**Supersedes**: none (evolves the submit/collapse behavior of collapsible-prompt-composer-v1)
**Related plan**: .sdd/plans/composer-send-animation-v1.md (to be authored)

---

## Overview

Today, when the user submits the shared prompt composer it shrinks/cross-fades back DOWN
into the small cosmos-logo button (`scale-[0.08]` at `origin-bottom`) and shows an inline
"Generating…" spinner glyph inside the Send button while the run is in flight. This feature
replaces that submit-time motion: on submit the composer instead animates **expanding to
full size while fading away**, and a **spinner is shown on the panel surface itself until
the Generative UI for that run actually renders** (or the run fails). It refines only the
submit-time feedback of collapsible-prompt-composer-v1; the open, Esc, and click-outside
behaviors are unchanged.

---

## User Scenarios

> Each scenario must be independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Submit expands-and-vanishes the composer · P1

**As a** user who has typed an utterance in any of the four generative panels
**I want to** see the composer grow to full size and fade out when I press Send/Enter
**So that** submitting feels like the prompt is being launched into the surface, not just shrinking away

**Acceptance criteria:**

- Given the expanded composer with non-empty (trimmed) text, when I submit (Enter or the Send control), then the utterance is sent exactly as today (same `onSubmit(utterance)`) and the composer animates by scaling UP toward full size while its opacity fades to zero (it does NOT shrink down into the logo).
- Given the submit animation has completed, then the composer is no longer visible or interactive (it is `inert` + `pointer-events-none`, so focus/clicks/AT cannot reach it).
- Given the composer is empty or whitespace-only, when I press Enter, then no run starts, no expand-and-vanish animation plays, and the composer stays expanded (unchanged no-op submit behavior).
- Given `prefers-reduced-motion` is set, when I submit, then the composer disappears without the scale/fade motion (instant swap) while the rest of the behavior is identical.

### Spinner runs until the Generative UI appears · P1

**As a** user who just submitted a prompt
**I want to** see a spinner on the surface while the agent works
**So that** I know a Generative UI is being produced and roughly when it is ready

**Acceptance criteria:**

- Given the composer has expanded-and-vanished after a submit, then a spinner appears on the panel's surface area (the originating tab's content region) indicating the Generative UI is being generated.
- Given the run produces its Generative UI, when that run's surface actually renders into the originating tab, then the spinner is removed and replaced by the rendered surface (the spinner's stop condition is the surface landing, not merely the agent run reporting "completed").
- Given the run fails (agent `error`), then the spinner is removed and the panel shows the run's error state in the originating tab as it does today (no perpetual spinner).
- Given `prefers-reduced-motion` is set, then the spinner is shown as a static/reduced-motion-friendly busy indicator (it MUST still convey "busy" without spinning animation).

### Returning to compose the next turn · P2

**As a** user whose Generative UI has rendered (or whose run errored)
**I want to** get back to a compose affordance for my next prompt
**So that** I can iterate without the composer being permanently gone

**Acceptance criteria:**

- Given the composer expanded-and-vanished on submit, then the collapsed cosmos-logo button is the resting affordance the user returns to (the panel ends the submit sequence in the COLLAPSED state, exactly as collapsible-prompt-composer-v1 already does post-submit).
- Given the run is still in flight, when I want to compose again, then I can re-open the composer from the logo (the logo remains usable mid-run; submit stays gated while a run is in flight, unchanged from FR-005/FR-019 of collapsible-prompt-composer-v1).

### Identical across all four generative panels · P1

**As a** user moving between Generated UI, Jira, Slack, and Confluence
**I want to** the expand-and-vanish motion and surface spinner to behave identically
**So that** submitting is predictable everywhere

**Acceptance criteria:**

- Given any of the four generative panels, then the submit-time expand-and-vanish motion and the until-rendered surface spinner are the same (one shared mechanism, no per-panel divergence).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | On a SUCCESSFUL submit, the system MUST animate the composer EXPANDING toward full size while its opacity fades to zero, then leave it non-visible. It MUST NOT play the previous shrink-into-the-logo (`scale-[0.08]`) motion on submit. |
| FR-002 | The submit animation MUST be a renderer/styling change only: it MUST preserve today's send path unchanged (`onSubmit(utterance)`, draft cleared only on success, no new IPC/MCP/main-process work). |
| FR-003 | After the submit animation, the composer MUST be non-interactive and removed from the tab/focus/AT order (`inert` + `pointer-events-none` + `tabIndex=-1`), consistent with the always-mounted dual-state pattern of collapsible-prompt-composer-v1 (both states stay mounted; the flag toggles which is live). |
| FR-004 | After the submit sequence the panel MUST rest in the COLLAPSED state (the cosmos-logo button), preserving collapsible-prompt-composer-v1 FR-006/FR-012 (auto-collapse + focus returns to the logo). The expand-and-vanish is the visual transition INTO that collapsed resting state — it MUST NOT leave the panel with no compose affordance. |
| FR-005 | Following a submit, the system MUST display a busy spinner on the originating tab's surface region indicating the Generative UI is being generated. |
| FR-006 | The surface spinner MUST stop (be removed) when this run's Generative UI actually renders into the originating tab — i.e. when the originating tab transitions from in-flight to having a rendered surface — NOT merely when the agent run reports `completed`. The rendered surface MUST replace the spinner. |
| FR-007 | On a run `error`, the surface spinner MUST stop and the panel MUST show the originating tab's existing error state; the spinner MUST NOT persist after a terminal run outcome (render OR error). |
| FR-008 | The surface spinner MUST be scoped to the originating tab (the tab the run was correlated to). Switching to a different tab that is not in-flight MUST NOT show the spinner; switching back to a still-in-flight tab MUST show it. |
| FR-009 | The inline in-Send-button "Generating…" spinner glyph (the `Loader2` text in the Send button) MUST be removed, since the busy affordance is now the surface spinner and the composer is no longer visible during the run; the redundant in-button spinner adds nothing. The Send control's disabled-while-running gating is unaffected when the composer is re-opened mid-run. |
| FR-010 | The submit motion and the surface spinner MUST degrade gracefully under `prefers-reduced-motion`: the composer disappears via an instant swap (no scale/fade) and the spinner is presented as a non-animated busy indicator that still conveys "busy" to sighted and AT users. |
| FR-011 | The expand-and-vanish motion + surface spinner MUST be implemented ONCE and reused by all four generative panels (Generated UI, Jira, Slack, Confluence), not re-inlined per panel. |
| FR-012 | The busy state SHOULD be conveyed to assistive technology (e.g. an `aria-busy`/status semantic on the surface region) so a screen-reader user knows generation is underway and when it finishes. |
| FR-013 | Tailwind v4 transition correctness: the motion MUST explicitly name the animated properties (e.g. `transition-[opacity,scale]`) because `scale-*` compiles to a standalone `scale:` prop, and both composer states MUST stay mounted and be toggled via the flag (per the documented gotcha) so the exit animation fires. |

## Edge Cases & Constraints

- **Spinner stop condition (FR-006 / OQ-1):** A generative run's lifecycle is: `agent.onStatus` `started` → (work) → `ui:render` frame filed into the originating tab (`useGenerativePanelTabs`) → `agent.onStatus` `completed`. The agent run can report `completed` WITHOUT (or before) a surface frame, and the surface frame is what the user perceives as "the Generative UI appeared." Therefore the spinner's stop condition is the originating tab's `surface` being populated (its `inFlight` clearing because a frame landed), not the `completed` status. The originating tab's in-flight/surface/error state already lives in `useGenerativePanelTabs` (the `GenerativeTab` record: `inFlight`, `surface`, `error`); the spinner is driven from that per-tab state, which is why FR-008 scopes it per tab. Today the composer is decoupled (it only subscribes to `agent.onStatus`), so wiring the spinner to per-tab surface state is the one integration point this feature introduces (renderer-only).
- **Composer is not visible during the run:** Because the composer expands-and-vanishes on submit (FR-001) and rests collapsed (FR-004), there is no composer card on screen during generation to host the spinner — confirming the spinner belongs on the surface region (the tab content area), not in the composer. This is why the in-button spinner is removed (FR-009).
- **Re-open mid-run:** The user may re-open the composer from the logo while the spinner is still running (a run is in flight). This is allowed (collapsible-prompt-composer-v1 FR-019); submit stays gated while running. Re-opening MUST NOT cancel or hide the surface spinner for the in-flight run.
- **Multiple runs / multiple tabs:** Each tab tracks its own in-flight/surface state, so two tabs can be at different stages; the spinner shows only on a tab that is in-flight without a surface (FR-008).
- **No surface ever arrives but the run completes (degenerate):** If a run reports `completed`/`error` and clears the tab's in-flight without ever landing a surface, the spinner MUST still stop (the tab's terminal state — surface, error, or no-longer-in-flight — ends the busy state); it MUST NOT spin forever. (The originating-tab state machine already clears `inFlight` on the render frame and on `error`.)
- **Out of scope:** The exact visual design of the expand-and-vanish motion and the spinner glyph/placement (owned by the `designer`; this is a UI-bearing feature and SHOULD route through the `design` skill). The open/Esc/click-outside behaviors and draft preservation of collapsible-prompt-composer-v1 (unchanged). Any change to `onSubmit`, target routing, per-tab correlation, the agent run lifecycle, IPC, MCP, or main-process code. The Terminal panel (no composer). Persisting any state across sessions.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | In all four generative panels, submitting a non-empty prompt animates the composer expanding-to-full-size while fading out (never the old shrink-to-logo), and the panel rests collapsed afterward. |
| SC-002 | After a submit, a busy spinner is visible on the originating tab's surface region until that run's Generative UI renders into the tab. |
| SC-003 | The spinner stops when the run's surface actually renders (replaced by the surface), and also stops on run `error` (showing the error state) — never persisting after a terminal outcome. |
| SC-004 | The spinner is scoped to the originating tab: a non-in-flight tab shows no spinner; switching back to a still-in-flight tab shows it again. |
| SC-005 | The in-Send-button "Generating…" glyph is gone; the busy affordance is the surface spinner. |
| SC-006 | Under `prefers-reduced-motion`, the composer disappears with no scale/fade and the spinner is a non-animated busy indicator; AT can perceive the busy/idle transition. |
| SC-007 | An empty/whitespace submit plays no animation and starts no spinner (unchanged no-op). |

---

## Open Questions

- [ ] **OQ-1 (resolved in spec; confirm with designer):** The spinner's stop condition is the originating tab's surface landing (its `inFlight` clearing because a `ui:render` frame was filed), NOT the agent run `completed` status — because a run can report completed without/before the user-visible surface. Resolved here from `useGenerativePanelTabs` (`GenerativeTab.inFlight`/`surface`/`error`); flagged only so the designer/implementer confirm the per-tab state is the chosen drive signal rather than re-deriving "busy" from `agent.onStatus`.
- [ ] **OQ-2 (designer):** Exact placement/style of the surface spinner within the tab content region (centered overlay vs. inline placeholder) and the expand-and-vanish easing/duration — defer to the `design` skill; this spec fixes only the behavior, not the look.
