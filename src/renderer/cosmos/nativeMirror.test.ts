import { describe, it, expect } from 'vitest'
import { buildConfluenceMirror, buildSlackMirror } from './nativeMirror'
import {
  SURFACE_CONFLUENCE_FEED,
  SURFACE_CONFLUENCE_PAGE,
  SURFACE_CONFLUENCE_SEARCH,
  confluenceResultRow
} from '../../shared/surfaceBuilders/confluenceSurfaceBuilder'
import {
  SURFACE_SLACK_CHANNELS,
  SURFACE_SLACK_HISTORY,
  SURFACE_SLACK_SEARCH,
  slackChannelRow,
  slackMessageRow,
  slackSearchRow
} from '../../shared/surfaceBuilders/slackSurfaceBuilder'
import type {
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceSearchResult
} from '../../shared/types/confluence'
import type { SlackChannel, SlackMessage, SlackPage, SlackSearchMatch } from '../../shared/types/slack'

/* cosmos-native-view-mirror-surface-v1 (D4) — nativeMirror selects the current native view + wraps
 * the SHARED bound builder's `{spec, dataModel, descriptor}` into a display-only TabSurface with a
 * fresh requestId. Tests: each view kind → the right surfaceId + seeded rows; null for no-data. A
 * deterministic mintId makes the requestId assertable. */

const mint = (): string => 'req-test'

const HIT: ConfluenceSearchResult = { id: 'P1', title: 'Page One', space: 'ENG', excerpt: 'hi' }
const FEED_PAGE: ConfluencePage<ConfluenceSearchResult> = { items: [HIT], nextCursor: 'c2' }
const DETAIL: ConfluencePageDetail = { id: 'P1', title: 'Page One', space: 'ENG', body: 'the body' }

const CHANNEL: SlackChannel = { id: 'C1', name: 'general', isMember: true }
const MESSAGE: SlackMessage = { ts: '1700000000.0001', userId: 'U1', userName: 'Ada', text: 'hi' }
const MATCH: SlackSearchMatch = {
  ts: '1700000000.0002',
  userId: 'U2',
  userName: 'Bo',
  text: 'found',
  channelId: 'C1',
  channelName: 'general'
}

describe('buildConfluenceMirror', () => {
  it('null view → null (no native data yet → favorite WAITING, FR-008)', () => {
    expect(buildConfluenceMirror(null, mint)).toBeNull()
  })

  it('feed view → a confluence-feed surface seeded with the mapped rows + fresh requestId', () => {
    const surface = buildConfluenceMirror({ kind: 'feed', page: FEED_PAGE }, mint)
    expect(surface).not.toBeNull()
    expect(surface!.requestId).toBe('req-test')
    expect(surface!.spec.surfaceId).toBe(SURFACE_CONFLUENCE_FEED)
    expect(surface!.dataModel?.[0]).toEqual({
      surfaceId: SURFACE_CONFLUENCE_FEED,
      path: '/feed',
      value: [confluenceResultRow(HIT)]
    })
    expect(surface!.descriptor?.dataSource).toBe('defaultFeed')
  })

  it('search view → a confluence-search surface carrying the query in its descriptor', () => {
    const surface = buildConfluenceMirror(
      { kind: 'search', query: 'spec', page: { items: [HIT] } },
      mint
    )
    expect(surface!.spec.surfaceId).toBe(SURFACE_CONFLUENCE_SEARCH)
    expect(surface!.descriptor?.query).toEqual({ query: 'spec' })
  })

  it('page view → a confluence-page detail surface seeded with the page value', () => {
    const surface = buildConfluenceMirror({ kind: 'page', detail: DETAIL }, mint)
    expect(surface!.spec.surfaceId).toBe(SURFACE_CONFLUENCE_PAGE)
    expect(surface!.dataModel?.[0]).toEqual({
      surfaceId: SURFACE_CONFLUENCE_PAGE,
      path: '/page',
      value: DETAIL
    })
    expect(surface!.descriptor?.query).toEqual({ pageId: 'P1' })
  })

  it('mints a FRESH requestId per build (display-only re-projection)', () => {
    const a = buildConfluenceMirror({ kind: 'feed', page: FEED_PAGE })
    const b = buildConfluenceMirror({ kind: 'feed', page: FEED_PAGE })
    expect(a!.requestId).not.toBe(b!.requestId)
  })
})

describe('buildSlackMirror', () => {
  it('null view → null', () => {
    expect(buildSlackMirror(null, mint)).toBeNull()
  })

  it('channels view → a slack-channels surface seeded with the mapped channel rows', () => {
    const surface = buildSlackMirror(
      { kind: 'channels', page: { items: [CHANNEL], nextCursor: 'c2' } },
      mint
    )
    expect(surface!.spec.surfaceId).toBe(SURFACE_SLACK_CHANNELS)
    expect(surface!.dataModel?.[0]).toEqual({
      surfaceId: SURFACE_SLACK_CHANNELS,
      path: '/channels',
      value: [slackChannelRow(CHANNEL)]
    })
  })

  it('history view → a slack-history surface keyed on the channelId, rows carry resolved userName', () => {
    const page: SlackPage<SlackMessage> = { items: [MESSAGE] }
    const surface = buildSlackMirror({ kind: 'history', channelId: 'C1', page }, mint)
    expect(surface!.spec.surfaceId).toBe(SURFACE_SLACK_HISTORY)
    expect(surface!.dataModel?.[0]).toEqual({
      surfaceId: SURFACE_SLACK_HISTORY,
      path: '/messages',
      value: [slackMessageRow(MESSAGE, 'C1')]
    })
    // OQ-5: the lifted message carried a resolved userName, so the mirror row shows the name.
    expect((surface!.dataModel?.[0].value as Record<string, unknown>[])[0]).toMatchObject({
      userName: 'Ada',
      channelId: 'C1'
    })
    expect((surface!.descriptor!.query as Record<string, unknown>).channelId).toBe('C1')
  })

  it('search view → a slack-search surface carrying the query, rows carry resolved userName', () => {
    const surface = buildSlackMirror({ kind: 'search', query: 'hello', page: { items: [MATCH] } }, mint)
    expect(surface!.spec.surfaceId).toBe(SURFACE_SLACK_SEARCH)
    expect(surface!.dataModel?.[0]).toEqual({
      surfaceId: SURFACE_SLACK_SEARCH,
      path: '/matches',
      value: [slackSearchRow(MATCH)]
    })
    expect((surface!.descriptor!.query as Record<string, unknown>).query).toBe('hello')
  })

  it('carries no token/secret in the built mirror (NON-SECRET, FR-006)', () => {
    const surface = buildSlackMirror({ kind: 'history', channelId: 'C1', page: { items: [MESSAGE] } }, mint)
    expect(JSON.stringify(surface)).not.toMatch(/Bearer|xoxb|xoxp|token/i)
  })
})
