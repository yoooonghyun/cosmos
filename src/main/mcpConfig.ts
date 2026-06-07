/**
 * Shared render_ui MCP config builder — cosmos generative-UI foundation v1.
 *
 * The render_ui stdio server entry is needed in TWO places:
 *  1. the interactive `claude` PTY's `--mcp-config` (`embeddedMcpConfig` in
 *     `src/main/index.ts`), and
 *  2. the headless `claude -p` runner's `--mcp-config` (`AgentRunner`).
 *
 * Both MUST register byte-identical render_ui wiring against the SAME `UiBridge`
 * socket so the two paths cannot drift (FR-007/FR-013). This module is the single
 * source of that entry.
 *
 * Spec trace: .sdd/specs/generative-ui-foundation-v1.md (FR-007, FR-013).
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgeSocketPath,
  confluenceBridgeSocketPath,
  jiraBridgeSocketPath,
  slackBridgeSocketPath
} from '../shared/bridge'
import { DEFAULT_UI_RENDER_TARGET, type UiRenderTarget } from '../shared/ipc'
import { JiraTool } from '../shared/jira'
import { SlackTool } from '../shared/slack'
import { ConfluenceTool } from '../shared/confluence'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** A single stdio MCP server registration (the shape `--mcp-config` expects). */
export interface McpStdioServerEntry {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * The render_ui stdio server entry — `node out/main/mcp/renderUiServer.js` with
 * `COSMOS_BRIDGE_SOCKET` pointing at the EXISTING `UiBridge` socket for
 * `sandboxDir`. Identical for the interactive PTY and the headless runner so a
 * `render_ui` call from either lands in the same `UiBridge → ui:render` path.
 */
export function renderUiMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/renderUiServer.js')],
    env: { COSMOS_BRIDGE_SOCKET: bridgeSocketPath(sandboxDir) }
  }
}

/**
 * The headless runner's single-server `--mcp-config` JSON string: ONLY
 * `cosmos-render-ui` (least-privilege — no slack/jira/confluence; FR-013). Built
 * from {@link renderUiMcpServerEntry} so it can never drift from the interactive
 * path's render_ui registration.
 */
export function renderUiMcpConfigJson(sandboxDir: string): string {
  return JSON.stringify({
    mcpServers: { 'cosmos-render-ui': renderUiMcpServerEntry(sandboxDir) }
  })
}

/* ------------------------------------------------------------------------- *
 * Jira render-UI server (Jira generative-UI v2, D2/D3)
 * ------------------------------------------------------------------------- */

/** The MCP server name for the Jira-scoped render tool (used in --allowedTools). */
export const JIRA_RENDER_UI_SERVER_NAME = 'cosmos-jira-render-ui'

/** The fully-qualified Jira render tool grant for `--allowedTools` (D2). */
export const JIRA_RENDER_UI_TOOL = 'mcp__cosmos-jira-render-ui__render_jira_ui'

/** The standard render tool grant for `--allowedTools` (the generated-ui target). */
export const RENDER_UI_TOOL = 'mcp__cosmos-render-ui__render_ui'

/** The MCP server name for the Jira read+write tools (used in --allowedTools). */
export const JIRA_TOOLS_SERVER_NAME = 'cosmos-jira'

/**
 * The fully-qualified Jira read+write tool grants for `--allowedTools`. A jira-target
 * generative run needs the READ tools (search/get) to fetch real tickets to compose a
 * surface, plus the WRITE tools so the agent can mutate when asked — the same tools the
 * interactive PTY already exposes. Tokens never reach the agent: each tool relays over the
 * jira bridge to main, which attaches the credential (FR-017 / security baseline).
 */
export const JIRA_TOOL_GRANTS: readonly string[] = [
  `mcp__${JIRA_TOOLS_SERVER_NAME}__${JiraTool.SearchIssues}`,
  `mcp__${JIRA_TOOLS_SERVER_NAME}__${JiraTool.GetIssue}`,
  `mcp__${JIRA_TOOLS_SERVER_NAME}__${JiraTool.TransitionIssue}`,
  `mcp__${JIRA_TOOLS_SERVER_NAME}__${JiraTool.AddComment}`,
  `mcp__${JIRA_TOOLS_SERVER_NAME}__${JiraTool.CreateIssue}`,
  `mcp__${JIRA_TOOLS_SERVER_NAME}__${JiraTool.UpdateIssue}`
]

/**
 * The Jira read+write stdio server entry — `node out/main/mcp/jiraMcpServer.js` with its
 * OWN bridge socket (`COSMOS_JIRA_BRIDGE_SOCKET`). Identical to the interactive PTY's
 * `cosmos-jira` registration so a jira-target generative run reaches the same JiraManager
 * read+write methods. Carries NO token/secret — the bridge attaches it in main.
 */
export function jiraToolsMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/jiraMcpServer.js')],
    env: { COSMOS_JIRA_BRIDGE_SOCKET: jiraBridgeSocketPath(sandboxDir) }
  }
}

/**
 * The Jira render_jira_ui stdio server entry — `node out/main/mcp/jiraRenderUiServer.js`
 * with `COSMOS_BRIDGE_SOCKET` pointing at the SAME `UiBridge` socket as render_ui
 * (D3: the Jira render tool stamps its bridge frame `target: 'jira'` and relays to
 * the same bridge — no second bridge). Carries NO token/secret (FR-017).
 */
export function jiraRenderUiMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/jiraRenderUiServer.js')],
    env: { COSMOS_BRIDGE_SOCKET: bridgeSocketPath(sandboxDir) }
  }
}

/* ------------------------------------------------------------------------- *
 * Slack render-UI server (Slack + Confluence generative-UI v1) — read-only
 * ------------------------------------------------------------------------- */

/** The MCP server name for the Slack-scoped render tool (used in --allowedTools). */
export const SLACK_RENDER_UI_SERVER_NAME = 'cosmos-slack-render-ui'

/** The fully-qualified Slack render tool grant for `--allowedTools` (FR-008). */
export const SLACK_RENDER_UI_TOOL = 'mcp__cosmos-slack-render-ui__render_slack_ui'

/** The MCP server name for the read-only Slack tools (used in --allowedTools). */
export const SLACK_TOOLS_SERVER_NAME = 'cosmos-slack'

/**
 * The fully-qualified read-only Slack tool grants for `--allowedTools` (FR-009/FR-010).
 * A slack-target generative run needs the five READ tools to fetch real channels,
 * messages, search hits, and users to compose a surface — render alone would leave the
 * run with no data. NO write tool (read-only, FR-012). Tokens never reach the agent:
 * each tool relays over the slack bridge to main, which attaches the credential (FR-018).
 */
export const SLACK_TOOL_GRANTS: readonly string[] = [
  `mcp__${SLACK_TOOLS_SERVER_NAME}__${SlackTool.ListChannels}`,
  `mcp__${SLACK_TOOLS_SERVER_NAME}__${SlackTool.ReadHistory}`,
  `mcp__${SLACK_TOOLS_SERVER_NAME}__${SlackTool.ReadThread}`,
  `mcp__${SLACK_TOOLS_SERVER_NAME}__${SlackTool.SearchMessages}`,
  `mcp__${SLACK_TOOLS_SERVER_NAME}__${SlackTool.LookupUser}`
]

/**
 * The read-only Slack stdio server entry — `node out/main/mcp/slackMcpServer.js` with
 * its OWN bridge socket (`COSMOS_SLACK_BRIDGE_SOCKET`). Identical to the interactive
 * PTY's `cosmos-slack` registration so a slack-target generative run reaches the same
 * SlackManager read methods. Carries NO token/secret — the bridge attaches it in main.
 */
export function slackToolsMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/slackMcpServer.js')],
    env: { COSMOS_SLACK_BRIDGE_SOCKET: slackBridgeSocketPath(sandboxDir) }
  }
}

/**
 * The render_slack_ui stdio server entry — `node out/main/mcp/slackRenderUiServer.js`
 * with `COSMOS_BRIDGE_SOCKET` pointing at the SAME `UiBridge` socket as render_ui (the
 * Slack render tool stamps its bridge frame `target: 'slack'` and relays to the same
 * bridge — no second bridge, FR-008). Carries NO token/secret (FR-018).
 */
export function slackRenderUiMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/slackRenderUiServer.js')],
    env: { COSMOS_BRIDGE_SOCKET: bridgeSocketPath(sandboxDir) }
  }
}

/* ------------------------------------------------------------------------- *
 * Confluence render-UI server (Slack + Confluence generative-UI v1) — read-only
 * ------------------------------------------------------------------------- */

/** The MCP server name for the Confluence-scoped render tool (used in --allowedTools). */
export const CONFLUENCE_RENDER_UI_SERVER_NAME = 'cosmos-confluence-render-ui'

/** The fully-qualified Confluence render tool grant for `--allowedTools` (FR-008). */
export const CONFLUENCE_RENDER_UI_TOOL =
  'mcp__cosmos-confluence-render-ui__render_confluence_ui'

/** The MCP server name for the read-only Confluence tools (used in --allowedTools). */
export const CONFLUENCE_TOOLS_SERVER_NAME = 'cosmos-confluence'

/**
 * The fully-qualified read-only Confluence tool grants for `--allowedTools`
 * (FR-009/FR-010). A confluence-target generative run needs the two READ tools to fetch
 * real search results + page detail to compose a surface. NO write tool (read-only,
 * FR-012). Tokens never reach the agent: each tool relays over the confluence bridge to
 * main, which attaches the credential (FR-018).
 */
export const CONFLUENCE_TOOL_GRANTS: readonly string[] = [
  `mcp__${CONFLUENCE_TOOLS_SERVER_NAME}__${ConfluenceTool.SearchContent}`,
  `mcp__${CONFLUENCE_TOOLS_SERVER_NAME}__${ConfluenceTool.GetPage}`
]

/**
 * The read-only Confluence stdio server entry — `node out/main/mcp/confluenceMcpServer.js`
 * with its OWN bridge socket (`COSMOS_CONFLUENCE_BRIDGE_SOCKET`). Identical to the
 * interactive PTY's `cosmos-confluence` registration so a confluence-target generative
 * run reaches the same ConfluenceManager read methods. Carries NO token/secret.
 */
export function confluenceToolsMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/confluenceMcpServer.js')],
    env: { COSMOS_CONFLUENCE_BRIDGE_SOCKET: confluenceBridgeSocketPath(sandboxDir) }
  }
}

/**
 * The render_confluence_ui stdio server entry —
 * `node out/main/mcp/confluenceRenderUiServer.js` with `COSMOS_BRIDGE_SOCKET` pointing at
 * the SAME `UiBridge` socket as render_ui (the Confluence render tool stamps its bridge
 * frame `target: 'confluence'` and relays to the same bridge — no second bridge, FR-008).
 * Carries NO token/secret (FR-018).
 */
export function confluenceRenderUiMcpServerEntry(sandboxDir: string): McpStdioServerEntry {
  return {
    type: 'stdio',
    command: 'node',
    args: [join(__dirname, 'mcp/confluenceRenderUiServer.js')],
    env: { COSMOS_BRIDGE_SOCKET: bridgeSocketPath(sandboxDir) }
  }
}

/**
 * The headless runner's `--mcp-config` JSON for a given render `target` (D2): for
 * `'jira'`, the jira render server + read/write tools; for `'slack'`/`'confluence'`,
 * that integration's render server + its READ-ONLY tools (FR-008..FR-010); for
 * `'generated-ui'`, ONLY `cosmos-render-ui`. Least-privilege per run — each target's run
 * cannot reach another integration's tools or the generic render tool. Pairs with
 * {@link allowedToolForTarget}.
 */
export function renderMcpConfigJsonForTarget(
  sandboxDir: string,
  target: UiRenderTarget = DEFAULT_UI_RENDER_TARGET
): string {
  if (target === 'jira') {
    // A jira-target run gets the render tool PLUS the cosmos-jira read+write tools so it can
    // fetch real tickets to compose surfaces (and mutate when asked) — render alone left the
    // run with no data to render. Still least-privilege: no slack/confluence/generic-render.
    return JSON.stringify({
      mcpServers: {
        [JIRA_RENDER_UI_SERVER_NAME]: jiraRenderUiMcpServerEntry(sandboxDir),
        [JIRA_TOOLS_SERVER_NAME]: jiraToolsMcpServerEntry(sandboxDir)
      }
    })
  }
  if (target === 'slack') {
    // A slack-target run gets the Slack render tool PLUS the read-only Slack tools (no
    // writes, FR-012). Least-privilege: no jira/confluence/generic-render.
    return JSON.stringify({
      mcpServers: {
        [SLACK_RENDER_UI_SERVER_NAME]: slackRenderUiMcpServerEntry(sandboxDir),
        [SLACK_TOOLS_SERVER_NAME]: slackToolsMcpServerEntry(sandboxDir)
      }
    })
  }
  if (target === 'confluence') {
    // A confluence-target run gets the Confluence render tool PLUS the read-only Confluence
    // tools (no writes, FR-012). Least-privilege: no jira/slack/generic-render.
    return JSON.stringify({
      mcpServers: {
        [CONFLUENCE_RENDER_UI_SERVER_NAME]: confluenceRenderUiMcpServerEntry(sandboxDir),
        [CONFLUENCE_TOOLS_SERVER_NAME]: confluenceToolsMcpServerEntry(sandboxDir)
      }
    })
  }
  return renderUiMcpConfigJson(sandboxDir)
}

/**
 * Per-target grounding system prompt for the headless run, or undefined for targets that
 * need none. The jira target gets a hard anti-fabrication instruction: the render tool's
 * description carries an EXAMPLE with placeholder tickets (PROJ-1 …), and the run has no
 * other system prompt — so without this the model will copy the example and invent a board
 * when it lacks real data. This forces it to fetch real tickets first and surface errors as
 * a Notice rather than fabricating.
 */
export function groundingPromptForTarget(
  target: UiRenderTarget = DEFAULT_UI_RENDER_TARGET
): string | undefined {
  if (target === 'jira') {
    return [
      'You render Jira UI surfaces for the cosmos Jira panel from REAL Jira data ONLY.',
      'Before calling render_jira_ui you MUST fetch the actual tickets with jira_search_issues',
      '(and jira_get_issue for detail). Every issueKey, summary, status, assignee, and comment',
      'you render MUST come verbatim from a tool result in THIS conversation. NEVER invent,',
      'guess, paraphrase, or use placeholder/example data — the issue keys and summaries shown',
      'in the render_jira_ui description are format illustration only; do NOT copy their values.',
      'If Jira is not connected or a tool returns an error, render a single Notice component',
      'explaining that (and to connect/reconnect Jira) INSTEAD of fabricating any tickets.'
    ].join(' ')
  }
  if (target === 'slack') {
    // Read-only anti-fabrication grounding, mirroring the Jira one (FR-011).
    return [
      'You render Slack UI surfaces for the cosmos Slack panel from REAL Slack data ONLY.',
      'Before calling render_slack_ui you MUST fetch the actual data with the Slack read tools',
      '(slack_list_channels, slack_read_history, slack_read_thread, slack_search_messages,',
      'slack_lookup_user). Every channel name, message, author, timestamp, and search hit you',
      'render MUST come verbatim from a tool result in THIS conversation. NEVER invent, guess,',
      'paraphrase, or use placeholder/example data — the values shown in the render_slack_ui',
      'description are format illustration only; do NOT copy them. If Slack is not connected or',
      'a tool returns an error, render a single Notice component explaining that (and to',
      'connect/reconnect Slack in cosmos) INSTEAD of fabricating any channels, messages, or',
      'users. If a read returns no results, convey "nothing found" rather than inventing rows.'
    ].join(' ')
  }
  if (target === 'confluence') {
    // Read-only anti-fabrication grounding, mirroring the Jira one (FR-011).
    return [
      'You render Confluence UI surfaces for the cosmos Confluence panel from REAL Confluence',
      'data ONLY. Before calling render_confluence_ui you MUST fetch the actual data with the',
      'Confluence read tools (confluence_search_content, confluence_get_page). Every page title,',
      'space, excerpt, and body you render MUST come verbatim from a tool result in THIS',
      'conversation. NEVER invent, guess, paraphrase, or use placeholder/example data — the',
      'values shown in the render_confluence_ui description are format illustration only; do NOT',
      'copy them. If Confluence is not connected or a tool returns an error, render a single',
      'Notice component explaining that (and to connect/reconnect Confluence in cosmos) INSTEAD',
      'of fabricating any pages. If a read returns no results, convey "nothing found" rather',
      'than inventing rows.'
    ].join(' ')
  }
  return undefined
}

/**
 * The `--allowedTools` grant string for a render `target` (least-privilege). The
 * generated-ui target grants ONLY the generic render tool; the jira target grants the Jira
 * render tool PLUS the Jira read+write tools (comma-separated — the form `--allowedTools`
 * accepts), so the run can read real tickets and mutate when asked.
 */
export function allowedToolForTarget(
  target: UiRenderTarget = DEFAULT_UI_RENDER_TARGET
): string {
  if (target === 'jira') {
    return [JIRA_RENDER_UI_TOOL, ...JIRA_TOOL_GRANTS].join(',')
  }
  if (target === 'slack') {
    // Slack render tool + the five read-only Slack tools; NO writes (FR-009/FR-010/FR-012).
    return [SLACK_RENDER_UI_TOOL, ...SLACK_TOOL_GRANTS].join(',')
  }
  if (target === 'confluence') {
    // Confluence render tool + the two read-only Confluence tools; NO writes.
    return [CONFLUENCE_RENDER_UI_TOOL, ...CONFLUENCE_TOOL_GRANTS].join(',')
  }
  return RENDER_UI_TOOL
}
