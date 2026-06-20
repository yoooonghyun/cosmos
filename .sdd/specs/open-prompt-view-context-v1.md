# Spec: Open Prompt View Context — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/open-prompt-view-context-v1.md

---

## Grounding

> Direct investigation performed for this spec (architect ran these — not handed in).

**codegraph_explore / codegraph_search**

- `PromptComposer promptComposerLogic submitDecision useGenerativePanelTabs submit agent.submit` — confirmed `useGenerativePanelTabs.submit()` (src/renderer/useGenerativePanelTabs.ts:433) is the single seam that calls `window.cosmos.agent.submit({ utterance, target })`; every panel destructures `submit` and passes `onSubmit={submit}` to `PromptComposer`.
- `JiraPanel detailIssueKey SlackPanel ... PromptComposer props` — confirmed `PromptComposerProps` (src/renderer/PromptComposer.tsx:60) is `{ onSubmit, placeholder, ariaLabel, collapsedAriaLabel?, busy? }` with one caller per panel; the composer is panel-agnostic today.
- Grep of each panel for selection state — confirmed the per-panel "current view" lives in: Jira `detail.detailIssueKey` (JiraPanel.tsx:238/353); Slack `nav.view` (`{ kind:'history'; channel: SlackChannel }`, SlackPanel.tsx:243) + `nav.openThread` (`channelId`+`threadTs`); Confluence `view` (`{ kind:'page'; pageId; title }`, ConfluencePanel.tsx:107) + `genUiPage` (`{ pageId; title }`); Calendar `genUiEvent` (`EventChipData` with `id`, GoogleCalendarPanel.tsx:391).

**Reads (on-disk truth)**

- `src/shared/ipc/agent.ts` — `AgentSubmitPayload` today carries ONLY `utterance` + optional `target`; both annotated "NO secret".
- `src/shared/ipc/agent.validate.ts` — `validateAgentPrompt` validates at the boundary, returns `null` to warn-and-ignore.
- `src/main/agentRunner.ts` — `run(utterance, target)` appends `groundingPromptForTarget(target)` via `--append-system-prompt`; this is the per-run grounding seam.
- `src/main/mcpConfig.ts` — **key nuance:** `JIRA_TOOL_GRANTS` ALREADY includes write tools (`TransitionIssue`, `AddComment`, `CreateIssue`, `UpdateIssue`); Slack/Confluence/Calendar grants are READ-ONLY. So a "fix this ticket" run could already mutate Jira; "send this message" cannot send Slack today.
- `src/main/index.ts:1012` — `AgentChannel.Submit` handler validates then calls `agentRunner.run(payload.utterance, payload.target)`.
- `docs/ARCHITECTURE.md` §4.10 — the AgentRunner / least-privilege / grounding contract this feature extends.

**memory_recall / memory_smart_search**

- "Open Prompt composer utterance agent submit view context grounding" → no prior results (clean slate; no superseded decision).
- "agent run read-only least-privilege grounding per-target" → no prior results.
- Persisted the v1 context-only scoping decision via `memory_save` (mem id `mem_mqmguhvv_b015d5878d70`).

---

## Overview

When the user sends an utterance from the Open Prompt composer, the headless run today
receives ONLY the literal text plus a panel `target`. Deictic utterances — "fix **this**
ticket", "send to **this** message's channel", "summarize **this** page", "what's on
**this** event" — have no referent, so the agent cannot know which ticket / channel /
thread / page / event the user is looking at. This feature provides the **current view
context** of the active panel alongside the utterance, so the agent resolves "this"
against what the user actually has on screen.

This is a **context-provision** feature: it makes existing runs better-grounded. It does
NOT change what tools a run may call (see Edge Cases — write enablement is out of scope).

## User Scenarios

### Resolve "this ticket" against the open Jira detail · P1

**As a** user viewing a Jira issue's detail dock
**I want to** type "fix this ticket" (or "add a comment saying I'm on it") without naming the issue key
**So that** the agent acts on the issue I'm looking at, not a guessed or fabricated one

**Acceptance criteria:**

- Given the Jira detail dock is open on `PROJ-123`, when I send "summarize this ticket", then the run receives `PROJ-123` as its in-view issue and composes/acts against it.
- Given no Jira issue detail is open (list view only), when I send an utterance, then no `selectedIssueKey` is supplied and the run behaves exactly as today.
- Given the supplied issue key is the one on screen, then the agent never has to fabricate or re-derive which ticket "this" means.

### Resolve "this channel / this thread" against the open Slack view · P1

**As a** user viewing a Slack channel (and optionally an open thread dock)
**I want to** type "summarize this channel" or "what's the status of this thread"
**So that** the agent reads the channel/thread I'm viewing rather than asking which one

**Acceptance criteria:**

- Given I'm viewing `#general` (`view.kind === 'history'`), when I send "summarize this channel", then the run receives that channel id as its in-view channel.
- Given a thread dock is open, when I send "what was decided in this thread", then the run receives both the channel id and the thread `threadTs`.
- Given I'm on the channel-list view (`view.kind === 'channels'`) with no channel open, then no channel id is supplied and behaviour is unchanged.

### Resolve "this page" against the open Confluence page · P2

**As a** user viewing a Confluence page detail
**I want to** type "summarize this page"
**So that** the agent fetches and works with the page I'm reading

**Acceptance criteria:**

- Given a page detail is open (`view.kind === 'page'` or the `genUiPage` overlay), when I send "summarize this page", then the run receives that `pageId` (and title) as its in-view page.
- Given I'm on the search/list view with no page open, then no page id is supplied.

### Resolve "this event" against the open Calendar event · P2

**As a** user with a calendar event's gen-UI detail open
**I want to** type "what's this meeting about"
**So that** the agent works with the event I have selected

**Acceptance criteria:**

- Given a `genUiEvent` is selected, when I send an utterance, then the run receives that event id as its in-view event.
- Given no event is selected, then no event id is supplied.

### Clean utterance, transparent context · P1

**As a** user
**I want to** my literal typed text to remain exactly what I typed
**So that** context provision never corrupts my words or leaks identifiers into my message

**Acceptance criteria:**

- Given any utterance, when it is submitted, then the user's literal `utterance` string is unchanged — context is delivered to the model out-of-band (grounding), not concatenated into the utterance.
- Given a view context is supplied, then it carries ONLY non-secret identifiers/labels the panel already displays — never a token, OAuth secret, or credential.

### No regression when nothing is selected · P1

**As a** user
**I want to** the composer to work exactly as today when there is nothing in view
**So that** the feature is purely additive

**Acceptance criteria:**

- Given a panel with no current selection, when I submit, then the payload carries no `viewContext` (or an empty one) and the run is byte-for-byte equivalent to today's behaviour.
- Given a malformed/invalid `viewContext` reaches main, then it is warned and ignored — the run still starts with the valid `utterance`/`target` (never crashes, never drops the run).

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The `agent:submit` IPC payload MUST carry an OPTIONAL, additive `viewContext` object describing the active panel's current view. Absence MUST be equivalent to today's behaviour (backward compatible). |
| FR-002 | `viewContext` MUST be data-only and carry ONLY non-secret identifiers/labels the renderer already legitimately displays. It MUST NEVER carry a token, OAuth secret, credential, or raw transcript. |
| FR-003 | `viewContext` MUST be a discriminated/structured shape keyed by panel target, exposing at most: Jira → `selectedIssueKey?`; Slack → `selectedChannelId?`, `selectedChannelName?`, `threadTs?`; Confluence → `selectedPageId?`, `selectedPageTitle?`; Google Calendar → `selectedEventId?`. The generated-ui target carries no panel-specific selection. No field beyond what a panel already holds in state. |
| FR-004 | Each panel MUST derive `viewContext` from the view state it ALREADY owns (Jira `detailIssueKey`; Slack `view.channel.id` + `openThread.threadTs`; Confluence `view.pageId`/`genUiPage.pageId` + title; Calendar `genUiEvent.id`). No new fetches, no new selection tracking beyond reading existing state. |
| FR-005 | When the active panel has NO current selection, the panel MUST submit with `viewContext` absent (or with no populated selection fields) — never a fabricated/placeholder selection. |
| FR-006 | The main-process boundary MUST validate `viewContext` (warn-and-ignore on invalid per the established validator convention): an invalid `viewContext` is dropped while the run STILL starts with the valid `utterance`/`target`. Invalid input MUST never crash or block the run. |
| FR-007 | A supplied, valid `viewContext` MUST be threaded into the run as MODEL-VISIBLE GROUNDING (e.g. appended to the per-target grounding system prompt), NOT concatenated into the user's `utterance`. The literal utterance string the run receives MUST be unchanged from what the user typed. |
| FR-008 | The grounding text derived from `viewContext` MUST instruct the model that these identifiers are "what the user is currently viewing", so deictic terms ("this ticket/channel/thread/page/event") resolve to them. It MUST only describe IDs the model can fetch with its existing read tools; it MUST NOT instruct the model to perform actions it lacks tools for. |
| FR-009 | The feature MUST NOT broaden the tool grants of any run (`allowedToolForTarget` / `renderMcpConfigJsonForTarget` unchanged). Whatever a target could do before, it can do after — only its grounding gets richer. |
| FR-010 | The view-context capture logic (mapping panel state → the typed `viewContext`) and the grounding-text builder (typed `viewContext` → grounding string) MUST be pure, framework-free `.ts` modules, node-testable per the `.ts`/`.test.ts` split. |
| FR-011 | Context capture MUST be best-effort and non-blocking: if a panel cannot determine its selection, submit proceeds WITHOUT `viewContext` (FR-005). Capturing context MUST never throw or delay the existing submit path. |

## Edge Cases & Constraints

- **Selection changes between expand and send.** The composer can be open while the user clicks around. The `viewContext` MUST be captured at SEND time (read live panel state in the submit handler), so it reflects what is on screen when Enter is pressed, not when the composer was opened.
- **Multiple tabs.** Per-tab nav state means the "current view" is the ACTIVE tab's view. `viewContext` MUST be derived from the active tab's state (the same state the panel already reads for rendering).
- **Stale/closed selection.** If the in-view item was closed before send (e.g. detail dock dismissed), the panel supplies no selection (FR-005) — never a dangling id.
- **Untrusted identifiers.** Identifiers originate in the renderer; main MUST treat them as untrusted input and validate shape/type (FR-006). They are non-secret labels, so passing them to the model is safe, but the validator still guards against malformed payloads.
- **OUT OF SCOPE — write enablement.** The user's examples ("수정해줘"/"전송해줘") imply WRITE actions. This feature is **context-only**. Note the asymmetry that exists TODAY (independent of this feature): the `'jira'` target ALREADY grants `cosmos-jira` write tools (transition/comment/create/update), so a "fix this ticket" run can already mutate Jira; the `'slack'`/`'confluence'`/`'google-calendar'` targets are READ-ONLY, so "send this message" / write-to-Slack is NOT possible regardless of context. This spec does NOT add or remove any write grant. Enabling Slack send (or any new write scope) is a SEPARATE follow-up feature with its own scope, confirmation UX, and least-privilege review. See Open Questions.
- **OUT OF SCOPE — visible "context chip" affordance.** Whether the composer should SHOW the user which item it will scope to (a chip like "↳ PROJ-123") is a design concern, not required for the contract to work. Flagged as an open question; default v1 ships no visible chip (context is invisible plumbing).
- **No persistence.** `viewContext` is computed per-submit and not persisted; it is not part of any session snapshot.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | With a Jira issue detail open, an utterance "summarize this ticket" produces a run whose grounding names that exact issue key; the rendered surface/action targets it (no fabricated key). |
| SC-002 | With a Slack channel (and optionally a thread) open, "summarize this channel/thread" produces a run whose grounding names that channel id (and threadTs when a thread is open). |
| SC-003 | The user's literal utterance string delivered to the run is byte-for-byte what they typed — verified by inspecting the `-p` argument (no identifiers spliced in). |
| SC-004 | No `viewContext` payload, bridge frame, or grounding string ever contains a token, OAuth secret, or credential. |
| SC-005 | A submit with NO selection, or with a malformed `viewContext`, still starts a run with the valid utterance/target and behaves exactly as the pre-feature baseline (warn-and-ignore; no crash). |
| SC-006 | Tool grants per target are identical before and after the feature (`allowedToolForTarget` output unchanged) — confirmed by the existing grants test still passing unmodified. |
| SC-007 | The context-capture and grounding-builder logic are covered by node tests (happy path, each panel's populated case, missing-selection case, invalid-input warn-and-ignore). |

---

## Open Questions

- [ ] **OQ-1 (write enablement follow-up).** Should a separate follow-up enable write actions where they're absent (notably Slack send) so utterances like "send this to the channel" are actionable end-to-end? This is explicitly OUT OF SCOPE here; recommend tracking as its own spec with confirmation UX + scope review. Default: do NOT enable in v1.
- [ ] **OQ-2 (visible context chip).** Should the composer display a chip indicating the in-view item it will scope to ("↳ PROJ-123" / "↳ #general")? If yes, this adds a UI-bearing surface and would warrant a `design` step. Default v1: NO visible chip (context is invisible plumbing); revisit if users find the scoping non-obvious.
- [ ] **OQ-3 (generated-ui target).** The generic Generated-UI panel has no integration selection of its own. Should it carry any view context (e.g. the active tab's last composed surface descriptor)? Default v1: NO — generated-ui submits without `viewContext`. Revisit only if a concrete deictic use case emerges.
