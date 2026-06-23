# Plan: Slack independent message-list scroll — v1

**Status**: Draft
**Created**: 2026-06-23
**Last updated**: 2026-06-23
**Spec**: .sdd/specs/slack-independent-list-scroll-v1.md

---

## Grounding

> Same direct investigation as the spec — see the spec's Grounding section for the full
> codegraph/docs/memory queries. Plan-relevant takeaways:

- Single shared scroller is at `SlackPanel.tsx` ~line 1551:
  `<div className="min-w-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">`
  wrapping `A2UIProvider` → `ActiveTabSurface`. Every emitted list flows into this one viewport.
- Catalog list components (`slackCatalog/components.tsx`) are plain `flex flex-col` divs with no
  height bound. The clamp pattern (`SLACK_LAYOUT_CLAMP_CLASS = 'w-full min-w-0 max-w-full'`)
  lives in `slackCatalog/logic.ts` and is asserted by a node test — establishes the precedent of
  putting a class string in `logic.ts` so it is unit-testable without a DOM.
- `MessageList` renders count label + top `LoadMoreButton` + rows; `SearchResultList`/`ChannelList`
  render count label + rows + bottom `LoadMoreButton`. Row ordering is `orderBoundMessages`.
- The agent groups lists in clamped SDK `Column`/`Row` (`slackCatalog/layout.tsx`).

---

## Summary

Make each agent-rendered Slack message list its own bounded, vertically-scrollable region by
giving the list-root `<div>` in the Slack catalog a `max-height` + `overflow-y-auto`, applied
ONLY when the surface contains more than one list — preserving the natural single-list case.
Because the catalog component cannot know how many sibling lists the agent emitted, the chosen
approach is a **CSS-only sibling-aware bound**: the list root always carries a self-contained
"scroll when it would otherwise grow past a cap" treatment, but the cap is relaxed to "fill"
when the list is the surface's only list. We express this with a Tailwind class string factored
into `slackCatalog/logic.ts` (mirroring `SLACK_LAYOUT_CLAMP_CLASS`) so it is node-testable, and
keep the panel's existing single `overflow-auto` viewport as the surface-level scroller that the
per-list regions nest beneath (FR-001/FR-002). The change is presentational only: no row,
ordering, load-more, data-model, or read-only behavior changes (FR-007).

### Chosen height/scroll-bounding approach (and why)

**Approach: fixed `max-height` per list with internal `overflow-y-auto`, single-list relaxed to
fill — Open Question policy (A).**

- Each message-bearing list root becomes `min-w-0 max-w-full` (unchanged, FR-008) **plus**
  `overflow-y-auto` and a `max-h-[…]` cap (e.g. a viewport-relative cap like `max-h-[60vh]` or a
  rem cap such as `max-h-[28rem]`; final value chosen during implementation against the panel
  chrome, see checklist). A list shorter than the cap sizes to its content and shows no scrollbar
  (`max-height` + `auto` overflow does exactly this — FR-004). A taller list scrolls internally
  and can never push siblings off-screen (FR-002). Multiple such lists stack inside the existing
  panel `overflow-auto`, which still scrolls the whole group (FR-001 nested-beneath behavior).
- **Single-list naturalness (FR-003/FR-009):** the cap must not cramp the common case. Two
  candidate mechanisms, decided in the checklist:
  - **Preferred — CSS `:only-of-type`-style relaxation via a wrapper marker.** Wrap each catalog
    list in the layout layer so a list that is the sole list child gets no cap (grows to fill),
    and only when 2+ lists are siblings does the cap apply. Pure CSS (`group`/sibling selectors
    or `[&:only-child]` on a stable list wrapper), no React counting, no agent/protocol change.
  - **Fallback — uniform cap with a generous value.** If a reliable CSS-only "only list" selector
    is not achievable given how the SDK nests nodes (lists may be wrapped in SDK `Column`/`Row`
    divs, breaking adjacency), apply a generous cap (e.g. `max-h-[70vh]`) uniformly: a single
    list still nearly fills the panel (acceptable naturalness), and multiple lists are still
    bounded enough to each remain reachable. This trades a perfectly-flush single list for
    implementation simplicity and zero counting.

  The implementer MUST verify which mechanism the actual DOM nesting supports (lists are often
  inside the clamped `Column`/`Row` wrappers, so simple sibling selectors on the list root may
  not see each other). If CSS-only "only list" detection is unreliable, take the fallback and
  record it as a deviation; the spec's FR-009 is explicitly flagged `[NEEDS CLARIFICATION]` so
  the user confirms the policy before locking the value.

**Why not equal-split (policy B):** an equal flex split requires the surface to be a
non-scrolling flex column and requires the catalog to know it is the surface root — the agent
emits arbitrary node trees (lists nested in `Column`/`Row`), so a robust equal split is not
achievable purely in the catalog leaf without a new container node or React-level surface
introspection. Fixed-cap (A) is local to each list root, needs no knowledge of siblings for the
multi-list case, and degrades gracefully. (Revisit if the user picks B in the Open Question.)

**Why the class lives in `logic.ts`:** mirrors `SLACK_LAYOUT_CLAMP_CLASS` and
`scroll-area.classes.ts` — a node (no-jsdom) unit test asserts the bound class is present on the
list root, since vitest runs in node and cannot mount the `.tsx` to observe computed layout.

---

## SEQUENCING — read before starting implementation

> **Collision warning.** `SlackPanel.tsx` and `slackCatalog/components.tsx` are CURRENTLY being
> edited by another in-flight agent (an Open Prompt composer hoist). This plan's implementation
> touches BOTH files. **Do NOT begin implementation until that work has landed/merged.** The
> spec + plan authoring is safe now; only the code edits must wait. Before starting Phase 3,
> re-read the current `SlackPanel.tsx` surface-mount region (~line 1551) and
> `slackCatalog/components.tsx` list components, because line numbers and surrounding markup will
> have moved. Treat all `SlackPanel.tsx` line references in this plan as approximate.

---

## Technical Context

| Item              | Value                                                                 |
|-------------------|-----------------------------------------------------------------------|
| Language          | TypeScript + React (renderer)                                         |
| Key dependencies  | `@a2ui-sdk/react` (catalog render), Tailwind v4 (utilities, container queries) — no new deps |
| Files to create   | none (class string + test added to existing files; OR one `*.classes.ts` sibling if preferred for testability) |
| Files to modify   | `src/renderer/slackCatalog/components.tsx` (list roots get the bound class), `src/renderer/slackCatalog/logic.ts` (export the bound class string), `src/renderer/slackCatalog/logic.test.ts` (assert the class), possibly `src/renderer/slackCatalog/layout.tsx` + `SlackPanel.tsx` (only if the single-list relaxation needs a wrapper/marker) |

---

## Implementation Checklist

> Update as work progresses. **Phase 0 gate must pass before any edits.**

### Phase 0 — Sequencing gate (mandatory)

- [x] Confirm the in-flight "Open Prompt composer hoist" work on `SlackPanel.tsx` /
  `slackCatalog/components.tsx` has landed/merged. (Landed — commit 3fcdfed.)
- [x] Re-read the current `slackCatalog/components.tsx` list components and the `SlackPanel.tsx`
  generative-surface mount. Live line numbers: surface mount now `SlackPanel.tsx:1571`;
  `MessageList` root `components.tsx:323`, `SearchResultList` root `:434`, `ChannelList` root `:181`.
- [x] Resolved Open Questions confirmed by user/orchestrator: policy (A) fixed-cap; bound
  MESSAGE lists ONLY (`MessageList` + `SearchResultList`), `ChannelList` left as-is; NO header pin.

### Phase 1 — Interface / class definition

- [x] In `slackCatalog/logic.ts`, added `SLACK_LIST_SCROLL_CLASS =
  'max-h-[70vh] overflow-y-auto min-w-0 max-w-full'` (mirrors `SLACK_LAYOUT_CLAMP_CLASS`), with a
  documented header comment (cap choice + single-list relaxation rationale).
- [x] Single-list relaxation mechanism decided: **uniform generous 70vh cap** (NOT a CSS
  `:only`-style wrapper) — see Deviations.

### Phase 2 — Testing (node, no-jsdom)

- [x] In `slackCatalog/logic.test.ts`, added a `SLACK_LIST_SCROLL_CLASS` describe block asserting
  the `max-h-[70vh]` cap + `overflow-y-auto` + `min-w-0`/`max-w-full` wrap-safety + the generous
  70vh value.
- [x] No relaxation wrapper/marker introduced (uniform cap) — N/A.
- [x] Source-level assertion that the two message lists compose the bound class onto their root
  and `ChannelList` does not (SDK catalog components can't mount in node, so assert on source).

### Phase 3 — Implementation

- [x] Applied `SLACK_LIST_SCROLL_CLASS` (via `cn`) to the `MessageList` root `<div>`
  (`components.tsx:323`), keeping count label, top `LoadMoreButton`, and rows inside it (FR-005).
  `orderBoundMessages` + top-placed load-more untouched (FR-007/SC-005).
- [x] Applied the same to `SearchResultList` (`components.tsx:434`) — renders the same shared row (FR-006).
- [x] `ChannelList` left UNBOUNDED per the resolved decision (message lists only — FR-006).
- [x] Took the uniform-generous-cap path (no CSS-only `:only` relaxation) — SDK `Column`/`Row`
  nesting defeats sibling detection. Recorded under Deviations.
- [x] Horizontal wrap preserved: the bound class carries `min-w-0 max-w-full` so wrap-safety is
  intact (FR-008/SC-006). Thread dock (`@container/slackbody`) markup untouched.
- [ ] **RUNTIME-ONLY (not exercised — no live Electron here):** manually validate 2+ lists scroll
  independently (SC-001/002); single list fills naturally with no inner scrollbar / no empty
  reserved space (SC-003/004); short multi-lists show no inner scrollbar (SC-004). See report for
  exact steps.

### Phase 4 — Docs

- [x] Ran `npm run typecheck` (slack files clean; remaining non-zero exit is unrelated concurrent
  Confluence edits) and `npx vitest run slackCatalog/logic.test.ts` → 73 pass / 0 fail.
- [x] Updated `docs/DEVELOPMENT.md` generative-catalog section with the per-list self-bound note.
- [ ] `docs/ARCHITECTURE.md` one-line note — left for `architect` (owns that file).
- [x] `memory_save`d the chosen policy + relaxation mechanism (mem_mqqr18bb).
- [x] Deviation recorded below (uniform-cap fallback used).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-23**: Plan authored. Implementation BLOCKED on the in-flight Open Prompt composer
  hoist touching `SlackPanel.tsx` + `slackCatalog/components.tsx` — Phase 0 gate must clear first.
- **2026-06-23**: Two open questions deferred to the user (multi-list policy A vs B; whether
  `ChannelList` is bounded; whether the per-list header pins). Plan recommends policy (A)
  fixed-cap with a single-list relaxation; values/mechanism locked after user confirms.
- **2026-06-23 (implementation)**: Open Questions resolved by user/orchestrator — policy (A)
  fixed-cap; bound MESSAGE lists ONLY (`MessageList` + `SearchResultList`), `ChannelList` left
  unbounded; NO header pin. Implemented `SLACK_LIST_SCROLL_CLASS =
  'max-h-[70vh] overflow-y-auto min-w-0 max-w-full'` in `logic.ts`, applied via `cn` to both
  message-list roots in `components.tsx`.
- **2026-06-23 (DEVIATION — single-list relaxation mechanism)**: Took the plan's documented
  **fallback (uniform generous cap, `max-h-[70vh]`)** instead of the preferred CSS `:only`-style
  wrapper. Reason exactly as the plan anticipated: the agent nests lists inside the clamped SDK
  `Column`/`Row` layout wrappers (`slackCatalog/layout.tsx`), which breaks list-to-list DOM
  adjacency, so a reliable CSS-only "I am the only list" selector is not achievable in the catalog
  leaf without React-level surface introspection or a new container node (both out of scope). 70vh
  keeps the sole-list case natural (nearly fills the panel, no cramped box / no reserved empty
  space — FR-003/FR-004) while still bounding 2+ lists. FR-009's `[NEEDS CLARIFICATION]` policy is
  thereby resolved to (A)-uniform; revisit only if the user later wants per-N equal-split (policy
  B) or a pinned-header variant.
- **2026-06-23 (verification note)**: The presentational/class seam is node-tested (73 pass) and
  typecheck is clean for all touched slack files. The actual visual behavior — multiple lists each
  scrolling independently and a single list filling naturally — is RUNTIME and was NOT exercised
  (no live Electron in this session). Manual confirmation steps are in the developer report.
