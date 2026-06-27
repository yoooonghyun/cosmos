# Plan: Slack Scroll-Based History Pagination — v1

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: .sdd/specs/slack-scroll-pagination-v1.md

---

## Grounding

(Same direct investigation as the spec's Grounding section — see
`.sdd/specs/slack-scroll-pagination-v1.md`. Key facts the plan builds on:)

- Native `MessageList` (`src/renderer/SlackPanel.tsx:549`) owns `items`/`cursor`/`run(next)`;
  `run(cursor)` is the existing older-page load. `loadingMore` already tracks the in-flight older
  fetch. Older page PREPENDS via `prependOlderMessages`. Self-scroll variant wraps `body` in a
  Radix `<ScrollArea ref={scrollRef} className={messageListWrapClass(scroll)}>`.
- `useSlackScrollToLatest(itemCount, 'radix-viewport')` already finds the scroller as
  `root.querySelector('[data-slot="scroll-area-viewport"]')` and runs in `useLayoutEffect`. The
  same viewport element is the anchor measurement target.
- The generative `MessageList` (`slackCatalog/components.tsx`) is intentionally OUT OF SCOPE
  (spec FR-013) — its older page is accumulated by `AdapterDispatcher.run` mode `append`, not a
  local `run`/`cursor`.

## Summary

Add scroll-up infinite pagination to the NATIVE Slack history `MessageList`. A new node-tested
pure decision (`slackScrollPaginate.ts`: should-auto-load given scrollTop/threshold/in-flight/
has-cursor) gates a new DOM hook (`useSlackScrollPaginate.ts`) that (a) attaches a scroll listener
to the Radix viewport and fires the existing `run(cursor)` once near top, guarded by `loadingMore`,
and (b) on each older-page prepend, restores the user's position by anchoring on the scrollHeight
delta inside a `useLayoutEffect`. The manual "Load older messages" button stays as a disabled-while-
loading fallback. No layout classes, IPC, or `prependOlderMessages`/`olderAbove` semantics change.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript / React (renderer) |
| Key dependencies  | Existing: Radix `ScrollArea`, `useSlackScrollToLatest`, `prependOlderMessages`, `run(cursor)`/`loadingMore` in `SlackPanel.tsx`. No new deps. |
| Files to create   | `src/renderer/slackScrollPaginate.ts` (pure decision), `src/renderer/slackScrollPaginate.test.ts` (node tests), `src/renderer/useSlackScrollPaginate.ts` (DOM hook: scroll listener + prepend anchor) |
| Files to modify   | `src/renderer/SlackPanel.tsx` (native `MessageList`: wire the hook into the self-scroll `olderAbove` history path only) |
| Out of scope      | `src/renderer/slackCatalog/components.tsx`, `src/main/adapterDispatcher.ts`, any layout class / `*.css`, `src/shared/ipc*` |

---

## Design approach (the hard parts)

**1. Trigger + guard (FR-001/002/003/008).**
- Pure `shouldAutoLoadOlder({ scrollTop, threshold, inFlight, hasCursor })` in
  `slackScrollPaginate.ts`: returns `scrollTop <= threshold && !inFlight && hasCursor`.
  `threshold` is a small constant (e.g. `NEAR_TOP_PX = 64`), exported so tests pin it.
- `useSlackScrollPaginate` attaches a `scroll` listener (passive) to the resolved viewport. On
  each event it reads `scroller.scrollTop`, evaluates the pure decision with the CURRENT
  `inFlight` (= `loadingMore`) and `hasCursor` (= `cursor != null`), and if true calls the
  provided `onLoadOlder()` (= `() => run(cursor)`). The in-flight guard (`loadingMore`) is the
  authority; rAF/debounce is optional polish — the guard alone prevents double-fire because
  `run` sets `loadingMore=true` synchronously before its first await is observed by the next
  scroll tick. To be safe against the React state lag between `setLoadingMore(true)` and re-render,
  the hook ALSO keeps a local `firingRef` latch set true the moment it calls `onLoadOlder` and
  cleared when `itemCount` changes or `loadingMore` goes false — so a burst of scroll events in
  the same frame cannot re-enter before React commits.

**2. Scroll-position preservation on prepend (FR-004/005).**
- Anchor in a `useLayoutEffect` keyed on `itemCount` (rows count), mirroring how
  `useSlackScrollToLatest` keys its bottom-jump:
  - Keep `prevScrollHeightRef` + `prevScrollTopRef`. BEFORE a prepend changes layout we have the
    last committed values; in the layout effect (after the new rows are in the DOM, before paint)
    read `newScrollHeight = scroller.scrollHeight` and set
    `scroller.scrollTop = prevScrollTop + (newScrollHeight − prevScrollHeight)`.
  - This runs ONLY for a prepend-grow that was NOT the initial load. Distinguish exactly like the
    sibling hook: the initial bottom-jump is the FIRST non-empty render (owned by
    `useSlackScrollToLatest`); the anchor restore runs only when `itemCount` GREW on an instance
    that has already done its initial scroll. Track a `firstNonEmptyDoneRef` (or read that the
    previous itemCount was already > 0) so the very first 0→N transition is skipped here and left
    to `useSlackScrollToLatest`.
  - Update `prevScrollHeightRef`/`prevScrollTopRef` at the end of every layout effect so the next
    delta is correct.
- Because both hooks run in `useLayoutEffect` on the same `itemCount` change, ORDER matters: the
  initial 0→N render must do the bottom-jump (sibling hook) and the anchor hook must no-op; a
  later N→M prepend must do the anchor (this hook) and the sibling must no-op (its `alreadyScrolled`
  latch is set). Both conditions are mutually exclusive by construction, so order between them is
  safe — document this in both hooks.

**3. Keep the button (FR-006).** No change to the `loadMore` button JSX except that it is already
`disabled={loadingMore}`, which now also covers scroll-triggered loads (same `loadingMore`). It
stays rendered at the top for `olderAbove`.

**4. Coexistence (FR-005/012).** The hook is wired ONLY on the `scroll=true && olderAbove=true`
path (history). The thread-dock (`scroll=false`) returns `body` bare — no viewport, hook not
attached. Search uses `olderAbove` per its call site; gate the auto-load on `olderAbove === true`
so only older-direction lists scroll-paginate.

---

## Implementation Checklist

### Phase 1 — Interface

- [x] Read spec, confirm recommendations (keep button; native-only; no design step) accepted — no open questions remain
- [x] Create `src/renderer/slackScrollPaginate.ts`: export `NEAR_TOP_PX` const + `interface AutoLoadOlderInput { scrollTop; threshold; inFlight; hasCursor }` + pure `shouldAutoLoadOlder(input): boolean`. No DOM import. (Also added pure `anchorScrollTop(prevTop,prevH,newH)` so the prepend-delta math is node-tested too.)
- [x] Create `src/renderer/useSlackScrollPaginate.ts`: hook taking `{ itemCount, inFlight, hasCursor, enabled, onLoadOlder }`, returning a callback ref. Owns the scroll listener (passive), the `firingRef` latch, and the prepend anchor `useLayoutEffect`. Reuses the same `[data-slot="scroll-area-viewport"]` resolution as `useSlackScrollToLatest`.
- [x] Review the new types vs spec — no invented props; the decision inputs match FR-010 exactly.

### Phase 2 — Testing

- [x] `src/renderer/slackScrollPaginate.test.ts` (vitest, node): `shouldAutoLoadOlder` truth table — near-top + has-cursor + not-in-flight ⇒ true; below threshold ⇒ false; in-flight ⇒ false; no cursor ⇒ false; exact-boundary `scrollTop === threshold` ⇒ true; negative/overscroll scrollTop ⇒ true. Plus `anchorScrollTop` delta cases. 12 tests pass.
- [x] Assert `NEAR_TOP_PX` is the pinned constant (regression guard).
- [x] (DOM anchor + scroll-listener wiring are not node-testable — they need a real layout pass; verified visually, noted like `useSlackScrollToLatest`'s DOM side.)

### Phase 3 — Implementation

- [x] In `SlackPanel.tsx` native `MessageList`: attach `useSlackScrollPaginate`, passing `itemCount=items.length`, `inFlight=loadingMore`, `hasCursor={cursor != null}`, `enabled={scroll && olderAbove}`, `onLoadOlder` guarded on `cursor` (`() => void run(cursor)`).
- [x] The existing `useSlackScrollToLatest` ref and the paginate hook coexist on the one Radix `ScrollArea` via a merged callback ref (`mergedScrollRef`); both resolve the viewport internally. Layout-effect mutual exclusion documented in both hook headers.
- [x] Leave `loadMore` button, `prependOlderMessages`, `olderAbove`, `messageListWrapClass`, and all classes untouched (FR-011).
- [x] All Slack tests pass (394) + new 12; `npm run typecheck:web` green. (`typecheck:node` has one pre-existing error in `confluenceClient.test.ts`, a file another agent is editing — unrelated to this change.)

### Phase 4 — Docs

- [ ] Add a one-line note to `docs/ARCHITECTURE.md` §4.8 (Slack panel): native history list paginates older history via scroll-up (infinite-scroll, scrollHeight-anchored) with the manual button kept as fallback; generative list is a follow-up. (Architect to apply at wrap-up if the pattern lands as specced.)
- [ ] Update this plan's Deviations with anything that differed (esp. if the `firingRef` latch proved unnecessary, or if search needed a different `olderAbove` gate).
- [ ] `memory_save` the scroll-anchor-on-prepend + dual-layout-effect mutual-exclusion pattern for future Slack/Confluence list work.

---

## Deviations & Notes

- **2026-06-27**: Initial plan. Native history list only; generative list deferred (adapter-side
  accumulation makes a renderer scrollHeight anchor infeasible without reworking
  `AdapterDispatcher` — out of scope for v1).
