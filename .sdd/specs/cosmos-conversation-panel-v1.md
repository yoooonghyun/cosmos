# Spec: Cosmos Conversation Panel — v1

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: none
**Related plan**: .sdd/plans/cosmos-conversation-panel-v1.md

---

## Grounding

> Direct investigation by the architect (codegraph + agentmemory + docs). This section makes
> the grounding visible to the cycle.

**codegraph_explore queries run (verbatim source returned, treated as Read):**

- `agentRunner Open Prompt PromptComposer ActiveComposerProvider render_ui UiBridge ui:render GeneratedUiPanel`
  → the Open-Prompt → agent → render path; `PromptComposer` is ONE hoisted App-level composer.
- `SurfaceId UiRenderTarget railVisibility visibleSurfaceIds resolveFallbackSurface ALL_SURFACE_IDS RAIL_ITEM SessionProvider`
  → `SurfaceId = 'terminal' | 'generated-ui' | GateableIntegration`; `'generated-ui'` is in
  `ALWAYS_PRESENT`; `UiRenderTarget` is a SEPARATE union in `src/shared/ipc/common.ts`.
- `AgentRunner runClaude session id jsonl transcript output-format json ui:render UiBridge handleRender`
  → **load-bearing finding:** `AgentRunner.run()` spawns a fresh `claude -p --output-format json`
  per submit with **no `--session-id`/`--resume`**; stdout is captured then discarded (only
  `parseJsonResult` peeks at `result`/`error` on failure).
- `GeneratedUiPanel A2UIProvider useActiveComposerConfig agent.submit ActiveComposerProvider activeComposer`
  → the panel publishes its composer wiring via `usePublishComposer('generated-ui', …)` and hosts
  the active tab's `<A2UIProvider catalogId="standard">`.
- `useGenerativePanelTabs GenerativePanelTab agent:submit agent:status agent:render handleAgentSubmit AgentSubmitPayload UiRenderPayload pushRender`
  → the renderer's only record of an agent run is per-tab surface state (utterance label + landed
  A2UI surface + error); a frame is filed into the originating tab by `originatingTabIdRef`.
- `agentRunner spawn sessionId session_id transcript resume jsonl ~/.claude/projects output-format json result`
  → confirms the headless runner records no session id and reads no transcript jsonl (unlike the
  interactive PTY/session-resume path).
- `AgentStatusPayload AgentSubmitPayload producedSurface agent:submit ipcMain.on agentRunner.run agent channel AgentChannelName`
  → `agent:submit` (R→M) carries `{ utterance, target, viewContext? }`; `agent:status` (M→R)
  carries `{ state: started|completed|error, message?, producedSurface? }`. Main sets
  `producedSurface` from `renderPushedForRun` (a `generated-ui` frame was pushed for this run).
- `parseJsonResult output-format json result session_id messages assistant content blocks`
  → the only stdout parse is `parseJsonResult` (error-message extraction); no message/transcript
  parsing exists.

**Files read directly:** `docs/ARCHITECTURE.md` §3, §4.4, §4.5, §4.10, §4.11, §5a (render path +
session model); `docs/DEVELOPMENT.md` add-a-panel recipe + render routing; `src/renderer/App.tsx`
rail render (`RAIL_ITEM`, `visibleIds.map`, the six `TabsContent` panels, `SharedComposer`);
`src/main/index.ts` `agent:submit` handler (line ~1362) + `pushRenderToRenderer` /
`renderPushedForRun` (line ~1910) + the `AgentRunner` `onStatus` `producedSurface` stamp
(line ~2211); `railVisibility.ts`; `ActiveComposerProvider.tsx`.

**memory_recall / memory_smart_search queries run:**

- `generated ui agent runner default session conversation render target open prompt A2UI` → empty.
- `generated ui panel agent runner conversation history default session render target open prompt claude -p`
  → empty (no prior decisions persisted on this area).
- Persisted this cycle's load-bearing finding via `memory_save` (the ephemeral-`claude -p`,
  no-transcript reality + the timeline-from-existing-stream conclusion).

**Load-bearing answers to the 4 grounding questions** (the data source + the inline-vs-text-log
decision) are written up in the Open Questions and Functional Requirements below.

---

## Overview

Replace the "Generated UI" rail panel with a **Cosmos** panel that shows the running
**conversation history** of the Open-Prompt agent — every utterance the user has commanded
through the Open-Prompt composer against this default agent, the run's outcome, and the rich
A2UI surface each run generated — as a single scrollable, append-only timeline, so the user can
review the whole session of generated UI instead of seeing only the last surface in a tab.

This is the user's request: "Generated UI 패널 삭제하고 Cosmos 패널 만들어줘. 여기서는 Open
Prompt를 통해서 명령한 default session의 대화기록을 다 볼수 있음." — remove the Generated UI panel;
add a Cosmos panel that shows the full conversation history of the default session commanded via
Open Prompt.

**What "default session" means here (grounded):** there is no persistent `claude` conversation —
each Open-Prompt submit spawns a fresh ephemeral `claude -p` run (§4.10). The "default session"
is therefore the **logical stream of Open-Prompt commands routed to the general-purpose agent**
(today the `'generated-ui'` render target — the one Open-Prompt target with no integration
connection, no view-context, no deterministic dispatcher). The Cosmos panel is the home of that
stream's history.

---

## User Scenarios

### See the full history of what I asked the agent · P1

**As a** cosmos user who drives the agent through the Open-Prompt composer
**I want to** see every command I gave the default agent and the UI it generated, in order
**So that** I can review and re-read the whole session instead of only the latest surface

**Acceptance criteria:**

- Given I have submitted three Open-Prompt commands against the Cosmos surface, when I open the
  Cosmos panel, then I see three timeline entries in submission order, each showing the utterance I
  typed and the A2UI surface that run produced (or its error/empty outcome).
- Given a new command is submitted while the Cosmos panel is open, when the run completes, then a
  new entry appends to the bottom of the timeline without discarding the earlier entries.
- Given I scroll up to an earlier entry, when I read it, then its generated surface is still
  rendered and (for a static surface) still readable.

### Interact with a generated surface from history · P1

**As a** user reviewing the Cosmos timeline
**I want to** interact with the rich A2UI surface inside a history entry the same way I do today in
the Generated UI panel
**So that** the Cosmos panel is a full replacement, not a read-only downgrade

**Acceptance criteria:**

- Given a timeline entry holds a `generated-ui` surface with a control (button/form), when I act on
  it, then the action is delivered to the agent exactly as it is today (the `ui:action` round-trip
  resolves the pending render call).
- Given a surface is refreshable (carries a descriptor/bindings), when its data refreshes, then the
  entry's surface updates in place (the existing data-model push path is preserved).

### Submit a new command from the Cosmos panel · P1

**As a** user on the Cosmos panel
**I want to** use the Open-Prompt composer to issue a new command
**So that** the panel is both the input and the history of the default agent

**Acceptance criteria:**

- Given the Cosmos panel is active, when I open the Open-Prompt composer and submit an utterance,
  then a run starts against the default agent and a new in-flight entry appears in the timeline.
- Given a run is in flight, when I look at the new entry, then it shows the agent's working state
  (the surface spinner / "generating" affordance) until the surface lands, errors, or completes.

### Empty, loading, and error states · P2

**As a** user opening Cosmos for the first time in a session
**I want to** see a clear empty state and clear per-entry error states
**So that** the panel is never a blank or broken-looking surface

**Acceptance criteria:**

- Given I have submitted no commands this session, when I open the Cosmos panel, then I see an idle
  empty state inviting me to describe a UI via the composer.
- Given a run fails, when its entry resolves, then that entry shows a recoverable error message
  (the run's reported failure text), and earlier entries are unaffected.
- Given a run completes without generating any surface (a plain command), when it resolves, then
  its entry settles to a non-spinning "no UI generated" outcome rather than hanging on a spinner.

### Restore history across app restart · P3

**As a** returning user
**I want to** see my prior Cosmos history after restarting the app (to the extent today's session
persistence allows)
**So that** my generated surfaces are not silently lost

**Acceptance criteria:**

- Given the existing session-persistence behavior re-instates composed `generated-ui` surfaces on
  restart, when I reopen the app, then the Cosmos timeline shows those re-instated surfaces as
  history entries (subject to the same persistence limits the Generated UI panel has today — live
  data views are re-fetched, not snapshotted).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### The Cosmos panel & rail swap

| ID | Requirement |
|----|-------------|
| FR-001 | The rail surface `'generated-ui'` MUST be replaced by a new always-present rail surface `'cosmos'` (label "Cosmos"). The Generated UI rail item, its icon/label entry, and its panel component MUST be removed from the rail. |
| FR-002 | The Cosmos panel MUST occupy the rail position the Generated UI panel occupied (an always-present, non-gateable surface, like Terminal), so the rail order and the disable-active fallback behavior are otherwise unchanged. |
| FR-003 | The Open-Prompt composer MUST publish to the Cosmos surface so that submitting from the Cosmos panel starts a default-agent run, exactly as it published to the Generated UI surface before. |
| FR-004 | Removing Generated UI MUST NOT change how the general-purpose agent's render frames are routed: the agent's `render_ui` continues to produce the general-purpose render target, and the Cosmos panel MUST consume those frames (see FR-010 on the target identity). Other panels' targets (Slack/Jira/Confluence/Google Calendar) MUST be unaffected. |

### The conversation timeline (data + behavior)

| ID | Requirement |
|----|-------------|
| FR-005 | The Cosmos panel MUST present the default-session history as a single, append-only, vertically scrollable **timeline** of entries in submission order (oldest → newest), not as a replace-on-compose single surface and not as a side-by-side tab strip. |
| FR-006 | Each timeline entry MUST record, at minimum: (a) the **user utterance** that started the run, (b) the **run outcome/state** (in-flight, completed, error), and (c) the **generated A2UI surface** for that run when one was produced (rendered inline — see FR-008), or the entry's empty/error outcome when none was. |
| FR-007 | The timeline's data source MUST be the existing agent run-lifecycle + render stream the renderer already receives for the default agent — the submitted utterance (captured at submit time), `agent:status` (`started`/`completed`/`error`, including `producedSurface`), and the matching `ui:render` (and any `ui:dataModel`) frames. No secret, token, or raw run stdout/transcript may be read or surfaced (the agent run carries none into the renderer today, and this feature MUST NOT add one). |
| FR-008 | A timeline entry that produced a surface MUST render that A2UI surface **inline** within the entry, using the SAME standard-catalog `A2UIProvider` host the Generated UI panel uses today, so generated UI in history is fully interactive (controls work, refreshable surfaces update). The timeline is therefore a rich, interactive log — NOT a text-only transcript. (Recommendation; see Open Questions OQ-1.) |
| FR-009 | An in-flight entry MUST show the agent's working affordance (the existing surface spinner / generating signal) until its surface lands, it errors, or the run completes with no surface; a plain command that produces no surface MUST settle to a calm "no UI generated" outcome, never an indefinite spinner. |

### Contract & routing

| ID | Requirement |
|----|-------------|
| FR-010 | The render-target identity the default agent uses MUST be preserved end-to-end. `'cosmos'` is a **rail/`SurfaceId`** value (a panel id), which is DISTINCT from the **`UiRenderTarget`** the agent stamps on render frames. The feature MUST keep the general-purpose render target stable so that the agent runner's tool grant, grounding, `producedSurface` signaling, and the "display-only settle vs. blocking" rule in `UiBridge` (only the general-purpose target keeps blocking to await a user action) all continue to work unchanged. [NEEDS CLARIFICATION resolved as a plan decision — see OQ-2: keep the wire target literal `'generated-ui'` vs. rename to `'cosmos'`.] |
| FR-011 | Any new renderer→main or main→renderer communication this feature needs MUST go through the single typed IPC contract in `src/shared/ipc.ts` (a typed channel + a boundary validator that warns-and-ignores invalid payloads, never crashes). The feature SHOULD avoid adding a new IPC channel if the timeline can be assembled entirely in the renderer from streams it already receives (FR-007); a new channel is justified ONLY if a capability the renderer cannot currently observe is required. |
| FR-012 | Session persistence of Cosmos history MUST follow the existing per-panel snapshot mechanism: the Cosmos surface reuses the persisted slice that Generated UI used (renamed/retargeted to the Cosmos surface), so composed surfaces are re-instated on restart with the same limits as today (FR-013/FR-015 of session-persistence-v1: fresh requestId, live data re-fetched). No new persistence store is introduced. |

---

## Edge Cases & Constraints

- **No persistent claude session exists.** Each Open-Prompt submit is a fresh `claude -p` run with
  no session id and no transcript read (grounded). The "history" is the accumulated stream of
  utterance → status → surface events, NOT a `~/.claude/projects/*.jsonl` read. This feature MUST
  NOT introduce a transcript reader unless an Open Question explicitly resolves that the
  utterance/status/surface stream is insufficient for the desired history depth.
- **Single-run guard is unchanged.** Headless runs stay sequential (at most one in flight
  app-wide). The timeline therefore has at most one in-flight entry at a time, which keeps the
  existing originating-run correlation valid (no per-run id needed). If cosmos ever allows
  concurrent runs, the correlation would need revisiting (same caveat as §4.11 today).
- **Assistant text / tool-call log is out of scope for v1** unless OQ-3 resolves otherwise: the
  agent run does not stream its intermediate reasoning or tool calls to the renderer today (only
  status + the final surface). v1's "conversation" is utterance + outcome + generated surface, the
  data the renderer can actually observe. Surfacing assistant prose/tool calls would require a new
  data path (capturing/streaming `claude -p` stream-json) — flagged as OQ-3, not assumed.
- **Tabs vs. timeline.** The Generated UI panel today is a multi-tab strip (one surface per tab).
  The Cosmos panel is a SINGLE continuous timeline (no per-surface tab strip). Whether the panel
  keeps any tab affordance at all is OQ-4. The default recommendation is a single timeline with no
  tab strip (the history is the scroll, not tabs).
- **Out of scope:** changing the agent runner's spawn model (still `claude -p`, ephemeral); adding
  multi-session management; persisting raw transcripts; streaming assistant text; changing any
  other rail panel; changing the Open-Prompt composer's own behavior beyond which surface it
  publishes to.
- Removing the `'generated-ui'` rail surface MUST keep `railVisibility` invariants intact (the new
  `'cosmos'` id is always-present; `resolveFallbackSurface` still falls back to `terminal`).

---

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | The rail shows a "Cosmos" item where "Generated UI" used to be; there is no "Generated UI" rail item, panel, or label remaining. |
| SC-002 | Submitting N Open-Prompt commands against Cosmos yields N timeline entries in order; none is discarded when the next is submitted. |
| SC-003 | A `generated-ui`-style surface in a history entry is interactive: a button/form action round-trips to the agent and resolves the pending render call exactly as it does in the Generated UI panel today. |
| SC-004 | An in-flight entry shows the working affordance and resolves to surface / error / "no UI generated"; no entry hangs on a spinner after its run completes. |
| SC-005 | The empty, loading, populated, and error states all render (no blank or white-screen). An unknown/invalid A2UI component in one entry degrades to that entry's error boundary and never affects sibling entries. |
| SC-006 | `npm run typecheck` and `npm test` pass; no secret/token/raw-transcript value appears in any IPC payload, persisted snapshot, or surface introduced by this feature. |
| SC-007 | The general-purpose agent run path (tool grant, grounding, `producedSurface`, UiBridge blocking-vs-display-only settle) is unchanged in behavior after the swap. |

---

## Open Questions

- [ ] **OQ-1 (central UX — recommendation given, needs user confirm):** Should each history entry
  render its **A2UI surface inline** (interactive, the full Generated-UI experience embedded in the
  timeline), or show a **text/structured summary** of the entry (utterance + outcome label) with
  the surface available on expand, or **both**? **Architect recommendation: render the surface
  inline (FR-008)** — it is the faithful replacement for the Generated UI panel (which renders the
  live surface), keeps generated UI interactive, and needs no new data path. The cost is that a
  long history mounts many `A2UIProvider` hosts at once (performance), which the plan can mitigate
  (e.g. mount only on-screen/most-recent entries; collapse older ones to a header). Confirm: inline
  interactive surfaces (recommended) vs. collapsed summaries.
- [ ] **OQ-2 (contract decision — recommendation given):** Keep the agent's wire **`UiRenderTarget`
  literal `'generated-ui'`** (Cosmos panel filters `ui:render` by `target === 'generated-ui'`; the
  rail id `'cosmos'` and the wire target stay decoupled), OR rename the target to `'cosmos'`
  everywhere (renderUiServer default, `DEFAULT_UI_RENDER_TARGET`, the UiBridge blocking rule, the
  agent grant/grounding, the persisted panel key). **Architect recommendation: keep the wire target
  `'generated-ui'`** — it is a smaller, lower-risk change (no MCP/bridge/grant churn, no migration
  of the persisted snapshot key), and the rail-id-vs-render-target distinction already exists in the
  codebase. Renaming is a larger, riskier rename for a cosmetic gain. Confirm which the user wants.
- [ ] **OQ-3 (history depth):** Is utterance + run outcome + generated surface a sufficient
  "대화기록", or does the user expect to also see the **agent's assistant text and tool calls**
  (a true chat transcript)? The renderer does NOT receive these today; surfacing them needs a new
  data path (capture `claude -p` `--output-format stream-json` / `--include-partial-messages` in
  main and stream message events to the renderer over a NEW typed IPC channel, tokens/secrets
  excluded). **Architect recommendation: v1 = utterance + outcome + surface (no transcript)**;
  treat assistant-text/tool-call transcript as a follow-up (v2) if desired, because it is a
  materially larger change (new capture path, new channel, new validator). Confirm scope.
- [ ] **OQ-4 (tabs):** Should the Cosmos panel keep any per-surface **tab strip**, or is it a
  single continuous timeline with no tabs? **Architect recommendation: single timeline, no tab
  strip** (the scroll IS the history). Confirm.
- [ ] **OQ-5 (naming/persistence key):** If OQ-2 keeps the wire target `'generated-ui'`, the
  persisted snapshot panel key stays `'generated-ui'` while the rail id becomes `'cosmos'`. Confirm
  it is acceptable for the persisted key to differ from the rail id (no snapshot migration), versus
  renaming the snapshot key (a schema migration). Recommendation: keep the key, no migration.
