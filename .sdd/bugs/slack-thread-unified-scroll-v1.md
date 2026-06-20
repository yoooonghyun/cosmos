# Bug Report: slack-thread-unified-scroll (v1)

- **Status:** Fixed
- **Reported:** 2026-06-21
- **Severity:** degraded
- **Regression:** yes — introduced by the #101 fix (`slack-replies-focus-thread-scroll-v1`), which wrapped the root body in its own `max-h-[40%]` ScrollArea, creating a second scroll region.

## Symptom

In the right-docked Slack thread panel (`SlackThreadPanel`), the root message body (본문)
now scrolls in ITS OWN scroll region, separate from the replies (댓글) list scroll. The user
reports they are two different scrolls and wants them to share one:

> "slack thread에 본문에 스크롤이 생겼는데, 댓글과 본문이 다른 scroll로 이루어진듯..? 같은 scroll을 공유하도록 수정해줘."

## Expected vs Actual

- **Expected:** The root message body and the replies list scroll TOGETHER as a single scroll
  region. The dock header and the reply composer stay fixed; everything between them (root +
  "N replies" divider + replies) scrolls as one.
- **Actual:** Two independent scroll containers — the root body scrolls within its own capped
  `max-h-[40%]` ScrollArea, and the replies `MessageList` scrolls within its own `flex-1`
  ScrollArea. The user has to scroll each separately.

## Reproduction

1. Open the Slack panel, open a channel history, click a message's "N replies" affordance to
   dock the thread on the right.
2. Open a thread whose ROOT message body is long (multi-paragraph) AND that has several replies.
3. Observe: scrolling over the root body moves only the root (capped at 40% height); scrolling
   over the replies moves only the replies — two separate scrollbars / scroll gestures.

## Scope & Severity

Single surface (the native Slack thread dock); no crash, no data loss — a layout/UX degradation.
One renderer file owns it (`SlackPanel.tsx`), plus a tiny pure layout helper extracted to
`slackThreadPanelLogic.ts`.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in one renderer component (two-scroll structure); pure
  layout/CSS restructure, no new IPC contract, no cross-layer change.

## Classification & Routing (Step 2)

- **Class:** Implementation defect (layout structure)
- **Routed to:** developer
- **Reason:** the defect is in how the thread dock JSX nests scroll containers, not in the
  design intent (one shared scroll) or any contract.

## Root Cause (Step 3)

The #101 fix solved "a long root body pushes the replies out of view" by giving the root its
OWN scroll region, but that produced two independent scrolls.

- **Origin:** `src/renderer/SlackPanel.tsx` — in `SlackThreadPanel`, the root was wrapped in
  `<ScrollArea className="max-h-[40%] shrink-0 bg-muted/30">` (the root's own scroll region),
  while the replies `MessageList` rendered into a `min-h-0 flex-1` wrapper and `MessageList`
  itself always wrapped its body in `<ScrollArea className="h-full">` (the replies' own scroll
  region). Two sibling ScrollAreas under the same flex column = two independent scrolls.
- **Why:** Each `ScrollArea` (Radix viewport) establishes its own `overflow` context. With the
  root capped at `max-h-[40%]` in one ScrollArea and the replies in another, a long body
  scrolls only within the root's 40% box and the replies scroll only within their flex box —
  exactly the two-scroll symptom.

## Fix (Step 4)

Restructure the dock so a SINGLE `ScrollArea` wraps BOTH the root block AND the replies list,
with the "N replies" divider as an inline section header inside that same scroll. Only the dock
header (above) and the composer (below) stay fixed outside the scroll.

- **Files changed:**
  - `src/renderer/SlackPanel.tsx`
  - `src/renderer/slackThreadPanelLogic.ts`
  - `src/renderer/slackThreadPanelLogic.test.ts`
- **Summary:**
  - In `SlackThreadPanel`, replaced the root's `max-h-[40%] shrink-0` ScrollArea + the replies'
    independent `flex-1` scroll with ONE `<ScrollArea className="min-h-0 flex-1">` wrapping the
    root block, the "N replies" divider (now a plain inline header, no `shrink-0`), and the
    replies list. The root grows with its content and scrolls together with the replies.
  - Added an optional `scroll` prop to the shared native `MessageList` (default `true`). When
    `false`, `MessageList` renders its body BARE (no inner `ScrollArea`) so it flows inside the
    dock's single shared ScrollArea instead of establishing a second scroll region. The history
    view keeps the default (`scroll` true → its own `ScrollArea h-full`), so it is unaffected.
  - Extracted the layout decision into a pure helper `messageListWrapClass(scroll)` in
    `slackThreadPanelLogic.ts` (`true → 'h-full'`, `false → 'h-auto'`) and wired it as the
    single source of the wrapper class, so the decision is node-testable.
  - Left #95's row-click (`onOpenThread`) logic and #92's context chip untouched; the shared
    `SlackMessageRow` is unchanged.

## Regression Test (Step 5)

This is primarily a layout/CSS fix. The one cleanly testable decision — which scroll mode the
shared `MessageList` is in — is captured by the pure helper.

- **Test:** `src/renderer/slackThreadPanelLogic.test.ts` — new `describe('messageListWrapClass …')`.
- **Asserts:** `scroll=true → 'h-full'` (history owns its scroll), `scroll=false → 'h-auto'`
  (thread dock flows in the shared scroll), and `scroll=false` never returns `'h-full'` (i.e.
  the replies never re-establish their own full-height scroll region — the second-scroll bug).
- **Fails-without-fix confirmed:** the helper and the `scroll=false` path did not exist before
  the fix; the prior code unconditionally returned `<ScrollArea className="h-full">`, so the
  thread dock always produced a second scroll region. The new assertions encode the corrected
  single-scroll decision.
- **Note (visual-only remainder):** the actual single-vs-double scroll containment is a DOM/CSS
  outcome not exercised by the node test. It needs an `npm run dev` eyeball: open a thread with a
  long root body + several replies and confirm one scrollbar moves root + replies together while
  the header and composer stay fixed.

## Verification (Step 6)

- [x] `npm run typecheck` green (exit 0)
- [x] `npm test` green incl. the new regression test (`slackThreadPanelLogic.test.ts`: 19 passed)
- [ ] Original Step 1 reproduction re-run — symptom gone (needs `npm run dev` eyeball; pure
      layout change not exercisable in headless tests — see note above)
- [ ] UI surface exercised (renderer fix) — golden path + long-root-body edge case (needs
      `npm run dev` eyeball)
- [x] No regressions in adjacent behavior — only the thread dock passes `scroll={false}`; the
      history `MessageList` (line ~1292) keeps the default `scroll` true → unchanged scroll
      behavior. `messageListWrapClass` is the sole new branch.

## Wrap-up (Step 7)

- **bug memory saved:** see memory_save below.
- **Docs updated:** none required (no new convention; reuses the existing ScrollArea idiom and
  the `.ts`/`.test.ts` split already documented in DEVELOPMENT.md).
- **wrap-up run:** pending end-of-iteration wrap-up.
