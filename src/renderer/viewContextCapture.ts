/**
 * open-prompt-view-context-v1 — pure renderer-side capture mappers.
 *
 * Each panel derives a non-secret {@link ViewContext} from the view state it ALREADY
 * holds (no new fetch, no new selection tracking — FR-004). A mapper returns `undefined`
 * when nothing is selected (the panel then submits with NO viewContext — FR-005), never a
 * placeholder/dangling id. These are framework-free + node-testable (no React/DOM imports,
 * per the `.ts`/`.test.ts` split — FR-010).
 *
 * Also derives the DISPLAY-ONLY {@link ContextChipData} for the composer chip (design
 * §3/§6): render data separate from the IPC contract, built from the same panel state.
 *
 * SECURITY (FR-002): every value here is a non-secret label/identifier the panel already
 * shows on screen. NEVER a token, OAuth secret, or credential.
 */

import type { UiRenderTarget, ViewContext } from '../shared/ipc'

/** True for a string that has at least one non-whitespace character. */
function present(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/* ------------------------------------------------------------------ *
 * Per-panel state shapes — structurally minimal mirrors of the panel
 * state, so this module imports no panel/React code (FR-010).
 * ------------------------------------------------------------------ */

/** Slack's per-tab base view (mirror of `SlackPanel`'s `View`). */
export type SlackViewState =
  | { kind: 'channels' }
  | { kind: 'history'; channel: { id: string; name: string } }
  | { kind: 'search'; query: string }

/** Slack's open-thread dock state (mirror of `OpenThreadState`). */
export type SlackThreadState = { channelId: string; threadTs: string } | null

/** Confluence's per-tab base view (mirror of `ConfluenceView`). */
export type ConfluenceViewState =
  | { kind: 'search' }
  | { kind: 'page'; pageId: string; title: string }

/** Confluence's gen-UI page overlay (mirror of `genUiPage`). */
export type ConfluencePageOverlay = { pageId: string; title: string } | null

/** The minimal calendar event fields the chip/context need (mirror of `EventChipData`). */
export type CalendarEventState = { id?: string; summary?: string } | null

/* ------------------------------------------------------------------ *
 * Capture mappers (panel state → ViewContext)
 * ------------------------------------------------------------------ */

/** jira: the open detail dock's issue key, or undefined when the list view is shown. */
export function jiraViewContext(detailIssueKey: string | null): ViewContext | undefined {
  if (!present(detailIssueKey)) {
    return undefined
  }
  return { selectedIssueKey: detailIssueKey }
}

/** slack: the open channel (+ open thread), or undefined on the channels/search view. */
export function slackViewContext(
  view: SlackViewState,
  thread: SlackThreadState
): ViewContext | undefined {
  if (view.kind !== 'history' || !present(view.channel.id)) {
    return undefined
  }
  const ctx: ViewContext = { selectedChannelId: view.channel.id }
  if (present(view.channel.name)) {
    ctx.selectedChannelName = view.channel.name
  }
  // A thread dock only ever opens against the channel in view; carry its ts when present.
  if (thread && present(thread.threadTs)) {
    ctx.threadTs = thread.threadTs
  }
  return ctx
}

/** confluence: the open page (native view or gen-UI overlay), or undefined on search. */
export function confluenceViewContext(
  view: ConfluenceViewState,
  overlay: ConfluencePageOverlay
): ViewContext | undefined {
  // The gen-UI overlay sits OVER the base view, so it takes precedence as the in-view page.
  const page = overlay ?? (view.kind === 'page' ? view : null)
  if (!page || !present(page.pageId)) {
    return undefined
  }
  const ctx: ViewContext = { selectedPageId: page.pageId }
  if (present(page.title)) {
    ctx.selectedPageTitle = page.title
  }
  return ctx
}

/** google-calendar: the selected event, or undefined when no event is open. */
export function calendarViewContext(event: CalendarEventState): ViewContext | undefined {
  if (!event || !present(event.id)) {
    return undefined
  }
  const ctx: ViewContext = { selectedEventId: event.id }
  if (present(event.summary)) {
    ctx.selectedEventTitle = event.summary
  }
  return ctx
}

/* ------------------------------------------------------------------ *
 * Chip descriptor (ViewContext → display-only ContextChipData)
 * ------------------------------------------------------------------ */

/**
 * Display-only descriptor of the in-view item the composer chip shows (design §6,
 * Option 1). DERIVED from the same panel state as `viewContext` but kept SEPARATE from
 * the IPC contract — it carries whatever the chip needs to read well. NON-SECRET labels.
 */
export interface ContextChipData {
  /** The lead dimension shown as the primary badge. */
  primary: {
    kind: 'jira' | 'slack-channel' | 'confluence' | 'calendar'
    /** The truncatable display label (issue key / #channel / title). */
    label: string
    /** The full untruncated label for the truncation tooltip (design state D). */
    fullLabel?: string
  }
  /** Optional second dimension — the Slack open thread (design §3.4 / state C). */
  secondary?: { kind: 'slack-thread'; label: string }
}

/**
 * Build the composer chip descriptor for a `target` from its captured `viewContext`, or
 * undefined when there is nothing to show (design state A: generated-ui always; any panel
 * with no selection). RENDER data only — never crosses the IPC boundary.
 */
export function contextChipFor(
  target: UiRenderTarget,
  viewContext: ViewContext | undefined
): ContextChipData | undefined {
  if (!viewContext) {
    return undefined
  }
  if (target === 'jira') {
    if (!present(viewContext.selectedIssueKey)) {
      return undefined
    }
    return { primary: { kind: 'jira', label: viewContext.selectedIssueKey } }
  }
  if (target === 'slack') {
    if (!present(viewContext.selectedChannelId)) {
      return undefined
    }
    const label = present(viewContext.selectedChannelName)
      ? `#${viewContext.selectedChannelName}`
      : viewContext.selectedChannelId
    const chip: ContextChipData = { primary: { kind: 'slack-channel', label } }
    if (present(viewContext.threadTs)) {
      chip.secondary = { kind: 'slack-thread', label: 'Thread' }
    }
    return chip
  }
  if (target === 'confluence') {
    if (!present(viewContext.selectedPageId)) {
      return undefined
    }
    if (present(viewContext.selectedPageTitle)) {
      return {
        primary: {
          kind: 'confluence',
          label: viewContext.selectedPageTitle,
          fullLabel: viewContext.selectedPageTitle
        }
      }
    }
    return { primary: { kind: 'confluence', label: 'Page' } }
  }
  if (target === 'google-calendar') {
    if (!present(viewContext.selectedEventId)) {
      return undefined
    }
    if (present(viewContext.selectedEventTitle)) {
      return {
        primary: {
          kind: 'calendar',
          label: viewContext.selectedEventTitle,
          fullLabel: viewContext.selectedEventTitle
        }
      }
    }
    return { primary: { kind: 'calendar', label: 'Event' } }
  }
  // generated-ui (and any future target with no panel selection) → no chip (state A).
  return undefined
}
