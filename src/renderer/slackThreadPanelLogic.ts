/**
 * slackThreadPanelLogic — pure, DOM-free state transitions for the right-docked Slack
 * thread panel (slack-thread-sidepanel-and-image-viewer-v1, FR-001/FR-004/FR-013).
 *
 * The native Slack panel's "N replies" affordance (`onOpenThread`) AND the generative
 * A2UI surface's `SLACK_OPEN_THREAD_ACTION` BOTH feed ONE renderer-local "open thread"
 * state (FR-013). These transitions encode that single source of truth: open / retarget /
 * toggle-same-closes / close, plus the `isThreadOpen` derivation the row uses to know
 * whether its own thread is the open one. The root-drop helper (drop the thread root from
 * the replies, since it is shown as the panel header — FR-003) lives here too so it is
 * node-testable.
 *
 * Carried state is the non-secret {@link SlackOpenThreadContext} only: thread coordinates
 * (`channelId`/`threadTs`) + the parent message's display fields. NO Slack token, secret,
 * or `files.slack.com` URL ever enters this state (FR-009/FR-013) — these are pure value
 * transitions, total, and never throw.
 *
 * Split convention (DEVELOPMENT.md): the transitions are pure → here in `.ts`, tested in
 * `slackThreadPanelLogic.test.ts` (node env, no DOM). `SlackPanel.tsx` keeps only JSX +
 * wiring.
 */

import type { SlackOpenThreadContext } from './slackCatalog/logic'

/**
 * The renderer-local open-thread state: either no thread is open (`null`), or the
 * non-secret context of the one open thread. A single source of truth shared by the
 * native and generative reply affordances (FR-013).
 */
export type OpenThreadState = SlackOpenThreadContext | null

/** No thread open — the message list fills the full width (FR-005). */
export const OPEN_THREAD_CLOSED: OpenThreadState = null

/**
 * Resolve the `MessageList` outer-wrapper class for the two scroll modes
 * (bug slack-thread-unified-scroll-v1). `MessageList` is shared by the history view and
 * the thread dock's replies. In the history view it OWNS its scroll (`scroll=true`) →
 * `h-full` so its inner ScrollArea fills the column. In the thread dock the root (본문) +
 * the "N replies" divider + the replies must scroll as ONE region, so the replies list
 * must NOT scroll independently (`scroll=false`) → `h-auto` lets it grow to content height
 * inside the single shared ScrollArea wrapping the whole thread content. Pure + total:
 * any boolean in, a stable class out, never throws.
 */
export function messageListWrapClass(scroll: boolean): string {
  return scroll ? 'h-full' : 'h-auto'
}

/**
 * Whether `state` currently has the thread identified by `channelId`/`threadTs` open.
 * Used by the panel to decide toggle-vs-retarget and to mark the active row. A `null`
 * state (closed) is never "open". Total: missing/odd ids simply compare unequal.
 */
export function isThreadOpen(
  state: OpenThreadState,
  channelId: string,
  threadTs: string
): boolean {
  return state !== null && state.channelId === channelId && state.threadTs === threadTs
}

/**
 * Transition for activating a thread's "N replies" affordance (FR-001/FR-004).
 *
 * - If `ctx` is the SAME thread already open → returns `null` (toggle closed, FR-004 MAY).
 * - Otherwise → returns `ctx` (open a fresh thread, or retarget in place to a different
 *   one without a close/reopen — FR-004; the dock updates content, never churns).
 *
 * Pure; does not mutate `state`. The caller stores the returned value as the new state.
 */
export function openThread(state: OpenThreadState, ctx: SlackOpenThreadContext): OpenThreadState {
  if (isThreadOpen(state, ctx.channelId, ctx.threadTs)) {
    return OPEN_THREAD_CLOSED
  }
  return ctx
}

/** Close the panel (header X / narrow scrim / channel-or-view change) → full-width list. */
export function closeThread(): OpenThreadState {
  return OPEN_THREAD_CLOSED
}

/**
 * Whether `permalink` is a live-openable "Open in Slack" web URL (slack-thread-open-in-slack-v1):
 * a non-empty string that parses to an ABSOLUTE `http(s)` URL. Re-validates the value main carried
 * on the replies page so a non-`http(s)`/malformed string can NEVER become a live header link
 * (the dock then renders a plain header, no icon). Mirrors the Confluence `PageDetailTitle` guard.
 * Pure + total: never throws (parse failures → false).
 */
export function isOpenableThreadPermalink(permalink: string | undefined): permalink is string {
  if (typeof permalink !== 'string' || permalink.trim() === '') {
    return false
  }
  try {
    const u = new URL(permalink)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Drop the thread root from a reply list (FR-003): `conversations.replies` returns the
 * parent as the first item, but the panel shows it as the header, so it must not render
 * twice. Filters any reply whose `ts` equals the parent's. Total: a non-array input
 * yields `[]`; a missing `parentTs` filters nothing (safe fallback, never throws).
 */
export function dropThreadRoot<T extends { ts?: string }>(
  replies: readonly T[] | undefined,
  parentTs: string | undefined
): T[] {
  if (!Array.isArray(replies)) {
    return []
  }
  if (typeof parentTs !== 'string' || parentTs === '') {
    return [...replies]
  }
  return replies.filter((m) => m.ts !== parentTs)
}
