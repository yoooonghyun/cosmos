import { describe, it, expect } from 'vitest'
import { CONFLUENCE_TOOL_DESCRIPTION } from './confluenceToolDescription'

/*
 * confluence-detail-rich-render-v1 — render_confluence_ui catalog-description invariants
 * (FR-001/FR-002/FR-003). Written RED in Step 4: the description is REWRITTEN in Step 5, so
 * these assert the NEW required wording and currently fail against the stale "DISPLAY-ONLY:
 * no actions" / positional `"id": "1"` example string.
 */

describe('CONFLUENCE_TOOL_DESCRIPTION — SearchResultRow.id is the REAL page id (FR-001)', () => {
  it('states the row id is the real Confluence page id from confluence_search_content', () => {
    // The model must learn the row id IS the page id that opens that page on click — not a
    // positional/sequential index. Tie it to the search read that produced the rows.
    expect(CONFLUENCE_TOOL_DESCRIPTION).toMatch(/real Confluence page id/i)
    expect(CONFLUENCE_TOOL_DESCRIPTION).toMatch(/confluence_search_content/)
  })
})

describe('CONFLUENCE_TOOL_DESCRIPTION — row is actionable, not "no actions" (FR-002)', () => {
  it('no longer claims there are NO actions / display-only', () => {
    // A SearchResultRow now opens the page detail on click; the stale "no actions" wording
    // must be gone so the model does not believe the surface is inert.
    expect(CONFLUENCE_TOOL_DESCRIPTION).not.toMatch(/no\s+actions/i)
    expect(CONFLUENCE_TOOL_DESCRIPTION).not.toMatch(/no\s+input\s+controls\s+and\s+no\s+actions/i)
  })
})

describe('CONFLUENCE_TOOL_DESCRIPTION — example seeds a realistic page id, never "1" (FR-003)', () => {
  it('does not model the positional id "id": "1" in the example', () => {
    expect(CONFLUENCE_TOOL_DESCRIPTION).not.toContain('"id": "1"')
  })

  it('keeps the "illustrative only, never copy" caveat', () => {
    expect(CONFLUENCE_TOOL_DESCRIPTION).toMatch(/illustrative only/i)
  })
})
