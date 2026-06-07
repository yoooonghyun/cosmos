# Bug Report: terminal-tab-index-skip (v1)

- **Status:** Fixed
- **Reported:** 2026-06-07
- **Severity:** cosmetic (wrong tab label numbering; no functional/data impact)
- **Regression:** no — present since panel-tabs v1; only manifests under React StrictMode (dev)

## Symptom

In the Terminal panel, the first tab is "Terminal 1" but clicking `+` to open a second tab
labels it **"Terminal 3"** instead of "Terminal 2" — the index skips 2.

## Expected vs Actual

- **Expected:** seed tab "Terminal 1", next `+` tab "Terminal 2", then "Terminal 3", …
- **Actual:** seed "Terminal 1", first `+` tab "Terminal 3" (index 2 is silently consumed).

## Reproduction

1. `npm run dev` (StrictMode is enabled — `src/renderer/main.tsx:16`).
2. Open the Terminal surface. The seed tab reads "Terminal 1".
3. Click `+`.
4. **Bug:** the new tab reads "Terminal 3", not "Terminal 2".

## Scope & Severity

Single renderer file (`src/renderer/TerminalPanel.tsx`); the pure helpers it calls
(`nextTerminalIndex`/`terminalLabel` in `panelTabs.ts`) are correct. Cosmetic. Note this is a
**dev-only** manifestation (StrictMode double-invoke); a production build would not skip — but
the underlying impurity is a real defect to fix regardless.

## Scope gate (Step 1.5)

- **Decision:** continue the bug cycle
- **Reason:** One renderer file, an impurity fix at a known root cause. No new IPC/contract/MCP,
  no net-new behavior. Small.

## Classification & Routing (Step 2)

- **Class:** Implementation defect
- **Routed to:** `developer`
- **Reason:** A render-phase side effect (impure `useState` lazy initializer mutates a ref) is
  double-invoked by StrictMode, advancing the monotonic terminal counter twice for one tab.
  Wrong logic, not a visual/design issue.

## Root Cause (Step 3)

> Confirmed by the orchestrator's triage; the developer re-verifies and records final `file:line`.

**The user's hypothesis (a hidden "background gen-UI terminal" consuming an index) is NOT the
cause — there is no background terminal.** The Generated UI surface is drawn by a headless
`AgentRunner` (`src/main/agentRunner.ts`), not a PTY; only `TerminalView` issues `pty:start`,
one per visible Terminal tab. So no extra pane consumes an index.

Actual cause — an **impure `useState` lazy initializer**:
- `src/renderer/TerminalPanel.tsx:210-219` — `mintTab()` advances a ref:
  `const index = nextTerminalIndex(everOpened.current); everOpened.current = index`, and it is
  called **inside** the `useState(() => { const first = mintTab(); … })` lazy initializer.
- React **StrictMode** (`src/renderer/main.tsx:16`) intentionally double-invokes state
  initializers in dev to surface impurity. The initializer runs twice:
  - call #1: `everOpened` 0→1, seed labelled "Terminal 1" (this result is KEPT),
  - call #2: `everOpened` 1→2 (this result is DISCARDED, but the **ref mutation persists**).
- After mount the panel shows "Terminal 1" while `everOpened.current === 2`. The next `+` →
  `nextTerminalIndex(2)` = 3 → "Terminal 3". This exactly predicts the reported symptom.

The defect is the **ref mutation during render** (a non-idempotent side effect in the
initializer), not the pure index helpers.

## Fix (Step 4) — DONE

Made the seed pure; the render-phase `useState` initializer no longer mutates the monotonic
counter.

- Added a pure helper `seedTerminalIndex(): number` → `1` in
  `src/renderer/panelTabs.ts:268` (sits beside `nextTerminalIndex`/`terminalLabel`; documents
  the StrictMode hazard).
- `src/renderer/TerminalPanel.tsx`:
  - Root cause was at `TerminalPanel.tsx:209-219` — `everOpened` started at `0` and the seed
    called the impure `mintTab()` (read + advanced the ref) INSIDE `useState(() => …)`.
  - Fix: initialize the counter AT the seed index — `const everOpened = useRef(seedTerminalIndex())`
    (`TerminalPanel.tsx:216`) — and make the lazy initializer PURE: build the seed tab with
    `label: terminalLabel(seedTerminalIndex())` and NO `mintTab()` call
    (`TerminalPanel.tsx:220-226`). `mintTab()` still advances the ref but now runs ONLY from
    `handleNewTab` and the `tabs.length === 0` empty-refill effect, neither of which StrictMode
    double-invokes for this purpose.

The pure helpers `nextTerminalIndex`/`terminalLabel` were untouched (they were correct).
Monotonic close/reopen numbering is preserved (still climbs; no renumber).

## Regression Test (Step 5) — DONE

Added to `src/renderer/panelTabs.test.ts` (node env, no DOM; does NOT import the `.tsx`) a new
`describe('terminal panel seeding is StrictMode-idempotent (terminal-tab-index-skip-v1)')`
block (`panelTabs.test.ts:268-330`). It mirrors the panel's counter discipline with plain
helpers — a `Counter` cell (the `everOpened` ref), `mintLabel` (mirrors `mintTab`: advances +
labels), and `seed` (mirrors the FIXED pure seed: counter starts at `seedTerminalIndex()`,
label derived directly, no advance). Key assertions:

- Seed reads "Terminal 1" and leaves the counter at 1.
- Double-evaluating the seed (StrictMode) does NOT double-advance — `second.counter.value === 1`
  and the first `+` mints "Terminal 2", not "Terminal 3".
- After the seed, minting two more tabs yields "Terminal 2" then "Terminal 3".

Verified the test genuinely fails the old logic: a scratch test modeling the OLD impure seed
(counter starts at 0, seed calls `mintLabel`) double-advances to `2`, so its first `+` is
"Terminal 3" — the idempotence assertions above would fail against it. Passes with the fix.

## Verification (Step 6)

- [x] `npm run typecheck` green
- [x] `npm test` green (incl. new regression test) — 31 files, 649 tests passed
- [ ] Reproduction re-run in `npm run dev` — seed "Terminal 1", `+` → "Terminal 2", "Terminal 3"
      (not exercised by the developer — a live StrictMode dev launch; logic verified by the
      idempotence regression test instead)
- [x] No regressions in adjacent behavior (close/reopen monotonic numbering still holds —
      pure helpers untouched; full suite green)

## Wrap-up (Step 7)

- **bug memory saved:** yes — `bug` memory (symptom + the impure-initializer root cause + the
  pure-seed fix + the general StrictMode lesson)
- **Docs updated:** CLAUDE.md (StrictMode impure-initializer gotcha) — see wrap-up
