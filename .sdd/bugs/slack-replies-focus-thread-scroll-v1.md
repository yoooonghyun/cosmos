# Bug Report: slack-replies-focus-thread-scroll (v1)

- **Status:** Fixed
- **Reported:** 2026-06-21
- **Severity:** degraded (both defects: a focus/interaction nuisance + a clipped-content layout bug)
- **Regression:** Defect 1 — no (the replies affordance has been a focusable `<Button>` since the
  shared-row unification); Defect 2 — no (the thread dock never capped the root body height).

## Symptom

Two defects in the native Slack panel, both reported by the user (Korean):

- **Defect 1:** "메세지의 replies에 포커스 상호작용 없어도 될듯." — the per-message "N replies"
  affordance is a separate focus/keyboard target (own tab stop + focus ring). The user wants it
  to NOT be focus-interactive.
- **Defect 2:** "thread dock에서 본문이 긴경우 스크롤이 없고 댓글 ui가 밀려서 보이지 않음." — in the
  right-docked thread panel, a long root-message body (본문) has no scroll, so the replies (댓글)
  list below it is pushed down and clipped out of view.

## Expected vs Actual

- **Expected (D1):** The whole message row is the open-thread trigger (from #88/#95). The "N replies"
  label should not be a standalone tab stop / focus target — clicking it (via the row) still opens
  the thread.
- **Actual (D1):** The "N replies" affordance rendered a real shadcn `<Button>` (a `<button>`
  element), so it was an independent tab stop with a focus ring, redundant with the row-level
  open-thread trigger.
- **Expected (D2):** The thread dock header + reply composer stay fixed; the root anchor and the
  replies list each remain visible and scroll their own overflow.
- **Actual (D2):** A long root body grew unbounded and consumed the replies' flex space, clipping
  the 댓글 list out of view (no scroll anywhere on the root).

## Reproduction

Defect 1:
1. Connect Slack, open a channel with a threaded message (replyCount > 0).
2. Tab through the message list — focus lands on the "N replies" button as a separate stop with a ring.

Defect 2:
1. Open a thread whose root message body is very long (many lines).
2. Observe the root body fills the dock; the "N replies" divider + replies list are pushed below the
   visible region and clipped; no scrollbar lets you reach them.

## Scope & Severity

Contained to the native Slack panel renderer (`SlackPanel.tsx` + the shared `SlackMessageRow.tsx`).
Affects every threaded message row (D1) and every long-rooted thread (D2). No crash; degraded UX.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** Both are single-layer (renderer) markup/CSS corrections — no new IPC contract, no new
  behavior, no cross-layer change. Not feature-sized.

## Classification & Routing (Step 2)

- **Class:** Implementation defect (markup / layout)
- **Routed to:** developer
- **Reason:** Pure presentation fixes against existing components — no design-system decision (no
  new token / no new component); reuses the existing `ScrollArea` idiom and existing palette tokens.
  Nothing required escalation to the designer.

## Root Cause (Step 3)

### Defect 1 — replies affordance is a standalone focus target

- **Origin:** `src/renderer/slackCatalog/SlackMessageRow.tsx`, `RepliesAffordance` interactive
  branch (pre-fix line ~180: `return <Button type="button" variant="link" size="xs" ...>`).
- **Why:** The interactive variant rendered a shadcn `<Button>`, which is a real `<button>` —
  inherently focusable (own tab stop) with a `focus-visible` ring. Since #88/#95 the WHOLE ROW is
  the open-thread trigger (`role="button"` + the row's `onClick` → `isPlainRowClick` → `onOpenThread`),
  so the button is a redundant second focus target. Note: `isPlainRowClick` treats a click landing
  on a nested `<button>` as "nested interactive" and bails — so the click was being handled by the
  Button's OWN `onClick`, not the row. Making the label a plain (non-button) text node both removes
  the focusability AND lets the row-level click open the thread (the label is no longer a nested
  control, so `isPlainRowClick` returns true).

### Defect 2 — thread dock root body has no scroll cap

- **Origin:** `src/renderer/SlackPanel.tsx`, `SlackThreadPanel` root block (pre-fix line ~787:
  `<div className="bg-muted/30 [&>div]:border-b-0"><MessageRow message={parent} /></div>`).
- **Why:** The dock is a flex column (`flex h-full flex-col`). The root block was neither `shrink-0`
  nor height-capped, while the replies `MessageList` is `min-h-0 flex-1`. A long root body grows to
  its intrinsic content height and, with no `max-height` + no `overflow`, eats the column so the
  `flex-1` replies region is squeezed below the visible area and clipped — a classic flex-overflow
  bug (the content can't scroll and overflows instead).

## Fix (Step 4)

- **Files changed:**
  - `src/renderer/slackCatalog/SlackMessageRow.tsx`
  - `src/renderer/SlackPanel.tsx`

- **Summary:**
  - **D1:** Replaced the interactive `<Button>` in `RepliesAffordance` with a plain
    `<p className="text-xs font-medium text-primary hover:underline">{label}</p>`. It carries NO
    `tabIndex`, NO `role`, and is NOT a `<button>`, so it is never an independent focus target; it
    keeps a clickable-affordance look (primary color + hover underline). Because it is now plain
    text, `isPlainRowClick` no longer treats it as a nested control, so a click on the label bubbles
    to the row's `onClick` and opens the thread — the open-thread behavior is preserved via the
    row, not a separate handler. The non-interactive variant (no `onOpenThread`) was already a plain
    muted `<p>` and is unchanged. Removed the now-unused `Button` import.
  - **D2:** Wrapped the dock root block in the shared `ScrollArea` with `max-h-[40%] shrink-0`
    (`<ScrollArea className="max-h-[40%] shrink-0 bg-muted/30"><MessageRow message={parent} /></ScrollArea>`),
    and made the dock header and the "N replies" count divider `shrink-0`. The root anchor now scrolls
    its own overflow and never consumes the replies' flex space; the replies `MessageList` keeps its
    own `min-h-0 flex-1` scroll; header + composer stay fixed. The old `[&>div]:border-b-0` border
    override was dropped because the sole-child row's existing `last:border-b-0` already suppresses
    its bottom border. No new component, no new token — reused the existing `ScrollArea` idiom and
    palette tokens.

## Regression Test (Step 5)

- **Test:** none added — both fixes are markup/CSS-only with no extractable pure logic.
- **Asserts / rationale:**
  - **D1 is markup-only.** The interactivity is structural (a `<Button>` vs a `<p>`), not a value a
    pure helper computes — `RepliesAffordance` branches solely on `onOpenThread` presence. The
    node-env `.ts`/`.test.ts` split (no `.tsx`/DOM import) cannot capture "this element has no
    `tabIndex`/`role`". The relevant decision seam, `shouldOpenThreadOnRowClick`, is already covered
    in `slackCatalog/logic.test.ts` (a plain row-body click opens; a genuinely nested control does
    not). With the label now a plain text node it falls under the existing "plain row click opens"
    coverage. Visually verified instead (see Verification).
  - **D2 is pure CSS/layout** (`shrink-0`, `max-h-[40%]`, `ScrollArea`). There is no reasonable
    layout decision to extract to `logic.ts` — it is a flex-overflow class correction. Visual-only;
    verified by inspection of the layout classes (no logic test added).
- **Fails-without-fix confirmed:** n/a (no logic test); markup/CSS only.

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web; the transient `renderPushedForRun` unused error from
  in-flight #97 did not appear in this run)
- [x] `npm test` green — 99 files / 1883 tests passed (no new regression test; existing
  `shouldOpenThreadOnRowClick` coverage still green)
- [ ] Original Step 1 reproduction re-run in a running app — NOT exercised: Electron (`npm run dev`)
  was not launched in this environment, so the live focus behavior (D1) and the dock scroll (D2)
  were verified by code/markup inspection only, not by clicking in the running app. Flagging
  explicitly per instructions: both are visual/renderer fixes that should be eyeballed in `npm run dev`.
- [x] UI surface reasoning: D1 — replies label is no longer a `<button>`/`role`/`tabIndex`, so it is
  not a tab stop; row click still opens thread. D2 — root block is `shrink-0` + `max-h-[40%]` inside
  `ScrollArea`; replies list keeps `min-h-0 flex-1`; header/divider/composer are `shrink-0`.
- [x] No regressions in adjacent behavior: the row-level open-thread (#88/#95) is preserved (the
  label is now plain text, so `isPlainRowClick` returns true for clicks on it); the non-interactive
  degraded label and the image-thumbnail buttons are untouched.

## Wrap-up (Step 7)

- **bug memory saved:** pending (orchestrator/wrap-up)
- **Docs updated:** none required (no new convention; existing `ScrollArea` idiom + palette tokens
  reused). If desired, the "long root body scroll cap" detail could be noted in `docs/DEVELOPMENT.md`
  under the thread-dock layout, but it is a localized layout correction, not a new convention.
- **wrap-up run:** no (developer scope ends here; do not commit)
