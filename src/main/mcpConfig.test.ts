import { describe, it, expect } from 'vitest'
import {
  CONFLUENCE_RENDER_UI_SERVER_NAME,
  CONFLUENCE_RENDER_UI_TOOL,
  CONFLUENCE_TOOLS_SERVER_NAME,
  CONFLUENCE_TOOL_GRANTS,
  JIRA_RENDER_UI_SERVER_NAME,
  JIRA_RENDER_UI_TOOL,
  JIRA_TOOLS_SERVER_NAME,
  JIRA_TOOL_GRANTS,
  RENDER_UI_TOOL,
  SLACK_RENDER_UI_SERVER_NAME,
  SLACK_RENDER_UI_TOOL,
  SLACK_TOOLS_SERVER_NAME,
  SLACK_TOOL_GRANTS,
  allowedToolForTarget,
  confluenceRenderUiMcpServerEntry,
  confluenceToolsMcpServerEntry,
  groundingPromptForTarget,
  jiraRenderUiMcpServerEntry,
  renderMcpConfigJsonForTarget,
  renderUiMcpConfigJson,
  renderUiMcpServerEntry,
  slackRenderUiMcpServerEntry,
  slackToolsMcpServerEntry
} from './mcpConfig'
import { bridgeSocketPath } from '../shared/bridge'

const SANDBOX = '/tmp/cosmos-sandbox'

describe('renderUiMcpServerEntry (FR-007)', () => {
  it('is a node stdio entry pointing the bridge socket at the sandbox UiBridge', () => {
    const entry = renderUiMcpServerEntry(SANDBOX)
    expect(entry.type).toBe('stdio')
    expect(entry.command).toBe('node')
    expect(entry.args).toHaveLength(1)
    expect(entry.args[0]).toMatch(/mcp\/renderUiServer\.js$/)
    expect(entry.env.COSMOS_BRIDGE_SOCKET).toBe(bridgeSocketPath(SANDBOX))
  })
})

describe('renderUiMcpConfigJson (FR-013 least-privilege)', () => {
  it('produces a single-server cosmos-render-ui config (no slack/jira/confluence)', () => {
    const config = JSON.parse(renderUiMcpConfigJson(SANDBOX))
    expect(Object.keys(config.mcpServers)).toEqual(['cosmos-render-ui'])
  })

  it('matches the entry exactly (no drift between the interactive + headless configs)', () => {
    const config = JSON.parse(renderUiMcpConfigJson(SANDBOX))
    expect(config.mcpServers['cosmos-render-ui']).toEqual(renderUiMcpServerEntry(SANDBOX))
  })
})

describe('jiraRenderUiMcpServerEntry (Jira generative-UI v2, D3)', () => {
  it('is a node stdio entry for the jira render server pointing at the SAME bridge socket', () => {
    const entry = jiraRenderUiMcpServerEntry(SANDBOX)
    expect(entry.type).toBe('stdio')
    expect(entry.command).toBe('node')
    expect(entry.args).toHaveLength(1)
    expect(entry.args[0]).toMatch(/mcp\/jiraRenderUiServer\.js$/)
    // same UiBridge socket as render_ui — no second bridge (D3).
    expect(entry.env.COSMOS_BRIDGE_SOCKET).toBe(bridgeSocketPath(SANDBOX))
    expect(entry.env.COSMOS_BRIDGE_SOCKET).toBe(renderUiMcpServerEntry(SANDBOX).env.COSMOS_BRIDGE_SOCKET)
  })
})

describe('renderMcpConfigJsonForTarget (Jira generative-UI v2, D2 least-privilege)', () => {
  it("target 'jira' registers the jira render server + jira tools (no generic render_ui)", () => {
    const config = JSON.parse(renderMcpConfigJsonForTarget(SANDBOX, 'jira'))
    expect(Object.keys(config.mcpServers)).toEqual([
      JIRA_RENDER_UI_SERVER_NAME,
      JIRA_TOOLS_SERVER_NAME
    ])
    expect(config.mcpServers[JIRA_RENDER_UI_SERVER_NAME]).toEqual(jiraRenderUiMcpServerEntry(SANDBOX))
    // No slack/confluence/generic render server leaks into a jira run (least-privilege).
    expect(config.mcpServers['cosmos-render-ui']).toBeUndefined()
    expect(config.mcpServers[SLACK_RENDER_UI_SERVER_NAME]).toBeUndefined()
    expect(config.mcpServers[CONFLUENCE_RENDER_UI_SERVER_NAME]).toBeUndefined()
  })

  it("target 'generated-ui' registers ONLY the generic render server (not jira)", () => {
    const config = JSON.parse(renderMcpConfigJsonForTarget(SANDBOX, 'generated-ui'))
    expect(Object.keys(config.mcpServers)).toEqual(['cosmos-render-ui'])
  })

  it('defaults to the generic render server when target is omitted (backward-compatible)', () => {
    const config = JSON.parse(renderMcpConfigJsonForTarget(SANDBOX))
    expect(Object.keys(config.mcpServers)).toEqual(['cosmos-render-ui'])
  })
})

describe('allowedToolForTarget (Jira generative-UI v2, D2 grants)', () => {
  it("grants render_jira_ui PLUS the jira read+write tools for the 'jira' target", () => {
    const grant = allowedToolForTarget('jira')
    expect(grant).toBe([JIRA_RENDER_UI_TOOL, ...JIRA_TOOL_GRANTS].join(','))
    // The render tool is first; the jira tool grants follow.
    expect(grant.split(',')[0]).toBe(JIRA_RENDER_UI_TOOL)
  })

  it("grants ONLY render_ui for the 'generated-ui' target", () => {
    expect(allowedToolForTarget('generated-ui')).toBe(RENDER_UI_TOOL)
  })

  it('defaults to render_ui when target is omitted', () => {
    expect(allowedToolForTarget()).toBe(RENDER_UI_TOOL)
  })
})

/* ------------------------------------------------------------------------- *
 * Slack + Confluence generative-UI v1 (read-only) — FR-008..FR-012
 * ------------------------------------------------------------------------- */

describe('slack/confluence render-UI server entries (FR-008)', () => {
  it('the slack render server points at the SAME UiBridge socket as render_ui (no second bridge)', () => {
    const entry = slackRenderUiMcpServerEntry(SANDBOX)
    expect(entry.type).toBe('stdio')
    expect(entry.command).toBe('node')
    expect(entry.args[0]).toMatch(/mcp\/slackRenderUiServer\.js$/)
    expect(entry.env.COSMOS_BRIDGE_SOCKET).toBe(bridgeSocketPath(SANDBOX))
  })

  it('the confluence render server points at the SAME UiBridge socket as render_ui', () => {
    const entry = confluenceRenderUiMcpServerEntry(SANDBOX)
    expect(entry.type).toBe('stdio')
    expect(entry.command).toBe('node')
    expect(entry.args[0]).toMatch(/mcp\/confluenceRenderUiServer\.js$/)
    expect(entry.env.COSMOS_BRIDGE_SOCKET).toBe(bridgeSocketPath(SANDBOX))
  })
})

describe('renderMcpConfigJsonForTarget — slack/confluence (least-privilege, FR-008..FR-010)', () => {
  it("target 'slack' registers the slack render server + read-only slack tools only", () => {
    const config = JSON.parse(renderMcpConfigJsonForTarget(SANDBOX, 'slack'))
    expect(Object.keys(config.mcpServers)).toEqual([
      SLACK_RENDER_UI_SERVER_NAME,
      SLACK_TOOLS_SERVER_NAME
    ])
    expect(config.mcpServers[SLACK_RENDER_UI_SERVER_NAME]).toEqual(
      slackRenderUiMcpServerEntry(SANDBOX)
    )
    expect(config.mcpServers[SLACK_TOOLS_SERVER_NAME]).toEqual(slackToolsMcpServerEntry(SANDBOX))
    // No jira/confluence/generic render server leaks into a slack run.
    expect(config.mcpServers['cosmos-render-ui']).toBeUndefined()
    expect(config.mcpServers[JIRA_RENDER_UI_SERVER_NAME]).toBeUndefined()
    expect(config.mcpServers[CONFLUENCE_RENDER_UI_SERVER_NAME]).toBeUndefined()
  })

  it("target 'confluence' registers the confluence render server + read-only confluence tools only", () => {
    const config = JSON.parse(renderMcpConfigJsonForTarget(SANDBOX, 'confluence'))
    expect(Object.keys(config.mcpServers)).toEqual([
      CONFLUENCE_RENDER_UI_SERVER_NAME,
      CONFLUENCE_TOOLS_SERVER_NAME
    ])
    expect(config.mcpServers[CONFLUENCE_RENDER_UI_SERVER_NAME]).toEqual(
      confluenceRenderUiMcpServerEntry(SANDBOX)
    )
    expect(config.mcpServers[CONFLUENCE_TOOLS_SERVER_NAME]).toEqual(
      confluenceToolsMcpServerEntry(SANDBOX)
    )
    // No jira/slack/generic render server leaks into a confluence run.
    expect(config.mcpServers['cosmos-render-ui']).toBeUndefined()
    expect(config.mcpServers[JIRA_RENDER_UI_SERVER_NAME]).toBeUndefined()
    expect(config.mcpServers[SLACK_RENDER_UI_SERVER_NAME]).toBeUndefined()
  })
})

describe('allowedToolForTarget — slack/confluence (read-only, FR-009/FR-010/FR-012)', () => {
  it("grants render_slack_ui PLUS the read-only slack tools and NOTHING else", () => {
    const grant = allowedToolForTarget('slack')
    expect(grant).toBe([SLACK_RENDER_UI_TOOL, ...SLACK_TOOL_GRANTS].join(','))
    const tools = grant.split(',')
    expect(tools[0]).toBe(SLACK_RENDER_UI_TOOL)
    // Read-only: no write tool, no jira/confluence/generic tool reachable.
    expect(tools).not.toContain(RENDER_UI_TOOL)
    expect(tools).not.toContain(JIRA_RENDER_UI_TOOL)
    expect(tools).not.toContain(CONFLUENCE_RENDER_UI_TOOL)
    expect(tools.some((t) => t.includes('cosmos-jira'))).toBe(false)
    expect(tools.some((t) => t.includes('cosmos-confluence'))).toBe(false)
  })

  it("grants render_confluence_ui PLUS the read-only confluence tools and NOTHING else", () => {
    const grant = allowedToolForTarget('confluence')
    expect(grant).toBe([CONFLUENCE_RENDER_UI_TOOL, ...CONFLUENCE_TOOL_GRANTS].join(','))
    const tools = grant.split(',')
    expect(tools[0]).toBe(CONFLUENCE_RENDER_UI_TOOL)
    expect(tools).not.toContain(RENDER_UI_TOOL)
    expect(tools).not.toContain(JIRA_RENDER_UI_TOOL)
    expect(tools).not.toContain(SLACK_RENDER_UI_TOOL)
    expect(tools.some((t) => t.includes('cosmos-jira'))).toBe(false)
    expect(tools.some((t) => t.includes('cosmos-slack'))).toBe(false)
  })
})

describe('groundingPromptForTarget — slack/confluence anti-fabrication (FR-011)', () => {
  it('returns a non-empty grounding prompt for the slack target that forbids fabrication', () => {
    const prompt = groundingPromptForTarget('slack')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Slack')
    expect(prompt?.toLowerCase()).toContain('never invent')
    // Must instruct to fetch real data with the read tools.
    expect(prompt).toContain('slack_list_channels')
  })

  it('returns a non-empty grounding prompt for the confluence target that forbids fabrication', () => {
    const prompt = groundingPromptForTarget('confluence')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Confluence')
    expect(prompt?.toLowerCase()).toContain('never invent')
    expect(prompt).toContain('confluence_search_content')
  })

  it('returns undefined for the generated-ui target (no grounding needed)', () => {
    expect(groundingPromptForTarget('generated-ui')).toBeUndefined()
  })
})
