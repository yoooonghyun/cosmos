# Bug Report: terminal-picker-spinner-hang (v1)

- **Status:** Fixed
- **Reported:** 2026-06-20
- **Severity:** broken
- **Regression:** yes — latent since terminal-open-directory-picker-v1 (#75) introduced the `isMountedRef` guard; only manifests under React StrictMode (dev / `npm run dev`).

## Symptom

User: "terminal open 이후 폴더 선택시 spinner 돌면서 동작안함." On a freshly-opened terminal
tab, clicking **[Open a folder]** opens the native picker; after the user selects a folder the
button's **"Opening…"** spinner keeps spinning forever and `claude` never starts.

## Expected vs Actual

- **Expected:** After choosing a folder, the tab goes live and `claude` spawns in that cwd; the
  spinner clears.
- **Actual:** The spinner spins indefinitely; no spawn, no live xterm.

## Reproduction

1. `npm run dev` (StrictMode is enabled — `src/renderer/main.tsx:16`).
2. Open a fresh terminal tab → it shows the [Open a folder] empty state.
3. Click [Open a folder], pick any directory, confirm.
4. Observe: button stuck on "Opening…"; `claude` never starts.

Deterministic in dev. Would NOT reproduce in a production build (no StrictMode double-invoke).

## Scope & Severity

Breaks the entire fresh-terminal flow in dev — every new terminal tab is unusable after a pick.
Renderer-only; one component.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle
- **Reason:** single root cause in one renderer file (`TerminalPanel.tsx`), no contract change.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** developer (applied directly — one-line lifecycle fix)
- **Reason:** a React effect/ref lifecycle bug; logic matches the design, the wiring is wrong.

## Root Cause (Step 3)

- **Origin:** `src/renderer/TerminalPanel.tsx` — `TerminalView` mount `useEffect` cleanup sets
  `isMountedRef.current = false` (~line 199) but the effect body never re-asserts
  `isMountedRef.current = true` on (re)mount.
- **Why:** `isMountedRef` is initialized `true` once at `useRef` creation. React StrictMode (dev)
  runs every effect mount → cleanup → mount. The cleanup flips the ref to `false`; the second mount
  does not reset it, so the ref is stuck `false` for the component's whole life. In `handleOpen`,
  after the picker resolves with a real path:
  `if (res.path && isMountedRef.current) { start(...); setPhase('live') }` is skipped (guard false →
  no spawn, no live), and `finally { if (isMountedRef.current) setPending(false) }` is also skipped
  (guard false → `pending` stays `true`) → the "Opening…" spinner never clears. The OQ-3 guard
  (ignore a selection returned after the tab unmounted) was meant to fire only on a real unmount, but
  StrictMode's simulated unmount made it permanently armed.

## Fix (Step 4)

- **Files changed:** `src/renderer/TerminalPanel.tsx`
- **Summary:** Set `isMountedRef.current = true` at the START of the mount effect, so each (re)mount
  (including StrictMode's dev remount) restores the guard; the cleanup still sets it `false` on a real
  unmount. The OQ-3 "ignore late selection after unmount" behavior is preserved for genuine unmounts.

## Regression Test (Step 5)

- **Test:** none (node/no-jsdom vitest cannot exercise a React effect/ref StrictMode lifecycle; the
  project keeps `.tsx`/DOM lifecycle out of node unit tests by convention). The fix is the standard
  StrictMode-safe `isMounted` reset pattern; correctness is verified by typecheck + the mechanism
  above + user GUI verify in `npm run dev`.
- **Fails-without-fix confirmed:** by reasoning — without the reset the ref is `false` post-StrictMode
  double-invoke, so both guards short-circuit (the exact symptom).

## Verification (Step 6)

- [x] `npm run typecheck` green
- [x] `npm test` green (no test touched; full suite unaffected)
- [ ] Original Step 1 reproduction re-run — symptom gone (USER GUI verify in `npm run dev`)
- [ ] UI surface exercised — pick a folder → claude spawns; cancel → stays [Open] (USER GUI verify)
- [x] No regressions in adjacent behavior — only the guard reset added; spawn/cancel/unmount paths
      unchanged.

## Wrap-up (Step 7)

- **bug memory saved:** terminal-picker-spinner-hang — StrictMode `isMounted` ref must be reset to
  `true` at effect start, not only set `false` in cleanup.
- **Docs updated:** docs/DEVELOPMENT.md (StrictMode isMounted-ref gotcha).
- **wrap-up run:** yes
