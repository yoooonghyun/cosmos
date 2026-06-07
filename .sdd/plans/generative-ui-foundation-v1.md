# Plan: Generative UI Foundation — v1

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: .sdd/specs/generative-ui-foundation-v1.md

---

## Summary

Add a natural-language prompt input to the Generated-UI panel and a NEW headless
agent runner in the Electron main process. On submit, the renderer sends the utterance
string over a dedicated typed IPC channel (`agent:*`, exposed as `window.cosmos.agent`).
A new main-process manager — `AgentRunner` — receives the utterance and processes it by
spawning the already-installed `claude` binary in headless print mode as a non-PTY child
process (`child_process.spawn`): `claude -p "<utterance>" --mcp-config <render_ui config>
--permission-mode dontAsk --allowedTools "mcp__cosmos-render-ui__render_ui"
--output-format json`. NO new npm dependency is added — the runner reuses the same
`claude` binary as the interactive PTY TUI, so it inherits the `~/.claude` login
automatically (no `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` injected). The runner is
granted ONLY the existing `render_ui` MCP tool by passing the SAME stdio server
registration that the interactive `claude` uses (`mcp/renderUiServer.js` +
`COSMOS_BRIDGE_SOCKET` pointing at the existing `UiBridge` socket) via `--mcp-config`, and
scopes `--allowedTools` to just `mcp__cosmos-render-ui__render_ui`. The child's
`render_ui` calls therefore land in the EXISTING `UiBridge → ui:render` path and the
surface appears in the same panel — no second rendering path. The runner is a separate
channel from the interactive Terminal PTY: the two never spawn, kill, write to, or
share a stream with each other (they are independent child processes that both read the
same read-mostly `~/.claude` login). The runner detects completion/error from the child's
`--output-format json` stdout and exit code (0 = `completed`, non-zero / spawn failure =
`error`) and emits `started` / `completed` / `error` lifecycle status to the renderer so
the prompt input shows in-progress and error states and returns to idle. Concurrency is
**single-run**: while a run is in progress the input is disabled (blocked-while-running).
`AgentRunner` mirrors the `PtyManager`/`UiBridge` lifecycle — constructed in
`createWindow`, torn down on window close / app quit / renderer reload (killing any
in-flight child).

## Technical Context

| Item              | Value                                                                                                                                                                                                                                                                                                       |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer), ES modules                                                                                                                                                                                                                                                     |
| Key dependencies  | **NO new npm dependency.** The runner spawns the already-installed `claude` binary via Node's built-in `node:child_process` (`spawn`). Existing: `@modelcontextprotocol/sdk`, `@a2ui-sdk/react`, existing `UiBridge` + `renderUiServer.js` stdio MCP entry, the existing render_ui MCP registration pattern (currently inline in `embeddedMcpConfig`), and `PtyManager`'s `claude`-on-PATH resolution/pre-check (to be reused)                |
| Files to create   | `src/main/agentRunner.ts` (new manager); `src/main/agentRunner.test.ts` (unit tests, optional pure-logic seams); `src/shared/validate.test.ts` additions (new validator); renderer test (if any) co-located                                                                                                  |
| Files to modify   | `src/main/mcpConfig.ts` (new shared `render_ui` entry builder) — see refactor below; `src/main/index.ts` (`embeddedMcpConfig` uses the shared builder; construct/teardown + IPC handlers); `src/shared/ipc.ts` (new `AgentChannel` + `AgentApi` types + add to `CosmosApi`); `src/shared/validate.ts` (`validateAgentPrompt`); `src/preload/index.ts` (`agentApi` namespace); `src/renderer/GeneratedUiPanel.tsx` (prompt input + run-status UI) |
| Out of scope      | Granting slack/jira/confluence (or any non-`render_ui`) tools to the runner; utterance-based editing of an existing surface; persistence; multi-turn history UI; explicit cancel affordance; concurrency/queueing                                                                                            |

### Resolved open questions (from the spec)

1. **Concurrency policy** → **single-run / blocked-while-running.** While a headless
   run is in progress the prompt input is disabled; there is NO queue and NO concurrency.
   `AgentRunner` tracks a single in-flight run; a `submit` received while busy is
   ignored by the runner (and the disabled input prevents it in the UI). Stated
   explicitly to close FR-003's open edge case.

2. **Headless transport + how the runner reaches `render_ui`** → **spawn the
   already-installed `claude` binary in headless print mode** (NOT the
   `@anthropic-ai/claude-agent-sdk`), reusing the same `render_ui` stdio MCP
   registration against the existing `UiBridge`. The runner runs, via
   `node:child_process.spawn` (no PTY):
   ```
   claude -p "<utterance>" \
     --mcp-config <render_ui-only config JSON> \
     --permission-mode dontAsk \
     --allowedTools "mcp__cosmos-render-ui__render_ui" \
     --output-format json
   ```
   where `<render_ui-only config JSON>` is exactly the SAME single-server stdio entry the
   interactive `claude` registers — `{ mcpServers: { 'cosmos-render-ui': { type: 'stdio',
   command: 'node', args: [<out/main/mcp/renderUiServer.js>], env: { COSMOS_BRIDGE_SOCKET:
   bridgeSocketPath(sandboxDir) } } } }` — built from the SHARED builder (see refactor
   below) so the two configs can't drift. The socket path is the SAME one the
   already-running `UiBridge` listens on, so the child's `render_ui` calls resolve to the
   EXISTING `UiBridge → ui:render` path (FR-007). The runner does NOT start a second
   `UiBridge` and does NOT add a second renderer push path. The headless config contains
   ONLY `cosmos-render-ui` (NOT slack/jira/confluence), and `--allowedTools` grants only
   `mcp__cosmos-render-ui__render_ui` — least-privilege (FR-013 still holds: later specs
   add server entries + allowedTools).

   - **Auth:** the headless child inherits the interactive `claude`'s `~/.claude` login
     automatically — NO `ANTHROPIC_API_KEY`, NO `CLAUDE_CODE_OAUTH_TOKEN` is set. (This is
     why we use the `claude` binary rather than the Agent SDK, whose `query()` does NOT
     reuse the subscription OAuth login and would require an injected key/token.) If the
     user is not logged in, the run exits non-zero with an auth error → surfaced as the
     run's `error` status (FR-014).
   - **Permissions:** `--permission-mode dontAsk` + `--allowedTools` so the non-interactive
     run never blocks waiting on an approval prompt.
   - **Completion / error detection:** parse the child's stdout (`--output-format json`)
     and watch the exit code — exit 0 = `completed`, non-zero (or a spawn failure) =
     `error`. Run lifecycle: `started` on spawn, `completed` on exit 0, `error` on
     non-zero / spawn failure / binary-not-found.
   - **Binary resolution (Electron caveat):** a GUI-launched Electron app may not inherit
     the shell PATH, so `claude` may not be found. The runner MUST resolve the `claude`
     binary the SAME way `PtyManager` already does (it pre-checks the executable on PATH
     before spawning — see `isExecutableResolvable` in `src/main/ptyManager.ts` and the
     CLAUDE.md "`claude` not found does NOT throw" note). If `claude` can't be found,
     surface an `error` status — do NOT hang. The Interface step should factor/reuse that
     resolution rather than reinvent it (extract a tiny shared helper if cleanest).

3. **Cancel affordance** → **deferred** (explicitly out of scope; not requested for this
   foundation). With the blocked-while-running policy the user cannot start a second run,
   so an in-run cancel is unnecessary for v1. Noted as deferred to a later spec.

### Design step (designer agent) — REQUIRED before Interface

This feature adds a renderer surface (the prompt input + run-status indication in
`GeneratedUiPanel`). Per CLAUDE.md, UI-bearing work runs the **design** skill between
plan and interface. The prompt-input UI (text input/textarea, submit affordance,
in-progress/disabled state, error message styling) MUST be specified by the designer
in `.sdd/designs/generative-ui-foundation-v1.md` using the existing Tailwind + shadcn/ui
design system (reuse `@/components/ui/button`, an input/textarea component, and the
existing `border-border`/`bg-card`/`text-destructive` tokens already used in the panel).
Do NOT hand-author ad-hoc CSS for the prompt input in this plan — defer the visual
contract to the design spec.

### Architecture invariants this plan honors

- Window security baseline unchanged: `contextIsolation: true`, `nodeIntegration: false`
  (FR-012). The runner is entirely in main; the renderer sends only the utterance string
  and receives only status (no tokens, secrets, or raw transcript — FR-011/FR-012).
- Every inbound IPC payload validated at the main-process boundary; invalid → warn +
  ignore, never crash, no run started (FR-010).
- `AgentRunner` is the single owner of its lifecycle, mirroring `PtyManager`/`UiBridge`
  (FR-006): constructed in `createWindow`, killed on renderer reload, torn down on
  `closed` / `window-all-closed` / `before-quit`.
- Channel independence: the runner NEVER touches `ptyManager` and the PTY path NEVER
  touches the runner (FR-008). The two are independent child processes; both read the
  same read-mostly `~/.claude` login but each has its own session/transcript, so no
  write-conflict is expected for this usage.
- Structured so additional read-only MCP tools can be granted LATER without
  re-architecting: the headless `--mcp-config` is built from the shared per-server
  entry builder, so adding slack/jira/confluence entries + their `--allowedTools` later
  is additive (FR-013). This spec includes ONLY `cosmos-render-ui` and grants ONLY
  `mcp__cosmos-render-ui__render_ui`.

---

## File-by-file change list

### Create: `src/main/agentRunner.ts`
New main-process manager mirroring `PtyManager`'s shape (constructor takes sinks +
options; `run`-style entry; explicit teardown). Responsibilities:
- Hold single-run state (`isRunning` flag + a handle to the in-flight child); reject/
  ignore a `run()` while busy (single-run policy).
- `run(utterance: string)`: re-validate non-empty (defense in depth; renderer already
  guards FR-004); resolve the `claude` binary (reuse `PtyManager`'s on-PATH pre-check —
  if unresolvable, emit `error` immediately and do NOT spawn, no hang — FR-014/Electron
  PATH caveat); emit `started` via the `onStatus` sink; then `child_process.spawn` the
  headless `claude`:
  - command/binary: `claude` (resolved as above)
  - args: `['-p', utterance, '--mcp-config', renderUiMcpConfigJson(sandboxDir),
    '--permission-mode', 'dontAsk', '--allowedTools',
    'mcp__cosmos-render-ui__render_ui', '--output-format', 'json']`
  - `cwd: sandboxDir`; `env: process.env` (so the child inherits `~/.claude` login —
    do NOT set `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`); stdio piped (capture
    stdout/stderr; no stdin needed — the prompt is the `-p` arg).
  - The `--mcp-config` JSON is built from the SHARED render_ui entry builder (see the
    `mcpConfig.ts` refactor below) wrapped as a single-server `{ mcpServers: { … } }`
    config, pointing at `out/main/mcp/renderUiServer.js` + `COSMOS_BRIDGE_SOCKET:
    bridgeSocketPath(sandboxDir)` (the existing `UiBridge` socket — FR-007). Pass it as a
    JSON string on the command line (matching how the interactive path passes
    `embeddedMcpConfig`).
  - Completion/error: accumulate stdout; on the child's `exit`/`close`, exit code 0 →
    parse the `--output-format json` stdout and emit `completed`; non-zero exit (incl.
    the not-logged-in auth error) → emit `error` with a human-readable message derived
    from stderr/parsed output (FR-014). On the child's `error` event (spawn failure) →
    emit `error`. Always clear `isRunning` + the child handle in a finally-style path so
    the input never hangs.
- Teardown method (e.g. `dispose()`): kill any in-flight child (mirrors
  `PtyManager.kill` — detach handlers first, then `child.kill()`) and mark not running so
  a window close / reload does not leak the runner (edge case: renderer reload while
  running). The runner MUST NOT touch the `UiBridge` (the existing reload handling
  cancels a pending `render_ui` call already).
- NEVER spawns, kills, or writes to the PTY (FR-008). NEVER logs/forwards secrets;
  status payloads carry only `state` + optional human-readable `message`/`runId`
  (FR-011).
- Inject a `spawn`-shaped function (and/or the binary-resolution helper) via the
  constructor/options so the runner's run-lifecycle logic is unit-testable without
  launching a real `claude` process.

### Create: `src/main/mcpConfig.ts` (shared render_ui MCP entry builder — refactor)
Factor the `render_ui` stdio server entry OUT of `embeddedMcpConfig` so BOTH the
interactive PTV config and the headless `--mcp-config` share ONE builder (so they can't
drift). Export:
- `renderUiMcpServerEntry(sandboxDir): McpStdioServerEntry` — returns the single
  `{ type: 'stdio', command: 'node', args: [join(__dirname, 'mcp/renderUiServer.js')],
  env: { COSMOS_BRIDGE_SOCKET: bridgeSocketPath(sandboxDir) } }` object (the exact entry
  currently inlined as `'cosmos-render-ui'` in `embeddedMcpConfig`).
- `renderUiMcpConfigJson(sandboxDir): string` — the headless single-server config:
  `JSON.stringify({ mcpServers: { 'cosmos-render-ui': renderUiMcpServerEntry(sandboxDir) } })`.
This is a pure extraction: no behavior change to the interactive path.

### Modify: `src/main/index.ts` (use the shared builder in `embeddedMcpConfig`)
Replace the inlined `'cosmos-render-ui'` stdio object in `embeddedMcpConfig` with
`renderUiMcpServerEntry(sandboxDir)` (imported from `mcpConfig.ts`). The slack/jira/
confluence entries are unchanged. This guarantees the interactive PTV and the headless
runner register byte-identical render_ui MCP wiring against the same `UiBridge` socket.
(The rest of `src/main/index.ts`'s changes — construct/teardown + IPC handlers — are
described further below.)

### Modify: `src/shared/ipc.ts`
Add a new section for this feature (mirrors the existing `UiChannel` block):
- `AgentChannel` const:
  - `Submit: 'agent:submit'` (R→M: submit an utterance).
  - `Status: 'agent:status'` (M→R: run lifecycle status).
- `AgentSubmitPayload` — `{ utterance: string }` (and nothing else — FR-002).
- `AgentRunState` — `'started' | 'completed' | 'error'`.
- `AgentStatusPayload` — `{ state: AgentRunState; runId?: string; message?: string }`
  (carries only what the panel needs; NO tokens/secrets/transcript — FR-011).
- `AgentApi` interface — `submit(payload: AgentSubmitPayload): void` (R→M send) and
  `onStatus(listener): () => void` (M→R subscription returning an unsubscribe fn,
  matching the existing `on*` convention).
- Add `agent: AgentApi` to `CosmosApi` (alongside, not merged into, `pty`/`ui`/
  `slack`/`jira`/`confluence` — FR-009).

### Modify: `src/shared/validate.ts`
Add `validateAgentPrompt(raw, warn = defaultWarn): AgentSubmitPayload | null`:
- `raw` is an object, `raw.utterance` is a string, and (per FR-004/FR-010) NOT
  whitespace-only. Reuse `isObject`; add a trimmed-non-empty check.
- On invalid: warn (`[agent] ignoring agent:submit — ...`) and return `null` (caller
  ignores → no run started). Return `{ utterance: raw.utterance }` (or trimmed —
  decide at Interface; keep raw value to preserve the user's exact text, only reject if
  trim is empty).

### Modify: `src/preload/index.ts`
Add an `agentApi: AgentApi` namespace mirroring `uiApi`:
- `submit(payload)` → `ipcRenderer.send(AgentChannel.Submit, payload)`.
- `onStatus(listener)` → `ipcRenderer.on(AgentChannel.Status, handler)` returning an
  unsubscribe fn.
- Add `agent: agentApi` to the `api: CosmosApi` object exposed via `contextBridge`.

### Modify: `src/renderer/GeneratedUiPanel.tsx`
Add a prompt input region (visual details deferred to the design spec):
- Local state: `running: boolean`, `error: string | null`, `value: string`.
- Subscribe to `window.cosmos.agent.onStatus` in an effect; drive `running`/`error`:
  `started` → running true, clear error; `completed` → running false; `error` →
  running false, set message (FR-003/FR-011). Detach on unmount (return the unsub fn).
- Submit handler: trim-guard empty/whitespace (FR-004) → if empty, do nothing; else
  `window.cosmos.agent.submit({ utterance })`, set running true optimistically (the
  `started` status confirms), clear the field.
- Disable the input + submit while `running` (single-run / blocked-while-running);
  show the in-progress state and any error message using design-system components.
- The surface still arrives via the EXISTING `ui:render` path already wired in
  `SurfaceBridge` — no change to that flow.

### Modify: `src/main/index.ts` (construct/teardown + IPC handlers)
- Add `let agentRunner: AgentRunner | null = null`.
- In `createWindow`, after `uiBridge.start()`, construct
  `agentRunner = new AgentRunner({ onStatus: (p) => mainWindow.webContents.send(
  AgentChannel.Status, p) }, { sandboxDir })` (pass the SAME `sandboxDir` so the runner's
  `render_ui` registration targets the running `UiBridge` socket — FR-007). The runner
  spawns the `claude` binary itself via `node:child_process`; no SDK handle is injected.
- In `registerIpcHandlers`, add `ipcMain.on(AgentChannel.Submit, (_e, raw) => { const
  p = validateAgentPrompt(raw); if (!p) return; agentRunner?.run(p.utterance) })`
  (validate-at-boundary — FR-010).
- Teardown: in the `did-start-navigation` reload handler call `agentRunner?.dispose()`
  alongside `ptyManager?.kill()` / `uiBridge?.cancelActive()`; in `closed`,
  `window-all-closed`, and `before-quit` dispose + null the runner (mirrors the PTY/
  bridge teardown — FR-006, edge case).
- Do NOT couple the runner to `ptyManager` in any handler (FR-008).

### `electron.vite.config.ts` — no change needed
- **No new rollup `input` is needed.** The runner reuses the EXISTING `mcp/renderUiServer`
  input (already emitted to `out/main/mcp/renderUiServer.js`), which the shared
  `renderUiMcpServerEntry` builder points at. Both `agentRunner.ts` and the new
  `mcpConfig.ts` are part of `src/main/index.ts`'s import graph, so they bundle into
  `out/main/index.js` without a new input.
- **No SDK externalization is needed** — no new npm dependency is added; the runner spawns
  the `claude` binary via Node's built-in `node:child_process`.

### Install step — none
- No `npm install`. The runner relies on the already-installed `claude` binary on the
  user's machine (the same one the interactive TUI spawns).

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates.

### Phase 0 — Design (designer agent; UI-bearing)

- [ ] Produce `.sdd/designs/generative-ui-foundation-v1.md` for the prompt-input region
      (input/textarea, submit affordance, in-progress/disabled state, error message)
      using the existing Tailwind + shadcn/ui tokens and components — no ad-hoc CSS.

### Phase 1 — Interface

- [x] Read the spec and this plan; confirm the decisions are resolved (single-run;
      headless `claude -p` spawn reusing the render_ui stdio registration → existing
      UiBridge; cancel deferred). NO npm install — no new dependency.
- [x] Extract the shared render_ui entry: create `src/main/mcpConfig.ts` with
      `renderUiMcpServerEntry(sandboxDir)` + `renderUiMcpConfigJson(sandboxDir)`; switch
      `embeddedMcpConfig` in `src/main/index.ts` to use `renderUiMcpServerEntry` (pure
      extraction, interactive path unchanged).
- [x] Confirm the headless `claude -p` flag surface (`-p`, `--mcp-config`,
      `--permission-mode dontAsk`, `--allowedTools "mcp__cosmos-render-ui__render_ui"`,
      `--output-format json`) and the shape of the `--output-format json` stdout so the
      runner can map it to completed/error. Confirm the child inherits `~/.claude` login
      with no key/token env. (Plus `--strict-mcp-config` — see Deviation 1.)
- [x] Add `AgentChannel`, `AgentSubmitPayload`, `AgentRunState`, `AgentStatusPayload`,
      `AgentApi` to `src/shared/ipc.ts`; add `agent` to `CosmosApi`. No invented fields —
      every field traces to FR-002/FR-009/FR-011.
- [x] Define the `AgentRunner` constructor/sinks/options signature (with injectable
      `spawn` and/or binary-resolution helper) in `src/main/agentRunner.ts`.
- [x] Add the `validateAgentPrompt` signature to `src/shared/validate.ts`.
- [x] Review types against the spec — no invented properties, no secrets in any payload.

### Phase 2 — Testing

- [x] `validateAgentPrompt`: happy path (valid utterance) → returns payload.
- [x] `validateAgentPrompt`: non-object / missing `utterance` / non-string → `null` + warn.
- [x] `validateAgentPrompt`: empty / whitespace-only utterance → `null` (no run; FR-004).
- [x] `AgentRunner` (with a fake `spawn` returning a fake child): `run()` emits `started`
      then `completed` on a child that exits 0 with valid json stdout; `isRunning` true
      during, false after.
- [x] `AgentRunner`: a child that exits non-zero (e.g. simulated auth/not-logged-in error)
      or emits a spawn `error` event → emits `error` with a message and clears `isRunning`
      (FR-014); never throws out of `run()`.
- [x] `AgentRunner`: the `claude` binary is unresolvable (fake resolver returns false) →
      emits `error` immediately and does NOT spawn (no hang; Electron PATH caveat / FR-014).
- [x] `AgentRunner`: a second `run()` while busy is ignored (single-run policy).
- [x] `AgentRunner`: `dispose()` while running kills the child, clears state, and does not
      emit `completed` (reload/teardown edge case); never touches a PTY (no PTY dependency
      exists — assert by construction).
- [x] `renderUiMcpConfigJson(sandboxDir)`: produces the single-server `cosmos-render-ui`
      stdio config (no slack/jira/confluence) pointing at the bridge socket; matches the
      entry `embeddedMcpConfig` registers.

### Phase 3 — Implementation

- [x] Implement `src/main/mcpConfig.ts` (`renderUiMcpServerEntry` +
      `renderUiMcpConfigJson`) and switch `embeddedMcpConfig` to use it (FR-013;
      no-drift refactor).
- [x] Implement `validateAgentPrompt` (reuse `isObject`; trimmed-non-empty check).
- [x] Implement `AgentRunner` (resolve `claude` via PtyManager's on-PATH pre-check;
      single-run guard; `child_process.spawn` of `claude -p … --mcp-config
      renderUiMcpConfigJson(sandboxDir) --strict-mcp-config --permission-mode dontAsk
      --allowedTools mcp__cosmos-render-ui__render_ui --output-format json`;
      `cwd: sandboxDir`; `env: process.env` with NO key/token; parse json stdout +
      exit code → `started`/`completed`/`error`; `dispose` kills the child).
- [x] Implement `agentApi` in `src/preload/index.ts`; add to the exposed `api`.
- [x] Wire `src/main/index.ts`: construct in `createWindow`, IPC `Submit` handler with
      `validateAgentPrompt`, dispose on reload/close/quit; pass `sandboxDir`.
- [x] Add the prompt input + run-status UI to `GeneratedUiPanel.tsx` per the design spec;
      wire `onStatus` + `submit`; disable while running; show error; clear on completion.
- [x] All tests pass (`npm test` — 270 passing); typecheck clean (`npm run typecheck`);
      build succeeds (`npm run build`).
- [x] Reused shared utilities (`isObject`, existing `on*` preload convention, existing
      `UiBridge`/`ui:render` path, `PtyManager`'s `claude`-on-PATH resolution, the shared
      `renderUiMcpServerEntry` builder) — no duplicated logic, no second render path, no
      drift between interactive and headless render_ui configs.

### Phase 4 — Verify

- [ ] `npm run dev`: type an utterance in the Generated-UI panel → a headless `claude -p`
      child run starts; a `render_ui` surface appears in the SAME panel via the existing
      path (SC-001/002).
- [ ] In-progress disables the input; it returns to idle on completion (SC-003).
- [ ] A forced failure (e.g. unresolvable `claude` binary, or a non-zero/auth exit)
      surfaces an error and leaves the input usable; app does not crash (SC-004).
- [ ] Empty/whitespace submit + a malformed `agent:submit` payload start no run; the
      malformed payload is warned + ignored at the boundary (SC-005).
- [ ] During a headless run the Terminal TUI PTY is unchanged — not spawned, killed,
      restarted, or written to (SC-006).

### Phase 5 — Docs

- [ ] Mark the item done in `TODO.md` (or add it if missing) at wrap-up.
- [ ] Update this plan with any deviations.
- [ ] **Reconcile note (do NOT edit the architecture doc in this plan):** flag for
      `wrap-up` that headless `claude -p` execution is now IN USE for background/
      generative-UI work (NOT the Agent SDK), so `docs/ARCHITECTURE.md` §4.5 (Agent
      Engine — currently "optional/reserved") should be updated to reflect a headless
      `claude -p` child-process runner that reuses the interactive binary's `~/.claude`
      login and the same `render_ui` `--mcp-config`, and §7 Open Question #5 ("interactive
      only vs. add background execution") should be marked resolved (headless `claude -p`
      added alongside the interactive PTY — NO Agent SDK, NO new dependency, NO injected
      key/token). Also note the shared `renderUiMcpServerEntry` builder (one source for the
      interactive + headless render_ui MCP config), the new `window.cosmos.agent` namespace,
      and the `AgentRunner` manager for §4.6.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-06 — Added `--strict-mcp-config` to the headless argv.** The plan's argv
  listed `-p`, `--mcp-config`, `--permission-mode dontAsk`, `--allowedTools`,
  `--output-format json`. The implementation also passes `--strict-mcp-config` (a
  confirmed real flag) so the headless run uses ONLY the servers from `--mcp-config` and
  cannot see any global/user MCP config — strengthening the least-privilege isolation the
  plan already intended (FR-013). No behavior the spec forbids; it narrows scope further.
- **2026-06-06 — Exported `isExecutableResolvable` from `src/main/ptyManager.ts`.** The
  plan's Q2 note allowed extracting a tiny shared helper if cleanest. Rather than move the
  function, I exported the existing one in place so `AgentRunner` reuses the EXACT
  PtyManager PATH pre-check (no duplicated resolution logic). The runner also injects it as
  `resolveExecutable` for testability.
- **2026-06-06 — Used the child's `close` event (not `exit`) for completion detection.**
  `close` fires after the stdio streams (stdout/stderr) have flushed, so the accumulated
  `--output-format json` stdout is complete when we parse it. Functionally equivalent to
  the plan's "on the child's exit/close"; `close` is the correct one for reading piped
  output.
- **2026-06-06 — `npx shadcn@latest add textarea` created the file under a literal `@/`
  dir at the repo root** (it did not resolve the `@` alias). Moved it to
  `src/renderer/components/ui/textarea.tsx` (canonical new-york Textarea, unmodified) and
  removed the stray `@/` directory. The component is otherwise exactly the standard
  shadcn primitive as the design spec specified.
