# Spec: Cosmos Timeline Prompt Context — v1

**Status**: Draft
**Created**: 2026-06-28
**Supersedes**: —
**Related plan**: (to be authored at `.sdd/plans/cosmos-timeline-prompt-context-v1.md`)

---

## Grounding

> Direct investigation run for this spec (mandatory architect grounding). Tools were run by
> the architect, not handed in.

**codegraph_explore queries (one-line takeaways):**

- `ViewContext viewContextCapture contextChipFor ContextChip viewContextGroundingClause` —
  `ViewContext` (`src/shared/ipc/agent.ts`) carries ONLY the in-view ITEM (issue key / channel
  id+name / threadTs / page id+title / event id+title); it does NOT carry the panel id or tab
  label. `contextChipFor`/`ContextChip` derive a display-only `ContextChipData` (the composer
  chip "↳ PROJ-123"). `viewContextGroundingClause` (main) maps `ViewContext` → a grounding
  sentence appended via `--append-system-prompt`, never into the literal utterance.
- `CosmosPanel CosmosTimelineEntry UserBubble cosmosConversation TimelineEntry transcriptReader transcriptParse agentSessionStore` —
  the timeline reads the default-session transcript via `window.cosmos.conversation` (a
  main-owned read), reconciles it with the live in-flight run (`reconcileTimeline`), and renders
  each `ConversationTurn`; the user-prompt turn is `UserBubble` (text only). The live submit is
  seeded in `CosmosPanel`'s `onSubmit` (it has `utterance` in hand) and threads
  `target: 'generated-ui'` via `window.cosmos.agent.submit`.
- `parseTranscript ConversationTurn turn id user-prompt ... agentSessionStore SESSION_SCHEMA_VERSION sessionStore` —
  a `user-prompt` turn's stable `id` is claude's transcript line `uuid` (minted by claude, NOT
  known to cosmos at submit time). `agentSessionStore.ts` persists ONE non-secret value
  (`defaultSessionId`) as plain JSON under `userData` with an injectable fs + atomic
  tmp→rename + defensive load (no schema version — "additive store"); `sessionStore.ts` is the
  versioned (`SESSION_SCHEMA_VERSION`) snapshot store. `TranscriptReader` owns ALL `~/.claude`
  access, confined to the one default-session jsonl path, and never throws across IPC.
- `SurfaceId RAIL_ITEMS railVisibility ComposerConfig captureViewContext composerModeForSurface AgentSubmitPayload` —
  the rail panel id type is `SurfaceId` (`'terminal' | 'cosmos' | 'slack' | 'jira' |
  'confluence' | 'google-calendar'`, `src/renderer/app/railVisibility.ts`); the wire render
  `target` `'generated-ui'` is DISTINCT from the rail id `'cosmos'`. The panel tab strip is
  per-panel session-only state (`PanelTab` label, `§4.11`). The one App-level composer routes to
  the active surface via `ComposerConfig.onSubmit`; `AgentSubmitPayload` already carries the
  optional `viewContext`.

**codegraph_explore queries — this revision (one-line takeaways):**

- `sandboxDir CLAUDE.md groundingPrompt composeGroundingPrompt append-system-prompt buildArgs claude spawn run sandbox working dir` —
  the embedded `claude` is spawned with cwd = `resolveSandboxDir()` (`src/main/index.ts:767` →
  `<userData>/sandbox`, created on-demand via `mkdirSync`). The agent's model-visible instruction
  surface today is the `--append-system-prompt` string assembled by `composeGroundingPrompt`
  (`agentRunner.ts:461`) = `groundingPromptForTarget` (`mcpConfig.ts:421`, per-target render
  rules) + `viewContextGroundingClause` (`viewContextGrounding.ts:30`, the in-view item). There
  is **NO CLAUDE.md currently provisioned in the sandbox cwd** (grep confirms only doc/comment
  references). Since Claude Code auto-loads a project `CLAUDE.md` from its working dir, the
  concrete "cosmos agent's CLAUDE.md" surface for Decision C is a file at
  `<userData>/sandbox/CLAUDE.md` (i.e. `join(resolveSandboxDir(), 'CLAUDE.md')`) that main must
  newly provision — distinct from the append-system-prompt channel.
- `ViewContext` (`src/shared/ipc/agent.ts:43`) — confirmed the concrete non-secret item fields the
  dock descriptor reuses: `selectedIssueKey` (jira), `selectedChannelId`+`selectedChannelName`+
  `threadTs` (slack), `selectedPageId`+`selectedPageTitle` (confluence), `selectedEventId`+
  `selectedEventTitle` (calendar). These are the ONLY fields the marker's `dock` object may carry.

**memory_recall / memory_smart_search queries (takeaways):**

- `cosmos timeline prompt context marker viewContext grounding clause append system prompt` —
  returned the prior REVISED architecture memo (embed-in-prompt mechanism, marker = display/
  persistence, `viewContextGroundingClause` stays authoritative grounding). This revision
  pins the marker syntax and the two-channel relationship that memo left open.
- `cosmos timeline view-context open-prompt context chip submit` / `ViewContext capture panel tab
  dock persistence transcript correlation` — no further stored results.

**Design revision (this version, the FINALIZED user decisions).** Building on the prior
embed-in-prompt revision, the user has now FINALIZED three decisions: (A) the marker syntax is
**pinned** to a trailing `<cosmos:context>…</cosmos:context>` XML-tag block carrying a single JSON
payload, after a blank line (closes Open Question 1); (B) **"one source, two channels"** — the user
considered making the marker the SOLE grounding and correctly **rejected** it (it would couple the
model's grounding to the fragile in-message marker and let the malformed→no-context degrade rule
silently kill grounding too). PromptContext is captured ONCE at submit and fed to TWO channels that
both derive from that one object: the authoritative `viewContextGroundingClause`
(`--append-system-prompt`, UNCHANGED) AND the additive `<cosmos:context>` marker (transcript
persistence + timeline display). The marker is now intentionally **model-visible** as a BONUS
reinforcement, but is NOT the sole grounding, and its failure must NEVER remove grounding (closes
Open Question 2). (C) the embedded cosmos agent's **CLAUDE.md** (provisioned into the sandbox cwd)
MUST document how to interpret the `<cosmos:context>` block so Generated-UI requests are built to
apply to that on-screen context. The earlier rejection of the cosmos-owned sidecar store still
holds (no separate store, no correlation, no `SESSION_SCHEMA_VERSION` concern).

---

## Overview

When the user submits a prompt from any cosmos panel's Open-Prompt composer, the **Cosmos
conversation timeline** should display, alongside that user-prompt turn, the **context that was
active at submit time**: which rail PANEL was active, which TAB within it, and — when a dock /
detail overlay was open — that dock's descriptor (the Slack thread, Confluence page, Jira issue
detail, Calendar event detail, etc.). This context **persists across a full quit/relaunch**, so
re-reading the historical timeline still shows each past prompt's context. The feature exists so
the user can see *what they were looking at* when they asked something, making the conversation
self-explanatory after the fact.

This builds on the existing `ViewContext` (the in-view item already captured at submit and used
for model grounding) and adds the new **panel + tab + dock** dimensions. The design is **one
source, two channels**: PromptContext is captured ONCE at submit, then fed to TWO channels that
both derive from that single object so they can never disagree:

1. **The system-prompt channel (`viewContextGroundingClause` via `--append-system-prompt`) —
   UNCHANGED and AUTHORITATIVE.** This remains the robust, model-actionable grounding that names
   the in-view item with the right read-tool guidance. It has no new error surface and is the SOLE
   source of grounding the model must obey.
2. **The `<cosmos:context>` marker embedded in the user message — ADDITIVE.** The captured context
   is serialized as a compact, non-secret, collision-safe trailing `<cosmos:context>…
   </cosmos:context>` block appended to the utterance after a blank line, so it is recorded in
   claude's own transcript user turn and persists automatically — **no separate cosmos store, no
   correlation by order/text, no schema version**. The Cosmos timeline parser detects and parses
   that marker on each user-prompt turn to render the context affordance, and strips it so the
   bubble shows clean user text. Because the marker rides the same transcript turn as the prompt,
   the context is intrinsically tied to its turn — there is nothing to correlate. The marker is
   ALSO visible to the model in the user turn (an intentional BONUS — it reinforces that a
   Generated-UI request should be built against the in-view dock item), but it is NOT the sole
   grounding: if the marker is malformed/absent, ONLY the timeline display degrades — the
   system-prompt grounding (channel 1) is independent and unaffected.

So the embedded `claude` knows how to read the marker, the cosmos agent's **CLAUDE.md** (the
project instructions the embedded claude runs under in its sandbox working dir) documents that a
trailing `<cosmos:context>` block describes the screen the user is looking at and that a
Generated-UI result should be built to apply to that context (especially the open dock item).

---

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### See the panel + tab a prompt was sent from · P1

**As a** cosmos user
**I want to** see, on each of my prompt bubbles in the Cosmos timeline, which panel and tab I had
active when I sent it
**So that** I can understand the context of my own past questions without remembering it

**Acceptance criteria:**

- Given I am on the Jira panel with a tab labeled "Sprint board" active and I submit a prompt,
  when that prompt appears in the Cosmos timeline, then its user-prompt turn shows a context
  affordance naming the Jira panel and the "Sprint board" tab.
- Given I am on a panel with nothing selected (no dock/detail open), when I submit a prompt, then
  the timeline shows at least the panel and tab dimensions (the dock dimension is absent).
- Given I submit a prompt from the Cosmos panel itself (the docked composer), when it appears,
  then the timeline shows the Cosmos panel + its active tab as the context.

### See the open dock/detail a prompt was sent against · P1

**As a** cosmos user
**I want to** see, when I had a dock/detail open (Slack thread, Confluence page overlay, Jira
issue detail, Calendar event detail) at submit time, that dock named alongside my prompt
**So that** I can tell which specific item I was asking about

**Acceptance criteria:**

- Given I have Jira issue PROJ-123's detail open and submit a prompt, when it appears in the
  timeline, then the context affordance includes the Jira issue PROJ-123 dock dimension in
  addition to panel + tab.
- Given I have a Slack channel open with a thread docked and submit a prompt, when it appears,
  then the context affordance includes the channel and the open thread.
- Given I have a Confluence page overlay open / a Calendar event detail open and submit a prompt,
  when it appears, then the context affordance includes that page / event.

### Context survives quit and relaunch · P1

**As a** cosmos user
**I want to** still see the panel/tab/dock context on my historical prompts after I quit and
reopen cosmos
**So that** the conversation history stays self-explanatory across sessions

**Acceptance criteria:**

- Given I submitted several prompts with different contexts and then fully quit and relaunch
  cosmos, when the Cosmos timeline re-reads the transcript, then each historical user-prompt turn
  still shows the context it was submitted with (parsed from that turn's embedded marker).
- Given a historical prompt whose turn carries no marker (pre-feature, or a marker absent/
  malformed), when it renders, then it shows no context affordance (the bubble renders exactly as
  today) — never an error, never a wrong context.

### Context never shows a stale or mismatched item · P2

**As a** cosmos user
**I want to** trust that the context shown belongs to the prompt it sits on
**So that** I am never misled by a context attributed to the wrong turn

**Acceptance criteria:**

- Given two prompts with identical text submitted under different contexts, when they render in
  the timeline, then each shows the context it was actually submitted with — because each turn
  carries its OWN embedded marker, there is no cross-turn attribution to get wrong.
- Given a user-prompt turn whose embedded marker is malformed or only partially present, when the
  timeline renders, then that turn degrades to no context (plain bubble) rather than showing a
  guessed or partial context — never a crash.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### Capture (renderer, at submit)

| ID     | Requirement                                                                                                                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | On every Open-Prompt submit from any panel (Terminal excluded — it has no composer; Cosmos, Slack, Jira, Confluence, Calendar, Generated-UI included), the system MUST capture a **PromptContext** describing the active panel, the active tab, and any open dock at that instant. |
| FR-002 | The PromptContext MUST include a **panel** dimension: the active rail `SurfaceId` (`cosmos`/`slack`/`jira`/`confluence`/`google-calendar`/`terminal`) and a display label for it.                                                                                              |
| FR-003 | The PromptContext MUST include a **tab** dimension: the active tab's id and its current display label within that panel. When the panel has no tab concept active (e.g. a panel showing its zero-tab native base), the tab dimension MAY be absent.                             |
| FR-004 | The PromptContext MUST include a **dock** dimension ONLY when a dock/detail overlay is open at submit time, carrying a non-secret descriptor of that dock (its kind + the item's display label/id). When nothing is open, the dock dimension MUST be absent.                    |
| FR-005 | The dock descriptor MUST reuse the existing in-view item identifiers already captured as `ViewContext` (issue key / channel id+name / threadTs / page id+title / event id+title) — the PromptContext **extends** `ViewContext` with the new panel + tab dimensions; it MUST NOT introduce a parallel, divergent item shape. |
| FR-006 | When there is genuinely nothing in view (no dock, no selection), the captured PromptContext MUST still carry the panel and (when present) tab dimensions, so the timeline shows at least "which panel / which tab".                                                              |
| FR-007 | The PromptContext MUST be derived ENTIRELY from view state the renderer already holds at submit (the active surface id, the active tab record, the panel's existing selection/dock state). It MUST NOT trigger any new fetch, new tracking, or new subscription.                |

### Contract (shared, non-secret)

| ID     | Requirement                                                                                                                                                                                                                                            |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-008 | Every field of PromptContext MUST be a **non-secret** display/identity label the renderer already legitimately shows on screen. It MUST NEVER carry a token, OAuth secret, credential, file path, `~/.claude` location, or raw transcript line. This applies to the EMBEDDED marker too — the serialized marker MUST contain only these non-secret fields. |
| FR-009 | The PromptContext type and the marker's serialize/parse helpers MUST live in shared, reused code (the typed contract module + a pure `.ts` serializer/parser) reused identically by capture/embed and parse/strip — no duplicated shape, no ad-hoc string assembly at the call sites. |
| FR-010 | The marker serialization MUST be defensive at every layer: a missing/oversized/wrong-shape PromptContext at submit MUST NOT block the submit (the prompt is sent without a marker); a malformed marker at parse MUST be dropped (warn-and-ignore) — never a crash. |

### Embed at submit (renderer → prompt → claude transcript)

| ID     | Requirement                                                                                                                                                                                                                                                                                |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-011 | At submit, the system MUST serialize the captured PromptContext into the marker and **embed it into the utterance string** sent to claude (via the existing `agent.submit` path), so the marker is recorded in claude's transcript user turn and persists across quit/relaunch for free. The system MUST NOT write into, annotate, or otherwise mutate claude's transcript jsonl directly. |
| FR-012 | The marker format is **PINNED** to a trailing **XML-tag block** delimited by the literal `<cosmos:context>` … `</cosmos:context>` tag pair. This delimiter is collision-safe against normal user text (extraordinarily unlikely in a hand-typed prompt) and Claude treats XML tags as structured context. The inner payload MUST be a single compact **JSON object** carrying ONLY non-secret fields: `panel` `{id,label}` (always present), `tab` `{id,label}` (OMITTED when absent), and `dock` `{kind, …ViewContext item id/label fields}` (OMITTED when no dock is open). Example: `{"panel":{"id":"jira","label":"Jira"},"tab":{"id":"t1","label":"Sprint board"},"dock":{"kind":"jira-issue","key":"PROJ-123","label":"Login bug"}}`. |
| FR-013 | The marker MUST be **position-pinned to the TRAILING end** of the utterance: the user's prose first, then a **blank line**, then the `<cosmos:context>` block. It MUST survive multi-line utterances unchanged (newlines/blank lines in the prose do not affect the trailing block), and MUST round-trip the `panel`, `tab` (when present), and `dock` (when a dock is open) fields exactly. The trailing position guarantees that — even if the model echoes or ignores the block — the user's intended instruction is the prose that precedes it, not the marker. |
| FR-014 | Parse/strip MUST be a **regex anchored to the trailing tag block** (e.g. `/\n*<cosmos:context>[\s\S]*?<\/cosmos:context>\s*$/`), then `JSON.parse` + **schema-validate** the inner payload (panel present with id+label; tab/dock optional but, when present, correctly shaped). ANY failure — missing tag, bad JSON, wrong shape, or partial fields — MUST drop the WHOLE block to no-context (FR-020) AND still strip a dangling/partial trailing tag from the displayed text so the raw marker is never shown (FR-025). |
| FR-015 | The embedded marker MUST be **non-secret** (FR-008). It is now intentionally **model-visible** as an ADDITIVE BONUS (it reinforces that a Generated-UI request should be built against the in-view dock item) — it is NO LONGER framed as strictly inert/display-only. However it is **NOT the sole grounding**: the authoritative, model-actionable grounding remains `viewContextGroundingClause` (`--append-system-prompt`, FR-017). The marker MUST be shaped as structured CONTEXT, not a second imperative directive, so the two channels reinforce rather than conflict or double-instruct. |
| FR-016 | The spec only requires fidelity of the **user-prompt turn as recorded by claude** (claude records the submitted user text verbatim in the user turn); the parser reads that turn, so the marker is present exactly as embedded regardless of how the model alters the conversation downstream. |

### Grounding reconciliation

| ID     | Requirement                                                                                                                                                                                                                                                                                |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-017 | **One source, two channels.** PromptContext MUST be captured ONCE at submit and fed to BOTH (a) `viewContextGroundingClause` (`--append-system-prompt`) and (b) the `<cosmos:context>` marker, BOTH derived from that single object so they can never disagree. Channel (a) is **UNCHANGED, authoritative, and the SOLE grounding the model must obey** — it names the in-view item with the right read-tool guidance and has no new error surface. Channel (b) is **ADDITIVE**: it persists the context for the timeline AND is a model-visible reinforcement, but it is NOT authoritative. The marker MUST NOT be the sole grounding, and the marker's degrade rule (FR-020) MUST affect **ONLY timeline display — never the system-prompt grounding** (a malformed/absent marker MUST NOT remove or weaken channel (a)). The two channels MUST NOT double-instruct: the marker reads as structured context, the clause carries the actionable directive. |
| FR-018 | The marker MAY carry the new **panel/tab** dimensions (which `viewContextGroundingClause` does not), because the marker is now model-visible context as well as timeline data; but panel/tab MUST remain non-actionable (shown to the user, and at most contextual reinforcement to the model) — they MUST NOT become new imperative model instructions, and they MUST NOT alter the authoritative grounding in channel (a). The non-secret invariant (FR-008) applies identically across BOTH channels. |

### Embedded-agent documentation (cosmos agent CLAUDE.md)

| ID     | Requirement                                                                                                                                                                                                                                                                                |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-026 | The embedded cosmos `claude` engine MUST be **told how to interpret** the `<cosmos:context>` block. Concretely: the embedded agent's project-instruction surface is a **`CLAUDE.md` in its sandbox working dir** — the cwd it is spawned in, `resolveSandboxDir()` → `<userData>/sandbox` (`src/main/index.ts:767`); Claude Code auto-loads a `CLAUDE.md` from that cwd. **No such file is provisioned there today**, so main MUST newly provision/maintain `join(resolveSandboxDir(), 'CLAUDE.md')` (or otherwise ensure the embedded agent's CLAUDE.md carries this guidance). |
| FR-027 | That CLAUDE.md MUST document that a **trailing `<cosmos:context>` block describes the screen context the user is looking at** — the active panel/tab and any open dock item — and that when the user requests Generated UI, the result MUST be built to **apply to that context, especially the open dock item** (e.g. a request with `dock:{kind:"jira-issue",key:"PROJ-123"}` should produce a surface about PROJ-123). It MUST frame the block as context to read, NOT a literal instruction to echo, and MUST NOT instruct leaking the block's contents back to the user or into any surface. The documented fields MUST match the pinned non-secret shape (FR-012) and MUST NOT imply any secret field exists. |

### Parse, strip, render (Cosmos timeline)

| ID     | Requirement                                                                                                                                                                                                                                                                                                |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-019 | When normalizing the transcript (`transcriptParse.ts` / the Cosmos conversation mapper), each **user-prompt** turn MUST be inspected for an embedded marker; when a well-formed marker is found, its parsed PromptContext MUST be attached to that turn's normalized model, and the marker MUST be **stripped** from the turn's displayed `text` so the bubble shows clean user prose. |
| FR-020 | An **absent or malformed** marker MUST degrade to **no context** for that turn (the plain bubble), with the full original text shown unmodified — never a crash, never a guessed/partial context (warn-and-ignore boundary rule). A partially-parseable marker (some fields valid, some not) MUST be treated as malformed → no context (no partial chip). |
| FR-021 | A user-prompt turn with no parsed PromptContext MUST render exactly as it does today (the plain `UserBubble`), with no empty/placeholder context affordance. |
| FR-022 | The timeline MUST render the parsed PromptContext as a quiet, informational affordance attached to the user-prompt turn, **visually consistent with the existing composer `ContextChip`** (the "↳ item" treatment). The exact visual treatment is owned by the designer in a later step; this spec fixes only the dimensions shown (panel, tab, dock) and the empty/partial states. |
| FR-023 | The render affordance MUST show the **panel** dimension always (when context is present), the **tab** dimension when present, and the **dock** dimension only when a dock was open — matching the captured shape (FR-002..FR-004). |
| FR-024 | The LIVE in-flight prompt (the just-submitted turn shown before the transcript confirms it) SHOULD show the same PromptContext it was submitted with, so the context appears immediately on submit and remains stable once the turn is confirmed from the transcript. The live path SHOULD use the captured PromptContext object directly (it is in hand at submit), not re-parse its own marker. The displayed LIVE bubble text MUST also be clean (marker-free), consistent with the historical bubble. |
| FR-025 | The marker stripping MUST be robust to a marker the model or transcript preserved verbatim; the timeline MUST NEVER display the raw marker text to the user in any turn (user, assistant, or otherwise) — if a marker ever appears in a NON-user turn (e.g. the model echoed it), the timeline SHOULD still avoid surfacing the raw marker syntax, degrading to plain display. |

---

## Edge Cases & Constraints

- **Identical prompt text, different context.** Two prompts with the same text but different
  contexts each carry their OWN marker on their OWN transcript turn, so there is no cross-turn
  attribution to get wrong — each renders its own context (no ordinal/correlation needed).
- **Malformed / partial marker.** A marker that is malformed, truncated, or only partially
  parseable MUST degrade to no-context (plain bubble) for that turn — never a partial chip, never
  a crash (FR-020).
- **Marker-like text typed by the user.** Because the marker uses the reserved `<cosmos:context>`
  tag pair and is anchored to the trailing end (FR-012/FR-014), ordinary prose — including prose
  that mentions panels/tabs or contains brackets — MUST NOT be mis-parsed as a marker. If a user
  somehow types a `<cosmos:context>` tag, the JSON-parse + schema-validate (FR-014) MUST still fail
  safe to no-context rather than show a wrong context, and the trailing tag MUST still be stripped
  from the displayed text (FR-025).
- **Grounding survives marker failure (the key two-channel guarantee).** A malformed, absent, or
  partial marker degrades ONLY the timeline display to no-context — it MUST NEVER remove or weaken
  the authoritative system-prompt grounding (`viewContextGroundingClause`), which is an independent
  channel derived from the same captured PromptContext (FR-017). The model is never left ungrounded
  by a marker problem.
- **Multi-line prompts.** A marker MUST parse correctly and strip cleanly regardless of newlines
  or blank lines in the user's prompt (FR-013), leaving the multi-line prose intact in the bubble.
- **Pre-feature history.** Prompts submitted before this feature shipped carry no marker; those
  historical turns render with no context (graceful, expected) (FR-020/FR-021).
- **Terminal panel.** The Terminal panel has no Open-Prompt composer and submits no agent
  prompts, so it never captures, embeds, or shows a PromptContext.
- **Dock closed / tab renamed after submit.** The marker is a SNAPSHOT serialized into the prompt
  at submit time; closing the dock or renaming the tab afterward does NOT change the historical
  context shown — the marker is immutable once embedded in the transcript turn.
- **Marker is model-visible by design, but not a directive.** The marker IS visible to the model
  in the user turn (an intentional BONUS reinforcing that Generated UI applies to the in-view dock
  item — FR-015), but it is structured CONTEXT, not an imperative; the user's prose remains the
  instruction, and the actionable in-view grounding stays in `viewContextGroundingClause` (FR-017),
  so the model is not double-instructed. The cosmos agent's CLAUDE.md (FR-026/FR-027) teaches the
  embedded engine to read the block as screen context rather than echo it.
- **Embedded agent must understand the block.** If the sandbox CLAUDE.md does NOT document the
  `<cosmos:context>` block, the embedded engine may not build Generated UI against the in-view dock
  item; FR-026/FR-027 make documenting it a hard requirement, targeting the concrete sandbox-cwd
  CLAUDE.md surface.
- **Raw marker never shown to the user.** The timeline MUST never surface the raw marker syntax in
  any rendered turn (FR-025); a marker that survived verbatim is stripped (user turn) or
  suppressed (any other turn).
- **Non-secret invariant is absolute.** No field of PromptContext, in capture, embed (marker), IPC
  payload, parse, or render, may carry a token/secret/path/raw line (FR-008). This is the same rule
  that already governs `ViewContext`.
- **Out of scope (explicitly):** any cosmos-owned sidecar store or order/text correlation
  (REMOVED — superseded by the in-prompt embed); changing `viewContextGroundingClause`'s actionable
  grounding behavior (it is UNCHANGED and remains the authoritative grounding — the marker is the
  additive second channel, never a replacement);
  editing/annotating claude's transcript directly; showing context on assistant/tool/surface turns
  (only user-prompt turns get context); cross-session context (only the default session's
  timeline); retroactively backfilling context for pre-feature prompts; any new fetch or new
  tracking to enrich context beyond what the panel already holds; any `SESSION_SCHEMA_VERSION`
  change (no store, so none needed).

---

## Success Criteria

| ID     | Criterion                                                                                                                                                                                       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | Submitting a prompt from a panel with an open dock shows panel + tab + dock on that prompt's timeline bubble; with no dock open it shows panel + tab; with nothing in view it shows at least panel (+ tab when present). |
| SC-002 | After a full quit/relaunch, every historical user-prompt turn that was submitted with a marker still shows that exact context, parsed from the transcript turn (no separate store involved).    |
| SC-003 | A user-prompt turn with no marker (or a malformed one) renders identically to today's plain bubble — no error, no placeholder, no wrong context — with the marker stripped from the shown text. |
| SC-004 | Two identical-text prompts submitted under different contexts each show their own context; there is no cross-turn attribution because each turn carries its own marker.                          |
| SC-005 | A malformed, truncated, or partial marker never crashes main or the renderer; the affected turn degrades to no-context and the timeline otherwise behaves exactly as today.                      |
| SC-006 | No token, secret, OAuth credential, file path, or raw transcript line ever appears in the PromptContext OR the embedded marker at any layer (capture, embed, IPC, parse, render).               |
| SC-007 | The raw marker syntax is never displayed to the user in any timeline turn; the user-prompt bubble shows clean prose, and `SESSION_SCHEMA_VERSION` is unchanged (no store exists).               |
| SC-008 | The marker is the pinned trailing `<cosmos:context>{…JSON…}</cosmos:context>` block (FR-012/FR-013): an embedded marker round-trips `panel` (always), `tab` (when present), and `dock` (when a dock is open, reusing the ViewContext item id/label fields) exactly, with the JSON omitting absent dimensions; while a corpus of ordinary multi-line prompts (including ones mentioning panels/tabs/brackets) parses as no-marker. The strip regex (`/\n*<cosmos:context>[\s\S]*?<\/cosmos:context>\s*$/`) leaves the prose intact and removes even a malformed/dangling trailing tag. |
| SC-009 | The timeline's context affordance is visually consistent with the existing composer `ContextChip` (the "↳ item" treatment), pending the designer's exact treatment.                            |
| SC-010 | **Grounding survives marker failure.** With a malformed/absent/partial marker, the user-prompt turn shows no context (plain bubble) AND the model still receives the full authoritative `viewContextGroundingClause` grounding — the two channels are independent (FR-017); no marker problem ever leaves the model ungrounded. |
| SC-011 | The captured PromptContext feeds BOTH channels from ONE object: the system-prompt clause and the embedded marker name the SAME in-view item (they can never disagree), and the non-secret invariant holds across both (FR-008/FR-017/FR-018). |
| SC-012 | The cosmos agent's CLAUDE.md (provisioned at the sandbox cwd, `join(resolveSandboxDir(), 'CLAUDE.md')`) documents that a trailing `<cosmos:context>` block is the user's screen context and that Generated-UI output should be built to apply to it (especially the open dock item); the documented fields match the pinned non-secret shape and reference no secret field (FR-026/FR-027). |

---

## Open Questions

> The two prior OQs (correlation tie-breaking; sidecar retention/pruning) are MOOT under the
> in-prompt embed mechanism — there is no store to correlate or prune. Removed.

- [x] **RESOLVED — Exact marker syntax + placement.** PINNED (FR-012/FR-013/FR-014): a TRAILING
  `<cosmos:context>` … `</cosmos:context>` XML-tag block, after a blank line, carrying a single
  compact JSON object (`panel` always; `tab`/`dock` omitted when absent; dock reuses the
  ViewContext item id/label fields). Parse/strip = the trailing-anchored regex
  `/\n*<cosmos:context>[\s\S]*?<\/cosmos:context>\s*$/` + `JSON.parse` + schema-validate; any
  failure → drop the whole block to no-context and still strip a dangling tag. The plan tests this
  against an ordinary-prose corpus (SC-008).
- [x] **RESOLVED — Marker is model-visible by design (not the sole grounding).** The user
  considered making the marker the sole grounding and correctly rejected it. Final design: "one
  source, two channels" (FR-017) — the marker IS visible to the model as an additive reinforcement,
  but `viewContextGroundingClause` (`--append-system-prompt`) remains the independent, authoritative
  grounding, and a marker failure degrades ONLY timeline display, never grounding. The embedded
  engine is taught to read the block via the cosmos agent's sandbox-cwd CLAUDE.md (FR-026/FR-027).
  No remaining ambiguity for v1.
