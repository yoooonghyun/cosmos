# Spec: Jira Generative UI — v1

**Status**: Draft
**Created**: 2026-06-06
**Supersedes**: —
**Related plan**: .sdd/plans/jira-generative-ui-v1.md (to be authored after this spec is approved)

---

## Overview

Render Jira screens (issue lists, a single ticket) as A2UI surfaces in the cosmos
Generated-UI panel, and make interacting with them perform REAL Jira operations. Building on
the just-completed generative-UI foundation (`render_ui` → `UiBridge` → renderer → `ui:action`)
and the existing read-only Jira integration (§4.9), this feature adds **deterministic action
binding** — a surface action like "move this ticket to Done" or "add a comment" is statically
mapped to a Jira API call and dispatched **directly by the Electron main process without
re-invoking Claude** — plus the **`write:jira-work`** scope and the first **write** Jira MCP
tools (issue transition, comment). This is a deliberate, scoped departure from the prior
intentionally read-only Atlassian stance.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Compose a Jira screen from an utterance · P1

**As a** cosmos user
**I want to** ask for a Jira screen in natural language (e.g. "show my open bugs", "open PROJ-123")
**So that** I see a native, interactive Jira surface in the Generated-UI panel instead of reading raw text

**Acceptance criteria:**

- Given Jira is connected, when I submit an utterance asking for issues or a ticket, then the headless agent reads Jira via the existing read tools (`jira_search_issues` / `jira_get_issue`) and renders an A2UI surface in the Generated-UI panel via the existing `render_ui` → `UiBridge` → `ui:render` path.
- Given the surface renders, when I look at it, then each issue/ticket shows the data already abstracted in `src/shared/jira.ts` (key, summary, status name + normalized category, assignee; for a single ticket also reporter, description, comments) — no parallel resource shapes are invented.
- Given Jira is NOT connected, when I ask for a Jira screen, then the agent surfaces the existing structured "connect Jira in cosmos first" outcome and the panel does not hang or crash.

### Transition a ticket from the surface (deterministic) · P1

**As a** cosmos user
**I want to** move a ticket to another status by interacting with the rendered surface
**So that** the change is applied in real Jira immediately, without waiting on another model round-trip

**Acceptance criteria:**

- Given a ticket surface offers a status transition (e.g. a `ChoicePicker`/`Button` whose action is named `jira.transition` with context `{ issueKey, transitionId }`), when I pick a transition and the surface action fires, then the Electron main process recognizes the bound `jira.*` action and executes the transition via the existing `JiraManager` — WITHOUT spawning or re-invoking `claude`.
- Given the transition succeeds, when it completes, then the surface reflects the new status (e.g. the status badge/text updates) without the surface being re-composed by Claude.
- Given the transition is rejected by Jira (not an allowed transition, permission denied, conflict), when the result returns, then the surface shows a clear, non-alarming error state and the ticket's displayed status is unchanged.

### Comment on a ticket from the surface (deterministic) · P1

**As a** cosmos user
**I want to** add a comment to a ticket from the rendered surface
**So that** the comment is posted to real Jira immediately

**Acceptance criteria:**

- Given a ticket surface offers a comment control (an action named `jira.comment` with context `{ issueKey, body }`), when I submit a non-empty comment, then main executes the comment write via `JiraManager` WITHOUT re-invoking `claude`, and the surface reflects success (e.g. the new comment appears / a success state is shown).
- Given the comment body is empty/whitespace-only, when I attempt to submit, then no write is dispatched.
- Given the comment write fails (permission denied, token expired, network), when the result returns, then the surface shows a clear error state and no comment is shown as posted.

### Re-consent for write access · P1

**As a** cosmos user
**I want to** be told that Jira actions need additional (write) permission and re-authorize once
**So that** cosmos can perform writes I explicitly approved, with no silent scope escalation

**Acceptance criteria:**

- Given my existing Jira connection was granted only read scopes, when I first attempt a write (or open the Jira surface flow), then cosmos detects the missing `write:jira-work` scope and prompts me to reconnect/re-consent rather than silently failing or attempting a write it cannot perform.
- Given I complete the re-consent, when the new token set (now including `write:jira-work`) is stored, then subsequent writes proceed; the token and `client_secret` never leave the main process.
- Given I decline or the re-consent fails, when I return, then the connection degrades to a clear state (e.g. `reconnect_needed` / a "writes need permission" message) and reads continue to work.

### Write fails gracefully · P1

**As a** cosmos user
**I want to** a failed Jira write to never hang or crash the app
**So that** I can retry or move on

**Acceptance criteria:**

- Given any deterministic `jira.*` action, when the write fails for any reason (rate limited, network, reconnect needed, invalid transition, permission), then main returns a structured failure that the surface reflects as a recoverable error — never a crash, hang, or stack trace, and never leaking a token/secret.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                          |
|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001  | Jira screens (an issue list from a search, and a single ticket) MUST be renderable as A2UI surfaces in the Generated-UI panel through the EXISTING `render_ui` → `UiBridge` → `ui:render` path — no second rendering path is introduced.                                                                                                                                                                |
| FR-002  | Jira surfaces MUST present the resources already abstracted in `src/shared/jira.ts` (`JiraIssueSummary`, `JiraIssueDetail`, `JiraComment`, `JiraUserRef`, normalized `JiraStatusCategory`). NO parallel/duplicate Jira resource type may be introduced for rendering.                                                                                                                                  |
| FR-003  | v1 MUST render Jira surfaces using the A2UI **standard catalog** (Card/Text/ChoicePicker/Button etc.). A Jira-specific custom catalog (`catalogId: "jira"`, e.g. `TicketCard`/`TransitionPicker`) is OUT of scope for v1 (deferred polish — see Edge Cases).                                                                                                                                            |
| FR-004  | A surface action whose name is in the reserved **`jira.*`** namespace MUST be treated as a **deterministically bound** Jira operation: it is recognized and dispatched in the Electron **main** process and executed via the existing `JiraManager`, WITHOUT spawning or re-invoking `claude`.                                                                                                          |
| FR-005  | v1 MUST support at least two bound actions: `jira.transition` (context `{ issueKey, transitionId }`) and `jira.comment` (context `{ issueKey, body }`). The bound-action name + its required context fields MUST be the single contract shared by main's dispatcher and any surface that emits the action (centralized in `src/shared/jira.ts`, never an ad-hoc string).                                  |
| FR-006  | Main MUST validate every bound `jira.*` action's payload (action name + required context fields, correct types, non-empty where required — e.g. a non-empty `comment.body`) at the boundary before dispatch; an invalid/unknown bound action MUST be warned and safely ignored (no write, no crash), consistent with existing IPC-boundary conventions.                                                  |
| FR-007  | After a bound action's Jira operation resolves, the rendered surface MUST reflect the result (success → updated status / appended comment / success indicator; failure → a clear recoverable error state) WITHOUT the surface being re-composed by Claude (no model round-trip to update the surface).                                                                                                  |
| FR-008  | A new **write** Jira MCP tool set MUST be added to `src/mcp/jiraMcpServer.ts` exposing at least a transition tool and a comment tool, so the headless/interactive agent MAY also perform these writes (the model-mediated path). These tools relay over the existing `JiraBridge` to the SAME `JiraManager` write methods used by deterministic dispatch — one write implementation, two callers.        |
| FR-009  | The Jira write tool names MUST be centralized in `src/shared/jira.ts` (extending `JiraTool`/`JiraOp`) so the entry script, the bridge, and the manager never disagree on a literal; the write tools' descriptions MUST clearly state they MUTATE Jira (distinct from the read-only tools).                                                                                                              |
| FR-010  | `JiraManager` MUST gain write operations (at least `transitionIssue` and `addComment`) that go through its existing token/refresh/`reconnect_needed`-handling `run()` path and the single `JiraClient`. The write operations MUST return the same `JiraResult<T>` discriminated-union discipline as reads so all callers branch on `ok` and degrade gracefully.                                          |
| FR-011  | `JiraClient` MUST gain the corresponding write REST calls (transition: `POST /rest/api/3/issue/{key}/transitions`; comment: `POST /rest/api/3/issue/{key}/comment`) against `…/ex/jira/{cloudId}`, mapping HTTP failures through the existing `mapJiraError` discipline (429 → `rate_limited`, 401/403 → `reconnect_needed`, else → `network`).                                                          |
| FR-012  | The Atlassian/Jira OAuth scope set MUST add **`write:jira-work`** to the Jira scopes (`src/main/integrations/atlassianConfig.ts`), retaining the existing read scopes. This is the documented departure from the prior read-only stance and MUST be the ONLY new scope added for v1 (least privilege).                                                                                                  |
| FR-013  | Because adding a scope changes the grant, the system MUST require **re-consent / re-authorization** before performing any write: a Jira token granted without `write:jira-work` MUST NOT be used to attempt a write. Main MUST detect the missing write scope (from the stored token's granted scopes) and surface a clear "reconnect to enable Jira actions" outcome rather than attempting a failing write. |
| FR-014  | The Atlassian Cloud 3LO **`client_secret`** MUST remain main-process only (from the gitignored env var), NEVER logged, and NEVER placed in any IPC payload, bridge frame, MCP tool argument/result, or A2UI surface. Adding writes MUST NOT change this invariant.                                                                                                                                      |
| FR-015  | Jira access + refresh tokens MUST remain main-process only (encrypted via `safeStorage`), NEVER exposed to the renderer, the bridge, the MCP entry script, or the sandboxed `claude` child. Surfaces and bound-action payloads carry only non-secret content/identifiers (e.g. `issueKey`, `transitionId`, comment body) — never a token.                                                               |
| FR-016  | A bound action and its write MUST be a SEPARATE concern from the foundation's "submit-and-return-to-Claude" `ui:action` semantics: a `jira.*` action MUST NOT require the pending `render_ui` call to resolve back into a Claude turn in order to take effect (the write happens in main regardless). See Open Questions for how the pending `render_ui` call is settled.                                  |
| FR-017  | All write failures (invalid transition, permission denied, `reconnect_needed`, `rate_limited`, `network`) MUST be surfaced to the user as recoverable surface states and MUST NOT crash, hang, or expose a token/secret/stack trace. A not-connected/reconnect-needed write MUST return the structured "connect/reconnect Jira in cosmos first" result, mirroring the read tools.                        |
| FR-018  | Adding the write MCP tools MUST keep the existing read-only tools (`jira_search_issues`, `jira_get_issue`) and their behavior unchanged, and MUST follow the existing build-wiring convention so the (still single) `jiraMcpServer` entry continues to bundle to `out/main/mcp/jiraMcpServer.js` via its rollup `input` in `electron.vite.config.ts` (flag: confirm no NEW entry/input is needed since the write tools live in the SAME server). |
| FR-019  | The deterministic dispatch path MUST NOT spawn, kill, write to, or otherwise disturb the interactive Terminal PTY or the headless `AgentRunner`; executing a `jira.*` action is purely a main → `JiraManager` → Jira REST call plus a surface update.                                                                                                                                                  |
| FR-020  | A `jira.transition` action SHOULD carry a `transitionId` resolved from Jira's allowed transitions for that issue (Jira transitions are issue/workflow-specific). v1 MAY rely on the composing agent to read the issue's available transitions when building the surface; main MUST treat an unknown/disallowed `transitionId` as a write failure (FR-017), not a crash. See Open Questions for whether main resolves transitions itself. |

## Edge Cases & Constraints

- **Write fails — not allowed transition / permission denied** → main returns a structured `JiraResult` error; the surface shows a recoverable error and the displayed status is unchanged (FR-007, FR-017). No crash.
- **Token expired mid-write** → `JiraManager.run()`'s existing proactive/reactive refresh applies to writes too (FR-010); only a failed refresh flips to `reconnect_needed`, surfaced as a recoverable error (FR-017).
- **Token granted without `write:jira-work`** (existing connection from the read-only era) → detected via the stored granted scopes; cosmos prompts re-consent and does NOT attempt the write (FR-013). Reads keep working.
- **Empty/whitespace comment body** → no write dispatched (FR-006); the surface guards it.
- **Unknown/invalid bound action** (e.g. `jira.frobnicate`, or `jira.transition` missing `issueKey`/`transitionId`) → warned + ignored at the main boundary; no write (FR-006).
- **Concurrent surface / superseding render** → the foundation's `UiBridge` keeps at most one active surface and supersede/cancel resolves the pending `render_ui` call exactly once. A bound `jira.*` action operating on an issue key is independent of which surface is currently active; main dispatches by the action's `issueKey` in the payload, not by assuming the active surface. (See Open Questions for how the surface that emitted the action is updated if it is no longer the active surface.)
- **Rate limited (429)** → mapped to `rate_limited` with `Retry-After` honored (FR-011); surface shows "busy, retry shortly".
- **Stale `transitionId`** (the issue moved since the surface was composed, so the transition is no longer valid) → Jira rejects; surfaced as a write failure (FR-017, FR-020).
- **Security:** `client_secret` and tokens stay in main only (FR-014, FR-015); bound-action payloads and surfaces carry only non-secret content. The write tools' arguments (`issueKey`, `transitionId`, `body`) are non-secret.
- **Explicitly out of scope for v1:**
  - A Jira-specific A2UI custom catalog (`catalogId: "jira"`, `TicketCard`/`TransitionPicker`) — deferred polish; the standard catalog suffices (FR-003).
  - Write operations beyond transition + comment (assign, edit fields, create issue, delete, attachments, worklogs).
  - `write:jira-user` or any scope beyond the single `write:jira-work` (FR-012).
  - Multi-site selection, bulk operations, optimistic offline queueing.
  - Confluence writes (this spec is Jira-only).
  - Utterance-based editing of an already-rendered Jira surface (the conversational refine loop) beyond what the foundation already provides.

## Success Criteria

| ID      | Criterion                                                                                                                                                  |
|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001  | Submitting a Jira utterance renders an issue-list or single-ticket A2UI surface in the Generated-UI panel via the existing `render_ui` path, populated from the `src/shared/jira.ts` resource shapes. |
| SC-002  | Picking a transition on a ticket surface executes a REAL Jira transition via `JiraManager` dispatched in main WITHOUT re-invoking `claude`, and the surface reflects the new status. |
| SC-003  | Submitting a comment on a ticket surface posts a REAL Jira comment via `JiraManager` dispatched in main WITHOUT re-invoking `claude`, and the surface reflects success. |
| SC-004  | A write attempted with a token lacking `write:jira-work` does NOT execute; the user is prompted to reconnect, and after re-consent the write succeeds. |
| SC-005  | A failed write (invalid transition / permission / reconnect-needed / rate-limited / network) surfaces a recoverable error state; the app never crashes, hangs, or leaks a token/secret. |
| SC-006  | The new write MCP tools (transition + comment) are registered in `jiraMcpServer.ts`, route through `JiraBridge` → `JiraManager` to the SAME write methods as deterministic dispatch, and the existing read-only tools are unchanged. |
| SC-007  | The Jira scope set includes exactly `write:jira-work` added to the prior read scopes; `client_secret` and tokens remain main-process only across the new write paths (never logged/IPC/bridge/MCP/surface). |
| SC-008  | Executing a `jira.*` bound action never spawns/kills/writes to the Terminal PTY or the `AgentRunner` (channel independence preserved). |

---

## Open Questions

- [ ] **Where exactly does Jira bound-action dispatch intercept, and how is the pending `render_ui` call settled?** (the central design tension)
  **Recommended resolution:** Intercept bound `jira.*` actions in **main, at the `ui:action` boundary**, as an extension of the existing `UiBridge`/`ui:action` handling — NOT in the renderer and NOT by bouncing through Claude. Concretely: when an inbound `ui:action` carries an `actionId` in the reserved `jira.*` namespace, main routes it to a new **Jira action dispatcher** (calling `JiraManager` write methods) instead of (or in addition to) resolving it back to the pending `render_ui` tool call.
  For the pending `render_ui` call: **resolve it as `cancel`** (the foundation's existing "no Claude turn needed" settlement) so the headless run that composed the surface does not block and Claude is NOT re-invoked to apply the write. The surface update (FR-007) is then driven by main pushing a fresh `ui:render` (or a new lightweight `ui:result`/surface-patch channel) reflecting the post-write state — produced in main from the write's `JiraResult`, NOT by Claude. This keeps deterministic binding fully main-side. **Trade-off / sub-question:** updating the surface after the write needs either (a) main re-pushing a re-rendered surface it composes deterministically from the `JiraResult` (simplest; main owns a small Jira-surface builder), or (b) a new targeted surface-update IPC the renderer applies in place. Recommend (a) for v1 (main composes the updated Jira surface deterministically), deferring (b). Confirm before planning.

- [ ] **Does v1 introduce a dedicated bound-action IPC channel, or reuse `ui:action`?**
  **Recommended resolution:** Reuse the existing `ui:action` channel and discriminate on the `jira.*` `actionId` namespace in main (no new renderer-facing channel needed for dispatch), since surfaces already emit actions via `ui:action`. The only genuinely new IPC is the surface-update mechanism the chosen FR-007 option above requires (option (a) reuses the existing `ui:render`). Confirm.

- [ ] **Who resolves the `transitionId` for `jira.transition`?**
  **Recommended resolution:** For v1, the **composing agent** resolves available transitions when building the surface (it can read the issue and Jira's transitions), so the surface emits a concrete `transitionId`; main treats an invalid/stale `transitionId` as a write failure (FR-020, FR-017). Optionally add a read-only "list transitions" capability later if the agent proves unreliable at this. Flagging because Jira transitions are workflow-specific and not derivable from the normalized `JiraStatusCategory` alone — `done` is a category, not a transition. Confirm whether v1 also needs a `jira_list_transitions` read tool to support this.

- [ ] **Re-consent UX entry point.** Where does the user trigger the write re-consent — the existing Jira native panel's Connect/Reconnect button (extended to request the new scope), a prompt from the Generated-UI panel when a bound action hits a scope gap, or both?
  **Recommended resolution:** Extend the existing Jira connection flow so reconnecting always requests the full (read + `write:jira-work`) scope set, and have a scope-gap write surface a "reconnect to enable Jira actions" error that points the user to that existing Connect/Reconnect affordance. Avoid a second OAuth entry point. Confirm.
