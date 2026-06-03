# Spec: Terminal Panel — v1

**Status**: Review
**Created**: 2026-06-03
**Supersedes**: —
**Related plan**: .sdd/plans/terminal-panel-v1.md

---

## Overview

The Terminal Panel embeds the **real, interactive Claude Code TUI** inside the cosmos
Electron app. It is PoC milestone 1: prove that node-pty can host `claude` and that its
live terminal output renders, and is interactive, inside an xterm.js panel.

## User Scenarios

### See the live Claude Code TUI · P1

**As a** cosmos user
**I want to** see the actual Claude Code terminal interface inside the app window
**So that** I can use Claude Code without a separate terminal

**Acceptance criteria:**

- Given the app is launched, when the window opens, then the live `claude` TUI is shown in the terminal panel within a few seconds.
- Given `claude` produces colored/styled output, when it renders, then ANSI colors and layout appear correctly in the panel.

### Interact with Claude Code · P1

**As a** cosmos user
**I want to** type into the panel and have it reach Claude Code
**So that** I can drive a real session

**Acceptance criteria:**

- Given the panel has focus, when I type characters, then they are delivered to the `claude` process and echoed/handled as in a normal terminal.
- Given Claude Code responds, when output arrives, then it appears in the panel in real time.

### Resize reflows the TUI · P1

**As a** cosmos user
**I want to** resize the window and have the TUI reflow
**So that** the interface is not clipped or corrupted

**Acceptance criteria:**

- Given the window is resized, when the terminal dimensions change, then the PTY is notified of the new cols/rows and the TUI reflows correctly.

### Process exit & restart · P2

**As a** cosmos user
**I want to** see when the Claude Code process ends and be able to restart it
**So that** I can recover without relaunching the whole app

**Acceptance criteria:**

- Given the `claude` process exits, when it terminates, then the panel shows an exit indication (e.g. an exit line) rather than silently freezing.
- Given the process has exited, when I trigger restart, then a fresh `claude` session starts in the same panel.

---

## Functional Requirements

| ID     | Requirement                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST spawn the interactive `claude` process via node-pty in the Electron main process with a pseudo-terminal. |
| FR-002 | The system MUST stream raw PTY output (bytes, including ANSI escapes) from main to renderer over IPC.         |
| FR-003 | The system MUST render the streamed output in an xterm.js terminal instance in the renderer.                  |
| FR-004 | The system MUST forward keyboard input from xterm.js to the PTY stdin over IPC.                               |
| FR-005 | The system MUST propagate terminal resize (cols, rows) from the renderer to the PTY.                          |
| FR-006 | The renderer MUST run with `contextIsolation: true` and `nodeIntegration: false`; the only main-process surface exposed to it MUST be the PTY IPC channels, via a `contextBridge` preload. |
| FR-007 | The system MUST detect `claude` process exit and signal an exit state to the renderer.                        |
| FR-008 | The system SHOULD allow restarting the `claude` process without restarting the app.                          |
| FR-009 | The system MUST start the PTY with the project root as the working directory.                                |
| FR-010 | The main process MUST validate inbound IPC payloads (input/resize); an invalid or missing required field MUST log a warning and be safely ignored (no crash). |

## Edge Cases & Constraints

- `claude` binary not found on PATH → surface an error in the panel; the app MUST NOT crash.
- Rapid/continuous resize events → coalescing/debouncing is permitted (SHOULD) to avoid flooding the PTY.
- Renderer reload MUST NOT orphan the PTY process (clean teardown / re-attach).
- **Explicitly out of scope** (deferred to later milestones): the A2UI generated-UI panel, the `render_ui` MCP server, multiple concurrent sessions/tabs, persisting scrollback across restarts.

## Success Criteria

| ID     | Criterion                                                                                  |
|--------|---------------------------------------------------------------------------------------------|
| SC-001 | Launching the app shows the live `claude` TUI inside the window.                            |
| SC-002 | Keystrokes reach `claude` and its output renders with correct colors and layout.           |
| SC-003 | Resizing the window reflows the TUI without visual corruption.                              |
| SC-004 | The node-pty native module loads successfully under Electron's runtime (rebuilt for Electron's ABI). |
| SC-005 | An invalid IPC payload logs a warning and does not crash the app.                           |

---

## Open Questions

- (none blocking — build tooling and TS config are implementation decisions handled in the plan)
