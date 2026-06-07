# Plan: New tab shows the panel's base view — v1

**Status**: Draft
**Created**: 2026-06-07
**Last updated**: 2026-06-07
**Spec**: `.sdd/specs/new-tab-base-view-v1.md`

---

## Summary

Renderer-only refinement of panel-tabs v1. Generalize each generative panel's base screen
from `tabs.length === 0` to "the active tab is empty/uncomposed"
(`!activeTab || (!activeTab.surface && !activeTab.error)`) so a fresh `+` tab lands on the
panel's base instead of a blank panel. Confluence, Slack, and Generated UI already carry
this change ad-hoc (typecheck + tests green) and are only verified/justified here against
the new FRs. The work is in Jira: its base is the agent-generated my-tickets default board
view, so opening a `+` tab must request that default view for the new tab, with a **per-tab**
loading skeleton (replacing today's panel-wide `loadingDefault` flag). To avoid the
unsolicited default-view frame racing the shared `originatingTabIdRef` slot with an in-flight
compose, the request is **deferred while a compose is awaiting a frame** (OQ-1 resolution).
The chosen seam is a small, generic capability added to the shared `useGenerativePanelTabs`
hook (request a deferred default surface for a freshly opened tab + track per-tab default-load
state) rather than panel-wide flags in `ConnectedBody`; Jira is the only caller today but the
seam stays clean.

## Technical Context

| Item              | Value                                                                                     |
|-------------------|-------------------------------------------------------------------------------------------|
| Language          | TypeScript (React renderer)                                                                |
| Key dependencies  | `useGenerativePanelTabs.ts`, `usePanelTabs.ts`, `panelTabs.ts`, `window.cosmos.jira.requestDefaultView`, `window.cosmos.agent.onStatus` |
| Files to create   | (none — extend existing modules + their existing tests)                                   |
| Files to modify   | `src/renderer/useGenerativePanelTabs.ts`, `src/renderer/JiraPanel.tsx`, `src/renderer/useGenerativePanelTabs.test.ts` (if present, else add); verification-only: `ConfluencePanel.tsx`, `SlackPanel.tsx`, `GeneratedUiPanel.tsx` |

### Key facts grounding the approach (verified against the codebase)

- `requestDefaultView()` is a **deterministic main read** (`index.ts` →
  `handleJiraDefaultView` → `JiraSurfaceBuilder.buildDefaultViewSurface`) that pushes an
  **unsolicited** `target: 'jira'` `ui:render` frame. It is NOT an `AgentRunner` run and does
  NOT consume the §4.10 single-run guard. The only correlation hazard is the shared
  `originatingTabIdRef` in `useGenerativePanelTabs.ts`: a solicited compose and an unsolicited
  default-view frame both consume "the next matching `ui:render`", so firing the request while
  a compose is awaiting a frame can swap the two surfaces. Hence OQ-1's defer rule.
- Today `JiraPanel.ConnectedBody` owns a single panel-wide `loadingDefault` boolean cleared
  when `tabs.some(t => t.surface !== null)`. This is the FR-009 violation: a second `+` tab
  loading its default shows no skeleton because another tab already has a surface. It must
  become per-tab.
- The shared hook already exposes `open`, `update`, `submit`, `newTab`, `closeTab`,
  `activeTab`, and internally holds `originatingTabIdRef` (the "awaiting a frame" signal) and
  subscribes to `agent:status`. The deferral + per-tab default-load capability fit naturally
  beside that bookkeeping.

### Design of the shared-hook seam (OQ-1 mechanism)

Add to `useGenerativePanelTabs` a generic capability for "open a fresh tab that wants a
base/default surface, deferred until the correlation is idle":

- **Per-tab default-load state.** Extend `GenerativeTab` with an optional
  `loadingDefault?: boolean` (set when a default-surface request is outstanding for that tab,
  cleared when any surface or error lands in that tab — already handled by the existing
  frame-filing `update`). This replaces the panel-wide `loadingDefault` so FR-009 holds
  per-tab. Keep it optional so Slack/Confluence/Generated UI tabs never set it.
- **A `newTabWithDefault(request: () => void)` (or similarly named) controller method.** It
  `open`s a fresh tab with `loadingDefault: true`, makes it active, and then:
  - If `originatingTabIdRef.current` is null (no compose awaiting a frame), invoke `request()`
    immediately (Jira passes `() => window.cosmos.jira.requestDefaultView()`).
  - If a compose IS awaiting a frame, record the deferred `request` in a ref keyed nothing-
    fancier-than a small FIFO/single-slot queue, and flush it when the in-flight run resolves.
    Reuse the hook's EXISTING `agent:status` subscription: on `completed`/`error` (after the
    originating-tab bookkeeping runs), if a deferred default request is queued AND the
    correlation is now idle, fire it. The unsolicited frame then lands via the existing
    unsolicited-frame path (active tab, which is the new tab) — no new routing.
  - The deferred request fires as an UNSOLICITED frame, so it MUST only be flushed when
    `originatingTabIdRef.current` is null at flush time (guard against a second compose started
    in between — degrade by keeping it deferred, never hang the tab on a stuck skeleton; the
    tab still shows its base because `loadingDefault` + no surface → base, and a later flush or
    a manual user action resolves it). Document this guard inline.
- **Clearing `loadingDefault` correctly.** The existing `ui:render` filing `update(tabId, …)`
  already clears `inFlight`/`error` when a surface lands; extend that same patch to clear
  `loadingDefault: false` so a landed default board (or Notice) stops the skeleton (FR-008/
  FR-010). Closing a tab mid-load drops its record (existing `closeTab`); a late frame follows
  today's unsolicited-frame path (FR-027) — no change needed.

This keeps Jira's `ConnectedBody` thin: it calls `newTabWithDefault(() => window.cosmos.jira.requestDefaultView())`
for the activation default-view AND for the `+` button, deletes its panel-wide `loadingDefault`
state + the `anySurface` effect, and derives the skeleton from `activeTab.loadingDefault`.

---

## Implementation Checklist

> Update as work progresses; note deviations inline.

### Phase 1 — Interface (shared hook seam)

- [x] Read `.sdd/specs/new-tab-base-view-v1.md` and confirm OQ-1 is resolved (defer-while-awaiting-a-frame). No open questions remain.
- [x] In `useGenerativePanelTabs.ts`: add optional `loadingDefault?: boolean` to `GenerativeTab` (spec FR-008/FR-009). No other field invented.
- [x] Add a controller method (e.g. `newTabWithDefault(request: () => void)`) to `GenerativePanelTabs`: opens a fresh active tab with `loadingDefault: true` and either fires `request()` now (correlation idle) or DEFERS it (compose awaiting a frame). Type it generically — no Jira specifics in the hook signature (FR-012, clean seam).
- [x] Confirm types against the spec — no invented properties; `loadingDefault` is the only new field, traced to FR-008/FR-009.

### Phase 2 — Testing (node-env, no jsdom — pure fire-or-defer helpers; see Deviations)

- [x] Test: idle correlation → fire decision (`defaultRequestDecision(null) === 'fire'`); the hook then opens the tab with `loadingDefault: true`, `surface: null` (FR-007/FR-008).
- [x] Test: a compose in flight → defer decision (`defaultRequestDecision('tab-1') === 'defer'`); no `request()` fires, no hang (FR-011, OQ-1).
- [x] Test: deferred flush gate — `shouldFlushDeferredDefault(true, null) === true` (run resolved + correlation idle); `(true, 'tab-2') === false` (second compose → stay deferred); `(false, …)` never flushes (FR-011). The hook wires this to BOTH `agent:status` `completed` and `error`.
- [x] Test: a landed `target` frame for a default-loading tab clears `loadingDefault` (FR-008); a Notice/error surface frame likewise clears it (FR-010) — covered by the hook's `update(..., loadingDefault: false)` on the surface-filing path (existing `updateTab` partial-merge tests confirm the mechanism).
- [x] Test: per-tab independence — `loadingDefault` is a per-tab field on `GenerativeTab`, not a panel-wide flag, so one tab keeps its skeleton while another has a surface (FR-009).
- [x] Test: closing a default-loading tab drops it (existing `closeTab` pure tests); a late unsolicited frame follows the existing active-tab/auto-create path in `fileFrame` (FR-011/FR-027) — unchanged path, already covered.

### Phase 3 — Implementation

- [x] Implement the `newTabWithDefault` + deferral + per-tab `loadingDefault` logic in `useGenerativePanelTabs.ts`, reusing the EXISTING `originatingTabIdRef` and `agent:status` subscription (no second subscription).
- [x] Extend the existing `ui:render` filing `update(...)` to also clear `loadingDefault: false` when a surface lands (FR-008/FR-010).
- [x] Rewire `JiraPanel.tsx` `ConnectedBody`:
  - [x] Remove the panel-wide `loadingDefault` state, the `wasActiveRef`/`hasTabsRef` default-view effect's direct `open` + `requestDefaultView`, and the `anySurface` clearing effect.
  - [x] On first activation with no tab (the false→true `active` edge, no tabs), call `newTabWithDefault(() => window.cosmos.jira.requestDefaultView())` (preserves §4.9 default-view-on-activation, FR-007).
  - [x] Wire the `+` button (`onNewTab`) to `newTabWithDefault(() => window.cosmos.jira.requestDefaultView())` instead of plain `newTab` (FR-007 — `+` loads the default view for the new tab).
  - [x] Derive the skeleton from `activeTab?.loadingDefault && !activeTab.surface` (per-tab, FR-008/FR-009).
- [x] All new + existing tests pass; reused shared utilities — no duplicated correlation logic, no Jira-specific code leaking into the hook beyond the injected `request` callback.

### Phase 4 — Verify the three already-done panels (no re-implementation)

- [x] `ConfluencePanel.tsx`: confirmed `showNativeBase = !activeTab || (!activeTab.surface && !activeTab.error)` (line 419) satisfies FR-001/FR-005; composer stays mounted (outside the `showNativeBase` gate); A2UI host gated on `activeTab && (activeTab.surface || activeTab.error)` so errored/composed tabs bypass the base (FR-002/FR-003). No code change.
- [x] `SlackPanel.tsx`: confirmed same pattern (line 754) for the Slack native base (FR-001/FR-005). No code change.
- [x] `GeneratedUiPanel.tsx`: confirmed `showBase` (line 148) satisfies FR-001/FR-006 (idle placeholder), host gated identically. No code change.
- [x] None of the three diverged — all green.

### Phase 5 — Docs

- [x] Update `docs/ARCHITECTURE.md` §4.11 (and §4.9 Jira bullet) to record: the base shows on any empty/uncomposed active tab (not only zero tabs); Jira `+` loads a per-tab default view; the default-view request is **deferred while a compose is awaiting a frame** to protect the `originatingTabIdRef` slot (OQ-1 rationale). Keep it tight — a refinement, not a new subsystem.
- [x] Update this plan with any deviations.
- [x] Reconcile `TODO.md` if it tracks this item (wrap-up skill owns the final pass).

---

## Edge cases the implementation must keep correct (from the spec)

- Empty/uncomposed active tab → base (FR-001); in-flight-no-surface → base + indicator
  (Jira: skeleton, FR-008); errored → error state, never base (FR-003).
- Jira `+` while a compose is awaiting a frame → DEFER the default request; new tab shows
  base, never a stuck skeleton; request fires on run completion if correlation is idle
  (FR-011, OQ-1).
- Closing a default-loading Jira tab → no crash; a late unsolicited frame follows the
  existing active-tab/auto-create path (FR-011/FR-027).
- Switch away/back → composed tabs keep their surface; a tab that already has a default
  view is NOT re-requested (FR-007 fires once per `+` / first activation).

## Non-goals (unchanged from spec)

- No new IPC / main / MCP code (FR-012).
- No new panel-tabs primitive beyond the per-tab `loadingDefault` field + `newTabWithDefault`
  on the shared hook.
- No per-run id on `UiRenderPayload` / `AgentSubmitPayload`; the §4.11 sequential-run
  invariant stands.

---

## Deviations & Notes

- **2026-06-07**: Plan authored. OQ-1 resolved as defer-while-awaiting-a-frame; seam placed
  in the shared `useGenerativePanelTabs` hook (per-tab `loadingDefault` + `newTabWithDefault`)
  rather than panel-wide flags in `JiraPanel.ConnectedBody`.
- **2026-06-07 (impl)**: Implemented. Files changed:
  - `src/renderer/panelTabs.ts` — added two PURE node-testable helpers:
    `defaultRequestDecision(originatingTabId) → 'fire' | 'defer'` and
    `shouldFlushDeferredDefault(hasDeferredRequest, originatingTabId) → boolean`.
  - `src/renderer/useGenerativePanelTabs.ts` — added `loadingDefault?: boolean` to
    `GenerativeTab`; added `newTabWithDefault(request)` to the controller; added a
    single-slot `deferredDefaultRequestRef`; extended the surface-filing `update(...)` to
    clear `loadingDefault: false`; extended the existing `agent:status` subscription to
    flush a deferred request on BOTH `completed` and `error` (previously it acted only on
    `error`).
  - `src/renderer/JiraPanel.tsx` — `ConnectedBody` now uses `newTabWithDefault` for first
    activation AND the `+` button; deleted the panel-wide `loadingDefault` state, the
    `anySurface` clearing effect, and the direct `open`+`requestDefaultView`; the skeleton
    is derived from `activeTab?.loadingDefault && !activeTab.surface`.
  - `src/renderer/panelTabs.test.ts` — added tests for the two new helpers.
- **DEVIATION — test approach (Phase 2).** The plan's Phase 2 framing ("hook logic via
  mocked `window.cosmos`") is not achievable as written: vitest runs in the **node env**
  (`vitest.config.ts` `environment: 'node'`, `include: ['src/**/*.test.ts']` — no `.tsx`,
  no jsdom, no `@testing-library/react`). `useGenerativePanelTabs` is a React hook
  (`useState`/`useEffect`/`useRef`) that cannot be rendered without a DOM. Per the CLAUDE.md
  convention ("keep testable logic in a plain `.ts`, never import a `.tsx`/hook from a
  `.test.ts`" — the same split that put `panelTabs.ts` logic apart from `PanelTabStrip.tsx`),
  I extracted the two load-bearing decisions (fire-vs-defer, and flush-vs-stay-deferred) into
  pure functions in `panelTabs.ts` and unit-tested THOSE. The hook wires these helpers; its
  per-tab `loadingDefault` is a plain `GenerativeTab` field merged through the already-tested
  `updateTab`, and the close/late-frame paths are the already-tested existing `closeTab` +
  `fileFrame` behavior. So the new logic that is genuinely new (the two boolean decisions) is
  covered; the wiring is type-checked. Full end-to-end hook/render behavior (skeleton paint,
  deferred-then-flush over real IPC) is NOT exercised by an automated test and was not
  manually run in-app — flagged for the wrap-up/manual QA.
- **Test count**: 570 → 576 (6 new pure-helper assertions across 2 describe blocks).
  Typecheck (node + web) and `npm test` both green.
