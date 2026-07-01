# Spec: Dev wake-reload session survival — v1

**Status**: Draft
**Created**: 2026-07-01
**Supersedes**: —
**Related plan**: (none yet — spec only)

---

## Grounding

Investigated directly with codegraph + the authoritative in-repo decision record. (The LLM wiki
MCP tools — `wiki_query` — were **not exposed to this agent session**, so I grounded the prior
"rolled-back" decision from its canonical record instead: `docs/ARCHITECTURE.md` §4.1
`terminal-session-unnecessary-restart-v1` (lines 197–242) plus the load-bearing code comments in
`ptyManager.ts` / `index.ts`, which encode the same content the wiki `debugging` page would.)

**codegraph_explore queries run:**
- `ptyManager killAll teardownSession killAllSync did-start-navigation pty:start resume` — the
  three kill paths (`kill`, `killAll`, `killAllSync`) all funnel through `teardownSession`
  (group SIGHUP → grace → SIGKILL); `killAll` has exactly **1 caller** in `src/main/index.ts`.
- `TerminalPanel pty:start pane mount subscribe pty:data reattach paneId scrollback restore serialize` —
  `TerminalView` subscribes to `pty:data`/`pty:exit` filtered by `paneId` on mount; scrollback is
  captured lazily via a `SerializeAddon` serializer at report/teardown, restored by pre-writing
  `initialScrollback` before the live stream attaches.
- `TerminalView pty:start onPtyData subscribe autoStart useEffect goLive spawn agentRunner reload cosmos session` —
  the go-live path: `autoStart && !mirror → window.cosmos.pty.start(paneId)`; `AgentRunner`
  (headless `claude -p`) holds a persistent `defaultSessionId` and resumes, PTY-free.

**Grep queries run (exact seams):**
- `did-start-navigation|before-quit|will-quit|killAll|killAllSync|window-all-closed|close` in
  `src/main/index.ts` — found the exact listeners (below).
- `pty.start|dispose|isRunning|reattach` in `TerminalPanel.tsx` and `src/shared` — confirmed there
  is **no** reattach / `isAlive` IPC today; `pty.start` is the only go-live call.

**Key mechanism facts confirmed (verifies the brief):**
- `src/main/index.ts` `mainWindow.webContents.on('did-start-navigation', …)` calls
  `ptyManager?.killAll()` for any non-same-document navigation (the reload). This is the single
  session-kill on reload.
- On a FULL reload the renderer document is destroyed, so `TerminalView`'s unmount cleanup
  (`window.cosmos.pty.dispose(paneId)`, TerminalPanel.tsx:386) does **NOT** run. The **only** kill
  path on a reload is main's `did-start-navigation → killAll()`. Removing that one call is
  sufficient to stop the session kill.
- On remount the reloaded renderer re-issues `pty.start(paneId)` (TerminalPanel.tsx:359), and
  `PtyManager.start` currently kills any existing session for that `paneId` and respawns
  (ptyManager.ts:294–298) — this is the restart.
- Quit/close teardown is separate and reliable: `before-quit`, `will-quit`, `window-all-closed`,
  and window `closed` all call `killAllSync()` (group SIGHUP → bounded busy-wait → SIGKILL
  survivors), which is the load-bearing "ZERO `out/main/mcp/*Server.js` orphans on clean quit"
  invariant (`session-resume-relaunch-v3`). A reload does **not** destroy the window, so `closed`
  does not fire on reload.
- `powerMonitor.on('suspend')` already deliberately does **NOT** kill PTYs on sleep — sessions are
  meant to keep running across sleep/wake (ARCHITECTURE §4.1 continue-don't-restart policy).
- The cosmos headless agent (`AgentRunner`) is **not** a PTY and is **not** touched by `killAll`;
  it is disposed only on `before-quit`. Its transcript is on disk and it resumes its persistent
  `defaultSessionId`, so it already survives a reload in main.

---

## Overview

In `npm run dev`, when the machine sleeps/wakes (or the dev server re-runs), the `@vite/client` HMR
client's dev-server WebSocket is severed and, on reconnect, Vite issues a full `location.reload()`.
That reload fires main's `did-start-navigation` listener, which calls `ptyManager.killAll()`,
destroying every live terminal `claude` process; the reloaded renderer then `--resume`-spawns a NEW
process per pane. The conversation is preserved on disk, but it is a visible **restart**: the
startup banner reappears, in-TUI auto-accept mode is lost, and live scrollback is replaced with a
stale restored copy. Packaged builds (`loadFile`, no HMR client) never do this — it is a DEV-ONLY
annoyance, but the fix is correct for all builds.

This feature makes live sessions **survive a renderer reload** instead of being torn down and
respawned: main keeps the PTY sessions alive across a reload (killing only on a genuine quit/close),
and the reloaded renderer **reattaches** to the still-running session by its stable `paneId` rather
than spawning a fresh `--resume` process.

**Recommended direction: Direction B (survive + reattach), delivered as the minimal hybrid core.**
Rationale is in "Direction evaluation" below. This spec describes the behavior; the exact reattach
mechanism (output buffer vs. repaint-on-reattach) and any new IPC are plan decisions, flagged as
open questions.

---

## Direction evaluation (informative — behavior rationale, not implementation)

- **Direction A — suppress the Vite wake-reload (dev-config).** Stop `@vite/client` from full-
  reloading on WS reconnect via `server.hmr` config, a dev-only Vite plugin, or a main-side
  intercept. **Not recommended.** It is Vite-version-fragile, addresses ONLY the Vite-triggered
  reload (a manual Cmd+R still restarts sessions), and — per the authoritative record
  (ARCHITECTURE §4.1) — Vite hard-codes the reconnect reload with no cancel hook, so there is no
  clean seam to disable it while keeping HMR. It also does nothing for packaged builds (which is
  fine, since they never reload) and does not improve genuine reloads.
- **Direction B — survive the reload + reattach.** Sessions stay alive in main across a reload; the
  renderer reattaches by `paneId`. **Recommended.** It fixes BOTH the terminal and the cosmos agent
  session, works regardless of what triggered the reload (Vite wake-reload OR a genuine Cmd+R), and
  is a real product improvement — a genuine reload no longer destroys in-session context either.
- **The rolled-back approach must NOT be re-proposed:** a renderer guard overriding
  `window.location.reload` throws at startup (non-configurable in Electron/Chromium) and
  white-screens the app (it only passed under jsdom). This spec does not touch `location.reload`.

**Minimal core (what actually fixes the defect):** STOP killing PTY sessions on a renderer
reload/navigation — remove the `ptyManager?.killAll()` from the `did-start-navigation` listener —
while keeping the quit/close `killAllSync` teardown exactly as-is. That single change stops the
SESSION KILL. Paired with a renderer reattach (an idempotent `pty:start` that re-subscribes instead
of respawning when the pane is already live), the terminal shows the same live session with no
restart. Whether a main-side output buffer is additionally required to make the reload-gap lossless
(vs. relying on a TUI repaint-on-reattach + existing scrollback) is an open question below.

---

## User Scenarios

### Terminal session survives sleep→wake in dev · P1

**As a** developer running cosmos with `npm run dev`
**I want to** put my machine to sleep with a live `claude` terminal session and return later
**So that** I resume exactly where I left off — no restart, no lost context

**Acceptance criteria:**

- Given a live `claude` terminal pane with an ongoing conversation and auto-accept mode enabled,
  when the machine sleeps and wakes (triggering the Vite reconnect reload), then the SAME `claude`
  process is still attached to that pane — no startup banner reappears, auto-accept mode is still
  enabled, and the on-screen scrollback/context is unchanged.
- Given the pane was mid-response when the machine slept, when it wakes, then no output the
  surviving session produced during the reload gap is lost from the pane. *(Strength of this
  guarantee — lossless vs. best-effort — is OQ-1.)*
- Given the reload occurs, when the renderer remounts, then the pane does NOT spawn a new `--resume`
  process; it reattaches to the running one.

### Cosmos agent context survives sleep→wake in dev · P1

**As a** developer with an active cosmos generative-UI conversation
**I want to** the cosmos timeline to be unchanged after a wake-reload
**So that** the agent conversation reads as continuous, with no phantom restart

**Acceptance criteria:**

- Given an active cosmos agent conversation, when a wake-reload occurs, then the timeline shows no
  new "session started"/restart entry and the prior transcript/context is intact.

### A genuine quit still tears down cleanly · P1

**As a** developer/user quitting the app
**I want to** every `claude` process and its MCP-server children reaped
**So that** no orphaned processes or stale session-registry files leak (the resume invariant holds)

**Acceptance criteria:**

- Given live terminal sessions, when the app quits (`before-quit`/`will-quit`) or the last window
  closes (`window-all-closed`/window `closed`), then every session's process GROUP is torn down
  (SIGHUP → grace → SIGKILL survivors) and `ps` shows ZERO leftover `claude` or
  `out/main/mcp/*Server.js` processes.

### A session that died during sleep recovers gracefully · P2

**As a** developer whose `claude` process happened to die while the machine slept
**I want to** the pane to recover (resume/exit-banner) rather than show a frozen blank terminal
**So that** a genuinely-dead session is not mistaken for a survivable one

**Acceptance criteria:**

- Given a pane whose `claude` process is no longer alive in main after wake, when the renderer
  reattaches, then it detects the session is not alive and falls back to the existing resume /
  exit-banner recovery path (never a silent blank pane).

### Genuine manual reload preserves the session too · P2

**As a** developer who presses Cmd+R
**I want to** live sessions preserved across the reload
**So that** a manual reload no longer needlessly destroys in-session context

**Acceptance criteria:**

- Given live sessions, when the user triggers a genuine full reload (Cmd+R), then sessions survive
  and are reattached (same as the wake-reload path), and a subsequent quit still reaps cleanly.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST NOT tear down (kill) any live PTY session on a renderer reload / non-same-document navigation. The `did-start-navigation` path MUST stop calling `killAll()`. |
| FR-002 | The system MUST still tear down ALL PTY sessions cleanly on a genuine app quit or window close (`before-quit`, `will-quit`, `window-all-closed`, window `closed`), preserving the existing group teardown (SIGHUP → bounded grace → SIGKILL survivors) so a clean exit leaves ZERO orphaned `claude` / `out/main/mcp/*Server.js` processes. This invariant (`session-resume-relaunch-v3`) MUST NOT weaken. |
| FR-003 | On a reload, the renderer MUST reattach to each still-live session by its stable `paneId` — re-subscribe to that pane's `pty:data`/`pty:exit`, re-fit the terminal — INSTEAD of spawning a new `--resume` process. |
| FR-004 | A `pty:start` for a `paneId` that ALREADY has a live session MUST reattach (no kill + respawn). A `pty:start` for a `paneId` with no live session MUST spawn / resume exactly as today. |
| FR-005 | The renderer MUST be able to determine whether a given `paneId` still has a live session in main, so it can choose reattach vs. spawn. |
| FR-006 | Auto-accept mode and full TUI/conversation context MUST be preserved across a wake-reload (a direct consequence of keeping the same process — no new banner, no lost toggle). |
| FR-007 | Output the surviving session produced during the reload gap MUST NOT be lost from the pane on reattach. *(Whether this is a hard MUST via a main-side buffer or a best-effort SHOULD via repaint-on-reattach is OQ-1.)* |
| FR-008 | The keep-alive-on-reload behavior MUST apply to BOTH dev and packaged builds — it is universally correct because a reload always leaves the main process (and thus the sessions) alive. The change MUST NOT be gated to dev only. *(Confirm with product — OQ-4.)* |
| FR-009 | A session that genuinely died while the app was asleep MUST route the reattaching pane to the existing exit-banner / resume recovery path, never a silent frozen/blank pane. |
| FR-010 | The cosmos headless agent session and its timeline MUST show no restart across a wake-reload; the transcript/context MUST remain continuous. |
| FR-011 | Reattach MUST bind the reloaded renderer's tab to the surviving main session by a `paneId` that is stable across the reload; if the renderer's rehydrated `paneId`s can diverge from main's live sessions, the two MUST be reconciled (no live session left unreferenced/orphaned). *(Reconciliation mechanism is OQ-2.)* |
| FR-012 | The change MUST NOT weaken the orphan-recovery path (`onSessionInUse` / `sessionLockRecovery`, `session-resume-relaunch-v1..v5`) that frees an in-use recorded id at relaunch. |

## Edge Cases & Constraints

- **Genuine Cmd+R reload:** sessions survive and reattach (an improvement — no context loss); a
  later quit still reaps cleanly.
- **Real quit / window close:** `killAllSync` group teardown unchanged — ZERO orphaned `claude` /
  MCP-server processes and no stale `~/.claude/sessions/<pid>.json` left un-freed.
- **Session died during sleep:** reattach detects "not alive" → existing resume / exit-banner path
  (FR-009). A session alive-but-different (impossible today, but noted) reconciles per FR-011.
- **Reload-gap output:** the window between reload-start and reattach has no renderer listening;
  the surviving `claude` may emit output no one is buffering. See OQ-1.
- **`paneId` freshness across reload:** the reloaded renderer rehydrates tabs from the last-saved
  session snapshot, which is debounce-saved and may be slightly stale; a `paneId` minted after the
  last save would not be in the snapshot, so its reloaded tab id could differ from the surviving
  main session's key. See OQ-2 / FR-011.
- **Single-window assumption:** cosmos is single-window (`window-all-closed` teardown). Multi-window
  is out of scope.
- **Multiplexed panes (Home terminal favorite mirror):** a `mirror` view never owns the PTY
  lifecycle and already only fans in on `pty:data`; reattach must preserve that — only the OWNING
  source view reattaches/spawns.
- **Launch-time orphan reaping:** `reapOrphanMcpServers` at startup (for a genuinely hard-killed
  prior run) is unaffected and remains the safety net for the unavoidable residual (force-quit /
  SIGKILL of cosmos).
- **Out of scope:** Direction A (suppressing the Vite reload); any change to `location.reload`;
  scraping/injecting in-TUI state; multi-window.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | In `npm run dev`, sleep the machine ≥10 min with a live `claude` pane (auto-accept on, mid-conversation), then wake: the pane shows the SAME session — no startup banner, auto-accept still on, scrollback/context intact, no `--resume` respawn. |
| SC-002 | After the same wake, the cosmos timeline shows no new "session started"/restart entry; the agent conversation is continuous. |
| SC-003 | Quitting the app (or closing the last window) leaves ZERO orphaned `claude` and ZERO `out/main/mcp/*Server.js` processes (verified via `ps`), and no un-freed `~/.claude/sessions/<pid>.json`. |
| SC-004 | A genuine Cmd+R reload preserves + reattaches the session; a subsequent quit still reaps cleanly (SC-003 holds). |
| SC-005 | A pane whose `claude` died during sleep surfaces the exit banner / recovers via resume on reattach — never a silent blank/frozen pane. |
| SC-006 | Packaged builds are byte-behavior-unchanged for quit/close teardown; keep-alive-on-reload is inert there (they never reload). |

---

## Open Questions

- [ ] **OQ-1 (reload-gap losslessness):** Is losslessness of output produced DURING the reload gap a
  hard requirement, or best-effort? Two mechanisms satisfy reattach: (a) a **main-side per-`paneId`
  output buffer** captured while no renderer is attached, replayed on reattach — lossless but adds
  buffering state and a bound; (b) **repaint-on-reattach** — since the live `claude` TUI redraws on
  a resize/SIGWINCH, trigger a re-fit/resize on reattach to force a full repaint, plus the existing
  scrollback restore — simpler, but output emitted mid-gap that scrolled off is not recovered.
  **Recommendation:** start with (b) repaint-on-reattach (minimal, and the TUI's current screen is
  what matters for a full-screen app like Claude Code); add (a) only if a real gap-loss is observed.
  Need your call on whether "no gap loss" is a hard MUST.
- [ ] **OQ-2 (`paneId` reconciliation / reattach handshake):** Is the session snapshot guaranteed
  fresh enough that the reloaded renderer's `paneId`s always match main's live sessions — or must
  main expose its set of live `paneId`s so the renderer can reconcile (adopt a surviving session
  whose tab wasn't in the last snapshot, and avoid respawning over it)? This decides whether a new
  "list live panes" / "is paneId alive" IPC channel is needed (likely yes, for FR-005/FR-011).
- [ ] **OQ-3 (cosmos agent — any change needed?):** The headless `AgentRunner` already survives a
  reload in main (not a PTY, not killed by `killAll`, disposed only on quit) and resumes its
  persistent `defaultSessionId`; its transcript is on disk. Confirm the cosmos timeline already
  re-hydrates continuously with no visible restart — or is there a renderer-side "restart" artifact
  that must be explicitly suppressed?
- [ ] **OQ-4 (dev-only scope vs. universal):** Recommend applying keep-alive-on-reload in BOTH dev
  and prod (not dev-gated), since it strictly improves a genuine Cmd+R and the no-orphan guarantee
  lives entirely on the quit/close path (unchanged). Confirm it's acceptable to change prod reload
  behavior this way (vs. gating the change to dev builds only).
