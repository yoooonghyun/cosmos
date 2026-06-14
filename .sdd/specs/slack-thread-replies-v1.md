# Spec: Slack Thread Replies (generated-UI catalog) — v1

**Status**: Draft
**Created**: 2026-06-08
**Supersedes**: —
**Related plan**: .sdd/plans/slack-thread-replies-v1.md

---

## Grounding

> Investigated directly via codegraph + agentmemory before authoring (CLAUDE.md SDD rule).
> agentmemory had no prior records for this feature area (empty recall on both Slack-catalog
> and Jira-dispatcher queries) — no superseded decisions to honor. Grounding is therefore from
> codegraph against the current tree.

- **Slack generated-UI catalog** (`src/renderer/slackCatalog/`): a custom `catalogId: 'slack'`
  catalog registered via `<A2UIProvider catalog={slackCatalog}>` in the Slack panel. Its
  `MessageRow` (`components.tsx:126`) is **display-only** and renders a dead `"N replies"` text
  label from `replyCount` (lines 147–151) — it has no click affordance and no thread data.
- **Native parity already exists**: `SlackPanel.tsx`'s native `MessageRow` (line 189) renders the
  same `"N replies"` as a clickable `Button` (`onOpenThread`, lines 210–219); the native thread
  view (lines 935–951) calls `window.cosmos.slack.getReplies({ channelId, threadTs, cursor })`
  and renders the replies as a `MessageList`. The native panel already drops the parent (Slack's
  `conversations.replies` returns it as item 0) to avoid double-rendering the root.
- **Read IPC already wired**: `SlackApi.getReplies(params: SlackRepliesParams)` exists in
  `src/shared/ipc.ts` (line 371) and returns `SlackResult<SlackPage<SlackMessage>>`; the params
  shape `SlackRepliesParams { channelId, threadTs, cursor? }` is in `src/shared/slack.ts:193`.
  The Slack token never leaves main; `getReplies` carries no token (FR-006/SC-008 baseline).
- **Two existing action conventions**:
  1. **Renderer-local nav actions** — `SLACK_OPEN_CHANNEL_ACTION = 'slack.openChannel'`
     (`slackCatalog/logic.ts:62`) and `JIRA_OPEN_DETAIL_ACTION = 'jiraNav.openDetail'`. A catalog
     component dispatches these and the owning panel's `onAction` seam
     (`SlackPanel.handleSurfaceAction`, `SlackPanel.tsx:715`) intercepts them **renderer-locally**
     — never forwarded to main or the agent.
  2. **Main deterministic bound-action** — the `jira.*` write namespace, intercepted at the
     `ui:action` boundary in `src/main/index.ts` (line 561) and routed to `JiraActionDispatcher`,
     which re-composes its surface from scratch (board/detail templates main owns) and re-pushes.
- **The composed Slack surface is display-only and not held by main**: `UiBridge` retains only
  `{ requestId, callId, socket }` (`uiBridge.ts:39`), NOT the agent's A2UI spec, and a
  `target: 'slack'` render call is **settled immediately** (`uiBridge.ts:190`) because the surface
  awaits no action. ARCHITECTURE §4.8 states the Slack generative surface is "display-only — no
  write scope, no write tool, no deterministic dispatcher". These facts decide the mechanism (see
  the plan's Technical Context).

---

## Overview

In the Slack agent-composed surface (rendered by `render_slack_ui`, `catalogId: 'slack'`),
thread replies cannot currently be seen — the catalog's `MessageRow` shows only a dead "N replies"
label. This feature makes that label a clickable affordance that, **on demand**, fetches the
thread's replies (read-only) and renders them nested/indented under their parent using the **same
`MessageRow` component**, matching what the native Slack panel already does. Replies are never
preloaded: a freshly composed surface shows collapsed threads; only a click loads and reveals a
thread's replies.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice to have).

### View a thread's replies on demand · P1

**As a** cosmos user looking at a Slack message history composed by the agent
**I want to** click the "N replies" indicator on a message that has a thread
**So that** I can read the replies without leaving the generated surface

**Acceptance criteria:**

- Given a composed Slack surface where a `MessageRow` has `replyCount > 0`, when the surface first
  renders, then the thread is **collapsed** — only the "N replies" affordance shows, no replies are
  fetched or displayed.
- Given a collapsed thread, when I click the "N replies" affordance, then its replies are fetched
  via the read-only path and rendered **nested/indented under the parent**, each reply using the
  **same `MessageRow` visual component** as the parent.
- Given replies are being fetched after a click, when the fetch is in flight, then the affordance
  reflects a loading state and cannot be double-triggered into a second concurrent fetch.
- Given the parent message is the thread root that Slack returns as the first reply item, when its
  replies render, then the parent is **not** rendered twice (the root is dropped from the nested
  list, matching native behavior).

### Collapse an expanded thread · P2

**As a** user who has expanded a thread
**I want to** collapse it again
**So that** I can tidy the view back to the message list

**Acceptance criteria:**

- Given an expanded thread, when I click the affordance again, then the nested replies are hidden
  and the row returns to its collapsed "N replies" state.
- Given a thread I previously expanded then collapsed, when I expand it again, then its replies are
  shown again (re-fetched on demand; no stale write-back into the agent surface is required).

### Graceful failure when replies cannot load · P1

**As a** user clicking a thread whose replies fail to load (network error, reconnect needed, or
not connected)
**I want to** see a clear, non-alarming inline message instead of a crash or an infinite spinner
**So that** I understand the thread could not load and the rest of the surface stays usable

**Acceptance criteria:**

- Given a click on a thread, when the read fails for any reason, then an inline error/notice is
  shown under that parent row (not a crash, not a white-screen, not a hung spinner), and the rest
  of the composed surface remains interactive.
- Given a failed expansion, when I click the affordance again, then a fresh fetch is attempted
  (the error state is retryable).
- Given Slack is not connected when I click, then the inline message communicates that connecting
  Slack is required, consistent with the read-only tools' not-connected posture.

### Read-only posture preserved · P1

**As a** security-conscious operator
**I want** this feature to add no write capability and leak no token
**So that** the Slack generated-UI surface stays strictly read-only and secret-safe

**Acceptance criteria:**

- Given any interaction with the reply affordance, when replies are fetched, then ONLY the
  read-only thread read is used — no Slack write of any kind is performed.
- Given any payload crossing a process boundary for this feature, when it is inspected, then it
  carries no Slack token or secret.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Each traces to a scenario/grounding.

| ID     | Requirement                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The catalog `MessageRow` MUST render the "N replies" indicator as an interactive affordance (a button) when `replyCount > 0`, replacing the current dead text label.        |
| FR-002 | A freshly composed Slack surface MUST NOT preload thread replies; each thread starts **collapsed** and fetches replies only upon the user's click (on-demand load).         |
| FR-003 | On click of a collapsed thread, the system MUST fetch that thread's replies via the **read-only** thread read and MUST NOT perform any Slack write.                          |
| FR-004 | Fetched replies MUST render **nested/indented under their parent**, each reply using the **same `MessageRow` component** as the parent (no divergent reply row).            |
| FR-005 | The system MUST NOT render the thread root twice: the parent message returned as the first reply item MUST be dropped from the nested list (native parity).                 |
| FR-006 | While a thread's replies are being fetched, the affordance MUST show a loading state and MUST prevent a second concurrent fetch for that same thread.                       |
| FR-007 | Clicking the affordance of an expanded thread MUST collapse it (hide its nested replies and return to the "N replies" state).                                               |
| FR-008 | Re-expanding a previously collapsed thread MUST show its replies again (a re-fetch is acceptable; no requirement to cache across collapse).                                  |
| FR-009 | A failed reply read (network / reconnect-needed / rate-limited / not-connected) MUST surface an inline, non-alarming error or notice under the parent row, NEVER a crash, white-screen, or hung spinner. |
| FR-010 | A failed expansion MUST be **retryable** — a subsequent click attempts a fresh fetch.                                                                                       |
| FR-011 | When Slack is not connected, clicking the affordance MUST produce a not-connected inline message consistent with the read-only tools' not-connected result.                 |
| FR-012 | A thread with `replyCount` of 0 or absent MUST show no reply affordance (unchanged from today).                                                                             |
| FR-013 | The reply read MUST require the parent message's thread coordinates (`channelId`, `threadTs`); a `MessageRow` lacking the channel context MUST degrade safely to today's non-interactive "N replies" label rather than erroring. |
| FR-014 | No Slack token or secret MUST appear in any payload, IPC message, or A2UI surface introduced by this feature (security baseline).                                           |
| FR-015 | This feature MUST NOT introduce any new mutation to Slack or change the surface's display-only posture; the composed agent surface remains display-only and its render call still settles immediately. |
| FR-016 | The expanded/collapsed state and fetched replies MAY be renderer-local UI state only; they need NOT be persisted into the composed surface spec or any session snapshot.    |
| FR-017 | The reply affordance and any inline error/notice MUST be visually consistent with the existing Slack catalog (cosmos palette, same `MessageRow`/`Notice` visuals) — exact styling to be specified by the designer step. |

## Edge Cases & Constraints

- **Thread fetch fails / network error** → inline error or `Notice` under the parent, retryable on
  re-click; the rest of the surface stays interactive (FR-009/FR-010).
- **Zero replies** → no affordance shown; if `replyCount > 0` but the read returns an empty reply
  list (e.g. all replies deleted), show a benign "no replies" inline state rather than an error.
- **Reply-button re-click / collapse** → toggles expand↔collapse; while a fetch is in flight a
  re-click does not start a second fetch (FR-006).
- **Not connected** → not-connected inline message; no token, no crash (FR-011).
- **MessageRow without channel context** → falls back to today's non-interactive label (FR-013) —
  the agent surface must carry the parent's `channelId`/`threadTs` for the affordance to be live.
- **Restore after restart** → session restore re-renders the composed surface spec verbatim; threads
  come back **collapsed** and re-fetch on click. This is acceptable and intentional (FR-016).
- **Out of scope**: pagination/"load more" of long reply chains beyond the first page is OPTIONAL
  for v1 (the native panel paginates; the generated catalog MAY show the first page only and defer
  paging) — see Open Questions. Posting/editing/reacting to replies is out of scope (read-only).
  Real-time thread updates are out of scope.

## Success Criteria

| ID     | Criterion                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| SC-001 | On a composed Slack surface, clicking "N replies" on a thread reveals that thread's replies nested under the parent, using the same `MessageRow`. |
| SC-002 | No replies are fetched until the user clicks; a freshly composed surface performs zero reply reads.           |
| SC-003 | A reply read failure renders an inline message and never crashes/white-screens/hangs the surface; re-click retries. |
| SC-004 | Re-clicking collapses, and a further click re-expands, an already-loaded thread.                              |
| SC-005 | No Slack write is performed and no token/secret appears in any payload or surface introduced by this feature. |
| SC-006 | A `replyCount` of 0/absent shows no affordance; a `MessageRow` missing channel context degrades to the static label without error. |

---

## Open Questions

- [ ] **Reply pagination (v1 scope).** The native panel paginates replies via the `nextCursor`
  "Load more" control. For the generated catalog, is first-page-only acceptable for v1, or must the
  nested reply list also offer "Load more"? Default assumption pending confirmation:
  **first-page-only for v1**, paging deferred. (Does not block the core load-on-click behavior.)
