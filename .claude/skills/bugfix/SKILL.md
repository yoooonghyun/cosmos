---
name: bugfix
description: "Use when fixing reported defect, regression, or unexpected behavior (not new feature). Runs bug cycle: triage & reproduce → classify & route to right agent (designer / developer / architect) → root-cause → fix → regression test → verify → wrap-up."
argument-hint: "<short bug description> (e.g. slack tabs share state)"
---

Running **bug-fix cycle** for reported defect. Unlike `sdd` skill (builds new behavior from spec), this cycle starts from something already built and **behaving wrong**. Goal: fix *root cause* — not symptom — with regression test proving it, route work to agent owning the layer the bug lives in.

Follow each step in order. No skipping ahead: fix applied before cause understood, or before bug classified = symptom-patching + scope creep.

> Use `sdd` instead when request is net-new behavior. Use **this** skill when existing behavior wrong, regressed, crashes, or diverges from spec/design intent.

## Artifact

Cycle records findings in versioned bug report at:
```
.sdd/bugs/<bug>-v<N>.md
```
Use `./bug_report_template.md` (this skill directory) as base. Increment `N` if report for this bug exists. Report = paper trail: symptom, reproduction, classification + routing decision, root cause (`file:line`), fix, regression test. Keep updated as cycle progresses — living record, like sdd plan.

## Step 0 — Recall & Survey (always run first)

Prime context from two code-intelligence systems before touching anything:

- **LLM wiki (canonical memory).** Call `wiki_query` (`mcp__plugin_oh-my-claudecode_t__wiki_query`) with bug keywords AND symptom (try the `debugging` category). Past bugs live as wiki `debugging` pages — recurring/previously-"fixed" defect, known gotcha, or prior decision explaining behavior often already recorded. Can short-circuit whole investigation. (**agentmemory is DEPRECATED** — its `bug` memories were migrated into the wiki `debugging` pages 2026-06-28; do NOT call `memory_*`.)
- **codegraph (code structure).** Run `codegraph_explore` on symbols/area named in report to see current structure before forming hypothesis. If reports no project loaded, run `codegraph init .` once.

As with sdd, this primes *orchestrator's* triage judgement. Does **not** replace routed agent's own grounding — `developer`/`designer`/`architect` each re-investigate with same tools when they own analysis. Delegate the *investigation*, not just the edit.

## Step 1 — Triage & Reproduce (이슈 분석)

Understand defect concretely before classifying. Establish:
- **Symptom** — what user observes, their words, and where (which surface/panel/flow).
- **Expected vs actual** — what *should* happen vs what *does*. If "expected" ambiguous, may be spec defect (Step 2) — note it, don't guess.
- **Reproduction** — minimal, deterministic steps to trigger. If can't reproduce, say so and gather more detail rather than fixing blind.
- **Scope & severity** — how many surfaces/users; crash vs cosmetic; is it **regression** (worked before) — if so, `git log`/`git blame` suspect area to find when it changed.

Create bug report (`.sdd/bugs/<bug>-v<N>.md`), fill Symptom + Reproduction. Don't proceed until reproducible (or explicitly stated why not and what you'll assume).

## Step 1.5 — Scope gate (수정범위 판단 → sdd로 분기)

Once defect understood (Step 1), judge **fix size** before classifying. This gate decides whether lightweight bug cycle is right tool at all.

**Escalate to `sdd` skill instead of continuing when fix is large** — any of:
- touches **many files or crosses several layers** (renderer + main + IPC + MCP), or
- requires **new/changed contract** (new IPC channel/type, new MCP tool, schema or `UiRenderTarget` change), or
- "fix" is really **net-new behavior** or redesign — bug exposed missing feature, not wrong line, or
- correcting it means **re-specifying intended behavior** broadly rather than patching one root cause.

When gate trips, record in bug report that fix exceeds bug-cycle scope and **stop bugfix cycle**; run **`sdd`** skill (specify → plan → [design] → interface → test → implement → wrap-up) with bug report as input context — work is now feature-sized, needs spec/plan, not spot fix.

Otherwise — contained fix at known root cause in one layer — **continue to Step 2**. When in doubt, prefer bug cycle for genuinely small fixes, `sdd` for anything that smells like feature; single-line spec/architecture correction stays here, routes to `architect` in Step 2 (small fix, not large scope).

## Step 2 — Classify & Route (적절한 agent에 routing)

Decide which **layer** defect lives in — picks owning agent. Record classification + one-line reason in bug report.

| If the defect is…                                                                                 | Class                      | Route to    |
|---------------------------------------------------------------------------------------------------|----------------------------|-------------|
| Wrong visuals/layout/spacing/typography, a missing or wrong **state** (loading/empty/error/disabled), inconsistency with the design system, raw hex / one-off CSS, a11y/contrast/focus/keyboard issue — but the underlying logic matches the design | **Design defect**          | `designer`  |
| Code does **not** do what the spec/design says: wrong logic, broken/shared state wiring, race condition, off-by-one, crash, bad data, perf, incorrect IPC/validation behavior | **Implementation defect**  | `developer` |
| The **intended behavior itself** is wrong, missing, contradictory, or underspecified — fixing it requires changing the contract (spec/architecture), not just the code | **Spec/architecture defect** | `architect` (then `developer` to implement) |

Routing rules:
- **Delegate to owning agent via Agent tool.** Hand it bug report path + reproduction; instruct it to ground itself with codegraph + the LLM wiki (`wiki_query`; don't pre-paste your findings as substitute for its own investigation), own Steps 3–4 for its layer.
- **Design defects still need code.** `designer` has no Bash, writes no feature code: revises design (tokens / `components/ui/` / design spec), then hands build to `developer`. Design fix = `designer` → `developer` handoff, not designer-only.
- **Spec defects loop back.** If behavior specified wrong, `architect` corrects spec/`docs/ARCHITECTURE.md` first, then `developer` implements corrected contract. Don't let developer silently redefine intended behavior.
- **When fix reveals different class, re-route.** Defect first read as "implementation" may be design/spec gap (or vice-versa). Escalate rather than forcing fix into wrong layer — as `developer` escalates scope to `architect`.
- **Mixed bugs:** pick primary layer, fix there, spin secondary part to its owner rather than one agent reaching across layers.

## Step 3 — Root-cause analysis (상세 분석)

> Owned by agent routed in Step 2.

Find **cause**, not symptom. Using codegraph (`codegraph_explore` to read implicated symbols; `codegraph_callers`/`codegraph_callees`/`codegraph_impact` to trace how bad state/value propagates), pinpoint exact origin to `file:line` and explain *why* it produces symptom. Correct root cause predicts reproduction and related-but-unseen failures. Record in bug report. If "cause" only explains some repros, keep going — you have symptom, not cause.

Stop and re-route (Step 2) if analysis shows defect lives in different layer.

## Step 4 — Remediate (조치)

> Owned by routed agent (design fixes: `designer` revises design/system, `developer` applies; impl fixes: `developer`; spec fixes: `architect` corrects contract, then `developer` implements).

Apply **minimal** fix at root cause. Per project conventions:
- Fix cause, not symptom. No symptom-masking, no defensive band-aids around it.
- No scope creep — bug fix gets no surrounding refactors, cleanup, or new features. Don't add error handling or abstractions fix doesn't require.
- Reuse shared utilities; keep node-testable logic in `.ts` separate from `.tsx` (project split). If root cause is shared util, fix it there so every caller benefits.
- If proper fix needs contract change current spec/design can't express, stop and escalate to `architect`/`designer` rather than hacking around it.

## Step 5 — Regression test (test 작성)

Write test that **captures this bug** so it can't silently return. Test must assert corrected behavior and would have **failed before** Step 4 fix — confirm that (revert fix mentally/temporarily, or reason precisely why old code fails it). Test passing with or without fix is not regression test.

**Delegate test AUTHORING to the `test-engineer` agent** (separate pass from whoever fixed it).
Hand it the bug report + the root cause. It MUST:
1. **Read `docs/TEST-SCENARIOS.md` first** -- check the new regression test does not contradict an
   existing invariant (a CSS seam, IPC channel, shared behavior). A contradiction between two
   wanted behaviors is a product decision -- surface it, don't silently override.
2. **Write the test at the layer that actually reproduces the bug.** This is the crux: a node
   `*.test.ts` (node env, no jsdom) only sees pure logic + class strings -- it CANNOT catch a DOM
   wiring / event / focus bug (e.g. a ref-timing scroll listener), an IPC/protocol/spawn bug, or a
   layout/pixel bug. A green node test is NECESSARY but NOT SUFFICIENT. Pick:
   - renderer DOM / hook / event / focus bug -> **jsdom** `*.dom.test.tsx` (`npm run test:dom`)
   - layout / pixel bug -> **visual** (`npm run test:visual`)
   - main-process IPC / `cosmos-file` protocol / agent spawn-queue bug -> **node-integration**
     (`npm run test:integration`) or **e2e** (`npm run test:e2e`)
   - pure logic / reducer / validator -> node-unit (`*.test.ts`, `npm test`)
   The test must FAIL before the fix (red) and pass after (green) -- confirm the red.
3. Cover the specific failing case from Step 1 + obvious adjacent cases the root cause implicates.
4. **Update `docs/TEST-SCENARIOS.md`** with the new regression scenario (id, invariant, layer, file).

Keep node-unit logic in a plain `.ts` beside the component (the `.ts`/`.test.ts` split still holds for
the node-unit layer) -- but do NOT certify a UI/IPC bug fixed on node-unit alone.

> Best practice: writing failing test *before* fix (swap Steps 4 and 5) encouraged — proves repro, gives red→green signal. Order here matches common "diagnose, fix, then lock it in" flow; either fine as long as test genuinely fails without fix.

## Step 6 — Verify (검증)

Confirm fix is real and contained:
- Run `npm run typecheck` and `npm test` — all green, including new regression test.
- **Run the layer-appropriate suite the regression test lives in** and confirm it goes from red to
  green: `npm run test:dom` (renderer DOM/hook), `npm run test:visual` (layout/pixel),
  `npm run test:integration` (IPC/protocol/spawn), `npm run test:e2e` (full app). Node `npm test`
  passing alone does NOT confirm a UI/IPC/runtime fix.
- Re-run **original reproduction** from Step 1; confirm symptom gone.
- For UI/renderer fixes, actually exercise surface (running `npm run dev`, or Playwright) — golden path AND broken edge case. Don't claim UI behavior fixed if you couldn't exercise it; say so explicitly.
- Watch for regressions in adjacent behavior fix could affect (use `codegraph_impact`).

If verification fails, return to Step 3 — root cause was wrong or incomplete.

## Step 7 — Wrap Up

Finalize cycle:
- Update bug report with final root cause, fix, test, verification result; set status to Fixed.
- **Save the bug to the LLM wiki** with `wiki_ingest` (`category: "debugging"`): symptom, real root cause, fix — so the defect is recalled in Step 0 of future cycles (merges into the existing `cosmos debugging: …` pages). Highest-value output; bug not remembered = bug that recurs. (agentmemory `memory_save` is DEPRECATED — do NOT use it.)
- If bug exposed gotcha, missing invariant, or pattern worth enforcing, reflect in `docs/ARCHITECTURE.md` and/or `CLAUDE.md` (owned by `architect` for arch-level facts).

Then invoke **`wrap-up`** skill to propagate cycle's durable learnings into living documents and reconcile `TODO.md`:
```
wrap-up auto
```
Don't finish cycle until wrap-up has run. Don't commit unless user explicitly asks.