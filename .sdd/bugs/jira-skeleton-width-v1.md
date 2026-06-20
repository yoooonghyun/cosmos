# Bug Report: jira-skeleton-width (v1)

- **Status:** Fixed (pending user GUI verify)
- **Reported:** 2026-06-20
- **Severity:** cosmetic (layout jump)
- **Regression:** no — surfaced after the generative-wrap clamp (#79) made the rendered
  Jira surface full-width, leaving the loading skeleton narrower than the content it replaces.

## Symptom

User: "jira는 이제 width에 꽉차게 그리는거 같은데, skeleton도 widht에 꽉차게 그려줘." The rendered
Jira surface (default list + board) now fills the panel width, but the loading skeleton does
not, so the skeleton→content swap jumps the data region's horizontal extent.

## Expected vs Actual

- **Expected:** The loading skeleton fills the panel width, matching the now-full-width
  rendered surface; no horizontal jump on swap.
- **Actual:** `KanbanBoardSkeleton` used fixed-width `w-64 shrink-0` columns inside an
  `overflow-x-auto` container, so the board skeleton was narrower than the full-width board.

## Root Cause (Step 3)

- **Origin:** `src/renderer/JiraPanel.tsx` — `KanbanBoardSkeleton`. Columns carried
  `flex w-64 shrink-0 flex-col gap-2` and the container `flex gap-3 overflow-x-auto`. The
  real board renders via the width-clamped `Column` wrapper (`JIRA_LAYOUT_CLAMP_CLASS =
  'w-full min-w-0 max-w-full'`, jiraCatalog/layout.tsx), so it fills the panel; the
  fixed-width skeleton columns did not, mismatching on swap. (`DefaultViewSkeleton` /
  `SkeletonCard` are block flex-col elements and already fill width; their roots were also
  given explicit `w-full min-w-0` for parity.)

## Fix (Step 4)

- **Files changed:** `src/renderer/JiraPanel.tsx`
- **Summary:** `KanbanBoardSkeleton` container `flex gap-3 overflow-x-auto` →
  `flex w-full min-w-0 gap-3`; each column `flex w-64 shrink-0 flex-col gap-2` →
  `flex min-w-0 flex-1 flex-col gap-2`. The three columns now share the panel width equally,
  matching the full-width rendered board. `DefaultViewSkeleton` + `SkeletonCard` roots gained
  `w-full min-w-0` for explicit parity.

## Regression Test (Step 5)

- **Test:** none. Pure renderer/CSS (Tailwind utility) change in a `.tsx`; the project keeps
  DOM/layout out of node (no-jsdom) vitest by convention. Correctness is by the mechanism above
  + user GUI verify in `npm run dev`.

## Verification (Step 6)

- [x] `npm run typecheck` green
- [x] `npm test` green (1391 passed; no test touched)
- [ ] Original symptom gone — skeleton fills width, no jump on swap (USER GUI verify, `npm run dev`)
