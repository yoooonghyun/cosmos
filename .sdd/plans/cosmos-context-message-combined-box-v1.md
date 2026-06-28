# Plan: Cosmos Timeline — Context + Message Combined Box — v1

**Status**: Draft
**Created**: 2026-06-29
**Last updated**: 2026-06-29
**Spec**: `.sdd/specs/cosmos-context-message-combined-box-v1.md`

---

## Grounding

> Direct investigation run for this plan (architect grounding). Tools run by the architect.
> NOTE: the `wiki_query`/`wiki_ingest` LLM-wiki tools were NOT in this session's toolset, so
> prior-decision grounding came from reading the in-repo source of truth (sibling plan/spec +
> the live source) — flagged so the gap is visible.

**codegraph_explore (one-line takeaways):**

- `CosmosTimelineEntry PromptContextChip UserBubble ToolCallRow` — confirmed the three render
  branches that stack `PromptContextChip` ABOVE `UserBubble` in `flex flex-col gap-1`
  (`live-generating` and `user-prompt`), `UserBubble` = one right-aligned `bg-primary
  text-primary-foreground rounded-2xl rounded-br-sm max-w-chat-bubble` `<p>`, and `ToolCallRow` =
  the sectioned-box template (header button + `border-t border-border/60` divider + `{open &&}`
  body). The combined box borrows that STRUCTURE, not its muted color, and drops the collapse.

**Source reads (in lieu of wiki):**

- `.sdd/plans/cosmos-panel-tab-list-v1.md` — the CONCURRENT feature. It edits `CosmosPanel.tsx`,
  `useGenerativePanelTabs.ts`, `App.tsx`, adds `src/renderer/panelTabs/` + `PanelTabTree.tsx`, and
  (Phase 6) touches `PromptContextChip`/`contextChipIcons`/`ContextChipData` to render a panel+tab
  chip kind. It does NOT restructure the chip-above-bubble layout (it works the composer-side
  selection + the right-column tree). Both features touch `CosmosTimelineEntry.tsx`/
  `PromptContextChip.tsx` → HARD sequencing dependency (this lands AFTER it).
- `src/renderer/cosmos/PromptContextChip.dom.test.tsx` — the existing suite asserts (a) the chip's
  dimension permutations + dock kinds + `role="note"`/`aria-label` + no raw marker (all CONTENT,
  preserved), and (b) `CosmosTimelineEntry — historical user-prompt turn`: the chip sits **ABOVE**
  the bubble (`chip.compareDocumentPosition(bubble) & DOCUMENT_POSITION_FOLLOWING`, lines 157-159).
  That ordering assertion + its `#2 ordering` doc comment WILL BREAK and MUST be updated to the
  in-bubble-header structure. The REAL-codec round-trip tests (lines 192-267) assert content +
  clean prose only — they still pass (findable by `role="note"`/`getByText`).
- `docs/ARCHITECTURE.md:761` — one line says the timeline "renders it as the read-only
  `PromptContextChip`". A light coherence reword (chip-above → in-bubble context header of the
  combined message box) lands WITH the implementation (Phase 4), not ahead of it.

---

## Summary

A **renderer-only** restructure of `src/renderer/cosmos/CosmosTimelineEntry.tsx`. Today the
`live-generating` and historical `user-prompt` branches render `<PromptContextChip>` (a free-standing
right-aligned `Badge variant="secondary"` pill) ABOVE a separate `<UserBubble>` in a `flex flex-col
gap-1`. This feature MERGES them into ONE combined message box — a single right-aligned `bg-primary`
/ `max-w-chat-bubble` bubble that, when a context is present, contains a **static context-breadcrumb
HEADER**, a **horizontal divider**, then the **always-visible message body** (the tool-call row's
sectioned structure, but NOT collapsible and NOT muted). When there is no context, the box renders as
exactly today's plain bubble (no header, no divider) — FR-009. The chosen reuse approach **extracts
`PromptContextChip`'s breadcrumb inner content into a shared presentational piece** (`PromptContextBreadcrumb`)
so the combined-box header and any remaining standalone use consume ONE breadcrumb source — no fork
of the segment/dock/aria logic. No IPC, contract, `PromptContext`, or marker-codec change.

## Chosen `PromptContextChip`-reuse approach + why

**Decision: (b) EXTRACT the breadcrumb inner content into a shared presentational piece —
`PromptContextBreadcrumb` — NOT (a) a render-variant prop on `PromptContextChip`.**

`PromptContextChip` today is two concerns welded together: the **breadcrumb CONTENT** (the null
guard, the `dockTarget` narrowing + `contextChipFor` dock derivation, the panel/tab/dock segments,
the `ariaLabelFor` + `role="note"`) and the **pill CHROME** (the `flex justify-end` wrapper + the
`Badge variant="secondary"` `max-w-chat-bubble` pill). The combined-box header needs the CONTENT
verbatim (FR-007) but a **different** chrome: it is a header section INSIDE the `bg-primary` bubble —
no `justify-end` (the box owns alignment), no `Badge` secondary-pill background (it sits on the accent
fill; the designer owns the exact in-bubble treatment).

- A **prop-variant** (option a) would pile two divergent chrome treatments (secondary pill vs.
  in-bubble header on `bg-primary`, with different alignment ownership and a divider sibling) plus
  their conditional class logic into one component — more branching, more brittle, and the variant's
  premise ("one component serves both LIVE uses") is moot: after this merge the standalone pill has
  **no remaining renderer consumer** (grep: `PromptContextChip` is imported only by
  `CosmosTimelineEntry.tsx` + its test). There is effectively ONE live use — the in-bubble header.
- **Extraction** (option b) gives ONE breadcrumb-content source (the segments + dock derivation +
  `role="note"`/aria + null guard) that the combined box renders directly as its header. The chrome
  difference becomes two thin wrappers (or one, if the standalone pill is retired) over the shared
  piece — no conditional-chrome branching, no duplicated segment logic, single place to keep the
  D-11 idiom. This is the lower-risk, less-coupled shape and matches the spec's "reuse content, only
  relocate" intent (FR-007).

**Shape:**
- Extract `PromptContextBreadcrumb({ context })` (exported from `PromptContextChip.tsx` to keep the
  merge surface minimal — no new file) carrying: the `!context` null-guard (returns `null`), the
  `PanelGlyph`/`dockTarget`/`dockChip` derivation, the `DockSegment`/`TruncLabel` segments, and
  `role="note"` + `ariaLabelFor`. It renders the segments only — NO `justify-end`, NO `Badge`.
- The **standalone `PromptContextChip`** becomes a thin shell: `<div className="flex justify-end">
  <Badge variant="secondary" …><PromptContextBreadcrumb context /></Badge></div>` — OR is retired if
  the design step confirms no surface still wants the pill. Default: **keep it as the thin shell** so
  the existing standalone-chip dom tests (the non-`CosmosTimelineEntry` `describe('PromptContextChip')`
  block) keep passing unchanged, and removing it stays out of scope. (Designer/dev may retire it later
  if truly unused.)
- New local `UserMessageBox` in `CosmosTimelineEntry.tsx` replaces the `flex flex-col gap-1` +
  `UserBubble` pair: a right-aligned `bg-primary` / `max-w-chat-bubble` box that renders
  `{context && (<header><PromptContextBreadcrumb context /></header> + <divider/>)}` then the
  always-visible body (`whitespace-pre-wrap break-words`, today's text rendering). `UserBubble` is
  absorbed into / replaced by `UserMessageBox` (kept as the body sub-element). Exact divider/ header
  classes are placeholders pending the design step (§ Design step).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (React renderer; jsdom-tested). No pure-node helper expected (no new serialization/parse logic). |
| Key dependencies  | Existing only — `PromptContextChip`'s breadcrumb internals, `Badge`/`Tooltip` primitives, the `max-w-chat-bubble` token, `bg-primary`/`text-primary-foreground`, `SURFACE_ICON`/`PRIMARY_ICON`/`contextChipFor`. No new npm package, no new MCP server, no new IPC channel, no preload change, no contract/marker change. |
| Files to create   | (none expected — `PromptContextBreadcrumb` is exported from the existing `PromptContextChip.tsx`; the combined box is a local component in `CosmosTimelineEntry.tsx`). |
| Files to modify   | `src/renderer/cosmos/CosmosTimelineEntry.tsx` (merge chip+bubble into `UserMessageBox` for BOTH branches; absorb `UserBubble`), `src/renderer/cosmos/PromptContextChip.tsx` (extract `PromptContextBreadcrumb`; reshape the standalone chip as a thin shell over it), `src/renderer/cosmos/PromptContextChip.dom.test.tsx` (update the `historical user-prompt turn` ordering assertion + comment to the in-bubble-header structure; add combined-box assertions), `docs/ARCHITECTURE.md` (one-line coherence reword at ~L761). |
| Layers touched    | Renderer presentation only (1 layer): the Cosmos timeline user-prompt rendering. No main/IPC/MCP/shared-contract change. |

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 0 — Sequencing gate (HARD dependency — do NOT start before this clears)

- [x] **Confirm `cosmos-panel-tab-list-v1` has MERGED** before editing any file. (`src/renderer/panelTabs/` present on disk; `PromptContextChip` already narrows `'terminal'`.) That feature also
  edits `CosmosTimelineEntry.tsx` and `PromptContextChip.tsx` (its Phase 6 adds a panel+tab chip
  kind + ensures the timeline chip still renders panel+tab turns). Landing this feature first would
  force a merge clash on both shared files. **This feature lands AFTER it.** (Spec Edge Case +
  coordinator-confirmed sequencing.)
- [x] **Confirm the design step (Step 2.5) is complete** so the in-bubble divider/header treatment +
  the breadcrumb-on-`bg-primary` contrast decision are in hand before implementation (see Design step).

### Phase 1 — Interface / extraction (renderer)

- [x] In `PromptContextChip.tsx`, extract `PromptContextBreadcrumb({ context })`: move the `!context`
  null-guard, the `PanelGlyph`/`dockTarget`/`dockChip` derivation, the segment JSX
  (`DockSegment`/`TruncLabel`/panel/tab), and `role="note"` + `ariaLabelFor` into it. It renders the
  segments only — NO `flex justify-end`, NO `Badge`. Export it.
- [x] Reshape standalone `PromptContextChip` as a thin shell: `flex justify-end` + `Badge
  variant="secondary" max-w-chat-bubble` wrapping `<PromptContextBreadcrumb context />`. Behavior +
  DOM for the standalone path stays equivalent (its dom tests must still pass). [Note: retire the
  shell only if the design step confirms no surface wants the pill — default keep.]
- [x] No new types — `PromptContext` is unchanged. Confirm no invented props (FR-008/FR-012).

### Phase 2 — Combined box (renderer)

- [x] Add `UserMessageBox({ text, context })` to `CosmosTimelineEntry.tsx`: a right-aligned
  (`flex justify-end`) `bg-primary` / `text-primary-foreground` / `max-w-chat-bubble` box. When
  `context` present: render a static header section `<PromptContextBreadcrumb context />` + a
  horizontal divider (`border-t …`, exact token from the design step), then the always-visible body.
  When `context` absent: render ONLY the body, identical to today's plain bubble (FR-009). NO toggle,
  NO `aria-expanded`, NO collapse (FR-005/FR-006). Body keeps `whitespace-pre-wrap break-words` +
  today's text rendering (FR-011).
- [x] Wire BOTH branches to `UserMessageBox` (FR-010):
  - `live-generating`: `entry.promptText && <UserMessageBox text={entry.promptText}
    context={entry.promptContext} />` (replaces the `<PromptContextChip>` + `<UserBubble>` pair);
    keep the `AssistantRow`/`TypingIndicator` below.
  - `user-prompt`: `<UserMessageBox text={turn.text} context={turn.context} />` (replaces the
    `flex flex-col gap-1` + chip + bubble).
- [x] Absorb/replace `UserBubble` (its body styling moves into `UserMessageBox`'s body element; the
  shared `max-w-chat-bubble` token + rounded-corner treatment preserved per the design step).
- [x] Update the in-code comments that currently say "chip ABOVE the user prompt … stable across the
  confirm" to describe the combined in-bubble header.

### Phase 3 — Tests (jsdom; no node-unit unless a pure helper is extracted)

- [x] Update `PromptContextChip.dom.test.tsx` `describe('CosmosTimelineEntry — historical
  user-prompt turn')`: replace the chip-ABOVE-bubble ordering assertion (+ its `#2 ordering` comment)
  with combined-box assertions — the breadcrumb (`role="note"`) and the body text are in ONE box, the
  breadcrumb precedes the body in DOM order WITHIN that box, and a divider element is present between
  them.
- [x] Add: **combined box (context present)** — header + divider + body present in ONE box; body
  visible without interaction; **NO collapse control** (`queryByRole('button')` for a toggle absent /
  no `aria-expanded`) (FR-005/FR-006).
- [x] Add: **null context → plain bubble** (FR-009) — for BOTH a `user-prompt` turn with no `context`
  AND a `live-generating` entry with no `promptContext`: body present, `queryByRole('note')` absent,
  no divider element.
- [x] Add: **live + historical parity** (FR-010) — a `live-generating` entry and a `user-prompt`
  turn carrying the SAME context render the same combined-box structure (header + divider + body).
- [x] Confirm the REAL-codec round-trip tests (lines ~192-267) still pass unchanged (content +
  clean-prose assertions are structure-agnostic).
- [x] Long-content guards (SC-006): a long breadcrumb still truncates (tooltip preserved) and a
  long/multi-line body still wraps within `max-w-chat-bubble` — assert the box/segment classes
  rather than measuring pixels (jsdom has no layout).

### Phase 4 — Docs

- [x] `docs/ARCHITECTURE.md` (~L761): reword "renders it as the read-only `PromptContextChip`" →
  the in-bubble context header of the combined user-message box (chip-above placement superseded).
  Land this WITH the code (not before).
- [x] Confirm the designer has updated DESIGN.md D-11 (placement superseded), §2 (the "prompt context
  chip" token row), and §15 (chat-surface canon) in the design step — this plan does NOT edit
  DESIGN.md. If a wrap-up reconciliation is needed, flag it.
- [x] Update this plan's Deviations with anything that differed; `TODO.md` reconciled at wrap-up.

---

## Test Layers

- **jsdom (`PromptContextChip.dom.test.tsx`, the existing suite extended):** the combined-box DOM —
  header + divider + body in ONE box; no collapse control / body always visible; null-context → plain
  bubble (both live + historical); live↔historical parity; long-content class guards; existing
  standalone-chip + REAL-codec round-trip tests still green.
- **node-unit:** none expected. The feature extracts no pure serialization/parse logic
  (`PromptContextBreadcrumb` is presentational). IF the implementer factors out a pure helper (e.g. a
  "has-context" predicate), add a `.ts`/`.test.ts` node unit per the project split — but the plan does
  not anticipate one.

---

## Design step (Step 2.5 — designer inputs; NOT resolved here)

The designer owns and MUST decide before Phase 1/2 implementation:

- The **in-bubble divider** treatment on the `bg-primary` accent fill (color/weight/opacity — the
  tool-call row's `border-border/60` is tuned for a muted box, not the accent fill).
- The **header** type/spacing inside the bubble (the breadcrumb as a header band vs. inline header).
- The **CONTRAST of the breadcrumb glyphs/labels now on `bg-primary`** instead of `bg-secondary` —
  the architect-flagged item: the segments currently use `text-muted-foreground`, tuned for the
  secondary pill; they may not read on the brand-pink fill and likely need a primary-foreground-family
  tone.
- DESIGN.md updates: **D-11** (placement superseded: above → in-bubble header), **§2** (the prompt
  context chip token row), **§15** (chat-surface canon — the combined box replacing chip-above-bubble).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-29**: Reuse approach decided as (b) EXTRACT `PromptContextBreadcrumb` (shared content
  piece), not (a) a prop-variant on `PromptContextChip` — the standalone pill has no remaining
  renderer consumer after the merge, so a variant's "one component, two live uses" premise is moot;
  extraction avoids forking the segment/dock/aria logic and keeps the chrome difference as thin
  wrappers.
- **2026-06-29 (implemented)**: `PromptContextBreadcrumb` now CARRIES `role="note"` + `aria-label`
  itself (the breadcrumb IS the meaning), so both consumers are pure chrome and there is exactly one
  `role="note"`. The standalone `PromptContextChip` nests the breadcrumb inside `Badge
  variant="secondary"` (NOT `asChild`/Slot — a plain function child doesn't forward Slot's injected
  props; nesting keeps the standalone DOM/tests stable). Its FR-021 null-guard is kept on the chip
  too (renders nothing) so no empty pill.
- **2026-06-29 (deviation from plan Phase 2 wiring)**: the `live-generating` branch renders
  `UserMessageBox` when `promptText || promptContext` (passing `text={promptText ?? ''}`), NOT only
  when `promptText` is truthy. RATIONALE: pre-merge, the free-standing chip rendered from
  `promptContext` independently of `promptText`; the cross-panel live-context flow
  (`CosmosCrossPanelLiveContext.dom.test.tsx`) seeds context WITHOUT text. Guarding the merged box on
  `promptText` alone would have dropped the context header in that flow (2 tests went red). The
  OR-guard preserves the prior "context shows whenever captured" behavior under the merged box and
  keeps FR-010 parity. No spec change — this restores existing behavior, doesn't add scope.
- **2026-06-29 (user follow-up, in-scope)**: glyph SIZE moved onto the shared breadcrumb
  `DECORATION` class (`size-3 shrink-0 opacity-70`). Pre-merge the `Badge`'s `[&>svg]:size-3` sized
  the icons; once the breadcrumb left the Badge's direct-svg scope (in-bubble header), the lucide/
  brand SVGs fell back to their 24px/`1em` default and read oversized (user: "tab icon이랑 cosmos
  icon 크기 너무커"). Baking `size-3` on the glyph itself uniformly sizes panel/cosmos/tab/dock/
  chevron glyphs on ANY container.

---

## Needs confirmation before the design/dev steps

1. **Sequencing (hard):** this feature MUST land AFTER `cosmos-panel-tab-list-v1` merges (shared edits
   to `CosmosTimelineEntry.tsx` + `PromptContextChip.tsx`). Confirm that ordering holds.
2. **Standalone-pill fate:** plan defaults to KEEPING `PromptContextChip` as a thin shell over the
   extracted breadcrumb (so its existing standalone dom tests stay green and removal stays out of
   scope). Confirm OK to retire it later only if the design step finds no surface wants the pill —
   not in this feature.
