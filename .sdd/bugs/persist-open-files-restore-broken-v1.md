# Bug Report: persist-open-files-restore-broken (v1)

- **Status:** Fixed
- **Reported:** 2026-06-21
- **Severity:** broken
- **Regression:** no — first implementation of persist-workdir-open-files-v1 (#96) was
  itself broken end-to-end; the feature never worked across a relaunch. Work is in `main`,
  uncommitted.

## Symptom

After relaunching the app, the per-tab file viewer is EMPTY — none of the previously-open
files / file tabs come back. The persist-workdir-open-files-v1 (#96) first pass added the
snapshot field + reversed the old go-live wipe, but the open-files round-trip is broken in dev.

## Expected vs Actual

- **Expected:** a terminal tab that had files open before quit re-opens with the same file
  tab strip (and active file) on relaunch; contents are re-read from disk (FR-004/FR-005).
- **Actual:** the strip is empty (the "Select a file" placeholder shows); no restored files.

## Reproduction

Running under `npm run dev` (React StrictMode ON — confirmed `src/renderer/main.tsx:16`):

1. Open a folder in a terminal tab, open one or more files in the file viewer.
2. Quit and relaunch the app.
3. Observe: the file strip is empty — the restored files do not appear.

The pure persistence units (`buildTerminalDraft`, `hydrateTerminalTabs`, `validateOpenFiles`,
`seedOpenFiles`) all round-trip openFiles correctly and were already green — so the break is
NOT in the snapshot save/load/validate path. It is in the live React seeding wiring, exposed by
StrictMode's dev double-mount.

## Scope & Severity

One renderer hook (`useFileExplorer`), one feature (open-files restore). Broken, not a crash.
Dev-mode specific (StrictMode double-invoke); production single-mount would seed once correctly,
but the dev path is the one the user runs, and the fix also hardens any future effect re-run.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in one renderer file; no contract / layer change. The new pure
  helper + test stay within the existing `.ts`/`.test.ts` split.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** developer
- **Reason:** an effect-lifecycle / StrictMode-idempotence mistake in the seeding code, not a
  design or contract gap. The schema, IPC, save boundary, and pure helpers are all correct.

## Root Cause (Step 3)

The go-live SEED in `useFileExplorer` consumed (nulled) the restored-slice ref **inside the
effect body** on the first invoke, so React StrictMode's dev double-mount seeded EMPTY on the
SECOND (real) invoke — wiping the restored files.

- **Origin:** `src/renderer/fileExplorer/useFileExplorer.ts:185` (pre-fix) —
  `restoredOpenFilesRef.current = undefined` ran in the go-live effect body, immediately after
  reading the slice, "to seed only on the FIRST go-live."
- **Why:** React StrictMode (dev) runs an effect as **body → cleanup → body**, synchronously,
  on mount. A `useRef` persists across that remount. So:
  - Run 1 (discarded): reads the restored slice, sets the ref to `undefined`,
    `setOpenFiles(seeded)`.
  - Cleanup runs.
  - Run 2 (the real one): reads the ref — now `undefined` — and seeds `EMPTY_OPEN_FILES`,
    calling `setOpenFiles(EMPTY_OPEN_FILES)`.
  The committed state after Run 2 is the empty strip. (Moving the consume into the effect
  CLEANUP does NOT help — the cleanup also runs between the two body invokes.) Contrast the
  scrollback restore, which works precisely because its source ref
  (`TerminalPanel.tsx:471 restoredScrollbackRef`) is NEVER nulled — both StrictMode mounts
  re-write the same scrollback harmlessly.

Note on the empty on-disk snapshot: `<userData>/cosmos/session.json` showed
`panels.terminal = { tabs: [], activeTabId: null, everOpened: 1 }`. That is the EXPECTED clean
fingerprint of a fresh, never-started default terminal tab (it defers its PTY to the [Open]
picker, so `terminalSessionMap` is empty and `enrichSnapshotForSave` drops the unresumable tab —
`src/main/index.ts:417-425`). It is the relaunch's own re-save, not evidence of a save-side
open-files bug. The terminal-tab persistence (session-persistence-v1) is unaffected; this bug is
specifically the open-files SEED hop on restore.

## Fix (Step 4)

Make the go-live seed StrictMode-idempotent: the restored slice is read on every go-live and
seeded via a new pure helper, and is consumed (cleared) ONLY on a genuine `enabled` true→false
transition (a real re-root / disable), tracked by `wasEnabledRef` — never inside a go-live run
or its cleanup. A StrictMode double-mount keeps `enabled` true throughout, so it re-seeds the
SAME slice idempotently; a real re-enter of the live phase still starts empty (no stale paths).

- **Files changed:**
  - `src/renderer/fileExplorer/openFiles.ts` — new pure `seedOnGoLive(restored)` (returns the
    seeded `OpenFilesState`, or `EMPTY_OPEN_FILES` when no slice). Decouples the seed decision
    from the ref-nulling so it is node-testable and never wipes on a benign re-run.
  - `src/renderer/fileExplorer/useFileExplorer.ts` — stop nulling `restoredOpenFilesRef` in the
    effect body; seed via `seedOnGoLive`; add `wasEnabledRef` and consume the slice only on a
    real `enabled` true→false transition; cleanup no longer touches the ref.
- **Summary:** the restored slice survives the StrictMode dev remount, so the strip seeds from
  it on relaunch.

## Regression Test (Step 5)

- **Test:** `src/renderer/fileExplorer/openFiles.test.ts` — new describe
  `seedOnGoLive — StrictMode-safe go-live seeding (bug persist-open-files-restore-broken-v1)`.
- **Asserts:**
  - a StrictMode double-mount (goLive → [cleanup, no real disable] → goLive) re-seeds the SAME
    restored slice both times, NOT empty;
  - a GENUINE re-root (goLive → disable → goLive) starts empty the second time (no stale paths);
  - no restored slice → seeds empty (FR-010).
- **Fails-without-fix confirmed:** the old code nulled the ref in the effect body, i.e. the
  faithful model would clear `pending` inside `goLive()`, so the second `goLive()` returns
  `EMPTY_OPEN_FILES` and the first assertion (`second.files == ['a.ts','src/b.ts']`) fails.
  The fixed model (consume only on real disable) makes both go-live runs return the slice.

## Verification (Step 6)

- [x] `npm run typecheck` green
- [x] `npm test` green (1911 passed, incl. the new regression test)
- [ ] Original Step 1 reproduction re-run — symptom gone: NOT yet exercised live. This is a
  restore-on-relaunch path that needs TWO app launches under `npm run dev`; still owed. The fix
  is proven via the round-trip unit test + the StrictMode-sequence reasoning above.
- [ ] UI surface exercised — owed (two-launch manual smoke).
- [x] No regressions in adjacent behavior — full suite green; change is confined to the seed
  helper + one hook effect.

## Wrap-up (Step 7)

- **bug memory saved:** see memory_save below.
- **Docs updated:** none required (no convention change; the StrictMode-idempotent-seed gotcha
  is already a documented pattern class in the codebase — `seedTerminalIndex`, the
  `isMountedRef` reset). Consider a one-line `docs/DEVELOPMENT.md` note if it recurs.
- **wrap-up run:** pending (developer pass only).
