# Spec: Slack Rich Message Render — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/slack-rich-message-render-v1.md (to be authored next)
**Input context**: .sdd/bugs/slack-image-emoji-mention-broken-v1.md (escalated from bugfix scope-gate)

---

## Grounding

**codegraph_explore** (code structure — verbatim source returned, treated as read):
- `slackClient toMessages SlackMessage DTO slackText decodeTokens decodeEmoji slackEmoji SlackManager slackAdapter slackSurfaceBuilder` → confirmed `toMessages` (`slackClient.ts:364`) is the SINGLE sync message-mapping point for history + replies; `decodeSlackText`/`decodeTokens` (`slackText.ts`) return the raw user id (`@U07ABC`) when a `<@U…>` token has no inline label; `decodeEmoji` maps only the curated `SLACK_EMOJI` table; `toMessages` drops `files[]`/`blocks[]`. `getUser`/`SlackUser` already exist (users.info).
- `SlackManager getHistory getReplies search SlackMessage SlackUser` → `SlackMessage` DTO (`src/shared/slack.ts:77`) carries `ts/userId/userName?/text/replyCount?` — NO image field. `SlackManager.getUser` exists; reads run through `run()`/`ensureToken()`.
- `SlackMessageRow slackCatalog components slackAdapter slackSurfaceBuilder SlackPanel` → `SlackMessageRow.tsx` is the ONE canonical row imported by both the native panel and the generated catalog; body is a single `<p>{text}</p>`. Native panel resolves mention author names via a renderer `nameCache` + `resolveNames` (works for `userId`, NOT for inline `<@…>` tokens in `text`). Generative path resolves via `slackAdapter.ts`.
- `confluenceImageProtocol registerSchemesAsPrivileged protocol.handle confluenceImageRef … slackEmoji SLACK_EMOJI` + Read of `confluenceImageProtocol.ts`, `confluenceImageRef.ts`, `contentImageSrc.ts` → confirmed the mirror surface: privileged scheme registered pre-`app.ready`; `protocol.handle` post-ready; pure SSRF-safe base64url ref codec rejecting forged/absolute/traversal refs; renderer rewrites `src` to the opaque scheme; `ConfluenceManager.currentAuth()` main-only token accessor; `index.html` CSP `img-src 'self' data: https: cosmos-confluence-img:`.
- Read `slackConfig.ts` → current Slack `user_scope` set: `channels:read, channels:history, users:read, search:read`. Custom-emoji `emoji.list` requires a NEW scope `emoji:read`.

**memory_recall** (agentmemory):
- `Confluence content attachment images cosmos-confluence-img protocol ref codec SSRF` → full end-to-end architecture memory of `confluence-content-images-v1` + `confluence-attachment-scope-v1`: one privileged streaming scheme, base64url path/id ref (no token/host), SSRF guard, `net.fetch` with bearer from main-only accessor, CSP widening, scope add → one-time reconnect, CSP meta change needs dev relaunch. This is the template to mirror for Slack images.
- `slack-text-rendering-v1 / slack-generative-message-parity / SlackMessageRow` and `slack OAuth scopes … emoji.list` → no stored memories (confirmed via empty recall); grounded directly from code instead.

**OPEN QUESTION (proceeding with the noted assumption):**
- OQ-1: Slack's `emoji.list` returns custom-emoji entries that can be `alias:other-name` (an alias chain) and standard-emoji entries the workspace has not overridden. **Assumption:** v1 resolves a one-hop alias to its target, treats unknown/standard-aliased shortcodes as "not custom" (falls through to the standard-emoji library), and never loops. Flagged here; resolve concretely in the plan/interface step. No other spec-level ambiguity — the user's four decisions are settled.

---

## Overview

Slack messages on BOTH cosmos Slack surfaces (the native panel and the generated A2UI surface, which share `SlackMessageRow.tsx`) currently lose three classes of content fidelity: inline user mentions render as raw ids, `:shortcode:` emoji outside a tiny curated table stay literal, and uploaded images do not render at all. This feature makes a Slack message render with its mentions resolved to display names, its emoji shown as glyphs or images, and its attached images shown as inline thumbnails — identically on both surfaces — while keeping the Slack bot/user token confined to the main process.

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### Inline mention resolves to a display name · P1

**As a** cosmos user reading a Slack channel or thread
**I want to** see `@DisplayName` where a message mentions someone
**So that** I can tell who is being addressed without decoding user ids.

**Acceptance criteria:**
- Given a message whose text contains `<@U07ABC>` with no inline label, when the message renders on the native panel, then it shows `@`+the user's display name (e.g. `@Jane Doe`), not `@U07ABC`.
- Given the same message rendered on the generated A2UI Slack surface, then it shows the identical resolved `@DisplayName`.
- Given a message that mentions several distinct users, when it renders, then each mention resolves to its own display name and each id is looked up at most once (cached).
- Given a `<@U07ABC|jane>` token that already carries an inline label, when it renders, then the inline label is used (no extra lookup needed).

### Emoji shortcode renders as a glyph or image · P1

**As a** cosmos user reading Slack messages
**I want to** see emoji rendered as their glyph (standard) or image (custom workspace emoji)
**So that** messages read the way they do in Slack instead of showing `:shortcode:` text.

**Acceptance criteria:**
- Given a message containing a standard `:tada:`-style shortcode (including ones absent from today's curated table), when it renders on either surface, then the Unicode glyph is shown.
- Given a message containing a workspace CUSTOM emoji shortcode (image-backed, no Unicode glyph), when it renders on either surface, then the emoji's image is shown inline at text scale.
- Given a `:shortcode:` that is neither a known standard emoji nor a known custom emoji, when it renders, then the literal `:shortcode:` text is shown (graceful, unchanged from today).

### Attachment image renders inline · P1

**As a** cosmos user reading a Slack message with an uploaded image
**I want to** see the image inline as a thumbnail
**So that** I can see shared screenshots/pictures without leaving cosmos.

**Acceptance criteria:**
- Given a message carrying an image file (`files[]`) or an image block (`blocks[]`) whose URL is an auth-gated `https://files.slack.com/…` URL, when it renders on the native panel, then the image appears inline as a thumbnail.
- Given the same message rendered on the generated A2UI Slack surface, then the image appears identically inline.
- Given the renderer DOM/IPC payload for that message, when inspected, then it contains only an opaque `cosmos-slack-img://` scheme reference — never the Slack token and never a token-bearing `files.slack.com` URL.
- Given a message with multiple images, when it renders, then each image renders as its own thumbnail.

### Graceful degradation on resolution failure · P1

**As a** cosmos user
**I want** a message to still render readably when a name/emoji/image cannot be resolved
**So that** one unresolved element never blanks the message or crashes a surface.

**Acceptance criteria:**
- Given a mention to an unknown/unresolvable user id (lookup fails or returns nothing), when it renders, then it falls back to `@<userId>` and the rest of the message renders.
- Given a custom emoji shortcode not present in `emoji.list`, when it renders, then it falls through to standard-emoji resolution, else the literal `:shortcode:`.
- Given an image whose fetch fails (missing/expired/forbidden), when it renders, then a broken-image affordance is shown and the rest of the message renders.
- Given a network failure on any of the supporting reads (`users.info`, `emoji.list`, image fetch), when it occurs, then the surface degrades to the raw/literal form and never throws or white-screens.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST resolve inline `<@U…>` user mentions in a message's text to the user's display name (`@DisplayName`) at the single Slack message-mapping point, so history, replies, and search all benefit. |
| FR-002 | Mention resolution MUST use an id→display-name lookup (`users.info`) woven into the message mapping, caching each id so it is looked up at most once per session/batch. |
| FR-003 | When a `<@U…\|label>` mention carries an inline label, the system MUST use that label without an extra lookup. |
| FR-004 | When a mentioned id cannot be resolved (lookup error/empty/network failure), the system MUST fall back to `@<userId>` and continue rendering the rest of the message (no throw). |
| FR-005 | The system MUST render standard `:shortcode:` emoji as their Unicode glyph using a full-coverage emoji library, replacing/augmenting today's curated `SLACK_EMOJI` table so common shortcodes outside that table also resolve. |
| FR-006 | The system MUST render workspace CUSTOM (image-backed) emoji as an inline image at text scale, resolving the shortcode→image-URL via Slack `emoji.list` (cached). |
| FR-007 | A custom-emoji image MUST be referenced through the same privileged streaming protocol path as Slack attachment images (FR-010) so its auth-gated URL/token never reaches the renderer. |
| FR-008 | A `:shortcode:` that is neither a known custom emoji nor a known standard emoji MUST be left as literal text (graceful, unchanged behavior). |
| FR-009 | The system MUST extract a message's image attachments (image `files[]` and image `blocks[]`, auth-gated `https://files.slack.com/…` URLs) into the `SlackMessage` DTO so they can be rendered. |
| FR-010 | Attachment images MUST be rendered inline as thumbnails via a NEW privileged streaming protocol `cosmos-slack-img://`, mirroring the Confluence content-image protocol: the renderer holds only an opaque scheme reference; the bot/user token is attached only to the outbound main-process fetch. |
| FR-011 | The image reference MUST be encoded by an SSRF-safe codec that carries only an opaque pointer to a `files.slack.com` (or `emoji.list`-supplied) asset — never a token, never an arbitrary host — and the main-process handler MUST reject any forged/absolute/non-allowed-host/traversal reference (broken image, no fetch), exactly like the Confluence ref codec. |
| FR-012 | All four behaviors (mention, standard emoji, custom emoji, image) MUST render identically on BOTH the native Slack panel and the generated A2UI Slack surface, through the shared `SlackMessageRow`. |
| FR-013 | An image fetch failure (missing/expired/forbidden/network) MUST degrade to a broken-image affordance for that image only; the message and surface MUST keep rendering (never throw, never white-screen). |
| FR-014 | The Slack token MUST stay in main only, encrypted at rest; it MUST NEVER appear in any IPC payload, bridge frame, MCP result, A2UI surface, renderer DOM, or log. The renderer/surface holds only opaque scheme references and resolved display strings. |
| FR-015 | Every new/changed cross-process payload (DTO fields, any new IPC channel) MUST be defined in the one typed IPC contract (`src/shared/ipc.ts` / per-domain `src/shared/ipc/`) and validated at the main-process boundary (invalid → warn + ignore, never crash). |
| FR-016 | Custom-emoji resolution (`emoji.list`) MUST require and use the minimal additional read scope (`emoji:read`); if that scope is absent, custom emoji MUST degrade to literal `:shortcode:` (FR-008) rather than failing the read. |
| FR-017 | The new behaviors MUST preserve the existing read-only posture and the existing graceful-degradation guarantees of the Slack reads (a supporting lookup failure never converts a successful message read into an error). |
| FR-018 | The renderer CSP `img-src` MUST be widened to permit the new `cosmos-slack-img:` scheme (mirroring the existing `cosmos-confluence-img:` allowance). |

## Edge Cases & Constraints

- **Unknown / unresolvable mention id:** fall back to `@<userId>` (FR-004).
- **Mention without label vs. with label:** label present → use it (FR-003); absent → look up (FR-002).
- **Standard emoji absent from the old curated table:** now resolves via the full library (FR-005).
- **Custom emoji not in `emoji.list`:** fall through to standard, else literal (FR-006/FR-008).
- **`emoji:read` scope not granted:** custom emoji degrade to literal; no read failure (FR-016). Adding the scope is a one-time reconnect (mirrors Confluence `read:attachment` scope add).
- **`emoji.list` alias entries:** resolve one hop to the target; do not loop (OQ-1 assumption).
- **Missing / expired / forbidden image:** broken-image affordance for that image only (FR-013).
- **Network failure on `users.info` / `emoji.list` / image fetch:** degrade to raw/literal/broken-image; never throw (FR-013, FR-017).
- **Forged / origin-escaping image ref:** rejected by the SSRF guard → broken image, no fetch (FR-011).
- **Multiple mentions / emoji / images in one message:** each resolves independently; ids/emoji looked up at most once via cache (FR-002, FR-006).
- **CSP meta change requires a dev relaunch** (not hot-swapped by HMR) — same gotcha as the Confluence image work.
- **Out of scope:** non-image attachments (docs/files) beyond a basic link affordance if any; sending/reacting/writing to Slack (read-only preserved); video/audio rendering; emoji skin-tone image variants for custom emoji; rendering of arbitrary external (non-Slack, non-`files.slack.com`) image URLs; animated-emoji playback fidelity beyond showing the image.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A message with `<@U07ABC>` (no label) renders `@DisplayName` on both surfaces; an unresolvable id renders `@U07ABC` with the rest of the message intact. |
| SC-002 | A standard `:shortcode:` outside the old curated table renders as its glyph on both surfaces. |
| SC-003 | A workspace custom emoji renders as an inline image on both surfaces; an unknown shortcode stays literal. |
| SC-004 | A message image renders as an inline thumbnail on both surfaces. |
| SC-005 | Inspecting the renderer DOM / any IPC payload / bridge frame / MCP result for an image- or custom-emoji-bearing message shows only an opaque `cosmos-slack-img://` reference — no token, no `files.slack.com` URL. (FR-014) |
| SC-006 | A forged/absolute/non-`files.slack.com`/traversal image reference is rejected by main (broken image, no outbound fetch). (FR-011) |
| SC-007 | A failing image fetch / failing `users.info` / failing `emoji.list` / absent `emoji:read` scope degrades gracefully (broken image / raw id / literal shortcode) with no thrown error and no white-screen. |
| SC-008 | The same `SlackMessageRow` produces identical mention/emoji/image rendering on the native panel and the generated A2UI surface. (FR-012) |
| SC-009 | Every new DTO field / IPC channel is in the typed contract and validated at the main boundary; an invalid payload is warned + ignored, never crashes. (FR-015) |

---

## Anticipated contracts (light — refined in plan/interface)

- **New privileged scheme:** `cosmos-slack-img://` (mirrors `cosmos-confluence-img://`): pre-`app.ready` registration + post-ready `protocol.handle`; main-only `SlackManager` token accessor (mirror `ConfluenceManager.currentAuth()`); SSRF-safe base64url ref codec restricted to `files.slack.com` (image attachments) and `emoji.list`-supplied custom-emoji hosts. Pure codec lives node-testable apart from the Electron wiring (the `.ts`/`.test.ts`, `confluenceImageRef.ts`/`confluenceImageProtocol.ts` split).
- **DTO change:** `SlackMessage` gains an image-attachments field (list of opaque image refs + alt/dimension metadata as needed); mention resolution mutates `text`'s display form. Custom-emoji rendering implies the row body parses `text` into glyph/image/text runs rather than a single `<p>{text}</p>` (refined in design/interface; no implementation choice fixed in this spec).
- **New IPC, possibly:** a custom-emoji map read (or fold into existing status/read responses) and/or `users.info` weaving — exact channels decided in the plan; whatever is added goes in the typed contract and is boundary-validated (FR-015).
- **New scope:** `emoji:read` added to `SLACK_USER_OAUTH_SCOPES` (one-time reconnect); custom emoji degrade to literal when absent (FR-016).
- **CSP:** widen `img-src` in `src/renderer/index.html` to include `cosmos-slack-img:` (FR-018; requires dev relaunch).

## Open Questions

- [ ] OQ-1 (stated above, proceeding with assumption): `emoji.list` alias chains — v1 resolves one alias hop to its target, treats standard-aliased/unknown shortcodes as "not custom" (falls through to the standard library), never loops. Confirm/refine in the plan/interface step.
