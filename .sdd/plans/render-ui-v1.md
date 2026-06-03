# Plan: render_ui MCP Server & Generated-UI Panel — v1

**Status**: In Progress
**Created**: 2026-06-03
**Last updated**: 2026-06-03
**Approved decisions**: spec render-ui-v1 approved 2026-06-03; transport + A2UI mapping decided in this plan (see Key Decisions)
**Spec**: .sdd/specs/render-ui-v1.md

---

## Summary

Build cosmos's second channel: a `render_ui` MCP tool that lets the interactive `claude`
session render A2UI surfaces in the Generated-UI panel and get the user's interaction back
as the tool result. The tool is implemented as a **stdio MCP server entry script** that the
`claude` CLI spawns (per project-scope `.mcp.json`); that script bridges to the existing
Electron main process over a local IPC socket, so the surface reaches the renderer and the
user's action flows back to resolve the tool call. The renderer renders surfaces with the
A2UI React SDK and reports actions. Main↔renderer IPC follows the milestone-1 pattern: one
typed contract in `src/shared/ipc.ts`, pure validators in `src/shared/validate.ts`, invalid
payloads warned-and-ignored at the boundary, and a new `window.cosmos.ui` preload surface
exposed alongside `window.cosmos.pty`.

## Technical Context

| Item              | Value                                                                 |
|-------------------|-----------------------------------------------------------------------|
| Language          | TypeScript                                                            |
| Build/dev tool    | electron-vite (existing); the MCP entry script is bundled/emitted as a standalone Node script the CLI can spawn |
| UI                | React 19 + react-dom (existing renderer); A2UI panel via the A2UI React SDK |
| New deps (renderer) | `@a2ui-sdk/react` (A2UI React renderer; provides `A2UIProvider`, `A2UIRenderer`, `useA2UIMessageHandler`, types) |
| New deps (main / entry script) | `@modelcontextprotocol/sdk` (official TS MCP SDK — `McpServer` + `StdioServerTransport`); `zod` (tool input schema, an MCP SDK peer) |
| Local bridge      | Node `net` IPC (Unix domain socket / named pipe) between the spawned MCP entry script and Electron main — no extra dep |
| Files to create   | see checklist Phase 1/Phase 3                                         |
| Files to modify   | `src/preload/index.ts` (add `window.cosmos.ui`), `src/shared/ipc.ts`, `src/shared/validate.ts`, `src/main/index.ts` (wire UI IPC + bridge server lifecycle), renderer app shell (mount the panel); later `docs/ARCHITECTURE.md` |

### Pinned versions (proposed; confirm exact at install — see Deviations placeholder)

- `@a2ui-sdk/react` **0.4.0** (peer-requires react/react-dom ^19 — matches the repo's react 19). Uses versioned protocol subpaths, e.g. `@a2ui-sdk/react/0.8`. Pulls in `@a2ui-sdk/types` 0.4.0 and `@a2ui-sdk/utils` 0.4.0 transitively.
- `@modelcontextprotocol/sdk` **^1.x** (latest 1.x at install) — official MCP TypeScript SDK.
- `zod` **^3.x** — input-schema validation for the MCP tool (MCP SDK convention/peer).

---

## Resolved Open Questions

### 1. MCP transport / registration mechanics (the load-bearing decision)

**Finding (researched).** Claude Code launches `.mcp.json` `type: "stdio"` servers as
**subprocesses** and speaks JSON-RPC over the child's stdin/stdout (confirmed:
modelcontextprotocol.io transports — "the client launches the MCP server as a subprocess";
code.claude.com `.mcp.json` schema — stdio servers `{command, args, env}` "run as local
processes"). Therefore an MCP server living **literally inside the Electron main process is
not directly reachable** by the separately-spawned `claude` CLI: the CLI will spawn its own
child and talk stdio to *that*, not to our already-running Electron process.

Claude Code does set `CLAUDE_PROJECT_DIR` in the spawned server's env, and `.mcp.json`
supports `${VAR}` expansion — useful for locating our app and the bridge socket.

**Decision — stdio entry script + local-socket bridge to Electron main.**
- A small standalone **MCP entry script** (`src/mcp/renderUiServer.ts`, emitted to a bundled
  Node script) is what `.mcp.json` spawns. It builds an `McpServer` over
  `StdioServerTransport`, exposes the `render_ui` tool, and on each call **forwards the spec
  to the running Electron main process over a local IPC socket** (Unix domain socket on
  macOS, path derived from `CLAUDE_PROJECT_DIR` or a fixed app-data path), then awaits the
  user's action from main and returns it as the tool result.
- The **Electron main process hosts the bridge socket server** (`src/main/uiBridge.ts`) and
  owns the actual surface↔renderer IPC (`ui:render` / `ui:action`). Main is the single owner
  of pending-call state and `requestId` correlation.
- `.mcp.json` (project root) registers the server as stdio:
  ```json
  {
    "mcpServers": {
      "cosmos-render-ui": {
        "type": "stdio",
        "command": "node",
        "args": ["${CLAUDE_PROJECT_DIR:-.}/out/mcp/renderUiServer.js"]
      }
    }
  }
  ```

**Tradeoff & why.** This is one more hop (CLI → stdio entry script → socket → main → IPC →
renderer) than the architecture's "in-process" wording implies, but it is the only design
that satisfies MCP's stdio model *and* reaches our live Electron renderer. Alternatives
rejected: (a) a pure in-process MCP server — unreachable by the spawned CLI as shown above;
(b) HTTP/streamable-HTTP transport — viable (main could host a localhost MCP endpoint and
`.mcp.json` points at the URL), but adds an HTTP listener + Origin/DNS-rebind hardening the
PoC does not need, and stdio is the MCP-preferred local transport ("clients SHOULD support
stdio whenever possible"); (c) Agent SDK in-process — abandons the "show the real CLI TUI"
requirement (ARCHITECTURE §6). HTTP transport is noted as the clean upgrade path if the
socket bridge proves limiting.

**ARCHITECTURE.md refinement (apply at wrap-up, not now).** §4.3 says the MCP server is
"in-process … Electron `ipcMain` → `ipcRenderer`." Refine to: the `render_ui` MCP server is
a **stdio entry script the `claude` CLI spawns**, which **bridges to the Electron main
process over a local socket**; main then does `ipcMain → ipcRenderer`. The §3 diagram's
"render_ui MCP Server … registered to claude" box should show the stdio-script + socket-bridge
split. No product-behavior change — only the transport mechanics are made precise.

### 2. A2UI surfaceUpdate schema + SDK event model → action mapping

**Finding (researched).** The renderer SDK is the easyops-cn A2UI implementation, published
as **`@a2ui-sdk/react`** (v0.4.0), supporting A2UI protocol v0.8 (stable) / v0.9 (draft).
(Note: ARCHITECTURE/spec name it `@easyops-cn/a2ui-sdk`; the npm package is `@a2ui-sdk/react`
— recorded as a deviation to confirm at install.) Host pattern:
```tsx
<A2UIProvider>
  <A2UIRenderer onAction={handleAction} />
</A2UIProvider>
// const { processMessage } = useA2UIMessageHandler(); processMessage(a2uiMessage)
```
A2UI agent→client messages include `surfaceUpdate`, `dataModelUpdate`, `beginRendering`,
`deleteSurface`. The client→agent **userAction** is delivered to the host via the
`onAction(action: A2UIAction)` callback; `A2UIAction` carries an **action name**, the
**`surfaceId`** and **`componentId`** that fired, plus a context/values payload (e.g. form
field values via the SDK's JSON-Pointer data-binding model). Types come from
`@a2ui-sdk/types`.

**Mapping to the spec's contract (FR-008, holds).** The cosmos-owned channel/correlation
shape stays exactly as the spec proposed; we map the SDK's `A2UIAction` onto it in the
renderer:
- `render_ui` arg `spec` = the A2UI `surfaceUpdate` message → fed to `processMessage` in the
  renderer (we may also synthesize the required `beginRendering` per SDK requirements — a
  rendering detail handled in Phase 3).
- SDK `onAction(a2uiAction)` → cosmos `ui:action` payload
  `{ requestId, action: { type: 'submit', actionId, values } }` where `actionId` ← the SDK
  action name / `componentId`, and `values` ← the SDK action's bound data/context.
- The panel's **dismiss/cancel** affordance (cosmos-owned chrome, not an SDK event) →
  `{ requestId, action: { type: 'cancel' } }` (FR-009).

**No behavioral spec change required.** The SDK's real event model is a superset of what the
spec needs; the spec's `submit`/`cancel` + `actionId` + `values` contract maps cleanly. The
exact `A2UIAction` field names (`action` vs `actionName`, where values live) are confirmed
against `@a2ui-sdk/types` during Phase 1 — an implementation detail, not a scope change.

---

## Key Decisions

- **Stdio MCP entry script + local-socket bridge to Electron main** (see Resolved Q1). Main owns pending-call/`requestId` state; the entry script is a thin stdio↔socket relay.
- **A2UI React SDK `@a2ui-sdk/react`** renders surfaces; `onAction` is mapped to the cosmos `ui:action` contract (see Resolved Q2). Cancel is app chrome, not an SDK event.
- **IPC contract reuse.** New channels `ui:render` (M→R) and `ui:action` (R→M) live in `src/shared/ipc.ts` next to `PtyChannel`; validators in `src/shared/validate.ts`; boundary warns-and-ignores invalid action payloads (FR-010) — mirrors milestone 1.
- **Dedicated preload surface.** Preload exposes `window.cosmos.ui` (render listener + action sender) alongside `window.cosmos.pty`; security baseline unchanged (FR-011).
- **A2UI spec validation at the MCP boundary** (FR-003): the entry script / main validates the arg is a well-formed `surfaceUpdate` before pushing; invalid → warn + error tool result + safe panel fallback, never crash.
- **Single active surface** (FR-014): a new `render_ui` supersedes the current surface; the superseded pending call resolves `cancel`/superseded (FR-009, edge case). Renderer-reload or bridge-disconnect while pending → resolve `cancel` so Claude never hangs.
- **`requestId` minted in main** per call (FR-012); the entry script echoes it on the round trip so the right pending call resolves.

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates.

### Phase 0 — Deps & registration
- [x] Install `@a2ui-sdk/react` (renderer) and `@modelcontextprotocol/sdk` + `zod` (main/entry); pin exact versions, record in Deviations. Confirm the real package name (`@a2ui-sdk/react` vs spec's `@easyops-cn/a2ui-sdk`). — Installed `@a2ui-sdk/react@0.4.0`, `@modelcontextprotocol/sdk@1.29.0`, `zod@^3` clean, no peer conflicts.
- [x] Smoke-verify the MCP SDK builds an `McpServer` over `StdioServerTransport` under the repo's Node/TS toolchain. — Drove a real stdio `initialize` + `tools/list` handshake against the emitted entry; server returns `serverInfo` and advertises `render_ui`.
- [x] Add project-root `.mcp.json` registering `cosmos-render-ui` as a stdio server (command `node`, args → emitted entry script). — Created; `args` point at `out/main/mcp/renderUiServer.js` (emit-path deviation, see below). `claude mcp list` / `/mcp` discovery (SC-001) remains manual.
- [x] Confirm electron-vite emits the entry script (`src/mcp/renderUiServer.ts`) to a stable path the `.mcp.json` `args` point at. — Verified: emits to `out/main/mcp/renderUiServer.js` (NOT the plan's `out/mcp/...`; see Deviations). Shared `bridge` chunk co-emitted under `out/main/chunks/` and resolves.

### Phase 1 — Interface (Step 3)
- [x] Add to `src/shared/ipc.ts`: `UiChannel` (`ui:render` M→R, `ui:action` R→M), `A2uiSurfaceUpdate` (typed alias over the SDK's surfaceUpdate message type), `UiRenderPayload { requestId, spec }`, `UiActionPayload { requestId, action }`, `A2uiAction { type: 'submit'|'cancel', actionId?, values? }`. — Done; `A2uiSurfaceUpdate = SurfaceUpdatePayload` from `@a2ui-sdk/types/0.8`.
- [x] Define the bridge protocol types (entry-script ↔ main over the socket). — `src/shared/bridge.ts`: `BridgeRenderRequest {kind:'render',callId,spec}` (S→M) and `BridgeResultResponse {kind:'result',callId,action}` (M→S), `bridgeSocketPath()`, `encodeBridgeMessage()`. Note: bridge uses its own `callId`; main mints the renderer-facing `requestId` separately (FR-012) and maps the two.
- [x] Extend the preload API type: `window.cosmos.ui` = `{ onRender(listener): unsubscribe, sendAction(payload): void }`. — Added `UiApi`; `CosmosApi` now `{ pty, ui }`.
- [x] Confirm the SDK `A2UIAction` field names against `@a2ui-sdk/types`; finalize the `actionId`/`values` mapping. — Confirmed against installed types (see Deviations: final mapping).

### Phase 2 — Testing (Step 4)
- [x] Validator happy path: a well-formed `ui:action` (`submit` with `actionId`/`values`, and `cancel`) parses and passes (FR-006, FR-010). — `src/shared/validateUi.test.ts`.
- [x] Validator rejects invalid action payloads (missing `requestId`, bad `type`, malformed `values`) → warns + ignored; does NOT resolve a pending call (FR-010, SC-006).
- [x] A2UI spec validation: a non-`surfaceUpdate` / malformed spec is rejected (FR-003, SC-005). — `validateSurfaceUpdate` + tests.
- [x] requestId correlation: an action with an unknown/stale `requestId` is ignored, not mis-resolved (FR-012). — `src/main/pendingCalls.test.ts`.
- [x] Pending-call resolution rules: cancel/supersede/disconnect each resolve exactly once (FR-009). — `PendingCallRegistry` tests cover submit/cancel/supersede/cancelCurrent + resolve-once.

### Phase 3 — Implementation (Step 5)
- [x] `src/mcp/renderUiServer.ts` — `McpServer` + `StdioServerTransport`; `render_ui(spec)` tool (zod input); validate spec (FR-003); relay to main over the socket; await + return the action as the tool result (FR-001, FR-007); error tool result on invalid spec; `cancel` (incl. bridge-unreachable) returned as a normal result with `structuredContent.action` (FR-009).
- [x] `src/main/uiBridge.ts` — local socket server; mint `requestId` (FR-012); push `ui:render` to renderer (FR-004); track the active call; resolve on `ui:action`; resolve `cancel` on supersede/renderer-reload/disconnect (FR-009, edge cases). Pending-call rules extracted to `src/main/pendingCalls.ts` (pure, unit-tested); `UiBridge` applies the same single-active-surface logic over live sockets.
- [x] `src/main/index.ts` — start/stop the bridge with app lifecycle; wire `ipcMain` for `ui:action` with boundary validation (FR-010); cancel active call on renderer reload; clean teardown on close/quit (no orphaned socket).
- [x] `src/preload/index.ts` — `contextBridge` expose `window.cosmos.ui` (onRender + sendAction) alongside `pty`; nothing else (FR-011).
- [x] `src/renderer/` — `GeneratedUiPanel.tsx`: `A2UIProvider` + `A2UIRenderer`; `useA2UIMessageHandler().processMessage` on `ui:render` (synthesizes `beginRendering` from the surfaceUpdate, FR-005); map `onAction` → `ui:action` `submit` (FR-006); a Dismiss affordance → `ui:action` `cancel` (FR-009); single active surface, replace on new render (FR-014); safe fallback on failed render (SC-005). Mounted beside `TerminalPanel` in `App.tsx`; TUI stream untouched (FR-013, SC-007).
- [ ] End-to-end: `render_ui` renders a surface, submit returns the action, cancel returns the cancel result (SC-002, SC-003, SC-004). — **Requires live GUI + `claude` run; could not be exercised here. Manual verification pending.**
- [x] All tests pass. — 62 passing (3 files); `npm run build` + `npm run typecheck` green.

### Phase 4 — Docs (Step 6 / wrap-up)
- [ ] Record deviations below (exact pinned versions; real SDK package name; final `A2UIAction` mapping; any electron-vite emit-path adjustments).
- [ ] Apply the ARCHITECTURE.md refinement from Resolved Q1 (§3 diagram + §4.3 wording: stdio entry script + socket bridge, not literally in-process) and mark §7 items 2 and 3 resolved.
- [ ] Run `wrap-up` skill → propagate learnings into `docs/ARCHITECTURE.md`, `CLAUDE.md`, agents.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-03 — SDK package name (verified via npm).** Spec/ARCHITECTURE name `@easyops-cn/a2ui-sdk`, which **does not exist on npm (404)**. The published React package is `@a2ui-sdk/react` (v0.4.0, confirmed via `npm view`), with versioned protocol subpaths (`@a2ui-sdk/react/0.8`) and a sibling `@a2ui-sdk/types`. `@modelcontextprotocol/sdk` confirmed at 1.29.0. ARCHITECTURE stack table to be corrected at wrap-up.
- **2026-06-03 — "In-process" wording refined.** Research showed `.mcp.json` stdio servers are spawned as subprocesses, so a literally in-process MCP server is unreachable by the CLI. Chose a stdio entry script + local-socket bridge to Electron main. ARCHITECTURE §3/§4.3 to be refined at wrap-up (see Resolved Q1). Behavior unchanged.
- **2026-06-03 — Exact installed versions.** `@a2ui-sdk/react@0.4.0` (+ transitive `@a2ui-sdk/types@0.4.0`, `@a2ui-sdk/utils@0.4.0`), `@modelcontextprotocol/sdk@1.29.0`, `zod@3.x`. `npm install` added 143 packages with **0 peer conflicts** — no `--force`/`--legacy-peer-deps` needed. Vite stays pinned at 7.
- **2026-06-03 — electron-vite emit path (plan said `out/mcp/...`; actual `out/main/mcp/...`).** electron-vite only has main/preload/renderer config sections — there is no separate `mcp` output dir. Added the entry as a second `main` rollup input keyed `mcp/renderUiServer`, which emits to **`out/main/mcp/renderUiServer.js`** (main's outDir + the key path). `.mcp.json` `args` updated to that path. The shared `bridge` module is co-emitted as `out/main/chunks/bridge-*.js` and resolves via relative import. Verified the emitted script has **no `electron` import** (runs as plain Node) and passes a real stdio MCP `initialize` + `tools/list` handshake advertising `render_ui`.
- **2026-06-03 — A2UI SDK API shapes (confirmed against installed `@a2ui-sdk/react@0.4.0` / `@a2ui-sdk/types@0.4.0`).** Public API is namespaced under subpaths: import from `@a2ui-sdk/react/0.8`. `A2UIProvider` takes optional `messages?`/`catalog?`; **`onAction` is a prop of `A2UIRenderer`** (`A2UIRendererProps.onAction: ActionHandler`), not of the provider. Incremental rendering uses `useA2UIMessageHandler().processMessage(message: A2UIMessage)` (hook → must run inside the provider). The SDK's action type is `ActionPayload` (re-exported as `A2UIAction`) = `{ surfaceId, name, context: Record<string,unknown>, sourceComponentId }`. **Final cosmos mapping:** `actionId` ← `ActionPayload.name`; `values` ← `ActionPayload.context`. (`surfaceId`/`sourceComponentId` were available but the spec's contract needs neither, so they are not carried — no invented fields.)
- **2026-06-03 — `beginRendering` synthesized in the renderer.** The A2UI SDK requires a `beginRendering` message to initialize a surface before a `surfaceUpdate`. The `render_ui` arg is only the `surfaceUpdate`, so the panel synthesizes `{ beginRendering: { surfaceId, root: components[0]?.id ?? surfaceId } }` before processing the update (plan Resolved Q2, "may synthesize beginRendering"). The `root` heuristic (first component id) is unverified against real multi-component surfaces — flagged for manual GUI check.
- **2026-06-03 — Bridge `callId` vs renderer `requestId` (two-id design).** To keep FR-012 correlation watertight across the extra socket hop, the entry script tags each tool call with its own `callId`; Electron main mints a separate renderer-facing `requestId` and maps `callId↔requestId`. A malformed renderer `ui:action` therefore can never resolve the wrong tool call. Pure resolution rules live in `src/main/pendingCalls.ts` (`PendingCallRegistry`), unit-tested; `UiBridge` mirrors the single-active-surface rule over real sockets.
- **2026-06-03 — Cancel returned as a normal tool result, not `isError`.** Only an invalid/malformed spec yields `{ isError: true }` (FR-003). A user cancel/dismiss/supersede/disconnect resolves the tool with a normal result whose text says "cancelled" and `structuredContent.action = { type: 'cancel' }` (FR-009: an explicit, distinguishable cancelled result — not an error, not empty, never a hang).
