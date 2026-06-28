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
import { SurfaceSpinner } from '../SurfaceSpinner'
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
    <div className="rounded-md border border-border/60 bg-muted/40 text-[12px]">
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
        <span className="font-medium text-foreground">{toolName}</span>
        {argPreview && <span className="truncate text-muted-foreground">{argPreview}</span>}
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
    return (
      <div className="flex flex-col gap-1">
        {entry.promptText && <UserBubble text={entry.promptText} />}
        <SurfaceSpinner />
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
      return <UserBubble text={turn.text} />
    case 'assistant-text':
      return (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-card-foreground">
          {turn.text}
        </p>
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

/** A user prompt bubble — right-aligned, accent-tinted. */
function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary/15 px-3 py-1.5 text-[13px] leading-relaxed text-foreground">
        {text}
      </p>
    </div>
  )
}
