# Spec: Slack message-list scroll — independent-scroll AND fill (v2)

**Status**: Draft
**Created**: 2026-06-23
**Supersedes**: .sdd/specs/slack-independent-list-scroll-v1.md
**Related plan**: .sdd/plans/slack-list-scroll-fill-v2.md

---

## Grounding

> Tools run directly by the architect for this spec. Verify-don't-trust the framing — every
> claim below was confirmed against on-disk source this session.

**codegraph_explore** (queries run, one-line takeaways)

- `SlackPanel surface host overflow-auto tabpanel SLACK_LIST_SCROLL_CLASS MessageList SearchResultList`
  — surfaced the catalog list components. Confirmed `MessageList` / `SearchResultList` roots are
  `<div className={cn('flex w-full flex-col', SLACK_LIST_SCROLL_CLASS)}>`, where
  `SLACK_LIST_SCROLL_CLASS` is currently `max-h-full overflow-y-auto min-w-0 max-w-full
  scrollbar-hover-only` (the Attempt-2 state). `ChannelList` root is unbounded
  (`flex w-full max-w-full min-w-0 flex-col gap-1`).
- `ActiveTabSurface surface root render renderComponent A2UIProvider Surface` — confirmed the
  render path `ActiveTabSurface → SurfaceErrorBoundary → A2UIRenderer`. `ActiveTabSurface` adds NO
  scroll/height wrapper of its own; the agent's emitted root component becomes the first DOM node
  under the provider. So the height chain into a list goes: tabpanel host → (optional Slack
  `Column`/`Row` wrapper) → (SDK flex div) → list root.

**Direct reads (codegraph trimmed these, so read verbatim)**

- `node_modules/@a2ui-sdk/react/dist/0.9/components/layout/ColumnComponent.js` and
  `RowComponent.js` — CONFIRMED the SDK container renders exactly
  `<div className={cn('flex flex-col gap-4', justify, align)} style={weight ? {flexGrow} : undefined}>`
  (Row: `flex flex-row gap-3`). It carries **NO `data-*` attribute, NO id, NO `min-h-0`, NO
  `flex-1`, NO definite height** — the only DOM signal is the literal `flex flex-col gap-4` /
  `flex flex-row gap-3` class string. There is no stable selector the catalog can target on the
  SDK div itself, and `displayName` (`A2UI.Column`) is not a DOM attribute.
- `src/renderer/slackCatalog/layout.tsx` — the Slack catalog does NOT register the raw SDK
  `Column`/`Row`; it registers its OWN wrappers that render `<div className={SLACK_LAYOUT_CLAMP_CLASS}>
  <SdkColumn {...props} /></div>`. **This wrapper div is renderer-owned, first-party code we fully
  control** — it is the one stable DOM seam between the host and a list root, and the SDK flex div
  is always its only child.
- `src/renderer/SlackPanel.tsx` ~1570–1592 — the generative surface host is
  `<div className="@container/slackbody relative flex min-h-0 flex-1">` (line 1574, already a
  registered container `slackbody`) wrapping the tabpanel
  `<div className="min-w-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">`
  (line 1575) → `<A2UIProvider catalog={slackCatalog}><ActiveTabSurface …/>`. The tabpanel is the
  SINGLE shared scroller; its `flex-1` child has a definite height (it is the flex item of the
  `flex min-h-0` parent), but it is `overflow-auto` with no inner flex column, so a percentage /
  flex chain does NOT continue past it into the surface subtree today.
- `src/renderer/slackCatalog/logic.ts` — `SLACK_LIST_SCROLL_CLASS` and `SLACK_LAYOUT_CLAMP_CLASS`
  live here as pure exported strings (node-testable), mirroring `scroll-area.classes.ts`. The big
  block comment documents WHY both prior attempts failed.

**Docs**

- `docs/DEVELOPMENT.md` (575–620) — the catalog-surface conventions: agent surfaces render inside a
  plain `overflow-auto` div (no Radix ScrollArea); the SDK `Column`/`Row` shrink-wrap and are
  width-clamped via first-party `layout.tsx` wrappers across all three generative catalogs; the
  existing "MESSAGE lists self-bound their height" note describes the v1/Attempt-1+2 state. Cascade
  layers + container queries (`@container/slackbody`) are the established tools here.
- `docs/ARCHITECTURE.md` — target-routed multi-panel A2UI hosting; Slack surfaces are read-only,
  display-only, each panel hosts its own `A2UIProvider` + custom catalog.

**memory_recall / memory_smart_search**

- `slack list scroll independent fill A2UI Column wrapper` → ONE pattern memory
  (`mem_…f9b92c57bd2e`): records the Attempt-1 (`max-h-[70vh]`) → Attempt-2 (`max-h-full`)
  change and crucially states the conclusion *"a TRUE adjacency-aware fill-when-alone /
  hard-bound-when-many layout is NOT achievable from the catalog leaf"* because the SDK
  wrappers break BOTH sibling adjacency AND the percentage/flex height chain. v2's job is to
  defeat exactly that conclusion by moving the fix UP to the first-party wrapper + host, not the
  leaf. (Will `memory_save` the v2 mechanism once the plan is approved.)

---

## Overview

In the Slack panel's agent-generated (A2UI) surface, the agent may render one OR MORE Slack message
lists. Two requirements have so far been mutually exclusive in practice: (R1) when multiple lists
render, each must scroll INDEPENDENTLY; (R2) a single list must FILL down to the panel bottom with
no dead gap. v2 makes BOTH hold at once by repairing the broken height chain at the one DOM seam the
renderer actually controls — the first-party `Column`/`Row` clamp wrapper and the surface host —
rather than at the catalog list leaf (which cannot see its siblings or a definite-height ancestor).

## Background — why the two prior attempts each failed (must not be repeated)

- **Attempt 1 — `max-h-[70vh] overflow-y-auto` per list root.** Gave R1 (each list got an
  independent bounded scroll region) but BROKE R2: `70vh` is a fixed viewport fraction that is
  SHORTER than the panel body, so a lone tall list stopped at 70vh and left ~30vh of dead space
  below it. The cap is decoupled from the actual panel height.
- **Attempt 2 — `max-h-full overflow-y-auto` per list root.** Gave R2 (a lone list fills) but
  BROKE R1: `max-height: 100%` resolves against the LIST'S CONTAINING BLOCK, which is the SDK
  `Column`/`Row` flex div (`flex flex-col gap-4`, auto height, no `min-h-0`/`flex-1`/definite
  height). A percentage `max-height` against an auto-height (indefinite) parent computes to
  effectively `none`, so the bound never engages — every list flows back into the ONE panel-level
  `overflow-auto` scroller and N lists share one scrollbar (the regression report
  "메세지 리스트들이 공유하는 구조로 롤백됐음").

The ROOT cause both attempts hit: **the height chain from the tabpanel scroller down to a list
root is BROKEN at the SDK `Column`/`Row` flex div** — it is neither a definite-height ancestor (so
`max-h-full`/`%` can't resolve) nor a `flex-1 min-h-0` link (so a flex-fill chain can't thread
through). A leaf class alone can never fix this because the break is above the leaf and the leaf
cannot see sibling count or whether a definite-height ancestor exists.

## User Scenarios

### Single message list fills the panel · P1

**As a** cosmos user viewing an agent-composed Slack surface with exactly ONE message list (the
common case)
**I want to** the list to fill all the way down to the panel bottom
**So that** there is no awkward empty gap below the list and it reads like the native history view

**Acceptance criteria:**

- Given a surface with exactly one message list whose content is SHORTER than the panel, when it
  renders, then the list occupies the full panel height down to the bottom with NO dead gap and NO
  inner scrollbar (it sizes to content but its region reaches the panel bottom).
- Given a surface with exactly one message list whose content is TALLER than the panel, when it
  renders, then the list fills the panel height and reveals its overflow via its OWN single
  scrollbar (not a panel-level scrollbar duplicating it), with no dead gap.

### Multiple message lists each scroll independently · P1

**As a** cosmos user viewing a surface that rendered 2+ message lists
**I want to** scroll within one list and have only that list move
**So that** one tall list never pushes the sibling lists off-screen and they never share one
scrollbar

**Acceptance criteria:**

- Given a surface with 2+ message lists, when I scroll inside one list, then ONLY that list's rows
  move and the sibling lists stay in place.
- Given 2+ lists where one has far more rows than the others, when the surface renders, then no
  list grows tall enough to push a sibling out of view — each list occupies a bounded region and
  reveals its own overflow via its own scrollbar.
- Given 2+ lists, when the surface renders, then the lists DIVIDE the available panel height
  between them (each gets a fair share and is visible at once) rather than all flowing into one
  shared panel scroller.

### Per-list load-more and ordering keep working · P2

**As a** cosmos user scrolling an independently-scrollable history list
**I want to** the "load older" affordance and newest-at-bottom ordering to keep behaving
**So that** the layout fix does not break pagination or message order

**Acceptance criteria:**

- Given a history `MessageList` (top-placed load-more, newest-at-bottom) inside its own scroll
  region, when I load an older page, then the older rows appear above within THAT list's region and
  ordering stays ascending — unchanged from today.
- Given a `SearchResultList` (bottom-placed load-more) inside its own region, when I load more,
  then the next page appends within that region as before.

## Functional Requirements

| ID     | Requirement                                                                                       |
|--------|---------------------------------------------------------------------------------------------------|
| FR-001 | When the agent renders exactly ONE message list, that list MUST fill down to the panel bottom with NO empty gap below it (R2). A lone list shorter than the panel still reaches the panel bottom; a lone list taller than the panel scrolls within its OWN single region. |
| FR-002 | When the agent renders 2+ message lists in one surface, EACH list MUST be its own vertically-scrollable region so scrolling one does not scroll the others, and they MUST NOT share one scrollbar (R1). |
| FR-003 | With 2+ lists, each list MUST be height-bounded so a tall list cannot push siblings off-screen; the lists MUST DIVIDE the available panel height (equal-share fill) so all are visible at once, each scrolling internally past its share. |
| FR-004 | A list (single or multi) whose content fits within its allotted height MUST NOT show an inner scrollbar and MUST NOT reserve visible empty space below its rows beyond the natural fill region. |
| FR-005 | The fill/independent-scroll behavior MUST be achieved by repairing the height chain at a RENDERER-OWNED (first-party) DOM seam — the Slack catalog's own `Column`/`Row` clamp wrapper (`slackCatalog/layout.tsx`) and the surface host (`SlackPanel.tsx`) — NOT by depending on any attribute or marker of the THIRD-PARTY SDK `Column`/`Row` `<div>` (which exposes none). |
| FR-006 | The chain repair MUST establish a definite-height / flex-fill ancestry from the tabpanel host through every layer down to a list root, so the list root's bound resolves against a real height: the host MUST be a definite-height flex column (`flex flex-col min-h-0`), each first-party layout wrapper MUST forward fill (`flex flex-col min-h-0 flex-1`) so the SDK flex child it contains participates in the chain, and the list root MUST consume the chain (`min-h-0 flex-1 overflow-y-auto`). |
| FR-007 | The mechanism MUST behave correctly whether a list is a BARE surface root (direct child of the tabpanel host) OR nested inside one or more first-party `Column`/`Row` wrappers. |
| FR-008 | The class/variable logic (the host class, wrapper class, and list-root scroll class) MUST live in `slackCatalog/logic.ts` as pure exported strings so the decisions are assertable in a node (no-jsdom) unit test, mirroring `SLACK_LAYOUT_CLAMP_CLASS` and `scroll-area.classes.ts`. |
| FR-009 | The bounding MUST apply to the message-bearing lists (`MessageList`, `SearchResultList`). `ChannelList` MAY also be repaired for consistency; whether it is included is a design decision recorded in the plan (default: include it so a grouped channel+message surface fills uniformly). |
| FR-010 | The change MUST NOT alter the read-only nature of Slack surfaces, the shared `SlackMessageRow`, per-list ordering (`orderBoundMessages`), the load-more/data-model wiring, or the existing `scrollbar-hover-only` behavior — it is a presentational containment change only. |
| FR-011 | The surface MUST remain horizontally wrap-safe — repairing the VERTICAL chain MUST preserve the existing `min-w-0 max-w-full` clamps so it never reintroduces the horizontal-overflow class of bugs `SLACK_LAYOUT_CLAMP_CLASS` prevents. |
| FR-012 | The mechanism MUST degrade gracefully if the SDK `Column`/`Row` markup changes in a future `@a2ui-sdk` upgrade: because the repair is anchored on the FIRST-PARTY wrapper (not the SDK div), an SDK markup change MUST NOT silently reintroduce shared scroll; at worst it falls back to a still-functional (lone-list-fills) state, never a horizontal-overflow or white-screen. The fallback behavior MUST be stated in the plan. |

## Edge Cases & Constraints

- **One list, content shorter than panel**: fills to panel bottom, no inner scrollbar, no dead gap.
- **One list, content taller than panel**: fills, scrolls within its own region; exactly one
  scrollbar (the list's), not a duplicate panel scrollbar.
- **N lists, all short**: each gets its equal share of height; none shows an inner scrollbar; the
  surface as a whole does not need a panel scrollbar because the lists fill but do not overflow.
- **N lists, one very tall**: the tall one scrolls internally within its share; siblings keep their
  share and stay visible.
- **Lists grouped with a `Text` header inside a `Column`** (e.g. header above each list): the fill
  chain forwards through the wrapper; the header takes its natural height and the LIST body takes
  the remaining fill within that column — the header stays visible and only the list body scrolls.
  (A `Column` containing a header + a list splits: header `auto`, list `flex-1 min-h-0`.)
- **Bare list as surface root** (no `Column`/`Row`): the list is a direct child of the
  `flex flex-col min-h-0` host and consumes `flex-1 min-h-0` directly — fills (single) / would be
  the only child so still fills (the multi-list case always implies a grouping container).
- **Thread dock open**: the right-docked thread panel (`@container/slackbody`, line 1574/1600)
  overlays/sits beside the surface; the fill chain must coexist with the narrowed list column when
  the dock is side-by-side and must not break the container-query layout. The host's `min-h-0
  flex-1` must not conflict with the existing `@container/slackbody relative flex min-h-0 flex-1`.
- **Out of scope**: changing the agent prompt/catalog to emit a NEW container node type; changing
  native (non-generative) Slack views (they already each own a `ScrollArea`); changing
  Jira/Confluence catalogs (parity may be noted in the plan but is not required here); a resize
  handle / draggable split between lists; a pinned per-list header (count + load-more stay inside
  the scroll region as today).

## Success Criteria

| ID     | Criterion                                                                                  |
|--------|---------------------------------------------------------------------------------------------|
| SC-001 | A surface with exactly one message list fills the panel down to the bottom with NO visible empty gap below it (R2 holds — fixes the Attempt-1 dead-space defect). |
| SC-002 | A surface with 2+ message lists: scrolling within one list visibly moves only that list's rows; sibling lists' first rows stay fixed, and there is no single shared scrollbar (R1 holds — fixes the Attempt-2 shared-scroll regression). |
| SC-003 | With 2+ lists, no single list pushes a sibling out of view; the lists divide the panel height and each overflowing list shows its OWN scrollbar. |
| SC-004 | A list whose content fits its allotted height shows no inner scrollbar and reserves no dead space below its rows. |
| SC-005 | Per-list load-more (top for history, bottom for search) and `orderBoundMessages` ordering behave exactly as before, now within each list's own region. |
| SC-006 | No horizontal-overflow regression: long unbroken message lines still wrap within each list region. |
| SC-007 | A node unit test asserts the exported host/wrapper/list-root class strings carry the required chain tokens (host: `flex flex-col min-h-0`; wrapper: `flex flex-col min-h-0 flex-1` + the width-clamp tokens; list root: `min-h-0 flex-1 overflow-y-auto` + `min-w-0 max-w-full` + `scrollbar-hover-only`). |

---

## Open Questions

- [ ] **Equal-split vs. cap for the multi-list case (confirm the policy).** v2 chooses
  **equal-share fill** via the flex-fill chain (`flex-1 min-h-0` on each list) so N lists divide
  the panel and all stay visible — this is what makes R1 and R2 the SAME mechanism (a lone list is
  just N=1, so it fills; N>1 splits). The alternative (a per-list `max-h` cap with the surface
  scrolling past) was rejected because it reintroduces a fixed/decoupled cap (the Attempt-1
  failure mode) and does not guarantee all lists are visible. Confirm equal-split is acceptable
  (it is the recommended and default direction); if the user instead wants "first list fills,
  later lists capped and the surface scrolls", that is a different policy and would need a
  measured/container-query variant noted below.
- [ ] **Container-query-height (`cqh`) as a hardening fallback?** A `@container/slackbody` already
  exists on the host (line 1574). The plan should evaluate whether ALSO expressing the lone-list
  fill as `min-h-[100cqh]`/`max-h-[100cqh]` against that container is worth adding as a belt-and-
  suspenders so the fill survives even if the first-party flex chain is accidentally broken by a
  future edit. This is an implementation hardening choice, not a behavior change — flagged for the
  plan to decide, not a blocker.
- [ ] **Include `ChannelList` in the repair (FR-009)?** Default is yes (uniform fill for a grouped
  channel+message surface). Confirm if channel lists should stay unbounded (message lists only).
