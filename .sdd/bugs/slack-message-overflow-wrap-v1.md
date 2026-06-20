# Bug Report: slack-message-overflow-wrap (v1)

- **Status:** Open — routed to developer
- **Reported:** 2026-06-18
- **Severity:** degraded (readability; content present but unreadable for long lines)
- **Regression:** unknown (likely present since the Slack panel landed)

## Symptom

In the Slack panel, **long message lines do not wrap — they overflow horizontally** (text runs
off to the right, horizontal scroll / clipping) instead of wrapping onto the next line. The user
perceives this as "줄바꿈이 안 됨" (line breaks broken), but on clarification it is the
WRAPPING that fails: a long line stays one line and spills past the panel width.

This is DISTINCT from `slack-text-rendering-v1` (that fixed `:emoji:` / entity / `<…>` token
decode and confirmed real `\n` newlines survive to the DOM). Emoji + mention decode now work;
the remaining complaint is purely horizontal overflow of long lines.

## Expected vs Actual

- **Expected:** a long message line wraps at the panel's right edge onto multiple visual lines
  (Slack-like). Real `\n` newlines already render on separate lines (v1).
- **Actual:** a long line extends past the panel width (horizontal overflow / scroll), not wrapping.

## Reproduction

1. Connect Slack, open a channel with a long single-line message (a long sentence or a long URL).
2. Observe the message row overflows horizontally rather than wrapping.

Surface: user reported "모름/여러 곳" (multiple / unsure) — so treat ALL three message render
sites as affected (native history/thread, search, agent-composed catalog).

(Could not reproduce live — no Slack workspace/token in the build env. Reproduction is the user's
direct GUI observation; confirm against the real panel on verify.)

## Initial survey (orchestrator, pre-routing)

All three message-text render sites ALREADY carry `whitespace-pre-wrap break-words` on the `<p>`,
and their immediate parent is `min-w-0 flex-1`:
- `src/renderer/SlackPanel.tsx:209` (native `MessageRow`) + `:622` (native search result).
- `src/renderer/slackCatalog/components.tsx:205` / `:310` / `:440` (agent-composed catalog rows).

So the `<p>` itself is configured to wrap. Yet long lines overflow — pointing at an ANCESTOR width
constraint failing, NOT the paragraph CSS. Prime suspects (for the developer to confirm/refute):
- A flex ancestor in the row → ScrollArea → panel chain whose default `min-width: auto` lets
  content force the track wider than the panel (classic flex-overflow; some link in the chain
  needs `min-w-0` / `w-full`).
- The Radix `ScrollArea` viewport wrapper (`@/components/ui/scroll-area`) — Radix sets
  `display: table` (or `min-width` behavior) on the viewport's inner child, which shrink-to-fits to
  content width, so `whitespace-pre-wrap` text expands the table rather than wrapping. Known Radix
  ScrollArea gotcha; the usual fix is constraining the viewport child to the available width.

## Classification & Routing (Step 2)

- **Class:** Layout / overflow defect (renderer CSS structure). The `<p>` wrap CSS already matches
  intent; the failure is an ancestor width constraint / Radix ScrollArea viewport behavior.
- **Routed to:** developer — the fix is a mechanical CSS/structure change (flex `min-w-0` / `w-full`
  / ScrollArea viewport constraint), NOT a design-system or token change, so no designer handoff
  is needed. Re-route to designer only if the fix turns out to need a new design decision.

## Root Cause (Step 3)

**Confirmed: Suspect #2 — the Radix `ScrollArea` viewport content div.** Not a flex
`min-w-0` chain failure.

`@radix-ui/react-scroll-area` (dist `index.mjs:130`) renders its `ScrollArea.Viewport`
children inside an inner content `div` with an **inline** style
`style={{ minWidth: "100%", display: "table" }}`:

```js
children: jsx("div", { ref: context.onContentChange, style: { minWidth: "100%", display: "table" }, children })
```

A `display: table` box **shrink-to-fits its content's intrinsic width**, and
`min-width: 100%` is only a floor, not a ceiling. So a long unbroken line of
`whitespace-pre-wrap` text expands the table past the panel width and overflows
horizontally — even though the message `<p>` already carries
`whitespace-pre-wrap break-words` and its column is `min-w-0 flex-1`. The paragraph CSS
is correct; its **containing block (the table) is wider than the panel**, so the wrap
cap never engages. This is a documented Radix ScrollArea gotcha.

**Which sites are affected (verified):**
- `src/renderer/SlackPanel.tsx` native sites — channel list (`ChannelList`, `:414`),
  channel history + thread replies (`MessageList`, `:521`), and search results
  (`SearchResults`, `:595`) each render inside `<ScrollArea className="h-full">`. All
  affected.
- `src/renderer/slackCatalog/components.tsx` agent-composed sites — **NOT affected by
  this root cause.** The catalog surface renders via `ActiveTabSurface` → `A2UIRenderer`
  inside a plain `<div className="min-h-0 flex-1 overflow-auto p-3">` (SlackPanel:1002),
  a block container with NO Radix ScrollArea, so there is no `display: table` wrapper.
  Its rows already wrap (block formatting context + `min-w-0 flex-1` column +
  `break-words`). The catalog path was a red herring; no change needed there.

Flex-overflow (Suspect #1) was refuted: the native row chain already carries
`min-w-0 flex-1` on the text column, and the ScrollArea content is block-level, not a
flex track — the overflow is entirely the `display: table` shrink-wrap.

## Fix (Step 4)

Single shared root-cause fix in the shared ScrollArea primitive — benefits all native
Slack read surfaces (and every other ScrollArea consumer) at once, no per-`<p>` patch.

- `src/renderer/components/ui/scroll-area.classes.ts` (new) — factors the viewport
  className into a pure node-testable constant. Adds the override
  `[&>div]:!block [&>div]:!min-w-full` targeting the Radix content child:
  - `[&>div]:!block` defeats the inline `display: table` (switches it to a normal block
    box that fills the available width and lets `whitespace-pre-wrap` text wrap).
  - `[&>div]:!min-w-full` preserves Radix's `min-width: 100%` floor (short content still
    fills the viewport; scrollbar geometry unchanged).
  - `!important` is required because Radix sets `display: table` as an **inline** style,
    which a plain utility class cannot override.
- `src/renderer/components/ui/scroll-area.tsx` — the `ScrollArea.Viewport` now applies
  `SCROLL_AREA_VIEWPORT_CLASS` from that constant (was an inline literal).

No design-system / token change, no refactor of the catalog path, no `<p>` edits — a
structural CSS override only.

## Regression Test (Step 5)

`src/renderer/components/ui/scroll-area.classes.test.ts` (vitest, node env).

- **Proves:** the wrap-enabling override (`[&>div]:!block`, `[&>div]:!min-w-full`, all
  `!important`) is present in the class string the ScrollArea applies and is folded into
  the full viewport class. If a future edit drops it (e.g. a shadcn `--overwrite` re-add
  regenerating the plain viewport className), the suite goes red.
- **Does NOT prove:** the *rendered* layout actually wraps. vitest runs in node with no
  jsdom (`vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts']`), so
  the `.tsx` cannot be mounted and computed width/wrapping cannot be observed. This is the
  closest node-observable proxy — presence of the structural fix in the class contract.
  Visual wrap must be confirmed against the live GUI.

## Verification (Step 6)

- `npm run typecheck` (node + web) — **green** (exit 0).
- `npm test` (full vitest suite) — the new `scroll-area.classes.test.ts` passes (4/4) and
  all Slack/renderer suites pass. **2 pre-existing failures in
  `src/main/googleCalendarManager.test.ts` (token-refresh `listEvents` assertion) are
  UNRELATED** to this fix — confirmed they fail independently of the scroll-area change
  (an unrelated Google Calendar feature, no overlap with touched files).
- **GUI not live-exercised for the wrap:** the dev app is running, but the Slack panel is
  OAuth-gated and this env has no Slack workspace/token, so the actual horizontal-wrap fix
  could NOT be observed in the live GUI. The fix is asserted structurally (correct override
  defeating the confirmed Radix `display: table` inline style) and via the regression test;
  a human should confirm the visual wrap against a real connected Slack workspace.
