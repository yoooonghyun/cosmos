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
import { PromptContextBreadcrumb } from './PromptContextChip'
import type { TimelineEntry } from './cosmosConversation'
import type { PromptContext } from '../../shared/promptContext/promptContext'
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
    // cosmos-context-message-combined-box-v1 (design §1): the captured context + the user prompt
    // are ONE combined `UserMessageBox` (context header → divider → always-visible body), then the
    // assistant typing dots below. Live + historical render the IDENTICAL box, so it is stable
    // across the live→confirmed transition (FR-010/FR-024).
    return (
      <div className="flex flex-col gap-1">
        {(entry.promptText || entry.promptContext) && (
          <UserMessageBox text={entry.promptText ?? ''} context={entry.promptContext} />
        )}
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
      // cosmos-context-message-combined-box-v1 (design §1): the read-only context breadcrumb is
      // the static HEADER of the combined `UserMessageBox`; with no context the box renders exactly
      // today's plain bubble (no header, no divider — FR-009). Identical to the live branch.
      return <UserMessageBox text={turn.text} context={turn.context} />

    case 'assistant-text':
      return (
        <AssistantRow>
          {/* `mt-0.5` nudges the first text line down to sit level with the avatar glyph
              (the avatar carries `mt-px`). */}
          <p className="mt-0.5 whitespace-pre-wrap break-words text-body-sm text-card-foreground">
            {turn.text}
          </p>
        </AssistantRow>
      )
    case 'tool-call':
      // No avatar on a tool-call row, but indent it by the SAME avatar(`size-6`)+`gap-2`
      // geometry as `AssistantRow` so its left edge lines up with the assistant text (not
      // further left). The leading box is an invisible avatar-sized spacer (no logo).
      return (
        <div className="flex items-start gap-2">
          <div className="size-6 shrink-0" aria-hidden />
          <ToolCallRow
            toolName={turn.toolName}
            argPreview={turn.argPreview}
            resultPreview={turn.resultPreview}
          />
        </div>
      )
    case 'surface':
      // A HISTORICAL surface — display-only (no live requestId, so a control action is a no-op).
      return <InlineSurface spec={turn.spec} requestId="" />
    default:
      return null
  }
}

/**
 * UserMessageBox — the combined user-prompt box (cosmos-context-message-combined-box-v1,
 * design §1 / DESIGN.md D-11/D-14/D-18). ONE right-aligned brand-accent bubble that, when a
 * PromptContext is present, carries the submit-time context as a STATIC header section, a hairline
 * divider, then the always-visible message body — so a prompt and the screen it was sent from read
 * as ONE self-contained unit. This replaces the prior two-element stack (a `Badge`-pill
 * `PromptContextChip` ABOVE a separate `UserBubble`); placement superseded by D-11.
 *
 * Color/geometry (always): `bg-primary` / `text-primary-foreground`, `rounded-2xl rounded-br-sm`,
 * `max-w-chat-bubble` (2/3) — the unchanged "my message" accent (D-14). `overflow-hidden` clips the
 * full-bleed divider to the rounded corners.
 *
 * Header (context PRESENT only): the shared, tone-neutral `PromptContextBreadcrumb` in a
 * `text-primary-foreground/80` container (≈5.4:1 AA; decoration softens to `opacity-70`, ≈3:1) — the
 * D-18 fix for the breadcrumb now sitting on the pink fill instead of the old `bg-secondary` pill.
 * The header is STATIC: no toggle, no `aria-expanded`, no click target (FR-005). The body is ALWAYS
 * visible (FR-006) — the explicit OPPOSITE of the collapsible `ToolCallRow`.
 *
 * Null/absent context (FR-009 / SC-004): the box renders ONLY the body — no header, no divider —
 * visually identical to the prior plain `UserBubble`. The divider never appears alone.
 *
 * Body: today's escaped React text with `whitespace-pre-wrap break-words` (multi-line preserved,
 * marker already stripped upstream — FR-011). Assistant replies stay BARE on the panel `bg-card`
 * (no bubble) → user-accent-right / assistant-plain-left.
 */
function UserMessageBox({
  text,
  context
}: {
  text: string
  context?: PromptContext
}): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-chat-bubble overflow-hidden rounded-2xl rounded-br-sm bg-primary text-body-sm text-primary-foreground">
        {context && (
          <div className="px-3 pt-1.5 pb-1 text-caption text-primary-foreground/80">
            <PromptContextBreadcrumb context={context} />
          </div>
        )}
        <p
          className={`whitespace-pre-wrap break-words px-3 py-1.5 ${
            context ? 'border-t border-primary-foreground/20' : ''
          }`}
        >
          {text}
        </p>
      </div>
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
      <Avatar size="sm" className="mt-px items-center justify-center bg-muted">
        <CosmosGlyphIcon className="size-4 text-muted-foreground" />
      </Avatar>
      <div className="min-w-0 max-w-chat-bubble">{children}</div>
    </div>
  )
}
