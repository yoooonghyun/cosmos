# Spec: Cosmos Conversation Panel — v2 (Step 3: full conversation timeline from the transcript)

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: extends `.sdd/specs/cosmos-conversation-panel-v1.md` (step 1 rail swap + step 2
persistent session are SHIPPED; this v2 adds step 3 and supersedes v1's "no transcript / build the
timeline from the live `ui:render` stream only" data-source decision — a persistent transcript now
exists and is the timeline's source of truth).
**Related plan**: .sdd/plans/cosmos-conversation-panel-v2.md

---

## Grounding

> Direct investigation by the architect (codegraph + agentmemory + an actual on-disk transcript +
> docs). This section makes the grounding visible to the cycle.

**codegraph_explore queries run (verbatim source returned, treated as Read):**

- `AgentRunner agentSessionStore agentSessionQueue ui:render UiBridge useGenerativePanelTabs CosmosPanel railVisibility SessionSnapshot defaultSessionId resolveSandboxDir`
  → confirmed step 2 shipped: `AgentRunner` takes `defaultSessionId?`; for the default
  `'generated-ui'` target it spawns `claude -p --output-format json --session-id <persistedId>`
  (create-or-continue) so the conversation is CONTINUOUS and `claude` records a transcript jsonl.
- `resolveSandboxDir agentSessionStore AgentSessionStore selectDefaultSessionId decideSubmit isPersistentSessionTarget DEFAULT_UI_RENDER_TARGET pushRenderToRenderer renderPushedForRun`
  → `resolveSandboxDir()` = `join(app.getPath('userData'),'sandbox')` (the stable cwd); the persisted
  id lives at `<userData>/agent-session.json` (`AgentSessionStore`, plain JSON, atomic write);
  `DEFAULT_UI_RENDER_TARGET = 'generated-ui'`; `pushRenderToRenderer` sets `renderPushedForRun` when
  a `'generated-ui'` frame is pushed (drives `producedSurface`).
- `renderUiServer render_ui tool input spec UiRenderPayload UiBridge handleRender ui:render UiChannel UiRenderTarget DEFAULT_UI_RENDER_TARGET ui:action ui:dataModel`
  → the render path: `UiBridge.onMessage` mints a `requestId`, pushes `UiRenderPayload {requestId,
  spec, target, descriptor?, bindings?}` over `ui:render`; only `target === 'generated-ui'` keeps
  blocking to await the user's action (so the live in-flight surface still flows through `ui:render`
  exactly as today).
- `renderUiServer render_ui inputSchema spec A2uiSurfaceUpdate UiRenderPayload AgentStatusPayload AgentSubmitPayload UiChannel AgentChannel onRender onStatus preload window.cosmos.ui.onRender agent.onStatus`
  → the renderer-facing shapes: `UiRenderPayload` (ui.ts), `AgentStatusPayload {state, message?,
  producedSurface?}` + `AgentSubmitPayload {utterance, target?, viewContext?}` (agent.ts);
  `window.cosmos.ui.onRender` / `window.cosmos.agent.onStatus` / `window.cosmos.ui.onDataModel` are
  the existing renderer subscriptions the live in-flight surface uses.

**Actual transcript jsonl read on disk (to pin the format):**

- `~/.claude/projects/-Users-yonghyuncho-Workspace-cosmos/1efd6bd0-0468-4a82-9507-45abaf9d8cd6.jsonl`
  (a real session) — top-level lines for `permission-mode`, `file-history-snapshot`, a `user`
  message with a STRING `content` (`"hello?"`), `attachment` lines (deferred-tools / mcp-instructions
  / skill-listing — system noise), and an `assistant` message whose `content` is an array of
  `{type:"text",text}` blocks.
- `~/.claude/projects/-Users-yonghyuncho-Workspace-cosmos/2e893f35-….jsonl` — an `assistant` message
  whose `content` is an array containing a `{type:"tool_use", id:"toolu_…", name:"Agent", input:{…}}`
  block; a `user` message whose `content` is an array containing a `{type:"tool_result",
  tool_use_id:"toolu_…", content:[…]}` block; and a `queue-operation` line.
- The deferred-tools list in that transcript confirms the render tool's transcript name is
  **`mcp__cosmos-render-ui__render_ui`** (the standard-catalog `render_ui`); its
  `tool_use.input` is `{ spec: <A2UI surfaceUpdate> }`.
- NOTE: the cosmos sandbox transcript (`~/.claude/projects/<sandbox-hash>/<defaultSessionId>.jsonl`)
  did not yet exist on this machine (the persistent default session had not been exercised, or dev
  userData differs); the format above is pinned from real same-version cosmos-project transcripts,
  which share the exact line shape claude 2.1.x writes everywhere.

**memory_recall / memory_smart_search queries run:**

- `agent runner persistent session transcript jsonl conversation cosmos panel` → returned the v1
  "no persistent session / build from `ui:render` stream" decision AND the step-2 "persistent
  resumable session + transcript jsonl now recorded" decision. Takeaway: step 2 INVERTS v1's
  data-source premise — the timeline content now comes from the transcript, not only the live stream.
- Persisted this cycle's transcript-format + live-update + tab-model conclusions via `memory_save`.

**Files read directly:** `docs/ARCHITECTURE.md` §3, §4.3, §4.4, §4.5, §4.10, §4.11, §5/§5a (render
path, AgentRunner headless model, panel-tabs correlation); `src/shared/ipc/ui.ts`
(`UiRenderPayload`, `A2uiAction`, `UiApi`); `src/shared/ipc/agent.ts` (`AgentSubmitPayload`,
`AgentStatusPayload`); `src/main/agentSessionStore.ts`; `src/main/agentSessionQueue.ts`; the v1
spec + plan in full.

---

## Overview

Step 1 renamed the Generated-UI rail surface to **Cosmos**. Step 2 made the default Open-Prompt
agent a **persistent, resumable `claude` session** (one continuous conversation, id persisted at
`<userData>/agent-session.json`, cwd `<userData>/sandbox`) — so `claude` now records a **transcript
jsonl** that survives restart and grows with every submit.

**Step 3 (this spec)** turns the Cosmos panel into the **full conversation timeline of that default
session**, read from the transcript: the user's prompts, the assistant's text responses, the tool
calls the agent made (including each `render_ui` call), and the **generated A2UI surfaces** —
rendered inline and interactive — as one scrollable history that live-updates as new submits land
and persists across restart (because the transcript file does).

This realizes the user's original ask — "Open Prompt를 통해서 명령한 default session의 대화기록을 다
볼 수 있음" (see the WHOLE conversation history of the default session) — at full fidelity: not just
"utterance + landed surface" (the v1 compromise, made because no transcript existed then), but the
actual prompt → assistant text → tool calls → generated UI conversation.

**Step 3 also introduces the TAB MODEL the user now requires:** the Cosmos panel has **tabs**, with
ONE **undeletable default tab** showing the default-session conversation. Future "favorited" tabs
will be appended here (out of scope to build now), so the tab state must accommodate them additively.

---

## What changed since v1 (the data-source inversion)

| Concern | v1 (steps 1–2 spec) | v2 (step 3, this spec) |
|---------|---------------------|------------------------|
| Persistent session | "none — each submit is ephemeral `claude -p`" | **Shipped in step 2** — one persistent `--session-id` session, transcript recorded |
| Timeline data source | The live `agent:status` + `ui:render` stream only (no transcript) | **The transcript jsonl** (full history) + the live `ui:render` stream for the in-flight run |
| History depth | utterance + outcome + surface (OQ-3 deferred richer transcript) | **Full**: user prompts + assistant text + tool calls + generated surfaces |
| Persistence across restart | re-instated composed surfaces only (session snapshot) | the **whole conversation** (the transcript file is durable) |
| Panel shape | single continuous timeline, no tabs (OQ-4) | a **tab strip** with one undeletable default tab; forward-compat for favorites |

v1's FR-001..FR-004 (rail swap) and the step-2 persistent-session work remain in force; this spec
does not re-litigate them. v2 REPLACES v1 FR-005..FR-009 (the live-stream-only timeline) and v1
OQ-3/OQ-4 (history depth + tabs) with the transcript-backed timeline + the tab model below.

---

## User Scenarios

### See my whole conversation with the default agent · P1

**As a** cosmos user who drives the default agent through Open Prompt
**I want to** see the full conversation — what I asked, what the agent said, the tools it ran, and
every UI it generated — in order, in the Cosmos default tab
**So that** the Cosmos panel is a faithful record of my session, not just the latest surface

**Acceptance criteria:**

- Given the default session has prior turns, when I open the Cosmos panel, then the default tab
  shows the conversation in chronological order: my prompt bubbles, the assistant's text replies,
  the tool calls it made, and the A2UI surfaces it generated.
- Given I scroll up to an earlier turn, when I read it, then its content (prompt text, assistant
  markdown, and any generated surface) is still present and readable.
- Given the assistant produced a `render_ui` surface mid-conversation, when I reach that point in
  the timeline, then the generated A2UI surface is rendered inline at that position.

### Watch the conversation update live as a run lands · P1

**As a** user who just submitted an Open-Prompt command
**I want to** see my new prompt and the agent's response appear in the timeline as the run completes
**So that** the panel is live, not a stale snapshot I must reload

**Acceptance criteria:**

- Given the Cosmos panel is open, when I submit an Open-Prompt command, then my prompt appears as a
  new turn and the agent's reply (text + any generated surface) appends when the run resolves —
  without discarding earlier turns.
- Given a run is in flight, when I look at the timeline, then I see a working/generating affordance
  for the in-flight turn until it resolves.
- Given the in-flight run pushes a `render_ui` surface live (over `ui:render`), when it lands, then
  that surface is shown exactly ONCE — it is NOT double-rendered (once from the live stream and again
  from the re-read transcript).

### Interact with a generated surface in history · P1

**As a** user reviewing the Cosmos timeline
**I want to** interact with an A2UI surface in a turn the same way I do with a live one
**So that** historical surfaces are not a read-only downgrade

**Acceptance criteria:**

- Given a turn holds a `generated-ui` surface with a control (button/form), when I act on it, then
  the action is delivered to the agent via the existing `ui:action` round-trip (subject to the
  same blocking/settle rules as today — see Edge Cases on stale/closed render calls).
- Given a surface is refreshable (descriptor/bindings), when its data refreshes, then the entry's
  surface updates in place (the existing data-model push path is preserved).

### Persist across restart · P1

**As a** returning user
**I want to** see my full Cosmos conversation after restarting the app
**So that** my history is durable, not lost on quit

**Acceptance criteria:**

- Given I had a multi-turn default session, when I quit and relaunch cosmos, then the Cosmos default
  tab shows the same conversation history (re-read from the persisted transcript for the persisted
  default session id).
- Given a generated surface was static (no live data), when restored from the transcript, then it
  re-renders from its recorded spec. (Live/bound data follows the existing refresh-on-mount path;
  this spec does not change that.)

### Empty, loading, and error states · P2

**As a** user opening Cosmos before any conversation exists
**I want to** see clear empty / loading / error states
**So that** the panel is never blank or broken-looking

**Acceptance criteria:**

- Given no default session transcript exists yet (fresh install / no submits), when I open the
  Cosmos panel, then I see an idle empty state inviting me to describe a UI via the composer.
- Given the transcript is being read, when I open the panel, then I see a brief loading state rather
  than a flash of empty.
- Given the transcript file is unreadable/corrupt, when the read fails, then the panel shows a calm,
  recoverable error state (not a crash, not a white screen) and the composer still works.
- Given a single transcript line is malformed, when the reader parses, then that line is skipped and
  the rest of the conversation still renders (one bad line never blanks the timeline).

### The default tab is pinned; favorites come later · P1 (tab model)

**As a** cosmos user
**I want** the Cosmos panel's default conversation tab to be permanent (uncloseable)
**So that** I can never accidentally lose the home of my default session, and future favorited tabs
can be added beside it

**Acceptance criteria:**

- Given the Cosmos panel is open, when I look at the tab strip, then the default tab is present and
  has NO close affordance (it cannot be closed by click, shortcut, or middle-click).
- Given a future build adds favorited tabs, when they are appended to the strip, then the default
  tab remains pinned/first and the favorited tabs are closeable — adding them is additive, requiring
  no change to the default tab's behavior or the timeline it hosts.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### The conversation data model (what the renderer consumes)

| ID | Requirement |
|----|-------------|
| FR-101 | Step 3 MUST introduce a normalized **conversation data model** the renderer consumes — an ordered list of **turns/messages** derived from the transcript. At minimum the model MUST represent: a **user prompt** (text), an **assistant text** message (markdown), a **tool call** (tool name + a non-secret, display-safe summary/args), and a **generated A2UI surface** (the `render_ui` call's `spec`, rendered inline). Each item carries a stable id (from the transcript line `uuid`) and a timestamp for ordering. |
| FR-102 | The normalization MUST map transcript lines to the model as follows: a `type:"user"` line whose `message.content` is a STRING, or an array containing a `{type:"text"}` block, → a **user prompt**; a `type:"assistant"` line's `message.content` `{type:"text"}` blocks → **assistant text**; its `{type:"tool_use"}` blocks → **tool call** items (the `render_ui`-family tool — name `mcp__cosmos-render-ui__render_ui` — maps to a **generated-surface** item carrying `input.spec`, the others to generic tool-call items); a `type:"user"` line's `{type:"tool_result"}` blocks → the **result** of the correlated tool call (correlated by `tool_use_id`). |
| FR-103 | The reader MUST SKIP non-conversational transcript lines: `permission-mode`, `file-history-snapshot`, `attachment` (deferred-tools / mcp-instructions / skill-listing), `queue-operation`, and any line with `isSidechain: true` or sourced from a `subagents/` file. These are claude bookkeeping, not user-visible conversation. |
| FR-104 | The conversation data model MUST be **secret-safe**. No token, OAuth secret, or credential may cross to the renderer. Tool-call `input` and `tool_result` `content` MAY contain integration read data (never tokens — tokens never reach the claude sandbox), but the reader MUST still treat tool args/results as untrusted and surface only a **bounded, display-safe** projection (e.g. a tool name + a truncated/sanitized argument preview, never raw blobs), and MUST strip anything that pattern-matches a secret. The generated-surface item carries only the A2UI `spec` (already non-secret by the render contract). |

### The transcript reader + IPC contract

| ID | Requirement |
|----|-------------|
| FR-105 | A **main-process transcript reader** MUST own all `~/.claude` access. It MUST be **confined to the ONE known default-session transcript path** — `~/.claude/projects/<hash-of-sandboxDir>/<defaultSessionId>.jsonl`, where `sandboxDir = resolveSandboxDir()` and `defaultSessionId` is the persisted id (`AgentSessionStore`). It MUST NOT expose arbitrary `~/.claude` reads, accept a renderer-supplied path, or read any other session/project. The renderer NEVER touches `~/.claude`. |
| FR-106 | All renderer↔main communication for this feature MUST go through the single typed IPC contract in `src/shared/ipc.ts` (a new typed channel set + boundary validators that warn-and-ignore malformed payloads, never crash). The contract MUST provide: (a) a **fetch** of the full parsed conversation for the default session on demand, and (b) a **live push** of conversation updates as the transcript grows. The payloads carry only the normalized, secret-safe conversation model (FR-101/FR-104) — never a raw transcript line, file path, token, or `~/.claude` location. |
| FR-107 | The live-update mechanism MUST keep the timeline current as new submits land. The recommended trigger (see OQ-V2) is **re-read on the AgentRunner run lifecycle** — main re-reads the transcript and emits the updated conversation when a default-session run completes — because the runner already observes run completion (`agent:status`) and `claude` has flushed the transcript by then, which is more robust than racing a partial `fs.watch` mid-write. A file-watch on the jsonl MAY be added as a complementary trigger but MUST be debounced and tolerant of partial/last-line writes (skip an incomplete trailing line). |
| FR-108 | Reads MUST be resilient: a missing transcript file → the **empty** state (not an error); an unreadable/corrupt file → the **error** state; a single malformed line → skipped, the rest parsed (FR-103 robustness). The reader MUST never throw across the IPC boundary; failures resolve to a typed empty/error result. |

### Rendering the timeline in the Cosmos panel

| ID | Requirement |
|----|-------------|
| FR-109 | The Cosmos default tab MUST render the conversation model as a vertically scrollable timeline in chronological order: **user prompt bubbles**, **assistant text** (rendered as markdown), **tool calls** (compact, and — see OQ-V2-collapse — collapsible to keep the timeline readable), and **generated A2UI surfaces rendered INLINE and interactive**. |
| FR-110 | An inline generated surface MUST reuse the EXISTING standard-catalog A2UI host the panel already has (`<A2UIProvider catalogId="standard">` + the `ActiveTabSurface`-style host), so a historical surface is fully interactive (controls round-trip via `ui:action`; refreshable surfaces update via `ui:dataModel`) and a bad/unknown component degrades to that surface's error boundary without affecting sibling turns. |
| FR-111 | The historical (transcript-sourced) surfaces MUST reconcile with the LIVE `ui:render` stream so the in-flight run's surface is shown exactly ONCE (no double-render). The panel MUST treat the live `ui:render` frame as the authority for the IN-FLIGHT turn, and the transcript re-read as the authority for COMPLETED turns; when a run completes and its surface appears in the re-read transcript, the live in-flight entry MUST resolve into the same timeline position rather than producing a duplicate. (Recommended reconciliation: key turns by the transcript line `uuid`; the in-flight turn is a provisional entry replaced/confirmed by the transcript re-read on completion.) |
| FR-112 | The panel MUST present the four states distinctly: **loading** (reading the transcript), **empty** (no conversation yet — idle invite + composer), **populated** (the timeline), and **error** (unreadable transcript — calm recoverable message, composer still usable). |
| FR-113 | Submitting from the Cosmos panel MUST start a default-agent run exactly as today (the Open-Prompt composer publishes to the Cosmos surface; the wire `UiRenderTarget` stays `'generated-ui'`, the persistent-session path from step 2 is unchanged). A new in-flight turn appends to the timeline. |

### The tab model (default tab pinned; forward-compat for favorites)

| ID | Requirement |
|----|-------------|
| FR-114 | The Cosmos panel MUST have a **tab strip** with exactly ONE **default tab** that is **undeletable**: it has no close affordance and cannot be closed via UI, keyboard shortcut (`tab:close`), or any other path. The default tab hosts the default-session conversation timeline. |
| FR-115 | The Cosmos tab state MUST be **forward-compatible with appended "favorited" tabs**: the data structure MUST model a tab kind/role (e.g. a pinned `default` tab vs. future `favorite` tabs) so that adding favorite tabs later is **additive** — appending closeable tabs beside the pinned default — and requires no rewrite of the default tab, its timeline, or the tab-state shape. Building favorite tabs is OUT OF SCOPE for step 3; only the accommodating shape is required now. |
| FR-116 | The Cosmos panel MUST NOT reuse the existing per-tab generative-surface state machine (`useGenerativePanelTabs`, which models one A2UI surface per tab). The Cosmos default tab is a **conversation timeline**, not a surface-per-tab strip; the old per-tab generative state for the Generated-UI/Cosmos surface MUST be retired in favor of the new tab + timeline model. (Architect recommendation — see OQ-V2-tabsystem.) The OTHER generative panels (Jira/Slack/Confluence/Google Calendar) keep `useGenerativePanelTabs` unchanged. |

### Contract, routing, security (carried from v1, restated)

| ID | Requirement |
|----|-------------|
| FR-117 | The wire `UiRenderTarget` for the default agent MUST stay `'generated-ui'` (rail/`SurfaceId` is `'cosmos'`; the two stay decoupled, per v1 OQ-2). The step-2 persistent-session path (the `--session-id` create-or-continue, the FIFO queue, `agentSessionStore`) MUST be unchanged. |
| FR-118 | Every new IPC payload MUST be validated at the main-process boundary (warn + ignore on malformed, never crash). No SESSION_SCHEMA_VERSION bump is required: the conversation is read from the transcript and the default session id store, not added as a new persisted field on `SessionSnapshot` (additive session-snapshot fields, if any, need no version bump). |

---

## Edge Cases & Constraints

- **Sandbox transcript path derivation.** The transcript is at
  `~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl`, where `<dir-key>` is `claude`'s
  encoding of the cwd (`resolveSandboxDir()` = `<userData>/sandbox`) — observed as the absolute path
  with `/` and `.` replaced by `-`. The reader MUST derive `<dir-key>` from `sandboxDir` the SAME way
  claude does (the plan pins the exact transform against a real on-disk dir during implementation;
  if claude's encoding can't be reproduced deterministically, the reader MAY instead resolve the
  project dir by scanning `~/.claude/projects/*` for the one containing `<defaultSessionId>.jsonl` —
  flagged in the plan).
- **No transcript yet.** Before the first default-session submit (or before step 2's session is
  exercised) the file is absent — this is the EMPTY state, not an error.
- **Subagent / sidechain noise.** The default Open-Prompt run is unlikely to spawn subagents, but the
  reader MUST defensively skip `subagents/*.jsonl` and `isSidechain: true` lines (FR-103) so a
  subagent turn never pollutes the user-facing conversation.
- **Live vs. transcript double-render.** The in-flight run's surface arrives BOTH live (`ui:render`)
  and, on completion, in the re-read transcript. FR-111 governs reconciliation (key by line `uuid`;
  in-flight provisional entry confirmed/replaced by the transcript). The plan MUST make this
  deterministic so no turn renders twice and no turn is dropped.
- **Stale render calls in history.** A `render_ui` call recorded in the transcript was resolved long
  ago (its pending bridge call is gone). A historical surface re-rendered from the transcript is
  therefore INTERACTIVE for display, but a control action on it has no live pending call to resolve
  — acting on a stale historical surface MUST degrade gracefully (the action is a no-op against a
  missing requestId, exactly as a stale `ui:action` is already warn-and-ignored in main), NOT an
  error. Only the IN-FLIGHT turn's surface has a live, resolvable render call. (The plan specifies how
  the panel signals which surfaces are live-actionable vs. historical-display.)
- **Transcript size.** A long session yields a large jsonl. The reader SHOULD parse it streamingly /
  incrementally rather than loading the whole file as one JSON, and the timeline SHOULD avoid mounting
  every historical `A2UIProvider` at once (virtualize / collapse older surfaces) — see OQ-V2-perf.
- **Secrets.** Tokens never reach the claude sandbox, so the transcript contains none. But tool
  args/results MAY hold integration data; the reader surfaces only a bounded, sanitized projection
  (FR-104) and the generated-surface item carries only the non-secret A2UI `spec`. The reader and all
  `~/.claude` access stay in MAIN (FR-105).
- **Out of scope (step 3):** building favorited tabs (only the accommodating tab shape); changing the
  step-2 spawn/session model; multi-session management; editing the transcript; streaming the
  assistant's PARTIAL/in-progress tokens (the in-flight turn shows a working affordance and resolves
  from the transcript on completion — token-level streaming is a possible follow-up, OQ-V2-stream);
  changing any other rail panel or its `useGenerativePanelTabs`.

---

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-101 | Opening the Cosmos panel shows the default session's full conversation (user prompts, assistant text as markdown, tool calls, and inline generated surfaces) in chronological order, read from the transcript via the main-side reader. |
| SC-102 | Submitting a new Open-Prompt command appends the prompt + (on completion) the agent's reply/surface to the timeline live, with no earlier turn lost and no surface double-rendered. |
| SC-103 | A generated surface in history renders inline via the standard-catalog A2UI host; the in-flight turn's surface is interactive (round-trips via `ui:action`); a stale historical surface action degrades to a no-op, never an error; an unknown component degrades to that turn's error boundary without affecting siblings. |
| SC-104 | After app restart, the Cosmos default tab shows the same conversation (re-read from the persisted transcript for the persisted default session id). |
| SC-105 | The default tab is present with NO close affordance and cannot be closed by click, shortcut, or middle-click; the tab state models a pinned-default vs. future-favorite distinction so favorites can be appended additively. |
| SC-106 | Loading / empty / error states all render (no blank, no white screen); a missing transcript → empty, a corrupt transcript → calm error, a single malformed line → skipped with the rest intact. |
| SC-107 | `npm run typecheck` and `npm test` pass. No token/secret, raw transcript line, file path, or `~/.claude` location appears in any IPC payload or renderer surface introduced by this feature; all `~/.claude` access is in main and confined to the one default-session transcript path. |
| SC-108 | The step-1 rail swap and step-2 persistent-session path are behaviorally unchanged; the wire `UiRenderTarget` stays `'generated-ui'`; other generative panels' `useGenerativePanelTabs` behavior is unchanged. |

---

## Open Questions

- [ ] **OQ-V2-watch (live-update mechanism — recommendation given):** Trigger live updates by
  **re-reading the transcript on the AgentRunner run-lifecycle** (`agent:status` `completed` for the
  default target → main re-reads + emits the updated conversation), OR by **`fs.watch` on the jsonl**,
  OR both? **Architect recommendation: re-read on run-lifecycle as the primary trigger** (robust —
  the runner already knows when a run finished and claude has flushed by then; no racing a partial
  mid-write), with an OPTIONAL debounced `fs.watch` as a secondary trigger for out-of-band growth.
  Confirm.
- [ ] **OQ-V2-tabsystem (tab state — recommendation given):** Should the Cosmos panel **retire**
  `useGenerativePanelTabs` (the surface-per-tab model) in favor of a NEW tab model where the default
  tab hosts a conversation timeline (FR-116), OR try to overload `useGenerativePanelTabs`?
  **Architect recommendation: retire it for the Cosmos panel** — a conversation timeline is a
  fundamentally different shape than "one A2UI surface per tab", and the new pinned-default +
  forward-compat-favorites model (FR-114/FR-115) is cleaner as a small purpose-built tab state. The
  other four panels keep `useGenerativePanelTabs` untouched. Confirm.
- [ ] **OQ-V2-pathkey (transcript path derivation):** Should the reader **derive** `<dir-key>` from
  `sandboxDir` by reproducing claude's cwd→folder encoding (replace `/` and `.` with `-`), OR
  **discover** the project dir by scanning `~/.claude/projects/*` for the one containing
  `<defaultSessionId>.jsonl`? **Architect recommendation: derive (pin the exact transform against a
  real on-disk dir in the plan), with the scan as a documented fallback** if claude's encoding proves
  non-trivial (e.g. special-character handling). Confirm acceptable.
- [ ] **OQ-V2-toolcalls (tool-call display depth):** How much of each tool call should the timeline
  show? **Architect recommendation: a compact, collapsible row** — tool name + a short sanitized
  argument preview, expandable to a bounded/redacted detail — never a raw arg/result blob (FR-104).
  Confirm the desired verbosity (e.g. hide non-render tool calls entirely, show them collapsed by
  default, or show them inline).
- [ ] **OQ-V2-stream (token streaming — out of scope by default):** Should the in-flight turn stream
  the assistant's PARTIAL tokens as they generate (would require `--output-format stream-json` /
  `--include-partial-messages` capture in main and a new streaming channel), or is a working
  affordance that resolves from the transcript on completion sufficient for step 3? **Architect
  recommendation: working affordance + resolve-on-completion for step 3** (the transcript is the
  source of truth; token streaming is a materially larger follow-up). Confirm out of scope.
- [ ] **OQ-V2-perf (long-history performance):** For a long conversation with many generated
  surfaces, mount only on-screen / most-recent `A2UIProvider` hosts and collapse older surfaces to a
  header (virtualize)? **Architect recommendation: yes — specify the collapse/virtualize affordance
  in the design step.** Confirm the acceptable trade-off (older surfaces collapsed-by-default vs. all
  mounted).
