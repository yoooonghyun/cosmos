# Spec: Cosmos Timeline — Context + Message Combined Box — v1

**Status**: Draft
**Created**: 2026-06-29
**Supersedes**: —
**Related plan**: (to be authored at `.sdd/plans/cosmos-context-message-combined-box-v1.md`)

---

## Grounding

> Direct investigation run for this spec (mandatory architect grounding). Tools were run by the
> architect, not handed in. NOTE: the `wiki_query`/`wiki_ingest` LLM-wiki tools were NOT available
> in this session's toolset, so prior-decision grounding came from reading the in-repo source of
> truth instead — the sibling spec `cosmos-timeline-prompt-context-v1.md` and `docs/DESIGN.md`
> (D-11/D-14, §2 token map, §15 chat-surface canon). Flagging this so the gap is visible.

**codegraph_explore queries (one-line takeaways):**

- `CosmosTimelineEntry PromptContextChip UserBubble ToolCallRow` — `CosmosTimelineEntry.tsx` renders
  the `live-generating` and `user-prompt` cases as `flex flex-col gap-1` with `<PromptContextChip>`
  ABOVE `<UserBubble>`. `UserBubble` = a single right-aligned `<p>` with `bg-primary
  text-primary-foreground`, `rounded-2xl rounded-br-sm`, `max-w-chat-bubble`. `PromptContextChip`
  returns `null` when `context` is undefined (FR-021), else a right-aligned `Badge variant="secondary"`
  breadcrumb (panel › tab › ↳ dock) sharing the same `max-w-chat-bubble` token.
- `ToolCallRow sectioned box collapse header divider CosmosTimelineEntry` — `ToolCallRow` is the
  SECTIONED-box reference: an outer rounded box (`rounded-md border bg-muted/40`) with a HEADER button
  (toggle) and, `{open && …}`, a BODY section separated by `border-t border-border/60`. The body is
  COLLAPSIBLE (default `open=false`). This is the structural template the user is invoking — but the
  combined box must NOT collapse and is NOT muted-colored.

**Source-of-truth reads (prior decisions, in lieu of wiki):**

- `.sdd/specs/cosmos-timeline-prompt-context-v1.md` — the upstream feature that introduced
  `PromptContext` (panel/tab/dock), the `<cosmos:context>` marker, and `PromptContextChip`. FR-021
  (null context → render nothing / plain bubble) and FR-022 (chip visually consistent, "↳ item") are
  inherited invariants this feature must preserve.
- `docs/DESIGN.md` §2 + §15 + D-11/D-14 — D-14 = the chat-surface canon (`user-accent-right /
  assistant-plain-left`, shared `max-w-chat-bubble` 2/3 token). D-11 = "the prompt context chip sits
  ABOVE the user bubble as a quieter `Badge variant="secondary"` breadcrumb, sharing the
  `max-w-chat-bubble` token." This feature SUPERSEDES D-11's *placement* (above → in-bubble header).
  The designer updates D-11/§2/§15 in the design step — NOT edited here.

---

## Overview

In the Cosmos conversation timeline, merge the two separate affordances that today stack vertically —
the read-only prompt-context breadcrumb (`PromptContextChip`) ABOVE the user's message
(`UserBubble`) — into ONE combined message box. Inside a single right-aligned brand-accent bubble:
the context breadcrumb as a header section at the top, a horizontal divider, then the message body.
The message body is ALWAYS visible (never collapses). The change makes a prompt and the screen
context it was sent from read as one self-contained unit instead of two loosely-stacked pieces.

This is a **renderer-only** UI restructure of `src/renderer/cosmos/CosmosTimelineEntry.tsx`. It
introduces NO IPC/contract change, NO change to `PromptContext` capture/embed/parse, and NO change to
the breadcrumb's *content* — it relocates the existing breadcrumb from a free-standing pill above the
bubble to a header section inside the bubble.

---

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### A prompt and its context read as one combined box · P1

**As a** cosmos user
**I want to** see the screen context I sent a prompt from and the prompt's text inside a single
message box — context on top, a divider, then my message
**So that** a past prompt and the context it belongs to read as one self-contained unit rather than
two separately-floating pieces

**Acceptance criteria:**

- Given a historical user-prompt turn that has a parsed PromptContext, when it renders in the
  timeline, then the context breadcrumb and the message body appear inside ONE right-aligned bubble,
  with the breadcrumb as a header at the top, a horizontal divider beneath it, and the message body
  below the divider.
- Given that combined box, when it renders, then the WHOLE box (header + divider + body) carries the
  user bubble's `bg-primary` brand accent, is right-aligned, and is capped at the `max-w-chat-bubble`
  (2/3) width — it is NOT a neutral/muted tool-call-colored box.
- Given that combined box, when it renders, then the message body is ALWAYS visible — there is no
  toggle, no collapse, no click affordance on either the header or the body (explicitly the OPPOSITE
  of the tool-call row's collapsible body).
- Given that combined box, when the user reads the header, then it shows the SAME breadcrumb content
  as today's chip (panel › tab › ↳ dock item, with the existing `SURFACE_ICON`/`PRIMARY_ICON` glyphs
  and the D-11 breadcrumb idiom) — only its POSITION changed (in-bubble header, not a pill above).

### The live in-flight prompt uses the same combined box · P1

**As a** cosmos user
**I want to** see the same combined-box structure on my just-submitted (still generating) prompt as
on the confirmed historical one
**So that** the box does not visibly restructure or jump when the turn is confirmed from the
transcript

**Acceptance criteria:**

- Given I submit a prompt with an active context, when the live (`live-generating`) turn renders
  before the transcript confirms it, then it shows the identical combined box (context header +
  divider + always-visible body) that the historical (`user-prompt`) turn will show.
- Given the live turn transitions to the confirmed historical turn, when the timeline re-renders,
  then the combined box's structure is stable (the box does not change shape across the confirm), and
  the assistant's typing indicator / reply still renders below it as today.

### A prompt with no context renders as today's plain bubble · P1

**As a** cosmos user
**I want to** a prompt that had no captured/parsed context to look exactly like today's plain message
bubble
**So that** the new header + divider only appear when there is actually context to show — no empty
header, no dangling divider

**Acceptance criteria:**

- Given a user-prompt turn with NO parsed PromptContext (null/absent — pre-feature history, or a
  malformed marker that degraded to no-context), when it renders, then it shows exactly today's plain
  right-aligned `bg-primary` message bubble — NO context header, NO divider — just the body.
- Given the live (`live-generating`) turn with no captured context, when it renders, then it likewise
  shows only the plain message bubble (no header, no divider).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The Cosmos timeline MUST render the prompt context and the user's message as ONE combined message box, replacing today's two-element `flex flex-col gap-1` stack of `PromptContextChip` ABOVE `UserBubble`. |
| FR-002 | When a PromptContext is present, the combined box MUST contain, top to bottom: (1) a context-breadcrumb HEADER section, (2) a horizontal DIVIDER, (3) the message-body section. |
| FR-003 | The combined box MUST keep the user bubble's visual identity: the `bg-primary` brand accent fill, RIGHT alignment (`justify-end`), and the `max-w-chat-bubble` (2/3) width cap. The header, divider, and body MUST all live INSIDE this one right-aligned accent bubble. |
| FR-004 | The combined box MUST NOT be styled as a neutral/muted tool-call-colored box; it is the brand-accent user bubble, not the `bg-muted/40` inert-row treatment. (The tool-call row is only the structural — sectioned, header/divider/body — reference, not the color reference.) |
| FR-005 | The context header section MUST be STATIC: always shown (whenever context is present), with NO click target, NO toggle, NO expand/collapse, and NO `aria-expanded`/button affordance. |
| FR-006 | The message body MUST be ALWAYS visible — never collapsed, never behind a toggle. This is explicitly the OPPOSITE of the tool-call row, whose body collapses by default. |
| FR-007 | The context header MUST reuse the EXISTING `PromptContextChip` breadcrumb CONTENT verbatim: the panel › tab › ↳ dock segments, the `SURFACE_ICON`/`PRIMARY_ICON` glyphs, the `ChevronRight`/`↳` separators, the `TruncLabel` truncation, and the existing ARIA labeling — relocated from a free-standing pill ABOVE the bubble to a header section INSIDE the bubble. The breadcrumb's content, segment rules, and which dimensions show (panel always, tab when present, dock when a dock was open) MUST NOT change. |
| FR-008 | The header MUST show ONLY non-secret context (the existing `PromptContext` whitelist — panel/tab/dock display labels). No new field, no secret, is introduced; this feature does not touch capture/embed/parse. |
| FR-009 | When there is NO PromptContext (null/absent, the FR-021 case from the upstream feature), the combined box MUST render as exactly today's plain message bubble: the body only, with NO context header and NO divider. The header + divider MUST appear ONLY when a context is present. |
| FR-010 | The behavior in FR-001..FR-009 MUST apply IDENTICALLY to BOTH the live (`live-generating`) user turn AND the historical (`user-prompt`) turn, so the box structure is stable across the live→confirmed transition. |
| FR-011 | The message body MUST preserve today's text rendering: the submitted user prose rendered as auto-escaped React text with `whitespace-pre-wrap break-words` (multi-line prompts preserved), and — for the live turn — the clean, marker-stripped text exactly as today. No marker syntax is ever surfaced (inherited from the upstream feature; unchanged here). |
| FR-012 | This feature MUST NOT change any IPC contract, `PromptContext` shape, marker serialize/parse/strip logic, capture path, or grounding channel — it is a renderer-only restructure of `CosmosTimelineEntry.tsx` (and any header/box presentational component it factors out). |

## Edge Cases & Constraints

- **No context → plain bubble.** Null/absent context renders exactly today's plain `bg-primary`
  bubble — no header, no divider, just the body (FR-009). This is the most important regression to
  preserve: the divider must never appear alone.
- **Very long context breadcrumb.** A long panel/tab/dock label in the header MUST stay within the
  `max-w-chat-bubble` box and truncate as today (the existing `TruncLabel` + tooltip behavior), so the
  header never widens the box past the 2/3 cap or overflows horizontally. The combined box's width is
  governed by the message body and the shared width token, not by an over-long breadcrumb.
- **Long message body.** A long, multi-line message MUST wrap (`break-words`, `whitespace-pre-wrap`)
  and stay within the `max-w-chat-bubble` cap, exactly as today's `UserBubble`. The header sits above
  it unaffected.
- **Live → confirmed stability.** Because both the live and historical turns render the identical
  combined box (FR-010), confirming a turn from the transcript MUST NOT visibly restructure the box.
- **D-11 placement rule is SUPERSEDED.** DESIGN.md D-11 today reads "the prompt context chip sits
  ABOVE the user bubble" as a free-standing `Badge variant="secondary"` breadcrumb. This feature
  supersedes that PLACEMENT (above → in-bubble header). The breadcrumb CONTENT/idiom and the shared
  `max-w-chat-bubble` token are retained; only the position changes. The designer updates D-11 (and
  §2's "prompt context chip" token row + §15 chat-surface canon) in the design step — this spec does
  NOT edit DESIGN.md.
- **Implementation ordering (merge-conflict avoidance).** A developer is CONCURRENTLY implementing a
  SEPARATE panel-tab feature that also touches `CosmosTimelineEntry.tsx` and `PromptContextChip.tsx`.
  This is a SPEC document only (no code), so there is no conflict now — but the implementing session
  MUST land this feature AFTER that panel-tab feature merges, to avoid a merge clash on the shared
  files. Flag this in the plan as a sequencing dependency.
- **Out of scope (explicitly):** any change to PromptContext capture/embed/marker/parse/strip; any
  change to the breadcrumb's content, segments, glyphs, or which dimensions it shows; any change to
  the grounding channels (`viewContextGroundingClause`); any IPC/contract change; the exact
  in-bubble visual treatment of the header/divider (divider color/weight, header type/spacing, accent
  contrast of the breadcrumb on `bg-primary`) — that is the designer's call in the design step; any
  change to assistant/tool/surface turns.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A user-prompt turn WITH context renders as ONE right-aligned `bg-primary`, `max-w-chat-bubble`-capped box containing a context header, a horizontal divider, and an always-visible message body — top to bottom (FR-001/FR-002/FR-003). |
| SC-002 | The combined box has NO collapse/toggle: there is no clickable header, no `aria-expanded`, and the message body is visible at all times (FR-005/FR-006). |
| SC-003 | The header shows the SAME breadcrumb content as today's `PromptContextChip` (panel › tab › ↳ dock, same glyphs/separators/truncation/ARIA), only relocated inside the bubble (FR-007). |
| SC-004 | A user-prompt turn with NO context renders byte-for-behavior identically to today's plain `UserBubble` — no header, no divider, just the body (FR-009). |
| SC-005 | The live (`live-generating`) turn and the historical (`user-prompt`) turn render the identical combined-box structure, so the box does not restructure across the live→confirmed transition (FR-010). |
| SC-006 | A very long breadcrumb truncates within the box (tooltip preserved) and a long/multi-line message wraps within the `max-w-chat-bubble` cap — neither overflows or widens the box past 2/3 (Edge Cases). |
| SC-007 | No IPC contract, `PromptContext` shape, or marker logic is changed; the diff is renderer-only within `CosmosTimelineEntry.tsx` and any presentational header/box helper it factors out (FR-012). |
| SC-008 | The box is the brand-accent user bubble (`bg-primary`/`text-primary-foreground`), NOT the muted tool-call treatment, even though it borrows the tool-call row's sectioned structure (FR-004). |

---

## Open Questions

- None blocking. The confirmed decisions handed to this spec resolve structure (sectioned box,
  context-header → divider → always-visible body), color (keep `bg-primary` accent, right-aligned,
  `max-w-chat-bubble`), the static/no-collapse rule, the both-turns rule, and the null-context →
  plain-bubble rule. The remaining choices — the exact divider treatment (color/weight on the accent
  fill), header type/spacing, and how the breadcrumb's glyphs/labels read against `bg-primary`
  instead of `bg-secondary` (a contrast question now that the breadcrumb moves off the secondary
  surface onto the primary fill) — are deliberately deferred to the designer in the design step, not
  unresolved product behavior. The designer must also reconcile the breadcrumb's current
  `text-muted-foreground` glyph tone, which was tuned for the `bg-secondary` pill and may not read on
  `bg-primary`; flagged for the design step, not a spec-level open question.
```
