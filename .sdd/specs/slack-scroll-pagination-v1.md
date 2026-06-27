# Spec: Slack Scroll-Based History Pagination — v1

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: —
**Related plan**: .sdd/plans/slack-scroll-pagination-v1.md

---

## Grounding

Direct investigation by `architect` (not handed in):

- **codegraph_explore** `SlackPanel MessageList prependOlderMessages olderAbove cursor run LoadMoreButton`
  → native `MessageList` (`SlackPanel.tsx:549`) owns `items`/`cursor`/`run(next)`; older pages
  PREPEND via `prependOlderMessages` + re-sort ascending; top "Load older messages" button gated
  on `cursor`; self-scroll variant wraps rows in a Radix `ScrollArea` (`scroll=true`).
- **codegraph_explore** `SlackPanel.tsx MessageList olderAbove ... ScrollArea Load older messages`
  → confirmed the generative `MessageList` (`slackCatalog/components.tsx:305`) is a SEPARATE
  surface: its rows/loading/hasMore are BOUND paths, the older page is appended main-side by
  `AdapterDispatcher.run` (`adapterDispatcher.ts:301`, mode `append`) then re-ordered in the
  renderer by `orderBoundMessages`; load-more is a `LoadMoreButton` dispatching an adapter action,
  not a local `run`. No local `cursor`/`scrollHeight` handle.
- **Read** `slackScrollToLatest.ts` / `useSlackScrollToLatest.ts` → existing one-shot
  initial-load scroll-to-bottom; latches per mount (`alreadyScrolledRef`), supports `'self'` and
  `'radix-viewport'` scroller shapes. The new auto-load logic MUST coexist (must not fire during
  the initial bottom-jump, and the bottom-jump must not fire on prepend).
- **Grep** `SlackPanel.tsx` olderAbove/ScrollArea/run → native `MessageList` is reused in three
  homes (history `scroll=true olderAbove=true`, search, thread-dock `scroll=false olderAbove=false`).
- **memory_recall** / **memory_smart_search** `slack scroll pagination ... anchor` → no stored
  prior decision (empty). Honoring the briefed HARD CONSTRAINT (feedback-slack-per-list-scroll):
  the layout fill chain (`SLACK_LIST_SCROLL_CLASS`/`SLACK_LAYOUT_FILL_CLASS`, no `!flex-row`, no
  flex-wrap, per-list independent scroll) is OUT OF SCOPE — this is a scroll-event + fetch concern.

---

## Overview

In the Slack message history, replace the manual top "Load older messages" button as the PRIMARY
way to page older history with SCROLL-BASED pagination: when the user scrolls the history near the
TOP, the next older page auto-loads (infinite-scroll-up) and the user's current messages stay
visually in place (no jump). The existing manual button is KEPT as a visible fallback affordance.
This is a behavior change to the native history list only; the generative list is a noted follow-up.

## User Scenarios

### Auto-load older on scroll-up · P1

**As a** Slack user reading a long channel history
**I want to** keep scrolling up to reveal older messages without hunting for a button
**So that** browsing history feels continuous, like a real Slack client.

**Acceptance criteria:**

- Given a history list with an older page available (`cursor` set), when I scroll the viewport
  to within the near-top threshold, then the next older page loads automatically exactly once.
- Given an older-page load is already in flight, when I keep scrolling near the top, then no
  second load is triggered until the first completes.
- Given the cursor is exhausted (no older page), when I scroll to the very top, then nothing
  loads and no spinner appears.

### Scroll position preserved on prepend · P1

**As a** Slack user who just auto-loaded older messages
**I want to** stay anchored on the message I was reading
**So that** the view does not jump to the top and lose my place.

**Acceptance criteria:**

- Given older rows are prepended above my current view, when the prepend completes, then the
  message that was under my cursor stays at the same on-screen position (scroll anchored on the
  `scrollHeight` delta).
- Given the initial load lands the view at the bottom (newest), when older pages later prepend,
  then the initial bottom-jump does NOT re-fire.

### Manual button still works · P2

**As a** user on a list that does not overflow, or who prefers an explicit control
**I want to** still see and click "Load older messages"
**So that** I can page history when scroll cannot trigger it.

**Acceptance criteria:**

- Given a short history that does not overflow the viewport (no scroll possible), when a cursor
  exists, then the top button is shown and loads the older page on click.
- Given I click the button while a scroll-triggered load is in flight, then only one load runs
  (the button is disabled during any in-flight older-page load).

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The native history `MessageList` (self-scrolling, `olderAbove=true`) MUST auto-load the next older page when the scroll viewport reaches within a near-top threshold of the top. |
| FR-002 | The auto-load MUST fire `run(cursor)` AT MOST ONCE per qualifying scroll: it MUST be guarded so it does not fire while an older-page load is in flight, and MUST not re-fire on the scroll changes caused by the prepended content settling. |
| FR-003 | The auto-load MUST NOT fire when no older page exists (`cursor` undefined/exhausted). |
| FR-004 | On a successful older-page prepend, the system MUST preserve the user's visual scroll position by anchoring on the scrollHeight delta (new `scrollTop = oldScrollTop + (newScrollHeight − oldScrollHeight)`), measured on the SAME scroller the initial scroll-to-latest uses (the Radix viewport for the history list). |
| FR-005 | The auto-load MUST NOT trigger during, or interfere with, the existing one-shot initial scroll-to-latest (bottom-jump): the initial load lands at the bottom and only a genuine near-top scroll afterward may auto-load. |
| FR-006 | The existing manual "Load older messages" button MUST be kept as a visible fallback, disabled while any older-page load (scroll- or click-triggered) is in flight, and hidden when the cursor is exhausted (current behavior). |
| FR-007 | A failed older-page load MUST NOT corrupt state: the existing rows/cursor remain, the in-flight guard clears so a later scroll/click can retry, and the existing error affordance applies. |
| FR-008 | Rapid scrolling MUST collapse to a single in-flight older-page load (the guard, not unbounded fetches); a debounce/rAF MAY be used but the in-flight guard is the authority. |
| FR-009 | A short list that does not overflow (no scrollable height) MUST behave exactly as today — no auto-load fires (no near-top event), the manual button remains the path (FR-006). |
| FR-010 | The pure "should I auto-load older now?" decision (given scrollTop, threshold, in-flight, has-cursor) MUST live in a node-testable `.ts` (the `.ts`/`.test.ts` split), with the DOM measurement/anchoring in the hook. |
| FR-011 | The change MUST be scoped to scroll-event + fetch behavior and the scroll-anchor; it MUST NOT alter the Slack layout fill chain (`SLACK_LIST_SCROLL_CLASS`/`SLACK_LAYOUT_FILL_CLASS`), per-list independent scroll, scrollbar-hover-only, `olderAbove`/`prependOlderMessages`, or the IPC contract. |
| FR-012 | The thread-dock reply variant (`scroll=false`, `olderAbove=false`) and the search variant MUST be unaffected: scroll-up auto-load applies ONLY to the self-scrolling `olderAbove=true` history list. |
| FR-013 | The generative `slackCatalog` `MessageList` is OUT OF SCOPE for v1 (its older page is accumulated main-side via the shared `AdapterDispatcher`, not a local `run`/`cursor`/`scrollHeight`); it keeps its manual top `LoadMoreButton`, and scroll-pagination for it is a noted follow-up. |

## Edge Cases & Constraints

- **Cursor exhausted** — once `cursor` is undefined, the top sentinel/button disappear and no
  scroll event can load (FR-003, FR-006).
- **Failed page** — error surfaces via the existing path; guard clears; current rows intact (FR-007).
- **Rapid scroll-up flicks** — coalesced to one in-flight load by the guard (FR-008).
- **Short / non-overflowing list** — no scrollbar, no near-top event; manual button only (FR-009).
- **Coexistence with initial bottom-jump** — initial load lands at bottom; auto-load only on a
  real subsequent near-top scroll (FR-005).
- **Anchor math source of truth** — measured on the Radix `[data-slot="scroll-area-viewport"]`
  scroller (the same element `useSlackScrollToLatest` finds for `'radix-viewport'`), captured
  BEFORE the prepend re-renders and re-applied in the SAME layout effect (FR-004).
- **Out of scope:** generative-list scroll pagination (FR-013); any layout/flex/scrollbar change
  (FR-011); thread-dock/search lists (FR-012); newer-direction ("load newer") pagination.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Scrolling a long history to near-top auto-loads exactly one older page; continuing up after it lands loads the next — with no double-fires (observed via a single `run(cursor)` per page). |
| SC-002 | After each prepend the message previously under the cursor stays at the same on-screen Y (no visible jump). |
| SC-003 | The initial open / channel-switch still lands at the newest (bottom) message and the auto-load never fires on that initial render. |
| SC-004 | The manual "Load older messages" button still appears (esp. on short/non-overflowing lists), still loads on click, and is disabled during any in-flight load. |
| SC-005 | Node tests cover the should-auto-load decision across scrollTop/threshold/in-flight/has-cursor combinations; existing Slack/typecheck/test suites stay green; no layout-class diff. |

---

## Open Questions

- None blocking. RECOMMENDATIONS taken in-spec (open to override at plan review):
  (1) KEEP the manual button as a fallback rather than remove it — required for short
  non-overflowing lists and as an explicit affordance (FR-006/FR-009).
  (2) Scope v1 to the NATIVE history list; treat the generative `slackCatalog` `MessageList`
  as a follow-up because its pagination is main-side adapter accumulation, not a local
  `run`/`cursor`/`scrollHeight` the renderer can anchor (FR-013).
  (3) No design step — reuses existing rows/button/ScrollArea, adds zero visual surface; this is
  behavior-only.
