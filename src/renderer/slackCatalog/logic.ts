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

/* ------------------------------------------------------------------------- *
 * Bound-list display gating (slack-generative-adapter-v1, FR-004)
 *
 * The bound Slack lists (ChannelList/MessageList/SearchResultList) read their rows +
 * `loading`/`hasMore`/`error` flags from the data model and disambiguate the five
 * states (design §3). These pure helpers encode that gating so the `.tsx` shells stay
 * thin and the decisions are node-testable (the catalog `.ts`/`.test.ts` split). They
 * mirror the bound `IssueList`'s in-component logic; Slack is APPEND-ONLY (no prev).
 * ------------------------------------------------------------------------- */

/** Coerce a possibly-undefined bound rows value to a safe array (never throws). */
export function boundRows<T>(rows: T[] | undefined): T[] {
  return Array.isArray(rows) ? rows : []
}

/**
 * Whether to render the recoverable-error Notice ABOVE the rows (FR-007 / design §3).
 * True iff a non-empty error message is present. The prior rows stay visible (the caller
 * keeps them); an empty list WITH an error shows the Notice instead of the empty state.
 */
export function showErrorNotice(error: string | undefined): boolean {
  return typeof error === 'string' && error.trim() !== ''
}

/**
 * Whether to render the bound empty state (design §3). True iff the list is empty AND
 * there is no error notice to show in its place (the error supersedes the empty state).
 */
export function showEmptyState(rowCount: number, error: string | undefined): boolean {
  return rowCount === 0 && !showErrorNotice(error)
}
