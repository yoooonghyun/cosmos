# CLAUDE.md

cosmos is a Conductor-style Electron app that embeds Claude Code as its engine: it shows
the real Claude Code TUI (node-pty + xterm.js) and renders agent-generated UI (A2UI). The
authoritative design is `docs/ARCHITECTURE.md`, the file-by-file map is
`docs/PROJECT-STRUCTURE.md`, and detailed development conventions/gotchas are
`docs/DEVELOPMENT.md`. This file is behavioral guidelines and pointers — not the encyclopedia.

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

- **Design / architecture (authoritative):** `docs/ARCHITECTURE.md` — owned by the `architect`.
- **File tree & per-file map:** `docs/PROJECT-STRUCTURE.md`.
- **Development conventions & gotchas (detailed dev policy):** `docs/DEVELOPMENT.md` — owned by the
  `developer`. Read it before touching build/native, IPC, MCP, A2UI catalogs, panel tabs, styling,
  or tests; it carries the load-bearing gotchas (node-pty rebuild, preload-restart, target-routed
  render, per-tab correlation, Tailwind cascade layers, OAuth secret handling, the `.ts`/`.test.ts`
  split, etc.).

## Behavioral rules

- **Read before writing.** `docs/ARCHITECTURE.md` is ground truth for design; `docs/DEVELOPMENT.md`
  for conventions. Ground yourself with codegraph + agentmemory rather than guessing.
- **One typed IPC contract** in `src/shared/ipc.ts`; never define channel strings ad hoc. Every
  cross-process payload is validated at the main-process boundary — invalid payloads warn and are
  ignored, never crash.
- **Secrets and tokens stay in main, period.** Integration tokens live only in main, encrypted at
  rest (`safeStorage`); the Atlassian `client_secret` (`COSMOS_ATLASSIAN_CLIENT_SECRET`) is read from
  a gitignored `.env` in main only. Never log them or place them in any IPC payload, bridge frame,
  MCP result, or A2UI surface, and never expose them to the renderer or the embedded `claude` sandbox.
- **Preload edits require a full `npm run dev` restart**, not HMR — a new `window.cosmos.*` method
  added live will throw "not a function" until you restart.
- **Adding an MCP server** needs a matching rollup `input` in `electron.vite.config.ts` or it is
  silently never bundled. See `docs/DEVELOPMENT.md` for the full add-a-panel / add-a-server recipe.

## Workflow

- Feature work follows the **`sdd`** skill (specify → plan → [design] → interface → test → implement → wrap-up).
- **Defect work follows the `bugfix` skill** (triage/reproduce → scope-gate → classify & route to
  `designer`/`developer`/`architect` → root-cause → fix → regression test → verify → wrap-up). After
  triage, if the fix is large (many files/layers, a new contract, or net-new behavior) the skill
  escalates to `sdd` instead. Bug reports live at `.sdd/bugs/<bug>-v<N>.md`.
- Specs/plans and `docs/ARCHITECTURE.md` are owned by the **`architect`** agent;
  implementation (interface/tests/code) by the **`developer`** agent. The **`wrap-up`**
  skill propagates end-of-iteration learnings into the living docs and reconciles `TODO.md`.
- **The SDD agents (`architect`/`developer`/`designer`) are equipped with codegraph +
  agentmemory and must ground their own investigation with them** — `codegraph_explore` for
  code structure, `memory_recall`/`memory_smart_search` for prior decisions, `memory_save` to
  persist new ones. Do NOT have the orchestrator pre-gather findings and embed them into a
  subagent's prompt; delegate the investigation, not just the writing. (A subagent starts with
  a fresh context, but it has the tools to rebuild exactly the grounding it needs.)
- **UI-bearing features add a design step** (the **`design`** skill, owned by the
  **`designer`** agent) between plan and interface: it establishes/extends the Tailwind +
  shadcn/ui design system and produces a design spec (`.sdd/designs/<feature>-v<N>.md`) so
  every surface stays visually uniform. Skip it for purely non-visual (main/IPC/MCP) work.
  The designer owns the theme tokens + `src/renderer/components/ui/`; build wiring (installs,
  shadcn CLI) is done by the developer/main session since the designer has no Bash.
- `TODO.md` is the living, milestone-level checklist of outstanding work; the `wrap-up` skill
  keeps it current (checks off completed items, adds newly surfaced work).
- Do not commit unless explicitly asked.
