---
name: wrap-up
description: "Final step of a work iteration. Propagates corrections and learnings that emerged during the iteration into the project's living documents — CLAUDE.md, docs/, Claude agent files, and Claude skill files — and reconciles the root TODO.md. Accepts the target documents to update as parameters."
argument-hint: "[targets] — space/comma-separated docs or globs to update (e.g. \"CLAUDE.md docs/ARCHITECTURE.md\"), category keywords (claude-md | docs | agents | skills), or \"auto\" to scan all four categories"
---

You are running the **wrap-up** step at the end of a work iteration. Your job is to take
the corrections, decisions, and learnings that emerged **during this iteration** and
reflect them into the project's living documents so future sessions inherit them.

This is not a generic "update the docs" pass. Only propagate things that actually changed
or were learned in this iteration. Do not invent content, and do not restate what the
documents already say.

## Input — Target Documents

The documents to update are provided as arguments: `$ARGUMENTS`

Interpret the arguments as follows:
- **Explicit paths or globs** (e.g. `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/**`) — update exactly those.
- **Category keywords** — expand to the matching set:
  - `claude-md` → `CLAUDE.md` and any nested `**/CLAUDE.md`
  - `docs` → files under `docs/`
  - `agents` → Claude agent files under `.claude/agents/**/*.md`
  - `skills` → Claude skill files under `.claude/skills/**/SKILL.md`
- **`auto`** or **no arguments** — consider all four categories: CLAUDE.md, docs/, agents, skills.

If a requested target does not exist and the learning clearly belongs there, create it.
Otherwise, skip silently rather than forcing an update.

## Step 1 — Collect corrections from the iteration

Review the current iteration (this conversation and the changes made in it) and gather
**durable, generalizable** items worth recording. Look for:
- User corrections to your approach ("no, do it this way", "stop doing X")
- Decisions made and the reasoning behind them
- New conventions, patterns, or constraints that were established
- Deviations from the original plan and why
- Gotchas, pitfalls, or non-obvious facts discovered while working
- New or renamed components, commands, agents, or skills

Exclude ephemeral task detail (in-progress state, one-off debugging, transient context).
If nothing durable emerged, say so and stop — do not pad the documents.

## Step 2 — Map each learning to a target

For every collected item, decide which target document it belongs in:
- **CLAUDE.md** — project-wide conventions, build/test/run commands, repository rules,
  gotchas that any contributor (human or agent) must know.
- **docs/** — architecture, design decisions, component responsibilities, data flows.
  Keep these in sync with what was actually built this iteration.
- **Claude agent files** (`.claude/agents/**`) — adjustments to an agent's role,
  scope, or instructions revealed by how it was actually used.
- **Claude skill files** (`.claude/skills/**/SKILL.md`) — corrections to a skill's
  steps, parameters, or guidance that this iteration proved necessary.

A single learning may map to more than one target. Avoid duplicating the same content
across documents — put it where it is most authoritative and reference rather than repeat.

## Step 3 — Apply the updates

For each target document:
1. Read the current content first.
2. Make the minimal edit that records the learning — integrate it into the existing
   structure rather than appending a changelog dump.
3. Keep the document's existing tone and format.
4. Match the repository's style; do not add commentary about this iteration ("added for
   the cosmos work", "per the session on …") — write the durable fact only.

## Step 3.5 — Persist durable learnings to agentmemory

In addition to the document edits, save the durable, cross-session learnings from Step 1 into
**agentmemory** (the canonical memory consulted at the start of every sdd cycle — see the sdd
skill's Step 0). For each generalizable item, call `memory_save` (agentmemory MCP) with the
appropriate `type` (`preference`, `pattern`, `architecture`, `bug`, `workflow`, or `fact`),
a concise `content` statement, and the relevant `concepts`/`files`. Save only durable items —
the same exclusion of ephemeral task detail from Step 1 applies. This is what makes a learning
available to future cycles even when it does not belong in any tracked document.

## Step 4 — Reconcile TODO.md

Always update the project's root `TODO.md` to reflect where the work now stands —
**regardless of the `$ARGUMENTS` targets**, since this is progress tracking, not learning
propagation. (If `TODO.md` does not exist, create it with `In progress` / `Next` /
`Deferred / future` / `Done` sections.)

1. Read `TODO.md`.
2. Check off (`[ ]` → `[x]`) every item this iteration actually completed; move finished
   top-level items into the `Done` section.
3. Add any new outstanding work this iteration surfaced (follow-ups, deferred decisions,
   newly discovered tasks) under the appropriate section.
4. Keep it a concise checklist — do not paste design detail that belongs in
   `docs/ARCHITECTURE.md`; link to it instead. Do not duplicate the sdd plan's internal
   checklist verbatim; track milestone-level progress only.

## Step 5 — Report

Summarize concisely:
- Which documents were updated and the one-line reason for each.
- Which learnings were saved to agentmemory (type + one-line content).
- How `TODO.md` changed (items checked off, items added).
- Any learning you deliberately did NOT record, and why (e.g. too ephemeral).
- Any target that was requested but skipped (and why).

Do not commit changes unless the user explicitly asks.
