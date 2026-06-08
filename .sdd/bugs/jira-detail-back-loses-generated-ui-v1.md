# Bug Report: jira-detail-back-loses-generated-ui (v1)

- **Status:** Fixed
- **Reported:** 2026-06-08
- **Severity:** broken
- **Regression:** no — gap exposed by composer-send-animation-v1 + the `composed` flag (the generated-UI-on-Jira flow is newly first-class)

## Symptom

In the Jira panel, after the user composes a **generated UI** (a `composed` A2UI surface) in a
tab, that surface should stay pinned. Clicking a ticket in the generated UI opens its detail, but
pressing **Back** ("← Back to list") returns to the **default board / search list**, NOT the
generated UI it was opened from. The generated UI is lost.

## Expected vs Actual

- **Expected:** Back from a ticket detail that was opened **on top of a composed generated-UI
  surface** restores that generated UI surface (it is pinned — the detail is a temporary overlay).
- **Actual:** Back re-runs the default-view (or last JQL search) read and shows the ticket list;
  the generated UI never comes back.

## Reproduction

1. Connect Jira; in a Jira tab, compose a generated UI via the prompt composer (e.g. "show my
   blocked tickets as cards") → a `composed` surface lands and is shown.
2. Click a ticket card in that generated UI → its detail opens in place ("← Back to list" row shows).
3. Press **Back**.
4. Observe: the panel shows the default board / search list, not the generated UI from step 1.

## Scope & Severity

One surface (Jira panel), the generated-UI → detail → back flow. Functionally broken (lost user
context), not a crash. Slack/Confluence have no in-panel detail/back nav, so they are unaffected.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in one renderer file (`JiraPanel.tsx` back-nav origin tracking);
  no new IPC/contract, no cross-layer work. Extends the existing `originListRef` mechanism.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** developer
- **Reason:** the back-navigation state wiring is wrong/incomplete — `originListRef` records only
  `default`/`search` list origins and the detail-open overwrites (and does not snapshot) the
  composed surface, so "back" cannot restore it. Logic bug, matches no design/spec change.

## Root Cause (Step 3) — CONFIRMED (developer)

- **Origin:** `src/renderer/JiraPanel.tsx:167-169` (`originListRef` declaration),
  `src/renderer/JiraPanel.tsx:245-260` (`handleSurfaceAction`, opens detail), and
  `src/renderer/JiraPanel.tsx:265-274` (`goBackToList`) — all line numbers pre-fix.
- **Confirmed:** the triage hypothesis is correct. Traced in the current source:
  1. `originListRef` was typed `{ kind: 'default' } | { kind: 'search'; jql: string }`
     (`JiraPanel.tsx:167`) — **no `composed` variant**, so a generated-UI origin could not be
     represented at all.
  2. On a ticket click in the generated UI, `handleSurfaceAction` (`JiraPanel.tsx:245`) fires
     `requestDefaultInActiveTab(() => requestIssueDetail(...))` WITHOUT first snapshotting the
     active tab's composed surface.
  3. That detail request pushes an **unsolicited** `target:'jira'` frame. In
     `useGenerativePanelTabs.onRender` (`useGenerativePanelTabs.ts:184-233`) an unsolicited frame has
     `wasSolicited === false`, so `update(tabId, { surface: <detail>, composed: false, ... })`
     **overwrites** the tab's pinned generated-UI surface (the `composed` flag flips to `false`) and
     the generated UI is lost from tab state.
  4. `goBackToList` (`JiraPanel.tsx:265`) only branched on `search` vs `default` and re-ran
     `requestSearchView()` / `requestDefaultView()`. With no `composed` origin and no snapshot, there
     was **no path** to restore the generated UI — it fell through to the default-view read.

## Fix (Step 4)

Renderer-only. No IPC/main/MCP change. Minimal, in line with the routed direction.

- **New pure helper** `src/renderer/jiraBackNav.ts` (`.ts`, node-testable, no `.tsx` import):
  - `JiraBackOrigin = { kind: 'default' } | { kind: 'search'; jql } | { kind: 'composed'; surface: TabSurface }`
    — adds the `composed` origin carrying the snapshotted generated-UI surface.
  - `backNavTarget(origin): JiraBackTarget` — a total, pure decision returning
    `{ kind: 'restore-surface'; surface }` | `{ kind: 'read-search'; jql }` | `{ kind: 'read-default' }`.
    A `composed` origin with a snapshot → `restore-surface`; default/search → the existing reads; a
    malformed composed origin (no snapshot) safe-falls-back to `read-default` (never throws).
- **`src/renderer/JiraPanel.tsx`:**
  - `originListRef` retyped to `JiraBackOrigin` (was `default | search`).
  - `handleSurfaceAction`: when the active tab is showing a pinned generated UI
    (`activeTab.surface && activeTab.composed`), snapshot it as `{ kind: 'composed', surface }`
    BEFORE firing the detail read — the only point the surface can be captured, since the unsolicited
    detail frame overwrites it. `activeTab` added to the callback deps.
  - `goBackToList`: dispatches on `backNavTarget(originListRef.current)`. `restore-surface` re-files
    the snapshot via `update(activeTabId, { surface, composed: true, loadingDefault: false })` —
    no read, no `beginNavLoad()`/skeleton flash — then resets the origin to `default`. Restoring
    `composed: true` re-applies the `onGeneratedUi` gate so the JQL search box stays hidden.
    `read-search`/`read-default` keep the prior `beginNavLoad()` + read behavior verbatim.

- **Files changed:**
  - `src/renderer/jiraBackNav.ts` (new)
  - `src/renderer/jiraBackNav.test.ts` (new — regression test)
  - `src/renderer/JiraPanel.tsx` (import + retype ref + snapshot in `handleSurfaceAction` + dispatch in `goBackToList`)
- **Summary:** Back from a detail opened on a pinned generated-UI surface now restores that surface
  from a snapshot taken at detail-open time; default/search origins are unchanged.

## Regression Test (Step 5)

- **Test:** `src/renderer/jiraBackNav.test.ts` (pure `backNavTarget` helper, node env — no jsdom,
  no `.tsx` import).
- **Asserts:**
  - composed origin → `{ kind: 'restore-surface', surface }`, restoring the EXACT snapshot
    reference (the regression guard).
  - default origin → `read-default`; search origin → `read-search` with the raw jql (unchanged).
  - a malformed composed origin missing its snapshot → `read-default` (safe fallback, no throw).
- **Fails-without-fix confirmed:** YES. Temporarily simulated the pre-fix state by making the
  `composed` branch return `read-default` (no restore path ever existed pre-fix, since the origin
  union had no `composed` variant). The two `composed → restore-surface` assertions FAILED
  (`expected 'read-default' to be 'restore-surface'`) while the default/search/fallback assertions
  PASSED — proving the test pins the bug AND that those paths are unchanged. Reverted the simulation;
  with the real fix all 5 pass.

## Verification (Step 6)

- [x] `npm run typecheck` green
- [x] `npm test` green (incl. new regression test) — 33 files, 698 tests passed
- [ ] Original Step 1 reproduction re-run — symptom gone (NOT verifiable here: live Electron UI is
  not browser-automatable; left for the user to exercise)
- [ ] UI surface exercised (if renderer fix) — golden path + the broken edge case (NOT verifiable
  here — same reason; logic covered by the pure-helper regression test)
- [x] No regressions in adjacent behavior — full suite green; default/search back-nav and the
  `onGeneratedUi` JQL-search-box gate (re-applied by restoring `composed: true`) preserved; tab-switch
  origin reset and JQL-search-while-in-detail behaviors left untouched

## Wrap-up (Step 7)

- **bug memory saved:** mem_mq59b54n_936bde66008f
- **Docs updated:** docs/ARCHITECTURE.md (target-routed render overwrites a pinned composed surface — snapshot at overlay-open time)
- **wrap-up run:** yes
