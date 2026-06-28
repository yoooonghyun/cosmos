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
import { Calendar, FileText, Hash, MessagesSquare, Ticket, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ContextChipData } from './viewContextCapture'

/** The lucide icon used for each primary chip kind (echoes each panel's own glyph, design §3). */
const PRIMARY_ICON = {
  jira: Ticket,
  'slack-channel': Hash,
  confluence: FileText,
  calendar: Calendar
} as const

/** An accessible-label prefix per primary kind (design §8 ARIA). */
const PRIMARY_NOUN = {
  jira: 'Jira issue',
  'slack-channel': 'Slack channel',
  confluence: 'Confluence page',
  calendar: 'Calendar event'
} as const

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
