# Plan: Panel-Level Refresh for Generative-Adapter Surfaces — v1

**Status**: Draft (revised 2026-06-09 — OQ-1 mechanism pivoted; see "Change from prior plan")
**Created**: 2026-06-09
**Last updated**: 2026-06-09
**Spec**: .sdd/specs/panel-refresh-v1.md

---

## Summary

Replace the per-surface catalog `RefreshButton` with ONE refresh control per generative
panel, mounted in the panel chrome (outside the A2UI host) and acting on the active tab's
registered surface. Fix the renderer's one-shot action guard so `adapter.*` actions repeat
while the terminal `submit` stays one-shot — this alone restores Jira's repeat-refresh. Make
the **agent-composed** Slack/Confluence (and optionally Generated UI / Jira) surfaces
refreshable by letting the composing agent attach an OPTIONAL secret-free
`descriptor { dataSource, query }` to its render call; main validates it at the bridge
boundary, registers it with the existing `AdapterDispatcher` (bind options via the existing
composite resolver), and forwards it in the existing `UiRenderPayload.descriptor` field that
the renderer already persists. On `adapter.refresh`, main re-executes the descriptor exactly
as Jira's `handleJiraView`-registered surfaces do — token attached in main, only non-secret
values cross. This fixes the user's actual symptom (refresh broken on an agent-composed
`render_slack_ui` surface) instead of adding a separate native view.

## Change from prior plan (2026-06-09)

The prior draft chose a **native panel-driven bound-compose** path (a new main-side
`handle*View` mirroring Jira, fed by new `Request*SurfaceView` IPC channels). Per user
direction this is DROPPED as the primary mechanism: it would have made a *separate native
view* refreshable but left the user's actual broken surface (agent-composed via
`render_slack_ui`) un-refreshable. The new mechanism (the agent emits the descriptor) is the
previously-"deferred" option `agent-bound-surface-descriptor-v1`, now pulled INTO this cycle.
No new `Request*SurfaceView` IPC channels are added. Reused from the prior plan: the dormant
`buildBound*Surface` builders + resolvers + composite resolver + `*BindOptions` remain the
registration target — only the TRIGGER moved from a native main-side read to the agent's
render call.

## OQ-1 resolution — agent-emitted secret-free descriptor

**Runtime flow today (verified):**
- The embedded `claude` already fetches Slack/Confluence data through the **MCP read proxy**:
  a `render`-target run is granted `cosmos-slack` / `cosmos-confluence` read tools whose MCP
  entry scripts relay a `slack_call` / `confluence_call` bridge frame (`{ op, params }`,
  non-secret) to main; `SlackManager` / `ConfluenceManager` attach the token **in main** and
  return typed data — NO token crosses (`src/shared/bridge.ts` SlackBridgeCallRequest /
  ConfluenceBridgeCallRequest, FR-021/SC-008). So the agent ALREADY holds the exact non-secret
  `{ op, params }` (≡ `{ dataSource, query }`) it used to obtain the data it is now rendering.
- The agent then calls `render_slack_ui` / `render_confluence_ui`, whose entry script sends a
  `BridgeRenderRequest { kind:'render', callId, spec, target }` (`src/shared/bridge.ts:70`).
  Today that frame carries `spec` + `target` only — **no descriptor** — so `UiBridge.onMessage`
  (`src/main/uiBridge.ts:151`) pushes a literal-data surface and main cannot register it.

**Mechanism (the contract):**
1. **Tool param.** Extend `render_slack_ui` / `render_confluence_ui` (and, for consistency,
   `render_ui` / `render_jira_ui`) to accept an OPTIONAL `descriptor` argument shaped exactly
   like the existing `AdapterDescriptor` (`{ dataSource, query }`, secret-free). The entry
   script passes it through onto the bridge frame.
2. **Bridge frame.** Add an OPTIONAL `descriptor?: AdapterDescriptor` field to
   `BridgeRenderRequest` (`src/shared/bridge.ts`). Non-secret; absent on a legacy frame
   (backward-compatible).
3. **Main validation + registration.** In `UiBridge.onMessage`, when a render frame carries a
   `descriptor`, validate it at the boundary (a new `validateAdapterDescriptor`, parallel to the
   existing `validateAdapterAction`): it must be a known `dataSource` whose `query` shape
   matches, AND its `dataSource` must belong to the frame's `target` integration (OQ-4 / FR-012
   — reject a cross-target descriptor). Invalid → warn + ignore, surface still renders (FR-012).
   Valid → derive bind options via the existing composite resolver chain
   (`slackBindOptionsForSource` → `confluenceBindOptionsForSource` → Jira split, already in
   `src/main/index.ts` ~623) and `adapterDispatcher.register(surfaceId, descriptor, opts)` keyed
   by `spec.surfaceId`, then forward the descriptor in the pushed `UiRenderPayload.descriptor`
   (the field already exists; the renderer already persists + carries it onto the tab).
   `UiBridge` gains an injected `registerDescriptor(surfaceId, descriptor, target)` dep (it must
   stay panel/dispatcher-agnostic by construction) wired in `src/main/index.ts`.
4. **Refresh.** Unchanged from Jira: the panel refresh control dispatches
   `adapter.refresh { surfaceId }`; main routes it to `adapterDispatcher.refresh(surfaceId)`,
   which re-executes the registered descriptor via the composite resolver (token attached in
   main) and pushes `updateDataModel`. No view re-compose, no agent round-trip.

**Security.** The descriptor is `dataSource` (enum) + non-secret query params (channelId / cql /
query text / cursor / pageId) — the SAME shape the agent already legitimately passes on
`slack_call` / `confluence_call`. It NEVER carries a token; the token is attached only in main
at re-execution time (existing invariant). Validated at the main boundary like every other
cross-process payload (CLAUDE.md). A surface composed without a descriptor renders normally and
is simply non-refreshable.

**Bind options + listPath (interface-step caution).** The agent supplies `{ dataSource, query }`
but NOT the bound `listPath` / `pagination` — those are catalog/renderer concerns main derives
from `dataSource` via the existing `*BindOptionsForSource` selectors (no new agent surface
area). A refresh writes `updateDataModel` at the `listPath` the bind options imply (e.g.
`/items`), so the agent-authored spec must bind its data at that SAME path/flags for the in-place
update to land. See OQ-5: if a hand-authored agent spec cannot be guaranteed to match the bound
contract, the robust variant is for main to COMPOSE the bound surface from the descriptor
(reusing `buildBound*Surface` + an initial `updateDataModel`) and push THAT instead of the
agent's literal spec — making "agent emits descriptor" effectively "agent picks the data, main
composes the bound view." The interface step picks trust-the-spec vs. main-composes; the
contract (agent emits `{dataSource,query}`, token stays in main) is identical either way.

## OQ-2 resolution — Generated UI panel refresh

A `render_ui` surface is now refreshable IFF its render call carried a descriptor (FR-010
makes the param optional on `render_ui` too). When the agent supplies one, the Generated UI
panel's control is enabled and refreshes like any other; when it does not, the shared
enabled/disabled derivation (FR-003/FR-004) yields disabled naturally. Decision: the Generated
UI panel mounts the SAME shared control — no special-case hide, no per-panel branching.
(Whether the generic catalog has bound components to render against is a `render_ui`
prompt/catalog matter, not a blocker for this control.)

## Technical Context

| Item              | Value                                                                                                   |
|-------------------|---------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer), A2UI 0.9                                                    |
| Key dependencies  | `AdapterDispatcher`, secret-free `AdapterDescriptor`, `updateDataModel` IPC, reserved `adapter.*` actions, shared `catalogShared/controls`, `useGenerativePanelTabs` |
| Files to create   | `src/renderer/PanelRefreshButton.tsx` (panel-chrome control) + its `.test.ts(x)`; `src/renderer/panelRefreshLogic.ts` (pure enabled/busy derivation) + test; a `validateAdapterDescriptor` (in `src/shared/validate.ts` or beside `validateAdapterAction`) + test |
| Files to modify   | `src/shared/bridge.ts` (`BridgeRenderRequest.descriptor?`), the four render entry scripts (`src/mcp/{renderUiServer,jiraRenderUiServer,slackRenderUiServer,confluenceRenderUiServer}.ts`) + their tool input schemas/descriptions, `src/main/uiBridge.ts` (validate + register on render frame), `src/main/index.ts` (wire `registerDescriptor` dep into `UiBridge`), `src/renderer/ActiveTabSurface.tsx` (guard split), `src/renderer/catalogShared/controls.tsx` + jira/slack/confluence catalogs + `*SurfaceBuilder.ts` (drop in-surface RefreshButton), `src/renderer/{Jira,Slack,Confluence,GeneratedUi}Panel.tsx` (mount control), `docs/ARCHITECTURE.md`. NOTE: NO new IPC channels / preload methods needed (descriptor rides the existing bridge + `UiRenderPayload.descriptor`). |

### Design dependency

This is a UI-bearing feature → a **design step (designer)** precedes the interface step. The
designer owns the panel refresh control's placement per panel (tab strip vs. footer vs. a
chrome row), its idle/busy/disabled visual states, ARIA, and the spinner treatment, producing
`.sdd/designs/panel-refresh-v1.md`. The component file is created by the developer per that
design. Plan items below assume that design spec exists before Phase 1 (Interface).

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 0 — Design (designer, before interface)

- [x] Design spec `.sdd/designs/panel-refresh-v1.md`: panel-chrome refresh control placement
      per panel (4 panels), idle/in-flight/disabled states, ARIA label + busy, spinner
      (reuse `lucide` `RotateCw` / `Loader2` parity with the removed in-surface control)
- [x] Confirm the control is visually distinct from `LoadMoreButton`/`PaginationBar` (which
      stay in-surface) and from the prompt composer's send-spinner

### Phase 1 — Interface

- [x] Read spec + design; confirm no open questions remain (OQ-1/OQ-2 resolved; OQ-4/OQ-5 decided here)
- [x] `src/shared/bridge.ts`: add OPTIONAL `descriptor?: AdapterDescriptor` to
      `BridgeRenderRequest` (secret-free; absent on legacy frames — backward-compatible). NO new
      IPC channels and NO preload methods (descriptor rides the existing render bridge frame and
      the existing `UiRenderPayload.descriptor`).
- [x] `validateAdapterDescriptor` (beside `validateAdapterAction`): known `dataSource` + matching
      non-secret `query` shape, and `dataSource` ∈ the frame's `target` integration (OQ-4 — reject
      a cross-target descriptor). Invalid → caller warns + ignores.
- [x] Render tool input schemas: extend `render_slack_ui` / `render_confluence_ui` (and, for
      consistency, `render_ui` / `render_jira_ui`) with an OPTIONAL `descriptor { dataSource,
      query }` param; the entry script passes it onto the bridge frame.
- [x] OQ-5 decision (trust-the-spec vs. main-composes): pick whether main registers the agent's
      literal spec as-is (agent must bind its data at the `*BindOptions` `listPath`) OR main
      composes the bound surface from the descriptor via `buildBound*Surface` and pushes THAT.
      Default to **main-composes** unless the interface work shows the agent spec reliably matches
      the bound contract — the secure contract (agent emits `{dataSource,query}`, token stays in
      main) is identical either way.
- [x] Define the `PanelRefreshButton` prop contract (active `surfaceId | null`, `registered`
      boolean, `busy` boolean) + a pure `panelRefreshLogic` deriving enabled/busy from the
      active tab's surface (has descriptor/registered? in-flight?), no invented props vs. spec

### Phase 2 — Testing

- [ ] `ActiveTabSurface` guard: `adapter.*` actions repeat (N sends all forwarded); a terminal
      `submit` still blocked after first send (FR-008/FR-009) — pure-logic test of the
      submitted-set split (only terminal submit is added to `submittedRef`)
- [x] `panelRefreshLogic`: enabled only when active tab has a registered/bound (descriptor)
      surface; disabled for empty/Untitled tab, native-base view, non-adapter surface; busy
      while a refresh is in flight; re-derives after tab switch (FR-003/FR-004/FR-017)
- [ ] `PanelRefreshButton`: idle click dispatches `adapter.refresh {surfaceId}`; busy click is
      a no-op; disabled state non-actionable; ARIA label + `aria-busy` (FR-002/FR-018)
- [x] `validateAdapterDescriptor`: accepts a well-formed same-target descriptor; rejects a bad
      `dataSource`, a mismatched `query` shape, a cross-target descriptor, and anything carrying
      a token-like field (FR-012/FR-013/OQ-4)
- [x] `UiBridge` render-frame path: a frame WITH a valid descriptor → calls the injected
      `registerDescriptor(surfaceId, descriptor, target)` and forwards descriptor in the pushed
      `UiRenderPayload.descriptor`; a frame with an absent/invalid descriptor → surface still
      pushed, no registration (FR-011/FR-012); descriptor never carries a secret (FR-013)
- [x] Boundary: malformed `adapter.*` still warned + ignored; refresh of unregistered
      surfaceId is a safe no-op (FR-014/FR-015) — existing dispatcher tests cover most; add a
      panel-control-level guard test

### Phase 3 — Implementation

- [x] `src/renderer/ActiveTabSurface.tsx`: split the one-shot guard — only the terminal
      `submit` consumes `submittedRef`; `adapter.*` (and the existing renderer-local
      `onAction` intercept) never do. Keep the existing restore-refresh effect (it already
      fires `adapter.refresh` and must remain repeatable).
- [x] `src/renderer/catalogShared/controls.tsx`: remove `RefreshButton` (and `RefreshButtonNode`)
      OR keep the symbol but stop registering it in catalogs; `LoadMoreButton` / `PaginationBar`
      unchanged. Confirm no remaining catalog references compile.
- [x] jira/slack/confluence catalogs (`*Catalog/components.tsx` / index): drop the
      `RefreshButton` registration + any bound-surface builder that emitted a RefreshButton node
      (Jira `jiraSurfaceBuilder.ts`, Slack `slackSurfaceBuilder.ts`, Confluence
      `confluenceSurfaceBuilder.ts`) so composed surfaces no longer carry an in-surface refresh
      control (FR-006). LoadMore/Pagination nodes stay.
- [x] `src/renderer/PanelRefreshButton.tsx`: the shared panel-chrome control per the design;
      dispatches `window.cosmos.ui.sendAction({ requestId, action: adapter.refresh, values:
      {surfaceId} })` for the ACTIVE tab's surfaceId (no descriptor — registered live).
- [x] Mount `PanelRefreshButton` in each of the four `*Panel.tsx` chromes, fed the active
      tab's surface state (surfaceId + registered/has-descriptor + busy). GeneratedUiPanel
      mounts it too (always-disabled per OQ-2).
- [x] `src/shared/bridge.ts` + the four render entry scripts
      (`src/mcp/{renderUiServer,jiraRenderUiServer,slackRenderUiServer,confluenceRenderUiServer}.ts`):
      add the optional `descriptor` tool param + pass it onto `BridgeRenderRequest`.
- [x] `src/main/uiBridge.ts`: on a render frame with a descriptor → `validateAdapterDescriptor`,
      then (per OQ-5 decision) register + push. Inject a `registerDescriptor(surfaceId,
      descriptor, target)` dep so `UiBridge` stays dispatcher-agnostic; wire it in
      `src/main/index.ts` to `adapterDispatcher.register(...)` using the composite resolver's
      `*BindOptionsForSource`. Reuse the existing `buildBound*Surface` if OQ-5 = main-composes.
- [x] Typecheck (node + web) + full test suite green

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4g: panel-LEVEL refresh in chrome (one per panel),
      in-surface RefreshButton removed, LoadMore/Pagination stay in-surface; close the "Known
      seam" — an agent-composed surface that attaches a secret-free `descriptor {dataSource,
      query}` to its `render_*_ui` call is now registered + refreshable end-to-end (token stays
      in main); a render call without a descriptor renders normally but non-refreshable.
- [ ] Update `TODO.md` (wrap-up): check off the panel-refresh seam item.
- [ ] Update this plan + `memory_save` any new decision

---

## Resolved here (was prior follow-up)

The previously-deferred **`agent-bound-surface-descriptor-v1`** (making agent-composed surfaces
refreshable via an agent-emitted descriptor) is **pulled INTO this cycle** per user direction —
it IS the OQ-1 mechanism above. No separate follow-up remains for it.

## Deviations & Notes

- **2026-06-09**: First draft chose candidate 1 (native panel-driven bound-compose mirroring
  Jira). **Revised same day** per user direction: pivoted OQ-1 to the **agent-emitted secret-free
  descriptor** mechanism so the user's actual broken surface (agent-composed `render_slack_ui`)
  becomes refreshable; native `Request*SurfaceView` IPC channels DROPPED (no new channels/preload).
  OQ-2: Generated UI control refreshable iff its `render_ui` call carried a descriptor, else
  disabled (shared control, no special-case). New open items OQ-4 (per-tool `dataSource`
  allow-list / cross-target reject) and OQ-5 (trust-the-spec vs. main-composes) decided in the
  interface step.
- **2026-06-09 (orchestrator)**: the architect's revision stream timed out mid-edit, leaving the
  checklist + tail on the stale candidate-1 mechanism while the top half was already pivoted.
  Phases 1–4 + this tail reconciled to the agent-emitted-descriptor decision to make the plan
  self-consistent; the architectural decision (top half + spec) was not changed.
- **2026-06-09 (developer) — OQ-5 = MAIN-COMPOSES.** Chose main-composes over trust-the-spec: a
  render frame carrying a `descriptor` does NOT push the agent's literal-prop spec (it can't
  repaint on a later `adapter.refresh` — literal props ignore `updateDataModel`). Instead a new
  PURE `src/main/descriptorShell.ts#resolveDescriptorShell(descriptor)` maps `dataSource` → the
  matching DATA-FREE `{path}`-bound shell (`buildSlackBoundShell`/`buildConfluenceBoundShell`/
  `buildJiraBoundShell`) + bind options; `UiBridge` (via an injected `registerDescriptor` dep
  wired in `index.ts`) registers the shell's stable surfaceId with the dispatcher, kicks its
  first `refresh()` (token in main), and pushes the SHELL (descriptor forwarded in
  `UiRenderPayload.descriptor`). Rationale: a hand-authored agent spec can't be guaranteed to
  bind at the dispatcher's `listPath`/flags, so composing the bound view in main is the robust
  variant. An unknown source / no descriptor → falls through to the agent's literal spec,
  rendered normally but non-refreshable (FR-012).
- **2026-06-09 (developer) — test-coverage shape.** Phase 2's `ActiveTabSurface` guard-split and
  `PanelRefreshButton` items are covered indirectly, not as dedicated DOM tests: the vitest
  config is node-only (`include: ['src/**/*.test.ts']`, no `.test.tsx`), and both the guard-split
  and the button's dispatch live INSIDE `.tsx` (DOM) components with no extractable pure module.
  The button's dispatch DECISION is the pure `shouldDispatchRefresh` + the enabled/busy derivation
  (`panelRefreshLogic.test.ts`); the guard-split predicate (`adapter.*`/`jira.*` repeatable vs.
  one-shot `submit`) remains `.tsx`-internal and is exercised only at runtime. Added: 16 new
  tests across `panelRefreshLogic.test.ts` (new) + `descriptorShell.test.ts` (new), plus
  cross-target/`adapterSourceMatchesTarget` cases appended to `validateAdapter.test.ts`; the
  `UiBridge` render-frame descriptor path is the wiring around those validated pure units rather
  than a separate harness. Suite 871 → 900 passing (45 → 47 files); typecheck (node + web) green.
