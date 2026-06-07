---
name: bugfix
description: "Use when fixing a reported defect, regression, or unexpected behavior (not a new feature). Runs the bug cycle: triage & reproduce → classify & route to the right agent (designer / developer / architect) → root-cause → fix → regression test → verify → wrap-up."
argument-hint: "<short bug description> (e.g. slack tabs share state)"
---

You are running a **bug-fix cycle** for a reported defect. Unlike the `sdd` skill (which
builds new behavior from a spec), this cycle starts from something that is already built and
**behaving wrong**. The goal is to fix the *root cause* — not the symptom — with a regression
test that proves it, and to route the work to the agent that owns the layer the bug lives in.

Follow each step in order. Do not skip ahead: a fix applied before the cause is understood, or
before the bug is classified, is how symptom-patching and scope creep happen.

> Use `sdd` instead when the request is net-new behavior. Use **this** skill when existing
> behavior is wrong, regressed, crashes, or diverges from what the spec/design intended.

## Artifact

This cycle records its findings in a versioned bug report at:
```
.sdd/bugs/<bug>-v<N>.md
```
Use `./bug_report_template.md` (in this skill directory) as the base. Increment `N` if a
report for this bug already exists. The report is the paper trail: symptom, reproduction,
classification + routing decision, root cause (with `file:line`), the fix, and the regression
test. Keep it updated as the cycle progresses — it is the living record, like the sdd plan.

## Step 0 — Recall & Survey (always run first)

Prime context from the two code-intelligence systems before touching anything:

- **agentmemory (canonical memory).** Call `memory_recall` / `memory_smart_search` with the
  bug's keywords AND the symptom. Past bugs are saved here as `bug` memories — a recurring or
  previously-"fixed" defect, a known gotcha, or a prior decision that explains the behavior is
  often already recorded. This can short-circuit the whole investigation.
- **codegraph (code structure).** Run `codegraph_explore` on the symbols/area named in the
  report to see the current structure before forming a hypothesis. If it reports no project
  loaded, run `codegraph init .` once.

As with sdd, this primes the *orchestrator's* triage judgement. It does **not** replace the
routed agent's own grounding — the `developer`/`designer`/`architect` each re-investigate with
these same tools when they own the analysis. Delegate the *investigation*, not just the edit.

## Step 1 — Triage & Reproduce (이슈 분석)

Understand the defect concretely before classifying it. Establish:
- **Symptom** — what the user observes, in their words, and where (which surface/panel/flow).
- **Expected vs actual** — what *should* happen vs what *does*. If "expected" is ambiguous,
  this may itself be a spec defect (see Step 2) — note it, don't guess.
- **Reproduction** — the minimal, deterministic steps to trigger it. If you cannot reproduce
  it, say so and gather more detail rather than fixing blind.
- **Scope & severity** — how many surfaces/users it touches; crash vs cosmetic; is it a
  **regression** (worked before) — if so, `git log`/`git blame` the suspect area to find when
  it changed.

Create the bug report (`.sdd/bugs/<bug>-v<N>.md`) and fill in Symptom + Reproduction. Do not
proceed until the bug is reproducible (or you have explicitly stated why it isn't and what
you'll assume).

## Step 1.5 — Scope gate (수정범위 판단 → sdd로 분기)

Once the defect is understood (Step 1), judge **how big the fix is** before classifying it.
This gate decides whether the lightweight bug cycle is the right tool at all.

**Escalate to the `sdd` skill instead of continuing this cycle when the fix is large** — i.e.
any of:
- it touches **many files or crosses several layers** (renderer + main + IPC + MCP), or
- it requires a **new or changed contract** (a new IPC channel/type, a new MCP tool, a schema
  or `UiRenderTarget` change), or
- the "fix" is really **net-new behavior** or a redesign — the bug exposed a missing feature,
  not a wrong line, or
- correcting it means **re-specifying intended behavior** broadly rather than patching one
  root cause.

When the gate trips, record in the bug report that the fix exceeds bug-cycle scope and **stop
the bugfix cycle**; run the **`sdd`** skill (specify → plan → [design] → interface → test →
implement → wrap-up) with the bug report as input context, since the work is now feature-sized
and needs a spec/plan, not a spot fix.

Otherwise — a contained fix at a known root cause in one layer — **continue to Step 2**. When
in doubt, prefer the bug cycle for genuinely small fixes and `sdd` for anything that smells
like a feature; a single-line spec/architecture correction still stays here and routes to the
`architect` in Step 2 (that is a small fix, not large scope).

## Step 2 — Classify & Route (적절한 agent에 routing)

Decide which **layer** the defect lives in — this picks the owning agent. Record the
classification and the one-line reason in the bug report.

| If the defect is…                                                                                 | Class                      | Route to    |
|---------------------------------------------------------------------------------------------------|----------------------------|-------------|
| Wrong visuals/layout/spacing/typography, a missing or wrong **state** (loading/empty/error/disabled), inconsistency with the design system, raw hex / one-off CSS, a11y/contrast/focus/keyboard issue — but the underlying logic matches the design | **Design defect**          | `designer`  |
| Code does **not** do what the spec/design says: wrong logic, broken/shared state wiring, race condition, off-by-one, crash, bad data, perf, incorrect IPC/validation behavior | **Implementation defect**  | `developer` |
| The **intended behavior itself** is wrong, missing, contradictory, or underspecified — fixing it requires changing the contract (spec/architecture), not just the code | **Spec/architecture defect** | `architect` (then `developer` to implement) |

Routing rules:
- **Delegate to the owning agent via the Agent tool.** Hand it the bug report path and the
  reproduction; instruct it to ground itself with codegraph + agentmemory (do not pre-paste
  your findings as a substitute for its own investigation) and to own Steps 3–4 for its layer.
- **Design defects still need code.** The `designer` has no Bash and writes no feature code:
  it revises the design (tokens / `components/ui/` / the design spec), then hands the build to
  the `developer`. A design fix is a `designer` → `developer` handoff, not designer-only.
- **Spec defects loop back.** If the bug is that the behavior was specified wrong, the
  `architect` corrects the spec/`docs/ARCHITECTURE.md` first, then the `developer` implements
  the corrected contract. Do not let the developer silently redefine intended behavior.
- **When a fix reveals a different class, re-route.** A defect first read as "implementation"
  may turn out to be a design or spec gap (or vice-versa). Escalate rather than forcing the
  fix into the wrong layer — exactly as the `developer` escalates scope to the `architect`.
- **Mixed bugs:** pick the primary layer, fix it there, and spin the secondary part to its
  owner rather than one agent reaching across layers.

## Step 3 — Root-cause analysis (상세 분석)

> Owned by the agent routed in Step 2.

Find the **cause**, not the symptom. Using codegraph (`codegraph_explore` to read the
implicated symbols; `codegraph_callers`/`codegraph_callees`/`codegraph_impact` to trace how the
bad state/value propagates), pinpoint the exact origin to `file:line` and explain *why* it
produces the symptom. A correct root cause predicts the reproduction and any related-but-unseen
failures. Record it in the bug report. If the "cause" you found only explains some repros, keep
going — you have a symptom, not the cause.

Stop and re-route (Step 2) if the analysis shows the defect actually lives in a different layer.

## Step 4 — Remediate (조치)

> Owned by the routed agent (design fixes: `designer` revises the design/system, `developer`
> applies it; impl fixes: `developer`; spec fixes: `architect` corrects the contract, then
> `developer` implements).

Apply the **minimal** fix at the root cause. Per the project's conventions:
- Fix the cause, not the symptom. No symptom-masking, no defensive band-aids around it.
- No scope creep — a bug fix does not get surrounding refactors, cleanup, or new features.
  Don't add error handling or abstractions the fix doesn't require.
- Reuse shared utilities; keep node-testable logic in `.ts` separate from `.tsx` (the project
  split). If the root cause is a shared util, fix it there so every caller benefits.
- If fixing it properly needs a contract change the current spec/design can't express, stop
  and escalate to the `architect`/`designer` rather than hacking around it.

## Step 5 — Regression test (test 작성)

Write a test that **captures this bug** so it can never silently return. The test must assert
the corrected behavior and would have **failed before** your Step 4 fix — confirm that (e.g.
by reverting the fix mentally/temporarily, or reasoning precisely about why the old code fails
it). A test that passes with or without the fix is not a regression test.

Follow the project's test conventions: vitest; `*.test.ts` runs in **node env (no jsdom)**, so
put unit-testable logic in a plain `logic.ts` beside the component and test that — do not import
a `.tsx`/DOM component into a `.test.ts`. Cover the specific failing case from Step 1, plus the
obvious adjacent cases the root cause implicates.

> Best practice: writing the failing test *before* the fix (swap Steps 4 and 5) is encouraged —
> it proves the repro and gives you a red→green signal. The order here matches the common
> "diagnose, fix, then lock it in" flow; either is fine as long as the test genuinely fails
> without the fix.

## Step 6 — Verify (검증)

Confirm the fix is real and contained:
- Run `npm run typecheck` and `npm test` — all green, including the new regression test.
- Re-run the **original reproduction** from Step 1; confirm the symptom is gone.
- For UI/renderer fixes, actually exercise the surface (the running `npm run dev`, or
  Playwright) — golden path AND the edge case that was broken. Do not claim a UI behavior is
  fixed if you could not exercise it; say so explicitly.
- Watch for regressions in adjacent behavior the fix could affect (use `codegraph_impact`).

If verification fails, return to Step 3 — the root cause was wrong or incomplete.

## Step 7 — Wrap Up

Finalize the cycle:
- Update the bug report with the final root cause, the fix, the test, and verification result;
  set its status to Fixed.
- **Save a `bug` memory** with `memory_save` (agentmemory): the symptom, the real root cause,
  and the fix — so this defect is recalled in Step 0 of future cycles. This is the highest-value
  output; a bug that isn't remembered is a bug that recurs.
- If the bug exposed a gotcha, a missing invariant, or a pattern worth enforcing, reflect it in
  `docs/ARCHITECTURE.md` and/or `CLAUDE.md` (owned by the `architect` for arch-level facts).

Then invoke the **`wrap-up`** skill to propagate the cycle's durable learnings into the living
documents and reconcile `TODO.md`:
```
wrap-up auto
```
Do not finish the cycle until wrap-up has run. Do not commit unless the user explicitly asks.
