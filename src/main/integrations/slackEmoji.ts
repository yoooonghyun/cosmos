/**
 * slackEmoji — the standard `:shortcode:` → Unicode glyph adapter
 * (slack-rich-message-render-v1, FR-005, Track C). Replaces the former hand-curated
 * `SLACK_EMOJI` table with full-coverage `node-emoji` so common shortcodes outside the old
 * table now resolve. Kept as a THIN adapter ({@link glyphFor}) so the call site in
 * `slackText.ts` (`decodeEmoji`, with its skin-tone stripping) is unchanged.
 *
 * node-emoji's name set is GitHub/gemoji-based, which covers the overwhelming majority of
 * Slack standard shortcodes. A small {@link SLACK_ALIASES} supplement maps the handful of
 * Slack-specific names node-emoji does not carry (e.g. `thumbsup`/`thumbsdown`) to a known
 * name so they still resolve. An unknown shortcode returns `null` and `decodeEmoji` leaves
 * the literal `:name:` (FR-008 — a missing glyph is more readable than a blank).
 *
 * PURE: no Electron, no network, no state. Custom (workspace, image-backed) emoji are NOT
 * handled here — they have no Unicode glyph and resolve to images via `slackEmojiList.ts`.
 */

import { get as nodeEmojiGet } from 'node-emoji'

/**
 * Slack-specific shortcode aliases node-emoji does not carry, mapped to a node-emoji name.
 * Small + curated; everything else comes from node-emoji's full set. (node-emoji uses
 * `+1`/`-1` for thumbs and omits the Slack `thumbsup`/`thumbsdown` spellings.)
 */
const SLACK_ALIASES: Record<string, string> = {
  thumbsup: '+1',
  thumbsdown: '-1',
  facepunch: 'punch',
  hankey: 'poop'
}

/**
 * Resolve a bare Slack `:shortcode:` name (no surrounding colons, e.g. `tada`) to its
 * Unicode glyph, or `null` when it is not a known STANDARD emoji (custom/workspace emoji and
 * truly-unknown names return `null`). Pure; never throws. node-emoji accepts both `name` and
 * `:name:`; we pass the colon-wrapped form for an exact shortcode lookup, after applying the
 * Slack-alias supplement.
 */
export function glyphFor(shortcode: unknown): string | null {
  if (typeof shortcode !== 'string' || shortcode === '') {
    return null
  }
  const name = SLACK_ALIASES[shortcode] ?? shortcode
  try {
    const glyph = nodeEmojiGet(`:${name}:`)
    return typeof glyph === 'string' && glyph !== '' ? glyph : null
  } catch {
    return null
  }
}
