# Plan: Open Prompt spinner gating — only block for UI generation — v1

**Status**: Draft
**Created**: 2026-06-21
**Last updated**: 2026-06-21
**Spec**: .sdd/specs/open-prompt-spinner-gating-v1.md

---

## Grounding

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `AgentStatusPayload AgentRunState agentRunner onStatus emit completed render_ui detection UiBridge validateAgentStatus` — `AgentStatusPayload` (src/shared/ipc/agent.ts) carries only `state` + optional `message`; `AgentRunner` (src/main/agentRunner.ts) has NO visibility into whether a surface was rendered — it only owns the `claude -p` child lifecycle.
- `validateAgentStatusPayload agent:status main index onStatus webContents UiBridge render_ui requestRender pendingRender` — the render frame arrives at `UiBridge.onMessage` (src/main/uiBridge.ts ~line 217), which calls the injected `pushRender` (wired to `pushRenderToRenderer` in index.ts). This is the single main-side point where main KNOWS a `generated-ui` surface is being produced for the in-flight run.
- `index.ts AgentRunner UiBridge pushRender onStatus agent:status webContents.send ui:render wiring` — in `src/main/index.ts createWindow()`, both `pushRenderToRenderer` (line 1579) and the `AgentRunner` `onStatus` sink (line 1840 → `webContents.send(AgentChannel.Status, payload)`) live in the SAME scope, so a small main-side per-run flag can be set on render-push and read on status emit.
- Grep `onStatus|pushRender|agent:status` in `src/main/index.ts` + `src/preload/index.ts` — preload exposes `agent.onStatus` (src/preload/index.ts ~line 333) by forwarding the `AgentChannel.Status` payload verbatim; an added field flows through untouched.

**Re-confirmed from the spec's grounding (still current on disk):**

- `surfaceSpinnerVisible` + `submitDecision` live in `src/renderer/promptComposerLogic.ts`; `PromptComposer.tsx` takes `busy` and HIDES the composer while busy.
- `useGenerativePanelTabs.submit()` (src/renderer/useGenerativePanelTabs.ts ~line 433) sets `inFlight: true` unconditionally; the `agent:status` handler (~line 414) clears `inFlight` ONLY on `error`, never on `completed` — the root-cause defect.
- All five generative panels (Generated UI, Jira, Slack, Confluence, Google Calendar) compute `showSpinner` from `surfaceSpinnerVisible` against the active tab and pass it to both `<SurfaceSpinner>` and `PromptComposer busy`.

**memory_recall takeaway:** prior session memory `mem_mqmhmnbi_8d13b17da72e` captured the root cause (inFlight cleared only on error) and the #92 same-file coordination constraint; this plan builds on it.

---

## Summary

Make the "Generating…" blocking spinner appear only when a run actually produces a UI surface,
across ALL generative panels (OQ-2). The engine signals UI intent (OQ-1): main tracks, per run,
whether a `ui:render` frame was pushed for that run and stamps a non-secret boolean
`producedSurface` onto the terminal `agent:status` payload (`completed`). `useGenerativePanelTabs`
fixes the root-cause leak — on a terminal status (`completed`/`error`) it CLEARS the originating
tab's `inFlight` so a plain-command run that produced no surface releases the panel instead of
hanging on the spinner forever — using `producedSurface` to keep the existing UI-generation
behavior intact (a true UI run's surface still lands via `ui:render` and clears `inFlight` first;
the signal makes the no-surface release deterministic rather than ordering-dependent). For a
plain (non-spinner) submit, the composer shows a transient, non-blocking "Sent" hint (OQ-3) that
neither hides the composer nor blocks the panel. The signal is OPTIONAL/additive: absent ⇒
today's behavior for an in-flight surface; validated warn-and-ignore at the main boundary; a
missing/invalid value defaults to the safe interpretation that does NOT regress real UI runs.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload + React renderer); vitest (node env for `.ts` logic) |
| Key dependencies  | Existing IPC contract (`src/shared/ipc/agent.ts`), `UiBridge` (main), `AgentRunner` (main), `useGenerativePanelTabs` + `promptComposerLogic` + `PromptComposer` (renderer). No new packages. |
| Files to create   | (none required) — new pure helper(s) may be added to `src/renderer/promptComposerLogic.ts` and a small main-side run-tracking helper inline in `index.ts`; a transient-hint test file if logic is extracted. |
| Files to modify   | `src/shared/ipc/agent.ts` (add `producedSurface` to `AgentStatusPayload`); `src/shared/ipc/ui.validate.ts` (or wherever `validateAgentStatusPayload` lives — confirm in Phase 1) for warn-and-ignore validation; `src/main/index.ts` (track per-run render-pushed flag; stamp it on the terminal status); `src/renderer/useGenerativePanelTabs.ts` (clear `inFlight` on terminal status; honor `producedSurface`); `src/renderer/promptComposerLogic.ts` (gating + "sent" hint logic, pure); `src/renderer/PromptComposer.tsx` (render the transient "Sent" hint); panel `.tsx` files only if the hint needs panel wiring. |

### Detection mechanism (OQ-1 — engine signals UI intent)

- **Origin of the signal.** `UiBridge.onMessage` → injected `pushRender` (`pushRenderToRenderer`
  in `index.ts`) is the one place main learns a `generated-ui` surface is being produced for the
  in-flight run. Set a main-side per-run flag `renderPushedForRun` to `true` there (only for the
  `generated-ui` target — the spinner-gating concern; other targets settle display-only and are
  out of the blocking-spinner path).
- **Threading.** In `index.ts`, the `AgentRunner` `onStatus` sink already owns the
  `webContents.send(AgentChannel.Status, payload)`. On a terminal `completed`, stamp
  `producedSurface: renderPushedForRun` onto the payload before sending, then RESET the flag for
  the next run. `started` resets the flag; `error` need not carry it (error path clears `inFlight`
  already). The flag is plain main-side state (single-run runner ⇒ at most one run in flight).
- **Why not in `AgentRunner`.** `AgentRunner` has no visibility into `UiBridge` renders; keeping
  the flag in `index.ts` (where both sinks are wired) avoids coupling the runner to the bridge.
- **Contract.** Add `producedSurface?: boolean` to `AgentStatusPayload` — NON-SECRET, OPTIONAL,
  additive (mirrors how `message` is `error`-only). Document it as present only on `completed`.
- **Validation / safety (FR-008).** `validateAgentStatusPayload` warn-and-ignores a non-boolean
  `producedSurface` (drops the field, keeps the status). Renderer default when the field is
  ABSENT: treat as "unknown" and fall back to the existing surface-presence check
  (`tab.surface != null`) so an old/partial payload never regresses a real UI run.

### Renderer gating + root-cause fix

- **Root-cause fix (spec FR-004).** In `useGenerativePanelTabs`, extend the `agent:status`
  handler so a TERMINAL status for the originating tab clears `inFlight`:
  - `error` — unchanged (already clears `inFlight`, sets `error`).
  - `completed` — NEW: if the originating tab is still `inFlight` and has NO surface, clear
    `inFlight` (release the panel to its idle base / prior state). Use `producedSurface` as the
    deterministic signal: `producedSurface === true` means a surface was pushed (it will have /
    has landed via `ui:render`, which already clears `inFlight`); `producedSurface !== true`
    (false or absent-with-no-surface) means release now. This is the gate that stops the
    permanent "Generating…".
  - Preserve the originating-tab correlation discipline already in the handler (clear
    `originatingTabIdRef` appropriately; do not disturb the deferred-default flush logic).
- **Ordering nuance (record as a deviation guard).** A `generated-ui` `ui:render` frame is pushed
  synchronously before the run exits, so by `completed` the surface has typically already landed
  and cleared `inFlight` — the new `completed` branch is then a no-op for true UI runs.
  `producedSurface` makes the no-surface release deterministic even if ordering ever varies.
- **Gating predicate.** `surfaceSpinnerVisible` itself stays correct (it already hides the
  spinner once `inFlight` is false). The fix is upstream: ensure `inFlight` is cleared for a
  no-surface completion. No change to the `inFlight && !hasSurface && !hasError && !loadingDefault`
  shape is required; the spinner now simply never persists past a no-surface completion.
- **Scope across panels (OQ-2).** Because the gating lives entirely in the shared
  `useGenerativePanelTabs` + `surfaceSpinnerVisible`, the fix applies to all five panels with no
  per-panel branching. Verify no panel regresses (Jira/Slack/Confluence/Calendar settle
  display-only; their `inFlight` already clears via the landed frame — the new `completed` branch
  only releases a stuck no-surface case, which is the desired behavior everywhere).

### "Sent" indicator (OQ-3)

- A transient, non-blocking hint shown after a submit whose run will NOT show the spinner. It
  MUST NOT set `busy` (composer stays visible) and MUST NOT block the panel.
- Pure logic (when/how long to show, auto-dismiss) extracted into `promptComposerLogic.ts` for
  node tests; the DOM/timer binding stays in `PromptComposer.tsx`.
- **Design verdict (recorded): NO designer step required.** The "Sent" hint is a tiny transient
  text/badge that reuses existing design-system tokens (muted-foreground text / existing badge
  styles already used by the composer hint copy and the draft dot). It introduces no new visual
  affordance class, color, or layout pattern — it is a reuse of existing tokens, which per the
  CLAUDE.md UI-bearing rule and the orchestrator's stated lean qualifies for skipping the design
  step. If, during implementation, the hint grows into a new styled component (animation
  treatment, new token, distinct placement), STOP and route to the designer before building it.

## Coordination, Risks & Sequencing

- **CRITICAL — sequence AFTER #92 (`open-prompt-view-context-v1`).** #92 edits the SAME files
  this plan touches: `src/renderer/promptComposerLogic.ts` and `useGenerativePanelTabs.ts`'s
  `submit()` (it threads a non-secret `viewContext` into `window.cosmos.agent.submit({ utterance,
  target, viewContext })`; the in-flight worktree is `.claude/worktrees/agent-ab393954505248475/`,
  which also carries a STALE 4-value `UiRenderTarget` union — note the live tree has 5 targets
  incl. `google-calendar`). Implementation MUST start from the landed #92 tip, NOT fork against
  its worktree: (1) do not clobber the `viewContext` capture seam in `submit()` — add the
  `inFlight`/terminal-status changes alongside it; (2) reconcile against #92's `AgentSubmitPayload`
  shape; (3) if #92 has not merged at implementation time, rebase onto it rather than racing.
- **No secrets (CLAUDE.md).** `producedSurface` is a non-secret boolean derived purely from
  "was a render frame pushed". It carries no token, transcript, or surface content. Confirm in
  review that nothing else is added to the status payload.
- **Single-run runner.** The main-side `renderPushedForRun` flag is safe because `AgentRunner` is
  single-run (one child at a time); reset on `started` and after stamping `completed`.
- **Backward compatibility.** The field is optional/additive; a persisted/older payload without
  it falls back to surface-presence — no migration, no session-snapshot change.

---

## Implementation Checklist

> Update as work progresses. Add inline notes when a step deviates. START from the landed #92 tip.

### Phase 0 — Sequencing gate

- [x] Confirm #92 (`open-prompt-view-context-v1`) has LANDED on the working branch; if not, block/rebase onto it (do not fork the worktree). — CONFIRMED landed: live `useGenerativePanelTabs` carries `getViewContext`/`getViewContextRef` + `submit` capturing `viewContext`; `AgentSubmitPayload.viewContext` + `validateViewContext` in main. Built on top, not clobbered.
- [x] Re-read current `promptComposerLogic.ts`, `useGenerativePanelTabs.ts` `submit()`, and `AgentStatusPayload` on the post-#92 tip — reconcile against the `viewContext` seam.

### Phase 1 — Interface (types)

- [x] Add `producedSurface?: boolean` to `AgentStatusPayload` in `src/shared/ipc/agent.ts`, documented as non-secret, optional, present only on `completed`.
- [x] Locate `validateAgentStatusPayload` — DEVIATION: no validator existed by that name. `agent:status` is M→R (main is the PRODUCER), so the validator lives in `src/shared/ipc/agent.validate.ts` (NOT `ui.validate.ts`) and is applied at the main emit boundary (in the `onStatus` sink) right before `webContents.send`. It warn-and-ignores a non-boolean `producedSurface` (drop field, keep status) and drops a malformed status entirely. Exported via the `src/shared/validate.ts` barrel.
- [x] Define the pure renderer types for the gating + "sent" hint in `promptComposerLogic.ts` (`TerminalReleaseInput`/`shouldReleaseInFlightOnCompleted`, `SentHintState`/`sentHintAfterSubmit`/`SENT_HINT_DURATION_MS`) — no invented fields beyond `producedSurface` and existing tab signals.
- [x] Review types vs spec — no invented properties; the only new wire field is `producedSurface`.

### Phase 2 — Testing (write first where logic is pure)

- [x] `validate.test.ts`: `producedSurface` accepted when boolean (true/false); dropped (warn) when non-boolean; absent is valid; unknown state dropped (null).
- [x] `promptComposerLogic.test.ts`: gating/terminal-state helper — in-flight + completed + no surface + `producedSurface !== true` ⇒ release; completed + `producedSurface === true` ⇒ no release (surface path); has-surface ⇒ no release; missing field ⇒ safe fallback to surface-presence; bad input ⇒ warn + false.
- [x] `promptComposerLogic.test.ts`: "sent" hint helper — shows for an accepted submit, nothing for rejected, never carries a busy/block field, finite auto-dismiss duration.
- [x] (Main-side run-flag) — kept inline in `index.ts` (the `onStatus` sink + `pushRenderToRenderer`), exercised through `validateAgentStatusPayload`; no separate helper extracted (the flag is trivial module state, single-run runner).

### Phase 3 — Implementation

- [x] `src/main/index.ts`: added per-run `renderPushedForRun` flag; set in `pushRenderToRenderer` for the `generated-ui` target; in the `AgentRunner` `onStatus` sink stamp `producedSurface` on `completed`, reset on `started`/after `completed`; validate warn-and-ignore before send. SURGICAL — confined to the render-push fn + status sink (no touch to the #96 save-path region).
- [x] `src/renderer/useGenerativePanelTabs.ts`: extended the `agent:status` handler so a terminal `completed` for the originating tab clears `inFlight` when no surface was produced (via `shouldReleaseInFlightOnCompleted`/`producedSurface`); kept `error` behavior; preserved correlation + deferred-default flush ordering (release clears `originatingTabIdRef` BEFORE the deferred-default check). Built on top of #92's `viewContext` `submit()` seam (untouched).
- [x] `src/renderer/promptComposerLogic.ts`: implemented the pure gating helper + the "sent" hint logic.
- [x] `src/renderer/PromptComposer.tsx`: render the transient non-blocking "Sent" hint (reusing the muted-foreground token); never sets `busy`; hidden while `busy` (UI run shows the surface spinner instead); auto-dismiss timer bound here.
- [x] Verify all five panels: gating lives entirely in the shared hook + predicate, so all panels get it with no per-panel branching. Spinner shows only for true UI runs; plain command never blocks; error still surfaces.
- [x] All tests pass (99 files / 1883 tests); `npm run typecheck` clean (node + web).
- [x] Reused shared `surfaceSpinnerVisible` gate and existing tokens — no duplicated logic, no new visual component.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` if the `producedSurface` signal / terminal-status `inFlight` release is a new system-shaping decision (it touches the agent-status contract — likely yes; add a concise note to the generative-UI / agent-runner section).
- [ ] Reconcile `TODO.md` (wrap-up) — check off this item.
- [ ] Update this plan's Deviations with anything that differed (esp. the #92 reconciliation and the confirmed location of `validateAgentStatusPayload`).
- [ ] Persist the final mechanism decision to agentmemory (memory_save).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-21 (impl)**: `validateAgentStatusPayload` did NOT pre-exist (the plan flagged it might
  live in `ui.validate.ts`). Since `agent:status` is M→R (main is the producer), the validator was
  ADDED to `src/shared/ipc/agent.validate.ts` and applied at the **main emit boundary** (the
  `AgentRunner.onStatus` sink in `index.ts`, just before `webContents.send`) — warn-and-ignore a
  non-boolean `producedSurface` (drop field, keep status), drop a malformed status entirely. This
  honours the CLAUDE.md "validate at the main boundary, never crash" rule for the producer side.
  The renderer's `shouldReleaseInFlightOnCompleted` provides the absent-field safe fallback
  (surface-presence). Main-side per-run flag kept inline (`renderPushedForRun`, module scope; safe
  because `AgentRunner` is single-run) rather than extracted — too trivial for a separate helper.
  The "Sent" hint stayed a token-reuse (muted-foreground text above the collapsed logo) — no
  designer escalation needed. #92 `viewContext` seam left untouched; `index.ts` edit confined to the
  render-push fn + status sink (no overlap with #96's save-path region). Full suite green (1883).
- **2026-06-21**: Plan authored. OQ-1 resolved to engine-signals-UI-intent via `producedSurface`
  on `AgentStatusPayload`; OQ-2 resolved to ALL generative panels (achieved for free via the
  shared hook + predicate); OQ-3 resolved to a transient non-blocking "Sent" hint. Design step
  judged UNNEEDED (transient text/badge reusing existing tokens) — escalate to designer only if
  the hint grows into a new styled affordance. Hard constraint: sequence after #92 and reconcile
  against its `viewContext` seam; do not fork its worktree.
