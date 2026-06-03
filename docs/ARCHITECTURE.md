# cosmos — Architecture

## 1. Product Overview

cosmos is a desktop application that embeds **Claude Code** as its agent engine and
gives it a graphical surface. It does two things that a plain terminal cannot:

1. **Shows the real Claude Code TUI** inside the app window, pixel-for-pixel as it
   appears in a terminal.
2. **Lets Claude generate rich, interactive UI** (forms, cards, buttons) that is
   rendered with native web components alongside the TUI.

The goal is a Conductor-style "host app" where Claude Code is the brain and cosmos
is the body — a work/business tool built on top of the agent rather than inside a
terminal.

### Design principle

> The stock Claude Code binary cannot draw graphical UI; it only emits text/ANSI.
> So cosmos does not try to extend the TUI. Instead it **hosts** Claude Code and
> separates two channels: the human-facing TUI stream, and a structured UI-generation
> channel. These never share a stream.

---

## 2. Technology Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Shell | **Electron** | Entire toolchain (Claude Code, Agent SDK, MCP SDK, PTY) is Node-native — single language, single process model |
| Terminal embed | **node-pty + xterm.js** | The VS Code reference pattern for embedding a real terminal |
| UI generation protocol | **A2UI** (`a2ui.org`) | Open standard; agent emits declarative JSON UI, client renders with native components |
| A2UI renderer | **@easyops-cn/a2ui-sdk** (React) | TypeScript/React implementation of the A2UI protocol |
| Renderer framework | **react-dom** | Standard web UI for the A2UI panel and app chrome |
| Agent engine | **Claude Code CLI** (interactive) + optional **Claude Agent SDK** | Real TUI via CLI; SDK reserved for programmatic session control if needed |

**Pinned versions (milestone 1):** electron 42, electron-vite 5, vite **7** (not 8 —
electron-vite 5 peer-requires `vite ^5||^6||^7`), react 19, node-pty 1.1, @xterm/xterm 6,
@xterm/addon-fit 0.11, vitest 4, typescript 5.7. node-pty is a native addon and is rebuilt
for Electron's ABI via a `postinstall` `electron-rebuild` step.

**Window security:** every BrowserWindow uses `contextIsolation: true` and
`nodeIntegration: false`; `sandbox` is intentionally left `false` so the preload can use
`ipcRenderer` reliably, while the renderer still only sees the `pty` channels.

**Tradeoff accepted:** Electron's larger bundle (~100MB) and higher memory use are
acceptable for an internal tool where development speed and a single Node stack win.
If hard size/memory limits appear later, the core can migrate to Tauri.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Electron Renderer (Chromium)                                      │
│  ┌───────────────────────────┐  ┌──────────────────────────────┐  │
│  │ Terminal Panel             │  │ Generated-UI Panel            │  │
│  │  xterm.js                  │  │  react-dom + A2UI SDK         │  │
│  │  (real Claude Code TUI)    │  │  (renders A2UI surfaces)      │  │
│  └────────────▲──────────────┘  └───────────────▲──────────────┘  │
└───────────────┼─────────────────────────────────┼─────────────────┘
        ANSI / keystrokes (IPC)            A2UI JSON / user actions (IPC)
┌───────────────┼─────────────────────────────────┼─────────────────┐
│  Electron Main (Node.js)                         │                 │
│  ┌────────────▼──────────────┐  ┌────────────────▼──────────────┐  │
│  │ PTY Manager (node-pty)     │  │ render_ui MCP Server          │  │
│  │  spawns `claude` (TUI)     │  │  (in-process MCP endpoint)    │  │
│  └───────────────────────────┘  └───────────────────────────────┘  │
│         spawns / streams                  registered to claude      │
└────────────────────────────────────────────────────────────────────┘
                                │
                       ┌────────▼─────────┐
                       │  Claude Code      │
                       │  (agent engine)   │
                       └───────────────────┘
```

Two independent channels reach the same Claude Code process:

- **TUI channel** — node-pty owns Claude Code's stdin/stdout. ANSI flows to xterm.js;
  keystrokes flow back. This is the unmodified, interactive Claude Code experience.
- **UI-generation channel** — a local MCP server (`render_ui`) is registered with
  Claude Code. When Claude wants to show UI, it calls the tool with an A2UI payload.
  The server forwards the payload to the renderer and returns the user's interaction
  as the tool result.

---

## 4. Components

### 4.1 PTY Manager (main process)
- Uses `node-pty` to spawn the interactive `claude` process with a pseudo-terminal.
- Streams raw stdout (ANSI) to the renderer over IPC; relays renderer keystrokes and
  resize events back into the PTY.
- Owns process lifecycle: spawn, restart, kill, exit handling.

### 4.2 Terminal Panel (renderer)
- `xterm.js` instance bound to the PTY stream. Displays the genuine Claude Code TUI.
- Handles fit/resize, scrollback, and forwards input events to the main process.

### 4.3 render_ui MCP Server (main process)
- An in-process MCP server exposing one primary tool, `render_ui(spec)`, where `spec`
  is an A2UI `surfaceUpdate` payload (validated against the A2UI JSON schema).
- On invocation it pushes the payload to the renderer (Tauri-equivalent here: Electron
  `ipcMain` → `ipcRenderer`) and **awaits** a user action.
- Returns the user's action (button pressed, form values) as the tool result, closing
  the loop so Claude can continue reasoning on the response.
- Registered to Claude Code via project-scope `.mcp.json` (or user scope) so the
  interactive TUI session can see it.

### 4.4 Generated-UI Panel (renderer)
- `react-dom` host that renders A2UI payloads via `@easyops-cn/a2ui-sdk`.
- Styling and component set are controlled by cosmos, so generated UI looks native to
  the app. Captures user interactions and sends them back to the MCP server via IPC.

### 4.5 Agent Engine
- Default: interactive `claude` CLI in the PTY.
- Optional: Claude Agent SDK for programmatic/headless control if a feature needs it
  (e.g. background tasks, structured runs) without a visible TUI.

### 4.6 Code Structure & Conventions

The four Electron process roles map to the source tree as follows:

- **main** (`src/main/`) — owns the PTY (`ptyManager.ts`) and all `ipcMain` wiring
  (`index.ts`). Validates every inbound IPC payload at the boundary.
- **preload** (`src/preload/`) — `contextBridge` exposes only the `pty` channel surface as
  `window.cosmos.pty`. No Node globals reach the renderer.
- **renderer** (`src/renderer/`) — React app; `TerminalPanel.tsx` hosts xterm.js + FitAddon.
- **shared** (`src/shared/`) — `ipc.ts` is the single source of truth for channel names and
  payload types (consumed by all three processes); `validate.ts` holds pure, unit-tested
  validators.

Conventions:
- One typed IPC contract in `src/shared/ipc.ts`; never define channel strings ad hoc.
- IPC validators are pure functions with an injectable logger (testable without Electron).
- Invalid payloads warn and are ignored — never crash the process.

---

## 5. Key Flow: Agent Generates UI

```
User types in xterm.js
   → PTY → Claude Code reasons
   → Claude calls render_ui(A2UI spec)        [UI-generation channel]
   → MCP server pushes spec to renderer via IPC
   → A2UI panel renders native components
   → User interacts (clicks "Confirm", fills form)
   → renderer sends action to MCP server via IPC
   → render_ui returns action as tool result
   → Claude continues with the user's response
```

The TUI keeps showing Claude's textual reasoning the whole time; the rich UI appears
in the side panel. The two stay in sync because both ultimately talk to the same
Claude Code process.

---

## 6. Why Not Alternatives

- **Extend the Claude Code TUI directly** — impossible; it is a fixed Ink/terminal app
  with no plugin surface for custom graphical components.
- **Parse A2UI out of the TUI text stream** — fragile; the interactive TUI emits ANSI
  for humans, not clean JSON. A dedicated MCP channel avoids back-parsing.
- **Headless-only (no real TUI)** — loses the "show the actual Claude Code screen"
  requirement. Kept available via the Agent SDK for features that need it.
- **Ink in the webview** — Ink renders to a TTY, not the DOM. The only way to show
  Ink/TUI output in a webview is xterm.js + PTY, which is exactly what cosmos does.

---

## 7. Open Questions / Next Steps

1. ~~**PoC milestone 1** — node-pty spawns `claude`, xterm.js shows the live TUI.~~ Built
   (`src/main`, `src/preload`, `src/renderer`, `src/shared`); build green, tests pass.
   Live-GUI visuals (SC-001..SC-003) still need manual verification via `npm run dev`.
2. **PoC milestone 2** — `render_ui` MCP server pushes an A2UI surface to the panel and
   returns a user action as the tool result.
3. Decide the interaction contract for A2UI actions (naming, schema) shared between the
   MCP server and the renderer.
4. Decide whether session control stays purely interactive (PTY) or adds Agent SDK for
   background work.
5. codegraph index (`codegraph init`) once the codebase has real source to index.
