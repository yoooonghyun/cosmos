---
name: sdd
description: "Use when starting any component or feature. Runs the full spec-driven development cycle: specify → plan → interface → test → implement → update docs."
---

You are beginning a spec-driven development cycle for the requested feature or component.
Follow each step in order. Do not proceed to the next step without completing the current one.

## Prerequisites — Template Files

Before starting, check that the following template files exist in the skill directory (`.claude/skills/sdd/`):
- `spec_template.md`
- `plan_template.md`

If either file is missing, download it from:
```
https://raw.githubusercontent.com/yoooonghyun/agent-skills/main/.claude/skills/sdd/<filename>
```
Use the WebFetch tool to retrieve the raw content and write it to the correct path before proceeding.

## Step 0 — Recall & Survey (always run first)

Before writing any spec, prime context from the two code-intelligence systems so the cycle
builds on what already exists instead of rediscovering it:

- **agentmemory (canonical memory).** Call `memory_recall` / `memory_smart_search` (agentmemory
  MCP) with the feature's keywords to surface prior decisions, preferences, patterns, and past
  bugs relevant to this work. agentmemory is the canonical cross-session memory for the SDD
  workflow — consult it at the start of every cycle and let what it returns inform the spec/plan.
- **codegraph (code structure).** Run `codegraph_explore` (or `codegraph_search`) on the symbols
  and areas the feature will touch to learn the current structure before proposing changes.
  codegraph indexes every symbol/edge/file and is sub-millisecond — prefer one `codegraph_explore`
  call over a grep/read sweep. If it reports no project loaded, run `codegraph init .` once.

Carry the findings into Step 1 (Specify) and Step 2 (Plan).

## Step 1 — Specify

> **Owned by the `architect` agent.** Delegate this step to the `architect` agent (via
> the Agent tool). The architect owns `docs/ARCHITECTURE.md`, specs, and plans, and will
> ground the spec in the current architecture. Resume the cycle once it returns the spec.

Understand the requested feature or component from the user's description and any relevant existing code or docs. If the request leaves a required behavior genuinely ambiguous — something that cannot be inferred from context — ask for clarification before writing the spec. Do not ask about things that can be determined by reading the codebase.

Create a versioned specification document at:
```
.sdd/specs/<feature>-v<N>.md
```
Increment `N` if a spec for this feature already exists. Use `./spec_template.md` as the base.

Fill in all sections: user scenarios with acceptance criteria, functional requirements, edge cases, and success criteria. Base the spec on the user's request; do not add behavior the user did not ask for.

Do not proceed if any required behavior is still unresolved. State the blocker and stop.

## Step 2 — Plan

> **Owned by the `architect` agent.** Delegate this step to the `architect` agent. It
> authors the plan from the approved spec, keeps `docs/ARCHITECTURE.md` consistent with
> any new decisions, presents the plan, and stops for user confirmation. Implementation
> (Steps 3–5) is performed by the main session, not the architect.

Based on the spec document from Step 1, create a versioned implementation plan at:
```
.sdd/plans/<feature>-v<N>.md
```
Use the same version number as the corresponding spec document. Use `./plan_template.md` as the base.

Fill in the summary, technical context, and implementation checklist. The checklist is the living record of progress — update it during every subsequent step. Present the plan and get confirmation before moving to the next step.

## Step 2.5 — Design (UI features only)

> **Owned by the `designer` agent, driven by the `design` skill.** For any feature that
> introduces or changes a renderer surface, run the **`design`** skill after the plan is
> approved and **before** Interface (Step 3). The designer establishes/extends the Tailwind +
> shadcn/ui design system and produces a design spec at `.sdd/designs/<feature>-v<N>.md` that
> the developer builds against, so surfaces stay visually uniform. **Skip this step** for
> purely non-visual work (main-process logic, IPC contracts, MCP tools with no new UI).

## Steps 3–5 — Owned by the `developer` agent

> **Implementation (Step 3 Interface, Step 4 Tests, Step 5 Implement) is owned by the
> `developer` agent.** Once the plan is approved, delegate these steps to the `developer`
> agent (via the Agent tool). It knows the project structure and technology stack and
> works from the approved spec and plan. If it hits a behavior the spec cannot express,
> it escalates back to the `architect` rather than inventing scope.

## Step 3 — Interface

Before defining contracts, consult **codegraph** (`codegraph_explore` on the relevant symbols)
to ground the new interfaces in the existing structure and reuse current types/conventions.

Define public contracts (types, interfaces, function signatures, API schemas, etc.) based on the spec document. Use the conventions of the project's language and ecosystem. Rules:
- Every field or parameter must trace back to a requirement in the spec document
- Do not add properties or behaviors not present in the spec
- Use the appropriate type constructs for the language (e.g., union types, enums, ADTs, schemas)

## Step 4 — Create Testing

Write tests against the interface before writing any implementation. Tests must cover:
- A spec-compliant happy path
- Missing optional fields (must not error)
- An invalid or missing required field (must log a warning and return a safe fallback)

Do not write implementation code in this step.

## Step 5 — Implement

Write the implementation to pass the tests. Before and while editing, consult **codegraph**
(`codegraph_callers` / `codegraph_callees` / `codegraph_impact`) to see what a change touches and
avoid breaking callers. Rules:
- Any behavior not covered by the spec must not be added
- Reuse shared utilities instead of inlining logic in components
- If a required behavior cannot be expressed by the spec, stop and raise it as a spec-level change

## Step 6 — Wrap Up

After implementation is complete, finalize the cycle by invoking the **wrap-up** skill.

First, record the cycle-internal state:
- Update the versioned plan document with any deviations made during implementation.
- If new patterns or decisions were introduced, reflect them in `docs/ARCHITECTURE.md` —
  the single, authoritative design reference for the project (both product-level design and
  code-level structure live there; there is no separate design doc).

Then invoke the `wrap-up` skill to propagate the corrections and learnings that emerged
during this cycle into the project's living documents (CLAUDE.md, docs/, Claude agent
files, Claude skill files). Pass the documents to update as arguments, for example:
```
wrap-up CLAUDE.md docs/ agents skills
```
Use `wrap-up auto` to let it scan all four categories. Do not finish the cycle until the
wrap-up step has run.
