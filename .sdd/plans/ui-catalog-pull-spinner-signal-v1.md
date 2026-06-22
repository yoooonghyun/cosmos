# Plan: Catalog-pull early signal for UI-generation spinner gating — v1

**Status**: Draft
**Created**: 2026-06-22
**Last updated**: 2026-06-22
**Spec**: .sdd/specs/ui-catalog-pull-spinner-signal-v1.md

---

## Summary

Split the render MCP surface into two tools so the agent must PULL the A2UI catalog before it can
author a surface, turning the catalog pull into a deterministic EARLY "UI generation has begun"
signal. Concretely: (1) extract the static `A2UI_TOOL_DESCRIPTION` catalog text into ONE shared
module and serve it from a new `get_ui_catalog()` tool registered byte-identically in all five
render servers; slim `render_ui`/`render_*_ui`'s description so the catalog pull is the natural
path. (2) On a `get_ui_catalog` invocation each render server fires a NEW fire-and-forget bridge
frame (`{ kind:'generating', callId, target }`) over the SAME `UiBridge` socket. (3) `UiBridge`
forwards a non-secret begin-signal to main, which emits a NEW dedicated IPC channel
(`ui:generatingBegin`, target-only payload) to the renderer. (4) The renderer gates the per-tab
spinner on that begin-signal (replacing the optimistic `inFlightOnSubmit()`): ON when the signal
arrives for the originating tab, OFF when `ui:render` lands or the run completes/errors. (5) Grant
`get_ui_catalog` per target in `allowedToolForTarget` and instruct the ordering in
`groundingPromptForTarget`. No new server file ⇒ no new rollup input.

**Chosen resolutions of the spec's open questions (confirm with user before implementing):**

- **OQ-1** → Keep a MINIMAL inline hint in the slimmed `render_ui` description (one or two lines:
  flat `{ id, component, ...props }` array + "call `get_ui_catalog` first for the full catalog and
  rules"), plus a strong grounding instruction. Accept that a non-compliant run may skip the catalog;
  FR-010 keeps such a surface rendering. Strongest-practical signal without breaking valid surfaces.
- **OQ-2** → No correlation id on the begin-signal in v1; the renderer's existing "no originating
  tab ⇒ discard" handles interactive-PTY catalog pulls (FR-008). Documented as the same sequential-
  run assumption as today's correlation.
- **OQ-3** → A DEDICATED `ui:generatingBegin` channel (NOT a new `AgentStatusPayload` state). The
  begin-signal originates from `UiBridge`/`get_ui_catalog`, not the `AgentRunner` run lifecycle that
  owns `agent:status`, so a dedicated channel keeps the two concerns separate and avoids overloading
  the run-status payload. Reuses the secret-free, validate-at-boundary, preload-restart discipline.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + mcp entry scripts + preload + React renderer) |
| Key dependencies  | `@modelcontextprotocol/sdk` (`McpServer.registerTool`), existing `UiBridge` NDJSON socket, `@a2ui-sdk/*` (unchanged), zod (tool input schema), vitest |
| Files to create   | `src/mcp/uiCatalog.ts` (shared catalog text + `get_ui_catalog` tool registration helper) |
| Files to modify   | `src/mcp/renderUiServer.ts`, `src/mcp/jiraRenderUiServer.ts`, `src/mcp/slackRenderUiServer.ts`, `src/mcp/confluenceRenderUiServer.ts`, `src/mcp/googleCalendarRenderUiServer.ts`, `src/shared/bridge.ts`, `src/main/uiBridge.ts`, `src/main/index.ts`, `src/shared/ipc/ui.ts` (+ `ui.validate.ts`), `src/preload/index.ts`, `src/renderer/promptComposerLogic.ts` (+ `.test.ts`), `src/renderer/useGenerativePanelTabs.ts`, the per-panel components only if `busy` gating needs the begin-signal threaded; `docs/ARCHITECTURE.md` (§4.3/§4.10/§4.11 + §5a), `docs/PROJECT-STRUCTURE.md`, `docs/DEVELOPMENT.md` (add-a-render-tool note) |
| Net-new contract  | Bridge frame `BridgeGeneratingNotification { kind:'generating', callId, target? }` (S→M, fire-and-forget, no result); IPC channel `UiChannel.GeneratingBegin = 'ui:generatingBegin'` with payload `UiGeneratingBeginPayload { target: UiRenderTarget }`; preload `window.cosmos.ui.onGeneratingBegin(listener)` |

### The new contract, precisely

1. **Bridge frame (`src/shared/bridge.ts`)** — a render-server→main sibling of `BridgeRenderRequest`,
   fire-and-forget (main sends NO `BridgeResultResponse` for it; the tool returns the catalog locally):

   ```ts
   /** S->M. A render server signals "the agent began composing UI" (it called get_ui_catalog).
    *  Fire-and-forget: main forwards a non-secret begin-signal to the renderer and sends NO result.
    *  NON-SECRET: target only. */
   export interface BridgeGeneratingNotification {
     kind: 'generating'
     /** Entry-script-side correlation id for the get_ui_catalog call (debug/trace only). */
     callId: string
     /** Which panel this UI generation targets; absent ⇒ 'generated-ui'. */
     target?: UiRenderTarget
   }
   ```
   Extend `BridgeClientMessage = BridgeRenderRequest | BridgeGeneratingNotification` and the
   `encodeBridgeMessage` union. `UiBridge.onMessage` gains a `message.kind === 'generating'` branch
   (BEFORE the existing `kind !== 'render'` reject) that forwards the begin-signal and returns — it
   NEVER touches `this.active`, mints no `requestId`, and settles no call.

2. **IPC channel (`src/shared/ipc/ui.ts`)** — dedicated, non-secret, target-only:

   ```ts
   UiChannel.GeneratingBegin = 'ui:generatingBegin'   // M->R
   export interface UiGeneratingBeginPayload { target: UiRenderTarget }  // NO secret
   ```
   Add `onGeneratingBegin(listener: (p: UiGeneratingBeginPayload) => void): () => void` to `UiApi`,
   and `validateUiGeneratingBeginPayload` in `ui.validate.ts` (target ∈ the known render targets;
   invalid ⇒ warn-and-ignore). Main sends it via `mainWindow.webContents.send(...)` from the
   `UiBridge` `generating` handler (a new injected `pushGeneratingBegin` dep on `UiBridgeDeps`,
   mirroring `pushRender`/`pushDataModel`).

3. **Preload (`src/preload/index.ts`)** — expose `onGeneratingBegin` under `window.cosmos.ui`.
   NEW preload method ⇒ a full `npm run dev` restart is required (CLAUDE.md; HMR leaves it
   "not a function").

## Implementation Checklist

> Ordered: shared catalog module → server wiring → bridge frame → main signal → IPC contract →
> renderer gating → tests → docs. Each phase compiles + the prior phase's behavior is preserved.

### Phase 1 — Shared catalog module + `get_ui_catalog` across all five servers (FR-001/FR-002/SC-005)

- [ ] Create `src/mcp/uiCatalog.ts`: move the `A2UI_TOOL_DESCRIPTION` string body (renderUiServer.ts
  lines 176-257) here verbatim as the exported `A2UI_CATALOG_TEXT` (single source). Keep the
  refreshable-bindings section. Export a `registerGetUiCatalogTool(server, { onGenerating })` helper
  that registers the `get_ui_catalog` tool (no input args; returns `A2UI_CATALOG_TEXT` as a text
  content result) and calls the injected `onGenerating()` side-effect on invocation (the bridge
  notify). This keeps the catalog + tool wiring single-sourced so all five servers are byte-identical.
- [ ] In each of the five render servers (`renderUiServer.ts`, `jiraRenderUiServer.ts`,
  `slackRenderUiServer.ts`, `confluenceRenderUiServer.ts`, `googleCalendarRenderUiServer.ts`):
  register `get_ui_catalog` via the shared helper, passing an `onGenerating` that fires the bridge
  `generating` frame for that server's `target` (Phase 3). Each server already constructs a
  `BridgeClient` — extend it with a `notifyGenerating(target)` method (Phase 3).
- [ ] Slim each server's `render_*_ui` description to a MINIMAL hint (OQ-1): drop the full catalog,
  keep one or two lines (flat `{ id, component, ...props }` array + "ALWAYS call `get_ui_catalog`
  first to get the component catalog and authoring rules"). The Jira/Slack/Confluence/Calendar
  servers have their OWN custom-catalog descriptions — confirm whether `get_ui_catalog` should return
  the STANDARD catalog only or a per-target catalog. **Decision for v1:** `get_ui_catalog` returns the
  STANDARD `A2UI_CATALOG_TEXT` (the component grammar + bindings rules are the same across catalogs);
  each custom render tool keeps a SHORT per-target catalog note inline (it is small and panel-specific).
  Re-confirm in Phase 4 docs.
- [ ] Review: the five servers' `get_ui_catalog` registration + `notifyGenerating` wiring are
  byte-identical (single helper); no per-server catalog copy remains.

### Phase 2 — Grant + ordering in `mcpConfig.ts` (FR-009)

- [ ] Add per-target `get_ui_catalog` grant constants
  (`mcp__cosmos-render-ui__get_ui_catalog`, `mcp__cosmos-jira-render-ui__get_ui_catalog`, …) and
  include each in `allowedToolForTarget(target)` alongside the matching render tool.
- [ ] In `groundingPromptForTarget(target)`: prepend a clause for EVERY render target (including
  `generated-ui`, which currently returns `undefined`) — "Before calling `render_*_ui`, ALWAYS call
  `get_ui_catalog` to get the component catalog and authoring rules." For `generated-ui` this means
  `groundingPromptForTarget('generated-ui')` now returns a (short) prompt instead of `undefined` —
  verify the `AgentRunner` `--append-system-prompt` wiring tolerates a prompt for the default target
  (it does; it only skips when `undefined`).
- [ ] The interactive PTY (`embeddedMcpConfig` in `index.ts`) registers all five render servers but
  does NOT pass `--allowedTools`/grounding (the TUI is unrestricted). `get_ui_catalog` is auto-
  available there once registered — no `embeddedMcpConfig` change beyond the servers already present.

### Phase 3 — Bridge frame + `BridgeClient.notifyGenerating` (FR-003)

- [ ] `src/shared/bridge.ts`: add `BridgeGeneratingNotification` (shape above), extend
  `BridgeClientMessage` and the `encodeBridgeMessage` parameter union.
- [ ] In each server's `BridgeClient`: add `notifyGenerating(target?)` — `ensureConnected()` then
  write an `encodeBridgeMessage({ kind:'generating', callId: randomUUID(), target })` frame
  fire-and-forget (no waiter registered; swallow write errors — a missing bridge must NOT fail the
  catalog return, FR-010/FR-012). Each server passes its own `target` (the render servers already
  know their target: `renderUiServer` omits ⇒ `'generated-ui'`, jira passes `'jira'`, etc.).

### Phase 4 — Main: `UiBridge` handler + `ui:generatingBegin` emit (FR-003/FR-004)

- [ ] `src/main/uiBridge.ts`: add a `pushGeneratingBegin?: (p: { target: UiRenderTarget }) => void`
  dep to `UiBridgeDeps`. In `onMessage`, BEFORE the `kind !== 'render'` reject, add:
  `if (message.kind === 'generating') { this.pushGeneratingBegin?.({ target: message.target ?? DEFAULT_UI_RENDER_TARGET }); return }`.
  It mints no requestId, touches no `this.active`, settles no call — pure forward + return.
- [ ] `src/main/index.ts`: wire `pushGeneratingBegin` into the `UiBridge` construction to
  `mainWindow.webContents.send(UiChannel.GeneratingBegin, validated)` (validate at the boundary;
  guard a destroyed window — mirror `pushRenderToRenderer`). NO secret on the payload (target only).

### Phase 5 — IPC contract + preload (FR-004/FR-011/FR-012)

- [ ] `src/shared/ipc/ui.ts`: add `UiChannel.GeneratingBegin = 'ui:generatingBegin'`,
  `UiGeneratingBeginPayload { target: UiRenderTarget }`, and `UiApi.onGeneratingBegin`.
- [ ] `src/shared/ipc/ui.validate.ts`: add `validateUiGeneratingBeginPayload` (target is a known
  `UiRenderTarget`; invalid ⇒ warn + return null). Keep `channelUniqueness.test.ts` green.
- [ ] `src/preload/index.ts`: expose `window.cosmos.ui.onGeneratingBegin` (NEW preload method —
  full restart required, note in DEVELOPMENT.md).

### Phase 6 — Renderer gating (FR-005/FR-006/FR-007/FR-008)

- [ ] `src/renderer/promptComposerLogic.ts`: change `inFlightOnSubmit()` to return `false`
  (submit no longer optimistically spins) — keep it as the named, node-tested helper, update its
  doc to reflect the begin-signal gate. Keep `composerInteractiveAfterSubmit()` = `true` (FR-007).
  `surfaceSpinnerVisible(...)` stays as-is (it already keys off `inFlight`); the change is WHAT sets
  `inFlight`.
- [ ] `src/renderer/useGenerativePanelTabs.ts`:
  - In `submit()`: set the originating tab's `inFlight` from `inFlightOnSubmit()` (now `false`) but
    STILL set `originatingTabIdRef`/`pendingUtteranceRef` (correlation must persist so the
    begin-signal and the surface can find the tab). Clearing the prior surface on resubmit stays.
  - Add a `window.cosmos.ui.onGeneratingBegin` subscription: when a begin-signal for THIS panel's
    `target` arrives, set `inFlight: true` on `originatingTabIdRef.current` (if still open; discard
    otherwise — FR-008). Idempotent (a second signal on an already-in-flight tab is a no-op).
  - The existing `ui:render` subscription (clears `inFlight` on surface land) and the `agent:status`
    `completed`/`error` release (`shouldReleaseInFlightOnCompleted`) are UNCHANGED and remain the
    stop conditions (FR-005). `producedSurface` becomes belt-and-suspenders (the begin-signal is now
    the primary engage signal; the `completed` release still clears a catalog-pulled-but-no-surface
    run — SC-003).
  - Read the new subscription's deps through refs (like `onUnsolicitedFrameRef`) so the long-lived
    subscription never re-subscribes.
- [ ] Per-panel components: where a panel passes `busy` to `<PromptComposer>` from its active tab's
  spinner gate, no change is needed — `busy` is already derived from the same `inFlight`/spinner
  gate, which now tracks the begin-signal. Confirm each panel (Generated UI / Jira / Slack /
  Confluence / Calendar) still computes `busy`/`showSpinner` from the active tab.

### Phase 7 — Tests

- [ ] `promptComposerLogic.test.ts`: `inFlightOnSubmit()` now `false`; `composerInteractiveAfterSubmit()`
  still `true`; `surfaceSpinnerVisible` table unchanged (re-assert it keys off `inFlight`).
- [ ] `ui.validate.test.ts` (or the ui-domain validator test): `validateUiGeneratingBeginPayload`
  accepts each known target, warns-and-drops an unknown/missing target and a non-object.
- [ ] `uiBridge.test.ts` (or new): a `{ kind:'generating', target }` frame calls `pushGeneratingBegin`
  with the target (default `'generated-ui'` when absent), does NOT mint a requestId, does NOT push a
  render, does NOT settle/alter `this.active`; a malformed frame is ignored.
- [ ] `bridge` encode test: `BridgeGeneratingNotification` round-trips through
  `encodeBridgeMessage`/parse.
- [ ] A `uiCatalog` test: `registerGetUiCatalogTool` registers a `get_ui_catalog` tool whose handler
  returns `A2UI_CATALOG_TEXT` and invokes the injected `onGenerating` once per call (mock the server +
  the notify). Optionally assert the five servers each call the shared helper (smoke import check).
- [ ] Renderer correlation: if a `useGenerativePanelTabs` test harness exists, assert a begin-signal
  for the originating tab sets `inFlight`, a begin-signal for a closed tab is discarded, and
  `completed` with no surface clears `inFlight` (SC-001/SC-003). If no harness, cover the pure
  decision in `promptComposerLogic` and document the manual check.
- [ ] `npm run typecheck` + `npm test` green.

### Phase 8 — Docs

- [ ] `docs/ARCHITECTURE.md`:
  - §4.3 (Render MCP tools): document the two-tool surface — `get_ui_catalog` (single-sourced catalog
    text in `src/mcp/uiCatalog.ts`, registered byte-identically in all five render servers) + slimmed
    `render_*_ui`; and the fire-and-forget `{ kind:'generating' }` bridge frame → `UiBridge`
    `pushGeneratingBegin` → `ui:generatingBegin` IPC.
  - §4.11 / §4.10 (spinner gating): record that the per-tab "Generating…" spinner is now gated on the
    `get_ui_catalog` EARLY begin-signal (replacing the optimistic `inFlightOnSubmit`), with `ui:render`
    land + `completed`/`error` as stop conditions; the begin-signal is non-secret (target only) and
    correlates to the originating tab via the same `originatingTabIdRef` (valid only while runs are
    sequential).
  - §5a (utterance → surface flow): add the `get_ui_catalog` pull step before `render_*_ui`.
- [ ] `docs/PROJECT-STRUCTURE.md`: add `src/mcp/uiCatalog.ts`.
- [ ] `docs/DEVELOPMENT.md`: extend the add-a-render-server recipe — a new render server must also
  register `get_ui_catalog` via the shared helper + fire the `generating` frame; note the new
  `onGeneratingBegin` preload method needs a full dev restart.
- [ ] Update §7 Open Questions / Next Steps with this cycle's entry; mark this plan's deviations.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-22**: Plan authored. OQ-1/OQ-2/OQ-3 given default resolutions (minimal inline hint kept;
  no correlation id in v1; dedicated `ui:generatingBegin` channel). Confirm these with the user before
  implementing — particularly OQ-1 (latency/reliability of forcing the catalog pull) and OQ-3
  (dedicated channel vs. `AgentStatusPayload` flag).
