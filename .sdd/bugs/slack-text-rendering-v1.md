# Bug Report: slack-text-rendering (v1)

- **Status:** Fixed
- **Reported:** 2026-06-18
- **Severity:** degraded
- **Regression:** unknown (likely present since Slack panel landed — text was never decoded)

## Symptom

In the Slack panel, rendered messages display wrong:
1. **Line breaks not honored** — multi-line Slack messages render as if collapsed / not on separate lines.
2. **Emoji broken** — emoji do not render correctly.

Affects every Slack message surface: `MessageRow` / `MessageList` (channel history) and
`SearchResultRow` / `SearchResultList` (search), on both the native panel and the MCP/agent
render path (both fed by the same text).

## Expected vs Actual

- **Expected:** Slack messages render like Slack — newlines preserved on separate lines, `:emoji:`
  shortcodes (and unicode emoji) shown as the glyph, HTML entities (`&amp;`/`&lt;`/`&gt;`)
  unescaped, mention/link tokens readable rather than raw `<@U…>` / `<http…|text>` markup.
- **Actual:** raw Slack message `text` is shown verbatim. Slack's wire format is NOT plain text;
  it carries `:shortcode:` emoji, HTML-escaped `&amp;`/`&lt;`/`&gt;`, and `<…>` mention/link
  tokens — none decoded.

## Reproduction

1. Connect Slack, open a channel whose history has a multi-line message and an emoji
   (e.g. typed as `:tada:` or a multi-line paragraph).
2. Observe the message row in the cosmos Slack panel.
3. Newlines appear collapsed and/or emoji appear as literal `:tada:` or broken glyphs.

(Could not exercise live without a connected Slack workspace + GUI; reproduction reasoned from
the data pipeline — confirm against a real workspace during verify.)

## Scope & Severity

All Slack message/search rows, both surfaces. Cosmetic-to-degraded (content readable but wrong);
no crash. Not a recent regression — the decode step appears to have never existed.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause — Slack message `text` is passed through undecoded. Fix is one
  shared node-testable decode util applied where text is mapped (`slackClient.ts`), plus its
  callers; one layer, no new IPC/MCP contract, no `UiRenderTarget` change.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** developer
- **Reason:** missing data transformation (Slack mrkdwn/entity/emoji decode). The renderer CSS is
  already correct (`MessageRow`/`SearchResultRow` use `whitespace-pre-wrap break-words`), so the
  bug is in the text data, not the design.

## Root Cause (Step 3) — CONFIRMED

Grounded via codegraph (`codegraph_explore` slackClient mapping, `codegraph_impact decodeSlackText`)
and Read of the renderer rows + IPC/validate boundary.

- **Single origin (both surfaces):** `src/main/integrations/slackClient.ts` is the SOLE place
  Slack message text is mapped. Two call sites:
  - `toMessages()` — `slackClient.ts:370` (history + replies) did `text: String(m.text ?? '')`.
  - `SlackClient.search()` — `slackClient.ts:325` did `text: String(m.text ?? '')`.
  The native panel (over IPC) and the MCP/agent render path (data-bearing surfaces re-execute reads
  through the adapter dispatcher → SlackManager → SlackClient) BOTH consume these mapped DTOs, so
  one undecoded mapping point explains every affected row.

- **Symptom 2 (emoji) — confirmed:** Slack message `text` is "mrkdwn". `:tada:` shortcodes,
  HTML-escaped `&amp;`/`&lt;`/`&gt;`, and `<@U…|name>`/`<#C…|name>`/`<url|label>` tokens were
  forwarded verbatim → literal `:tada:`, escaped entities, raw `<…>` markup in the panel.

- **Symptom 1 (line breaks) — refined, NOT a separate layer:** verified the renderer rows
  (`MessageRow` ~`components.tsx:205`, `SearchResultRow` ~`:310`) already use
  `whitespace-pre-wrap break-words`, and the IPC/validate boundary (`validate.ts`) only validates
  *params* (channelId/cursor/query), never result text — so a real `\n` survives main→renderer to
  the DOM and WOULD render. Slack `conversations.history` does send real `\n`. Conclusion: the
  line-break loss was a hypothesis the reporter could not exercise live; the decode fix explicitly
  PRESERVES `\n` (never collapses), so if any break loss occurred in the undecoded passthrough it is
  fixed, and the regression test locks newline preservation in. Did NOT re-classify to design — the
  CSS is correct and the only data transform is the new decoder, so the bug stays an implementation
  defect owned by developer.

## Fix (Step 4)

One shared, node-testable decoder applied at the single mapping point — both call sites and both
surfaces benefit. No IPC/MCP contract change, no write path, no refactor. Mirrors the existing
`atlassianText.ts` flattener convention (pure, returns `''` for absent input, never throws).

- **New `src/main/integrations/slackText.ts`** — `decodeSlackText(raw: unknown): string`. Order:
  (1) decode `<…>` mention/channel/link/broadcast tokens on raw text FIRST (so a literal `&lt;` in a
  label can't be mistaken for a token delimiter), (2) unescape the Slack-escaped HTML entities
  (`&amp;`/`&lt;`/`&gt;`, plus `&#39;`/`&quot;` defensively — NOT a broad HTML unescape, so unrelated
  `&copy;` is left intact), (3) map `:shortcode:` → glyph (skin-tone modifiers dropped to base;
  unknown shortcodes left verbatim). Newlines preserved verbatim.
- **New `src/main/integrations/slackEmoji.ts`** — `SLACK_EMOJI` curated shortcode→glyph map
  (~150 common chat emoji, `\u{…}` escapes). **No dependency added** — chose a small built-in map
  over an emoji-data package, matching the project's existing no-dependency emoji handling in
  `confluenceCatalog/sanitize.ts`. Unknown names degrade gracefully (left as `:name:`); the map is
  trivially extendable without touching the decoder.
- **`src/main/integrations/slackClient.ts`** — `toMessages()` (`:370`) and `search()` (`:325`) now
  call `decodeSlackText(m.text)` instead of `String(m.text ?? '')`; added the import.

Secrets unaffected — only read-only message text is transformed; no token touches the decoder.

## Regression Test (Step 5)

`src/main/integrations/slackText.test.ts` — vitest, node env, against `decodeSlackText` (pure
`.ts`, no DOM/`.tsx`). 25 cases covering: multi-line text preserved (incl. blank line between
paragraphs, and newlines alongside emoji/entities), `:shortcode:` → glyph (single, multiple,
skin-tone drop, unknown-left-verbatim, `3:1` not-an-emoji), HTML entities unescaped (`&amp;`/`&lt;`/
`&gt;`/`&#39;`/`&quot;`, unrelated `&copy;` intact), mention/channel/link/broadcast/subteam/mailto
tokens rendered readable, and safe fallbacks (empty/undefined/null/non-string → `''`, unterminated
token does not throw), plus a combined realistic message.

**Confirmed it fails without the fix:** the test imports the net-new `slackText.ts` module, so
without the fix the file fails to load (module not found). Additionally simulated the OLD mapping
`String(m.text ?? '')` against representative expectations — it fails 3/3 (`:tada:`, `a &amp; b`,
`hey <@U1|alice>` all pass through verbatim instead of decoding).

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web, exit 0)
- [x] `npm test` green — 67 files / 1229 tests pass, incl. the new 25-case regression test
- [x] No regressions in adjacent behavior — `codegraph_impact decodeSlackText` shows only the two
      `slackClient.ts` mapping callers; `slackClient.test.ts` still passes
- [~] Original Step 1 reproduction re-run — verified at the unit/data level (decoder + existing
      mapping tests), NOT against a live workspace (see below)
- [ ] UI surface exercised (Slack panel) — **NOT done.** The dev app is running, but exercising the
      Slack panel requires connecting a real Slack workspace via OAuth (token in main). No live
      Slack workspace/token was available in this environment, so multi-line + emoji rows could not
      be rendered through the GUI. The fix is verified purely at the node/unit level; a live
      multi-line + emoji message should be eyeballed in the panel before closing if a workspace is
      available.

## Wrap-up (Step 7)

- Root cause was a missing data transform at the single Slack text mapping point; fixed with one
  shared pure decoder (`slackText.ts` + `slackEmoji.ts`) applied in `slackClient.ts`, covering
  history, replies, and search across the native panel and the MCP render path.
- No dependency added (built-in emoji map, matching the project's existing no-dependency emoji
  handling). No IPC/MCP contract change; secret-handling unchanged.
- Convention reinforced: Slack/Atlassian wire text is decoded in main at the mapping boundary
  (pure `.ts`, node-tested), never in the renderer — `slackText.ts` now sits alongside
  `atlassianText.ts` as the Slack analogue.
- Follow-up (optional, out of scope): the emoji map is curated; extend `SLACK_EMOJI` as gaps surface.
