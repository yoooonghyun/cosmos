/**
 * googleCalendarSurfaceBuilder — pure Google Calendar → A2UI 0.9 surface composition
 * (Google Calendar integration v1). The composer for the per-switch DEFAULT VIEW and
 * a recoverable error notice.
 *
 * v1 is READ-ONLY: the default view renders an `EventList` carrying the listed events
 * as STATIC props (the `src/shared/googleCalendar.ts` shapes); there is no input
 * component, no bound action. The window (`timeMin`/`timeMax`) the events were read
 * for is carried so the panel can label the range.
 *
 * Pure mapping: NO Calendar API calls, no IPC, no secrets. Carries only non-secret
 * content/identifiers (event id/summary/start/end) — never a token.
 */

import type { A2uiSurfaceUpdate, GoogleCalendarDefaultView } from '../shared/ipc'
import type {
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleCalendarEventsPage,
  GoogleCalendarLegendEntry
} from '../shared/types/googleCalendar'
import { calendarColorToken } from '../shared/types/googleCalendarColor'

/** An A2UI 0.9 component definition: an id + a `component` discriminator + props. */
type Component = { id: string; component: string } & Record<string, unknown>

/** The default-view surfaceId (exported so main can identify the default view). */
export const SURFACE_DEFAULT_VIEW = 'google-calendar-default-view'

/**
 * The explicit time window a default view was composed for. Non-secret RFC-3339
 * instants; carried on the surface so the panel can label the range without re-deriving it.
 */
export interface GoogleCalendarViewWindow {
  /** Inclusive lower bound (RFC-3339). */
  timeMin: string
  /** Exclusive upper bound (RFC-3339). */
  timeMax: string
}

/** A recoverable notice rendered inside the Google Calendar host (non-secret message). */
export interface GoogleCalendarSurfaceNotice {
  kind: 'success' | 'error'
  message: string
}

/** A deterministic per-invocation id minter (containers reference children by id). */
function makeIds(): (hint: string) => string {
  let n = 0
  return (hint) => `${hint}-${n++}`
}

/** Map one event to the static prop object an `EventList` item / `EventRow` wants. */
function eventRow(event: GoogleCalendarEvent): Record<string, unknown> {
  return {
    id: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    ...(event.timeZone ? { timeZone: event.timeZone } : {}),
    ...(event.location ? { location: event.location } : {}),
    // shared-calendars-v1 (FR-005): tag each event with its owning calendar so the catalog
    // can color it by calendar + a legend toggle can filter it. Absent on primary-only.
    ...(event.calendarId ? { calendarId: event.calendarId } : {}),
    // calendar-event-detail-v1 (FR-007/FR-008/FR-010/FR-011): carry the NON-SECRET detail
    // fields onto each event so the renderer-local detail dock renders without a new fetch.
    // Omitted when absent (no `undefined` keys). No token/secret ever crosses here.
    ...(event.description ? { description: event.description } : {}),
    ...(event.attendees && event.attendees.length > 0 ? { attendees: event.attendees } : {}),
    ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
    ...(event.recurring ? { recurring: true } : {})
  }
}

/**
 * Map one accessible calendar to its NON-SECRET legend entry, RESOLVING its Google
 * `backgroundColor` to a bounded cosmos `--event-*` token ONCE here (shared-calendars-v1,
 * FR-006/FR-007) so the catalog never re-derives a color and the legend swatch + the
 * event chips always agree. A raw `backgroundColor` hex NEVER reaches the surface.
 */
function legendEntry(calendar: GoogleCalendar): GoogleCalendarLegendEntry {
  return {
    id: calendar.id,
    summary: calendar.summary,
    colorToken: calendarColorToken(calendar),
    ...(typeof calendar.selected === 'boolean' ? { selected: calendar.selected } : {}),
    ...(calendar.primary === true ? { primary: true } : {})
  }
}

/**
 * Compose the per-switch DEFAULT VIEW surface from a bounded events page + the window
 * it was read for. A single `EventList` root carrying the events as static props +
 * the labeled window; the catalog component renders the count header + EventRows (and
 * its own empty state for a 0-event page).
 */
export function buildDefaultViewSurface(
  page: GoogleCalendarEventsPage,
  window: GoogleCalendarViewWindow
): A2uiSurfaceUpdate {
  const id = makeIds()
  const root = id('root')
  const components: Component[] = [
    {
      id: root,
      component: 'EventList',
      events: page.items.map(eventRow),
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      hasMore: page.nextCursor !== undefined
    }
  ]
  return { surfaceId: SURFACE_DEFAULT_VIEW, components }
}

/**
 * The merged shared/multi-calendar view a {@link buildSharedViewSurface} composes from:
 * the ordered+capped accessible calendars (the legend source) + the merged events (each
 * tagged with its `calendarId`). Mirrors the manager's aggregated read. Non-secret.
 */
export interface GoogleCalendarSharedView {
  /** The ordered+capped accessible calendars (primary → selected → rest). */
  calendars: GoogleCalendar[]
  /** The merged events from every successfully-read calendar, each tagged `calendarId`. */
  events: GoogleCalendarEvent[]
}

/**
 * Compose the per-switch DEFAULT VIEW surface for the SHARED / multi-calendar view
 * (shared-calendars-v1, FR-004/FR-008/FR-016). Same single `EventList` root as
 * {@link buildDefaultViewSurface} but additionally carries:
 *  - `calendars[]` — the per-calendar legend, each entry with its RESOLVED color token
 *    (FR-007), so the catalog renders the legend + colors chips by calendar (the same
 *    `EventList` root feeds BOTH the native panel and the agent/MCP render path — FR-016).
 *  - each event tagged with its owning `calendarId` (FR-005).
 *
 * Additive + backward-compatible: a single-calendar (`calendars.length <= 1`) or
 * primary-only view still renders today's grid (the catalog suppresses a trivial legend).
 * `hasMore` is false — the shared view reads ONE bounded page per calendar (no aggregate
 * pagination in v1). Pure mapping: NO API calls, NO token.
 *
 * calendar-week-day-views-v1 (FR-001): `viewKind` rides onto the EventList root so the
 * catalog routes the MONTH grid (`'month'`, the default) vs the WEEK/DAY schedule. The same
 * flat `events[]` + `calendars[]` + window feed all three layouts; only the layout changes.
 * Defaults to `'month'` so existing callers (and the agent/MCP path) keep the grid unchanged.
 */
export function buildSharedViewSurface(
  view: GoogleCalendarSharedView,
  window: GoogleCalendarViewWindow,
  viewKind: GoogleCalendarDefaultView = 'month'
): A2uiSurfaceUpdate {
  const id = makeIds()
  const root = id('root')
  const components: Component[] = [
    {
      id: root,
      component: 'EventList',
      events: view.events.map(eventRow),
      calendars: view.calendars.map(legendEntry),
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      hasMore: false,
      // 'month' is the default; omit it to keep the back-compat surface byte-identical.
      ...(viewKind !== 'month' ? { view: viewKind } : {})
    }
  ]
  return { surfaceId: SURFACE_DEFAULT_VIEW, components }
}

/**
 * Compose a single-`Notice` surface for a recoverable, non-`reconnect_needed` read
 * failure (a `reconnect_needed` routes to the native Connect/Reconnect via
 * `statusChanged`). The `Notice` component colors the error. No crash, no token.
 */
export function buildNoticeSurface(notice: GoogleCalendarSurfaceNotice): A2uiSurfaceUpdate {
  return {
    surfaceId: SURFACE_DEFAULT_VIEW,
    components: [
      {
        id: 'root',
        component: 'Notice',
        noticeKind: notice.kind,
        message: notice.message
      }
    ]
  }
}
