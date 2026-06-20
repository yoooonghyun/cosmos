/**
 * Google OAuth + read-scope + endpoint configuration (Google Calendar integration v1).
 *
 * Centralizes the authorize/token endpoints, the read-only Calendar scope, the
 * Calendar REST base, and the Google-specific authorize params so an endpoint/scope
 * swap is one edit. Mirrors `atlassianConfig.ts`.
 *
 * Google is a CONFIDENTIAL client (client_id + client_secret), so the secret is
 * required at the token POST (added there, never in the authorize URL, never logged).
 * `access_type=offline` + `prompt=consent` force Google to issue a refresh token on
 * the first grant (Google only returns a refresh token when offline access is
 * requested with explicit consent). v1 is READ-ONLY: the single `calendar.readonly`
 * scope, no write scopes.
 */

/** Google authorize endpoint (consent page opened in the system browser). */
export const GOOGLE_AUTHORIZE_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth'
/** Google token endpoint (code->token exchange + refresh rotation). */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/**
 * Google Calendar scopes — READ-ONLY (v1). The single `calendar.readonly` scope
 * grants list/read across the user's calendars; no write/manage scopes. Identity
 * (account email / name / primary-calendar time zone) is resolved from the primary
 * calendar read itself, so no extra `userinfo`/`openid` scope is required.
 */
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly'
]

/**
 * Extra authorize-URL params Google requires to issue a refresh token: `access_type
 * =offline` (return a refresh token) + `prompt=consent` (force the consent screen so
 * a refresh token is re-issued even on re-auth). `include_granted_scopes=true` keeps
 * previously granted scopes. None is a secret.
 */
export const GOOGLE_AUTHORIZE_EXTRA_PARAMS: Record<string, string> = {
  access_type: 'offline',
  include_granted_scopes: 'true'
}

/** Google `prompt` value (forces consent so a refresh token is re-issued). */
export const GOOGLE_AUTHORIZE_PROMPT = 'consent'

/**
 * Google Calendar REST v3 base. Callers append `/calendars/...` or `/calendars/
 * primary/events` paths. `Authorization: Bearer <access token>`.
 */
export const GOOGLE_CALENDAR_API_BASE =
  'https://www.googleapis.com/calendar/v3'

/** The primary-calendar id alias Google accepts in place of the account's email. */
export const GOOGLE_PRIMARY_CALENDAR_ID = 'primary'

/* ------------------------------------------------------------------------- *
 * Shared / multi-calendar view bounds (shared-calendars-v1, FR-013)
 *
 * The shared-calendar view reads `GET /users/me/calendarList` and fans out a
 * per-calendar `listEvents` over the same month window. The reads are BOUNDED so an
 * account with many calendars cannot make the view do unbounded work or hang. The
 * `calendar.readonly` scope ALREADY grants `calendarList` + per-calendar event reads
 * (see the scope comment above) — NO new OAuth scope, NO re-consent.
 * ------------------------------------------------------------------------- */

/**
 * The path (relative to {@link GOOGLE_CALENDAR_API_BASE}) for the signed-in account's
 * calendar list — `GET /users/me/calendarList` (shared-calendars-v1, FR-001). Read-only.
 */
export const GOOGLE_CALENDAR_LIST_PATH = '/users/me/calendarList'

/**
 * Max calendars whose events one month view aggregates (shared-calendars-v1, FR-013).
 * Calendars are ordered primary → `selected:true` → the rest, and this cap is applied
 * AFTER that ordering so the most relevant calendars always win. A bounded constant so a
 * later tweak is one edit.
 */
export const GOOGLE_CALENDAR_MAX_CALENDARS = 25

/**
 * Max per-calendar events reads in flight at once during the bounded fan-out
 * (shared-calendars-v1, FR-013). Keeps the aggregate read responsive without firing all
 * 25 reads simultaneously. The per-calendar read itself stays the SAME single bounded
 * page (`maxResults=50`, `singleEvents=true&orderBy=startTime`) — NO multi-page loop.
 */
export const GOOGLE_CALENDAR_FANOUT_CONCURRENCY = 6
