/**
 * Shared A2UI authoring catalog + the `get_ui_catalog` tool registration helper
 * (ui-catalog-pull-spinner-signal-v1, FR-001/FR-002).
 *
 * The render MCP surface is SPLIT into two tools so the agent must PULL the catalog
 * before it can author a valid surface — that pull is the deterministic EARLY
 * "UI generation has begun" signal. This module is the SINGLE source of:
 *
 *  - {@link A2UI_CATALOG_TEXT} — the component catalog + authoring rules (moved here
 *    verbatim from `renderUiServer.ts`'s old `A2UI_TOOL_DESCRIPTION`), so the text the
 *    agent reads can never drift across the five render servers (SC-005).
 *  - {@link registerGetUiCatalogTool} — registers a `get_ui_catalog` tool that returns
 *    that text and fires an injected `onGenerating()` side-effect (the bridge
 *    "generating" notify) on each invocation, registered BYTE-IDENTICALLY in all five
 *    render servers (FR-002).
 *
 * This module runs OUTSIDE Electron (plain Node, spawned by the `claude` CLI), so it
 * imports only the MCP SDK types + the pure shared adapter flag-path constants.
 */

import { AdapterFlagPath } from '../shared/adapter'

/**
 * The A2UI 0.9 component catalog + authoring rules returned by `get_ui_catalog`.
 *
 * SINGLE SOURCE (FR-002/SC-005): every render server serves this same text from
 * `get_ui_catalog`; no per-server copy is kept. Moved verbatim from the former
 * `A2UI_TOOL_DESCRIPTION` in `renderUiServer.ts` (lines 176-257) so the renderer's
 * actual catalog and the agent's authoring guidance can never disagree.
 *
 * Key 0.9 facts encoded below: components is a FLAT list (not a tree); each component
 * is `{ id, component: "<Type>", ...props }` where `component` is a STRING type name
 * (not a nested object); parents reference children by id string; exactly one root.
 * CRITICAL — data binding: every interactive input's `value` MUST be a path binding
 * `{ "path": "/field" }`, NOT a literal, or the SDK never captures the user's input.
 *
 * NON-SECRET: pure authoring guidance — no token, transcript, or surface content.
 */
export const A2UI_CATALOG_TEXT = [
  'The A2UI 0.9 component catalog + authoring rules for the cosmos render tools.',
  'ARGUMENT to render: { spec: { surfaceId: string, components: Component[] } } — A2UI 0.9.',
  '',
  'components is a FLAT array (not nested). Each Component is:',
  '  { "id": "<unique-string>", "component": "<TypeName>", ...props }',
  '"component" is a STRING type name (e.g. "Text"), NOT a nested object.',
  'Parents reference children by their id string. Exactly ONE component must be',
  'the root: either give it "id": "root", or make it the only component that no',
  'other component references.',
  '',
  'DATA BINDING (important): every interactive input MUST bind its "value" to a',
  'data-model path written as { "path": "/fieldName" } — NOT a literal. Without a',
  'path binding the control will not capture the user input (a dropdown choice',
  'will not even stay selected) and nothing is returned. Then set the submit',
  "Button's action.context to echo those paths so you receive the values, e.g.",
  '  "action": { "name": "submit", "context": { "choice": { "path": "/choice" } } }',
  '',
  'Available component types and their props:',
  '  Text   { text: string, variant?: "h1"|"h2"|"h3"|"h4"|"h5"|"body"|"caption" }',
  '  Image  { url: string }   Icon { name: string }   Divider {}',
  '  Column { children: string[] /* child ids */, justify?, align? }',
  '  Row    { children: string[] /* child ids */, justify?, align? }',
  '  List   { children: string[] }   Card { child: string /* child id */ }',
  '  Button { child: string /* id, usually a Text */, primary?: boolean,',
  '           action: { name: string, context?: { <key>: { path: string } } } }',
  '  TextField { label?: string, value: { path: string },',
  '              variant?: "shortText"|"longText"|"number"|"obscured" }',
  '  CheckBox  { label?: string, value: { path: string } }',
  '  ChoicePicker { label?: string, value: { path: string },',
  '                 options: [{ value: string, label: string }],',
  '                 variant?: "multipleSelection"|"mutuallyExclusive" }',
  '  Slider { value: { path: string } }   DateTimeInput { value: { path: string } }',
  '',
  'Make at least one Button so the user can submit; its action.name identifies',
  'which control fired and is returned to you. Example (a single-choice poll):',
  '{ "surfaceId": "s1", "components": [',
  '  { "id": "root", "component": "Column", "children": ["title", "pick", "send"] },',
  '  { "id": "title", "component": "Text", "text": "Pick one", "variant": "h2" },',
  '  { "id": "pick", "component": "ChoicePicker", "variant": "mutuallyExclusive",',
  '    "value": { "path": "/choice" },',
  '    "options": [ { "value": "a", "label": "Option A" },',
  '                 { "value": "b", "label": "Option B" } ] },',
  '  { "id": "send", "component": "Button", "primary": true, "child": "sendLbl",',
  '    "action": { "name": "submit", "context": { "choice": { "path": "/choice" } } } },',
  '  { "id": "sendLbl", "component": "Text", "text": "Submit" } ] }',
  '',
  'Resolves with the user action, or an explicit cancellation if dismissed.',
  '',
  '════ REFRESHABLE DATA — compose the layout, declare ONE BINDING per data container ════',
  'Whenever a container DISPLAYS live integration data you just read (a Slack/Jira/Confluence',
  'list or detail), COMPOSE the layout you want and pass the rows you fetched as ORDINARY',
  'LITERAL props — those literals become the first-paint SEED and the surface shows them',
  'instantly. To make that container REFRESHABLE (the panel refresh control re-fetches +',
  'repaints it in place, no agent round-trip), declare ONE binding for it. You do NOT author',
  'any "{ path }" data binding yourself — cosmos rewrites each bound container\'s data prop to a',
  'refreshable path for you, whether you passed literal rows or a path.',
  '',
  'BINDINGS is the primary way: pass "bindings": one entry per data-bearing container —',
  '  { "componentId": "<the container\'s id>",',
  '    "descriptor": { "dataSource": "<read id>", "query": { ... } } }.',
  'A surface with a SINGLE data container declares ONE binding; a PARTITIONED layout (a kanban',
  'with one list per status column, side-by-side feeds) declares ONE binding PER container, each',
  'with its OWN narrowed query — so each refreshes independently and an EMPTY column (empty',
  'literal seed) still re-fetches and can populate. dataSource is the integration read id; query',
  'holds only NON-SECRET params (e.g. a jql, channelId, or pageId) — NEVER a token (cosmos',
  'attaches the token only in main at refresh). dataSource is the ADAPTER SOURCE id — NOT the MCP',
  'read-tool name ("jira_search_issues"/"slack_read_history"/"confluence_search_content"). Using a',
  'tool name makes the surface non-refreshable. Valid dataSources:',
  `  searchIssues, getIssue;  listChannels, getHistory, search;  defaultFeed, searchContent, getPage.`,
  '',
  '"descriptor": { "dataSource": ..., "query": { ... } } is the DEGENERATE single-binding form —',
  'one surface-wide fetcher for a surface with a single data container. Use "descriptor" for one',
  'region, "bindings" for many — NEVER pass both; if both are present bindings wins.',
  '',
  `You MAY still bind the shared reserved flags ("${AdapterFlagPath.loading}", "${AdapterFlagPath.hasMore}", "${AdapterFlagPath.error}") — cosmos also`,
  'manages these for bound containers. Mint a UNIQUE surfaceId per surface. Omit all bindings',
  'ONLY for a purely static/composed surface that shows no live integration data.'
].join('\n')

/** The one-line description of the `get_ui_catalog` tool (FR-001). */
export const GET_UI_CATALOG_TOOL_DESCRIPTION =
  'Return the A2UI component catalog + authoring rules for the render tools. ALWAYS call ' +
  'this FIRST, before render_ui / render_*_ui, to learn the exact component types, props, ' +
  'and the refreshable-bindings rules needed to author a valid surface.'

/** The text content result the `get_ui_catalog` handler returns. */
export interface CatalogToolResult {
  content: { type: 'text'; text: string }[]
}

/**
 * The minimal-effort `McpServer` surface this helper needs — just `registerTool`.
 * Typed structurally (not against the SDK class) so the helper stays node-testable with a tiny
 * fake server. The `config`/`handler` params are deliberately PERMISSIVE (`any`) so the real
 * SDK `McpServer.registerTool` — whose generic signature is far more elaborate — satisfies this
 * interface; the helper passes a concrete, correct config + handler shape itself.
 */
export interface CatalogToolServer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTool(name: string, config: any, handler: any): unknown
}

/**
 * Register the `get_ui_catalog` tool on `server` (FR-001/FR-002). The tool takes no
 * arguments and returns {@link A2UI_CATALOG_TEXT} as a text content result. On EACH
 * invocation it first fires the injected `onGenerating()` side-effect — the render
 * server passes one that writes the fire-and-forget bridge `generating` frame (FR-003),
 * making the catalog pull the early UI-generation signal.
 *
 * `onGenerating` is best-effort: a thrown/failed notify MUST NOT prevent the catalog
 * from being returned (FR-010/FR-012) — the catalog return is the agent's contract.
 *
 * Registered byte-identically in all five render servers via this single helper, so no
 * per-server catalog or wiring copy can drift (SC-005).
 */
export function registerGetUiCatalogTool(
  server: CatalogToolServer,
  options: { onGenerating: () => void }
): void {
  server.registerTool(
    'get_ui_catalog',
    {
      title: 'Get UI catalog',
      description: GET_UI_CATALOG_TOOL_DESCRIPTION,
      // No input args: the catalog is the same regardless of caller.
      inputSchema: {}
    },
    async () => {
      // FR-003: signal "UI generation has begun" BEFORE returning the catalog. Best-effort:
      // a notify failure (bridge down) must never block the catalog return (FR-010/FR-012).
      try {
        options.onGenerating()
      } catch {
        // swallow — the catalog still returns.
      }
      return {
        content: [{ type: 'text' as const, text: A2UI_CATALOG_TEXT }]
      }
    }
  )
}
