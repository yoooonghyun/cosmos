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

import type { SlackImageRef, SlackSearchMatch } from '../../shared/slack'
import type { SlackMessageRowProps } from './SlackMessageRow'

/** Author display name with raw-id fallback (FR-004 / native `authorName`). */
export function authorName(userId: string, userName?: string): string {
  return userName && userName.trim() !== '' ? userName : userId
}

/**
 * The SUPERSET row shape every Slack message-bearing DTO can supply to the canonical row
 * (slack-search-row-full-parity-v1). A channel-history `SlackMessage`, a `SlackSearchMatch`, and
 * a generated bound `MessageRowNode` are three DIFFERENT DTOs, but they all map to the ONE
 * `SlackMessageRow`. Each field below is the union of what those DTOs carry; {@link messageToRowProps}
 * selects the present ones the SAME way for every path so a row can NEVER render differently
 * across native history, search results, and a generated `MessageList` given equivalent data.
 *
 * NON-SECRET only: this is display + non-secret thread coordinates — never a token.
 */
export interface SlackRowSource {
  ts?: string
  userId?: string
  userName?: string
  text?: string
  /** Thread reply count — present on a history message; ABSENT on a search hit (search.messages
   * does not return reply_count), so the "N replies" label simply does not render for search. */
  replyCount?: number
  customEmoji?: Record<string, string>
  /** Inline image refs — now carried by BOTH history AND search (extractImageRefs, main side). */
  images?: SlackImageRef[]
  /** Cross-channel `#channel` chip — search hits only (the one intended presentational difference). */
  channelName?: string
}

/**
 * The ONE field mapper from any Slack message DTO to the canonical {@link SlackMessageRowProps}
 * (slack-search-row-full-parity-v1, OQ-3 full unification). EVERY render path — native history,
 * native search, generated `MessageRow`, generated `SearchResultRow` — builds its data props
 * through THIS function, so the field selection can never drift between contexts. Given equivalent
 * source data the three contexts produce IDENTICAL props (the runtime visual-identity guarantee).
 *
 * The `onOpenThread` BEHAVIOR is NOT built here: it is a per-context closure (native carries a
 * `SlackMessage`; the generated row dispatches the `SLACK_OPEN_THREAD_ACTION`), which a pure
 * function cannot express. Callers pass their closure as `opts.onOpenThread` and it is appended
 * uniformly — so the only thing that ever differs between contexts is the closure's body, not the
 * data props. The DECISION of whether a row is thread-interactive is itself unified upstream
 * (every path wires the closure iff {@link buildOpenThreadContext} yields coords, i.e. the row
 * carries `channelId` + `threadTs`).
 *
 * Parity notes (why each field maps the same for all DTOs):
 *  - `userName` is the RESOLVED display name (FR-014); BOTH history (`resolveNames`) and search
 *    (`resolveMatchNames` / `resolveAuthorNames`) fill it BEFORE this runs, so the avatar initials
 *    + name match exactly (raw-`userId` fallback only when resolution failed — same for all paths).
 *  - `text`/`customEmoji` are decoded at the single main mapping point, so rich text + custom emoji
 *    render identically.
 *  - `images` are extracted by the SAME `extractImageRefs` for history AND search, so the inline
 *    thumbnail strip is identical.
 *  - `replyCount` is present on a history message and ABSENT on a search hit (search.messages omits
 *    it); the row's `RepliesAffordance` renders nothing for a 0/absent count, so this is a clean
 *    degrade, not a divergent variant.
 *  - `channelName` is the cross-channel `#channel` chip — search hits only; the ONE intended
 *    presentational difference.
 *
 * Pure + total: omits each optional field when absent (a missing optional never becomes an explicit
 * `undefined` prop), never throws.
 */
export function messageToRowProps(
  source: SlackRowSource,
  opts: { onOpenThread?: () => void } = {}
): SlackMessageRowProps {
  return {
    ts: source.ts ?? '',
    userId: source.userId ?? '',
    ...(source.userName !== undefined ? { userName: source.userName } : {}),
    text: source.text ?? '',
    ...(typeof source.replyCount === 'number' ? { replyCount: source.replyCount } : {}),
    ...(source.customEmoji ? { customEmoji: source.customEmoji } : {}),
    ...(source.images && source.images.length > 0 ? { images: source.images } : {}),
    ...(source.channelName ? { channelName: source.channelName } : {}),
    ...(opts.onOpenThread ? { onOpenThread: opts.onOpenThread } : {})
  }
}

/**
 * Map a Slack SEARCH match into the canonical row props (slack-search-row-full-parity-v1).
 * A THIN wrapper over the unified {@link messageToRowProps}: it forwards the match's now-full set
 * of render fields (incl. `images`) plus the cross-channel `#channel` chip, and wires
 * `onOpenThread` when the caller supplies the thread-open closure (a search hit carries
 * `channelId` + `threadTs = ts`, so it IS clickable to open its own thread — exactly like a
 * history row). Sharing the mapper with the native + generated history paths means a search row's
 * field mapping can never drift from theirs; the node test asserts every shared field is carried.
 *
 * `userName` is the RESOLVED display name (`resolveMatchNames` / `resolveAuthorNames` fill it
 * before this runs); `replyCount` is intentionally absent (search.messages omits reply_count), so
 * the "N replies" label does not render for a search row — the one documented divergence.
 *
 * Pure + total: omits each optional field when absent; never throws.
 */
export function searchMatchToRowProps(
  match: SlackSearchMatch,
  opts: { onOpenThread?: () => void } = {}
): SlackMessageRowProps {
  return messageToRowProps(
    {
      ts: match.ts,
      userId: match.userId,
      ...(match.userName !== undefined ? { userName: match.userName } : {}),
      text: match.text,
      ...(match.customEmoji ? { customEmoji: match.customEmoji } : {}),
      ...(match.images ? { images: match.images } : {}),
      ...(match.channelName ? { channelName: match.channelName } : {})
    },
    opts
  )
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
 * Filter a channel list by a name query (bug slack-channel-search-v1, Issue 1). The native
 * Slack panel paginates ALL public channels into one in-memory list, so finding a channel by
 * name is a pure case-insensitive substring filter over that list — no extra Slack read, no
 * token, no IPC. An empty/whitespace query returns the list UNCHANGED (the default browse
 * view). The match ignores a leading `#` on either side so typing "#general" or "general"
 * both work. Pure + total: a non-array input yields `[]`, an odd channel name compares as
 * empty, never throws.
 */
export function filterChannelsByName<T extends { name?: string }>(
  channels: readonly T[] | undefined,
  query: string
): T[] {
  if (!Array.isArray(channels)) {
    return []
  }
  const needle = query.trim().replace(/^#/, '').toLowerCase()
  if (needle === '') {
    return [...channels]
  }
  return channels.filter((c) =>
    (typeof c.name === 'string' ? c.name : '').toLowerCase().includes(needle)
  )
}

/**
 * Which subject the ONE shared Slack search Input acts on (bug slack-search-mode-selector-v1):
 * the unified [Channels] / [Messages] mode toggle. `'channels'` filters the in-memory channel
 * list by name (the {@link filterChannelsByName} path — narrows the channel list, no Slack read);
 * `'messages'` runs the message search (the `search` → `SlackMessageRow` results path). The mode
 * itself is component state; this type + the helpers below keep the per-mode decisions
 * (placeholder, whether a submit applies) node-testable.
 */
export type SlackSearchMode = 'channels' | 'messages'

/** The two modes in display order — the segmented toggle iterates this. */
export const SLACK_SEARCH_MODES: readonly SlackSearchMode[] = ['channels', 'messages']

/** Human label for a search mode (the segmented toggle's button text). */
export function searchModeLabel(mode: SlackSearchMode): string {
  return mode === 'channels' ? 'Channels' : 'Messages'
}

/**
 * Placeholder for the ONE shared search Input, switched by the selected mode
 * (bug slack-search-mode-selector-v1). `'channels'` → "Find a channel" (filters the loaded
 * list as you type); `'messages'` → "Search messages" (runs the message search on submit).
 * Pure + total: an unknown mode falls back to the message-search placeholder.
 */
export function searchPlaceholder(mode: SlackSearchMode): string {
  return mode === 'channels' ? 'Find a channel' : 'Search messages'
}

/**
 * Whether the shared Input runs its action on FORM SUBMIT (Enter) rather than live-as-you-type
 * (bug slack-search-mode-selector-v1). Message search is an explicit Slack read, so it fires on
 * submit only; channel filtering is a local list narrow that updates on every keystroke (no
 * submit needed). Pure decision so the panel wiring stays node-testable.
 */
export function searchModeSubmits(mode: SlackSearchMode): boolean {
  return mode === 'messages'
}

/**
 * Prepend an OLDER page of history above the existing (newer) messages, keeping the whole
 * list in one ascending-chronological order (bug slack-message-order-loadmore-v1, Issue 3).
 *
 * The channel history renders NEWEST-at-bottom (oldest at top): `toMessages` sorts every page
 * ascending by `ts`, and the list paints them top-to-bottom. "Load more" fetches the NEXT
 * cursor page, which is OLDER history, so those rows belong ABOVE the current ones — appending
 * them at the bottom (the old behavior) tangled the order. This puts the older page first, then
 * the existing rows, and re-sorts by `ts` so any interleaving is resolved into one clean
 * ascending order. Returns a NEW array. Pure + total: non-array inputs coerce to `[]`, a row
 * with an odd/absent `ts` sorts as epoch 0, never throws.
 */
export function prependOlderMessages<T extends { ts?: string }>(
  existing: readonly T[] | undefined,
  olderPage: readonly T[] | undefined
): T[] {
  const cur = Array.isArray(existing) ? existing : []
  const older = Array.isArray(olderPage) ? olderPage : []
  return [...older, ...cur].sort((a, b) => compareTsAsc(a.ts, b.ts))
}

/**
 * Order a GENERATED bound message list ascending by `ts` (oldest → newest, newest-at-bottom)
 * so it renders IDENTICALLY to the native panel (bug slack-generated-message-order-v1).
 *
 * The native list owns its own accumulation and PREPENDS older history above
 * ({@link prependOlderMessages}). The GENERATED bound list's accumulation is owned by the
 * shared main-side `AdapterDispatcher`, which is panel-agnostic and APPENDS every next page at
 * the BOTTOM of the accumulated array (correct for Jira/Confluence, which paginate
 * newest-first downward). For Slack history the next page is OLDER, so a raw append tangles the
 * order vs native. Rather than special-case the SHARED dispatcher (which would risk
 * Jira/Confluence), the Slack catalog re-orders the rows it was handed at the RENDER layer:
 * one ascending sort makes the displayed order match native no matter which direction the
 * dispatcher accumulated. Pure + total: a non-array input yields `[]`, an odd/absent `ts` sorts
 * as epoch 0, returns a NEW array, never throws.
 */
export function orderBoundMessages<T extends { ts?: string }>(rows: readonly T[] | undefined): T[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return [...rows].sort((a, b) => compareTsAsc(a.ts, b.ts))
}

/**
 * Compare two Slack epoch `ts` strings ("seconds.micros") NUMERICALLY for ascending
 * (oldest → newest) order (bug slack-message-order-loadmore-v1). A lexical compare misorders
 * unequal-length integer parts ("999.9" sorts after "1000.0"); `Number()` parses the whole
 * fixed-point value so the microsecond suffix tiebreaks. A non-numeric/absent `ts` sorts as 0.
 * Pure + total, never throws. (Mirrors the main-side `compareTs` in `slackClient.ts`, kept here
 * so the renderer prepend is node-testable without importing main.)
 */
export function compareTsAsc(a: string | undefined, b: string | undefined): number {
  const na = Number(a)
  const nb = Number(b)
  const va = Number.isFinite(na) ? na : 0
  const vb = Number.isFinite(nb) ? nb : 0
  return va - vb
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
 * Per-list independent-scroll AND fill — v2 height-chain repair
 * (slack-list-scroll-fill-v2, supersedes slack-independent-list-scroll-v1)
 *
 * GOAL (two requirements that were mutually exclusive in practice):
 *   R1 — 2+ message lists each scroll INDEPENDENTLY (no shared scrollbar).
 *   R2 — a LONE list FILLS down to the panel bottom (no dead gap).
 *
 * WHY the two prior leaf-only attempts each failed (must NOT be repeated):
 *   - Attempt 1, `max-h-[70vh]` per list root: gave R1 but BROKE R2 — a fixed viewport
 *     fraction is SHORTER than the panel body, so a lone tall list stopped at 70vh and left
 *     ~30vh of dead space below it. The cap is decoupled from the actual panel height.
 *   - Attempt 2, `max-h-full` per list root: gave R2 but BROKE R1 — `max-height: 100%`
 *     resolves against the list's containing block, which is the SDK `Column`/`Row` flex div
 *     (`flex flex-col gap-4`, AUTO height, no `min-h-0`/`flex-1`/definite height). A percentage
 *     `max-height` against an indefinite-height parent computes to effectively `none`, so the
 *     bound never engaged — every list flowed back into the ONE panel `overflow-auto` scroller
 *     and N lists shared one scrollbar (the regression).
 *
 * ROOT CAUSE (both attempts): the height chain from the tabpanel scroller down to a list root
 * is BROKEN at the SDK `Column`/`Row` flex div — it is neither a definite-height ancestor (so
 * `%`/`max-h-full` can't resolve) nor a `flex-1 min-h-0` link (so a flex-fill chain can't
 * thread through). A leaf class alone can NEVER fix this: the break is ABOVE the leaf and the
 * leaf cannot see sibling count or whether a definite-height ancestor exists.
 *
 * v2 MECHANISM — repair the chain at the FIRST-PARTY DOM seam, not the leaf:
 *   The Slack catalog does NOT register the raw SDK `Column`/`Row`; it registers its OWN
 *   `slackCatalog/layout.tsx` wrappers (`<div className={…}><SdkColumn/></div>`). That wrapper
 *   div is renderer-owned, and the SDK flex div is ALWAYS its only child. So we thread a
 *   definite-height / flex-fill chain from the host all the way down WITHOUT depending on any
 *   SDK attribute:
 *     1. HOST  (SlackPanel.tsx tabpanel) carries {@link SLACK_SURFACE_HOST_CLASS}
 *        (`flex flex-col min-h-0`) on top of its existing `flex-1 overflow-auto` — its parent
 *        `@container/slackbody relative flex min-h-0 flex-1` gives it a resolved height, so the
 *        host becomes the definite-height TOP of a flex column.
 *     2. WRAPPER (layout.tsx Column/Row) carries {@link SLACK_LAYOUT_FILL_CLASS}
 *        (width clamp + `flex flex-col min-h-0 flex-1` + a POSITIONAL `[&>*]` descendant repair
 *        of the auto-height SDK flex child). `[&>*]` keys off DOM POSITION (direct child), not
 *        any SDK class, so the SDK flex div participates in the chain regardless of its classes.
 *     3. LIST ROOT (MessageList/SearchResultList) carries {@link SLACK_LIST_SCROLL_CLASS}
 *        (`min-h-0 flex-1 overflow-y-auto` — definite FLEX sizing, NOT a `%` max-height).
 *
 *   Result: a LONE list is the only flex child of its parent → consumes `flex-1` → FILLS to the
 *   panel bottom (R2, no dead gap). N lists are SIBLING flex children → equal-split the available
 *   height and EACH scrolls internally past its share (R1). R1 and R2 are now the SAME mechanism
 *   (N=1 is the degenerate split). No fixed `vh`, no `%` against an indefinite parent.
 *
 * SDK-markup robustness (FR-012): nothing keys off the SDK div's classes — the anchor is the
 * first-party wrapper + the positional `[&>*]`. If a future `@a2ui-sdk` upgrade inserts an EXTRA
 * wrapper layer, the worst case is one un-filled auto-height layer → degrades to "lone list still
 * fills, multi-list may share" — NEVER horizontal overflow (`min-w-0 max-w-full` untouched) and
 * never a white-screen.
 *
 * cqh hardening (Story 5) — SKIPPED: `100cqh` against `@container/slackbody` fills the lone list
 * but has NO divide-by-N, so applied to every list root it re-breaks multi-list (each becomes
 * full-panel-tall → shared scroll, the Attempt-2 failure). The catalog leaf can't see sibling
 * count to make it single-list-only, so cqh is not used; the flex chain is the load-bearing
 * mechanism.
 *
 * Scrollbar visibility: the list root keeps `scrollbar-hover-only` (a Tailwind `@utility` in
 * `index.css`) — the inner scrollbar is HIDDEN by default and revealed ONLY while the pointer is
 * over THAT list; `scrollbar-gutter: stable` reserves the track so hover causes no content shift.
 *
 * SCOPE: presentational containment only — no row, ordering (`orderBoundMessages`), load-more,
 * data-model, or read-only behavior changes (FR-010). `ChannelList` is repaired uniformly via the
 * wrapper fill chain (FR-009 default = include); the per-list scroll class applies to the
 * MESSAGE-bearing lists (`MessageList`/`SearchResultList`) as before.
 *
 * The three class strings live here (not the `.tsx`) so the chain is assertable in a node
 * (no-jsdom) unit test — mirroring `SLACK_LAYOUT_CLAMP_CLASS` + `components/ui/scroll-area.classes.ts`.
 * ------------------------------------------------------------------------- */

/**
 * Per-list scroll bound for a MESSAGE-bearing catalog list root: it CONSUMES the v2 flex-fill
 * chain — `min-h-0 flex-1 overflow-y-auto` (definite flex sizing, NOT a `%`/`vh` max-height, so a
 * lone list fills and N siblings equal-split + each scroll), preserving the `min-w-0 max-w-full`
 * wrap-safety and the hover-only inner scrollbar. (Dropped the Attempt-1/2 `max-h-*` cap — the
 * bound is now flex sizing against the repaired chain, not a percentage max-height.)
 */
export const SLACK_LIST_SCROLL_CLASS =
  'min-h-0 flex-1 overflow-y-auto min-w-0 max-w-full scrollbar-hover-only'

/**
 * Fill-chain class for the FIRST-PARTY `Column`/`Row` wrapper (layout.tsx): extends the existing
 * width clamp (`w-full min-w-0 max-w-full`) with the flex-fill chain (`flex min-h-0 flex-1`) AND a
 * POSITIONAL `[&>*]` descendant repair of the auto-height SDK flex child. The SDK child holds the
 * sibling lists; it is forced to `!flex-row` (overriding the SDK's own `flex-col`) so MULTIPLE
 * lists lay out SIDE-BY-SIDE (vertical dividers — "세로 분할"), each a full-height column that
 * scrolls independently, instead of stacking top/bottom (horizontal dividers) which read poorly.
 * A lone list is the only flex child → it fills the full width. The `[&>*]` keys off DOM position
 * (the wrapper's only child is always the SDK `Column`/`Row` div), not any SDK class — so the chain
 * threads through regardless of SDK markup (FR-005/FR-012). Replaces {@link SLACK_LAYOUT_CLAMP_CLASS}.
 */
export const SLACK_LAYOUT_FILL_CLASS =
  'w-full min-w-0 max-w-full flex flex-col min-h-0 flex-1 ' +
  '[&>*]:flex [&>*]:!flex-row [&>*]:min-h-0 [&>*]:min-w-0 [&>*]:flex-1'

/**
 * Chain-fill class the SlackPanel tabpanel HOST adds so its surface child participates in the
 * v2 fill chain: `flex flex-col min-h-0` (combined at the call site with the host's existing
 * `min-w-0 flex-1 overflow-auto p-3 …`). Its parent `@container/slackbody relative flex min-h-0
 * flex-1` gives the host a resolved height, so the host is the definite-height TOP of the column.
 * Exported as a string so the node test asserts the host carries these chain tokens.
 */
export const SLACK_SURFACE_HOST_CLASS = 'flex flex-col min-h-0'

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
