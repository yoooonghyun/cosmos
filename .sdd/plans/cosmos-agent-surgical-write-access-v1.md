# Plan: Cosmos Agent Integration Tool Access (Home reads+writes + per-panel surgical writes) — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-agent-surgical-write-access-v1.md`

---

## Grounding

Direct investigation (LLM wiki `wiki_query` unavailable in this environment — substituted
the `MEMORY.md` index; see the spec's Grounding section).

**codegraph_explore queries run for the plan:**

- `AgentRunner renderMcpConfigJsonForTarget allowedToolForTarget groundingPromptForTarget permission-mode dontAsk allowedTools`
  — the three grant functions are PURE and called once per run in `AgentRunner.spawnRun`
  (`renderMcpConfigJsonForTarget(this.sandboxDir, target)`, `allowedToolForTarget(target)`,
  `groundingPromptForTarget(target)`). Confirmed the `generated-ui` defaults: render-only
  server, render-only grant, catalog-only grounding.
- `ConfluenceTool confluence_create_page … confluenceMcpServer … write methods`
  — `confluenceMcpServer.ts` already `registerTool`s `confluence_create_page` /
  `confluence_update_page` / `confluence_create_comment`; `confluenceToolsMcpServerEntry`
  (already registered for the `confluence` target) is the server that exposes them. **No MCP
  exposure work needed for Confluence** — only allow-list + grounding.
- `AgentRunner constructor … index.ts new AgentRunner wiring; JiraManager/ConfluenceManager/SlackManager/GoogleCalendarManager getStatus connection state`
  — `AgentRunner` is constructed in `src/main/index.ts` with an options bag (`sandboxDir`,
  `command`, `spawn`, `defaultSessionId`, …). All four managers live in `index.ts` and each
  exposes `getStatus(): { state }` where `state === 'connected'` is the connected signal
  (non-secret). This is the live source for connected-only gating.

**Read (verbatim):** `src/main/mcpConfig.ts`, `src/mcp/confluenceMcpServer.ts`, the four
managers' `getStatus`, `AgentRunner` constructor/`spawnRun`, `docs/ARCHITECTURE.md` §4.9/§4.10.

---

## Summary

Extend the three pure per-target grant builders in `src/main/mcpConfig.ts` so (1) the
`confluence` per-panel target also grants its three curated, non-destructive write tools
(`confluence_create_page` / `confluence_update_page` / `confluence_create_comment`) plus a
write-permitting grounding clause, and (2) the **Home** `generated-ui` target gains the
**connected integrations'** read + curated-write tools, their MCP tool servers, and a
combined integration-grounding clause — computed per run from the **live connected set**.
The connected set is read in `AgentRunner.spawnRun` via an injected provider (wired in
`index.ts` from the four managers' `getStatus().state === 'connected'`) and threaded into the
three (now connected-aware) builders. Auto-execute is unchanged: granted tools run under the
existing `--permission-mode dontAsk` (no new mode, no `bypassPermissions`, no per-write
confirm). Secrets stay in main — the provider returns booleans only; tokens never enter the
args, the agent, or the timeline.

## Decisions (resolving spec OQs, all user-signed-off per coordinator)

- **OQ-6 Home full-power:** APPROVED — Home gets integration tools.
- **OQ-2/OQ-3 Confluence writes:** all three (create + update + comment).
- **OQ-1 connected-only:** Home is granted ONLY currently-connected integrations; computed
  per run from live `getStatus()`. An unconnected integration is not granted; the agent
  surfaces a Notice.
- **OQ-4 auto-execute:** pure `dontAsk` auto-run, no per-write confirm. Design leaves room
  for a later in-timeline confirm (the grant path is centralized, so a confirm gate could be
  inserted at the `ui:action`/dispatch layer later) but v1 adds none.
- **OQ-7 Home render tools — DECIDED: Home gets the integration DATA tools (reads + curated
  writes) + the generic `render_ui`/`get_ui_catalog` ONLY, NOT the per-integration render
  tools (`render_jira_ui`, …).** Justification: the per-integration render tools + their
  `get_ui_catalog` are the *panels'* surface contract (they stamp `target: 'jira'` etc. and
  route to that panel — §4.4/§4.10). A Home run renders into the Home/Cosmos surface, so it
  must render generically via `render_ui`; granting it `render_jira_ui` would let a Home run
  push a surface into the Jira panel (cross-target routing leak) and balloon the grant. Home
  reads/writes integration DATA, renders generically. So Home's `--mcp-config` registers each
  connected integration's TOOLS server only (`cosmos-jira`, `cosmos-confluence`, …), never its
  render server.
- **OQ-8 grounding shape — DECIDED: a single combined integration-grounding clause assembled
  from the connected set.** One clause lists the connected integrations, restates read-first
  anti-fabrication (render values verbatim from real read results; on not-connected/error
  render a Notice, never fabricate), and grants the sanctioned writes when explicitly asked.
  Assembled per run so it names only connected integrations (keeps it bounded). Reuses the
  existing per-target anti-fabrication wording as building blocks rather than four full prompts.
- **OQ-9 Jira:** document parity only — `JIRA_TOOL_GRANTS` already carries read+write; no
  re-curate.
- **OQ-5 destructive:** curated set is create/update/comment only; no delete tool exists.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main process; plain-Node MCP entry scripts already exist) |
| Key dependencies  | Existing only — `mcpConfig.ts` builders, `AgentRunner`, the four integration managers/bridges/MCP servers. No new runtime deps. |
| Files to create   | `src/main/mcpConfig.test.ts` (node-unit; the builders have NO covering tests today) |
| Files to modify   | `src/main/mcpConfig.ts`, `src/main/agent/agentRunner.ts`, `src/main/index.ts`, `src/main/agent/agentRunner.integration.test.ts` (extend), `docs/ARCHITECTURE.md` (§4.9/§4.10 notes) |
| Out of bounds     | Do NOT touch `slackMcpServer`/`googleCalendar*` write paths (none exist); do NOT add `bypassPermissions`; do NOT remove the `'generated-ui'` target (the concurrent dead-panel cleanup removes the generic *panel*, not the target — see Coordination). |

## Technical approach

### 1. Connected-integration descriptor (pure, secret-free)

Introduce a small descriptor used by the builders and produced by the provider:

```
// in src/main/mcpConfig.ts (or src/shared/ipc.ts if the type is shared)
export interface ConnectedIntegrations {
  jira: boolean
  confluence: boolean
  slack: boolean
  googleCalendar: boolean
}
export const NO_INTEGRATIONS_CONNECTED: ConnectedIntegrations = {
  jira: false, confluence: false, slack: false, googleCalendar: false
}
```

Booleans only — no token, scope, or identity. (Note: connected-only gating uses the
*connection* signal; write-scope gaps are still handled at call time as
`write_not_authorized` → Notice. We do NOT pre-check write scope for the grant — granting the
write tool to a connected-but-read-only token is safe because the manager returns the
structured scope-gap error.)

### 2. Curated Confluence write grants (per-panel + Home)

Add to `mcpConfig.ts`, mirroring `JIRA_TOOL_GRANTS`’ naming:

```
export const CONFLUENCE_WRITE_TOOL_GRANTS: readonly string[] = [
  `mcp__${CONFLUENCE_TOOLS_SERVER_NAME}__${ConfluenceTool.CreatePage}`,
  `mcp__${CONFLUENCE_TOOLS_SERVER_NAME}__${ConfluenceTool.UpdatePage}`,
  `mcp__${CONFLUENCE_TOOLS_SERVER_NAME}__${ConfluenceTool.CreateComment}`
]
```

Keep `CONFLUENCE_TOOL_GRANTS` (the two reads) as-is; compose reads + writes where granted so
the read/write split stays reviewable (FR-006/FR-007). No delete grant (FR-007/OQ-5).

### 3. `allowedToolForTarget(target, connected?)` — connected-aware

- **`confluence` (per-panel):** `[CONFLUENCE_GET_UI_CATALOG_TOOL, CONFLUENCE_RENDER_UI_TOOL,
  ...CONFLUENCE_TOOL_GRANTS, ...CONFLUENCE_WRITE_TOOL_GRANTS]`.
- **`jira`/`slack`/`google-calendar` (per-panel):** unchanged (Jira already read+write; Slack/
  Calendar read-only).
- **`generated-ui` (Home):** start from `[GET_UI_CATALOG_TOOL, RENDER_UI_TOOL]`, then for each
  `connected.*` true, append that integration's DATA-tool grants:
  - jira → `...JIRA_TOOL_GRANTS` (read+write)
  - confluence → `...CONFLUENCE_TOOL_GRANTS, ...CONFLUENCE_WRITE_TOOL_GRANTS`
  - slack → `...SLACK_TOOL_GRANTS` (read-only)
  - google-calendar → `...GOOGLE_CALENDAR_TOOL_GRANTS` (read-only)
  - Home does NOT add any per-integration `get_ui_catalog`/render tool (OQ-7). Empty connected
    set → byte-identical to today (`get_ui_catalog,render_ui`), so the no-integration path is
    unchanged.

A shared internal helper `integrationDataToolGrants(connected)` returns the flat grant list so
the same mapping feeds both the allow-list and (server form) the mcp-config.

### 4. `renderMcpConfigJsonForTarget(sandboxDir, target, connected?)` — connected-aware

- **`generated-ui`:** `mcpServers` = `{ 'cosmos-render-ui': renderUiMcpServerEntry(...) }` plus,
  for each connected integration, its TOOLS server entry only:
  `jiraToolsMcpServerEntry` / `confluenceToolsMcpServerEntry` / `slackToolsMcpServerEntry` /
  `googleCalendarToolsMcpServerEntry`. NO per-integration render server (OQ-7). Empty set →
  identical to today’s `renderUiMcpConfigJson`.
- The integration tool servers connect to the SAME already-running per-`sandboxDir` bridges
  the panels use (the bridges are process-global per socket path, started in `index.ts`
  regardless of target), so Home needs no new bridge wiring.
- Per-panel branches unchanged except they already register their own tool server (Confluence
  already registers `confluenceToolsMcpServerEntry`, which exposes the writes — FR-009 already
  satisfied; the plan only changes the allow-list + grounding for that target).

### 5. `groundingPromptForTarget(target, connected?)` — connected-aware

- **`confluence` (per-panel):** keep the existing read-first anti-fabrication wording and the
  `BINDINGS_FIRST_STEERING`; ADD a sanctioned-write clause: "When the user explicitly asks to
  create/update a page or add a comment, you MAY call `confluence_create_page` /
  `confluence_update_page` / `confluence_create_comment`. Use ONLY the user-provided/real
  values; if the write is not authorized or fails, render a single Notice (reconnect to grant
  write access) — never claim a fabricated success." Read-rendered values stay verbatim.
- **`generated-ui` (Home):** keep `GET_UI_CATALOG_STEERING`; when ≥1 integration connected,
  append ONE combined integration clause assembled from the connected set:
  - Names the connected integrations.
  - Read-first anti-fabrication: fetch real data with that integration's read tools, render
    every value verbatim from a tool result, never copy a tool description's example.
  - Sanctioned writes: MAY perform the curated writes (Jira transition/comment/create/update;
    Confluence create/update/comment) when the user explicitly asks; Slack/Calendar are
    read-only.
  - Not-connected discipline: if the user names an integration whose tools are absent (not
    connected) OR a call returns not-connected/error, render a single Notice telling them to
    connect/reconnect it in cosmos — never fabricate, never claim success.
  - Empty connected set → just `GET_UI_CATALOG_STEERING` (today’s behavior).
- Implement by extracting the per-integration anti-fabrication sentences into small reusable
  fragments so the Home clause composes from the same source as the panel prompts (no
  divergence).

### 6. `AgentRunner` — read the live connected set at spawn

- Add an optional injected provider to `AgentRunnerOptions`:
  `getConnectedIntegrations?: () => ConnectedIntegrations` (default returns
  `NO_INTEGRATIONS_CONNECTED`, so the runner’s behavior is unchanged until wired — safe).
- In `spawnRun`, read once: `const connected = this.getConnectedIntegrations()`. Pass it into
  all three builders. For non-`generated-ui` targets the builders ignore it except the
  `confluence` per-panel write grant (which is static — independent of `connected`).
- No other AgentRunner change; the queue/session/retry logic is untouched.

### 7. `index.ts` — wire the provider from the managers

- When constructing `AgentRunner`, pass
  `getConnectedIntegrations: () => ({ jira: jiraManager?.getStatus().state === 'connected',
  confluence: confluenceManager?.getStatus().state === 'connected', slack:
  slackManager?.getStatus().state === 'connected', googleCalendar:
  googleCalendarManager?.getStatus().state === 'connected' })`.
- The provider is evaluated per run (closure over the live manager singletons), so connecting/
  disconnecting an integration changes the next run’s grant with no restart. Returns booleans
  only — no token/secret crosses into AgentRunner.

### Graceful failure (FR-004/FR-013/FR-015)

- **Unconnected integration (Home):** its tools are simply not granted → the model lacks them;
  the grounding instructs a Notice. No phantom grant, no crash.
- **Write-scope gap / API error / version conflict / not-connected mid-run:** the bridge/
  manager returns a structured error result (`write_not_authorized`, `not_connected`, etc.) →
  grounding instructs a single Notice. No token in the result (FR-013) — unchanged from reads.
- Auditability (FR-014): the integration tool call + its non-secret result land in the
  unified-agent-session jsonl the Cosmos panel reads.

## Test layers

### Node-unit — `src/main/mcpConfig.test.ts` (NEW)

Pure functions, no spawn. Cover:

- `CONFLUENCE_WRITE_TOOL_GRANTS` equals the three fully-qualified create/update/comment names;
  contains no delete.
- `allowedToolForTarget('confluence')` includes catalog + render + 2 reads + 3 writes.
- `allowedToolForTarget('generated-ui', connected)`:
  - none connected → exactly `get_ui_catalog,render_ui` (unchanged).
  - `{confluence}` → render_ui + catalog + confluence reads + 3 writes; asserts NO jira/slack/
    calendar grant and NO `render_confluence_ui`.
  - `{jira, slack}` → jira read+write + slack reads; NO confluence/calendar.
  - all four → union of all data grants; still NO per-integration render tools.
- `renderMcpConfigJsonForTarget('generated-ui', connected, sandboxDir)` mcpServers keys:
  none → `['cosmos-render-ui']`; `{confluence}` → `['cosmos-render-ui','cosmos-confluence']`;
  all four → render-ui + the four tool servers; asserts NO `*-render-ui` integration servers.
- `groundingPromptForTarget('generated-ui', connected)`: none → catalog steering only;
  `{confluence}` → mentions Confluence + write permission + Notice-on-not-connected; does not
  mention unconnected integrations.
- `groundingPromptForTarget('confluence')` includes the sanctioned-write clause + retains
  anti-fabrication + bindings-first.

### Node-integration — `src/main/agent/agentRunner.integration.test.ts` (EXTEND)

Inject a fake `spawn` + a `getConnectedIntegrations` stub; assert the composed argv:

- Home run, provider `{confluence:true}` → argv `--allowedTools` carries the confluence reads
  + 3 writes; `--mcp-config` JSON contains `cosmos-confluence` (tool server) and NOT
  `cosmos-confluence-render-ui`; `--append-system-prompt` mentions Confluence + writes; argv
  carries NO jira/slack/calendar grants.
- Home run, provider returns none → argv identical to the pre-feature Home run (only render_ui,
  no integration server) — regression guard.
- Confluence-panel run → argv `--allowedTools` now includes the 3 confluence writes.
- Assert no token/secret string anywhere in argv (the provider returns booleans).
- Existing AgentRunner queue/session tests remain green (no behavioral change there).

## Implementation Checklist

### Phase 1 — Interface / types

- [ ] Read the spec; confirm all OQs resolved (they are — see Decisions).
- [ ] Add `ConnectedIntegrations` + `NO_INTEGRATIONS_CONNECTED` (in `mcpConfig.ts`, or
      `src/shared/ipc.ts` if cleaner to share) — booleans only, no secret fields.
- [ ] Add `CONFLUENCE_WRITE_TOOL_GRANTS` constant (create/update/comment).
- [ ] Add `getConnectedIntegrations?: () => ConnectedIntegrations` to `AgentRunnerOptions`
      with a `NO_INTEGRATIONS_CONNECTED` default.
- [ ] Review types vs spec — no invented properties (no token/scope on the descriptor).

### Phase 2 — Tests first

- [ ] Create `src/main/mcpConfig.test.ts` with the node-unit cases above (RED).
- [ ] Extend `agentRunner.integration.test.ts` with the connected-vs-unconnected argv cases (RED).

### Phase 3 — Implementation

- [ ] `allowedToolForTarget(target, connected?)`: add confluence writes (per-panel) + the
      connected-aware Home branch (via an `integrationDataToolGrants` helper).
- [ ] `renderMcpConfigJsonForTarget(sandboxDir, target, connected?)`: connected-aware Home
      branch registering each connected integration’s TOOLS server (no render server).
- [ ] `groundingPromptForTarget(target, connected?)`: confluence write clause + Home combined
      integration clause assembled from the connected set (shared fragments).
- [ ] `AgentRunner.spawnRun`: read `getConnectedIntegrations()` once and thread into the three
      builders.
- [ ] `index.ts`: wire the provider from the four managers’ `getStatus().state === 'connected'`.
- [ ] All node-unit + integration tests pass; `npm run typecheck` clean.
- [ ] Reused shared constants/entries — no duplicated tool-name strings (all derive from the
      `*Tool` enums + server-name constants).

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md` §4.9: update the "Confluence generative panel stays read-only /
      create tool intentionally NOT in `--allowedTools`" statement to reflect the curated
      Confluence write grant (create/update/comment).
- [ ] `docs/ARCHITECTURE.md` §4.10: update the per-target least-privilege description — Home
      (`generated-ui`) now gets the CONNECTED integrations’ read + curated-write DATA tools +
      servers (computed per run from live connection state), renders generically via
      `render_ui` (no per-integration render tools); per-panel Confluence now grants its three
      writes. State the security posture (least-privilege → least-privilege + curated writes;
      Home is broad-but-connected-only; secrets unaffected).
- [ ] Note in this plan any deviation; reconcile `TODO.md` via wrap-up.

## Coordination notes

- **Stay in `mcpConfig.ts` / `agentRunner.ts` / `index.ts` (provider wiring) / the grant
  grounding.** The concurrent developer removing the dead generic `generated-ui` *panel* was
  told not to touch the `mcpConfig.ts` grants — those are this feature’s.
- **CONFIRM the `'generated-ui'` TARGET survives the dead-panel cleanup.** `'generated-ui'` is
  `DEFAULT_UI_RENDER_TARGET` and is the HOME AGENT’s target — it must NOT be removed even
  though the generic panel UI is gone. If the cleanup touches `UiRenderTarget` /
  `DEFAULT_UI_RENDER_TARGET`, coordinate so the target value stays.

## Open items needing confirmation before dev

- **Type location:** `ConnectedIntegrations` in `src/main/mcpConfig.ts` (main-only) vs
  `src/shared/ipc.ts` (shared). Recommend main-only — it is never sent over IPC. Confirm.
- **Confluence per-panel posture parity:** the plan grants the three Confluence writes to BOTH
  the `confluence` per-panel target AND Home-when-confluence-connected. Confirm the per-panel
  Confluence panel should also become write-capable (the spec implies yes via FR-006/FR-008;
  flagging because §4.9 currently calls the panel deliberately read-only).

## Deviations & Notes

- _none yet_
