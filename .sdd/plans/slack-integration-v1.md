# Plan: Slack Integration (read-only) — v1

**Status**: Draft
**Created**: 2026-06-03
**Last updated**: 2026-06-03
**Spec**: .sdd/specs/slack-integration-v1.md

---

## Summary

Build cosmos's first third-party integration — read-only Slack — and, in doing so, factor
the reusable **Third-Party Integration Foundation** that Jira and Confluence will adopt. The
foundation lives entirely in the Electron **main process** and has three pieces: (1) a generic
PKCE OAuth authorization-code flow handler (no client secret, no hosted backend — a desktop
public-client flow), (2) a `safeStorage`-encrypted token store, and (3) a single per-integration
Web API client that is the *only* place Slack is called. That one client serves **two surfaces
over one connection**: a native React **Slack panel** in the renderer (reached over a new typed
IPC channel set extending the `src/shared/ipc.ts` + `validate.ts` pattern), and a set of
**read-only Slack MCP tools** for the embedded `claude` (reached over a render_ui-style
Unix-domain-socket bridge — a sibling to `UiBridge`, which also generalizes the MCP surface from
"render_ui is the only tool" toward a small tool registry). The token never leaves main in
plaintext: both surfaces request *operations*; main attaches the token.

The user connects by clicking a single **"Connect Slack"** button — no token is ever pasted or
typed. cosmos runs the flow against its OWN registered public Slack client (`client_id` from the
`COSMOS_SLACK_CLIENT_ID` env var, never hardcoded). OAuth uses a **loopback redirect** trying
ports **7421 → 7422 → 7423** in order (`http://127.0.0.1:<bound-port>/callback`) because Slack
requires an exact redirect-URI match; the redirect URI is assembled (and the browser opened) only
once a port binds. Because desktop/loopback redirects may request only USER scopes, the four read
scopes are sent as **`user_scope`** (with `scope` empty); Slack returns a **single user token**
(`xoxp-…`) at `authed_user.access_token` that drives **every** read — channels, history, threads,
user lookups, AND search (`canSearch` = scopes include `search:read`).

## Technical Context

| Item              | Value                                                                                  |
|-------------------|----------------------------------------------------------------------------------------|
| Language          | TypeScript (Node ESM main, React 19 renderer), consistent with existing tree           |
| OAuth model       | Slack **desktop PKCE** public-client flow (verified: docs.slack.dev/authentication/using-pkce). cosmos's OWN registered public client; `client_id` from the **`COSMOS_SLACK_CLIENT_ID` env var** (never hardcoded); **no** `client_secret`; **no** hosted token broker. **`user_scope` only** (desktop/loopback redirects cannot request bot scopes); `scope` empty. Single **user token** (`xoxp-…`) at `authed_user.access_token` drives every read. Long-lived user token; **no refresh token / no silent refresh**. |
| Token at rest     | Electron **`safeStorage`** (OS keychain-backed) `encryptString`/`decryptString`; ciphertext stored as a file under `app.getPath('userData')`. Persists the single access token + granted scopes + team identity. Plaintext never written to disk; never sent to renderer or sandbox. |
| Loopback redirect | `http://127.0.0.1:<port>/callback`, trying ports **7421 → 7422 → 7423** in order. The exact bound port's redirect URI is used; the authorize URL is assembled and the browser opened only **once a port binds** (`awaitLoopbackCallback`'s `onListening(port)` callback). All three ports must be on the Slack app's redirect-URL allowlist. A short-lived `http.Server` in main serves the single callback then closes (3-minute timeout). |
| PKCE primitives   | `node:crypto` only — `randomBytes(32)` → base64url `code_verifier`; `createHash('sha256')` → base64url `code_challenge`; `code_challenge_method=S256`. No new dependency. |
| HTTP client       | Node 18+ global `fetch` (undici, bundled in Electron's Node) for Slack Web API + token endpoints. No axios/got dependency. |
| Slack endpoints   | `https://slack.com/oauth/v2/authorize` (consent), `https://slack.com/api/oauth.v2.access` (code→token; PKCE, no secret), `conversations.list`, `conversations.history`, `conversations.replies`, `search.messages`, `users.info`. Bearer-token auth; cursor pagination via `cursor`/`response_metadata.next_cursor`. |
| Scopes (read-only)| All `user_scope`: `channels:read`, `channels:history`, `users:read`, `search:read`. One user token grants all four. No write scopes, no bot scopes. |
| Files to create   | `src/main/integrations/oauthPkce.ts` (generic PKCE foundation), `src/main/integrations/slackOAuth.ts` (Slack-specific orchestration + response mapping), `src/main/integrations/slackConfig.ts` (endpoints, user scopes, env-sourced client id), `src/main/integrations/tokenStore.ts`, `src/main/integrations/slackClient.ts`, `src/main/slackManager.ts`, `src/main/slackBridge.ts`, `src/mcp/slackMcpServer.ts`, `src/renderer/SlackPanel.tsx`, `src/shared/slack.ts` (Slack DTOs + tool contract), tests under `src/**/__tests__` / `test/`. |
| Files to modify   | `src/shared/ipc.ts` (Slack IPC channels + `SlackApi` on `CosmosApi`; `slack:connect` is **no-arg**), `src/shared/validate.ts` (Slack IPC + bridge validators; **no `validateSlackConnect`** — connect carries no payload), `src/shared/bridge.ts` (generalize socket frames / add Slack bridge frames), `src/preload/index.ts` (expose `window.cosmos.slack`; `connect()` no-arg), `src/main/index.ts` (wire SlackManager + SlackBridge + MCP config; inject `runOAuth` with `shell.openExternal` + `COSMOS_SLACK_CLIENT_ID`), `src/renderer` app shell (mount SlackPanel), `docs/ARCHITECTURE.md`. |

### Module & boundary decisions

**`src/main/integrations/oauthPkce.ts` (foundation, generic).** Integration-agnostic PKCE
helpers + loopback callback server: `createPkcePair()` (S256 verifier/challenge), `createState()`,
`buildAuthorizeUrl({authorizeEndpoint, clientId, scopes, userScopes, redirectUri, state,
codeChallenge})` (omits `scope` when empty, sets `user_scope` when present), `awaitLoopbackCallback({ports,
path, timeoutMs, expectedState, onListening})` → tries the port list in order, fires `onListening(port)`
once a port binds (so the caller assembles the redirect_uri + opens the browser), and resolves
`{code, port}` or rejects on deny/`state` mismatch/timeout, `loopbackRedirectUri(port)`,
`exchangeCodeRaw()` (returns the raw provider JSON — Slack needs this since the user token isn't
top-level) plus `exchangeCode`/`refreshToken`. Integration-agnostic so Jira/Confluence reuse it;
`shell.openExternal` is **injected** by the caller, not imported here (FR-010, SC-012).

**`src/main/integrations/slackOAuth.ts` (Slack-specific orchestration).** `runSlackOAuth({clientId,
openExternal, fetchImpl?, serverFactory?})` orchestrates the foundation: PKCE pair + state → bind the
loopback (ports 7421/7422/7423) → on bind, build the authorize URL (`user_scope` only, `scope`
empty) and `openExternal` it → capture code → `exchangeCodeRaw` at `oauth.v2.access` (no secret) →
`mapSlackTokenResponse(raw)` reads `authed_user.access_token`/`authed_user.scope` + `team.id`/`team.name`,
returning `{userToken, scopes, teamId?, teamName?}`.

**`src/main/integrations/slackConfig.ts`.** `SLACK_AUTHORIZE_ENDPOINT`, `SLACK_TOKEN_ENDPOINT`,
`SLACK_USER_OAUTH_SCOPES` (the four user scopes), `SLACK_SEARCH_SCOPE`, and the env-sourced
`client_id` (`COSMOS_SLACK_CLIENT_ID`, no hardcoded id).

**`src/main/integrations/tokenStore.ts` (foundation, generic).** `safeStorage`-backed store keyed
by integration name. Persists the token set (single access token, granted scopes, workspace/team
identity) as one `safeStorage.encryptString` blob on disk; `load`/`save`/`clear`/`has`. The Slack
user token is long-lived with no refresh token, so there is no silent refresh. Plaintext never
written; never returned to renderer/sandbox (FR-005, FR-006, SC-008).

**`src/main/integrations/slackClient.ts`.** The single Slack Web API client. Thin typed wrappers
over the five read endpoints with Bearer auth, cursor pagination, and a Slack-error→typed-result
mapper: distinguishes `not_connected`, `reconnect_needed` (e.g. `token_revoked`/`invalid_auth`/
`token_expired`), `rate_limited` (HTTP 429 → honor `Retry-After`, FR-026), `search_unavailable`
(missing scope), and transient `network` errors. **Read-only** — no write methods exist (FR-019,
SC-011).

**`src/main/slackManager.ts`.** Orchestrates the above: owns connection state machine
(`not_connected → connecting → connected → reconnect_needed`), runs connect/disconnect, and is
the **only** caller of `slackClient` (FR-008). `connect()` takes **no params** and calls an
injected `runOAuth()` dep (wired to `runSlackOAuth`); it persists a single `accessToken` (the user
token) + `scopes`, and `canSearch` is `scopes.includes('search:read')`. Both surfaces call into
SlackManager: the renderer via IPC handlers in `index.ts`, the MCP tools via `SlackBridge`. The
user token is long-lived (no refresh token), so there is no silent refresh — a token later rejected
by a read flips connection state to `reconnect_needed`. On connect deny/timeout/exchange-error the
manager returns to `not_connected` with a non-secret `lastError`, logging the failure kind via
`console.error('[slack] connect failed:', …)` but **never** a token.

**Native panel boundary — IPC (extends `src/shared/ipc.ts`).** New `SlackChannel` constants +
typed payloads + a `SlackApi` added to `CosmosApi`, exposed as `window.cosmos.slack` by the
preload (FR-007, FR-024). Request/response via `ipcRenderer.invoke`/`ipcMain.handle` (these reads
are request/response, unlike PTY's streaming `send`). Channels: `slack:getStatus`,
`slack:connect` (**no-arg** — it carries no payload, since no token is ever sent inbound),
`slack:disconnect`, `slack:listChannels`, `slack:getHistory`, `slack:getReplies`,
`slack:search`, `slack:getUser`, plus an `M->R` `slack:statusChanged` event for live state. Every
inbound payload with arguments is validated at the main boundary with pure validators in
`validate.ts` (FR-023); `slack:connect` needs **no validator** (no payload to validate).
**No token field is ever part of any Slack IPC payload** (FR-006, SC-008).

**MCP-tool boundary — socket bridge (sibling to `UiBridge`).** A new `SlackBridge`
(`src/main/slackBridge.ts`) mirrors `UiBridge`: a Unix-domain-socket server in main that the
spawned `src/mcp/slackMcpServer.ts` entry script connects to, with main owning request correlation
and pending-call state. The MCP server is registered via the existing main-managed
`--mcp-config` (no project-approval gate) with its socket path threaded through an env var
(`COSMOS_SLACK_BRIDGE_SOCKET`, sibling to `COSMOS_BRIDGE_SOCKET`). Tools (read-only, FR-017/FR-019):
`slack_list_channels`, `slack_read_history`, `slack_read_thread`, `slack_search_messages`,
`slack_lookup_user`. Each forwards to SlackManager and returns the typed result; a not-connected/
reconnect-needed state returns a structured "connect Slack in cosmos first" result, never a hang
(FR-020). Results never include the token (FR-021). Tools compose with `render_ui` but do not add a
new UI channel (FR-022).

**Bridge generalization (`src/shared/bridge.ts`).** Today bridge frames are render_ui-specific
(`render`/`result`). Generalize the framing helpers (`encodeBridgeMessage`, NDJSON) and add Slack
request/result frame types (`slack_call` / `slack_result` with a `callId` + `op` + params +
typed result). This is the spec's "registry of MCP tools" generalization — two independent bridges
(UiBridge, SlackBridge) sharing the NDJSON-over-socket pattern, each owning its own pending-call
state. No change to render_ui behavior.

---

## Implementation Checklist

> Update as work progresses. Notes inline when a step deviates from plan.

### Phase 1 — Interface (types & contracts)

- [x] Re-read `.sdd/specs/slack-integration-v1.md`; confirm no open behavioral questions remain (cred model & loopback port now resolved).
- [x] `src/shared/slack.ts`: Slack DTOs (Channel, Message, ThreadReply, SearchResult, User, ConnectionStatus) + the read-only MCP tool op/param/result contract. Trace every field to a spec read surface (FR-013..FR-017); no invented fields. (FR-025) — also defines `SlackResult<T>` discriminated union + `SlackOp`/`SlackTool` const maps.
- [x] `src/shared/ipc.ts`: add `SlackChannel` constants + typed IPC payloads + `SlackApi` on `CosmosApi`. No token field anywhere. (FR-006, FR-007, FR-025) — named `SlackChannelName` to avoid colliding with the `SlackChannel` DTO.
- [x] `src/shared/bridge.ts`: generalize NDJSON framing; add `slack_call`/`slack_result` frame types + `slackBridgeSocketPath()`. (FR-018, registry generalization)
- [x] Confirm types against spec — no invented properties, read-only only. (FR-019, SC-011)

### Phase 2 — Testing (write before/with implementation)

- [x] `oauthPkce`: verifier length / S256 challenge correctness; authorize-URL param assembly (`user_scope` set, `scope` omitted when empty); loopback callback fires `onListening(port)` then resolves `{code, port}` on match; rejects on `state` mismatch, on `error=access_denied` (deny/cancel), and on timeout. (FR-002, FR-003, FR-004, SC-002) — includes a port-fallback test (first port EADDRINUSE → binds the next). `slackOAuth.mapSlackTokenResponse` reads `authed_user.access_token`/`authed_user.scope`/`team`.
- [x] `tokenStore`: save→load round-trip via `safeStorage`; `clear` removes the blob; `has`; plaintext never written (assert on-disk bytes are ciphertext). (FR-005, FR-009, SC-001, SC-008, SC-010) — also asserts refusal to persist when encryption is unavailable, and corrupt-blob → null.
- [x] `slackClient`: error mapper — `invalid_auth`/`token_revoked`→reconnect_needed, missing search scope→search_unavailable, HTTP 429→rate_limited honoring `Retry-After`, network error→transient; cursor pagination threads `next_cursor`. (FR-026, SC-005, SC-007, SC-009) — `mapSlackError` extracted as a pure exported fn.
- [x] Slack IPC validators (`validate.ts`): happy path; missing/invalid required fields → warn + null (ignored); no token leakage. (FR-023, SC-007) — note: `slack:connect` is no-arg, so there is **no `validateSlackConnect`** (nothing to validate).
- [x] Slack bridge validators: malformed/unknown frame → warn + ignore; unknown `callId` not mis-resolved. (FR-023)
- [x] SlackManager state machine: not_connected → connecting → connected → reconnect_needed; connect via injected `runOAuth` (no-arg); deny/timeout → not_connected with `lastError`; a token rejected by a read → reconnect_needed (no refresh); disconnect → not_connected. (FR-008, FR-009, SC-007, SC-010)
- [x] MCP tools: not-connected → structured "connect Slack first" result (no hang); connected → returns SlackManager result; result carries no secret. (FR-020, FR-021, SC-006, SC-007) — verified at the `SlackBridge.handleCall` boundary (router + per-op param validation), which the MCP server relays verbatim.

### Phase 3 — Implementation (foundation first, then Slack, then surfaces)

- [x] `src/main/integrations/oauthPkce.ts` — PKCE pair, `createState`, `buildAuthorizeUrl` (`user_scope`/empty-`scope`), loopback callback server (ports `7421 → 7422 → 7423`, `/callback` path, `onListening(port)`, timeout + teardown, resolves `{code, port}`), `loopbackRedirectUri`, `exchangeCodeRaw`/`exchangeCode`/`refreshToken`. (FR-001, FR-002, FR-003, FR-004, FR-005) — kept generic: `shell.openExternal` is injected by `slackOAuth.ts`, not imported here.
- [x] `src/main/integrations/slackOAuth.ts` + `slackConfig.ts` — `runSlackOAuth` orchestration (PKCE → loopback → browser → exchange) + `mapSlackTokenResponse` (`authed_user.access_token`/`authed_user.scope`/`team`); endpoints, the four `user_scope` scopes, env-sourced `client_id`. (FR-001, FR-002, FR-005)
- [x] `src/main/integrations/tokenStore.ts` — `safeStorage` encrypt/decrypt, persist single access token + scopes + identity, load/save/clear/has. (FR-005, FR-006, FR-010) — `safeStorage`/`fs` injected via `SafeStorageLike`/`FsLike` for testability. (No refresh token: the Slack user token is long-lived.)
- [x] `src/main/integrations/slackClient.ts` — five read endpoints, Bearer auth, cursor pagination, typed error mapper, read-only. (FR-013, FR-014, FR-017, FR-019, FR-026)
- [x] `src/main/slackManager.ts` — connection state machine; sole caller of slackClient; no-arg `connect()` via injected `runOAuth`; disconnect; one user token serves both surfaces + every read. (FR-008, FR-009)
- [x] `src/main/slackBridge.ts` — Unix-socket server (sibling to UiBridge), NDJSON frames, request correlation + pending-call state, forwards to SlackManager. (FR-018, FR-020)
- [x] `src/mcp/slackMcpServer.ts` — stdio MCP entry script exposing the five read-only tools; thin stdio↔socket relay to SlackBridge via `COSMOS_SLACK_BRIDGE_SOCKET`. (FR-017, FR-018, FR-022)
- [x] `src/shared/validate.ts` — pure validators for the arg-carrying Slack IPC payloads and bridge frames (warn + ignore on invalid); **no `validateSlackConnect`** (connect is no-arg). (FR-023)
- [x] `src/main/index.ts` — instantiate SlackManager + SlackBridge with the window; inject `runOAuth` (wired to `runSlackOAuth` with `shell.openExternal` + `process.env.COSMOS_SLACK_CLIENT_ID`, rejecting clearly if unset); register `ipcMain.handle` for the Slack channels (the `slack:connect` handler is a no-arg passthrough to `slackManager.connect()`); emit `slack:statusChanged`; extend `embeddedMcpConfig` to also register the Slack MCP server with its socket env var; tear down on reload/quit. (FR-007, FR-018, FR-023)
- [x] `src/preload/index.ts` — expose `window.cosmos.slack` (invoke wrappers + `onStatusChanged` subscriber returning an unsubscribe fn). (FR-007, FR-024)
- [x] `src/renderer/SlackPanel.tsx` — native React panel: not-connected→single **"Connect Slack"** button (no token-paste form); connected→channel list (paginated), channel history, thread replies, search (or "search unavailable"), user-name resolution with raw-ID fallback; loading/empty/error states; `lastError`/reconnect Alerts. (FR-011..FR-016, SC-003, SC-004, SC-005) — NOT visually verified (see Deviations).
- [x] Mount SlackPanel in the renderer app shell alongside Terminal + Generated-UI panels. (FR-011) — App shell reworked into the design's `icon rail | Terminal | right column` vertical Radix `Tabs` (Generated-UI + Slack both `forceMount`).
- [x] All tests pass; `npm run typecheck` (node + web) green. (SC-001..SC-012) — 142 tests pass; node+web typecheck clean; `npm run build` succeeds (both MCP entries emit). `slackManager.test.ts` drives connect via an injected `runOAuth`; the `validateSlackConnect` tests were removed with the no-arg connect.
- [x] Reused the foundation (oauthPkce + tokenStore) generically — no Slack specifics leaked into the foundation modules. (FR-010, SC-012)

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md` updated (foundation component, dual-surface pattern, MCP tool registry, token security invariant, Slack pieces) — done in this Plan step; verify it still matches the final code at wrap-up.
- [ ] Update this plan with any deviations.
- [ ] `TODO.md` reconciled at wrap-up (Slack done; note deferred write/v2 scope).

---

## Deviations & Notes

- **2026-06-03**: Open question #2 (credential provisioning) resolved by user → **desktop PKCE public-client, cosmos's own registered `client_id`, no secret, no backend** (verified against Slack PKCE docs). Loopback redirect tries ports `7421 → 7422 → 7423` and uses the exact bound port's `http://127.0.0.1:<port>/callback` because Slack requires exact redirect-URI match. Open question #1 (endpoint/pagination/token-type detail) resolved during this plan via Slack docs.
- **2026-06-03 (impl)**: **`client_id` is read from the `COSMOS_SLACK_CLIENT_ID` env var** (`src/main/integrations/slackConfig.ts`), not hardcoded. With the var unset, `runOAuth` rejects immediately with a clear "Slack is not configured" message and the panel stays not_connected. To enable end-to-end OAuth, the Slack app behind the client id must ONE TIME (in OAuth & Permissions): **(1) Enable PKCE** (marks it a public client — an **irreversible** one-way op) and **(2) allowlist the three loopback redirect URLs** `http://127.0.0.1:{7421,7422,7423}/callback`; without these the token exchange fails with `bad_client_secret`. Then run cosmos with `COSMOS_SLACK_CLIENT_ID=<id>`.
- **2026-06-03 (impl)**: **Connection mechanism is desktop PKCE OAuth, not token-paste.** The panel is a single **"Connect Slack"** button (no inputs); `slack:connect` is no-arg (no inbound token payload; `SlackConnectParams` and `validateSlackConnect` removed). Desktop/loopback redirects can request only USER scopes, so the four read scopes go out as **`user_scope`** with `scope` empty, and Slack returns a **single user token** (`xoxp-…`) at `authed_user.access_token` that drives EVERY read including search (`canSearch` = scopes include `search:read`). There is no bot token and no separate search token. The user token is long-lived with no refresh token — a token rejected by a read flips to `reconnect_needed`.
- **2026-06-03 (impl)**: Two modules beyond the plan's original file list keep the foundation integration-agnostic (FR-010/SC-012): `slackConfig.ts` (endpoints, the four user scopes, env-sourced client id) and `slackOAuth.ts` (`runSlackOAuth` orchestration + `mapSlackTokenResponse` reading `authed_user.access_token`/`authed_user.scope`/`team`). The generic `oauthPkce.ts`/`tokenStore.ts` carry no Slack specifics; `oauthPkce.awaitLoopbackCallback` gained an `onListening(port)` callback so the caller builds the redirect_uri + opens the browser once the port binds.
- **2026-06-03 (impl)**: Naming — the IPC channel const map is `SlackChannelName` (in `ipc.ts`) to avoid colliding with the `SlackChannel` DTO (in `slack.ts`).
- **2026-06-03 (impl)**: MCP not-connected/no-secret guarantees (FR-020/FR-021/SC-006) are unit-tested at the `SlackBridge.handleCall` router boundary (op routing + per-op param validation + structured error, no hang) rather than by spawning the stdio MCP process; `slackMcpServer.ts` is a thin verbatim stdio↔socket relay over that boundary.
- **2026-06-03 (impl, NOT verified)**: `SlackPanel.tsx` and the reworked App shell were typechecked and built but **not visually exercised** — `npm run dev` was intentionally not run (reserved for the main session). Highest-risk-for-a-visual-pass items: (a) the four connection-bar states + reconnect prompt rendering; (b) the channels→history→thread back-stack navigation and `Load more` pagination; (c) search disabled/`search_unavailable` helper copy; (d) the 429 cooldown countdown on the error Alert's Retry button; (e) icon-rail active indicator + tooltips and the `forceMount` hidden-inactive tab behavior. No live Slack call path was exercised (no provisioned `client_id`).
