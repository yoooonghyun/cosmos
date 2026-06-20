/**
 * Slack mrkdwn → display-text decoder (slack-text-rendering-v1, extended by
 * slack-rich-message-render-v1).
 *
 * Slack message `text` is NOT plain text: it is "mrkdwn" on the wire, carrying
 *   - HTML-escaped entities (`&amp;` `&lt;` `&gt;`) — Slack escapes only these three
 *     (https://api.slack.com/reference/surfaces/formatting#escaping);
 *   - `:shortcode:` emoji (e.g. `:tada:` → 🎉);
 *   - angle-bracket tokens for mentions/links/channels
 *     (`<@U123|name>`, `<#C123|name>`, `<https://url|label>`, `<!here>`, …).
 * Real newlines (`\n`) DO arrive on the wire and are PRESERVED here verbatim so the
 * panel's `whitespace-pre-wrap` rows render them on separate lines.
 *
 * `decodeSlackText` is PURE, returns '' for empty/absent/non-string input, and never
 * throws on malformed input (a read must degrade gracefully — like {@link adfToPlainText}
 * in ./atlassianText.ts). Applied at the single Slack message mapping point in
 * ./slackClient.ts so history, replies, and search (both the native panel and the MCP
 * render path) all benefit.
 *
 * slack-rich-message-render-v1 weaves two resolved inputs through {@link DecodeOptions} so
 * the function stays pure (the async lookups happen in the mapping layer, not here):
 *   - `idToName` — a pre-resolved `<@U…>` id → display name map (Track B / FR-001..FR-004).
 *     An unlabeled mention id present in the map renders `@DisplayName`; absent → `@<id>`.
 *   - `customEmoji` — the set of `:shortcode:` names that are workspace CUSTOM (image-backed)
 *     emoji (Track C / FR-006..FR-008). These are LEFT as literal `:name:` markers (the
 *     renderer swaps them for images via the per-message ref map); every other shortcode is
 *     glyph-substituted via {@link glyphFor} (standard) or left literal (unknown — FR-008).
 */

import { glyphFor } from './slackEmoji'

/** A pre-resolved mention id → display-name lookup + custom-emoji marker set (pure inputs). */
export interface DecodeOptions {
  /**
   * Pre-resolved `<@U…>` id → display name. An unlabeled mention whose id is in this map
   * renders `@<displayName>`; absent / no map → the raw `@<id>` fallback (FR-002/FR-004).
   */
  idToName?: Record<string, string>
  /**
   * The `:shortcode:` names that are workspace CUSTOM emoji (image-backed). These are kept
   * as literal `:name:` markers for the renderer to swap to images (FR-006/FR-007); they are
   * NOT glyph-substituted here. A name absent from this set is glyph-substituted (standard)
   * or left literal when unknown (FR-008).
   */
  customEmoji?: ReadonlySet<string>
}

/**
 * Slack escapes exactly three HTML entities in message text (and nothing else).
 * We additionally decode `&#39;`/`&quot;` defensively — harmless if absent and they
 * occasionally appear from inbound copy/paste. NOT a general HTML unescape (the wire
 * text is otherwise literal, so a broad pass could corrupt legitimate `&…;` runs).
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'"
}

/** Decode the handful of Slack-escaped HTML entities; leaves any other `&…;` intact. */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
}

/**
 * Replace `:shortcode:` runs with their Unicode glyph when known. A skin-tone suffix
 * (`:wave::skin-tone-3:`) is dropped to the base glyph. A shortcode that is a CUSTOM emoji
 * (in `customEmoji`) is LEFT verbatim as a `:name:` marker for the renderer to swap to an
 * image (FR-006/FR-007). Other unknown shortcodes are left verbatim too (a missing glyph is
 * more readable than blanking the token — FR-008). The shortcode grammar is `[a-z0-9_+'-]+`
 * per Slack's emoji naming, anchored by colons.
 */
function decodeEmoji(text: string, customEmoji?: ReadonlySet<string>): string {
  // Strip skin-tone modifier shortcodes first so `:wave::skin-tone-3:` → base wave.
  const withoutSkinTones = text.replace(/:skin-tone-[2-6]:/g, '')
  return withoutSkinTones.replace(/:([a-z0-9_+'-]+):/g, (whole, name: string) => {
    // Custom (image-backed) emoji: keep the marker literal for the renderer (FR-006).
    if (customEmoji && customEmoji.has(name)) {
      return whole
    }
    const glyph = glyphFor(name)
    return glyph ?? whole
  })
}

/**
 * Render a Slack `<…>` angle-bracket token to a readable label (mentions, channels,
 * links, broadcasts). Slack tokens are `<target>` or `<target|label>`:
 *   - `<@U123|name>` / `<@U123>`   → `@name` / `@<resolved or U123>`   (user mention)
 *   - `<#C123|name>` / `<#C123>`   → `#name` / `#C123`   (channel mention)
 *   - `<!here>` / `<!channel>` / `<!subteam^S1|@team>` → `@here` / `@channel` / `@team`
 *   - `<https://url|label>` / `<https://url>` → `label` / `https://url` (link)
 * An unlabeled user mention resolves its id via `idToName` when present (FR-001..FR-004);
 * a labeled mention always uses the inline label (no lookup — FR-003). Newlines never appear
 * inside a token, so this is safe to run line-agnostically.
 */
function decodeTokens(text: string, idToName?: Record<string, string>): string {
  return text.replace(/<([^<>]+)>/g, (_whole, inner: string) => {
    const pipe = inner.indexOf('|')
    const target = pipe === -1 ? inner : inner.slice(0, pipe)
    const label = pipe === -1 ? '' : inner.slice(pipe + 1)
    if (target.startsWith('@')) {
      // User mention. Labeled → use the inline label (FR-003). Unlabeled → resolve the id
      // via the pre-resolved map (FR-002); absent → the raw id fallback (FR-004).
      if (label) {
        return `@${label}`
      }
      const id = target.slice(1)
      const resolved = idToName ? idToName[id] : undefined
      return `@${resolved && resolved !== '' ? resolved : id}`
    }
    if (target.startsWith('#')) {
      // Channel mention.
      return `#${label || target.slice(1)}`
    }
    if (target.startsWith('!')) {
      // Broadcast / special mention (here, channel, everyone, subteam^ID).
      const special = target.slice(1)
      if (label) {
        return label.startsWith('@') ? label : `@${label}`
      }
      const caret = special.indexOf('^')
      return `@${caret === -1 ? special : special.slice(0, caret)}`
    }
    // A link: prefer the human label, else the raw URL. `mailto:` shows the address.
    if (label) {
      return label
    }
    return target.startsWith('mailto:') ? target.slice('mailto:'.length) : target
  })
}

/**
 * Decode one Slack message `text` (mrkdwn) into readable display text (FR — slack-text-
 * rendering-v1; mentions/custom-emoji extended by slack-rich-message-render-v1). Order
 * matters: tokens are decoded on the raw text FIRST (before entity decode) so a literal
 * `&lt;` in a label can never be mistaken for a `<…>` token delimiter; then entities are
 * unescaped; then `:emoji:` shortcodes map to glyphs (custom shortcodes left as markers).
 * Newlines are preserved. Pure; returns '' for empty/absent input; never throws.
 */
export function decodeSlackText(raw: unknown, opts: DecodeOptions = {}): string {
  if (typeof raw !== 'string' || raw === '') {
    return ''
  }
  let text = decodeTokens(raw, opts.idToName)
  text = decodeEntities(text)
  text = decodeEmoji(text, opts.customEmoji)
  return text
}

/**
 * Extract the set of unlabeled user-mention ids (`<@U…>` WITHOUT an inline label) from a raw
 * Slack message text, so the mapping layer can batch-resolve their display names BEFORE the
 * pure decode (FR-002 — each id looked up once). A labeled `<@U…|x>` is skipped (its label is
 * used directly — FR-003). Pure; total; returns [] for empty/non-string input; never throws.
 */
export function extractMentionIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') {
    return []
  }
  const ids = new Set<string>()
  for (const m of raw.matchAll(/<@([^<>|]+)(\|[^<>]*)?>/g)) {
    const id = m[1]
    const hasLabel = typeof m[2] === 'string' && m[2].length > 1
    if (!hasLabel && id) {
      ids.add(id)
    }
  }
  return Array.from(ids)
}

/**
 * Extract the set of `:shortcode:` emoji names referenced in a raw Slack message text
 * (skin-tone modifiers excluded), so the mapping layer can resolve which are workspace
 * CUSTOM emoji BEFORE the pure decode. Pure; total; returns [] for empty/non-string input.
 */
export function extractEmojiShortcodes(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') {
    return []
  }
  const names = new Set<string>()
  for (const m of raw.matchAll(/:([a-z0-9_+'-]+):/g)) {
    const name = m[1]
    if (name && !/^skin-tone-[2-6]$/.test(name)) {
      names.add(name)
    }
  }
  return Array.from(names)
}
