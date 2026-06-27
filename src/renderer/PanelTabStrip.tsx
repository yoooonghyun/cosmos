/**
 * PanelTabStrip — the reusable VS Code-style tab strip shared by all five rail
 * panels (panel-tabs v1, Track B / Phase 5). Built verbatim to the design contract
 * `.sdd/designs/panel-tabs-v1.md` (§2 layout, §3 states, §4 affordances, §5 exact
 * classes, §7 a11y). It is a bespoke composite over existing primitives (`Button`,
 * `Tooltip`) + raw `role=tab` elements — NOT the shadcn `Tabs` primitive (design §9).
 *
 * Generic over tab kind: a panel passes a flat list of `PanelTab` descriptors plus
 * `onActivate` / `onClose` / `onNewTab` callbacks. Terminal vs generative styling is
 * driven by `kind` + per-tab `status` so one component serves every panel.
 *
 * Spec trace: FR-002 (strip, active distinguished), FR-003 (click activates),
 * FR-004 (per-tab close), FR-005 (new-tab `+`), FR-006/FR-007 (adjacent on
 * Delete/Backspace via onClose), FR-008 (overflow horizontal scroll, `+` pinned),
 * FR-009 (Untitled italic-muted), FR-010 (truncated utterance label + tooltip),
 * FR-011 (terminal glyph + "Terminal N"), FR-014 (in-flight Loader2 + aria-busy),
 * FR-015 (error CircleAlert + destructive tint + tooltip message).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CircleAlert, Loader2, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { renameCommitDecision } from './panelTabs'

/** A tab's lifecycle status as surfaced on the strip (design §3). */
export type PanelTabStatus = 'idle' | 'in-flight' | 'error'

/** A tab's kind — drives the leading glyph + label treatment (design §3.4/§3.5). */
export type PanelTabKind = 'generative' | 'terminal'

/** A single tab descriptor the panel hands to the strip (one per open tab). */
export interface PanelTab {
  /** Stable tab id (the generative tab id, or the terminal `paneId`). */
  id: string
  /** Visible label: the (truncated-by-CSS) utterance, "Untitled", or "Terminal N". */
  label: string
  /** generative vs terminal — selects glyph + label styling. Defaults to generative. */
  kind?: PanelTabKind
  /** Lifecycle status (generative only; terminal tabs are always idle — design §3.6). */
  status?: PanelTabStatus
  /** True for a `+`-created, not-yet-composed generative tab → italic-muted (FR-009). */
  untitled?: boolean
  /** Error message for the tooltip when `status === 'error'` (FR-015). */
  errorMessage?: string
  /**
   * Whether this tab shows a close `X` (cosmos-conversation-panel-v2 FR-114). Defaults to
   * `true` (the existing per-tab close affordance). The Cosmos pinned DEFAULT tab passes
   * `false` so it has NO close affordance and cannot be closed by click/keyboard. Purely
   * additive: the four generative panels + terminal omit it ⇒ closeable, unchanged.
   */
  closeable?: boolean
}

export interface PanelTabStripProps {
  /** The open tabs, in order. */
  tabs: PanelTab[]
  /** The active tab id (null when zero tabs — only the `+` shows). */
  activeTabId: string | null
  /** Click / Enter / Space activates a tab (FR-003). */
  onActivate: (tabId: string) => void
  /** `X` click or Delete/Backspace closes a tab (FR-004/FR-006). */
  onClose: (tabId: string) => void
  /**
   * `+` opens a new tab (FR-005). OPTIONAL: when omitted the pinned `+` is not rendered
   * (cosmos-conversation-panel-v2 — the Cosmos panel has no new-tab affordance in step 3;
   * favorites are out of scope). The four generative panels + terminal always pass it.
   */
  onNewTab?: () => void
  /**
   * A committed inline rename (tab-rename-v1 FR-019): the strip reports the new,
   * trimmed `label` and the panel persists it (label + `renamed`) into its own tab
   * record. Called ONLY on a non-empty commit (an empty/whitespace commit reverts
   * silently and never fires this). Optional — a panel without it simply has no
   * rename affordance.
   */
  onRename?: (tabId: string, label: string) => void
  /**
   * panel-refresh-v1 (design §1/§7): an optional chrome node rendered in the trailing,
   * NON-SCROLLING cluster, immediately LEFT of the pinned `+` (DOM + Tab order:
   * `…tabs → trailing → +`). The strip owns the cluster geometry; the node carries its own
   * `border-l`/`rounded-none` so the cluster reads as one segmented unit. Used to mount the
   * shared `PanelRefreshButton`. It is a sibling of the `role="tablist"` list, NOT a
   * `role="tab"`, so it never interferes with the roving-tabindex tab navigation.
   */
  trailing?: React.ReactNode
  /** Accessible name for the tablist, e.g. "Slack tabs" (design §7). */
  ariaLabel: string
}

/** Move keyboard focus to the tab button at `index` (roving tabindex, design §7). */
function focusTabAt(listEl: HTMLElement | null, index: number): void {
  if (!listEl) {
    return
  }
  const buttons = listEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  const target = buttons[index]
  if (target) {
    target.focus()
  }
}

export function PanelTabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNewTab,
  onRename,
  trailing,
  ariaLabel
}: PanelTabStripProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null)
  // tab-rename-v1: at most ONE tab is editable at a time (FR-012). The edit is purely
  // presentational/local strip state — the panel owns the committed label (FR-019).
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // The id we just committed/cancelled, so the post-edit effect returns focus to that
  // tab's <button> (FR-016: focus returns to the tab on commit/cancel) without keeping
  // a stale ref around once focus has landed.
  const refocusTabIdRef = useRef<string | null>(null)

  // The live rename input, focused + selected ONCE on entering edit mode (see effect).
  const editInputRef = useRef<HTMLInputElement | null>(null)

  // FR-013: cancel an in-progress edit when the edited tab disappears (closed) or the
  // active tab changes away from it (a new run / a tab switch). Pure revert — drop the
  // edit state; the panel's label is untouched because nothing was committed.
  useEffect(() => {
    if (editingTabId === null) {
      return
    }
    const stillPresent = tabs.some((t) => t.id === editingTabId)
    if (!stillPresent || activeTabId !== editingTabId) {
      setEditingTabId(null)
      setDraft('')
    }
  }, [tabs, activeTabId, editingTabId])

  // After an edit ends, return keyboard focus to the tab button (roving-tabindex
  // parity, FR-016). Runs once editingTabId clears and a refocus target was recorded.
  useEffect(() => {
    if (editingTabId !== null || refocusTabIdRef.current === null) {
      return
    }
    const id = refocusTabIdRef.current
    refocusTabIdRef.current = null
    const index = tabs.findIndex((t) => t.id === id)
    if (index !== -1) {
      focusTabAt(listRef.current, index)
    }
  }, [editingTabId, tabs])

  // FR-002: on ENTERING edit mode, focus the input and select its text exactly ONCE.
  // (A ref callback calling select() on every render re-selected the text on each
  // keystroke, so typing kept overwriting the whole value.) Keyed on the edited tab id
  // so it fires once per edit session, not on every `draft` change.
  useEffect(() => {
    if (editingTabId !== null) {
      const el = editInputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [editingTabId])

  /** Enter edit mode for `tabId`, seeding the draft from its current label (FR-001/002). */
  const beginEdit = (tabId: string, label: string): void => {
    // FR-012: at most one editing tab — starting an edit replaces any prior one
    // (the prior input's blur commits it first as it loses focus).
    setEditingTabId(tabId)
    setDraft(label)
  }

  /** Commit the draft via the pure decision; fire onRename only on a non-empty commit (FR-003/005). */
  const commitEdit = (tabId: string): void => {
    const decision = renameCommitDecision(draft)
    if (decision.commit && decision.label !== undefined) {
      onRename?.(tabId, decision.label)
    }
    refocusTabIdRef.current = tabId
    setEditingTabId(null)
    setDraft('')
  }

  /** Cancel the edit, restoring the pre-edit label (FR-004 — nothing committed). */
  const cancelEdit = (tabId: string): void => {
    refocusTabIdRef.current = tabId
    setEditingTabId(null)
    setDraft('')
  }

  // design §7: manual-activation roving tablist. Arrow/Home/End move focus only;
  // Enter/Space activate; Delete/Backspace close (adjacent-activation via onClose).
  // F2 enters rename on the focused tab (tab-rename-v1 FR-014, design §6.4).
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    tab: PanelTab
  ): void => {
    const tabId = tab.id
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusTabAt(listRef.current, Math.min(index + 1, tabs.length - 1))
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusTabAt(listRef.current, Math.max(index - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        focusTabAt(listRef.current, 0)
        break
      case 'End':
        event.preventDefault()
        focusTabAt(listRef.current, tabs.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onActivate(tabId)
        break
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        onClose(tabId)
        break
      case 'F2':
        // Rename the focused tab, only if the panel wired onRename (FR-014).
        if (onRename) {
          event.preventDefault()
          // Editing implies the active treatment (design §3.2); activate it first.
          onActivate(tabId)
          beginEdit(tabId, tab.label)
        }
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // design §5: strip container — fixed 32px band, popover bg, bottom border.
      className="flex h-8 shrink-0 select-none items-stretch border-b border-border bg-popover"
    >
      {/* design §2.1: the only scrolling region (overflow-x-auto), `+` is outside it. */}
      <div
        ref={listRef}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((t, index) => {
          const isActive = t.id === activeTabId
          const isEditing = t.id === editingTabId
          const kind = t.kind ?? 'generative'
          const status = t.status ?? 'idle'
          const isTerminal = kind === 'terminal'
          const tooltip =
            status === 'error' && t.errorMessage
              ? `Run failed: ${t.errorMessage}`
              : t.label

          return (
            <Tooltip key={t.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  // design §7: roving tabindex — active is 0, others -1.
                  tabIndex={isActive ? 0 : -1}
                  // Editing implies the active treatment (design §3.2): force bg-background.
                  data-state={isActive || isEditing ? 'active' : 'inactive'}
                  data-status={status}
                  {...(status === 'in-flight' ? { 'aria-busy': true } : {})}
                  title={tooltip}
                  onClick={() => {
                    // FR-010/FR-011: while editing, the cell click must not activate/close.
                    if (isEditing) {
                      return
                    }
                    onActivate(t.id)
                  }}
                  onKeyDown={(e) => handleTabKeyDown(e, index, t)}
                  className={cn(
                    // §5 Tab (base)
                    'group/tab relative flex h-full min-w-0 max-w-[16rem] cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    // §5 Tab inactive
                    'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                    // §5 Tab active (darker, primary top-accent, owns its edges, bold label)
                    'data-[state=active]:border-r-transparent data-[state=active]:bg-background data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:before:absolute data-[state=active]:before:inset-x-0 data-[state=active]:before:top-0 data-[state=active]:before:h-0.5 data-[state=active]:before:bg-gradient-to-r data-[state=active]:before:from-brand-pink data-[state=active]:before:to-brand-purple',
                    // §5 Tab error (label tint)
                    'data-[status=error]:text-destructive'
                  )}
                >
                  {/* Leading slot (mutually-exclusive): in-flight spinner | error glyph |
                      terminal glyph. Decorative — the busy/error semantics live on the
                      button (aria-busy / tooltip). design §3.2/§3.3/§3.4. */}
                  {status === 'in-flight' ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                  ) : status === 'error' ? (
                    <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  ) : isTerminal ? (
                    <SquareTerminal
                      className="size-3.5 shrink-0 text-muted-foreground group-data-[state=active]/tab:text-foreground"
                      aria-hidden="true"
                    />
                  ) : null}

                  {/* Label — truncates with ellipsis (FR-010); Untitled is italic-muted
                      even when active (FR-009 / design §3.5). Double-click enters inline
                      rename (tab-rename-v1 FR-001); cursor-text hints editability (§3.4).
                      While THIS tab edits, the label <span> is replaced by the input. */}
                  {isEditing ? (
                    // design §5: borderless inline input that BLENDS into the tab cell —
                    // no box/ring, transparent bg. `field-sizing:content` (Chromium 123+)
                    // auto-grows the input from the label's width to a max cap as the text
                    // grows (handles CJK width natively), so the tab never jumps wider than
                    // its name. Focus + select-all happen once via the effect above (FR-002).
                    // stopPropagation so editing never activates/closes the cell (FR-010);
                    // Enter/blur commit, Escape cancels (FR-003/004).
                    <input
                      type="text"
                      aria-label={`Rename ${t.label}`}
                      value={draft}
                      ref={editInputRef}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onBlur={() => commitEdit(t.id)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit(t.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit(t.id)
                        }
                      }}
                      className="h-5 min-w-[1ch] max-w-[14rem] [field-sizing:content] border-0 bg-transparent p-0 text-[13px] leading-none text-foreground outline-none selection:bg-primary selection:text-primary-foreground"
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        if (!onRename) {
                          return
                        }
                        // FR-010/FR-011: stop the underlying single-click activate from
                        // leaving the tab half-toggled; enter rename instead.
                        e.stopPropagation()
                        onActivate(t.id)
                        beginEdit(t.id, t.label)
                      }}
                      className={cn(
                        'min-w-0 truncate',
                        onRename && 'cursor-text',
                        t.untitled && 'italic text-muted-foreground'
                      )}
                    >
                      {t.label}
                    </span>
                  )}

                  {/* Close X — nested ghost button; hidden until hover/active/focus
                      (design §4.2). While THIS tab edits it stays VISIBLE but DISABLED
                      (dimmed + non-interactive) so it keeps its layout slot — the tab width
                      stays stable on entering edit mode — without an awkward empty gap and
                      with no click target during a rename. stopPropagation so it doesn't
                      also activate the tab. SUPPRESSED entirely for a non-closeable tab
                      (cosmos pinned default — FR-114): no `X`, no close path. */}
                  {t.closeable !== false && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${t.label}`}
                    className={cn(
                      'opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5',
                      isEditing && 'pointer-events-none opacity-40 group-hover/tab:opacity-40 group-data-[state=active]/tab:opacity-40'
                    )}
                  >
                    {/* asChild: render a <span role=button> so we don't nest <button>s
                        (invalid HTML). Keyboard-activatable via onKeyDown. */}
                    <span
                      role="button"
                      aria-label={`Close ${t.label}`}
                      aria-disabled={isEditing || undefined}
                      tabIndex={isEditing ? -1 : isActive ? 0 : -1}
                      onClick={(e) => {
                        if (isEditing) {
                          return
                        }
                        e.stopPropagation()
                        onClose(t.id)
                      }}
                      onKeyDown={(e) => {
                        if (isEditing) {
                          return
                        }
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          onClose(t.id)
                        }
                      }}
                    >
                      <X aria-hidden="true" />
                    </span>
                  </Button>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{tooltip}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* panel-refresh-v1 (design §1): the optional trailing chrome node (the panel refresh
          control), pinned LEFT of `+` in the same non-scrolling cluster. Never scrolls. */}
      {trailing}

      {/* Pinned trailing `+` — never scrolls (design §4.1). Present for every panel that
          passes `onNewTab` (FR-005/FR-016); OMITTED when absent (cosmos-conversation-panel-v2
          — the Cosmos panel has no new-tab affordance in step 3). */}
      {onNewTab && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="New tab"
              onClick={onNewTab}
              className="shrink-0 self-center rounded-none border-l border-border"
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New tab</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
