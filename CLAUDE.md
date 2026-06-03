# CLAUDE.md

cosmos is a Conductor-style Electron app that embeds Claude Code as its engine: it shows
the real Claude Code TUI (node-pty + xterm.js) and renders agent-generated UI (A2UI).
See `docs/ARCHITECTURE.md` for the authoritative design.

## Commands

| Task | Command |
|------|---------|
| Install (auto-rebuilds node-pty) | `npm install` |
| Dev (launch app w/ HMR) | `npm run dev` |
| Build | `npm run build` |
| Typecheck (node + web) | `npm run typecheck` |
| Tests | `npm test` (vitest); `npm run test:watch` |
| Rebuild native module | `npm run rebuild` |

## Project structure

- `src/main/` — Electron main process (`index.ts` window + IPC wiring; `ptyManager.ts` PTY lifecycle)
- `src/preload/` — `contextBridge` preload exposing only the `pty` channels as `window.cosmos.pty`
- `src/renderer/` — React renderer; `TerminalPanel.tsx` is the xterm.js terminal
- `src/shared/` — code shared across processes: `ipc.ts` (typed IPC contract), `validate.ts` (pure IPC payload validators)

## Conventions & gotchas

- **node-pty is a native addon** — it must be rebuilt for Electron's ABI. `postinstall`
  runs `electron-rebuild -f -w node-pty`; if PTY fails to load, run `npm run rebuild`.
- **`claude` not found does NOT throw.** On macOS `node-pty`'s `spawn` does not throw
  synchronously for a missing binary — it spawns and exits with code 1 (no stderr). Pre-check
  the executable on PATH before spawning to surface a meaningful error.
- **Vite is pinned to 7**, not 8 — electron-vite 5 peer-requires `vite ^5||^6||^7`.
- **Window security baseline:** `contextIsolation: true`, `nodeIntegration: false`. `sandbox`
  is intentionally `false` so the preload can use `ipcRenderer` reliably; the renderer still
  only sees the `pty` channels.
- All cross-process IPC payloads are validated at the main-process boundary; invalid payloads
  log a warning and are safely ignored (never crash).

## Workflow

- Feature work follows the **`sdd`** skill (specify → plan → interface → test → implement → wrap-up).
- Specs/plans and `docs/ARCHITECTURE.md` are owned by the **`architect`** agent;
  implementation (interface/tests/code) by the **`developer`** agent. The **`wrap-up`**
  skill propagates end-of-iteration learnings into the living docs and reconciles `TODO.md`.
- `TODO.md` is the living, milestone-level checklist of outstanding work; the `wrap-up` skill
  keeps it current (checks off completed items, adds newly surfaced work).
- Do not commit unless explicitly asked.
