# Spec: Unified Agent Session — v1

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: (none — extends cosmos-conversation-panel-v1 step 2)
**Related plan**: .sdd/plans/unified-agent-session-v1.md

---

## Grounding

**codegraph_explore** (verbatim source read, not summarized):
- `agentSessionQueue decideSubmit isPersistentSessionTarget PERSISTENT_SESSION_TARGET AgentRunner defaultSessionId` — confirmed the session-id + queue logic is gated on `isPersistentSessionTarget(target)` (`target === 'generated-ui'`); `decideSubmit` returns `enqueue` only for the persistent target and `drop` for all others while busy.
- `usePublishComposer submit target useGenerativePanelTabs originatingTabIdRef in-flight spinner cosmos-conversation-panel transcript reader conversation channel` — confirmed render routing is purely renderer-side: each panel's `useGenerativePanelTabs` filters `ui:render` by its own `target` and correlates the in-flight tab via `originatingTabIdRef`; per-tab spinner is gated on `ui:generatingBegin`, released on `ui:render` land or `agent:status completed/error`.

**Reads:** `agentRunner.ts` (`run`, `usesPersistentSession`, `spawnRun`, `drainQueue`, `dispose`), `transcriptReader.ts` (path derivation — confined to `~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl`), `index.ts` (~2312 AgentRunner construction passes `defaultSessionId: defaultSession.sessionId`), `ARCHITECTURE.md` §4.10 / §4.11.

**memory_recall** `persistent agent session defaultSessionId render target Open-Prompt serialization queue` — recovered the cosmos-conversation-panel-v1 step 2 architecture note: AgentRunner gained `defaultSessionId`, default-target runs pass `--session-id`, default-target submits serialize (FIFO `queue` drained on close/error), non-default targets kept drop-while-busy. This spec changes exactly that gate.

**Origin:** escalated from a `/bugfix` triage that hit the scope gate (architecture/contract change, not a spot fix). Triage note: `.sdd/bugs/open-prompt-conversation-not-accumulating-v1.md`.

---

## Overview

Open-Prompt conversations spoken from the Jira / Slack / Confluence / Calendar panels do not
accumulate in the Cosmos conversation panel, because only the default `'generated-ui'` target runs
against the persistent session; every other target runs ephemerally (no `--session-id`) and is
recorded to a different/no transcript the Cosmos reader never sees. This feature unifies ALL
Open-Prompt targets onto ONE persistent `claude` session so every conversation accumulates in the
Cosmos panel, while each panel's generated UI still renders into its own panel.

## User Scenarios

### Every panel's conversation appears in the Cosmos panel · P1

**As a** cosmos user
**I want to** see every Open-Prompt utterance I speak from any panel (Jira, Slack, Confluence,
Calendar, Generated UI) accumulate in the Cosmos conversation timeline
**So that** the Cosmos panel is a complete, continuous record of my assistant conversation.

**Acceptance criteria:**
- Given the Cosmos panel is open, when I submit an utterance from the Jira panel, then that
  utterance (and the assistant's turn) appears in the Cosmos conversation timeline.
- Given I have spoken from Slack, Confluence, and Calendar panels in one session, when I view the
  Cosmos panel, then all of those turns appear in the single continuous conversation.
- Given I relaunch the app, when I submit from any panel, then the conversation continues the same
  session (history preserved) rather than starting fresh.

### Shared, continuous assistant context across panels · P1

**As a** cosmos user
**I want to** the assistant to carry context from one panel's conversation into the next
**So that** I can refer back to something I asked in another panel without repeating myself.

**Acceptance criteria:**
- Given I asked about a Jira ticket, when I then submit from the Slack panel referring to "that
  ticket", then the assistant has the prior turn in context (one continuous conversation).

### A submit while another run is in flight waits, never drops · P1

**As a** cosmos user
**I want to** submit from panel B while panel A's run is still running and have my submit run after
**So that** my request is never silently lost and the two runs never collide on the session id.

**Acceptance criteria:**
- Given panel A's run is in flight, when I submit from panel B, then panel B shows a pending/in-flight
  indication and its run starts only after panel A's run completes.
- Given a long-running panel A run, when I submit from panel B, then panel B's pending state persists
  until A finishes and B's run is drained — it is never dropped.
- Given panel B's queued run eventually executes, when it produces a surface, then that surface
  renders into panel B (not panel A), preserving per-panel render routing.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | Every Open-Prompt submit (targets `jira`, `slack`, `confluence`, `google-calendar`, `generated-ui`) MUST run against the SAME persistent default session id — the run MUST always pass `--session-id <defaultSessionId>` regardless of target. |
| FR-002 | The render `target` of a submit MUST be preserved unchanged and used ONLY for `ui:render` routing (which panel the generated surface lands in). Unifying the session MUST NOT change which panel a surface renders into. |
| FR-003 | "Which session/transcript a run uses" MUST be DECOUPLED from "which render target a run renders to." The session id is ALWAYS the persistent default; the target governs render routing only. The two concerns MUST NOT be re-coupled. |
| FR-004 | While a run is in flight, a submit for ANY target MUST be ENQUEUED (serialized) behind the in-flight run, never dropped. The single shared session id makes all runs mutually exclusive. |
| FR-005 | Queued submits MUST drain in FIFO order, one at a time, each starting only when the runner is idle, so two `claude -p --session-id <same id>` runs never overlap (no "Session ID is already in use" collision). |
| FR-006 | A queued submit MUST preserve its own `target` and `viewContext` so that, when drained, it renders into the correct panel with the correct grounding. |
| FR-007 | The runner MUST still grant each run ONLY the tools for ITS target (`--mcp-config` + `--allowedTools` least-privilege), unchanged. Unifying the session MUST NOT broaden a run's tool grants. |
| FR-008 | When a submit is queued behind an in-flight run, the originating panel/tab MUST show a pending/in-flight indication (reusing the existing per-tab in-flight signal) so the user knows the submit was accepted and is waiting, not lost. |
| FR-009 | The shared conversation context across panels is a DELIBERATE product property (the unified assistant sees all panels' history), and MUST be documented as such — it is NOT a leak. |
| FR-010 | SECURITY UNCHANGED: integration tokens/secrets MUST remain main-only and MUST NEVER appear in any transcript, IPC payload, MCP result, or A2UI surface. |
| FR-011 | The Cosmos conversation reader MUST require NO change in which transcript it reads: it already reads the one default-session transcript at `~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl`, and ALL runs now record there. The spec MUST confirm (not assume) the path derivation still holds. |
| FR-012 | On relaunch, the persistent session MUST continue (create-or-continue id from `AgentSessionStore`), so accumulated history persists and new submits from any panel continue it. |
| FR-013 | The old per-target EPHEMERAL run behavior (a non-default target running with NO `--session-id`) MUST be REMOVED — there is no longer an ephemeral path. |
| FR-014 | Teardown (reload/close/quit) MUST clear the queue and kill the in-flight child as today (no stale queued submit fires after dispose). |

## Edge Cases & Constraints

- **Concurrent submits from two panels.** Both serialize on the single session; the second enqueues
  and drains after the first. Order is submit order (FIFO).
- **Long-running panel A blocking panel B.** Panel B's submit shows pending until A completes; it is
  never dropped. (Tradeoff the user accepted: cross-panel runs are mutually exclusive.)
- **Relaunch mid-conversation.** Session id is reused (create-or-continue); history continues.
- **Generated-UI correlation while serialized.** Each panel's `originatingTabIdRef` correlation is
  per-panel and renderer-side; a queued submit's eventual `ui:render` still carries its own `target`
  and lands in the right panel. The runner emits `started`/`completed`/`error` per actual run, so the
  begin-signal / surface / release sequence is unchanged per run. A panel whose submit is still
  queued has set its originating tab in-flight at send time and simply waits for its run's signals.
- **Empty utterance.** Still rejected before the queue/spawn decision (unchanged).
- **Out of scope:** any change to render routing, catalogs, per-tab correlation, the transcript
  parser/reader internals, or tool grants. Out of scope: a per-panel "separate conversation" mode
  (the user chose ONE unified session).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | After submitting from each of Jira, Slack, Confluence, Calendar, and Generated UI in one session, the Cosmos conversation timeline shows all five turns in one continuous conversation. |
| SC-002 | A submit from panel B while panel A's run is in flight is never dropped: it shows pending and runs to completion after A, rendering into panel B. |
| SC-003 | No "Session ID is already in use" error occurs under any interleaving of multi-panel submits. |
| SC-004 | No token/secret appears in any transcript line, IPC payload, MCP result, or surface (unchanged from prior). |
| SC-005 | After relaunch, a submit from any panel continues the prior conversation (history preserved). |

---

## Open Questions

- None blocking. The user has decided the model (one unified persistent session; panels share
  context; runs serialize). Fairness is FIFO by submit order (stated in FR-005); no priority tiers
  are introduced.
