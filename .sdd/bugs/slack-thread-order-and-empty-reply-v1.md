# Bug Report: slack-thread-order-and-empty-reply (v1)

- **Status:** Fixed
- **Reported:** 2026-06-20
- **Severity:** broken
- **Regression:** Bug 1 — yes, latent since Slack history/replies were first mapped (no sort
  ever existed). Bug 2 — introduced this session with the thread dock + composer (#80/#83):
  the only open-thread trigger was gated on `replyCount > 0`.

This report covers TWO defects in the Slack panel found together.

## Symptom

- **Bug 1 (ordering):** the channel message list and the thread reply list do not agree on
  chronological direction. The native channel history shows the NEWEST message at the top
  (opposite of how Slack shows a channel), while the thread dock shows replies oldest→newest.
- **Bug 2 (reply-less message):** a message with zero replies offers no way to open its thread,
  so the user can never post the FIRST reply. The thread dock only opens via the "N replies"
  affordance, which renders only when a message already has replies.

## Expected vs Actual

- **Bug 1 — Expected:** channel = oldest→newest top-to-bottom; thread = parent first then
  replies oldest→newest; SAME direction in both. **Actual:** channel newest-first, thread
  oldest-first — inconsistent.
- **Bug 2 — Expected:** clicking any message opens its thread dock (parent + empty replies +
  composer) so the first reply can be posted. **Actual:** reply-less messages have no trigger
  at all.

## Reproduction

1. Connect Slack, open a channel with recent activity → newest message sits at TOP (Bug 1).
2. Open a thread with replies → replies read oldest→newest (opposite direction; Bug 1).
3. Find a message with zero replies → no clickable affordance; the dock cannot be opened to
   add the first reply (Bug 2).

## Scope & Severity

Both surfaces of the Slack panel (native browser + generative A2UI rows, which share
`SlackMessageRow`). Broken UX, not a crash. No secret/IPC implications.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle (no escalation to `sdd`).
- **Reason:** Bug 1 = one missing sort at a single pure mapping point; Bug 2 = broaden an
  existing renderer-local action's trigger. No new IPC contract, no new behavior beyond the
  existing open-thread action + #83 send path.

## Classification & Routing (Step 2)

- **Class:** Implementation defect (both).
- **Routed to:** developer.
- **Reason:** Bug 1 is a missing/incorrect sort in main-side mapping; Bug 2 is missing wiring
  of an already-correct context builder to a clickable region — neither needs design/spec change.

## Root Cause (Step 3)

### Bug 1 — no chronological sort; two endpoints disagree by default
- **Origin:** `src/main/integrations/slackClient.ts` — `toMessages` (was ~line 503) returned
  messages in raw Slack API order with NO sort. `conversations.history` (`getHistory`,
  line 310) returns messages **newest-first**; `conversations.replies` (`getReplies`, line 334)
  returns them **oldest-first** (parent first). The native `MessageList`
  (`src/renderer/SlackPanel.tsx:537`) renders `items` top-to-bottom verbatim.
- **Why:** with no normalization, the channel reads newest-at-top while the thread reads
  oldest→newest — the two views disagree. Even a naive fix is fragile: epoch `ts`
  ("seconds.micros") string/lexical compare misorders unequal-length integer parts
  (`"999.x"` would sort after `"1000.x"`).

### Bug 2 — open-thread trigger gated on replyCount > 0
- **Origin:** `src/renderer/slackCatalog/SlackMessageRow.tsx` — `RepliesAffordance` (line ~133)
  returns `null` when `replyCount <= 0`, and it was the ONLY element wired to `onOpenThread`.
- **Why:** the dock's sole entry point was the replies affordance, which never renders for a
  zero-reply message — so such a message has no trigger, even though the context builder
  `buildOpenThreadContext` (`src/renderer/slackCatalog/logic.ts`) already produces a valid
  open-thread context for it (it does not require `replyCount`).

## Fix (Step 4)

- **Files changed:**
  - `src/main/integrations/slackClient.ts` — added pure `compareTs` (numeric epoch compare) +
    `sortMessagesByTs` (ascending, non-mutating); `toMessages` now returns
    `sortMessagesByTs(mapped)`, so BOTH history and replies are normalized oldest→newest at the
    single mapping point. (Search uses its own inline mapping and is relevance-ranked — left
    untouched, out of scope.)
  - `src/renderer/slackCatalog/logic.ts` — added `messageRowOpenThread(row)` (the row-click
    open-thread decision; delegates to `buildOpenThreadContext`, so it works regardless of
    `replyCount`).
  - `src/renderer/slackCatalog/SlackMessageRow.tsx` — when `onOpenThread` is present the WHOLE
    row is now a `role="button"` / `tabIndex=0` trigger (Enter/Space activate, focus-visible
    ring, hover). A new pure `isPlainRowClick(target)` ignores clicks that are a text SELECTION
    or land on a nested interactive element (`a, button, img, [role="button"]`), so text
    selection, image-viewer thumbnails, links, and the existing replies affordance keep working
    and the row click does not double-fire.
- **Summary:** one canonical chronological order for channel + thread; every message row is a
  thread-dock trigger (reply-less included), without regressing the replies-count affordance,
  `cosmos-slack-img://` image rendering, or text selection.

## Regression Test (Step 5)

- **Test (Bug 1):** `src/main/integrations/slackClient.test.ts` — new `message ordering` block:
  - `compareTs` orders `"999.9"` before `"1000.0"` (numeric, not lexical) and tiebreaks by
    microsecond suffix.
  - `getHistory` returns oldest→newest when Slack returns newest-first.
  - `getReplies` returns parent-first then replies oldest→newest (same direction as the channel).
  - **Fails-without-fix confirmed:** yes — reverting `toMessages` to `return mapped` makes the
    `getHistory`/`getReplies` ordering tests fail; restoring the sort passes them.
- **Test (Bug 2):** `src/renderer/slackCatalog/logic.test.ts` — new `messageRowOpenThread` block:
  a reply-less row (no `replyCount`) still produces an open-thread trigger carrying its
  `channelId`/`threadTs` (== the message `ts`); a coord-less row yields `null`.
  - **Fails-without-fix confirmed:** the asserted helper `messageRowOpenThread` did not exist
    before the fix (the test would not compile/run against the original code).
- **Split honored:** logic lives in pure `.ts`; tests are node-env `.test.ts`; no `.tsx`
  imported into a `.test.ts`.

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web).
- [x] `npm test` green — 92 files, 1657 tests, incl. the new regression tests.
- [x] Original Step 1 reproduction reasoned through — channel + thread now share oldest→newest;
      reply-less message now clickable.
- [ ] UI surface exercised on a real Slack workspace — NOT done (no live GUI here). Needs
      manual check: (a) channel list reads oldest→newest top-to-bottom and matches the thread
      direction; (b) clicking a zero-reply message opens the dock with parent + empty replies +
      composer and a posted reply appears; (c) text selection inside a message, image-viewer
      thumbnails, and links still work without spuriously opening the dock; (d) keyboard
      Enter/Space on a focused row opens the dock.
- [x] No regressions in adjacent behavior — full suite green; the replies affordance, image
      rendering, and thread-header (parent has no `onOpenThread`) paths are preserved.

## Wrap-up (Step 7)

- **bug memory saved:** see memory_save below.
- **Docs updated:** none required (no new convention; existing open-thread action + send path
  reused). Consider a one-line gotcha in `docs/DEVELOPMENT.md` if the row-click vs
  text-selection interaction recurs.
- **wrap-up run:** pending (orchestrator).
