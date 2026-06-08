---
name: wrap-up
description: "Final step of work iteration. Propagate corrections + learnings from iteration into project living docs — CLAUDE.md, docs/, Claude agent files, Claude skill files — and reconcile root TODO.md. Target docs passed as params."
argument-hint: "[targets] — space/comma-separated docs or globs (e.g. \"CLAUDE.md docs/ARCHITECTURE.md\"), category keywords (claude-md | docs | agents | skills), or \"auto\" to scan all four"
---

Running **wrap-up** at end of work iteration. Job: take corrections, decisions, learnings from **this iteration** and reflect into project living docs so future sessions inherit them.

Not generic "update docs" pass. Only propagate what changed or got learned this iteration. No inventing content, no restating what docs already say.

## Input — Target Documents

Docs to update passed as args: `$ARGUMENTS`

Interpret args:
- **Explicit paths or globs** (e.g. `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/**`) — update exactly those.
- **Category keywords** — expand to matching set:
  - `claude-md` → `CLAUDE.md` and any nested `**/CLAUDE.md`
  - `docs` → files under `docs/`
  - `agents` → Claude agent files under `.claude/agents/**/*.md`
  - `skills` → Claude skill files under `.claude/skills/**/SKILL.md`
- **`auto`** or **no args** — consider all four categories: CLAUDE.md, docs/, agents, skills.

Requested target missing but learning clearly belongs there → create it. Else skip silently, no forced update.

## Step 1 — Collect corrections from the iteration

Review current iteration (this conversation + changes in it). Gather **durable, generalizable** items worth recording. Look for:
- User corrections to approach ("no, do it this way", "stop doing X")
- Decisions made + reasoning behind them
- New conventions, patterns, constraints established
- Deviations from original plan + why
- Gotchas, pitfalls, non-obvious facts found while working
- New or renamed components, commands, agents, skills

Exclude ephemeral task detail (in-progress state, one-off debugging, transient context). Nothing durable emerged → say so and stop. No padding docs.

## Step 2 — Map each learning to a target

For each item, decide target doc:
- **CLAUDE.md** — project-wide conventions, build/test/run commands, repo rules, gotchas any contributor (human or agent) must know.
- **docs/** — architecture, design decisions, component responsibilities, data flows. Keep synced with what got built this iteration.
- **Claude agent files** (`.claude/agents/**`) — adjustments to agent role, scope, instructions revealed by actual use.
- **Claude skill files** (`.claude/skills/**/SKILL.md`) — corrections to skill steps, params, guidance this iteration proved necessary.

Single learning may map to >1 target. Avoid duplicating same content across docs — put where most authoritative, reference rather than repeat.

## Step 3 — Apply the updates

Per target doc:
1. Read current content first.
2. Make minimal edit recording learning — integrate into existing structure, no changelog dump.
3. Keep doc's existing tone + format.
4. Match repo style; no commentary about this iteration ("added for the cosmos work", "per the session on …") — write durable fact only.

## Step 3.5 — Persist durable learnings to agentmemory

Plus doc edits, save durable cross-session learnings from Step 1 into **agentmemory** (canonical memory consulted at start of every sdd cycle — see sdd skill Step 0). Per generalizable item, call `memory_save` (agentmemory MCP) with right `type` (`preference`, `pattern`, `architecture`, `bug`, `workflow`, or `fact`), concise `content` statement, relevant `concepts`/`files`. Save only durable items — same Step 1 ephemeral exclusion applies. This makes learning available to future cycles even when it belongs in no tracked document.

## Step 4 — Reconcile TODO.md

Always update root `TODO.md` to reflect where work stands — **regardless of `$ARGUMENTS` targets**, since this is progress tracking, not learning propagation. (No `TODO.md` → create with `In progress` / `Next` / `Deferred / future` / `Done` sections.)

1. Read `TODO.md`.
2. Check off (`[ ]` → `[x]`) every item this iteration completed; move finished top-level items into `Done`.
3. Add new outstanding work surfaced this iteration (follow-ups, deferred decisions, newly discovered tasks) under right section.
4. Keep concise checklist — no design detail that belongs in `docs/ARCHITECTURE.md`; link instead. No duplicating sdd plan's internal checklist verbatim; track milestone-level progress only.

## Step 5 — Report

Summarize concise:
- Which docs updated + one-line reason each.
- Which learnings saved to agentmemory (type + one-line content).
- How `TODO.md` changed (items checked off, items added).
- Any learning deliberately NOT recorded + why (e.g. too ephemeral).
- Any target requested but skipped + why.

No committing changes unless user explicitly asks.