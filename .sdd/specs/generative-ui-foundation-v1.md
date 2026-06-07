# Spec: Generative UI Foundation — v1

**Status**: Draft
**Created**: 2026-06-06
**Supersedes**: —
**Related plan**: .sdd/plans/generative-ui-foundation-v1.md

---

## Overview

The foundation for natural-language generative UI in cosmos: the user types an utterance in
the Generated-UI panel; a headless `claude` CLI runner (a spawned `claude -p` child process)
in the Electron main process processes it, calls the existing `render_ui` MCP tool, and the
generated A2UI surface appears in that same panel. This is the first of a multi-spec feature
and establishes only the plumbing — a prompt input, a headless runner channel, and the IPC
contract — that later specs build on. It resolves ARCHITECTURE §7 Open Question #5 in favor of
**adding headless `claude -p` execution for background/non-interactive work** alongside (never
replacing) the interactive PTY TUI. The headless child reuses the same already-installed,
already-logged-in `claude` binary as the interactive TUI, so it inherits the `~/.claude` login
automatically — no separate API key or OAuth token is injected.

## User Scenarios

> Each scenario must be independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Compose UI from an utterance · P1

**As a** cosmos user
**I want to** type a natural-language utterance in the Generated-UI panel and submit it
**So that** Claude composes a UI surface for me without my touching the terminal

**Acceptance criteria:**

- Given the Generated-UI panel is open and idle, when I type an utterance into the prompt input and submit it, then a headless `claude` CLI run (a spawned `claude -p` child process) starts in the main process with that utterance.
- Given the headless run uses the `render_ui` tool, when the run produces a surface, then the A2UI surface is rendered in the Generated-UI panel via the existing UiBridge → `ui:render` path.
- Given a surface is rendered from my utterance, when I look at the Terminal panel, then the interactive `claude` TUI session is unaffected (the headless run is a separate channel and does not appear in or disturb the TUI).

### See run status while composing · P1

**As a** cosmos user
**I want to** see whether my utterance is being processed, finished, or failed
**So that** I know the app received my request and is working on it

**Acceptance criteria:**

- Given I submitted an utterance, when the run is in progress, then the prompt input reflects an in-progress/loading state (e.g. disabled with a visible status) so I can tell the run started.
- Given a run completes, when it ends, then the input returns to an idle state ready for the next utterance.
- Given a run fails (the headless runner errors or cannot start), when the failure is reported, then the panel shows an error state with a human-readable message and the input returns to a usable idle state (no hang, no crash).

### Empty / invalid utterance is handled · P2

**As a** cosmos user
**I want to** be prevented from submitting nothing
**So that** I do not start a meaningless run

**Acceptance criteria:**

- Given the prompt input is empty or whitespace-only, when I attempt to submit, then no run is started.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-001 | The Generated-UI panel (`GeneratedUiPanel`) MUST provide a prompt input where the user types a natural-language utterance and submits it. |
| FR-002 | On submit, the renderer MUST send the utterance string (and nothing else) to the main process over a dedicated IPC channel. |
| FR-003 | The prompt input MUST distinguish at least three states — idle/empty, submitting/in-progress, and error — and reflect the in-progress state while a run is active (e.g. disabled/loading) so the user can see status. |
| FR-004 | The renderer MUST NOT start a run for an empty or whitespace-only utterance. |
| FR-005 | The system MUST run a NEW headless `claude` CLI runner in the Electron main process that receives the utterance and processes it by spawning the already-installed `claude` binary as a non-interactive, non-PTY child process in headless print mode (`claude -p "<utterance>"`). The headless child MUST reuse the same `claude` binary as the interactive TUI and inherit its `~/.claude` login automatically (no separate `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is injected). |
| FR-006 | The headless runner MUST be structured as a main-process manager mirroring the existing PTY/bridge managers (a single owner of its lifecycle, constructed in `createWindow`, torn down on window close / app quit), so it is started, stopped, and wired consistently with `PtyManager`/`UiBridge`. |
| FR-007 | The headless runner MUST have the existing `render_ui` MCP tool available to its run so the agent renders UI into the Generated-UI panel through the EXISTING UiBridge → `ui:render` path (no second rendering path is introduced). It MUST achieve this by passing the SAME `render_ui` stdio MCP registration the interactive `claude` uses (the `renderUiServer.js` entry + `COSMOS_BRIDGE_SOCKET` pointing at the existing `UiBridge`) to the headless child via `--mcp-config`. |
| FR-008 | The headless runner MUST be a SEPARATE channel from the visible Terminal TUI (the interactive `claude` PTY); the two MUST NOT interfere — starting, running, or failing a headless run MUST NOT spawn, kill, restart, or write to the TUI PTY, and vice versa. |
| FR-009 | The system MUST define a dedicated typed IPC channel set in `src/shared/ipc.ts` for this feature — at minimum: renderer→main "submit utterance", and main→renderer run lifecycle/status (run started, run completed, run error) — exposed to the renderer ONLY through the `contextBridge` preload as a dedicated `window.cosmos.*` namespace, alongside (not merged into) the existing `pty`/`ui`/`slack`/`jira`/`confluence` surfaces. |
| FR-010 | The main process MUST validate every inbound IPC payload from the renderer (the submitted utterance) at the boundary with a pure validator in `src/shared/validate.ts`; an invalid or missing utterance MUST log a warning and be safely ignored (no crash, no run started), consistent with existing conventions. |
| FR-011 | The renderer MUST receive run lifecycle/status (started, completed, error) so it can drive the input's in-progress and error states (FR-003); status payloads MUST carry only what the panel needs to display state and MUST NOT carry tokens, secrets, or provider credentials. |
| FR-012 | The renderer MUST continue to run with `contextIsolation: true` and `nodeIntegration: false`; the headless runner runs entirely in main and the renderer sends only the utterance string and receives only status — never tokens, secrets, or raw agent transcript beyond what the panel needs for status (FR-011). |
| FR-013 | The headless runner MUST be structured so that ADDITIONAL read-only MCP tools (e.g. slack/jira/confluence) can be granted to it in a LATER spec without re-architecting the runner; this spec MUST NOT grant those tools now (only `render_ui` is in the headless `--mcp-config` and only `mcp__cosmos-render-ui__render_ui` is in `--allowedTools`, least-privilege). |
| FR-014 | A run failure or an inability to start the headless run (e.g. the `claude` binary cannot be found/spawned, the user is not logged in, or the run exits non-zero) MUST be surfaced to the renderer as an error status (FR-011) rather than hanging the input or crashing the app. |

## Edge Cases & Constraints

- Empty / whitespace-only utterance submitted → no run started (FR-004); the input stays idle.
- Invalid / malformed "submit utterance" IPC payload (missing or non-string utterance) → warn and ignore at the boundary; no run is started (FR-010).
- Headless run fails or cannot start → error status to the renderer; input returns to idle/usable; app does not crash (FR-014).
- The `claude` binary is not found / not resolvable on PATH (e.g. a GUI-launched Electron app that did not inherit the shell PATH) → the runner surfaces an error status and does NOT hang (FR-014). The runner reuses the interactive PTY path's binary-resolution/pre-check so it fails fast with a clear message rather than spawning a missing binary.
- The user is not logged in to `claude` (no valid `~/.claude` credentials) → the headless run exits non-zero with an auth error, which is surfaced to the renderer as the run's error status; the input returns to usable (FR-014).
- A headless run is in progress and the user submits again → covered by the in-progress input state (FR-003); whether a second concurrent run is allowed, queued, or blocked is an open question (see Open Questions), not assumed here.
- Renderer reload while a headless run is in progress → the run MUST NOT leak or wedge the runner manager; the manager is torn down/cleaned up consistently with the PTY/bridge teardown on reload (mirrors FR-006), and any surface it had pending is handled by the existing UiBridge reload behavior (already specified for `render_ui`).
- The headless runner and the interactive TUI PTY are independent channels reaching Claude; they MUST NOT share a stream or interfere (FR-008). Both run the same `claude` binary and both read the same `~/.claude` login directory, but each is a separate process with its own session/transcript — this read-mostly sharing is expected and no write-conflict is anticipated for this usage.
- **Security:** the headless runner runs in the main process; any provider `client_secret` or integration token stays in main only (env-only, never logged, never placed in any IPC payload, bridge frame, or MCP result) — the runner MUST NOT leak secrets into status payloads or surfaces (FR-011, FR-012). (Not directly exercised here since the runner only has `render_ui`, but the invariant is restated so later tool-granting specs inherit it.)
- **Explicitly out of scope** (deferred to later specs in this feature):
  - Slack/Jira/Confluence panel-specific dynamic composition (composing those native screens from utterances).
  - Utterance-based EDITING of an already-rendered surface (the conversational refine loop).
  - Persistence of composed surfaces across restarts.
  - Granting slack/jira/confluence (or any non-`render_ui`) MCP tools to the headless runner.
  - Multi-turn conversation history UI in the panel.

## Success Criteria

| ID     | Criterion                                                                                              |
|--------|-------------------------------------------------------------------------------------------------------|
| SC-001 | Typing an utterance in the Generated-UI panel and submitting it starts a headless `claude -p` child-process run in main with that utterance. |
| SC-002 | A headless run that calls `render_ui` renders the resulting A2UI surface in the Generated-UI panel via the existing UiBridge → `ui:render` path. |
| SC-003 | While a run is in progress the prompt input shows an in-progress/loading state, and it returns to idle on completion. |
| SC-004 | A failed or un-startable run surfaces an error state in the panel and leaves the input usable; the app does not crash. |
| SC-005 | Submitting an empty/whitespace utterance, or sending a malformed submit payload, starts no run (the latter is warned + ignored at the boundary). |
| SC-006 | The headless run does not spawn, kill, restart, or write to the interactive Terminal TUI PTY; the TUI session is unchanged across a headless run (channels independent). |
| SC-007 | The runner is wired as a main-process manager (constructed in `createWindow`, torn down on close/quit) consistent with `PtyManager`/`UiBridge`, with its IPC exposed as a dedicated `window.cosmos.*` namespace through the preload. |

---

## Resolved Decisions

- **Headless transport** → **spawn the already-installed `claude` binary in headless print
  mode** (`claude -p "<utterance>"` as a `child_process` child, no PTY), NOT the
  `@anthropic-ai/claude-agent-sdk`. The interactive `claude` is already logged in (`claude login`,
  creds in `~/.claude` / Keychain) and already registers `render_ui`; the headless child inherits
  that same login automatically (no API key / OAuth token to inject) and accepts the SAME
  `--mcp-config`. No new npm dependency is added. The run is driven with
  `--permission-mode dontAsk` + `--allowedTools "mcp__cosmos-render-ui__render_ui"` (so it never
  blocks on an interactive approval) and `--output-format json` (so completion/error are detectable
  from parsed stdout + exit code). This is the resolution of how the runner reaches `render_ui`
  (FR-007) and of the prior SDK-auth ambiguity.
- **Concurrency** → **single-run / blocked-while-running.** While a headless run is in progress the
  prompt input is disabled; there is NO queue and NO concurrency. A `submit` received while busy is
  ignored. This closes FR-003's edge case.

## Open Questions

- [ ] [NEEDS CLARIFICATION] Whether a run needs an explicit user-facing cancel affordance for an
  in-progress run. Not requested for this foundation; with the single-run / blocked-while-running
  policy the user cannot start a second run, so an in-run cancel is unnecessary for v1 and is
  deferred to a later spec.
