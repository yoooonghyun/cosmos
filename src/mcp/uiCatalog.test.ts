/**
 * uiCatalog — shared catalog text + `get_ui_catalog` tool registration helper tests
 * (ui-catalog-pull-spinner-signal-v1, FR-001/FR-002/FR-003).
 *
 * Node-env: `registerGetUiCatalogTool` is registered against a tiny FAKE server (the helper
 * is structurally typed over `registerTool`), so no MCP server / socket is booted. RED before
 * the change: the module + helper did not exist.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  A2UI_CATALOG_TEXT,
  registerGetUiCatalogTool,
  type CatalogToolServer
} from './uiCatalog'

/** Capture the tool the helper registers so the test can drive its handler. */
function makeFakeServer(): {
  server: CatalogToolServer
  getTool: () => {
    name: string
    handler: () => Promise<{ content: { type: 'text'; text: string }[] }>
  } | null
} {
  let captured: {
    name: string
    handler: () => Promise<{ content: { type: 'text'; text: string }[] }>
  } | null = null
  const server: CatalogToolServer = {
    registerTool(name: string, _config: unknown, handler: unknown) {
      captured = {
        name,
        handler: handler as () => Promise<{ content: { type: 'text'; text: string }[] }>
      }
      return undefined
    }
  }
  return { server, getTool: () => captured }
}

describe('registerGetUiCatalogTool (FR-001/FR-002)', () => {
  it('registers a tool named "get_ui_catalog"', () => {
    const { server, getTool } = makeFakeServer()
    registerGetUiCatalogTool(server, { onGenerating: vi.fn() })
    expect(getTool()?.name).toBe('get_ui_catalog')
  })

  it('the handler returns the single-sourced A2UI_CATALOG_TEXT as a text content result', async () => {
    const { server, getTool } = makeFakeServer()
    registerGetUiCatalogTool(server, { onGenerating: vi.fn() })
    const result = await getTool()!.handler()
    expect(result.content).toEqual([{ type: 'text', text: A2UI_CATALOG_TEXT }])
  })

  it('invokes the injected onGenerating side-effect ONCE per call (the begin-signal, FR-003)', async () => {
    const { server, getTool } = makeFakeServer()
    const onGenerating = vi.fn()
    registerGetUiCatalogTool(server, { onGenerating })
    await getTool()!.handler()
    expect(onGenerating).toHaveBeenCalledTimes(1)
    await getTool()!.handler()
    expect(onGenerating).toHaveBeenCalledTimes(2)
  })

  it('still returns the catalog when onGenerating THROWS (bridge down — FR-010/FR-012)', async () => {
    const { server, getTool } = makeFakeServer()
    registerGetUiCatalogTool(server, {
      onGenerating: () => {
        throw new Error('bridge down')
      }
    })
    const result = await getTool()!.handler()
    expect(result.content[0].text).toBe(A2UI_CATALOG_TEXT)
  })
})

describe('A2UI_CATALOG_TEXT — single source of the authoring catalog (SC-005)', () => {
  it('is a non-empty string carrying the A2UI component grammar + bindings rules', () => {
    expect(typeof A2UI_CATALOG_TEXT).toBe('string')
    expect(A2UI_CATALOG_TEXT.length).toBeGreaterThan(0)
    // The component grammar + the refreshable-bindings section moved here verbatim.
    expect(A2UI_CATALOG_TEXT).toContain('ChoicePicker')
    expect(A2UI_CATALOG_TEXT).toContain('REFRESHABLE DATA')
    expect(A2UI_CATALOG_TEXT).toContain('bindings')
  })

  it('is pure authoring guidance — no real credential value (SC-007)', () => {
    // The text legitimately INSTRUCTS "NEVER a token" in the bindings rules; it must not embed
    // an actual secret value. Assert no obvious credential-bearing patterns are present.
    expect(A2UI_CATALOG_TEXT).not.toMatch(/Bearer\s+\S+/i)
    expect(A2UI_CATALOG_TEXT).not.toMatch(/COSMOS_[A-Z_]*SECRET/)
  })
})
