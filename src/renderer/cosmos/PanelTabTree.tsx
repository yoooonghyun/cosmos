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
  onUnpin
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
}): React.JSX.Element {
  // The right-click Pin/Unpin menu is wired only when the panel passes pin handlers.
  const menuEnabled = Boolean(onPin && onUnpin)
  // Renderer-local expand/collapse, default EXPANDED (survey-first; not persisted — out of scope).
  // We track the COLLAPSED set so a newly-published panel defaults to expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // The roving-active row key (the one `tabIndex={0}`).
  const [activeKey, setActiveKey] = useState<string | null>(null)

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
        default:
          break
      }
    },
    [rows, effectiveActive, toggleGroup, onActivate]
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
                          focused={effectiveActive === tabKey(group.panelId, tab.id)}
                          onActivate={() => onActivate(group, tab)}
                          onFocus={() => setActiveKey(tabKey(group.panelId, tab.id))}
                          menu={
                            menuEnabled
                              ? renderRowMenu({
                                  panelId: group.panelId,
                                  pinned,
                                  onPin: () => onPin?.(group, tab),
                                  onUnpin: () => onUnpin?.(group, tab)
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
 * Build a tab row's right-click menu CONTENT (cosmos-home-favorite-tabs-v1, design §2.2/§2.3). Every
 * row — generative OR terminal (cosmos-terminal-favorite-multiplex-v1 relaxed the FR-040 exclusion:
 * terminal tabs ARE pinnable now, as an xterm-multiplex mirror) — gets a single state-reflective
 * item: "Unpin" when pinned, "Pin" when not (FR-001/FR-002). `panelId` is retained for parity with
 * the row's `isPinned` signal even though the menu no longer special-cases it.
 */
function renderRowMenu(opts: {
  panelId: CrossPanelId
  pinned: boolean
  onPin: () => void
  onUnpin: () => void
}): React.ReactNode {
  return (
    <ContextMenuContent>
      {opts.pinned ? (
        <ContextMenuItem onSelect={opts.onUnpin}>Unpin</ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={opts.onPin}>Pin</ContextMenuItem>
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
  useEffect(() => {
    if (focused) {
      ref.current?.focus()
    }
  }, [focused])
  // cosmos-random-tab-icons-v1 (FR-010): the per-tab glyph, else the uniform AppWindow fallback.
  const LeafGlyph = Icon ?? AppWindow
  const row = (
    <div
      ref={ref}
      role="treeitem"
      aria-level={2}
      aria-selected={isSelected}
      tabIndex={focused ? 0 : -1}
      onClick={onActivate}
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
      <span className={cn('min-w-0 truncate', pinned && 'font-medium')}>{label}</span>
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
