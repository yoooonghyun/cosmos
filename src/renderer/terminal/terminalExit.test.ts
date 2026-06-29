import { describe, it, expect } from 'vitest'
import { formatExit, exitRecoveryHint } from './terminalExit'

/**
 * terminal-panel-v1 FR-007 + terminal-session-unnecessary-restart-v1 (ARCHITECTURE.md §4.1):
 * the exit-banner copy. The message summarizes the exit; the recovery HINT is shown ONLY for a
 * genuine live-session death (exit code/signal) — telling the user that Restart resumes the
 * CONVERSATION but auto-accept mode must be re-enabled (it is process-local and cannot survive the
 * death) — and is SUPPRESSED for a PATH/spawn error (there is no transcript to resume).
 */
describe('formatExit', () => {
  it('surfaces a spawn/PATH error verbatim', () => {
    expect(formatExit({ paneId: 'p1', error: 'claude not found on PATH' })).toBe(
      'claude not found on PATH'
    )
  })

  it('summarizes an exit code', () => {
    expect(formatExit({ paneId: 'p1', exitCode: 1 })).toBe('claude exited (exit code 1)')
  })

  it('summarizes an exit code + signal', () => {
    expect(formatExit({ paneId: 'p1', exitCode: 1, signal: 9 })).toBe(
      'claude exited (exit code 1, signal 9)'
    )
  })

  it('falls back to a bare message when neither code nor signal is present', () => {
    expect(formatExit({ paneId: 'p1' })).toBe('claude exited')
  })
})

describe('exitRecoveryHint', () => {
  it('shows the honest resume + re-enable-auto-accept hint on a genuine death (exit code)', () => {
    const hint = exitRecoveryHint({ paneId: 'p1', exitCode: 1 })
    expect(hint).not.toBeNull()
    // It must promise a CONVERSATION resume (transcript preserved)...
    expect(hint).toMatch(/resume/i)
    // ...AND be honest that auto-accept mode must be re-enabled (not silently restored).
    expect(hint).toMatch(/auto-accept/i)
  })

  it('shows the hint on a signal-only death', () => {
    expect(exitRecoveryHint({ paneId: 'p1', signal: 9 })).not.toBeNull()
  })

  it('suppresses the hint for a spawn/PATH error (no transcript to resume)', () => {
    expect(exitRecoveryHint({ paneId: 'p1', error: 'claude not found on PATH' })).toBeNull()
  })

  it('does not claim auto-accept mode is restored', () => {
    const hint = exitRecoveryHint({ paneId: 'p1', exitCode: 1 }) ?? ''
    expect(hint).not.toMatch(/auto-accept mode (is )?restored/i)
  })
})
