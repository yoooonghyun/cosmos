# Bug Report: slack-genui-channel-name-above-list (v1)

- **Status:** Fixed (pending visual confirmation)
- **Reported:** 2026-06-27
- **Severity:** cosmetic-layout (readability) — generative Slack surface only
- **Regression:** partial — introduced as a side effect of slack-list-scroll-fill-v2,
  which added `[&>*]:!flex-row` to force MULTIPLE lists side-by-side. That rule also rows a
  non-list header, so a header-over-list became header-beside-list.

## Symptom

In the agent-generated (A2UI catalog) Slack surface, the channel-name shows BESIDE the message
list (to its side); it should show ABOVE the list (stacked on top). User (Korean): "슬랙 generated
ui 메세지 채널명이 메세지 목록 옆에 보이는데 메세지 목록 위에 보이도록 수정".

## Expected vs Actual

- **Expected:** a non-list header (e.g. the channel-name `Text`) stacks ABOVE its message list.
- **Actual:** the header sits beside the list (same horizontal row).

## Reproduction

1. Connect Slack; ask the agent for a channel's history so it composes a generated surface via
   `render_slack_ui` grouping a `Text` channel-name header + a `MessageList` inside one `Column`.
2. Observe: the channel name renders to the LEFT of the message list instead of on top of it.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle.
- **Reason:** single root cause, one renderer-owned CSS class seam (`logic.ts`
  `SLACK_LAYOUT_FILL_CLASS`), no contract/IPC/MCP/adapter change.

## Classification & Routing (Step 2)

- **Class:** implementation defect (a too-broad layout class on the first-party wrapper).
- **Routed to:** developer.

## Root Cause (Step 3)

- **File:** `src/renderer/slackCatalog/logic.ts:579-581` (pre-fix) — `SLACK_LAYOUT_FILL_CLASS`,
  the wrapper class applied by `src/renderer/slackCatalog/layout.tsx` `Column`/`Row` (lines 39 / 48).
- **Mechanism:** the wrapper's only direct child is the SDK `Column`/`Row` flex `<div>`
  (`node_modules/@a2ui-sdk/react/dist/0.9/.../ColumnComponent.js` → `flex flex-col gap-4`). That ONE
  SDK `<div>` holds ALL the agent's grouped children rendered directly as flex items (the SDK
  `children.map` does NOT wrap each child). `[&>*]:!flex-row` overrides the SDK div to `flex-row` so
  that MULTIPLE message lists lay out side-by-side (the v2 "세로 분할" split). But it rows the SDK
  div's ENTIRE child set, so when the agent emits `Column[ Text(channel name), MessageList ]` the
  `<span>`/`<p>` header is forced into the same row as the `MessageList` `<div>` → header BESIDE list.
- **Why it was right before / wrong now:** `!flex-row` is correct for the multi-LIST case but too
  broad — it rows headers too. Lists and headers differ structurally: every list root
  (MessageList/SearchResultList/ChannelList) is a `<div>`; header components (`Text` → `<span>`/`<p>`,
  `UserChip` → `<span>`) are never a `<div>`.

## Fix (Step 4)

CSS-only, same wrapper seam (`SLACK_LAYOUT_FILL_CLASS`). Keep `[&>*]:!flex-row` (multi-list split
preserved) and add:

- `[&>*]:flex-wrap` — the rowed SDK container may break onto multiple lines.
- `[&>*]:content-start` — pack wrap lines at the top so the header line keeps its natural text
  height (no 50/50 cross-stretch).
- `[&>*>*:not(div)]:!basis-full` — force every NON-`<div>` grandchild (a header) to a full-width
  basis so it takes its own wrap line ABOVE; the list `<div>`s wrap to the next line and still share
  width side-by-side (each keeps `flex-1`) and still scroll independently.

**Why it doesn't regress slack-list-scroll-fill-v2:** the `:not(div)` escape targets element TAG,
never a list root (always a `<div>`), so the list `<div>`s keep `flex-1 min-h-0` and their
side-by-side split + independent per-list scroll are untouched. A lone list with NO header does not
wrap (single line) → fills the full width/height exactly as before.

**Tradeoff (documented):** with `content-start`, a wrapped list LINE is sized to the tallest list on
that line rather than force-filling to the panel bottom. So a (header + single SHORT list) surface
may leave a small gap below the list; an overflowing list still bounds + shows its own scrollbar. The
common no-header lone-list path is unaffected. This is the smallest robust seam-level fix; the
alternative (restructuring the agent-emitted shape into `Column[ header, Row[ lists ] ]`) would need
either prompt changes or a renderer surface transform — out of proportion for this layout bug.

## Tests (Step 5)

Pure CSS-class logic, asserted in the existing node-env `.ts`/`.test.ts` split
(`src/renderer/slackCatalog/logic.test.ts`, no `.tsx` import). Added two regression cases in the
`SLACK_LAYOUT_FILL_CLASS` describe block:
- header stacks above (asserts `[&>*]:flex-wrap`, `[&>*]:content-start`,
  `[&>*>*:not(div)]:!basis-full`).
- multi-list split preserved (the `!basis-full` escape is `:not(div)`-scoped, never `[&>*]:`,
  and the list `flex-1`/`min-h-0` chain tokens remain).

## Verification

- `npm run typecheck` — passed (node + web).
- `npx vitest run src/renderer/slackCatalog/logic.test.ts` — PASS (98), FAIL (0).
- **Visual confirmation still needed:** this is a generative flexbox-layout change that cannot be
  exercised headless. The user should visually confirm (a) the channel-name header now sits ABOVE
  the list, and (b) a surface with 2+ message lists still splits side-by-side and each scrolls
  independently.
