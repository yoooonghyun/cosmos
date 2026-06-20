# Spec: Jira Tab-Switch Auto-Refresh + Loading Skeleton — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: none (extends the `restored`-flag restore-refresh mechanism from `refreshable-custom-generative-ui-v1` + the `jira-refreshable-detail-nav-crash-and-empty-v1` bug fix, generalized from snapshot/back-nav restore to plain tab re-activation)
**Related plan**: `.sdd/plans/jira-tab-switch-auto-refresh-v1.md` (to be authored)

---

## Grounding

> Tools I ran directly to ground this spec (mandatory per architect protocol).

**codegraph_explore**
- `"ActiveTabSurface restored descriptor bindings restore refresh re-register regions"` — confirmed `ActiveTabSurface`'s restore-refresh effect (`ActiveTabSurface.tsx:121-141`) fires `adapter.refresh` with the surface's `bindings`/`descriptor` ONLY when `surface.restored === true`, keyed on `surface?.requestId`. The in-place `onDataModel` apply effect (`:148-160`) repaints from `updateDataModel` pushes matched by `surfaceId`. `AdapterDispatcher.refresh` (`adapterDispatcher.ts:224`) re-fetches from page one and pushes a fresh data model without re-composing the view.
- `"useGenerativePanelTabs TabSurface GenerativeTab loadingDefault restored A2UIProvider mount active tab"` — confirmed `TabSurface.restored` is documented as set ONLY for snapshot-restored surfaces; `GenerativeTab.loadingDefault` is the EXISTING per-tab skeleton flag (Jira-only) cleared when a surface/error lands. A freshly composed surface is deliberately NOT flagged `restored` (no redundant first-page re-fetch).

**Read (verbatim, to match house style + mounting)**
- `JiraPanel.tsx` — confirmed only the active tab's `<A2UIProvider key={activeTab.id}>` is mounted, so a switch remounts the host (`:450-459`); the EXISTING `DefaultViewSkeleton` (`:64-80`) is shown when `activeTab.loadingDefault || navLoading`, hiding the stale surface; manual refresh runs via `PanelRefreshButton` + `panelRefreshInputsFor`.
- `.sdd/bugs/jira-refreshable-detail-nav-crash-and-empty-v1.md` — Defect B root cause: a BOUND multi-region kanban's rows live ONLY in live A2UI SDK state (`payload.dataModel` is `undefined` for bindings; seeded via separate `pushDataModel`). On remount the SDK is `clear()`ed and only the spec is reprocessed → empty columns unless a `restored`-driven refresh re-kicks the regions. Back-nav fix reused `restored: true` for exactly this.
- `.sdd/specs/refreshable-custom-generative-ui-v1.md` — the descriptor/bindings + AdapterDispatcher + in-place `updateDataModel` repaint contract this feature reuses.

**memory_recall / memory_smart_search** — `"Jira generative UI tab switch blank refresh restore restored bindings descriptor"` and `"restored bindings restore refresh empty board on Back snapshot tab switch repaint"` both returned no stored observations. (No prior decision on tab-switch auto-refresh exists; this is net-new behavior built on existing machinery.)

---

## Overview

When a cosmos user switches between Jira rail tabs, a bound generative surface (one backed by a
secret-free `descriptor` or `bindings` — e.g. a kanban or an issue list against live Jira data) comes
back BLANK and only repaints after a manual refresh. This feature makes such a surface auto-refresh on
tab re-activation so it repaints by itself, and shows a loading skeleton over the surface region until
the refreshed data lands — instead of a blank gap. It is a fix-shaped feature: it makes an existing
manual action (the refresh control) automatic for the tab-switch case, and adds a loading state. It is
NOT a redesign of the refresh, descriptor, or A2UI data-model machinery.

## Background — why it goes blank today

Only the ACTIVE Jira tab's `<A2UIProvider>` is mounted (keyed by tab id), so switching tabs remounts
the A2UI host and discards the live SDK data-model state of the surface being left. On remount,
`ActiveTabSurface` reprocesses the stored `spec` and re-applies the stored `dataModel` seed — but a
BOUND surface (especially a multi-region kanban) carries no `dataModel` on the tab (`payload.dataModel`
is `undefined`; its rows were seeded via separate `pushDataModel` pushes and live only in the
now-discarded SDK state). So the spec repaints with empty `{path}` bindings → blank columns / "No issue
found". The existing fix path is the `restored: true` flag: it triggers `ActiveTabSurface`'s
restore-refresh effect, which re-registers the surface's regions in main and re-fetches, repopulating
the surface. Today `restored` is set ONLY for snapshot-restored surfaces and for the detail→Back
restore — NOT for an ordinary tab-switch remount. That gap is the root cause; the user must click
refresh manually to get the same effect.

## Chosen direction (committed)

Generalize the EXISTING `restored`-driven restore-refresh from snapshot/back-nav restore to plain tab
re-activation: when a Jira tab carrying a bound surface (`descriptor` or `bindings`) becomes active and
its surface is remounted, fire the same one-shot `adapter.refresh` the restore path already fires, so
main lazily re-registers (idempotent) and re-fetches, pushing a fresh `updateDataModel` that repaints
the surface in place — no view re-compose, no agent round-trip, no new IPC channel. While that
auto-refresh is outstanding, show a loading skeleton over the surface region (the same per-panel
skeleton convention Jira already uses for its default-view read), then reveal the repainted surface
when the data lands. A NON-bound (static) generative surface has nothing to re-fetch, so it just
repaints from its stored spec verbatim — no skeleton, no auto-refresh.

This reuses `refreshable-custom-generative-ui-v1`'s descriptor/bindings + AdapterDispatcher +
in-place `updateDataModel` repaint, and the `restored`-flag plumbing from
`jira-refreshable-detail-nav-crash-and-empty-v1` — it adds a trigger (tab re-activation) and a loading
state, not a parallel mechanism.

---

## User Scenarios

> Each scenario is independently testable. Priorities: P1 (must), P2 (should), P3 (nice to have).

### Bound Jira surface repaints itself on tab switch · P1

**As a** cosmos user with a bound Jira surface (e.g. a kanban / issue list) in one tab
**I want to** switch to another tab and back and see my surface repaint with its data automatically
**So that** I never see a blank board or have to click refresh just because I changed tabs

**Acceptance criteria:**

- Given a Jira tab whose active surface is bound (carries `descriptor` or `bindings`), when I switch
  to a different tab and then switch back to it, then the surface auto-refreshes (without my clicking
  the refresh control) and repaints with its data.
- Given that auto-refresh fires on re-activation, when the surface had data before I left, then after
  re-activation it shows its data again (repopulated by the refresh) rather than staying blank.
- Given I never touch the manual refresh control, when I move between Jira tabs repeatedly, then each
  bound tab I land on repaints on its own.

### Skeleton while the data is loading · P1

**As a** cosmos user re-activating a bound Jira tab
**I want to** see a loading skeleton over the surface region until the data lands
**So that** the transition reads as "loading" instead of a blank/empty gap

**Acceptance criteria:**

- Given I re-activate a bound Jira tab and its auto-refresh is in flight, when the surface has not yet
  received its refreshed data, then a loading skeleton is shown over the surface region.
- Given the auto-refresh's fresh data lands, when the surface repaints, then the skeleton is replaced
  by the populated surface.
- Given a warm re-fetch resolves almost instantly, when the surface would otherwise flash, then the
  skeleton is shown for at least a brief, perceptible floor so the transition still reads as loading
  (consistent with Jira's existing in-place navigation skeleton floor).

### Static (non-bound) generative surface still repaints normally · P1

**As a** cosmos user with a static composed generative surface (no live-data binding) in a Jira tab
**I want to** switch away and back and see it re-render from its stored spec
**So that** a surface with nothing to re-fetch is never needlessly blanked, skeletoned, or refreshed

**Acceptance criteria:**

- Given a Jira tab whose active surface is NOT bound (no `descriptor`, no `bindings`), when I switch
  away and back, then the surface re-renders from its stored spec and seed verbatim, with NO skeleton
  and NO auto-refresh.
- Given a tab with no surface at all (empty / not-yet-composed), when I activate it, then no
  auto-refresh fires and its existing empty/Connect/compose presentation is unchanged.

### First-paint (compose) flow is unchanged · P2

**As a** cosmos user composing or first-loading a Jira surface
**I want** the existing first-paint behavior (compose send-spinner, default-view skeleton) to be
unchanged
**So that** this feature adds auto-refresh only to the tab-switch repaint window, not to first paint

**Acceptance criteria:**

- Given I compose a new surface or trigger the default-view load, when it first paints, then the
  existing send-spinner / `DefaultViewSkeleton` behavior is unchanged and no DUPLICATE auto-refresh
  fires on top of the fresh compose (a freshly composed surface is already registered + seeded live).
- Given the first compose just landed in the active tab, when I have not switched away, then no
  tab-switch auto-refresh is triggered.

---

## Functional Requirements

> Every FR traces to the verbatim user request: (1) auto-refresh the bound Jira generative surface on
> tab switch / re-activation so it repaints itself; (2) show a skeleton until the data lands. No FR
> introduces behavior the user did not ask for.

| ID     | Requirement                                                                                                                                                                                                                                              |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | When a Jira tab carrying a BOUND active surface (one with a `descriptor` or `bindings`) becomes the active tab via a tab switch / re-activation that remounts its A2UI host, the system MUST trigger one auto-refresh of that surface, with no manual user action. (Request 1) |
| FR-002 | The auto-refresh MUST reuse the EXISTING restore-refresh mechanism (`ActiveTabSurface`'s `restored`-driven `adapter.refresh` carrying the surface's `bindings`/`descriptor` for idempotent re-registration + re-fetch in main), NOT a new parallel refresh path. (Request 1) |
| FR-003 | The auto-refresh MUST re-fetch via the existing AdapterDispatcher and repaint the surface IN PLACE through the existing `updateDataModel` path — no view re-compose, no agent round-trip. (Request 1)                                                       |
| FR-004 | The auto-refresh MUST fire at most ONCE per tab re-activation (one-shot per remount), not repeatedly while the tab stays active and not on every data-model push. (Request 1)                                                                              |
| FR-005 | A NON-bound (static) active surface — no `descriptor` and no `bindings` — MUST NOT trigger an auto-refresh; it MUST re-render from its stored spec + seed verbatim on re-activation. (Request 1, scoping)                                                   |
| FR-006 | A tab with no active surface (empty / not-yet-composed / error) MUST NOT trigger an auto-refresh; its existing presentation is unchanged. (Request 1, scoping)                                                                                             |
| FR-007 | While a tab-switch auto-refresh is outstanding (fired but its refreshed data has not yet landed), the system MUST show a loading skeleton over the surface region of the re-activated tab. (Request 2)                                                       |
| FR-008 | When the auto-refresh's fresh data lands (the `updateDataModel` repaints the surface), the system MUST replace the skeleton with the populated surface. (Request 2)                                                                                         |
| FR-009 | The loading skeleton MUST reuse Jira's existing per-panel skeleton convention (the same treatment family as the default-view skeleton) rather than a blank region or a spinner-only placeholder; its exact visual treatment is delegated to the designer. (Request 2) |
| FR-010 | The skeleton MUST be shown for at least a brief, perceptible minimum floor so a warm/instant re-fetch does not blank-flash; this MUST reuse Jira's existing in-place-navigation skeleton-floor behavior rather than introduce a new timing model. (Request 2) |
| FR-011 | The skeleton state MUST be scoped to the ACTIVE re-activated tab; switching to a DIFFERENT bound tab that is also auto-refreshing MUST show that tab's own skeleton, and a sibling tab's auto-refresh MUST NOT drive the active tab's skeleton. (Request 2, scoping) |
| FR-012 | The feature MUST NOT change first-paint behavior: a freshly composed surface or a default/search/detail read MUST NOT additionally trigger the tab-switch auto-refresh (those are already registered + seeded live), and the existing send-spinner / default-view skeleton path MUST be preserved. (Request scoping) |
| FR-013 | The auto-refresh trigger and skeleton state MUST carry NO token or secret in any IPC payload, bridge frame, or A2UI surface — it only carries the already-secret-free `descriptor`/`bindings` the manual refresh already sends. (Project CLAUDE.md constraint) |
| FR-014 | The change SHOULD be implemented renderer-only, reusing the existing `adapter.refresh` dispatch and `onDataModel` repaint; it MUST NOT add a new typed IPC channel or main-process change UNLESS the plan demonstrates the renderer-only approach cannot satisfy FR-001–FR-008, in which case the need MUST be stated explicitly. (Project constraint) |
| FR-015 | The shared trigger/skeleton mechanism (in `ActiveTabSurface` and/or the shared tab hook) SHOULD be target-agnostic in its shape, with Jira as the only caller wired for now — so Slack/Confluence/Generated UI can adopt it later without a second mechanism, but their behavior is unchanged by this feature. (Scoping, see Open Questions) |

## Edge Cases & Constraints

- **Bound multi-region (kanban) vs single-region:** a partitioned surface re-registers via its
  `bindings`; a single-region surface via its `descriptor`. Both must repaint on re-activation. (The
  bound multi-region case is the one that visibly breaks today — its rows live only in live SDK state.)
- **Re-activation that does NOT remount:** if a tab switch does not actually remount the A2UI host
  (e.g. React preserves it), the surface still has its live data and no auto-refresh is needed; the
  trigger must key on the remount/re-activation, not fire spuriously while a tab stays active.
- **Auto-refresh resolving after the user leaves again:** if the user switches away before the
  auto-refresh data lands, the late `updateDataModel` is for a now-unmounted/sibling surface and is
  ignored by the existing `surfaceId`-matched apply — it must not error or paint the wrong tab.
- **Composed surface that just landed:** a fresh compose in the active tab must not be treated as a
  re-activation and re-refreshed (avoid a redundant first-page re-fetch on every compose).
- **Detail→Back and snapshot-restore paths:** these already set `restored: true` and already trigger
  the same refresh; this feature must not double-fire for them (the existing restore stays one-shot).
- **Failed refresh:** if the auto-refresh fails (network / Jira error), the skeleton must not hang
  forever — it must resolve to the surface's existing failure presentation; the feature inherits the
  existing refresh error handling and does not add a new error contract.
- **Out of scope:** Slack / Confluence / Generated UI auto-refresh behavior (the shared mechanism may
  be target-agnostic in shape per FR-015, but only Jira is wired and behavior-changed in v1);
  redesigning the refresh, descriptor, or A2UI data-model machinery; persisting any refreshed data;
  changing the manual `PanelRefreshButton`; the skeleton's visual styling (a design concern — see
  below).
- **Design follow-up:** this is a UI-bearing feature; the loading skeleton's exact visual treatment
  (shape, density, animation, whether it covers the whole surface or only the pending data region) is
  a design concern to be detailed by the designer in the design step after the plan. This spec only
  requires that a skeleton (house-style, not blank/spinner-only) is shown while loading.

## Success Criteria

| ID     | Criterion                                                                                                                                                              |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | Switching away from and back to a bound Jira tab (kanban or issue list) repaints the surface with its data WITHOUT any manual refresh click. (proves Request 1)        |
| SC-002 | The previously-blank-on-switch board is no longer blank after re-activation — its tickets/columns are present. (proves the user's stated defect is fixed)              |
| SC-003 | A loading skeleton is visible over the surface region during the auto-refresh and is replaced by the populated surface when data lands. (proves Request 2)            |
| SC-004 | A static (non-bound) generative surface re-renders verbatim on re-activation with NO skeleton and NO auto-refresh. (proves scoping FR-005)                            |
| SC-005 | First-paint flows (compose send-spinner, default-view skeleton) are unchanged and no duplicate auto-refresh fires on a fresh compose. (proves FR-012)                 |
| SC-006 | No new typed IPC channel is introduced unless explicitly justified in the plan; no token/secret appears in any payload or surface. (proves FR-013/FR-014)             |
| SC-007 | Node-testable trigger/skeleton-gating logic lives in a `.ts` file beside its `.tsx` and is covered by unit tests (per project test convention). (verifiability)       |

---

## Open Questions

- [ ] **Jira-only vs target-agnostic shape (FR-015) — decided, flagging for confirmation.** Decision
  taken: keep the shared `ActiveTabSurface` / tab-hook change target-AGNOSTIC in shape (the trigger
  keys on "bound surface remounted on re-activation," not on `target === 'jira'`), but wire/behavior-
  change ONLY Jira in v1 — matching the user's explicit "Jira의 경우" scope while avoiding a
  Jira-specific fork of shared code. If the user wants the auto-refresh to ALSO take effect for Slack
  and Confluence bound surfaces immediately, say so and the FRs expand to those panels.
- [ ] **Whole-surface vs partial skeleton (FR-009).** Decision deferred to the designer: this spec
  requires "a skeleton over the surface region" but does not mandate whole-surface vs
  data-region-only. If the user has a strong preference (e.g. keep surface chrome and skeleton only
  the data area), note it so the design step honors it; otherwise the designer picks the house-style
  treatment.
