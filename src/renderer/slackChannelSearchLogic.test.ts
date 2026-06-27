/**
 * Tests for slackChannelSearchLogic (bug slack-channel-search-full-load-v1).
 *
 * Pure node-env tests — no `.tsx` import, no DOM. They assert the channel-list exhaustion
 * loop: accumulates every page until no cursor, degrades to the partial set on a mid-pagination
 * failure, and (together with the cache contract) the served-once expectation via call counting.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  loadAllChannels,
  MAX_CHANNEL_PAGES,
  type ListChannelsPage
} from './slackChannelSearchLogic'
import type { SlackChannel, SlackPage, SlackResult } from '../shared/slack'

function ch(name: string): SlackChannel {
  return { id: `C-${name}`, name, isMember: false }
}

function ok(items: SlackChannel[], nextCursor?: string): SlackResult<SlackPage<SlackChannel>> {
  return { ok: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }
}

/** A fetcher that returns the given pages in order, keyed by the cursor it expects. */
function pagedFetcher(
  pages: { items: SlackChannel[]; nextCursor?: string }[]
): { fetch: ListChannelsPage; calls: () => number } {
  let i = 0
  let calls = 0
  const fetch: ListChannelsPage = async () => {
    calls += 1
    const page = pages[i]
    i += 1
    return ok(page.items, page.nextCursor)
  }
  return { fetch, calls: () => calls }
}

describe('loadAllChannels', () => {
  it('accumulates pages across the FULL set until there is no cursor', async () => {
    const { fetch, calls } = pagedFetcher([
      { items: [ch('alpha'), ch('beta')], nextCursor: 'c1' },
      { items: [ch('gamma')], nextCursor: 'c2' },
      { items: [ch('delta'), ch('epsilon')] } // no nextCursor -> last page
    ])
    const result = await loadAllChannels(fetch)
    expect(result.complete).toBe(true)
    expect(result.channels.map((c) => c.name)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon'
    ])
    expect(calls()).toBe(3)
  })

  it('threads the nextCursor of each page into the next fetch', async () => {
    const seen: (string | undefined)[] = []
    const fetch: ListChannelsPage = async (cursor) => {
      seen.push(cursor)
      if (cursor === undefined) return ok([ch('a')], 'cur-1')
      if (cursor === 'cur-1') return ok([ch('b')], 'cur-2')
      return ok([ch('c')])
    }
    const result = await loadAllChannels(fetch)
    expect(seen).toEqual([undefined, 'cur-1', 'cur-2'])
    expect(result.channels.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('single page (no cursor) loads completely in one call', async () => {
    const fetch: ListChannelsPage = async () => ok([ch('only')])
    const result = await loadAllChannels(fetch)
    expect(result).toEqual({ channels: [ch('only')], complete: true })
  })

  it('degrades to the partial set (complete:false) on a failed page mid-pagination', async () => {
    let n = 0
    const fetch: ListChannelsPage = async () => {
      n += 1
      if (n === 1) return ok([ch('one'), ch('two')], 'c1')
      if (n === 2) return ok([ch('three')], 'c2')
      // third page fails
      return { ok: false, kind: 'network', message: 'boom' }
    }
    const result = await loadAllChannels(fetch)
    expect(result.complete).toBe(false)
    expect(result.channels.map((c) => c.name)).toEqual(['one', 'two', 'three'])
  })

  it('degrades to the partial set when a fetch promise rejects (never throws)', async () => {
    let n = 0
    const fetch: ListChannelsPage = async () => {
      n += 1
      if (n === 1) return ok([ch('a')], 'c1')
      throw new Error('network exploded')
    }
    await expect(loadAllChannels(fetch)).resolves.toEqual({
      channels: [ch('a')],
      complete: false
    })
  })

  it('first-page failure yields empty + complete:false (no crash)', async () => {
    const fetch: ListChannelsPage = async () => ({
      ok: false,
      kind: 'reconnect_needed',
      message: 'nope'
    })
    const result = await loadAllChannels(fetch)
    expect(result).toEqual({ channels: [], complete: false })
  })

  it('stops at the page cap even if the cursor never ends (no infinite loop)', async () => {
    const fetch = vi.fn<ListChannelsPage>(async () => ok([ch('x')], 'always-more'))
    const result = await loadAllChannels(fetch)
    expect(result.complete).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(MAX_CHANNEL_PAGES)
    expect(result.channels).toHaveLength(MAX_CHANNEL_PAGES)
  })
})
