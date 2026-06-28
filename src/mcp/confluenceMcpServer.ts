/**
 * Confluence MCP entry script (Atlassian integration v1). A fully separate sibling
 * to jiraMcpServer.ts (its own socket — FR-A13).
 *
 * The main-managed `--mcp-config` registers this as a stdio MCP server; the
 * `claude` CLI spawns it and speaks JSON-RPC over stdin/stdout (FR-X01). It exposes
 * the two read Confluence tools plus the single page-create WRITE tool. Each tool is a thin relay:
 * it forwards an `op` + `params` to the running Electron main process over the
 * Confluence Unix-domain socket (`src/main/confluenceBridge.ts`), awaits the typed
 * `ConfluenceResult`, and returns it (FR-X05). Main owns the single connection +
 * token; the token NEVER reaches this process (FR-X02, SC-009).
 *
 * Runs OUTSIDE Electron (plain Node): imports only Node built-ins, the MCP SDK,
 * zod, and the pure shared bridge/confluence modules.
 */

import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  confluenceBridgeSocketPath,
  encodeBridgeMessage,
  type ConfluenceBridgeCallRequest,
  type ConfluenceBridgeServerMessage
} from '../shared/bridge'
import {
  ConfluenceOp,
  ConfluenceTool,
  type ConfluenceOpName,
  type ConfluenceResult
} from '../shared/types/confluence'

function projectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

function resolveSocketPath(): string {
  return process.env['COSMOS_CONFLUENCE_BRIDGE_SOCKET'] || confluenceBridgeSocketPath(projectDir())
}

/** A connection to the main Confluence bridge. NDJSON frames; resolves by `callId`. */
class ConfluenceBridgeClient {
  private socket: Socket | null = null
  private buffer = ''
  private readonly waiters = new Map<string, (result: ConfluenceResult<unknown>) => void>()

  constructor(private readonly socketPath: string) {}

  private ensureConnected(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket)
    }
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath)
      socket.setEncoding('utf8')
      socket.once('connect', () => {
        this.socket = socket
        resolve(socket)
      })
      socket.once('error', (err) => {
        this.socket = null
        reject(err)
      })
      socket.on('data', (chunk: string) => this.onData(chunk))
      socket.on('close', () => {
        this.socket = null
        this.failAllPending()
      })
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) {
        continue
      }
      let message: ConfluenceBridgeServerMessage
      try {
        message = JSON.parse(line) as ConfluenceBridgeServerMessage
      } catch {
        continue
      }
      if (message.kind === 'confluence_result') {
        const waiter = this.waiters.get(message.callId)
        if (waiter) {
          this.waiters.delete(message.callId)
          waiter(message.result)
        }
      }
    }
  }

  private failAllPending(): void {
    for (const [callId, waiter] of this.waiters) {
      this.waiters.delete(callId)
      waiter({
        ok: false,
        kind: 'not_connected',
        message: 'cosmos is not running. Connect Confluence in cosmos first.'
      })
    }
  }

  /** Run one read op; resolves the typed result (or not_connected if unreachable). */
  async call(
    op: ConfluenceOpName,
    params: Record<string, unknown>
  ): Promise<ConfluenceResult<unknown>> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { ok: false, kind: 'not_connected', message: 'Connect Confluence in cosmos first.' }
    }
    const callId = randomUUID()
    const request: ConfluenceBridgeCallRequest = { kind: 'confluence_call', callId, op, params }
    return new Promise<ConfluenceResult<unknown>>((resolve) => {
      this.waiters.set(callId, resolve)
      socket.write(encodeBridgeMessage(request), (err) => {
        if (err) {
          this.waiters.delete(callId)
          resolve({
            ok: false,
            kind: 'not_connected',
            message: 'Connect Confluence in cosmos first.'
          })
        }
      })
    })
  }
}

/** Render a ConfluenceResult as MCP tool content (structured + a text summary). */
function toToolResult(result: ConfluenceResult<unknown>): {
  isError?: boolean
  content: { type: 'text'; text: string }[]
  structuredContent: { result: ConfluenceResult<unknown> }
} {
  if (result.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data) }],
      structuredContent: { result }
    }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: result.message }],
    structuredContent: { result }
  }
}

async function main(): Promise<void> {
  const bridge = new ConfluenceBridgeClient(resolveSocketPath())
  const server = new McpServer({ name: 'cosmos-confluence', version: '0.1.0' })

  server.registerTool(
    ConfluenceTool.SearchContent,
    {
      title: 'Search Confluence content',
      description:
        'Search Confluence pages by text (read-only). Returns matching pages with title, ' +
        'space, and an excerpt. Optionally pass a pagination `cursor` from a previous result.',
      inputSchema: { query: z.string(), cursor: z.string().optional() }
    },
    async ({ query, cursor }) =>
      toToolResult(
        await bridge.call(ConfluenceOp.SearchContent, { query, ...(cursor ? { cursor } : {}) })
      )
  )

  server.registerTool(
    ConfluenceTool.GetPage,
    {
      title: 'Get a Confluence page',
      description:
        'Read one Confluence page in full (read-only): title, space, and body as plain text. ' +
        'Pass the page id.',
      inputSchema: { pageId: z.string() }
    },
    async ({ pageId }) => toToolResult(await bridge.call(ConfluenceOp.GetPage, { pageId }))
  )

  // WRITE tool: create a new page. MUTATES Confluence and reaches ConfluenceManager's
  // single write method (scope-gapped to `write:confluence-content`). The token never
  // reaches this process — main attaches it.
  server.registerTool(
    ConfluenceTool.CreatePage,
    {
      title: 'Create a Confluence page',
      description:
        'MUTATES Confluence: create a NEW page. Pass the destination space KEY ' +
        '(e.g. ENG), a non-empty `title`, and a non-empty `body` (plain text — line ' +
        'breaks are preserved). Optionally pass a `parentId` to nest the page under an ' +
        'existing page. Returns the new page id and title, or a structured error ' +
        '(e.g. an unknown space, write not authorized — reconnect Confluence to grant ' +
        'write access, or reconnect needed).',
      inputSchema: {
        spaceKey: z.string(),
        title: z.string(),
        body: z.string(),
        parentId: z.string().optional()
      }
    },
    async ({ spaceKey, title, body, parentId }) =>
      toToolResult(
        await bridge.call(ConfluenceOp.CreatePage, {
          spaceKey,
          title,
          body,
          ...(parentId !== undefined ? { parentId } : {})
        })
      )
  )

  // WRITE tool: update an existing page. MUTATES Confluence and reaches ConfluenceManager's
  // scope-gated `updatePage` (gated on `write:page:confluence`). The token never reaches this
  // process — main attaches it, reads the current version, and submits version+1.
  server.registerTool(
    ConfluenceTool.UpdatePage,
    {
      title: 'Update a Confluence page',
      description:
        'MUTATES Confluence: replace an EXISTING page\'s title and/or body. Pass the ' +
        '`pageId` and a non-empty `title`. Optionally pass a `body` (plain text — line ' +
        'breaks are preserved) to replace the page content; OMIT `body` (or pass an empty ' +
        'one) to keep the current body unchanged (a title-only edit never wipes content). ' +
        'Optionally pass a short `versionMessage` change note. Returns the page id, title, ' +
        'and the new version number, or a structured error (page not found / no permission; ' +
        'version conflict — the page changed since it was read, re-read it and try again; ' +
        'write not authorized — reconnect Confluence to grant write access; reconnect needed).',
      inputSchema: {
        pageId: z.string(),
        title: z.string(),
        body: z.string().optional(),
        versionMessage: z.string().optional()
      }
    },
    async ({ pageId, title, body, versionMessage }) =>
      toToolResult(
        await bridge.call(ConfluenceOp.UpdatePage, {
          pageId,
          title,
          ...(body !== undefined ? { body } : {}),
          ...(versionMessage !== undefined ? { versionMessage } : {})
        })
      )
  )

  // WRITE tool: add a footer comment to a page. MUTATES Confluence and reaches
  // ConfluenceManager's scope-gated `createComment` (gated on the SEPARATE
  // `write:comment:confluence` scope). The token never reaches this process — main attaches it.
  server.registerTool(
    ConfluenceTool.CreateComment,
    {
      title: 'Comment on a Confluence page',
      description:
        'MUTATES Confluence: add a footer comment to an EXISTING page. Pass the `pageId` ' +
        'and a non-empty `body` (plain text — line breaks are preserved). Returns the new ' +
        'comment id, or a structured error (page not found / no permission; comment not ' +
        'authorized — reconnect Confluence to grant comment access; reconnect needed).',
      inputSchema: {
        pageId: z.string(),
        body: z.string()
      }
    },
    async ({ pageId, body }) =>
      toToolResult(await bridge.call(ConfluenceOp.CreateComment, { pageId, body }))
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[cosmos-confluence] fatal:', err)
  process.exit(1)
})
