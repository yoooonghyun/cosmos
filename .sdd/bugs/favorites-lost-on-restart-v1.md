# Bug: Home FAVORITES disappear on every app restart

ID: `favorites-lost-on-restart-v1` (round 2 → `-v2`)
Status: Fixed (v2 — the v1 fix was necessary but INSUFFICIENT)
Skill: bugfix
Reported: 2026-06-30

---

## ROUND 2 (v2) — the real root cause the v1 fix missed

The v1 fix (eager `setFavorites` → `saveNow`) made a pin reach disk promptly, but
favorites STILL disappeared on restart. The v1 regression test was inadequate: a
SessionRegistry NODE-UNIT with a `vi.fn()` `save` spy — it proved favorites reach
the spy eagerly but NEVER exercised the real save→validate→load→seed→re-bind
round-trip, so it could not see the actual defect.

### Reproduced FIRST, end-to-end (the round-trip the v1 test lacked)

A disk-equivalent round-trip rendering the REAL `CosmosPanel` under the REAL
`SessionProvider`/`SessionRegistry` (`CosmosFavoriteRestartRoundTrip.dom.test.tsx`)
plus a node round-trip over the real classes confirmed the failure BEFORE any fix:
after a pin + a simulated RESTART (reload the persisted snapshot + re-mount), the
persisted `panels.jira.tabs` is `[]` — the favorite's SOURCE panel is gone from
disk — while `favorites` itself survives.

### ABSENT vs GONE-SOURCE — the empirical finding

**PRESENT-but-gone-source** (save-side, the source PANEL is wiped — NOT the favorite
reference). At the persistence layer the favorite `{panelId,tabId,label}` round-trips
fine; it is the source generative panel that is overwritten with an empty default, so
the next load hydrates the source empty and the favorite re-binds to nothing → the
calm "no longer open" state. (A SECOND, dev-only path produces the literal "absent,
as if never pinned" — see below.)

### Root cause (runtime/ordering — invisible to static reading; candidate (1) + (3))

On a fresh relaunch the `SessionRegistry` is constructed with EMPTY contributions
(`SessionProvider` `useMemo`). `CosmosPanel` is mounted BEFORE the generative panels
in the rail (`App.tsx` `TabsContent` order: terminal, **cosmos**, slack, jira,
confluence, google-calendar), so its EAGER favorites save (the mount effect at
`CosmosPanel.tsx`, `setFavorites` → `saveNow`) fires BEFORE jira/slack/confluence/
calendar have re-reported. `assembleSnapshot` (`sessionRegistry.ts`) fills every
un-reported panel with `emptyGenerative()`, so the eager save persists
`{ favorites, EMPTY jira/slack/confluence/google-calendar }` — wiping each favorite's
SOURCE panel from disk. The 600ms debounced panel reports heal disk only if the app
survives the window; a dev HMR / quick relaunch inside it makes the corruption stick.

`enabled` was ALREADY immune because `useEnabledIntegrations` seeds it into the
registry on mount (`SessionProvider.tsx`, comment: "so a save triggered by another
panel before the user toggles anything preserves the restored enabled state") — the
panels + favorites simply never got that same seed.

DEV-vs-PROD call:
- **Production (clean quit → relaunch):** real but self-healing — the eager mount
  save wipes the panels, the debounced reports re-persist them ~600ms later; a quit
  within that window leaves a gone-source favorite next launch.
- **Dev (`npm run dev`):** reliably broken — a Vite full reload hits the same
  gone-source window; AND a PARTIAL React Fast-Refresh REMOUNT of `CosmosPanel` (the
  registry instance survives, the `useState` initializer re-reads the STALE app-start
  snapshot via `useRestoredFavorites`, which lacks a favorite pinned during the
  session) resets `tabsState` to none and the eager favorites effect persists `[]` →
  the favorite is genuinely WIPED from disk = "absent, as if never pinned". (v1
  dismissed this as an out-of-scope Fast-Refresh artifact; v2 closes it.)

### Fix (minimal, root-cause)

1. `SessionRegistry.seed(snapshot)` — populate the generative-panel contributions +
   `enabled` + `openPromptPosition` + `favorites` from the restored snapshot at mount
   (called once in `SessionProvider`'s registry `useMemo`). Now any early/eager save
   preserves the restored panels REGARDLESS of panel-mount order or debounce timing —
   the same protection the `enabled` seed already provided, extended to the rest.
   Terminal is EXCLUDED: main re-enriches/drops terminal tabs from its live PTY
   session map at the save boundary (`enrichSnapshotForSave`, `index.ts`), and
   terminal reports before Cosmos anyway, so it is never at risk.
2. `SessionRegistry.getFavorites()` + `CosmosPanel` seeds its initial favorite tabs
   from `registry.getFavorites() ?? restoredFavorites ?? []`. On a dev Fast-Refresh
   remount the surviving registry holds the truly-pinned set, so the stale snapshot no
   longer resets favorites to none. A genuine unpin leaves the registry favorites `[]`
   (respected, not protected away).

NOT regressed: `setOpenPromptPosition`/`setEnabled`/panel `report` keep the trailing
debounce; the eager favorites save and terminal sessionId/cwd enrichment are unchanged.

Files: `src/renderer/session/sessionRegistry.ts` (`seed`/`getFavorites`),
`src/renderer/session/SessionProvider.tsx` (seed on construct),
`src/renderer/cosmos/CosmosPanel.tsx` (seed favorites from the live registry).

### Regression test (RED→GREEN at the round-trip layer — SESSION-FAVORITES-RESTART-02)

`src/renderer/cosmos/CosmosFavoriteRestartRoundTrip.dom.test.tsx` (renders the REAL
`CosmosPanel`; disk-equivalent store = JSON serialize/parse + the SHARED
`validateFavorites` the main `validateSnapshot` delegates to; faithful `JiraSource`
hydrates from the restored slice + publishes live + reports to the session registry):
- pin → save → RESTART preserves `panels.jira.tabs` on disk; a 2nd restart re-binds
  the favorite to a POPULATED source. RED pre-fix (`panels.jira.tabs` `[]`; gone-source).
- a keyed Fast-Refresh REMOUNT (SessionProvider stays mounted, snapshot prop stale)
  keeps the favorite in the strip + on disk. RED pre-fix (favorites wiped = absent).
Both confirmed RED with the fix reverted, GREEN after.
Plus node-unit `sessionRegistry.test.ts` locks the `seed`/`getFavorites` contract.

### Verification (v2)

- `npm run typecheck` — green
- `npm test` — 2743 passed
- `npm run test:dom` — 23 files / 118 tests passed
- Manual `npm run dev` (pin → restart → persists + renders live): NOT run here (no
  Electron in this environment) — flagged for a manual pass.

---

## (v1 — historical; the necessary-but-insufficient first fix)

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
