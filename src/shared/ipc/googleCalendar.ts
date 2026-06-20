/**
 * Google Calendar — native panel IPC surface.
 * Spec: .sdd/specs/google-calendar-v1.md. Re-exported (unchanged) through the
 * `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type {
  GoogleCalendarConnectionStatus,
  GoogleCalendarEvent,
  GoogleCalendarEventsPage,
  GoogleCalendarListEventsParams,
  GoogleCalendarResult
} from '../googleCalendar'

/**
 * Google Calendar IPC channel name constants. Same request/response + status-event
 * model as Confluence; a fully separate connection (independent of Slack/Atlassian).
 * No channel carries a token in either direction — the renderer requests
 * *operations*; main attaches the token.
 */
export const GoogleCalendarChannelName = {
  /** R->M (invoke): current connection status. */
  GetStatus: 'googleCalendar:getStatus',
  /** R->M (invoke): run the desktop OAuth flow; resolves with the new status. */
  Connect: 'googleCalendar:connect',
  /** R->M (invoke): delete the stored token; resolves with not-connected status. */
  Disconnect: 'googleCalendar:disconnect',
  /** R->M (invoke): list events on the primary calendar within a window (paginated). */
  ListEvents: 'googleCalendar:listEvents',
  /**
   * R->M (send): the Google Calendar panel became the active rail surface; main
   * re-composes the default calendar view (current week) and pushes it with
   * `target: 'google-calendar'`. Fire-and-forget — the rail switch never blocks on
   * the read.
   */
  RequestDefaultView: 'googleCalendar:requestDefaultView',
  /** M->R (event): connection status changed. */
  StatusChanged: 'googleCalendar:statusChanged'
} as const

export type GoogleCalendarChannelNameValue =
  (typeof GoogleCalendarChannelName)[keyof typeof GoogleCalendarChannelName]

/**
 * The default-view granularity (calendar-week-day-views-v1, FR-012). Selects the window
 * main builds for the `requestDefaultView` read: a whole month (the original behavior, the
 * DEFAULT), the week containing the anchor, or the single anchor day. Absent/invalid ⇒
 * `'month'` (warn-and-fallback at the main boundary). Additive + read-only — NO new scope.
 */
export type GoogleCalendarDefaultView = 'month' | 'week' | 'day'

/**
 * R->M. The Google Calendar panel's default-view request (calendar-month-year-nav-v1 +
 * calendar-week-day-views-v1). Carries an OPTIONAL target anchor so the panel can navigate
 * to any month/year (and, for week/day, a specific day); ABSENT the param it behaves
 * exactly as today (the CURRENT month, month view). `month`/`day` are **1-based on the
 * wire** (month 1 = January … 12 = December; day 1..31) — main owns the single
 * 1-based→0-based conversion when constructing the window (`new Date(year, month - 1, …)`).
 *
 * Fields:
 *  - `year` + `month` are all-or-nothing (the existing month anchor): neither present ⇒
 *    current month; an invalid/partial pair is warned and falls back to the current month.
 *  - `day` (calendar-week-day-views-v1) is the OPTIONAL day-of-month component the week/day
 *    window anchors on; absent ⇒ day 1 of the anchored month (month view never reads it).
 *  - `view` (calendar-week-day-views-v1) selects the window granularity; absent/invalid ⇒
 *    `'month'` (the default), warned-and-ignored at the boundary.
 *
 * Structurally only `{ year?, month?, day?, view? }` — NO token or secret (FR-018).
 */
export interface GoogleCalendarRequestDefaultViewPayload {
  /** 4-digit calendar year, e.g. 2026. Absent ⇒ current month. */
  year?: number
  /** 1-based month: 1 = January … 12 = December. Absent ⇒ current month. */
  month?: number
  /**
   * 1-based day-of-month (1..31) the week/day window anchors on (calendar-week-day-views-v1).
   * Optional; absent ⇒ day 1 of the anchored month. Ignored by the month view.
   */
  day?: number
  /**
   * The default-view granularity (calendar-week-day-views-v1, FR-012). Absent/invalid ⇒
   * `'month'` (the default month grid), warned-and-ignored at the main boundary.
   */
  view?: GoogleCalendarDefaultView
}

/**
 * The Google Calendar API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.googleCalendar`, alongside (not merged into) `pty`, `ui`, `slack`,
 * `jira`, and `confluence`. Every read resolves with a `GoogleCalendarResult<T>` so
 * the panel branches on `ok` and degrades gracefully. No method takes or returns a
 * token.
 */
export interface GoogleCalendarApi {
  /** R->M. Current connection status. */
  getStatus(): Promise<GoogleCalendarConnectionStatus>
  /** R->M. Run the desktop OAuth flow; resolves with the resulting status. */
  connect(): Promise<GoogleCalendarConnectionStatus>
  /** R->M. Delete the stored token; resolves with not-connected status. */
  disconnect(): Promise<GoogleCalendarConnectionStatus>
  /** R->M. List events on the primary calendar within a window (paginated). */
  listEvents(
    params: GoogleCalendarListEventsParams
  ): Promise<GoogleCalendarResult<GoogleCalendarEventsPage>>
  /**
   * R->M. Tell main to (re)compose + push the default calendar view. Fire-and-forget;
   * the surface arrives via `ui:render` (`target: 'google-calendar'`). Never blocks the
   * rail switch. With NO arg (or an absent month) main reads the CURRENT month — the
   * original "I was switched to" trigger. With an OPTIONAL `{ year, month }` (1-based
   * month) the panel navigates to that month/year (calendar-month-year-nav-v1). With an
   * OPTIONAL `view` + `day` (calendar-week-day-views-v1) main builds the week/day window
   * instead of the month window; absent/invalid `view` ⇒ the month default.
   */
  requestDefaultView(params?: GoogleCalendarRequestDefaultViewPayload): void
  /**
   * M->R. Subscribe to connection-status changes. Returns an unsubscribe fn so the
   * panel can detach on unmount (avoids leaks / double-binding on HMR).
   */
  onStatusChanged(listener: (status: GoogleCalendarConnectionStatus) => void): () => void
}

/* Re-export the Google Calendar event shape for renderer convenience. */
export type { GoogleCalendarEvent }
