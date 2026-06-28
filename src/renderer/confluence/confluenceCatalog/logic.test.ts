import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  boundRows,
  countLabel,
  CONFLUENCE_LAYOUT_CLAMP_CLASS,
  CONFLUENCE_OPEN_DETAIL_ACTION,
  hasReadableBody,
  isOpenDetailEmittable,
  isRowSelected,
  showEmptyState,
  showErrorNotice
} from './logic'

/* Slack + Confluence generative-UI v1 — pure Confluence catalog display helpers. */

describe('countLabel (list count line — pluralization)', () => {
  it('uses the singular for exactly one', () => {
    expect(countLabel(1, 'result', 'results')).toBe('1 result')
  })

  it('uses the plural for zero and many', () => {
    expect(countLabel(0, 'result', 'results')).toBe('0 results')
    expect(countLabel(5, 'result', 'results')).toBe('5 results')
  })
})

describe('hasReadableBody (PageDetail empty-body fallback — design §3.3)', () => {
  it('is true for a non-empty body (happy path)', () => {
    expect(hasReadableBody('Some page content')).toBe(true)
  })

  it('is false for a blank/whitespace-only body (shows "no readable body")', () => {
    expect(hasReadableBody('')).toBe(false)
    expect(hasReadableBody('   \n\t ')).toBe(false)
  })

  it('is false for an absent body (missing optional, safe fallback, never throws)', () => {
    expect(hasReadableBody(undefined)).toBe(false)
  })
})

/* confluence-page-detail-nav-v1 — click-to-open page detail (FR-001/FR-002/FR-003). */

describe('CONFLUENCE_OPEN_DETAIL_ACTION (renderer-local nav signal, FR-003)', () => {
  it('is a NON-confluence.* name so onAction intercepts it renderer-locally (never forwarded)', () => {
    // The ConfluencePanel onAction seam handles it + returns true; a confluence.*-prefixed
    // name would forward to main/the agent. Guard it stays renderer-local.
    expect(CONFLUENCE_OPEN_DETAIL_ACTION).toBe('confluenceNav.openDetail')
    expect(CONFLUENCE_OPEN_DETAIL_ACTION.startsWith('confluence.')).toBe(false)
  })
})

describe('isOpenDetailEmittable (id-gated clickable row, FR-001/FR-002)', () => {
  it('is true for a non-empty page id (the row is clickable)', () => {
    expect(isOpenDetailEmittable('P1')).toBe(true)
  })

  it('is false for an absent id (missing optional → inert row, no action, no throw)', () => {
    expect(isOpenDetailEmittable(undefined)).toBe(false)
  })

  it('is false for an empty/whitespace id (inert row)', () => {
    expect(isOpenDetailEmittable('')).toBe(false)
    expect(isOpenDetailEmittable('   ')).toBe(false)
    expect(isOpenDetailEmittable('\t\n')).toBe(false)
  })
})

/* confluence-page-detail-dock-v1 — selected-row marker on the open page's row (FR-007). */

describe('isRowSelected (open-dock selected-row marker, FR-007)', () => {
  it('is true when the row id equals the open dock page id (the marked row)', () => {
    expect(isRowSelected('P1', 'P1')).toBe(true)
  })

  it('is false for a row whose id differs from the open page (not the marked row)', () => {
    expect(isRowSelected('P1', 'P2')).toBe(false)
  })

  it('is false when the dock is closed (no open page id → no row marked)', () => {
    expect(isRowSelected('P1', undefined)).toBe(false)
    expect(isRowSelected('P1', '')).toBe(false)
  })

  it('is false for a row with no id, never matching an empty open id (no throw)', () => {
    expect(isRowSelected(undefined, undefined)).toBe(false)
    expect(isRowSelected(undefined, 'P1')).toBe(false)
    expect(isRowSelected('', '')).toBe(false)
  })
})

/* confluence-generative-adapter-v1 — bound-list display gating (FR-004/FR-007, design §3.1). */

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
    expect(showErrorNotice('Reconnect Confluence.')).toBe(true)
  })

  it('is false for an absent / blank message (missing optional, no notice)', () => {
    expect(showErrorNotice(undefined)).toBe(false)
    expect(showErrorNotice('')).toBe(false)
    expect(showErrorNotice('   ')).toBe(false)
  })
})

describe('showEmptyState (empty vs error-supersedes — design §3.1)', () => {
  it('is true for an empty list with no error', () => {
    expect(showEmptyState(0, undefined)).toBe(true)
  })

  it('is false when rows exist', () => {
    expect(showEmptyState(3, undefined)).toBe(false)
  })

  it('is false for an empty list WITH an error (the error notice supersedes the empty state)', () => {
    expect(showEmptyState(0, 'Reconnect.')).toBe(false)
  })
})

/* ------------------------------------------------------------------------- *
 * Generative layout width clamp (bug slack-generative-wrap-v1, Confluence latent instance)
 *
 * Regression: an agent-grouped Confluence list/detail rendered inside the SDK
 * standard-catalog Column/Row overflowed horizontally because that SDK flex container lacks
 * `min-w-0`, keeps `min-width: auto`, and grows to its content's intrinsic width — so a long
 * unbroken line never wrapped. The Confluence catalog now registers width-clamped Column/Row
 * wrappers. These tests would FAIL before the fix: the SDK container source carries NO clamp,
 * and there was no clamping wrapper around it. Mirrors the Slack catalog's regression.
 * ------------------------------------------------------------------------- */
describe('CONFLUENCE_LAYOUT_CLAMP_CLASS (generative wrap clamp)', () => {
  it('carries the width-clamp tokens that defeat the SDK flex intrinsic width', () => {
    // min-w-0 defeats flex `min-width: auto`; max-w-full caps at the panel width;
    // w-full keeps short content filling the column.
    expect(CONFLUENCE_LAYOUT_CLAMP_CLASS).toContain('min-w-0')
    expect(CONFLUENCE_LAYOUT_CLAMP_CLASS).toContain('max-w-full')
    expect(CONFLUENCE_LAYOUT_CLAMP_CLASS).toContain('w-full')
  })

  it('the raw SDK Column/Row container that caused the bug has NO width clamp', () => {
    // Root cause, asserted against the SDK source: its flex `<div>` className is a fixed
    // `flex flex-col gap-4` / `flex flex-row gap-3` with NO `min-w-0`/`max-w-full`. With
    // flex `min-width: auto` the container grows to its content's intrinsic width, so a
    // long unbroken line overflows instead of wrapping. (The SDK components require
    // SurfaceProvider context, so they can't be mounted in the node test env — we assert the
    // emitted className from source.) This test fails the day the SDK adds its own clamp,
    // signalling the wrapper is no longer needed.
    const sdkDir = '../../../../node_modules/@a2ui-sdk/react/dist/0.9/components/layout'
    const columnSrc = readFileSync(new URL(`${sdkDir}/ColumnComponent.js`, import.meta.url), 'utf8')
    const rowSrc = readFileSync(new URL(`${sdkDir}/RowComponent.js`, import.meta.url), 'utf8')
    expect(columnSrc).toContain('flex flex-col')
    expect(rowSrc).toContain('flex flex-row')
    expect(columnSrc).not.toContain('min-w-0')
    expect(rowSrc).not.toContain('min-w-0')
  })

  it('the Confluence catalog registers the clamped wrappers, not the raw SDK Column/Row', () => {
    // The fix: the catalog index imports Column/Row from ./layout (which apply the clamp)
    // instead of standardCatalog.components.Column/Row. Asserting the wiring is the
    // node-checkable proof the agent-grouped list is rendered inside the clamp box. Before
    // the fix the index registered the raw SDK containers directly.
    const indexSrc = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(indexSrc).toContain("from './layout'")
    expect(indexSrc).not.toContain('standardCatalog.components.Column')
    expect(indexSrc).not.toContain('standardCatalog.components.Row')

    // ...and the wrapper module applies the clamp class around the SDK container.
    const layoutSrc = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8')
    expect(layoutSrc).toContain('CONFLUENCE_LAYOUT_CLAMP_CLASS')
    expect(layoutSrc).toContain('standardCatalog.components.Column')
    expect(layoutSrc).toContain('standardCatalog.components.Row')
  })
})
