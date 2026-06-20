/**
 * Shared Google Calendar DTOs + the read-only Google Calendar MCP tool contract
 * (Google Calendar integration v1).
 *
 * Single source of truth for the calendar content shapes exchanged between the main
 * process, the renderer (over `window.cosmos.googleCalendar` IPC), and the Google
 * Calendar MCP tools (over the socket bridge). Every field traces to a read surface
 * in .sdd/specs/google-calendar-v1.md.
 *
 * v1 is READ-ONLY: there are NO write params/results, NO bound-action namespace, and
 * NO scope-gate machinery (contrast `src/shared/jira.ts`, which carries the write
 * surface). The access/refresh token + client_secret NEVER appear here: every field
 * is non-secret content/metadata or a non-secret identifier.
 *
 * This file deliberately mirrors `src/shared/jira.ts` (read paths only) so the
 * surface branches on the same `Result<T>`/`Page<T>` discipline.
 */

/* ------------------------------------------------------------------------- *
 * Connection status (shared by the panel + status events)
 * ------------------------------------------------------------------------- */

/**
 * The connection state machine the renderer reflects:
 *   not_connected    — no token; show the Connect button, perform no reads.
 *   connecting       — the browser OAuth flow is in progress (consent + exchange).
 *   connected        — a valid token (refreshed transparently on expiry); reads allowed.
 *   reconnect_needed — refresh itself failed; prompt re-connect.
 */
export type GoogleCalendarConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'reconnect_needed'

/**
 * Connection status surfaced to the renderer. Carries only non-secret identity
 * metadata — NEVER the token, refresh token, or client_secret.
 */
export interface GoogleCalendarConnectionStatus {
  /** Current connection state. */
  state: GoogleCalendarConnectionState
  /** Primary-calendar account email when connected (non-secret identity). */
  accountEmail?: string
  /** Account display name when connected (non-secret identity). */
  accountName?: string
  /** Primary calendar time zone (IANA, e.g. `America/Los_Angeles`) when connected. */
  timeZone?: string
  /**
   * Human-readable reason the last connect attempt failed (cancelled, denied,
   * state-mismatch, not-configured, no refresh token). Set when a connect ends
   * back at not_connected so the panel can explain why. Never a secret.
   */
  lastError?: string
}

/* ------------------------------------------------------------------------- *
 * Read-surface DTOs
 * ------------------------------------------------------------------------- */

/**
 * One calendar event in the default view (read-only). All fields are non-secret
 * content/metadata. Timed events carry RFC-3339 `start`/`end` instants; all-day
 * events carry date-only `start`/`end` (`allDay` true), as Google returns
 * `date` vs `dateTime`.
 */
export interface GoogleCalendarEvent {
  /** Event id (stable within the calendar; non-secret). */
  id: string
  /**
   * The id of the calendar this event came from (shared-calendars-v1, FR-005). Tagged
   * onto each event when the default view aggregates ALL accessible calendars, so the
   * renderer can color it by calendar and a legend toggle can filter it. Absent on the
   * single-primary degrade path (FR-014). Non-secret.
   */
  calendarId?: string
  /** Event title/summary; '' when the API omits it. */
  summary: string
  /**
   * Start instant. RFC-3339 date-time for timed events; date-only (`YYYY-MM-DD`)
   * for all-day events (`allDay` true).
   */
  start: string
  /**
   * End instant. RFC-3339 date-time for timed events; date-only (`YYYY-MM-DD`)
   * for all-day events (Google's exclusive end date).
   */
  end: string
  /** True when this is an all-day event (Google `date` form), false for timed. */
  allDay: boolean
  /** Event-level time zone when supplied (IANA); absent for all-day events. */
  timeZone?: string
  /** Free-text location when present (non-secret). */
  location?: string
  /**
   * Free-text event description as PLAIN TEXT (calendar-event-detail-v1, FR-007). Carried
   * so the detail dock can show it without a new fetch. Absent when the API omits it (the
   * dock then shows a calm "No description"). Plain text only — any HTML the API returns is
   * NOT rendered as markup (no sanitize surface in v1). Non-secret.
   */
  description?: string
  /**
   * The event's attendees as supplied by Google (calendar-event-detail-v1, FR-008). Each
   * entry carries only non-secret display fields (a display name and/or email, plus the
   * optional self/organizer/response markers when Google distinguishes them). Absent for a
   * solo/personal event. Non-secret — NO token or derived identity.
   */
  attendees?: GoogleCalendarAttendee[]
  /**
   * The event's own public "open in Google Calendar" URL (`htmlLink`,
   * calendar-event-detail-v1, FR-010). A NON-SECRET, non-token-bearing Google Calendar URL
   * opened in the system browser. Absent ⇒ the detail omits the link (FR-010 degrade).
   */
  htmlLink?: string
  /**
   * True when this event is one instance of a recurring series (calendar-event-detail-v1,
   * FR-011, SHOULD). Set from Google's `recurringEventId` presence so the detail can show a
   * small "part of a series" marker. Absent/false ⇒ a one-off event. The occurrence's own
   * `start`/`end` already carry the instance time (the FR-011 MUST). Non-secret.
   */
  recurring?: boolean
}

/**
 * One non-secret attendee of an event (calendar-event-detail-v1, FR-008). Carries only the
 * display fields Google supplies; NO token or derived identity. Every field optional so a
 * malformed/partial attendee degrades (the detail shows whatever it has) rather than throwing.
 */
export interface GoogleCalendarAttendee {
  /** Display name when Google supplies one. */
  displayName?: string
  /** Email address when supplied (often the only identifier). */
  email?: string
  /** True when this attendee is the signed-in user (Google `self`). Optional indicator. */
  self?: boolean
  /** True when this attendee is the event organizer (Google `organizer`). Optional indicator. */
  organizer?: boolean
  /** Google's `responseStatus` when present: accepted / declined / tentative / needsAction. */
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

/**
 * A page of events plus the cursor for the next page. `nextCursor` is absent when
 * there are no more pages. Maps Google's `nextPageToken` into the same opaque-cursor
 * model the panel's "Load more" consumes.
 */
export interface GoogleCalendarEventsPage {
  /** The events on this page, time-ordered. */
  items: GoogleCalendarEvent[]
  /** Opaque cursor for the next page, or absent when no more pages exist. */
  nextCursor?: string
}

/* ------------------------------------------------------------------------- *
 * Shared / multi-calendar view DTOs (shared-calendars-v1)
 * ------------------------------------------------------------------------- */

/**
 * One accessible calendar's NON-SECRET identity, as read from Google
 * `GET /users/me/calendarList` (shared-calendars-v1, FR-003). This is the RAW shape the
 * client maps each `calendarList` item to (the main process consumes it to order/cap +
 * resolve a color token). Every field is non-secret identity/metadata — NO token,
 * secret, or other sensitive field is carried.
 */
export interface GoogleCalendar {
  /** Calendar id (e.g. the account email for primary, or a shared-calendar address). */
  id: string
  /**
   * Display name: Google `summaryOverride` (the per-account rename) when present, else
   * `summary`. '' when the API omits both (the renderer degrades to the id).
   */
  summary: string
  /**
   * The calendar's Google color (`backgroundColor`, a hex like `#7986cb`) when supplied.
   * Mapped DETERMINISTICALLY onto a bounded cosmos `--event-*` token in the surface
   * builder (FR-007) — a raw hex NEVER reaches a renderer component.
   */
  backgroundColor?: string
  /** True for the account's primary calendar (FR-003); absent/false otherwise. */
  primary?: boolean
  /** The account's access role for this calendar (e.g. `owner`, `reader`); non-secret. */
  accessRole?: string
  /**
   * Google's per-account "shown" preference (`selected`). The legend's initial
   * shown/hidden state defaults from this (FR-010): shown when `selected !== false`.
   * Absent/unreadable ⇒ the calendar defaults to shown.
   */
  selected?: boolean
}

/**
 * The bounded set of cosmos event-color TOKEN NAMES a calendar resolves to
 * (shared-calendars-v1, FR-006/FR-007). The six base hues (carried over from
 * google-calendar-v1) PLUS the six shared-calendars-v1 additions; `gray` is the
 * unknown/absent fallback. The surface builder resolves this name ONCE per calendar and
 * ships it on the legend entry so the catalog never re-derives a color and the legend
 * swatch + event chips always agree. A token NAME, NEVER a raw hex.
 */
export type GoogleCalendarColorToken =
  | 'blue'
  | 'green'
  | 'purple'
  | 'red'
  | 'amber'
  | 'gray'
  | 'teal'
  | 'cyan'
  | 'indigo'
  | 'magenta'
  | 'pink'
  | 'olive'

/**
 * One per-calendar LEGEND entry as carried on the composed surface (shared-calendars-v1,
 * FR-008). The surface builder maps each accessible {@link GoogleCalendar} to this shape,
 * resolving its `backgroundColor` to a bounded `colorToken` (FR-007). Non-secret:
 * id/name/token/flags only — never a `backgroundColor` hex or any secret.
 */
export interface GoogleCalendarLegendEntry {
  /** Calendar id (matches each event's `calendarId` so the renderer can filter/color). */
  id: string
  /** Display name (`summaryOverride`/`summary`; '' degrades to the id at render). */
  summary: string
  /** The RESOLVED cosmos `--event-*` token name (FR-007) — never a raw hex. */
  colorToken: GoogleCalendarColorToken
  /** Google's per-account "shown" preference; seeds the legend's initial state (FR-010). */
  selected?: boolean
  /** True for the account's primary calendar; the builder orders it first (FR-014). */
  primary?: boolean
}

/* ------------------------------------------------------------------------- *
 * Read operation results — discriminated union
 * ------------------------------------------------------------------------- */

/**
 * Why a Google Calendar read could not complete. Each maps to a graceful,
 * recoverable state; never a crash, hang, or stack trace.
 *   not_connected    — no token; "connect Google Calendar in cosmos first".
 *   reconnect_needed — refresh failed; prompt re-connect.
 *   rate_limited     — Google 429/403 rateLimitExceeded; honor Retry-After.
 *   network          — transient network/HTTP error; recoverable Retry.
 */
export type GoogleCalendarErrorKind =
  | 'not_connected'
  | 'reconnect_needed'
  | 'rate_limited'
  | 'network'

/** A failed Google Calendar read. Carries NO secret. */
export interface GoogleCalendarError {
  /** Discriminates a failure result from `ok`. */
  ok: false
  /** Why the read failed. */
  kind: GoogleCalendarErrorKind
  /** Human-readable, non-alarming message for the panel / tool result. */
  message: string
  /** For `rate_limited`: seconds to wait before retrying (Retry-After). */
  retryAfterSeconds?: number
}

/** A successful Google Calendar read carrying its typed data. */
export interface GoogleCalendarOk<T> {
  /** Discriminates a success result from an error. */
  ok: true
  /** The read's typed data. */
  data: T
}

/**
 * Every Google Calendar read returns this discriminated result so the surface
 * branches on `ok` and degrades gracefully on failure.
 */
export type GoogleCalendarResult<T> = GoogleCalendarOk<T> | GoogleCalendarError

/* ------------------------------------------------------------------------- *
 * Read operation parameter shapes (shared by IPC + MCP tool surfaces)
 * ------------------------------------------------------------------------- */

/**
 * Params for listing events on the primary calendar. The time window is explicit
 * (`timeMin`/`timeMax`, RFC-3339); the surface builder supplies the default
 * (e.g. the current week). `cursor` (Google `nextPageToken`) paginates.
 */
export interface GoogleCalendarListEventsParams {
  /** Inclusive lower bound (RFC-3339) for event end times. */
  timeMin: string
  /** Exclusive upper bound (RFC-3339) for event start times. */
  timeMax: string
  /** Cursor (Google `nextPageToken`) for the next page; absent for the first page. */
  cursor?: string
  /**
   * Which calendar to read (shared-calendars-v1, FR-004). Absent ⇒ the primary calendar
   * (the google-calendar-v1 behavior). The shared/multi-calendar fan-out passes each
   * accessible calendar's id. Non-secret.
   */
  calendarId?: string
}

/* ------------------------------------------------------------------------- *
 * Adapter descriptor — Google Calendar concrete shapes
 *
 * The Google Calendar wiring of the SHARED, secret-free `AdapterDescriptor`
 * (`src/shared/adapter.ts`). `dataSource` maps to a manager READ (`listEvents` for
 * the default view); `query` carries only the non-secret time window/cursor — never
 * a token. Persisted in the tab snapshot + carried on the `adapter.*` dispatch path.
 * ------------------------------------------------------------------------- */

import type { AdapterDescriptor, AdapterQuery } from './adapter'

/**
 * The Google Calendar `dataSource` discriminators. Maps 1:1 to a manager READ the
 * adapter dispatcher re-executes. Reused from {@link GoogleCalendarOp} so the
 * descriptor, the resolver, and the IPC reads never disagree on a string.
 */
export const GoogleCalendarAdapterSource = {
  /** Default-view surface → `listEvents({ timeMin, timeMax, cursor })`. */
  ListEvents: 'listEvents'
} as const

export type GoogleCalendarAdapterSourceName =
  (typeof GoogleCalendarAdapterSource)[keyof typeof GoogleCalendarAdapterSource]

/**
 * The query for a Google Calendar `listEvents` descriptor. Non-secret: the time
 * window the surface was composed from + an optional opaque cursor for pagination.
 * Mirrors {@link GoogleCalendarListEventsParams} so the resolver passes it through.
 */
export interface GoogleCalendarListEventsAdapterQuery extends AdapterQuery {
  /** Inclusive lower bound (RFC-3339) for the listed window (non-secret). */
  timeMin: string
  /** Exclusive upper bound (RFC-3339) for the listed window (non-secret). */
  timeMax: string
  /** Opaque next-page cursor (Google `nextPageToken`); absent on the first page. */
  cursor?: string
}

/**
 * A Google Calendar adapter descriptor — the {@link AdapterDescriptor} narrowed to
 * the single read source. Discriminated by `dataSource`. Secret-free.
 */
export type GoogleCalendarAdapterDescriptor = AdapterDescriptor & {
  dataSource: typeof GoogleCalendarAdapterSource.ListEvents
  query: GoogleCalendarListEventsAdapterQuery
}

/**
 * Build a secret-free Google Calendar `listEvents` descriptor for a default-view
 * surface. Carries only the time window + (optionally) the cursor — never a token.
 */
export function googleCalendarListEventsDescriptor(
  timeMin: string,
  timeMax: string,
  cursor?: string
): GoogleCalendarAdapterDescriptor {
  return {
    dataSource: GoogleCalendarAdapterSource.ListEvents,
    query: { timeMin, timeMax, ...(cursor ? { cursor } : {}) }
  }
}

/* ------------------------------------------------------------------------- *
 * Read-only MCP tool contract
 * ------------------------------------------------------------------------- */

/**
 * The Google Calendar MCP tool names. Centralized so the entry script, the bridge,
 * and the manager never disagree on a string literal. v1 is read-only.
 */
export const GoogleCalendarTool = {
  /** List events on the primary calendar within a time window (paginated). Read-only. */
  ListEvents: 'google_calendar_list_events'
} as const

export type GoogleCalendarToolName =
  (typeof GoogleCalendarTool)[keyof typeof GoogleCalendarTool]

/**
 * The bridge-level Google Calendar operation discriminator. Each maps 1:1 to a
 * manager method; both the MCP tools and the IPC handlers route through these so the
 * single main-process client serves both surfaces. v1 is read-only.
 */
export const GoogleCalendarOp = {
  ListEvents: 'listEvents'
} as const

export type GoogleCalendarOpName =
  (typeof GoogleCalendarOp)[keyof typeof GoogleCalendarOp]
