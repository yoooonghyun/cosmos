# Plan: Cosmos Conversation Panel — v2 (Step 3: transcript-backed conversation timeline + tab model)

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: .sdd/specs/cosmos-conversation-panel-v2.md

---

## Grounding

See the spec's Grounding section for the full `codegraph_explore` / `memory_recall` queries, the
real on-disk transcript jsonl read to pin the format, and the files read. The load-bearing findings
the plan is built on:

- **Step 2 is shipped and INVERTS v1's premise.** `AgentRunner` (`src/main/agentRunner.ts`) now runs
  the default `'generated-ui'` target as a PERSISTENT `claude -p --output-format json --session-id
  <persistedId>` session, so a transcript jsonl now EXISTS and grows. The id is persisted at
  `<userData>/agent-session.json` (`AgentSessionStore`, `src/main/agentSessionStore.ts`); cwd is the
  stable `resolveSandboxDir()` = `<userData>/sandbox` (`src/main/index.ts`).
- **Transcript path:** `~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl`, `<dir-key>` =
  claude's cwd encoding (absolute path with `/` and `.` → `-`). Subagent lines live under
  `<sessionId>/subagents/agent-*.jsonl` and are ignored.
- **Transcript line format (claude 2.1.x, pinned from real cosmos-project transcripts):** one JSON
  object per line keyed by `type`. `user` (`message.content` = string OR block array incl.
  `tool_result`), `assistant` (`message.content` = block array of `{type:"text"}` /
  `{type:"tool_use",id,name,input}`), plus `permission-mode` / `file-history-snapshot` /
  `attachment` / `queue-operation` noise lines. `render_ui` = an assistant `tool_use` named
  `mcp__cosmos-render-ui__render_ui` whose `input.spec` is the A2UI `surfaceUpdate`. Each line has
  `uuid`, `timestamp`, `parentUuid`, `isSidechain`, `sessionId`, `cwd`.
- **The live render path is unchanged.** `UiBridge.onMessage` (`src/main/uiBridge.ts`) pushes
  `UiRenderPayload {requestId, spec, target, descriptor?, bindings?}` over `ui:render`; only
  `target === 'generated-ui'` keeps blocking. The in-flight Cosmos surface still flows live via
  `ui:render` exactly as today (FR-111 reconciliation depends on this).
- **Renderer-facing shapes:** `UiRenderPayload` / `A2uiAction` / `UiApi` (`src/shared/ipc/ui.ts`),
  `AgentStatusPayload` / `AgentSubmitPayload` (`src/shared/ipc/agent.ts`),
  `window.cosmos.ui.onRender` / `agent.onStatus` / `ui.onDataModel` (preload). The standard-catalog
  inline host is `ActiveTabSurface.tsx` + `<A2UIProvider catalogId="standard">`.

---

## Summary

Step 3 makes the Cosmos panel render the **default session's full conversation timeline**, read from
the transcript jsonl that step 2's persistent session records. The approach is **main-reads,
renderer-renders**:

1. A **main-process transcript reader** (`src/main/transcriptReader.ts`) resolves the one confined
   default-session jsonl path, parses it into the **normalized conversation model**
   (`src/shared/conversation.ts` — secret-safe turns), and emits it on demand + on each completed
   default-session run.
2. A **new typed IPC channel set** (`src/shared/ipc/conversation.ts` + validator) carries the
   conversation model to the renderer — fetch + live push — never a raw line, path, token, or
   `~/.claude` location.
3. The **Cosmos panel** (`src/renderer/CosmosPanel.tsx`) renders the timeline: prompt bubbles,
   assistant markdown, collapsible tool calls, and **inline interactive A2UI surfaces** reusing the
   existing standard-catalog host. It **reconciles** the live `ui:render` in-flight surface with the
   transcript re-read (no double-render).
4. A small **purpose-built Cosmos tab state** replaces `useGenerativePanelTabs` for this panel: ONE
   pinned, undeletable default tab, with a tab-kind model that lets future favorited tabs be appended
   additively.

This is **UI-bearing → a `design` step (designer) is REQUIRED** before implementation (timeline
chrome, turn anatomy, tool-call collapse, the four states, and the tab strip with a pinned default).

> NOTE: This plan documents the recommended path. The spec's Open Questions (OQ-V2-watch,
> -tabsystem, -pathkey, -toolcalls, -stream, -perf) MUST be confirmed by the user before
> implementation. Phase 0 is the gate.

---

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (React 19 renderer; Electron main; shared IPC) |
| Key dependencies | existing `@a2ui-sdk/react` standard catalog, `ActiveTabSurface` / `A2UIProvider`, `PromptComposer` + `ActiveComposerProvider`, `AgentRunner` + `AgentSessionStore` (step 2), `railVisibility.ts` (`'cosmos'` SurfaceId from step 1). A markdown renderer for assistant text (prefer an existing dep; if none, the design/plan picks a minimal, sanitized one — assistant text is model output, sanitize like the Confluence DOMPurify gate). |
| Files to create | `src/main/transcriptReader.ts` (path resolution + fetch/emit, fs in main); `src/main/transcriptParse.ts` + `transcriptParse.test.ts` (PURE line→model normalization, `.ts`/`.test.ts` split, no Electron/fs); `src/shared/conversation.ts` (the conversation data model types); `src/shared/ipc/conversation.ts` + `src/shared/ipc/conversation.validate.ts` (the typed channel + boundary validators); `src/renderer/CosmosPanel.tsx` (timeline panel — supersedes the step-1 placeholder if one exists); `src/renderer/cosmosConversation.ts` + `cosmosConversation.test.ts` (PURE renderer-side reconcile: merge transcript model + live in-flight `ui:render`, no double-render); `src/renderer/cosmosTabs.ts` + `cosmosTabs.test.ts` (PURE pinned-default + forward-compat-favorite tab state); optionally `src/renderer/CosmosTimelineEntry.tsx`, `src/renderer/CosmosTabStrip.tsx` |
| Files to modify | `src/shared/ipc.ts` + `src/shared/validate.ts` (barrel re-export the new conversation module); `src/main/index.ts` (construct the reader, wire the conversation IPC handlers, trigger a re-read on default-target `completed`); `src/preload/*` (expose `window.cosmos.conversation.*` — PRELOAD EDIT ⇒ full `npm run dev` restart, not HMR); `src/renderer/App.tsx` (Cosmos `TabsContent` now renders `<CosmosPanel>` with the new tab strip); docs (`ARCHITECTURE.md`, `PROJECT-STRUCTURE.md`) |
| Files explicitly UNCHANGED | `src/main/agentRunner.ts`, `src/main/agentSessionQueue.ts`, `src/main/agentSessionStore.ts` (step 2 session path); `src/main/uiBridge.ts`, `src/shared/ipc/ui.ts` (`UiRenderTarget` stays `'generated-ui'`); the other four generative panels + `useGenerativePanelTabs.ts` (Jira/Slack/Confluence/Google Calendar) |

---

## Sequencing note

Step 1 (rail swap to `'cosmos'`) and step 2 (persistent session) are SHIPPED. This plan builds on
top. The new IPC + preload method means a full `npm run dev` restart is required to exercise it
(CLAUDE.md preload rule). Coordinate commit ordering with the orchestrator if other `App.tsx`/preload
changes are in flight.

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 0 — Confirm open questions (GATE — before any code)

> RESOLVED by the developer with pragmatic defaults (per the orchestrator's instruction to
> resolve, not block). Each adopts the architect's recommendation; rationale inline.

- [x] OQ-V2-watch — ADOPTED re-read-on-run-lifecycle as the PRIMARY trigger. Implemented in
  `index.ts`: on every `agent:status` `completed`, main re-reads the transcript and pushes
  `conversation:update`. Did NOT add the optional `fs.watch` (the run-lifecycle trigger covers
  every default-session submit; a watch is additive later if out-of-band growth ever matters).
  Note: pushes on ALL completed runs (the status payload doesn't carry the target); a non-default
  run didn't append to the default transcript, so the re-read is idempotent (same content) —
  harmless, simpler than threading the target through the status sink.
- [x] OQ-V2-tabsystem — ADOPTED retire `useGenerativePanelTabs` for Cosmos. New pure
  `cosmosTabs.ts` (pinned-default + forward-compat favorites). Other four panels untouched.
- [x] OQ-V2-pathkey — ADOPTED derive `<dir-key>` (`/`+`.`→`-`) with a SCAN fallback
  (`readdirSync` of `~/.claude/projects/*`) when the derived file is absent. Both pinned by
  `transcriptReader.test.ts`. NOTE: Phase-1 live verification against a real on-disk transcript
  was NOT run (no `npm run dev` from this agent); the derive+scan pair is the safety net.
- [x] OQ-V2-toolcalls — ADOPTED compact collapsible rows. DECISION: show ALL tool calls
  (collapsed by default), not render-only — the user asked to see "the tools it ran". A
  `render_ui` call becomes an inline SURFACE turn (not a tool-call row). Args/results are a
  bounded, secret-redacted one-line preview (`previewArgs`, cap 200).
- [x] OQ-V2-stream — ADOPTED no partial-token streaming. The in-flight turn shows a
  `SurfaceSpinner` "generating" affordance + the live `ui:render` surface, resolved from the
  transcript on completion.
- [x] OQ-V2-perf — PARTIALLY ADOPTED. Older tool calls are collapsed-by-default (cheap). Did
  NOT implement surface virtualization in step 3 (all historical `A2UIProvider`s mount) — a
  perf refinement deferred to the design step / a follow-up; flagged so it is not forgotten.
  A very long history with many surfaces could be heavy; acceptable for step 3's first cut.

> EXTRA DECISION (markdown — Technical Context noted "prefer an existing dep; if none, pick a
> minimal sanitized one"): there is NO markdown dep installed. Assistant text is rendered as
> React TEXT nodes (auto-escaped, `whitespace-pre-wrap`), NOT raw HTML — zero injection surface,
> zero new dependency. Rich markdown rendering is a deferred refinement (noted in the panel).

### Phase 1 — Pin the transcript path + format (investigation, before parser code)

- [ ] Reproduce claude's cwd→`<dir-key>` encoding against a REAL on-disk dir: exercise the step-2
  persistent session once (`npm run dev`, submit one Open-Prompt command) so
  `~/.claude/projects/<sandbox-key>/<defaultSessionId>.jsonl` exists, and confirm `<sandbox-key>`
  equals `resolveSandboxDir()` with `/`+`.`→`-`. If the encoding differs (special chars), adopt the
  scan-fallback (OQ-V2-pathkey) and note the exact rule.
- [ ] Confirm against that real cosmos-sandbox transcript that a `render_ui` call is an assistant
  `tool_use` named `mcp__cosmos-render-ui__render_ui` with `input.spec` = the A2UI surfaceUpdate, and
  that the line `type`s match the spec's FR-102/FR-103 mapping. Record any deviation in Deviations.

### Phase 2 — Design step (designer, `design` skill) — REQUIRED, UI-bearing

- [ ] Designer produces `.sdd/designs/cosmos-conversation-panel-v2.md`: the conversation **timeline**
  (turn anatomy — user prompt bubble, assistant markdown block, collapsible tool-call row, inline
  surface region), the **tab strip with a pinned/undeletable default tab** (no close affordance) +
  the forward-compat slot for favorited tabs, and the **loading / empty / populated / error** states.
  Reuse the Tailwind + shadcn/ui system + brand tokens (`SurfaceSpinner`/`CosmosSpinner`, `--brand-*`,
  `CosmosMark`). Specify the long-history collapse/virtualize affordance (OQ-V2-perf) and how an
  in-flight turn vs. a completed turn vs. an error turn read distinctly.
- [ ] Design review: timeline reads as one coherent conversation; the default tab is visually pinned;
  tool calls are unobtrusive; inline surfaces are clearly interactive; states are unambiguous.

### Phase 3 — Interface: the conversation data model + IPC contract (types + pure logic, no UI)

- [ ] `src/shared/conversation.ts`: define the normalized model (FR-101). A `ConversationTurn`
  discriminated union — `{ kind:'user-prompt', id, ts, text }`, `{ kind:'assistant-text', id, ts,
  markdown }`, `{ kind:'tool-call', id, ts, toolName, argPreview, result? }`, `{ kind:'surface', id,
  ts, requestId?, spec, descriptor?, bindings? }` — plus a `Conversation { sessionId?, turns,
  state:'empty'|'populated' }`. All fields secret-safe (FR-104). NO React/fs import.
- [ ] `src/shared/ipc/conversation.ts` (+ barrel in `ipc.ts`): a new channel set, e.g.
  `ConversationChannel = { Fetch:'conversation:fetch' (R→M req/ack), Update:'conversation:update'
  (M→R push) }`, and the `ConversationApi` (`getDefault(): Promise<ConversationResult>` +
  `onUpdate(listener): () => void`). `ConversationResult` = `{ ok:true, conversation } | { ok:false,
  reason:'empty'|'unreadable' }` (FR-108/FR-112). Payloads carry only the model — no path/token/raw
  line (FR-106).
- [ ] `src/shared/ipc/conversation.validate.ts` (+ barrel in `validate.ts`): pure warn-and-ignore
  validators for every inbound payload at the main boundary (FR-118). A malformed update → dropped.
- [ ] `src/main/transcriptParse.ts` (PURE, node-tested): `parseTranscript(lines: string[]):
  ConversationTurn[]` — line-by-line: `JSON.parse` each (skip a malformed/empty/partial trailing
  line — FR-108), drop noise + sidechain (FR-103), map per FR-102 (user string/text → user-prompt;
  assistant text → assistant-text; assistant tool_use → tool-call, the `render_ui`-family →
  surface carrying `input.spec`; user tool_result → correlate to its tool-call by `tool_use_id`),
  ordered by appearance/`timestamp`. Secret-screen tool args/results into a bounded `argPreview`
  (FR-104). No fs/Electron import (the `.ts`/`.test.ts` split).
- [ ] `src/renderer/cosmosConversation.ts` (PURE, node-tested): the reconcile function (FR-111) —
  given the transcript-sourced `turns` + the current live in-flight entry (from `ui:render` /
  `agent:status`), produce the rendered timeline keyed by turn id so the in-flight provisional entry
  is confirmed/replaced by the transcript on completion (no double-render, no drop).
- [ ] `src/renderer/cosmosTabs.ts` (PURE, node-tested): the tab state (FR-114/FR-115) — a
  `CosmosTab` with a `kind: 'default' | 'favorite'`, the `default` tab pinned + uncloseable, and pure
  ops (`tabs()`, `closeable(tab)`, a future `appendFavorite` shape) so adding favorites is additive.
- [ ] Confirm the live-trigger contract: on a default-target `agent:status` `completed`, MAIN
  re-reads + pushes `conversation:update` (FR-107). No renderer `~/.claude` access (FR-105).

### Phase 4 — Testing (pure logic first)

- [ ] `transcriptParse.test.ts`: a fixture transcript (string[]) with each line type → expected
  turns; a `mcp__cosmos-render-ui__render_ui` tool_use → a `surface` turn carrying `input.spec`; a
  malformed line is skipped, siblings parse; noise + `isSidechain` lines dropped; a tool_result
  correlates to its tool_use by `tool_use_id`; a secret-looking arg is redacted from `argPreview`.
- [ ] `cosmosConversation.test.ts`: an in-flight provisional entry + a later transcript re-read that
  includes the same surface → exactly ONE timeline entry (reconciled by id), earlier turns intact; a
  completed run with NO surface → the provisional entry resolves without leaving a spinner.
- [ ] `cosmosTabs.test.ts`: the default tab is present + `closeable === false`; a `tab:close` against
  the default is a no-op; appending a favorite leaves the default pinned/first and the favorite
  closeable.
- [ ] `conversation.validate.test.ts`: malformed fetch/update payloads are warn-and-ignored; a valid
  one passes.

### Phase 5 — Implementation: main (reader + IPC + live trigger)

- [ ] `src/main/transcriptReader.ts`: resolve the confined path
  (`~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl` from `resolveSandboxDir()` +
  `AgentSessionStore.loadDefaultSessionId()`); read the file streamingly into lines, hand to
  `parseTranscript`, return `ConversationResult` (missing file → `{ok:false,reason:'empty'}`,
  read/parse failure → `{ok:false,reason:'unreadable'}`, never throws — FR-108). NEVER accept a
  renderer path; NEVER read outside the one confined path (FR-105).
- [ ] `src/main/index.ts`: construct the reader (it needs `resolveSandboxDir()` +
  `AgentSessionStore`); register the `conversation:fetch` handler (validated); and on a
  default-target run `completed` (the `AgentRunner` status sink / `renderPushedForRun` path, line
  ~2211 region), re-read + send `conversation:update` to the renderer (FR-107). Optional: a debounced
  `fs.watch` on the resolved jsonl as a secondary trigger (OQ-V2-watch).
- [ ] `src/preload/*`: expose `window.cosmos.conversation` (`getDefault`, `onUpdate`). PRELOAD EDIT —
  the impl session must do a full `npm run dev` restart to exercise it (CLAUDE.md).

### Phase 6 — Implementation: renderer (Cosmos panel timeline + tabs)

- [ ] `src/renderer/CosmosPanel.tsx`: on mount call `window.cosmos.conversation.getDefault()` and
  subscribe to `onUpdate`; feed the result + the live `ui:render` (filtered `target ===
  'generated-ui'`) / `agent:status` / `ui:dataModel` streams through `cosmosConversation.ts`;
  render the reconciled timeline. Prompt bubbles, assistant markdown (sanitized), collapsible
  tool-call rows, and each `surface` turn mounting the EXISTING standard-catalog host
  (`<A2UIProvider catalogId="standard">` + `ActiveTabSurface`-style body) inline (FR-110). Publish the
  composer via `usePublishComposer('cosmos', …)` so Open-Prompt submits route here (FR-113), threading
  the `'generated-ui'` wire target (step-2 path unchanged).
- [ ] Reconciliation (FR-111): the live in-flight `ui:render` is the authority for the in-flight
  turn; on the post-completion `conversation:update`, the provisional in-flight entry is
  confirmed/replaced by the transcript entry (keyed by id) — no double-render. Mark historical
  surfaces as display-only: a control action on a stale historical surface is a no-op against a
  missing live `requestId` (already warn-and-ignored in main) — never an error (Edge Cases).
- [ ] States (FR-112): loading (reading), empty (`reason:'empty'` → idle invite + composer), populated
  (timeline), error (`reason:'unreadable'` → calm recoverable message, composer still usable). Reuse
  `SurfaceSpinner` for the in-flight turn affordance and the `ActiveTabSurface` error boundary per
  surface (SC-103/SC-106).
- [ ] Long-history perf (OQ-V2-perf): mount only on-screen / most-recent surface hosts; collapse
  older surfaces to a header per the design.
- [ ] `src/renderer/CosmosTabStrip.tsx` (or reuse `PanelTabStrip` chrome) driven by `cosmosTabs.ts`:
  render the pinned default tab WITHOUT a close `X`; ensure `tab:close` / middle-click cannot close
  it (FR-114). Wire the strip so future favorited tabs append additively (FR-115) — but build NO
  favorite tab now.
- [ ] `App.tsx`: the Cosmos `TabsContent value="cosmos"` renders `<CosmosPanel active={surface ===
  'cosmos'} />` with the new tab strip; retire the Cosmos panel's use of `useGenerativePanelTabs`
  (FR-116) while leaving the other four panels untouched. Confirm the `tab:*` keyboard shortcuts do
  not act destructively on the pinned default (no close; `tab:new`/`tab:next` either no-op or operate
  only once favorites exist).

### Phase 7 — Verify

- [ ] `npm run typecheck` (node + web) and `npm test` green.
- [ ] Manual (`npm run dev`, after a full restart for the preload method): open Cosmos → full
  conversation shows (prompts, assistant text, tool calls, inline surfaces); submit a command → new
  turn appends live, surface shown once (no double-render); act on the in-flight surface → round-trips;
  act on a historical surface → no-op, no error; restart → conversation persists; empty state (fresh)
  / error state (corrupt the jsonl) render; the default tab has no close affordance and resists
  `tab:close`.
- [ ] Confirm no token/secret/raw-line/path crosses to the renderer (inspect the `conversation:*`
  payloads); all `~/.claude` reads are in main and confined to the one path (SC-107).

### Phase 8 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: extend the Cosmos/Generated-UI sections (§4.4, §4.10, §4.11) and
  add a new sub-section (e.g. §4.x "Cosmos conversation timeline"): the default agent is a persistent
  session (step 2) whose transcript jsonl is read in MAIN by `transcriptReader` (confined to the one
  default-session path), normalized to the `Conversation` model, and pushed to the Cosmos panel over
  the `conversation:*` IPC channel; the panel renders the timeline with inline interactive surfaces,
  reconciles the live `ui:render` in-flight surface (no double-render), and uses a pinned-default tab
  state (forward-compat for favorites) instead of `useGenerativePanelTabs`. Note the wire target stays
  `'generated-ui'`. Add a §7 "Next Steps" entry referencing this v2 spec/plan.
- [ ] Update `docs/PROJECT-STRUCTURE.md`: add `transcriptReader.ts`, `transcriptParse.ts`,
  `conversation.ts`, `ipc/conversation*.ts`, `CosmosPanel.tsx`, `cosmosConversation.ts`,
  `cosmosTabs.ts`, `CosmosTabStrip.tsx`.
- [ ] `wrap-up` reconciles `TODO.md`.

---

## Deviations & Notes

- **2026-06-27**: v2 plan authored (step 3). Chose **`-v2` companion docs** over editing v1 in place
  because step 3 supersedes v1's load-bearing "no transcript / live-stream-only timeline" decision
  (step 2 introduced the persistent transcript), and v1 should stay the historical record of the
  rail swap + persistent session. Recommendations pending user confirm: re-read-on-run-lifecycle live
  trigger (OQ-V2-watch); retire `useGenerativePanelTabs` for the Cosmos panel + new pinned-default tab
  state (OQ-V2-tabsystem); derive transcript path with scan fallback (OQ-V2-pathkey); compact
  collapsible tool-call rows (OQ-V2-toolcalls); no partial-token streaming in step 3 (OQ-V2-stream);
  virtualize/collapse older surfaces (OQ-V2-perf).
- **Design step is REQUIRED** (UI-bearing): timeline chrome + the pinned-default tab strip.
- If Phase 1 finds claude's cwd→folder encoding is not a clean `/`+`.`→`-` transform, switch the
  reader to the scan-fallback and record the exact rule here.
