# Spec: Slack Integration (read-only) — v1

**Status**: Review
**Created**: 2026-06-03
**Supersedes**: —
**Related plan**: .sdd/plans/slack-integration-v1.md

---

## Overview

cosmos gains a first-class, read-only **Slack integration**: the user connects their
Slack workspace to cosmos once by clicking a single **"Connect Slack"** button (a browser
OAuth flow — no tokens are ever pasted or typed), and can then view and search Slack content
two ways — through a native cosmos Slack panel with its own controls, and through MCP tools
the embedded Claude Code can call (which can also surface interactive UI via the existing
render_ui/A2UI panel). cosmos uses its OWN registered Slack OAuth client (a public client),
owns the OAuth flow, owns and securely stores the resulting token, and brokers every Slack
request through a single connection in the main process. Users do NOT register their own
Slack app or handle any token.

This is also the **first third-party integration**, so it deliberately establishes a
reusable "integration foundation" (OAuth authorization-code flow handling, OS-keychain
token storage, and the dual-surface pattern of exposing one integration as both native IPC
channels and MCP tools) that the planned Jira and Confluence cycles will reuse.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Connect a Slack workspace · P1

**As a** cosmos user
**I want to** connect my Slack workspace to cosmos through a guided sign-in
**So that** cosmos can read Slack on my behalf without me handling tokens manually

**Acceptance criteria:**

- Given the Slack panel shows a not-connected state, when I click the single **"Connect Slack"** button (no tokens to paste or type), then cosmos opens the Slack authorization page for cosmos's own OAuth client in my system browser and waits for me to approve.
- Given I approve in the browser, when Slack redirects back, then cosmos captures the authorization code, exchanges it (PKCE, no client secret) for a single user access token, stores the token securely at rest, and the panel switches to a connected state showing my workspace name.
- Given the request only declares read scopes, when I review the Slack consent screen, then the requested permissions are read-only (no posting/writing) and are requested as user scopes (desktop/loopback redirects cannot request bot scopes).

### Cancel or fail the connection gracefully · P1

**As a** cosmos user
**I want to** the app to stay calm if I abandon or fail sign-in
**So that** a cancelled or broken OAuth never leaves cosmos in a bad state

**Acceptance criteria:**

- Given the authorization page is open, when I close it or click "Cancel"/"Deny", then cosmos returns to the not-connected state with a clear, non-alarming message and no token is stored.
- Given the redirect returns an error or an unexpected/mismatched state value, when cosmos handles it, then the attempt is rejected, no token is stored, and the panel explains it could not connect.

### List channels in the native panel · P1

**As a** cosmos user
**I want to** see the list of channels I can read in the Slack panel
**So that** I can browse my workspace from inside cosmos

**Acceptance criteria:**

- Given Slack is connected, when I open the Slack panel, then it lists the public channels available to my token (name, and whether I am a member), without me typing anything.
- Given the workspace has more channels than one page, when I reach the end of the list, then I can load the next page (pagination), or the panel makes clear more exist.

### Read recent messages and a thread · P1

**As a** cosmos user
**I want to** open a channel and read its recent messages, and expand a thread
**So that** I can catch up on a conversation without leaving cosmos

**Acceptance criteria:**

- Given a channel is selected, when I open it, then the panel shows its recent messages in order (author and text), resolving author IDs to display names where possible.
- Given a message has replies, when I open that thread, then the panel shows the thread's replies in order.

### Search messages from the native panel · P2

**As a** cosmos user
**I want to** search Slack messages by keyword from the panel
**So that** I can find a conversation without remembering which channel it was in

**Acceptance criteria:**

- Given Slack is connected with a token that permits search, when I enter a query, then the panel shows matching messages (text, author, channel, timestamp).
- Given my connection does not permit search (search scope not granted), when I try to search, then the panel explains search is unavailable rather than failing silently or crashing.

### Claude reads Slack via MCP tools · P1

**As a** cosmos user
**I want to** the embedded Claude to read Slack (list channels, read history, read a thread, search, resolve users) through tools
**So that** Claude can reason over my Slack content as part of a task

**Acceptance criteria:**

- Given Slack is connected, when Claude calls a Slack read tool (e.g. list channels, read channel history, read thread replies, search messages, look up a user), then cosmos services it through the same stored connection and returns the result as the tool result.
- Given Slack is NOT connected, when Claude calls any Slack tool, then the tool returns a clear "not connected — connect Slack in cosmos first" result instead of an error stack or a hang.
- Given a Slack tool result would benefit from interaction, when Claude chooses to, then it MAY render the result through the existing render_ui/A2UI panel (the Slack tools and render_ui compose; Slack tools do not introduce a second UI channel).

### Reflect an expired or revoked connection · P2

**As a** cosmos user
**I want to** cosmos to notice when my Slack token no longer works
**So that** I am prompted to reconnect instead of seeing cryptic failures

**Acceptance criteria:**

- Given the stored token is rejected by Slack (expired/revoked/invalid), when either the panel or an MCP tool makes a request, then cosmos surfaces a "reconnect needed" state (panel prompts re-connect; tool returns a "reconnect needed" result), and does not crash.

### Disconnect · P2

**As a** cosmos user
**I want to** disconnect Slack from cosmos
**So that** my token is removed when I no longer want cosmos reading Slack

**Acceptance criteria:**

- Given Slack is connected, when I choose "Disconnect", then the stored token is deleted from cosmos, the panel returns to not-connected, and subsequent panel/tool reads report not-connected until I reconnect.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### Connection, OAuth & token storage (the reusable integration foundation)

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-001 | cosmos MUST own the Slack OAuth **authorization-code flow with PKCE (S256), as a public client with NO client secret**, in the **main process**; the embedded Claude and the renderer MUST NOT perform the OAuth exchange themselves. The flow runs against cosmos's OWN registered Slack OAuth client whose `client_id` is read from the `COSMOS_SLACK_CLIENT_ID` environment variable (never hardcoded); the user does NOT register their own Slack app. cosmos MUST generate a PKCE `code_verifier`/`code_challenge` pair per attempt and send `code_challenge` + `code_challenge_method=S256` on authorize and the matching `code_verifier` (no secret) on token exchange. |
| FR-002 | cosmos MUST open the Slack authorization URL in the user's **system browser** (Electron `shell.openExternal`, not inside the cosmos renderer/webview) and request **read-only** scopes only. Because desktop/loopback redirects may request only USER scopes (never bot scopes), the read scopes MUST be sent as **`user_scope`** (with `scope` omitted/empty) — see Scopes section. |
| FR-003 | cosmos MUST capture the OAuth redirect via a **loopback `http://127.0.0.1:<port>/callback` redirect** that the main process listens on for the single authorization-code callback, then shut that listener down once the code is received or the attempt ends. The listener MUST try ports **7421 → 7422 → 7423** in order and use the exact bound port's `http://127.0.0.1:<port>/callback` as the `redirect_uri` (assembled, and the browser opened, only once a port binds). |
| FR-004 | cosmos MUST generate a cryptographically random **`state`** value per authorization attempt and reject any callback whose `state` does not match the pending attempt (CSRF / stray-callback protection). |
| FR-005 | cosmos MUST exchange the authorization code for the user access token server-side in the main process (POST form to `oauth.v2.access` with `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri`, and **NO `client_secret`**), reading the token from **`authed_user.access_token`** and the granted scopes from `authed_user.scope` (a user-scope-only grant returns no top-level `access_token`); team identity comes from top-level `team.id`/`team.name`. cosmos MUST persist the token **at rest encrypted via Electron `safeStorage`** (OS keychain-backed). The token MUST NOT be written to disk in plaintext. |
| FR-006 | The stored token MUST NEVER be exposed to the renderer or to the embedded Claude's sandbox in plaintext: the renderer and the MCP tools request Slack **operations**, and the main process attaches the token; neither receives the token value. The `slack:connect` IPC carries NO inbound token payload (no token is ever sent into cosmos). |
| FR-007 | cosmos MUST expose connection status (not-connected, connecting, connected with workspace identity, reconnect-needed) and the connect / disconnect / (re)connect operations to the renderer over a typed IPC channel set following the `src/shared/ipc.ts` pattern, surfaced through the `contextBridge` preload as a dedicated `window.cosmos.*` namespace (alongside, not merged into, `pty` and `ui`). |
| FR-008 | A **single Slack connection / Web API client in the main process MUST be the only place** Slack is called from; both the native panel (via IPC) and the MCP tools (via the bridge) MUST route through it so they share one connection. A **single user token drives EVERY read** — list channels, history, threads, user lookups, AND search; there is no separate per-capability token. |
| FR-009 | "Disconnect" MUST delete the stored token from cosmos and return the connection to not-connected; after disconnect, panel and tool reads MUST report not-connected until reconnection. |
| FR-010 | The OAuth flow's behavior, token-at-rest storage (safeStorage), and the dual-surface brokering pattern (one main-process client serving both a native IPC panel and MCP tools) MUST be implemented as a **reusable integration foundation**, generic enough that Jira and Confluence can adopt it without re-deriving the OAuth/storage mechanics. (This spec establishes it; ARCHITECTURE.md captures it during the Plan step — see Architecture Impact.) |

### Native Slack panel (renderer)

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-011 | The renderer MUST provide a native **Slack panel** (React) with its own controls, distinct from the Generated-UI (A2UI) panel, showing connection state and the read surfaces below. |
| FR-012 | When not connected, the panel MUST show a connect affordance and MUST NOT attempt Slack reads. |
| FR-013 | When connected, the panel MUST be able to: list public channels (with pagination), open a channel and read its recent messages in order, and open a message's thread to read its replies in order. |
| FR-014 | The panel MUST resolve author identifiers to human-readable display names where the granted scopes allow; if a name cannot be resolved, it MUST fall back to the raw identifier rather than failing the view. |
| FR-015 | The panel SHOULD provide message **search** by keyword when the connection permits search; when search is not permitted by the granted scopes, the panel MUST clearly indicate search is unavailable (no silent failure). |
| FR-016 | The panel MUST render loading, empty, and error states for each read surface so a slow or failed Slack call degrades gracefully (never a blank or crashed panel). |

### Slack MCP tools (embedded Claude surface)

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-017 | cosmos MUST expose a set of **read-only Slack MCP tools** to the embedded `claude` session covering: list channels, read channel message history, read thread replies, search messages, and look up user/display-name info. |
| FR-018 | The Slack MCP tools MUST be registered with the embedded session the same way `render_ui` is — via the main-managed `--mcp-config` (no project-approval gate) — and MUST reach the main process over the **same socket-bridge pattern** as render_ui (a sibling channel on the existing bridge, or an analogous bridge), with main owning request correlation and pending-call state. |
| FR-019 | Each Slack MCP tool MUST be **read-only**: it MUST NOT post, edit, delete, or otherwise mutate Slack state in v1. |
| FR-020 | When Slack is not connected (or reconnect is needed), every Slack MCP tool MUST return a clear, structured "not connected / reconnect needed — connect Slack in cosmos first" result, never a hang or an unhandled error. |
| FR-021 | Slack MCP tool results MUST NOT include the access token or any other secret; they return only Slack content/metadata the user could see in Slack. |
| FR-022 | The Slack MCP tools MUST be independent of the render_ui channel: they return data as tool results, and Claude MAY separately call `render_ui` to display that data interactively. cosmos MUST NOT introduce a second/competing UI-generation channel for Slack. |

### Cross-cutting (consistency with cosmos conventions)

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-023 | The main process MUST validate every inbound IPC payload from the renderer and every inbound bridge message from the MCP tools at the boundary with pure validators; an invalid/missing-field payload MUST log a warning and be safely ignored (no crash), consistent with milestone-1/2 convention. |
| FR-024 | The renderer MUST continue to run with `contextIsolation: true` and `nodeIntegration: false`; all new Slack capability reaches the renderer ONLY through the `contextBridge` preload. |
| FR-025 | All Slack channel/type names MUST be centralized in `src/shared/ipc.ts` (and bridge message types in `src/shared/bridge.ts` or a sibling) — never ad hoc string literals — following the existing single-source-of-truth contract. |
| FR-026 | Slack API failures (network error, HTTP error, rate-limit `429`) MUST be handled so the panel and the tools degrade gracefully: surface a recoverable error state / structured error result, and on rate-limit respect Slack's `Retry-After` rather than tight-looping; never crash the app. |

## OAuth Scopes (read-only)

cosmos requests **read-only** scopes only, and requests them all as **`user_scope`** (a single
user token) — desktop/loopback redirects cannot request bot scopes. v1 grants no write capability.

| Scope                | Purpose in v1                                                  |
|----------------------|---------------------------------------------------------------|
| `channels:read`      | List public channels and read channel metadata (FR-013).      |
| `channels:history`   | Read recent messages and thread replies in public channels (FR-013). |
| `users:read`         | Resolve author IDs to display names / basic user info (FR-014, FR-017). |
| `search:read`        | Keyword message search (FR-015, FR-017); if not granted, search degrades per FR-015. |

Notes / assumptions:
- All four scopes are requested as `user_scope` and granted on **one user token** (`xoxp-…`)
  that drives every read, including search (Slack's Search API is user-token-only, and so is
  the whole grant in this desktop flow). `canSearch` is true iff the granted scopes include
  `search:read`; otherwise search degrades gracefully (FR-015).
- v1 targets **public channels** for the read surface. Private channels, DMs (`im:*`), and
  group DMs (`mpim:*`) are out of scope for v1 (and would require additional history scopes).

### One-time Slack app prerequisites (operability)

The OAuth client behind `COSMOS_SLACK_CLIENT_ID` must be configured ONCE in its Slack app's
**OAuth & Permissions** settings, or token exchange fails with `bad_client_secret`:

1. **Enable PKCE** — this marks the app as a public client. It is an **irreversible, one-way
   operation** (a public client can request only user scopes and exchanges with no secret).
2. **Allowlist the three loopback redirect URLs**: `http://127.0.0.1:7421/callback`,
   `http://127.0.0.1:7422/callback`, `http://127.0.0.1:7423/callback` (the port-fallback set
   from FR-003).

cosmos must then run with `COSMOS_SLACK_CLIENT_ID=<id>` set; if it is unset, Connect fails fast
with a clear "not configured" message and the panel stays not-connected (no token is fabricated).

## Edge Cases & Constraints

- **Not yet authenticated** → panel shows connect affordance and performs no reads (FR-012); every MCP tool returns "not connected" (FR-020).
- **User cancels / denies OAuth, or closes the browser** → return to not-connected with a clear message; no token stored (Scenario "Cancel or fail").
- **OAuth `state` mismatch or error redirect** → reject the callback, store nothing, report failure (FR-004).
- **Loopback callback never arrives (user abandons)** → the temporary listener MUST time out and shut down; cosmos returns to not-connected rather than holding a port open indefinitely (FR-003).
- **Expired / revoked / invalid token** → surface "reconnect needed" in both surfaces; never crash (FR-026, Scenario "Reflect an expired or revoked connection").
- **Network failure / Slack HTTP error** → recoverable error state in the panel; structured error tool result for MCP; no crash (FR-026).
- **Slack rate limit (`429`)** → respect `Retry-After`; surface a "try again shortly" state rather than tight-looping or crashing (FR-026).
- **Search not permitted** (scope/token absent) → panel marks search unavailable; search tool returns a clear "search unavailable" result (FR-015, FR-020-style).
- **Invalid IPC / bridge payload** → warn + ignore at the main boundary; never resolve the wrong call, never crash (FR-023).
- **Explicitly out of scope (deferred to a later version):**
  - **All write actions** — posting messages, replying, reactions, edits, deletes, marking read, status changes. v1 is strictly read-only.
  - Private channels, DMs (`im:*`), group DMs (`mpim:*`), and the scopes they require.
  - Multiple simultaneous Slack workspaces / accounts (v1 = a single connected workspace).
  - Real-time updates (Socket Mode / Events API / RTM); v1 reads on demand only.
  - Files, huddles, calls, reminders, admin/enterprise-grid management surfaces.
  - Caching/persistence of Slack content beyond what a view needs in-session; offline access.
  - Token auto-refresh beyond what is required to detect "reconnect needed" (token-rotation handling MAY be added when a feature needs it).

## Success Criteria

| ID     | Criterion                                                                                              |
|--------|-------------------------------------------------------------------------------------------------------|
| SC-001 | From a not-connected state, a user can click a single "Connect Slack" button (no token paste), complete the browser PKCE OAuth flow (no client secret; client_id from `COSMOS_SLACK_CLIENT_ID`), and reach a connected state showing their workspace, with the single user token stored encrypted via safeStorage (never in plaintext on disk). |
| SC-002 | Cancelling, denying, timing out, or a `state`-mismatched OAuth attempt returns cosmos to not-connected with a clear message and stores no token. |
| SC-003 | A connected user can, in the native panel, list public channels (with pagination), open a channel to read recent messages in order, and open a thread to read its replies. |
| SC-004 | Author identifiers are resolved to display names where scopes allow, falling back to the raw identifier otherwise. |
| SC-005 | Message search works in the panel when permitted (driven by the same single user token as every other read); when `search:read` is absent from the granted scopes it is clearly marked unavailable rather than failing silently. |
| SC-006 | The embedded Claude can call the read-only Slack MCP tools (list channels, read history, read thread, search, look up user) and receive results through the same stored connection. |
| SC-007 | When Slack is not connected or the token is rejected, both the panel and every MCP tool report a clear "connect / reconnect needed" state — no crash, no hang, no stack trace. |
| SC-008 | The access token is never delivered to the renderer or the embedded Claude sandbox; the panel and tools request operations and main attaches the token. |
| SC-009 | Network errors, Slack HTTP errors, and `429` rate limits are handled gracefully (recoverable state / structured result, `Retry-After` respected); the app never crashes from a Slack failure. |
| SC-010 | "Disconnect" deletes the stored token; afterwards panel and tools report not-connected until reconnection. |
| SC-011 | No v1 path performs any Slack write/mutation, and no write scope is requested at OAuth time (only the four read-only user scopes are requested; read-only guarantee). |
| SC-012 | The OAuth + safeStorage token-at-rest + single-main-client-serving-both-surfaces mechanics are factored as a reusable foundation a subsequent integration (Jira/Confluence) can adopt without re-implementing OAuth/storage. |

## Architecture Impact (for the Plan step — do not edit ARCHITECTURE.md in Specify)

This feature adds a new building block the current ARCHITECTURE.md does not yet describe.
The Plan step MUST update `docs/ARCHITECTURE.md` to capture, at minimum:

- A new **Third-Party Integration Foundation** component in the main process: OAuth
  authorization-code flow (loopback redirect), `safeStorage`-backed token store, and a
  per-integration API client — described generically so Jira/Confluence reuse it (FR-010, SC-012).
- Slack as the first concrete integration exposing **two surfaces over one main-process
  connection**: a native renderer panel (new `window.cosmos.*` IPC channel set) and a set of
  read-only MCP tools (reached over the render_ui-style socket bridge). This generalizes the
  current "render_ui is the only MCP tool" shape into "a registry of MCP tools," which
  ARCHITECTURE §7 item 3-area and the render-ui out-of-scope note previously deferred.
- The security invariant that integration tokens live only in main, encrypted at rest, and
  never cross into the renderer or the embedded sandbox in plaintext (FR-006, SC-008).

---

## Open Questions

- [x] RESOLVED — Slack Web API endpoint shapes and cursor pagination (`conversations.list`,
  `conversations.history`, `conversations.replies`, `search.messages`, `users.info`) confirmed
  against Slack's docs; all reads run on a **single user token** (no bot/user split).
- [x] RESOLVED — credential model: cosmos ships its **own registered public Slack OAuth client**
  and runs a **desktop PKCE flow with NO client secret**. The `client_id` is supplied at runtime
  via the `COSMOS_SLACK_CLIENT_ID` env var (never hardcoded, never a secret); the user does not
  register their own Slack app. See the one-time Slack app prerequisites under Scopes.
