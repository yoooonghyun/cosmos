# Bug Report: slack-thread-open-click (v1)

- **Status:** Fixed
- **Reported:** 2026-06-21
- **Severity:** broken
- **Regression:** yes — broke at #88 (whole-row `role="button"` + `isPlainRowClick` guard + `messageRowOpenThread()`)

## Symptom

In the Slack panel, hovering a message row changes the cursor to a pointer (the row
looks clickable), but CLICKING the message does NOT open the thread side-panel/dock.
Reported against cosmos #95.

## Expected vs Actual

- **Expected:** A plain click anywhere on a message row (that carries thread coordinates)
  opens the thread dock. Clicks on genuinely nested controls (links, buttons, image
  thumbnails, the "N replies" affordance) and text-selection drags must NOT open it.
- **Actual:** No click ever opens the thread. The cursor still changes (role/CSS apply),
  but the click handler is short-circuited on every plain click.

## Reproduction

1. Open the Slack panel, view a channel's messages (each row carries `channelId` +
   `threadTs`, so the whole row is wired as an open-thread trigger).
2. Hover a message — cursor becomes a pointer (row appears clickable).
3. Click on the message body (a plain, non-interactive area).
4. Observe: the thread dock does NOT open. (Before #88 it opened via the "N replies"
   affordance; #88 made the whole row clickable but the guard suppresses every click.)

## Scope & Severity

Single root cause in one renderer file (`SlackMessageRow.tsx`), shared by BOTH the native
Slack panel and the generated catalog row, so it breaks the thread-open affordance on every
Slack message surface. Broken (core affordance dead), regression from #88. Not a crash.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in one renderer file; the decision logic is extractable to
  the existing `slackCatalog/logic.ts` seam — no new contract, no cross-layer change.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** developer
- **Reason:** the guard's DOM walk has a logic error (matches the row element itself); the
  intended behavior is unchanged — only the implementation of the nested-interactive check
  is wrong.

## Root Cause (Step 3)

- **Origin:** `src/renderer/slackCatalog/SlackMessageRow.tsx:73` (pre-fix)
- **Why:** `isPlainRowClick` skipped clicks on nested interactive elements via

  ```ts
  if (target.closest('a, button, img, [role="button"]')) { return false }
  ```

  #88 made the WHOLE row `role="button"` (line ~207, `rowClickProps.role = 'button'`) so the
  whole row is an open-thread trigger. But `closest()` walks ancestor-OR-SELF, so on a plain
  click anywhere in the row the click target's nearest `[role="button"]` ancestor IS THE ROW
  ITSELF. `closest('[role="button"]')` therefore returned the row element (non-null) on EVERY
  plain click → `isPlainRowClick` returned `false` → `onClick` never called `onOpenThread()`.
  The cursor still changed because the `cursor-pointer` class + `role="button"` are applied
  regardless; only the click handler was short-circuited. A correct root cause predicts the
  reproduction exactly: every plain click is wrongly classified as "landed on a nested
  interactive element."

## Fix (Step 4)

- **Files changed:**
  - `src/renderer/slackCatalog/SlackMessageRow.tsx`
  - `src/renderer/slackCatalog/logic.ts`
  - `src/renderer/slackCatalog/logic.test.ts`
- **Summary:** Scope the nested-interactive check so it does NOT match the row element
  itself.
  - `isPlainRowClick(target, row)` now takes the row element (`e.currentTarget`) and computes
    `onNestedInteractive = hit !== null && hit !== row` — a `closest()` match equal to the row
    is treated as NOT nested (only a STRICTLY nested descendant control suppresses the open).
  - The pure selection/decision seam is extracted to `logic.ts` as
    `shouldOpenThreadOnRowClick(hasTextSelection, onNestedInteractive)` (returns
    `!hasTextSelection && !onNestedInteractive`) so the decision is node-testable without a
    DOM / without importing the `.tsx`.
  - The call site passes `e.currentTarget` into `isPlainRowClick`.

  Intent preserved: a text-selection drag and clicks on real nested links/buttons/images/the
  replies button still do NOT open the thread; a plain click anywhere else on the row DOES.
  Minimal, bugfix-scope — no refactor of the row's structure or behavior. Did not touch
  `SlackPanel.tsx` (kept clear of #92's just-landed view-context changes; root cause was not
  there).

## Regression Test (Step 5)

- **Test:** `src/renderer/slackCatalog/logic.test.ts` →
  `describe('shouldOpenThreadOnRowClick (whole-row open-thread click — bug slack-thread-open-click-v1)')`
- **Asserts:**
  - FIX: a plain click on the row body (row EXCLUDED from the nested-interactive walk) →
    `onNestedInteractive=false` → `shouldOpenThreadOnRowClick(false,false)===true` (opens).
  - BUG reproduction: WITHOUT excluding the row, `closest` matches the row →
    `onNestedInteractive=true` → decision is `false` (never opens) — the documented defect.
  - A genuinely nested control (inner link/button/image) → does NOT open.
  - An active text selection → does NOT open even on a plain click.

  The test models the `.tsx`'s DOM walk with a minimal node-only `closest` (no jsdom, no
  `.tsx` import), parameterized by whether the row is excluded — so it captures the exact
  bug mechanism.
- **Fails-without-fix confirmed:** yes — flipping the FIX case's modeled walk to the
  pre-fix `excludeRow=false` path made that assertion FAIL (decision returned `false`, i.e.
  thread never opens); restoring the row-exclusion makes it pass. This is precisely the
  before/after behavior of the live `.tsx` change.

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web)
- [x] `npm test` green for the changed files — `slackCatalog/logic.test.ts` 45/45 pass
      (was 41; +4 regression assertions). Full suite: the only failure is
      `src/main/integrations/confluenceClient.test.ts` (Confluence webUrl enrichment, #87) —
      a file this fix did not touch; a transient cross-track failure per the task note.
- [x] Original Step 1 reproduction reasoned through — a plain row click now yields
      `onNestedInteractive=false` → `onOpenThread()` runs → dock opens.
- [ ] UI surface exercised live — NOT done (no running Electron app in this cycle). The fix
      is a pure logic correction proven by the node test + typecheck; the rendered click
      path was not exercised in a live window.
- [x] No regressions in adjacent behavior — `isPlainRowClick` is called only from
      `SlackMessageRow.tsx` (codegraph: 1 caller); the shared row is consumed by both the
      native panel and the catalog node, both unchanged in structure.

## Wrap-up (Step 7)

- **bug memory saved:** see memory_save below
- **Docs updated:** none required (no new convention; the closest-matches-self gotcha is
  captured in the bug report + code comments)
- **wrap-up run:** pending (orchestrator)
