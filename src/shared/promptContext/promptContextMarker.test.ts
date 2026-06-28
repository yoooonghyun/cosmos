/**
 * Node-unit tests for the `<cosmos:context>` marker codec
 * (cosmos-timeline-prompt-context-v1, SC-008 + FR-012/FR-014/FR-020/FR-025).
 *
 * Covers: round-trip of panel (always) / tab (when present) / dock (all four kinds) with absent
 * dimensions OMITTED from the JSON; an ordinary-prose corpus parsing as no-marker; the strip
 * leaving prose intact and removing a malformed/dangling trailing tag; bad-JSON + partial-field
 * markers degrading to no-context with the text still stripped; and the defensive serialize.
 */
import { describe, it, expect } from 'vitest'
import {
  serializePromptContextMarker,
  parsePromptContextMarker,
  stripPromptContextMarker,
  MARKER_RE,
  DOCK_KIND_BY_PANEL
} from './promptContextMarker'
import type { PromptContext } from './promptContext'

const panelOnly: PromptContext = { panel: { id: 'cosmos', label: 'Cosmos' } }
const panelTab: PromptContext = {
  panel: { id: 'jira', label: 'Jira' },
  tab: { id: 't1', label: 'Sprint board' }
}
const jiraDock: PromptContext = {
  panel: { id: 'jira', label: 'Jira' },
  tab: { id: 't1', label: 'Sprint board' },
  dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
}
const slackThreadDock: PromptContext = {
  panel: { id: 'slack', label: 'Slack' },
  tab: { id: 't2', label: '#general' },
  dock: {
    kind: 'slack-channel',
    selectedChannelId: 'C0123',
    selectedChannelName: 'general',
    threadTs: '1700000000.0001'
  }
}
const confluenceDock: PromptContext = {
  panel: { id: 'confluence', label: 'Confluence' },
  dock: { kind: 'confluence-page', selectedPageId: 'P9', selectedPageTitle: 'Release notes' }
}
const calendarDock: PromptContext = {
  panel: { id: 'google-calendar', label: 'Google Calendar' },
  dock: { kind: 'calendar-event', selectedEventId: 'E5', selectedEventTitle: 'Standup' }
}

/** Round-trip helper: serialize ctx onto prose, then parse it back. */
function roundTrip(prose: string, ctx: PromptContext): { context?: PromptContext; text: string } {
  return parsePromptContextMarker(prose + serializePromptContextMarker(ctx))
}

describe('serializePromptContextMarker', () => {
  it('appends a TRAILING block after a blank line (FR-013)', () => {
    const marker = serializePromptContextMarker(panelOnly)
    expect(marker.startsWith('\n\n<cosmos:context>')).toBe(true)
    expect(marker.endsWith('</cosmos:context>')).toBe(true)
  })

  it('OMITS tab and dock from the JSON when absent (FR-012)', () => {
    const marker = serializePromptContextMarker(panelOnly)
    expect(marker).not.toContain('"tab"')
    expect(marker).not.toContain('"dock"')
    expect(marker).toContain('"panel"')
  })

  it('strips empty/undefined ViewContext fields from the dock', () => {
    const marker = serializePromptContextMarker({
      panel: { id: 'jira', label: 'Jira' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-1', selectedChannelName: '   ' }
    })
    expect(marker).toContain('"selectedIssueKey":"PROJ-1"')
    expect(marker).not.toContain('selectedChannelName')
  })

  it('returns "" for a missing/wrong-shape context (FR-010 — defensive)', () => {
    expect(serializePromptContextMarker(undefined)).toBe('')
    // bad panel id / empty label
    expect(
      serializePromptContextMarker({ panel: { id: 'nope' as never, label: 'X' } })
    ).toBe('')
    expect(serializePromptContextMarker({ panel: { id: 'jira', label: '  ' } })).toBe('')
  })

  it('returns "" for an oversized serialization (~4 KB cap, FR-010)', () => {
    const huge = 'x'.repeat(5000)
    const marker = serializePromptContextMarker({
      panel: { id: 'jira', label: 'Jira' },
      dock: { kind: 'jira-issue', selectedIssueKey: huge }
    })
    expect(marker).toBe('')
  })

  it('drops a dock with no populated item field (FR-004)', () => {
    const marker = serializePromptContextMarker({
      panel: { id: 'jira', label: 'Jira' },
      dock: { kind: 'jira-issue' }
    })
    expect(marker).not.toContain('"dock"')
  })
})

describe('round-trip (SC-008)', () => {
  it('panel only', () => {
    const out = roundTrip('hello', panelOnly)
    expect(out.text).toBe('hello')
    expect(out.context).toEqual(panelOnly)
  })

  it('panel + tab', () => {
    const out = roundTrip('do the thing', panelTab)
    expect(out.text).toBe('do the thing')
    expect(out.context).toEqual(panelTab)
  })

  it('jira dock (key only, no fabricated title)', () => {
    const out = roundTrip('summarize this ticket', jiraDock)
    expect(out.context).toEqual(jiraDock)
  })

  it('slack dock with thread', () => {
    const out = roundTrip('what happened here', slackThreadDock)
    expect(out.context).toEqual(slackThreadDock)
  })

  it('confluence dock', () => {
    expect(roundTrip('tl;dr', confluenceDock).context).toEqual(confluenceDock)
  })

  it('calendar dock', () => {
    expect(roundTrip('prep me', calendarDock).context).toEqual(calendarDock)
  })

  it('survives a MULTI-LINE prompt unchanged (FR-013)', () => {
    const prose = 'line one\n\nline two\n  indented'
    const out = roundTrip(prose, jiraDock)
    expect(out.text).toBe(prose)
    expect(out.context).toEqual(jiraDock)
  })

  it('DOCK_KIND_BY_PANEL maps each panel to the right kind', () => {
    expect(DOCK_KIND_BY_PANEL.jira).toBe('jira-issue')
    expect(DOCK_KIND_BY_PANEL.slack).toBe('slack-channel')
    expect(DOCK_KIND_BY_PANEL.confluence).toBe('confluence-page')
    expect(DOCK_KIND_BY_PANEL['google-calendar']).toBe('calendar-event')
    expect(DOCK_KIND_BY_PANEL.cosmos).toBeNull()
    // cosmos-panel-tab-list-v1 (T1): terminal is selectable as panel+tab context; it has no dock.
    expect(DOCK_KIND_BY_PANEL.terminal).toBeNull()
  })

  it('round-trips a TERMINAL panel+tab selection (T1 — terminal id whitelisted)', () => {
    const terminalTab: PromptContext = {
      panel: { id: 'terminal', label: 'Terminal' },
      tab: { id: 'pane-1', label: 'Terminal 2' }
    }
    const out = roundTrip('what is this command doing', terminalTab)
    expect(out.text).toBe('what is this command doing')
    expect(out.context).toEqual(terminalTab)
  })
})

describe('ordinary-prose corpus parses as NO-marker (SC-008 collision-safety)', () => {
  const corpus = [
    'Add a button to the panel',
    'Switch to the Jira tab and show the sprint board',
    'Use brackets [like this] and <angle> tags in my text',
    'Explain the difference between a panel and a tab',
    'line 1\n\nline 2\n\nline 3 mentions cosmos and context',
    'What does <context> mean here?',
    'A prompt ending with a closing brace }',
    'cosmos:context without any tag wrappers'
  ]
  for (const text of corpus) {
    it(`leaves "${text.slice(0, 24)}…" intact with no context`, () => {
      const out = parsePromptContextMarker(text)
      expect(out.context).toBeUndefined()
      expect(out.text).toBe(text)
    })
  }
})

describe('malformed / dangling markers degrade safely (FR-014/FR-020/FR-025)', () => {
  it('bad JSON inside well-formed tags → no context, text stripped clean', () => {
    const out = parsePromptContextMarker('my prompt\n\n<cosmos:context>{not json}</cosmos:context>')
    expect(out.context).toBeUndefined()
    expect(out.text).toBe('my prompt')
  })

  it('partial fields (missing panel.label) → no context, text stripped', () => {
    const out = parsePromptContextMarker(
      'hi\n\n<cosmos:context>{"panel":{"id":"jira"}}</cosmos:context>'
    )
    expect(out.context).toBeUndefined()
    expect(out.text).toBe('hi')
  })

  it('a present-but-malformed tab makes the WHOLE marker malformed (no partial chip)', () => {
    const out = parsePromptContextMarker(
      'hi\n\n<cosmos:context>{"panel":{"id":"jira","label":"Jira"},"tab":{"id":"t1"}}</cosmos:context>'
    )
    expect(out.context).toBeUndefined()
    expect(out.text).toBe('hi')
  })

  it('a DANGLING opening tag (no close) is stripped, no context (FR-025)', () => {
    const out = parsePromptContextMarker('real prompt\n\n<cosmos:context>{"panel":')
    expect(out.context).toBeUndefined()
    expect(out.text).toBe('real prompt')
  })

  it('an unknown panel id → no context, stripped', () => {
    const out = parsePromptContextMarker(
      'x\n\n<cosmos:context>{"panel":{"id":"weird","label":"W"}}</cosmos:context>'
    )
    expect(out.context).toBeUndefined()
    expect(out.text).toBe('x')
  })
})

describe('MARKER_RE (pinned strip regex, SC-008)', () => {
  it('matches a well-formed trailing block, leaves prose when replaced', () => {
    const text = 'prose\n\n<cosmos:context>{"panel":{"id":"jira","label":"Jira"}}</cosmos:context>'
    expect(MARKER_RE.test(text)).toBe(true)
    expect(text.replace(MARKER_RE, '')).toBe('prose')
  })
})

describe('stripPromptContextMarker (non-user defensive strip, FR-025)', () => {
  it('strips an echoed trailing marker from non-user text', () => {
    const echoed = 'Sure!\n\n<cosmos:context>{"panel":{"id":"jira","label":"Jira"}}</cosmos:context>'
    expect(stripPromptContextMarker(echoed)).toBe('Sure!')
  })

  it('leaves ordinary text untouched', () => {
    expect(stripPromptContextMarker('plain assistant reply')).toBe('plain assistant reply')
  })
})
