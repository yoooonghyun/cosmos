/**
 * Node-unit tests for the embedded-agent CLAUDE.md provisioning
 * (cosmos-timeline-prompt-context-v1, SC-012 / FR-026/FR-027).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  SANDBOX_CLAUDE_MD,
  provisionSandboxClaudeMd,
  type SandboxClaudeMdFsLike
} from './sandboxClaudeMd'

describe('SANDBOX_CLAUDE_MD content (FR-027)', () => {
  it('documents the <cosmos:context> block as screen context', () => {
    expect(SANDBOX_CLAUDE_MD).toContain('<cosmos:context>')
    expect(SANDBOX_CLAUDE_MD.toLowerCase()).toContain('screen')
  })

  it('tells the engine to build Generated UI that applies to the dock item', () => {
    expect(SANDBOX_CLAUDE_MD.toLowerCase()).toContain('generated ui')
    expect(SANDBOX_CLAUDE_MD).toContain('dock')
    expect(SANDBOX_CLAUDE_MD).toContain('PROJ-123')
  })

  it('frames the block as context to READ, not echo / leak', () => {
    const lower = SANDBOX_CLAUDE_MD.toLowerCase()
    expect(lower).toContain('echo')
    expect(lower).toContain('read')
  })

  it('references the pinned non-secret fields and documents NO secret field/value', () => {
    expect(SANDBOX_CLAUDE_MD).toContain('panel')
    expect(SANDBOX_CLAUDE_MD).toContain('tab')
    expect(SANDBOX_CLAUDE_MD).toContain('selectedIssueKey')
    // It affirms the fields are non-secret (it may SAY "never a token/secret" — that is the
    // invariant, not a documented secret field)...
    expect(SANDBOX_CLAUDE_MD.toLowerCase()).toContain('non-secret')
    // ...but it must contain no actual secret VALUE or secret-bearing field name.
    expect(SANDBOX_CLAUDE_MD).not.toContain('client_secret')
    expect(SANDBOX_CLAUDE_MD).not.toContain('Bearer ')
    expect(SANDBOX_CLAUDE_MD).not.toMatch(/xoxb-|sk-[a-z]/i)
    expect(SANDBOX_CLAUDE_MD).not.toContain('access_token')
  })
})

describe('provisionSandboxClaudeMd (SC-012 / FR-026)', () => {
  it('writes CLAUDE.md into the dir via the injected fs', () => {
    const writes: Array<{ path: string; data: string }> = []
    const fs: SandboxClaudeMdFsLike = {
      mkdirSync: vi.fn(),
      writeFileSync: (path, data) => writes.push({ path, data })
    }
    provisionSandboxClaudeMd('/tmp/sandbox', fs)
    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/sandbox', { recursive: true })
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe('/tmp/sandbox/CLAUDE.md')
    expect(writes[0].data).toBe(SANDBOX_CLAUDE_MD)
  })

  it('NEVER throws on a write failure — warns and returns (best-effort)', () => {
    const warn = vi.fn()
    const fs: SandboxClaudeMdFsLike = {
      mkdirSync: () => {},
      writeFileSync: () => {
        throw new Error('disk full')
      }
    }
    expect(() => provisionSandboxClaudeMd('/tmp/sandbox', fs, warn)).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
