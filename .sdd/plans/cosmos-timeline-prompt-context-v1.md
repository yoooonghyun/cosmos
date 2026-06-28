# Plan: Cosmos Timeline Prompt Context — v1

**Status**: Draft
**Created**: 2026-06-28
**Last updated**: 2026-06-28
**Spec**: `.sdd/specs/cosmos-timeline-prompt-context-v1.md` (APPROVED)

---

## Grounding

> Direct investigation run by the architect for THIS plan (tools run here, not handed in).

**codegraph_explore queries (one-line takeaways):**

- `ViewContext viewContextCapture contextChipFor ContextChip viewContextGroundingClause AgentSubmitPayload` —
  `ViewContext` (`src/shared/ipc/agent.ts:43`) carries ONLY the in-view dock item (issue key /
  channel id+name / threadTs / page id+title / event id+title); NO panel/tab. `AgentSubmitPayload`
  (same file) already carries `{utterance, target?, viewContext?}`. `contextChipFor` /
  `ContextChip` (`src/renderer/app/viewContextCapture.ts:136`, `src/renderer/app/ContextChip.tsx`)
  derive the composer's display-only "↳ item" chip from a `ViewContext` — directly reusable for the
  timeline dock dimension. `viewContextGroundingClause` (`src/main/generative/viewContextGrounding.ts:30`)
  maps a `ViewContext` → the `--append-system-prompt` grounding sentence (channel (a), to stay UNCHANGED).
- `CosmosPanel onSubmit cosmosConversation transcriptParse ConversationTurn UserBubble CosmosTimelineEntry reconcileTimeline` —
  the Cosmos timeline reads the default-session transcript (`window.cosmos.conversation.getDefault`),
  reconciles it with the live in-flight run (`reconcileTimeline`, `src/renderer/cosmos/cosmosConversation.ts:60`),
  and renders each `ConversationTurn` via `CosmosTimelineEntry` (`UserBubble` = text only). The Cosmos
  submit chokepoint is `CosmosPanel.tsx` `usePublishComposer('cosmos', { onSubmit })` (line ~142):
  `lastPromptRef.current = utterance; setLive({phase:'generating', promptText: utterance});
  window.cosmos.agent.submit({ utterance, target:'generated-ui' })`.
- `transcriptParse parseTranscript ConversationTurn user-prompt turn id text` — `parseTranscript`
  (`src/main/fs/transcriptParse.ts:121`) builds `UserPromptTurn` (`src/shared/types/conversation.ts:29`)
  in TWO branches: string `message.content` (line 157) and text-block content (line 181). Both set
  `text` verbatim — these are the strip/parse insertion points. `id` = claude's transcript line `uuid`.
- `usePublishComposer activeComposer ComposerConfig captureViewContext useGenerativePanelTabs PanelTab activeTabId railVisibility SurfaceId` —
  the four integration panels (jira/slack/confluence/google-calendar) submit through
  `useGenerativePanelTabs.submit` (`src/renderer/tabs/useGenerativePanelTabs.ts:526`), which captures
  `viewContext` LIVE at send time via `getViewContextRef.current?.()` then calls
  `window.cosmos.agent.submit({ utterance, target, viewContext })` (line 576). The hook already holds
  `target` (= the rail `SurfaceId` for these 4 panels), `panelName`, `tabs`, `activeTabId` — every
  PromptContext dimension is in hand here. Rail id type `SurfaceId` lives in
  `src/renderer/app/railVisibility.ts` (renderer-only).
- `composeGroundingPrompt agentRunner resolveSandboxDir spawn claude AgentChannel.Submit validateAgentPrompt` —
  the embedded `claude` is spawned cwd = `resolveSandboxDir()` (`src/main/index.ts:767` → `<userData>/sandbox`,
  `mkdirSync` on demand); NO `CLAUDE.md` is provisioned there today. The `agent:submit` handler
  (`src/main/index.ts:1435`) runs `validateAgentPrompt` (`src/shared/ipc/agent.validate.ts:79`) then
  `agentRunner.run(utterance, target, viewContext)` — the marker rides INSIDE `utterance`, so NO IPC
  contract change is needed for the wire (utterance is just longer; `viewContext` unchanged).

**memory_recall / memory_smart_search (takeaways):**

- `cosmos timeline prompt context two channels marker grounding ...` — recalled the FINALIZED
  architecture memo (`mem_mqxjrsr7…`) confirming the three pinned decisions (A marker syntax,
  B one-source-two-channels, C sandbox CLAUDE.md at `join(resolveSandboxDir(),'CLAUDE.md')`). This
  plan turns those into build steps; it re-opens nothing.

---

## Summary

Capture a **PromptContext** (panel + tab + optional dock) ONCE in the renderer at every Open-Prompt
submit, then feed it to TWO channels derived from that single object (spec FR-017): (a) the EXISTING
`viewContext` IPC field → `viewContextGroundingClause` → `--append-system-prompt` — **UNCHANGED and
authoritative**; and (b) a trailing `<cosmos:context>{json}</cosmos:context>` marker **appended to the
utterance string** so claude records it in the transcript user turn (free quit/relaunch persistence) and
the model sees it as additive reinforcement. A new **pure, shared marker codec** (`src/shared/promptContext/`)
serializes the marker at submit and parses+strips it at read; `parseTranscript` (main) runs the parser per
user-prompt turn, attaching the PromptContext to `UserPromptTurn.context` and stripping the marker from the
displayed text. The Cosmos timeline renders the context as a read-only chip (reusing the composer
`ContextChip` "↳ item" treatment, exact look owned by the **design step**). Main newly provisions
`<userData>/sandbox/CLAUDE.md` documenting how the embedded engine should read the block. All fields are
non-secret; every layer degrades warn-and-ignore (a malformed/absent marker affects ONLY timeline display,
never grounding — channels are independent).

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (Electron main + React renderer + shared) |
| Key dependencies  | Existing only — `ViewContext`/`AgentSubmitPayload` (`src/shared/ipc/agent.ts`), `ConversationTurn` (`src/shared/types/conversation.ts`), `parseTranscript` (`src/main/fs/transcriptParse.ts`), `useGenerativePanelTabs` + `CosmosPanel` submit paths, `contextChipFor`/`ContextChip` (renderer), `resolveSandboxDir` (`src/main/index.ts`). No new runtime deps. |
| Files to create   | `src/shared/promptContext/promptContext.ts`, `src/shared/promptContext/promptContextMarker.ts`, `src/shared/promptContext/promptContextMarker.test.ts`, `src/shared/promptContext/buildAgentSubmit.ts`, `src/shared/promptContext/buildAgentSubmit.test.ts`, `src/main/agent/sandboxClaudeMd.ts`, `src/main/agent/sandboxClaudeMd.test.ts`, `src/main/fs/transcriptParse.test.ts`, `src/renderer/cosmos/PromptContextChip.tsx`, `src/renderer/cosmos/PromptContextChip.dom.test.tsx`, `.sdd/designs/cosmos-timeline-prompt-context-v1.md` |
| Files to modify   | `src/shared/types/conversation.ts`, `src/main/fs/transcriptParse.ts`, `src/main/index.ts`, `src/renderer/tabs/useGenerativePanelTabs.ts`, `src/renderer/cosmos/CosmosPanel.tsx`, `src/renderer/cosmos/cosmosConversation.ts`, `src/renderer/cosmos/cosmosConversation.test.ts`, `src/renderer/cosmos/CosmosTimelineEntry.tsx`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md` (design-criteria entry) |

---

## Technical Approach (the how)

### A. Shared contract + pure codec (FR-005, FR-008, FR-009, FR-010, FR-012, FR-014)

`src/shared/promptContext/promptContext.ts` — the shared, non-secret types (importable by main +
renderer, NO renderer/Electron deps):

```ts
import type { ViewContext } from '../ipc/agent'

/** Rail panels that own an Open-Prompt composer (terminal excluded). Mirrors the renderer SurfaceId
 *  subset; declared here so shared stays free of a renderer import (SurfaceId is assignable to this). */
export type PromptPanelId = 'cosmos' | 'slack' | 'jira' | 'confluence' | 'google-calendar'

export type DockKind = 'jira-issue' | 'slack-channel' | 'confluence-page' | 'calendar-event'

/** Non-secret snapshot of what the user was looking at at submit. EXTENDS the in-view ViewContext
 *  with panel + tab; the dock REUSES the existing ViewContext item fields (FR-005 — no parallel shape). */
export interface PromptContext {
  panel: { id: PromptPanelId; label: string }
  tab?: { id: string; label: string }
  /** Present ONLY when a dock/detail is open. `kind` is the discriminator (derived from panel.id);
   *  the remaining fields are the POPULATED ViewContext item fields, verbatim (FR-005/FR-007). */
  dock?: { kind: DockKind } & ViewContext
}
```

`src/shared/promptContext/promptContextMarker.ts` — the PINNED codec, pure + node-tested:

- `const CONTEXT_TAG = 'cosmos:context'` and `MARKER_RE = /\n*<cosmos:context>[\s\S]*?<\/cosmos:context>\s*$/`
  (FR-014 — the exact trailing-anchored regex from SC-008).
- `serializePromptContextMarker(ctx: PromptContext): string` → `\n\n<cosmos:context>{json}</cosmos:context>`
  where `{json}` carries `panel` (always), `tab` (omitted when absent), `dock` (omitted when absent), with
  the dock's empty/undefined ViewContext fields stripped. Defensive: a missing/wrong-shape ctx or an
  oversized serialization (cap ~4 KB) returns `''` so the caller appends nothing (FR-010).
- `parsePromptContextMarker(text: string): { context?: PromptContext; text: string }` → match `MARKER_RE`;
  if no match return `{ text }` unchanged. On match: `JSON.parse` the inner payload, then
  **schema-validate** (panel.id ∈ PromptPanelId + panel.label non-empty string; tab, when present, has
  string id+label; dock, when present, has a known `kind` + ≥1 populated string field). ANY failure
  (missing tag fragment, bad JSON, wrong shape, partial fields) → drop the WHOLE block to no-context AND
  still return `text` with the trailing tag stripped (so a dangling/partial `<cosmos:context>` is never
  shown — FR-014/FR-020/FR-025). A non-empty inner that parses + validates → `{ context, text: stripped }`.
- The dock-kind ↔ panel-id mapping (`jira→jira-issue`, etc.) lives here as the single source so capture
  and render agree.

> **Pinned plan detail (resolves an apparent spec tension):** FR-012's example `dock:{kind:"jira-issue",
> key,label}` and FR-027's example use illustrative field names; the AUTHORITATIVE requirement is
> FR-005/FR-007/SC-008 — the dock reuses the EXISTING `ViewContext` item fields with NO new field and NO
> new fetch. So the dock object carries the real ViewContext field names (`selectedIssueKey`,
> `selectedChannelId`+`selectedChannelName`+`threadTs`, `selectedPageId`+`selectedPageTitle`,
> `selectedEventId`+`selectedEventTitle`) plus a `kind`. Jira's ViewContext has only the issue KEY (no
> title), so a jira dock is `{kind:'jira-issue', selectedIssueKey}` — no fabricated label. The CLAUDE.md
> (step below) documents the block conceptually, not a divergent field list.

### B. One-source-two-channels submit builder (FR-011, FR-013, FR-016, FR-017)

`src/shared/promptContext/buildAgentSubmit.ts` — the pure chokepoint both submit paths call:

```ts
buildAgentSubmitWithMarker(utterance: string, target: UiRenderTarget, ctx?: PromptContext): AgentSubmitPayload
```

Returns `{ utterance: utterance + serializeMarker(ctx), target, viewContext: ctx?.dock-as-ViewContext }`:
- Channel (b): append the marker (or nothing on defensive failure) — TRAILING, after a blank line (FR-013).
- Channel (a): derive `viewContext` = the dock's ViewContext fields (strip the `kind`) → the EXACT
  ViewContext shape `agent.submit` already sends today, so grounding is byte-identical and UNCHANGED
  (FR-017). Always set the viewContext field from `ctx.dock` REGARDLESS of whether the marker
  serialized — so a dropped/oversized marker never weakens grounding (SC-010/SC-011).
- Pure + node-tested (no DOM/IPC). The raw `utterance` (pre-marker) is what the caller keeps for the
  live bubble (FR-024 — the live display text stays clean).

### C. Capture sites (FR-001..FR-007)

- **Integration panels** (`src/renderer/tabs/useGenerativePanelTabs.ts`, `submit`): after the existing
  `viewContext = getViewContextRef.current?.()` capture (line ~563), build the PromptContext from data the
  hook already holds — `panel:{ id: target as PromptPanelId, label: panelName }`, `tab:` the active tab
  `{id,label}` from `tabs.find(t=>t.id===activeTabId)` (omit when none), `dock:` the captured
  `viewContext` tagged with its `kind` (omit when no viewContext). Apply the SAME `contextDismiss`
  ('all'/'thread') logic to the dock BEFORE building (so a dismissed chip drops the dock from BOTH
  channels consistently). Replace the line-576 `window.cosmos.agent.submit({...})` with
  `window.cosmos.agent.submit(buildAgentSubmitWithMarker(utterance, target, promptContext))`. For these
  four panels `target === SurfaceId`, so `panel.id` is correct; `panelName` is the existing label.
- **Cosmos panel** (`src/renderer/cosmos/CosmosPanel.tsx`, `onSubmit`): build
  `promptContext = { panel:{ id:'cosmos', label:'Cosmos' }, tab:{ id: tabsState.activeTabId, label } }`
  (no dock — the Cosmos panel has no dock/selection). Keep `lastPromptRef.current = utterance` and
  `promptText: utterance` as the RAW (marker-free) text; pass `promptContext` into `setLive` (see D);
  submit `window.cosmos.agent.submit(buildAgentSubmitWithMarker(utterance, 'generated-ui', promptContext))`.

### D. Live in-flight render (FR-024)

- `src/renderer/cosmos/cosmosConversation.ts`: add `promptContext?: PromptContext` to the
  `LiveInFlight` `'generating'`/`'surface'` variants and to the `live-generating` `TimelineEntry`. The
  panel passes the captured object directly (no re-parse of its own marker).
- `CosmosPanel` threads the captured `promptContext` into `setLive` at both the seed (onSubmit) and the
  `agent:status 'started'` path (carry it on the same ref as `lastPromptRef`).

### E. Parse + strip in the transcript mapper (FR-019, FR-020, FR-021, FR-025)

- `src/shared/types/conversation.ts`: add `context?: PromptContext` to `UserPromptTurn` (non-secret;
  crosses the existing `conversation:*` channel unchanged otherwise).
- `src/main/fs/transcriptParse.ts` `parseTranscript`: in BOTH user-prompt branches (string content line
  ~157, text-block line ~181), run `parsePromptContextMarker(text)`; push
  `{ kind:'user-prompt', id, ts, text: parsed.text, ...(parsed.context ? { context: parsed.context } : {}) }`.
  Absent/malformed → `context` omitted, `text` = original (or trailing-tag-stripped) — plain bubble
  (FR-020/FR-021). Defensive (FR-025): if a `<cosmos:context>` block ever appears in a NON-user turn
  (assistant/tool text), strip it from the displayed text without attaching context — the raw marker is
  never surfaced in any turn. Keep the existing empty-text skip semantics (a turn that is ONLY a marker
  with no prose still parses to context with empty text → skip rendering an empty bubble but the marker
  must never show).

### F. Timeline chip (FR-022, FR-023 — after the design step)

- `src/renderer/cosmos/PromptContextChip.tsx`: a read-only presentational component taking a
  `PromptContext` (returns null when undefined — FR-021). Renders the **panel** dimension always, **tab**
  when present, **dock** only when present. Reuse `contextChipFor(panel.id, dock)` →
  `ContextChip`-style "↳ item" treatment for the dock dimension (SC-009 visual consistency); panel/tab
  badges per the **designer's** spec. NO remove controls (read-only history).
- `src/renderer/cosmos/CosmosTimelineEntry.tsx`: render `<PromptContextChip context={turn.context} />`
  with the `UserBubble` for `user-prompt` turns, and `<PromptContextChip context={entry.promptContext} />`
  with the `live-generating` bubble. The bubble text stays the (clean) `turn.text` / raw `promptText`.

### G. Embedded-agent CLAUDE.md (FR-026, FR-027 — Decision C)

- `src/main/agent/sandboxClaudeMd.ts`: export `SANDBOX_CLAUDE_MD` (a string constant documenting that a
  trailing `<cosmos:context>` block describes the user's on-screen context — active panel/tab + any open
  dock item — and that a Generated-UI result MUST be built to apply to that context, especially the dock
  item; frame it as context to READ, not to echo or leak; reference only the non-secret pinned shape) and
  `provisionSandboxClaudeMd(dir: string, fs?)` that writes `join(dir, 'CLAUDE.md')` (injectable fs;
  idempotent overwrite so the guidance ships with every version; best-effort — a write failure warns and
  never blocks startup).
- `src/main/index.ts`: call `provisionSandboxClaudeMd(resolveSandboxDir())` at init, alongside where the
  sandbox dir is resolved / `agentRunner` is constructed.

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation. Steps are sequential.

### Phase 0 — Design (designer → `.sdd/designs/cosmos-timeline-prompt-context-v1.md`)

- [ ] Designer reads `docs/DESIGN.md` (design-criteria canon), `src/renderer/app/ContextChip.tsx`, and
      `src/renderer/cosmos/CosmosTimelineEntry.tsx`/`UserBubble`.
- [ ] Produce the design spec for the **read-only timeline PromptContextChip**: the multi-dimension layout
      (panel always, tab when present, dock when present), reusing the composer "↳ item" badge treatment
      for visual consistency (SC-009); define empty state (no chip) and the live vs historical parity.
      No remove controls. Output `.sdd/designs/cosmos-timeline-prompt-context-v1.md`; extend `docs/DESIGN.md`
      if a new criterion is introduced.

### Phase 1 — Interface (shared contract + types)

- [x] Read the approved spec; confirm no open questions remain (both OQs RESOLVED).
- [x] Create `src/shared/promptContext/promptContext.ts` — `PromptContext`, `PromptPanelId`, `DockKind`
      types (reuse `ViewContext`; no new fields — FR-005/FR-007).
- [x] Create `src/shared/promptContext/promptContextMarker.ts` — `serializePromptContextMarker`,
      `parsePromptContextMarker`, `MARKER_RE`, the dock-kind↔panel-id map (FR-012/FR-014, defensive FR-010).
      Also exports `stripPromptContextMarker` (non-user defensive strip — FR-025).
- [x] Create `src/shared/promptContext/buildAgentSubmit.ts` — `buildAgentSubmitWithMarker` (one source,
      two channels — FR-013/FR-017).
- [x] Add `context?: PromptContext` to `UserPromptTurn` in `src/shared/types/conversation.ts` (FR-019).
- [x] Add `promptContext?: PromptContext` to `LiveInFlight` + `live-generating` `TimelineEntry` in
      `src/renderer/cosmos/cosmosConversation.ts` (FR-024).
- [x] Review every new type vs spec — non-secret only, no invented properties, no parallel item shape.

### Phase 2 — Testing (write before/with implementation)

- [x] `src/shared/promptContext/promptContextMarker.test.ts` (node): round-trip panel (always) / tab
      (when present) / dock (when present, all four kinds) with absent dims omitted from JSON; the
      ordinary-prose CORPUS (multi-line prompts mentioning panels/tabs/brackets) parses as no-marker; the
      strip regex leaves prose intact and removes a malformed/dangling trailing tag; bad-JSON and
      partial-field markers → no context + stripped text (SC-008, FR-014/FR-020/FR-025).
- [x] `src/shared/promptContext/buildAgentSubmit.test.ts` (node): ctx → utterance gains the trailing
      marker after a blank line AND `viewContext` = the dock's ViewContext; missing/oversized ctx →
      plain utterance with marker omitted BUT `viewContext` still derived from `ctx.dock` (SC-010/SC-011);
      no-dock ctx → marker present, `viewContext` absent.
- [x] `src/main/fs/transcriptParse.test.ts` (node): user-prompt turn (string + text-block) with a marker
      → `context` attached + `text` stripped clean; absent/malformed marker → plain `text`, no `context`;
      a marker in an assistant turn → stripped from display, no context (FR-025). DEVIATION: the file
      ALREADY existed (baseline turn-mapping tests, not noted in the plan's create-list) — appended the
      marker `describe` blocks rather than creating it.
- [x] `src/main/agent/sandboxClaudeMd.test.ts` (node): `SANDBOX_CLAUDE_MD` documents the
      `<cosmos:context>` block, the apply-to-context (esp. dock) guidance, read-not-echo framing, and
      references NO secret field; `provisionSandboxClaudeMd` writes the file via injected fs and never
      throws on a write failure (SC-012).
- [x] `src/renderer/cosmos/PromptContextChip.dom.test.tsx` (jsdom): renders panel always; tab only when
      present; dock only when present (all kinds, reusing the ↳ treatment); `undefined` context → renders
      nothing (FR-021/FR-023).
- [x] Extend `src/renderer/cosmos/cosmosConversation.test.ts`: `live-generating` carries `promptContext`
      through `reconcileTimeline`; the user bubble text stays marker-free (FR-024).

### Phase 3 — Implementation

- [x] Implement the shared codec + builder + types to pass Phase-2 node tests.
- [x] Wire `parseTranscript` (main) per E — both user branches + the non-user defensive strip
      (assistant-text). Guards on the STRIPPED text so a marker-only turn renders no empty bubble.
- [x] Wire capture in `useGenerativePanelTabs.submit` (build PromptContext from `target`/`panelName`/
      active tab/dock; apply `contextDismiss`; call `buildAgentSubmitWithMarker`) — keep `viewContext`
      grounding byte-identical to today. (Added `tabs`/`panelName` to the `submit` useCallback deps.)
- [x] Wire capture in `CosmosPanel.onSubmit` (cosmos panel + active tab, no dock; thread `promptContext`
      into `setLive`/the live ref; submit via the builder; keep `promptText` raw/clean). Used a
      `tabsStateRef` mirror so onSubmit reads the current active tab without re-publishing the composer.
- [x] Build `PromptContextChip.tsx` to the design spec; render it in `CosmosTimelineEntry` for
      `user-prompt` turns and `live-generating` entries. Lifted `PRIMARY_ICON`/`PRIMARY_NOUN` into the
      shared `src/renderer/app/contextChipIcons.ts` (design §6 refactor) — both chips import it.
- [x] Implement `sandboxClaudeMd.ts` and call `provisionSandboxClaudeMd(resolveSandboxDir())` in
      `src/main/index.ts` init.
- [x] `npm run typecheck` (node + web) + `npm test` + `npm run test:dom` green; reused
      `contextChipFor`/`ContextChip` for the dock dimension — no duplicated chip logic.

### Phase 4 — Docs

- [x] Update `docs/ARCHITECTURE.md`: §3 sandbox paragraph + §4.10 Generative UI — documented (1) the NEW
      `<userData>/sandbox/CLAUDE.md` provisioning and what it tells the engine, and (2) the "one source,
      two channels" PromptContext mechanism (the `<cosmos:context>` marker for transcript persistence/
      timeline display alongside the UNCHANGED `viewContext` → `--append-system-prompt` grounding).
      Noted `SESSION_SCHEMA_VERSION` is unchanged (no store).
- [x] `docs/PROJECT-STRUCTURE.md`: added the new `src/shared/promptContext/` cluster, `sandboxClaudeMd.ts`,
      `contextChipIcons.ts`, and `PromptContextChip.tsx`. Also added the new `TEST-SCENARIOS.md` rows
      (PROMPT-CTX-MARKER-01 / CHANNELS-01 / PARSE-01 / CLAUDEMD-01 / CHIP-01).
- [ ] Update this plan with any deviations; reconcile `TODO.md` (wrap-up).

---

## Deviations & Notes

- **2026-06-28**: Plan authored. Resolved the FR-012-example vs FR-005 field-name tension in favor of
  reusing the literal `ViewContext` fields (no fabricated dock labels, no new fetch) — see the pinned
  detail under §A. No spec decision re-opened.
