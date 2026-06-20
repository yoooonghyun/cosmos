/**
 * The single Google Calendar REST client (Google Calendar integration v1). The ONLY
 * place Google Calendar is called from — GoogleCalendarManager is its sole caller.
 *
 * READ-ONLY (v1): `getPrimaryCalendar` (identity + time zone) and `listEvents`
 * (the primary calendar's events within a window). Bearer-token auth — the token is
 * passed in per call by the manager; the client never stores or persists it.
 *
 * Every method returns a `GoogleCalendarResult<T>`: a pure error mapper distinguishes
 * `reconnect_needed` (401/403), `rate_limited` (429, honoring `Retry-After`), and
 * transient `network` errors so the surface degrades gracefully and the app never
 * crashes from a Calendar failure.
 *
 * Endpoints:
 *   primary: GET {base}/calendars/primary
 *   events:  GET {base}/calendars/primary/events?timeMin=&timeMax=&singleEvents=true
 *            &orderBy=startTime&maxResults=50&pageToken=
 * where `base = https://www.googleapis.com/calendar/v3`.
 */

import type {
  GoogleCalendar,
  GoogleCalendarAttendee,
  GoogleCalendarError,
  GoogleCalendarEvent,
  GoogleCalendarEventsPage,
  GoogleCalendarResult
} from '../../shared/googleCalendar'
import {
  GOOGLE_CALENDAR_API_BASE,
  GOOGLE_CALENDAR_LIST_PATH,
  GOOGLE_PRIMARY_CALENDAR_ID
} from './googleConfig'

/** Minimal `fetch` shape (injectable; defaults to global fetch). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<GoogleHttpResponse>

export interface GoogleHttpResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

/** Non-secret identity resolved from the primary-calendar read. */
export interface GooglePrimaryCalendar {
  /** The calendar id — Google returns the account email for the primary calendar. */
  id: string
  /** The calendar's display summary (often the account email or name). */
  summary: string
  /** The primary calendar's IANA time zone (e.g. `America/Los_Angeles`). */
  timeZone: string
}

function err(
  kind: GoogleCalendarError['kind'],
  message: string,
  retryAfterSeconds?: number
): GoogleCalendarError {
  return {
    ok: false,
    kind,
    message,
    ...(typeof retryAfterSeconds === 'number' ? { retryAfterSeconds } : {})
  }
}

/**
 * Map a raw Google HTTP failure to a typed {@link GoogleCalendarError} (pure;
 * unit-tested).
 *   429        -> rate_limited (Retry-After honored)
 *   401 / 403  -> reconnect_needed (the manager flips connection state)
 *   else >=400 -> network (recoverable Retry)
 */
export function mapGoogleCalendarError(status: number, retryAfter?: number): GoogleCalendarError {
  if (status === 429) {
    return err(
      'rate_limited',
      'Google Calendar is busy — retrying shortly.',
      typeof retryAfter === 'number' ? retryAfter : undefined
    )
  }
  if (status === 401 || status === 403) {
    return err('reconnect_needed', 'Your Google Calendar connection expired. Reconnect to continue.')
  }
  return err('network', `Google Calendar request failed (HTTP ${status}).`)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Per-call auth threaded by GoogleCalendarManager (never stored). */
export interface GoogleCalendarCallAuth {
  /** The bearer access token to attach. */
  token: string
}

export interface GoogleCalendarClientDeps {
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Base API URL override for tests (else the Calendar v3 base). */
  apiBase?: string
}

/**
 * Map one raw Google attendee to a non-secret {@link GoogleCalendarAttendee}, or undefined
 * when it carries no usable identifier (no name AND no email — dropped, not crashed).
 * Reads ONLY non-secret display fields (calendar-event-detail-v1, FR-008); never a token.
 */
function toAttendee(raw: unknown): GoogleCalendarAttendee | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim() !== '' ? raw.displayName : undefined
  const email = typeof raw.email === 'string' && raw.email.trim() !== '' ? raw.email : undefined
  if (!displayName && !email) {
    return undefined
  }
  const status = typeof raw.responseStatus === 'string' ? raw.responseStatus : undefined
  const responseStatus =
    status === 'accepted' || status === 'declined' || status === 'tentative' || status === 'needsAction'
      ? status
      : undefined
  return {
    ...(displayName ? { displayName } : {}),
    ...(email ? { email } : {}),
    ...(raw.self === true ? { self: true } : {}),
    ...(raw.organizer === true ? { organizer: true } : {}),
    ...(responseStatus ? { responseStatus } : {})
  }
}

/**
 * Map one raw Google event object to a {@link GoogleCalendarEvent}, or undefined when
 * it lacks an id or a usable start/end (a malformed event is dropped, not crashed).
 * Google distinguishes all-day (`{ date }`) from timed (`{ dateTime, timeZone }`).
 *
 * calendar-event-detail-v1 (FR-007/FR-008/FR-010/FR-011): also carries the NON-SECRET
 * detail fields so they ride the already-fetched event to the detail dock without a new
 * fetch — `description` (plain text), `attendees` (non-secret display fields only),
 * `htmlLink` (the public open-in-Google URL), and a `recurring` marker derived from the
 * presence of Google's `recurringEventId`. Each is omitted when absent (no `undefined`
 * keys). NO token/secret field is ever read.
 */
export function toEvent(raw: unknown): GoogleCalendarEvent | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
  if (!id) {
    return undefined
  }
  const startObj = isRecord(raw.start) ? raw.start : undefined
  const endObj = isRecord(raw.end) ? raw.end : undefined
  const startDateTime = typeof startObj?.dateTime === 'string' ? startObj.dateTime : undefined
  const startDate = typeof startObj?.date === 'string' ? startObj.date : undefined
  const endDateTime = typeof endObj?.dateTime === 'string' ? endObj.dateTime : undefined
  const endDate = typeof endObj?.date === 'string' ? endObj.date : undefined

  const allDay = startDate !== undefined && startDateTime === undefined
  const start = startDateTime ?? startDate
  const end = endDateTime ?? endDate
  if (!start || !end) {
    return undefined
  }
  const timeZone =
    typeof startObj?.timeZone === 'string' && startObj.timeZone !== '' ? startObj.timeZone : undefined
  const location = typeof raw.location === 'string' && raw.location !== '' ? raw.location : undefined
  // calendar-event-detail-v1: enriched non-secret detail fields (omitted when absent).
  const description =
    typeof raw.description === 'string' && raw.description.trim() !== '' ? raw.description : undefined
  const attendeesRaw = Array.isArray(raw.attendees) ? raw.attendees : []
  const attendees = attendeesRaw
    .map(toAttendee)
    .filter((a): a is GoogleCalendarAttendee => a !== undefined)
  const htmlLink =
    typeof raw.htmlLink === 'string' && raw.htmlLink.trim() !== '' ? raw.htmlLink : undefined
  const recurring = typeof raw.recurringEventId === 'string' && raw.recurringEventId !== ''
  return {
    id,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    start,
    end,
    allDay,
    ...(!allDay && timeZone ? { timeZone } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(attendees.length > 0 ? { attendees } : {}),
    ...(htmlLink ? { htmlLink } : {}),
    ...(recurring ? { recurring: true } : {})
  }
}

/**
 * Map one raw Google `calendarList` item to a non-secret {@link GoogleCalendar}, or
 * undefined when it lacks an id (a malformed item is dropped, not crashed —
 * shared-calendars-v1, FR-001). Carries only non-secret identity: id, display name
 * (`summaryOverride` preferred over `summary`), `backgroundColor`, `primary`,
 * `accessRole`, `selected`. NO token/secret field is read.
 */
export function toCalendar(raw: unknown): GoogleCalendar | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
  if (!id) {
    return undefined
  }
  const summaryOverride =
    typeof raw.summaryOverride === 'string' && raw.summaryOverride !== '' ? raw.summaryOverride : undefined
  const summary = summaryOverride ?? (typeof raw.summary === 'string' ? raw.summary : '')
  const backgroundColor =
    typeof raw.backgroundColor === 'string' && raw.backgroundColor !== '' ? raw.backgroundColor : undefined
  const accessRole =
    typeof raw.accessRole === 'string' && raw.accessRole !== '' ? raw.accessRole : undefined
  return {
    id,
    summary,
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(raw.primary === true ? { primary: true } : {}),
    ...(accessRole ? { accessRole } : {}),
    ...(typeof raw.selected === 'boolean' ? { selected: raw.selected } : {})
  }
}

export class GoogleCalendarClient {
  private readonly fetchImpl: FetchLike
  private readonly apiBase: string

  constructor(deps: GoogleCalendarClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.apiBase = deps.apiBase ?? GOOGLE_CALENDAR_API_BASE
  }

  /**
   * Issue one GET, returning the parsed JSON body (on 2xx) or a typed
   * {@link GoogleCalendarError}. Read-only.
   */
  private async call(
    url: string,
    token: string
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: GoogleCalendarError }> {
    let res: GoogleHttpResponse
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
      })
    } catch {
      return {
        ok: false,
        error: err('network', 'Could not reach Google Calendar. Check your connection and retry.')
      }
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: mapGoogleCalendarError(429, parseRetryAfter(res.headers.get('retry-after')))
      }
    }
    if (!res.ok) {
      return { ok: false, error: mapGoogleCalendarError(res.status) }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: err('network', 'Google Calendar returned an unreadable response.') }
    }
    if (!isRecord(body)) {
      return { ok: false, error: err('network', 'Google Calendar returned an unexpected response.') }
    }
    return { ok: true, body }
  }

  /**
   * Read the primary calendar (identity + time zone). GET /calendars/primary →
   * `{ id, summary, timeZone }`. The `id` is the account's email for the primary
   * calendar.
   */
  async getPrimaryCalendar(
    auth: GoogleCalendarCallAuth
  ): Promise<GoogleCalendarResult<GooglePrimaryCalendar>> {
    const url = `${this.apiBase}/calendars/${GOOGLE_PRIMARY_CALENDAR_ID}`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    const id = typeof r.body.id === 'string' ? r.body.id : ''
    return {
      ok: true,
      data: {
        id,
        summary: typeof r.body.summary === 'string' ? r.body.summary : id,
        timeZone: typeof r.body.timeZone === 'string' ? r.body.timeZone : ''
      }
    }
  }

  /**
   * List the accessible calendars for the signed-in account. GET
   * /users/me/calendarList → `{ items: [...] }`. Read-only; works under the existing
   * `calendar.readonly` scope (shared-calendars-v1, FR-001/FR-002). Maps each raw item
   * to a non-secret {@link GoogleCalendar} via {@link toCalendar}; a malformed item is
   * dropped (never throws). A failure maps to the same typed errors as the other reads.
   */
  async listCalendars(
    auth: GoogleCalendarCallAuth
  ): Promise<GoogleCalendarResult<GoogleCalendar[]>> {
    const url = `${this.apiBase}${GOOGLE_CALENDAR_LIST_PATH}`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    const rawItems = Array.isArray(r.body.items) ? r.body.items : []
    const items: GoogleCalendar[] = rawItems
      .map(toCalendar)
      .filter((c): c is GoogleCalendar => c !== undefined)
    return { ok: true, data: items }
  }

  /**
   * List a calendar's events within a window. GET /calendars/{calendarId}/events with
   * `singleEvents=true&orderBy=startTime` (expands recurrences, time-ordered) and cursor
   * pagination via `pageToken`/`nextPageToken`. Maps each raw event to a
   * {@link GoogleCalendarEvent}; a malformed event is dropped.
   *
   * `calendarId` defaults to the primary calendar (the google-calendar-v1 behavior). For
   * the shared/multi-calendar view (shared-calendars-v1, FR-004) the manager passes each
   * accessible calendar's id so the same bounded single-page read fans out across them.
   * The id is URL-encoded (calendar ids are often email-like).
   */
  async listEvents(
    auth: GoogleCalendarCallAuth,
    timeMin: string,
    timeMax: string,
    cursor?: string,
    calendarId: string = GOOGLE_PRIMARY_CALENDAR_ID
  ): Promise<GoogleCalendarResult<GoogleCalendarEventsPage>> {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50'
    })
    if (cursor) {
      params.set('pageToken', cursor)
    }
    const url = `${this.apiBase}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    const rawItems = Array.isArray(r.body.items) ? r.body.items : []
    const items: GoogleCalendarEvent[] = rawItems
      .map(toEvent)
      .filter((e): e is GoogleCalendarEvent => e !== undefined)
    const nextCursor =
      typeof r.body.nextPageToken === 'string' && r.body.nextPageToken !== ''
        ? r.body.nextPageToken
        : undefined
    return { ok: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }
  }
}
