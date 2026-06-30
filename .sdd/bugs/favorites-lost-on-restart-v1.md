# Bug: Home FAVORITES disappear on every app restart

ID: `favorites-lost-on-restart-v1`
Status: Fixed
Skill: bugfix
Reported: 2026-06-30

## Symptom

A user pins a Home (Cosmos) favorite, then the app restarts — in practice every
time a source file is modified during `npm run dev` (Vite HMR / reload) — and the
pinned favorite is GONE. Not "source no longer open" (the graceful-degrade WAITING
state), but absent entirely from the Home tab strip, as if it was never pinned.

## Classification: DEV-HMR-dominant + a narrow real production window

- **Dev HMR: reliably broken.** This is what the user hits "on every restart".
- **Production (clean quit -> relaunch): mostly OK, with a narrow real window.** In
  normal use the user pins and leaves the app open > 600ms; the debounce fires, the
  favorite reaches disk, and a clean relaunch (which re-runs `useLoadSession` and
  reads disk) restores it. The genuine production defect is the narrow case of
  pin-then-quit within 600ms, which relied on the teardown `flush()` whose
  fire-and-forget `ipcRenderer.send` may not be drained before teardown.

The persistence WIRING is correct end-to-end (save assembles favorites, validate
carries them, atomic disk write; restore reads `snapshot.favorites` and seeds the
tab state). This was NOT a missing-wiring bug — it was a save-TIMING / lifecycle bug.

## Root cause

The favorites save went through the SHARED trailing debounce, which a dev
reload routinely pre-empts. Three compounding facts:

1. **Favorites saved on the shared 600ms debounce.**
   `SessionRegistry.setFavorites` (`src/renderer/session/sessionRegistry.ts`)
   called `this.schedule()` — the SINGLE `SAVE_DEBOUNCE_MS = 600` timer
   (`sessionRegistry.ts:176-184`) shared by every contribution. `schedule()`
   clears + restarts the one `this.timer`, so ANY other panel `report()` /
   `setX` within 600ms keeps pushing the favorites save out; an actively-changing
   session can perpetually defer the trailing save so only `flush()` ever persists.

2. **The save is fire-and-forget AND the teardown flush is reload-fragile.**
   `window.cosmos.session.save` = `ipcRenderer.send(SessionChannel.Save, …)`
   (`src/preload/index.ts:415-419`) — async, fire-and-forget. `SessionProvider`
   flushes on `pagehide` / `beforeunload` (`SessionProvider.tsx:53-61`), but a Vite
   HMR PARTIAL update hot-swaps modules in place and fires NEITHER event, so `flush()`
   never runs and the pending favorite never lands. (A FULL page reload does fire the
   events and the already-enqueued `send` does reach the persistent main process — so
   a full reload was more reliable than a partial HMR, but both raced the 600ms debounce.)

3. **Restore re-seeds from the app-start snapshot.** `CosmosPanel`'s `useState` lazy
   initializer (`CosmosPanel.tsx:115-119`) seeds favorites from `useRestoredFavorites()`
   = `snapshot.favorites`, where `snapshot` is loaded ONCE by `useLoadSession` at app
   start (`SessionProvider.tsx:202-221`) and never re-read. So a favorite that never
   reached disk before the reload is absent from the snapshot the next mount reads
   -> it vanishes.

Net: pin a favorite, modify a file within 600ms -> partial HMR fires no teardown
hook and the debounce hasn't fired -> the favorite never reaches disk -> the next
mount seeds from a snapshot without it -> gone.

## Fix (minimal, root-cause): eager favorites persistence

`SessionRegistry.setFavorites` now records the list then calls a shared private
`saveNow()` (cancel the pending timer + save the current snapshot IMMEDIATELY — the
same body `flush()` now delegates to). A pin/unpin reaches disk on the spot instead
of waiting on a debounce a reload can pre-empt, so a full reload / relaunch (which
re-runs `useLoadSession`) restores them. Pin/unpin/relabel are rare + user-driven,
so the extra writes are negligible; the eager save also flushes any OTHER pending
contributions, which is strictly safe (persists current state early, exactly like
the teardown flush already does).

NOT regressed: `setOpenPromptPosition` / `setEnabled` / panel `report()` keep the
trailing 600ms debounce (`openPromptPosition` intentionally debounces a drag storm).

File: `src/renderer/session/sessionRegistry.ts` (`setFavorites` -> `saveNow()`;
`flush()` delegates to the shared `saveNow()`).

### Known residual (dev-only, out of scope)

A pure renderer-only Fast-Refresh that REMOUNTS `CosmosPanel` without remounting
`SessionProvider` re-runs the `useState` initializer against the still-in-memory
app-start snapshot, so the disk-persisted favorite would not reflect until a FULL
reload re-runs `useLoadSession`. This is an inherent dev Fast-Refresh artifact (and
React often PRESERVES the component state across such edits anyway); the guarantee
this fix provides — and that the user's repro needs — is at the full reload /
relaunch level, which now works because the favorite is on disk.

## Regression test (RED -> GREEN)

`src/renderer/session/sessionRegistry.test.ts`, new describe
"SessionRegistry — eager favorites persistence (favorites-lost-on-restart-v1)":

- `setFavorites` calls `save` IMMEDIATELY, WITHOUT running the injected scheduler,
  carrying the favorite. RED pre-fix (was `schedule()`d — 0 calls until `sched.run()`).
- A `report` STORM that perpetually resets the shared debounce still lands the
  favorite eagerly (and carries the other pending contributions). RED pre-fix.
- `setOpenPromptPosition` STILL does not save until the scheduler fires — proves the
  eager path is favorites-specific (no debounce regression).

Confirmed RED before fix (reverting `setFavorites` to `schedule()` -> the two eager
tests FAIL, the no-regression test PASSES), GREEN after.

TEST-SCENARIOS row: `SESSION-FAVORITES-EAGER-01`.

## Verification

- `npm run typecheck` — green
- `npm test` (vitest node) — 143 files / 2724 tests pass
- `npm run test:dom` — 22 files / 112 tests pass
- Manual `npm run dev` check (pin a favorite -> restart -> persists): NOT run in
  this environment (no Electron run here) — flagged for a manual pass.
