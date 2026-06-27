/**
 * cosmos visual/layout tests — Playwright asserting COMPUTED LAYOUT, not class strings.
 *
 * These tests exist because class-presence unit tests (vitest/node) pass even when the
 * actual rendered pixels are wrong. The regressions caught here include:
 *   - Per-list scroll collapsing into one unified outer scroll (flex-wrap/content-start)
 *   - Header rendering beside a list instead of above it
 *   - PDF viewer showing a blank canvas
 *
 * Run with: npm run test:visual
 * The Playwright config (playwright.visual.config.ts) starts the Vite test-app server
 * automatically. No Electron, no Slack tokens, no agent required.
 */

import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Per-list independent scroll
// ---------------------------------------------------------------------------
//
// INVARIANT (feedback-slack-per-list-scroll, memory: load-bearing):
//   Two message lists inside the SLACK_LAYOUT_FILL_CLASS + SLACK_LIST_SCROLL_CLASS chain
//   must be SIDE-BY-SIDE (same top, different left, each ~half width), each be its OWN
//   scroll container (scrollHeight > clientHeight, independent scrollTop), and together
//   FILL the panel height (no collapse to one unified outer scroll).
//
// Goes RED if someone adds flex-wrap/content-start to SLACK_LAYOUT_FILL_CLASS.

test.describe('per-list independent scroll', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?scene=per-list-scroll')
    // Wait until both lists are in the DOM and have rendered content
    await page.waitForSelector('[data-testid="list-a"]')
    await page.waitForSelector('[data-testid="list-b"]')
  })

  test('two lists are side-by-side (same top, different left)', async ({ page }) => {
    const rectA = await page.$eval('[data-testid="list-a"]', (el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, right: r.right, width: r.width, height: r.height }
    })
    const rectB = await page.$eval('[data-testid="list-b"]', (el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, right: r.right, width: r.width, height: r.height }
    })

    // Lists share the same top (side-by-side, not stacked)
    expect(Math.abs(rectA.top - rectB.top)).toBeLessThan(4)

    // List B starts to the right of list A
    expect(rectB.left).toBeGreaterThan(rectA.left + 10)

    // Each list has meaningful width (at least 30% of panel)
    const panelWidth = 800
    expect(rectA.width).toBeGreaterThan(panelWidth * 0.3)
    expect(rectB.width).toBeGreaterThan(panelWidth * 0.3)
  })

  test('each list is its own scroll container (scrollHeight > clientHeight)', async ({ page }) => {
    const scrollA = await page.$eval('[data-testid="list-a"]', (el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    const scrollB = await page.$eval('[data-testid="list-b"]', (el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))

    // Each list must overflow its container — content is taller than the visible area
    expect(scrollA.scrollHeight).toBeGreaterThan(scrollA.clientHeight)
    expect(scrollB.scrollHeight).toBeGreaterThan(scrollB.clientHeight)
  })

  test('lists have independent scrollTop (scrolling one does not move the other)', async ({
    page,
  }) => {
    // Scroll list-a to the bottom
    await page.$eval('[data-testid="list-a"]', (el) => {
      el.scrollTop = el.scrollHeight
    })

    const scrollTopA = await page.$eval('[data-testid="list-a"]', (el) => el.scrollTop)
    const scrollTopB = await page.$eval('[data-testid="list-b"]', (el) => el.scrollTop)

    // A is scrolled, B is not
    expect(scrollTopA).toBeGreaterThan(0)
    expect(scrollTopB).toBe(0)
  })

  test('lists fill the panel height (no dead gap, no unified outer scroll)', async ({ page }) => {
    const panelHeight = 600 // matches PerListScrollScene fixed height

    const heightA = await page.$eval('[data-testid="list-a"]', (el) => el.clientHeight)
    const heightB = await page.$eval('[data-testid="list-b"]', (el) => el.clientHeight)

    // Each list's clientHeight should be close to the panel height
    // (they fill their share of the flex column; with one list per side they each get ~100%)
    // Allow 10% tolerance for padding/gap.
    expect(heightA).toBeGreaterThan(panelHeight * 0.85)
    expect(heightB).toBeGreaterThan(panelHeight * 0.85)

    // The panel host itself must NOT be a scroll container —
    // unified outer scroll would mean the host has scrollHeight > clientHeight.
    const hostScroll = await page.$eval('[data-testid="panel-host"]', (el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    // Host overflow must NOT exceed its own clientHeight (per-list scroll, not outer scroll).
    // We allow a tiny tolerance for sub-pixel rounding.
    expect(hostScroll.scrollHeight).toBeLessThanOrEqual(hostScroll.clientHeight + 4)
  })
})

// ---------------------------------------------------------------------------
// Initial scroll-to-latest
// ---------------------------------------------------------------------------
//
// INVARIANT: a long message list (newest-at-bottom) must be scrolled to the
// BOTTOM on first render so the user sees the latest messages immediately.

test.describe('initial scroll-to-latest', () => {
  test('message list is scrolled to the bottom on first render', async ({ page }) => {
    await page.goto('/?scene=scroll-to-latest')
    await page.waitForSelector('[data-testid="message-list"]')

    // useSlackScrollToLatest uses useLayoutEffect, which fires before paint.
    // By the time Playwright receives the DOM the scroll should already be at the bottom.
    // We wait a tick for React to settle just in case.
    await page.waitForTimeout(100)

    const scroll = await page.$eval('[data-testid="message-list"]', (el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))

    // scrollTop + clientHeight should equal scrollHeight (at bottom), allowing 2px rounding.
    const distanceFromBottom = scroll.scrollHeight - (scroll.scrollTop + scroll.clientHeight)
    expect(distanceFromBottom).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// PDF renders (not blank)
// ---------------------------------------------------------------------------
//
// INVARIANT: PdfView must render at least one page canvas with non-zero size.
// Goes RED if the pdf.js worker is not served or react-pdf fails to mount.

test.describe('PDF renders with non-zero canvas', () => {
  test('fixture PDF produces at least one canvas with non-zero dimensions', async ({ page }) => {
    await page.goto('/?scene=pdf')

    // Wait for the document to load (sentinel element inserted when numPages > 0).
    // Use state:'attached' because the sentinel is aria-hidden / zero-height.
    await page.waitForSelector('[data-testid="pdf-loaded"]', { state: 'attached', timeout: 15_000 })

    // Verify no load error was reported
    const errorEl = await page.$('[data-testid="pdf-error"]')
    expect(errorEl).toBeNull()

    // react-pdf renders each page as a <canvas> inside a .react-pdf__Page element.
    // Wait for at least one canvas to appear.
    const canvas = await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 10_000 })
    expect(canvas).not.toBeNull()

    // Assert the canvas has non-zero rendered dimensions.
    const dims = await canvas.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })
    expect(dims.width).toBeGreaterThan(0)
    expect(dims.height).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Channel name ABOVE list (FIXME — next layout target)
// ---------------------------------------------------------------------------
//
// DESIRED INVARIANT: when a Column contains [Text(channelName), MessageList],
// the header must be ABOVE the list (header.bottom <= list.top).
//
// This test is marked fixme because the current SLACK_LAYOUT_FILL_CLASS uses
// [&>*]:!flex-row which forces ALL children of the SDK Column to lay out
// SIDE-BY-SIDE — meaning the header renders BESIDE the list, not above it.
//
// The fix requires a careful layout change that preserves per-list independent
// scroll (the load-bearing invariant above). DO NOT attempt to make this pass
// by adding flex-wrap or content-start to SLACK_LAYOUT_FILL_CLASS — that
// was the regression that caused per-list scroll to collapse.
//
// When this test goes GREEN, the per-list-scroll suite above MUST still pass.

test.describe('channel name above list (target invariant)', () => {
  test.fixme(
    'channel header bottom edge is at or above message list top edge',
    async ({ page }) => {
      await page.goto('/?scene=channel-name-above-list')
      await page.waitForSelector('[data-testid="channel-header"]')
      await page.waitForSelector('[data-testid="message-list"]')

      const headerRect = await page.$eval('[data-testid="channel-header"]', (el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left }
      })
      const listRect = await page.$eval('[data-testid="message-list"]', (el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left }
      })

      // Header must be ABOVE the list: header.bottom <= list.top
      // (allowing 2px rounding tolerance)
      expect(headerRect.bottom).toBeLessThanOrEqual(listRect.top + 2)
    }
  )
})
