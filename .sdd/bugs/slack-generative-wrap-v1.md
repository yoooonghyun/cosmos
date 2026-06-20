# Bug Report: slack-generative-wrap (v1)

- **Status:** Fixed
- **Reported:** 2026-06-18
- **Severity:** broken (content overflows / unreadable in the generative panel)
- **Regression:** no — the generative path was never fully wrap-safe. A prior fix
  (`slack-message-overflow-wrap-v1`) addressed only the NATIVE panel's Radix `ScrollArea`
  `display:table` issue; a later parity change unified the row leaf classes. Neither touched
  the generative-path container that actually overflows.

## Symptom

In the cosmos Slack **generated-UI (A2UI catalog) panel**, long message text does NOT wrap — it
overflows horizontally instead of breaking onto new lines. Persists after the prior text-decode
fix and after unifying the canonical row component. User re-confirmed it is still broken in the
generative UI specifically (the native Slack browser panel wraps fine).

## Expected vs Actual

- **Expected:** A long unbroken message line in a generated Slack surface wraps to the panel
  width (same as the native panel), matching the leaf `<p>`'s `whitespace-pre-wrap break-words`.
- **Actual:** The line extends past the panel's right edge; the surface scrolls/overflows
  horizontally and the text is clipped/unreadable.

## Reproduction

1. Connect Slack, open the Slack panel, ask the agent for channel history / search results so it
   composes a generated surface via `render_slack_ui` (it groups the list in a `Column`/`Row` —
   the common case, e.g. a `Text` header + `MessageList`).
2. Ensure at least one message has a long unbroken token (a long URL or no-space string).
3. Observe: that row's text overflows horizontally instead of wrapping. (Same data in the native
   browser panel wraps correctly.)

## Scope & Severity

Affects every agent-composed Slack surface whose list is grouped inside a `Column`/`Row` (almost
all of them). Cosmetic-but-breaking: content is unreadable. Renderer-only, Slack generative layer.
The same unclamped SDK Column/Row are registered in Jira/Confluence catalogs (latent, not in scope).

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in the Slack renderer catalog (a missing width-clamp on the
  container the agent groups with); contained CSS/wiring fix, no contract/IPC/MCP change.

## Classification & Routing (Step 2)

- **Class:** Implementation defect (with a design-system flavor — a wrong/missing layout class on
  a container). Routed within the renderer layer.
- **Routed to:** developer
- **Reason:** The fix is wiring + a width-clamp class in the Slack catalog (`index.ts` +
  new `layout.tsx`), with a node-testable class seam in `logic.ts` — implementation work, no
  design-token or contract change.

## Root Cause (Step 3)

- **Origin:** `src/renderer/slackCatalog/index.ts:62-63` (pre-fix) registered the agent-facing
  `Column`/`Row` as the raw SDK `standardCatalog.components.Column`/`Row`. Those render at
  `node_modules/@a2ui-sdk/react/dist/0.9/components/layout/ColumnComponent.js:28` /
  `RowComponent.js:28` a `<div className="flex flex-col gap-4">` / `"flex flex-row gap-3">`
  with **no `min-w-0`**.
- **Why:** A flex container with default `min-width: auto` grows to its content's INTRINSIC
  (`max-content`) width. When the agent groups a list inside a `Column`/`Row` (e.g. `Text` header
  + `MessageList`), that SDK container becomes the containing block for the list. A long unbroken
  message line expands the SDK container past the panel width, so the leaf `<p>`'s
  `whitespace-pre-wrap break-words` and the list root's `w-full max-w-full min-w-0`
  (`components.tsx:309`) never take effect — `max-w-full` resolves to 100% of an already-overgrown
  parent. The DOM chain confirms it (the A2UI SDK adds no wrapper DOM of its own —
  `A2UIRenderer`/`ComponentRenderer` render the catalog component directly): panel host
  `overflow-auto` div (`SlackPanel.tsx:1018`) → SDK `Column`/`Row` flex div (UNCLAMPED) → list
  root → `SlackMessageRow` `<p>`. The native panel never hits this: it wraps rows in `<ScrollArea>`
  + its own `min-w-0` flex divs and never routes through the SDK Column/Row.

  This is a SECOND, distinct overflow source from the prior `slack-message-overflow-wrap-v1`
  (Radix `ScrollArea` `display:table`), which only ever affected the native path — hence the bug
  survived that fix and the row-unification fix.

## Fix (Step 4)

Register width-CLAMPED `Column`/`Row` wrappers in the Slack catalog instead of the raw SDK ones.
The third-party SDK div className can't be edited, so the wrapper renders the SDK `Column`/`Row`
inside a `w-full min-w-0 max-w-full` block box. That box is bounded by the panel width; the SDK
flex div is a block-level child of it, so its `min-w-0` list-root descendants finally wrap. All SDK
behavior (children-by-id, justify/align/weight, template binding) is forwarded verbatim.

- **Files changed:**
  - `src/renderer/slackCatalog/logic.ts` — new `SLACK_LAYOUT_CLAMP_CLASS = 'w-full min-w-0 max-w-full'`
    (node-testable seam, mirrors `scroll-area.classes.ts`) + rationale comment.
  - `src/renderer/slackCatalog/layout.tsx` — NEW: `Column`/`Row` wrappers rendering the SDK
    container inside the clamp box.
  - `src/renderer/slackCatalog/index.ts` — register the clamped wrappers; drop the now-unused
    `standardCatalog` import.
  - `src/renderer/slackCatalog/logic.test.ts` — regression tests.
  - `docs/DEVELOPMENT.md` — corrected the stale "A2UI surfaces are NOT affected" note; documented
    the SDK-Column/Row clamp gotcha (and that Jira/Confluence carry the same latent issue).
- **Summary:** The overflow came from an unclamped flex container the agent groups with; clamping
  it (`min-w-0` defeats flex `min-width:auto`; `max-w-full` caps at panel width) restores wrapping
  at root cause without touching the already-correct row leaf.

## Regression Test (Step 5)

- **Test:** `src/renderer/slackCatalog/logic.test.ts` — `describe('SLACK_LAYOUT_CLAMP_CLASS (generative wrap clamp)')`
- **Asserts:**
  1. The clamp class carries `min-w-0` + `max-w-full` + `w-full`.
  2. The SDK Column/Row source emits `flex flex-col`/`flex flex-row` with NO `min-w-0` (the root
     cause; read from the SDK `.js` source because the SDK components require `SurfaceProvider`
     context and can't be mounted in node/no-jsdom).
  3. The catalog `index.ts` registers the wrappers from `./layout` and NOT
     `standardCatalog.components.Column/Row`, and `layout.tsx` applies the clamp around the SDK
     container.
- **Fails-without-fix confirmed:** yes — before the fix `index.ts` imported nothing from `./layout`
  and registered `standardCatalog.components.Column/Row` directly, so assertions (3)
  (`toContain("from './layout'")`, `not.toContain('standardCatalog.components.Column')`) and the
  `layout.tsx`-existence assertions would fail. `layout.tsx` and `SLACK_LAYOUT_CLAMP_CLASS` did not
  exist pre-fix.

  > Why no end-to-end "computed wrap" assertion: vitest runs in node (no jsdom), and the SDK
  > Column/Row require `SurfaceProvider` context, so the rendered DOM / computed layout can't be
  > observed in a unit test. The node-checkable invariant is the class seam + the catalog wiring;
  > the actual on-screen wrap is covered by the manual GUI check below.

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web)
- [x] `npm test` green — 70 files / 1327 tests, incl. the new regression tests (39 in the slack
      logic file)
- [x] Original Step 1 reproduction reasoned through: the SDK container is now clamped, so the leaf
      `break-words` has a panel-bounded containing block — the long line wraps.
- [ ] UI surface exercised in `npm run dev`: NOT run in this cycle (headless). Manual GUI check
      below is required to confirm the on-screen wrap.
- [x] No regressions in adjacent behavior: only the Slack catalog Column/Row registration changed;
      list/row leaf classes untouched; all suites pass.

### Manual GUI check (required — couldn't be exercised headless)

In `npm run dev` → Slack panel: ask the agent for channel history/search containing a message with
a long unbroken token (long URL). Confirm the generated surface's message text WRAPS to the panel
width with no horizontal scrollbar, in both a `Column`-grouped and a `Row`-grouped layout, and that
the native browser panel still wraps as before.

## Latent instances fixed — Jira + Confluence catalogs (2026-06-19)

The same root cause (raw, unclamped `standardCatalog.components.Column/Row` registered for the
agent-facing `Column`/`Row`) was latent in the Jira and Confluence catalogs, flagged but out of
scope above. Both are now fixed by mirroring the Slack pattern EXACTLY — wrapper + registration +
clamp const + regression test per catalog, no other changes.

- **Jira (`src/renderer/jiraCatalog/`):**
  - `layout.tsx` — NEW: clamped `Column`/`Row` wrappers rendering the SDK container inside the
    clamp box.
  - `logic.ts` — new `JIRA_LAYOUT_CLAMP_CLASS = 'w-full min-w-0 max-w-full'` + rationale comment.
  - `index.ts` — register the clamped wrappers from `./layout`; drop the now-unused
    `standardCatalog` import (kept `type Catalog`).
  - `logic.test.ts` — `describe('JIRA_LAYOUT_CLAMP_CLASS (generative wrap clamp)')` regression
    (3 cases mirroring Slack: clamp tokens; SDK source has no clamp; catalog wires the wrappers).
- **Confluence (`src/renderer/confluenceCatalog/`):** same treatment —
  `layout.tsx` (NEW), `CONFLUENCE_LAYOUT_CLAMP_CLASS` in `logic.ts`, `index.ts` registration swap
  (dropped unused `standardCatalog` import), and a parallel `logic.test.ts` regression block.

Neither catalog was skipped — both registered the raw SDK Column/Row and so carried the bug. Same
node-test limitation applies (SDK components need `SurfaceProvider`, can't mount in node/no-jsdom),
so the regression asserts the class seam + catalog wiring, not computed layout. Manual GUI wrap
check for the Jira and Confluence generative panels is likewise recommended.

## Wrap-up (Step 7)

- **bug memory saved:** see `memory_save` below.
- **Docs updated:** `docs/DEVELOPMENT.md` (corrected stale note + new SDK-Column/Row clamp gotcha).
  No `docs/ARCHITECTURE.md`/`CLAUDE.md` change needed (renderer-layer gotcha, developer-owned).
- **wrap-up run:** pending (orchestrator to invoke `wrap-up`).
