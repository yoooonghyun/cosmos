/**
 * PURE terminal resize-arbitration predicate (cosmos-terminal-favorite-multiplex-v1, FR-011/FR-012).
 * Framework-free (no React/DOM construction — only reads two layout props), so it is node-testable
 * per the `.ts`/`.test.ts` split.
 *
 * A `paneId` may now have MORE THAN ONE bound xterm view (the source Terminal pane + a Home favorite
 * mirror). Both share one PTY, but only ONE is on-screen (measurable) at a time. A hidden / zero-size
 * view must NOT drive `pty:resize` — otherwise the off-screen view would push a stale/competing size
 * and the `claude` TUI mis-fits. This predicate gates every terminal view's resize so ONLY the
 * measurable (on-screen) view ever resizes the PTY, making the source↔favorite arbitration race-free
 * (the visible view is always the last writer). It also fixes a latent bug for ALL terminals: a
 * hidden terminal previously resized the PTY because `safeFit()` swallowed the unmeasurable-fit throw
 * but the resize still fired.
 */
export function shouldDriveResize(container: HTMLElement | null | undefined): boolean {
  return !!container && container.clientWidth > 0 && container.clientHeight > 0
}
