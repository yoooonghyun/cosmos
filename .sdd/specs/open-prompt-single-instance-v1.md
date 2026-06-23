# Spec: Open-Prompt Single App-Root Instance — v1

**Status**: Draft
**Created**: 2026-06-23
**Supersedes**: —
**Related plan**: .sdd/plans/open-prompt-single-instance-v1.md

---

## Grounding

> Direct investigation run by the architect for this spec (mandatory report).

**codegraph_explore** (code structure):
- `PromptComposer OpenPromptPositionProvider App panels forceMount data-state inactive hidden` — confirmed `PromptComposer` measures its position box via `rootRef.current?.closest('section')` (the panel's own `<section>`); a hidden panel measures a 0-box, the logo sits opacity-0 until an ASYNC ResizeObserver re-measures post-paint → the flicker. The eased-drag follow + re-grab-mid-settle machinery live entirely inside `PromptComposer`.
- `App.tsx OpenPromptPositionProvider useOpenPromptPosition surface state rail panels …` — `App` wraps `AppShell` in `OpenPromptPositionProvider` (App.tsx:88); the position is ALREADY one shared app-root state. `AppShell` holds `surface` (the active rail id) and force-mounts all 6 `TabsContent` panels with `data-[state=inactive]:hidden` (App.tsx:276-311). Terminal has no composer.
- `useGenerativePanelTabs submit showSpinner surfaceSpinnerVisible inFlight contextChipFor ContextChipData` — `submit`, `showSpinner` (`= surfaceSpinnerVisible({...})`), and `contextChipFor(...)` are produced PER PANEL by `useGenerativePanelTabs` + `viewContextCapture.ts`; each call site passes `{onSubmit, placeholder, ariaLabel, contextChip?, busy}`.
- Grep `<PromptComposer` — exactly 5 call sites: `GeneratedUiPanel.tsx:140` (no `contextChip`), `SlackPanel.tsx:1504`, `JiraPanel.tsx:731`, `ConfluencePanel.tsx:752`, `GoogleCalendarPanel.tsx:808`. Each gates render behind a per-panel condition (e.g. connected / has-tabs) before showing the composer.

**memory_recall / memory_smart_search**: `Open Prompt PromptComposer collapsed logo draggable position flicker panel switch` and `PromptComposer busy contextChip viewContext per-tab spinner gating` both returned no stored observations — no prior decision on file for this area; this spec establishes it.

---

## Overview

The bottom-center "Open Prompt" button **flickers** every time the user switches rail
panels: each of the 5 generative panels mounts its own `PromptComposer`, and a hidden
panel measures a 0-size box so its collapsed logo is held invisible until an asynchronous
post-switch re-measure fades it back in. This feature renders the Open-Prompt composer
**exactly once** at the app root so it never remounts or re-measures on a panel switch —
eliminating the flicker — while still reflecting the active panel's own prompt
configuration and submit behavior.

## User Scenarios

### Switching panels shows a steady Open-Prompt button · P1

**As a** user moving between the Generated UI, Slack, Jira, Confluence, and Google Calendar panels
**I want to** see the Open-Prompt logo button stay perfectly still and visible across the switch
**So that** the app feels stable and the button never blinks out and fades back in.

**Acceptance criteria:**
- Given the Open-Prompt button is visible on panel A, when I switch to panel B (which also shows the composer), then the button stays continuously visible with no opacity fade, position jump, or remount.
- Given I switch panels repeatedly, then the button never momentarily disappears or re-runs its fade-in animation.

### The button acts on the active panel · P1

**As a** user with the composer open on a given panel
**I want to** the prompt's placeholder, accessible name, context chip, busy state, and submit to match the panel I am looking at
**So that** typing and sending grounds against the panel I am actually viewing.

**Acceptance criteria:**
- Given panel X is active, when I open the composer, then its placeholder and accessible name are panel X's (e.g. "Ask about your Jira issues…" on Jira, "Describe the UI you want…" on Generated UI).
- Given panel X exposes a view-context chip (Slack/Jira/Confluence/Google Calendar), when I open the composer with an item in view, then the chip reflects panel X's current selection; Generated UI shows no chip.
- Given I submit an utterance, when the composer accepts it, then it is routed to the ACTIVE panel's submit handler (same tab/correlation bookkeeping as today), and the panel's surface spinner gates the composer exactly as before.

### The button stays positioned over the visible panel · P1

**As a** user who dragged the button somewhere in the panel
**I want to** the button to remain at that fractional position over the currently visible panel and to remain draggable across it
**So that** my placement is honored on every panel without re-measuring per panel.

**Acceptance criteria:**
- Given a saved fractional position, when any panel is active, then the button is drawn at that fraction of the ACTIVE panel's content box.
- Given I drag the button while panel X is active, then it follows the cursor (with the existing eased motion) clamped within panel X's content box, and the new position persists and applies on every panel.
- Given a panel resizes or the window resizes, then the button re-clamps into the active panel's box before paint (no off-screen drift), exactly as today.

### Panels that have no composer are unaffected · P2

**As a** user on the Terminal panel
**I want to** no Open-Prompt button to appear
**So that** the terminal surface is unobstructed.

**Acceptance criteria:**
- Given the Terminal panel is active, then no Open-Prompt logo or composer is shown.
- Given a generative panel is in a state that currently HIDES its composer (e.g. not-connected, or a panel-specific gate), when that panel is active, then the single instance shows nothing — matching today's per-panel visibility.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST render the Open-Prompt collapsed logo and expanded composer EXACTLY ONCE, at the app root (inside the existing app-root provider), not once per panel. |
| FR-002 | The single instance MUST NOT remount, re-measure, or re-run its fade-in/visibility animation as a result of a rail panel switch. |
| FR-003 | The single instance MUST operate on the ACTIVE panel: its `placeholder`, `ariaLabel`, `collapsedAriaLabel`, `contextChip`, `busy`, and `onSubmit` MUST be the active panel's values, swapping when the active panel changes. |
| FR-004 | Each composer-bearing panel (Generated UI, Slack, Jira, Confluence, Google Calendar) MUST PUBLISH its current `{onSubmit, placeholder, ariaLabel, collapsedAriaLabel?, contextChip?, busy}` to the single instance instead of rendering its own `PromptComposer`. Publication MUST happen only while the panel is the active surface. |
| FR-005 | When the active panel has NO published composer config (Terminal, or a panel whose own visibility gate is currently false), the single instance MUST render NOTHING — preserving each panel's existing show/hide conditions for the composer. |
| FR-006 | The single instance MUST position the logo against the ACTIVE panel's content box (its `<section>` content rect), so a drag maps across the visible panel and not the whole window. |
| FR-007 | The single instance MUST read and write the existing globally-shared draggable position (`OpenPromptPositionProvider`); dragging MUST persist via the same session-save path, and the position MUST apply identically on every panel. |
| FR-008 | The system MUST preserve, unchanged, the existing composer behaviors: collapse-on submit/Esc/click-outside, draft-preserved-until-successful-submit, the submit "launch" grow-fade vs. the gentle dismiss, the collapsed-logo error ring, the eased-drag follow, and the re-grab-mid-settle fix. |
| FR-009 | The system MUST preserve the spinner gating contract: while the active panel's `busy` (its per-tab `surfaceSpinnerVisible` gate) is true, BOTH composer states (expanded card and collapsed logo) are hidden, and the logo reappears only when the run's surface lands/errors. A plain submit MUST remain fire-and-forget (the composer stays interactive — `composerInteractiveAfterSubmit`). |
| FR-010 | No new IPC channel, MCP server, or main-process change is required; this is a renderer-only restructuring. |
| FR-011 | The expanded composer's local draft/expanded/sent-hint state SHOULD be a single global instance (one draft shared across panels). See Open Questions OQ-1. |

## Edge Cases & Constraints

- **Active panel with composer hidden by its own gate.** Each panel currently wraps its
  composer in a conditional (e.g. Slack/Jira/Confluence/Google Calendar render it only
  when connected; Generated UI when its base/tab conditions hold). The single instance
  must show nothing when the active panel publishes no config — i.e. each panel must
  publish ONLY when its existing condition is true, and clear/withhold its publication
  otherwise.
- **Selection changes while the composer is open.** `contextChip` and the view-context
  attached at send time must reflect the active panel's CURRENT selection at send time, as
  today (the panels read it through refs inside `submit`). The single instance must not
  snapshot a stale chip.
- **Switching panels while the composer is EXPANDED with a draft.** With one global
  instance the draft persists across the switch (it is the same component). This is a
  behavior change from today's per-panel drafts (each panel had its own). Flagged as OQ-1;
  recommended behavior is a single global draft.
- **Switching panels while a panel is `busy`.** Today each panel's own composer hides
  while that panel is busy. With the single instance reading the ACTIVE panel's `busy`,
  switching to a busy panel hides the composer and switching to a non-busy panel shows it
  — matching per-panel behavior, just sourced from the active publication.
- **Active panel rect when the instance is not a child of the panel.** The instance can no
  longer find its panel via `closest('section')`. The active panel must publish (or the
  instance must locate) the active panel's content box rect; see OQ-2.
- **Out of scope:** any change to the TUI/Terminal panel, the A2UI render pipeline,
  per-tab surface state, IPC/MCP, or the visual design of the composer/logo. No new
  draggable behavior — only relocation of the single existing instance.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Switching among all 5 composer-bearing panels produces ZERO opacity fade, position jump, or remount of the Open-Prompt button (visually verified; the button's mount identity is stable across switches). |
| SC-002 | Exactly one `PromptComposer` instance exists in the tree at any time (verified: the 5 per-panel mounts are removed). |
| SC-003 | On each panel, the composer's placeholder, ariaLabel, context chip presence, busy gating, and submit routing match that panel's pre-change behavior. |
| SC-004 | The dragged position persists and is honored on every panel, clamped to the active panel's content box, with the eased motion and re-grab-mid-settle behavior intact. |
| SC-005 | Terminal (and any panel whose composer gate is false) shows no Open-Prompt affordance. |
| SC-006 | Pure decision logic in `promptComposerLogic.ts` (submit decision, spinner gate, draft handling, position math) is unchanged or extended with node-testable units; existing tests still pass. |

---

## Open Questions

- [ ] **OQ-1 — Single global draft vs. per-panel draft.** A single app-root instance means
      one draft (text/expanded/sent-hint) shared across panels: opening the composer on Jira,
      typing, switching to Slack, and reopening shows the same draft. **Recommended default:
      single global draft** — simpler, matches "one composer for the whole app," and avoids
      reintroducing per-panel state that would defeat the single-instance goal. If per-panel
      drafts are required, the registry would need to key draft state by surface id (added
      complexity); flag before implementing if the product wants this.
- [ ] **OQ-2 — How the single instance finds the active panel's content rect.** Two viable
      options: (a) the active panel publishes its content-box `ref`/element alongside its
      config (the instance measures that element with the same ResizeObserver + window
      resize/scroll listeners it uses today); or (b) the instance queries the visible panel's
      `<section>` by a stable `data-` attribute (e.g. `[data-open-prompt-host="<surface>"]`)
      keyed off the active `surface` id. **Recommended default: (a) publish the element ref**
      — it is explicit, avoids DOM-attribute coupling, and the panel already owns its
      `<section>`. Both are renderer-only and node-test-neutral.
- [ ] **OQ-3 — Does the Terminal panel participate?** Confirmed NO — Terminal has no
      `PromptComposer` today and must show none. Listed only to make the exclusion explicit.
