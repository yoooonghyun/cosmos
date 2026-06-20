import { describe, it, expect } from 'vitest'
import {
  SCROLL_AREA_VIEWPORT_CLASS,
  SCROLL_AREA_VIEWPORT_CONTENT_FIX
} from './scroll-area.classes'

/**
 * Regression guard for bug `slack-message-overflow-wrap-v1`.
 *
 * WHAT THIS PROVES: the wrap-enabling override on the Radix ScrollArea viewport's
 * inner content div is present in the class string the component applies. If a
 * future edit drops it (e.g. a shadcn `--overwrite` re-add regenerating the plain
 * viewport className), this fails.
 *
 * WHAT THIS DOES NOT PROVE: it does NOT assert the *rendered* layout actually wraps.
 * vitest runs in node with no jsdom (vitest.config.ts: `environment: 'node'`,
 * `include: ['src/**\/*.test.ts']`), so the `.tsx` ScrollArea cannot be mounted and
 * its computed width/wrapping cannot be observed here. The visual wrap must be
 * confirmed against the live GUI. This is the closest node-observable proxy: the
 * presence of the structural fix in the class contract.
 */
describe('ScrollArea viewport wrap fix (slack-message-overflow-wrap)', () => {
  it('overrides the Radix display:table content div with !block so text wraps', () => {
    // `!block` defeats the inline `display: table` Radix sets on the content child;
    // without it, whitespace-pre-wrap text shrink-wraps the table and overflows.
    expect(SCROLL_AREA_VIEWPORT_CONTENT_FIX).toContain('[&>div]:!block')
  })

  it('preserves the min-width:100% floor on the content div via !min-w-full', () => {
    // Keeps Radix's `min-width: 100%` so short content still fills the viewport
    // (scrollbar geometry unchanged) while `!block` lets long lines wrap.
    expect(SCROLL_AREA_VIEWPORT_CONTENT_FIX).toContain('[&>div]:!min-w-full')
  })

  it('uses !important on the overrides (Radix sets display:table as an INLINE style)', () => {
    // A non-important utility would lose to the inline style; every override token
    // in the fix must carry the `!` important marker.
    for (const token of SCROLL_AREA_VIEWPORT_CONTENT_FIX.split(/\s+/).filter(Boolean)) {
      expect(token).toMatch(/^\[&>div\]:!/)
    }
  })

  it('folds the content fix into the full viewport class the component applies', () => {
    expect(SCROLL_AREA_VIEWPORT_CLASS).toContain(SCROLL_AREA_VIEWPORT_CONTENT_FIX)
    // The base viewport styling (filling the box) is retained alongside the fix.
    expect(SCROLL_AREA_VIEWPORT_CLASS).toContain('size-full')
  })
})
