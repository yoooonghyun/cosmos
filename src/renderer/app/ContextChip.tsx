/**
 * ContextChip — the composer's view-context chip (open-prompt-view-context-v1, design §3–§8).
 *
 * A quiet, informational row shown INSIDE the expanded composer card, directly below the
 * textarea and above the hint/Send footer, that names the in-view item the run will be
 * grounded against ("↳ PROJ-123", "↳ #general", "↳ Release notes", "↳ Sprint planning").
 * It is the visible face of the otherwise-invisible `viewContext` plumbing.
 *
 * Purely presentational: it renders the display-only {@link ContextChipData} the panel
 * derives (via `viewContextCapture.contextChipFor`) from the SAME state it builds the
 * `viewContext` from. It is a cosmos-specific COMPOSITION of existing primitives (`Badge`,
 * `Button`, `Tooltip`, lucide icons) — NOT a generic `components/ui/` primitive (design §6).
 *
 * Dismissible (design §5): a trailing `×` lets the user drop the context for the next
 * submit only (per-compose, non-sticky). Removing the channel chip clears BOTH dimensions
 * (a thread cannot outlive its channel); the thread badge has its own `×` that drops only
 * the thread. The remove control is `disabled` while `running` (mirrors the Send button).
 */
import { AppWindow, ChevronRight, MessagesSquare, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ContextChipData } from './viewContextCapture'
// cosmos-timeline-prompt-context-v1 (design §6): the per-kind item glyph + ARIA noun maps were
// lifted into the shared `contextChipIcons` module so the timeline `PromptContextChip` reuses the
// SAME source (no duplication). The composer chip imports them from there now.
import { PRIMARY_ICON, PRIMARY_NOUN } from './contextChipIcons'
// cosmos-panel-tab-list-v1 (design §3.3 / D-16): a panel+tab selection renders the SAME panel›tab
// breadcrumb idiom as the read-only timeline `PromptContextChip` — panel glyph from `SURFACE_ICON`
// (D-10, the ONE icon source), tab glyph lucide `AppWindow`, plus the composer chip's removable `×`.
import { SURFACE_ICON } from './surfaceIcons'

export interface ContextChipProps {
  /** The display descriptor; undefined ⇒ render nothing (design state A). */
  data?: ContextChipData
  /** True while a run is in flight — disables the remove controls (design state F). */
  running?: boolean
  /** Drop the WHOLE context for the next submit (channel `×` / primary `×`). */
  onRemoveAll: () => void
  /** Drop only the Slack thread dimension (thread `×`), leaving the channel chip. */
  onRemoveThread: () => void
}

export function ContextChip({
  data,
  running = false,
  onRemoveAll,
  onRemoveThread
}: ContextChipProps): React.JSX.Element | null {
  // State A (design §4): no context to show → render nothing (no empty/placeholder row).
  if (!data) {
    return null
  }

  // cosmos-panel-tab-list-v1 (design §3.3 / D-16): a panel+tab tree selection renders the D-11
  // breadcrumb — `[SURFACE_ICON panel] Panel › [AppWindow] Tab ×` — NOT the `↳` dock-item badge
  // (a tree selection has no dock item). Same breadcrumb the read-only timeline chip ships, plus
  // the removable `×` (drops the selection for the next compose, FR-016).
  if (data.kind === 'panel-tab') {
    const PanelGlyph = SURFACE_ICON[data.panel.id]
    return (
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <Badge
          variant="secondary"
          className="min-w-0 max-w-[18rem]"
          role="note"
          aria-label={`Prompt context: ${data.panel.label} panel, ${data.tab.label} tab`}
        >
          <PanelGlyph aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <span className="shrink-0">{data.panel.label}</span>
          <ChevronRight aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <AppWindow aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate" title={data.tab.label}>
                {data.tab.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{data.tab.label}</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={running}
            aria-label={`Remove ${data.tab.label} from this prompt`}
            className="-mr-1 ml-0.5 shrink-0 rounded-full hover:bg-accent"
            onClick={onRemoveAll}
          >
            <X aria-hidden="true" />
          </Button>
        </Badge>
      </div>
    )
  }

  const PrimaryIcon = PRIMARY_ICON[data.primary.kind]
  const primaryNoun = PRIMARY_NOUN[data.primary.kind]
  const primaryAria = `${primaryNoun} ${data.primary.label}`

  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5">
      <Badge
        variant="secondary"
        className="min-w-0 max-w-[18rem]"
        role="note"
        aria-label={`Prompt context: ${primaryAria}`}
      >
        <span aria-hidden="true" className="text-muted-foreground">
          ↳
        </span>
        <PrimaryIcon aria-hidden="true" className="text-muted-foreground" />
        {/* Truncatable label with a tooltip exposing the full text (design state D). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate" title={data.primary.fullLabel ?? data.primary.label}>
              {data.primary.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{data.primary.fullLabel ?? data.primary.label}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={running}
          aria-label={`Remove ${data.primary.label} from this prompt`}
          className="-mr-1 ml-0.5 shrink-0 rounded-full hover:bg-accent"
          onClick={onRemoveAll}
        >
          <X aria-hidden="true" />
        </Button>
      </Badge>

      {/* State C (design §3.4): the Slack open-thread dimension as a second badge. */}
      {data.secondary && (
        <Badge
          variant="secondary"
          className="shrink-0"
          role="note"
          aria-label="Prompt context: Slack thread"
        >
          <MessagesSquare aria-hidden="true" className="text-muted-foreground" />
          <span>{data.secondary.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={running}
            aria-label="Remove thread from this prompt"
            className="-mr-1 ml-0.5 shrink-0 rounded-full hover:bg-accent"
            onClick={onRemoveThread}
          >
            <X aria-hidden="true" />
          </Button>
        </Badge>
      )}
    </div>
  )
}
