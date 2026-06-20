# Spec: Open Prompt spinner gating — only block for UI generation — v1

**Status**: Draft
**Created**: 2026-06-21
**Supersedes**: —
**Related plan**: .sdd/plans/open-prompt-spinner-gating-v1.md (to be authored)

---

## Grounding

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `promptComposerLogic surfaceSpinnerVisible submitDecision PromptComposer useGenerativePanelTabs submit UiRenderTarget` — the "Generating…" spinner is `SurfaceSpinner`, gated by `surfaceSpinnerVisible({ inFlight, hasSurface, hasError, loadingDefault })` in `src/renderer/promptComposerLogic.ts`; the SAME value is passed as `busy` to `PromptComposer`, which HIDES the whole composer while busy.
- `surfaceSpinnerVisible PromptComposer GeneratedUiPanel SlackPanel JiraPanel sendSpinner UiRenderTarget DEFAULT_UI_RENDER_TARGET render_ui` — every generative panel computes `showSpinner` from its ACTIVE tab the same way; the Open Prompt panel is `GeneratedUiPanel` (`target: 'generated-ui'`, placeholder "Describe the UI you want…").
- `GeneratedUiPanel SlackPanel busy surfaceSpinnerVisible PromptComposer viewContext contextChipFor ViewContext captureViewContext` — `GeneratedUiPanel.submit` is `useGenerativePanelTabs.submit`, which UNCONDITIONALLY sets `inFlight: true` on the active tab and fires `window.cosmos.agent.submit({ utterance, target: 'generated-ui' })`.
- `agentRunner agent submit onStatus AgentStatusPayload completed render_ui UiBridge generated-ui blocking pending` — `AgentStatusPayload` carries only `state ('started' | 'completed' | 'error')` + optional `message`; it does NOT indicate whether the run emitted a `render_ui` frame.
- Grep `inFlight|completed|onStatus` in `useGenerativePanelTabs.ts` — KEY FINDING: the `agent:status` handler clears `inFlight` ONLY on `error` (line ~420). On `completed` it does NOT clear `inFlight`; only a landed `ui:render` frame (line ~382) clears it. So a `generated-ui` submit whose run completes WITHOUT a `render_ui` frame (a plain command) leaves the active tab stuck `inFlight: true` ⇒ "Generating…" spinner blocks the panel indefinitely.

**memory_recall / memory_smart_search queries run (one-line takeaways):**

- `Open Prompt spinner Generating surface render target generated-ui` — no stored results.
- `generated-ui plain command render_ui spinner stuck in-flight completion gating` — no stored results.
- (No prior agentmemory decisions exist for this behavior; this spec establishes it.)

---

## Overview

The Open Prompt composer (the `generated-ui` panel) shows a "Generating…" spinner and hides
the composer the instant ANY utterance is submitted, and keeps showing it until a UI surface
lands. For an utterance that does not produce a UI surface (a "plain command"), no surface ever
lands, so the panel is blocked by the spinner with nothing to display. This feature scopes the
"Generating…" blocking spinner to UI-generation runs only: a plain command must not show the
"Generating…" spinner or hide the composer.

## User Scenarios

### Plain command does not block with "Generating…" · P1

**As a** user of the Open Prompt panel
**I want to** send a plain, non-UI-generating instruction without the panel locking into a
"Generating…" spinner
**So that** I can keep using the panel and am not stuck staring at a spinner that never resolves

**Acceptance criteria:**

- Given the Open Prompt panel is showing its idle base ("Describe a UI below…"), when I submit
  an utterance whose run completes without producing a UI surface, then the panel does NOT show
  the "Generating…" `SurfaceSpinner` for that run and is NOT left blocked by it after the run
  ends.
- Given a plain command run is in flight, when the run completes, then the Open Prompt composer
  (collapsed logo / expanded card) is reachable again and the panel is not stuck on a spinner.

### UI generation still shows "Generating…" · P1

**As a** user of the Open Prompt panel
**I want to** see the "Generating…" spinner while a UI is actually being generated
**So that** I have clear feedback that my UI request is in progress

**Acceptance criteria:**

- Given the Open Prompt panel, when I submit an utterance that DOES result in a generated UI
  surface, then the "Generating…" `SurfaceSpinner` shows while that generation is in flight and
  stops the instant the surface lands (unchanged from today's behavior).
- Given a UI-generation run is in flight, when the surface lands, then the spinner is replaced by
  the rendered surface (unchanged from today).

### Failed run still surfaces its error · P1

**As a** user of the Open Prompt panel
**I want to** still see an error when a run fails
**So that** a failure is never silently swallowed by the new gating

**Acceptance criteria:**

- Given any submitted run, when the run errors, then the panel surfaces the failure exactly as
  today (the error message replaces the spinner) regardless of whether the run was a UI request.

## Functional Requirements

> "UI generation" for this panel = a run that produces a `generated-ui` `ui:render` surface
> frame (the `render_ui` path). The Open Prompt panel always submits `target: 'generated-ui'`,
> so the gating distinction is NOT the target (it is constant) — it is whether the run actually
> produces a UI surface. See OQ-1 for the detection mechanism (the spec fixes the BEHAVIOR; the
> plan owns the mechanism).

| ID     | Requirement |
|--------|-------------|
| FR-001 | The Open Prompt (`generated-ui`) panel MUST show the "Generating…" `SurfaceSpinner` only while a UI-generation run is in flight — i.e. only when a `generated-ui` `ui:render` surface is being produced. |
| FR-002 | The Open Prompt panel MUST NOT show the "Generating…" `SurfaceSpinner` for a submitted utterance whose run does not produce a UI surface (a plain command). |
| FR-003 | When the "Generating…" spinner is not shown for a submit, the Open Prompt composer MUST remain available (not hidden by the `busy` gate) — the `busy`/composer-hidden state MUST track the same UI-generation gate as the spinner, so a plain command never hides the composer. |
| FR-004 | A plain command submit MUST NOT leave the active tab in a permanent "Generating…"/in-flight blocked state after its run completes; the panel MUST return to a usable state (its idle base or prior surface) when the run ends. |
| FR-005 | A UI-generation run MUST continue to show the "Generating…" spinner while in flight and MUST stop it the instant the surface lands — unchanged from today (composer-send-animation-v1 FR-005/FR-006). |
| FR-006 | A run that ERRORS MUST continue to surface its error in the panel as today, clearing any spinner — for both plain commands and UI requests (composer-send-animation-v1 FR-007). |
| FR-007 | The change MUST be scoped to the Open Prompt / `generated-ui` panel's spinner-gating behavior. The Jira, Slack, Confluence, and Google Calendar panels' spinner behavior MUST NOT regress. [NEEDS CLARIFICATION — see OQ-2: whether non-`generated-ui` panels are in scope at all.] |
| FR-008 | Invalid or unexpected run-status/tab state MUST degrade safely (no thrown error, spinner defaults to hidden), consistent with the existing `surfaceSpinnerVisible` safe-fallback contract. |

## Edge Cases & Constraints

- **Plain-command feedback (no spinner):** With the "Generating…" blocking spinner suppressed,
  the spec does NOT require a new in-panel "sent" indicator for plain commands. The user's
  request only asks to stop showing "Generating…" for plain commands; any acknowledgement that
  the command was sent (e.g. composer auto-collapse, the existing run-status disable on the Send
  button) is the EXISTING composer behavior and is out of scope to change here. [NEEDS
  CLARIFICATION — see OQ-3 if the user expects an explicit non-spinner "command sent" cue.]
- **Rapid successive submits:** The existing single-run guard (composer `running` disables Send;
  `AgentRunner` is single-run in main) is unchanged. This feature does not add new concurrency;
  it only changes whether the spinner/busy gate engages for a given run.
- **Switching target while a generate is in flight:** The Open Prompt panel has a single fixed
  `target` (`generated-ui`), so there is no in-panel target switch. Switching to a different
  rail panel (Jira/Slack/etc.) is a separate panel with its own composer/spinner and is
  unaffected.
- **Tab switch during a run:** Spinner gating remains per-tab/active-tab scoped exactly as today
  (composer-send-animation-v1 FR-008) — switching away hides it, switching back to a still-
  in-flight UI-generation tab re-shows it.
- **Out of scope:** Changing the headless run lifecycle, the `render_ui` tool, the
  surface-rendering pipeline, or any non-Open-Prompt panel's visual behavior beyond not
  regressing it.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Submitting a plain (non-UI) command in the Open Prompt panel never shows the "Generating…" `SurfaceSpinner` and never leaves the panel blocked by it after the run ends. |
| SC-002 | Submitting a UI-generation request in the Open Prompt panel shows the "Generating…" spinner while in flight and replaces it with the surface when it lands (parity with today). |
| SC-003 | A run that errors surfaces its error and clears any spinner, for both plain commands and UI requests. |
| SC-004 | No regression in the Jira / Slack / Confluence / Google Calendar panels' spinner behavior. |

---

## Technical Context & Risks (for the implementing plan)

> Informational — captures the concrete code seam and a hard sequencing constraint the plan
> MUST honor. Not a substitute for the plan's own grounding.

- **Where the behavior lives.** The spinner is `SurfaceSpinner`, gated by
  `surfaceSpinnerVisible({ inFlight, hasSurface, hasError, loadingDefault })` in
  `src/renderer/promptComposerLogic.ts`. `GeneratedUiPanel` (`src/renderer/GeneratedUiPanel.tsx`)
  computes `showSpinner` from its ACTIVE tab and passes it both to `<SurfaceSpinner>` and as
  `busy` to `<PromptComposer>` (which HIDES the composer while busy). The tab's `inFlight` flag
  is set in `useGenerativePanelTabs.submit()` (`src/renderer/useGenerativePanelTabs.ts`,
  ~line 433) and is the root driver.
- **Root cause of the permanent block.** The panel `agent:status` handler in
  `useGenerativePanelTabs.ts` (~line 414) clears `inFlight` ONLY on `state === 'error'`. On
  `state === 'completed'` it does NOT clear `inFlight`. Today only a landed `ui:render` frame
  clears `inFlight`. So a `generated-ui` run that completes WITHOUT emitting a `render_ui` frame
  (a plain command) leaves the active tab stuck `inFlight: true` ⇒ the "Generating…" spinner
  blocks the panel until the user opens a new tab. This is the user-visible defect behind the
  request.
- **Detection gap (the load-bearing decision — OQ-1).** `AgentStatusPayload` carries only
  `state` + `message`; it does NOT say whether the run produced a `ui:render` surface. So the
  renderer cannot, on `completed`, deterministically distinguish "surface is still coming" from
  "this run produced no surface (plain command)." Resolving the gating therefore requires a
  decision the plan owns (e.g. clear `inFlight` for the `generated-ui` originating tab on
  `completed` with no surface yet; or add a non-secret signal to the run lifecycle indicating a
  surface was/was-not produced; or only engage the spinner once a surface frame is actually
  pending). This must NOT carry tokens/secrets (CLAUDE.md). The spec fixes the behavior (FR-001..
  FR-006); the plan must choose the mechanism and validate it against the edge cases above.
- **CRITICAL sequencing — concurrent in-flight feature (#92 Open Prompt view-context).** A
  concurrent feature (`open-prompt-view-context-v1`) is editing the SAME files this change
  touches — `src/renderer/promptComposerLogic.ts` and `useGenerativePanelTabs.ts`'s `submit()`
  (it threads a non-secret `viewContext` into `window.cosmos.agent.submit({ utterance, target,
  viewContext })`; see `src/renderer/viewContextCapture.ts`, `ViewContext` in
  `src/shared/ipc/agent.ts`, the worktree at `.claude/worktrees/agent-ab393954505248475/`).
  Implementation of THIS spec MUST sequence AFTER #92 lands and reconcile against its changes:
  do NOT clobber the `viewContext` capture seam in `submit()` and do NOT fork
  `promptComposerLogic.ts`/`useGenerativePanelTabs.ts` against the #92 worktree's edits. If #92
  has not landed at implementation time, the plan must rebase onto it rather than racing it.

---

## Open Questions

- [ ] **OQ-1 [NEEDS CLARIFICATION]** Detection mechanism for "UI generation." Concretely, when
  exactly should the spinner engage/clear given that `AgentStatusPayload` does not report whether
  a surface was produced? Candidate resolutions: (a) keep showing the spinner on submit but CLEAR
  `inFlight` (and thus the spinner) for the `generated-ui` originating tab on a `completed` status
  that arrives with no surface landed — so a plain command's spinner self-resolves at run end;
  (b) add a non-secret "produced a surface" signal to the run lifecycle so the panel only blocks
  for true UI runs; (c) defer engaging the spinner until a surface frame is actually pending. The
  spec's behavior (FR-001..FR-006) holds under any of these; the PLAN should pick one. Resolve
  with the user if a visible mid-run difference (spinner shows briefly then clears vs. never
  shows) matters to them.
- [ ] **OQ-2** Scope: does the user want this gating only for the Open Prompt (`generated-ui`)
  panel (the panel whose "Generating…" placeholder they referenced), or for every generative
  panel that can receive a plain command? The request names the Open Prompt panel specifically;
  this spec scopes to it (FR-007) and leaves others non-regressing. Confirm before widening.
- [ ] **OQ-3** Does the user want any explicit "command sent" acknowledgement for a plain command
  now that the "Generating…" spinner is suppressed, or is the silent existing composer behavior
  (auto-collapse) sufficient? The literal request asks only to stop the spinner; this spec
  assumes no new cue (Edge Cases). Confirm.
