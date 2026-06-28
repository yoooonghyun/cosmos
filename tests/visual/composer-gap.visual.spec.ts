/**
 * Composer→footer gap (bug terminal-broke-scroll-unify-redo-v1, Task 2).
 *
 * The docked Cosmos composer's distance to its name+status footer is controlled SOLELY by the
 * docked band's bottom padding (`pb-*`) in `app/SharedComposer.tsx`. The user reported the gap
 * looked unchanged; this measures the REAL rendered px gap (composer card bottom → footer top) so
 * code-vs-environment is provable, and locks the intended value so it cannot silently revert.
 *
 * The composer card is the docked `<form>` (`max-w-2xl rounded-lg … p-2`); the footer's visible
 * name strip carries `aria-label="Panel"`. gap = footerStrip.top − form.bottom = the band's `pb-*`
 * PLUS the footer's own constant ~6.25px top inset. With `pb-8` (2rem = 32px) the measured gap is
 * ~38px; with the OLD `pb-5` (20px) it was ~26px. Bumping pb moves the gap 1:1, so this locks the
 * larger (pb-8) breathing room so it cannot silently revert to the cramped pb-5 value.
 */
import { test, expect } from '@playwright/test'

// pb-8 (32px) + the PanelFooter's constant ~6.25px top inset = ~38.25px measured.
const EXPECTED_GAP_PX = 38

test.describe('cosmos composer→footer gap', () => {
  test('gap between composer card bottom and footer top equals the docked band pb', async ({
    page,
  }) => {
    await page.goto('/?scene=composer-gap')
    await page.waitForSelector('form')
    await page.waitForSelector('[aria-label="Panel"]')

    const formBottom = await page.$eval('form', (el) => el.getBoundingClientRect().bottom)
    const footerTop = await page.$eval('[aria-label="Panel"]', (el) => el.getBoundingClientRect().top)
    const gap = footerTop - formBottom

    // eslint-disable-next-line no-console
    console.log(`[composer-gap] form.bottom=${formBottom} footer.top=${footerTop} gap=${gap}px`)

    // The gap tracks the band's bottom padding (pb-8) and must be clearly larger than the old
    // cramped pb-5 (~26px) — the composer now has more breathing room above the footer.
    expect(gap, `measured gap=${gap}px`).toBeGreaterThan(EXPECTED_GAP_PX - 2)
    expect(gap, `measured gap=${gap}px`).toBeLessThan(EXPECTED_GAP_PX + 2)
  })
})
