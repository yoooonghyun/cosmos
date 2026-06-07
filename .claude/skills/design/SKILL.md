---
name: design
description: "Use when a feature has UI. Runs the design step of the cosmos dev cycle: establish/extend the Tailwind + shadcn design system, design every surface and all its states against the theme, and produce a design spec the developer builds against. Sits between sdd's Plan (Step 2) and Interface (Step 3)."
argument-hint: "<feature-name> (e.g. slack-panel)"
---

You are running the **design step** for a UI-bearing feature. Its job is to guarantee that
whatever gets built looks like one coherent cosmos product, by designing it against a
managed design system rather than ad-hoc CSS.

> **Owned by the `designer` agent.** Delegate the design work to the `designer` agent (via
> the Agent tool). The designer owns the Tailwind theme tokens, the shadcn/ui component set
> in `src/renderer/components/ui/`, and the design specs, and will ground the design in the
> current system. Resume the cycle once it returns the design spec.
>
> **If the `designer` subagent type is not registered** in the Agent tool (only
> `architect`/`developer` may be available), delegate instead to a `general-purpose` agent
> and instruct it to first read `.claude/agents/designer.md` and adopt that role. The agent
> definition file exists either way; only the dedicated subagent slot may be missing.

## When this step applies

Run it for any feature that introduces or changes a **renderer surface** (a panel, a screen,
agent-generated/A2UI UI, a dialog, etc.). **Skip it** for purely non-visual work
(main-process logic, IPC contracts, MCP tools with no new UI). If unsure, run it — a
two-line "no UI changes" design note is cheap; an inconsistent surface is not.

## Where this sits in the cycle

The cosmos cycle for UI features is:
specify (architect) → plan (architect) → **design (this skill)** → interface → test →
implement (developer) → wrap-up. Do not start design until the spec and plan exist and the
plan is approved; do not start the developer's interface step until the design spec is done.

## Step 1 — Ground in the current system

Read, in order: the feature spec (`.sdd/specs/<feature>-v<N>.md`), the plan
(`.sdd/plans/<feature>-v<N>.md`), `docs/ARCHITECTURE.md`, and the **live design system** —
`src/renderer/index.css` (theme tokens / palette) and `src/renderer/components/ui/` (existing
shadcn primitives). Know exactly which tokens and components already exist before designing
anything, so you reuse rather than reinvent.

## Step 2 — Establish or extend the design system

Express the feature in **existing tokens and components** wherever possible. Only when the
system genuinely cannot express a need do you extend it:
- a new **token** (color/spacing/radius CSS variable) added to the theme, in the cosmos
  dark palette, so the same need always resolves to the same value app-wide; or
- a new **shadcn component or variant** under `src/renderer/components/ui/`.

Never solve a surface's need with a bespoke one-off style. Extending the system is the
correct move; one-offs break uniformity. Note that package installs and shadcn-CLI runs need
Bash — the designer hands those to the developer/main session; the designer authors the
token/component source directly.

## Step 3 — Design the surface and ALL its states

Design each screen/panel: layout, hierarchy, spacing, typography, and interaction
affordances, mapped to theme tokens and shadcn components. A surface is not designed until
**every** state is specified: loading, empty, populated, error, disabled. Specify focus
order, keyboard paths, ARIA expectations (lean on Radix), and contrast against the dark
palette.

## Step 4 — Produce the design spec

Write a versioned design document at:
```
.sdd/designs/<feature>-v<N>.md
```
Use the same version number as the feature's spec/plan. It must give the developer a
buildable, unambiguous picture: surfaces & layout; exact tokens used (flag any added/changed);
shadcn components + variants/sizes (flag any added); each surface's five states; interaction
& a11y notes; and any open questions. If a required visual behavior is genuinely unresolved,
state the blocker and stop rather than guessing.

## Step 5 — Hand off to the developer

The design spec is the contract for sdd Steps 3–5. The developer implements the interface,
tests, and code against it (and performs any system-extension installs/CLI runs the designer
flagged). If implementation reveals the design can't be built as specified, the developer
surfaces it back so the design is revised here — the surface is not quietly restyled off-system.

## Step 6 — Design review

After implementation, the designer reviews the built surface against the design spec and the
system: does it use the specified tokens/components (no stray hex or one-off CSS)? Are all
states present? Is it visually consistent with the rest of cosmos and accessible? File any
drift as fixes. Carry design-system changes (new tokens/components, new standards) into the
wrap-up so `docs/ARCHITECTURE.md` and the design system stay authoritative.
