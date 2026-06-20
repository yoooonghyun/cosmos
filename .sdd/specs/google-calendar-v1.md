# Spec: Google Calendar Integration — v1

**Status**: Draft
**Created**: 2026-06-15
**Supersedes**: —
**Related plan**: .sdd/plans/google-calendar-v1.md

---

## Grounding

**codegraph_explore** (queries run, one-line takeaways):
- `slackConfig atlassianConfig clientConfigResolver clientConfigStore createSlackManager createJiraManager createConfluenceManager TokenStore OAuth runOAuth refresh` → each integration has a manager built in `index.ts` (`createSlackManager`/`createJiraManager`/`createConfluenceManager`) that owns its own `safeStorage`-encrypted `TokenStore` (`<userData>/integrations/<x>.token.enc`); `runOAuth`/`refresh` closures read effective creds via `effectiveClientConfig()` at call time (no restart). `ClientConfigStore` persists user-set client config encrypted, sibling of the token blobs; only set fields present, absent ⇒ env fallback.
- `JiraPanel default view refresh getStatus connect disconnect onStatusChanged PromptComposer SurfaceBridge UiRenderTarget JiraChannelName CosmosApi jira sub-api` → each manager exposes `getStatus`/`connect`/`disconnect` + a `not_connected | connecting | connected | reconnect_needed` state machine, pushes `*:statusChanged`, refreshes proactively+reactively on token expiry. Jira's panel fires `requestDefaultView` on becoming the active rail surface; main runs a bounded read, composes a surface deterministically, and pushes it via `ui:render` (`target:'jira'`).
- `resolveEffective EffectiveClientConfig runAtlassianOAuth refreshAtlassianToken runSlackOAuth redirect URI loopback clientConfigResolver` → `resolveEffective(stored, env)` merges Settings-over-env; `toStatus` is the only renderer-safe shape (ids + sources + `secretConfigured` boolean, NEVER the secret); `diffEffective` drives force-disconnect-on-change. `runAtlassianOAuth` is the confidential-client template (client_id + optional client_secret, PKCE, loopback redirect via `loopbackRedirectUri(port)`, refresh rotates the token).

**Read** (verbatim): `src/shared/ipc.ts` (per-domain `*ChannelName` const + sub-APIs on `CosmosApi`; `UiRenderTarget` union; `SettingsChannelName`/`ClientConfigStatus`/`ClientConfigSavePayload`/`ClientConfigSaveResult`; `SessionSnapshot.panels`), `src/renderer/App.tsx` (`RAIL_ITEMS` + `SurfaceId` + force-mounted `TabsContent`; gear opens `SettingsDialog`; `useConnectedStatus` subscribes per integration), `.sdd/specs/settings-oauth-clients-v1.md` (the OAuth-client-config contract), `docs/ARCHITECTURE.md` §4.3/§4.4/§4.7/§4.8/§4.9 (render-MCP + target-routed panels + integration foundation conventions).

**memory_recall / memory_smart_search**:
- `OAuth client config settings dialog Slack Atlassian integration policy` → no prior stored decision for Google.
- `integration panel rail surface generative UI MCP render server` → confirmed the target-routed end-to-end recipe (extend `UiRenderTarget`, add scoped render MCP entry + rollup input + embedded config, branch `mcpConfig.ts`, add a custom catalog on the panel's own `A2UIProvider`, give the panel a target-filtered SurfaceBridge). Saved a new architecture memory capturing the v1 Google Calendar decisions.

---

## Overview

Add a **Google Calendar** integration to cosmos that connects the user's Google account via
OAuth and renders their calendar — a month/week grid reminiscent of the Google Calendar web UI —
as a new left-rail surface, consistent with the existing Slack / Jira / Confluence integrations
(same OAuth-client-config policy, same connect/disconnect/status model, same target-routed
generative panel, same main-only secret handling). v1 is **read-only**: it displays events from
the user's calendars; it does not create or edit them.

## User Scenarios

> P1 = must, P2 = should, P3 = nice to have.

### Connect Google Calendar from the panel · P1

**As a** cosmos user
**I want to** connect my Google account from the Google Calendar panel with one click
**So that** cosmos can show my calendar without me pasting any token.

**Acceptance criteria:**
- Given the Google Calendar rail surface is open and not connected, when I view it, then I see a connect affordance and a brief explanation, not a calendar grid.
- Given I click Connect, when the desktop OAuth consent flow completes successfully, then the panel moves to connected and shows my calendar grid; my Google account identity (e.g. email / name) is displayed as non-secret status.
- Given I deny consent, the flow times out, or it errors, when control returns to cosmos, then the panel returns to not-connected with a clear, retry-able error message and no token is stored.
- Given a Google client id and secret are not configured (neither in Settings nor env), when I click Connect, then the panel fails fast with a clear "not configured" message pointing me at Settings, and no browser flow starts.

### See my calendar as the default view · P1

**As a** connected user
**I want** the Google Calendar panel to show my upcoming events in a calendar grid as soon as I open it
**So that** I get the Google-Calendar-web-like overview with no extra action.

**Acceptance criteria:**
- Given I am connected, when the Google Calendar surface becomes the active rail surface (and its active tab has no surface yet), then cosmos composes and shows a calendar grid populated from my primary calendar's events for the current period.
- Given the default view is loading, when the read is in flight, then the panel shows a loading state, then replaces it with the grid (or an empty/error state).
- Given my primary calendar has no events in the shown period, when the grid renders, then it shows the empty grid with an unobtrusive "no events" indication rather than an error.
- Given I re-activate the panel or use its refresh affordance, when the refresh runs, then the grid re-fetches and repaints in place without losing my tab.

### Read events without leaking credentials · P1

**As a** security-conscious user
**I want** my Google token and client secret to stay inside cosmos's main process
**So that** they never reach the renderer, a log, an IPC payload, or the embedded `claude` sandbox.

**Acceptance criteria:**
- Given a Google connection is established, when any status, surface, IPC payload, or log is produced, then it contains no access token, no refresh token, and no client secret — only non-secret identity (account email/name) and event data needed to render.
- Given the embedded `claude` agent or an MCP tool composes a Google Calendar surface, when it reads calendar data, then it does so through a main-mediated bridge that attaches the token in main; the agent never sees the token.

### Configure the Google OAuth client in Settings · P1

**As a** user setting up the integration
**I want** to enter my Google OAuth **Client ID** and **Client Secret** in the existing Settings dialog
**So that** I can connect without hand-editing a `.env`, exactly like Slack/Atlassian.

**Acceptance criteria:**
- Given I open Settings, when I view it, then there is a **Google** section with an editable **Client ID** field (pre-filled with the effective value if any) and a write-only **Client Secret** field that shows only a configured / not-configured indicator, never the secret's value.
- Given I save a Google Client ID and/or Secret, when an integration runs OAuth next, then the saved values take effect with no app restart; an unset field falls back to the matching env var.
- Given Google is connected and I change (or clear) the effective Google Client ID or Client Secret, when I save, then Google Calendar is force-disconnected (its stored token is cleared) and its panel shows not-connected; saving with no effective change leaves it connected.

### Stay signed in across token expiry · P2

**As a** returning user
**I want** cosmos to silently refresh my Google access token when it expires
**So that** I keep seeing my calendar without reconnecting every hour.

**Acceptance criteria:**
- Given my access token is expired and a refresh token is stored, when the panel reads events, then cosmos refreshes the token in main, persists the rotated set, and the read succeeds transparently.
- Given a refresh fails (e.g. revoked consent), when the read runs, then the panel moves to a reconnect-needed state with a clear "reconnect to continue" message; no stale token is used.

### Disconnect Google Calendar · P1

**As a** user
**I want** to disconnect Google Calendar
**So that** cosmos forgets my Google token.

**Acceptance criteria:**
- Given I am connected, when I disconnect, then the stored Google token is deleted, the panel returns to not-connected, and only the Google token is affected (Slack/Jira/Confluence are untouched).

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST add a new **Google Calendar** integration that mirrors the established integration policy of Slack/Jira/Confluence: one native rail panel over a typed IPC channel set, a fully independent connection (its own token blob), and main-only secret/token handling. |
| FR-002 | Google Calendar MUST connect via a desktop **Google OAuth 2.0 authorization-code flow** run through the generic loopback OAuth foundation. Google is a **confidential client**: the flow MUST use both a **client id** and a **client secret** (analogous to the Atlassian flow), with PKCE applied per the foundation. |
| FR-003 | The OAuth redirect URI MUST be runtime-derived from the bound loopback port (same mechanism as the other integrations); it MUST NOT be hardcoded or user-editable. |
| FR-004 | v1 MUST request **read-only** calendar scope sufficient to render a calendar view (`https://www.googleapis.com/auth/calendar.readonly`, plus identity scopes such as `openid`/`email` only as needed to display the connected account). The flow MUST request offline access so a refresh token is issued. v1 MUST NOT request any write/modify scope. |
| FR-005 | The Google access token, refresh token, expiry, granted scopes, and account identity MUST be persisted as ONE `safeStorage`-encrypted blob in main (its own `*.token.enc`), exactly like the existing token stores; plaintext MUST never be written and the token MUST never be returned to the renderer or the embedded sandbox. |
| FR-006 | The Google OAuth **client id + client secret** MUST be configurable through the EXISTING Settings dialog and resolver (settings-oauth-clients-v1): the system MUST treat Google as a new logical client with its own `COSMOS_GOOGLE_CLIENT_ID` / `COSMOS_GOOGLE_CLIENT_SECRET` env fallbacks, Settings-over-env precedence, a write-only secret (renderer learns only a configured/not-configured boolean + source), and encrypted-at-rest persistence in the existing client-config store. |
| FR-007 | On a Settings save (or field clear) that CHANGES the effective Google client id or secret, the system MUST force-disconnect Google Calendar by clearing its stored token; a save with NO effective Google change MUST NOT disconnect it. (Google is independent of the Slack and Atlassian logical clients.) |
| FR-008 | The system MUST expose a `getStatus`/`connect`/`disconnect` operation set and a live `statusChanged` push for Google Calendar, with a connection state machine matching the others (`not_connected | connecting | connected | reconnect_needed`) and non-secret identity (account email/name) in the status. |
| FR-009 | On token expiry the system MUST refresh the access token in main (proactively before use and reactively on an auth failure), persist the rotated token set, and surface a `reconnect_needed` state with a clear message when refresh fails — mirroring the Jira/Confluence refresh discipline. |
| FR-010 | The renderer MUST gain a `window.cosmos.googleCalendar` sub-API and a `googleCalendar:` channel namespace defined in the single typed IPC contract (`src/shared/ipc.ts`); no ad-hoc channel strings. Every Google Calendar read MUST resolve a result type the panel can branch on (ok vs not-connected / reconnect-needed / error), like the other integrations. |
| FR-011 | The system MUST add a new **Google Calendar** left-rail surface (its own icon + `UiRenderTarget` value `'google-calendar'`) to the app rail, force-mounted alongside the existing surfaces, with the same tab behavior as the other generative panels. |
| FR-012 | The Google Calendar panel's DEFAULT VIEW MUST be a **calendar grid** (a month/week layout reminiscent of the Google Calendar web UI) populated from the user's **primary** calendar's events for the current period. The default view MUST be composed **deterministically in main** (a bounded read + main-composed surface pushed via `ui:render` with `target:'google-calendar'`) and triggered when the panel becomes the active rail surface, mirroring the Jira default-view pattern. |
| FR-013 | The panel MUST support a refresh that re-fetches the current period's events and repaints the grid in place without tearing down the active tab, consistent with the other panels' refresh behavior. |
| FR-014 | Calendar data reads MUST be reachable by the embedded `claude` via a Google-Calendar-scoped render/read MCP path consistent with the other integrations (a scoped render MCP server stamping `target:'google-calendar'`, a Google-Calendar custom catalog on the panel's own provider, and read-only Google Calendar tools mediated by a main-process bridge that attaches the token). v1 exposes READ tools only — no write tool. |
| FR-015 | Every Google Calendar IPC payload crossing the main boundary MUST be validated; an invalid payload MUST be warned-and-ignored, never crash the process. |
| FR-016 | Event times MUST be rendered correctly with respect to time zones: the panel MUST display events in a consistent, well-defined time zone (the user's local/primary-calendar time zone) and MUST correctly handle all-day events vs timed events. |
| FR-017 | The Google Calendar panel MUST surface distinct **not-connected**, **connecting**, **loading**, **empty (no events)**, **error**, and **reconnect-needed** states, each with clear copy and (where applicable) a retry/connect affordance — never a blank or crashing surface. |
| FR-018 | Google Calendar's per-panel tab state MUST participate in session persistence consistently with the other generative panels (its composed-surface tab state persists; live integration data and tokens are NOT persisted; the panel rehydrates to not-connected / re-fetches on restore). The session snapshot schema MUST be extended (and its version bumped) to include the new panel. |

## Edge Cases & Constraints

- **Not configured.** No effective Google client id or secret (neither Settings nor env) ⇒ Connect fails fast with a clear "configure Google in Settings" message; no browser flow, no token.
- **Consent denied / timeout / error.** Returns to not-connected with a retry-able error; nothing persisted (mirrors the other integrations' connect-failure handling).
- **No refresh token issued.** If Google does not return a refresh token (e.g. offline access not granted / prior consent), the connect MUST fail clearly rather than persist a non-refreshable session, consistent with how Atlassian treats a missing refresh token.
- **Empty calendar.** No events in the shown period renders the empty grid with a "no events" indication, not an error.
- **Multiple calendars.** v1 shows the user's **primary** calendar only. Aggregating/secondary calendars, calendar selection/toggles, and color-by-calendar are explicitly out of scope for v1.
- **Time zones & all-day events.** Timed events render in the user's local/primary time zone; all-day and multi-day events render as such. Recurring events are shown as their expanded instances within the visible period (no recurrence editing).
- **Encryption unavailable.** A save that would persist the Google client secret MUST fail with a clear error rather than write plaintext (same as the existing client-config and token stores); nothing is persisted.
- **Force-disconnect on client change.** Changing/clearing the effective Google client id or secret while connected drops the Google token (FR-007); an unchanged save does not.
- **Independence.** Connecting or disconnecting Google Calendar never affects Slack, Jira, or Confluence, and vice versa.
- **Out of scope (v1):** creating / editing / deleting events; RSVP / responding to invites; reminders/notifications; multiple-calendar selection or overlay; free/busy or scheduling; drag-to-create; any write scope or write MCP tool; non-primary calendars; Google services other than Calendar.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A new Google Calendar icon appears in the left rail; activating it shows a connect affordance when not connected and a calendar grid when connected. |
| SC-002 | A user can connect Google Calendar via the in-app OAuth flow (no pasted token) and see their primary calendar's events in a month/week grid as the default view. |
| SC-003 | Google Client ID + Client Secret are configurable in the existing Settings dialog with the same write-only-secret + settings-over-env semantics; a saved value overrides the corresponding env var on the next connect with no restart. |
| SC-004 | Changing the effective Google client id/secret force-disconnects a connected Google Calendar; an unchanged save leaves it connected; Slack/Jira/Confluence are never affected. |
| SC-005 | The on-disk Google token + client-secret blobs are ciphertext, and no IPC payload to the renderer, log line, surface, or MCP result contains the access token, refresh token, or client secret. |
| SC-006 | An expired access token is refreshed transparently on read; a failed refresh surfaces a clear reconnect-needed state. |
| SC-007 | Not-connected, connecting, loading, empty, error, and reconnect-needed states each render clearly; an invalid Google IPC payload is warned-and-ignored without crashing. |
| SC-008 | Events render with correct time-zone handling, and all-day vs timed events are visually distinguished; an empty period shows a "no events" grid, not an error. |
| SC-009 | Disconnecting Google Calendar deletes its token and returns the panel to not-connected; the embedded `claude` can read calendar data only through the main-mediated bridge (never holds the token). |

---

## Open Questions

- [ ] **Default grid period (month vs week).** The Google Calendar web UI defaults to a week view; cosmos's existing panels favor a single bounded list. v1 assumes a **month grid of the current month** as the default (with the spec leaving week-vs-month as a presentation choice the design step settles). Flag if a specific default (e.g. week) is required.
- [ ] **Identity scope minimization.** FR-004 requests `calendar.readonly` plus minimal identity scopes for display. If account identity can be derived from the Calendar API alone (primary calendar summary/email), the `openid`/`email` scopes MAY be dropped to minimize consent. To be confirmed against the Google API during planning.
