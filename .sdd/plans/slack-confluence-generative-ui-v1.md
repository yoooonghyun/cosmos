# Plan: Slack + Confluence Generative UI — v1

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: `.sdd/specs/slack-confluence-generative-ui-v1.md`

---

## Summary

Mirror the Jira generative-UI path (§4.9/§4.10) for Slack and Confluence, **minus writes**. Add two
render targets (`'slack'`, `'confluence'`) to the existing target-routed multi-panel A2UI model; for
each, add a scoped render MCP server (`render_slack_ui` / `render_confluence_ui`) that teaches a custom
catalog vocabulary and stamps its bridge frame with the target, plus an `mcpConfig.ts` branch granting
that target's render tool **PLUS that integration's existing READ tools only** (least privilege, no
writes). Each rail panel gains a `PromptComposer` (threading its target through the single shared
`AgentRunner`) and a target-filtered A2UI host body, gated on connected; the existing connect/search
affordances are preserved. `UiBridge`'s settle-immediately branch generalizes from `target === 'jira'`
to all non-`'generated-ui'` display-only targets so the read-only one-shot run completes and the
spinner stops. **No main-side surface builder, no write tools, no deterministic action dispatcher** —
the agent composes surfaces entirely from real read-tool data, grounded against fabrication.

**UI-bearing feature.** New custom-catalog surfaces ship here, so the **design step (2.5, `designer`
agent)** runs next after this plan is approved: it produces `.sdd/designs/slack-confluence-generative-ui-v1.md`
and owns the pixels/tokens of the new catalog components. This plan owns the component CONTRACT
(type name → props → source resource shape), not the visual design.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main + Node MCP entries + React renderer) |
| Key dependencies | `@a2ui-sdk/react/0.9` (catalogs/provider), `@a2ui-sdk/types/0.9`, `@modelcontextprotocol/sdk`, `zod`, existing `UiBridge`/`AgentRunner`/`slackBridge`/`confluenceBridge` |
| Files to create | 6: `src/mcp/slackRenderUiServer.ts`, `src/mcp/confluenceRenderUiServer.ts`, `src/renderer/slackCatalog/` (index + components), `src/renderer/confluenceCatalog/` (index + components) |
| Files to modify | 6: `src/shared/ipc.ts`, `src/main/mcpConfig.ts`, `src/main/uiBridge.ts`, `src/main/index.ts`, `src/renderer/SlackPanel.tsx`, `src/renderer/ConfluencePanel.tsx`, `electron.vite.config.ts` |
| Surface builder needed? | **No** for both — see "Main-side surface builder decision" below |

### Layer map (mirrors the Jira generative path)

| Layer | Jira reference | This feature — Slack | This feature — Confluence |
|-------|----------------|----------------------|---------------------------|
| Render target enum | `UiRenderTarget` in `src/shared/ipc.ts` | add `'slack'` | add `'confluence'` (one shared edit) |
| Scoped render MCP entry | `src/mcp/jiraRenderUiServer.ts` | `src/mcp/slackRenderUiServer.ts` (tool `render_slack_ui`, stamps `target:'slack'`) | `src/mcp/confluenceRenderUiServer.ts` (tool `render_confluence_ui`, stamps `target:'confluence'`) |
| MCP config + grants | `mcpConfig.ts` jira branch | render tool + `SlackTool` read grants | render tool + `ConfluenceTool` read grants |
| Build wiring | `'mcp/jiraRenderUiServer'` input | `'mcp/slackRenderUiServer'` input | `'mcp/confluenceRenderUiServer'` input |
| Custom catalog | `src/renderer/jiraCatalog/` | `src/renderer/slackCatalog/` (`catalogId:'slack'`) | `src/renderer/confluenceCatalog/` (`catalogId:'confluence'`) |
| Panel composer + A2UI host | `JiraPanel.tsx` (`PromptComposer`+`ConnectedBody`+`SurfaceBridge`) | `SlackPanel.tsx` | `ConfluencePanel.tsx` |
| Bridge settle | `uiBridge.ts` `target==='jira'` | generalize to all non-`'generated-ui'` (one shared edit) | (covered by same edit) |
| Interactive PTY config | `index.ts` `embeddedMcpConfig` | register `cosmos-slack-render-ui` | register `cosmos-confluence-render-ui` |

### Main-side surface builder decision

**Not needed for either Slack or Confluence in v1.** The Jira `jiraSurfaceBuilder.ts` exists because
Jira deterministically composes surfaces in main for two paths that Slack/Confluence DO NOT have in
v1: (a) the per-switch **default view** (`requestDefaultView` read → builder → push) and (b) the
**post-write re-push** (`JiraActionDispatcher` re-reads + re-composes). Spec FR-012 omits writes and
FR-016 omits a default view, so neither main-side compose path exists here. The agent composes every
Slack/Confluence surface itself from real read-tool results, and renders a Notice on
not-connected/error/empty per the grounding prompt (FR-011) — so the Notice block lives in the catalog
(rendered from agent-emitted props), not in a main-side builder. If a future cycle adds writes or a
default view, a `slackSurfaceBuilder.ts` / `confluenceSurfaceBuilder.ts` would be introduced then.

### Component contract — Slack catalog (`catalogId: 'slack'`)

Data inputs trace to `src/shared/slack.ts` (FR-004/FR-006). Components carry data as STATIC props (the
`render_slack_ui` description teaches this), like the Jira display components.

| Type name | Props | Source shape |
|-----------|-------|--------------|
| `ChannelRow` | `{ id, name, isMember }` | `SlackChannel` |
| `ChannelList` | `{ channels: ChannelRow-props[] }` | `SlackChannel[]` |
| `MessageRow` | `{ ts, userId, userName?, text, replyCount? }` | `SlackMessage` |
| `MessageList` | `{ messages: MessageRow-props[] }` | `SlackMessage[]` |
| `SearchResultRow` | `{ ts, userId, userName?, text, channelId, channelName? }` | `SlackSearchMatch` |
| `SearchResultList` | `{ matches: SearchResultRow-props[] }` | `SlackSearchMatch[]` |
| `UserChip` | `{ id, displayName }` | `SlackUser` |
| `Notice` | `{ noticeKind: 'info'\|'error', message }` | (not-connected/error/empty — FR-011) |
| `Column`/`Row`/`Text` | SDK passthroughs (grouping, labels) | standard catalog (reused like jiraCatalog) |

Author-name display uses the raw-id fallback (`userName ?? userId`) the native panel already uses.

### Component contract — Confluence catalog (`catalogId: 'confluence'`)

Data inputs trace to `src/shared/confluence.ts` (FR-005/FR-006).

| Type name | Props | Source shape |
|-----------|-------|--------------|
| `SearchResultRow` | `{ id, title, space?, excerpt }` | `ConfluenceSearchResult` |
| `SearchResultList` | `{ results: SearchResultRow-props[] }` | `ConfluenceSearchResult[]` |
| `PageDetail` | `{ id, title, space?, body }` | `ConfluencePageDetail` |
| `Notice` | `{ noticeKind: 'info'\|'error', message }` | (not-connected/error/empty — FR-011) |
| `Column`/`Row`/`Text` | SDK passthroughs | standard catalog (reused) |

> The exact component set above is the floor (the spec's "at least"). The `designer` may refine
> grouping/labels within this contract but MUST NOT add components or props not traceable to a
> resource shape above.

---

## Implementation Checklist

> Slack ships first, then Confluence. Mechanism edits shared by both are done ONCE in Phase 0.

### Phase 0 — Shared mechanism (done once, before either integration)

- [x] `src/shared/ipc.ts`: extend `UiRenderTarget` to `'jira' | 'generated-ui' | 'slack' | 'confluence'`; update the doc comment. `DEFAULT_UI_RENDER_TARGET`, `UiRenderPayload.target`, `AgentSubmitPayload.target` are unchanged (already typed by the union). NO new channel set (FR-001).
- [x] `src/main/uiBridge.ts`: generalize the settle-immediately branch from `if (target === 'jira')` to `if (target !== 'generated-ui')` (so `'jira'`/`'slack'`/`'confluence'` all settle on push; only `'generated-ui'` blocks awaiting an action). Update the comment to explain display-only targets (FR-014).
- [x] `src/main/mcpConfig.ts`: add the structural scaffolding both targets will fill — server-name + tool-grant constants, and prepare `renderMcpConfigJsonForTarget` / `allowedToolForTarget` / `groundingPromptForTarget` to branch on the new targets (filled per-integration below).
- [x] Typecheck green (`npm run typecheck`).

### Phase 1 — Slack generative UI

#### Interface / contract
- [x] `src/mcp/slackRenderUiServer.ts`: new entry mirroring `jiraRenderUiServer.ts` — one tool `render_slack_ui`, `BridgeClient.render` stamps `target: 'slack'`, validates spec via `validateSurfaceUpdate`, tool description teaches the Slack catalog vocab (ChannelList/ChannelRow/MessageList/MessageRow/SearchResultList/SearchResultRow/UserChip/Notice + Column/Row/Text) with an example, and the anti-fabrication note that example values are illustrative only. NO token/secret.
- [x] `electron.vite.config.ts`: add rollup input `'mcp/slackRenderUiServer'` → `src/mcp/slackRenderUiServer.ts` (FR-017; without it the server silently never bundles).
- [x] `src/main/mcpConfig.ts`: add `SLACK_RENDER_UI_SERVER_NAME`, `SLACK_RENDER_UI_TOOL`, `SLACK_TOOLS_SERVER_NAME` (`'cosmos-slack'`), `SLACK_TOOL_GRANTS` (the five `SlackTool` reads), `slackRenderUiMcpServerEntry(sandboxDir)` (same `COSMOS_BRIDGE_SOCKET` as render_ui), and reuse the existing slack tools entry (`COSMOS_SLACK_BRIDGE_SOCKET`). Branch `renderMcpConfigJsonForTarget`/`allowedToolForTarget`/`groundingPromptForTarget` for `'slack'` (render tool + read tools only — least privilege, FR-009/FR-010; grounding forbids fabrication, FR-011). NO write tools.

#### Catalog (component contract; pixels deferred to design step)
- [x] `src/renderer/slackCatalog/components.tsx`: ChannelRow, ChannelList, MessageRow, MessageList, SearchResultRow, SearchResultList, UserChip, Notice (plain cosmos React, `{ surfaceId, componentId, ...nodeProps }`, cosmos palette — no Slack brand color). Raw-id author fallback.
- [x] `src/renderer/slackCatalog/index.ts`: export `SLACK_CATALOG_ID = 'slack'` + `slackCatalog: Catalog` (the components above + `Column`/`Row`/`Text` from `standardCatalog`).

#### Panel
- [x] `src/renderer/SlackPanel.tsx`: add a `PromptComposer` (clone `JiraPanel`'s — Enter submits, Shift+Enter newline, empty/whitespace no-op, in-progress + error states; submits `{ utterance, target: 'slack' }`) and a generative A2UI host: an `<A2UIProvider catalog={slackCatalog}>` + a `SurfaceBridge` filtering `ui:render` to `target: 'slack'`, with a `SurfaceErrorBoundary` (FR-007). Gate the composer + host on `status.state === 'connected'`; keep the existing Connect/Reconnect affordance and the existing channel/search browser per FR-015 (composer is additive; do not remove existing read affordances). No `requestDefaultView` analogue (FR-016).
- [x] `src/main/index.ts`: register `cosmos-slack-render-ui` in `embeddedMcpConfig` via `slackRenderUiMcpServerEntry` so the interactive PTY can also reach it (mirrors the jira registration). Verify the existing `cosmos-slack` read server is already registered (it is).

#### Verify Slack
- [x] Typecheck + build green; new entry lands at `out/main/mcp/slackRenderUiServer.js`.
- [ ] Manual (NOT run — no live Slack OAuth in this session): connected Slack panel utterance composes a real-data Slack surface in-panel; spinner stops (settle-on-push); not-connected disables composer; error/empty → Notice. Least-privilege grant IS verified by automated tests in `mcpConfig.test.ts`/`agentRunner.test.ts`.

### Phase 2 — Confluence generative UI (repeat the Phase 1 pattern)

#### Interface / contract
- [x] `src/mcp/confluenceRenderUiServer.ts`: tool `render_confluence_ui`, stamps `target: 'confluence'`, teaches the Confluence catalog vocab (SearchResultList/SearchResultRow/PageDetail/Notice + Column/Row/Text) with example + anti-fabrication note.
- [x] `electron.vite.config.ts`: add rollup input `'mcp/confluenceRenderUiServer'` (FR-017).
- [x] `src/main/mcpConfig.ts`: add `CONFLUENCE_RENDER_UI_SERVER_NAME`, `CONFLUENCE_RENDER_UI_TOOL`, `CONFLUENCE_TOOLS_SERVER_NAME` (`'cosmos-confluence'`), `CONFLUENCE_TOOL_GRANTS` (the two `ConfluenceTool` reads), `confluenceRenderUiMcpServerEntry`, and the `'confluence'` branches of the three per-target functions (render + read tools only; grounding forbids fabrication). NO write tools.

#### Catalog
- [x] `src/renderer/confluenceCatalog/components.tsx`: SearchResultRow, SearchResultList, PageDetail, Notice (cosmos palette — no Atlassian brand color). Body/excerpt are pre-flattened plain text (per `ConfluencePageDetail`/`ConfluenceSearchResult`).
- [x] `src/renderer/confluenceCatalog/index.ts`: export `CONFLUENCE_CATALOG_ID = 'confluence'` + `confluenceCatalog: Catalog`.

#### Panel
- [x] `src/renderer/ConfluencePanel.tsx`: add `PromptComposer` (`target: 'confluence'`) + `<A2UIProvider catalog={confluenceCatalog}>` + `SurfaceBridge` filtering `target: 'confluence'` + error boundary; gate on connected; keep existing Connect/Reconnect + search/page browser affordances.
- [x] `src/main/index.ts`: register `cosmos-confluence-render-ui` in `embeddedMcpConfig`.

#### Verify Confluence
- [x] Typecheck + build green; entry at `out/main/mcp/confluenceRenderUiServer.js`.
- [ ] Manual (NOT run — no live Atlassian OAuth in this session): same checks as Slack, for Confluence. Least-privilege grant IS verified by automated tests.

### Phase 3 — Tests

- [x] `mcpConfig`: unit-test `allowedToolForTarget('slack')` / `('confluence')` grant exactly the render tool + that integration's read tools and NOTHING else (least privilege, SC-003); `groundingPromptForTarget` returns a non-empty anti-fabrication prompt for both.
- [x] `uiBridge`: a `'slack'` and a `'confluence'` render are settled on push (display-only); a `'generated-ui'` render still blocks (SC-004 / regression guard for the generalized branch).
- [x] Reuse existing `validateSurfaceUpdate` coverage for the two new render servers.

### Phase 4 — Docs

- [x] Update this plan with any deviations.
- [ ] `docs/ARCHITECTURE.md` (DEFERRED to wrap-up, not done now): §3 diagram render-entry-scripts list (now four render-style entries); §4.3 target-routed render (two more targets + the "all non-generated-ui settle on push" generalization); §4.4 multi-panel A2UI (Slack/Confluence panels host their own catalogs); §4.7 registry (two more scoped render entries); §4.8 Slack + §4.9 Confluence panel descriptions (now generative, read-only); §4.10 + §5a per-target grant table; Open Questions / Next Steps entry for this feature.

---

## Deviations & Notes

> Record anything that differs from the plan during implementation. Date each entry.

- **2026-06-06**: Decided NO main-side surface builder for either integration (no default view, no
  writes in v1 — the agent composes every surface and renders a Notice on error via the catalog).
  Revisit if a future cycle adds writes or a default view.
- **2026-06-06 (impl)**: Q1 resolved REPLACE-ON-COMPOSE. The connected body keeps the native
  channel/search (Slack) and search/page (Confluence) browser as the IDLE state; once the agent
  composes a surface it REPLACES the native browser body with an `X` "Clear generated view" header
  back to idle (also cleared on disconnect). The `<A2UIProvider>`+`SurfaceBridge` stays mounted at
  all times (so its `ui:render` subscription is live while idle) and is shown only once a `'slack'`/
  `'confluence'`-target frame arrives. Composer is bottom-docked and additive; native read
  affordances are preserved (FR-015).
- **2026-06-06 (impl)**: Pure catalog display helpers were extracted into
  `src/renderer/{slackCatalog,confluenceCatalog}/logic.ts` (mirroring `jiraCatalog/logic.ts`) so they
  are unit-testable under the `node`-env vitest config (which only includes `*.test.ts`, not `.tsx`,
  and has no jsdom). Catalog `.tsx` components import these. Slack `formatTs` now guards a blank `ts`
  explicitly (`Number('')` is `0`/finite) so a missing timestamp shows no time rather than epoch-0.
- **2026-06-06 (impl)**: Fixed pre-existing STALE test assertions that predated the Jira write-extend
  cycle (they asserted the `'jira'` target grants/registers ONLY the render tool/server, but the Jira
  run already grants the render tool PLUS `cosmos-jira` read+write tools and registers both servers):
  `mcpConfig.test.ts`, `agentRunner.test.ts`, and `validate.test.ts` (the latter listed `'slack'` as an
  INVALID `UiRenderTarget`). Updated to current truth and added Slack/Confluence coverage.
- **2026-06-06 (impl)**: `SurfaceBridge` in both panels retains a defensive `handleAction` that maps an
  SDK action back to `ui:action` even though v1 surfaces are display-only (FR-012) — it is a safety net
  for a misbehaving surface and mirrors the Jira/Generated-UI bridges; no v1 catalog component emits an
  action, so it is never exercised in normal flow.
