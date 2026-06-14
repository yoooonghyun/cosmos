# CLAUDE.md

cosmos = Conductor-style Electron app embed Claude Code as engine: show real Claude Code TUI (node-pty + xterm.js), render agent-generated UI (A2UI). Authoritative design `docs/ARCHITECTURE.md`, file-by-file map `docs/PROJECT-STRUCTURE.md`, dev conventions/gotchas `docs/DEVELOPMENT.md`. This file = behavioral rules + pointers, not encyclopedia.

## Commands

| Task | Command |
|------|---------|
| Install (auto-rebuilds node-pty) | `npm install` |
| Dev (launch app w/ HMR) | `npm run dev` |
| Build | `npm run build` |
| Typecheck (node + web) | `npm run typecheck` |
| Tests | `npm test` (vitest); `npm run test:watch` |
| Rebuild native module | `npm run rebuild` |

## Where to look

- **Design / architecture (authoritative):** `docs/ARCHITECTURE.md` — owned by `architect`.
- **File tree & per-file map:** `docs/PROJECT-STRUCTURE.md`.
- **Development conventions & gotchas (detailed dev policy):** `docs/DEVELOPMENT.md` — owned by
  `developer`. Read before touching build/native, IPC, MCP, A2UI catalogs, panel tabs, styling,
  or tests; carries load-bearing gotchas (node-pty rebuild, preload-restart, target-routed
  render, per-tab correlation, Tailwind cascade layers, OAuth secret handling, `.ts`/`.test.ts`
  split, etc.).

## Behavioral rules

- **Read before writing.** `docs/ARCHITECTURE.md` = ground truth for design; `docs/DEVELOPMENT.md`
  for conventions. Ground self w/ codegraph + agentmemory, not guess.
- **One typed IPC contract** in `src/shared/ipc.ts`; never define channel strings ad hoc. Every
  cross-process payload validated at main-process boundary — invalid payloads warn + ignored,
  never crash.
- **Secrets and tokens stay in main, period.** Integration tokens live only in main, encrypted at
  rest (`safeStorage`); Atlassian `client_secret` (`COSMOS_ATLASSIAN_CLIENT_SECRET`) read from
  gitignored `.env` in main only. Never log them or put in any IPC payload, bridge frame,
  MCP result, or A2UI surface; never expose to renderer or embedded `claude` sandbox.
- **Preload edits require full `npm run dev` restart**, not HMR — new `window.cosmos.*` method
  added live throws "not a function" until restart.
- **Adding an MCP server** needs matching rollup `input` in `electron.vite.config.ts` or silently
  never bundled. See `docs/DEVELOPMENT.md` for full add-a-panel / add-a-server recipe.

## Workflow

- Feature work follows **`sdd`** skill (specify → plan → [design] → interface → test → implement → wrap-up).
- **Defect work follows `bugfix` skill** (triage/reproduce → scope-gate → classify & route to
  `designer`/`developer`/`architect` → root-cause → fix → regression test → verify → wrap-up). After
  triage, if fix large (many files/layers, new contract, or net-new behavior) skill escalates to
  `sdd`. Bug reports at `.sdd/bugs/<bug>-v<N>.md`.
- Specs/plans + `docs/ARCHITECTURE.md` owned by **`architect`** agent;
  implementation (interface/tests/code) by **`developer`** agent. **`wrap-up`**
  skill propagates end-of-iteration learnings into living docs + reconciles `TODO.md`.
- **Delegate SDD/bugfix agents (`architect`/`developer`/`designer`) as BACKGROUND subagents**
  (`run_in_background: true`) by default so the main agent stays responsive (not blocked waiting on a
  step). SDD steps are sequential (spec→plan→implement), so reserve true parallelism (multiple
  background agents at once, or team mode) for independent multi-track work.
- **SDD agents (`architect`/`developer`/`designer`) equipped w/ codegraph +
  agentmemory, must ground own investigation w/ them** — `codegraph_explore` for
  code structure, `memory_recall`/`memory_smart_search` for prior decisions, `memory_save` to
  persist new. Do NOT have orchestrator pre-gather findings + embed into subagent prompt;
  delegate investigation, not just writing. (Subagent starts fresh context, but has tools to
  rebuild grounding it needs.)
- **UI-bearing features add design step** (**`design`** skill, owned by
  **`designer`** agent) between plan and interface: establishes/extends Tailwind +
  shadcn/ui design system, produces design spec (`.sdd/designs/<feature>-v<N>.md`) so
  every surface stays visually uniform. Skip for purely non-visual (main/IPC/MCP) work.
  Designer owns theme tokens + `src/renderer/components/ui/`; build wiring (installs,
  shadcn CLI) done by developer/main session since designer has no Bash.
- `TODO.md` = living, milestone-level checklist of outstanding work; `wrap-up` skill
  keeps current (checks off done items, adds newly surfaced work).
- Do not commit unless explicitly asked.