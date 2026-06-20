/**
 * GoogleCalendarManager — owns the Google Calendar connection state machine and is the
 * SOLE caller of {@link GoogleCalendarClient} (Google Calendar integration v1). Both
 * surfaces (the native panel over IPC, the MCP tools over the bridge) route their
 * *reads* through this one manager so they share one token and one connection. The
 * token never leaves main: callers request reads; the manager reads the token from the
 * store and attaches it.
 *
 * State machine (mirrors JiraManager):
 *   not_connected -> connecting -> connected -> reconnect_needed
 *
 * Connecting runs the Google desktop OAuth flow ({@link runGoogleOAuth}), resolves the
 * primary-calendar identity, and persists the access+refresh token + expiry + identity
 * encrypted. Reads transparently refresh on expiry/401: the refreshed token set is
 * persisted and the read retried ONCE. Only when refresh itself fails does the manager
 * flip to reconnect_needed.
 *
 * v1 is READ-ONLY: the only operation is `listEvents`. There is NO write path, NO
 * scope-gate (contrast JiraManager's `write:jira-work` short-circuit). Google does NOT
 * rotate the refresh token on every refresh, so the rotated set PRESERVES the existing
 * refresh token when the response omits it.
 *
 * The token store, client, OAuth runner, and refresher are injected so the state
 * machine is unit-testable without Electron, the browser, or the network.
 */

import type {
  GoogleCalendar,
  GoogleCalendarConnectionStatus,
  GoogleCalendarEvent,
  GoogleCalendarEventsPage,
  GoogleCalendarListEventsParams,
  GoogleCalendarResult
} from '../shared/googleCalendar'
import type { GoogleCalendarCallAuth, GoogleCalendarClient } from './integrations/googleCalendarClient'
import {
  GOOGLE_CALENDAR_FANOUT_CONCURRENCY,
  GOOGLE_CALENDAR_MAX_CALENDARS
} from './integrations/googleConfig'
import type { GoogleOAuthResult } from './integrations/googleOAuth'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { TokenExchangeResult } from './integrations/oauthPkce'
import { expiryFromSeconds } from './integrations/tokenStore'

/** A refresh callback the manager invokes when the access token is expired/rejected. */
export type GoogleRefreshFn = (refreshToken: string) => Promise<TokenExchangeResult>

export interface GoogleCalendarManagerDeps {
  client: GoogleCalendarClient
  tokenStore: TokenStore
  /**
   * Run the Google desktop OAuth flow (opens the browser, captures the redirect,
   * exchanges the code, resolves identity). Injected so the state machine is
   * unit-testable (main wires this to {@link runGoogleOAuth} with the Calendar scope).
   */
  runOAuth: () => Promise<GoogleOAuthResult>
  /** Refresh the access token; main wires {@link refreshGoogleToken}. Non-rotating. */
  refresh: GoogleRefreshFn
  /** Notify on every state change (main wires this to `googleCalendar:statusChanged`). */
  onStatusChanged?: (status: GoogleCalendarConnectionStatus) => void
}

export class GoogleCalendarManager {
  private readonly deps: GoogleCalendarManagerDeps
  private state: GoogleCalendarConnectionStatus['state'] = 'not_connected'
  private lastError: string | null = null

  constructor(deps: GoogleCalendarManagerDeps) {
    this.deps = deps
    if (this.deps.tokenStore.has()) {
      this.state = 'connected'
    }
  }

  /** Current connection status (non-secret identity only). */
  getStatus(): GoogleCalendarConnectionStatus {
    const tokens = this.state === 'not_connected' ? null : this.deps.tokenStore.load()
    const accountEmail = readExtraString(tokens, 'accountEmail')
    const timeZone = readExtraString(tokens, 'timeZone')
    return {
      state: this.state,
      ...(accountEmail ? { accountEmail } : {}),
      ...(tokens?.accountName ? { accountName: tokens.accountName } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(this.state === 'not_connected' && this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private setState(state: GoogleCalendarConnectionStatus['state']): void {
    this.state = state
    this.deps.onStatusChanged?.(this.getStatus())
  }

  /**
   * Connect via the Google desktop OAuth flow. Opens the browser for consent,
   * exchanges the code, resolves identity, then persists the token set and moves to
   * connected. On deny/timeout/error/missing-refresh-token, returns to not_connected
   * with a clear lastError. No token is logged or returned to the renderer.
   */
  async connect(): Promise<GoogleCalendarConnectionStatus> {
    if (this.state === 'connecting') {
      return this.getStatus()
    }
    this.lastError = null
    this.setState('connecting')

    let oauth: GoogleOAuthResult
    try {
      oauth = await this.deps.runOAuth()
    } catch (err) {
      this.lastError = 'Google Calendar connection was cancelled or failed. Click Connect to try again.'
      console.error('[google-calendar] connect failed:', err instanceof Error ? err.message : err)
      this.setState('not_connected')
      return this.getStatus()
    }

    this.deps.tokenStore.save(toStoredTokenSet(oauth))
    this.setState('connected')
    return this.getStatus()
  }

  /** Delete the stored token; return to not_connected. Only this product's token. */
  disconnect(): GoogleCalendarConnectionStatus {
    this.deps.tokenStore.clear()
    this.setState('not_connected')
    return this.getStatus()
  }

  private auth(tokens: StoredTokenSet): GoogleCalendarCallAuth {
    return { token: tokens.accessToken }
  }

  /**
   * Ensure a usable access token: load it, refresh PROACTIVELY when expired, persist
   * the refreshed set, and return it. A refresh failure flips to reconnect_needed and
   * returns a structured error.
   */
  private async ensureToken(): Promise<StoredTokenSet | GoogleCalendarResult<never>> {
    const tokens = this.deps.tokenStore.load()
    if (!tokens) {
      this.setState('not_connected')
      return { ok: false, kind: 'not_connected', message: 'Connect Google Calendar in cosmos first.' }
    }
    if (this.deps.tokenStore.isExpired() && tokens.refreshToken) {
      const refreshed = await this.tryRefresh(tokens)
      if (!refreshed) {
        return {
          ok: false,
          kind: 'reconnect_needed',
          message: 'Your Google Calendar connection expired. Reconnect to continue.'
        }
      }
      return refreshed
    }
    return tokens
  }

  /**
   * Refresh + persist the new token set, preserving the non-secret identity (account
   * email, name, time zone). Google does NOT rotate the refresh token, so the existing
   * refresh token is preserved when the response omits it. Returns the new set, or null
   * on failure (after flipping to reconnect_needed). NEVER logs the token.
   */
  private async tryRefresh(tokens: StoredTokenSet): Promise<StoredTokenSet | null> {
    if (!tokens.refreshToken) {
      this.setState('reconnect_needed')
      return null
    }
    try {
      const result = await this.deps.refresh(tokens.refreshToken)
      const refreshedSet: StoredTokenSet = {
        ...tokens,
        accessToken: result.accessToken,
        // Non-rotating: keep the existing refresh token unless Google returns a new one.
        refreshToken: result.refreshToken ?? tokens.refreshToken,
        ...(typeof result.expiresInSeconds === 'number'
          ? { expiresAtMs: expiryFromSeconds(result.expiresInSeconds) }
          : {})
      }
      this.deps.tokenStore.save(refreshedSet)
      return refreshedSet
    } catch (err) {
      console.error('[google-calendar] token refresh failed:', err instanceof Error ? err.message : err)
      this.setState('reconnect_needed')
      return null
    }
  }

  /**
   * Run a read: ensure a token (refreshing on expiry), call the client, and — if the
   * call returns `reconnect_needed` (a 401/403 the proactive refresh did not pre-empt)
   * — attempt ONE reactive refresh + retry before surfacing it.
   */
  private async run<T>(
    fn: (auth: GoogleCalendarCallAuth) => Promise<GoogleCalendarResult<T>>
  ): Promise<GoogleCalendarResult<T>> {
    const ensured = await this.ensureToken()
    if ('ok' in ensured) {
      return ensured as GoogleCalendarResult<T>
    }
    let tokens = ensured
    let result = await fn(this.auth(tokens))
    if (!result.ok && result.kind === 'reconnect_needed' && tokens.refreshToken) {
      const refreshed = await this.tryRefresh(tokens)
      if (refreshed) {
        tokens = refreshed
        result = await fn(this.auth(tokens))
      }
    }
    if (!result.ok && result.kind === 'reconnect_needed' && this.state !== 'reconnect_needed') {
      this.setState('reconnect_needed')
    }
    return result
  }

  /**
   * List a calendar's events within a window (read-only). `params.calendarId` selects
   * the calendar; absent ⇒ the primary calendar (the google-calendar-v1 behavior). The
   * shared/multi-calendar view passes each accessible calendar's id (shared-calendars-v1,
   * FR-004).
   */
  listEvents(
    params: GoogleCalendarListEventsParams
  ): Promise<GoogleCalendarResult<GoogleCalendarEventsPage>> {
    return this.run((auth) =>
      this.deps.client.listEvents(auth, params.timeMin, params.timeMax, params.cursor, params.calendarId)
    )
  }

  /**
   * List the accessible calendars for the signed-in account (read-only,
   * shared-calendars-v1 FR-001). Routes through {@link run} so the token is refreshed
   * transparently on expiry/401, exactly like the event reads. Works under the existing
   * `calendar.readonly` scope — NO new scope (FR-002).
   */
  listCalendars(): Promise<GoogleCalendarResult<GoogleCalendar[]>> {
    return this.run((auth) => this.deps.client.listCalendars(auth))
  }

  /**
   * Aggregate events from ALL accessible calendars over one month window
   * (shared-calendars-v1, FR-004/FR-012/FR-013). Reads the calendar list, orders it
   * (primary → `selected:true` → rest) and caps it at {@link GOOGLE_CALENDAR_MAX_CALENDARS},
   * then fans out a bounded per-calendar single-page `listEvents` ≤
   * {@link GOOGLE_CALENDAR_FANOUT_CONCURRENCY} in flight, tagging each event with its
   * owning `calendarId`. Partial failures DEGRADE (FR-012): a calendar whose read fails is
   * skipped (its legend entry stays) while the successes are merged. Only when the calendar
   * LIST read itself fails is the structured error surfaced (so the panel can fall back to
   * its existing error/reconnect state). The token never leaves main.
   */
  async listAggregatedEvents(
    params: GoogleCalendarListEventsParams
  ): Promise<GoogleCalendarResult<GoogleCalendarAggregatedView>> {
    const calendarsResult = await this.listCalendars()
    if (!calendarsResult.ok) {
      // The calendar LIST read failed (or not_connected/reconnect_needed) — surface it so
      // the panel falls back to its existing error / reconnect-needed state (FR-012).
      return calendarsResult
    }

    const ordered = orderAndCapCalendars(calendarsResult.data, GOOGLE_CALENDAR_MAX_CALENDARS)
    // Degenerate: no accessible calendars at all → an empty merged view (the empty grid).
    if (ordered.length === 0) {
      return { ok: true, data: { calendars: [], events: [], anyCalendarFailed: false } }
    }

    const events: GoogleCalendarEvent[] = []
    let anyCalendarFailed = false
    // Bounded concurrency: process the ordered calendars in chunks of ≤ N in flight
    // (Promise.allSettled). A rejected/failed per-calendar read is counted + skipped, never
    // failing the whole view (FR-012).
    for (let i = 0; i < ordered.length; i += GOOGLE_CALENDAR_FANOUT_CONCURRENCY) {
      const chunk = ordered.slice(i, i + GOOGLE_CALENDAR_FANOUT_CONCURRENCY)
      const settled = await Promise.allSettled(
        chunk.map((cal) =>
          this.listEvents({ timeMin: params.timeMin, timeMax: params.timeMax, calendarId: cal.id })
        )
      )
      settled.forEach((outcome, idx) => {
        const cal = chunk[idx]
        if (outcome.status !== 'fulfilled' || !outcome.value.ok) {
          anyCalendarFailed = true
          return
        }
        for (const ev of outcome.value.data.items) {
          events.push({ ...ev, calendarId: cal.id })
        }
      })
    }

    return { ok: true, data: { calendars: ordered, events, anyCalendarFailed } }
  }
}

/**
 * The merged shared/multi-calendar read (shared-calendars-v1). Carries the ordered+capped
 * accessible calendars (the legend source) and the merged events (each tagged with its
 * `calendarId`), plus a flag noting whether ANY per-calendar read failed so the surface
 * can show the quiet partial-failure note (FR-012). Non-secret throughout.
 */
export interface GoogleCalendarAggregatedView {
  /** The ordered+capped accessible calendars (primary → selected → rest). */
  calendars: GoogleCalendar[]
  /** The merged events from every successfully-read calendar, each tagged `calendarId`. */
  events: GoogleCalendarEvent[]
  /** True when ≥1 per-calendar read failed while others succeeded (FR-012, quiet note). */
  anyCalendarFailed: boolean
}

/**
 * Order accessible calendars primary → `selected:true` → the rest, then cap at `max`
 * (shared-calendars-v1, FR-013). The cap is applied AFTER the ordering so the most
 * relevant calendars always win. Stable within each tier (preserves Google's order).
 * Pure + node-testable. A non-array degrades to empty.
 */
export function orderAndCapCalendars(
  calendars: GoogleCalendar[],
  max: number
): GoogleCalendar[] {
  const list = Array.isArray(calendars) ? calendars : []
  const tier = (c: GoogleCalendar): number => {
    if (c.primary === true) {
      return 0
    }
    return c.selected !== false ? 1 : 2
  }
  // Stable sort by tier (preserve input order within a tier).
  const ordered = list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => tier(a.c) - tier(b.c) || a.i - b.i)
    .map((x) => x.c)
  return max >= 0 ? ordered.slice(0, max) : ordered
}

/** Map a completed OAuth result to the persisted token set (identity in `extra`). */
function toStoredTokenSet(oauth: GoogleOAuthResult): StoredTokenSet {
  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    ...(typeof oauth.expiresAtMs === 'number' ? { expiresAtMs: oauth.expiresAtMs } : {}),
    scopes: oauth.scopes,
    ...(oauth.accountName ? { accountName: oauth.accountName } : {}),
    extra: {
      ...(oauth.accountEmail ? { accountEmail: oauth.accountEmail } : {}),
      ...(oauth.timeZone ? { timeZone: oauth.timeZone } : {})
    }
  }
}

function readExtraString(tokens: StoredTokenSet | null, key: string): string | undefined {
  const extra = tokens?.extra
  return extra && typeof extra[key] === 'string' ? (extra[key] as string) : undefined
}
