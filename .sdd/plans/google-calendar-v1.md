# Plan: Google Calendar Integration — v1

**Status**: Draft
**Created**: 2026-06-16
**Last updated**: 2026-06-16
**Spec**: .sdd/specs/google-calendar-v1.md

---

## Grounding

**codegraph_explore** (queries run, one-line takeaways):
- `createJiraManager createSlackManager createConfluenceManager TokenStore runAtlassianOAuth refreshAtlassianToken clientConfigResolver clientConfigStore resolveEffective diffEffective effectiveClientConfig loopbackRedirectUri` → each integration is a `create<X>Manager(window)` factory in `src/main/index.ts` that builds a `TokenStore` (`<userData>/integrations/<x>.token.enc`, `safeStorage`) + a client + an injected `runOAuth`/`refresh` closure reading `effectiveClientConfig()` at call time (no restart). `resolveEffective(stored, env)` merges Settings-over-env; `toStatus` is the renderer-safe shape (ids + sources + `secretConfigured` boolean, never the secret); `diffEffective` drives force-disconnect. Confirmed the resolver currently knows exactly two logical clients (slack, atlassian) — Google is a NEW third.
- `JiraManager getStatus connect disconnect ensureToken tryRefresh run searchIssues` → the manager state machine (`not_connected | connecting | connected | reconnect_needed`), proactive-refresh-on-expiry + one reactive-refresh-on-401/403, `run()` wrapper, `disconnect()` clears only this token. Google's manager mirrors this exactly.
- `jiraRenderUiServer uiBridge JiraBridge jiraActionDispatcher jiraSurfaceBuilder buildDefaultViewSurface buildBoundIssueListSurface UiRenderTarget pushRender` → target-routed render: a scoped render MCP server stamps `target`, `UiBridge.onMessage` routes by target + settles non-`generated-ui` immediately (display-only), `buildDefaultViewSurface`/bound builders compose a surface deterministically in main, `JiraBridge` is the read/write tool relay through the one manager. Google reuses the SAME shapes; v1 is read-only (no dispatcher).
- `exchangeCodeRaw refreshToken awaitLoopbackCallback buildAuthorizeUrl loopbackRedirectUri TokenExchangeResult` → the OAuth foundation (`src/main/integrations/oauthPkce.ts`) is provider-agnostic: PKCE + loopback callback + a form `exchangeCodeRaw`/`refreshToken` that already supports an optional `clientSecret`. Google is a confidential client like Atlassian, but uses a standard Google authorize/token endpoint with `access_type=offline` + `prompt=consent` to force a refresh token (not Atlassian's `audience`/`accessible-resources`).
- `embeddedMcpConfig SessionSnapshot panels App.tsx SurfaceId RAIL_ITEMS JiraPanel useGenerativePanelTabs` (+ `electron.vite.config.ts` read) → confirmed the 4 places a new scoped render server must register (rollup `input`, `mcpConfig.ts` entry name, `embeddedMcpConfig`, `UiRenderTarget`), `SessionSnapshot.panels` is a fixed-key record (needs a `'google-calendar'` key + `schemaVersion` bump), and `SurfaceId`/`RAIL_ITEMS`/`TabsContent` in `App.tsx` enumerate the rail surfaces.

**memory_recall / memory_smart_search** (from the spec, re-confirmed): no prior Google decision existed; saved a v1 architecture memory capturing the Google-Calendar decisions (third logical client, confidential client, read-only `calendar.readonly`, primary calendar, deterministic main-composed grid). No conflicting prior decisions found.

---

## Summary

> Add a **Google Calendar** integration that mirrors the existing Slack/Jira/Confluence integration
> shape end-to-end: a new left-rail generative panel over a typed `googleCalendar:` IPC namespace, a
> fully independent `safeStorage`-encrypted token blob, main-only secret handling, and a target-routed
> (`'google-calendar'`) deterministic default view. Technically it reuses the provider-agnostic OAuth
> loopback foundation (`oauthPkce.ts`) as a **confidential client** (client id + secret, PKCE,
> `access_type=offline`) like Atlassian, but against Google's own authorize/token endpoints; it adds a
> third logical client to the Settings resolver (`COSMOS_GOOGLE_CLIENT_ID` / `COSMOS_GOOGLE_CLIENT_SECRET`,
> Settings-over-env, write-only secret, independent force-disconnect). The default view is a **calendar
> grid** composed deterministically in main from the user's **primary** calendar's events for the visible
> period (a new `googleCalendarSurfaceBuilder.ts`, pushed via `ui:render` with `target:'google-calendar'`),
> mirroring the Jira default-view pattern. v1 is **read-only** (REST `events.list` on the primary calendar;
> no write scope, no write MCP tool, no deterministic action dispatcher).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload + React renderer; Node MCP entry scripts) |
| Key dependencies  | Existing only: `oauthPkce.ts` (loopback OAuth foundation), `TokenStore`, `clientConfigResolver` + `ClientConfigStore`, `UiBridge` (target-routed render), `@modelcontextprotocol/sdk` (MCP server), `electron.safeStorage`, Google Calendar REST v3 (`events.list`, primary calendar). No new npm packages expected. |
| Files to create   | `src/shared/googleCalendar.ts` (types: status, result union, event/list shapes); `src/main/integrations/googleConfig.ts` (endpoints + scopes); `src/main/integrations/googleOAuth.ts` (run + refresh, confidential client); `src/main/integrations/googleCalendarClient.ts` (REST reads); `src/main/googleCalendarManager.ts` (state machine); `src/main/googleCalendarBridge.ts` (read-only tool relay); `src/main/googleCalendarSurfaceBuilder.ts` (deterministic grid composition); `src/mcp/googleCalendarRenderUiServer.ts` (scoped render server, stamps `target:'google-calendar'`); `src/mcp/googleCalendarMcpServer.ts` (read-only tools); `src/renderer/GoogleCalendarPanel.tsx`; `src/renderer/googleCalendarCatalog/{components.tsx,logic.ts,logic.test.ts,index.ts}`; manager/oauth/client/surface-builder/validate `.test.ts` siblings. |
| Files to modify   | `src/shared/ipc.ts` (`GoogleCalendarChannelName` + `GoogleCalendarApi` on `CosmosApi`; extend `UiRenderTarget` with `'google-calendar'`; add `'google-calendar'` to `SessionSnapshot.panels` + bump `SESSION_SCHEMA_VERSION`; extend `ClientConfigStatus`/save/clear payloads with a `google` section); `src/shared/validate.ts` (Google IPC + bridge validators; extend session-snapshot + client-config validators); `src/main/index.ts` (`createGoogleCalendarManager`, IPC handlers, `requestDefaultView` compose-and-push, `clientConfigEnv()` Google vars, `effectiveClientConfig` consumers, `embeddedMcpConfig` entry, force-disconnect wiring); `src/main/clientConfigResolver.ts` (`googleClientId`/`googleClientSecret` in `EffectiveClientConfig` + `resolveEffective`/`toStatus`/`diffEffective`); `src/main/integrations/clientConfigStore.ts` (`google` block in `ClientConfig`); `src/main/mcpConfig.ts` (`GOOGLE_CALENDAR_RENDER_UI_SERVER_NAME` + entry builder); `electron.vite.config.ts` (two rollup inputs: render + read MCP servers); `src/preload/index.ts` (`googleCalendar` sub-API); `src/renderer/App.tsx` (`SurfaceId`, `RAIL_ITEMS`, `useConnectedStatus`, force-mounted `TabsContent`); `src/renderer/sessionSnapshot.ts` + `src/main/sessionSnapshot.ts` (panel key); `src/renderer/SettingsDialog.tsx` (Google client id + secret section); `docs/ARCHITECTURE.md` (new §4.x Google Calendar integration + §3 rail list + §7 open-questions entry). |

---

## Sequencing & gating

This is a **UI-bearing** feature, so per CLAUDE.md the **design step (`designer` agent) runs BETWEEN this
plan and Interface/Tests** — it owns the calendar-grid catalog visuals + state copy (`.sdd/designs/google-calendar-v1.md`).
Do not start Phase 2/3 panel work until the design spec lands.

Two tracks, the main-only track lands first:

- **Track A — main-only (no design dependency, can land first):** shared types + IPC contract, the OAuth
  config/flow, token store wiring, the manager state machine, the read client, the Settings-resolver Google
  client, the scoped render + read MCP servers + rollup inputs + `embeddedMcpConfig`, the deterministic
  surface builder, and all their unit tests. This delivers connect/disconnect/status/refresh + a composed grid
  pushable to a (not-yet-built) panel.
- **Track B — UI (needs the design spec first):** `GoogleCalendarPanel.tsx`, the `googleCalendarCatalog/`,
  the rail wiring in `App.tsx`, the Settings dialog section, and session-snapshot panel participation.

**Preload gotcha (CLAUDE.md):** adding `window.cosmos.googleCalendar` requires a **full `npm run dev` restart**
(HMR alone leaves the new methods `not a function`). Call this out to whoever runs the app during Track B.

**MCP bundling gotcha (CLAUDE.md):** each new scoped MCP server MUST get a matching rollup `input` in
`electron.vite.config.ts` AND an `embeddedMcpConfig`/`mcpConfig.ts` entry, or it silently never bundles.

---

## Open Questions — resolution

- **OQ1 — Default grid period (month vs week).** DEFERRED to the design step. The plan composes the surface in
  main from a **bounded `events.list` over a visible-period window**; the period bounds (month grid of the
  current month vs current week) are a presentation parameter the surface builder accepts, so the design
  decision changes only the builder's window + the catalog grid layout, not the contract. Builder MUST accept
  an explicit `{ timeMin, timeMax }` window so either choice is a config, not a rewrite.
- **OQ2 — Identity-scope minimization.** RESOLVE at build time. The connected-account identity (email + summary)
  is available from the Calendar API itself: `GET /calendar/v3/calendars/primary` returns `id` (the account's
  primary-calendar email) and `summary`/`timeZone`. So v1 SHOULD request **`calendar.readonly` only** and derive
  identity from the primary-calendar resource, dropping `openid`/`email`. If, during implementation, the
  primary-calendar read does not yield a usable display identity, fall back to adding `openid email` and read
  identity from the userinfo endpoint — record the choice in `googleConfig.ts` + Deviations. Either way no write
  scope, and the flow MUST request `access_type=offline` + `prompt=consent` so a refresh token is issued
  (FR-004); a connect that yields no refresh token FAILS clearly (edge case: no refresh token).

---

## Implementation Checklist

> Milestone-level but concrete. Update as work progresses; add inline notes on deviation.
> Phases 1-4 are Track A (main-only). Phase D is the design gate. Phases 5-7 are Track B (UI).

### Phase 1 — Interface (Track A: shared contract + types)

- [x] Read the spec; confirm OQ1 deferred-to-design and OQ2 resolved (above) — no remaining blockers.
- [x] `src/shared/googleCalendar.ts`: define `GoogleCalendarConnectionStatus` (`state` machine + non-secret
      identity `accountEmail`/`accountName`/`timeZone` + `lastError`), a `GoogleCalendarResult<T>` discriminated
      union mirroring `JiraResult` (`ok` | `not_connected` | `reconnect_needed` | `network` kinds), and the
      event/list read shapes (`GoogleCalendarEvent` with `start`/`end`, an `allDay` flag, `summary`, `timeZone`;
      a `GoogleCalendarEventsPage`). No token/secret fields anywhere.
- [x] `src/shared/ipc.ts`: add `GoogleCalendarChannelName` (`getStatus`/`connect`/`disconnect`/
      `requestDefaultView`/`statusChanged`; optional `refresh`/`listEvents` only if the panel needs them beyond
      the default-view request) + `GoogleCalendarApi`; add `googleCalendar` to `CosmosApi`. Extend
      `UiRenderTarget` with `'google-calendar'`. Add `'google-calendar'` to `SessionSnapshot.panels` and bump
      `SESSION_SCHEMA_VERSION`. Extend `ClientConfigStatus` + `ClientConfigSavePayload`/`ClientConfigClearPayload`
      with a `google` section (clientId + write-only secret indicator).
- [x] `src/main/clientConfigResolver.ts`: add `googleClientId`/`googleClientSecret` to `EffectiveClientConfig`,
      `ClientConfigEnv` (`COSMOS_GOOGLE_CLIENT_ID`/`COSMOS_GOOGLE_CLIENT_SECRET`), `resolveEffective`, `toStatus`
      (secret stays a boolean), and `diffEffective` (independent `google` change flag — NOT tied to atlassian).
- [x] `src/main/integrations/clientConfigStore.ts`: add an optional `google: { clientId?, clientSecret? }` block
      to `ClientConfig`.
- [x] `src/main/integrations/googleConfig.ts`: Google authorize/token endpoints, `GOOGLE_CALENDAR_OAUTH_SCOPES`
      (`['https://www.googleapis.com/auth/calendar.readonly']` per OQ2), the Calendar REST base, and the
      `access_type=offline`/`prompt=consent` authorize params.
- [x] Review types vs spec — no invented properties; no token/secret in any renderer-facing shape.
 — Tests (Track A; write before/with implementation)

- [x] `googleOAuth.test.ts`: happy-path code→token exchange (with secret), refresh-token rotation, and the
      **no-refresh-token → connect fails** edge (FR-004 / edge case), all with an injected fetch + server factory
      (no Electron/network), mirroring the Atlassian OAuth tests.
- [x] `googleCalendarClient.test.ts`: `events.list` happy path (timed + all-day events parsed correctly,
      time-zone normalization — FR-016), empty period → empty page (not error), and HTTP error mapping
      (401/403 → `reconnect_needed`, 429 → rate-limited/`network`, else → `network`).
- [x] `googleCalendarManager.test.ts`: state machine (connect success/deny/timeout → not_connected with
      `lastError`; disconnect clears only this token; proactive refresh on expiry; reactive refresh on
      401/403 then `reconnect_needed` on failure), mirroring `jiraManager.test.ts`.
- [x] `clientConfigResolver` tests (extend existing if present): Google Settings-over-env precedence, `toStatus`
      never leaks the secret, `diffEffective` flips `google` independently of `atlassian`/`slack`.
- [x] `validate` tests: every Google IPC + bridge validator warns-and-ignores malformed/invalid payloads
      (FR-015); session-snapshot validator accepts/round-trips the new panel key and rejects a wrong
      `schemaVersion`. (Bridge relay also covered by `googleCalendarBridge.test.ts`; IPC + bridge frame
      validators by the new `validateGoogleCalendar.test.ts`.)
- [x] `googleCalendarSurfaceBuilder.test.ts`: deterministic grid composition from a fixed events page (stable
      ids, all-day vs timed distinction, empty period → empty-grid surface, accepts an explicit
      `{ timeMin, timeMax }` window per OQ1).
- [x] `googleCalendarCatalog/logic.test.ts`: pure grid/event presentation logic (event → cell placement,
      all-day lane, "no events" state) — written against the design spec after Phase D. (29 assertions: colorId
      → `--event-*` token map, isAllDay, time label, title fallback, monthFromWindow, eventDayKey, buildMonthGrid
      35-cell month/empty/malformed-skip/Monday-start, cellEventDisplay cap/overflow, dayCellAriaLabel.)

### Phase 3 — Implementation (Track A: main)

- [x] `src/main/integrations/googleOAuth.ts`: `runGoogleOAuth` (PKCE + loopback via `awaitLoopbackCallback` +
      `loopbackRedirectUri`; authorize URL with `access_type=offline`, `prompt=consent`, scopes; exchange via
      `exchangeCodeRaw` WITH `client_secret`; require a `refresh_token` or throw) and `refreshGoogleToken`
      (`refreshToken` foundation helper with the secret). Identity (email/summary/timeZone) resolved from the
      primary-calendar read per OQ2. No token/secret logged.
- [x] `src/main/integrations/googleCalendarClient.ts`: REST reads — `getPrimaryCalendar` (identity + time zone)
      and `listEvents({ auth, timeMin, timeMax, cursor? })` against the **primary** calendar, single-calendar
      only (FR; multi-calendar out of scope). Map HTTP errors to the `GoogleCalendarResult` kinds; normalize
      all-day vs timed + time zones (FR-016).
- [x] `src/main/googleCalendarManager.ts`: the state machine + `run()` wrapper (proactive/reactive refresh,
      `reconnect_needed`), `getStatus`/`connect`/`disconnect`, `listEvents`/`getPrimaryCalendar` reads — modeled
      on `JiraManager`. Own `TokenStore` at `<userData>/integrations/googleCalendar.token.enc`.
- [x] `src/main/googleCalendarSurfaceBuilder.ts`: `buildDefaultViewSurface(page, window)` → an A2UI surface using
      the Google Calendar catalog's grid component(s); deterministic ids; empty-period empty-grid surface;
      accepts the OQ1 window. (No bound/refreshable descriptor required for v1 — refresh re-composes + re-pushes,
      mirroring Jira's default-view path; a bound variant is a later enhancement.)
- [x] `src/main/googleCalendarBridge.ts`: read-only bridge relay (its own socket, sibling to the Slack/Jira/
      Confluence bridges) routing READ ops through the one manager; validate each frame, warn-and-ignore invalid.
      No write op.
- [x] `src/mcp/googleCalendarRenderUiServer.ts`: clone the Jira render server; `render()` stamps
      `target:'google-calendar'`; teach the tool the Google Calendar custom catalog. Display-only (UiBridge
      settles non-`generated-ui` immediately).
- [x] `src/mcp/googleCalendarMcpServer.ts`: read-only Calendar tools (list events / read primary calendar) over
      the Google Calendar bridge socket, mirroring `slackMcpServer.ts` (no write tool — FR-014).
- [x] `src/main/mcpConfig.ts`: add `GOOGLE_CALENDAR_RENDER_UI_SERVER_NAME` + its entry builder.
- [x] `electron.vite.config.ts`: add rollup `input` entries `mcp/googleCalendarRenderUiServer` and
      `mcp/googleCalendarMcpServer` (CLAUDE.md gotcha).
- [x] `src/main/index.ts`: `createGoogleCalendarManager(window)` (token store + client + injected
      `runOAuth`/`refresh` reading `effectiveClientConfig().google*` at call time, fail-fast "configure Google in
      Settings" when unset — FR; `onStatusChanged` → `googleCalendar:statusChanged`); register the
      `getStatus`/`connect`/`disconnect` IPC handlers + the `requestDefaultView` send-handler (bounded
      `listEvents` → `buildDefaultViewSurface` → `pushRender({ target:'google-calendar' })`); wire the bridge +
      `embeddedMcpConfig` entries; extend `clientConfigEnv()` with the Google vars; in the Settings save handler,
      force-disconnect Google when `diffEffective().google` is true (independent of atlassian/slack).
- [x] `src/shared/validate.ts`: Google IPC + bridge validators; extend the session-snapshot + client-config
      validators for the Google panel key + `google` config block.
- [x] All Track A tests pass; reused the OAuth foundation, TokenStore, resolver, and UiBridge — no duplicated
      OAuth/token/render logic. — Design gate (designer agent, BEFORE Track B)

- [ ] `designer` produces `.sdd/designs/google-calendar-v1.md`: the calendar-grid catalog (month/week layout —
      settles OQ1), event cell + all-day lane, and the not-connected / connecting / loading / empty / error /
      reconnect-needed states (FR-017), reusing the Tailwind + shadcn/ui design system and the existing panel
      chrome (tab strip, footer, connect CTA, refresh button).
- [ ] Main session does any build wiring the design needs (shadcn installs/components) — designer has no Bash.

### Phase 5 — Interface/Tests (Track B: panel + catalog, after Phase D)

- [x] `src/renderer/googleCalendarCatalog/{components.tsx,logic.ts,index.ts}`: the catalog grid component(s) +
      pure logic per the design spec; `logic.test.ts` covers event placement / all-day / empty (Phase 2 item).
- [x] Confirm catalog component prop shapes match the surface builder's emitted props (no drift). Builder root is
      `EventList {events[], timeMin, timeMax, hasMore}` (flat events); the catalog's `EventList` renders the
      design month grid by bucketing those flat events via `logic.buildMonthGrid` (month derived from `timeMin`).

### Phase 6 — Implementation (Track B: renderer)

- [x] `src/renderer/GoogleCalendarPanel.tsx`: model on `JiraPanel.tsx` — status subscription
      (`getStatus`/`onStatusChanged`), connect/disconnect, `useGenerativePanelTabs({ target:'google-calendar' })`,
      `requestDefaultInActiveTab(() => window.cosmos.googleCalendar.requestDefaultView())` on active+connected
      empty tab, the refresh button (re-fetch + repaint in place — FR-013), and the full state matrix (FR-017)
      hosted on a target-filtered `A2UIProvider` with `googleCalendarCatalog`. (Own Google-specific connect CTA +
      footer status — the Atlassian `ConnectForm`/`ConnectionStatus` hardcode Atlassian copy + use
      `siteName`/`accountName`; Google needs `accountName`/`accountEmail` + read-only Google copy. `MonthGridSkeleton`
      is the loading state. v1 read-only → no JQL/detail/search chrome; `cancelOnClose:false`.)
- [x] `src/renderer/App.tsx`: add `'google-calendar'` to `SurfaceId`, a `RAIL_ITEMS` entry (lucide `CalendarDays`,
      appended LAST so the Cmd+Shift+[/] cycle indices stay stable), a force-mounted `TabsContent` rendering
      `GoogleCalendarPanel`, and a `useConnectedStatus` `google` key.
- [x] `src/preload/index.ts`: expose the `googleCalendar` sub-API (mirror `jira`). **Already landed in Track A**
      (the shared `CosmosApi` requires the key, so it was pulled forward — see Track-A deviation). **Full
      `npm run dev` restart required** before the renderer can call `window.cosmos.googleCalendar.*`.
- [x] `src/renderer/SettingsDialog.tsx`: a **Google** section with an editable Client ID (pre-filled with the
      effective value) and a write-only Client Secret (configured/not-configured indicator only), saving via the
      existing settings save/clear API; independent force-disconnect on effective change (FR-007). Generalized the
      `SecretField` helper to take per-integration `id`/`clearAriaLabel` (was Atlassian-hardcoded) so two secret
      fields coexist; extended drafts/`buildSavePayload`/`wouldDisconnect`/`confirmTitle`/`FeedbackSlot`
      (`disconnected['google-calendar']`) + `connected.google`.
- [x] `src/renderer/sessionSnapshot.ts` + `src/main/sessionSnapshot.ts`: include `'google-calendar'` in the
      per-panel build/hydrate. **No per-panel edit needed** — snapshot reporting is generic via
      `useGenerativePanelTabs` keyed by `target`, and `sessionRegistry.assembleSnapshot` already carries the
      `'google-calendar'` key (Track-A type-completeness fix). Composed-surface tabs persist; the live default view
      (`composed:false`) re-fetches on restore. (Deviation noted below.)
- [x] All Track B tests pass; panel reuses the shared tab/refresh/composer chrome — no bespoke duplicates.
      Typecheck clean; full vitest 1204/1204 green (incl. 29 new `googleCalendarCatalog/logic.test.ts`).

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: a new §4.x "Google Calendar Integration" (confidential-client OAuth,
      `calendar.readonly`, primary calendar, deterministic main-composed grid, read-only MCP path), add Google
      Calendar to the §3 rail-surface list + `UiRenderTarget` set, and a §7 completed-work entry. Note the third
      logical Settings client.
- [ ] Reconcile `TODO.md` (handled by `wrap-up`).
- [ ] Update this plan's Deviations with any divergence (esp. OQ2's identity-scope outcome and OQ1's settled
      period).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-16**: Plan authored. OQ2 (identity scope) resolved to `calendar.readonly`-only with identity from the
  primary-calendar resource, with a documented `openid email` fallback. OQ1 (month vs week) deferred to the
  design step; surface builder takes an explicit `{ timeMin, timeMax }` window so the choice is config, not a
  rewrite.
- **2026-06-16 (Track A landed — developer)**: Phases 1-3 (main-only) complete; typecheck + full vitest green
  (1156 tests, incl. 19 new `validateGoogleCalendar.test.ts`). Notable Track-A decisions/deviations:
  - **`index.ts` default-view window**: `handleGoogleCalendarDefaultView` reads a forward **7-day** window
    (`now` → `now+7d`, RFC-3339) and uses the UN-BOUND `buildDefaultViewSurface` (NOT the adapter-bound Jira
    path) — the refreshable descriptor binding is deferred to a later enhancement per Phase-3 note; refresh
    re-composes + re-pushes.
  - **`requestDefaultView` validator reuse**: the Google `RequestDefaultView` send-handler reuses the generic
    empty-payload validator `validateRequestDefaultView` (same as Jira) rather than a Google-specific one — the
    payload is `Record<string, never>`, so no new validator was warranted.
  - **`src/preload/index.ts` `googleCalendar` sub-API pulled into Track A**: the plan listed preload under Track
    B (Phase 6), but `CosmosApi` (shared contract) now *requires* the `googleCalendar` key, so the typed web
    build fails to compile without it. Implemented the read-only sub-API now (mirrors `jira`) to keep the build
    green. Gotcha unchanged: a full `npm run dev` restart is required before the renderer can call the new
    `window.cosmos.googleCalendar.*` methods (HMR alone leaves them `not a function`).
  - **`src/renderer/sessionRegistry.ts` minimal type-completeness fix**: `assembleSnapshot` gained an optional
    `'google-calendar'` contribution + an `emptyGenerative()` default so the renderer compiles against the bumped
    `SessionSnapshot.panels` shape. This is a structural default only — actual panel participation
    (`GoogleCalendarPanel`, catalog, rail wiring, SettingsDialog section, `sessionSnapshot.ts` renderer
    contribution) remains **Track B / deferred** to the designer + a follow-up developer pass.
  - **MCP wiring**: both Google entries in `embeddedMcpConfig` are built from the `mcpConfig.ts` entry helpers
    (`googleCalendarToolsMcpServerEntry` / `googleCalendarRenderUiMcpServerEntry`) so the interactive + headless
    configs cannot drift; matching rollup inputs were already present in `electron.vite.config.ts`.
  - **Seams left for Track B**: `target: 'google-calendar'` render frames are pushed by main but no renderer
    panel consumes them yet; `googleCalendarCatalog/logic.test.ts` + its components are unwritten (await the
    design spec); `App.tsx`/`SettingsDialog.tsx`/renderer `sessionSnapshot.ts` untouched.
- **2026-06-16 (Track B landed — developer)**: Phases 5-6 (renderer panel + catalog + rail/Settings wiring)
  complete; typecheck clean + full vitest **1204/1204** green (29 new `googleCalendarCatalog/logic.test.ts`).
  Notable Track-B decisions/deviations:
  - **`EventList` renders the month grid (no separate `CalendarMonthGrid` root).** Track A's green
    `googleCalendarSurfaceBuilder.test.ts` locks an `EventList` root with a FLAT `events[]` + `timeMin`/`timeMax`
    window; the design wants a month grid. Reconciled WITHOUT touching Track A: the catalog's `EventList`
    component buckets the flat events onto day cells via `logic.buildMonthGrid` (month derived from `timeMin`)
    and renders the design's `CalendarMonthGrid`/`DayCell`/`EventChip`/`MonthEmptyNote` as internal pieces.
    `EventRow` is registered too (a standalone single-event chip the agent vocabulary advertises).
  - **`eventDayKey` all-day validation fix.** Initial `logic.ts` returned `start.slice(0,10)` verbatim for an
    all-day event, but `eventDayKey({ start: 'nope' })` must drop out as `''` (the test). Added a
    `^\d{4}-\d{2}-\d{2}$` guard on the sliced head so a non-date all-day-ish start buckets nowhere instead of a
    garbage key.
  - **No per-panel `sessionSnapshot.ts` change (as predicted in Track A).** Renderer snapshot contributions are
    reported generically by `useGenerativePanelTabs` keyed by `target`; `sessionRegistry.assembleSnapshot` +
    `main/sessionSnapshot.ts` already carry the `'google-calendar'` key. The plan's Phase-6 line for
    `sessionSnapshot.ts` is therefore satisfied with zero edits — checked off as a no-op.
  - **Own Google connect CTA + footer status (not the shared Atlassian `atlassianPanelBits`).** Those hardcode
    Atlassian copy + a `siteName`/`accountName` shape; Google uses read-only Google copy + `accountName`/
    `accountEmail`. Small local `GoogleConnectForm`/`GoogleConnectionStatus` in the panel; all other chrome
    (tab strip, refresh button, composer, footer, A2UIProvider host) is the shared primitives.
  - **`SecretField` generalized.** Was Atlassian-id-hardcoded; now takes `id`/`clearAriaLabel` so the Atlassian
    and Google secret fields coexist in one dialog without colliding element ids.
  - **`--event-*` token family** (6 hues + foreground) added to `src/renderer/index.css` in all three blocks
    (`@theme inline`, `:root`, `.dark`) so the catalog references only `bg-event-*` tokens (no raw hex), per
    design §5. **GUI not exercised** (no `npm run dev` in this pass) — manual verification items in the report.
