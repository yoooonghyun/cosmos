/**
 * slackChannelSearchLogic — node-testable pagination + cache logic for the Slack
 * panel's NATIVE channel browser "Channels" search mode
 * (bug slack-channel-search-full-load-v1).
 *
 * Problem: the native channel browser pages channels in on demand (load-more), so the
 * "Channels" search filtered over ONLY the already-paged subset and missed most of the
 * workspace. Slack's PUBLIC Web API has no channel-name search endpoint
 * (`conversations.list` takes no query) and `admin.conversations.search` needs Enterprise
 * Grid, so the only route is to enumerate the FULL channel list via cursor pagination then
 * filter client-side.
 *
 * This module is the pure orchestration of that enumeration: loop the EXISTING
 * `listChannels({ cursor })` IPC until there is no `nextCursor`, accumulating every page.
 * It is deliberately UI-free (no React, no DOM) so the accumulate / degrade-on-failure /
 * served-once behavior is unit-testable in the node vitest env, separate from `SlackPanel.tsx`
 * (the project `.ts` / `.test.ts` split). The session cache itself (a ref) lives in the panel;
 * this module only computes the exhausted list given a fetch fn.
 *
 * Reuses the existing typed IPC contract — adds NO new channel/type/MCP tool/main method. The
 * only data crossing the boundary is the non-secret channel id/name already carried today.
 */

import type { SlackChannel, SlackPage, SlackResult } from '../../shared/types/slack'

/** A single page-fetch over the EXISTING `listChannels` IPC, threaded by cursor. */
export type ListChannelsPage = (
  cursor: string | undefined
) => Promise<SlackResult<SlackPage<SlackChannel>>>

/** Outcome of exhausting the channel list (degrade-never-throw, FR-016 spirit). */
export interface FullChannelLoad {
  /** Every channel accumulated across all pages fetched before the loop ended. */
  channels: SlackChannel[]
  /**
   * Whether the FULL set was loaded (the loop ran out of cursors cleanly). `false` means a
   * page fetch failed mid-pagination and we degraded to the partial accumulation — the caller
   * should NOT cache this as the exhausted set so a later search can retry.
   */
  complete: boolean
}

/**
 * A safety cap on pages fetched, so a pathological/looping cursor can never spin forever.
 * 100 channels/page x 200 pages = 20k channels, far above any real workspace; reaching it is
 * treated like a clean end (the practical full set has been loaded).
 */
export const MAX_CHANNEL_PAGES = 200

/**
 * Exhaust the channel list by following `nextCursor` from the first page (no cursor) until it
 * is absent, accumulating every page's `items`. Pure orchestration over the injected `fetchPage`
 * (the existing `listChannels` IPC) — no React/DOM, fully node-testable.
 *
 * Degrade-never-throw (FR-016/FR-026 spirit): if any page fetch returns `{ ok:false }` (or the
 * promise rejects), the loop STOPS and returns the channels gathered so far with
 * `complete:false`. The caller then filters over the partial set and does NOT cache it, so the
 * next search retries the full load. A clean run (cursor runs out, or the page cap is hit)
 * returns `complete:true`.
 */
export async function loadAllChannels(fetchPage: ListChannelsPage): Promise<FullChannelLoad> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined = undefined
  let pages = 0
  // Loop pages: first call has no cursor; each subsequent call uses the page's nextCursor.
  // Terminates on absent nextCursor (clean end), a failed/rejected fetch (degrade), or the cap.
  for (;;) {
    let result: SlackResult<SlackPage<SlackChannel>>
    try {
      result = await fetchPage(cursor)
    } catch {
      // A thrown/rejected fetch is treated exactly like a failed page — degrade to partial.
      return { channels, complete: false }
    }
    if (!result.ok) {
      return { channels, complete: false }
    }
    channels.push(...result.data.items)
    pages += 1
    const next = result.data.nextCursor
    if (!next || pages >= MAX_CHANNEL_PAGES) {
      return { channels, complete: true }
    }
    cursor = next
  }
}
