# Spec: Slack Send Message (text-only) — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/slack-send-message-v1.md

---

## Grounding

> Investigated directly via codegraph + agentmemory before authoring (CLAUDE.md SDD rule).

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `slackClient slackAdapter chat.postMessage Slack scopes oauthPkce token safeStorage` —
  `SlackClient` (`src/main/integrations/slackClient.ts`) is **read-only**: its private `call()`
  issues **GET only**, all methods are reads (`listChannels`/`getHistory`/`getReplies`/`search`/
  `getUser`). There is no POST path, no `chat.postMessage`. Adding a write means a new POST-capable
  client method, the FIRST write on Slack.
- `SlackApi getReplies SlackRepliesParams ipc.ts Slack scopes connect oauth reconnect SlackManager
  postMessage` — `SlackManager` (`src/main/slackManager.ts`) threads every read through `run()` →
  `ensureToken()`, attaches the token via `auth(tokens)` (`{ token: tokens.accessToken }`), and flips
  to `reconnect_needed` when the client returns that kind. `currentAuth()` loads the token in main and
  is explicitly **never** an IPC method (token never leaves main). No write method exists today.
- `src/shared/ipc/slack.ts` + `slack.validate.ts` — the Slack IPC barrel exposes `SlackChannelName`
  (all reads + `StatusChanged`) and `SlackApi`; every read returns `SlackResult<T>`; **no channel
  carries the token** (FR-006/SC-008). Boundary validators warn + return `null` on invalid payloads.
- `src/shared/slack.ts` — `SlackConnectionStatus { state, workspaceName?, teamId?, canSearch? }`,
  `SlackResult<T> = SlackOk<T> | SlackError`, `SlackErrorKind = not_connected | reconnect_needed |
  search_unavailable | rate_limited | network`. `canSearch?` is the existing **per-scope capability
  flag** on the status — the precedent for advertising a granted scope to the renderer.
- `src/main/integrations/slackConfig.ts` — `SLACK_USER_OAUTH_SCOPES` is **read-only** (`channels:read`,
  `channels:history`, `users:read`, `search:read`, `emoji:read`, `files:read`); comment says "no write
  scope is ever requested." `SLACK_SEARCH_SCOPE = 'search:read'` is the per-scope capability constant.
- `jiraManager.ts` write path — the canonical write+scope pattern in this app: `JIRA_WRITE_SCOPE`,
  `getWriteCapability()` reads `StoredTokenSet.scopes`, and each write **short-circuits to a structured
  `write_not_authorized` result (no client call)** when the scope is absent. Confluence mirrors it. This
  is the model to follow for `chat:write` + a `write_not_authorized` Slack kind.
- `SlackPanel.tsx` — the panel has a **channel-history view** (`MessageList` for `view.kind==='history'`)
  and a **right-docked thread region** (`SlackThreadPanel`, thread-sidepanel v1) opened from any row's
  "N replies" / `onOpenThread`. The thread dock already owns `channelId` + `threadTs` (the parent's
  coordinates) and calls `getReplies`. These are the two natural composer homes.

**memory_recall / memory_smart_search queries run:**

- `Slack integration scopes OAuth read-only token main process write capability` — empty recall (no
  prior records for this feature area). No superseded decisions to honor; grounding is from codegraph
  + ARCHITECTURE §4.7/§4.8.

> Settled decisions persisted to agentmemory (see `memory_save` at end): Slack `chat:write` follows
> the Jira write-scope + `write_not_authorized` short-circuit pattern; the channel composer lives in
> the history view and the reply composer in the thread dock; send is a new request/response IPC
> channel (not a read), token stays main-only.

---

## Overview

Let the user send a **plain-text** Slack message from the cosmos Slack panel — to a public channel
(from the channel-history view) and as a **reply** to a thread (from the right-docked thread panel).
This is the **first write capability** on the Slack integration, which has been strictly read-only.
v1 is intentionally minimal: text only, no attachments/blocks, no edit/delete/reactions, no emoji
picker.

## User Scenarios

> Each scenario is independently testable. P1 (must) / P2 (should) / P3 (nice to have).

### Send a message to a channel · P1

**As a** cosmos user reading a channel's history in the Slack panel
**I want to** type a plain-text message and send it to that channel
**So that** I can reply in Slack without leaving cosmos

**Acceptance criteria:**

- Given I am viewing a channel's history and Slack is connected with `chat:write` granted, when I
  type non-empty text into the channel composer and submit, then the message is posted to that
  channel and appears in the history view.
- Given the composer, when the text is empty or whitespace-only, then the send control is disabled
  (or the submit is a no-op) and no IPC send is issued.
- Given I have submitted a send, when the post is in flight, then the composer reflects a sending
  state and a second concurrent submit of the same text is prevented.
- Given a successful send, when it confirms, then the composer clears and is ready for the next
  message.

### Reply to a thread · P1

**As a** user with a thread open in the right-docked thread panel
**I want to** type a plain-text reply and send it into that thread
**So that** I can continue the conversation in the thread

**Acceptance criteria:**

- Given the thread dock is open (it owns `channelId` + the parent `threadTs`) and `chat:write` is
  granted, when I submit non-empty text in the thread composer, then the reply is posted into that
  thread (carrying `thread_ts`) and appears under the thread's replies.
- Given the thread composer, the same empty-text, in-flight, clear-on-success, and no-double-send
  rules as the channel composer apply.

### Reconnect to grant write scope · P1

**As a** user whose Slack connection predates this feature (read-only scopes only)
**I want to** be told write requires reconnecting and be given a one-click way to do it
**So that** I can opt in to sending without a confusing hard failure

**Acceptance criteria:**

- Given Slack is connected but the stored token lacks `chat:write`, when I view a composer, then the
  composer surfaces a **Reconnect** affordance (consistent with the panel's existing reconnect
  banner) explaining that sending requires reconnecting once, instead of an enabled-but-failing send.
- Given I click Reconnect, when I complete the OAuth consent (now requesting `chat:write`), then on
  return the composer becomes send-capable without any further configuration.
- Given a user who reconnects, when the new token is stored, then no token or secret is ever exposed
  to the renderer — only the capability flag (granted/not) crosses the boundary.

### Send fails gracefully · P1

**As a** user sending when something goes wrong (not connected, scope missing, network/Slack error)
**I want** a clear, non-alarming inline message and my text preserved
**So that** I can retry without losing what I typed

**Acceptance criteria:**

- Given Slack is not connected, when I attempt a send, then I get a not-connected inline message
  consistent with the read tools' posture; no crash.
- Given the token lacks `chat:write`, when a send is somehow attempted, then main returns a
  structured not-authorized result and the composer shows the Reconnect affordance; no crash, no
  silent drop.
- Given a network error, a Slack API error, a rate-limit (429), or a rejected token
  (`reconnect_needed`), when the send fails, then an inline, non-alarming error is shown, the typed
  text is **preserved**, and the send is **retryable**; the rest of the panel stays interactive.

### Read-only posture for everyone else preserved · P1

**As a** security-conscious operator
**I want** this write capability gated behind an explicit scope and confined to main
**So that** the token never leaks and read-only connections are unaffected

**Acceptance criteria:**

- Given any send, when the payload crosses any process boundary (IPC request, result, bridge frame,
  MCP result, DOM), then it carries **no** Slack token or secret.
- Given the Slack generative A2UI surface and MCP tools, when this feature ships, then **they remain
  read-only** — no send tool, no write op is added to the agent/MCP surface (the composer is a native
  panel control only).

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Each traces to a scenario/grounding.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The Slack panel MUST provide a **plain-text** message composer in the channel-history view that sends to the currently-viewed channel. |
| FR-002 | The Slack panel MUST provide a **plain-text** reply composer in the right-docked thread panel that sends into the open thread (carrying the parent `thread_ts`). |
| FR-003 | A send MUST be issued only for **non-empty, non-whitespace** text; an empty/whitespace composer MUST disable the send control (or no-op) and issue no IPC send. |
| FR-004 | The send MUST go over a **new dedicated request/response IPC channel** in the Slack IPC barrel (`src/shared/ipc/slack.ts`), distinct from the read channels; its request carries `{ channelId, text, threadTs? }` and resolves a `SlackResult<{ ts }>` (success carries the posted message `ts`). |
| FR-005 | The send IPC payload MUST be **validated at the main-process boundary**: a non-object payload, an empty `channelId`, or empty/whitespace `text` is warned and ignored (returns a structured failure / null per the barrel's convention) — never a crash. |
| FR-006 | The send MUST be performed in **main** via a `chat.postMessage` POST in the Slack client; main attaches the token. The token MUST NOT appear in the IPC request, the result, any bridge frame, any MCP result, or the DOM. |
| FR-007 | Sending MUST require the Slack **`chat:write`** user scope; the read-only scope set MUST be extended to request it at connect/reconnect time. |
| FR-008 | The stored-token write capability MUST be derived from the persisted `StoredTokenSet.scopes` (the Jira/Confluence pattern); when `chat:write` is absent the manager MUST short-circuit a send to a structured **not-authorized** result **without** calling the Slack API. |
| FR-009 | `SlackConnectionStatus` MUST advertise whether sending is permitted via a non-secret capability flag (mirroring `canSearch`), so the renderer can decide composer state without attempting a send. |
| FR-010 | When the connection lacks `chat:write`, each composer MUST surface a **Reconnect** affordance (consistent with the existing reconnect banner) explaining sending needs a one-time reconnect, instead of an enabled-but-failing send. |
| FR-011 | A reconnect MUST re-run the existing OAuth flow with the extended scope set; on success the composer MUST become send-capable with no further user configuration. |
| FR-012 | While a send is in flight, the composer MUST show a sending state and MUST prevent a second concurrent submit of the same content. |
| FR-013 | On a successful send, the composer MUST clear; the just-sent message SHOULD become visible (via refresh/re-read of the relevant view — exact mechanism left to the plan). |
| FR-014 | A failed send (not_connected, not-authorized, network, rate_limited, reconnect_needed, Slack API error) MUST surface an **inline, non-alarming** error, **preserve the typed text**, and be **retryable**; never a crash, white-screen, or hung composer. |
| FR-015 | A `reconnect_needed` send result MUST flip the connection state to `reconnect_needed` (same discipline as reads via `run()`) so both composer and panel reflect the rejected token. |
| FR-016 | This feature MUST NOT add any Slack write capability to the **MCP tool surface** or the **generative A2UI surface**; those remain strictly read-only (no send tool, no write op). |
| FR-017 | v1 MUST be **text-only**: no attachments, no Block Kit / rich blocks, no message edit/delete, no reactions, no emoji picker, no scheduled send. (Out of scope, see below.) |
| FR-018 | The composer and any inline error/notice MUST be visually consistent with the existing Slack panel (cosmos palette, existing alert/banner visuals) — exact styling specified by the designer step. |

## Edge Cases & Constraints

- **Empty / whitespace text** → send disabled or no-op; no IPC issued (FR-003).
- **Not connected at send time** → not-connected inline message; no token, no crash (FR-014).
- **Connected but missing `chat:write`** → composer shows Reconnect affordance up front (FR-010);
  if a send is still attempted, main short-circuits to not-authorized (FR-008) and the composer
  shows Reconnect — never a hard crash.
- **Network / Slack API error / rate-limit (429)** → inline error, text preserved, retryable; honor
  the read tools' rate-limit posture (FR-014).
- **Token rejected mid-send (`reconnect_needed`)** → flip connection state, show reconnect (FR-015).
- **In-flight double submit** → prevented (FR-012).
- **Thread vs channel target** → the same send channel handles both; a present `threadTs` makes it a
  thread reply, absent makes it a channel message. The thread dock already owns `channelId` +
  `threadTs`; the channel composer uses the viewed channel's id with no `threadTs`.
- **Optimistic vs confirmed render** → v1 renders the sent message **on confirmation** (after the
  successful result), not optimistically, to avoid showing un-acknowledged sends and to keep the
  read DTOs the single source of truth. (See Open Questions; sensible default chosen.)
- **Generative surface / MCP** → unchanged; no send op exposed there (FR-016).
- **Explicitly out of scope (v1):** attachments/files, Block Kit / rich formatting, message
  edit/delete, reactions/emoji picker, scheduled or recurring sends, DMs/private channels beyond
  what the existing read scopes already surface, mention autocomplete, draft persistence across
  app restart.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | With `chat:write` granted, submitting non-empty text in the channel composer posts to that channel and the message becomes visible in the history view. |
| SC-002 | With `chat:write` granted, submitting non-empty text in the thread composer posts a reply (with `thread_ts`) and it becomes visible in the thread dock. |
| SC-003 | A connection lacking `chat:write` shows a Reconnect affordance on both composers and never attempts an enabled-but-failing send; reconnecting makes sending work with no further config. |
| SC-004 | Empty/whitespace text never issues a send; an in-flight send blocks a duplicate concurrent submit. |
| SC-005 | Every send failure (not_connected / not-authorized / network / rate_limited / reconnect_needed / API error) shows an inline non-alarming message, preserves the typed text, is retryable, and never crashes the panel. |
| SC-006 | No Slack token or secret appears in any IPC request/result, bridge frame, MCP result, or DOM introduced by this feature. |
| SC-007 | The Slack MCP tools and the generative A2UI surface remain read-only — no send/write op is added there. |

---

## Open Questions

- [ ] **Confirmed vs optimistic render (default chosen).** v1 renders the sent message on
  confirmation (after a successful result), re-reading the relevant view rather than optimistically
  appending. Default assumption pending confirmation: **confirmed render for v1**; optimistic UI
  deferred. (Does not block the core send behavior.)
- [ ] **Post-send visibility mechanism (plan-level, non-blocking).** Whether the just-sent message
  appears via a targeted re-read of the current page, an in-place append of the returned message, or
  a full view refresh is an implementation choice for the plan; all satisfy FR-013. Recorded here so
  the behavior (message becomes visible) is the contract, not the mechanism.
