/**
 * confluenceToolDescription — the `render_confluence_ui` tool description, EXTRACTED into a
 * side-effect-free module so it is importable by a node-env test without booting the MCP
 * server (`confluenceRenderUiServer.ts` runs `main()` at load — sockets + StdioTransport —
 * so it cannot be imported into a test). Mirrors the catalog `.ts`/`.test.ts` split.
 *
 * The string teaches the model the Confluence CUSTOM catalog (`catalogId: 'confluence'`)
 * vocabulary: same A2UI 0.9 flat-list format as render_ui, but the component TYPE NAMES are
 * the Confluence catalog's, carrying their data as STATIC props (the resource shapes from
 * src/shared/confluence.ts). A `SearchResultRow` is ACTIONABLE — clicking opens that page's
 * detail (confluence-page-detail-nav-v1), so the row `id` MUST be the REAL Confluence page
 * id (confluence-detail-rich-render-v1, FR-001/FR-002/FR-003).
 */

import { AdapterFlagPath } from '../shared/adapter'

export const CONFLUENCE_TOOL_DESCRIPTION = [
  'Render a Confluence UI surface in the cosmos Confluence panel using the Confluence',
  "custom catalog (catalogId: 'confluence'). Use this for content search results and",
  'page detail — it matches the native Confluence panel chrome.',
  '',
  'ARGUMENT: { spec: { surfaceId: string, components: Component[] } } — A2UI 0.9.',
  'components is a FLAT array; each is { "id": "<unique>", "component": "<Type>", ...props }.',
  'Parents reference children by id string. Exactly ONE root (id "root" or the',
  'component nothing else references).',
  '',
  'Confluence component types and their props (each takes STATIC props — real Confluence',
  'data; excerpt is pre-flattened plain text, PageDetail.body is server-rendered HTML):',
  '  SearchResultRow  { id: string, title: string, space?: string, excerpt: string }',
  '  SearchResultList { results: SearchResultRow-props[] }  // empty [] => "No content matches."',
  '  PageDetail  { id: string, title: string, space?: string, body: string }',
  '  Notice      { noticeKind: "info"|"error", message: string }',
  '  Text        { text: string, variant?: "label"|"body", muted?: boolean }',
  '  Column / Row  // layout grouping; reference children by id',
  '',
  'ACTIONABLE ROWS: a SearchResultRow is CLICKABLE — clicking it opens that page\'s detail',
  'in the panel. So SearchResultRow.id MUST be the REAL Confluence page id — the "id" field',
  'returned by confluence_search_content for that hit (the value that opens that exact page).',
  'It is NOT a positional/sequential index: NEVER number the rows 1, 2, 3… A row given a',
  'fake/positional id opens the WRONG page or fails — always copy the real id from the search',
  'result. A row with no real id is rendered inert (not clickable).',
  '',
  'Use a Notice (noticeKind "error") when Confluence is not connected or a read fails,',
  'and (noticeKind "info") for "nothing found" / a page not found. Use Column/Row/Text',
  'only to group or label.',
  '',
  'Example (a search result list — values are ILLUSTRATIVE ONLY, never copy them; in real',
  'output the "id" is the page id from confluence_search_content, e.g. a value like below):',
  '{ "surfaceId": "confluence-search", "components": [',
  '  { "id": "root", "component": "SearchResultList", "results": [',
  '    { "id": "131073", "title": "Onboarding", "space": "ENG", "excerpt": "Welcome…" } ] } ] }',
  '',
  'Resolves once the surface is shown — it does not await a user action; the row click is',
  'handled by the panel itself (it opens the page detail), not returned to you.',
  '',
  '════ REFRESHABLE DATA — compose the layout, declare ONE BINDING per data container ════',
  'Whenever a container DISPLAYS live Confluence data you just fetched (a content feed, search',
  'results, page detail), COMPOSE the layout you want and pass the rows you fetched as ORDINARY',
  'LITERAL props (a "results" array on SearchResultList; the title/space/body on PageDetail) —',
  'those literals become the first-paint SEED and the surface shows them instantly. To make a',
  'container REFRESHABLE (the panel refresh control re-fetches + repaints it in place), declare',
  'ONE binding for it. You do NOT author any "{ path }" data binding yourself — cosmos rewrites',
  'each bound container\'s data prop to a refreshable path for you, whether you passed literal',
  'rows or a path.',
  '',
  'BINDINGS is the primary way: pass "bindings": one entry per data-bearing container —',
  '  { "componentId": "<the container\'s id>",',
  '    "descriptor": { "dataSource": "defaultFeed"|"searchContent"|"getPage", "query": { ... } } }.',
  'IMPORTANT: "dataSource" is the ADAPTER SOURCE id — EXACTLY "defaultFeed", "searchContent", or',
  '"getPage" — NOT the MCP read-tool name ("confluence_default_feed"/"confluence_search_content"/',
  '"confluence_get_page"). Using the tool name makes the surface non-refreshable.',
  'The descriptor is the SAME read you performed; query holds only NON-SECRET params (a "query"',
  'for searchContent, a "pageId" for getPage) — NEVER a token (cosmos attaches the token only in',
  'main at refresh). cosmos KEEPS your custom spec and refreshes it IN PLACE.',
  '',
  'SINGLE data container → ONE binding. PARTITIONED layout (side-by-side content feeds) → ONE',
  'binding PER container, each with its OWN narrowed query — so each refreshes independently and',
  'a container composed with an EMPTY rows array still re-fetches via its binding.',
  '',
  '"descriptor": { "dataSource": ..., "query": { ... } } is the DEGENERATE single-binding form —',
  'one surface-wide fetcher for a surface with a single data container. Use "descriptor" for one',
  'region, "bindings" for many — NEVER pass both; if both are present bindings wins.',
  `You MAY also bind the shared flags ("${AdapterFlagPath.loading}", "${AdapterFlagPath.hasMore}", "${AdapterFlagPath.error}"). Mint a UNIQUE`,
  'surfaceId per surface. Omit all bindings ONLY for a static surface with no live Confluence data.'
].join('\n')
