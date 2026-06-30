/**
 * panelTabsTree — pure derivations over the live cross-panel tab registry
 * (cosmos-panel-tab-list-v1). Framework-free + node-testable (no React/DOM), per the
 * `.ts`/`.test.ts` split.
 *
 *  - {@link toPanelTabGroups} shapes the {@link PanelTabsRegistry} into the ordered, labeled groups
 *    the tree renders (FR-005/FR-006/FR-008/FR-020/FR-022).
 *  - {@link reconcileSelectedContext} keeps a tree-click selection honest as tabs close/rename
 *    (FR-017) so a stale/dangling context is never carried into a submit.
 *
 * DEFENSIVE (FR-022, the project boundary rule): a malformed registry entry / tab is WARNED + SKIPPED
 * rather than crashing the tree.
 */

import type { CrossPanelId, LivePanelTab, PanelTabsRegistry } from './panelTabs'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import { isTabIconId } from '../../shared/tabIcons'

/** One labeled group of a panel's open tabs (the tree's level-1 node). */
export interface PanelTabGroup {
  panelId: CrossPanelId
  /** The panel's display label (e.g. "Jira", "Terminal") — from the caller's label map. */
  label: string
  /** Every open tab of this panel, in published order (FR-008). May be empty (FR-020). */
  tabs: LivePanelTab[]
  /** The active tab's id (FR-007), or `null`. */
  activeTabId: string | null
}

/** True for a non-empty string (a usable id/label). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** A single tab entry is well-formed iff it has a non-empty string id + label (FR-022). */
function validTab(value: unknown): value is LivePanelTab {
  if (!value || typeof value !== 'object') {
    return false
  }
  const tab = value as Record<string, unknown>
  return isNonEmptyString(tab.id) && isNonEmptyString(tab.label)
}

/**
 * Shape the registry into ordered groups for the tree (FR-005/FR-006/FR-008/FR-020/FR-022):
 *  - `order` fixes the group order (the rail order minus cosmos); a panel id is rendered ONCE.
 *  - A panel ABSENT from the registry (never published) OR explicitly `null` is OMITTED — the tree
 *    lists only panels actually available, matching rail visibility (FR-006).
 *  - A published panel with ZERO tabs yields an EMPTY group (the tree shows "No open tabs" — FR-020).
 *  - A malformed registry entry (not `{ tabs: [], activeTabId }`) or a malformed tab is WARNED +
 *    SKIPPED, never a crash (FR-022).
 *
 * Pure: the same inputs always yield the same groups. Never throws.
 */
export function toPanelTabGroups(
  registry: PanelTabsRegistry | null | undefined,
  order: readonly CrossPanelId[],
  labels: Record<CrossPanelId, string>,
  warn: (msg: string) => void = console.warn
): PanelTabGroup[] {
  if (!registry || typeof registry !== 'object') {
    warn('[panelTabsTree] toPanelTabGroups: missing registry; rendering no groups')
    return []
  }
  const groups: PanelTabGroup[] = []
  for (const panelId of order) {
    const entry = registry[panelId]
    // Absent / explicitly-null ⇒ the panel has not published (unmounted / disabled). Omit (FR-006).
    if (entry === undefined || entry === null) {
      continue
    }
    if (typeof entry !== 'object' || !Array.isArray((entry as { tabs?: unknown }).tabs)) {
      warn(`[panelTabsTree] toPanelTabGroups: malformed entry for "${panelId}"; skipping`)
      continue
    }
    const rawTabs = (entry as { tabs: unknown[] }).tabs
    const tabs: LivePanelTab[] = []
    for (const t of rawTabs) {
      if (validTab(t)) {
        // cosmos-random-tab-icons-v1 (FR-012): carry a VALID glyph id through; an unknown id is
        // simply omitted (the tree leaf falls back to AppWindow). Keeps the pure/defensive contract.
        tabs.push({
          id: t.id,
          label: t.label,
          ...(isTabIconId(t.iconId) ? { iconId: t.iconId } : {})
        })
      } else {
        warn(`[panelTabsTree] toPanelTabGroups: skipping a malformed tab in "${panelId}"`)
      }
    }
    const activeRaw = (entry as { activeTabId?: unknown }).activeTabId
    const activeTabId = isNonEmptyString(activeRaw) ? activeRaw : null
    groups.push({ panelId, label: labels[panelId], tabs, activeTabId })
  }
  return groups
}

/**
 * Keep a tree-click selection honest against the LIVE groups (FR-017). Given the currently selected
 * panel+tab `PromptContext` and the live groups:
 *  - no selection (or a selection without a `tab`) ⇒ returned unchanged.
 *  - the selected panel is gone, or its selected tab id is no longer open ⇒ CLEARED (`null`) so a
 *    closed selection never embeds a stale/dangling context in the next submit.
 *  - the selected tab still exists but its LABEL changed ⇒ a NEW context with the fresh label.
 *  - nothing changed ⇒ the SAME `selected` reference (so a caller's `useEffect`/`setState` can skip
 *    a redundant update).
 *
 * Pure. Never throws.
 */
export function reconcileSelectedContext(
  selected: PromptContext | null,
  groups: PanelTabGroup[]
): PromptContext | null {
  if (!selected || !selected.tab) {
    return selected
  }
  const group = groups.find((g) => g.panelId === selected.panel.id)
  if (!group) {
    return null // panel gone (disabled / unmounted) → clear (no dangling context)
  }
  const tab = group.tabs.find((t) => t.id === selected.tab!.id)
  if (!tab) {
    return null // tab closed → clear
  }
  if (tab.label === selected.tab.label) {
    return selected // unchanged → preserve reference
  }
  // tab renamed → reflect the new label (FR-017).
  return { ...selected, tab: { id: selected.tab.id, label: tab.label } }
}
