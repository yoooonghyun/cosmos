/**
 * open-prompt-view-context-v1 — pure view-context grounding-clause builder (main).
 *
 * Maps a validated, non-secret {@link ViewContext} → an extra system-prompt sentence that
 * tells the model which on-screen item deictic terms ("this ticket / this channel / this
 * thread / this page / this event") refer to (FR-007/FR-008). The clause is APPENDED to
 * the per-target grounding via the SAME `--append-system-prompt` mechanism — it is NEVER
 * concatenated into the user's literal utterance (SC-003).
 *
 * It references ONLY ids the model can fetch with its EXISTING read tools; it MUST NOT
 * instruct an action the run lacks tools for (FR-008/FR-009) — e.g. it never tells a
 * read-only Slack run to "send" anything. Returns '' (a no-op) when there is no usable
 * selection for the target. Framework-free + node-testable (FR-010).
 *
 * SECURITY (SC-004): by construction it only echoes the non-secret labels/ids the
 * renderer already displays — never a token, secret, or credential.
 */

import { DEFAULT_UI_RENDER_TARGET, type UiRenderTarget, type ViewContext } from '../../shared/ipc'

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * The extra grounding sentence for a `target`'s captured `viewContext`, or '' when there
 * is no usable selection (FR-007/FR-008). `generated-ui` carries no panel selection
 * (FR-003), so it always returns ''.
 */
export function viewContextGroundingClause(
  target: UiRenderTarget = DEFAULT_UI_RENDER_TARGET,
  viewContext: ViewContext | undefined
): string {
  if (!viewContext) {
    return ''
  }

  if (target === 'jira' && present(viewContext.selectedIssueKey)) {
    const key = viewContext.selectedIssueKey
    return [
      `The user is currently viewing Jira issue ${key} in the panel.`,
      `When they say "this ticket" (or similar deictic reference) they mean ${key} —`,
      'fetch it with the Jira read tools and act on that issue, not a guessed or fabricated one.'
    ].join(' ')
  }

  if (target === 'slack' && present(viewContext.selectedChannelId)) {
    const id = viewContext.selectedChannelId
    const name = present(viewContext.selectedChannelName)
      ? ` (#${viewContext.selectedChannelName})`
      : ''
    const channelClause = [
      `The user is currently viewing Slack channel ${id}${name} in the panel.`,
      `When they say "this channel" they mean ${id} — read it with the Slack read tools.`
    ].join(' ')
    if (present(viewContext.threadTs)) {
      return [
        channelClause,
        `A thread is open in that channel (parent ts ${viewContext.threadTs});`,
        '"this thread" means that thread — read it with the Slack thread read tool.'
      ].join(' ')
    }
    return channelClause
  }

  if (target === 'confluence' && present(viewContext.selectedPageId)) {
    const id = viewContext.selectedPageId
    const title = present(viewContext.selectedPageTitle)
      ? ` ("${viewContext.selectedPageTitle}")`
      : ''
    return [
      `The user is currently viewing Confluence page ${id}${title} in the panel.`,
      `When they say "this page" they mean ${id} — fetch it with the Confluence read tools.`
    ].join(' ')
  }

  if (target === 'google-calendar' && present(viewContext.selectedEventId)) {
    const id = viewContext.selectedEventId
    const title = present(viewContext.selectedEventTitle)
      ? ` ("${viewContext.selectedEventTitle}")`
      : ''
    return [
      `The user is currently viewing calendar event ${id}${title} in the panel.`,
      `When they say "this event"/"this meeting" they mean ${id} —`,
      'use the Google Calendar read tool to work with that event.'
    ].join(' ')
  }

  return ''
}
