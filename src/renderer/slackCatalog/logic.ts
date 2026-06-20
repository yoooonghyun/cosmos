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

/**
 * Action a generated `MessageRow`'s "N replies" affordance emits on click
 * (slack-generative-message-parity-v1, FR-005/FR-008, OQ-1 = reuse native thread view).
 * Handled renderer-locally by the Slack panel — NEVER sent to main or the agent (the
 * `ActiveTabSurface` `onAction` intercept returns `true`). The context carries the
 * non-secret thread coordinates + the parent display fields so the native thread view's
 * header renders without a re-read: `{ channelId, threadTs, ts, userId, userName?, text,
 * replyCount? }`. No Slack token or secret is ever carried (FR-013/FR-019).
 */
export const SLACK_OPEN_THREAD_ACTION = 'slack.openThread'

/**
 * The renderer-local action context the reply affordance dispatches and the panel's
 * `handleSurfaceAction` consumes. NON-SECRET only: `channelId`/`threadTs` are the thread
 * coordinates the native thread read needs; the rest are the parent message's display
 * fields (so the native thread header renders without a re-read). A Slack token NEVER
 * appears here (FR-013/FR-019).
 */
export interface SlackOpenThreadContext {
  /** The channel the thread lives in (non-secret). */
  channelId: string
  /** The parent message `ts` (== the thread root key) — non-secret. */
  threadTs: string
  /** The parent message `ts` (same value as threadTs; carried for the header row). */
  ts: string
  /** The parent author user id (raw-id fallback for the header). */
  userId: string
  /** The parent author display name when resolved. */
  userName?: string
  /** The parent message text (header body). */
  text: string
  /** The parent thread's reply count, when known. */
  replyCount?: number
}

/**
 * Build the {@link SlackOpenThreadContext} the reply affordance dispatches from a bound
 * `MessageRow`'s props (slack-generative-message-parity-v1, FR-005/FR-013). Returns
 * `null` when the thread coordinates are absent — the row then degrades to the
 * non-interactive label (FR-012). Pure, total, secret-free: it copies only the non-secret
 * display fields, never a token. `replyCount`/`userName` are omitted when absent.
 */
export function buildOpenThreadContext(row: {
  channelId?: string
  threadTs?: string
  ts?: string
  userId?: string
  userName?: string
  text?: string
  replyCount?: number
}): SlackOpenThreadContext | null {
  const channelId = typeof row.channelId === 'string' ? row.channelId : ''
  const threadTs = typeof row.threadTs === 'string' ? row.threadTs : ''
  if (channelId === '' || threadTs === '') {
    return null
  }
  return {
    channelId,
    threadTs,
    ts: typeof row.ts === 'string' ? row.ts : threadTs,
    userId: typeof row.userId === 'string' ? row.userId : '',
    ...(typeof row.userName === 'string' && row.userName !== '' ? { userName: row.userName } : {}),
    text: typeof row.text === 'string' ? row.text : '',
    ...(typeof row.replyCount === 'number' ? { replyCount: row.replyCount } : {})
  }
}

/**
 * The open-thread trigger a CLICK ON THE WHOLE MESSAGE ROW emits
 * (slack-thread-order-and-empty-reply-v1, Bug 2). Decouples "open the thread dock" from the
 * "N replies" affordance: BEFORE this, the dock only opened via the replies affordance, which
 * renders ONLY when `replyCount > 0` — so a message with zero replies offered no way to open
 * its thread and post the first reply. This decides that EVERY message row carrying the thread
 * coordinates (`channelId` + `threadTs`) is an open-thread trigger, regardless of `replyCount`.
 * It is exactly {@link buildOpenThreadContext} (the same secret-free context, `threadTs = ts`),
 * named for the row-click decision so the `.tsx` row wires a single clickable region to it and
 * the decision is node-testable. Returns `null` when coords are absent (the row is then a
 * plain, non-interactive message — FR-012). Pure, total, secret-free.
 */
export function messageRowOpenThread(row: {
  channelId?: string
  threadTs?: string
  ts?: string
  userId?: string
  userName?: string
  text?: string
  replyCount?: number
}): SlackOpenThreadContext | null {
  return buildOpenThreadContext(row)
}

/**
 * Whether a click on the whole message ROW should open the thread dock
 * (bug slack-thread-open-click-v1). The `.tsx` row is `role="button"` so the WHOLE row is an
 * open-thread trigger; opening on EVERY click would swallow normal interactions, so we ignore
 * a click that is either:
 *  - part of a text SELECTION (the user is selecting/copying message text — `hasTextSelection`),
 *    or
 *  - landing on a GENUINELY NESTED interactive element — a link, button, image, or inner
 *    `[role=button]` that owns its own click (`onNestedInteractive`).
 *
 * The decision is split out of the DOM here so it is node-testable. The CRITICAL distinction
 * (the bug) is that "nested interactive" means a DESCENDANT control, NOT the row element itself:
 * the row carries `role="button"`, so a naive `closest('[role="button"]')` matched the row on
 * EVERY plain click and wrongly short-circuited it. The `.tsx` therefore computes
 * `onNestedInteractive` by walking up from the click target but EXCLUDING the row element, and
 * passes the result here. Pure, total, DOM-free.
 *
 * @param hasTextSelection  true when a non-empty Range selection exists (user is selecting text)
 * @param onNestedInteractive true when the click landed on a nested interactive descendant
 *                            (a real link/button/image/inner role=button), NOT the row itself
 * @returns true only for a plain click on the row's own non-interactive area
 */
export function shouldOpenThreadOnRowClick(
  hasTextSelection: boolean,
  onNestedInteractive: boolean
): boolean {
  return !hasTextSelection && !onNestedInteractive
}

/* ------------------------------------------------------------------------- *
 * Generative layout width-clamp (bug slack-generative-wrap-v1)
 *
 * The agent groups Slack lists with the SDK standard-catalog `Column`/`Row`
 * (registered in `index.ts`). Those SDK containers render a `<div>` whose className
 * is a fixed `flex flex-col gap-4` / `flex flex-row gap-3` with NO `min-w-0` — so the
 * flex box keeps its default `min-width: auto` and grows to its content's INTRINSIC
 * width. A long unbroken line of message text therefore expands that container past the
 * panel and overflows horizontally; the leaf `<p>`'s `whitespace-pre-wrap break-words`
 * and the list root's `min-w-0` never take effect because their containing block is
 * already wider than the panel.
 *
 * We cannot edit the third-party SDK div's className, so the Slack catalog registers
 * clamped wrappers (see `layout.tsx`) that render the SDK `Column`/`Row` inside a
 * block box carrying this class. `min-w-0` defeats the flex `min-width: auto` floor the
 * wrapper inherits from the panel's flex host; `max-w-full` caps it at the panel width;
 * `w-full` keeps short content filling the column. The SDK flex `<div>` is then a
 * block-level child bounded by this box, so its `min-w-0` list-root descendants wrap.
 *
 * The class lives here (not the `.tsx`) so the fix is assertable in a node (no-jsdom)
 * unit test — mirroring `components/ui/scroll-area.classes.ts`.
 * ------------------------------------------------------------------------- */

/** Width-clamp applied around an agent-emitted SDK Column/Row so its subtree wraps. */
export const SLACK_LAYOUT_CLAMP_CLASS = 'w-full min-w-0 max-w-full'

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
 * Whether to render the bound empty state (design §3 + slack-generative-message-parity-v1
 * §5.2, FR-015). The empty state means GENUINELY empty — distinct from "loading", which
 * shows the skeleton. So empty requires the list to be empty AND not loading AND to have
 * completed at least one load (mirroring the native panel's `loaded && items.length === 0`),
 * AND no error notice to show in its place (the error supersedes the empty state). The
 * `loaded`/`loading` args are optional for back-compat; when omitted the prior
 * empty-when-no-error behavior holds. Gating order: error > skeleton > empty > rows.
 */
export function showEmptyState(
  rowCount: number,
  error: string | undefined,
  loaded = true,
  loading = false
): boolean {
  if (showErrorNotice(error)) {
    return false
  }
  return rowCount === 0 && loaded && !loading
}

/**
 * Whether to render the bound loading SKELETON instead of the empty state
 * (slack-generative-message-parity-v1 §5.2, FR-014/FR-015/FR-016). True when the list has
 * NO rows yet AND either it has never loaded (first paint) OR a refresh is in flight
 * (`replace-fresh` momentarily clears rows with `loading=true`). An error supersedes the
 * skeleton (FR-016): a recoverable notice takes the region instead. Rows present → no
 * skeleton (a refresh-with-prior-rows keeps the rows visible). Pure, total, never throws.
 * Gating order: error > skeleton > empty > rows.
 */
export function showSkeletonState(
  rowCount: number,
  loading: boolean,
  loaded: boolean,
  error: string | undefined
): boolean {
  if (showErrorNotice(error)) {
    return false
  }
  if (rowCount > 0) {
    return false
  }
  return !loaded || loading
}
