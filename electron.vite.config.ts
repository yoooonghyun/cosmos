import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // PoC milestone 2: the stdio MCP entry script the `claude` CLI spawns
          // (per .mcp.json). Emitted into the main outDir; the rollup input key
          // 'mcp/renderUiServer' lands it at out/main/mcp/renderUiServer.js.
          'mcp/renderUiServer': resolve(__dirname, 'src/mcp/renderUiServer.ts'),
          // Jira generative-UI v2 (D3): the Jira-scoped render tool entry script.
          // Lands at out/main/mcp/jiraRenderUiServer.js (matches embeddedMcpConfig).
          'mcp/jiraRenderUiServer': resolve(__dirname, 'src/mcp/jiraRenderUiServer.ts'),
          // Slack + Confluence generative-UI v1 (FR-017): the scoped render tool entry
          // scripts. Land at out/main/mcp/{slack,confluence}RenderUiServer.js (match the
          // mcpConfig.ts paths). Without these inputs the servers never bundle.
          'mcp/slackRenderUiServer': resolve(__dirname, 'src/mcp/slackRenderUiServer.ts'),
          'mcp/confluenceRenderUiServer': resolve(
            __dirname,
            'src/mcp/confluenceRenderUiServer.ts'
          ),
          // Slack integration v1: read-only Slack MCP entry script. Lands at
          // out/main/mcp/slackMcpServer.js (matches embeddedMcpConfig path).
          'mcp/slackMcpServer': resolve(__dirname, 'src/mcp/slackMcpServer.ts'),
          // Atlassian integration v1: read-only Jira + Confluence MCP entry
          // scripts. Land at out/main/mcp/{jira,confluence}McpServer.js (match
          // the embeddedMcpConfig paths in src/main/index.ts).
          'mcp/jiraMcpServer': resolve(__dirname, 'src/mcp/jiraMcpServer.ts'),
          'mcp/confluenceMcpServer': resolve(__dirname, 'src/mcp/confluenceMcpServer.ts'),
          // Google Calendar integration v1: the scoped render tool entry + the read-only
          // Google Calendar MCP entry. Land at out/main/mcp/googleCalendar{RenderUi,Mcp}Server.js
          // (match the mcpConfig.ts paths). Without these inputs the servers never bundle.
          'mcp/googleCalendarRenderUiServer': resolve(
            __dirname,
            'src/mcp/googleCalendarRenderUiServer.ts'
          ),
          'mcp/googleCalendarMcpServer': resolve(__dirname, 'src/mcp/googleCalendarMcpServer.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
