/**
 * messageContent — PURE text → ordered render-runs parser for the Slack message body
 * (slack-rich-message-render-v1, Track E / design §2). No DOM, no React, no fetch — so it
 * is node-unit-testable in isolation (the catalog `.ts`/`.test.ts` split). `SlackMessageRow`
 * (`.tsx`) maps the runs to inline elements; this module only DECIDES the runs.
 *
 * The DTO decision (Track A): `text` is a plain string in which mentions are already
 * resolved to `@DisplayName` and standard emoji are already substituted to their Unicode
 * glyph (both done in main). CUSTOM-emoji shortcodes survive as literal `:name:` markers,
 * plus the message carries a per-message `customEmoji` map `{ shortcode: ref }` of the ones
 * that resolved to a workspace image. This parser walks `text` and, for each `:name:` marker
 * whose shortcode is in the map, emits a `custom-emoji` run (the row renders an `<img>`);
 * everything else is a plain `text` run carrying its segment verbatim (including standard
 * glyphs, resolved mentions, newlines, and unresolved `:name:` markers — FR-008 literal).
 *
 * Custom-emoji shortcode grammar matches Slack's emoji naming (`[a-z0-9_+'-]+`), anchored by
 * colons. A `:name:` whose shortcode is NOT in the map stays inside a text run (literal —
 * FR-008). Pure; total; never throws; returns `[]` for empty/absent input.
 */

/** The custom-emoji shortcode grammar (Slack emoji naming), anchored by surrounding colons. */
const CUSTOM_EMOJI_RE = /:([a-z0-9_+'-]+):/g

/** A plain text segment — rendered verbatim (carries standard glyphs, resolved mentions,
 * newlines, and any literal `:name:` that did not resolve to a custom emoji). */
export interface TextRun {
  kind: 'text'
  /** The literal text segment. */
  text: string
}

/** A custom (workspace, image-backed) emoji — the row renders an inline `<img src={ref}>`
 * at text scale; the broken-image fallback is the literal `:${shortcode}:`. */
export interface CustomEmojiRun {
  kind: 'custom-emoji'
  /** The shortcode WITHOUT colons (e.g. `parrot`). The accessible alt is `:${shortcode}:`. */
  shortcode: string
  /** The opaque `cosmos-slack-img://` image ref (never a token/URL). */
  ref: string
}

/** One ordered render run of a Slack message body. */
export type MessageRun = TextRun | CustomEmojiRun

/**
 * Parse a (already mention-resolved, standard-emoji-substituted) message `text` plus its
 * per-message `customEmoji` ref map into ordered render runs. A `:name:` marker whose
 * shortcode is present (non-empty string ref) in the map becomes a `custom-emoji` run; all
 * other characters — including unresolved `:name:` markers — accumulate into `text` runs.
 * Adjacent text is coalesced so the row renders the natural spacing/newlines verbatim.
 *
 * Total + pure: returns `[]` for empty/absent `text`; a non-object / absent map means "no
 * custom emoji" (every `:name:` stays literal — FR-008). Never throws.
 */
export function parseMessageRuns(
  text: unknown,
  customEmoji?: Record<string, string>
): MessageRun[] {
  if (typeof text !== 'string' || text === '') {
    return []
  }
  const map = isStringMap(customEmoji) ? customEmoji : undefined
  const runs: MessageRun[] = []
  let pending = ''
  const flush = (): void => {
    if (pending !== '') {
      runs.push({ kind: 'text', text: pending })
      pending = ''
    }
  }

  let lastIndex = 0
  // Fresh regex state each call (the literal is module-level; reset lastIndex defensively).
  CUSTOM_EMOJI_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CUSTOM_EMOJI_RE.exec(text)) !== null) {
    const [whole, shortcode] = match
    const ref = map ? map[shortcode] : undefined
    if (typeof ref !== 'string' || ref === '') {
      // Not a known custom emoji → leave the `:name:` literal inside the text flow (FR-008).
      // Advance the regex past this marker but keep the chars as pending text.
      continue
    }
    // Emit the gap text before this marker, then the custom-emoji run.
    pending += text.slice(lastIndex, match.index)
    flush()
    runs.push({ kind: 'custom-emoji', shortcode, ref })
    lastIndex = match.index + whole.length
  }
  // Trailing text after the last consumed custom-emoji marker (or the whole string when none).
  pending += text.slice(lastIndex)
  flush()
  return runs
}

/** True for a plain `{ [string]: string }` map (the custom-emoji ref shape). */
function isStringMap(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
