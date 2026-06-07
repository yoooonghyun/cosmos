/**
 * slackCatalog/logic — pure, side-effect-free helpers for the Slack custom A2UI
 * catalog (Slack + Confluence generative-UI v1). Extracted from `components.tsx` so the
 * display decisions are unit-testable without a DOM (the catalog components import
 * these). Mirrors `jiraCatalog/logic.ts`.
 *
 * These encode the design's display rules: author raw-id fallback (FR-004 / native
 * `authorName`), avatar initials, and the Slack-epoch `ts` short timestamp. All are
 * total functions — a missing/odd value yields a safe display string, never a throw.
 */

/** Author display name with raw-id fallback (FR-004 / native `authorName`). */
export function authorName(userId: string, userName?: string): string {
  return userName && userName.trim() !== '' ? userName : userId
}

/** Initials for the Avatar fallback (NO remote images). Returns '?' for an empty name. */
export function initials(name: string): string {
  const parts = name.replace(/^[@#]/, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return '?'
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Best-effort short timestamp from a Slack epoch `ts` (e.g. "1700000000.000100").
 * Returns '' for a non-numeric/absent value (the row simply shows no time).
 */
export function formatTs(ts: string): string {
  const head = String(ts).split('.')[0]
  // Empty/blank ts => no time (the catalog passes `ts ?? ''`). Number('') is 0 (finite),
  // so guard the blank case explicitly before the finite check.
  if (head.trim() === '') {
    return ''
  }
  const seconds = Number(head)
  if (!Number.isFinite(seconds)) {
    return ''
  }
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** A list count label ("1 channel" / "N channels") with correct pluralization. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Action a generated `ChannelList` row emits on click. Handled renderer-locally by the
 * Slack panel (navigate to that channel's native conversation view) — NOT sent to main
 * or the agent. The context carries `{ channelId, channelName, isMember }`.
 */
export const SLACK_OPEN_CHANNEL_ACTION = 'slack.openChannel'
