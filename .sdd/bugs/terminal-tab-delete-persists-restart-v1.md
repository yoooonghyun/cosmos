# Bug: deleted terminal tab reappears after cosmos restart

- **ID:** terminal-tab-delete-persists-restart-v1
- **Status:** Fixed (regression test TERM-CLOSE-EAGER-SAVE-01, all suites green)
- **Reported:** 2026-07-01
- **Layer:** Implementation defect → `developer`

## Symptom

User deletes a terminal tab (labelled "monitor") in the Terminal panel. After restarting
cosmos, the deleted tab is still there — the deletion did not persist.

## Expected vs actual

- **Expected:** a deleted terminal tab stays gone across an app restart.
- **Actual:** the tab (e.g. "monitor") reappears on the next launch.

## Reproduction (to confirm)

1. Open Terminal panel, create/rename a tab → "monitor".
2. Delete it (strip `X`, tree Delete, or Cmd/Ctrl+W).
3. Fully quit + relaunch cosmos.
4. The "monitor" tab is back.

## Prime suspects (orchestrator triage — developer to confirm root cause)

1. **Snapshot save timing** — on delete, `reportTerminal` re-reports a draft WITHOUT the tab, but
   the debounced/teardown save may not persist the new draft before quit → the on-disk snapshot
   (still containing "monitor") is restored. Check `flush()` on teardown vs debounce race.
2. **Adopt path** (`TerminalPanel.tsx:777` `planReattach` → `open({ id: paneId })`) — if the PTY
   session for the deleted tab SURVIVES the delete (its `TerminalView` unmount cleanup only kills
   when `isClosing(paneId)` is true; a favorite-portal reparent or a missed `closingPaneIdsRef`
   mark would skip the kill), then on restart `listLive()` returns its paneId, `planReattach` finds
   NO hydrated tab for it, and ADOPTS it as a new tab — resurrecting the deleted tab. This matches
   the symptom exactly (tab is back with a live/resumed session).

Note: full app quit runs `killAllSync`, so suspect #2 requires the session to survive the *delete*
itself (not the quit). Verify whether `handleClose` reliably reaches the view unmount + kill for
every close entry point, including when the same pane is mirrored in a Home favorite portal.

## Root cause

**Suspect #1 (save timing) confirmed; suspect #2 (adopt) refuted.**

The deletion is never durably persisted before quit, so the pre-delete snapshot (which still lists
the tab) is what restores. Trace for the reported repro (delete → immediately quit):

1. `handleClose` (`TerminalPanel.tsx:863`) marks the pane closing and calls `close(tabId)`.
2. The tab-change effect (`TerminalPanel.tsx:833`) re-reports the post-delete terminal draft via
   `registry.report('terminal', …)` → `schedule()`, a **600ms trailing-debounced** save
   (`SAVE_DEBOUNCE_MS`, `sessionRegistry.ts:115`). The draft correctly OMITS the deleted tab.
3. The `TerminalView` unmount disposes the PTY (`TerminalPanel.tsx:403`) → `pty:dispose`
   (`index.ts:1236`) → `ptyManager.kill` REMOVES the pane from `listLive` (`ptyManager.ts:502-509`).
   So on relaunch `planReattach` has nothing live to adopt → **suspect #2 cannot resurrect it.**
4. On a prompt quit the 600ms debounce has not fired, so the only path to disk is the teardown
   flush (`SessionProvider.tsx:61-69` → `registry.flush()` → `saveNow()` → `window.cosmos.session.save`).
   That is a **fire-and-forget `ipcMain.on` send** (`index.ts:1343`) fired from `beforeunload`/
   `pagehide` during the quit sequence; main does not await it, so on a prompt quit the last save IPC
   is dropped before the process exits.
5. The last durable snapshot on disk is therefore from BEFORE the delete and still lists the tab →
   it restores → the tab reappears.

This is the SAME failure class already documented + fixed for favorites (favorites-lost-on-restart-v1,
`sessionRegistry.test.ts:120-123`): a change inside the `SAVE_DEBOUNCE_MS` window that the teardown
flush fails to persist never reaches disk. Favorites were fixed by persisting EAGERLY
(`setFavorites`→`saveNow`). The lingering `terminalSessionMap` entry (kept on dispose,
`index.ts:1244`) is a real design constraint but is NOT the trigger — `enrichSnapshotForSave`
(`index.ts:746`) only persists tabs the renderer draft lists, and the post-delete draft omits it.

## Fix

Make a genuine terminal tab CLOSE persist EAGERLY, matching the favorites precedent, so the deletion
save IPC is sent during normal operation (before any quit) rather than riding the debounce + the
unreliable teardown flush. All in `src/renderer/terminal/TerminalPanel.tsx`:

- Import + hold the shared `useSessionRegistry()` coordinator.
- `handleClose` (the single choke point for every genuine close — strip `X`, tree Delete, Ctrl/Cmd+W)
  sets a `pendingCloseFlushRef` flag before `close(tabId)`.
- A new effect declared immediately AFTER the report effect (so it runs SECOND on the close render,
  once the post-close draft is already in the registry's contributions) calls `registry.flush()` when
  the flag is set, then clears it. Only fires on a close, so opens/renames/switches keep their debounce.

After the fix disk is corrected immediately on close; a subsequent prompt quit (and any dropped
teardown-flush IPC) no longer matters, and the killed PTY is not adopted on relaunch → the tab stays
deleted.

## Regression test

_test-engineer — read `docs/TEST-SCENARIOS.md` first, confirm red-before-green, register the scenario._
The behavior to lock: a terminal tab CLOSE triggers an EAGER (non-debounced) `session:save` whose
persisted terminal draft OMITS the closed tab — i.e. the write reaches the save sink WITHOUT advancing
the fake debounce scheduler. A `TerminalPanel` dom test (close a tab, assert `window.cosmos.session.save`
/ the registry save fired immediately with the tab absent) reproduces it; a green node-only
`planReattach` unit test alone does NOT certify this (the resurrection is a save-timing defect, not an
adopt defect). Mirror the favorites eager-save unit style in `sessionRegistry.test.ts`.
