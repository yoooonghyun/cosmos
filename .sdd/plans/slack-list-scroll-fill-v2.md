# Plan: Slack message-list scroll — independent-scroll AND fill (v2)

**Status**: Draft
**Created**: 2026-06-23
**Last updated**: 2026-06-23
**Spec**: .sdd/specs/slack-list-scroll-fill-v2.md
**Supersedes**: .sdd/plans/slack-independent-list-scroll-v1.md

---

## Summary

Repair the broken vertical height chain at the ONE renderer-owned DOM seam — the Slack catalog's
first-party `Column`/`Row` clamp wrapper (`slackCatalog/layout.tsx`) plus the surface host
(`SlackPanel.tsx`) — instead of trying to fix it at the catalog list leaf. Make the surface host a
definite-height flex column, make each first-party layout wrapper forward flex-fill so the SDK flex
div it contains participates in the chain, and make each message-list root consume the chain with
`min-h-0 flex-1 overflow-y-auto`. Result: a lone list is the only flex child and fills the panel
(R2); N lists are sibling flex children that equal-split the panel height and each scroll internally
(R1). All three class strings live in `slackCatalog/logic.ts` as pure exports so a node test asserts
the chain tokens. This is purely a presentational containment change — no data-model, ordering,
load-more, or read-only behavior changes.

### Chosen mechanism — direction (a), not (b) or (c)

| Direction | Verdict | Why |
|-----------|---------|-----|
| **(a) Inject `flex flex-col min-h-0 flex-1` at the first-party wrapper + host, list root uses `min-h-0 flex-1 overflow-y-auto`** | **CHOSEN** | The break was always at the SDK `Column`/`Row` flex div, but the Slack catalog never registers the RAW SDK container — it registers its OWN `layout.tsx` wrapper that renders `<div className={SLACK_LAYOUT_CLAMP_CLASS}><SdkColumn/></div>`. That wrapper is first-party code we control, and the SDK flex div is always its only child. So we DON'T need any SDK attribute: make the wrapper a `flex flex-col min-h-0 flex-1` link, make the host a definite-height flex column, and the chain threads through. A lone list = the only flex child = fills (R2); N lists = sibling flex children = equal-split + each scrolls (R1). R1 and R2 become the SAME mechanism (N=1 is just the degenerate split). Robust to SDK markup changes (FR-012) because nothing keys off the SDK div. |
| (b) JS-measure host height → CSS var `--slack-surface-h`, list roots use `max-h-[calc(var(--slack-surface-h)/N)]` | Rejected | The catalog leaf does NOT know sibling count N (the spec/memory confirm the SDK wrappers break sibling adjacency, so a leaf can't count siblings, and a `:only-child`/`nth` selector is unreliable through the wrappers). Obtaining N requires either a ResizeObserver/DOM walk in `SlackPanel` counting list roots by a data-attribute (added complexity, runtime measurement, re-measure on every data-model update + dock open/close), or threading count through the SDK — neither is clean. Pure-CSS flex equal-split achieves the same "divide by N" for free, with no measurement and no count plumbing. Keep (b) only as a last resort if (a) proves impossible. |
| (c) Container-query height: `@container/slackbody` + `min-h-[100cqh]`/`max-h-[100cqh]` on list roots | Rejected as the PRIMARY mechanism; KEPT as an optional hardening | `100cqh` resolves against the registered container (the host on line 1574), sidestepping the broken percentage chain — great for the LONE list (R2). But for N lists each list is `100cqh` = full panel height each, so they stack to N× panel height and overflow into the panel scroller = shared scroll again (R1 broken). `cqh` has no built-in "divide by sibling count". So `cqh` alone repeats Attempt-2's failure for multi-list. It MAY be added as a belt-and-suspenders `min-h` fallback for the single-list fill (see Story 5, optional), but it is not the load-bearing mechanism. |

### Why (a) beats BOTH failed attempts

- vs **Attempt 1 (`max-h-[70vh]`)**: no fixed viewport fraction anywhere — the fill is driven by the
  real panel height through the flex chain, so a lone list reaches the actual panel bottom (no
  ~30vh dead gap). R2 fixed.
- vs **Attempt 2 (`max-h-full`)**: the list root no longer relies on a percentage `max-height`
  resolving against an indefinite-height parent. The parent (first-party wrapper) is now a real
  `flex-1 min-h-0` flex item with a resolved height, and the list root uses `flex-1 min-h-0`
  (definite flex sizing, not a `%`), so the bound engages for every list and N lists each get their
  own scroll region. R1 fixed — without re-breaking R2, because the same `flex-1` makes a lone list
  fill.

### SDK-wrapper dependency (FR-005 / FR-012)

- We depend ONLY on the first-party `slackCatalog/layout.tsx` `Column`/`Row` wrappers (which WE
  author) being the registered containers — confirmed in `slackCatalog/index.ts` (registers
  `./layout` `Column`/`Row`, with a node test already asserting the raw SDK containers are not
  registered). We do NOT depend on any class/attribute of the third-party SDK `<div>` (verified: it
  exposes `flex flex-col gap-4`/`flex flex-row gap-3` only — no `data-*`, no id, no marker).
- The SDK flex div sits BETWEEN our wrapper and the list root and is auto-height. We thread the
  chain THROUGH it by ALSO marking it from our wrapper via an arbitrary-variant descendant selector
  on the wrapper class — `[&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col` — targeting the
  wrapper's direct child (the SDK div) regardless of the SDK's own classes. `[&>*]` keys off DOM
  POSITION (direct child), not any SDK class, so an SDK markup/class change does not break it as
  long as the wrapper still has exactly one child element (it always does — `layout.tsx` renders a
  single `<SdkColumn/>`/`<SdkRow/>`). This is the stable anchor.
- **Fallback if the SDK markup changes (FR-012)**: because the anchor is `[&>*]` (positional) on a
  first-party wrapper, the worst realistic regression is the SDK introducing an EXTRA wrapper layer
  of its own between its outer div and the children — which would leave one un-filled auto-height
  layer and degrade to "lone list still fills, multi-list may share". It can NEVER reintroduce
  horizontal overflow (the `min-w-0 max-w-full` clamp is untouched) and never white-screens. The
  node test (Story 4) pins the wrapper class tokens so an accidental first-party edit is caught;
  the manual multi-list check (below) catches an SDK-shape regression at runtime.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript / React 19 / Tailwind v4 (renderer) |
| Key dependencies  | `@a2ui-sdk/react/0.9` (third-party `Column`/`Row`, NOT modified); first-party `slackCatalog/layout.tsx` wrappers; `slackCatalog/logic.ts` pure class strings; `index.css` `scrollbar-hover-only` utility (existing) |
| Files to create   | none (extend existing) |
| Files to modify   | `src/renderer/slackCatalog/logic.ts` (class strings), `src/renderer/slackCatalog/layout.tsx` (apply fill class to wrappers), `src/renderer/slackCatalog/components.tsx` (list roots use the new scroll class — already reference `SLACK_LIST_SCROLL_CLASS`), `src/renderer/SlackPanel.tsx` (host = definite-height flex column), `src/renderer/slackCatalog/logic.test.ts` (assert chain tokens), `docs/DEVELOPMENT.md` (update the catalog-surface scroll note), `docs/ARCHITECTURE.md` (if the chain-repair pattern is a new documented convention) |

> **SEQUENCING (concurrency hazard).** `SlackPanel.tsx` is being edited by a concurrent
> dock-overlay agent. The host-class change (Story 3) touches the SAME ~1570–1592 region
> (`@container/slackbody relative flex min-h-0 flex-1` + the `overflow-auto` tabpanel). **Do NOT
> start Story 3 until the dock-overlay change has landed**; rebase the host edit onto the final
> markup of that region. Stories 1, 2, 4 (logic.ts, layout.tsx, the node test) are independent of
> `SlackPanel.tsx` and MAY proceed first. Land the `SlackPanel.tsx` edit (Story 3) last, against
> the post-dock-overlay tree, then do the manual runtime check (Story 6) once everything is in.

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates from plan.
> Stories are ORDERED; Story 3 is gated on the concurrent dock-overlay landing (see above).

### Story 1 — Define the chain class strings in `logic.ts` (node-testable seam) — independent of SlackPanel

- [ ] In `src/renderer/slackCatalog/logic.ts`, REPLACE the Attempt-2 `SLACK_LIST_SCROLL_CLASS`
  (`'max-h-full overflow-y-auto min-w-0 max-w-full scrollbar-hover-only'`) with the fill-chain
  consumer: `'min-h-0 flex-1 overflow-y-auto min-w-0 max-w-full scrollbar-hover-only'`. (Drop
  `max-h-full` — the bound is now flex sizing, not a percentage `max-height`.)
- [ ] Add a new exported `SLACK_LAYOUT_FILL_CLASS` for the first-party wrapper that forwards fill
  AND threads the chain through the SDK child:
  `'w-full min-w-0 max-w-full flex flex-col min-h-0 flex-1 [&>*]:flex [&>*]:flex-col [&>*]:min-h-0 [&>*]:flex-1'`
  (extends the existing width clamp `w-full min-w-0 max-w-full` with the vertical fill chain + the
  positional `[&>*]` descendant repair of the SDK flex div). Keep `SLACK_LAYOUT_CLAMP_CLASS` as-is
  if any non-fill consumer still needs width-only, OR fold it in — decide in the wrapper story.
- [ ] Add a new exported `SLACK_SURFACE_HOST_CLASS` for the tabpanel host fill column:
  the chain tokens the host must carry — `'flex flex-col min-h-0'` (combined with the host's
  existing `min-w-0 flex-1 overflow-auto p-3 …` at the SlackPanel call site). Export it as a string
  so the node test can assert the host carries `flex flex-col min-h-0`.
- [ ] Rewrite the big block comment to document the v2 chain-repair (host → wrapper `[&>*]` → list
  root), explicitly stating WHY Attempt-1 (`70vh` dead gap) and Attempt-2 (`max-h-full` against
  indefinite parent → shared) failed, and that R1+R2 are now one mechanism.

**Acceptance**: `logic.ts` exports `SLACK_LIST_SCROLL_CLASS` (with `min-h-0 flex-1 overflow-y-auto`,
no `max-h-*`), `SLACK_LAYOUT_FILL_CLASS` (width clamp + fill chain + `[&>*]` SDK-child repair), and
`SLACK_SURFACE_HOST_CLASS` (`flex flex-col min-h-0`). No `.tsx` import broken.

### Story 2 — Apply the fill class to the first-party Column/Row wrappers — independent of SlackPanel

- [ ] In `src/renderer/slackCatalog/layout.tsx`, change `Column` and `Row` to render the wrapping
  `<div>` with `SLACK_LAYOUT_FILL_CLASS` instead of `SLACK_LAYOUT_CLAMP_CLASS` (import the new
  constant). The SDK `<SdkColumn/>`/`<SdkRow/>` stays the only child — the `[&>*]` selector in the
  class repairs ITS auto-height so the chain threads to the list roots inside it.
- [ ] Update the file's doc comment: the wrapper now repairs BOTH horizontal (width clamp,
  unchanged) AND vertical (fill chain + `[&>*]` SDK-child repair) so a grouped list both wraps and
  fills/splits.

**Acceptance**: `layout.tsx` `Column`/`Row` carry `SLACK_LAYOUT_FILL_CLASS`; width-clamp tokens
preserved (FR-011); SDK child unchanged/forwarded verbatim.

### Story 3 — Make the surface host a definite-height flex column — GATED on the concurrent dock-overlay landing

- [ ] **Wait for the dock-overlay agent's `SlackPanel.tsx` change to land; rebase onto its final
  ~1570–1592 markup.**
- [ ] In `src/renderer/SlackPanel.tsx`, add `flex flex-col` (from `SLACK_SURFACE_HOST_CLASS`) to the
  tabpanel host so its surface child participates in the fill chain. Current host:
  `<div className="min-w-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">` →
  becomes `… flex flex-col min-h-0 …` (it already has `flex-1`; add `flex flex-col min-h-0`). Keep
  `overflow-auto` so a lone list TALLER than the panel still has a scroll fallback at the host (but
  the list's own `flex-1 overflow-y-auto` is the primary scroller, so in practice the host won't
  double-scroll — verify in the manual check no duplicate scrollbar appears).
- [ ] Verify the parent on line 1574 (`@container/slackbody relative flex min-h-0 flex-1`) still
  gives the host a definite height (it is a `flex min-h-0` parent, so its `flex-1` child host has a
  resolved height — this is the top of the chain). Do NOT remove `min-h-0` from either node.
- [ ] Confirm the thread-dock side-by-side layout (`@[32rem]/slackbody` branch, ~line 1600) still
  lays out correctly with the host now a flex column.

**Acceptance**: the tabpanel host is `flex flex-col min-h-0 flex-1` (plus its existing
`min-w-0 overflow-auto p-3`); the chain from line-1574 parent → host → wrapper → list root is
unbroken; thread dock unaffected.

### Story 4 — Node unit test for the chain tokens (no-jsdom seam) — independent of SlackPanel

- [ ] In `src/renderer/slackCatalog/logic.test.ts`, add assertions:
  - `SLACK_LIST_SCROLL_CLASS` contains `min-h-0`, `flex-1`, `overflow-y-auto`, `min-w-0`,
    `max-w-full`, `scrollbar-hover-only`, and does NOT contain `max-h-` (the Attempt-1/2 cap is
    gone) nor `70vh`.
  - `SLACK_LAYOUT_FILL_CLASS` contains the width clamp (`w-full`, `min-w-0`, `max-w-full`) AND the
    fill chain (`flex`, `flex-col`, `min-h-0`, `flex-1`) AND the SDK-child repair tokens
    (`[&>*]:min-h-0`, `[&>*]:flex-1`).
  - `SLACK_SURFACE_HOST_CLASS` contains `flex`, `flex-col`, `min-h-0`.
- [ ] (Optional) assert that the trio together expresses a complete chain: host has `flex-col
  min-h-0`, wrapper forwards `flex-1 min-h-0` + repairs `[&>*]`, list root consumes `flex-1
  min-h-0` — i.e. a regression that drops any one token fails the test.

**Acceptance**: `npm test` passes with the new assertions; a deliberately reverted token (e.g.
putting `max-h-full` back) fails the test.

### Story 5 — (Optional) container-query-height hardening for the lone-list fill

- [ ] Evaluate adding `min-h-[100cqh]` to the LONE-list fill path as belt-and-suspenders so the
  fill survives a future accidental flex-chain break (the `@container/slackbody` already exists on
  the host). NOTE: `100cqh` must NOT be applied unconditionally to EVERY list root or it
  re-breaks multi-list (each becomes full-panel-tall → shared scroll). If added, it must be a
  single-list-only affordance — and since the catalog leaf can't see sibling count, this likely
  can't be expressed at the leaf and should be SKIPPED unless a clean host-level hook exists.
- [ ] Default decision: SKIP (the flex chain is the mechanism; `cqh` divide-by-N isn't expressible).
  Record the decision in `logic.ts` comment so a future reader knows it was considered and why it
  was not used as the primary mechanism.

**Acceptance**: a documented decision (skip, or a single-list-only hardening that provably does not
affect multi-list).

### Story 6 — Docs + manual runtime verification — after Stories 1–4 and the gated Story 3

- [ ] Update `docs/DEVELOPMENT.md` (the ~615–620 "Slack catalog MESSAGE lists self-bound their
  height" note) to describe the v2 chain-repair: host `flex flex-col min-h-0` → first-party
  `Column`/`Row` wrapper `flex flex-col min-h-0 flex-1` + `[&>*]` SDK-child repair → list root
  `min-h-0 flex-1 overflow-y-auto`; lone list fills, N lists equal-split; class strings in
  `logic.ts`; node-tested.
- [ ] Update `docs/ARCHITECTURE.md` IF the "repair the height chain at the first-party catalog
  wrapper, not the SDK leaf" approach is worth recording as a generative-catalog convention (it
  likely is, since the same SDK-wrapper break affects Jira/Confluence catalogs — note parity as
  future work, do not change those catalogs in this feature).
- [ ] `npm run typecheck` (node + web) clean; `npm test` green.
- [ ] **Manual runtime check (`npm run dev`)** — exercise an agent surface in the Slack panel:
  - [ ] **Single list, short content** — fills down to the panel bottom, NO empty gap below, NO
    inner scrollbar (SC-001, FR-004).
  - [ ] **Single list, tall content** — fills the panel and scrolls within its own region; exactly
    ONE scrollbar (no duplicate panel scrollbar) (SC-001).
  - [ ] **Two-plus lists** — EACH scrolls independently; scrolling one does not move the others; NO
    single shared scrollbar; the lists divide the panel height and all are visible (SC-002, SC-003,
    FR-002, FR-003).
  - [ ] **Two-plus lists, one very tall** — the tall one scrolls internally within its share; no
    sibling pushed off-screen (SC-003).
  - [ ] **No dead gap in any case** below the last list (SC-001).
  - [ ] **List with a `Text` header in a `Column`** — header stays visible, only the list body
    scrolls within that column (edge case).
  - [ ] **Long unbroken message line** — still wraps within each list region; no horizontal
    overflow (SC-006, FR-011).
  - [ ] **Load-more** — top-load-more history grows above within the region, ordering ascending;
    search bottom-load-more appends within its region (SC-005, FR-010).
  - [ ] **Thread dock open (side-by-side and overlay)** — fill/independent-scroll still correct in
    the narrowed list column; container-query layout intact (edge case).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-23**: Plan authored. Chosen mechanism = direction (a): repair the height chain at the
  first-party `layout.tsx` wrapper + `SlackPanel` host via flex-fill (`flex flex-col min-h-0 flex-1`)
  + a positional `[&>*]` descendant repair of the auto-height SDK `Column`/`Row` flex div, list
  roots consume `min-h-0 flex-1 overflow-y-auto`. Rejected (b) JS-measure (leaf can't count
  siblings; flex equal-split divides-by-N for free) and (c) `cqh` as primary (no divide-by-N → multi-list
  re-shares). Story 3 (host edit) gated on the concurrent dock-overlay `SlackPanel.tsx` change.
- **2026-06-24 (developer, IMPLEMENTED)**: Stories 1–4 + 6 done; Story 5 = SKIP (documented in
  `logic.ts` comment). `logic.ts`: `SLACK_LIST_SCROLL_CLASS` → `'min-h-0 flex-1 overflow-y-auto
  min-w-0 max-w-full scrollbar-hover-only'` (dropped `max-h-full`); added `SLACK_LAYOUT_FILL_CLASS`
  + `SLACK_SURFACE_HOST_CLASS`; rewrote the block comment to the v2 chain story. `layout.tsx`
  Column/Row now apply `SLACK_LAYOUT_FILL_CLASS` (folded the old `SLACK_LAYOUT_CLAMP_CLASS` width
  tokens into it; the clamp constant is retained but unused by the wrapper). `SlackPanel.tsx`
  generative tabpanel host got `flex flex-col min-h-0` (Story 3, dock-overlay had already landed
  — I did it in this same pass). `logic.test.ts`: replaced the `max-h-full` assertions with v2
  chain-token + absence assertions, added FILL/HOST describe blocks + a complete-chain assertion,
  and repointed the wrap-clamp wiring test from `SLACK_LAYOUT_CLAMP_CLASS` → `SLACK_LAYOUT_FILL_CLASS`
  in layout.tsx. components.tsx comments refreshed (usage already referenced the const). DEVELOPMENT.md
  Slack section rewritten for v2 + a new always-overlay dock note. ALSO did CHANGE 1 (dock overlay)
  in the same pass: BOTH SlackPanel thread-dock blocks (native ~1532 + generative ~1593) converted
  from the `@[32rem]/slackbody` squeeze-side-by-side to always-overlay (scrim `absolute inset-0 z-10
  bg-black/40` always shown, drawer `absolute inset-y-0 right-0 z-20 w-full max-w-[28rem] border-l
  bg-card shadow-lg`, transitions kept), matching Jira/Confluence. Verified: `npm run typecheck`
  clean (node+web, no stash needed — no transient errors present at run time); full `npx vitest run`
  = 2220 pass / 0 fail (slack suite 81/81). Runtime not exercised (no dev session) — manual checks
  in Story 6 still pending.
