/**
 * slackEmojiList — the cached workspace CUSTOM-emoji resolver (slack-rich-message-render-v1,
 * FR-006/FR-007/FR-016, Track C). Resolves a `:shortcode:` to its workspace custom-emoji
 * IMAGE URL via Slack `emoji.list` (cached once per connected session), with one-hop alias
 * resolution (OQ-1). The caller turns the returned image URL into an opaque
 * `cosmos-slack-img://` ref so the token never leaves main (FR-007).
 *
 * `emoji.list` returns a `{ [name]: value }` map where `value` is either:
 *   - an `https://emoji.slack-edge.com/...` (custom image) URL, or
 *   - `alias:<other-name>` (an alias to another entry), or
 *   - a standard-emoji unicode form the workspace did not override (we treat these as
 *     "not custom" — they fall through to the standard glyph library, FR-008).
 *
 * Resolution (OQ-1): a direct image URL → that URL. An `alias:other` → resolve `other` ONE
 * hop; if the target is itself an alias or not an image URL, treat as "not custom" (null).
 * Never loops. An unknown shortcode → null. Custom emoji require the `emoji:read` scope; when
 * the read fails for ANY reason (missing scope, network, etc.) the resolver caches an EMPTY
 * map so every custom shortcode degrades to literal/standard and the read never fails (FR-016).
 *
 * PURE except for the injected async `fetchEmojiMap` (which the SlackManager wires to the
 * Slack client). The map-resolution helpers are pure + node-testable in isolation.
 */

import { encodeImageRef, isAllowedSlackImageHost } from '../slackImageRef'

/** The raw `{ name: value }` map `emoji.list` returns (value = image URL or `alias:other`). */
export type EmojiListMap = Record<string, string>

/** Alias prefix in an `emoji.list` value. */
const ALIAS_PREFIX = 'alias:'

/**
 * Resolve a shortcode to its custom-emoji IMAGE URL from a raw `emoji.list` map, with ONE
 * alias hop (OQ-1). Returns the image URL string, or `null` when the shortcode is unknown, is
 * an alias to a non-image / further-alias target, or is a non-image (standard) entry. Pure;
 * total; never throws.
 */
export function resolveCustomEmojiUrl(map: EmojiListMap, shortcode: string): string | null {
  if (typeof shortcode !== 'string' || shortcode === '') {
    return null
  }
  const direct = map[shortcode]
  if (typeof direct !== 'string' || direct === '') {
    return null
  }
  let value = direct
  // One alias hop only (never loop — OQ-1).
  if (value.startsWith(ALIAS_PREFIX)) {
    const target = value.slice(ALIAS_PREFIX.length)
    const resolved = map[target]
    if (typeof resolved !== 'string' || resolved === '' || resolved.startsWith(ALIAS_PREFIX)) {
      // Alias to another alias / unknown / standard — not a custom image (FR-008).
      return null
    }
    value = resolved
  }
  // Only an allowlisted https image URL counts as a custom emoji image (FR-007/FR-011).
  return isCustomEmojiImageUrl(value) ? value : null
}

/** True for an `https://<allowlisted emoji CDN host>/...` custom-emoji image URL. A standard
 * unicode entry, a `data:`/non-https URL, or an off-allowlist host is NOT a custom image. */
export function isCustomEmojiImageUrl(value: string): boolean {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) {
    return false
  }
  try {
    return isAllowedSlackImageHost(new URL(value).hostname)
  } catch {
    return false
  }
}

/** Fetches the raw `emoji.list` map for the connected session, or `null` on any failure
 * (missing `emoji:read` scope, network, rejected token). Injected by SlackManager. */
export type FetchEmojiMap = () => Promise<EmojiListMap | null>

/**
 * A session-scoped custom-emoji resolver. `forShortcode(name)` returns the opaque
 * `cosmos-slack-img://` ref for a workspace custom emoji, or `null` (unknown / standard /
 * read-unavailable → caller falls through to the standard glyph or literal). The underlying
 * `emoji.list` map is fetched at most once (lazy, cached); a failed fetch caches an empty map
 * so custom emoji degrade to literal and no further fetch is attempted (FR-016). NEVER throws.
 */
export class SlackCustomEmojiResolver {
  private readonly fetchEmojiMap: FetchEmojiMap
  private mapPromise: Promise<EmojiListMap> | null = null

  constructor(fetchEmojiMap: FetchEmojiMap) {
    this.fetchEmojiMap = fetchEmojiMap
  }

  /** Lazily fetch + cache the emoji map (empty map on failure — FR-016). Never throws. */
  private async map(): Promise<EmojiListMap> {
    if (this.mapPromise === null) {
      this.mapPromise = this.fetchEmojiMap()
        .then((m) => m ?? {})
        .catch(() => ({}))
    }
    return this.mapPromise
  }

  /**
   * Resolve a shortcode to its opaque custom-emoji image ref, or `null`. The image URL is
   * encoded via {@link encodeImageRef} (allowlist + SSRF guard) so the renderer never holds a
   * token/URL (FR-007/FR-014). A URL that fails the allowlist yields `null` (degrade).
   */
  async forShortcode(shortcode: string): Promise<string | null> {
    const map = await this.map()
    const url = resolveCustomEmojiUrl(map, shortcode)
    if (url === null) {
      return null
    }
    return encodeImageRef(url)
  }
}
