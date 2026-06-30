import { describe, it, expect } from 'vitest'
import {
  CONFLUENCE_GET_UI_CATALOG_TOOL,
  CONFLUENCE_RENDER_UI_SERVER_NAME,
  CONFLUENCE_RENDER_UI_TOOL,
  CONFLUENCE_TOOLS_SERVER_NAME,
  CONFLUENCE_TOOL_GRANTS,
  CONFLUENCE_WRITE_TOOL_GRANTS,
  GOOGLE_CALENDAR_TOOL_GRANTS,
  NO_INTEGRATIONS_CONNECTED,
  type ConnectedIntegrations,
  GET_UI_CATALOG_TOOL,
  JIRA_GET_UI_CATALOG_TOOL,
  JIRA_RENDER_UI_SERVER_NAME,
  JIRA_RENDER_UI_TOOL,
  JIRA_TOOLS_SERVER_NAME,
  JIRA_TOOL_GRANTS,
  RENDER_UI_TOOL,
  SLACK_GET_UI_CATALOG_TOOL,
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
  it("grants get_ui_catalog + render_jira_ui PLUS the jira read+write tools for the 'jira' target", () => {
    const grant = allowedToolForTarget('jira')
    expect(grant).toBe(
      [JIRA_GET_UI_CATALOG_TOOL, JIRA_RENDER_UI_TOOL, ...JIRA_TOOL_GRANTS].join(',')
    )
    // ui-catalog-pull-spinner-signal-v1 (FR-009): the catalog tool is granted first.
    const tools = grant.split(',')
    expect(tools[0]).toBe(JIRA_GET_UI_CATALOG_TOOL)
    expect(tools).toContain(JIRA_RENDER_UI_TOOL)
  })

  it("grants get_ui_catalog + render_ui for the 'generated-ui' target (FR-009)", () => {
    expect(allowedToolForTarget('generated-ui')).toBe(
      [GET_UI_CATALOG_TOOL, RENDER_UI_TOOL].join(',')
    )
  })

  it('defaults to get_ui_catalog + render_ui when target is omitted', () => {
    expect(allowedToolForTarget()).toBe([GET_UI_CATALOG_TOOL, RENDER_UI_TOOL].join(','))
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
  it("grants get_ui_catalog + render_slack_ui PLUS the read-only slack tools and NOTHING else", () => {
    const grant = allowedToolForTarget('slack')
    expect(grant).toBe(
      [SLACK_GET_UI_CATALOG_TOOL, SLACK_RENDER_UI_TOOL, ...SLACK_TOOL_GRANTS].join(',')
    )
    const tools = grant.split(',')
    expect(tools[0]).toBe(SLACK_GET_UI_CATALOG_TOOL)
    expect(tools).toContain(SLACK_RENDER_UI_TOOL)
    // Read-only: no write tool, no jira/confluence/generic tool reachable.
    expect(tools).not.toContain(RENDER_UI_TOOL)
    expect(tools).not.toContain(JIRA_RENDER_UI_TOOL)
    expect(tools).not.toContain(CONFLUENCE_RENDER_UI_TOOL)
    expect(tools.some((t) => t.includes('cosmos-jira'))).toBe(false)
    expect(tools.some((t) => t.includes('cosmos-confluence'))).toBe(false)
  })

  it("grants get_ui_catalog + render_confluence_ui PLUS the reads AND the 3 curated writes (cosmos-agent-surgical-write-access-v1)", () => {
    const grant = allowedToolForTarget('confluence')
    expect(grant).toBe(
      [
        CONFLUENCE_GET_UI_CATALOG_TOOL,
        CONFLUENCE_RENDER_UI_TOOL,
        ...CONFLUENCE_TOOL_GRANTS,
        ...CONFLUENCE_WRITE_TOOL_GRANTS
      ].join(',')
    )
    const tools = grant.split(',')
    expect(tools[0]).toBe(CONFLUENCE_GET_UI_CATALOG_TOOL)
    expect(tools).toContain(CONFLUENCE_RENDER_UI_TOOL)
    // The panel is no longer read-only — the three curated writes are granted.
    for (const w of CONFLUENCE_WRITE_TOOL_GRANTS) {
      expect(tools).toContain(w)
    }
    // Still least-privilege: no other integration's tools, no generic render.
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

  it('returns the catalog-pull steering for the generated-ui target (ui-catalog-pull-spinner-signal-v1 FR-009)', () => {
    // Previously undefined; now the generic run also pulls get_ui_catalog first.
    const prompt = groundingPromptForTarget('generated-ui')
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('get_ui_catalog')
  })
})

describe('groundingPromptForTarget — get_ui_catalog ordering clause (ui-catalog-pull-spinner-signal-v1, FR-009)', () => {
  it('every render target instructs ALWAYS call get_ui_catalog before render', () => {
    for (const target of [
      'generated-ui',
      'jira',
      'slack',
      'confluence',
      'google-calendar'
    ] as const) {
      const prompt = groundingPromptForTarget(target)
      expect(prompt).toBeTruthy()
      expect(prompt).toContain('get_ui_catalog')
    }
  })
})

describe('groundingPromptForTarget — bindings-first steering (v2 Fix A)', () => {
  it('every data-bearing target forces a binding per data container with its own narrowed query', () => {
    for (const target of ['jira', 'slack', 'confluence'] as const) {
      const prompt = groundingPromptForTarget(target)
      expect(prompt).toBeTruthy()
      // The uniform clause: a binding per container, narrowed per-container query, no broad split.
      expect(prompt).toContain('binding')
      expect(prompt).toContain('narrowed')
      expect(prompt).toContain('NEVER partition a broad fetch')
      // Secret-free: never instruct a token.
      expect(prompt).toContain('NEVER a token')
    }
  })

  it('teaches the exact adapter-source dataSource ids and warns against the read-tool name (v3)', () => {
    for (const target of ['jira', 'slack', 'confluence'] as const) {
      const prompt = groundingPromptForTarget(target)!
      // dataSource is the adapter source id, NOT the MCP read-tool name.
      expect(prompt).toContain('ADAPTER SOURCE id')
      // The valid ids per integration are stated.
      expect(prompt).toContain('searchIssues')
      expect(prompt).toContain('getIssue')
      expect(prompt).toContain('listChannels')
      expect(prompt).toContain('getHistory')
      expect(prompt).toContain('defaultFeed')
      expect(prompt).toContain('searchContent')
      expect(prompt).toContain('getPage')
      // And the read-tool names are explicitly called out as WRONG.
      expect(prompt).toContain('jira_search_issues')
      expect(prompt).toContain('slack_read_history')
      expect(prompt).toContain('confluence_search_content')
    }
  })
})

/* ------------------------------------------------------------------------- *
 * cosmos-agent-surgical-write-access-v1 — Home reads+writes + per-panel writes
 * ------------------------------------------------------------------------- */

/** Build a ConnectedIntegrations from a partial (defaults all-false). */
function connected(partial: Partial<ConnectedIntegrations> = {}): ConnectedIntegrations {
  return { jira: false, confluence: false, slack: false, googleCalendar: false, ...partial }
}

/** Parse the mcpServers keys out of a render-config JSON string. */
function serverKeys(json: string): string[] {
  return Object.keys((JSON.parse(json) as { mcpServers: Record<string, unknown> }).mcpServers)
}

describe('CONFLUENCE_WRITE_TOOL_GRANTS — the curated, non-destructive write set', () => {
  it('is exactly the three create/update/comment write tool names', () => {
    expect(CONFLUENCE_WRITE_TOOL_GRANTS).toEqual([
      'mcp__cosmos-confluence__confluence_create_page',
      'mcp__cosmos-confluence__confluence_update_page',
      'mcp__cosmos-confluence__confluence_create_comment'
    ])
  })

  it('contains NO delete/purge/destructive tool (OQ-5)', () => {
    for (const grant of CONFLUENCE_WRITE_TOOL_GRANTS) {
      expect(grant).not.toMatch(/delete|purge|remove|destroy/i)
    }
  })

  it('is disjoint from the read grants (read/write split stays reviewable)', () => {
    for (const w of CONFLUENCE_WRITE_TOOL_GRANTS) {
      expect(CONFLUENCE_TOOL_GRANTS).not.toContain(w)
    }
  })
})

describe('allowedToolForTarget(generated-ui, connected) — connected-aware Home grant', () => {
  it('none connected → exactly get_ui_catalog,render_ui (byte-identical to today)', () => {
    expect(allowedToolForTarget('generated-ui', NO_INTEGRATIONS_CONNECTED)).toBe(
      [GET_UI_CATALOG_TOOL, RENDER_UI_TOOL].join(',')
    )
    // default arg (no connected) is identical to all-false.
    expect(allowedToolForTarget('generated-ui')).toBe(
      allowedToolForTarget('generated-ui', NO_INTEGRATIONS_CONNECTED)
    )
  })

  it('{confluence} → render_ui + catalog + confluence reads + 3 writes; NO jira/slack/calendar; NO render_confluence_ui', () => {
    const tools = allowedToolForTarget('generated-ui', connected({ confluence: true })).split(',')
    expect(tools).toContain(GET_UI_CATALOG_TOOL)
    expect(tools).toContain(RENDER_UI_TOOL)
    for (const t of [...CONFLUENCE_TOOL_GRANTS, ...CONFLUENCE_WRITE_TOOL_GRANTS]) {
      expect(tools).toContain(t)
    }
    for (const t of [...JIRA_TOOL_GRANTS, ...SLACK_TOOL_GRANTS, ...GOOGLE_CALENDAR_TOOL_GRANTS]) {
      expect(tools).not.toContain(t)
    }
    // OQ-7: Home never gets a per-integration render/catalog tool.
    expect(tools.some((t) => /cosmos-(jira|slack|confluence|google-calendar)-render-ui__/.test(t))).toBe(
      false
    )
  })

  it('{jira, slack} → jira read+write + slack reads; NO confluence/calendar', () => {
    const tools = allowedToolForTarget('generated-ui', connected({ jira: true, slack: true })).split(
      ','
    )
    for (const t of [...JIRA_TOOL_GRANTS, ...SLACK_TOOL_GRANTS]) {
      expect(tools).toContain(t)
    }
    for (const t of [...CONFLUENCE_WRITE_TOOL_GRANTS, ...GOOGLE_CALENDAR_TOOL_GRANTS]) {
      expect(tools).not.toContain(t)
    }
  })

  it('all four connected → union of all data grants; still NO per-integration render tools', () => {
    const all = connected({ jira: true, confluence: true, slack: true, googleCalendar: true })
    const tools = allowedToolForTarget('generated-ui', all).split(',')
    for (const t of [
      ...JIRA_TOOL_GRANTS,
      ...CONFLUENCE_TOOL_GRANTS,
      ...CONFLUENCE_WRITE_TOOL_GRANTS,
      ...SLACK_TOOL_GRANTS,
      ...GOOGLE_CALENDAR_TOOL_GRANTS
    ]) {
      expect(tools).toContain(t)
    }
    expect(tools.some((t) => /cosmos-(jira|slack|confluence|google-calendar)-render-ui__/.test(t))).toBe(
      false
    )
  })
})

describe('renderMcpConfigJsonForTarget(generated-ui, connected) — Home tool servers', () => {
  it('none connected → only cosmos-render-ui (identical to renderUiMcpConfigJson)', () => {
    const json = renderMcpConfigJsonForTarget(SANDBOX, 'generated-ui', NO_INTEGRATIONS_CONNECTED)
    expect(serverKeys(json)).toEqual(['cosmos-render-ui'])
    // Byte-identical to the pre-feature render-only builder.
    expect(json).toBe(renderUiMcpConfigJson(SANDBOX))
    expect(renderMcpConfigJsonForTarget(SANDBOX, 'generated-ui')).toBe(json)
  })

  it('{confluence} → cosmos-render-ui + cosmos-confluence TOOL server; NO render servers', () => {
    const json = renderMcpConfigJsonForTarget(
      SANDBOX,
      'generated-ui',
      connected({ confluence: true })
    )
    expect(serverKeys(json).sort()).toEqual(['cosmos-confluence', 'cosmos-render-ui'])
    expect(json).not.toContain('cosmos-confluence-render-ui')
  })

  it('all four connected → render-ui + the four tool servers; NO *-render-ui integration servers', () => {
    const all = connected({ jira: true, confluence: true, slack: true, googleCalendar: true })
    const json = renderMcpConfigJsonForTarget(SANDBOX, 'generated-ui', all)
    expect(serverKeys(json).sort()).toEqual([
      'cosmos-confluence',
      'cosmos-google-calendar',
      'cosmos-jira',
      'cosmos-render-ui',
      'cosmos-slack'
    ])
    // No per-INTEGRATION render server (only the generic cosmos-render-ui is allowed to end -render-ui).
    for (const k of serverKeys(json)) {
      expect(k).not.toMatch(/^cosmos-(jira|slack|confluence|google-calendar)-render-ui$/)
    }
  })
})

describe('groundingPromptForTarget(generated-ui, connected) — combined Home clause', () => {
  it('none connected → catalog-pull steering only (no integration clause)', () => {
    const prompt = groundingPromptForTarget('generated-ui', NO_INTEGRATIONS_CONNECTED) ?? ''
    expect(prompt).toContain('get_ui_catalog')
    expect(prompt).not.toMatch(/Jira|Confluence|Slack|Google Calendar/)
    expect(groundingPromptForTarget('generated-ui')).toBe(prompt)
  })

  it('{confluence} → mentions Confluence + write permission + Notice; does NOT name unconnected integrations', () => {
    const prompt = groundingPromptForTarget('generated-ui', connected({ confluence: true })) ?? ''
    expect(prompt).toContain('Confluence')
    expect(prompt).toMatch(/confluence_create_page/)
    expect(prompt).toMatch(/Notice/)
    expect(prompt).toMatch(/verbatim/)
    expect(prompt).not.toMatch(/Jira|Slack|Google Calendar/)
  })

  it('Slack/Calendar are described READ-ONLY when connected (no write tools)', () => {
    const prompt =
      groundingPromptForTarget('generated-ui', connected({ slack: true, googleCalendar: true })) ?? ''
    expect(prompt).toMatch(/READ-ONLY/)
    expect(prompt).toContain('Slack')
    expect(prompt).toContain('Google Calendar')
  })
})

describe('groundingPromptForTarget(confluence) — sanctioned writes', () => {
  it('retains read-first anti-fabrication + bindings-first AND adds the three sanctioned writes', () => {
    const prompt = groundingPromptForTarget('confluence') ?? ''
    expect(prompt).toMatch(/verbatim/)
    expect(prompt).toMatch(/NEVER invent/)
    expect(prompt).toMatch(/REFRESHABILITY IS MANDATORY/)
    expect(prompt).toMatch(/confluence_create_page/)
    expect(prompt).toMatch(/confluence_update_page/)
    expect(prompt).toMatch(/confluence_create_comment/)
  })
})
