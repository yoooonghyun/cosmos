# Plan: Dev wake-reload session survival — v1

**Status**: Draft
**Created**: 2026-07-01
**Last updated**: 2026-07-01
**Spec**: `.sdd/specs/cosmos-dev-wake-reload-session-survival-v1.md`

---

## Grounding

Investigated directly with codegraph + targeted Read/Grep. (The LLM wiki MCP tools `wiki_query`/
`wiki_ingest` were **not exposed to this agent session**; I grounded the prior rolled-back decision
and the continue-don't-restart policy from their canonical record — `docs/ARCHITECTURE.md` §4.1 and
the load-bearing code comments — which carry the same content.)

**codegraph_explore queries run (this step):**
- `preload window.cosmos.pty start dispose onData onExit ipcMain.handle pty:start pty:dispose validate PtyStartPayload` —
  the pty IPC surface + `PtyManager.start` body; confirmed `start` kills any existing session for a
  `paneId` then respawns (ptyManager.ts:294-298).
- (Step-1 queries carried over) `ptyManager killAll teardownSession killAllSync` and
  `TerminalPanel pty:start subscribe reattach scrollback serialize`.

**Grep/Read (exact seams):**
- `src/main/index.ts:2468-2486` — the `did-start-navigation` listener: `ptyManager?.killAll()` +
  `fsExplorer?.stopAll()` + `uiBridge?.cancelActive()` + `agentRunner?.dispose()` +
  `transcriptWatcher?.stop()`.
- `src/main/index.ts:2492-2497` (`closed`) and `:2630-2692` (`window-all-closed`/`before-quit`/
  `will-quit`) — the quit/close teardown (`killAll` on window destroy, `killAllSync` on quit).
- `src/main/index.ts:1122-1252` — the `pty:start` / `pty:restart` / `pty:dispose` handlers.
  `presweepResumeLock` already **no-ops when `ptyManager.isRunning(paneId)`** (index.ts:492), so the
  start handler is already resume-safe for a live pane.
- `src/shared/ipc/pty.ts` + `src/shared/ipc/pty.validate.ts` — the channel constants, payloads,
  `PtyApi`, and the boundary validators (`validateStart`/`validatePaneId` pattern to mirror).
- `src/renderer/terminal/TerminalPanel.tsx:184-389` — `TerminalView` mount effect: subscribes
  `onData`/`onExit` by `paneId`, `if (autoStart && !mirror) pty.start(paneId)` (:358), and the
  **unmount cleanup unconditionally calls `pty.dispose(paneId)`** (:385-387).
- `src/renderer/main.tsx:15-19` — **`<StrictMode>` is enabled** in the real app. This is the
  load-bearing constraint below.

**Key discovered constraint (NOT in the brief — needs confirmation, see "Needs confirmation"):**
Because StrictMode is on and `TerminalView`'s cleanup disposes (kills) the PTY, an idempotent
`start` ALONE does not make a session survive in dev: on the post-reload fresh mount React does
mount → cleanup(**dispose → kill**) → remount, killing the survivor between the two `start`s. So the
fix MUST also stop the unmount cleanup from killing a still-wanted session. The minimal, deterministic
way is to make the renderer dispose the PTY **only on a genuine tab close**, not on every unmount
(StrictMode / reload / rail-switch). Paired with idempotent `start`, the session then survives both
StrictMode and reload; a genuine close still kills.

---

## Summary

Make live terminal `claude` sessions **survive a renderer reload** instead of being killed and
respawned, so a `npm run dev` sleep/wake (and a genuine Cmd+R) no longer restarts the session
(banner, lost auto-accept, stale scrollback). Three coordinated changes: (1) **main stops killing
PTYs on reload** — remove the single `ptyManager?.killAll()` from the `did-start-navigation` listener
(everything else in that listener stays); kill remains only on genuine quit/close, unchanged.
(2) **`PtyManager.start` becomes idempotent** — a `start` for a `paneId` whose session is still live
reattaches (no kill + respawn); `restart` keeps forcing a fresh spawn. (3) **the renderer reattaches**
— a new `pty:listLive` query lets the Terminal panel reconcile its reloaded tabs against main's live
sessions (reattach survivors, adopt any live pane missing from the stale snapshot), each survivor
view re-subscribes to `pty:data` and nudges a resize so the live claude TUI repaints (best-effort,
per spec OQ-1); and the unmount cleanup disposes the PTY only on a genuine tab close. The quit/close
`killAllSync` group teardown, the `onSessionInUse` orphan recovery, and the exit-banner resume path
are all preserved untouched.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main + React renderer) |
| Key dependencies | node-pty, xterm.js (`SerializeAddon`, `FitAddon`), existing `src/shared/ipc` contract |
| Files to create | (none — all edits land in existing modules; new tests added) |
| Files to modify | `src/main/index.ts`, `src/main/pty/ptyManager.ts`, `src/shared/ipc/pty.ts`, `src/shared/ipc/pty.validate.ts` (+ barrel if needed), `src/renderer/terminal/TerminalPanel.tsx`, `src/main/preload.ts` (new `listLive` bridge method), `docs/ARCHITECTURE.md` §4.1 (doc phase) |

---

## Design decisions

### D1 — Main: stop killing PTYs on reload (the minimal core)
In `src/main/index.ts` `did-start-navigation` listener (:2468), **remove only** the
`ptyManager?.killAll()` call (:2472). Confirmed the rest is still load-bearing and stays:
- `fsExplorer?.stopAll()` — the reloaded renderer re-mounts every explorer and re-issues
  `fs:watchStart`; releasing old watchers is still correct (no leak). KEEP.
- `uiBridge?.cancelActive()` — a pending `render_ui` across a reload must not hang. KEEP.
- `agentRunner?.dispose()` + `transcriptWatcher?.stop()` — tears down any in-flight headless cosmos
  run; its transcript is already on disk and the reloaded timeline re-hydrates from it (spec OQ-3).
  KEEP for v1 (keeping an in-flight headless run alive+reattached is out of scope — see
  "Needs confirmation" C3).

Quit/close paths are **untouched**: `mainWindow.on('closed')` → `killAll()` (window destroyed —
does NOT fire on reload); `window-all-closed`/`before-quit`/`will-quit` → `killAllSync()` (group
SIGHUP → bounded grace → SIGKILL survivors). This preserves the ZERO-orphans invariant
(`session-resume-relaunch-v3`).

### D2 — `PtyManager.start` idempotent reattach (ptyManager.ts:294)
Map presence already implies a LIVE session (self-exit deletes the entry in `onExit`; `kill` deletes
before teardown). Change the head of `start`:

```
const existing = this.sessions.get(paneId)
if (existing) {
  // A still-live session for this paneId ⇒ a renderer reload / StrictMode remount re-issued
  // pty:start. REATTACH: do NOT kill + respawn (that is the visible restart — banner, lost
  // auto-accept, stale scrollback). Leave the process running; the renderer re-subscribes to
  // pty:data and nudges a resize to repaint. Idempotent.
  return
}
```
(Replaces the current `if (existing) { this.kill(paneId) }` kill-then-fall-through.)

`PtyManager.restart` (ptyManager.ts:431) MUST keep forcing a fresh spawn — it calls `start`, which
is now idempotent, so change `restart` to **explicitly `kill` then `start`** (kill removes the map
entry so the subsequent `start` spawns). Verify `restart`'s callers (blast radius: the `pty:restart`
IPC handler calls `ptyManager.start` DIRECTLY with resume args, not `restart()`; and the exit-banner
Restart only fires for an already-dead pane, so it spawns normally). The explicit-restart path and
the dead-pane resume path are unaffected.

### D3 — New `pty:listLive` query IPC (reattach handshake / OQ-2 reconciliation)
- `src/shared/ipc/pty.ts`: add `PtyChannel.ListLive = 'pty:listLive'` (R→M, request/response via
  `ipcRenderer.invoke`/`ipcMain.handle`). Request carries no field (`type PtyListLiveRequest =
  Record<string, never>`, mirroring `PtyPickDirectoryRequest`). Response
  `interface PtyListLiveResult { paneIds: string[] }`. **Non-secret** — renderer-minted paneIds
  only (no cwd, sessionId, scrollback, or token). Add `listLive(): Promise<PtyListLiveResult>` to
  `PtyApi`.
- `src/main/preload.ts`: expose `listLive` on `window.cosmos.pty`. **NEW preload method ⇒ requires a
  full `npm run dev` restart** (HMR alone leaves it "not a function" — CLAUDE.md gotcha; call out in
  the checklist).
- `src/main/index.ts`: `ipcMain.handle(PtyChannel.ListLive, () => ptyManager?.listLive() ?? { paneIds: [] })`.
  The response is built entirely in main; no inbound payload to validate beyond the empty-request
  shape (ignored, like `pickDirectory`).
- `src/main/pty/ptyManager.ts`: add `listLive(): string[]` returning `[...this.sessions.keys()]`
  (map presence = live, per D2). Wrap into `{ paneIds }` at the handler.

### D4 — Renderer reattach + reconciliation (TerminalPanel.tsx)
- **Panel mount:** query `window.cosmos.pty.listLive()` once → `liveSet: Set<string>`. Reconcile
  against the hydrated tabs:
  - Hydrated tab whose `id ∈ liveSet` → **survivor**: mount its `TerminalView` in attach mode
    (phase `'live'`, no `[Open]`), reattach.
  - Hydrated **restored** tab NOT in `liveSet` → resume via the existing `autoStart` path (its
    session legitimately isn't live — e.g. first launch after a real quit).
  - `paneId ∈ liveSet` with **no** hydrated tab → **adopt** (spec OQ-2 orphan avoidance): create a
    tab bound to that `paneId` (default `terminalLabel`), attach mode. Prevents a live-but-orphaned
    session with no tab (a paneId minted after the last debounced snapshot save).
- **`TerminalView` attach mode** (new prop, e.g. `attach: boolean`): when attaching, on mount it
  subscribes to `pty:data`/`pty:exit` (already does), calls `pty.start(paneId)` (main idempotent →
  reattach; harmless), pre-writes `initialScrollback` as pre-redraw history (best-effort), then
  after `safeFit()` **pushes a resize** via the existing `pushResize()` → node-pty `resize` →
  SIGWINCH → the claude ink TUI repaints its current screen (spec OQ-1 best-effort repaint; no
  main-side output buffer in v1).
- **Dispose only on genuine close (the StrictMode/reload guard, D1's necessary partner):** gate the
  cleanup's `window.cosmos.pty.dispose(paneId)` (TerminalPanel.tsx:385-387) behind an intentional-
  close signal. Track closing paneIds in a panel-level ref set; `handleClose`/`close`-driven removal
  marks the id before unmount, and the cleanup disposes ONLY if the id is in that set. A plain
  unmount (StrictMode double-invoke, rail switch, reload) does NOT dispose — the session survives and
  reattaches. Keep every OTHER cleanup action (xterm `dispose()`, listener/`onData` removal,
  serializer unregister, fs-watcher stop) unchanged so nothing leaks. (The FAVORITE `mirror` view
  already never disposes — unchanged.)

### D5 — Cosmos agent (spec OQ-3): confirm, don't rebuild
The headless `AgentRunner` is not a PTY, is not touched by `killAll`, and is disposed only on
`before-quit` (its `did-start-navigation` `dispose()` tears down only an IN-FLIGHT run). Its
transcript is on disk and the timeline re-hydrates via `ConversationChannel.Fetch` on reload, so it
shows no restart entry. **No code change** for the agent beyond the dev-verify step (SC-002). An
in-flight run interrupted by the reload is existing behavior (transcript preserved) — keeping it
alive is out of scope (C3).

### PRESERVE (do NOT touch)
- `killAllSync` on `before-quit`/`will-quit`/`window-all-closed`, and `killAll` on window `closed`
  (all genuine quit/close) — the group teardown + SIGKILL escalation (ZERO orphans).
- `onSessionInUse` / `sessionLockRecovery` / `presweepResumeLock` / `planResumeRetry` orphan
  recovery (`session-resume-relaunch-v1..v5`) and `reapOrphanMcpServers` at launch.
- The exit-banner Restart path (`pty:restart` → resume the recorded id) for a genuinely-dead session.
- `powerMonitor` `suspend` (no kill on sleep).

---

## Implementation Checklist

### Phase 1 — Interface (types + contract)
- [x] Read spec; confirm the 4 resolved OQs + the new "Needs confirmation" items before coding.
- [x] `src/shared/ipc/pty.ts`: add `PtyChannel.ListLive`, `PtyListLiveRequest`, `PtyListLiveResult`, and `PtyApi.listLive()`. Doc-comment: non-secret, paneIds only.
- [x] Confirm barrel `src/shared/ipc.ts` / `src/shared/validate.ts` re-export any new symbols (pattern-match existing pty exports). — pty.ts is re-exported via `export * from './ipc/pty'`; NO new validator needed (the request carries no field, like `pickDirectory` — the handler ignores the arg).
- [x] Review new types vs spec — no invented fields (paneIds only).

### Phase 2 — Testing (write first where practical)
- [x] node: `PtyManager.start` on a **live** paneId does NOT re-spawn and does NOT kill (same `proc`, no extra `spawn` call) — idempotent reattach (D2). (`ptyManager.test.ts`, replaced the old "start twice replaces" test.)
- [x] node: `PtyManager.start` on an **absent/exited** paneId spawns as before (regression guard).
- [x] node: `PtyManager.restart` on a live paneId DOES kill + respawn (force) (D2).
- [x] node: `PtyManager.listLive()` returns exactly the live paneIds; excludes killed/exited ones (D3).
- [x] node: **quit path unchanged (LOAD-BEARING)** — `killAllSync()` still group-tears-down every session with SIGKILL escalation and leaves the map empty (`sessionRestart.integration.test.ts` new lifecycle block, stubborn group killer forcing SIGKILL; `ptyManager.test.ts` existing killAllSync tests kept green).
- [x] jsdom: `TerminalView` — a plain unmount + a StrictMode double-invoke do NOT call `pty.dispose`; a genuine close DOES (D4 intentional-close guard). (`TerminalReloadSurvival.dom.test.tsx`, incl. a `<StrictMode>` case.)
- [x] jsdom: `TerminalPanel` reconcile — given `listLive` returns `[pane-A, pane-B]`, the hydrated survivor `pane-A` reattaches (`pty:start` once), and `pane-B` (live, no tab) is adopted as a new tab (`TerminalPanelReattach.dom.test.tsx`). Pure adoption decision also node-tested (`terminalReattach.test.ts`).
- [x] jsdom: a restored tab NOT in `listLive` still resumes via `autoStart` (regression guard) (`TerminalPanelReattach.dom.test.tsx`).

### Phase 3 — Implementation
- [x] `src/main/pty/ptyManager.ts`: idempotent `start` (D2), force-respawn `restart` (D2 — explicit kill-then-start), `listLive()` (D3).
- [x] `src/main/index.ts`: remove `ptyManager?.killAll()` from `did-start-navigation` (D1, keep the other four calls); add `ipcMain.handle(PtyChannel.ListLive, …)` (D3).
- [x] `src/preload/index.ts` (the preload lives at `src/preload/`, not `src/main/preload.ts`): expose `listLive` on `window.cosmos.pty` (⚠️ requires full `npm run dev` restart).
- [x] `src/renderer/terminal/TerminalPanel.tsx`: panel-mount `listLive` reconcile + adopt (D4); survivor/adopted tabs autoStart (reattach via idempotent start + the existing resize repaint); gate cleanup `pty.dispose` behind the intentional-close ref set (D4). Reconcile decision extracted to a PURE `terminalReattach.ts` (node-tested).
- [x] Verify `restart()` callers (blast radius) — `PtyManager.restart` has NO production caller (tests only); the `pty:restart` handler calls `ptyManager.start` directly and only for already-dead panes.
- [x] `npm run typecheck` (node + web) + `npm test` + `npm run test:integration` + `npm run build` all green.

### Phase 4 — Docs
- [x] Update `docs/ARCHITECTURE.md` §4.1: a renderer reload now **KEEPS** live sessions and the renderer **reattaches** (kill only on genuine quit/close); retired the "Direction B deferred" paragraph + the dev-only `terminal-session-unnecessary-restart-v1` caveat; added the `pty:listLive` reattach handshake + idempotent-start + intentional-close-guard note. (Edited per the explicit task directive; flag to architect for review.)
- [x] `docs/DEVELOPMENT.md`: pty-channels bullet (listLive, idempotent-start, dispose-only-on-close) + rewrote the "KNOWN DEV-ONLY annoyance" bullet to "FIXED via direction B". `docs/TEST-SCENARIOS.md`: added TERM-RELOAD-SURVIVAL-01 row + the idempotent-start-vs-force-restart tension.
- [x] Deviations recorded below.
- [ ] `wrap-up`: reconcile `TODO.md`; persist the reattach decision to the LLM wiki when tools are available.

## Deviations

- **Preload path:** the plan named `src/main/preload.ts`; the actual preload is `src/preload/index.ts`. Edited there.
- **No new validator:** `pty:listLive` request carries no field (empty record), so — mirroring `pty:pickDirectory` — no `validate*` function was added; the handler ignores the inbound arg and builds the response entirely in main.
- **Pure reconcile module (added file):** the reconcile/adopt decision was extracted to a new PURE `src/renderer/terminal/terminalReattach.ts` (`planReattach`) + node test `terminalReattach.test.ts`, keeping the panel thin and the decision testable without heavy provider mocking. (The plan listed "no files to create"; this is an additive helper, not new behavior.)
- **Attach mode = autoStart:** rather than a separate `attach` prop, a survivor/adopted tab simply uses the existing `autoStart` path (go-live + idempotent `pty:start` reattach + the existing end-of-mount `pushResize()` repaint). `autoStart` now = `restoredTabIds.has(id) || liveSet.has(id)`. The behavior matches D4's "attach mode" without a new phase.
- **`start` cols/rows:** after the early idempotent `return`, `existing` narrows to `never`, so the `existing?.cols/rows` reads were replaced with the manager defaults (a fresh spawn's size; a later `pty:resize` sets the real size). No behavior change.

---

## Manual dev verification (the defect is dev-only + timing-based — SC-001/002/003)
- [ ] `npm run dev`; open a terminal, start a conversation, enable auto-accept (shift+tab), sleep the machine ≥10 min, wake: SAME session — no banner, auto-accept still on, scrollback/context intact, no respawn (SC-001).
- [ ] Same wake: cosmos timeline shows no new "session started" (SC-002).
- [ ] Quit the app; `ps -axo pid,command | grep -E 'claude|out/main/mcp'` shows ZERO leftovers (SC-003).
- [ ] Cmd+R reload: session survives + reattaches; subsequent quit still clean (SC-004).
- [ ] Kill a pane's claude during sleep (or `kill` its pid), wake: exit banner / resume recovery, not a blank pane (SC-005).

---

## Needs confirmation before dev

**All three CONFIRMED by the dev brief and implemented as recommended:** C1 = renderer intentional-close guard (not a main-side timer); C2 = repaint via resize nudge + scrollback restore (no main-side buffer); C3 = keep `agentRunner.dispose()` on reload (in-flight headless run interrupted, transcript persists, timeline re-hydrates).

- [x] **C1 (StrictMode dispose guard — the key discovered decision):** StrictMode is enabled, so the
  reload's fresh mount does mount→cleanup(dispose→kill)→remount; idempotent `start` alone would still
  let the cleanup kill the survivor. My plan disposes the PTY **only on a genuine tab close** (a
  panel-level closing-ref set), not on every unmount. This is deterministic and also removes the
  pre-existing dev double-spawn on initial load. Confirm this over the alternative (a main-side
  **deferred-dispose grace**: `pty:dispose` schedules the kill after ~250ms and a same-paneId
  `pty:start` within the window cancels it). Both work; I recommend the renderer intentional-close
  guard (no timer, deterministic).
- [ ] **C2 (repaint mechanism, spec OQ-1):** v1 repaints a reattached survivor via a **resize nudge**
  (SIGWINCH → TUI redraw) + the existing scrollback pre-write — no main-side output buffer. Accept
  best-effort (a rare mid-gap line that scrolled off is not recovered), building the buffer only if a
  real gap-loss is later observed. Confirm.
- [ ] **C3 (in-flight cosmos run on reload, spec OQ-3):** v1 KEEPS `agentRunner?.dispose()` on
  `did-start-navigation`, so an in-flight headless cosmos run is interrupted by the reload (its
  transcript persists; the timeline re-hydrates with no restart). Keeping an in-flight headless run
  alive + reattached across a reload is out of scope for v1 (the terminal PTY is the P1 target).
  Confirm acceptable.
