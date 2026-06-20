# Plan: Slack Send Message (text-only) — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/slack-send-message-v1.md

---

## Grounding

> Same direct codegraph + agentmemory investigation as the spec — see the spec's Grounding
> section for the exact queries and takeaways. Plan-relevant facts:

- `SlackClient.call()` is **GET-only** (`src/main/integrations/slackClient.ts`); a new POST-capable
  method (`postMessage`) is needed — the first write on the Slack client.
- `SlackManager.run()` → `ensureToken()` → `auth(tokens)` is the token-attach + `reconnect_needed`
  discipline every read uses; a send reuses it. `currentAuth()` proves the token is loaded in main
  and never IPC-exposed.
- The **Jira/Confluence write pattern** is the model: `JIRA_WRITE_SCOPE`, `getWriteCapability()`
  reading `StoredTokenSet.scopes`, and a structured `write_not_authorized` short-circuit (no client
  call). Replicate as `SLACK_WRITE_SCOPE = 'chat:write'` + a Slack not-authorized kind.
- `SlackConnectionStatus.canSearch?` is the precedent for a non-secret capability flag → add an
  analogous `canSend?` (or `canWrite?`).
- IPC barrel (`src/shared/ipc/slack.ts` + `slack.validate.ts`): all-reads today; add ONE send
  channel + its boundary validator following the existing `validateSlack*` shape.
- `SlackPanel.tsx`: channel-history `MessageList` view (composer home #1) and the right-docked
  `SlackThreadPanel` which already owns `channelId` + `threadTs` (composer home #2).

## Summary

Add the first Slack write — a plain-text `chat.postMessage` send — exposed as ONE new
request/response IPC channel in the Slack IPC barrel and performed entirely in main. The send is
gated behind a new `chat:write` user scope, following the established Jira/Confluence write-scope +
`write_not_authorized` short-circuit pattern: the manager reads the granted scopes from the stored
token and refuses (without an API call) when `chat:write` is absent, surfacing a Reconnect
affordance in the renderer. Two native composers — one in the channel-history view, one in the
right-docked thread panel — submit `{ channelId, text, threadTs? }`; main attaches the token, posts,
and resolves a `SlackResult<{ ts }>`. The token never leaves main; the MCP and generative A2UI
surfaces stay read-only. **UI-bearing: a designer step (design skill → `.sdd/designs/`) follows this
plan before interface/implementation** to spec the composer + Reconnect-affordance visuals.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload + React renderer) |
| Key dependencies  | Slack Web API `chat.postMessage`; existing `SlackClient`/`SlackManager`/`SlackBridge`; existing OAuth PKCE flow (`oauthPkce.ts`); `safeStorage`-backed token store |
| Files to create   | `.sdd/designs/slack-send-message-v1.md` (designer step, before impl) |
| Files to modify   | `src/main/integrations/slackConfig.ts` (add `chat:write` to scopes + `SLACK_WRITE_SCOPE`); `src/main/integrations/slackClient.ts` (POST-capable `postMessage`); `src/main/slackManager.ts` (`getSendCapability()` + `sendMessage()` short-circuit + `canSend` on status); `src/shared/slack.ts` (`SlackSendParams`, send result data, `write_not_authorized` kind or reuse, `canSend?` on status, send op/tool constants if bridged — but NOT exposed); `src/shared/ipc/slack.ts` (`SlackChannelName.Send` + `SlackApi.sendMessage`); `src/shared/ipc/slack.validate.ts` (`validateSlackSend`); `src/preload/index.ts` (`sendMessage` bridge method — **requires full `npm run dev` restart**); `src/main/index.ts` (register the send `ipcMain.handle`); `src/renderer/SlackPanel.tsx` (channel composer + thread composer + Reconnect affordance wiring); `docs/ARCHITECTURE.md` (§4.8 — Slack gains its first write) |

### Design decisions (resolved)

- **IPC request/response shape (new channel, R→M invoke):**
  `SlackChannelName.Send = 'slack:sendMessage'`; `SlackApi.sendMessage(params: SlackSendParams):
  Promise<SlackResult<SlackSendResult>>` where
  `SlackSendParams = { channelId: string; text: string; threadTs?: string }` and
  `SlackSendResult = { ts: string }` (the posted message `ts`). A present `threadTs` ⇒ thread reply
  (`thread_ts`), absent ⇒ channel message. NO token in either direction (mirrors every read channel).
- **Boundary validation (`validateSlackSend`):** require object, non-empty `channelId`, non-empty
  (post-trim) `text`; optional `threadTs` string when present. Invalid → warn + `null`, exactly like
  `validateSlackReplies`.
- **Scope + reconnect:** add `'chat:write'` to `SLACK_USER_OAUTH_SCOPES` and export
  `SLACK_WRITE_SCOPE = 'chat:write'`. `SlackManager.getSendCapability()` = `scopes.includes(SLACK_WRITE_SCOPE)`
  read from the stored token (Jira parity). `sendMessage()` short-circuits to a structured
  not-authorized result (no API call) when absent. `getStatus()` sets `canSend` from the same check
  so the renderer gates composer state without a probe send. Reconnect reuses the existing
  `connect()` OAuth flow (now requesting the wider scope set).
- **Not-authorized result kind:** prefer a dedicated `SlackErrorKind` member (e.g.
  `'write_not_authorized'`) on `SlackResult` so the renderer can branch to the Reconnect affordance
  distinctly from `not_connected`/`network` — confirm naming in interface phase. (Jira uses a
  `write_not_authorized` kind; match it for cross-integration consistency.)
- **Composer placement:** channel composer docked at the **bottom of the channel-history view**
  (the `view.kind==='history'` `MessageList`); reply composer docked at the **bottom of
  `SlackThreadPanel`** (it already holds `channelId` + `threadTs`). Both are native-panel controls
  only — NOT added to the generative catalog or MCP surface.
- **Confirmed render:** on success, re-read the relevant view (history / thread replies) so the sent
  message appears via the existing read DTOs; no optimistic append in v1 (spec OQ default).
- **Read-only surfaces preserved:** no new MCP tool, no bridge send op exposed to the agent, no
  catalog control. The send is renderer→main native IPC exclusively.

---

## Implementation Checklist

> A **designer step precedes Phase 1**: produce `.sdd/designs/slack-send-message-v1.md` (composer
> layout in channel view + thread dock, sending/disabled/error states, Reconnect affordance) before
> building the React surface. Build wiring / shadcn installs (if any) done by the developer session.

### Phase 0 — Design (designer agent)

- [ ] Author `.sdd/designs/slack-send-message-v1.md`: channel + thread composer visuals, send/disabled/
      in-flight/error states, and the Reconnect affordance (consistent with the existing reconnect banner).

### Phase 1 — Interface

- [ ] Read spec; confirm Open Questions defaults (confirmed render; post-send visibility) still hold.
- [ ] `src/shared/slack.ts`: add `SlackSendParams`, `SlackSendResult`, `canSend?` on
      `SlackConnectionStatus`, and the `write_not_authorized` `SlackErrorKind` (+ not-authorized message
      constant). No invented fields beyond spec.
- [ ] `src/shared/ipc/slack.ts`: add `SlackChannelName.Send` + `SlackApi.sendMessage`.
- [ ] `src/main/integrations/slackConfig.ts`: add `'chat:write'` to `SLACK_USER_OAUTH_SCOPES`; export
      `SLACK_WRITE_SCOPE`.
- [ ] Review types vs spec — no token field anywhere; no scope creep into attachments/edit/blocks.

### Phase 2 — Testing

- [ ] `validateSlackSend`: happy path; missing/empty `channelId`; empty/whitespace `text`; optional
      `threadTs` present/absent; non-object payload → null.
- [ ] `SlackManager.sendMessage`: not-connected short-circuit; `write_not_authorized` short-circuit when
      scopes lack `chat:write` (asserts NO client call); happy path posts with/without `thread_ts`;
      `reconnect_needed` flips state; network/API error mapped to a graceful result.
- [ ] `SlackManager.getStatus`: `canSend` true/false from stored scopes.
- [ ] `SlackClient.postMessage`: issues a POST to `chat.postMessage` with token attached; maps Slack
      `ok:false`/HTTP errors via `mapSlackError`; returns the posted `ts` on success.

### Phase 3 — Implementation

- [ ] `src/main/integrations/slackClient.ts`: add `postMessage(auth, channelId, text, threadTs?)` — a
      POST (the client's first non-GET path; factor a small POST helper rather than overloading `call()`
      if cleaner). Read-only methods untouched.
- [ ] `src/main/slackManager.ts`: `getSendCapability()`; `sendMessage(params)` with scope short-circuit +
      `run()` discipline; `canSend` in `getStatus()`.
- [ ] `src/shared/ipc/slack.validate.ts`: `validateSlackSend`.
- [ ] `src/main/index.ts`: register the `slack:sendMessage` `ipcMain.handle`, validating via
      `validateSlackSend` and delegating to the manager.
- [ ] `src/preload/index.ts`: expose `sendMessage` on `window.cosmos.slack` (**flag: full
      `npm run dev` restart required, not HMR**).
- [ ] `src/renderer/SlackPanel.tsx`: channel composer (history view) + reply composer (thread dock),
      both gated on `canSend`; Reconnect affordance when `!canSend`; in-flight/disabled/error states;
      clear-on-success + confirmed re-read of the relevant view.
- [ ] All tests pass; reuse `mapSlackError`, `run()`, and existing reconnect banner — no duplicated logic.

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md` §4.8: note Slack gains its **first write** (`chat:write`, native composer
      only); the MCP + generative A2UI surfaces remain read-only; cross-reference the Jira write-scope
      pattern. Reconcile the "Slack remains read-only" statements in §4.7/§4.8.
- [ ] Check off the matching `TODO.md` item (#83); record any deviations below.
- [ ] `memory_save` any non-obvious decision that emerged during implementation.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-20**: Plan authored. Open: final name of the not-authorized `SlackErrorKind` (default
  `write_not_authorized` for Jira parity) and the capability-flag name (`canSend` vs `canWrite`) —
  pinned in interface phase. Neither blocks build.
