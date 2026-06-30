/**
 * PanelTabTree — the Cosmos panel's right-column cross-panel tab survey
 * (cosmos-panel-tab-list-v1, design §2 / DESIGN.md D-15). A FileTree-idiom `role="tree"` that
 * lists, grouped by panel, the LIVE open tabs of the four generative panels + Terminal. Activating
 * a tab row does NOT navigate — it selects that panel + tab as the Cosmos composer's next-prompt
 * context (the selection state + submit wiring live in `CosmosPanel`; this component is presentational).
 *
 * Reuses `FileTree`'s exact roving-tabindex ARIA-tree keymap (FR-003): ↑/↓ + Home/End move focus,
 * →/← expand/collapse/descend/ascend a group, Enter/Space activate. THREE visually distinct row
 * states (D-15): hover `bg-accent`, roving focus thin `--ring`, and the PERSISTENT context-selected
 * state (leading `--brand-accent` inset bar + `bg-accent` + `font-medium` + `aria-selected`). The
 * source panel's active tab carries a leading `--brand-accent` dot (D-4).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ChevronRight, PanelsTopLeft } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { SURFACE_ICON, type RailIcon } from '../app/surfaceIcons'
import { tabIconComponent } from '../tabs/tabIconRegistry'
import { renameCommitDecision } from '../tabs/panelTabs'
import type { CrossPanelId, LivePanelTab, PanelTabGroup } from '../panelTabs'
import type { PromptPanelId } from '../../shared/promptContext/promptContext'

/** The currently context-selected tab (FR-016), or null. */
export interface PanelTabSelection {
  panelId: PromptPanelId
  tabId: string
}

/** A flattened visible row: a group header, or a tab row of an EXPANDED group. */
type VisibleRow =
  | { type: 'group'; key: string; group: PanelTabGroup; expanded: boolean }
  | { type: 'tab'; key: string; group: PanelTabGroup; tab: LivePanelTab }

const groupKey = (panelId: string): string => `group:${panelId}`
const tabKey = (panelId: string, tabId: string): string => `tab:${panelId}:${tabId}`

/**
 * Tab-row left indent (px). The group header carries two leading glyphs (chevron + panel icon), so
 * tab rows + the empty-group line indent deeper to read as nested under the panel label rather than
 * in front of it (user feedback). FileTree-style `depth*12 + 8` with depth 3.
 */
const TAB_INDENT = 3 * 12 + 8

export function PanelTabTree({
  groups,
  selected,
  onActivate,
  isPinned,
  onPin,
  onUnpin,
  canEditTab,
  onRenameTab,
  onDeleteTab
}: {
  groups: PanelTabGroup[]
  selected: PanelTabSelection | null
  onActivate: (group: PanelTabGroup, tab: LivePanelTab) => void
  /**
   * cosmos-home-favorite-tabs-v1 (FR-001/FR-002): whether the source panel+tab is currently pinned
   * as a Home favorite (drives the row's right-click menu Pin vs Unpin). Optional — when omitted (no
   * pin handlers wired) tab rows carry no menu. Terminal rows ARE pinnable too
   * (cosmos-terminal-favorite-multiplex-v1 relaxed FR-040).
   */
  isPinned?: (panelId: CrossPanelId, tabId: string) => boolean
  /** Pin a source tab as a favorite (FR-001/FR-010). */
  onPin?: (group: PanelTabGroup, tab: LivePanelTab) => void
  /** Unpin a source tab's favorite (FR-001/FR-004). */
  onUnpin?: (group: PanelTabGroup, tab: LivePanelTab) => void
  /**
   * cosmos-tree-tab-rename-delete-v1 (FR-001/FR-011): whether the source panel has published its
   * reverse tab commands (so Rename/Delete may act on it). When false/absent the row shows only
   * Pin/Unpin (graceful degrade — FR-011).
   */
  canEditTab?: (panelId: CrossPanelId) => boolean
  /**
   * cosmos-tree-tab-rename-delete-v1 (FR-004/FR-006): commit a trimmed rename to the source tab in
   * its own panel (routes to the panel's `update(id, { label, renamed: true })`). Fired only on a
   * non-empty commit — the pure `renameCommitDecision` gates empty/whitespace.
   */
  onRenameTab?: (group: PanelTabGroup, tab: LivePanelTab, label: string) => void
  /** cosmos-tree-tab-rename-delete-v1 (FR-005/FR-008): close the source tab immediately (no confirm). */
  onDeleteTab?: (group: PanelTabGroup, tab: LivePanelTab) => void
}): React.JSX.Element {
  // The right-click menu renders when EITHER pin handlers OR edit handlers are wired (FR-001).
  const menuEnabled = Boolean((onPin && onUnpin) || (onRenameTab && onDeleteTab))
  // Renderer-local expand/collapse, default EXPANDED (survey-first; not persisted — out of scope).
  // We track the COLLAPSED set so a newly-published panel defaults to expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // The roving-active row key (the one `tabIndex={0}`).
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // cosmos-tree-tab-rename-delete-v1 (FR-006/FR-007): the in-tree inline-rename state, lifted from
  // the PanelTabStrip idiom. At most ONE row edits at a time; `editingKey` is the row key
  // `tabKey(panelId,tabId)` + `draft` the live input. Routing through the SAME pure
  // `renameCommitDecision` (empty/whitespace ⇒ revert, no call).
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // After an edit ends, return roving focus to that row (parity with the strip's FR-016). Holds the
  // key to refocus once `editingKey` clears, then cleared so it does not re-fire.
  const refocusKeyRef = useRef<string | null>(null)

  const rows = useMemo<VisibleRow[]>(() => {
    const out: VisibleRow[] = []
    for (const group of groups) {
      const expanded = !collapsed.has(group.panelId)
      out.push({ type: 'group', key: groupKey(group.panelId), group, expanded })
      if (expanded) {
        for (const tab of group.tabs) {
          out.push({ type: 'tab', key: tabKey(group.panelId, tab.id), group, tab })
        }
      }
    }
    return out
  }, [groups, collapsed])

  // The effective roving row: the tracked one if still visible, else the first row.
  const effectiveActive =
    (activeKey && rows.some((r) => r.key === activeKey) ? activeKey : null) ?? rows[0]?.key ?? null

  const toggleGroup = useCallback((panelId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(panelId)) {
        next.delete(panelId)
      } else {
        next.add(panelId)
      }
      return next
    })
  }, [])

  // FR-006: enter inline edit for a tab row, seeding the draft from its current label.
  const beginEdit = useCallback((key: string, label: string): void => {
    setEditingKey(key)
    setDraft(label)
  }, [])

  // FR-006: commit the draft via the pure decision; fire onRenameTab only on a non-empty commit.
  const commitEdit = useCallback(
    (group: PanelTabGroup, tab: LivePanelTab): void => {
      const decision = renameCommitDecision(draft)
      if (decision.commit && decision.label !== undefined) {
        onRenameTab?.(group, tab, decision.label)
      }
      refocusKeyRef.current = tabKey(group.panelId, tab.id)
      setEditingKey(null)
      setDraft('')
    },
    [draft, onRenameTab]
  )

  // FR-006: cancel the edit (Escape) — nothing committed, revert to the source label.
  const cancelEdit = useCallback((group: PanelTabGroup, tab: LivePanelTab): void => {
    refocusKeyRef.current = tabKey(group.panelId, tab.id)
    setEditingKey(null)
    setDraft('')
  }, [])

  // FR-007/FR-011: cancel an in-progress edit when its row VANISHES (closed elsewhere / panel
  // unmounted) — pure revert, no commit, no throw (mirrors the strip's cancel-on-vanish effect).
  useEffect(() => {
    if (editingKey === null) {
      return
    }
    if (!rows.some((r) => r.key === editingKey)) {
      setEditingKey(null)
      setDraft('')
    }
  }, [rows, editingKey])

  // FR-006: after an edit ends, return roving focus to that row (strip-parity FR-016). Only when the
  // row still exists (a vanished row was handled above).
  useEffect(() => {
    if (editingKey !== null || refocusKeyRef.current === null) {
      return
    }
    const key = refocusKeyRef.current
    refocusKeyRef.current = null
    if (rows.some((r) => r.key === key)) {
      setActiveKey(key)
    }
  }, [editingKey, rows])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (rows.length === 0) {
        return
      }
      const idx = Math.max(0, rows.findIndex((r) => r.key === effectiveActive))
      const row = rows[idx]
      const move = (next: number): void => {
        e.preventDefault()
        setActiveKey(rows[Math.max(0, Math.min(rows.length - 1, next))].key)
      }
      switch (e.key) {
        case 'ArrowDown':
          move(idx + 1)
          break
        case 'ArrowUp':
          move(idx - 1)
          break
        case 'Home':
          move(0)
          break
        case 'End':
          move(rows.length - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          if (row.type === 'group') {
            if (!row.expanded) {
              toggleGroup(row.group.panelId) // collapsed → expand
            } else if (idx + 1 < rows.length && rows[idx + 1].type === 'tab') {
              setActiveKey(rows[idx + 1].key) // expanded → descend to first tab
            }
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (row.type === 'group' && row.expanded) {
            toggleGroup(row.group.panelId) // expanded → collapse
          } else if (row.type === 'tab') {
            setActiveKey(groupKey(row.group.panelId)) // tab → ascend to its header
          }
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (row.type === 'group') {
            toggleGroup(row.group.panelId)
          } else {
            onActivate(row.group, row.tab)
          }
          break
        case 'F2':
          // cosmos-tree-tab-rename-delete-v1 (keyboard parity with the strip's F2): begin inline
          // rename on a focused tab row whose panel published edit commands.
          if (row.type === 'tab' && (canEditTab?.(row.group.panelId) ?? false)) {
            e.preventDefault()
            beginEdit(row.key, row.tab.label)
          }
          break
        default:
          break
      }
    },
    [rows, effectiveActive, toggleGroup, onActivate, canEditTab, beginEdit]
  )

  // FR-021: no in-scope panel available → a single calm centered block (FileTree empty-root idiom).
  if (groups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <PanelsTopLeft className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-caption text-muted-foreground">No open tabs in other panels</p>
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div role="tree" aria-label="Open panel tabs" className="py-1" onKeyDown={onKeyDown}>
        {groups.map((group) => {
          const expanded = !collapsed.has(group.panelId)
          const PanelGlyph = SURFACE_ICON[group.panelId]
          const Chevron = expanded ? ChevronDown : ChevronRight
          return (
            <div key={group.panelId} role="presentation">
              <GroupHeaderRow
                label={group.label}
                Glyph={PanelGlyph}
                Chevron={Chevron}
                expanded={expanded}
                focused={effectiveActive === groupKey(group.panelId)}
                onActivate={() => toggleGroup(group.panelId)}
                onFocus={() => setActiveKey(groupKey(group.panelId))}
              />
              {expanded && (
                <div role="group">
                  {group.tabs.length === 0 ? (
                    // FR-020: a published panel with zero tabs → quiet "No open tabs" line.
                    <p
                      className="text-caption text-muted-foreground italic"
                      style={{ paddingLeft: TAB_INDENT }}
                    >
                      No open tabs
                    </p>
                  ) : (
                    group.tabs.map((tab) => {
                      // ONE source of truth for pinned-ness — the SAME signal the Pin/Unpin menu
                      // uses (cosmos-home-favorite-tabs-v1). Drives both the menu's Pin vs Unpin AND
                      // the additive row marking (text-primary icon + bold label, D-15). Applies to
                      // terminal rows too now (cosmos-terminal-favorite-multiplex-v1).
                      const pinned = isPinned?.(group.panelId, tab.id) ?? false
                      const rowKey = tabKey(group.panelId, tab.id)
                      const pinnable = Boolean(onPin && onUnpin)
                      const canEdit =
                        Boolean(onRenameTab && onDeleteTab) && (canEditTab?.(group.panelId) ?? false)
                      return (
                        <TabRow
                          key={tab.id}
                          label={tab.label}
                          // cosmos-random-tab-icons-v1 (FR-010): the leaf glyph is this tab's
                          // per-tab random glyph; an absent/unknown id falls back to AppWindow.
                          Icon={tabIconComponent(tab.iconId)}
                          pinned={pinned}
                          isSelected={
                            selected?.panelId === group.panelId && selected?.tabId === tab.id
                          }
                          focused={effectiveActive === rowKey}
                          // cosmos-tree-tab-rename-delete-v1 (FR-006/FR-007): inline-edit wiring.
                          editing={editingKey === rowKey}
                          draft={draft}
                          onDraftChange={setDraft}
                          onCommit={() => commitEdit(group, tab)}
                          onCancel={() => cancelEdit(group, tab)}
                          onActivate={() => onActivate(group, tab)}
                          onFocus={() => setActiveKey(rowKey)}
                          menu={
                            menuEnabled
                              ? renderRowMenu({
                                  pinnable,
                                  pinned,
                                  onPin: () => onPin?.(group, tab),
                                  onUnpin: () => onUnpin?.(group, tab),
                                  canEdit,
                                  // cosmos-tree-rename-not-working-v1: the PRIMARY fix is
                                  // `onCloseAutoFocus` preventDefault on the menu content (see
                                  // `renderRowMenu`) — that stops Radix yanking focus back to the
                                  // trigger and blurring the editor. This one-tick defer is kept as
                                  // belt-and-suspenders: it lets the closing menu's FocusScope fully
                                  // unmount BEFORE the input mounts + auto-focuses, so the two never
                                  // race. The F2 path has no menu-close, so it enters edit
                                  // synchronously (no defer needed there).
                                  onRename: () => setTimeout(() => beginEdit(rowKey, tab.label), 0),
                                  onDelete: () => onDeleteTab?.(group, tab)
                                })
                              : undefined
                          }
                        />
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/**
 * Build a tab row's right-click menu CONTENT (cosmos-home-favorite-tabs-v1 + cosmos-tree-tab-rename-
 * delete-v1, design §2.2/§2.3 / D-19). Pin/Unpin (the state-reflective toggle) comes first; then —
 * when the source panel published edit commands (`canEdit`, FR-011) — a separator and the
 * **Rename** + **Delete** pair. Every row (generative OR terminal) is pinnable AND editable now.
 * Rename begins an in-row inline edit (D-15); Delete is `variant="default"` — a benign, reopenable
 * close (X == unpin precedent, no confirm), NOT `destructive` (FR-008/FR-012).
 */
export function renderRowMenu(opts: {
  pinnable: boolean
  pinned: boolean
  onPin: () => void
  onUnpin: () => void
  canEdit: boolean
  onRename: () => void
  onDelete: () => void
}): React.ReactNode {
  return (
    // cosmos-tree-rename-not-working-v1 (ROOT-CAUSE fix): STOP Radix restoring focus to the row
    // trigger when this menu closes. By default Radix's DismissableLayer/FocusScope re-focuses the
    // trigger on close (`onCloseAutoFocus`), and that focus-restore runs on a LATER tick than the
    // `setTimeout(0)`-deferred `beginEdit` below — so it lands AFTER the inline-rename input has
    // mounted + auto-focused, blurring it → the input's `onBlur` commits → `editingKey` clears →
    // the editor closes before the user can type (the "flashes and closes" / "does nothing" runtime
    // break; jsdom never replicates the timing so the old test stayed green). This component already
    // owns roving focus itself (`refocusKeyRef` + the after-edit `setActiveKey` effect), so Radix's
    // auto-focus-restore is redundant; preventing it leaves the freshly-mounted input focused. The
    // Pin/Unpin/Delete paths open no input, so a no-op focus-restore there is harmless — the roving
    // row is still in the tree and the existing focus effects keep a sane active row.
    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
      {opts.pinnable &&
        (opts.pinned ? (
          <ContextMenuItem onSelect={opts.onUnpin}>Unpin</ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={opts.onPin}>Pin</ContextMenuItem>
        ))}
      {opts.canEdit && (
        <>
          <ContextMenuItem onSelect={opts.onRename}>Rename</ContextMenuItem>
          <ContextMenuItem onSelect={opts.onDelete}>Delete</ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}

/** A group header row: `role="treeitem" aria-level={1} aria-expanded` (design §2.2). */
function GroupHeaderRow({
  label,
  Glyph,
  Chevron,
  expanded,
  focused,
  onActivate,
  onFocus
}: {
  label: string
  Glyph: React.ComponentType<{ className?: string }>
  Chevron: React.ComponentType<{ className?: string }>
  expanded: boolean
  focused: boolean
  onActivate: () => void
  onFocus: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (focused) {
      ref.current?.focus()
    }
  }, [focused])
  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      tabIndex={focused ? 0 : -1}
      onClick={onActivate}
      onFocus={onFocus}
      style={{ paddingLeft: 8 }}
      className={cn(
        'flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-sm pr-2 text-body-sm font-medium text-foreground outline-none select-none',
        'hover:bg-accent',
        'focus-visible:ring-[1.5px] focus-visible:ring-ring focus-visible:ring-inset'
      )}
    >
      <Chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Glyph className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}

/**
 * A tab row: `role="treeitem" aria-level={2}` (design §2.3). Per user request the tree is a pure
 * PICKER — a click just reflects the selection into the composer's context chip; there is NO
 * persistent in-tree highlight (no active-source dot, no context-selected bar). `aria-selected`
 * still reflects the current selection for screen-reader users; it carries no visual.
 */
function TabRow({
  label,
  Icon,
  pinned,
  isSelected,
  focused,
  editing,
  draft,
  onDraftChange,
  onCommit,
  onCancel,
  onActivate,
  onFocus,
  menu
}: {
  label: string
  /**
   * cosmos-random-tab-icons-v1 (FR-010): this tab's per-tab glyph (resolved from its `iconId`),
   * or `undefined` ⇒ the uniform `AppWindow` fallback. Only the glyph SOURCE changes — the D-15
   * pinned `text-primary` tint + bold label and the selected/focus states are unchanged (FR-011).
   */
  Icon?: RailIcon
  /**
   * cosmos-home-favorite-tabs-v1 (D-15): this source tab ALREADY has a Home favorite. An additive,
   * purely-visual mark so the user can see which tabs are pinned — the leading icon takes the brand
   * accent (`text-primary`) and the label goes bold (`font-medium`). Driven by the SAME `isPinned`
   * signal the Pin/Unpin menu uses (one source of truth); applies to terminal rows too now
   * (cosmos-terminal-favorite-multiplex-v1).
   */
  pinned: boolean
  isSelected: boolean
  focused: boolean
  /**
   * cosmos-tree-tab-rename-delete-v1 (FR-006): this row is in inline-rename. The label `<span>` is
   * swapped for a borderless input seeded with `draft`; Enter/blur commit, Escape cancels.
   */
  editing: boolean
  draft: string
  onDraftChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  onActivate: () => void
  onFocus: () => void
  /**
   * cosmos-home-favorite-tabs-v1: the row's right-click Pin/Unpin menu CONTENT (a `ContextMenuContent`)
   * — when present the row is also a `ContextMenuTrigger` (native right-click + Shift+F10, FR-003).
   * Composed with the Tooltip via nested `asChild` slots so the roving-tabindex row stays the trigger.
   */
  menu?: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  // Don't steal focus to the row div while its inline input is editing (the input owns focus).
  useEffect(() => {
    if (focused && !editing) {
      ref.current?.focus()
    }
  }, [focused, editing])
  // cosmos-tree-tab-rename-delete-v1 (FR-006): on ENTERING edit, focus the input + select its text
  // ONCE (keyed on `editing` so a keystroke doesn't re-select — the strip's load-bearing fix).
  const editInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (editing) {
      const el = editInputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [editing])
  // cosmos-random-tab-icons-v1 (FR-010): the per-tab glyph, else the uniform AppWindow fallback.
  const LeafGlyph = Icon ?? AppWindow
  const row = (
    <div
      ref={ref}
      role="treeitem"
      aria-level={2}
      aria-selected={isSelected}
      tabIndex={focused ? 0 : -1}
      onClick={() => {
        // FR-006: a click while editing must not activate the row (select-context).
        if (editing) {
          return
        }
        onActivate()
      }}
      onFocus={onFocus}
      // Indent the tab rows clearly PAST the group header. The header carries TWO leading glyphs
      // (chevron + panel icon) so its label sits ~48px in; a tab row has ONE glyph, so it needs a
      // deeper indent (3*12+8 = 44 to its glyph, ~64 to its label) to read as nested rather than
      // sitting in front of the panel label. Matches the empty-group "No open tabs" line.
      style={{ paddingLeft: TAB_INDENT }}
      className={cn(
        'group/row relative flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm pr-2 text-body-sm text-foreground/90 outline-none select-none',
        'hover:bg-accent',
        'focus-visible:ring-[1.5px] focus-visible:ring-ring focus-visible:ring-inset'
      )}
    >
      <LeafGlyph
        // A pinned row's icon carries the brand accent (D-15). The row's hover/focus states recolor
        // only the BACKGROUND (`hover:bg-accent`) / ring — never the icon — so `text-primary` has no
        // competing icon-color state to flip against: a selected/hovered pinned row still reads pinned.
        // cosmos-random-tab-icons-v1 (FR-011): only the glyph SOURCE changes (per-tab vs uniform);
        // the pinned tint + every state class still applies to WHATEVER glyph renders.
        className={cn('size-3.5 shrink-0', pinned ? 'text-primary' : 'text-muted-foreground')}
        aria-hidden="true"
      />
      {editing ? (
        // cosmos-tree-tab-rename-delete-v1 (FR-006/D-15): a borderless input that BLENDS into the
        // row, reusing the strip's idiom — `field-sizing:content` auto-grows, focus+select once via
        // the effect above. stopPropagation so typing never activates the row or fires the tree
        // keymap; Enter/blur commit, Escape cancels.
        <input
          type="text"
          aria-label={`Rename ${label}`}
          value={draft}
          ref={editInputRef}
          onChange={(e) => onDraftChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => onCommit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              onCommit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          className="h-5 min-w-[1ch] max-w-[14rem] [field-sizing:content] border-0 bg-transparent p-0 text-body-sm leading-none text-foreground outline-none selection:bg-primary selection:text-primary-foreground"
        />
      ) : (
        <span className={cn('min-w-0 truncate', pinned && 'font-medium')}>{label}</span>
      )}
    </div>
  )
  // No menu → the existing Tooltip-only row.
  if (!menu) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }
  // With a menu → nest the two Radix `asChild` triggers (Tooltip + ContextMenu) onto the SAME row
  // div so it stays the roving-tabindex element AND gains native right-click / Shift+F10 (FR-003).
  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      {menu}
    </ContextMenu>
  )
}
