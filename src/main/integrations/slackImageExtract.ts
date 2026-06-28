/**
 * slackImageExtract — PURE extractor of a Slack message's inline IMAGE attachments into
 * opaque `cosmos-slack-img://` refs (slack-rich-message-render-v1, FR-009/FR-010, Track D).
 * No Electron, no network — node-unit-testable in isolation. The SlackManager mapping point
 * (`toMessage` in slackClient.ts) calls this once per message.
 *
 * Slack carries inline images two ways:
 *   - `files[]` — uploaded image files. We take entries whose `mimetype` starts `image/`,
 *     preferring a `thumb_*` URL (smaller, same auth host) then `url_private`. Both are
 *     auth-gated `https://files.slack.com/...` URLs, encoded to a ref via `encodeImageRef`.
 *   - `blocks[]` — Block Kit `image` blocks carry an `image_url`. Only an allowlisted host
 *     URL survives `encodeImageRef`; everything else is dropped.
 * Any URL that fails the host allowlist / path safety yields `null` from `encodeImageRef` and
 * is dropped (the renderer shows nothing rather than a dead ref). PURE; total; never throws;
 * returns `[]` for a non-object / no-image input.
 */

import type { SlackImageRef } from '../../shared/types/slack'
import { encodeImageRef } from '../slack/slackImageRef'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Pick the best image URL from a Slack `files[]` entry: a `thumb_*` (smaller, same host)
 * else the full `url_private`. Returns the first string url found, else undefined. */
function fileImageUrl(file: Record<string, unknown>): string | undefined {
  // Prefer a mid-size thumb when present (same files.slack.com host), then the original.
  const candidates = [
    file.thumb_480,
    file.thumb_360,
    file.thumb_720,
    file.url_private,
    file.url_private_download
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c !== '') {
      return c
    }
  }
  return undefined
}

/**
 * Extract a message's inline image attachments as opaque refs. Reads image `files[]`
 * (mimetype `image/*`) and Block Kit `image` blocks (`image_url`), encoding each via
 * {@link encodeImageRef} and dropping any that fail the allowlist. Pure; never throws.
 */
export function extractImageRefs(message: unknown): SlackImageRef[] {
  if (!isRecord(message)) {
    return []
  }
  const refs: SlackImageRef[] = []

  // 1) Uploaded image files.
  const files = Array.isArray(message.files) ? message.files : []
  for (const f of files) {
    if (!isRecord(f)) {
      continue
    }
    const mime = typeof f.mimetype === 'string' ? f.mimetype : ''
    if (!mime.startsWith('image/')) {
      continue
    }
    const url = fileImageUrl(f)
    const ref = url ? encodeImageRef(url) : null
    if (ref === null) {
      continue
    }
    const alt =
      (typeof f.title === 'string' && f.title) ||
      (typeof f.name === 'string' && f.name) ||
      undefined
    refs.push({
      ref,
      ...(alt ? { alt } : {}),
      ...(numOrUndef(f.original_w) !== undefined ? { w: numOrUndef(f.original_w) } : {}),
      ...(numOrUndef(f.original_h) !== undefined ? { h: numOrUndef(f.original_h) } : {})
    })
  }

  // 2) Block Kit image blocks.
  const blocks = Array.isArray(message.blocks) ? message.blocks : []
  for (const b of blocks) {
    if (!isRecord(b) || b.type !== 'image') {
      continue
    }
    const url = typeof b.image_url === 'string' ? b.image_url : ''
    const ref = url ? encodeImageRef(url) : null
    if (ref === null) {
      continue
    }
    const alt = typeof b.alt_text === 'string' && b.alt_text ? b.alt_text : undefined
    refs.push({ ref, ...(alt ? { alt } : {}) })
  }

  return refs
}
