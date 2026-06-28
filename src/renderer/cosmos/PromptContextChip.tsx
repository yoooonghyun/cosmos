/**
 * PromptContextBreadcrumb + PromptContextChip — the read-only timeline affordance that names what
 * the user was looking at when they sent a prompt (cosmos-timeline-prompt-context-v1, FR-022/FR-023;
 * relocated in-bubble by cosmos-context-message-combined-box-v1, D-11/D-18).
 *
 * `PromptContextBreadcrumb` is the shared, TONE-NEUTRAL breadcrumb CONTENT: the panel / tab / dock
 * dimensions collapsed into ONE cohesive single-line breadcrumb (read-only history → nothing
 * removable, unlike the composer `ContextChip` which splits removable badges). Segments left→right,
 * joined by a `ChevronRight`:
 *
 *   [PanelGlyph] Panel  ›  [TabGlyph] Tab  ›  ↳ [DockGlyph] item  [› [MessagesSquare] Thread]
 *
 * It draws NO container/chrome and NO tone of its own: meaningful LABELS inherit `currentColor` and
 * the `aria-hidden` DECORATION (glyphs/separators) is `opacity-70` relative — so the CONSUMING
 * container sets the base family (D-18). The combined-box header sets `text-primary-foreground/80`
 * on the `bg-primary` fill; the standalone `Badge variant="secondary"` shell sets
 * `text-secondary-foreground`. ONE content source, never forked. It carries `role="note"` +
 * `aria-label` itself (the meaning of the breadcrumb), so any container is just chrome.
 *
 * Reuses the system's existing surface (design §2/§3): `SURFACE_ICON` (the ONE source of a rail
 * surface's glyph, D-10) for the panel mark, the composer's `PRIMARY_ICON`/`PRIMARY_NOUN` for the
 * dock item (via the shared `contextChipIcons` + `contextChipFor`, SC-009), and lucide `AppWindow`
 * for the tab. NO new design token, NO new `components/ui/` primitive.
 *
 * `PromptContextChip` is the thin standalone shell: a right-aligned `Badge variant="secondary"`
 * over the breadcrumb (kept so its existing standalone uses/tests stay green — D-11 still records the
 * idiom). Presentational only: `context === undefined` → both render nothing (state Absent / FR-021).
 * The raw `<cosmos:context>` marker is stripped upstream and never reaches this surface (FR-025).
 */
import { AppWindow, ChevronRight, MessagesSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SURFACE_ICON } from '../app/surfaceIcons'
import { PRIMARY_ICON, PRIMARY_NOUN } from '../app/contextChipIcons'
import { contextChipFor, type ItemContextChip } from '../app/viewContextCapture'
import type { PromptContext } from '../../shared/promptContext/promptContext'

/**
 * The shared DECORATION class for breadcrumb glyphs/separators (D-18). Tone-neutral: it inherits the
 * consumer's `currentColor` and softens it to `opacity-70` (the "muted glyph / solid label"
 * hierarchy) — NEVER a hardcoded `text-muted-foreground` (≈1.9:1 on `bg-primary`).
 *
 * `size-3` (12px) is baked in so EVERY glyph (the `SURFACE_ICON` panel/cosmos brand SVG, the lucide
 * `AppWindow` tab mark, the `PRIMARY_ICON` dock glyph, `ChevronRight`, `MessagesSquare`) renders at
 * ONE uniform size on ANY container. Previously the `Badge`'s `[&>svg]:size-3` sized them; now the
 * breadcrumb is no longer the Badge's direct svg child (it sits in the in-bubble header / inside the
 * breadcrumb span), so the size MUST live on the glyph itself or the lucide/brand SVGs fall back to
 * their 24px / `1em` default and read oversized (user report).
 */
const DECORATION = 'size-3 shrink-0 opacity-70'

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
      <ChevronRight aria-hidden="true" className={DECORATION} />
      <span aria-hidden="true" className={DECORATION}>
        ↳
      </span>
      <PrimaryIcon aria-hidden="true" className={DECORATION} />
      <TruncLabel label={chip.primary.label} />
      {chip.secondary && (
        <>
          <ChevronRight aria-hidden="true" className={DECORATION} />
          <MessagesSquare aria-hidden="true" className={DECORATION} />
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

/**
 * The shared, TONE-NEUTRAL breadcrumb CONTENT (the inner segments + `role="note"` + `aria-label`),
 * with NO container chrome and NO alignment/tone of its own. The consuming container (the
 * combined-box header on `bg-primary`, or the standalone `Badge variant="secondary"` shell) sets the
 * base foreground family; labels inherit it, decoration softens to `opacity-70` (D-18).
 *
 * `context === undefined` → renders nothing (state Absent / FR-021), so a container that always
 * mounts the breadcrumb (e.g. the no-context bubble) still emits no header.
 */
export function PromptContextBreadcrumb({
  context
}: {
  context?: PromptContext
}): React.JSX.Element | null {
  // Design state Absent / FR-021: no context → render nothing (no placeholder, no empty header).
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
    <span
      className="flex min-w-0 items-center gap-1"
      role="note"
      aria-label={ariaLabelFor(context, dockChip)}
    >
      {/* Panel — always shown, the brand mark (D-10). */}
      <PanelGlyph aria-hidden="true" className={DECORATION} />
      <span className="shrink-0">{context.panel.label}</span>

      {/* Tab — when present. */}
      {context.tab && (
        <>
          <ChevronRight aria-hidden="true" className={DECORATION} />
          <AppWindow aria-hidden="true" className={DECORATION} />
          <TruncLabel label={context.tab.label} />
        </>
      )}

      {/* Dock — only when a dock/detail was open. */}
      {dockChip && <DockSegment chip={dockChip} />}
    </span>
  )
}

/**
 * The standalone read-only chip: a right-aligned `Badge variant="secondary"` shell over the shared
 * `PromptContextBreadcrumb`. The `secondary` variant supplies `text-secondary-foreground`, so the
 * breadcrumb's `currentColor` labels read solid light-gray and its `opacity-70` decoration stays a
 * clean muted glyph on the `bg-secondary` pill (D-18). The breadcrumb owns `role="note"` +
 * `aria-label`, so the Badge is pure chrome. `context === undefined` → renders nothing (FR-021).
 * Kept for any surface still wanting the pill.
 */
export function PromptContextChip({
  context
}: {
  context?: PromptContext
}): React.JSX.Element | null {
  // FR-021: no context → render nothing (no empty pill), matching the breadcrumb's null guard.
  if (!context) {
    return null
  }
  return (
    <div className="flex justify-end">
      <Badge variant="secondary" className="min-w-0 max-w-chat-bubble">
        <PromptContextBreadcrumb context={context} />
      </Badge>
    </div>
  )
}
