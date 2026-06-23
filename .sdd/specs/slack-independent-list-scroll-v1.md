# Spec: Slack independent message-list scroll — v1

**Status**: Draft
**Created**: 2026-06-23
**Supersedes**: —
**Related plan**: .sdd/plans/slack-independent-list-scroll-v1.md

---

## Grounding

> Tools run directly by the architect for this spec. Verify-don't-trust the framing.

**codegraph_explore**

- `SlackPanel SlackMessageRow slackCatalog components logic message list render scroll` —
  surfaced the Slack catalog list components and the panel shell. Confirmed `MessageList`,
  `ChannelList`, `SearchResultList` are each a plain `<div className="flex w-full max-w-full
  min-w-0 flex-col">` with NO bounded height and NO `overflow-*`.
- `ActiveTabSurface A2UIProvider surface render scroll viewport overflow-y-auto ScrollArea
  generative panel mount` — found the surface render path: `ActiveTabSurface` →
  `A2UIProvider` → `A2UIRenderer`. The agent's emitted catalog nodes become a DOM subtree
  under one provider. `ActiveTabSurface` itself adds no scroll container.
- Read `SlackPanel.tsx` lines 1439–1592 directly (codegraph trimmed the surface mount): the
  generative surface is mounted at line ~1551 inside a SINGLE scroller —
  `<div className="min-w-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">`.
  THIS is why multiple lists share one scroll: every emitted `MessageList` flows into this one
  panel-level `overflow-auto` viewport, so the whole surface scrolls as one column and one list
  pushes the others off-screen.
- Read `slackCatalog/layout.tsx` + `logic.ts` (`SLACK_LAYOUT_CLAMP_CLASS`): the agent groups
  lists with clamped SDK `Column`/`Row` wrappers (`w-full min-w-0 max-w-full`, width-only — no
  height/scroll). `MessageList` re-orders bound rows via `orderBoundMessages` and renders a
  TOP-placed `LoadMoreButton` (older history grows above); `ChannelList`/`SearchResultList` keep
  a BOTTOM load-more. The row component (`SlackMessageRow`) is the ONE canonical row shared with
  the native panel and search results — a recent unification.

**Docs**

- `docs/DEVELOPMENT.md` (575–604): explicit note that "the agent-composed A2UI catalog surfaces
  render inside a plain `overflow-auto` div (no Radix ScrollArea)" — confirms the single shared
  scroller, and that catalog surfaces are NOT subject to the Radix `display:table` wrap bug.
  The `Column`/`Row` clamp pattern is shared across all THREE generative catalogs.
- `docs/ARCHITECTURE.md` (§4.3/§4.4): target-routed multi-panel A2UI hosting; Slack surfaces are
  read-only with no controls. Each panel hosts its own `A2UIProvider` + catalog.

**memory_recall / memory_smart_search**

- `slack message list scroll catalog generative UI shared component …` → no results.
- `generative surface scroll viewport overflow per-list bounded height …` → no results.
- No prior decision on per-list scroll exists; this is net-new. (Will `memory_save` the chosen
  bounding approach once settled.)

---

## Overview

In the Slack panel's agent-generated (A2UI) surface, when the agent renders MULTIPLE Slack
message lists at once, all lists currently share ONE panel-level scroll viewport, so scrolling
one list scrolls the entire surface and a tall list pushes the others off-screen. This feature
makes each rendered message list its OWN independently-scrollable region, so the user can scroll
each list separately while the others stay put.

## User Scenarios

### Scroll one of several lists without disturbing the others · P1

**As a** cosmos user viewing an agent-composed Slack surface that rendered several message lists
**I want to** scroll within one list and have only that list move
**So that** I can read each list independently instead of one tall list shoving the rest away

**Acceptance criteria:**

- Given an agent surface that rendered 2+ Slack message lists, when I scroll inside one list,
  then only that list's rows scroll and the other lists remain in place.
- Given the same multi-list surface, when one list has many more rows than the others, then it
  does not grow tall enough to push the sibling lists out of view — each list occupies a bounded
  region and reveals its overflow via its own scrollbar.
- Given a multi-list surface taller than the panel overall, when I scroll the panel itself, then
  the panel can still scroll the list group as a whole (e.g. to reach a list lower in the
  surface) — per-list scroll does not eliminate the surface-level scroll, it nests beneath it.

### Single list still feels natural · P1

**As a** cosmos user viewing a surface with exactly ONE Slack message list (the common case)
**I want to** the single list to fill the available space and read naturally
**So that** the independent-scroll change never makes the common case feel cramped or boxed-in

**Acceptance criteria:**

- Given an agent surface with exactly one message list, when it renders, then the list is NOT
  confined to a small cramped viewport — it uses the available panel height the way it does today
  (no visible regression for the single-list case).
- Given a single short list (fewer rows than fit), when it renders, then it does not show a
  pointless inner scrollbar or reserve empty bounded space below the rows.

### Per-list load-more and ordering keep working · P2

**As a** cosmos user scrolling an independently-scrollable history list
**I want to** the "load older" affordance and newest-at-bottom ordering to keep behaving
**So that** making the list its own scroll region does not break pagination or message order

**Acceptance criteria:**

- Given a history `MessageList` (top-placed load-more, newest-at-bottom) inside its own scroll
  region, when I load an older page, then the older rows appear above within THAT list's scroll
  region and ordering stays ascending — unchanged from today.
- Given a `ChannelList` / `SearchResultList` (bottom-placed load-more) inside its own scroll
  region, when I load more, then the next page appends within that list's region as before.

## Functional Requirements

| ID     | Requirement                                                                                       |
|--------|---------------------------------------------------------------------------------------------------|
| FR-001 | When the agent renders 2+ Slack message lists in one surface, each list MUST be its own vertically-scrollable region so scrolling one does not scroll the others. |
| FR-002 | Each list's scroll region MUST be height-bounded so a tall list cannot push sibling lists off-screen; overflow beyond the bound MUST be reachable via that list's own vertical scroll. |
| FR-003 | The single-list case MUST remain visually natural — a lone list MUST use the available panel height as it does today and MUST NOT appear cramped, double-boxed, or confined to a small fixed viewport. |
| FR-004 | A list with fewer rows than its bound MUST NOT show an inner scrollbar and MUST NOT reserve empty space below its rows (the region sizes to content up to the bound). |
| FR-005 | The list count label / error notice / load-more affordance MUST remain reachable. If the count label and load-more are part of the list (as today), they MAY stay inside the scroll region; the spec does not require pinning a header, but the list's own load-more MUST stay operable within its bounded region. |
| FR-006 | The bounding MUST apply to the message-bearing lists rendered by the Slack catalog (`MessageList`, and `SearchResultList` which renders the same shared row). It MAY also apply to `ChannelList` for consistency; whether channel lists are bounded is a design decision recorded in the plan. |
| FR-007 | Independent-scroll bounding MUST NOT alter the read-only nature of Slack surfaces, the shared `SlackMessageRow`, per-list ordering (`orderBoundMessages`), or the load-more/data-model wiring — it is a presentational containment change only. |
| FR-008 | The surface MUST remain horizontally wrap-safe — adding a vertical scroll region MUST NOT reintroduce the horizontal-overflow class of bugs the existing `min-w-0 max-w-full` clamps prevent. |
| FR-009 | When only one list is present, the system SHOULD let it grow to fill the panel (so the single-list scenario reads like the native history view), reserving the strict per-list height bound for the multi-list case. [NEEDS CLARIFICATION — see Open Questions: is multi-list bounding "equal share of panel height" or "fixed max-height per list"?] |

## Edge Cases & Constraints

- **One list, many rows**: must fill the panel and scroll naturally (single shared scroll is
  fine when there is only one list) — the multi-list bound should not kick in to shrink it.
- **Many lists, all short**: each region sizes to its content; no list shows an inner scrollbar
  and the surface as a whole scrolls if their combined height exceeds the panel.
- **Lists mixed with non-list nodes** (e.g. a `Text` header above each list, grouped in clamped
  `Column`/`Row`): the bounded scroll applies to the LIST, not the whole `Column`, so a header
  above a list stays visible and only the list body scrolls.
- **Thread dock open**: the right-docked thread panel (`@container/slackbody`) overlays/sits
  beside the surface; per-list bounding must coexist with the narrowed list column when the dock
  is side-by-side, and must not break the container-query layout.
- **Nested lists inside SDK `Column`/`Row`**: the height bound must be expressed so it works
  whether a list is a direct surface child or nested inside the clamped layout wrappers.
- **Out of scope**: changing the agent's catalog/prompt to emit a new container node; changing
  native (non-generative) Slack views (channel history, thread replies, search results already
  each own a `ScrollArea`); changing Jira/Confluence catalogs (parity may be considered in the
  plan but is not required by this spec); adding a resize handle between lists.

## Success Criteria

| ID     | Criterion                                                                                  |
|--------|---------------------------------------------------------------------------------------------|
| SC-001 | In a surface with 2+ message lists, scrolling within one list visibly moves only that list's rows; the other lists' first rows stay fixed. |
| SC-002 | No single list can push a sibling list entirely out of view — each is height-bounded with its own scrollbar when it overflows. |
| SC-003 | A surface with exactly one message list looks and scrolls indistinguishably from today (no cramped inner box, no empty reserved space, fills the panel). |
| SC-004 | A list shorter than its bound shows no inner scrollbar. |
| SC-005 | Per-list load-more (top for history, bottom for channel/search) and `orderBoundMessages` ordering behave exactly as before, now within the list's own scroll region. |
| SC-006 | No horizontal overflow regression: long unbroken message lines still wrap within each bounded list. |

---

## Open Questions

- [ ] **Multi-list height policy (the core decision).** When N>1 lists render, how is each list's
  height bounded? Candidate policies:
  - **(A) Fixed max-height per list** (e.g. each list caps at ~`max-h-[24rem]`/`40vh`), regions
    stack and the surface scrolls past them. Simple, predictable; tall lists each get the same
    cap regardless of N. Recommended default — see plan's chosen approach.
  - **(B) Equal share of panel height** (lists divide the panel via a flex `min-h-0` split so all
    N are visible at once, each scrolling internally). More "dashboard"-like but each list gets
    cramped as N grows, and requires the surface to be a non-scrolling flex column.
  The plan proposes (A) with a single-list exception (FR-009). Confirm whether the user wants a
  fixed cap (A) or an equal split (B).
- [ ] **Does `ChannelList` get the same bounding as `MessageList`?** The request is specifically
  about message lists; FR-006 allows but does not require bounding channel lists. Confirm whether
  consistency across all catalog lists is wanted or message lists only.
- [ ] **Should the count-label header pin while the body scrolls?** FR-005 leaves the header
  inside the scroll region (simplest, matches today). Confirm if a pinned per-list header (count
  + load-more stays visible while rows scroll) is desired, or scroll-the-whole-list is acceptable.
