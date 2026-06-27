# cosmos

**A unified work-space.**

Our day is scattered across a dozen tools — a terminal here, Slack there, Jira, Confluence,
the calendar, an AI assistant in yet another window. Context lives everywhere and nowhere.
cosmos pulls that chaos into one coherent place: true to its name (the ordered universe, the
opposite of chaos), it composes your tools into a single, harmonious workspace.

It does this by embedding **Claude Code** as the engine and giving it two surfaces:

1. A **real Claude Code terminal** — the actual TUI running over `node-pty` + `xterm.js`,
   with sessions that persist and resume across restarts.
2. **Agent-generated native UI (A2UI)** — instead of jumping between apps, the agent renders
   rich, interactive panels for your integrations (Slack, Jira, Confluence, Google Calendar)
   right inside cosmos by calling render MCP tools.

You drive everything from one place — the floating **Open Prompt** composer — which commands a
single persistent agent session whose conversation is recorded and resumable. One prompt, one
workspace, instead of a dozen scattered tabs.

## What you can do

- **Terminal**: multiple live Claude Code tabs, each its own PTY session, with a side
  file explorer + viewer; sessions restore (and recover orphaned processes) on relaunch.
- **Cosmos panel**: command the persistent default agent and see its generated UI / (planned)
  full conversation history.
- **Integrations**: connect Slack, Jira, Confluence, and Google Calendar via browser OAuth.
  The agent can read and (where granted) write — e.g. create/update Confluence pages, comment,
  transition Jira issues, browse Slack threads — and present results as native panels.
- **Open Prompt**: a draggable, position-persistent composer that routes prompts to the
  active surface's agent.

## Architecture (in brief)

- **Process model**: secrets and integration tokens live in the **main** process only,
  encrypted at rest (`safeStorage`); they never cross into any IPC payload, MCP result, A2UI
  surface, or the embedded `claude` sandbox.
- **One typed IPC contract** (`src/shared/ipc.ts`): every cross-process payload is validated at
  the main-process boundary (invalid payloads are warned and ignored, never crash).
- **A2UI render path**: the agent runs `claude -p --output-format json`, calls render MCP tools,
  and the resulting frames flow through a UI bridge to the renderer, which hosts them in a
  catalog-driven A2UI surface.
- Authoritative design lives in **`docs/ARCHITECTURE.md`**; the file-by-file map in
  **`docs/PROJECT-STRUCTURE.md`**; dev conventions and gotchas in **`docs/DEVELOPMENT.md`**.

## Getting started

Requires Node and a working `claude` CLI on your PATH (cosmos embeds it as the engine).

```bash
npm install        # installs deps and rebuilds the node-pty native module
npm run dev         # launch the app with HMR
```

> Editing preload code requires a full `npm run dev` restart (not HMR) for new
> `window.cosmos.*` methods to take effect.

## Commands

| Task | Command |
|------|---------|
| Install (auto-rebuilds node-pty) | `npm install` |
| Dev (launch with HMR) | `npm run dev` |
| Build | `npm run build` |
| Typecheck (node + web) | `npm run typecheck` |
| Tests | `npm test` (vitest); `npm run test:watch` |
| Rebuild native module | `npm run rebuild` |

## Project layout

```
src/main/       Electron main: window, IPC, integrations, MCP servers, session/PTY
src/preload/    The typed window.cosmos bridge
src/renderer/   React UI: terminal, panels, A2UI catalogs, Open Prompt
src/shared/     The one typed IPC contract + shared types
docs/           ARCHITECTURE.md (design) · DEVELOPMENT.md (conventions) · PROJECT-STRUCTURE.md
```

## Security model

- Integration tokens and the Atlassian `client_secret` (from a gitignored `.env`) stay in
  main, encrypted at rest, and are never logged or exposed to the renderer or the agent.
- Local file access in the renderer goes through scoped custom protocols confined to the
  active tab's root — no arbitrary filesystem reach.
