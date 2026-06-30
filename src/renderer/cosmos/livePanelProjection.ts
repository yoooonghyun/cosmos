/**
 * livePanelProjection — the PURE per-tab projection from a generative panel's live tab record
 * to the published {@link LivePanelTab} the cross-panel registry carries
 * (cosmos-native-view-mirror-surface-v1, D2). Framework-free + node-testable (no React/DOM
 * import — only erased `import type`s), per the `.ts`/`.test.ts` split.
 *
 * THE MUTUAL-EXCLUSIVITY RULE (OQ-4 / FR-007). A favorite resolves `mirrorSurface ?? surface`,
 * so to make the favorite always show EXACTLY what the source shows, the publish projection
 * publishes them mutually exclusively:
 *
 *   - a COMPOSED surface present (`surface` non-null) → `mirrorSurface: null`
 *     ⇒ the favorite resolves to the composed surface (native mirror suppressed);
 *   - a NATIVE view (`surface` null) → carry the stored `mirrorSurface`
 *     ⇒ the favorite resolves to the native mirror (or WAITING when both are null).
 *
 * So even a stale `mirrorSurface` lingering on the tab record from before a compose can never
 * mask the composed surface — robust by construction.
 */

import type { TabSurface } from '../tabs/useGenerativePanelTabs'

/** The minimal live-tab slice the projection reads (a structural subset of `GenerativeTab`). */
export interface ProjectableTab {
  id: string
  label: string
  /** The agent-COMPOSED surface, or null/absent while the source browses natively. */
  surface?: TabSurface | null
  /** The favorite-only NATIVE-VIEW mirror surface (Confluence/Slack), or null/absent. */
  mirrorSurface?: TabSurface | null
}

/** The published per-tab shape (a structural subset of `LivePanelTab` for the generative panels). */
export interface ProjectedLiveTab {
  id: string
  label: string
  surface: TabSurface | null
  mirrorSurface: TabSurface | null
}

/**
 * Project one live generative tab to its published form, applying the mutual-exclusivity rule:
 * `mirrorSurface: surface ? null : (mirrorSurface ?? null)`. Pure; never throws.
 */
export function projectLivePanelTab(tab: ProjectableTab): ProjectedLiveTab {
  const surface = tab.surface ?? null
  return {
    id: tab.id,
    label: tab.label,
    surface,
    mirrorSurface: surface ? null : (tab.mirrorSurface ?? null)
  }
}
