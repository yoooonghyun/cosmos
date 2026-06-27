# Plan: Cosmos Conversation Panel — v1

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: .sdd/specs/cosmos-conversation-panel-v1.md

---

## Grounding

See the spec's Grounding section for the full list of `codegraph_explore` /
`memory_recall` / `memory_save` queries and the files read. The load-bearing findings the plan
is built on:

- **`AgentRunner.run()` (`src/main/agentRunner.ts`) spawns a fresh ephemeral `claude -p` per
  submit, no `--session-id`/`--resume`, and discards stdout.** There is no transcript to read; the
  timeline is assembled from the streams the renderer already receives.
- **`SurfaceId` (`src/renderer/railVisibility.ts`) ≠ `UiRenderTarget`
  (`src/shared/ipc/common.ts`).** `'generated-ui'` exists in BOTH (a rail id AND a render target).
  The swap renames the **rail id** to `'cosmos'`; the plan's chosen default (OQ-2) keeps the
  **wire render target** `'generated-ui'`.
- The renderer's per-run record lives in `useGenerativePanelTabs.ts` (utterance label + landed
  surface + error), filed into the originating tab; `GeneratedUiPanel.tsx` hosts the active tab's
  `<A2UIProvider catalogId="standard">` and publishes the composer via
  `usePublishComposer('generated-ui', …)`.
- `App.tsx` renders the rail from `RAIL_ITEM` + `visibleIds.map`, and the panels as six
  `TabsContent` blocks; `SharedComposer surface={surface}` routes Open-Prompt to the active surface.
- `src/main/index.ts`: `agent:submit` (line ~1362) → `agentRunner.run`; `pushRenderToRenderer` +
  `renderPushedForRun` (line ~1910) drives `producedSurface`; the `AgentRunner` `onStatus` stamps
  it (line ~2211). These stay UNCHANGED under the chosen OQ-2 decision.

---

## Summary

Remove the Generated UI rail panel and introduce a **Cosmos** rail panel that renders the
default agent's Open-Prompt history as a single append-only, interactive timeline. The chosen
technical approach (pending OQ confirmation) is **renderer-centric and low-risk**: rename the rail
`SurfaceId` `'generated-ui'` → `'cosmos'`, keep the **wire `UiRenderTarget` literal
`'generated-ui'`** (no MCP/bridge/grant/main churn), and build the Cosmos panel as a timeline that
**accumulates** the run-lifecycle + `ui:render` stream it already receives into ordered entries
(each hosting the existing standard-catalog `A2UIProvider` inline) instead of the current
replace-per-tab tab strip. Session persistence reuses the existing `generated-ui` snapshot slice.
No new IPC channel is anticipated; the feature is renderer + a small `railVisibility`/`App.tsx`
swap. **This is a UI-bearing change → a `design` step (designer) is required before
implementation** for the Cosmos panel chrome and the conversation-timeline entry/state visuals.

> NOTE: This plan documents the recommended path. The spec's Open Questions (esp. OQ-1 inline
> surfaces, OQ-2 wire-target identity, OQ-3 transcript depth, OQ-4 tabs) MUST be confirmed by the
> user before implementation begins. Phase 0 below is the gate.

---

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (React 19 renderer; Electron main; shared IPC) |
| Key dependencies | `@a2ui-sdk/react` (existing standard catalog), existing `useGenerativePanelTabs` / `ActiveTabSurface` / `A2UIProvider`, `PromptComposer` + `ActiveComposerProvider`, `railVisibility.ts`, session-persistence snapshot |
| Files to create | `src/renderer/CosmosPanel.tsx` (the timeline panel); `src/renderer/cosmosTimeline.ts` (pure timeline accumulation/state logic, `.ts`/`.test.ts` split) + `cosmosTimeline.test.ts`; (optional) `src/renderer/CosmosTimelineEntry.tsx` |
| Files to modify | `src/renderer/railVisibility.ts` (SurfaceId/ALWAYS_PRESENT/ALL_SURFACE_IDS); `src/renderer/App.tsx` (RAIL_ITEM, the `TabsContent`, imports); `src/renderer/railVisibility.test.ts` (if it asserts ids); docs (`ARCHITECTURE.md`, `PROJECT-STRUCTURE.md`) |
| Files to delete | `src/renderer/GeneratedUiPanel.tsx` (replaced by `CosmosPanel.tsx`) |
| Files explicitly UNCHANGED (OQ-2 = keep wire target) | `src/shared/ipc/common.ts` (`UiRenderTarget`, `DEFAULT_UI_RENDER_TARGET`), `src/main/uiBridge.ts`, `src/main/agentRunner.ts`, `src/main/mcpConfig.ts`, `src/mcp/renderUiServer.ts`, `src/main/index.ts` (`pushRenderToRenderer`/`renderPushedForRun`/`producedSurface`), the `agent:*` IPC contract, the `'generated-ui'` persisted snapshot key |

---

## Sequencing note (uncommitted titlebar change)

A custom-titlebar change just landed (uncommitted) in `App.tsx` + `src/main/index.ts`. The
`SurfaceId`/rail edits in this plan ALSO touch `App.tsx` (`RAIL_ITEM`, the `TabsContent` list) and
`railVisibility.ts`. **Implementation MUST be sequenced AFTER that titlebar change is committed (or
at least stable) and AFTER this spec/plan is approved**, to avoid a messy overlapping diff on
`App.tsx`. Coordinate with the orchestrator on commit ordering before Phase 1.

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 0 — Confirm open questions (GATE — before any code)

- [ ] OQ-1 confirmed: inline interactive surfaces in each entry (recommended) vs. collapsed
  summaries. The timeline component design depends on this.
- [ ] OQ-2 confirmed: keep wire `UiRenderTarget` `'generated-ui'` (recommended) vs. rename to
  `'cosmos'`. **If the user chooses rename, this plan grows materially** (MCP default, UiBridge
  blocking rule, agent grant/grounding, `DEFAULT_UI_RENDER_TARGET`, snapshot-key migration) — a
  v2 of this plan would be warranted.
- [ ] OQ-3 confirmed: v1 = utterance + outcome + surface, no assistant-text/tool-call transcript
  (recommended). If the user wants a true chat transcript, scope a follow-up (new `claude -p`
  stream-json capture path + new typed IPC channel) — out of v1.
- [ ] OQ-4 confirmed: single timeline, no per-surface tab strip (recommended).
- [ ] OQ-5 confirmed: persisted snapshot key stays `'generated-ui'` (no schema migration) while the
  rail id is `'cosmos'` (recommended).

### Phase 1 — Design step (designer, `design` skill) — REQUIRED, UI-bearing

- [ ] Designer produces `.sdd/designs/cosmos-conversation-panel-v1.md`: the Cosmos panel chrome,
  the conversation-**timeline** layout (entry anatomy: utterance header, status/affordance, inline
  surface region, error block), and the loading / empty / populated / error states, reusing the
  existing Tailwind + shadcn/ui design system and the brand tokens (`SurfaceSpinner`/`CosmosSpinner`,
  `--brand-*`). Establishes how an in-flight entry, a completed-no-surface entry, and an error entry
  read distinctly. (Designer owns theme tokens + `components/ui/`; build wiring by the developer.)
- [ ] Design review: timeline reads as one continuous history; entry states are visually
  unambiguous; long-history performance affordance (collapse/virtualize older entries) is specified
  if OQ-1 = inline.

### Phase 2 — Interface (types + pure logic, no UI)

- [ ] Read the approved spec + design; confirm no open questions remain (Phase 0 done).
- [ ] `railVisibility.ts`: replace `'generated-ui'` with `'cosmos'` in `SurfaceId`, `ALWAYS_PRESENT`,
  `ALL_SURFACE_IDS`. `resolveFallbackSurface`/`visibleSurfaceIds` logic is unchanged (still
  always-present, still falls back to `terminal`).
- [ ] Define the pure timeline model in `src/renderer/cosmosTimeline.ts`: a `CosmosTimelineEntry`
  (id, utterance, state: `in-flight | completed | error | no-surface`, surface payload?, error?,
  descriptor/bindings? for refreshable) and pure transitions (`appendOnSubmit`,
  `applyRenderFrame`, `applyStatus`) that accumulate the existing stream into an ordered list —
  modeled on `useGenerativePanelTabs`'s correlation logic but APPEND-only (no replace, no tab
  bookkeeping). Node-testable (the `.ts`/`.test.ts` split; no React/DOM import).
- [ ] Confirm: NO new IPC type is added (FR-011) — the renderer assembles the timeline from
  `agent:submit` (utterance, captured at send), `agent:status`, `ui:render`, `ui:dataModel`, all of
  which it already receives. (If Phase 0 surfaces a genuine gap, STOP and revise the spec — do not
  invent a channel silently.)

### Phase 3 — Testing (pure logic first)

- [ ] `cosmosTimeline.test.ts` happy path: submit → in-flight entry appended; matching render frame
  → entry resolves with surface; `completed` with `producedSurface=false` → `no-surface`.
- [ ] Append ordering: N submits → N ordered entries; a later submit never mutates an earlier entry.
- [ ] Error: `agent:status` `error` resolves the originating entry to an error state; siblings
  unaffected.
- [ ] Refreshable: a render frame carrying descriptor/bindings + a later `ui:dataModel` updates that
  entry's surface data in place.
- [ ] `railVisibility.test.ts`: `'cosmos'` is present + always visible; disabling an integration
  while Cosmos is active keeps it active; fallback still resolves to `terminal`.

### Phase 4 — Implementation (renderer)

- [ ] Create `src/renderer/CosmosPanel.tsx`: hosts the timeline. Subscribes to the same streams the
  Generated UI panel did (`window.cosmos.ui.onRender` filtered by `target === 'generated-ui'`,
  `window.cosmos.agent.onStatus`, `window.cosmos.ui.onDataModel`), feeds them through
  `cosmosTimeline.ts`, and renders one entry per run. Each entry that produced a surface mounts the
  EXISTING standard-catalog host (`<A2UIProvider catalogId="standard">` + `ActiveTabSurface`-style
  host) inline so controls/refresh work (FR-008). Publishes the composer via
  `usePublishComposer('cosmos', …)` so Open-Prompt submits route here (FR-003), reusing the existing
  submit→run wiring (the submit still threads the `'generated-ui'` wire target per OQ-2).
- [ ] Implement the empty / loading / populated / error states per the design; reuse
  `SurfaceSpinner` for the in-flight affordance and the existing error-boundary degradation
  (unknown component → entry error boundary, never white-screen, never affects siblings — FR per
  SC-005).
- [ ] If OQ-1 = inline + long-history perf is a concern: mount only on-screen / most-recent entries'
  providers and collapse older entries to a header (per the design).
- [ ] Session persistence (FR-012): reuse the `'generated-ui'` persisted snapshot slice
  (`useRestoredGenerativePanel('generated-ui')` equivalent) to re-instate prior composed surfaces as
  history entries on restart, with the same limits as today (fresh requestId; live data re-fetched).
  Keep the snapshot key `'generated-ui'` (OQ-5) — no schema migration.
- [ ] `App.tsx`: remove the `GeneratedUiPanel` import + its `TabsContent value="generated-ui"`; add
  `import { CosmosPanel }` + a `TabsContent value="cosmos"` rendering `<CosmosPanel active={surface
  === 'cosmos'} />`. Update `RAIL_ITEM`: drop the `'generated-ui'` entry, add `cosmos: { label:
  'Cosmos', Icon: … }` (designer specifies the icon — likely `CosmosMark`/sparkle). The
  `visibleIds.map` + `SharedComposer` wiring is otherwise unchanged.
- [ ] Delete `src/renderer/GeneratedUiPanel.tsx`.
- [ ] Confirm the keyboard-shortcut surface-cycle (`surface:next`/`surface:prev`) and tab shortcuts
  still behave: Cosmos is a single-timeline panel (OQ-4), so per-tab `tab:*` shortcuts either no-op
  on Cosmos or are scoped out (specify in design/impl — do not leave a dangling tab shortcut that
  acts on a non-existent tab strip).

### Phase 5 — Verify

- [ ] `npm run typecheck` (node + web) and `npm test` green.
- [ ] Manual (`npm run dev`): rail shows "Cosmos" (no "Generated UI"); submit several commands →
  ordered timeline; a button/form in a history entry round-trips to the agent; in-flight → spinner →
  resolve; error entry; empty state; restart re-instates prior composed surfaces.
- [ ] Grep the tree for any lingering `'generated-ui'` **rail** references (RAIL_ITEM, SurfaceId
  usage in renderer) — distinguish from the intentionally-kept **wire target** `'generated-ui'`
  (UiRenderTarget, snapshot key, UiBridge rule). Document the distinction so a future reader does not
  "finish the rename" and break routing.

### Phase 6 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: rename the Generated-UI panel references to the **Cosmos
  conversation panel** in §3 (rail list), §4.4 (the general-purpose A2UI panel is now the Cosmos
  timeline), §4.11 (Cosmos is a single-timeline panel, not a tab strip — note the exception), and a
  new sub-point under §4.x / §5a stating: the wire render target stays `'generated-ui'` while the
  rail surface is `'cosmos'`, and the Cosmos panel accumulates the default-agent run stream into an
  append-only interactive timeline (no transcript read — runs are ephemeral `claude -p`). Add a §7
  "Next Steps" entry referencing this spec/plan.
- [ ] Update `docs/PROJECT-STRUCTURE.md`: `GeneratedUiPanel.tsx` → `CosmosPanel.tsx` +
  `cosmosTimeline.ts`.
- [ ] `wrap-up` reconciles `TODO.md`.

---

## Deviations & Notes

- **2026-06-27**: Plan authored. Key decisions recorded as recommendations pending user confirm:
  keep the wire `UiRenderTarget` `'generated-ui'` while renaming the rail `SurfaceId` to `'cosmos'`
  (OQ-2); inline interactive surfaces per entry (OQ-1); no transcript/assistant-text in v1 (OQ-3);
  single timeline, no tab strip (OQ-4); no snapshot-key migration (OQ-5). If OQ-2 flips to a full
  target rename, this plan must be re-scoped (it grows to touch MCP/bridge/main/grant + a snapshot
  migration).
