/**
 * cosmosSelectedContext — pure mapper from a Cosmos panel-tab TREE selection to the composer's
 * `kind: 'panel-tab'` context chip (cosmos-panel-tab-list-v1, design §3.2/§3.4). Framework-free +
 * node-testable (no React/DOM), per the `.ts`/`.test.ts` split.
 *
 * SECURITY (FR-011): only the non-secret panel id/label + tab id/label cross — never a token,
 * secret, path, or dock value. A tree selection v1 carries panel + tab ONLY (no dock, FR-018).
 */

import type { PromptContext } from '../../shared/promptContext/promptContext'
import type { PanelTabContextChip } from '../app/viewContextCapture'

/**
 * Build the composer's panel+tab chip descriptor from the current tree selection, or `undefined`
 * when there is nothing to show — no selection, or a (defensive) selection missing its `tab`
 * (a tree selection always names a tab; a panel-only context yields no chip). Pure; never throws.
 */
export function panelTabChipFor(
  selected: PromptContext | null | undefined
): PanelTabContextChip | undefined {
  if (!selected || !selected.tab) {
    return undefined
  }
  return {
    kind: 'panel-tab',
    panel: { id: selected.panel.id, label: selected.panel.label },
    tab: { id: selected.tab.id, label: selected.tab.label }
  }
}
