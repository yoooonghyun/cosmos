# Plan: Slack Rich Message Render — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/slack-rich-message-render-v1.md

---

## Grounding

**codegraph_explore** (verbatim source, treated as read):
- `slackClient toMessages SlackMessage DTO slackText decodeTokens decodeEmoji slackEmoji` → `toMessages` (`slackClient.ts:364`) is the ONE sync mapping point for history + replies; it drops `files[]`/`blocks[]`; `decodeSlackText`/`decodeTokens` (`slackText.ts`) return the raw id for an unlabeled `<@U…>`; `decodeEmoji` maps only the curated `SLACK_EMOJI`. `getUser`/`SlackUser`/`SlackManager.getUser` already exist (users.info).
- `src/shared/ipc.ts src/shared/ipc/slack.ts validate slackBridge preload cosmos.slack` → IPC is per-domain modules under `src/shared/ipc/` with a `*.validate.ts` boundary validator (jira pattern). `getUser` bridged + called by `SlackPanel` and `slackAdapter`.
- Read `confluenceImageProtocol.ts` / `confluenceImageRef.ts` / `contentImageSrc.ts` / `slackConfig.ts` / `index.html` CSP → full mirror surface for `cosmos-slack-img://`; current Slack scopes `channels:read,channels:history,users:read,search:read`; CSP `img-src 'self' data: https: cosmos-confluence-img:`.

**memory_recall**: Confluence content-image architecture memory (`confluence-content-images-v1` + `confluence-attachment-scope-v1`) = the protocol template; no stored Slack-rendering memories.

---

## Summary

Make a Slack message render with mentions resolved to display names, emoji shown as glyphs (standard) or inline images (custom), and uploaded images shown as inline thumbnails — identically on the native panel and the generated A2UI surface (shared `SlackMessageRow`) — with the Slack token confined to main. Technical approach: (1) weave an async `users.info` id→name lookup (cached, main-side) into the single `toMessages` mapping so `<@U…>` tokens decode to `@DisplayName`; (2) replace the curated `slackEmoji.ts` table with a full-coverage emoji library (`node-emoji`) for standard `:shortcode:`→glyph and resolve workspace custom emoji via cached `emoji.list`; (3) add a new privileged streaming protocol `cosmos-slack-img://` mirroring `cosmos-confluence-img://` (pre-`app.ready` registration + post-ready `protocol.handle`, main-only token accessor, SSRF-safe base64url ref codec with a host-allowlist branch for `files.slack.com` attachments and the emoji CDN host), carry image attachments + emoji-image refs on the `SlackMessage` DTO as opaque scheme refs, and render the row body as glyph/image/text runs. New read scope `emoji:read`; CSP `img-src` widened.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload, React renderer, shared contract) |
| Key dependencies  | NEW runtime dep **`node-emoji`** (standard-emoji full-set `:shortcode:`→glyph); Electron `protocol`/`net`; existing A2UI SDK + `@a2ui-sdk/react/0.9`. **Install (`npm install node-emoji`) is done by the main/developer session, NOT by architect.** |
| Files to create   | `src/main/slackImageRef.ts` (pure SSRF-safe codec, host-allowlist), `src/main/slackImageProtocol.ts` (Electron wiring), `src/main/integrations/slackEmojiList.ts` (cached `emoji.list` client + resolver), `src/renderer/slackCatalog/messageContent.ts` (pure text→runs parser: mention/glyph/custom-emoji-img/image-thumb), + `.test.ts` siblings |
| Files to modify   | `src/main/integrations/slackText.ts` (mention/emoji decode hooks), `src/main/integrations/slackEmoji.ts` (replace/augment via node-emoji), `src/main/integrations/slackClient.ts` (`toMessages` async + image extraction), `src/main/slackManager.ts` (name-resolver + emoji map + `currentAuth()` accessor), `src/main/integrations/slackConfig.ts` (`emoji:read`), `src/main/index.ts` (register/install protocol), `src/shared/slack.ts` (DTO image/emoji ref fields), `src/shared/ipc/slack.ts` + `slack.validate.ts` (any new channel + validation), `src/preload/index.ts` (if a new bridge method), `src/renderer/slackCatalog/SlackMessageRow.tsx` (runs body), `src/renderer/slackCatalog/components.tsx` + `slackAdapter.ts` (carry refs through generative path), `src/renderer/index.html` (CSP), `docs/ARCHITECTURE.md` |

---

## Tracks, ordering & dependencies

Five tracks. **A (contract) is the hard prerequisite for everything.** B/C/D are then largely parallel; E (renderer) consumes A/B/C/D outputs. Interface/test/implement happen per SDD phase across these tracks, but the dependency edges below are what gate the order.

### Track A — Shared contract & DTO (FIRST; gates B–E)
- Extend `SlackMessage` (and `SlackSearchMatch` where applicable) with:
  - image attachments: a list of opaque image refs `{ ref: string; alt?: string; w?: number; h?: number }` (ref = `cosmos-slack-img://` opaque pointer, **never a token/URL**).
  - the `text` field continues to carry display text (mentions already resolved, standard emoji already glyph-substituted); custom-emoji shortcodes are left as `:name:` markers PLUS a per-message custom-emoji ref map `{ [shortcode]: ref }` so the renderer can swap them to images. (Decision: keep `text` a plain string for backward compatibility + the existing `whitespace-pre-wrap`; the renderer parses runs — avoids encoding HTML in the DTO.)
- Add any new IPC channel to `src/shared/ipc/slack.ts` and a matching boundary validator in `slack.validate.ts` (invalid → warn + ignore, never crash — FR-015). **Decide in interface:** custom-emoji map is fetched once per connected workspace — prefer folding it into a single new read (e.g. `slack.getEmoji`) rather than per-message, cached in main.
- **No relaunch needed** for contract-only edits.

### Track B — Mentions (depends on A)
- Make `toMessages` async; thread a `resolveUserName(id) => Promise<string>` from `SlackManager` (wrapping existing `getUser`, with a main-side `Map` cache so each id is looked up at most once — FR-002).
- In `slackText.ts`: change mention decoding so an unlabeled `<@U…>` is resolved via the injected resolver (labeled `<@U…|x>` still uses the label — FR-003); unresolved/failed → `@<userId>` (FR-004). Keep `decodeSlackText` pure by extracting the async id-resolution to the mapping layer and feeding a pre-resolved id→name map into a pure decode (preserves node-testability + the existing degrade-never-throw contract).
- Apply at the single mapping point so history/replies/search all benefit (FR-001).

### Track C — Emoji (depends on A)
- **Standard:** REPLACE the hand-curated `SLACK_EMOJI` lookup with `node-emoji` (full set), keeping `slackEmoji.ts` as a thin adapter exposing `glyphFor(shortcode): string | null` (so call sites + skin-tone stripping in `decodeEmoji` are unchanged). Augment (not pure-replace) only if a handful of Slack-specific aliases are missing from node-emoji — verify in interface.
- **Custom:** new `slackEmojiList.ts` — cached `emoji.list` read in `SlackManager`; resolve `:name:` → image URL; **one-hop alias resolution** (`alias:other` → resolve `other` once, no loop — OQ-1 resolved). Unknown custom → fall through to standard → literal (FR-006/008). Requires scope `emoji:read`; absent → custom degrade to literal, read never fails (FR-016). Emoji image URLs are turned into `cosmos-slack-img://` refs (Track D codec) so the token never leaves main (FR-007).

### Track D — Image protocol (depends on A; parallel to B/C)
- `src/main/slackImageRef.ts` (PURE, node-testable — mirror `confluenceImageRef.ts`): `encode`/`decode` base64url ref; SSRF guard with a **host allowlist branch**: accept ONLY `files.slack.com` (attachment images) and the Slack **emoji CDN host(s)** (e.g. `emoji.slack-edge.com`/`*.slack-edge.com`) for custom emoji; reject forged/absolute-other-host/traversal/control-char refs (→ null → broken image, no fetch — FR-011). Decision: custom emoji + attachments **share one codec** but the codec validates against a 2-entry host allowlist (NOT a single host), since the two asset classes live on different Slack hosts.
- `src/main/slackImageProtocol.ts` (Electron wiring — mirror `confluenceImageProtocol.ts`): `registerSlackImageScheme()` pre-`app.ready`; `installSlackImageProtocol(resolveAuth)` post-ready; `net.fetch` with `Authorization: Bearer <token>` from `SlackManager.currentAuth()` (NEW main-only accessor mirroring `ConfluenceManager.currentAuth()`); any failure → non-2xx broken-image Response, never throw (FR-013).
- Wire register/install in `src/main/index.ts`.

### Track E — Renderer (depends on A/B/C/D)
- `messageContent.ts` (PURE): parse the message into ordered runs — text, resolved-mention text, standard glyph (already in `text`), custom-emoji image (`<img>` from the per-message ref map), and the attachment-image thumbnails block. Node-testable.
- `SlackMessageRow.tsx`: body becomes runs instead of a single `<p>{text}</p>`; add an inline custom-emoji `<img>` at text scale, an image-thumbnail block, and a per-image broken-image state (FR-013). Stays purely presentational (no data fetch).
- Generative path: `slackAdapter.ts` + `slackCatalog/components.tsx` carry the new DTO fields through unchanged so the generated surface renders identically (FR-012). Confirm the `render_slack_ui` MessageRow bound shape passes the refs.

### Relaunch / install / scope flags (call out to the dev session)
- **`npm install node-emoji`** — main session only (architect has no Bash).
- **Preload edit** (only if a new `window.cosmos.slack.*` method is added) → full `npm run dev` restart, not HMR.
- **CSP `img-src` widen** in `index.html` (add `cosmos-slack-img:`) → needs a dev relaunch (not HMR-hot-swapped) — same gotcha as Confluence.
- **New scope `emoji:read`** → existing connections need a one-time reconnect to gain it (mirrors Confluence `read:attachment` scope add); custom emoji degrade to literal until then.

### OQ-1 resolution (carried from spec)
`emoji.list` alias entries (`alias:other`) are resolved **one hop** to the target image URL; a target that is itself an alias or unknown is treated as "not custom" and falls through to the standard library, then literal. Never loops. Pinned here.

### docs/ARCHITECTURE.md (edits to land during the cycle)
- Add `cosmos-slack-img://` to the "privileged image protocols" section alongside `cosmos-confluence-img://` (SSRF-safe ref, host allowlist `files.slack.com` + emoji CDN, token main-only).
- Note the new Slack read scope `emoji:read` and the `users.info`/`emoji.list` cached-resolution weaving at the single Slack message-mapping point.
- Note the shared `SlackMessageRow` now renders glyph/image/text runs (still the single canonical row for both surfaces).

---

## Implementation Checklist

> Update as work progresses; add inline notes on deviation.

### Phase 0 — Design (SDD Step 2.5, BEFORE interface)
- [ ] **This is a UI-bearing feature → the `design` skill / designer step is REQUIRED after plan approval and before interface.** `SlackMessageRow` gains inline emoji-image, image-thumbnail, and broken-image treatments — produce `.sdd/designs/slack-rich-message-render-v1.md` (Tailwind/shadcn tokens, thumbnail sizing/grid, emoji-image inline scale, broken-image affordance).

### Phase 1 — Interface (Track A first)
- [x] Re-read spec; confirm OQ-1 pinned (one-hop alias) — done in this plan.
- [x] Track A: extend `SlackMessage` DTO (`images?: SlackImageRef[]` + `customEmoji?: Record<string,string>`) + `SlackSearchMatch` (`customEmoji?`) in `src/shared/slack.ts`. **Deviation:** NO new IPC channel — the refs ride on existing response DTOs (resolved in main, trusted) so no `slack.validate.ts` change was needed (see Deviations).
- [x] Define the pure codec signatures (`slackImageRef.ts`) + resolver/types (`messageContent.ts`, `MessageResolvers`, `EmojiListMap`).
- [x] Review types vs spec — every field traces to an FR.

### Phase 2 — Testing
- [x] Codec: happy path (files.slack.com + emoji CDN), forged/absolute-other-host/traversal/control-char → null (`slackImageRef.test.ts`).
- [x] Mentions: unlabeled `<@U…>` → name; labeled → label; unresolved → `@<id>`; `extractMentionIds` dedupe (`slackText.test.ts`).
- [x] Emoji: standard via node-emoji + alias supplement (`slackEmoji.test.ts`); custom → image ref, alias one-hop, absent scope → null, unknown → literal (`slackEmojiList.test.ts`).
- [x] Image extraction: `files[]` + image `blocks[]` → refs; non-image / off-allowlist dropped (`slackImageExtract.test.ts`).
- [x] `messageContent` runs parser: mixed text/custom-emoji; unmapped marker literal (`messageContent.test.ts`).
- [x] Boundary: codec/extract/resolvers all return safe fallback (null/[]/literal) on bad input — covered across the new tests. (No new IPC validator to test — see deviation.)

### Phase 3 — Implementation
- [x] Track B: async `toMessages` + `SlackManager` per-session cached name resolver; `slackText.ts` mention decode via `idToName`.
- [x] Track C: `node-emoji` adapter in `slackEmoji.ts`; `slackEmojiList.ts` cached `emoji.list` + alias one-hop; `emoji:read` scope added.
- [x] Track D: `slackImageRef.ts` + `slackImageProtocol.ts`; `SlackManager.currentAuth()`; register pre-ready + install post-ready in `index.ts`.
- [x] Track E: `messageContent.ts`; `SlackMessageRow.tsx` runs body + thumbnails; generative path (`slackAdapter.ts`, `components.tsx`) + native panel (`SlackPanel.tsx` history + search rows) carry refs.
- [x] CSP widen in `index.html` (`cosmos-slack-img:`).
- [x] All tests pass (1443) + typecheck clean; reused the Confluence-mirror shape + the shared row.

### Phase 4 — Docs
- [ ] Update `docs/ARCHITECTURE.md` (slack image protocol + `emoji:read` scope + runs row) — **architect-owned; flagged for the wrap-up/architect step.**
- [ ] Reconcile `TODO.md` (wrap-up).
- [x] Record deviations below; `memory_save` the slack-img protocol + emoji decisions.

---

## Deviations & Notes

- **2026-06-20**: Plan authored. OQ-1 resolved (one-hop alias). Decision: custom-emoji + attachment images share ONE `cosmos-slack-img://` codec validated against a 2-host allowlist (`files.slack.com` + Slack emoji CDN), not a single host. `node-emoji` chosen for full standard-emoji coverage; install is a main-session task.
- **2026-06-20 (impl)**: **No new IPC channel/validator.** The image + custom-emoji refs are produced in main and returned on the EXISTING `SlackMessage`/`SlackSearchMatch` response DTOs (history/replies/search). Since they ride a main→renderer RESPONSE (trusted side, not a renderer→main request), and the renderer holds only opaque `cosmos-slack-img://` strings re-validated by the protocol handler, no boundary-validator change was required (satisfies FR-014/FR-015 without new surface). Net: NO preload edit either → **no dev restart for the IPC layer**; the CSP widen + `emoji:read` scope are the only manual relaunch/reconnect needs.
- **2026-06-20 (impl)**: Per-session resolver caching lives in `SlackManager` (`resolverCache` keyed by token; rebuilt on reconnect, cleared on disconnect). `resolveUserName` memoizes per-id via a `Map<string, Promise<string>>`; custom emoji via `SlackCustomEmojiResolver` (one `emoji.list` fetch, empty-map-on-failure). Threaded as a 4th `resolvers` arg into `client.getHistory/getReplies/search` — two `slackManager.test.ts` call-arg assertions updated to `expect.objectContaining` for it.
- **2026-06-20 (impl)**: Native search rows (`SlackPanel.tsx`) and the generated `SearchResultRow` render the body via `parseMessageRuns` (inline custom-emoji `<img>`) rather than the shared `SlackMessageRow`, since search rows have a distinct chrome (channel chip, no replies/thumbnails). History rows (native + generated) go through `SlackMessageRow` which now renders runs + an image-thumbnail strip.
- **2026-06-20 (impl)**: Phase 0 design step was NOT run separately this cycle (no `.sdd/designs/slack-rich-message-render-v1.md`). The row used existing cosmos tokens/shadcn primitives only (inline emoji `h-[1.25em]`, thumbnails `max-h-40 max-w-[12rem] rounded-md border`); flag for the designer if a formal design spec is wanted retroactively.
