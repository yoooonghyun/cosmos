# Spec: Catalog-pull early signal for UI-generation spinner gating — v1

**Status**: Draft
**Created**: 2026-06-22
**Supersedes**: refines the gating mechanism chosen by `open-prompt-spinner-gating-v1.md` (OQ-1 candidate (b) — a non-secret "this run will generate UI" signal). Does not supersede that spec's behavior contract.
**Related plan**: .sdd/plans/ui-catalog-pull-spinner-signal-v1.md

---

## Grounding

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `renderUiServer render_ui A2UI_TOOL_DESCRIPTION BridgeClient BridgeRenderRequest pushRenderToRenderer renderPushedForRun AgentStatusPayload` — the render servers are thin stdio→socket relays (`BridgeClient.render` writes a `{ kind:'render' }` frame); the A2UI catalog is the static `A2UI_TOOL_DESCRIPTION` string in `renderUiServer.ts:176-257` baked into `render_ui`'s `description`; `pushRenderToRenderer` (index.ts:1592) sets `renderPushedForRun = true` only for `target === 'generated-ui'`.
- `promptComposerLogic inFlightOnSubmit surfaceSpinnerVisible composerInteractiveAfterSubmit originatingTabIdRef` — spinner is `SurfaceSpinner`, gated by `surfaceSpinnerVisible({ inFlight, hasSurface, hasError, loadingDefault })`; `inFlightOnSubmit()` returns constant `true` (optimistic), so today every submit shows the spinner until release.
- `useGenerativePanelTabs.ts` (read in full) — `submit()` sets the originating tab `inFlight` unconditionally and stamps `originatingTabIdRef`; the `ui:render` subscription clears it when a surface lands; the `agent:status` `completed` handler releases via `shouldReleaseInFlightOnCompleted({ producedSurface })`. This is the single renderer correlation seam.
- `mcpConfig.ts` (read in full) — `allowedToolForTarget(target)` builds the comma-separated `--allowedTools` grant; `groundingPromptForTarget(target)` builds the `--append-system-prompt`. Both are per-target and the single source for the 5 render targets (`generated-ui`/`jira`/`slack`/`confluence`/`google-calendar`).
- `uiBridge.ts` / `src/shared/bridge.ts` (read in full) — `BridgeRenderRequest { kind:'render', callId, spec, target?, descriptor?, bindings? }` is the only render-server→main frame; `UiBridge.onMessage` rejects any `message.kind !== 'render'`. The Slack/Jira/Confluence/GoogleCalendar bridges are separate sockets; all 5 render servers share the ONE `UiBridge` socket (`COSMOS_BRIDGE_SOCKET`).
- `agent.ts` (`AgentStatusPayload`) — carries `state` + optional `message` + optional `producedSurface` (set only on `completed` in `index.ts:1871`). No early/mid-run "began generating UI" signal exists.

**memory_recall / memory_smart_search queries run (one-line takeaways):**

- `generative UI spinner render_ui A2UI catalog producedSurface AgentStatusPayload generating` — no prior stored decision (empty); this spec/`memory_save` establishes the catalog-pull design.

---

## Overview

cosmos's generative panels show a per-tab "Generating…" spinner while a submitted utterance is in
flight. Today the only signal that a run produces UI is the `render_ui` tool firing — which happens
at the very END of the run (its argument IS the finished A2UI spec). With no early signal the panel
must show the spinner optimistically for EVERY run, including plain MCP/command runs that never
generate UI. This feature introduces a deterministic EARLY signal by splitting the render MCP
surface into two tools — `get_ui_catalog()` (which Claude must call FIRST to author a valid surface)
and a slimmed `render_ui(spec)` — so the catalog pull becomes the "UI generation has begun" signal.
The spinner then shows ONLY for runs that actually intend to generate UI, and never for plain runs.

## User Scenarios

> Each scenario is independently testable. "Generative panel" = any of the five render targets
> (`generated-ui`, `jira`, `slack`, `confluence`, `google-calendar`); the Open Prompt /
> `generated-ui` panel is the primary one the user referenced.

### Plain command never shows the spinner · P1

**As a** user of a generative panel
**I want to** send a plain, non-UI instruction (e.g. "summarize this in the terminal", a pure
read/MCP call) without the panel showing "Generating…"
**So that** the spinner is meaningful — it appears only when a UI is actually being generated

**Acceptance criteria:**

- Given a generative panel at its idle/base view, when I submit an utterance whose run never calls
  `get_ui_catalog` (a plain command), then the panel does NOT show the "Generating…" `SurfaceSpinner`
  at any point during or after that run.
- Given a plain command run is in flight, when it completes, then the panel remains usable and is
  not left blocked by a spinner.

### UI generation shows the spinner from the moment generation begins · P1

**As a** user of a generative panel
**I want to** see "Generating…" as soon as the agent commits to generating UI (not only once the
finished surface arrives)
**So that** I get prompt feedback that my UI request is being worked on

**Acceptance criteria:**

- Given a generative panel, when I submit an utterance that DOES generate UI, then the
  "Generating…" `SurfaceSpinner` appears as soon as the run calls `get_ui_catalog` (before the
  surface is composed) and remains until the surface lands.
- Given a UI-generation run is in flight, when the surface lands (`ui:render` for that target/tab),
  then the spinner is replaced by the rendered surface.

### The spinner never hangs · P1

**As a** user of a generative panel
**I want to** never be stuck on a spinner that never clears
**So that** an aborted or surface-less run still returns the panel to a usable state

**Acceptance criteria:**

- Given the spinner is showing because `get_ui_catalog` was called, when the run completes or errors
  WITHOUT a surface ever landing (the agent pulled the catalog but aborted), then the spinner clears
  when the run ends and the panel returns to its base/prior surface.
- Given any submitted run, when the run errors, then the panel surfaces the failure exactly as today
  and clears any spinner.

### The catalog stays in sync with the real renderer · P2

**As a** maintainer
**I want to** the catalog the agent reads to be served from one shared source
**So that** the authoring guidance can never drift from the actual A2UI catalog the renderer hosts

**Acceptance criteria:**

- Given the A2UI authoring catalog text, when it is updated, then there is exactly ONE source of
  that text, returned by `get_ui_catalog` and registered byte-identically across all five render
  servers (no per-server copy to keep in sync).

### Backward compatibility if the agent skips the catalog · P2

**As a** user
**I want to** a run that calls `render_ui` directly (older behavior, no `get_ui_catalog`) to still
render its surface
**So that** the new ordering requirement never silently drops a valid surface

**Acceptance criteria:**

- Given a run that calls `render_ui` without first calling `get_ui_catalog`, when the surface is
  valid, then it still renders (the surface-land path is unchanged); the "Generating…" spinner may
  be brief or absent for that run, but the panel is never blocked.

---

## Functional Requirements

> "UI generation begins" = the run invokes `get_ui_catalog` (for any render target). This is the
> deterministic early signal. The finished-surface signal (`ui:render`) and the run-end signals
> (`completed`/`error`) are unchanged and remain the spinner's stop conditions.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The render MCP surface MUST expose a `get_ui_catalog()` tool that returns the A2UI component catalog + authoring rules (the content currently encoded as `A2UI_TOOL_DESCRIPTION`), and a `render_ui(spec)` tool whose behavior is UNCHANGED but whose description is SLIMMED so a correct surface cannot reliably be authored without first calling `get_ui_catalog`. |
| FR-002 | The catalog text MUST be single-sourced in ONE shared module and returned by `get_ui_catalog`, and `get_ui_catalog` MUST be registered byte-identically across all five render servers (`cosmos-render-ui`, `cosmos-jira-render-ui`, `cosmos-slack-render-ui`, `cosmos-confluence-render-ui`, `cosmos-google-calendar-render-ui`), mirroring how `render_ui`/`render_*_ui` are wired. |
| FR-003 | A `get_ui_catalog` invocation MUST produce a non-secret "UI generation has begun" signal that reaches the Electron main process over the existing render bridge socket (a `get_ui_catalog` that returns only locally would be invisible to main). |
| FR-004 | Main MUST forward that begin-signal to the renderer as a non-secret IPC message carrying ONLY the render `target` (and any other non-secret run/correlation info needed to route it). It MUST carry NO token, secret, transcript, or surface content, and MUST be validated warn-and-ignore at the main boundary. |
| FR-005 | The renderer MUST show the per-tab "Generating…" `SurfaceSpinner` ON the originating tab when the begin-signal for that tab's `target` arrives, and MUST clear it when the surface lands (`ui:render`) OR the run completes/errors. The spinner MUST NOT be shown optimistically on plain submit (it is gated on the begin-signal). |
| FR-006 | A submitted run that never produces a begin-signal (never calls `get_ui_catalog`) MUST never show the "Generating…" spinner for that run, and MUST never leave the panel blocked after the run ends. |
| FR-007 | The composer MUST remain interactive (typeable + sendable) throughout a run (`composerInteractiveAfterSubmit` stays `true`); the `busy`/composer-hidden state, where used, MUST track the same begin-signal gate as the spinner so a plain command never hides the composer. |
| FR-008 | The begin-signal MUST be correlated to the originating tab via the existing single-run `originatingTabIdRef` correlation; if the originating tab was closed before the signal arrives, the signal MUST be safely discarded (the panel stays usable). |
| FR-009 | `get_ui_catalog` per target MUST be granted in `allowedToolForTarget`, and `groundingPromptForTarget` MUST instruct the agent to ALWAYS call `get_ui_catalog` before `render_*_ui` to obtain the component catalog. |
| FR-010 | A `render_*_ui` call that arrives WITHOUT a preceding `get_ui_catalog` MUST still render its surface (the surface-land path is unchanged); the new ordering requirement MUST NOT drop a valid surface. |
| FR-011 | The catalog returned by `get_ui_catalog` MUST be non-secret; the begin-signal frame and IPC message MUST carry only non-secret `target`/run info. The change MUST keep ONE typed IPC contract (`src/shared/ipc`), and MUST NOT require a new rollup `input` in `electron.vite.config.ts` (no new server FILE is added — existing servers are extended). |
| FR-012 | Invalid or unexpected begin-signal frames/payloads MUST degrade safely (warn-and-ignore, no thrown error, spinner defaults to hidden), consistent with the existing IPC validate-at-boundary contract. |
| FR-013 | The change MUST NOT regress the existing surface-land, deterministic `jira.*` write re-push, default-view, refreshable-adapter, or per-tab correlation behavior of any generative panel. |

## Edge Cases & Constraints

- **Catalog pulled, no surface ever lands (aborted run).** The begin-signal turned the spinner on;
  the `completed`/`error` run-end MUST still clear it (FR-005) so it never hangs.
- **`render_ui` without `get_ui_catalog` (older / non-compliant agent).** Surface still renders
  (FR-010). The spinner may be absent or only appear once the surface frame is in flight — accepted;
  the panel is never blocked.
- **Multiple `get_ui_catalog` calls in one run.** The begin-signal is idempotent for the originating
  tab — a second signal on an already-spinning tab is a no-op; the stop conditions are unchanged.
- **Single-run correlation.** This relies on `AgentRunner` runs being sequential (one run app-wide,
  §4.10/§4.11). The begin-signal ties to the originating tab via the same `originatingTabIdRef` slot.
  If cosmos ever allows concurrent runs, this breaks identically to today's correlation (a per-run id
  on the begin-signal + `UiRenderPayload` + `AgentSubmitPayload` would be required) — out of scope.
- **Interactive PTY `claude` (not the headless runner).** A `get_ui_catalog`/`render_ui` call from
  the interactive TUI also reaches `UiBridge`, but there is no originating panel tab and no
  `AgentRunner` run-status lifecycle. The begin-signal for such a call has no originating tab and is
  discarded by the renderer correlation (FR-008) — the interactive path's surface still lands as
  today. [See OQ-2.]
- **Latency.** Pulling the catalog adds one extra tool round-trip before the surface is authored.
  Accepted as the cost of a reliable early signal. [See OQ-1.]
- **Out of scope:** changing the headless run lifecycle, the A2UI surface-rendering pipeline, the
  adapter/refresh machinery, the catalog's CONTENT (only its delivery mechanism changes), or any
  panel's visual styling.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Submitting a plain (non-UI) command in any generative panel never shows the "Generating…" `SurfaceSpinner` and never leaves the panel blocked. |
| SC-002 | Submitting a UI-generation request shows the spinner from the moment `get_ui_catalog` is called (before the surface is composed) and replaces it with the surface when it lands. |
| SC-003 | A run that pulls the catalog but never lands a surface clears the spinner at run end (no hang). |
| SC-004 | A run that errors surfaces its error and clears any spinner, for both plain and UI runs. |
| SC-005 | The catalog text exists in exactly one shared module and is served by `get_ui_catalog` across all five render servers; no per-server catalog copy remains. |
| SC-006 | A `render_ui` call without a prior `get_ui_catalog` still renders its surface. |
| SC-007 | No token/secret appears in the begin-signal frame, the IPC payload, the catalog text, or any bridge frame (validated; consistent with CLAUDE.md secret rules). |
| SC-008 | No regression in the Jira/Slack/Confluence/Google Calendar/Generated-UI panels' surface-land, write re-push, default-view, refresh, or correlation behavior. |

---

## Open Questions

- [ ] **OQ-1** Latency vs. reliability of the ordering. Forcing a catalog pull before `render_ui`
  adds one round-trip. Should `render_ui`'s slimmed description retain a MINIMAL inline hint (e.g.
  the one-line "components is a flat array of `{ id, component, ...props }`; call `get_ui_catalog`
  for the full catalog") as a fallback so a compliant-but-impatient model can still produce a valid
  surface — at the cost of a slightly weaker forcing function — or should it be slimmed to the point
  that the catalog pull is effectively mandatory (strongest signal, highest latency)? The PLAN
  should pick a default (recommended: keep a minimal hint + strong instruction, accept occasional
  no-catalog runs handled by FR-010); confirm with the user if the latency/reliability tradeoff
  matters.
- [ ] **OQ-2** Should the begin-signal carry a correlation id so the renderer can ignore signals
  from the INTERACTIVE PTY `claude` (which has no originating tab) explicitly, rather than relying on
  "no originating tab ⇒ discard"? Today's discard behavior (FR-008) already handles it; an explicit
  source/run id would only be needed if interactive-path catalog pulls ever needed to drive UI. The
  spec assumes the discard is sufficient (matching the existing correlation discipline). Confirm.
- [ ] **OQ-3** Signal transport shape: extend `AgentStatusPayload` with a new state/flag (e.g. a
  `generatingUi` boolean or a new `generating` run state) vs. a DEDICATED IPC channel
  (`ui:generatingBegin`). The spec is agnostic (FR-004); the PLAN picks one. A dedicated channel is
  cleaner (the begin-signal originates from `UiBridge`/`get_ui_catalog`, not the `AgentRunner` run
  lifecycle that owns `agent:status`), but reuses the same secret-free, validate-at-boundary, and
  preload-restart discipline either way.
