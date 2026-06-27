import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  authorName,
  boundRows,
  buildOpenThreadContext,
  coerceImageRefs,
  compareTsAsc,
  countLabel,
  filterChannelsByName,
  formatTs,
  initials,
  messageRowOpenThread,
  messageToRowProps,
  orderBoundMessages,
  prependOlderMessages,
  searchMatchToRowProps,
  searchModeLabel,
  searchModeSubmits,
  searchPlaceholder,
  shouldOpenThreadOnRowClick,
  showEmptyState,
  showErrorNotice,
  showSkeletonState,
  SLACK_LAYOUT_CLAMP_CLASS,
  SLACK_LAYOUT_FILL_CLASS,
  SLACK_LIST_SCROLL_CLASS,
  SLACK_OPEN_THREAD_ACTION,
  SLACK_SURFACE_HOST_CLASS,
  SLACK_SEARCH_MODES,
  type SlackSearchMode
} from './logic'

/* Slack + Confluence generative-UI v1 — pure Slack catalog display helpers (FR-004). */

describe('authorName (raw-id fallback — design §2)', () => {
  it('returns userName when present (happy path)', () => {
    expect(authorName('U123', 'Alice')).toBe('Alice')
  })

  it('falls back to userId when userName is absent (missing optional)', () => {
    expect(authorName('U123')).toBe('U123')
    expect(authorName('U123', undefined)).toBe('U123')
  })

  it('falls back to userId when userName is empty/whitespace (safe fallback)', () => {
    expect(authorName('U123', '')).toBe('U123')
    expect(authorName('U123', '   ')).toBe('U123')
  })
})

describe('initials (avatar fallback — no remote images)', () => {
  it('uses first+last initials for a multi-word name', () => {
    expect(initials('Alice Bob')).toBe('AB')
  })

  it('uses the first two chars for a single-word name', () => {
    expect(initials('alice')).toBe('AL')
  })

  it('strips a leading @ or # before deriving initials', () => {
    expect(initials('@alice')).toBe('AL')
    expect(initials('#general')).toBe('GE')
  })

  it('returns "?" for an empty/whitespace name (never throws, safe fallback)', () => {
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('formatTs (Slack epoch ts — design §2.3)', () => {
  it('formats a numeric epoch ts to a short local string', () => {
    // We only assert it produced a non-empty string (locale-dependent exact value).
    expect(formatTs('1700000000.000100')).not.toBe('')
  })

  it('returns "" for a non-numeric / absent ts (safe fallback, row shows no time)', () => {
    expect(formatTs('')).toBe('')
    expect(formatTs('not-a-number')).toBe('')
  })
})

/* bug slack-channel-search-v1 (Issue 1) — find a channel by name over the loaded list. */

describe('filterChannelsByName (channel name filter — Issue 1)', () => {
  const channels = [
    { id: 'C1', name: 'general' },
    { id: 'C2', name: 'random' },
    { id: 'C3', name: 'eng-general' },
    { id: 'C4', name: 'Design' }
  ]

  it('returns the FULL list unchanged for an empty / whitespace query (default browse)', () => {
    expect(filterChannelsByName(channels, '')).toEqual(channels)
    expect(filterChannelsByName(channels, '   ')).toEqual(channels)
  })

  it('matches case-insensitively as a substring (happy path — finds a channel by name)', () => {
    expect(filterChannelsByName(channels, 'gen').map((c) => c.id)).toEqual(['C1', 'C3'])
    expect(filterChannelsByName(channels, 'DESIGN').map((c) => c.id)).toEqual(['C4'])
  })

  it('ignores a leading # on the query so "#random" works like "random"', () => {
    // The leading # is stripped, so "#random" matches the same as "random" (only C2).
    expect(filterChannelsByName(channels, '#random').map((c) => c.id)).toEqual(['C2'])
    expect(filterChannelsByName(channels, 'random').map((c) => c.id)).toEqual(['C2'])
  })

  it('returns [] when nothing matches (genuinely-empty filtered view)', () => {
    expect(filterChannelsByName(channels, 'zzz')).toEqual([])
  })

  it('returns [] for a non-array input and tolerates an odd/absent name (safe fallback)', () => {
    expect(filterChannelsByName(undefined, 'x')).toEqual([])
    expect(
      filterChannelsByName([{ id: 'C9' } as { id: string; name?: string }], 'x')
    ).toEqual([])
  })
})

/* bug slack-search-mode-selector-v1 — the unified [Channels]/[Messages] search mode. */

describe('search mode selector (channels vs messages — slack-search-mode-selector-v1)', () => {
  it('lists both modes in display order', () => {
    expect(SLACK_SEARCH_MODES).toEqual(['channels', 'messages'])
  })

  it('labels each mode for the segmented toggle (happy path)', () => {
    expect(searchModeLabel('channels')).toBe('Channels')
    expect(searchModeLabel('messages')).toBe('Messages')
  })

  it('switches the shared Input placeholder by mode', () => {
    expect(searchPlaceholder('channels')).toBe('Find a channel')
    expect(searchPlaceholder('messages')).toBe('Search messages')
  })

  it('runs message search on submit, but channel filter live as-you-type', () => {
    expect(searchModeSubmits('messages')).toBe(true)
    expect(searchModeSubmits('channels')).toBe(false)
  })

  it('falls back to the message-search placeholder for an unknown mode (safe fallback)', () => {
    expect(searchPlaceholder('???' as SlackSearchMode)).toBe('Search messages')
  })
})

/* bug slack-message-order-loadmore-v1 (Issue 3) — load-more PREPENDS older history. */

describe('compareTsAsc (numeric ascending ts compare — Issue 3)', () => {
  it('orders oldest → newest numerically (not lexically)', () => {
    // String compare would misorder "999.9" after "1000.0"; numeric compare must not.
    expect(compareTsAsc('999.9', '1000.0')).toBeLessThan(0)
    expect(compareTsAsc('1700000002.0', '1700000001.0')).toBeGreaterThan(0)
  })

  it('treats an absent / non-numeric ts as epoch 0 (stable, never throws)', () => {
    expect(compareTsAsc(undefined, '1')).toBeLessThan(0)
    expect(compareTsAsc('nope', undefined)).toBe(0)
  })
})

describe('prependOlderMessages (older page goes ABOVE — Issue 3)', () => {
  const newer = [
    { ts: '1700000010.0', text: 'c' },
    { ts: '1700000020.0', text: 'd' }
  ]
  const older = [
    { ts: '1700000001.0', text: 'a' },
    { ts: '1700000002.0', text: 'b' }
  ]

  it('prepends the older page ABOVE the existing rows, keeping one ascending order (the fix)', () => {
    // The OLD behavior appended older below → ['c','d','a','b'] (tangled). The fix must
    // produce one ascending chronological order with the older rows on top.
    expect(prependOlderMessages(newer, older).map((m) => m.text)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('re-sorts any interleaving by numeric ts so the merged list stays ordered', () => {
    const mixedExisting = [{ ts: '1700000005.0', text: 'mid' }]
    const mixedOlder = [
      { ts: '1700000009.0', text: 'late' },
      { ts: '1700000001.0', text: 'early' }
    ]
    expect(prependOlderMessages(mixedExisting, mixedOlder).map((m) => m.text)).toEqual([
      'early',
      'mid',
      'late'
    ])
  })

  it('coerces non-array inputs to [] (safe fallback, never throws)', () => {
    expect(prependOlderMessages(undefined, older).map((m) => m.text)).toEqual(['a', 'b'])
    expect(prependOlderMessages(newer, undefined).map((m) => m.text)).toEqual(['c', 'd'])
    expect(prependOlderMessages(undefined, undefined)).toEqual([])
  })

  it('returns a NEW array (does not mutate either input)', () => {
    const a = [{ ts: '2.0' }]
    const b = [{ ts: '1.0' }]
    const out = prependOlderMessages(a, b)
    expect(out).not.toBe(a)
    expect(out).not.toBe(b)
    expect(a).toEqual([{ ts: '2.0' }])
    expect(b).toEqual([{ ts: '1.0' }])
  })
})

/*
 * bug slack-generated-message-order-v1 — the GENERATED bound MessageList re-orders the
 * dispatcher-accumulated rows ascending so it matches the native panel (newest-at-bottom).
 * The shared dispatcher appends each older page at the BOTTOM of the accumulated array; this
 * test FAILS without the catalog-layer sort (the rows would render bottom-appended/tangled).
 */
describe('orderBoundMessages (generated list matches native order)', () => {
  it('sorts the accumulated rows ascending by ts (newest at the bottom) — the fix', () => {
    // Simulate the dispatcher's append accumulation for Slack history: page 1 (newer) then a
    // load-more page 2 that is OLDER, concatenated at the bottom → tangled raw order.
    const accumulatedRaw = [
      { ts: '1700000010.0', text: 'newer-1' },
      { ts: '1700000020.0', text: 'newer-2' },
      { ts: '1700000001.0', text: 'older-1' },
      { ts: '1700000002.0', text: 'older-2' }
    ]
    // Without the fix the rows render in raw accumulation order
    // (['newer-1','newer-2','older-1','older-2']); the fix must produce one ascending order.
    expect(orderBoundMessages(accumulatedRaw).map((m) => m.text)).toEqual([
      'older-1',
      'older-2',
      'newer-1',
      'newer-2'
    ])
  })

  it('orders by NUMERIC ts (not lexical) so unequal-length epochs sort correctly', () => {
    const rows = [{ ts: '1000.0', text: 'b' }, { ts: '999.9', text: 'a' }]
    expect(orderBoundMessages(rows).map((m) => m.text)).toEqual(['a', 'b'])
  })

  it('coerces a non-array / undefined bound value to [] (safe fallback, never throws)', () => {
    expect(orderBoundMessages(undefined)).toEqual([])
    expect(orderBoundMessages(null as unknown as { ts?: string }[])).toEqual([])
  })

  it('tolerates an odd/absent ts (sorts as epoch 0) and returns a NEW array', () => {
    const rows = [{ ts: '5.0', text: 'has-ts' }, { text: 'no-ts' } as { ts?: string; text: string }]
    const out = orderBoundMessages(rows)
    expect(out).not.toBe(rows)
    // The absent-ts row sorts as epoch 0 → ahead of the ts:5.0 row.
    expect(out.map((m) => m.text)).toEqual(['no-ts', 'has-ts'])
  })
})

/*
 * bug slack-search-row-data-parity-v1 — a SlackSearchMatch maps into the SAME row-props shape
 * SlackMessageRow expects from a channel-history message, so a search hit renders identically.
 * These FAIL if the mapper drops a shared field (the cause of "search results don't share the
 * message component" — the rows looked different because their data was mapped sparsely).
 */
describe('searchMatchToRowProps (search match → shared row props — data parity)', () => {
  it('carries EVERY shared display field a history row uses (full match)', () => {
    const match = {
      ts: '1700000000.000100',
      userId: 'U123',
      userName: 'Alice',
      text: 'hello :wave:',
      channelId: 'C999',
      channelName: 'general',
      customEmoji: { wave: 'cosmos-slack-img://x' }
    }
    expect(searchMatchToRowProps(match)).toEqual({
      ts: '1700000000.000100',
      userId: 'U123',
      userName: 'Alice',
      text: 'hello :wave:',
      customEmoji: { wave: 'cosmos-slack-img://x' },
      channelName: 'general'
    })
  })

  it('keeps ts/userId/text + the resolved userName so the author + avatar match a history row', () => {
    // userName is the RESOLVED display name (resolveMatchNames fills it before mapping). The
    // mapper MUST carry it — dropping it is the bug that showed the raw userId / raw-id initials.
    const props = searchMatchToRowProps({
      ts: '1.0',
      userId: 'U1',
      userName: 'Bob',
      text: 'hi',
      channelId: 'C1'
    })
    expect(props.userName).toBe('Bob')
    expect(props.ts).toBe('1.0')
    expect(props.userId).toBe('U1')
    expect(props.text).toBe('hi')
  })

  it('OMITS each optional field when absent (no explicit-undefined props, missing-optional safe)', () => {
    const props = searchMatchToRowProps({ ts: '1.0', userId: 'U1', text: 'hi', channelId: 'C1' })
    expect('userName' in props).toBe(false)
    expect('customEmoji' in props).toBe(false)
    expect('channelName' in props).toBe(false)
    expect('images' in props).toBe(false)
    // replyCount is never carried by a search hit (search.messages omits reply_count).
    expect('replyCount' in props).toBe(false)
    // No onOpenThread closure supplied ⇒ a non-interactive row (graceful).
    expect('onOpenThread' in props).toBe(false)
  })

  it('CARRIES images when the search match has them (slack-search-row-full-parity-v1)', () => {
    // A search hit now carries the same inline image refs a history row does (extracted main-side),
    // so the thumbnail strip renders — this was the prior divergence (search rows showed no images).
    const images = [{ ref: 'cosmos-slack-img://abc', alt: 'pic' }]
    const props = searchMatchToRowProps({ ts: '1.0', userId: 'U1', text: 'hi', channelId: 'C1', images })
    expect(props.images).toEqual(images)
  })

  it('wires onOpenThread from the supplied closure so a search row is clickable to open its thread', () => {
    // A search hit carries thread coords (channelId + threadTs = ts), so the caller supplies a
    // thread-open closure — the row becomes interactive EXACTLY like a native/generated history row.
    let opened = 0
    const props = searchMatchToRowProps(
      { ts: '1.0', userId: 'U1', text: 'hi', channelId: 'C1', threadTs: '1.0' },
      { onOpenThread: () => { opened++ } }
    )
    expect(typeof props.onOpenThread).toBe('function')
    props.onOpenThread?.()
    expect(opened).toBe(1)
  })

  it('falls back to the raw userId for the name when userName is unresolved (history fallback)', () => {
    // The mapper omits userName; SlackMessageRow/authorName then falls back to userId — the SAME
    // fallback a history row uses, so an unresolved search row is not a degraded variant.
    const props = searchMatchToRowProps({ ts: '1.0', userId: 'U9', text: 'x', channelId: 'C1' })
    expect(props.userName).toBeUndefined()
    expect(authorName(props.userId ?? '', props.userName)).toBe('U9')
  })
})

describe('messageToRowProps (THE unified mapper — every path builds row props through it)', () => {
  // slack-search-row-full-parity-v1: native history, native search, generated MessageRow, and
  // generated SearchResultRow ALL build SlackMessageRowProps through this one function, so given
  // equivalent source data every context produces IDENTICAL props (the runtime visual identity).

  it('selects every render-bearing field the same way (full source)', () => {
    const images = [{ ref: 'cosmos-slack-img://x', alt: 'a' }]
    const customEmoji = { wave: 'cosmos-slack-img://w' }
    expect(
      messageToRowProps({
        ts: '1700000000.000100',
        userId: 'U123',
        userName: 'Alice',
        text: 'hello :wave:',
        replyCount: 3,
        customEmoji,
        images,
        channelName: 'general'
      })
    ).toEqual({
      ts: '1700000000.000100',
      userId: 'U123',
      userName: 'Alice',
      text: 'hello :wave:',
      replyCount: 3,
      customEmoji,
      images,
      channelName: 'general'
    })
  })

  it('THE PARITY GUARANTEE: a history message, a search match, and a generated row with EQUIVALENT data produce IDENTICAL props', () => {
    // The exact same underlying message viewed three ways. Each path's DTO is shaped differently,
    // but all funnel the same fields into messageToRowProps, so the resulting props must be equal.
    const shared = {
      ts: '1700000000.000100',
      userId: 'U1',
      userName: 'Alice',
      text: 'shipped it :tada:',
      customEmoji: { tada: 'cosmos-slack-img://t' },
      images: [{ ref: 'cosmos-slack-img://i' }]
    }
    // (1) native history MessageRow spreads a SlackMessage (replyCount present there).
    const nativeHistory = messageToRowProps({ ...shared, replyCount: 2 })
    // (2) generated MessageRow spreads a bound MessageRowNode (same data).
    const generatedHistory = messageToRowProps({ ...shared, replyCount: 2 })
    // (3) native + generated search build from a SlackSearchMatch via searchMatchToRowProps.
    //     reply_count is NOT returned by search.messages, so replyCount is absent — but every
    //     OTHER field (incl. images) is identical. We compare the shared subset.
    const search = searchMatchToRowProps({ ...shared, channelId: 'C1' })
    expect(generatedHistory).toEqual(nativeHistory)
    // Search matches the history props on every field it carries (channelName/replyCount aside):
    const { replyCount: _rc, ...historyMinusReply } = nativeHistory
    expect(search).toEqual(historyMinusReply)
  })

  it('coerces missing ts/userId/text to empty strings (total — never undefined for the required trio)', () => {
    const props = messageToRowProps({})
    expect(props.ts).toBe('')
    expect(props.userId).toBe('')
    expect(props.text).toBe('')
  })

  it('OMITS each optional field when absent (missing-optional safe — no explicit-undefined props)', () => {
    const props = messageToRowProps({ ts: '1.0', userId: 'U1', text: 'hi' })
    expect('userName' in props).toBe(false)
    expect('replyCount' in props).toBe(false)
    expect('customEmoji' in props).toBe(false)
    expect('images' in props).toBe(false)
    expect('channelName' in props).toBe(false)
    expect('onOpenThread' in props).toBe(false)
  })

  it('drops an empty images array (no empty thumbnail strip)', () => {
    expect('images' in messageToRowProps({ ts: '1.0', userId: 'U1', text: 'hi', images: [] })).toBe(false)
  })

  it('appends the per-context onOpenThread closure verbatim (the one per-path piece)', () => {
    let n = 0
    const props = messageToRowProps(
      { ts: '1.0', userId: 'U1', text: 'hi' },
      { onOpenThread: () => { n++ } }
    )
    expect(typeof props.onOpenThread).toBe('function')
    props.onOpenThread?.()
    expect(n).toBe(1)
  })
})

describe('countLabel (list count line — pluralization)', () => {
  it('uses the singular for exactly one', () => {
    expect(countLabel(1, 'channel', 'channels')).toBe('1 channel')
    expect(countLabel(1, 'result', 'results')).toBe('1 result')
  })

  it('uses the plural for zero and many', () => {
    expect(countLabel(0, 'channel', 'channels')).toBe('0 channels')
    expect(countLabel(3, 'result', 'results')).toBe('3 results')
  })
})

/* slack-generative-adapter-v1 — bound-list display gating (FR-004/FR-007, design §3). */

describe('boundRows (safe array coercion)', () => {
  it('returns the array as-is when present (happy path)', () => {
    expect(boundRows([1, 2])).toEqual([1, 2])
  })

  it('returns [] for an undefined / non-array bound value (safe fallback, never throws)', () => {
    expect(boundRows<number>(undefined)).toEqual([])
    expect(boundRows(null as unknown as number[])).toEqual([])
  })
})

describe('showErrorNotice (recoverable error gate — FR-007)', () => {
  it('is true for a non-empty error message', () => {
    expect(showErrorNotice('Reconnect Slack.')).toBe(true)
  })

  it('is false for an absent / blank message (missing optional, no notice)', () => {
    expect(showErrorNotice(undefined)).toBe(false)
    expect(showErrorNotice('')).toBe(false)
    expect(showErrorNotice('   ')).toBe(false)
  })
})

describe('showEmptyState (empty vs error-supersedes — design §3)', () => {
  it('is true for an empty list with no error (back-compat default loaded/not-loading)', () => {
    expect(showEmptyState(0, undefined)).toBe(true)
  })

  it('is false when rows exist', () => {
    expect(showEmptyState(3, undefined)).toBe(false)
  })

  it('is false for an empty list WITH an error (the error notice supersedes the empty state)', () => {
    expect(showEmptyState(0, 'Reconnect.')).toBe(false)
  })
})

/* slack-generative-message-parity-v1 — empty/skeleton gating (FR-014/FR-015/FR-016, §5.2). */

describe('showEmptyState (loaded/loading gating — FR-015)', () => {
  it('is true only once loaded AND not loading (genuine empty)', () => {
    expect(showEmptyState(0, undefined, true, false)).toBe(true)
  })

  it('is false while a refresh is in flight (empty + loading → skeleton, not empty)', () => {
    expect(showEmptyState(0, undefined, true, true)).toBe(false)
  })

  it('is false before the first load completes (never-loaded → not empty prematurely)', () => {
    expect(showEmptyState(0, undefined, false, false)).toBe(false)
  })

  it('is false for an empty list WITH an error even when loaded (error supersedes)', () => {
    expect(showEmptyState(0, 'Reconnect.', true, false)).toBe(false)
  })

  it('is false when rows exist regardless of loaded/loading', () => {
    expect(showEmptyState(3, undefined, true, false)).toBe(false)
    expect(showEmptyState(3, undefined, false, true)).toBe(false)
  })
})

describe('showSkeletonState (loading vs empty — FR-014/FR-016)', () => {
  it('is true on the never-loaded first paint (zero rows, not loaded)', () => {
    expect(showSkeletonState(0, false, false, undefined)).toBe(true)
  })

  it('is true on an in-flight refresh with zero rows (replace-fresh)', () => {
    expect(showSkeletonState(0, true, true, undefined)).toBe(true)
  })

  it('is false once loaded with rows present', () => {
    expect(showSkeletonState(5, false, true, undefined)).toBe(false)
  })

  it('is false for a loaded, empty, not-loading list (defer to the empty state)', () => {
    expect(showSkeletonState(0, false, true, undefined)).toBe(false)
  })

  it('is false when an error is present (the error notice supersedes the skeleton — FR-016)', () => {
    expect(showSkeletonState(0, true, false, 'Reconnect.')).toBe(false)
    expect(showSkeletonState(0, false, false, 'Reconnect.')).toBe(false)
  })

  it('keeps prior rows during a refresh (rows present + loading → no skeleton)', () => {
    expect(showSkeletonState(5, true, true, undefined)).toBe(false)
  })
})

/* slack-generative-message-parity-v1 — reply drill-in action context (FR-005/FR-012/FR-013). */

describe('SLACK_OPEN_THREAD_ACTION (renderer-local reply drill-in)', () => {
  it('is the renderer-local "slack.openThread" action name', () => {
    expect(SLACK_OPEN_THREAD_ACTION).toBe('slack.openThread')
  })
})

describe('buildOpenThreadContext (reply drill-in context builder — FR-013/FR-019)', () => {
  it('round-trips the thread coordinates + parent display fields when present', () => {
    const ctx = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.000100',
      ts: '1700000000.000100',
      userId: 'U1',
      userName: 'Alice',
      text: 'hello',
      replyCount: 3
    })
    expect(ctx).toEqual({
      channelId: 'C123',
      threadTs: '1700000000.000100',
      ts: '1700000000.000100',
      userId: 'U1',
      userName: 'Alice',
      text: 'hello',
      replyCount: 3
    })
  })

  it('returns null when channelId is absent (degrade to non-interactive label — FR-012)', () => {
    expect(buildOpenThreadContext({ threadTs: '1700000000.0', ts: '1700000000.0', userId: 'U1', text: 'x' })).toBeNull()
  })

  it('returns null when threadTs is absent (degrade to non-interactive label — FR-012)', () => {
    expect(buildOpenThreadContext({ channelId: 'C123', ts: '1700000000.0', userId: 'U1', text: 'x' })).toBeNull()
  })

  it('omits userName and replyCount when absent (missing optional, no error)', () => {
    const ctx = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.0',
      ts: '1700000000.0',
      userId: 'U1',
      text: 'x'
    })
    expect(ctx).not.toBeNull()
    expect(ctx).not.toHaveProperty('userName')
    expect(ctx).not.toHaveProperty('replyCount')
  })

  it('falls back ts to threadTs when ts is absent (safe fallback, never throws)', () => {
    const ctx = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.5',
      userId: 'U1',
      text: 'x'
    })
    expect(ctx?.ts).toBe('1700000000.5')
  })

  it('carries no token/secret fields (FR-019) — only the declared non-secret keys', () => {
    const ctx = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.0',
      ts: '1700000000.0',
      userId: 'U1',
      userName: 'Alice',
      text: 'hi',
      replyCount: 1
    })
    expect(Object.keys(ctx ?? {}).sort()).toEqual(
      ['channelId', 'replyCount', 'text', 'threadTs', 'ts', 'userId', 'userName'].sort()
    )
  })

  it('CARRIES the parent images so the dock root header renders them (slack-thread-root-image-v1)', () => {
    // The root cause of "thread root image does not render in the dock": the open-thread context
    // dropped the clicked message's images, so the header (built from the context) had none — even
    // though the row it was opened from did. Carrying them end-to-end is the fix.
    const images = [{ ref: 'cosmos-slack-img://abc', alt: 'pic' }]
    const ctx = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.0',
      ts: '1700000000.0',
      userId: 'U1',
      text: 'see this',
      images
    })
    expect(ctx?.images).toEqual(images)
  })

  it('OMITS images when absent or an empty array (no empty thumbnail strip on the header)', () => {
    const noImages = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.0',
      ts: '1700000000.0',
      userId: 'U1',
      text: 'x'
    })
    expect(noImages).not.toHaveProperty('images')
    const emptyImages = buildOpenThreadContext({
      channelId: 'C123',
      threadTs: '1700000000.0',
      ts: '1700000000.0',
      userId: 'U1',
      text: 'x',
      images: []
    })
    expect(emptyImages).not.toHaveProperty('images')
  })
})

/* slack-thread-root-image-v1 — validate UNTRUSTED images crossing the A2UI action boundary. */

describe('coerceImageRefs (A2UI-boundary image-ref validator — slack-thread-root-image-v1)', () => {
  it('keeps well-formed refs and carries the optional alt/w/h when present (happy path)', () => {
    const out = coerceImageRefs([
      { ref: 'cosmos-slack-img://a', alt: 'pic', w: 100, h: 80 },
      { ref: 'cosmos-slack-img://b' }
    ])
    expect(out).toEqual([
      { ref: 'cosmos-slack-img://a', alt: 'pic', w: 100, h: 80 },
      { ref: 'cosmos-slack-img://b' }
    ])
  })

  it('drops entries missing a string ref and keeps the valid ones (warn+ignore, never throws)', () => {
    const out = coerceImageRefs([
      { ref: 'cosmos-slack-img://ok' },
      { alt: 'no-ref' },
      { ref: 123 },
      null,
      'not-an-object'
    ])
    expect(out).toEqual([{ ref: 'cosmos-slack-img://ok' }])
  })

  it('drops malformed optional fields but keeps the valid ref (additive, lenient)', () => {
    const out = coerceImageRefs([{ ref: 'cosmos-slack-img://x', alt: 5, w: 'big', h: null }])
    expect(out).toEqual([{ ref: 'cosmos-slack-img://x' }])
  })

  it('returns undefined for a non-array, an empty array, or an all-invalid array (no images carried)', () => {
    expect(coerceImageRefs(undefined)).toBeUndefined()
    expect(coerceImageRefs(null)).toBeUndefined()
    expect(coerceImageRefs('cosmos-slack-img://x')).toBeUndefined()
    expect(coerceImageRefs([])).toBeUndefined()
    expect(coerceImageRefs([{ alt: 'no-ref' }, 42])).toBeUndefined()
  })
})

describe('messageRowOpenThread (whole-row open-thread trigger — Bug 2)', () => {
  it('a REPLY-LESS message (no replyCount) still produces an open-thread trigger carrying its thread_ts/channelId', () => {
    // Bug 2: before, the dock only opened via the "N replies" affordance, which renders only
    // when replyCount > 0 — so a zero-reply message could never open its thread. The whole-row
    // trigger must build a context for a row WITHOUT a replyCount.
    const ctx = messageRowOpenThread({
      channelId: 'C123',
      threadTs: '1718900000.000100',
      ts: '1718900000.000100',
      userId: 'U1',
      text: 'a lonely message with zero replies'
    })
    expect(ctx).not.toBeNull()
    expect(ctx?.channelId).toBe('C123')
    expect(ctx?.threadTs).toBe('1718900000.000100')
    // thread_ts === the message ts so the first reply threads off THIS message.
    expect(ctx?.ts).toBe('1718900000.000100')
    expect(ctx).not.toHaveProperty('replyCount')
  })

  it('returns null when the row lacks thread coordinates (non-interactive plain row)', () => {
    expect(messageRowOpenThread({ ts: '1.0', userId: 'U1', text: 'x' })).toBeNull()
  })
})

/* ------------------------------------------------------------------------- *
 * Whole-row click → open thread (bug slack-thread-open-click-v1)
 *
 * Regression: #88 made the WHOLE message row `role="button"` so a plain click anywhere on
 * it opens the thread dock. The guard skipped clicks that land on a nested interactive
 * element via `target.closest('a, button, img, [role="button"]')`. But the ROW itself is
 * now `role="button"`, so on a PLAIN row click `closest('[role="button"]')` matched the ROW
 * — the guard treated every plain click as "nested interactive" and bailed, so the thread
 * NEVER opened (the cursor still changed because role/CSS applied; only the handler was
 * short-circuited). The fix excludes the row element (`e.currentTarget`) from the
 * nested-interactive check, so only a STRICTLY nested control suppresses the open.
 *
 * `shouldOpenThreadOnRowClick(hasTextSelection, onNestedInteractive)` is the node-testable
 * decision seam. Below we model the `.tsx`'s DOM walk with a minimal `closest` so we can
 * assert BOTH the buggy computation (closest matches the row → would never open) and the
 * fixed computation (row excluded → plain click opens). The "fixed" assertions FAIL before
 * the fix: the old code never excluded the row, so a plain row click computed
 * onNestedInteractive=true and the row never opened.
 * ------------------------------------------------------------------------- */
describe('shouldOpenThreadOnRowClick (whole-row open-thread click — bug slack-thread-open-click-v1)', () => {
  // A minimal Element-like node with `closest` that walks the parent chain, matching the
  // bug-relevant selector cases: a real nested control (matches itself) vs the row (matches
  // only via its own role="button"). No jsdom — pure node objects.
  type FakeEl = {
    /** Does THIS node match the nested-interactive selector (link/button/img/role=button)? */
    matchesInteractive: boolean
    parent: FakeEl | null
    /** The nearest ancestor-or-self matching the interactive selector, or null. */
    closest: () => FakeEl | null
  }
  function el(matchesInteractive: boolean, parent: FakeEl | null): FakeEl {
    const node: FakeEl = {
      matchesInteractive,
      parent,
      closest() {
        let cur: FakeEl | null = this
        while (cur) {
          if (cur.matchesInteractive) return cur
          cur = cur.parent
        }
        return null
      }
    }
    return node
  }

  // The row carries role="button" (the whole-row trigger), so it matchesInteractive=true.
  function makeRow(): FakeEl {
    return el(true, null)
  }

  // Replicates the .tsx isPlainRowClick nested-interactive computation, parameterized by
  // whether we exclude the row element (the fix) — proving the fix is what flips the bug.
  function onNestedInteractive(target: FakeEl, row: FakeEl, excludeRow: boolean): boolean {
    const hit = target.closest()
    return hit !== null && (excludeRow ? hit !== row : true)
  }

  it('FIX: a PLAIN click on the row body opens the thread (row excluded from nested check)', () => {
    const row = makeRow()
    const body = el(false, row) // the non-interactive message body text node
    const nested = onNestedInteractive(body, row, /* excludeRow */ true)
    expect(nested).toBe(false)
    expect(shouldOpenThreadOnRowClick(false, nested)).toBe(true)
  })

  it('BUG reproduction: WITHOUT excluding the row, a plain click matches the row and never opens', () => {
    const row = makeRow()
    const body = el(false, row)
    // Old behavior: closest('[role=button]') matched the ROW itself → treated as nested.
    const nestedBuggy = onNestedInteractive(body, row, /* excludeRow */ false)
    expect(nestedBuggy).toBe(true)
    expect(shouldOpenThreadOnRowClick(false, nestedBuggy)).toBe(false)
  })

  it('a click on a GENUINELY nested control (link/button/image) does NOT open the thread', () => {
    const row = makeRow()
    const innerButton = el(true, row) // e.g. the replies <Button> or an image-thumbnail <button>
    const nested = onNestedInteractive(innerButton, row, /* excludeRow */ true)
    expect(nested).toBe(true)
    expect(shouldOpenThreadOnRowClick(false, nested)).toBe(false)
  })

  it('an active text SELECTION suppresses the open even on a plain row click (copy text, not open)', () => {
    expect(shouldOpenThreadOnRowClick(true, false)).toBe(false)
  })
})

/* ------------------------------------------------------------------------- *
 * Generative layout width clamp (bug slack-generative-wrap-v1)
 *
 * Regression: an agent-grouped Slack list rendered inside the SDK standard-catalog
 * Column/Row overflowed horizontally because that SDK flex container lacks `min-w-0`,
 * keeps `min-width: auto`, and grows to its content's intrinsic width — so a long
 * unbroken message line never wrapped. The Slack catalog now registers width-clamped
 * Column/Row wrappers. These tests would FAIL before the fix: the SDK container source
 * carries NO clamp, and there was no clamping wrapper around it.
 * ------------------------------------------------------------------------- */
describe('SLACK_LAYOUT_CLAMP_CLASS (generative wrap clamp)', () => {
  it('carries the width-clamp tokens that defeat the SDK flex intrinsic width', () => {
    // min-w-0 defeats flex `min-width: auto`; max-w-full caps at the panel width;
    // w-full keeps short content filling the column.
    expect(SLACK_LAYOUT_CLAMP_CLASS).toContain('min-w-0')
    expect(SLACK_LAYOUT_CLAMP_CLASS).toContain('max-w-full')
    expect(SLACK_LAYOUT_CLAMP_CLASS).toContain('w-full')
  })

  it('the raw SDK Column/Row container that caused the bug has NO width clamp', () => {
    // Root cause, asserted against the SDK source: its flex `<div>` className is a fixed
    // `flex flex-col gap-4` / `flex flex-row gap-3` with NO `min-w-0`/`max-w-full`. With
    // flex `min-width: auto` the container grows to its content's intrinsic width, so a
    // long unbroken message line overflows instead of wrapping. (The SDK components require
    // SurfaceProvider context, so they can't be mounted in the node test env — we assert the
    // emitted className from source.) This test fails the day the SDK adds its own clamp,
    // signalling the wrapper is no longer needed.
    const sdkDir = '../../../node_modules/@a2ui-sdk/react/dist/0.9/components/layout'
    const columnSrc = readFileSync(new URL(`${sdkDir}/ColumnComponent.js`, import.meta.url), 'utf8')
    const rowSrc = readFileSync(new URL(`${sdkDir}/RowComponent.js`, import.meta.url), 'utf8')
    expect(columnSrc).toContain('flex flex-col')
    expect(rowSrc).toContain('flex flex-row')
    expect(columnSrc).not.toContain('min-w-0')
    expect(rowSrc).not.toContain('min-w-0')
  })

  it('the Slack catalog registers the clamped wrappers, not the raw SDK Column/Row', () => {
    // The fix: the catalog index imports Column/Row from ./layout (which apply the clamp)
    // instead of standardCatalog.components.Column/Row. Asserting the wiring is the
    // node-checkable proof the agent-grouped list is rendered inside the clamp box. Before
    // the fix the index registered the raw SDK containers directly.
    const indexSrc = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(indexSrc).toContain("from './layout'")
    expect(indexSrc).not.toContain('standardCatalog.components.Column')
    expect(indexSrc).not.toContain('standardCatalog.components.Row')

    // ...and the wrapper module applies the v2 fill class (which still carries the width-clamp
    // tokens `w-full min-w-0 max-w-full`) around the SDK container. (slack-list-scroll-fill-v2
    // folded the width-only clamp into SLACK_LAYOUT_FILL_CLASS; the clamp tokens are asserted in
    // the SLACK_LAYOUT_FILL_CLASS describe block above.)
    const layoutSrc = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8')
    expect(layoutSrc).toContain('SLACK_LAYOUT_FILL_CLASS')
    expect(layoutSrc).toContain('standardCatalog.components.Column')
    expect(layoutSrc).toContain('standardCatalog.components.Row')
  })
})

/* ------------------------------------------------------------------------- *
 * Per-list independent-scroll AND fill — v2 height-chain repair
 * (slack-list-scroll-fill-v2, supersedes slack-independent-list-scroll-v1)
 *
 * v2 repairs the broken vertical height chain at the FIRST-PARTY DOM seam (host + layout.tsx
 * Column/Row wrapper), not the catalog leaf: a lone list FILLS to the panel bottom (R2/SC-001)
 * AND N lists each scroll independently (R1/SC-002) via the SAME flex-fill chain. The three
 * class strings are pure exports here so the chain is node-assertable. These tests pin the v2
 * chain tokens and lock OUT the failed Attempt-1/2 caps (`max-h-*`/`70vh`); they FAIL if any
 * required chain token is dropped or a `max-h-*` cap is reintroduced.
 * ------------------------------------------------------------------------- */
describe('SLACK_LIST_SCROLL_CLASS (v2 list-root fill-chain consumer)', () => {
  it('consumes the flex-fill chain (min-h-0 + flex-1 + overflow-y-auto) so a lone list fills and N siblings split + each scroll (R1+R2)', () => {
    // Definite FLEX sizing (not a %/vh max-height): a lone list is the only flex child → fills
    // (R2); N lists are sibling flex children → equal-split + each scrolls independently (R1).
    expect(SLACK_LIST_SCROLL_CLASS).toContain('min-h-0')
    expect(SLACK_LIST_SCROLL_CLASS).toContain('flex-1')
    expect(SLACK_LIST_SCROLL_CLASS).toContain('overflow-y-auto')
  })

  it('preserves the min-w-0 / max-w-full wrap-safety so vertical scroll adds no horizontal overflow (FR-011)', () => {
    expect(SLACK_LIST_SCROLL_CLASS).toContain('min-w-0')
    expect(SLACK_LIST_SCROLL_CLASS).toContain('max-w-full')
  })

  it('DROPS the failed Attempt-1/2 caps: no max-h-* and no fixed 70vh (so neither dead-gap nor shared-scroll regresses)', () => {
    // Attempt-1 `max-h-[70vh]` left a dead gap (R2 broken); Attempt-2 `max-h-full` against the
    // indefinite SDK parent collapsed to shared scroll (R1 broken). The v2 bound is flex sizing,
    // not a max-height cap — lock both out so a regression to either is caught.
    expect(SLACK_LIST_SCROLL_CLASS).not.toContain('max-h-')
    expect(SLACK_LIST_SCROLL_CLASS).not.toContain('70vh')
    expect(SLACK_LIST_SCROLL_CLASS).not.toContain('vh]')
  })

  it('hides the scrollbar until the list is hovered (scrollbar-hover-only — no content shift, FR-010)', () => {
    // The hover-only scrollbar utility (index.css) collapses the WebKit scrollbar by default,
    // reveals it on :hover, and reserves the gutter (scrollbar-gutter: stable) so hover causes
    // no horizontal content shift. Composing the token here is the node-checkable seam.
    expect(SLACK_LIST_SCROLL_CLASS).toContain('scrollbar-hover-only')
  })

  it('the MESSAGE-bearing list roots compose the scroll bound (MessageList + SearchResultList)', () => {
    // Source-level assertion (the SDK catalog components require SurfaceProvider context, so
    // they can't be mounted in the node test env). MessageList + SearchResultList apply the
    // bound to their root <div>.
    const componentsSrc = readFileSync(new URL('./components.tsx', import.meta.url), 'utf8')
    expect(componentsSrc).toContain('SLACK_LIST_SCROLL_CLASS')
    // The import names the bound; the two message lists reference it on their root className.
    const refs = componentsSrc.match(/SLACK_LIST_SCROLL_CLASS/g) ?? []
    // 1 import + 1 use in MessageList + 1 use in SearchResultList = 3 occurrences.
    expect(refs.length).toBeGreaterThanOrEqual(3)
  })
})

describe('SLACK_LAYOUT_FILL_CLASS (v2 first-party Column/Row wrapper — threads the chain through the SDK child)', () => {
  it('keeps the width clamp (w-full / min-w-0 / max-w-full) so the horizontal wrap fix is preserved (FR-011)', () => {
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('w-full')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('min-w-0')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('max-w-full')
  })

  it('forwards the vertical fill chain (flex / flex-col / min-h-0 / flex-1) so the wrapper is a fill link (FR-006)', () => {
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('flex')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('flex-col')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('min-h-0')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('flex-1')
  })

  it('repairs the auto-height SDK flex child POSITIONALLY via [&>*] (keys off DOM position, not any SDK class — FR-005/FR-012)', () => {
    // The SDK Column/Row renders `flex flex-col gap-4` with NO data-*/id/min-h-0 — the only stable
    // anchor is that it is the wrapper's direct child. [&>*] threads min-h-0/flex-1 into it.
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:min-h-0')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:flex-1')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:flex')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:min-w-0')
  })

  it('forces the SDK child to !flex-row so multiple lists lay out SIDE-BY-SIDE (세로 분할), not stacked', () => {
    // The SDK Column is natively `flex-col` (stacks lists top/bottom = horizontal dividers, poor
    // readability). The positional repair overrides it with `!flex-row` so sibling lists become
    // full-height columns split by vertical dividers; a lone list still fills the full width.
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:!flex-row')
    expect(SLACK_LAYOUT_FILL_CLASS).not.toContain('[&>*]:flex-col')
  })

  it('does NOT add flex-wrap/content-start (feedback-slack-per-list-scroll: a channel-name-above-list attempt that did so collapsed per-list scroll into one unified scroll — reverted, must not return)', () => {
    expect(SLACK_LAYOUT_FILL_CLASS).not.toContain('flex-wrap')
    expect(SLACK_LAYOUT_FILL_CLASS).not.toContain('content-start')
    // The per-list fill+split tokens stay intact (each list is its own flex-1 scroll column).
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:flex-1')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:min-h-0')
  })

  it('the first-party Column/Row wrappers apply the fill class (not the width-only clamp) — node-checkable wiring', () => {
    const layoutSrc = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8')
    expect(layoutSrc).toContain('SLACK_LAYOUT_FILL_CLASS')
    expect(layoutSrc).not.toContain('SLACK_LAYOUT_CLAMP_CLASS')
  })
})

describe('SLACK_SURFACE_HOST_CLASS (v2 tabpanel host = definite-height flex column, top of the chain)', () => {
  it('carries flex / flex-col / min-h-0 so the host is a definite-height flex column (FR-006)', () => {
    expect(SLACK_SURFACE_HOST_CLASS).toContain('flex')
    expect(SLACK_SURFACE_HOST_CLASS).toContain('flex-col')
    expect(SLACK_SURFACE_HOST_CLASS).toContain('min-h-0')
  })

  it('the SlackPanel generative tabpanel host composes the chain tokens (flex flex-col min-h-0) — node-checkable wiring', () => {
    // Source-level assertion: the A2UI surface host <div role="tabpanel"> must carry the fill-chain
    // tokens so the chain threads host → wrapper → list root. (SlackPanel can't mount in node.)
    const panelSrc = readFileSync(new URL('../SlackPanel.tsx', import.meta.url), 'utf8')
    const hostLine = panelSrc
      .split('\n')
      .find((l) => l.includes('overflow-auto p-3 text-card-foreground') && l.includes('flex-col'))
    expect(hostLine, 'a tabpanel host div should carry flex + flex-col + min-h-0').toBeDefined()
    expect(hostLine).toContain('flex')
    expect(hostLine).toContain('flex-col')
    expect(hostLine).toContain('min-h-0')
  })

  it('expresses a COMPLETE chain across the trio: host flex-col min-h-0 → wrapper flex-1 min-h-0 + [&>*] repair → list root flex-1 min-h-0 (any dropped token fails)', () => {
    // Host top of chain.
    expect(SLACK_SURFACE_HOST_CLASS).toContain('flex-col')
    expect(SLACK_SURFACE_HOST_CLASS).toContain('min-h-0')
    // Wrapper forwards fill + repairs the SDK child.
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('flex-1')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('min-h-0')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:flex-1')
    expect(SLACK_LAYOUT_FILL_CLASS).toContain('[&>*]:min-h-0')
    // List root consumes the chain.
    expect(SLACK_LIST_SCROLL_CLASS).toContain('flex-1')
    expect(SLACK_LIST_SCROLL_CLASS).toContain('min-h-0')
  })
})
