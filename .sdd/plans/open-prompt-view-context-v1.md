# Plan: Open Prompt View Context — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/open-prompt-view-context-v1.md

---

## Grounding

> Direct investigation performed for this plan (architect ran these — not handed in). Same
> grounding set as the spec; the load-bearing on-disk facts the plan depends on:

**codegraph_explore / codegraph_search**

- `useGenerativePanelTabs submit agent.submit` — `submit(utterance)` at src/renderer/useGenerativePanelTabs.ts:433 is the SOLE caller of `window.cosmos.agent.submit({ utterance, target })` (line 458). Extending it threads context for every panel from one place.
- `PromptComposer props` — `PromptComposerProps` (src/renderer/PromptComposer.tsx:60) calls `onSubmit(value)` (line 157) with the raw utterance only; the composer is panel-agnostic.

**Reads (on-disk truth)**

- `src/shared/ipc/agent.ts` `AgentSubmitPayload` — extend additively here; re-exported through `src/shared/ipc.ts` barrel.
- `src/shared/ipc/agent.validate.ts` `validateAgentPrompt` — extend to validate+attach `viewContext`; uses `isObject`/`WarnFn` from `common.validate` and `validateUiRenderTarget` from `ui.validate`.
- `src/main/index.ts:1012` `AgentChannel.Submit` handler — pass the validated `viewContext` to `agentRunner.run(...)`.
- `src/main/agentRunner.ts` `run(utterance, target)` — appends `groundingPromptForTarget(target)` via `--append-system-prompt` (lines 143-146); the `viewContext` grounding clause is appended in the SAME mechanism.
- `src/main/mcpConfig.ts` `groundingPromptForTarget` (line 394) — the per-target grounding builder; `allowedToolForTarget`/`renderMcpConfigJsonForTarget` MUST stay untouched (FR-009). Note `JIRA_TOOL_GRANTS` already includes writes; Slack/Confluence/Calendar are read-only.
- Per-panel view state (exact field paths): JiraPanel.tsx `detail.detailIssueKey`; SlackPanel.tsx `nav.view` (`{kind:'history';channel}`) + `nav.openThread` (`channelId`/`threadTs`); ConfluencePanel.tsx `view` (`{kind:'page';pageId;title}`) + `genUiPage` (`{pageId;title}`); GoogleCalendarPanel.tsx `genUiEvent` (`EventChipData.id`).

**memory**

- No prior decisions on file (clean slate). Persisted the context-only scoping decision (`memory_save` mem_mqmguhvv_b015d5878d70).

---

## Summary

Thread the active panel's **current view context** through the existing `agent:submit` →
`AgentRunner.run` path so deictic utterances resolve. Approach: (1) extend
`AgentSubmitPayload` with an additive optional, target-keyed `viewContext` (data-only,
non-secret identifiers); (2) validate it warn-and-ignore at the main boundary; (3) each
panel supplies a pure `viewContext` provider read from the state it already holds, passed
into `useGenerativePanelTabs`/`PromptComposer` and captured at SEND time; (4) in main, a
pure builder turns the validated `viewContext` into a grounding clause appended via the
SAME `--append-system-prompt` mechanism as the per-target grounding, so the user's literal
utterance stays clean. **Tool grants are unchanged (FR-009): context-only, no write
enablement.** Likely **no designer step** (no new visible surface) — unless OQ-2's
context-chip is adopted, which would add one.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer + shared IPC); Vitest node env for `.ts` logic |
| Key dependencies  | Existing `agent:*` IPC, `AgentRunner`, `groundingPromptForTarget`, `useGenerativePanelTabs`, `PromptComposer`. No new libraries. |
| Files to create   | `src/renderer/viewContextCapture.ts` (+ `.test.ts`) — pure panel-state → `ViewContext` mappers; `src/main/viewContextGrounding.ts` (+ `.test.ts`) — pure `ViewContext` → grounding-clause builder |
| Files to modify   | `src/shared/ipc/agent.ts` (payload type), `src/shared/ipc/agent.validate.ts` (+ `.test.ts`) (validate `viewContext`), `src/main/index.ts` (pass through), `src/main/agentRunner.ts` (accept + append grounding), `src/main/mcpConfig.ts` (optional: house the grounding-clause builder if co-locating with `groundingPromptForTarget`), `src/renderer/useGenerativePanelTabs.ts` (accept a `viewContext` provider, include in `agent.submit`), `src/renderer/PromptComposer.tsx`/panels (wire provider), `JiraPanel.tsx`/`SlackPanel.tsx`/`ConfluencePanel.tsx`/`GoogleCalendarPanel.tsx` (supply provider) |
| Out of scope      | Any change to `allowedToolForTarget`/`renderMcpConfigJsonForTarget`; Slack/any new write scope; session persistence of context; visible context chip (OQ-2) |

### Design notes (the "how")

- **Contract shape (FR-001/FR-003).** Add to `AgentSubmitPayload`:
  ```ts
  /** Non-secret identifiers describing what the user is currently viewing (open-prompt-view-context-v1). */
  viewContext?: ViewContext
  ```
  where `ViewContext` is a small data-only interface (NOT a union with the surface payloads).
  Recommended flat optional fields so the validator is trivial and the same shape works for
  every panel; the `target` already disambiguates which fields are meaningful:
  ```ts
  export interface ViewContext {
    selectedIssueKey?: string      // jira: the open detail dock's issue
    selectedChannelId?: string     // slack: the open channel
    selectedChannelName?: string   // slack: its display name (label only)
    threadTs?: string              // slack: the open thread dock
    selectedPageId?: string        // confluence: the open page
    selectedPageTitle?: string     // confluence: its title (label only)
    selectedEventId?: string       // google-calendar: the selected event
  }
  ```
  Every field optional; all non-secret. Annotate "NO secret" like the existing payload fields.
- **Capture (FR-004/FR-005/FR-010/FR-011) — renderer.** Each panel builds a `ViewContext`
  from its existing state via a pure mapper in `viewContextCapture.ts`, e.g.
  `jiraViewContext(detailIssueKey)`, `slackViewContext(view, openThread)`,
  `confluenceViewContext(view, genUiPage)`, `calendarViewContext(genUiEvent)` — each returns a
  `ViewContext` with only the populated fields, or `{}`/`undefined` when nothing is selected
  (never a placeholder). These are node-testable (no DOM/React imports).
- **Send-time capture (Edge Cases).** `useGenerativePanelTabs` gains an optional
  `getViewContext?: () => ViewContext | undefined` option; `submit()` calls it at send time and
  includes the result in `window.cosmos.agent.submit({ utterance, target, viewContext })`.
  Reading live in `submit()` guarantees the context reflects the screen when Enter is pressed,
  not when the composer opened. `PromptComposer` itself stays UNCHANGED (it already only calls
  `onSubmit(value)`); the per-panel `submit` from the hook owns the context — so no new prop on
  `PromptComposer` is strictly required. (If a future chip is wanted, that is where a prop lands —
  OQ-2.)
- **Validation (FR-006) — main boundary.** Extend `validateAgentPrompt`: if `raw.viewContext`
  is present, validate it through a new `validateViewContext` (each field optional, must be a
  string when present; unknown/extra fields dropped). An invalid `viewContext` is warned and
  OMITTED — the returned payload still carries the valid `utterance`/`target` so the run starts
  (never returns `null` for a bad `viewContext`). Reuse `isObject`/`WarnFn` from
  `common.validate`.
- **Grounding (FR-007/FR-008) — main.** A pure `viewContextGroundingClause(target, viewContext)`
  returns an extra system-prompt sentence, e.g. for jira:
  *"The user is currently viewing Jira issue PROJ-123 in the panel. When they say 'this ticket'
  or similar, they mean PROJ-123 — fetch it with the read tools and act on it."* For slack:
  *"The user is currently viewing channel C0123 (#general)" (+ "and thread <ts>" when present)*.
  It references ONLY ids the model can fetch with its EXISTING read tools and never instructs
  actions the run lacks tools for (FR-008/FR-009). `AgentRunner.run` appends this clause to the
  existing `groundingPrompt` string (or, when there is no per-target grounding, appends it
  alone) via the SAME `--append-system-prompt`. The user's `-p` utterance arg is untouched
  (FR-007/SC-003). Decision: house `viewContextGroundingClause` either in the new
  `viewContextGrounding.ts` or alongside `groundingPromptForTarget` in `mcpConfig.ts`; prefer the
  dedicated module so `mcpConfig.ts` stays grant/config-focused, and have `run()` compose the two.
- **Signature change.** `AgentRunner.run(utterance, target, viewContext?)` — additive third arg;
  the `index.ts` handler passes `payload.viewContext`. Tests injecting `spawn` assert the built
  args include the composed `--append-system-prompt` and that `-p`'s value equals the raw
  utterance.
- **Security (FR-002/SC-004).** Only ids/labels the renderer already displays cross the bridge;
  no token path is touched. The validator additionally guards shape. No `viewContext` value is
  ever logged beyond the existing submit log (which may include it as non-secret data — confirm
  it carries no secret, which by construction it cannot).

---

## Implementation Checklist

### Phase 1 — Interface

- [x] Read spec; confirm no blocking open questions (OQ-1/OQ-2/OQ-3 are deferred defaults, not blockers).
- [x] Add `ViewContext` interface + optional `viewContext?: ViewContext` field to `AgentSubmitPayload` in `src/shared/ipc/agent.ts` (annotate every field "NO secret"; document each panel's owner). **Note:** added `selectedEventTitle?` (non-secret label) so the chip can label calendar events without re-deriving — design §3/DQ-3.
- [x] Confirm the barrel `src/shared/ipc.ts` re-exports the new type (it re-exports `agent.ts` wholesale — verified, `export * from './ipc/agent'`).
- [x] Define `viewContextCapture.ts` pure mapper signatures (per-panel) and `viewContextGrounding.ts` builder signature; review vs spec — no invented fields beyond FR-003.

### Phase 2 — Testing

- [x] `viewContextCapture.test.ts`: each panel mapper — populated selection → expected `ViewContext`; no selection → undefined (FR-005); stale/closed → no dangling id. Plus `contextChipFor` chip-descriptor cases (design §3).
- [x] `viewContextGrounding.test.ts`: each target with populated context → clause names the id(s); empty/undefined context → empty clause (no-op); clause never references a write action a read-only target lacks (FR-008).
- [x] `validate.test.ts` (the agent-validate suite): payload with valid `viewContext` → attached; with invalid `viewContext` (non-object, non-string field) → warned + `viewContext` omitted, run still valid (FR-006/SC-005); absent/empty `viewContext` → unchanged baseline.
- [x] `agentRunner` test: `run(utterance, target, viewContext)` builds args where `-p` value == raw utterance (SC-003) and `--append-system-prompt` includes BOTH per-target grounding and the view-context clause; no change to `--allowedTools`/`--mcp-config` (SC-006).

### Phase 3 — Implementation

- [x] Implement `viewContextCapture.ts` mappers (pure, no React/DOM imports). Houses `contextChipFor` too (display-only chip descriptor, design §6).
- [x] Implement `viewContextGrounding.ts` builder (pure).
- [x] Extend `validateAgentPrompt` + add `validateViewContext` (warn-and-ignore, never drops the run).
- [x] Add optional `getViewContext` to `useGenerativePanelTabs` options; capture at send time in `submit()` (via a ref so `submit` stays stable); include in `agent.submit({ utterance, target, viewContext })`.
- [x] Wire each panel to pass `getViewContext` reading its existing state: Jira `detailIssueKey`; Slack `view`+`openThread`; Confluence `view`/`genUiPage`; Calendar `genUiEvent`. Each routes live state through a ref (the nav/detail state is derived from `usePerTabNav` AFTER the hook call — same cycle-break as Jira's `setDetailRef`).
- [x] Thread `viewContext` through `AgentChannel.Submit` handler in `index.ts` → `agentRunner.run(utterance, target, viewContext)`.
- [x] Extend `AgentRunner.run` to compose per-target grounding + view-context clause into one `--append-system-prompt` (`composeGroundingPrompt` helper); leave grants/config untouched.
- [x] **Context chip (design spec, OQ-2 = IN per user):** `ContextChip.tsx` composite (Badge/Button/Tooltip/lucide), rendered in `PromptComposer` between textarea and footer; `contextChip?` prop added; dismissible via a local `contextDismiss` state threaded into `submit` as `onSubmit(value, { contextDismiss })` (the hook strips thread/all before attaching `viewContext`).
- [x] Run `npm run typecheck` (node + web) and `npm test`; all green (typecheck exit 0; 1823 tests, 98 files pass).

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.10: note that a run's grounding now ALSO carries the active panel's non-secret view context (deictic resolution), threaded via `--append-system-prompt`, and that tool grants are UNCHANGED (context-only). One or two sentences; keep §4.10 authoritative.
- [ ] Record any deviation below; reconcile `TODO.md` via the `wrap-up` skill.
- [ ] If OQ-2 (context chip) is later adopted, branch a `design` step + designer pass; not in v1.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-20**: Scoping call recorded — v1 is CONTEXT-ONLY. No write grants added/removed. Pre-existing asymmetry noted (jira target already has write tools; slack/confluence/calendar read-only). Write enablement (esp. Slack send) deferred to a follow-up spec (OQ-1).
- **2026-06-21** (developer, impl): Added one field beyond the plan's listed `ViewContext` shape — `selectedEventTitle?` (google-calendar). The plan's calendar context was id-only; the design chip (§3, DQ-3) needs a human label, and the title is already non-secret/on-screen (`EventChipData.summary`). Carrying it on `viewContext` (rather than a separate chip-only channel) also lets the grounding clause name the event by title. Still non-secret, still optional, still additive — within FR-002/FR-003 intent.
- **2026-06-21** (developer, impl): Chip dismiss (design §5/§6, DQ-1 = dismissible) DOES touch the plan's capture seam as the designer flagged: `onSubmit` is extended to `onSubmit(value, { contextDismiss })`, and `useGenerativePanelTabs.submit` strips `threadTs` (dismiss `'thread'`) or the whole `viewContext` (dismiss `'all'`) AFTER capturing from `getViewContext`, before attaching to the IPC payload. `getViewContext` still reads raw live state; the dismiss is a per-compose, non-sticky composer-local override (reset on collapse). PromptComposer is NOT unchanged (the plan's note that it could stay untouched held only for the no-chip path).
- **2026-06-21** (developer, impl): `getViewContext` is read through a ref in the hook so `submit` stays a stable `useCallback`; each panel updates a per-render ref to its live selection (`detailIssueKeyRef`/`viewRef`+`openThreadRef`/`viewRef`+`genUiPageRef`/`genUiEventRef`) because the selection state is derived from `usePerTabNav`/`useState` defined AFTER the hook call (same forward-ref cycle-break Jira already used for `setDetailRef`).
