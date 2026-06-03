# Spec: render_ui MCP Server & Generated-UI Panel — v1

**Status**: Review
**Created**: 2026-06-03
**Supersedes**: —
**Related plan**: .sdd/plans/render-ui-v1.md

---

## Overview

The second cosmos channel: a `render_ui` MCP server (Electron main process) exposing a
tool `render_ui(spec)` where `spec` is an A2UI `surfaceUpdate` payload. When Claude Code
calls the tool, cosmos renders the payload as native components in a Generated-UI panel,
waits for the user to interact, and returns that interaction as the tool result — closing
the loop so Claude can keep reasoning. This is PoC milestone 2 (ARCHITECTURE §4.3, §4.4, §5).

## User Scenarios

> Each scenario must be independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Claude shows a rich UI surface · P1

**As a** cosmos user
**I want to** see rich, interactive UI (forms, cards, buttons) that Claude generates
**So that** I can respond to Claude graphically instead of only through the terminal

**Acceptance criteria:**

- Given a `claude` session is running in the TUI, when Claude calls `render_ui` with a valid A2UI `surfaceUpdate`, then the described UI is rendered with native components in the Generated-UI panel within a moment.
- Given the panel renders Claude's UI, when I look at the TUI, then the terminal continues to show Claude's textual reasoning unchanged (the two channels never share a stream).

### Respond by interacting with the UI · P1

**As a** cosmos user
**I want to** click buttons / fill in fields in the generated UI
**So that** my response is delivered back to Claude as the tool result

**Acceptance criteria:**

- Given a rendered surface with an actionable control, when I activate it (e.g. press a button, submit a form), then the action and any associated values are captured and sent back to the MCP server.
- Given my action reaches the MCP server, when the `render_ui` call resolves, then Claude receives my action as the tool result and continues reasoning on it.

### Dismiss / cancel without acting · P2

**As a** cosmos user
**I want to** dismiss or cancel a generated surface
**So that** I am not forced to interact, and Claude is told I declined

**Acceptance criteria:**

- Given a rendered surface, when I cancel/dismiss it, then the `render_ui` call resolves with an explicit "cancelled/dismissed" result rather than hanging or returning empty.

### Tool is visible to the interactive session · P1

**As a** cosmos user
**I want to** the running `claude` session to discover `render_ui` automatically
**So that** Claude can choose to use it without manual setup each run

**Acceptance criteria:**

- Given cosmos launches the `claude` session, when Claude lists its tools, then `render_ui` is registered and available via project-scope `.mcp.json`.

### Malformed UI does not break the app · P2

**As a** cosmos user
**I want to** the app to stay alive if Claude emits an invalid surface
**So that** a bad payload degrades gracefully instead of crashing my session

**Acceptance criteria:**

- Given Claude calls `render_ui` with a payload that is not a valid A2UI `surfaceUpdate`, when the server validates it, then the payload is rejected with a warning, the panel shows a safe fallback (not a crash), and the tool returns an error result.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST run an in-process MCP server in the Electron main process exposing a tool `render_ui` whose single argument is an A2UI `surfaceUpdate` spec. |
| FR-002 | The system MUST register the `render_ui` MCP server with the interactive `claude` session via a project-scope `.mcp.json` so the running TUI session can discover and call the tool. |
| FR-003 | On a `render_ui` call, the system MUST validate the argument is a well-formed A2UI `surfaceUpdate`; an invalid spec MUST be rejected with a warning and the tool MUST return an error result (it MUST NOT crash the server or the app). |
| FR-004 | On a valid `render_ui` call, the system MUST push the A2UI spec from the main process to the renderer's Generated-UI panel over IPC. |
| FR-005 | The Generated-UI panel MUST render the pushed A2UI spec as native components via `@easyops-cn/a2ui-sdk`. |
| FR-006 | The panel MUST capture the user's interaction (the action identity plus any associated values, e.g. submitted form data) and send it back to the main process over IPC. |
| FR-007 | The `render_ui` tool call MUST await the user's action and resolve with that action as the MCP tool result, so Claude continues reasoning on the user's response. |
| FR-008 | The system MUST define a single shared interaction contract (an A2UI **action** message: stable channel names plus typed action/result payloads) in `src/shared/ipc.ts`, consumed by both the MCP server and the renderer. (Resolves ARCHITECTURE §7 item 3.) |
| FR-009 | When the user dismisses/cancels a surface without completing an action, the tool MUST resolve with an explicit "cancelled" result distinguishable from a completed action (never hang, never resolve empty). |
| FR-010 | The main process MUST validate every inbound IPC payload from the renderer (the returned action) at the boundary with a pure validator; an invalid or missing required field MUST log a warning and be safely ignored (no crash), consistent with the milestone-1 convention. |
| FR-011 | The renderer MUST continue to run with `contextIsolation: true` and `nodeIntegration: false`; the new A2UI surface MUST be exposed to the renderer only through the `contextBridge` preload as a dedicated `window.cosmos.ui` channel set, alongside (not merged into) the existing `pty` surface. |
| FR-012 | The system MUST correlate each pushed surface with its returned action (a per-call `requestId`) so a returned action resolves the correct pending `render_ui` call. |
| FR-013 | The `render_ui` and PTY (TUI) channels MUST remain independent; the A2UI spec MUST NOT be parsed out of the TUI text stream. |
| FR-014 | The panel SHOULD display a single active surface at a time; a new `render_ui` call MAY replace the currently displayed surface (PoC scope — no multi-surface stacking). |

## Interaction Contract (proposal — resolves ARCHITECTURE §7 item 3)

A concrete proposal for the shared A2UI action contract, to live in `src/shared/ipc.ts`
(typed) and `src/shared/validate.ts` (validators). Direction legend: `M->R` main→renderer,
`R->M` renderer→main.

- `ui:render` · **M->R** — push a surface to render.
  Payload: `{ requestId: string, spec: A2uiSurfaceUpdate }`.
- `ui:action` · **R->M** — return the user's interaction for a surface.
  Payload: `{ requestId: string, action: A2uiAction }` where
  `A2uiAction = { type: 'submit' | 'cancel', actionId?: string, values?: Record<string, unknown> }`.
  `type: 'cancel'` carries the dismiss/cancel case (FR-009); `type: 'submit'` carries
  `actionId` (which control fired) and optional `values` (e.g. form fields).

`requestId` is generated by the MCP server per call (FR-012). The exact A2UI `surfaceUpdate`
schema and the precise action vocabulary emitted by `@easyops-cn/a2ui-sdk` are confirmed
against the SDK during planning (see Open Questions); the channel/correlation shape above is
the cosmos-owned contract and is stable regardless of A2UI's internal field names.

## Edge Cases & Constraints

- Invalid / non-A2UI spec passed to `render_ui` → warn + safe fallback in the panel + error tool result; no crash (FR-003).
- User dismisses/cancels without acting → explicit "cancelled" tool result (FR-009).
- Invalid action payload returned from the renderer (missing/extra/malformed fields) → warn and ignore at the boundary; the pending call is not resolved by a bad payload (FR-010).
- A new `render_ui` call arrives while a surface is still displayed → the new surface replaces the old; the superseded call SHOULD resolve as "cancelled/superseded" rather than hang (relates to FR-009/FR-014).
- Renderer reload while a `render_ui` call is pending → the pending call MUST NOT hang forever; it SHOULD resolve as cancelled so Claude is not blocked indefinitely.
- **Explicitly out of scope** (deferred): multiple concurrent surfaces / surface stacking, session/surface persistence across restarts, authentication or capability scoping of the tool, a registry of multiple MCP tools beyond `render_ui`, streaming/partial surface updates, and theming beyond what makes generated UI look native.

## Success Criteria

| ID     | Criterion                                                                                              |
|--------|-------------------------------------------------------------------------------------------------------|
| SC-001 | The running `claude` TUI session can discover and call `render_ui` (registered via `.mcp.json`).       |
| SC-002 | A valid `render_ui` call renders the corresponding native UI in the Generated-UI panel.                |
| SC-003 | Activating a control in the panel returns the user's action to Claude as the `render_ui` tool result.  |
| SC-004 | Cancelling/dismissing a surface returns an explicit "cancelled" tool result (call does not hang).      |
| SC-005 | An invalid A2UI spec is rejected with a warning and a safe fallback; the app does not crash.            |
| SC-006 | An invalid returned-action IPC payload logs a warning and is safely ignored (no crash), and does not falsely resolve a pending call. |
| SC-007 | The TUI channel keeps streaming Claude's text unchanged while a surface is shown (channels stay independent). |

---

## Open Questions

- [ ] [NEEDS CLARIFICATION] Exact A2UI `surfaceUpdate` JSON schema and the action/event vocabulary emitted by `@easyops-cn/a2ui-sdk` (e.g. how a button press / form submit surfaces to the host). The proposed cosmos action contract (`submit`/`cancel` + `actionId` + `values`) must be confirmed against, and mapped to, the SDK's actual event model during planning. This is an implementation-detail confirmation, not a behavioral ambiguity, so it does not block this spec.
- [ ] [NEEDS CLARIFICATION] Whether the in-process MCP server is reachable by the `claude` CLI over stdio launched as a subprocess, or must be exposed as a separate local server endpoint referenced from `.mcp.json`. ARCHITECTURE calls it "in-process"; the transport/registration mechanics are a plan-level decision.
