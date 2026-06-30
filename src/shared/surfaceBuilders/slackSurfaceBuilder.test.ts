import { describe, it, expect } from 'vitest'
import {
  buildBoundChannelListSurface,
  buildBoundMessageListSurface,
  buildBoundSearchResultListSurface,
  SLACK_CHANNELS_PATH,
  SLACK_MATCHES_PATH,
  SLACK_MESSAGES_PATH,
  slackChannelRow,
  slackMessageRow,
  slackSearchRow,
  SURFACE_SLACK_CHANNELS,
  SURFACE_SLACK_HISTORY,
  SURFACE_SLACK_SEARCH
} from './slackSurfaceBuilder'
import { SlackAdapterSource } from '../types/slack'
import type { SlackChannel, SlackMessage, SlackPage, SlackSearchMatch } from '../types/slack'

/* slack-generative-adapter-v1 — BOUND Slack surfaces: a `{path}`-bound (data-free) spec +
 * an initial data-model seed + a secret-free descriptor. APPEND-ONLY: every list seeds
 * /loading + /hasMore (never /hasPrev) and binds via {path}. Pattern per FR: happy path;
 * missing-optional (no nextCursor → hasMore:false); no-secret invariant (FR-018).
 * cosmos-native-view-mirror-surface-v1 (D3): RELOCATED here from src/main/slack so the
 * renderer can reuse them for a favorite's native-view mirror (single source of truth). */

type Component = { id: string; component: string } & Record<string, unknown>

function isBinding(v: unknown): v is { path: string } {
  return typeof v === 'object' && v !== null && typeof (v as { path?: unknown }).path === 'string'
}

const CHANNEL: SlackChannel = { id: 'C1', name: 'general', isMember: true }
const MESSAGE: SlackMessage = { ts: '1700000000.000100', userId: 'U1', userName: 'Ada', text: 'hi' }
const MATCH: SlackSearchMatch = {
  ts: '1700000000.000200',
  userId: 'U2',
  userName: 'Bo',
  text: 'found',
  channelId: 'C1',
  channelName: 'general'
}

describe('buildBoundChannelListSurface (FR-002/FR-003/FR-006)', () => {
  const page: SlackPage<SlackChannel> = { items: [CHANNEL], nextCursor: 'c2' }

  it('emits a ChannelList root whose rows + flags are {path} bindings (data-free spec)', () => {
    const { spec } = buildBoundChannelListSurface(page)
    expect(spec.surfaceId).toBe(SURFACE_SLACK_CHANNELS)
    const root = (spec.components as Component[])[0]
    expect(root.component).toBe('ChannelList')
    expect(root.channels).toEqual({ path: SLACK_CHANNELS_PATH })
    expect(root.loading).toEqual({ path: '/loading' })
    expect(root.hasMore).toEqual({ path: '/hasMore' })
    expect(root.error).toEqual({ path: '/error' })
    expect(isBinding(root.channels)).toBe(true)
    // APPEND-ONLY: no prev binding anywhere.
    expect('hasPrev' in root).toBe(false)
  })

  it('seeds the first page rows + /loading=false + /hasMore=true (FR-003)', () => {
    const { dataModel } = buildBoundChannelListSurface(page)
    expect(dataModel).toEqual([
      { surfaceId: SURFACE_SLACK_CHANNELS, path: SLACK_CHANNELS_PATH, value: [slackChannelRow(CHANNEL)] },
      { surfaceId: SURFACE_SLACK_CHANNELS, path: '/loading', value: false },
      { surfaceId: SURFACE_SLACK_CHANNELS, path: '/hasMore', value: true }
    ])
  })

  it('seeds hasMore:false when the page has no nextCursor (missing optional, no error)', () => {
    const { dataModel } = buildBoundChannelListSurface({ items: [] })
    expect(dataModel.find((d) => d.path === '/hasMore')!.value).toBe(false)
    expect(dataModel.some((d) => d.path === '/hasPrev')).toBe(false)
  })

  it('carries the listChannels descriptor (secret-free) for re-execution (FR-006)', () => {
    const { descriptor } = buildBoundChannelListSurface(page)
    expect(descriptor.dataSource).toBe(SlackAdapterSource.ListChannels)
    expect(JSON.stringify(descriptor)).not.toMatch(/Bearer|xoxb|xoxp|token/i)
  })
})

describe('buildBoundMessageListSurface (FR-002/FR-003/FR-006)', () => {
  const page: SlackPage<SlackMessage> = { items: [MESSAGE], nextCursor: 'h2' }

  it('emits a MessageList root bound via {path} on /messages', () => {
    const { spec } = buildBoundMessageListSurface('C1', page)
    expect(spec.surfaceId).toBe(SURFACE_SLACK_HISTORY)
    const root = (spec.components as Component[])[0]
    expect(root.component).toBe('MessageList')
    expect(root.messages).toEqual({ path: SLACK_MESSAGES_PATH })
    expect(root.loading).toEqual({ path: '/loading' })
    expect(root.hasMore).toEqual({ path: '/hasMore' })
  })

  it('seeds the first page rows + flags (FR-003) with the thread coords (FR-013)', () => {
    const { dataModel } = buildBoundMessageListSurface('C1', page)
    // slack-generative-message-parity-v1 (FR-013): seed rows carry the non-secret thread
    // coords (channelId + threadTs == ts) so the seeded reply affordance is interactive.
    expect(dataModel[0]).toEqual({
      surfaceId: SURFACE_SLACK_HISTORY,
      path: SLACK_MESSAGES_PATH,
      value: [slackMessageRow(MESSAGE, 'C1')]
    })
    expect((dataModel[0].value as Record<string, unknown>[])[0]).toMatchObject({
      channelId: 'C1',
      threadTs: MESSAGE.ts
    })
    expect(dataModel.find((d) => d.path === '/hasMore')!.value).toBe(true)
  })

  it('carries the getHistory descriptor keyed on the channelId (secret-free, FR-006)', () => {
    const { descriptor } = buildBoundMessageListSurface('C1', page)
    expect(descriptor.dataSource).toBe(SlackAdapterSource.GetHistory)
    expect((descriptor.query as Record<string, unknown>).channelId).toBe('C1')
    expect(JSON.stringify(descriptor)).not.toMatch(/Bearer|xoxb|xoxp|token/i)
  })
})

describe('buildBoundSearchResultListSurface (FR-002/FR-003/FR-006)', () => {
  const page: SlackPage<SlackSearchMatch> = { items: [MATCH], nextCursor: '2' }

  it('emits a SearchResultList root bound via {path} on /matches', () => {
    const { spec } = buildBoundSearchResultListSurface('hello', page)
    expect(spec.surfaceId).toBe(SURFACE_SLACK_SEARCH)
    const root = (spec.components as Component[])[0]
    expect(root.component).toBe('SearchResultList')
    expect(root.matches).toEqual({ path: SLACK_MATCHES_PATH })
    expect(root.loading).toEqual({ path: '/loading' })
    expect(root.hasMore).toEqual({ path: '/hasMore' })
  })

  it('seeds the first page rows (FR-003)', () => {
    const { dataModel } = buildBoundSearchResultListSurface('hello', page)
    expect(dataModel[0]).toEqual({
      surfaceId: SURFACE_SLACK_SEARCH,
      path: SLACK_MATCHES_PATH,
      value: [slackSearchRow(MATCH)]
    })
  })

  it('carries the search descriptor keyed on the query (secret-free, FR-006)', () => {
    const { descriptor } = buildBoundSearchResultListSurface('hello', page)
    expect(descriptor.dataSource).toBe(SlackAdapterSource.Search)
    expect((descriptor.query as Record<string, unknown>).query).toBe('hello')
    expect(JSON.stringify(descriptor)).not.toMatch(/Bearer|xoxb|xoxp|token/i)
  })

  it('carries no literal row data in the bound spec (data lives only in the seed, FR-001)', () => {
    const { spec } = buildBoundSearchResultListSurface('hello', page)
    expect(JSON.stringify(spec)).not.toMatch(/found|general/)
  })
})
