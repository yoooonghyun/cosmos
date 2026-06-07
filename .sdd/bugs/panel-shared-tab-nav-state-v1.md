# Bug Report: panel-shared-tab-nav-state (v1)

- **Status:** Fixed <!-- Open | Investigating | Routed | Fixed | Escalated-to-sdd -->
- **Reported:** 2026-06-07
- **Severity:** degraded
- **Regression:** no — present since the panels were made tabbed (panel-tabs v1, Phase 6)

## Symptom

In the **Slack** and **Confluence** panels, all tabs appear to share one navigation
state. Navigating the native browser in one tab (drilling into a channel / opening a page /
running a search) is reflected in every other tab's native base instead of each tab keeping
its own independent view.

## Expected vs Actual

- **Expected:** Each tab's native base browser has its **own independent** navigation state.
  Opening #general in tab 1 leaves tab 2 on its own view (e.g. the channel list).
- **Actual:** All tabs render the **same** native-base navigation. Drilling in one tab
  changes what every other tab shows when it falls back to the native base.

## Reproduction

Slack (connected):
1. Open the Slack panel. Tab 1 shows the channel list.
2. Click a channel → it drills into that channel's history.
3. Click `+` to open a new tab (a fresh "Untitled" tab → shows the native base).
4. **Bug:** the new tab shows the *same channel's history* (shared `view`), not a fresh
   channel list.

Confluence (connected): same shape — open a page / type a search query in one tab, open a
new tab, the new tab shows that same page / query instead of its own default feed.

## Scope & Severity

Two renderer files (`SlackPanel.tsx`, `ConfluencePanel.tsx`). Degraded UX, no crash, no data
loss. The per-tab *generative A2UI surface* is already correctly isolated (stored on
`GenerativeTab.surface`); only the **native-base browser nav state** is shared.

## Scope gate (Step 1.5)

- **Decision:** continue the bug cycle
- **Reason:** Renderer-only state-location fix in 2 files. No new IPC/contract, no new MCP, no
  net-new behavior — the state simply lives at panel scope where it must live per-tab. Not
  feature-sized.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** `developer`
- **Reason:** Wrong state wiring — `view`/`searchText` (Slack) and `view`/`searchText`/`query`
  (Confluence) are panel-level `useState`, shared across all tabs; the logic must hold this
  state per-tab. The native browser already renders all five design states correctly, so this
  is not a design defect.

## Root Cause (Step 3)

Confirmed: the defect is renderer state wiring in the two panels (no other layer involved — no
IPC/contract/MCP). The native-base browser nav was held in panel-level `useState`, a SINGLE value
shared across all tabs, while the native base is mounted only for the active tab. So every tab's
base reads the same `view`/`searchText`/`query`.

Exact origins (pre-fix line numbers):
- `src/renderer/SlackPanel.tsx:747` — `const [view, setView] = useState<View>({ kind: 'channels' })`
  (panel-scoped).
- `src/renderer/SlackPanel.tsx:748` — `const [searchText, setSearchText] = useState('')`
  (panel-scoped).
- `src/renderer/ConfluencePanel.tsx:422` — `const [view, setView] = useState<ConfluenceView>(...)`.
- `src/renderer/ConfluencePanel.tsx:423` — `const [searchText, setSearchText] = useState('')`.
- `src/renderer/ConfluencePanel.tsx:425` — `const [query, setQuery] = useState('')`.

These are the only consumers of the shared nav: the generative A2UI *surface* is already isolated
per-tab on `GenerativeTab.surface` (`useGenerativePanelTabs.ts`) and is NOT touched.

Two callsites needed care under per-tab semantics:
- Slack `handleSurfaceAction` (`SlackPanel.tsx:774-795`) set the shared `view` then CLOSED the active
  tab, relying on the shared value to reveal the channel in the adjacent tab — incoherent per-tab.
- The connection transitions (`connect`/`disconnect`/`refreshStatus`) reset the shared `view` (and,
  for Confluence disconnect, `query`/`searchText`) — these must reset ALL tabs' nav, not one.

## Fix (Step 4)

Renderer-only. The native-base nav is now held PER-TAB, keyed by tab id, via a new node-testable
pure helper + a thin React hook (the `panelTabs.ts`/`usePanelTabs.ts` split convention), reused by
both panels (no duplication). No IPC/contract/MCP change.

New files:
- `src/renderer/perTabNav.ts` — pure, framework-free `Map`-as-`Record<tabId, N>` logic, generic over
  the per-panel nav shape `N`: `getNav` (with per-panel default for an unset tab), `setNav`, `dropNav`
  (tab-close cleanup), `clearAllNav` (connection reset). Invalid/empty `tabId` warns + safe fallback;
  all ops are pure (no input mutation).
- `src/renderer/usePerTabNav.ts` — React hook wrapping the helper: takes `activeTabId` + a per-panel
  `fallback`, exposes `nav` (the active tab's state, falling back to default), `setNav` (value OR
  updater, scoped to the active tab), `drop`, `clearAll`.

Wiring:
- `SlackPanel.tsx` — removed the panel-level `view`/`searchText` `useState`; introduced
  `SlackNav = { view, searchText }` + `SLACK_NAV_DEFAULT` and consumed `usePerTabNav<SlackNav>(activeTabId, …)`.
  `setView`/`setSearchText` are now updater-form wrappers over `setNav` so partial updates compose.
  `handleCloseTab` drops the closed tab's nav entry (wired into both the strip `onClose` and
  `useTabShortcuts`).
- `ConfluencePanel.tsx` — same shape with `ConfluenceNav = { view, searchText, query }` +
  `CONFLUENCE_NAV_DEFAULT`; `submitSearch` sets `query` + `view` in one per-tab `setNav` update.

### Judgment call 1 — connection transitions reset ALL tabs

`connect`/`disconnect`/`refreshStatus` now call `clearAllNav()` (reset every tab's nav to default)
instead of setting one shared `view`. Rationale: while disconnected the connect call-to-action
replaces the base entirely for every tab, so leaving stale per-tab drill-ins/queries behind a
reconnect would be incoherent; a clean reset to each panel's default is the natural per-tab analog of
the old single `setView(default)`. Applied consistently in both panels (Confluence also clears the
submitted `query` + `searchText`, which the old disconnect did explicitly).

### Judgment call 2 — Slack `handleSurfaceAction` opens the channel in the CURRENT tab

A generated channel-row click now opens the channel **in the current tab**: it sets that tab's
`view` to the channel history and clears that tab's generative surface (`update(activeTabId,
{ surface: null, error: undefined })`) so the native base shows. Previously it set the shared `view`
then CLOSED the active tab, relying on shared state to surface the channel in the adjacent tab — under
per-tab state that would have written the CLOSING tab's view and shown nothing. Opening in place is the
minimal, coherent per-tab behavior and keeps the panel read-only (the action is still handled
renderer-locally and never sent to main, FR-020).

## Regression Test (Step 5)

`src/renderer/perTabNav.test.ts` (vitest, node env — tests the pure `perTabNav.ts`, never imports a
`.tsx`). Key assertions:
- **Per-tab independence (the bug):** after `setNav(map, 'tab-A', drilledIn)`, `getNav(map, 'tab-A')`
  reflects the drill-in but `getNav(map, 'tab-B')` reads the supplied default — i.e. setting tab A's
  nav does NOT affect tab B; two tabs can hold different nav simultaneously; re-setting a tab replaces
  only that tab.
- An unset tab reads the supplied default; `dropNav`/`clearAllNav` cleanup; purity (no input mutation);
  invalid/empty `tabId` warns + safe fallback.

**Why it fails without the fix:** the pre-fix model held one shared value, so there was NO per-tab
keying at all — tab B's base was structurally the SAME state as tab A's. The independence assertion
(`getNav(map, 'tab-B', DEFAULT)` stays default after writing tab A) cannot hold in a single-value
model: any write visible to tab A is visible to tab B. The helper that makes it pass (a `tabId`-keyed
map) is the fix; the test exercises exactly that keying.

All 11 cases pass with the fix.

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web)
- [x] `npm test` green (646 passed, incl. 11 new `perTabNav.test.ts` cases)
- [x] Per-tab independence proven by the regression test (would fail pre-fix)
- [x] Wiring reviewed: both panels consume `usePerTabNav`; `handleCloseTab` drops the entry
      and is wired into the strip `onClose` + `useTabShortcuts`; connection transitions call
      `clearAllNav()`. `perTabNav`/`usePerTabNav` have no consumers beyond the two panels.
- [~] **UI not manually exercised in the connected flow.** The repro requires a live
      Slack/Confluence OAuth connection, which cannot be authenticated in this environment.
      Renderer-only change is HMR-live in the running `npm run dev`; logic is locked by the
      regression test and typecheck. Flagged honestly rather than claimed.

## Wrap-up (Step 7)

- **bug memory saved:** yes — `bug` memory (symptom + root cause + per-tab fix)
- **Docs updated:** CLAUDE.md (per-tab native-base nav gotcha)
- **wrap-up run:** <pending>
