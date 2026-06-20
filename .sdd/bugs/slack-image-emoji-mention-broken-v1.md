# Bug Report: slack-image-emoji-mention-broken (v1)

- **Status:** Escalated to `sdd` (scope exceeds bug cycle)
- **Reported:** 2026-06-20
- **Severity:** broken (visible fidelity loss across both Slack surfaces)

## Symptom (Step 1)

User: "슬랙에서 이미지, 이모지, 사용자 태그 깨짐" — persists AFTER `slack-text-rendering-v1`'s
`decodeSlackText` fix. Confirmed via clarification: occurs on BOTH the native Slack panel AND
the generated A2UI Slack surface (both render through `SlackMessageRow`).

Three distinct symptoms:

1. **User tag (mention) → raw ID.** An inline `<@U07ABC>` mention renders as `@U07ABC` (the
   user ID), not the person's display name.
2. **Emoji → literal `:shortcode:`.** A `:tada:`-style shortcode shows verbatim as text rather
   than the glyph.
3. **Image → not shown at all.** An image uploaded to a message does not render (no `<img>`,
   no placeholder) — the message body shows nothing for the image.

## Expected vs Actual

- **Expected:** mention shows `@DisplayName`; emoji shows the glyph; an uploaded image renders
  inline (or at least a usable affordance).
- **Actual:** mention shows `@<userId>`; unknown/custom shortcodes stay literal; images absent.

## Root-cause direction (pre-escalation triage)

- **Mention:** `decodeTokens` in `src/main/integrations/slackText.ts:65` returns
  `target.slice(1)` (= the user ID) when a `<@U123>` token carries NO inline label — and Slack
  history/replies tokens usually have no label. Resolving to a name needs an async `users.info`
  id→name lookup woven into the (currently sync) `toMessages` mapping (`slackClient.ts:364`).
- **Emoji:** `decodeEmoji` (`slackText.ts:47`) maps only the curated `SLACK_EMOJI` table
  (`slackEmoji.ts`); any standard emoji absent from that small table — and all workspace CUSTOM
  emoji (which are image-backed, no Unicode) — stay literal.
- **Image:** Slack message images live in `files[]` / `blocks[]` (auth-gated `https://files.slack.com/…`
  URLs needing the bot bearer). They are NOT fetched into the `SlackMessage` DTO and NOT rendered.
  Rendering them is net-new: a `SlackMessage` DTO field, an IPC/DTO change, a privileged
  `cosmos-slack-img://` streaming protocol (mirroring `confluence-content-images-v1`'s
  `cosmos-confluence-img://` — token stays in main), and a renderer image surface.

## Scope gate (Step 1.5)

- **Decision:** **ESCALATE to `sdd`** — fix exceeds the bug cycle.
- **Reason:** the image symptom is net-new behavior crossing main + IPC/DTO + a new streaming
  protocol + renderer, and the mention fix needs new async user-id resolution wiring. This is a
  new/changed contract across several layers, not a contained one-layer spot fix. The three
  symptoms are cohesive (Slack message-content fidelity) and the image part forces a spec/plan,
  so they are bundled into one sdd cycle (proposed `slack-rich-message-render-v1`) with this
  report as input context.
