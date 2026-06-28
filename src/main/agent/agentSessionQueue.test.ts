import { describe, it, expect, vi } from 'vitest'
import { selectDefaultSessionId, decideSubmit, sessionFlagForRun } from './agentSessionQueue'

describe('selectDefaultSessionId — create-or-continue', () => {
  it('mints a fresh id when nothing is persisted (and flags it for the caller to persist)', () => {
    const mint = vi.fn(() => 'fresh-uuid')
    const sel = selectDefaultSessionId(null, mint)
    expect(sel).toEqual({ sessionId: 'fresh-uuid', minted: true })
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('mints when the persisted value is undefined', () => {
    const sel = selectDefaultSessionId(undefined, () => 'fresh')
    expect(sel).toEqual({ sessionId: 'fresh', minted: true })
  })

  it('mints when the persisted value is blank/whitespace (corrupt) — never reuses an empty id', () => {
    const sel = selectDefaultSessionId('   ', () => 'fresh')
    expect(sel).toEqual({ sessionId: 'fresh', minted: true })
  })

  it('REUSES a persisted, non-empty id (continuity across runs + relaunch) and does NOT mint', () => {
    const mint = vi.fn(() => 'would-not-use')
    const sel = selectDefaultSessionId('persisted-id', mint)
    expect(sel).toEqual({ sessionId: 'persisted-id', minted: false })
    expect(mint).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// sessionFlagForRun — agent-session-id-reuse-resume-v1 regression guard
//
// For headless `claude -p`, `--session-id` is CREATE-ONLY (hard-rejects "already in
// use" once the session jsonl exists). The session must be created exactly once
// (`--session-id`) and every later run CONTINUES it (`--resume`). These tests MUST
// FAIL against the old always-`--session-id` code and pass with the fix.
// ---------------------------------------------------------------------------

describe('sessionFlagForRun — create-once-then-resume (agent-session-id-reuse-resume-v1)', () => {
  it('returns --session-id when the session does NOT yet exist (first run, create path)', () => {
    expect(sessionFlagForRun(false)).toBe('--session-id')
  })

  it('returns --resume when the session ALREADY EXISTS on disk (every subsequent run)', () => {
    expect(sessionFlagForRun(true)).toBe('--resume')
  })

  it('never returns --resume for a fresh session (would fail: session not created yet)', () => {
    expect(sessionFlagForRun(false)).not.toBe('--resume')
  })

  it('never returns --session-id for an existing session (would hard-reject "already in use")', () => {
    expect(sessionFlagForRun(true)).not.toBe('--session-id')
  })
})

describe('decideSubmit — spawn / enqueue (unified-agent-session-v1)', () => {
  it('spawns immediately when idle', () => {
    expect(decideSubmit({ running: false })).toEqual({ action: 'spawn' })
  })

  it('ENQUEUES while busy — every target serializes on the one shared session (FR-004/FR-005)', () => {
    // The regression this feature fixes: a busy submit USED to `drop` for non-default
    // targets; now it ALWAYS enqueues because all targets share the one session id.
    expect(decideSubmit({ running: true })).toEqual({ action: 'enqueue' })
  })

  it('never returns a drop outcome (the per-target ephemeral drop path is removed — FR-013)', () => {
    expect(decideSubmit({ running: true }).action).not.toBe('drop')
    expect(decideSubmit({ running: false }).action).not.toBe('drop')
  })
})
