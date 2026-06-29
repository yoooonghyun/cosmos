# Bug: terminal claude sessions restart unnecessarily (lock/wake/etc) — lose context + auto-mode

ID: `terminal-session-unnecessary-restart-v1`
Skill: bugfix → Spec/architecture defect (route: `architect` for root-cause + session-lifecycle
policy, then `developer` to implement). Scope-gate: likely exceeds a one-line fix.
Reported: 2026-06-29

## Symptom (user)

After the machine goes to lock/sleep and is turned back on (and "등" — other cases where the claude
session would NOT need a restart), cosmos **keeps (re)starting the claude session** instead of
continuing the live one. The restart **loses context and unsets auto-mode** (the in-session
auto-accept / mode toggles), badly degrading usability. Expected: like a normal terminal, an
already-open app's session CONTINUES across lock/wake without a restart.

Scope: the TERMINAL panel's embedded `claude` TUI sessions (node-pty). "auto mode 풀림" is a TUI
in-session state, so this is the PTY claude, not (only) the headless agent runner.

## Expected vs actual

- Expected: a live terminal `claude` keeps running across lock/sleep/wake (and app focus changes);
  the same process, same in-session state (context, auto-accept mode), no restart.
- Actual: the session is restarted; `--resume` (at best) reloads the transcript but the live process
  is NEW, so in-session-only flags (auto-accept mode toggled via shift+tab, any runtime state beyond
  the transcript) are LOST — and in the worst case a FRESH session is started, losing even context.

## Orchestrator grounding (ORIENTATION for the owner — re-investigate, don't take as final)

- `powerMonitor.on('suspend')` (`src/main/index.ts:2638`) DELIBERATELY does NOT kill PTYs on sleep
  ("wake → keep using the same live claude"); `will-quit` kills them. So suspend itself is not the
  killer — the restart trigger is elsewhere.
- The renderer does NOT self-reload / respawn on visibility/focus/online (no such handler in
  `src/renderer`). `TerminalView` (`TerminalPanel.tsx:158-350`) spawns on mount only when
  `autoStart`, disposes (`pty.dispose` → kill) on UNMOUNT, and `restart` is called ONLY from the
  manual exit-banner button (`handleRestart`, `:376`). The active-toggle effect (`:355`) only re-fits.
- A real respawn-losing-state path exists: on a resume FAILURE, `src/main/index.ts:1087-1088`
  logs `[session] resume failed for pane …; starting a fresh session` and calls
  `ptyManager.start(… resume:false …)` — a FRESH session (loses context + auto-mode).
- The "already in use" recovery churn (`onSessionInUseForPane` / `planResumeRetry` /
  `sessionLockRecovery.ts`) retries a SAME-id `--resume`; if the old process is still
  shutting down on wake, the resume can collide and (after backoff) give up.
- `--resume` reattaches a session id but is a NEW `claude` process → in-session-only TUI state is
  inherently not restored by it. So ANY respawn (even a "successful" resume) loses auto-mode.

The actual runtime trigger on lock/wake is NOT pinned statically (candidates: the live `claude`
process dies when its API/stream connection drops during lock → PTY `onExit` → exit banner / restart;
or a renderer remount/relaunch path; or app quit+relaunch re-creating instead of resuming). The
owner MUST reproduce/observe (logs around lock/wake) to pin the real cause(s) before fixing.

## Why this is architecture (scope-gate)

The user is asking to change the **session-management approach** — i.e. re-specify WHEN a session
continues vs restarts, and how to preserve in-session state across lifecycle events. That is a
behavior/contract correction spanning main (PtyManager lifecycle, resume/lock-recovery, session
store) and the relaunch/renderer path — not a single wrong line. Per the bugfix scope-gate this
routes to `architect` (correct the session-lifecycle policy + `docs/ARCHITECTURE.md`), then
`developer` implements; escalate to full `sdd` if it proves feature-sized.

## To do (architect)

1. Reproduce + pin the ACTUAL restart trigger(s) on lock/wake (and the other "등" cases). Ground with
   codegraph + `wiki_query` (debugging) + `git log` on the PTY/session files. Confirm `file:line`.
2. Define the correct policy: a live PTY `claude` continues across lock/sleep/wake/focus with NO
   respawn; a respawn happens ONLY when genuinely necessary (true process death / explicit user
   restart / first launch). If in-session state (auto-mode) cannot survive a respawn, the policy must
   AVOID the respawn rather than paper over it. Record in `docs/ARCHITECTURE.md`.
3. Hand `developer` a precise fix spec. If the fix is large/feature-sized, escalate to `sdd`.

## SUPERSEDED hypothesis (kept for the record — DO NOT IMPLEMENT)

An earlier static-only pass hypothesized the trigger was an UPSTREAM `claude` process death on a
lock/wake connection drop (live `claude` exits → plain `onExit` banner → user manual-restart spawns
a fresh, non-resumed process). **Runtime evidence falsified this** (see below): the symptom is a
spontaneous re-mount with STACKING startup banners, not a single "claude exited" banner. The
upstream-death section has been replaced by the corrected chain.

## ROOT CAUSE (architect, 2026-06-29 — CORRECTED by runtime evidence)

### Runtime evidence (decisive)

Reproduced live in `npm run dev` (HMR): on lock→wake the session RESETS and the `claude` Code
**STARTUP BANNER re-runs and STACKS** — multiple overlapping "Claude Code v… Opus 4.8" banners
accumulate in the pane. This is NOT a single "claude exited" banner, which **falsifies** the
upstream-process-death hypothesis (that path shows one exit banner + a manual restart, not a
spontaneous re-mount with stacking banners).

### The corrected chain — renderer full-reload on wake (DEV)

1. **Dev-server HMR WebSocket drops while the host sleeps.** `npm run dev` loads the renderer from
   `process.env['ELECTRON_RENDERER_URL']` via `loadURL` (`index.ts:2474-2478`), so the page runs the
   `@vite/client` HMR client. On sleep the client's WS to the Vite dev server is severed.
2. **On wake the Vite client full-reloads.** `@vite/client` detects the lost socket, polls the
   server (`waitForSuccessfulPing`), and on a successful reconnect after the server was unreachable
   it calls `location.reload()` (Vite's standard "server connection restored → reload"). This is a
   FULL-PAGE navigation, not an HMR module swap.
3. **`did-start-navigation` (non-same-document) fires → `ptyManager.killAll()` kills EVERY live
   PTY** (`index.ts:2429-2433`). That handler was written to avoid orphaning PTYs across an
   intentional reload; it cannot tell a wake-induced HMR reload from a deliberate Cmd+R, so it kills
   all live `claude` sessions.
4. **The reloaded renderer re-mounts, re-mints tabs, and re-`pty:start`s each** — restored tabs
   spawn `--resume <id>` (`autoStart`, `TerminalPanel.tsx:322-324`).
5. **Banners STACK** because on each mount `TerminalView` pre-writes the restored scrollback
   (`initialScrollback`, `TerminalPanel.tsx:200-202`) — which already contains the PRIOR startup
   banner — and THEN the fresh `--resume` claude prints ANOTHER startup banner on top. Repeated wake
   cycles accumulate them exactly as the user reports.

So the trigger is **a cosmos-internal renderer full-reload on wake (driven by the Vite HMR reconnect),
NOT an upstream claude death.** The session is healthy and live across sleep; cosmos's own reload
path kills and respawns it.

### Dev-only? — YES (the lock/wake reset is a DEV-ONLY artifact)

The reload is HMR-client behavior. A PACKAGED build loads the renderer via
`loadFile(...index.html)` (`index.ts:2476-2477`) with **no `@vite/client`** — no dev-server WS to
drop, no reconnect-reload on wake, so `did-start-navigation` does not fire spontaneously. The user's
report is from `npm run dev`, so this exact lock→wake reset does not occur in a packaged build.
**Caveat (keep honest):** `did-start-navigation` + `killAll()` is still CORRECT for a genuine,
user-driven reload (Cmd+R) in BOTH builds — that stays. The defect is narrowly the SPURIOUS dev
reload on wake.

### Why the prior static pass missed it

The static trace correctly excluded `suspend`, the `restart` button, `onResumeFailure`, and
`onSessionInUse` as wake triggers — but it overlooked that the renderer PAGE itself reloads in dev.
The `@vite/client` HMR client lives in the served page, not in `src/renderer` source, so the
"no respawn handler in src/renderer" grep was true yet incomplete: the reload comes from the dev
runtime, and the kill comes from `did-start-navigation → killAll()` in MAIN.

## FIX DECISION: (A) suppress the spurious dev wake-reload — NOT (B), NOT sdd

Two directions were weighed:

- **(A) Dev-only:** stop the spurious Vite HMR full-reload on dev-server reconnect after sleep, so
  `did-start-navigation` never fires on wake and live sessions stay untouched. Smallest; targets the
  exact reproduced scenario; production is already fine.
- **(B) General:** make PTY sessions SURVIVE a renderer reload — drop the `killAll()` on
  `did-start-navigation`, keep sessions alive in main, and have the renderer REATTACH (stable
  paneIds across reload + reattach xterm to the live PTY).

**Decision: (A).** Justification:

1. **(A) matches the actual defect and the user's literal want** ("세션이 떠 있으니 새로고침 없이
   그대로 다시 쓰면 된다" — the live session should SURVIVE, not reload). The bug is a SPURIOUS reload
   on wake; removing that reload makes the live session simply stay, with no kill, no respawn, no
   banner stacking — the normal-terminal behavior the user asked for. The fix is contained to dev
   config/guard; the production path is unchanged and already correct.
2. **(B) is the wrong tradeoff here and is feature-sized.** It REVERSES the deliberate
   orphan-avoidance `killAll()` on reload — the very invariant `session-resume-relaunch-v1..v4` and
   the FR-023 teardown were built around (a reload that does NOT kill would leave every `claude` +
   its MCP-server children orphaned on a genuine Cmd+R, re-opening the orphan/stale-registry problem
   those features closed). It also needs a new contract: paneId stability across a full reload (today
   the renderer re-mints paneIds on mount) and a reattach handshake (renderer rebinds xterm to a
   still-live PTY, replays/relinks scrollback) — net-new behavior across main + renderer + the IPC
   contract. That is an `sdd` feature, not a bugfix, and it would be solving reload-survival in
   GENERAL when the only observed problem is one spurious DEV reload that (A) eliminates at the
   source. (B) can be revisited as its own feature later if reload-survival in PRODUCTION is ever
   wanted, but it is not warranted by this bug.

**Scope: contained dev-config/guard fix → `developer`. Do NOT escalate to `sdd`.**

### What the developer should implement (direction A)

Goal: in dev, the Vite HMR client must NOT `location.reload()` when its dev-server WebSocket
reconnects after a sleep/disconnect — so no spurious full-page navigation fires on wake and the live
PTY sessions are never `killAll()`-ed. Investigate the cleanest lever (in rough order of
preference); pick the one that is robust and does not weaken a genuine user reload:

1. **Guard `did-start-navigation` to ignore the HMR reconnect-reload while keeping genuine reloads
   working** — IF the wake-reload can be distinguished in MAIN (e.g. it is a reload to the SAME
   `ELECTRON_RENDERER_URL` not initiated by the user). This is the most surgical and build-agnostic
   option, but only valid if the spurious reload is reliably distinguishable from a deliberate Cmd+R;
   if it is NOT distinguishable, do NOT weaken the handler (a real reload must still `killAll()` to
   avoid orphans) and prefer option 2.
2. **Suppress the reload at the Vite client** — configure `server.hmr` in
   `electron.vite.config.ts` (`renderer`) and/or add a small dev-only client guard so the
   reconnect does a silent HMR reattach instead of a full `location.reload()`. Confirm against the
   installed Vite version's client behavior (`@vite/client` `waitForSuccessfulPing` →
   `location.reload()`); the exact config key may be version-specific — verify with Context7/Vite
   docs for the pinned Vite 7 before implementing.
3. **Dev-only `beforeunload`/navigation guard in the renderer** that cancels an unsolicited
   reconnect reload — only if 1 and 2 are not viable; least preferred (can mask a wanted reload).

Hard constraints for whichever lever is chosen:

- A GENUINE user reload (Cmd+R) MUST still `killAll()` the PTYs in BOTH dev and prod (no orphans) —
  do not break the FR-023 teardown / `session-resume-relaunch` orphan-avoidance.
- The fix must be **dev-only** (gated on `ELECTRON_RENDERER_URL` / dev mode); production
  (`loadFile`) has no HMR client and must be untouched.
- Do NOT pursue (B): do not stop `killAll()` on a genuine reload, and do not add a reload-survival
  reattach mechanism — that is a separate, out-of-scope feature.

### Already-shipped, orthogonal, KEEP

The developer already shipped (uncommitted) a separate, still-valid hardening: manual exit-banner
Restart now `--resume`s the same session id (the `pty:restart` handler in `index.ts` + `paneSpawn`),
instead of minting a fresh `--session-id`. This is CORRECT and should be KEPT — it makes a genuine
process-death recovery context-preserving — but it is ORTHOGONAL to this bug (it does not address the
reload-kills-sessions wake path). Do not undo it.

### Tests the developer should add

- dev-path regression: simulate the Vite reconnect-reload signal and assert it does NOT trigger the
  `did-start-navigation`→`killAll()` teardown of live PTYs (sessions stay live, no respawn). Shape
  the assertion to whichever lever option 1/2/3 is chosen.
- preserve: a GENUINE (user-initiated) reload still `killAll()`s every live PTY (no orphan
  regression) in dev and prod.
- keep the existing manual-Restart-resumes-same-id coverage from the orthogonal hardening green.

## Verification (later)

`npm run typecheck` + `npm test` + the layer-appropriate suite. The decisive manual check:
in `npm run dev`, lock the machine and wake it — the live `claude` session must remain exactly as
it was (no re-run startup banner, no stacking, no `killAll`), i.e. continue without a refresh. Also
confirm a deliberate Cmd+R still tears down + re-mounts cleanly (no orphaned `claude`/MCP children).
