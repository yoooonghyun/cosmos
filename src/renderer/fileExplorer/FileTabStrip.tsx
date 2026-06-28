/**
 * FileTabStrip — the LIGHT bespoke file-tab strip above the middle viewer column
 * (terminal-file-tabs-v1, FR-012..FR-015, design §2/§3/§6). One `role="tab"` per open file:
 * a leading file glyph + truncated basename + a hover/active/focus-revealed close `X`. Overflow
 * scrolls horizontally; the active tab is kept reachable; the active tab carries a 2px `--primary`
 * top-accent on the column's `bg-card` surface.
 *
 * It is NOT `PanelTabStrip` (design §0 / plan D-3): it reuses that strip's EXACT tokens, focus ring
 * (`ring-[3px] ring-ring/50`), close-`X` reveal idiom, truncation+`Tooltip`, and roving-tabindex
 * keymap VERBATIM — but DROPS the `+` new-tab, inline rename/F2, run-status glyphs, the terminal
 * glyph, and the trailing slot (a read-only viewer opened only from the tree has none of those).
 * The band rests on `bg-card/60` — one notch quieter than the panel band's `bg-popover` — so it
 * reads as in-column chrome, not a second panel tab bar. No new token, no new shadcn primitive.
 */

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { File, FileCode, FileImage, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fileGlyphKind, type FileGlyphKind } from './fileGlyph'

/** The lucide glyph for a file tab, by its classified kind — the SAME map as the tree row + the
 * #84 viewer header, so a tab's glyph matches its tree row (design §2.2). */
const TAB_GLYPH: Record<FileGlyphKind, typeof File> = {
  code: FileCode,
  image: FileImage,
  text: FileText,
  file: File
}

/** One file tab the strip renders (one per open file; ordered; keyed by relPath). */
export interface FileTab {
  /** Root-relative path — the stable key; the full path rides the tooltip (disambiguates basenames). */
  relPath: string
  /** The basename — the visible (truncated) label. */
  name: string
}

export interface FileTabStripProps {
  /** The open files, in order. */
  tabs: FileTab[]
  /** The active file's relPath (null only when zero tabs — then the strip is not rendered). */
  activeRelPath: string | null
  /** Click / Enter / Space activates a tab (FR-003); the tree open path also flows here (FR-017). */
  onActivate: (relPath: string) => void
  /** `X` click / Delete/Backspace on the tab / Enter/Space on the `X` closes a tab (FR-004/FR-005). */
  onClose: (relPath: string) => void
  /** Accessible name for the tablist, e.g. "Open files" (design §6). */
  ariaLabel: string
}

/** Move keyboard focus to the tab button at `index` (roving tabindex, design §6) — VERBATIM the
 * `PanelTabStrip.focusTabAt` shape so file tabs and panel tabs navigate identically. */
function focusTabAt(listEl: HTMLElement | null, index: number): void {
  if (!listEl) {
    return
  }
  const buttons = listEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons[index]?.focus()
}

export function FileTabStrip({
  tabs,
  activeRelPath,
  onActivate,
  onClose,
  ariaLabel
}: FileTabStripProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null)

  // design §3.4: keep the active tab reachable — scroll it into view when it changes (e.g. opening
  // an off-screen file from the tree). Instant (motion-reduce-safe) — no smooth-scroll animation.
  useEffect(() => {
    const list = listRef.current
    if (!list || activeRelPath === null) {
      return
    }
    const index = tabs.findIndex((t) => t.relPath === activeRelPath)
    if (index === -1) {
      return
    }
    const active = list.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  }, [activeRelPath, tabs])

  // design §6: manual-activation roving tablist — VERBATIM the PanelTabStrip keymap (minus F2
  // rename). Arrow/Home/End move FOCUS only; Enter/Space activate; Delete/Backspace close.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, relPath: string): void => {
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
        onActivate(relPath)
        break
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        onClose(relPath)
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // design §3.1: the strip band — fixed 32px, the column's quieter card tone, bottom border.
      className="flex h-8 shrink-0 select-none items-stretch border-b border-border bg-card/60"
    >
      {/* design §3.4: the whole strip is the scroll region (no pinned `+`/trailing). */}
      <div ref={listRef} className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden scrollbar-hover-only">
        {tabs.map((t, index) => {
          const isActive = t.relPath === activeRelPath
          const Glyph = TAB_GLYPH[fileGlyphKind(t.name)]
          return (
            <Tooltip key={t.relPath}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  // design §6: roving tabindex — active is 0, others -1 (one Tab stop).
                  tabIndex={isActive ? 0 : -1}
                  data-state={isActive ? 'active' : 'inactive'}
                  title={t.relPath}
                  onClick={() => onActivate(t.relPath)}
                  onKeyDown={(e) => handleTabKeyDown(e, index, t.relPath)}
                  className={cn(
                    // §3.2 base (every tab)
                    'group/tab relative flex h-full min-w-0 max-w-[14rem] cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    // §3.2 inactive (quiet over the bg-card/60 band)
                    'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                    // §3.2 active — MATCHES PanelTabStrip's active treatment VERBATIM (file-viewer-color-wrap-v1,
                    // #94): bg-background + bold label + the pink→purple BRAND-gradient top-accent (NOT the blue
                    // --primary), so the file-tab strip and the terminal tab strip read identically.
                    'data-[state=active]:border-r-transparent data-[state=active]:bg-background data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:before:absolute data-[state=active]:before:inset-x-0 data-[state=active]:before:top-0 data-[state=active]:before:h-0.5 data-[state=active]:before:bg-gradient-to-r data-[state=active]:before:from-brand-pink data-[state=active]:before:to-brand-purple'
                  )}
                >
                  {/* Leading file glyph — matches the file's tree row + the #84 viewer header. */}
                  <Glyph
                    className="size-3.5 shrink-0 text-muted-foreground group-data-[state=active]/tab:text-foreground"
                    aria-hidden="true"
                  />
                  {/* Label — the basename, truncated; the full relPath rides the tooltip/`title`. */}
                  <span className="min-w-0 truncate">{t.name}</span>
                  {/* Close `X` — VERBATIM the PanelTabStrip reveal idiom: hidden at rest, shown on
                      hover/active/focus. `asChild` renders a <span role="button"> so we never nest
                      <button>s; stopPropagation so closing never also activates the tab. */}
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${t.name}`}
                    className="ml-0.5 shrink-0 opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5"
                  >
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose(t.relPath)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          onClose(t.relPath)
                        }
                      }}
                    >
                      <X aria-hidden="true" />
                    </span>
                  </Button>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t.relPath}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
