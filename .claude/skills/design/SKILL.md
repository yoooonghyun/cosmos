---
name: design
description: "Use when feature has UI. Runs design step of cosmos dev cycle: establish/extend Tailwind + shadcn design system, design every surface + all states against theme, produce design spec dev builds against. Sits between sdd Plan (Step 2) and Interface (Step 3)."
argument-hint: "<feature-name> (e.g. slack-panel)"
---

You run **design step** for UI-bearing feature. Job: guarantee whatever built looks like one coherent cosmos product — design against managed design system, not ad-hoc CSS.

> **Owned by `designer` agent.** Delegate design work to `designer` agent (via Agent tool). Designer owns Tailwind theme tokens, shadcn/ui component set in `src/renderer/components/ui/`, design specs; grounds design in current system. Resume cycle once it returns design spec.
>
> **If `designer` subagent type not registered** in Agent tool (only `architect`/`developer` available), delegate to `general-purpose` agent instead; instruct it to first read `.claude/agents/designer.md` and adopt that role. Agent definition file exists either way; only dedicated subagent slot may be missing.

## When this step applies

Run for any feature introducing/changing **renderer surface** (panel, screen, agent-generated/A2UI UI, dialog, etc.). **Skip** for purely non-visual work (main-process logic, IPC contracts, MCP tools with no new UI). If unsure, run it — two-line "no UI changes" design note cheap; inconsistent surface not.

## Where this sits in the cycle

Cosmos cycle for UI features:
specify (architect) → plan (architect) → **design (this skill)** → interface → test → implement (developer) → wrap-up. Don't start design until spec + plan exist and plan approved; don't start developer's interface step until design spec done.

## Step 1 — Ground in the current system

Read **`docs/DESIGN.md` FIRST** — the enforced design-criteria canon (surface→token map + the Design Criteria Registry of rules learned from past defects, e.g. rule D-1 "every `DialogContent` sets `bg-popover`"). Every surface you design must obey it. Then read, in order: feature spec (`.sdd/specs/<feature>-v<N>.md`), plan (`.sdd/plans/<feature>-v<N>.md`), `docs/ARCHITECTURE.md`, and **live design system** — `src/renderer/index.css` (theme tokens / palette) and `src/renderer/components/ui/` (existing shadcn primitives). Know exactly which tokens + components already exist before designing, so you reuse not reinvent.

## Step 2 — Establish or extend the design system

Express feature in **existing tokens and components** wherever possible. Only when system genuinely can't express a need do you extend:
- new **token** (color/spacing/radius CSS variable) added to theme, in cosmos dark palette, so same need always resolves to same value app-wide; or
- new **shadcn component or variant** under `src/renderer/components/ui/`.

Never solve surface need with bespoke one-off style. Extending system correct; one-offs break uniformity. Note: package installs + shadcn-CLI runs need Bash — designer hands those to developer/main session; designer authors token/component source directly.

## Step 3 — Design the surface and ALL its states

Design each screen/panel: layout, hierarchy, spacing, typography, interaction affordances, mapped to theme tokens + shadcn components. Surface not designed until **every** state specified: loading, empty, populated, error, disabled. Specify focus order, keyboard paths, ARIA expectations (lean on Radix), contrast against dark palette.

## Step 4 — Produce the design spec

Write versioned design document at:
```
.sdd/designs/<feature>-v<N>.md
```
Use same version number as feature's spec/plan. Must give developer buildable, unambiguous picture: surfaces & layout; exact tokens used (flag any added/changed); shadcn components + variants/sizes (flag any added); each surface's five states; interaction & a11y notes; open questions. If required visual behavior genuinely unresolved, state blocker and stop — don't guess.

## Step 5 — Hand off to the developer

Design spec = contract for sdd Steps 3–5. Developer implements interface, tests, code against it (and performs any system-extension installs/CLI runs designer flagged). If implementation reveals design can't be built as specified, developer surfaces it back so design revised here — surface not quietly restyled off-system.

## Step 6 — Design review

After implementation, designer reviews built surface against design spec + system: does it use specified tokens/components (no stray hex or one-off CSS)? Does it obey **every rule in `docs/DESIGN.md`** (surface→token map + registry)? All states present? Visually consistent with rest of cosmos + accessible? File any drift as fixes. **If this cycle established or repaired a standard, UPDATE `docs/DESIGN.md`** (add/edit the surface→token row and/or a Design Criteria Registry row with the rationale) so the rule is enforced next time. Carry design-system changes (new tokens/components, new standards) into wrap-up so `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, and the design system stay authoritative.