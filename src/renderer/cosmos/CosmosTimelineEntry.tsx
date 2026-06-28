/**
 * CosmosTimelineEntry — renders ONE entry of the Cosmos conversation timeline
 * (cosmos-conversation-panel-v2, step 3). Spec: FR-109/FR-110.
 *
 * An entry is either a normalized transcript {@link ConversationTurn} (user prompt bubble,
 * assistant text, a collapsible tool-call row, or an inline generated surface) or a synthetic
 * LIVE entry for the in-flight run (a "generating" affordance or a live, actionable surface).
 *
 * Inline generated surfaces reuse the EXISTING standard-catalog A2UI host
 * (`<A2UIProvider catalogId="standard">` + `ActiveTabSurface`) so a historical surface is
 * fully interactive and a bad/unknown component degrades to that surface's error boundary
 * without affecting sibling turns (FR-110). A HISTORICAL surface has no live `requestId`, so
 * a control action on it is a no-op against a missing pending call (already warn-and-ignored
 * in main) — never an error (Edge Cases). Only the LIVE in-flight surface is actionable.
 *
 * Assistant + tool text is MODEL output (untrusted): it is rendered as React text nodes
 * (auto-escaped) with whitespace preserved — never as raw HTML — so there is no injection
 * surface. (Rich markdown rendering is a deferred refinement; see DEVELOPMENT notes.)
 */

import { useState } from 'react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { ChevronRight, Wrench } from 'lucide-react'
import { ActiveTabSurface } from '../generative/ActiveTabSurface'
import { Avatar } from '../components/ui/avatar'
import { CosmosGlyphIcon } from '../app/surfaceIcons'
import { TypingIndicator } from './TypingIndicator'
import { PromptContextChip } from './PromptContextChip'
import type { TimelineEntry } from './cosmosConversation'
import type { A2uiSurfaceUpdate } from '../../shared/ipc'

/** Mount one generated surface inline via the existing standard-catalog host (FR-110). */
function InlineSurface({
  spec,
  requestId
}: {
  spec: A2uiSurfaceUpdate
  /** A live, resolvable requestId for the in-flight surface; '' for a historical one. */
  requestId: string
}): React.JSX.Element {
  return (
    <A2UIProvider>
      <ActiveTabSurface
        surface={{ requestId, spec }}
        catalogId="standard"
        panelName="CosmosTimeline"
      />
    </A2UIProvider>
  )
}

/** A compact, collapsible tool-call row (OQ-V2-toolcalls): name + sanitized preview. */
function ToolCallRow({
  toolName,
  argPreview,
  resultPreview
}: {
  toolName: string
  argPreview: string
  resultPreview?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="max-w-chat-bubble rounded-md border border-border/60 bg-muted/40 text-caption">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Wrench className="size-3 shrink-0" />
        {/* Title area shows ONLY the tool name — the arg preview is body, shown when expanded. */}
        <span className="truncate font-medium text-foreground">{toolName}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-border/60 px-2 py-1.5">
          {argPreview && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{argPreview}</p>
          )}
          {resultPreview && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground/80">
              → {resultPreview}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function CosmosTimelineEntry({ entry }: { entry: TimelineEntry }): React.JSX.Element | null {
  if (entry.kind === 'live-generating') {
    // cosmos-timeline-prompt-context-v1 (design §1): chip → bubble → typing dots. The chip names
    // the captured context and sits ABOVE the user prompt; the dots are the assistant. Live +
    // historical use the same component, so the chip is stable across the confirm (FR-024).
    return (
      <div className="flex flex-col gap-1">
        <PromptContextChip context={entry.promptContext} />
        {entry.promptText && <UserBubble text={entry.promptText} />}
        <AssistantRow>
          <TypingIndicator />
        </AssistantRow>
      </div>
    )
  }
  if (entry.kind === 'live-surface') {
    // The in-flight surface carries a LIVE requestId — its controls round-trip via ui:action.
    return <InlineSurface spec={entry.spec} requestId={entry.requestId} />
  }
  const { turn } = entry
  switch (turn.kind) {
    case 'user-prompt':
      // cosmos-timeline-prompt-context-v1 (design §1): stack the read-only context chip ABOVE
      // the bubble in a flex column; with no context the chip returns null and this renders
      // exactly today's bare bubble (FR-021).
      return (
        <div className="flex flex-col gap-1">
          <PromptContextChip context={turn.context} />
          <UserBubble text={turn.text} />
        </div>
      )
    case 'assistant-text':
      return (
        <AssistantRow>
          <p className="whitespace-pre-wrap break-words text-body-sm text-card-foreground">
            {turn.text}
          </p>
        </AssistantRow>
      )
    case 'tool-call':
      return (
        <ToolCallRow
          toolName={turn.toolName}
          argPreview={turn.argPreview}
          resultPreview={turn.resultPreview}
        />
      )
    case 'surface':
      // A HISTORICAL surface — display-only (no live requestId, so a control action is a no-op).
      return <InlineSurface spec={turn.spec} requestId="" />
    default:
      return null
  }
}

/**
 * A user prompt bubble — right-aligned, filled with the brand `--primary` color
 * (chat-surface canon, DESIGN.md §15 / D-14). `bg-primary` / `text-primary-foreground`
 * is the conventional "my message" accent bubble (a sent message reads as the brand
 * accent, the agent's replies stay plain) — chosen by product over a neutral surface.
 * Width is the SHARED `max-w-chat-bubble` token (the same one the chip uses, so the
 * two never drift). Assistant replies stay BARE on the panel `bg-card` (no bubble) →
 * user-accent-right / assistant-plain-left.
 */
function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <p className="max-w-chat-bubble whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-body-sm text-primary-foreground">
        {text}
      </p>
    </div>
  )
}

/**
 * AssistantRow — the LEFT-aligned assistant turn shell: a small MONOCHROME Cosmos logo
 * avatar followed by the reply (assistant text or the in-progress `TypingIndicator`), so
 * every agent turn reads as the SAME speaker (chat-surface canon, DESIGN.md §15 / D-17).
 * The avatar identifies the agent the way `UserBubble`'s right-aligned accent identifies the
 * user — `user-accent-right / assistant-logo-left`.
 *
 * The avatar is the `Avatar size="sm"` primitive (a 24px `bg-muted` circle) holding the
 * `CosmosGlyphIcon` — the SAME four-point-sparkle glyph the left rail's Cosmos tab uses
 * (`SURFACE_ICON.cosmos`, the one rail-logo source, D-10), already `currentColor`-monochrome —
 * in `text-muted-foreground`, one quiet neutral tone in the same `muted` family as the
 * tool-call / typing rows, so it never competes with the brand-pink user bubble. It is
 * `shrink-0` and `items-start`-aligned to the FIRST line of the reply;
 * `gap-2` (8px, §9 grid) sets the avatar→text rhythm. The mark is `aria-hidden` decoration
 * (the timeline conveys the speaker), so screen readers still read only the reply text.
 */
function AssistantRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <Avatar size="sm" className="mt-0.5 items-center justify-center bg-muted">
        <CosmosGlyphIcon className="size-4 text-muted-foreground" />
      </Avatar>
      <div className="min-w-0 max-w-chat-bubble">{children}</div>
    </div>
  )
}
