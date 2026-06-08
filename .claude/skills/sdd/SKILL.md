---
name: sdd
description: "Use when starting any component or feature. Runs the full spec-driven development cycle: specify → plan → interface → test → implement → update docs."
---

Beginning spec-driven dev cycle for requested feature/component.
Follow steps in order. No proceed to next step without finishing current.

## Prerequisites — Template Files

Before start, check these template files exist in skill dir (`.claude/skills/sdd/`):
- `spec_template.md`
- `plan_template.md`

If either missing, download from:
```
https://raw.githubusercontent.com/yoooonghyun/agent-skills/main/.claude/skills/sdd/<filename>
```
Use WebFetch tool to get raw content, write to correct path before proceeding.

## Step 0 — Recall & Survey (always run first)

Before writing spec, prime context from two code-intelligence systems so cycle builds on
what exists instead of rediscovering:

- **agentmemory (canonical memory).** Call `memory_recall` / `memory_smart_search` (agentmemory
  MCP) with feature keywords to surface prior decisions, preferences, patterns, past bugs
  relevant to work. agentmemory = canonical cross-session memory for SDD workflow — consult
  at start of every cycle, let results inform spec/plan.
- **codegraph (code structure).** Run `codegraph_explore` (or `codegraph_search`) on symbols
  and areas feature touches to learn current structure before proposing changes. codegraph
  indexes every symbol/edge/file, sub-millisecond — prefer one `codegraph_explore` call over
  grep/read sweep. If reports no project loaded, run `codegraph init .` once.

Primes orchestrator's own understanding so it frames delegation and judges ambiguity. Does
**not** replace each agent's own grounding: `architect`, `developer`, `designer` themselves
equipped with codegraph + agentmemory and MUST investigate directly when owning a step.
Delegate the *investigation*, not just writing — do not pre-gather findings here and paste
into subagent's prompt as substitute for it grounding itself (subagent's fresh context
rebuilt with same tools, sub-millisecond).

## Step 1 — Specify

> **Owned by the `architect` agent.** Delegate this step to `architect` agent (via
> Agent tool). Architect owns `docs/ARCHITECTURE.md`, specs, plans, grounds spec in
> current architecture. Resume cycle once it returns spec.

Understand requested feature/component from user description and relevant existing code/docs.
If request leaves required behavior genuinely ambiguous — something not inferable from context
— ask clarification before writing spec. Do not ask about things determinable by reading codebase.

Create versioned spec doc at:
```
.sdd/specs/<feature>-v<N>.md
```
Increment `N` if spec for feature already exists. Use `./spec_template.md` as base.

Fill all sections: user scenarios with acceptance criteria, functional requirements, edge cases,
success criteria. Base spec on user's request; no add behavior user did not ask for.

No proceed if any required behavior still unresolved. State blocker and stop.

## Step 2 — Plan

> **Owned by the `architect` agent.** Delegate this step to `architect` agent. It authors
> plan from approved spec, keeps `docs/ARCHITECTURE.md` consistent with new decisions,
> presents plan, stops for user confirmation. Implementation (Steps 3–5) done by main
> session, not architect.

Based on spec doc from Step 1, create versioned implementation plan at:
```
.sdd/plans/<feature>-v<N>.md
```
Use same version number as corresponding spec doc. Use `./plan_template.md` as base.

Fill summary, technical context, implementation checklist. Checklist = living progress record
— update during every subsequent step. Present plan, get confirmation before next step.

## Step 2.5 — Design (UI features only)

> **Owned by the `designer` agent, driven by the `design` skill.** For any feature that
> introduces/changes a renderer surface, run **`design`** skill after plan approved and
> **before** Interface (Step 3). Designer establishes/extends Tailwind + shadcn/ui design
> system, produces design spec at `.sdd/designs/<feature>-v<N>.md` that developer builds
> against, so surfaces stay visually uniform. **Skip this step** for purely non-visual work
> (main-process logic, IPC contracts, MCP tools with no new UI).

## Steps 3–5 — Owned by the `developer` agent

> **Implementation (Step 3 Interface, Step 4 Tests, Step 5 Implement) owned by `developer`
> agent.** Once plan approved, delegate these steps to `developer` agent (via Agent tool).
> It knows project structure and tech stack, works from approved spec and plan. If hits
> behavior spec cannot express, escalates back to `architect` rather than inventing scope.

## Step 3 — Interface

Before defining contracts, consult **codegraph** (`codegraph_explore` on relevant symbols)
to ground new interfaces in existing structure and reuse current types/conventions.

Define public contracts (types, interfaces, function signatures, API schemas, etc.) based on
spec doc. Use conventions of project's language/ecosystem. Rules:
- Every field/parameter must trace back to requirement in spec doc
- No add properties/behaviors not in spec
- Use appropriate type constructs for language (e.g., union types, enums, ADTs, schemas)

## Step 4 — Create Testing

Write tests against interface before any implementation. Tests must cover:
- Spec-compliant happy path
- Missing optional fields (must not error)
- Invalid/missing required field (must log warning, return safe fallback)

No implementation code in this step.

## Step 5 — Implement

Write implementation to pass tests. Before and while editing, consult **codegraph**
(`codegraph_callers` / `codegraph_callees` / `codegraph_impact`) to see what change touches and
avoid breaking callers. Rules:
- Any behavior not covered by spec must not be added
- Reuse shared utilities instead of inlining logic in components
- If required behavior cannot be expressed by spec, stop and raise as spec-level change

## Step 6 — Wrap Up

After implementation complete, finalize cycle by invoking **wrap-up** skill.

First, record cycle-internal state:
- Update versioned plan doc with any deviations made during implementation.
- If new patterns/decisions introduced, reflect in `docs/ARCHITECTURE.md` — single
  authoritative design reference for project (both product-level design and code-level
  structure live there; no separate design doc).

Then invoke `wrap-up` skill to propagate corrections and learnings that emerged during cycle
into project's living docs (CLAUDE.md, docs/, Claude agent files, Claude skill files). Pass
docs to update as arguments, e.g.:
```
wrap-up CLAUDE.md docs/ agents skills
```
Use `wrap-up auto` to scan all four categories. Do not finish cycle until wrap-up step has run.