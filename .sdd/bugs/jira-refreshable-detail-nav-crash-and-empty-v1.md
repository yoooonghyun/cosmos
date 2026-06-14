# Bug Report: jira-refreshable-detail-nav-crash-and-empty (v1)

- **Status:** Fixed (pending user runtime confirmation in `npm run dev`)
- **Reported:** 2026-06-14
- **Severity:** broken (one crash + one functional loss)
- **Regression:** yes — both surfaced after the refreshable-custom-generative-ui bindings/refresh
  landed (kanban columns now register per-region descriptors + kick refreshes). Refresh itself
  works; navigation on the now-refreshable surface is what breaks.

This report covers TWO co-occurring defects in the same flow (a refreshable Jira generated UI,
e.g. a kanban, with ticket detail open/back). Same owner (`developer`).

## Defect A — main-process crash: `UiBridge.settle` null deref

### Symptom (user, verbatim)
```
Uncaught Exception:
TypeError: Cannot read properties of null (reading 'socket')
  at UiBridge.settle (out/main/index.js:966:15)
  at UiBridge.onMessage (out/main/index.js:958:12)
  at Socket.<anonymous> (out/main/index.js:880:16)
  at Socket.emit (node:events:509:28)
  ...
```

### Expected vs Actual
- **Expected:** rendering / superseding a refreshable Jira surface never throws.
- **Actual:** `settle(call)` is invoked with `call === null`, so `call.socket` throws and crashes
  the Electron main process.

### Where (pre-fix)
- `src/main/uiBridge.ts` — `settle` (`uiBridge.ts:343`) reads `call.socket.destroyed` /
  `call.socket.write` with no null guard. It is called from `onMessage` at:
  - the **supersede** branch (`uiBridge.ts:231-233`, `settle(this.active, cancel)`), and
  - the **non-`generated-ui` immediate-settle** branch (`uiBridge.ts:337-339`,
    `settle(this.active, cancel)` — jira/slack/confluence are display-only).
  Both pass `this.active` directly, so when `this.active` is `null` at the call, `settle` null-derefs.
- **Suspected mechanism (developer to confirm):** `this.active` is set at `uiBridge.ts:239`, then
  the bindings branch (`uiBridge.ts:263-273`) calls the injected `registerAgentSurfaceBindings`,
  which **kicks each region's first refresh**. If that kick (via the AdapterDispatcher wired in
  `src/main/index.ts`) re-enters the bridge synchronously (e.g. `cancelActive`/`resolveAction`, or a
  nested render that supersedes), `this.active` is nulled before the line-338 settle runs →
  `settle(null)`. Trace with `codegraph_callers`/`codegraph_callees` on `registerAgentSurfaceBindings`,
  the dispatcher refresh kick, and every caller of `UiBridge.settle`/`cancelActive`/`resolveAction`.

## Defect B — ticket detail → Back shows "No issue found", tickets vanish

### Symptom (user, verbatim)
> 티켓 상세 들어갔다 나오면 No issue found.와 함께 티켓 안보임.

Open a ticket's detail from a refreshable kanban, press Back → the panel shows "No issue found"
and the kanban's tickets are gone (empty board).

### Expected vs Actual
- **Expected:** Back from a ticket detail opened on top of a refreshable generated UI restores that
  surface **with its data** (columns repopulated). User's stated acceptable options: on Back,
  **re-run the refresh**, OR if nothing changed just keep showing the prior cards.
- **Actual:** the surface shell may restore but its region data is empty → "No issue found" / blank
  columns.

### Relationship to prior fix
`jira-detail-back-loses-generated-ui-v1` (Status: Fixed) made Back **restore the composed surface
spec** from a snapshot taken at detail-open (`src/renderer/jiraBackNav.ts`,
`src/renderer/JiraPanel.tsx`, `src/renderer/useGenerativePanelTabs.ts`). That fix predates bindings:
it snapshots the **spec**, but a refreshable kanban's rows live in a separate **data-model store**
(seeded via `pushDataModel`, repainted by per-region refresh) and its regions are registered in the
main AdapterDispatcher. Suspect: opening the detail (an unsolicited `target:'jira'` frame) overwrites
the tab and/or the detail render unregisters/replaces the kanban's region data models, so restoring
the snapshot spec brings back empty columns. Developer to trace how region data models + region
registration survive (or don't) the detail overlay, and restore (or re-refresh) them on Back.

## Reproduction
1. Connect Jira. In a Jira tab, compose a refreshable kanban ("칸반으로 보여줘") — 3 columns render,
   each refreshes from its own status query (confirmed working in dev log bi8f9v4gs).
2. Click a ticket card → its detail opens ("← Back to list").
3. Press **Back**.
4. Observe: (B) the board shows "No issue found" / no tickets; and intermittently (A) the main
   process throws the `settle` null deref during the render/supersede churn.

## Scope & Severity
One surface family (Jira refreshable generated UI). A = main-process crash (severe). B = functional
loss of board context (broken). Slack/Confluence have no in-panel detail/back nav → unaffected.

## Scope gate (Step 1.5)
- **Decision:** continue bug cycle (do NOT escalate to sdd).
- **Reason:** A is a contained null-guard + ordering fix in one main file (`uiBridge.ts`, plus
  possibly the dispatcher-kick wiring in `index.ts`). B extends the existing renderer back-nav +
  data-model restore mechanism for the bindings case. No new IPC channel/type, no new MCP tool, no
  `UiRenderTarget` change, no net-new behavior — both are wrong-behavior fixes at known root causes.

## Classification & Routing (Step 2)
- **Class:** Implementation defect (both).
- **Routed to:** `developer`.
- **Reason:** A = main-process crash (null deref + re-entrancy/double-settle ordering). B = broken
  state wiring (region data-model / region-registration not restored on Back). Both are logic bugs,
  not design/spec changes.

## Root Cause (Step 3) — CONFIRMED (developer)

### Defect A — synchronous re-entrant `cancelActive` nulls `this.active` before the late settle
Traced the exact chain in source:
1. `UiBridge.onMessage` (`src/main/uiBridge.ts:239`) sets `this.active = { requestId, callId, socket }`.
2. The bindings branch (`uiBridge.ts:266`) calls `registerAgentSurfaceBindings`, wired in
   `src/main/index.ts:1128-1142`. For each region it runs
   `void adapterDispatcher.refresh(surfaceId, region.regionKey)` (`index.ts:1139`) — the first-refresh
   kick.
3. `AdapterDispatcher.refresh` (`src/main/adapterDispatcher.ts:224`) runs its SYNCHRONOUS prefix up to
   the first `await`: line `231` `this.cancelActive?.()`. That dep is wired to
   `() => uiBridge?.cancelActive()` (`index.ts:1210`).
4. `UiBridge.cancelActive` (`uiBridge.ts:181`) sees `this.active` non-null → `settle(this.active, cancel)`
   → `settle` NULLS `this.active` (`uiBridge.ts:345`, pre-fix). All of this happens synchronously,
   inside the `registerAgentSurfaceBindings` call, BEFORE `onMessage` returns from line 266.
5. The kanban target is `'jira'` (display-only), so `onMessage` reaches the immediate-settle branch
   (`uiBridge.ts:337-339`, pre-fix `this.settle(this.active, …)`). `this.active` is now **null** →
   `settle(null)` reads `call.socket` (`uiBridge.ts:347`) → `TypeError: Cannot read properties of null
   (reading 'socket')`, thrown inside the socket `'data'` handler → uncaught exception, main-process
   crash. Matches the reported stack exactly (`settle` ← `onMessage` ← socket emit).
   - The supersede settle (`uiBridge.ts:231-233`) also passes `this.active`, but it is guarded by
     `if (this.active)` so it never null-derefs; the unguarded line-338 settle is the crash site.

### Defect B — a refreshable surface's rows live ONLY in live SDK state, lost across the detail overlay
1. For a **bindings** (multi-region) kanban, `onMessage` pushes the render WITHOUT `dataModel`
   (`uiBridge.ts:311-317` omits it) and sends the seed via SEPARATE `pushDataModel` calls
   (`uiBridge.ts:321-325`). So `payload.dataModel` is `undefined`; the tab's `surface.dataModel`
   (set from `payload.dataModel` in `useGenerativePanelTabs.ts:311-317`) stays **undefined**. The row
   data exists ONLY in the live A2UI SDK message-handler state (seeded by the `onDataModel`
   subscription + repainted by per-region refresh — `ActiveTabSurface.tsx:148-160`).
2. Opening a ticket detail fires an unsolicited `target:'jira'` frame that overwrites the tab's
   `surface` with the detail spec (`useGenerativePanelTabs.ts:311-337`). `ActiveTabSurface`'s mount
   effect `clear()`s the SDK and processes the detail spec (`ActiveTabSurface.tsx:87-111`) — the
   kanban's live SDK rows are gone.
3. `jira-detail-back-loses-generated-ui-v1` snapshots the **spec** at detail-open
   (`JiraPanel.tsx:273-274`) and on Back restores it (`JiraPanel.tsx:294-311` → `update(tabId,
   { surface, composed:true, … })`). But the restored snapshot's `dataModel` is undefined (see #1),
   and the restore does NOT re-kick a refresh (`ActiveTabSurface`'s refresh effect only fires for
   `surface.restored === true`, `ActiveTabSurface.tsx:121-141`). So the spec repaints with empty
   `{path}` bindings → empty columns / "No issue found".

## Fix (Step 4) — CONFIRMED (developer)

### Defect A (`src/main/uiBridge.ts`) — fix the ORDERING, plus a defensive guard
- `onMessage`: capture the freshly-minted call into a local `const call: OutstandingCall` at the point
  `this.active` is set (`uiBridge.ts:247-248`), and settle the **captured local** at the display-only
  branch (`this.settle(call, …)`, was `this.settle(this.active, …)`). The local is immune to the
  re-entrant `cancelActive` nulling `this.active`, so the late settle can never pass null. `settle`
  still clears `this.active` only when it is still current, so double-settle stays a no-op.
- `settle` signature widened to `OutstandingCall | null` with an early `if (!call) return` — defensive
  belt-and-suspenders on top of the ordering fix (endorsed in the routing note), so any future late
  caller is a no-op rather than a crash.
- No contract / IPC / dispatcher-wiring change.

### Defect B (`src/renderer/jiraBackNav.ts`) — re-kick the regions' refresh on Back
- `backNavTarget`: when the `composed` snapshot is a BOUND surface (`surface.bindings` or
  `surface.descriptor` present), return `restore-surface` carrying `{ ...surface, restored: true }`.
  `JiraPanel.goBackToList` already re-files `target.surface` into the tab verbatim
  (`JiraPanel.tsx:300`), so the `restored: true` flag rides along and triggers `ActiveTabSurface`'s
  EXISTING restore-refresh effect (`ActiveTabSurface.tsx:121-141`): it re-registers every region in
  main (idempotent) via the bindings and re-fetches → the board repopulates (the user's "re-run the
  refresh on Back" option). An UNBOUND composed surface (carries its data in the spec/seed) is
  restored verbatim, NOT flagged `restored` (no needless refresh). Pure helper — no `.tsx`/DOM import.

## Regression Test (Step 5) — CONFIRMED (developer)

- **Defect A** — `src/main/uiBridge.test.ts`, new describe "UiBridge — re-entrant refresh-kick
  null-safety (Defect A)". Injects a `registerAgentSurfaceBindings` that synchronously calls
  `bridge.cancelActive()` (mirroring the dispatcher's `refresh()` → `cancelActive?.()` kick), sends a
  `bindings` `target:'jira'` frame over the real socket path, and asserts: the surface still pushes, a
  single `result` frame comes back, and ZERO `uncaughtException`s fire. **Fails pre-fix:** reverting
  the captured-local settle + the `settle` null-guard makes the late `settle(this.active=null)` throw
  inside the socket `'data'` handler — captured by the test's `uncaughtException` handler →
  `expected [ …(1) ] to have a length of +0` (verified by temporary revert).
- **Defect B** — `src/renderer/jiraBackNav.test.ts`, new describe "a REFRESHABLE composed surface
  restores marked `restored` (Defect B)". Asserts a bindings surface and a descriptor surface each →
  `restore-surface` with `surface.restored === true` (bindings/descriptor/spec preserved by reference),
  and an UNBOUND composed surface → restored verbatim with `restored` undefined (unchanged behavior).
  **Fails pre-fix:** reverting the bound-branch flagging makes both bound assertions report
  `expected undefined to be true`; the unbound assertion stays green (verified by temporary revert).

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web).
- [x] `npx vitest run` green — 986 tests, 0 failing (incl. both new regression tests).
- [x] Each new test confirmed to FAIL on a temporary revert of its fix and PASS with the fix restored.
- [ ] Original Step 1 reproduction re-run (kanban → ticket detail → Back: no crash, board repopulates)
  — NOT verifiable here: live Electron is not browser-automatable. A `npm run dev` is already running;
  **runtime UI confirmation left to the user.** Both defects are covered by node-env unit tests.
