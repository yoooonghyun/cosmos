/**
 * Tests for slackThreadPanelLogic — the pure open-thread state transitions + root-drop
 * helper backing the right-docked Slack thread panel
 * (slack-thread-sidepanel-and-image-viewer-v1). Node env, no DOM.
 *
 * Covers (per plan Phase 4): open sets state; retarget to a different thread; toggle the
 * SAME thread closes (FR-004); close resets; `isThreadOpen` correctness; root-drop
 * (FR-003); and a no-token/secret guard on the carried state shape (FR-009/FR-013).
 * Each transition is exercised happy-path + missing-optional-fields (no error) +
 * invalid/missing-required (safe fallback, no crash).
 */

import { describe, it, expect } from 'vitest'
import {
  OPEN_THREAD_CLOSED,
  isThreadOpen,
  openThread,
  closeThread,
  dropThreadRoot,
  isOpenableThreadPermalink,
  messageListWrapClass,
  type OpenThreadState
} from './slackThreadPanelLogic'
import type { SlackOpenThreadContext } from './slackCatalog/logic'

const threadA: SlackOpenThreadContext = {
  channelId: 'C111',
  threadTs: '1700000000.000100',
  ts: '1700000000.000100',
  userId: 'U111',
  userName: 'Ada',
  text: 'parent A',
  replyCount: 3
}

const threadB: SlackOpenThreadContext = {
  channelId: 'C222',
  threadTs: '1700000999.000900',
  ts: '1700000999.000900',
  userId: 'U222',
  text: 'parent B'
}

describe('isThreadOpen', () => {
  it('is false for the closed (null) state', () => {
    expect(isThreadOpen(OPEN_THREAD_CLOSED, threadA.channelId, threadA.threadTs)).toBe(false)
  })

  it('is true only for the exact open thread coordinates', () => {
    expect(isThreadOpen(threadA, threadA.channelId, threadA.threadTs)).toBe(true)
    expect(isThreadOpen(threadA, threadA.channelId, threadB.threadTs)).toBe(false)
    expect(isThreadOpen(threadA, threadB.channelId, threadA.threadTs)).toBe(false)
  })

  it('does not throw on empty/odd ids (safe fallback)', () => {
    expect(isThreadOpen(threadA, '', '')).toBe(false)
    expect(isThreadOpen(OPEN_THREAD_CLOSED, '', '')).toBe(false)
  })
})

describe('openThread', () => {
  it('opens a thread from the closed state (happy path)', () => {
    expect(openThread(OPEN_THREAD_CLOSED, threadA)).toEqual(threadA)
  })

  it('retargets to a different thread in place (FR-004), not closing', () => {
    const next = openThread(threadA, threadB)
    expect(next).toEqual(threadB)
    expect(next).not.toBeNull()
  })

  it('toggles the SAME open thread closed (FR-004 MAY)', () => {
    expect(openThread(threadA, threadA)).toBe(OPEN_THREAD_CLOSED)
  })

  it('treats same coords but different display fields as the SAME thread (toggle closes)', () => {
    const sameCoords: SlackOpenThreadContext = { ...threadA, text: 'edited', userName: 'Ada L.' }
    expect(openThread(threadA, sameCoords)).toBe(OPEN_THREAD_CLOSED)
  })

  it('opens a context missing optional fields without error (missing-optional)', () => {
    // threadB has no userName / replyCount — must open cleanly.
    expect(openThread(OPEN_THREAD_CLOSED, threadB)).toEqual(threadB)
  })

  it('does not mutate the prior state', () => {
    const prior: OpenThreadState = { ...threadA }
    openThread(prior, threadB)
    expect(prior).toEqual(threadA)
  })
})

describe('messageListWrapClass (bug slack-thread-unified-scroll-v1)', () => {
  it('owns its scroll when scroll=true (history/search fill the column)', () => {
    expect(messageListWrapClass(true)).toBe('h-full')
  })

  it('grows to content when scroll=false (thread dock flows in the shared scroll)', () => {
    expect(messageListWrapClass(false)).toBe('h-auto')
  })

  it('never returns h-full for the unified-scroll (scroll=false) mode', () => {
    // The whole point of the fix: in the thread dock the replies must NOT establish their
    // own full-height scroll region — that was the second-scroll bug.
    expect(messageListWrapClass(false)).not.toBe('h-full')
  })
})

describe('closeThread', () => {
  it('always returns the closed state', () => {
    expect(closeThread()).toBe(OPEN_THREAD_CLOSED)
    expect(closeThread()).toBeNull()
  })
})

describe('isOpenableThreadPermalink (slack-thread-open-in-slack-v1)', () => {
  it('accepts an absolute http(s) Slack permalink (happy path → header link shows)', () => {
    expect(
      isOpenableThreadPermalink('https://acme.slack.com/archives/C1/p1700000000000100')
    ).toBe(true)
    expect(isOpenableThreadPermalink('http://example.com/x')).toBe(true)
  })

  it('returns false for a missing / empty permalink (missing-optional → plain header)', () => {
    expect(isOpenableThreadPermalink(undefined)).toBe(false)
    expect(isOpenableThreadPermalink('')).toBe(false)
    expect(isOpenableThreadPermalink('   ')).toBe(false)
  })

  it('returns false for a non-http(s) / malformed value (invalid → no live link, no crash)', () => {
    expect(isOpenableThreadPermalink('slack://channel?team=T1')).toBe(false)
    expect(isOpenableThreadPermalink('javascript:alert(1)')).toBe(false)
    expect(isOpenableThreadPermalink('not a url')).toBe(false)
  })
})

describe('dropThreadRoot (FR-003)', () => {
  const replies = [
    { ts: '1700000000.000100', text: 'root (parent)' },
    { ts: '1700000001.000200', text: 'reply 1' },
    { ts: '1700000002.000300', text: 'reply 2' }
  ]

  it('drops the reply whose ts equals the parent (happy path)', () => {
    const out = dropThreadRoot(replies, '1700000000.000100')
    expect(out.map((m) => m.ts)).toEqual(['1700000001.000200', '1700000002.000300'])
  })

  it('returns [] for a non-array input (safe fallback, no crash)', () => {
    expect(dropThreadRoot(undefined, '1700000000.000100')).toEqual([])
    // @ts-expect-error — invalid required input must not throw
    expect(dropThreadRoot(null, '1700000000.000100')).toEqual([])
  })

  it('filters nothing when parentTs is missing/blank (missing-optional)', () => {
    expect(dropThreadRoot(replies, undefined)).toHaveLength(3)
    expect(dropThreadRoot(replies, '')).toHaveLength(3)
  })

  it('returns a fresh array (does not mutate input)', () => {
    const out = dropThreadRoot(replies, 'no-match')
    expect(out).toHaveLength(3)
    expect(out).not.toBe(replies)
  })
})

describe('no-token / no-secret guard (FR-009/FR-013)', () => {
  it('the carried open-thread state has only non-secret fields', () => {
    const state = openThread(OPEN_THREAD_CLOSED, threadA)
    expect(state).not.toBeNull()
    const allowed = new Set(['channelId', 'threadTs', 'ts', 'userId', 'userName', 'text', 'replyCount'])
    for (const key of Object.keys(state as object)) {
      expect(allowed.has(key)).toBe(true)
    }
  })

  it('no field value looks like a token or files.slack.com URL', () => {
    const state = openThread(OPEN_THREAD_CLOSED, threadA) as SlackOpenThreadContext
    const blob = JSON.stringify(state)
    expect(blob).not.toMatch(/xox[abposr]-/) // Slack token prefixes
    expect(blob).not.toMatch(/files\.slack\.com/)
  })
})
