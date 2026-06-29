/**
 * Integration tests for TranscriptWatcher (cosmos-agent-progress-not-streaming-v1).
 *
 * The bug: while a headless `claude -p` run is in flight the Cosmos timeline showed only a
 * spinner, then every turn appeared at once on completion — the in-between steps never streamed.
 * The fix watches the default-session transcript WHILE a run is in flight and pushes an
 * incremental `conversation:update` each time the parsed conversation grows.
 *
 * These tests drive the watcher with an injected scheduler + an injected reader that returns a
 * GROWING transcript snapshot (the jsonl gaining assistant/tool turns as `claude` appends),
 * asserting:
 *   1. each growth fires ONE `onChange` carrying the accumulated turns (turns stream live);
 *   2. an unchanged poll (and a burst that collapses between ticks) is COALESCED — no redundant push;
 *   3. `stop()` clears the interval so no watcher leaks (and post-stop ticks are inert);
 *   4. `start()` re-baselines so a NEW run only streams turns appended during it.
 *
 * RED before the fix: there is no watcher at all, so the in-flight incremental push never happens.
 */

import { describe, it, expect, vi } from 'vitest'
import { TranscriptWatcher } from './transcriptWatcher'
import type { ConversationResult } from '../../shared/ipc/conversation'
import type { ConversationTurn } from '../../shared/types/conversation'

/** A manual scheduler: captures the poll callback so a test can drive ticks deterministically. */
function makeManualScheduler() {
  let cb: (() => void) | null = null
  let cleared = 0
  const handle = 1 as unknown as ReturnType<typeof setInterval>
  return {
    setIntervalFn: (fn: () => void) => {
      cb = fn
      return handle
    },
    clearIntervalFn: () => {
      cleared++
      cb = null
    },
    /** Fire one poll (no-op if the interval was cleared). */
    tick: () => cb?.(),
    /** How many times clearInterval ran (leak guard). */
    get clearedCount() {
      return cleared
    },
    /** Whether a live callback is still armed. */
    get armed() {
      return cb !== null
    }
  }
}

/** Build a populated `ConversationResult` from a list of turns. */
function populated(turns: ConversationTurn[]): ConversationResult {
  return { ok: true, conversation: { turns, state: turns.length > 0 ? 'populated' : 'empty' } }
}

const userTurn: ConversationTurn = { kind: 'user-prompt', id: 'u1', ts: '1', text: 'make a chart' }
const assistantTurn: ConversationTurn = {
  kind: 'assistant-text',
  id: 'a1',
  ts: '2',
  text: 'Working on it'
}
const toolTurn: ConversationTurn = {
  kind: 'tool-call',
  id: 't1',
  ts: '3',
  toolName: 'Read',
  argPreview: 'file.ts'
}

describe('TranscriptWatcher — incremental in-flight push', () => {
  it('pushes ONE conversation:update per real growth as the transcript gains turns', () => {
    const sched = makeManualScheduler()
    // The transcript GROWS across polls: empty (baseline) → user → user+assistant → +tool.
    const reads: ConversationResult[] = [
      populated([]), // baseline at start()
      populated([userTurn]),
      populated([userTurn, assistantTurn]),
      populated([userTurn, assistantTurn, toolTurn])
    ]
    let i = 0
    const read = () => reads[Math.min(i++, reads.length - 1)]
    const onChange = vi.fn()

    const watcher = new TranscriptWatcher({
      read,
      onChange,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn
    })

    watcher.start() // consumes reads[0] as the baseline — no push
    expect(onChange).toHaveBeenCalledTimes(0)
    expect(watcher.isWatching).toBe(true)

    sched.tick() // reads[1] — user turn appended
    sched.tick() // reads[2] — assistant turn appended
    sched.tick() // reads[3] — tool turn appended

    expect(onChange).toHaveBeenCalledTimes(3)
    // Each push carries the ACCUMULATED turns so far (the streamed timeline).
    expect(onChange.mock.calls[0][0]).toEqual(populated([userTurn]))
    expect(onChange.mock.calls[1][0]).toEqual(populated([userTurn, assistantTurn]))
    expect(onChange.mock.calls[2][0]).toEqual(populated([userTurn, assistantTurn, toolTurn]))
  })

  it('coalesces unchanged polls — no redundant push when the transcript did not grow', () => {
    const sched = makeManualScheduler()
    const reads: ConversationResult[] = [
      populated([]), // baseline
      populated([userTurn]), // grows once
      populated([userTurn]), // burst settled — same content
      populated([userTurn]) // still same
    ]
    let i = 0
    const onChange = vi.fn()
    const watcher = new TranscriptWatcher({
      read: () => reads[Math.min(i++, reads.length - 1)],
      onChange,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn
    })

    watcher.start()
    sched.tick() // change → push
    sched.tick() // identical → coalesced
    sched.tick() // identical → coalesced

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual(populated([userTurn]))
  })

  it('stop() clears the interval so no watcher leaks, and a post-stop tick is inert', () => {
    const sched = makeManualScheduler()
    const onChange = vi.fn()
    const watcher = new TranscriptWatcher({
      read: () => populated([userTurn]),
      onChange,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn
    })

    watcher.start()
    expect(watcher.isWatching).toBe(true)

    watcher.stop()
    expect(watcher.isWatching).toBe(false)
    expect(sched.clearedCount).toBe(1)
    expect(sched.armed).toBe(false)

    // A stray tick after stop must not push (the manual scheduler dropped the callback).
    sched.tick()
    expect(onChange).toHaveBeenCalledTimes(0)
  })

  it('start() re-baselines: a NEW run only streams turns appended DURING it (not the prior run)', () => {
    const sched = makeManualScheduler()
    // Run 1 ends with [user, assistant]; run 2 starts on that SAME transcript and must NOT
    // re-push it as if new — only the next appended turn (tool) streams.
    const run2Reads: ConversationResult[] = [
      populated([userTurn, assistantTurn]), // baseline for run 2 (prior run's final state)
      populated([userTurn, assistantTurn]), // unchanged first poll
      populated([userTurn, assistantTurn, toolTurn]) // run 2 appends a tool call
    ]
    let i = 0
    const onChange = vi.fn()
    const watcher = new TranscriptWatcher({
      read: () => run2Reads[Math.min(i++, run2Reads.length - 1)],
      onChange,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn
    })

    watcher.start() // baseline = [user, assistant] — no push for the prior state
    sched.tick() // unchanged → coalesced
    sched.tick() // tool appended → ONE push

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual(populated([userTurn, assistantTurn, toolTurn]))
  })

  it('start() is idempotent — re-arming clears the prior interval (no double watcher)', () => {
    const sched = makeManualScheduler()
    const watcher = new TranscriptWatcher({
      read: () => populated([]),
      onChange: vi.fn(),
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn
    })

    watcher.start()
    watcher.start() // re-arm: must stop the prior interval first
    expect(sched.clearedCount).toBe(1)
    expect(watcher.isWatching).toBe(true)
  })
})
