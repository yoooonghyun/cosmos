# cosmos — Architecture

## 1. Product Overview

cosmos is a desktop application that embeds **Claude Code** as its agent engine and
gives it a graphical surface. It does two things that a plain terminal cannot:

1. **Shows the real Claude Code TUI** inside the app window, pixel-for-pixel as it
   appears in a terminal.
2. **Lets Claude generate rich, interactive UI** (forms, cards, buttons) that is
   rendered with native web components alongside the TUI.

The goal is a Conductor-style "host app" where Claude Code is the brain and cosmos
is the body — a work/business tool built on top of the agent rather than inside a
terminal.

### Design principle

> The stock Claude Code binary cannot draw graphical UI; it only emits text/ANSI.
> So cosmos does not try to extend the TUI. Instead it **hosts** Claude Code and
> separates two channels: the human-facing TUI stream, and a structured UI-generation
> channel. These never share a stream.

---

## 2. Technology Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Shell | **Electron** | Entire toolchain (Claude Code, Agent SDK, MCP SDK, PTY) is Node-native — single language, single process model |
| Terminal embed | **node-pty + xterm.js** | The VS Code reference pattern for embedding a real terminal |
| UI generation protocol | **A2UI** (`a2ui.org`) | Open standard; agent emits declarative JSON UI, client renders with native components |
| A2UI renderer | **@a2ui-sdk/react** | TypeScript/React implementation of the A2UI protocol |
| Renderer framework | **react-dom** | Standard web UI for the A2UI panel and app chrome |
| Agent engine | **Claude Code CLI** (interactive) + optional **Claude Agent SDK** | Real TUI via CLI; SDK reserved for programmatic session control if needed |

**Pinned versions (milestone 1):** electron 42, electron-vite 5, vite **7** (not 8 —
electron-vite 5 peer-requires `vite ^5||^6||^7`), react 19, node-pty 1.1, @xterm/xterm 6,
@xterm/addon-fit 0.11, vitest 4, typescript 5.7. node-pty is a native addon and is rebuilt
for Electron's ABI via a `postinstall` `electron-rebuild` step.

**Window security:** every BrowserWindow uses `contextIsolation: true` and
`nodeIntegration: false`; `sandbox` is intentionally left `false` so the preload can use
`ipcRenderer` reliably, while the renderer still only sees the `pty` channels.

cosmos registers ONE custom privileged streaming protocol, **`cosmos-confluence-img://`**
(`registerSchemesAsPrivileged` before `app.ready`; `protocol.handle` after), so the renderer can
display auth-gated Confluence content/attachment images via an OPAQUE scheme while the access
token stays in main — the handler fetches the asset with the bearer token and streams it back, and
the renderer never sees the token, the token-bearing URL, or the raw bytes as a `data:` URL (§4.9).
The renderer CSP `img-src` is `'self' data: https: cosmos-confluence-img:`: auth-gated `/wiki/…`
assets load through the opaque proxy scheme, while PUBLIC external-CDN content images (no Confluence
auth, sanitized-body `<img src="https://…">` left untouched) load directly under `https:`. Images are
non-executable, so allowing `https:` here does not reopen the script-injection surface that
`script-src 'self'` and the DOMPurify gate close.

**Tradeoff accepted:** Electron's larger bundle (~100MB) and higher memory use are
acceptable for an internal tool where development speed and a single Node stack win.
If hard size/memory limits appear later, the core can migrate to Tauri.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Electron Renderer (Chromium)                                      │
│  ┌───────────────────────────┐  ┌──────────────────────────────┐  │
│  │ Terminal Panel             │  │ Generated-UI Panel            │  │
│  │  xterm.js                  │  │  react-dom + A2UI SDK         │  │
│  │  (real Claude Code TUI)    │  │  (renders A2UI surfaces)      │  │
│  └────────────▲──────────────┘  └───────────────▲──────────────┘  │
└───────────────┼─────────────────────────────────┼─────────────────┘
        ANSI / keystrokes (IPC)            A2UI JSON / user actions (IPC)
┌───────────────┼─────────────────────────────────┼─────────────────┐
│  Electron Main (Node.js)                         │                 │
│  ┌────────────▼──────────────┐  ┌────────────────▼──────────────┐  │
│  │ PTY Manager (node-pty)     │  │ UiBridge (Unix-socket server) │  │
│  │  spawns `claude` (TUI)     │  │  owns surface IPC + pending   │  │
│  │  in an isolated sandbox cwd│  │  calls for render_ui          │  │
│  └───────────────────────────┘  └───────────────▲──────────────┘  │
│                                  ┌───────────────┴──────────────┐  │
│                                  │ render entry scripts          │  │
│                                  │  render_ui + render_jira_ui   │  │
│                                  │  + render_slack/confluence_ui │  │
│                                  │  (stdio↔socket relay)         │  │
│                                  └───────────────────────────────┘  │
│         spawns / streams           registered via --mcp-config      │
└────────────────────────────────────────────────────────────────────┘
                                │
                       ┌────────▼─────────┐
                       │  Claude Code      │
                       │  (agent engine)   │
                       └───────────────────┘
```

The renderer presents its surfaces through a **left icon-rail single-surface switcher**
(`src/renderer/App.tsx`, a Radix vertical `Tabs`): the rail lists five surfaces — Terminal,
Generated UI, Slack, Jira, Confluence — and exactly **one fills the main area at a time**
(Terminal is the default). All five stay **mounted** when hidden (`forceMount` + a
`data-state`-driven hide) so switching only toggles visibility — never tearing down the
Terminal's live PTY session or a pending `render_ui` surface. (The §3 diagram shows the two
data *channels*, not the on-screen layout.) The selected rail item is clearly highlighted — a
`--secondary` filled pill behind a full-brightness icon plus a 3px full-height `--primary` left
bar — driven by React `surface` state, **not** `data-[state=active]` (each trigger is wrapped by
a `Tooltip` whose `data-state` clobbers the tab's; see DEVELOPMENT.md "Nested Radix triggers").

**Within each panel, VS Code-style tabs (§4.11).** Each rail panel hosts its OWN independent,
session-only ordered set of tabs (a side-by-side variable-width strip — click-to-switch,
per-tab close `X`, trailing `+` new-tab, horizontal overflow scroll). The rail switcher itself
is UNCHANGED and there is **no global cross-panel tab bar** — every tab strip lives inside its
panel. When a panel has zero tabs it shows its native base (Slack/Jira/Confluence native
browser) or idle placeholder (Generated UI); the Terminal panel always keeps ≥1 tab.

Two independent channels reach the same Claude Code process:

- **TUI channel** — node-pty owns Claude Code's stdin/stdout. ANSI flows to xterm.js;
  keystrokes flow back. This is the unmodified, interactive Claude Code experience.
- **UI-generation channel** — render-style MCP tools are registered with Claude Code.
  Because `claude` spawns stdio MCP servers as subprocesses, the server is not literally
  in-process: it is a thin **standalone stdio entry script** (`src/mcp/renderUiServer.ts`)
  that relays over a **Unix-domain socket** to a bridge in main (`UiBridge`,
  `src/main/uiBridge.ts`). Main owns surface↔renderer IPC, `requestId` minting, and
  pending-call state. When Claude wants to show UI, it calls the tool with an A2UI payload;
  main forwards it to the renderer and returns the user's interaction as the tool result.
  There are now **four render-style entry scripts**: the standard-catalog `render_ui`
  (`renderUiServer.ts`) and three custom-catalog-scoped siblings — `render_jira_ui`
  (`src/mcp/jiraRenderUiServer.ts`), `render_slack_ui` (`src/mcp/slackRenderUiServer.ts`),
  and `render_confluence_ui` (`src/mcp/confluenceRenderUiServer.ts`), §4.3; all relay to the
  same `UiBridge`, and each stamps its render frames with a **`target`**
  (`'generated-ui' | 'jira' | 'slack' | 'confluence'`) so the renderer routes the surface to
  the right panel (§4.4).

The embedded `claude` runs in an **isolated sandbox cwd** (`app.getPath('userData')/sandbox`)
so it never edits the host repo, and is launched with `--mcp-config` so MCP tools load without
the project-approval gate. The bridge socket path is threaded to each MCP entry script via an
env var (`COSMOS_BRIDGE_SOCKET` for both render entry scripts, which share the one `UiBridge`).

---

## 4. Components

### 4.1 PTY Manager (main process)
- Uses `node-pty` to spawn interactive `claude` processes with pseudo-terminals.
- **Multi-session, keyed by `paneId`.** `PtyManager` holds a `Map<paneId, IPty>` (not a single
  shared PTY) so the Terminal panel can host **one live `claude` session per terminal tab**
  (§4.11). The `paneId` is **minted by the renderer** per terminal tab. Every `pty:*` IPC payload
  carries that `paneId`, and the contract gains **`pty:start` (R→M, spawn a pane's session)** and
  **`pty:dispose` (R→M, kill on tab close)**; `pty:restart` is now per-pane, and `pty:data`/
  `pty:exit` are stamped with the originating `paneId` so the renderer routes them to the right
  terminal. The single-PTY **auto-start at window creation was removed** — each terminal tab issues
  its own `pty:start`. Each session remembers its own `cols`/`rows` so a per-pane restart reuses
  that pane's last size.
- Streams raw stdout (ANSI) to the renderer over IPC; relays renderer keystrokes and
  resize events back into the matching PTY (routed by `paneId`).
- Owns process lifecycle: spawn, restart, kill, exit handling — per pane, plus `killAll()` on
  teardown. Keeps the missing-binary pre-check per pane.

### 4.2 Terminal Panel (renderer)
- **One `xterm.js` `Terminal` per terminal tab (§4.11)**, each bound to its own `paneId`'s PTY
  stream (its own FitAddon; `pty:data`/`pty:exit` filtered by `paneId`; input/resize/restart/
  dispose scoped to it). Displays the genuine Claude Code TUI. `+` issues `pty:start` for a new
  pane; `X` issues `pty:dispose` to kill that pane's session.
- The panel **always keeps ≥1 terminal** — there is no zero-terminals empty state; closing the
  last terminal opens a fresh default one.
- Handles fit/resize, scrollback, and forwards input events to the main process.
- Is one of the five rail surfaces (§3), and the default. All terminal tabs are kept **mounted
  even when inactive or when another surface is selected** (only hidden), so neither switching
  terminal tabs nor switching the rail drops any live PTY session or scrollback.

### 4.3 Render MCP tools + UiBridge (main process)
- A `render_ui(spec)` MCP tool, where `spec` is an A2UI `surfaceUpdate` payload (validated
  at the boundary). The tool is implemented as a **standalone stdio entry script**
  (`src/mcp/renderUiServer.ts`) — not literally in-process — that relays over a Unix-domain
  socket to **`UiBridge`** (`src/main/uiBridge.ts`) in main.
- On invocation, `UiBridge` mints a `requestId`, pushes the payload to the renderer
  (Electron `ipcMain` → `ipcRenderer`) and **awaits** a user action; a pending call always
  resolves exactly once (submit, cancel, supersede, renderer reload, bridge disconnect).
- Returns the user's action (button pressed, form values) as the tool result, closing the
  loop so Claude can continue reasoning on the response.
- Registered to the embedded session via main-managed **`--mcp-config`** (not the project
  `.mcp.json` approval gate); the bridge socket path is passed through `COSMOS_BRIDGE_SOCKET`.
- **Target-routed render.** Every render frame carries a
  **`target: 'jira' | 'generated-ui' | 'slack' | 'confluence'`** on `UiRenderPayload`
  (`src/shared/ipc.ts`) so the renderer can host **multiple A2UI panels** and route each surface
  to the right one (§4.4). There are **three custom-catalog render-style entry scripts** — sibling
  to `renderUiServer.ts`, each with its own rollup `input`, each relaying to the SAME `UiBridge`
  but teaching the agent a panel-specific custom catalog and stamping a matching `target`:
  **`render_jira_ui`** (`jiraRenderUiServer.ts`, Jira catalog, §4.9), **`render_slack_ui`**
  (`slackRenderUiServer.ts`, Slack catalog, §4.8), and **`render_confluence_ui`**
  (`confluenceRenderUiServer.ts`, Confluence catalog, §4.9). `render_ui` defaults frames to
  `target: 'generated-ui'`. The headless `AgentRunner` (§4.10) grants each run only the render
  tool for its target.
- **Display-only renders settle immediately.** A `render_*_ui` call normally blocks awaiting a
  user action, which would hang the one-shot headless run for a surface that emits none. So
  `UiBridge` settles (`{ type: 'cancel' }`) any frame whose **`target !== 'generated-ui'`**
  right after `pushRender` — the surface stays rendered, but the run is freed to emit `completed`
  (stopping the composing panel's spinner). Only `target: 'generated-ui'` keeps blocking to await
  the user's action on its control. This is safe for `'jira'` because `jira.*` actions are
  dispatched deterministically by main (`JiraActionDispatcher`, §4.9), never returned to the
  agent's render call; and `'slack'`/`'confluence'` surfaces are read-only with no controls (§4.8).
- **Invariant — `onMessage` settles the CAPTURED call, never `this.active` (re-entrancy guard).**
  Registering a refreshable surface kicks its regions' first refresh, and `AdapterDispatcher.refresh`
  synchronously calls back into `uiBridge.cancelActive()` (its FR-013 supersede guard) BEFORE its
  first `await` — which settles + NULLS `this.active` *during* `onMessage`. So `onMessage` captures
  the freshly-minted call into a local and settles THAT local at the display-only branch; re-reading
  `this.active` there would pass `null` and null-deref `call.socket` (the
  `jira-refreshable-detail-nav-crash-and-empty-v1` crash). `settle` is also null-tolerant as
  belt-and-suspenders. Any future synchronous re-entrant settle path must preserve this.

### 4.4 A2UI panels (renderer) — target-routed multi-panel hosting
- A2UI payloads are rendered via `@a2ui-sdk/react`, with cosmos controlling the styling and
  component set so generated UI looks native to the app. Panels capture user interactions and
  send them back to main over IPC (`ui:action`).
- **Multiple A2UI panels** coexist over the SAME `ui:render` / `ui:action` channels. Each panel
  hosts its **own `A2UIProvider` with its own catalog** and **filters incoming `ui:render` by
  `target`** (§4.3), rendering only the frames addressed to it and ignoring the rest:
  - the **Generated-UI panel** — general-purpose, renders `target: 'generated-ui'` surfaces with
    the A2UI **standard catalog**;
  - the **Jira panel** (`src/renderer/JiraPanel.tsx`, §4.9) — renders `target: 'jira'` surfaces
    with the **Jira custom catalog** (`src/renderer/jiraCatalog/`); and
  - the **Slack panel** (`src/renderer/SlackPanel.tsx`, §4.8) and **Confluence panel**
    (`src/renderer/ConfluencePanel.tsx`, §4.9) — render `target: 'slack'` / `'confluence'`
    surfaces with their own read-only custom catalogs (`src/renderer/slackCatalog/`,
    `src/renderer/confluenceCatalog/`).

  Each catalog is registered via that provider's `catalog=` prop (catalogs are per-provider,
  not global).
- **Per-tab surface state (§4.11).** Each generative panel no longer holds a single
  replace-on-compose `surface`; instead every open tab owns its own surface state, and the panel
  mounts **only the ACTIVE tab's `<A2UIProvider>` + host subtree** (`ActiveTabSurface`, which
  processes the active tab's stored spec, carries a per-tab error boundary, and forwards SDK
  actions). Inactive tabs keep their last surface in state and are restored — not re-composed — on
  switch, so only one provider ever contends for the single `ui:render` channel.
- **Shared collapsible prompt composer (`src/renderer/PromptComposer.tsx`).** All four generative
  panels share ONE composer (per-panel copy only — `onSubmit`/`placeholder`/`ariaLabel`), not four
  inlined copies. It defaults COLLAPSED to a bottom-center cosmos-logo button (`CosmosMark`) and
  EXPANDS to a centered `max-w-2xl` card that floats as an overlay (zero-height in-flow slot +
  `absolute bottom-0`, transparent `pointer-events-none` surround) so a tall composer never pushes
  the tickets behind it. Open-only logo; collapses on submit / Esc / click-outside; draft preserved
  until a successful submit. Both states stay mounted and cross-fade via an `expanded` flag (so the
  open/close animation fires) with the hidden one `inert`. Pure decision logic lives in
  `promptComposerLogic.ts` (the `.ts`/`.test.ts` split). **Submit vs. dismiss are distinct exits**
  (composer-send-animation-v1): a successful submit sets a `launching` flag that animates the card
  GROWING to fill and fading out (`scale-[2.6]`, `transition-[opacity,scale,filter]`) — a "launch
  into the surface" — whereas Esc / click-outside is a gentle `scale-95` dismiss. During a generation
  the composer takes a `busy` prop (= the panel's surface-spinner gate) that hides BOTH states,
  including the logo button, so no compose affordance shows mid-run; the logo reappears only when the
  run's surface lands (or errors). The busy affordance is the **surface spinner** (`SurfaceSpinner` /
  `CosmosSpinner`), rendered in the active tab's content region and gated by `surfaceSpinnerVisible`
  (`inFlight && !surface && !error && !loadingDefault`) — the stop condition is the per-tab surface
  landing, not the agent `completed` status. The Send control uses the `cosmos` Button
  variant; the cosmos brand pink→purple identity is single-sourced as the `--brand-pink` /
  `--brand-purple` / `--brand-foreground` theme tokens (index.css), consumed by both the variant and
  `CosmosMark`'s gradient.
- An unknown/invalid component degrades to that tab's surface error boundary (a safe
  fallback), never a white-screen, and never affects sibling tabs.

### 4.5 Agent Engine
- Default: interactive `claude` CLI in the PTY (§4.1).
- Headless: a **second, non-interactive path** spawns the SAME already-logged-in `claude`
  binary in print mode (`claude -p`) as a `child_process` child (no PTY), owned by the
  **`AgentRunner`** (§4.10). This is how a typed utterance composes a surface. It is a
  separate channel from the TUI and the two never interfere. (This resolves the prior "Agent
  SDK vs headless" open question in favor of reusing the `claude` binary, not the Agent SDK —
  no new dependency, and the headless child inherits the `~/.claude` login automatically.)

### 4.6 Code Structure & Conventions

The four Electron process roles map to the source tree as below; the full file-by-file map is
in [`PROJECT-STRUCTURE.md`](./PROJECT-STRUCTURE.md), and the detailed development conventions and
gotchas are in [`DEVELOPMENT.md`](./DEVELOPMENT.md).

- **main** (`src/main/`) — owns the PTY (`ptyManager.ts`), the headless agent runner
  (`agentRunner.ts`, §4.10), the socket bridges (`uiBridge.ts`, and per-integration siblings
  like `slackBridge.ts`), the integration foundation (`integrations/`) + managers (e.g.
  `slackManager.ts`), the deterministic Jira action dispatcher + surface builder
  (`jiraActionDispatcher.ts`, `jiraSurfaceBuilder.ts`, §4.9), and all `ipcMain` wiring
  (`index.ts`). Validates every inbound IPC payload at the boundary.
- **mcp** (`src/mcp/`) — standalone stdio MCP entry scripts (the four render-style entries
  `renderUiServer.ts`, `jiraRenderUiServer.ts`, `slackRenderUiServer.ts`,
  `confluenceRenderUiServer.ts`, plus the integration tool servers `slackMcpServer.ts` and the
  Atlassian servers) that relay over Unix-domain sockets to the matching bridge in main.
- **preload** (`src/preload/`) — `contextBridge` exposes the per-channel surfaces as
  `window.cosmos.*` (`pty`, `ui`, `slack`); no Node globals reach the renderer.
- **renderer** (`src/renderer/`) — React app; `App.tsx` is the shell (left icon-rail
  single-surface switcher, §3), `TerminalPanel.tsx` hosts xterm.js + FitAddon, the Generated-UI
  panel renders `target: 'generated-ui'` A2UI (standard catalog), and `JiraPanel.tsx`,
  `SlackPanel.tsx`, `ConfluencePanel.tsx` are generative surfaces each rendering their own
  `target` A2UI with their own custom catalog (`jiraCatalog/`, `slackCatalog/`,
  `confluenceCatalog/`; §4.8/§4.9).
- **shared** (`src/shared/`) — `ipc.ts` is the single source of truth for channel names and
  payload types (consumed by all three processes); `bridge.ts` holds the NDJSON socket-frame
  contract; `validate.ts` holds pure, unit-tested validators.

Conventions:
- One typed IPC contract in `src/shared/ipc.ts`; never define channel strings ad hoc.
- IPC validators are pure functions with an injectable logger (testable without Electron).
- Invalid payloads warn and are ignored — never crash the process.

### 4.7 Third-Party Integration Foundation (main process)

A reusable substrate for connecting cosmos to external services (Slack first; Jira and
Confluence reuse it). It lives entirely in the **main process** and has three pieces:

- **PKCE OAuth flow handler** (`src/main/integrations/oauthPkce.ts`, generic) — runs a desktop
  OAuth authorization-code flow as a **public client using PKCE** (no client secret, no hosted
  backend/token-broker). It generates the `code_verifier`/`code_challenge` (S256) and a random
  `state` with `node:crypto`, builds the authorize URL (sending read scopes as **`user_scope`**
  with `scope` empty — desktop/loopback redirects can request only user scopes, not bot scopes),
  has the caller open the consent page in the **system browser** via an injected
  `shell.openExternal`, and captures the redirect on a **loopback URL**
  (`http://127.0.0.1:<port>/callback`, trying ports **7421 → 7422 → 7423** in order) served by a
  short-lived `http.Server` that closes once the code arrives or the attempt ends (with a timeout).
  The exact bound port's redirect URI is used, and the URL is assembled + browser opened only once
  a port binds (`onListening(port)`); a fixed allowlisted port set is required because providers
  match the redirect URI exactly. The `state` is verified on the callback (CSRF / stray-callback
  protection). The OAuth client's `client_id` is supplied at runtime (e.g. from an env var),
  never hardcoded; the per-integration orchestrator (e.g. `slackOAuth.ts`) maps the provider's
  token-response shape.
- **Token store** (`src/main/integrations/tokenStore.ts`) — persists the token set (access token,
  refresh token, expiry, granted scopes, account identity, and provider extras like a resolved
  cloudId) encrypted at rest via Electron **`safeStorage`** (OS keychain-backed) under `userData`.
  Plaintext is never written to disk, and the token **never crosses into the renderer or the
  embedded `claude` sandbox**. Slack's user token is long-lived with no refresh token; the
  **Atlassian integrations (§4.9) are the first to exercise the refresh-token rotation path** —
  the access token expires (~1h) and the refresh token rotates on every refresh, so the manager
  re-persists the rotated set after each refresh and only surfaces `reconnect_needed` when the
  refresh itself fails. Each integration gets its OWN encrypted blob (distinct file path) so
  connections are independent.

- **Post-grant provider steps** — some providers require resolving an identifier before any API
  call. Atlassian needs a **cloudId** (the site id), resolved once after the grant via
  `GET api.atlassian.com/oauth/token/accessible-resources` and persisted in the token set; reads
  then target `…/ex/jira/{cloudId}/…` and `…/ex/confluence/{cloudId}/wiki/…`. The foundation models
  this as an optional post-exchange resolution step the orchestrator runs (see `atlassianOAuth.ts`).

- **Confidential-client token exchange (sanctioned fallback)** — the OAuth handler is a PKCE public
  client by default (Slack), but a provider may be a **confidential client** that requires a
  `client_secret` at the token (and refresh) endpoint. Atlassian Cloud 3LO is such a client. cosmos
  attempts the secret-less exchange first, then — as an explicit, documented branch — includes a
  `client_secret` read from an **env var (gitignored `.env`), used in the main process only**, in
  the token POST body. The secret is **never logged, never placed in any IPC payload, bridge frame,
  or MCP result** — it stays strictly within main alongside the encrypted tokens, so this is a
  narrow, sanctioned deviation from the pure public-client model that does NOT weaken the
  token-never-leaves-main invariant.
- **Per-integration API client + manager** — a single API client is the *only* place the
  provider is called; a manager owns the connection state machine
  (`not_connected → connecting → connected → reconnect_needed`) and is the sole caller of
  that client.

**Security invariant:** integration tokens live only in main, encrypted at rest, and are
never exposed to the renderer or the sandbox in plaintext. Both surfaces below request
*operations*; main attaches the token.

**Dual-surface brokering:** one main-process connection serves **two surfaces**:
1. a **native renderer panel** over a typed IPC channel set (`src/shared/ipc.ts` +
   `validate.ts`, exposed as a dedicated `window.cosmos.*` namespace by the preload), and
2. a set of **MCP tools** for the embedded `claude`, reached over the same
   **stdio-entry-script + Unix-domain-socket bridge** pattern as render_ui.

**MCP tool registry generalization:** render_ui is no longer the only MCP tool. Each
integration adds its own entry script + bridge (a sibling to `UiBridge`, e.g. `SlackBridge`),
each registered via the main-managed `--mcp-config` with its own socket env var, and each
owning its own pending-call state. The NDJSON-over-socket framing in `src/shared/bridge.ts`
is shared. The registry now spans **four render-style entry scripts** sharing the one
`UiBridge` — `render_ui` (standard catalog) plus the three custom-catalog siblings
`render_jira_ui` / `render_slack_ui` / `render_confluence_ui` (§4.3) — plus the **three
integration bridges/servers** — `slack` + `jira` + `confluence` (§4.8/§4.9) — each a
self-contained sibling with no shared connection state. The **Jira bridge/server now
carries write ops too** (transition, comment, create, update — §4.9); Confluence and Slack
remain read-only.

### 4.8 Slack Integration (first concrete integration)

Read-only Slack built on §4.7. The user connects by clicking a single **"Connect Slack"**
button (no token is ever pasted or typed): cosmos runs a desktop PKCE OAuth flow against its
OWN registered public Slack client (`client_id` from the `COSMOS_SLACK_CLIENT_ID` env var) and
receives a **single user token** (`xoxp-…`, from `authed_user.access_token`) that drives EVERY
read — channels, history, threads, user lookups, AND search. The four read scopes are all
requested as `user_scope` (`channels:read`, `channels:history`, `users:read`, `search:read`);
`canSearch` is true iff the granted scopes include `search:read`. One Slack Web API client in
main serves both surfaces:

- **Slack panel** (`src/renderer/SlackPanel.tsx`) — list public channels (paginated), read
  channel history, read a thread's replies, search messages, resolve author display names; with
  not-connected / loading / empty / error / reconnect-needed states. Talks to main over the
  `window.cosmos.slack` IPC channel set. It is also a **generative, read-only A2UI surface**
  (`slack-confluence-generative-ui-v1`, mirroring the Jira panel minus writes): a bottom-docked
  `PromptComposer` threads `target: 'slack'` through the shared `AgentRunner` (§4.10), and a
  target-filtered `A2UIProvider` hosts the **Slack custom catalog** (`src/renderer/slackCatalog/`
  — ChannelList/MessageList/SearchResultList/UserChip/Notice over `src/shared/slack.ts` shapes).
  **The native browser is the base shown when zero tabs are open;** a composed `target: 'slack'`
  surface fills its originating tab (§4.11), and closing the last tab returns to the native base
  (generated state cleared on disconnect). The composer is gated on `connected`. The surface is
  **display-only** — no write scope, no write tool, no deterministic dispatcher (§4.3 settles its
  render immediately).
- **Read-only Slack MCP tools** (`src/mcp/slackMcpServer.ts` + `src/main/slackBridge.ts`) —
  `slack_list_channels`, `slack_read_history`, `slack_read_thread`, `slack_search_messages`,
  `slack_lookup_user`. They return data as tool results (and Claude MAY render that data via a
  render tool); they introduce no second UI channel. When not connected, they return a
  structured "connect Slack in cosmos first" result rather than hanging. A `target: 'slack'`
  headless run is granted ONLY the `render_slack_ui` tool plus these five reads (least
  privilege), and an anti-fabrication grounding prompt requires every rendered value to come
  verbatim from a real read result (else a single Notice) — §4.10.

v1 is strictly **read-only** (no posting/editing/reactions) and targets **public channels**;
writes, private channels/DMs, multiple workspaces, and real-time updates are deferred.

### 4.9 Atlassian Integrations — Jira + Confluence (second & third concrete integrations)

Two **fully separate** Atlassian integrations built on §4.7, parallel to Slack. **Jira is a
generative, write-capable surface; Confluence's generative panel stays read-only, but the
Confluence MCP server also exposes a single model-mediated write tool — `confluence_create_page`
(page creation) — usable from the interactive `claude` TUI.** Each has its own **"Connect
Jira"** / **"Connect Confluence"** button, its own connection state machine, its own encrypted
token blob, its own native panel, and its own MCP tools — connecting or disconnecting one never
affects the other. They MAY share the generic Atlassian OAuth/cloudId/refresh machinery but MUST
NOT share connection state.

**Shared Atlassian OAuth machinery** (`src/main/integrations/atlassianConfig.ts` +
`atlassianOAuth.ts`, thin orchestrators over `oauthPkce.ts`): cosmos runs an OAuth 2.0 (3LO)
authorization-code-with-PKCE flow against `auth.atlassian.com` for its OWN registered client
(`client_id` from `COSMOS_ATLASSIAN_CLIENT_ID`, shared by both products), sending
`audience=api.atlassian.com`, the space-delimited per-product scopes + `offline_access` (Jira
now includes the **`write:jira-work`** write scope alongside its reads; Confluence adds the single
**`write:confluence-content`** write scope for page creation — see scopes below), and the PKCE
challenge. **Atlassian Cloud 3LO is a confidential client**, so the token exchange and refresh
include `client_secret` (from `COSMOS_ATLASSIAN_CLIENT_SECRET`, main-process only, gitignored
`.env`, never logged/transmitted — see §4.7). After the grant, the orchestrator resolves the site
**cloudId** via `accessible-resources` (v1 uses the first site) and persists `{access, refresh,
expiry, scopes, cloudId, site/account identity}` per product, each in its own
`safeStorage`-encrypted blob (`integrations/jira.token.enc`, `integrations/confluence.token.enc`).
Atlassian access tokens expire (~1h) and refresh tokens rotate, so each manager refreshes
transparently on expiry/401 (retrying the read once) and only flips to `reconnect_needed` when the
refresh itself fails.

Per product, a single main-process API client + manager is the only place that product is called,
serving **both** surfaces:

- **Native panels** (`src/renderer/JiraPanel.tsx`, `src/renderer/ConfluencePanel.tsx`) — talk to
  main over `window.cosmos.jira` / `window.cosmos.confluence`. **The Jira panel is itself a
  generative A2UI surface** (no longer a static read-only browser): both first activation with no
  tab open AND each `+` tab open a fresh tab and request a recent-issues **default view** as that
  tab's base (one `jira:requestDefaultView` per tab; main reads recent issues → `JiraSurfaceBuilder`
  → push with `target: 'jira'`, landing as an unsolicited frame in that tab; a per-tab
  `loadingDefault` skeleton shows until it lands, and the request is deferred while a compose is
  awaiting a frame to protect the correlation slot, §4.11), and the panel carries a
  **prompt input** so a typed utterance composes the active tab's body via the headless
  `AgentRunner` (§4.10) and the `render_jira_ui` tool. Alongside the prompt input the panel
  also carries a **native deterministic JQL search box** (`jira-jql-search-v1`, paralleling
  Confluence's search box): its placeholder is the my-tickets JQL `assignee = currentUser() ORDER
  BY updated DESC` (the `JIRA_DEFAULT_VIEW_JQL`), an empty submit returns that default view, and a
  non-empty submit runs a native `jira:searchIssues` read (NOT an `AgentRunner` run) → the same
  `JiraSurfaceBuilder` `IssueList` compose → an unsolicited `target:'jira'` frame that replaces the
  ACTIVE tab's surface (filing + the fire-or-defer correlation-slot protection are the §4.11
  unsolicited-frame discipline, reused in place). Main generalizes `handleJiraDefaultView` to a
  shared `handleJiraView(jql)`; the search trigger is the sibling channel `jira:requestSearchView`
  (`{ jql }`). **Clicking a ticket opens its detail in place** (`jira-ticket-detail-v1`): a clickable
  `TicketCard` emits a renderer-local nav action that the panel intercepts via the same
  `ActiveTabSurface` `onAction` seam Slack uses for open-channel navigation (handled in the renderer,
  never forwarded to main / the agent), firing the sibling channel `jira:requestIssueDetail`
  (`{ issueKey }`) → main `getIssue` → `JiraSurfaceBuilder.buildIssueDetailSurface` → an unsolicited
  `target:'jira'` frame that replaces the ACTIVE tab's surface (the §4.11 unsolicited-frame +
  fire-or-defer discipline, reused in place). A **native back row** (panel chrome outside the A2UI
  host, the Confluence `ChevronLeft` precedent) returns to the originating list. Because the
  unsolicited detail frame OVERWRITES the active tab's surface (and flips `composed`→`false`), a
  detail opened on top of a **pinned generated-UI (`composed`) surface** cannot be re-read — so the
  origin is tracked by the pure `backNavTarget` helper (`src/renderer/jiraBackNav.ts`) over a
  `JiraBackOrigin` union: a `composed` origin snapshots the surface AT detail-open time and back
  **restores the snapshot verbatim** (`update(tab,{surface,composed:true})`, no read, no skeleton),
  while `default`/`search` origins re-run their read (`jira:requestDefaultView` /
  `jira:requestSearchView`; default view as the fallback). Lesson: an unsolicited target-routed frame
  clobbers a pinned `composed` surface, so any pinned generated UI must be snapshotted at
  overlay-open time, never recovered afterward. It is read-only — no new OAuth scope, no token on the payload/surface. It renders
  with the **Jira custom catalog** (`src/renderer/jiraCatalog/` — a real A2UI `Catalog` of cosmos React components:
  TicketCard, StatusBadge, TransitionPicker, IssueList, CommentList, AddCommentControl, plus
  v1 create/edit forms). Because catalog components are plain cosmos React, they use any Tailwind
  class including the `--status-todo/-progress/-done` tokens, giving the generated surface the same
  color/design fidelity as a hand-built panel. **The Confluence panel is likewise a generative,
  read-only A2UI surface** (`slack-confluence-generative-ui-v1`, parallel to Slack): a
  `PromptComposer` threading `target: 'confluence'` through the shared `AgentRunner` (§4.10) and a
  target-filtered `A2UIProvider` hosting the **Confluence custom catalog**
  (`src/renderer/confluenceCatalog/` — SearchResultList/PageDetail/Notice over
  `src/shared/confluence.ts` shapes), with its native search content (title/space/excerpt,
  paginated) + open-one-page (title/space/body) browser as the base shown when zero tabs are open
  (composed surfaces fill per-tab, §4.11). When the native search box is empty the base shows a
  **default personal feed** instead of a blank panel — a deterministic native read (`defaultFeed`,
  NOT an `AgentRunner` run) over the fixed CQL `(mention = currentUser() or watcher = currentUser()
  or favourite = currentUser()) and type = page order by lastmodified desc`, the closest 3LO-reachable
  approximation of the user's notification/bell feed (Confluence Cloud exposes NO OAuth-3LO
  notifications API or scope). It reuses the same `ContentList` component, `ConfluenceResult<…>` shape,
  and opaque-cursor pagination as search; typing a query swaps it for the search read. **Clicking a
  document row in a generated-UI list opens that page's detail in place** (`confluence-page-detail-nav-v1`).
  This deliberately REUSES the existing native `PageDetail` browser component rather than composing a
  main-side generative detail surface (the user rejected the Jira-style surface-push design as
  overengineered): an id-bearing `SearchResultRow` becomes a clickable `<button>` (dispatch in the
  container `SearchResultList`, carrying `{ pageId, title }`) emitting a renderer-local nav action
  (`CONFLUENCE_OPEN_DETAIL_ACTION = 'confluenceNav.openDetail'`, non-`confluence.*`) the panel intercepts
  via the `ActiveTabSurface` `onAction` seam — returns `true`, never forwarded to main / the agent; a
  no-id row stays inert (no cursor/hover/wrapping button). The intercept (`handleSurfaceAction`) sets
  renderer-local overlay state `genUiPage = { pageId, title }`, which makes the panel render a native
  `ChevronLeft` **back row** plus the EXISTING native `PageDetail` component keyed on `pageId`.
  `PageDetail` reads `window.cosmos.confluence.getPage({ pageId })` DIRECTLY in the renderer (the same
  read the native base browser uses) — its existing loading / empty-body / error / reconnect states apply
  unchanged, so there is **no new IPC channel, no main handler, no surface builder, and no fire-or-defer
  correlation**. The back row clears `genUiPage`, returning the tab to the generated list it overlaid
  (the list is the live A2UI host underneath, restored verbatim with no re-fetch); a `useEffect` keyed on
  `activeTabId` resets `genUiPage` on tab switch so an open detail never bleeds across tabs. Read-only —
  no new OAuth scope, no token on payload/surface. **The Confluence generative panel stays read-only** (no write
  control/dispatcher, and the page-create
  tool is intentionally NOT in the panel's `--allowedTools` grant — `CONFLUENCE_TOOL_GRANTS`); the
  `confluence_create_page` write lives only on the MCP server for the interactive TUI. Both panels
  render the not-connected / loading / idle-empty / error / reconnect-needed states and reuse the
  shared Tailwind + shadcn/ui design system and the Slack panel's chrome.
- **MCP tools** — read: `jira_search_issues`, `jira_get_issue` and `confluence_search_content`,
  `confluence_get_page`; **Jira write** (all in the SAME `cosmos-jira` server —
  `src/mcp/jiraMcpServer.ts` + `src/main/jiraBridge.ts`): `jira_transition_issue`,
  `jira_add_comment`, `jira_create_issue`, `jira_update_issue`, each clearly described as
  MUTATING Jira and relaying through `JiraBridge` → the SAME `JiraManager` write methods used by
  the deterministic dispatcher (one write implementation, two callers). Confluence
  (`src/mcp/confluenceMcpServer.ts` + `src/main/confluenceBridge.ts`) is two reads plus a single
  **`confluence_create_page`** write tool — a model-mediated mutation (the agent calls it directly;
  there is NO deterministic Confluence dispatcher) relaying through `ConfluenceBridge` →
  `ConfluenceManager.createPage` → `ConfluenceClient.createPage`. Each is a
  sibling bridge/entry-script with its own socket env var and pending-call state; they return data
  as tool results (Claude MAY render it via a render tool) and introduce no second UI channel; when
  a product is not connected or needs reconnect, they return a structured "connect/reconnect in
  cosmos first" result rather than hanging.

**Deterministic Jira action binding (writes without re-invoking Claude).** A surface action whose
`actionId` is in the reserved **`jira.*`** namespace is treated as a deterministically bound write,
intercepted in **main at the `ui:action` boundary** and handed to the **`JiraActionDispatcher`**
(`src/main/jiraActionDispatcher.ts`). The dispatcher validates the payload, executes the write via
`JiraManager` (the single `JiraClient`) **without spawning or re-invoking `claude`**, settles the
pending `render_ui`/`render_jira_ui` call as **`cancel`** (so the composing run does not block), then
re-reads the issue, re-composes the surface via `JiraSurfaceBuilder`, and **re-pushes `ui:render`
with a FRESH `requestId` and `target: 'jira'`** carrying a success/error/scope-gap notice — so the
surface reflects the outcome deterministically, never by a model round-trip. Four bound actions exist
(name → context, all centralized in `src/shared/jira.ts`): `jira.transition` `{ issueKey,
transitionId }`, `jira.comment` `{ issueKey, body }`, `jira.create` `{ projectKey, issueType,
summary, description }`, and `jira.update` `{ issueKey, fields }` (only changed fields; an empty edit
dispatches nothing). The same `JiraManager` write methods back both the dispatcher and the write MCP
tools. A write attempted with a token lacking `write:jira-work` short-circuits to a
`write_not_authorized` notice pointing the user at the native Connect/Reconnect affordance — no
silent scope escalation. **Create is deliberately minimal:** the four fixed fields only — **no
`createmeta`, no per-project required-field discovery, no dynamic field form**; a project that
requires extra fields just yields a recoverable error notice ("the project may require additional
fields").

**REST surfaces** (Bearer access token; Jira is read+write, Confluence is read plus a single create write):
Jira at `…/ex/jira/{cloudId}` reads via the **enhanced JQL search** `POST /rest/api/3/search/jql`
(forward-only `nextPageToken` cursor, since the legacy `startAt` `/rest/api/3/search` is deprecated)
and `GET /rest/api/3/issue/{key}?fields=…,comment`, and writes via `POST
/rest/api/3/issue/{key}/transitions`, `POST /rest/api/3/issue/{key}/comment`, **`POST
/rest/api/3/issue`** (create), and **`PUT /rest/api/3/issue/{key}`** (update) — descriptions wrapped
to ADF via `plainTextToAdf`; all failures mapped through the existing `mapJiraError` discipline
(429 → `rate_limited`, 401/403 → `reconnect_needed`, else → `network`). Confluence at
`…/ex/confluence/{cloudId}/wiki` is a v1+v2 **hybrid** — v2 `GET
/wiki/api/v2/pages/{id}?body-format=view` for page reads (server-rendered HTML carried RAW through
`ConfluencePageDetail.body` + sanitized with DOMPurify in the renderer before display —
confluence-detail-rich-render-v1; supersedes the earlier `body-format=storage` plain-text flattening).
**Embedded content/attachment images** in that body (relative, auth-gated `<img src>` like
`/wiki/download/attachments/…` — distinct from emoji, which are converted to glyphs offline) render
via the **`cosmos-confluence-img://` privileged protocol** (confluence-content-images-v1): the single
renderer sanitize gate, running AFTER DOMPurify, rewrites each Confluence-content `<img src>` to an
OPAQUE `cosmos-confluence-img://` reference encoding ONLY the asset's `/wiki/…` relative path; the
main handler re-resolves it against the gateway base `…/ex/confluence/{cloudId}` (rejecting any ref
that escapes the Confluence origin — SSRF-safe), fetches with the bearer token, and streams the bytes
back. The token, the token-bearing URL, and the raw bytes never reach the renderer; the existing
`data:`-URL strip stays in force (no base64 `data:` rewrite). External (non-Confluence) `<img>` are
left direct; a missing/expired/unscoped token degrades to a broken `<img>`, never a crash. And v1
`GET /wiki/rest/api/search?cql=…`
for content search — and the default personal feed (a fixed personal-CQL variant of the same v1
search endpoint, §default feed above) — (CQL is not exposed in v2), both paginating by opaque cursor
(`Link`/`_links.next`) — plus a single v2 write, **`POST /wiki/api/v2/pages`** (create), which first
resolves the user-supplied space KEY to the numeric `spaceId` the v2 create requires via `GET
/wiki/api/v2/spaces?keys={spaceKey}&limit=1`, then POSTs `{ spaceId, status: 'current', title, body:
{ representation: 'storage', value }, parentId? }` with the plain-text body wrapped to Confluence
storage XHTML via `plainTextToStorage` (the inverse of `storageToPlainText`: one `<p>…</p>` per line,
HTML-escaped). Scopes: Jira `read:jira-work` + `read:jira-user` + **`write:jira-work`**
(the least-privilege write scope; create + update reuse it, no new scope); Confluence **granular**
`read:page:confluence` + `read:space:confluence` + **`read:attachment:confluence`** (added by
confluence-content-images-v1 so the bearer can download embedded content/attachment images — a
scope change that forces a one-time disconnect+reconnect for already-connected users) +
**`write:page:confluence`** (the single create
write scope) plus the one **classic** scope `search:confluence` — kept because the v1 CQL
`/wiki/rest/api/search` endpoint has no granular search-scope equivalent and is the only classic
content scope still honored on a granular-migrated app (the deprecated `read:confluence-content.all`
family now 401s "scope does not match"); both plus `offline_access`. Deferred:
Confluence writes beyond create (edit/delete/labels), Jira writes beyond transition/comment/
create/update (assign-by-name, delete, bulk, attachments, worklogs), cross-product/unified search,
multi-site selection, and real-time updates.

### 4.10 Generative UI: utterance → surface (AgentRunner, main process)

The **`AgentRunner`** (`src/main/agentRunner.ts`) is a headless agent path that turns a typed
utterance into a generated A2UI surface, distinct from the interactive PTY TUI (§4.1). It is wired
as a main-process manager (constructed in `createWindow`, torn down on close/quit) alongside
`PtyManager`/`UiBridge`, with its IPC exposed to the renderer as a dedicated `window.cosmos.*`
namespace (submit-utterance renderer→main; run started/completed/error main→renderer, carrying only
status — never tokens or transcript).

- **`run(utterance, target)`** spawns the SAME already-logged-in `claude` binary in headless print
  mode (`claude -p`, a `child_process` child, no PTY — NOT the Agent SDK), inheriting the
  `~/.claude` login automatically (no API key / OAuth token injected). It reuses the interactive
  path's binary pre-check so a missing/un-resolvable `claude` fails fast with a clear error status
  rather than hanging.
- The run is granted **only the tools for its target** via `--mcp-config` + `--allowedTools`
  (least privilege; `renderMcpConfigJsonForTarget` / `allowedToolForTarget` in
  `src/main/mcpConfig.ts`): `render_ui` for `'generated-ui'`; for an integration target, that
  target's render tool **PLUS that integration's READ tools** — `render_jira_ui` + the
  `cosmos-jira` read/write tools for `'jira'`, `render_slack_ui` + the five `cosmos-slack` reads
  for `'slack'`, `render_confluence_ui` + the two `cosmos-confluence` reads for `'confluence'`
  (§4.3) — and nothing else (a `'slack'` run cannot reach Confluence/Jira/generic tools, and
  symmetrically). For any non-default target the run also appends an anti-fabrication grounding
  system prompt (`groundingPromptForTarget`) via `--append-system-prompt`: fetch REAL data with the
  read tools first, render every value verbatim from a tool result, never copy the render tool's
  example, and on not-connected/error render a single Notice. All render to the shared `UiBridge`,
  and each run's surface lands in the matching panel via `target` routing (§4.4). The run is driven
  with `--permission-mode dontAsk` and `--output-format json` so completion/error are detectable
  from parsed stdout + exit code.
- **Single-run guard (sequential).** While a run is in flight the prompt input is disabled and a
  `submit` is ignored — no queue, no concurrency. A Jira-panel utterance and a generic Generated-UI
  utterance therefore run sequentially, never simultaneously (accepted).
- **Channel independence.** The runner never spawns, kills, restarts, or writes to the interactive
  Terminal PTY, and vice versa; both run the same `claude` binary and read the same `~/.claude`
  login but are separate processes with separate sessions. A failed or un-startable run surfaces an
  error status and leaves the input usable — no hang, no crash.

### 4.11 Panel tabs: VS Code-style tabs within each rail panel (renderer)

Each rail panel (§3) hosts its own **independent, session-only ordered set of VS Code-style
tabs** — a side-by-side variable-width strip with click-to-switch, per-tab close (`X`), a
trailing `+` new-tab affordance, and horizontal overflow scroll. Tabs are renderer-only state
(not persisted across app restart); there is no global cross-panel tab bar.

- **Tab semantics.** `+` opens a new tab and makes it active. Closing the active tab activates an
  **adjacent** tab (right-else-left, the VS Code rule); closing a non-active tab leaves the active
  one unchanged. A generative panel shows its base screen whenever the active tab is
  **empty/uncomposed** — `showBase = !activeTab || (!activeTab.surface && !activeTab.error)` — not
  only when zero tabs are open, so a fresh `+` not-yet-composed tab lands on the same base as zero tabs;
  the per-tab A2UI host is gated on `activeTab && (activeTab.surface || activeTab.error)`. The base
  differs per panel: Slack/Confluence show their native browser, Generated UI shows its idle
  placeholder, and **Jira shows an agent-generated my-tickets default board view** (it has no static
  native browser — see §4.9). The Terminal panel always keeps ≥1 tab (§4.2). In a generative panel a
  submitted utterance **fills the ACTIVE tab** (auto-creating the first tab if none are open) — it
  does NOT auto-spawn a tab per utterance; `+` first yields a fresh tab for the next compose.
- **Tab rename (double-click / F2).** Any tab's label is renamable inline: double-clicking the
  label (or F2 on the focused tab) swaps it for an in-cell text input; Enter/blur commits, Escape
  cancels, an empty/whitespace commit reverts. The strip is presentational — it surfaces the
  committed value via an `onRename(tabId, label)` callback and the owning panel writes its own tab
  record. A committed rename sets a per-tab `renamed` flag, and the automatic relabel paths (a
  generative tab's utterance-derived label; a Terminal tab's static "Terminal N") **skip a renamed
  tab** so a user's custom name sticks for the session. Labels are session-only like the tabs.
- **Renderer modules** (all `src/renderer/`): `panelTabs.ts` (pure tab-collection logic —
  open/close with right-else-left adjacent activation, label helpers `labelFromUtterance` /
  `terminalLabel` / monotonic `nextTerminalIndex` where closed terminals are not renumbered);
  `usePanelTabs.ts` (generic controller hook over that logic, shared by Terminal and the four
  generative panels); `PanelTabStrip.tsx` (the reusable strip + its active/inactive/in-flight/
  error/overflow states); `useGenerativePanelTabs.ts` (shared originating-tab correlation +
  submit/in-flight/error bookkeeping for the four generative panels); `ActiveTabSurface.tsx`
  (shared per-tab A2UI host described in §4.4).
- **Originating-tab correlation — the load-bearing decision.** `UiRenderPayload` is **UNCHANGED**;
  no new render-routing field is added. Render frames still route panel→panel by `target` (§4.3/
  §4.4); the renderer adds the tab dimension purely client-side: on submit the panel records the
  **originating tab** and marks it in-flight, and the next matching `ui:render` for that `target`
  is filed into it (discarded if that tab was closed before the frame arrives; the panel stays
  usable). An **unsolicited** frame with no originating tab — Jira's default-view request and the
  deterministic `jira.*` write re-push (§4.9) — lands in the active tab, auto-creating one if none
  are open. An `agent:status` `error` surfaces in the originating tab. A landed surface is tagged
  with a per-tab **`composed`** flag — `true` for a solicited compose frame, `false` for an
  unsolicited deterministic push — so a panel can tell a generated-UI surface apart from a native
  data view: Jira hides its JQL search box on `composed` surfaces but keeps it for ticket browsing.
- **Unified seed-tab naming.** A not-yet-composed tab's label follows ONE convention across every
  rail panel via `panelTabLabel(panelName, index)` (`panelTabs.ts`): the **bare panel name** for the
  first tab, then `"<Panel> N"` for later tabs (`Terminal`, `Terminal 2`; `Jira`, `Jira 2`; etc.).
  `terminalLabel` delegates to it; the generative hook mints labels from a per-panel monotonic
  `everOpened` counter (no renumber on close, advanced only off render-phase so StrictMode cannot
  double-count — cf. terminal-tab-index-skip-v1). A compose then relabels the tab from its utterance
  (`labelFromUtterance`); a manual rename pins it (`renamed`).
- **Deferred default-view request — protecting the correlation slot.** A Jira default-view request
  (first activation or a `+` tab, §4.9) is a deterministic main read, NOT an `AgentRunner` run, so
  it does NOT consume the single-run guard — but its unsolicited frame and a solicited compose's
  frame both contend for the single `originatingTabIdRef` correlation slot. The shared hook
  `useGenerativePanelTabs` exposes a generic `newTabWithDefault(request)` that opens a fresh active
  tab with per-tab `loadingDefault: true` and **fires `request()` immediately only when correlation
  is idle** (`originatingTabIdRef == null`); if a compose is currently awaiting a frame the request
  is **deferred** (single-slot `deferredDefaultRequestRef`) and flushed on the next `agent:status`
  `completed`/`error`, when correlation is idle again. The two pure decisions (`defaultRequestDecision`,
  `shouldFlushDeferredDefault`) live in `panelTabs.ts`. The hook is Jira-agnostic — Jira injects
  `() => window.cosmos.jira.requestDefaultView()`. `loadingDefault` is per-tab (cleared when a
  surface or error lands), so a second loading tab keeps its skeleton even while another tab already
  has a surface.
- **Why this is valid: runs are sequential.** This renderer-only correlation is correct ONLY
  because headless `AgentRunner` runs are sequential — at most one run app-wide (the single-run
  guard, §4.10), so the single in-flight run produces at most one terminal surface per `target`.
  **If cosmos ever allows concurrent runs, this breaks** and a per-run id on `UiRenderPayload` +
  `AgentSubmitPayload` would be required to disambiguate which run's frame lands in which tab.
- **`cancelOnClose` nuance.** Only `'generated-ui'` `render_ui` calls block in main awaiting a user
  action (§4.3), so closing such a tab while its surface is unresolved sends `{ type: 'cancel' }`
  to settle that pending call (else the run hangs). The other three targets are settled immediately
  on push by `UiBridge` (§4.3), so closing one of their tabs needs no cancel. No main/MCP/bridge
  code changes for this — a stale `requestId` is already ignored in main.
- **Semantics preserved per tab.** The Jira read+write path (deterministic `jira.*` dispatch,
  §4.9) and the Slack/Confluence read-only generative semantics (§4.8/§4.9) are unchanged — now
  scoped to the originating/active tab rather than a panel-wide singleton.

---

## 5. Key Flow: Agent Generates UI

```
User types in xterm.js
   → PTY → Claude Code reasons
   → Claude calls render_ui(A2UI spec)        [UI-generation channel]
   → MCP server pushes spec to renderer via IPC
   → A2UI panel renders native components
   → User interacts (clicks "Confirm", fills form)
   → renderer sends action to MCP server via IPC
   → render_ui returns action as tool result
   → Claude continues with the user's response
```

The TUI keeps showing Claude's textual reasoning the whole time; the rich UI appears
in the side panel. The two stay in sync because both ultimately talk to the same
Claude Code process.

### 5a. Key Flow: Utterance → Surface (headless, no TUI)

```
User types an utterance in a panel's prompt input (Generated UI, Jira, Slack, or Confluence)
   → renderer → main (validated) → AgentRunner.run(utterance, target)   [§4.10]
   → headless `claude -p` spawned, granted ONLY the target's render + read tools (+ grounding)
   → Claude reads (e.g. jira_search_issues / slack_list_channels) and calls the target render tool
   → UiBridge pushes the surface with `target`; the matching panel renders it   [§4.4]
   → a non-'generated-ui' (display-only) render is settled on push so the run completes   [§4.3]
   → single-run guard frees the input on completion (or shows an error state)
```

This never touches the interactive Terminal PTY (separate channel, §4.10).

### 5b. Key Flow: Deterministic Jira Bound Action (no Claude round-trip)

```
User acts on a jira.* control (transition / comment / create / update)
   → renderer emits ui:action
   → main intercepts the reserved jira.* actionId at the ui:action boundary   [§4.9]
   → JiraActionDispatcher validates + executes the write via JiraManager
        (NO claude spawn / re-invocation), settles the pending render call as `cancel`
   → main re-reads the issue, re-composes via JiraSurfaceBuilder
   → re-pushes ui:render with a FRESH requestId + target: 'jira' (success/error notice)
   → the Jira panel reflects the outcome — deterministically, never via the model
```

A scope gap (token lacks `write:jira-work`) short-circuits to a `write_not_authorized`
notice pointing at the native Connect/Reconnect affordance; no write is attempted.

---

## 6. Why Not Alternatives

- **Extend the Claude Code TUI directly** — impossible; it is a fixed Ink/terminal app
  with no plugin surface for custom graphical components.
- **Parse A2UI out of the TUI text stream** — fragile; the interactive TUI emits ANSI
  for humans, not clean JSON. A dedicated MCP channel avoids back-parsing.
- **Headless-only (no real TUI)** — loses the "show the actual Claude Code screen"
  requirement. Kept available via the Agent SDK for features that need it.
- **Ink in the webview** — Ink renders to a TTY, not the DOM. The only way to show
  Ink/TUI output in a webview is xterm.js + PTY, which is exactly what cosmos does.
- **Wire a third-party/vendor Slack MCP server** — rejected. cosmos owns the OAuth flow and
  token so it can serve one connection to both surfaces (native panel + MCP tools) and keep
  the token in main, encrypted. A vendor server would split ownership and leak the auth model.
- **Hosted OAuth backend / shipped client secret** — rejected. cosmos is a public desktop
  client and cannot keep a secret; Slack's PKCE flow is purpose-built for this, so no secret
  and no backend are shipped (§4.7).

---

## 7. Open Questions / Next Steps

1. ~~**PoC milestone 1** — node-pty spawns `claude`, xterm.js shows the live TUI.~~ Built
   (`src/main`, `src/preload`, `src/renderer`, `src/shared`); build green, tests pass.
   Live-GUI visuals (SC-001..SC-003) still need manual verification via `npm run dev`.
2. ~~**PoC milestone 2** — `render_ui` MCP server pushes an A2UI surface to the panel and
   returns a user action as the tool result.~~ Built (standalone stdio entry script +
   `UiBridge` Unix-socket relay; embedded `claude` in an isolated sandbox cwd via
   `--mcp-config`, socket path via `COSMOS_BRIDGE_SOCKET`).
3. ~~Decide the interaction contract for A2UI actions (naming, schema) shared between the
   MCP server and the renderer.~~ Resolved (`ui:render`/`ui:action`, `A2uiAction` in
   `src/shared/ipc.ts`).
4. **Read-only Slack integration** (`.sdd/specs/slack-integration-v1.md`,
   `.sdd/plans/slack-integration-v1.md`) — first concrete integration; establishes the
   reusable Third-Party Integration Foundation (§4.7).
4a. **Read-only Atlassian integrations — Jira + Confluence** (`.sdd/specs/atlassian-integration-v1.md`,
   `.sdd/plans/atlassian-integration-v1.md`, §4.9) — second & third concrete integrations; first to
   exercise the foundation's refresh-token rotation + cloudId resolution and the sanctioned
   confidential-client `client_secret` fallback (Atlassian Cloud 3LO).
4b. ~~**Generative UI foundation** (`.sdd/specs/generative-ui-foundation-v1.md`,
   `.sdd/plans/generative-ui-foundation-v1.md`, §4.10) — utterance → headless `AgentRunner`
   (`claude -p`) → `render_ui` surface; single-run guard.~~ Built; tests green.
4c. ~~**Jira generative UI** (`.sdd/specs/jira-generative-ui-v1.md` + `.sdd/specs/jira-generative-ui-v2.md`,
   their plans + the v2 design, §4.9) — deterministic `jira.*` action binding (`JiraActionDispatcher`),
   `write:jira-work` scope + transition/comment write tools (v1); the Jira rail panel turned into a
   target-routed generative custom-catalog surface with a per-switch default view and the
   `render_jira_ui` tool (v2).~~ Built; tests green.
4d. ~~**Jira write extend — create + update** (`.sdd/specs/jira-write-extend-v1.md`,
   `.sdd/plans/jira-write-extend-v1.md`, `.sdd/designs/jira-write-extend-v1.md`, §4.9) —
   `jira.create` + `jira.update` bound actions + `jira_create_issue`/`jira_update_issue` tools +
   create/edit catalog forms; minimal fixed create fields (no `createmeta`); no new scope.~~ Built;
   tests green.
4e. ~~**Slack + Confluence generative UI** (`.sdd/specs/slack-confluence-generative-ui-v1.md`,
   its plan + design, §4.3/§4.8/§4.9) — generalized the Jira generative path to Slack and Confluence:
   two new render targets (`'slack'`, `'confluence'`), scoped render servers (`render_slack_ui`,
   `render_confluence_ui`) + per-panel custom catalogs, per-target read-only tool grants + grounding,
   and the `UiBridge` settle-on-push generalized to all non-`'generated-ui'` display-only targets.
   Read-only — no writes/scopes/dispatcher.~~ Built; tests green.
4f. ~~**Panel tabs — VS Code-style tabs within each rail panel** (`.sdd/specs/panel-tabs-v1.md`,
   `.sdd/plans/panel-tabs-v1.md`, §3/§4.1/§4.2/§4.11) — each panel hosts an independent
   session-only tab set; multi-session `PtyManager` (one PTY per terminal tab, keyed by a
   renderer-minted `paneId`, with `pty:start`/`pty:dispose`); per-tab A2UI hosting with
   renderer-only originating-tab correlation (no `UiRenderPayload` change, valid only because runs
   stay sequential, §4.10).~~ Built; tests green.
4g. **API→UI generative adapter** (Jira `.sdd/specs/jira-generative-adapter-v1.md`, Slack
   `.sdd/specs/slack-generative-adapter-v1.md`, Confluence
   `.sdd/specs/confluence-generative-adapter-v1.md`) — three sibling cycles (Jira → Slack →
   Confluence, all built) introducing surfaces whose **view is composed once but whose data refreshes** against
   the live source, via A2UI 0.9's view/data split. Jira **establishes the shared infrastructure**
   the other two reuse: bound surfaces (`{path}` bindings + `TemplateBinding` instead of literal
   props, seeded by an initial `updateDataModel`); `ActiveTabSurface` learning to process
   `updateDataModel` (today it sends only `createSurface` + `updateComponents`); a persisted,
   **secret-free adapter descriptor** `{ dataSource, query }` (which manager call + non-secret
   JQL/cursor/issueKey) stored in the session snapshot beside the composed view spec; a reusable
   main-side **`AdapterDispatcher`** that on a refresh trigger (tab restore / panel re-activation /
   explicit refresh) or a reserved `adapter.*` pagination action re-executes the descriptor via the
   integration manager (tokens stay in main) and pushes an **`updateDataModel`** keyed by `surfaceId`
   — NOT a full surface re-push; and both pagination shapes (append/"load more" writes the full
   accumulated list at the bound path — no RFC6901 `-`; page-replace swaps the list + updates cursor
   state, with Prev/Next bound to a `LogicExpression` over `hasMore`/`hasPrev`, and a `loading` flag
   driving the button spinner). Jira's existing deterministic `jira.*` write dispatch
   (`JiraActionDispatcher`, §4.9) is **reconciled into** this generalized main-side dispatch path
   (one coherent `ui:action`-boundary interception), preserving its execute→re-read→reflect behavior
   and coexisting with the §4.11 unsolicited-frame discipline + `jiraBackNav` Back restore. Security
   unchanged: all fetching/tokens in main, descriptor + data model + every payload secret-free, one
   typed IPC contract validated at the boundary (invalid → warn + ignore). UI-bearing — the design
   step (§pagination/refresh/loading states) precedes interface. **Shared modules** (built):
   `src/main/adapterDispatcher.ts` (channel-independent dispatcher), `src/main/dataModelApply.ts`
   (node-testable `updateDataModel` apply), `src/renderer/catalogShared/controls.tsx`
   (`Bind`/`Bound`/`useBound` + `RefreshButton`/`LoadMoreButton`/`PaginationBar`), the descriptor
   type + `updateDataModel` IPC payload + reserved `adapter.*` action contract in `src/shared/ipc.ts`,
   and the descriptor field on the generative-tab snapshot. **Slack + Confluence** reuse this verbatim
   as read-only, **append-only** lists (opaque forward cursors — `next_cursor`/`_links.next`; no
   page-replace, `hasPrev` unused) via `slackAdapter.ts`/`slackSurfaceBuilder.ts` and
   `confluenceAdapter.ts`/`confluenceSurfaceBuilder.ts`, each joining one **composite resolver** in
   `index.ts` (`*BindOptionsForSource` selects the owning resolver). Confluence's page-detail surface
   is `pagination:'none'` (refresh-only single `value`); Slack resolves author names via `getUser`
   in main (only the non-secret display name crosses).

   **Refresh affordance (`panel-refresh-v1`, planned):** refresh is **one control per generative
   panel, in the panel chrome** (outside the A2UI host), acting on the **active tab's** registered
   surface — NOT a per-surface/per-section button. The in-surface catalog `RefreshButton` is removed
   from composed surfaces; only `LoadMoreButton` (append) and `PaginationBar` (page-replace) stay
   in-surface (a list's paging is tied to its own scroll position, semantically distinct from a
   panel-wide refresh). The panel control dispatches the same reserved `adapter.refresh` for the
   active `surfaceId` and is disabled/absent when the active tab has no registered (bound) surface.
   `panel-refresh-v1` also fixes the renderer's one-shot action guard so reserved `adapter.*` actions
   (refresh / loadMore / page) repeat while only the terminal `submit` stays one-shot.

   **Closing the live-registration seam:** Jira already has a live bound-compose path
   (`handleJiraView`/`handleJiraIssueDetail` → `register` → push `{spec,dataModel,descriptor}`).
   `panel-refresh-v1` adds the analogous **panel-driven native bound-compose** path for the
   Slack/Confluence native data views (mirroring Jira: a new fire-and-forget request channel → a
   `handle*View` that runs the existing manager read, builds the dormant `buildBound*Surface`,
   `register`s the descriptor via the composite resolver, and pushes the bound frame) — so their
   panel-driven data surfaces become bound + registered + refreshable like Jira's.

   **Refreshable CUSTOM agent-composed surfaces (`refreshable-custom-generative-ui-v1`, built).**
   The original OQ-5 rule was "main-composes": when the agent attached a descriptor to a `render_*_ui`
   frame, main DISCARDED the agent's spec and pushed a FIXED generic `{path}`-bound SHELL
   (`resolveDescriptorShell` → `jira-issue-list`/`slack-channels`/…), so a custom layout (e.g. a
   kanban board) could not be refreshed in place — refreshability and custom layout were mutually
   exclusive. The new rule is **register-the-agent-surface, don't replace**: when the agent attaches a
   valid, secret-free, target-matched descriptor AND a usable spec (non-empty `surfaceId` + a
   `components` array), main registers the descriptor with the `AdapterDispatcher` keyed by the
   **agent's OWN `spec.surfaceId`** (bind options — `listPath` + pagination — resolved from
   `dataSource` via the same `resolveBindOptionsForSource`/per-integration resolvers the shells use),
   kicks the first `adapter.refresh`, and pushes the **agent's spec AS-IS**. A later refresh emits
   `updateDataModel { surfaceId: <agent's id>, path, value }` and repaints the custom layout in place
   — no full re-push, no agent round-trip. The agent composes `{path}` bindings against a
   **documented per-`dataSource` data-model path contract**, single-sourced from the `*_PATH`
   constants and taught by each render-tool description: Jira `searchIssues`→list `/items`,
   `getIssue`→value `/issue`; Slack `listChannels`→`/channels`, `getHistory`→`/messages`,
   `search`→`/matches`; Confluence `defaultFeed`→`/feed`, `searchContent`→`/results`, `getPage`→`/page`;
   shared reserved flags `/loading`, `/hasMore`, `/error` — so the path the agent binds and the path
   the dispatcher writes cannot drift. The generic `resolveDescriptorShell` SHELL remains the
   **fallback only** when the agent supplied a descriptor but no usable spec; an unknown `dataSource`
   (no resolver claims it) is warned + ignored and the agent's spec renders un-refreshably. cosmos
   trusts the documented `{path}` contract rather than statically detecting bound-vs-literal specs.
   Security unchanged: the descriptor is secret-free (validated + secret-stripped at the `UiBridge`
   boundary); the token is attached only in main at refresh. A `composed:true` custom bound surface
   persists its verbatim spec + descriptor and re-registers lazily under the agent's surfaceId on its
   restore refresh; `SESSION_SCHEMA_VERSION` bumped 3 → 4 (the new rule changes the meaning of a
   persisted descriptor-bearing surface, so v3 snapshots fall back to a clean session).
   The refresh → data-model → repaint chain is regression-guarded by an end-to-end integration test
   (`src/main/refreshRepaintIntegration.test.ts`, `refresh-repaint-integration-test-v1`) that drives
   the REAL `planAgentSurfaceRegistration` + `AdapterDispatcher` (over the real `jiraAdapterResolver`
   fed a fake `JiraAdapterManager`) + the renderer-pure `applyDataModel` + the SDK's own
   `setValueByPath`/`resolveValue`, proving a custom `{path}`-bound `IssueList` resolves the freshly
   re-pulled rows in place (and re-resolves to a changed set on a second refresh) — with a literal-prop
   negative control that does NOT move, confirming the `{path}` binding is what causes the redraw.

4h. **Refreshable custom generative UI** (`.sdd/specs/refreshable-custom-generative-ui-v1.md`,
   `.sdd/plans/refreshable-custom-generative-ui-v1.md`, OQ-4g panel-refresh-v1 sub-note) — supersedes
   the OQ-5 "main-composes" rule: main registers an agent-attached descriptor under the AGENT's own
   `spec.surfaceId` and pushes the agent's custom spec as-is (instead of substituting a generic bound
   shell), so a custom layout (e.g. a kanban board) refreshes in place via `updateDataModel`. The
   render-tool descriptions teach the documented per-`dataSource` `{path}` contract; the generic shell
   stays a fallback for an unusable spec; `SESSION_SCHEMA_VERSION` bumped 3 → 4.

   **Multi-region refreshable surfaces (`refreshable-custom-generative-ui` multi-region, built).**
   4h still required the agent to bind every refreshable container with its own `{path}` props. In
   practice the composing model emits containers with **literal props** (a kanban column as
   `issues:[…]` with no `{path}`) — so nothing was registered to refetch and the board went stale
   after refresh (a card moved `To Do → In Review` server-side stayed put). The fix is **generic
   across integrations** (Jira / Slack / Confluence + future), not Jira-specific, and adopts
   **Option 1 — the agent NAMES the containers, main AUTHORS the bindings**:
   - **`AdapterBinding` side-channel (`src/shared/adapter.ts`).** A render frame carries either a
     single `descriptor` (one-region surface) OR a `bindings: AdapterBinding[]` array (partitioned
     surface) — never both. Each `AdapterBinding {componentId, descriptor}` names which container
     gets which secret-free `{dataSource, query}` descriptor (its own narrowed query — e.g. a column
     whose JQL is `status="In Review"` — plus its own pagination/cursor). The `componentId` doubles
     as the dispatcher **regionKey**, so column identity comes from each column's QUERY, not inferred
     from rows — **empty columns still refresh correctly**. The 4 MCP render servers
     (`src/mcp/{jira,slack,confluence,}RenderUiServer.ts`) teach this `bindings` vs `descriptor`
     choice to the agent.
   - **Region → data-model path mapping (`regionListPath`/`regionFlagPath`, `ADAPTER_REGION_ROOT =
     '/regions'`).** An EMPTY regionKey maps to the flat top-level paths (`/items`, `/loading`) —
     full back-compat for single-region 4h surfaces; a non-empty key namespaces under
     `/regions/<escaped-componentId>/…` (RFC 6901-escaped). Both the dispatcher's push and main's
     `{path}` rebind call these helpers, so the bound path and the written path cannot drift.
   - **Main-side rebind (`src/main/specRebinder.ts`).** `planRegions(bindings)` derives the regions
     used by BOTH compose and restore (regionKey = `componentId` when >1 binding, else `''`).
     `rebindAgentSurface(spec, bindings)` rewrites each literal container's rows prop into a
     region-scoped `{path}`, stamps a `region` prop on multi-region containers (so an in-surface
     control reloads only its own column), **SEEDS the agent's literal rows as that region's first
     page** for instant paint, and returns `{spec, dataModel, regions}` — or `null` (caller falls
     back to the single-region shell).
   - **The extensibility seam (`src/main/adapterBindingRegistry.ts`).** The ONE per-integration fact
     main needs to rebind is `LIST_SOURCE_DATA_PROP` / `listSourceBinding(dataSource)` — which prop a
     container reads its rows from (Jira `issues`, Slack `channels`/`messages`/`matches`, Confluence
     `results`), keyed by `dataSource` (not component type, which Slack/Confluence share). A new
     rebindable list source = **one entry here plus its existing `*BindOptionsForSource`** — no
     rebinder change. Detail sources (`getIssue`/`getPage`) are intentionally absent (single-value,
     never partitioned).
   - **Per-region fetcher + surface-level fan-out (`src/main/adapterDispatcher.ts`).** The dispatcher
     is now multi-region: each surface is a `Map<regionKey, RegionState>`, every region holding its
     own descriptor / cursor / accumulation. `register/refresh/loadMore/page` take a `regionKey`
     (default `''`); `refreshSurface(surfaceId)` does a `Promise.all` fan-out over `regionsOf` so a
     surface-level refresh reloads every column from its own fetcher concurrently (one column's
     failure degrades only that column). `has`/`regionsOf`/`unregister(surfaceId, regionKey?)`
     complete the API.
   - **IPC + restore (`src/main/index.ts` `adapter.*` handler).** The `AdapterActionRequest.refresh`
     variant carries an optional `region` (absent ⇒ fan out to all regions) and optional `bindings`
     (lazy multi-region re-registration on tab restore: `bindings && !has(surfaceId)` →
     `planRegions` register loop). `region ? refresh(region) : refreshSurface`. Renderer controls
     (`src/renderer/catalogShared/controls.tsx` + each catalog's list components) thread the `region`
     prop into the dispatched `adapter.loadMore`/`adapter.page` context.
   - **Invariant — a bound surface's rows live ONLY in live SDK state, so any overlay-then-restore
     must re-kick its refresh.** The seed for a `bindings` surface is pushed as a SEPARATE
     `updateDataModel` (NOT on the render payload's `dataModel`), and per-region refresh repaints live;
     the tab's `surface.dataModel` is therefore empty. When something overwrites the surface (a Jira
     ticket detail's unsolicited frame `clear()`s the SDK — §4.11) and is later restored from a spec
     snapshot, restoring the spec ALONE repaints an empty board. So a Back/restore that re-files a
     bound composed surface marks it `restored: true` (`jiraBackNav.backNavTarget`) — re-triggering
     `ActiveTabSurface`'s restore-refresh effect, which re-registers every region (idempotent) and
     re-fetches. This is the same `restored`-flag path the session-snapshot restore uses; it is the
     `jira-refreshable-detail-nav-crash-and-empty-v1` (Defect B) "empty board on Back" fix.
   `SESSION_SCHEMA_VERSION` bumped 4 → 5 (a partitioned surface persists its `bindings` + the rebound
   spec). Covered by `src/main/specRebinder.test.ts` (new) + multi-region cases in
   `src/main/adapterDispatcher.test.ts`.

   **Bindings-first teaching (`.sdd/specs/bindings-first-generative-ui-v1.md`, descriptions-only).**
   The rebind/seed MECHANISM above is UNCHANGED. Only the 4 render-tool DESCRIPTIONS were reframed:
   because `rebindAgentSurface` overwrites each bound container's data prop to a `{path}` and seeds
   the agent's literal rows regardless of shape, the agent is now taught **bindings-first** — compose
   the layout, pass the fetched rows as ordinary literal props (a first-paint SEED), and declare ONE
   `binding` per data-bearing container (single container → one binding; partitioned → one per
   container); `descriptor` is the degenerate single-binding form, bindings wins when both are
   present, the `query` stays secret-free. The earlier "author the `{path}` yourself / do NOT pass
   literal rows / literals can never repaint" instructions were removed (they were made wrong by the
   rebinder). A side-effect-free **dev warning** (`src/main/dataBearingWarning.ts`
   `specHasUnboundDataContainer`) fires once at the `UiBridge.onMessage` boundary when a frame carries
   neither `bindings` nor `descriptor` yet its spec paints data (a `LIST_SOURCE_DATA_PROP` rows prop /
   bound detail prop) — warn-and-continue, never blocks or alters the render; ambiguous shapes stay
   silent. Covered by `src/main/dataBearingWarning.test.ts` + a suite in `src/main/uiBridge.test.ts`.

   **Bindings-first is now ENFORCED, not just taught (v2).** The description reframe alone proved
   insufficient at runtime — the model fetched broadly, partitioned rows into UI containers
   client-side, and rendered LITERAL rows with NO binding (refresh disabled; a reload re-paints
   stale rows). Two reinforcements were added, NO new IPC/contract field: (a) **grounding steering**
   — every data-bearing target's `groundingPromptForTarget` (`src/main/mcpConfig.ts`) carries a
   uniform clause forcing a binding per data container whose `query` is that container's OWN narrowed
   fetch (a kanban column → its status JQL), never splitting a broad fetch without a per-container
   binding; and (b) **tool-level rejection** — each `render_*_ui` MCP handler runs the shared
   `BindingsFirstEnforcer` (`src/shared/dataBearingSpec.ts`, which now also OWNS the moved-to-shared
   `LIST_SOURCE_DATA_PROP` + the `specHasUnboundDataContainer` heuristic so the MCP rollup bundles can
   import it) BEFORE relaying: a data-bearing spec with neither `descriptor` nor `bindings` is
   rejected with an instructive, secret-free MCP `isError` so the model resubmits with a binding per
   container; static surfaces and already-bound calls render normally. The reject loop is BOUNDED by
   an in-memory per-process counter (`ENFORCEMENT_REJECT_CAP = 2`, the render server lives one
   AgentRunner run) — after the cap it renders anyway (the warn-and-render fallback) so the surface
   still appears. Covered by `src/shared/dataBearingSpec.test.ts` + the steering assertion in
   `src/main/mcpConfig.test.ts`.
   **dataSource is the adapter source id, NOT the read-tool name (v3).** A runtime test showed the
   v2 steering worked (the model passed `bindings`) but set each `descriptor.dataSource` to the MCP
   READ-TOOL name (`jira_search_issues`) instead of the adapter source id (`searchIssues`), so main's
   `validateAdapterDescriptor` dropped all bindings as cross-target and the surface landed unbound.
   Fix, NO IPC change: each `render_*_ui` server tightens `DESCRIPTOR_SCHEMA.dataSource` from
   `z.string()` to a `.refine` against that target's `*AdapterSource` enum values (generic
   `render_ui` accepts the union, mirroring `TARGET_ADAPTER_SOURCES`) — a read-tool name is rejected
   AT the render tool (the model resubmits) rather than silently passing the MCP boundary; and the
   four tool descriptions plus `BINDINGS_FIRST_STEERING` now state the valid per-integration
   `dataSource` ids and that it is the adapter source id, NOT the read-tool name.
5. ~~Decide whether session control stays purely interactive (PTY) or adds Agent SDK for
   background work.~~ Resolved (§4.5, §4.10): a headless `claude -p` `AgentRunner` runs alongside
   the interactive PTY — the `claude` binary is reused, NOT the Agent SDK.
6. codegraph index (`codegraph init`) once the codebase has real source to index.
