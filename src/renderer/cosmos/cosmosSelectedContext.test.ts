/**
 * Node-unit tests for the pure selection → panel+tab chip mapper (cosmos-panel-tab-list-v1).
 * Scenario: PANEL-TABS-CHIP-01 (the `kind:'panel-tab'` chip builder).
 */
import { describe, it, expect } from 'vitest'
import { panelTabChipFor } from './cosmosSelectedContext'
import type { PromptContext } from '../../shared/promptContext/promptContext'

describe('panelTabChipFor (PANEL-TABS-CHIP-01)', () => {
  it('returns undefined for no selection', () => {
    expect(panelTabChipFor(null)).toBeUndefined()
    expect(panelTabChipFor(undefined)).toBeUndefined()
  })

  it('returns undefined for a panel-only selection (a tree selection always names a tab)', () => {
    const panelOnly: PromptContext = { panel: { id: 'jira', label: 'Jira' } }
    expect(panelTabChipFor(panelOnly)).toBeUndefined()
  })

  it('builds a kind:"panel-tab" chip carrying ONLY non-secret panel + tab labels (FR-011/FR-018)', () => {
    const sel: PromptContext = {
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 'j1', label: 'Sprint board' }
    }
    expect(panelTabChipFor(sel)).toEqual({
      kind: 'panel-tab',
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 'j1', label: 'Sprint board' }
    })
  })

  it('supports a Terminal selection (T1 — terminal is a selectable panel id)', () => {
    const sel: PromptContext = {
      panel: { id: 'terminal', label: 'Terminal' },
      tab: { id: 't2', label: 'Terminal 2' }
    }
    expect(panelTabChipFor(sel)).toEqual({
      kind: 'panel-tab',
      panel: { id: 'terminal', label: 'Terminal' },
      tab: { id: 't2', label: 'Terminal 2' }
    })
  })

  it('never carries a dock dimension (v1 tree selection is panel + tab only, FR-018)', () => {
    const sel: PromptContext = {
      panel: { id: 'slack', label: 'Slack' },
      tab: { id: 's1', label: '#general' }
    }
    const chip = panelTabChipFor(sel)
    expect(chip && 'dock' in chip).toBe(false)
  })
})
