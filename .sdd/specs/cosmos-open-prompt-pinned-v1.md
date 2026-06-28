# Spec: Cosmos Open-Prompt Pinned Composer — v1

**Status**: Draft
**Created**: 2026-06-28
**Supersedes**: (none — first cycle of the broader "fix the Cosmos panel" effort; the user said
"first / 우선", so this is intentionally narrow. Builds on `cosmos-conversation-panel-v2` and
`cosmos-live-output-streaming-v1`, which made the Cosmos panel a conversation timeline.)
**Related plan**: .sdd/plans/cosmos-open-prompt-pinned-v1.md (to be authored in Step 2)

---

## Grounding

> Direct investigation by the architect (codegraph_explore + agentmemory + the architecture/structure
> docs + existing specs). This section makes the grounding visible to the cycle.

**codegraph_explore queries run (verbatim source returned, treated as Read):**

- `Cosmos panel Open Prompt composer input conversation history unified agent session` → surfaced
  `PromptComposer.tsx`, `promptComposerLogic.ts` (`submitDecision`/`escDecision`/`draftAfterDismiss`),
  `openPromptPosition.ts` (the draggable fraction model), `agentSessionStore.ts` (persistent default
  `--session-id`). Takeaway: today's Open-Prompt is a **draggable, collapsed-by-default floating logo
  button** that expands into a centered overlay card — it is NOT a docked input.
- `PromptComposer open collapsed expanded toggle CosmosPanel conversation history panel layout footer`
  → confirmed the collapse/expand state machine: `const [expanded, setExpanded] = useState(false)`
  (default collapsed), `escDecision`/`shouldCollapseOnOutsideClick` collapse it, `draftAfterDismiss`
  preserves the draft. The logo's position is a globally-shared `{xFrac,yFrac}` fraction
  (`DEFAULT_OPEN_PROMPT_POSITION = {0.5, 0.96}` ≈ bottom-center) with full rAF drag physics.
- `CosmosPanel App.tsx PromptComposer mount panelRef ActiveTabSurface hoisted single instance render
  layout flex column` + `CosmosPanel render timeline composer onSubmit busy useCosmosConversation
  AppShell railVisibility active panel` → THE KEY CONSTRAINT: the composer is **ONE App-level hoisted
  instance** (`SharedComposer` in `App.tsx`), `absolute inset-0` overlay over the shared
  `surfaceRef` region, routed to whichever rail surface is active via `useActiveComposerConfig`. It
  floats over ALL panels (Terminal has none; Cosmos/Slack/Jira/Confluence/Google Calendar publish
  one). It deliberately has **no `key={surface}`** so the single instance, draft, drag position, and
  collapsed/expanded state are SHARED across panels (the open-prompt-hoist-v1 anti-flicker design).

**Files read directly:** `docs/ARCHITECTURE.md` §4.4 (the "Shared collapsible prompt composer"
paragraph — default-collapsed logo, float-as-overlay, collapses on submit/Esc/click-outside, `busy`
hides both states), §4.5 (headless agent); `src/renderer/App.tsx` (`AppShell` + `SharedComposer`);
`src/renderer/PromptComposer.tsx` (state machine + drag); `src/renderer/promptComposerLogic.ts`
(`submitDecision`, `escDecision`, `draftAfterDismiss`, `draftAfterSubmit`,
`shouldCollapseOnOutsideClick`); `src/renderer/openPromptPosition.ts` (fraction model + default
bottom-center); `.sdd/specs/cosmos-conversation-panel-v2.md` (Cosmos = transcript timeline, default
tab) and `.sdd/specs/cosmos-live-output-streaming-v1.md` (live streaming into the timeline).

**memory_recall / memory_smart_search queries run (one-line takeaways):**

- `Cosmos panel Open Prompt composer unified agent session persistent default agent conversation
  history` → empty (no prior memory hit).
- `Open Prompt composer collapse expand floating button Cosmos conversation panel` → empty.
- Cross-session `MEMORY.md` index notes the Cosmos direction (Conductor-style host, A2UI timeline) but
  nothing on the pinned-composer decision. A new memory will be persisted once this behavior is settled
  (see end).

---

## Overview

The Cosmos panel hosts the default-agent conversation timeline, and the **Open Prompt** input is how
the user drives that agent. Today the Open Prompt is a **collapsed-by-default, draggable floating
logo button** that only becomes an input when clicked, expands into a centered overlay card, and
**re-collapses on submit / Esc / click-outside**. The user wants the opposite for the Cosmos panel:
the Open Prompt input should be **pinned to the BOTTOM of the Cosmos panel and ALWAYS open** — a
fixed chat-style composer docked at the bottom edge, with the conversation timeline scrolling above
it, that never collapses or hides.

This is the FIRST of several planned Cosmos-panel fixes ("우선 / first"). It is scoped to ONLY
making the Open-Prompt composer a permanently-visible bottom-docked input on the Cosmos panel.
Broader Cosmos-panel rework (timeline layout, tabs, streaming polish, etc.) is explicitly out of
scope for this cycle.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice).

### The Open Prompt is always there, docked at the bottom · P1

**As a** cosmos user looking at the Cosmos conversation panel
**I want** the Open Prompt input to be permanently visible, docked to the bottom of the panel
**So that** I can type a command at any moment without first finding/clicking a button to open it —
it behaves like a chat input.

**Acceptance criteria:**
- Given I open (switch to) the Cosmos panel, when it renders, then a text input composer is already
  visible and ready at the bottom edge of the panel — I do NOT have to click anything to reveal it.
- Given I am looking at the Cosmos panel, when I do nothing, then the composer stays open; it never
  auto-collapses to a logo button or hides itself.
- Given the conversation timeline has content, when I look at the panel, then the timeline occupies
  the area ABOVE the composer and the composer is anchored below it (the composer does not overlap or
  cover the latest turns).

### Submit keeps the composer open · P1

**As a** cosmos user driving the default agent
**I want** the composer to stay open and ready after I send a command
**So that** I can fire off follow-up commands immediately, like a chat thread.

**Acceptance criteria:**
- Given I have typed a command, when I submit it (Enter or the Send control), then the command is
  sent to the default agent exactly as today AND the composer REMAINS open and visible (it does not
  collapse to a logo or launch-and-vanish).
- Given my submit was accepted, when it sends, then the input field clears, ready for the next
  command (existing `draftAfterSubmit` clear-on-success behavior).
- Given an agent run is in flight from my submit, when I look at the composer, then it is still
  visible and I can type the next command (the docked composer is never hidden by the run, unlike the
  old `busy`-hides-everything behavior).

### Scroll history while the composer stays put · P1

**As a** cosmos user reviewing my conversation
**I want** to scroll the timeline above while the composer stays pinned at the bottom
**So that** the input is always reachable no matter where I am in the history.

**Acceptance criteria:**
- Given a long conversation, when I scroll the timeline, then only the timeline scrolls; the docked
  composer stays fixed at the bottom of the panel.
- Given new turns stream in or land, when the conversation grows, then the composer stays anchored at
  the bottom (the growing timeline does not push the composer off-screen or out of the panel).

### Esc / click-outside no longer collapses the Cosmos composer · P2

**As a** cosmos user
**I want** pressing Esc or clicking elsewhere to NOT make the Cosmos input disappear
**So that** my always-open input stays open (consistent with "always pinned").

**Acceptance criteria:**
- Given the Cosmos composer is focused, when I press Esc, then the composer does NOT collapse/hide
  (it stays docked); Esc may still blur the field or be a no-op, but it never removes the input.
- Given the Cosmos composer is open, when I click elsewhere in the Cosmos panel (e.g. on the
  timeline), then the composer stays docked and visible.

### Empty Cosmos panel still shows the composer · P2

**As a** new user with no conversation yet
**I want** the docked composer present even in the empty state
**So that** I have an obvious place to type my first command.

**Acceptance criteria:**
- Given no conversation exists yet (fresh install / no submits), when I open the Cosmos panel, then
  the empty/idle state shows ABOVE and the docked composer is present at the bottom, inviting a first
  command.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.
> `[NEEDS CLARIFICATION]` flags genuine ambiguity (see Open Questions).

| ID     | Requirement |
|--------|-------------|
| FR-001 | On the Cosmos panel, the Open-Prompt composer MUST be rendered in an **always-open, expanded input state** — a docked text input + Send control — whenever the Cosmos panel is active. It MUST NOT default to, or fall back to, the collapsed logo-button state on the Cosmos panel. |
| FR-002 | The composer MUST be **docked to the bottom edge** of the Cosmos panel content area, with the conversation timeline occupying the region above it. The composer MUST remain at the bottom regardless of timeline length or growth (it is pinned, not in the normal scroll flow of the timeline). |
| FR-003 | The composer MUST NOT auto-collapse or hide on the Cosmos panel for ANY reason: not on submit, not on Esc, not on click-outside, and not while an agent run is in flight. Once the panel is shown, the input is continuously visible. |
| FR-004 | A successful submit MUST send the utterance to the default agent through the EXISTING path unchanged (the published `onSubmit` → `agent.submit`, wire `UiRenderTarget` stays `'generated-ui'`, the persistent `--session-id` session is untouched) and MUST clear the input draft (existing `draftAfterSubmit`), leaving the composer open and focused-ready for the next command. |
| FR-005 | While an agent run from a Cosmos submit is in flight, the docked composer MUST remain visible and the user MUST be able to continue typing/submitting (fire-and-forget, consistent with the existing non-blocking submit — `open-prompt-spinner-gating`). The in-flight/working affordance MUST be shown in the timeline region (as today), NOT by hiding the composer. |
| FR-006 | The composer's submit-accept rule MUST be preserved: an empty/whitespace-only value MUST NOT submit (existing `submitDecision`), and a malformed/non-string value MUST be safely rejected (no crash). |
| FR-007 | Esc and click-outside MUST NOT collapse/hide the Cosmos composer (FR-003). Esc on the Cosmos composer MAY blur the field or be a no-op, but MUST NOT remove the input; the existing `escDecision`/`shouldCollapseOnOutsideClick` collapse paths MUST be inert for the pinned Cosmos composer. |
| FR-008 | The empty, loading, and error states of the Cosmos timeline (from `cosmos-conversation-panel-v2`) MUST still render in the region above, with the docked composer present and usable in all of them (so a user can always type, even before any conversation exists or if the transcript read fails). |
| FR-009 | The pinned composer's layout MUST be **responsive to panel resize**: it stays docked and fully usable as the Cosmos panel is resized narrower/shorter; the timeline above flexes to the remaining height. The composer MUST NOT be clipped, pushed off-screen, or overlap the timeline content at any supported panel size. |
| FR-010 | A very long / multi-line input MUST be handled gracefully: the input grows (up to a bounded max height, then scrolls internally) WITHOUT pushing the composer off the bottom edge or covering the whole panel. Shift+Enter inserts a newline; Enter submits (existing hint copy "Enter to send · Shift+Enter for newline"). |
| FR-011 | The change MUST be scoped so it does NOT regress the floating/collapsible composer on the OTHER panels that share the one hoisted `PromptComposer` instance (Slack / Jira / Confluence / Google Calendar). Whatever mechanism makes the Cosmos composer pinned-and-open MUST leave the other surfaces' composer behavior unchanged. `[NEEDS CLARIFICATION]` — see OQ-1 on the shared-instance architecture. |
| FR-012 | The pinned composer MUST keep using the cosmos design-system styling (the `cosmos` Button variant, brand tokens, the shared design language) so it reads as part of the same UI; the exact docked-input visual treatment is established in the design step (this is a UI-bearing change — see "Design step required"). |

## Edge Cases & Constraints

- **Shared single composer instance (the central architectural tension).** The Open-Prompt composer
  is ONE App-level hoisted `PromptComposer` (`SharedComposer`), deliberately not re-mounted per panel
  (no `key={surface}`), so its expanded/collapsed + draft + drag state are SHARED across all panels.
  Making it "always open + bottom-docked" *only for Cosmos* therefore cannot just flip the global
  default — it must be a per-surface (Cosmos-vs-rest) behavior, or the Cosmos panel must get its own
  pinned composer separate from the shared floating one. This is the load-bearing design decision —
  see OQ-1. (The plan/design steps resolve the mechanism; the spec only requires the BEHAVIOR: pinned
  + always-open on Cosmos, unchanged elsewhere.)
- **Panel resize / very short panel.** When the Cosmos panel is made very short, the docked composer
  MUST stay usable (it does not get clipped away); the timeline above shrinks first. A minimum
  composer height is reserved before the timeline starts scrolling under pressure.
- **Streaming run in flight.** With live streaming (`cosmos-live-output-streaming-v1`), turns append
  to the timeline above while the composer stays docked below — the composer is never hidden by the
  `busy`/in-flight state on the Cosmos panel (departs from §4.4's "busy hides BOTH states" — that
  behavior is retained for the floating composer on OTHER panels but NOT for the pinned Cosmos one).
- **Focus behavior.** `[NEEDS CLARIFICATION]` whether the Cosmos composer should AUTO-FOCUS when the
  user switches to the Cosmos panel (chat-like) or only focus on click. Recommended: focus on panel
  activation so the user can type immediately, but do NOT steal focus from the embedded Terminal or
  from another panel — see OQ-2.
- **Drag position obsolete on Cosmos.** The globally-shared draggable `{xFrac,yFrac}` logo position
  is meaningless for a bottom-docked composer. On the Cosmos panel the composer is FIXED at the
  bottom (not draggable); the drag model still governs the floating logo on the OTHER panels. (No
  change to the shared position store is required — the Cosmos composer simply ignores it.)
- **Explicitly OUT OF SCOPE this cycle:** any broader Cosmos-panel rework (timeline rendering changes,
  tab strip changes, virtualization, markdown polish, streaming behavior); changing the composer on
  Slack/Jira/Confluence/Google Calendar (they keep the floating collapsible logo); changing the
  agent-submit / persistent-session / IPC contracts; removing the draggable-logo feature globally.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Switching to the Cosmos panel shows a text input composer already open and docked at the bottom — no click required to reveal it — in `npm run dev`. |
| SC-002 | The Cosmos composer never collapses/hides: after a submit, after Esc, after click-outside, and while a run streams, it remains visible and usable. |
| SC-003 | The conversation timeline scrolls in the region above while the composer stays pinned at the bottom; a growing/streaming timeline never pushes the composer off-screen. |
| SC-004 | A submit from the Cosmos composer drives the default agent exactly as before (same `agent.submit` path, `'generated-ui'` target, persistent session), clears the input, and leaves the composer open. |
| SC-005 | The empty, loading, and error states of the Cosmos panel all render with the docked composer present and usable. |
| SC-006 | The other panels' composer (Slack/Jira/Confluence/Google Calendar) is behaviorally UNCHANGED — still a floating, draggable, collapse-on-submit/Esc/outside-click logo. |
| SC-007 | At small/short panel sizes and with very long multi-line input, the composer stays docked, unclipped, and non-overlapping; `npm run typecheck` and `npm test` pass. |

---

## Design step required

This is a **UI-bearing** change (it changes a visible surface's layout and interaction model). Per the
cosmos workflow, a **design step (`design` skill, `designer` agent) MUST run between the plan and the
interface step** to establish the docked-composer visual treatment — bottom-dock layout, how it sits
against the timeline, input/Send sizing, multi-line growth bounds, focus/empty-state affordances —
using the existing Tailwind + shadcn/ui design system and brand tokens, so the pinned composer stays
visually uniform with the rest of cosmos. The design spec lands at
`.sdd/designs/cosmos-open-prompt-pinned-v1.md`.

---

## Open Questions

- [ ] **OQ-1 (shared-instance mechanism — the one real ambiguity):** The Open-Prompt composer is ONE
  App-level hoisted instance shared across all panels (no `key={surface}`), so "always open + bottom
  docked" cannot be a global flip without changing every panel. Two viable shapes: **(A)** parameterize
  the existing `PromptComposer` with a per-surface "pinned/docked" mode (a prop the `SharedComposer`
  passes only for the Cosmos surface) so the same instance renders docked-open on Cosmos and
  floating-collapsible elsewhere; OR **(B)** give the Cosmos panel its OWN dedicated bottom-docked
  composer and exclude Cosmos from the shared floating one. **Architect recommendation: (A)** —
  reuses the one composer + its submit/draft logic and the existing `useActiveComposerConfig` routing,
  with a `mode: 'docked' | 'floating'` flag driven off the active surface; (B) duplicates composer
  state and risks divergence. This is a BEHAVIOR-preserving question for the other panels — confirm
  (A) is acceptable before the plan commits the mechanism. (Resolved in the plan/design steps; does
  NOT block writing the spec.)
- [ ] **OQ-2 (focus on Cosmos activation):** Should the docked Cosmos composer AUTO-FOCUS when the
  user switches to the Cosmos panel (chat-like, type immediately), or only focus on click?
  Recommendation: focus on Cosmos activation but never steal focus from the Terminal PTY or another
  active panel. Confirm desired focus behavior.
