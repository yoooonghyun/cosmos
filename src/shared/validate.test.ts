import { describe, it, expect, vi } from 'vitest'
import {
  validateAgentPrompt,
  validateAgentStatusPayload,
  validateConfluenceDefaultFeed,
  validateConfluencePageDetail,
  validateDispose,
  validateInput,
  validateRequestDefaultView,
  validateRequestIssueDetail,
  validateRequestSearchView,
  validateResize,
  validateRestart,
  validateStart,
  validateUiRenderTarget
} from './validate'

describe('validateInput (FR-004, FR-010; panel-tabs v1 FR-021)', () => {
  it('accepts a valid pty:input payload (happy path)', () => {
    const warn = vi.fn()
    const result = validateInput({ paneId: 'p1', data: 'ls -la\r' }, warn)
    expect(result).toEqual({ paneId: 'p1', data: 'ls -la\r' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts an empty-string data field (valid, not "missing")', () => {
    const warn = vi.fn()
    const result = validateInput({ paneId: 'p1', data: '' }, warn)
    expect(result).toEqual({ paneId: 'p1', data: '' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra/optional unknown fields without erroring', () => {
    const warn = vi.fn()
    // Extra properties are not part of the contract but must not cause failure.
    const result = validateInput({ paneId: 'p1', data: 'x', extra: 123 } as unknown, warn)
    expect(result).toEqual({ paneId: 'p1', data: 'x' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when required "data" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateInput({ paneId: 'p1' }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "data" is the wrong type', () => {
    const warn = vi.fn()
    const result = validateInput({ paneId: 'p1', data: 42 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([undefined, '', 42, null, {}])(
    'warns and returns null when "paneId" is missing/invalid %p (panel-tabs v1 FR-021)',
    (paneId) => {
      const warn = vi.fn()
      const result = validateInput({ paneId, data: 'x' } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([null, undefined, 'a string', 42])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validateInput(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateResize (FR-005, FR-010; panel-tabs v1 FR-021)', () => {
  it('accepts a valid pty:resize payload (happy path)', () => {
    const warn = vi.fn()
    const result = validateResize({ paneId: 'p1', cols: 80, rows: 24 }, warn)
    expect(result).toEqual({ paneId: 'p1', cols: 80, rows: 24 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra unknown fields without erroring', () => {
    const warn = vi.fn()
    const result = validateResize(
      { paneId: 'p1', cols: 120, rows: 40, pixelWidth: 999 } as unknown,
      warn
    )
    expect(result).toEqual({ paneId: 'p1', cols: 120, rows: 40 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when "cols" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateResize({ paneId: 'p1', rows: 24 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "rows" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateResize({ paneId: 'p1', cols: 80 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([undefined, '', 42, null, {}])(
    'warns and returns null when "paneId" is missing/invalid %p (panel-tabs v1 FR-021)',
    (paneId) => {
      const warn = vi.fn()
      const result = validateResize({ paneId, cols: 80, rows: 24 } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([0, -1, 1.5, NaN, Infinity, '80'])(
    'warns and returns null for invalid cols value %p',
    (cols) => {
      const warn = vi.fn()
      const result = validateResize({ paneId: 'p1', cols, rows: 24 } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([0, -1, 2.2, NaN, Infinity, '24'])(
    'warns and returns null for invalid rows value %p',
    (rows) => {
      const warn = vi.fn()
      const result = validateResize({ paneId: 'p1', cols: 80, rows } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([null, undefined, 'nope', 7])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validateResize(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe.each([
  ['validateStart (panel-tabs v1, FR-022)', validateStart],
  ['validateRestart (panel-tabs v1, FR-026)', validateRestart],
  ['validateDispose (panel-tabs v1, FR-023)', validateDispose]
] as const)('%s', (_label, validate) => {
  it('accepts a valid { paneId } payload (happy path)', () => {
    const warn = vi.fn()
    const result = validate({ paneId: 'p1' }, warn)
    expect(result).toEqual({ paneId: 'p1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra unknown fields without erroring', () => {
    const warn = vi.fn()
    const result = validate({ paneId: 'p1', extra: 9 } as unknown, warn)
    expect(result).toEqual({ paneId: 'p1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 42, null, {}])(
    'warns and returns null when "paneId" is missing/invalid %p',
    (paneId) => {
      const warn = vi.fn()
      const result = validate({ paneId } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([null, undefined, 'nope', 7])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validate(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateStart optional cwd (terminal-open-directory-picker-v1, FR-004/FR-008)', () => {
  it('accepts a valid { paneId } with NO cwd (normal/restore path, unchanged)', () => {
    const warn = vi.fn()
    const result = validateStart({ paneId: 'p1' }, warn)
    expect(result).toEqual({ paneId: 'p1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a valid { paneId, cwd } with a non-empty cwd (freshly-picked tab)', () => {
    const warn = vi.fn()
    const result = validateStart({ paneId: 'p1', cwd: '/Users/me/project' }, warn)
    expect(result).toEqual({ paneId: 'p1', cwd: '/Users/me/project' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('treats an explicitly-undefined cwd as absent (normal path)', () => {
    const warn = vi.fn()
    const result = validateStart({ paneId: 'p1', cwd: undefined } as unknown, warn)
    expect(result).toEqual({ paneId: 'p1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['', 42, null, {}, []])(
    'warns and returns null when cwd is present but invalid %p (SC-005)',
    (cwd) => {
      const warn = vi.fn()
      const result = validateStart({ paneId: 'p1', cwd } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it('still warns + returns null when paneId is missing even if cwd is valid', () => {
    const warn = vi.fn()
    const result = validateStart({ cwd: '/Users/me/project' } as unknown, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('validateAgentPrompt (FR-004, FR-010)', () => {
  it('accepts a valid utterance (happy path)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({ utterance: 'Build me a login form' }, warn)
    // v2 D2: target is OPTIONAL — absent defaults to 'generated-ui' silently.
    expect(result).toEqual({ utterance: 'Build me a login form', target: 'generated-ui' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves the exact utterance text (no trimming of a valid value)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({ utterance: '  has leading space' }, warn)
    expect(result).toEqual({ utterance: '  has leading space', target: 'generated-ui' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra unknown fields without erroring', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      { utterance: 'hi', extra: 123 } as unknown,
      warn
    )
    expect(result).toEqual({ utterance: 'hi', target: 'generated-ui' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('carries an explicit valid target through (v2 D2 — Jira run)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({ utterance: 'show my issues', target: 'jira' }, warn)
    expect(result).toEqual({ utterance: 'show my issues', target: 'jira' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['slack', 'confluence'] as const)(
    'carries the %p target through (Slack + Confluence generative-UI v1)',
    (target) => {
      const warn = vi.fn()
      const result = validateAgentPrompt({ utterance: 'show me', target }, warn)
      expect(result).toEqual({ utterance: 'show me', target })
      expect(warn).not.toHaveBeenCalled()
    }
  )

  it('warns and defaults an INVALID target to "generated-ui" (never mis-routes to Jira)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({ utterance: 'hi', target: 'bogus' } as unknown, warn)
    expect(result).toEqual({ utterance: 'hi', target: 'generated-ui' })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "utterance" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({}, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "utterance" is not a string', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({ utterance: 42 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each(['', '   ', '\t', '\n  \n'])(
    'warns and returns null for empty/whitespace-only utterance %p (FR-004)',
    (utterance) => {
      const warn = vi.fn()
      const result = validateAgentPrompt({ utterance }, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([null, undefined, 'a string', 42])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validateAgentPrompt(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  // open-prompt-view-context-v1 — optional non-secret viewContext (FR-001/FR-006).
  it('attaches a valid viewContext when present (FR-001)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      {
        utterance: 'summarize this ticket',
        target: 'jira',
        viewContext: { selectedIssueKey: 'PROJ-123' }
      },
      warn
    )
    expect(result).toEqual({
      utterance: 'summarize this ticket',
      target: 'jira',
      viewContext: { selectedIssueKey: 'PROJ-123' }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('attaches a multi-field slack viewContext (channel + thread)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      {
        utterance: 'what was decided here',
        target: 'slack',
        viewContext: {
          selectedChannelId: 'C1',
          selectedChannelName: 'general',
          threadTs: '1700000000.0001'
        }
      },
      warn
    )
    expect(result?.viewContext).toEqual({
      selectedChannelId: 'C1',
      selectedChannelName: 'general',
      threadTs: '1700000000.0001'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('omits viewContext entirely when absent (backward-compatible baseline — FR-005)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt({ utterance: 'hi', target: 'jira' }, warn)
    expect(result).toEqual({ utterance: 'hi', target: 'jira' })
    expect(result).not.toHaveProperty('viewContext')
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops unknown viewContext fields but keeps the valid ones', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      {
        utterance: 'hi',
        target: 'jira',
        viewContext: { selectedIssueKey: 'PROJ-1', bogus: 'x', token: 'leak' } as unknown
      },
      warn
    )
    expect(result?.viewContext).toEqual({ selectedIssueKey: 'PROJ-1' })
  })

  it('warns and DROPS an invalid (non-object) viewContext but STILL starts the run (FR-006/SC-005)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      { utterance: 'still runs', target: 'jira', viewContext: 'not-an-object' } as unknown,
      warn
    )
    expect(result).toEqual({ utterance: 'still runs', target: 'jira' })
    expect(result).not.toHaveProperty('viewContext')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and drops a viewContext whose field is the wrong type (run still starts)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      {
        utterance: 'still runs',
        target: 'jira',
        viewContext: { selectedIssueKey: 42 } as unknown
      },
      warn
    )
    // The whole viewContext is dropped (warn-and-ignore) — never crashes, run still valid.
    expect(result).toEqual({ utterance: 'still runs', target: 'jira' })
    expect(result).not.toHaveProperty('viewContext')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('omits viewContext when it has no populated fields (empty object ⇒ baseline)', () => {
    const warn = vi.fn()
    const result = validateAgentPrompt(
      { utterance: 'hi', target: 'jira', viewContext: {} },
      warn
    )
    expect(result).toEqual({ utterance: 'hi', target: 'jira' })
    expect(result).not.toHaveProperty('viewContext')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('validateUiRenderTarget (Jira generative-UI v2, D1 / FR-004, FR-013)', () => {
  it('defaults ABSENT (undefined) to "generated-ui" SILENTLY (backward-compatible)', () => {
    const warn = vi.fn()
    expect(validateUiRenderTarget(undefined, warn)).toBe('generated-ui')
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['jira', 'generated-ui', 'slack', 'confluence'] as const)(
    'returns a valid target %p as-is',
    (target) => {
      const warn = vi.fn()
      expect(validateUiRenderTarget(target, warn)).toBe(target)
      expect(warn).not.toHaveBeenCalled()
    }
  )

  it.each([null, '', 'JIRA', 'Slack', 'CONFLUENCE', 'bogus', 7, {}, []])(
    'warns and defaults an INVALID value %p to "generated-ui" (safe fallback, never crashes)',
    (raw) => {
      const warn = vi.fn()
      expect(validateUiRenderTarget(raw as unknown, warn)).toBe('generated-ui')
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateRequestDefaultView (Jira generative-UI v2, D4 / FR-002)', () => {
  it('accepts the empty object trigger (the expected payload)', () => {
    const warn = vi.fn()
    expect(validateRequestDefaultView({}, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts an object with extra keys as the empty trigger (no field is read)', () => {
    const warn = vi.fn()
    expect(validateRequestDefaultView({ extra: 1 } as unknown, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 'nope', 7])(
    'warns and returns null for non-object payload %p (malformed frame triggers no read)',
    (raw) => {
      const warn = vi.fn()
      expect(validateRequestDefaultView(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateRequestSearchView (jira-jql-search-v1, FR-012)', () => {
  it('accepts a non-empty jql string (the happy path)', () => {
    const warn = vi.fn()
    expect(validateRequestSearchView({ jql: 'project = ABC' }, warn)).toEqual({
      jql: 'project = ABC'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts an EMPTY jql string (the valid clear-to-default case, FR-005)', () => {
    const warn = vi.fn()
    expect(validateRequestSearchView({ jql: '' }, warn)).toEqual({ jql: '' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a whitespace-only jql string (resolved to default in main)', () => {
    const warn = vi.fn()
    expect(validateRequestSearchView({ jql: '   ' }, warn)).toEqual({ jql: '   ' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 'nope', 7])(
    'warns and returns null for non-object payload %p (malformed frame triggers no read)',
    (raw) => {
      const warn = vi.fn()
      expect(validateRequestSearchView(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([{ jql: 7 }, { jql: null }, {}, { notJql: 'x' }])(
    'warns and returns null when "jql" is missing or not a string (%p)',
    (raw) => {
      const warn = vi.fn()
      expect(validateRequestSearchView(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateRequestIssueDetail (jira-ticket-detail-v1, FR-011)', () => {
  it('accepts a non-empty issueKey (the happy path)', () => {
    const warn = vi.fn()
    expect(validateRequestIssueDetail({ issueKey: 'PROJ-1' }, warn)).toEqual({
      issueKey: 'PROJ-1'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('carries ONLY issueKey through, dropping any extra keys (no token/secret, FR-010)', () => {
    const warn = vi.fn()
    expect(
      validateRequestIssueDetail({ issueKey: 'ABC-9', token: 'secret', extra: 1 } as unknown, warn)
    ).toEqual({ issueKey: 'ABC-9' })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 'PROJ-1', 7])(
    'warns and returns null for non-object payload %p (malformed frame triggers no read)',
    (raw) => {
      const warn = vi.fn()
      expect(validateRequestIssueDetail(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([{ issueKey: 7 }, { issueKey: null }, {}, { notIssueKey: 'x' }])(
    'warns and returns null when "issueKey" is missing or not a string (%p)',
    (raw) => {
      const warn = vi.fn()
      expect(validateRequestIssueDetail(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([{ issueKey: '' }, { issueKey: '   ' }, { issueKey: '\t\n' }])(
    'warns and returns null for an EMPTY/whitespace issueKey %p (no "default detail" — invalid)',
    (raw) => {
      const warn = vi.fn()
      expect(validateRequestIssueDetail(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateConfluenceDefaultFeed (confluence-default-feed v1, FR-006, FR-016)', () => {
  it('accepts the empty object (first page — cursor optional)', () => {
    const warn = vi.fn()
    expect(validateConfluenceDefaultFeed({}, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts undefined as the empty trigger (first page)', () => {
    const warn = vi.fn()
    expect(validateConfluenceDefaultFeed(undefined, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a string cursor', () => {
    const warn = vi.fn()
    expect(validateConfluenceDefaultFeed({ cursor: 'abc' }, warn)).toEqual({ cursor: 'abc' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null for a non-string cursor', () => {
    const warn = vi.fn()
    expect(validateConfluenceDefaultFeed({ cursor: 5 } as unknown, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, 'nope', 7])(
    'warns and returns null for a non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      expect(validateConfluenceDefaultFeed(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateConfluencePageDetail (confluence-detail-rich-render-v1, FR-009/SC-007)', () => {
  it('accepts a valid detail with HTML-string body + optional space (happy path)', () => {
    const warn = vi.fn()
    const detail = {
      id: '12345',
      title: 'Onboarding',
      space: 'ENG',
      body: '<h1>Welcome</h1><p>Hello</p>'
    }
    expect(validateConfluencePageDetail(detail, warn)).toEqual(detail)
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts an empty-string body (a page with no readable body is valid — FR-012)', () => {
    const warn = vi.fn()
    expect(validateConfluencePageDetail({ id: '1', title: 'T', body: '' }, warn)).toEqual({
      id: '1',
      title: 'T',
      body: ''
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a missing optional "space" (must not error)', () => {
    const warn = vi.fn()
    expect(
      validateConfluencePageDetail({ id: '1', title: 'T', body: '<p>x</p>' }, warn)
    ).toEqual({ id: '1', title: 'T', body: '<p>x</p>' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when required "body" is missing (warn + ignore, never crash)', () => {
    const warn = vi.fn()
    expect(validateConfluencePageDetail({ id: '1', title: 'T' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "body" is not a string', () => {
    const warn = vi.fn()
    expect(
      validateConfluencePageDetail({ id: '1', title: 'T', body: 42 } as unknown, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "id" or "title" is not a string', () => {
    const warn = vi.fn()
    expect(validateConfluencePageDetail({ id: 1, title: 'T', body: '' } as unknown, warn)).toBeNull()
    expect(validateConfluencePageDetail({ id: '1', title: 5, body: '' } as unknown, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('warns and returns null when optional "space" is present but not a string', () => {
    const warn = vi.fn()
    expect(
      validateConfluencePageDetail({ id: '1', title: 'T', body: '', space: 9 } as unknown, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, 'nope', 7])('warns and returns null for a non-object payload %p', (raw) => {
    const warn = vi.fn()
    expect(validateConfluencePageDetail(raw as unknown, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('validateAgentStatusPayload (open-prompt-spinner-gating-v1, FR-008)', () => {
  it.each(['started', 'completed', 'error'] as const)(
    'accepts a known run state %p as-is (happy path)',
    (state) => {
      const warn = vi.fn()
      expect(validateAgentStatusPayload({ state }, warn)).toEqual({ state })
      expect(warn).not.toHaveBeenCalled()
    }
  )

  it('preserves a string "message" (the error reason)', () => {
    const warn = vi.fn()
    expect(validateAgentStatusPayload({ state: 'error', message: 'boom' }, warn)).toEqual({
      state: 'error',
      message: 'boom'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts producedSurface=true on a completed status (UI-generation run)', () => {
    const warn = vi.fn()
    expect(
      validateAgentStatusPayload({ state: 'completed', producedSurface: true }, warn)
    ).toEqual({ state: 'completed', producedSurface: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts producedSurface=false on a completed status (plain command)', () => {
    const warn = vi.fn()
    expect(
      validateAgentStatusPayload({ state: 'completed', producedSurface: false }, warn)
    ).toEqual({ state: 'completed', producedSurface: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it('treats an ABSENT producedSurface as valid (optional/additive — no warn, field omitted)', () => {
    const warn = vi.fn()
    const result = validateAgentStatusPayload({ state: 'completed' }, warn)
    expect(result).toEqual({ state: 'completed' })
    expect(result).not.toHaveProperty('producedSurface')
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([1, 'true', null, {}])(
    'warns and DROPS a non-boolean producedSurface %p while KEEPING the status (warn + ignore)',
    (raw) => {
      const warn = vi.fn()
      const result = validateAgentStatusPayload(
        { state: 'completed', producedSurface: raw } as unknown,
        warn
      )
      expect(result).toEqual({ state: 'completed' })
      expect(result).not.toHaveProperty('producedSurface')
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([null, undefined, 'nope', 7, {}, { state: 'bogus' }])(
    'warns and returns null for an unknown/missing run state %p (malformed status dropped)',
    (raw) => {
      const warn = vi.fn()
      expect(validateAgentStatusPayload(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it('drops a non-string "message" without dropping the status', () => {
    const warn = vi.fn()
    expect(
      validateAgentStatusPayload({ state: 'error', message: 42 } as unknown, warn)
    ).toEqual({ state: 'error' })
  })
})
