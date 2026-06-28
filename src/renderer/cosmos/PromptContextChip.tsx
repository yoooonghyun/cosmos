/**
 * PromptContextChip — the read-only timeline affordance that names what the user was looking at
 * when they sent a prompt (cosmos-timeline-prompt-context-v1, design spec + FR-022/FR-023).
 *
 * A quiet, single-line breadcrumb pill attached ABOVE the right-aligned `UserBubble` (historical
 * `user-prompt` turn AND live in-flight bubble). It collapses the panel / tab / dock dimensions
 * into ONE cohesive `Badge variant="secondary"` breadcrumb (read-only history → nothing removable,
 * unlike the composer `ContextChip` which splits removable badges). Segments left→right, joined by
 * a muted `ChevronRight`:
 *
 *   [PanelGlyph] Panel  ›  [TabGlyph] Tab  ›  ↳ [DockGlyph] item  [› [MessagesSquare] Thread]
 *
 * Reuses the system's existing surface (design §2/§3): `Badge` + `Tooltip`, `SURFACE_ICON` (the ONE
 * source of a rail surface's glyph, D-10) for the panel mark, the composer's `PRIMARY_ICON`/
 * `PRIMARY_NOUN` for the dock item (via the shared `contextChipIcons` + `contextChipFor`, SC-009),
 * and lucide `AppWindow` for the tab. NO new design token, NO new `components/ui/` primitive.
 *
 * Presentational only: `context === undefined` → renders nothing (design state Absent / FR-021).
 * The raw `<cosmos:context>` marker is stripped upstream and never reaches this surface (FR-025).
 */
import { AppWindow, ChevronRight, MessagesSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SURFACE_ICON } from '../app/surfaceIcons'
import { PRIMARY_ICON, PRIMARY_NOUN } from '../app/contextChipIcons'
import { contextChipFor, type ItemContextChip } from '../app/viewContextCapture'
import type { PromptContext } from '../../shared/promptContext/promptContext'

/** A truncatable label segment with a full-text tooltip (design state Long label). */
function TruncLabel({ label }: { label: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/** The dock-item breadcrumb tail: `› ↳ [DockGlyph] item [› [MessagesSquare] Thread]` (design §3). */
function DockSegment({ chip }: { chip: ItemContextChip }): React.JSX.Element {
  const PrimaryIcon = PRIMARY_ICON[chip.primary.kind]
  return (
    <>
      <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <span aria-hidden="true" className="shrink-0 text-muted-foreground">
        ↳
      </span>
      <PrimaryIcon aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <TruncLabel label={chip.primary.label} />
      {chip.secondary && (
        <>
          <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <MessagesSquare aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <span className="shrink-0">{chip.secondary.label}</span>
        </>
      )}
    </>
  )
}

/** Build the single comprehensive ARIA label (omitting absent dimensions — design §5). */
function ariaLabelFor(context: PromptContext, dockChip: ItemContextChip | undefined): string {
  const parts = [`${context.panel.label} panel`]
  if (context.tab) {
    parts.push(`${context.tab.label} tab`)
  }
  if (dockChip) {
    parts.push(`${PRIMARY_NOUN[dockChip.primary.kind]} ${dockChip.primary.label}`)
    if (dockChip.secondary) {
      parts.push('thread')
    }
  }
  return `Prompt context: ${parts.join(', ')}`
}

export function PromptContextChip({
  context
}: {
  context?: PromptContext
}): React.JSX.Element | null {
  // Design state Absent / FR-021: no context → render nothing (no placeholder, no empty pill).
  if (!context) {
    return null
  }
  const PanelGlyph = SURFACE_ICON[context.panel.id]
  // Derive the dock segment via the SAME composer helper so it is byte-identical to the
  // composer's primary badge content (SC-009). The `kind` discriminator on the dock is extra
  // data `contextChipFor` ignores — it reads the literal ViewContext item fields. A dock only
  // ever exists on the four integration panels (never `cosmos`, never `terminal` — both have
  // `DOCK_KIND_BY_PANEL = null`), and those four ids ARE valid `UiRenderTarget`s, so excluding
  // them narrows the type safely (cosmos-panel-tab-list-v1 added 'terminal' to PromptPanelId).
  const dockTarget =
    context.panel.id === 'cosmos' || context.panel.id === 'terminal'
      ? undefined
      : context.panel.id
  const dockChip =
    context.dock && dockTarget ? contextChipFor(dockTarget, context.dock) : undefined

  return (
    <div className="flex justify-end">
      <Badge
        variant="secondary"
        className="min-w-0 max-w-chat-bubble"
        role="note"
        aria-label={ariaLabelFor(context, dockChip)}
      >
        {/* Panel — always shown, the brand mark (D-10). */}
        <PanelGlyph aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="shrink-0">{context.panel.label}</span>

        {/* Tab — when present. */}
        {context.tab && (
          <>
            <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <AppWindow aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <TruncLabel label={context.tab.label} />
          </>
        )}

        {/* Dock — only when a dock/detail was open. */}
        {dockChip && <DockSegment chip={dockChip} />}
      </Badge>
    </div>
  )
}
