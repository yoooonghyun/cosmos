# Bug Report: restart-pty-cwd (v1)

- **Status:** Fixed
- **Reported:** 2026-06-22
- **Severity:** broken
- **Regression:** yes — surfaced once terminal tabs began persisting + resuming a per-tab
  `cwd` (session-persistence-v1 D2/FR-019, the persisted-cwd-resume path). No guard was ever
  added that the persisted cwd still exists on the next launch.

## Symptom

After restarting the app (restoring a persisted session), a restored terminal tab breaks two
ways at once:
1. Claude pane shows `claude exited (exit code 0, signal 1)` (signal 1 = SIGHUP) with a
   "Restart claude" button.
2. Folder tree shows "Couldn't read this folder. This folder is outside the allowed root."

Both appear ONLY on restart (restoring a persisted session), never for a freshly-opened tab.

## Expected vs Actual

- **Expected:** a restored tab resumes `claude` in a valid working directory; its file explorer
  lists that directory.
- **Actual:** `claude` dies immediately (SIGHUP / exit 0) and the file tree denies every read as
  out-of-root.

## Reproduction

Deterministic (logic-level, via the regression test): seed the resume map with a persisted cwd
that no longer exists, then resolve the pane's spawn.

1. Open a terminal tab in some directory `D` (native picker) and let the session persist.
2. Quit the app; delete/rename/move `D` (or move the whole repo).
3. Relaunch — the restored tab resumes `claude --resume <id>` in `D`.
4. Observe: `claude` exits SIGHUP/0 and the folder tree says "outside the allowed root."

Cannot exercise the live Electron restart in this environment (no GUI / no node-pty spawn);
verified at the pure-resolver level instead — see Regression Test.

## Scope & Severity

Any restored tab whose persisted cwd is gone on next launch (deleted/renamed/moved repo). Both a
dead Claude pane and a dead file explorer for that tab → "broken", not cosmetic. Single root
cause feeding both symptoms.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in one pure main-side function (`resolvePaneSpawn`) plus its one
  call site; no new IPC contract, no new behavior — additive optional param.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** developer
- **Reason:** the cwd-resolution chokepoint omits an existence check; main-process logic only.

## Root Cause (Step 3)

The restore path records and spawns into the persisted cwd WITHOUT verifying it still exists.

- **Origin:** `src/main/paneSpawn.ts:54-55` (pre-fix) — the resume branch of `resolvePaneSpawn`
  returned `cwd: resume.cwd` and wrote that same cwd into `sessionMap` unconditionally.
- **Why (one cause, two symptoms):**
  - `session:load` (`src/main/index.ts:906-907`) seeds `terminalResumeMap` from each persisted
    tab's `{sessionId, cwd}`.
  - On the tab's first `pty:start`, `resolvePaneSpawn` (resume branch) returns the persisted cwd
    and records it into `terminalSessionMap`.
  - `PtyManager.start` (`src/main/ptyManager.ts:217-223`) passes that cwd straight to
    `pty.spawn`. node-pty spawning into a non-existent dir does not throw on this platform — the
    child dies immediately with SIGHUP / exit 0 → **symptom 1**.
  - The SAME recorded cwd is the file-explorer root: `paneRoot` (`src/main/index.ts:314-316`) →
    `fsExplorer.rootOf`/`confine` (`src/main/fsExplorer.ts:106-119`). `confine` calls
    `realpath` on the missing root, which returns `null` → every `list`/`read` returns
    `out-of-root` → **symptom 2**.

## Fix (Step 4)

Guard the stale resume cwd at the single resolution chokepoint — the only place that resolves
the cwd that BOTH the PTY spawn and the file-explorer root consume.

- **Files changed:**
  - `src/main/paneSpawn.ts` — `resolvePaneSpawn` gains an injected
    `dirExists: (absDir) => boolean` predicate (defaults to always-true, so existing
    callers/tests are unaffected). The resume branch now resolves
    `cwd = dirExists(resume.cwd) ? resume.cwd : sandboxDir`, records the corrected cwd into
    `sessionMap`, and keeps the still-valid `--resume <id>`.
  - `src/main/index.ts` — `paneSpawnFor` passes a real-fs `dirExistsOnDisk` (a total
    `statSync(absDir).isDirectory()`, false on any error); imports `statSync`.
- **Summary:** a restored tab whose persisted directory vanished now resumes in the sandbox dir
  (a directory that exists) instead of a dead one. Because the corrected cwd is recorded, the
  PTY spawns successfully AND `paneRoot` returns a real directory, so the file explorer reads
  correctly — both symptoms fixed by one change. A still-present cwd resumes unchanged.

## Regression Test (Step 5)

- **Test:** `src/main/paneSpawn.test.ts` — "resumes in the sandbox cwd when the persisted cwd no
  longer exists (stale-cwd guard)" (plus a companion asserting an existing cwd is kept).
- **Asserts:** with `dirExists` reporting the persisted cwd gone, the resolver returns
  `{ args: ['--resume', 'sess-old'], resume: true, cwd: SANDBOX }` and records
  `{ sessionId: 'sess-old', cwd: SANDBOX }` in the session map (so the explorer root is valid).
- **Fails-without-fix confirmed:** yes — temporarily reverting the resume cwd to
  `resume.cwd` makes exactly this test fail (6 pass / 1 fail); restoring the fix → 7/7. Node env,
  no jsdom.

## Verification (Step 6)

- [x] `npm run typecheck` green (node + web)
- [x] `npx vitest run` green — 1974 passed / 0 failed (incl. the 2 new tests)
- [ ] Original Step 1 reproduction re-run — NOT exercised: live Electron restart + node-pty spawn
  unavailable in this environment. Verified at the pure-resolver level instead.
- [x] No regressions in adjacent behavior — `codegraph_callers resolvePaneSpawn` shows one caller
  (`paneSpawnFor`), updated; new param is optional + defaulted (backward-compatible).

## Wrap-up (Step 7)

- **bug memory saved:** see memory_save below
- **Docs updated:** none required (no convention/contract change; additive optional param)
- **wrap-up run:** no (owned by orchestrator)

---

# Bug Report: restart-pty-cwd (v2) — REOPENED, runtime-confirmed regression

- **Status:** Fixed (v2)
- **Reported:** 2026-06-22 (reopened after v1 fix did NOT resolve at runtime)
- **Severity:** broken

## Why v1 did not fix it (wrong layer)

The v1 stale-cwd guard in `paneSpawn.ts` only triggers when the persisted cwd no
longer exists. The user's cwd is a valid, existing directory, so that guard never
fires — both symptoms remained after restart/reload. The real cause is in the PTY
exit path, not cwd resolution.

## Root Cause (confirmed — `src/main/ptyManager.ts`)

`PtyManager.start` registers `proc.onExit` (lines ~238-258). `kill(paneId)` (~322)
and `killAll()` (~340) call node-pty's `proc.kill()`, whose DEFAULT signal is
**SIGHUP (signal 1)**. They detached the session from the map but did NOT stop the
captured `onExit` handler from running. The map-delete guard
(`this.sessions.get(paneId) === session`) only suppresses the post-restart-stale
case; for an intentional kill the closure still reached `this.sinks.onExit(...)`
and emitted `{ signal: 1 }`. The doc comments on `kill`/`killAll` CLAIMED no exit
is emitted — that invariant was violated.

On renderer reload, `src/main/index.ts` `did-start-navigation` calls
`ptyManager.killAll()`. The window is NOT destroyed during a reload, so the
`onExit` sink (guarded only by `!window.isDestroyed()`) delivered the `signal 1`
exit to the reloaded renderer. The reloaded renderer restores tabs with the SAME
paneIds, so the stale exit matched a live restored pane → "claude exited (exit
code 0, signal 1)" + Restart (symptom 1). The same sink marks the pane
exited/non-live and stops fs watching, so the file-explorer root resolution
collapses and reads are denied as out-of-root (symptom 2). One bug, both symptoms.

## Fix (Step 4) — minimal, at root cause

`src/main/ptyManager.ts` only. Added a `disposed: boolean` flag to `PtySession`.
`kill()` and `killAll()` set `session.disposed = true` BEFORE `proc.kill()`. The
captured `onExit` handler early-returns when `session.disposed` is true, so an
INTENTIONAL kill never emits to the renderer. The session object is captured in
the closure, so this works even after `kill` removed the map entry. A genuine,
self-driven abnormal exit (claude crashing on its own) leaves `disposed` false and
STILL emits. `restart()` (start→kill) produces a working fresh pane with no
spurious "exited" flash. The resume-failure path is unchanged.

## Regression Test (Step 5)

`src/main/ptyManager.test.ts`. The fake IPty's `kill()` now mirrors real node-pty:
it fires `exitCb({ exitCode: 0, signal: 1 })` (SIGHUP) after marking killed. New
suite "intentional-kill is silent vs real SIGHUP (restart-pty-cwd)" asserts:
`kill()` emits no `onExit` despite the SIGHUP exit; `killAll()` emits nothing for
any pane; a genuine abnormal exit NOT via kill STILL emits
`{ exitCode: 1, signal: 1 }`; `restart()` yields a live fresh pane in the same cwd
with no spurious exit. Fails-without-fix confirmed: removing the
`if (session.disposed) return` guard → 5 fail / 21 pass (the 3 new tests plus the
pre-existing dispose-isolation and killAll-teardown tests, which the improved fake
now exercises against real SIGHUP behavior); with the guard → 26/26.

## Verification (Step 6)

- [x] `npm run typecheck` exit 0 (node + web)
- [x] `npx vitest run` green — 1983 passed / 0 failed
- [ ] Live Electron reload NOT exercised (no GUI / no node-pty spawn here) —
  verified at the logic level via the SIGHUP-firing fake.
- **Files changed:** `src/main/ptyManager.ts`, `src/main/ptyManager.test.ts` only.
  No index.ts / paneSpawn.ts changes needed.

---

# Bug Report: restart-pty-cwd (v3) — remaining half, runtime-confirmed

- **Status:** Fixed (v3)
- **Reported:** 2026-06-22 (after v2 removed the spurious "claude exited", the explorer still
  rooted at the embedded claude's `.omc` instead of the user's previously-picked folder)
- **Severity:** broken

## Symptom (remaining half)

On restart, a restored terminal's file-explorer tree roots at `.omc` (the embedded claude's OMC
state dir inside the SANDBOX) instead of the folder the user had picked for that tab. The
restored cwd is wrong — it shows the sandbox/state dir, not the persisted user-picked cwd.

## Definitive evidence

`~/Library/Application Support/cosmos/session.json` (live snapshot): the default "Terminal" tab
persisted `cwd: "…/cosmos/sandbox"` (the sandbox — whose only contents are the embedded claude's
`.omc`) WITH sandbox-running claude scrollback, while a later-picked tab persisted a real folder
(`…/Workspace/a2tui`). So the chosen folder was lost specifically for a tab that went through a
RESUME cycle — proving the loss happens at the resume hop, not the picker/persist hop.

## Root cause — the EXACT losing hop

`src/main/paneSpawn.ts:73-74` (the v1 stale-cwd guard), resume branch. It computed
`cwd = dirExists(resume.cwd) ? resume.cwd : sandboxDir` and wrote THAT fallback into `sessionMap`
(`terminalSessionMap`). `enrichSnapshotForSave` (`src/main/index.ts:441`) persists from that same
map and `paneRoot` (`index.ts:315-316`) roots the file explorer on it. So a SINGLE
`dirExists(resume.cwd) === false` — which can be transient (folder briefly unmounted / not
stat-able at launch), not only a deleted repo — **permanently overwrote the persisted chosen
folder with `sandboxDir`**. Every later launch then restored the sandbox (→ `.omc`). The v1
guard's fallback was DESTRUCTIVE to persistence.

## Fix (Step 4) — non-destructive guard

`src/main/paneSpawn.ts` only (one chokepoint). Split the SPAWN cwd from the RECORDED cwd in the
resume branch: the spawn still falls back to `sandboxDir` when the folder is gone (so `claude`
does not die), but `sessionMap` now records `resume.cwd` (the user's chosen folder) UNCHANGED.
Persistence + the explorer root therefore keep the chosen folder, so a still-existing (or
reappearing) folder restores its ACTUAL cwd. A genuinely-gone folder spawns in the sandbox this
session but is never erased. No IPC/contract change; `index.ts` / `ptyManager.ts` untouched.

## Regression Test (Step 5)

`src/main/paneSpawn.test.ts`:
- Updated the stale-cwd test → now asserts the SPAWN cwd is the sandbox while the RECORD keeps
  the chosen folder (non-destructive). Fails-without-fix CONFIRMED: reverting the record to the
  fallback `spawnCwd` → 7 pass / 1 fail; with the fix → 8/8.
- Added an explicit persist→session:load→resolvePaneSpawn round-trip (dirExists=true): the
  restored cwd equals the chosen folder, `!== sandbox`, and the record (explorer root) matches.

## Verification (Step 6)

- [x] `npm run typecheck` exit 0 (node + web)
- [x] `npx vitest run` green — 1986 passed / 0 failed
- [ ] Live Electron restart NOT exercised (no GUI / no node-pty spawn here) — verified at the
  pure-resolver level + against the real persisted session.json.
- **Files changed:** `src/main/paneSpawn.ts`, `src/main/paneSpawn.test.ts` only.

---

# Bug Report: restart-pty-cwd — picked folder not persisted (v1 follow-up)

- **Status:** Fixed
- **Reported:** 2026-06-22
- **Severity:** broken — user's picked folder is silently discarded; every restart roots the
  terminal and file-explorer in the internal sandbox dir instead.

## Symptom

User opens a terminal by picking a folder (native directory picker). After an app restart the
terminal's `claude` runs in the sandbox dir (`<userData>/sandbox`) and the file-explorer tree
roots there (showing `.omc`). The picked folder is never saved.

User verbatim: "이미 terminal을 열때 folder를 선택해서 open하는데 그 위치를 저장하고 있다가
해당 상태로 똑같이 열려야지."

Hard evidence: `~/Library/Application Support/cosmos/session.json` (schemaVersion 8) has
`panels.terminal.tabs[0].cwd = "<userData>/sandbox"` — sandbox was persisted as the cwd.

## Root Cause

**File:** `src/main/paneSpawn.ts:76-95` (the resume branch of `resolvePaneSpawn`)

**Hop where the pick is lost:** `resolvePaneSpawn`, line 78. The old comment read
`// Resume path: persisted cwd wins; the chosen-directory override is ignored (OQ-2)`.
When the user picks a folder for a tab whose paneId is still in `resumeMap`, `overrideCwd`
was silently discarded and `resume.cwd` (the stale sandbox value) was recorded and persisted.

**How sandbox got into the resume map in the first place:** at some prior point a tab's
first `pty:start` fired without a cwd and without a resume entry (fresh path, `overrideCwd`
absent), so `cwd = sandboxDir` was recorded. That value was written to session.json. Every
subsequent restart faithfully seeded the resume map with `cwd=sandbox` from the snapshot,
and the resume branch kept restoring it. This created a self-perpetuating loop: the only way
to break it was an explicit pick that overwrote the record — but the old code prevented that.

**Why it could never self-correct:** restored tabs have `autoStart=true` → `phase='live'`
immediately → the `!live` block (the [Open] picker button) is never rendered. The user had
no UI path to re-pick a folder for a restored tab; picks could only happen on brand-new tabs
(fresh paneIds), leaving the corrupted original tab's cwd unchanged forever.

## Fix

**File:** `src/main/paneSpawn.ts` — 5 lines changed in `resolvePaneSpawn` resume branch.

When `overrideCwd` is non-empty, it takes precedence over `resume.cwd` even in the resume
branch. The `--resume <sessionId>` is still issued (session history preserved), but both the
spawn cwd and the `sessionMap` record become the picked folder. `enrichSnapshotForSave` then
writes the pick to session.json on the next debounced save, overwriting the sandbox value.

No-overrideCwd resumes (the normal auto-restart path) keep the persisted cwd unchanged — OQ-2
regression-free.

The stale-cwd guard (v3) is preserved: if the effective cwd (picked or persisted) does not
exist on disk, the SPAWN falls back to sandbox but the RECORD keeps the chosen folder so a
transient miss never permanently downgrades it.

## Regression Test

Added to `src/main/paneSpawn.test.ts`:

- **"resumes WITHOUT an explicit pick: persisted cwd is kept unchanged"** — updated from the
  old OQ-2 test; now passes `undefined` (no override) to confirm the no-pick path is unchanged.
- **"resumes WITH an explicit pick: overrideCwd wins over the stale resume cwd"** — NEW test
  that FAILS without the fix: a resume entry with `cwd=SANDBOX` + `overrideCwd='/Users/me/project'`
  must record and spawn in the picked folder, not the sandbox.

## Verification

- [x] `npm run typecheck` exit 0 (node + web)
- [x] `npx vitest run` green — 1987 passed / 0 failed (1 new test added)
- [ ] Live Electron: cannot exercise directly (no GUI / no node-pty spawn). Manual step: after
  applying this fix the user must pick a folder ONCE for the affected tab — the next save will
  overwrite the corrupted sandbox cwd in session.json with the picked path, and subsequent
  restarts will restore correctly.
- **Files changed:** `src/main/paneSpawn.ts`, `src/main/paneSpawn.test.ts` only.
