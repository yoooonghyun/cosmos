# Bug Report: <bug> (v<N>)

- **Status:** Open <!-- Open | Investigating | Routed | Fixed | Escalated-to-sdd -->
- **Reported:** <YYYY-MM-DD>
- **Severity:** <crash | broken | degraded | cosmetic>
- **Regression:** <yes — broke at <commit/since> | no | unknown>

## Symptom

<What the user observes, in their words. Which surface/panel/flow, and what is wrong.>

## Expected vs Actual

- **Expected:** <what should happen>
- **Actual:** <what does happen>

## Reproduction

Minimal, deterministic steps:

1. <step>
2. <step>
3. <observe>

<If not reproducible: say so, and state what you assume / what more is needed.>

## Scope & Severity

<How many surfaces/users it touches; crash vs cosmetic; regression or not.>

## Scope gate (Step 1.5)

- **Decision:** <continue bug cycle | escalate to `sdd`>
- **Reason:** <one line — e.g. "single root cause in one renderer file" or "needs new IPC
  contract + crosses 3 layers → feature-sized">

<!-- If escalated to sdd, stop here; the rest is owned by the sdd cycle. -->

## Classification & Routing (Step 2)

- **Class:** <Design defect | Implementation defect | Spec/architecture defect>
- **Routed to:** <designer | developer | architect (→ developer)>
- **Reason:** <one line on why this layer owns the defect>

## Root Cause (Step 3)

<The cause, not the symptom. Pinpoint to `file:line` and explain WHY it produces the
symptom — a correct root cause predicts the reproduction.>

- **Origin:** `<path/to/file.ts>:<line>`
- **Why:** <mechanism — how the bad state/value propagates to the symptom>

## Fix (Step 4)

<The minimal change applied at the root cause. No scope creep, no symptom-masking.>

- **Files changed:** <list>
- **Summary:** <what changed and why it fixes the cause>

## Regression Test (Step 5)

<The test that captures this bug and would have FAILED before the fix.>

- **Test:** `<path/to/*.test.ts>`
- **Asserts:** <the corrected behavior>
- **Fails-without-fix confirmed:** <yes — how>

## Verification (Step 6)

- [ ] `npm run typecheck` green
- [ ] `npm test` green (incl. new regression test)
- [ ] Original Step 1 reproduction re-run — symptom gone
- [ ] UI surface exercised (if renderer fix) — golden path + the broken edge case
- [ ] No regressions in adjacent behavior (codegraph_impact checked)

## Wrap-up (Step 7)

- **bug memory saved:** <memory_save id / summary>
- **Docs updated:** <docs/ARCHITECTURE.md / CLAUDE.md — or none>
- **wrap-up run:** <yes>
