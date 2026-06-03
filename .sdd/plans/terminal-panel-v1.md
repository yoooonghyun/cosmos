# Plan: Terminal Panel — v1

**Status**: In Progress
**Created**: 2026-06-03
**Last updated**: 2026-06-03
**Approved decisions**: electron-vite + React + npm (confirmed 2026-06-03)
**Spec**: .sdd/specs/terminal-panel-v1.md

---

## Summary

Build the cosmos Electron shell and its first feature: a Terminal Panel that hosts the
interactive `claude` process via **node-pty** in the main process and renders its live
TUI in an **xterm.js** panel in the renderer. Main and renderer communicate over a small,
typed IPC surface exposed through a `contextBridge` preload. Scaffolding uses
**electron-vite** (TypeScript + React) with **vitest** for unit tests; node-pty (a native
addon) is rebuilt for Electron's ABI.

## Technical Context

| Item              | Value                                                                 |
|-------------------|-----------------------------------------------------------------------|
| Language          | TypeScript                                                            |
| Build/dev tool    | electron-vite (Vite-based main/preload/renderer)                      |
| UI                | React + react-dom (renderer); xterm.js panel                          |
| Key dependencies  | `electron`, `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `react`, `react-dom`; dev: `electron-vite`, `vitest`, `@electron/rebuild`, `typescript` |
| Native rebuild    | `@electron/rebuild` (or `electron-builder install-app-deps`) for node-pty |
| Files to create   | see checklist Phase 3                                                  |
| Files to modify   | none yet (greenfield); later `docs/ARCHITECTURE.md`, `CLAUDE.md`      |

### Key decisions
- **electron-vite** over electron-forge: cleaner separation of main/preload/renderer with Vite, fast HMR for the React renderer, good TS defaults.
- **node-pty native rebuild** is a known gotcha (SC-004): wire a `postinstall`/rebuild step so it loads under Electron's runtime, not system Node.
- **Security baseline** (FR-006): `contextIsolation: true`, `nodeIntegration: false`, `sandbox` compatible preload exposing only `pty` channels.
- **IPC contract** centralized in a shared `types.ts` consumed by main, preload, and renderer.

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates.

### Phase 0 — Scaffold
- [x] `npm init` + install deps; scaffold electron-vite TS+React project structure
- [x] Configure `tsconfig`, electron-vite config (main/preload/renderer entries)
- [x] Wire node-pty native rebuild for Electron ABI; verify it loads (SC-004) — `postinstall` runs `electron-rebuild`; verified by launching Electron and spawning a PTY (data + exit observed).
- [x] App launches an empty BrowserWindow with secure webPreferences (FR-006) — window built; live GUI launch not visually verified here (see manual-verification note).

### Phase 1 — Interface (Step 3)
- [x] Define IPC channel + payload types in `src/shared/ipc.ts` (PtyData, PtyInput, PtyResize, PtyExit, channel names) — plus `pty:restart`.
- [x] Define preload-exposed API surface type (`window.cosmos.pty`) — `PtyApi` / `CosmosApi`.
- [x] Review types against spec — every field traces to an FR; no invented properties.

### Phase 2 — Testing (Step 4)
- [x] Happy path: valid `pty:input` / `pty:resize` payloads parse and pass through (FR-004, FR-005)
- [x] Missing optional field does not error — see deviation: inbound payloads have NO optional fields; covered the valid analogs (empty-string `data`, tolerated extra fields).
- [x] Invalid/missing required field → logs a warning and is safely ignored (FR-010, SC-005) — 29 tests pass.

### Phase 3 — Implementation (Step 5)
- [x] `src/main/ptyManager.ts` — spawn `claude` via node-pty, cwd = project root (FR-001, FR-009), stream output (FR-002), write input (FR-004), resize (FR-005), exit detection (FR-007), restart (FR-008), payload validation (FR-010 — at IPC boundary in index.ts).
- [x] `src/main/index.ts` — create window, wire ipcMain handlers to ptyManager, teardown on reload (edge case) + before-quit + window-all-closed kill.
- [x] `src/preload/index.ts` — `contextBridge` expose only `pty` channels (FR-006).
- [x] `src/renderer/TerminalPanel.tsx` — xterm.js + FitAddon, bind to IPC, send input/resize (debounced), render data (FR-003), show exit + restart control (FR-007, FR-008).
- [x] `claude` not found → error shown in panel, no crash (edge case) — see deviation: added a PATH pre-check because node-pty does NOT throw on missing binary on macOS.
- [x] All tests pass (29/29).

### Phase 4 — Docs (Step 6 / wrap-up)
- [x] Update this plan with deviations (below).
- [x] Reflect code-level structure & conventions into `docs/ARCHITECTURE.md` (§4.6) — single authoritative design reference; no separate design doc.
- [x] Run `wrap-up` skill → reflected into `docs/ARCHITECTURE.md`, `CLAUDE.md`, `developer` agent.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-03 — Dependency versions.** Plan named electron-vite but not exact versions. Pinned: electron 42, electron-vite 5, vite 7 (NOT 8 — electron-vite 5 peer-requires vite ^5||^6||^7), @vitejs/plugin-react 5, react 19, node-pty 1.1, @xterm/xterm 6, @xterm/addon-fit 0.11, vitest 4, typescript 5.7, @electron/rebuild 4. No `--force`/`--legacy-peer-deps` used.
- **2026-06-03 — Shared file name.** Plan said the IPC contract lives in a shared `types.ts`; task instruction said `src/shared/ipc.ts`. Used `src/shared/ipc.ts` (per task) plus a separate pure `src/shared/validate.ts` so the validator is independently unit-testable (FR-010).
- **2026-06-03 — Extra channel.** Added `pty:restart` (R->M) to the contract to satisfy FR-008; the plan's enumerated list (PtyData/Input/Resize/Exit) omitted it. Traces to FR-008.
- **2026-06-03 — "Missing optional field" test.** Inbound payloads (`pty:input`, `pty:resize`) have NO optional fields — every field is required by its FR. The only type with optional fields is the OUTBOUND `PtyExitPayload` (M->R), which the renderer tolerates. The Step-4 "missing optional field does not error" intent is covered by the valid analogs: empty-string `data` is accepted, and unknown/extra fields are tolerated without warning. Noted so this isn't read as a skipped case.
- **2026-06-03 — `claude` not found behavior (SC edge case).** node-pty's `pty.spawn` does NOT throw synchronously for a missing binary on macOS; it spawns and then exits with code 1, no stderr/data. The plan implied a try/catch around spawn would catch it. Added a PATH/executable pre-check in `ptyManager.start()` that emits `onExit({ error })` with a clear "not found on PATH" message before spawning, while keeping the try/catch as a secondary guard. Verified empirically under the Electron runtime.
- **2026-06-03 — Native rebuild (SC-004) verification method.** Could not launch/inspect the full GUI here. Verified node-pty loads under Electron's ABI with a headless Electron main-process script that spawned a PTY (`/bin/echo`), observed streamed data and a clean `onExit`, then quit. Smoke script was removed after verification.
- **2026-06-03 — sandbox:false.** Set `sandbox: false` in webPreferences. `contextIsolation:true` + `nodeIntegration:false` (the FR-006 requirements) are kept; sandbox is left off so the preload can use `ipcRenderer` reliably across Electron 42. The renderer still only sees the `pty` channels.
