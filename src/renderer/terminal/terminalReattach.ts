/**
 * Pure reconcile logic for the dev wake-reload reattach handshake
 * (cosmos-dev-wake-reload-session-survival-v1, D4/FR-011/OQ-2).
 *
 * On a renderer reload main keeps the live PTY sessions alive; the reloaded renderer
 * queries `pty:listLive` and reconciles its rehydrated tabs against main's live set:
 *
 *  - A hydrated tab whose id IS live  → SURVIVOR: it already `autoStart`s (it was in the
 *    restored snapshot) and, because `PtyManager.start` is idempotent, that re-issued
 *    `pty:start` REATTACHES rather than respawns. No adoption needed.
 *  - A hydrated (restored) tab NOT live → resumes via the existing `autoStart`/exit-banner
 *    path (its session legitimately isn't running — e.g. first launch after a real quit).
 *  - A LIVE paneId with NO hydrated tab → ADOPT: the pane was minted AFTER the last
 *    (debounced, possibly stale) snapshot save, so its tab isn't in the rehydrated set.
 *    Without adoption its surviving session would be orphaned (no tab, no reattach). We
 *    create a tab bound to that paneId so nothing is left unreferenced (FR-011).
 *
 * This module is PURE (no React/IPC) so the reconcile decision is node-testable in
 * isolation; the panel does the imperative tab creation from the returned ids.
 */

/**
 * Decide which live paneIds must be ADOPTED as new tabs — the live sessions that have no
 * matching hydrated tab. Order is preserved from `livePaneIds`. Survivors (a live pane that
 * already has a hydrated tab) are NOT adopted — they reattach via their existing tab's
 * idempotent `autoStart`.
 */
export function planReattach(
  hydratedTabIds: readonly string[],
  livePaneIds: readonly string[]
): { adopt: string[] } {
  const tabs = new Set(hydratedTabIds)
  const adopt: string[] = []
  const seen = new Set<string>()
  for (const paneId of livePaneIds) {
    // De-dupe defensively (a malformed snapshot could repeat an id) and skip any already
    // represented by a hydrated tab.
    if (tabs.has(paneId) || seen.has(paneId)) {
      continue
    }
    seen.add(paneId)
    adopt.push(paneId)
  }
  return { adopt }
}
