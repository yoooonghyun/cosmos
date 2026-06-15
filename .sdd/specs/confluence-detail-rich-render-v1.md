# Spec: Confluence Detail — Real-Id Open + Rich Render — v1

**Status**: Draft
**Created**: 2026-06-14
**Supersedes**: —
**Related plan**: .sdd/plans/confluence-detail-rich-render-v1.md (to be authored)

---

## Grounding

Direct investigation run for this spec (tools owned by architect):

- `memory_recall` "confluence detail page detail storage format render" — no stored results.
- `memory_smart_search` "confluence page detail rich render storage to plain text macros" — no stored results.
- `codegraph_explore` "CONFLUENCE_TOOL_DESCRIPTION confluenceRenderUiServer SearchResultRow confluenceNav openDetail" — confirmed catalog rows are now clickable: `SearchResultList` (src/renderer/confluenceCatalog/components.tsx:137) wraps any row with a non-empty `id` in a `<button>` that dispatches `CONFLUENCE_OPEN_DETAIL_ACTION` with `context.pageId = result.id`. So the row `id` IS the pageId fed to `getPage`.
- `codegraph_explore` "confluenceClient getPage storageToPlainText ConfluencePageDetail body-format storage" — confirmed `getPage` (src/main/integrations/confluenceClient.ts:254) requests `?body-format=storage` then flattens via `storageToPlainText(storage.value)` (line 280); `ConfluencePageDetail.body` (src/shared/confluence.ts:81) is documented "flattened, plain readable text … no macro rendering — design Q2".
- Read src/mcp/confluenceRenderUiServer.ts:156-222 — `CONFLUENCE_TOOL_DESCRIPTION` still says "DISPLAY-ONLY: there are NO input controls and NO actions" (line 161) and the example seeds `"id": "1"` (line 189) labelled "values are ILLUSTRATIVE ONLY". No instruction that `SearchResultRow.id` must be the real page id.
- Read src/renderer/confluenceCatalog/components.tsx:235-272 + src/renderer/ConfluencePanel.tsx (PageDetail at :253) — BOTH the gen-UI catalog `PageDetail` and the native `PageDetail` render `body` as plain `whitespace-pre-wrap` text. The gen-UI overlay reuses the native `PageDetail` (native-reuse), which reads via `window.cosmos.confluence.getPage`. Improving the body contract + render fixes both surfaces.
- Read src/shared/validate.ts — confluence create body is validated at the main boundary; no validator yet for a page-detail HTML field (none exists today).

---

## Overview

Fix two defects in the Confluence panel's page-detail flow. (1) Clicking a generative-UI
search-result row throws "Confluence request failed (HTTP 500)" because the agent composes
rows with positional ids ("1", "2") instead of the real Confluence page id, and that id is
sent straight to `getPage`. (2) Page-detail readability is poor — only flattened plain text
renders, with no headings, lists, tables, links, or code blocks. Both are fixed together:
the catalog instruction is corrected to require real page ids, and the page body is carried
and rendered as sanitized rich content shared by the native panel and the gen-UI overlay.

## User Scenarios

### Open a generative-UI search result without an error · P1

**As a** cosmos user browsing an agent-composed Confluence search surface
**I want to** click a result row and see that exact page open
**So that** I can read the page instead of hitting "HTTP 500"

**Acceptance criteria:**

- Given an agent rendered a `SearchResultList` from `confluence_search_content` output, when I click a row, then the page detail for THAT page opens (the page whose real Confluence id backs the row).
- Given the same surface, when I click any row, then no "Confluence request failed (HTTP 500)" error occurs from a positional/illustrative id.
- Given the agent omits or fabricates a row id, when the surface renders, then that row is inert (not clickable) and never issues a `getPage` with a non-page-id value.

### Read a richly formatted Confluence page · P1

**As a** cosmos user opening a Confluence page detail (native panel OR gen-UI overlay)
**I want to** see the page's real formatting — headings, lists, tables, links, code, emphasis
**So that** the page is readable as authored, not collapsed into a wall of plain text

**Acceptance criteria:**

- Given a page with headings, lists, a table, links, and a code block, when I open its detail, then those structures render with appropriate typographic styling (not flattened to one paragraph).
- Given the same page opened from the native panel and from the gen-UI overlay, when both render, then they show the SAME rich content (one shared detail surface).
- Given any page, when its body renders, then the rendered HTML is sanitized before display (no script/iframe/event-handler/`javascript:` execution).

### Degrade safely on bad or empty content · P1

**As a** cosmos user
**I want to** never see a crash or a blank broken panel when a page is empty, malformed, or fails to load
**So that** the panel stays usable

**Acceptance criteria:**

- Given a page with an empty body, when I open it, then a safe "no readable body" state shows (no crash).
- Given `getPage` returns 500 or 404, when I open the row, then a safe error/notice state shows and the row interaction does not crash the panel.
- Given a page whose body contains unsupported macros or hostile markup, when it renders, then the unsupported parts degrade to a safe placeholder/inert text and any hostile markup is stripped.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The `render_confluence_ui` catalog description MUST instruct the model that `SearchResultRow.id` is the REAL Confluence page id returned by `confluence_search_content` (the value that opens that page on click), NOT a positional/sequential index. |
| FR-002 | The catalog description MUST correct the stale "DISPLAY-ONLY: there are NO input controls and NO actions" wording to reflect that a search-result row is now actionable (clicking opens that page's detail). |
| FR-003 | The catalog example MUST seed `SearchResultRow.id` with a realistic page-id-shaped value (a numeric string) and MUST NOT model a positional id ("1"); it MUST keep the "illustrative only, never copy" caveat. |
| FR-004 | The renderer MUST treat a `SearchResultRow` whose `id` is not a valid page id (empty, or not a numeric string) as INERT — it MUST NOT issue an open-detail / `getPage` for such a row (defensive guard complementing the catalog fix). |
| FR-005 | `getPage` MUST request a renderable body suitable for rich rendering (a server-rendered HTML view body and/or the storage body — exact `body-format` chosen at plan/design time) instead of relying solely on plain-text flattening. |
| FR-006 | The `ConfluencePageDetail` contract (`src/shared/confluence.ts`) MUST carry the page body as rich/renderable content (HTML or an equivalently structured field) through IPC, replacing/augmenting the plain-text-only `body`. |
| FR-007 | The shared `PageDetail` render surface (native panel + gen-UI overlay) MUST render the rich body with structural/typographic styling (headings, lists, tables, links, inline emphasis, code blocks). |
| FR-008 | Any Confluence-originated HTML MUST be sanitized in the renderer before injection; the system MUST NOT inject raw untrusted HTML via `dangerouslySetInnerHTML` without prior sanitization. |
| FR-009 | The cross-process page-detail payload MUST be validated at the main-process boundary; an invalid payload MUST be warned-and-ignored, never crash. |
| FR-010 | No new OAuth scopes MAY be introduced; the flow remains read-only (no `write:confluence-content` requirement). |
| FR-011 | Secrets/tokens MUST NOT appear in the page-detail IPC payload, bridge frame, MCP result, or A2UI surface, and MUST NOT be logged; the token stays in main. |
| FR-012 | The page detail MUST degrade gracefully for: empty body, unsupported/unknown macros, malformed HTML, and `getPage` errors (incl. 500/404) — each showing a safe state, never crashing. |
| FR-013 | The rich-render change MUST NOT regress the existing refreshable-binding behavior (the bound `getPage` descriptor that repaints the detail in place must continue to work with the new body field). |

## Edge Cases & Constraints

- **Empty body** — page has no content: show the existing "This page has no readable body." safe state; do not render an empty/broken HTML container.
- **Malicious HTML** — `<script>`, `<iframe>`, inline `on*=` handlers, `javascript:` URLs in the body: stripped by sanitization; nothing executes (XSS-blocked).
- **getPage 500** — the Problem-1 symptom (positional id) is eliminated by FR-001/FR-004; a genuine upstream 500 still resolves to a safe error/notice state, not a crash.
- **getPage 404 / page not found** — show a safe "not found" notice; do not throw.
- **Unsupported macros** — Confluence macros that don't survive the chosen body format (or that sanitization drops) degrade to a safe placeholder or inert text; the rest of the page still renders.
- **Very large pages** — a large body must render without crashing; truncation/scroll/perf strategy is decided at plan/design time, but the surface MUST remain responsive and MUST NOT crash.
- **Numeric id assumption** — Confluence page ids are numeric strings; the FR-004 guard keys on that shape. (If the agent ever supplies a non-numeric real id, the guard must not silently block a legitimately resolvable page — see Open Questions.)
- **Out of scope:** authoring/editing pages, new write scopes, rendering live/interactive macros (dynamic-content macros), embedding remote Confluence assets that would require additional fetches or token use.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking any row in an agent-composed Confluence search surface opens the correct page with zero "HTTP 500 from a positional id" failures. |
| SC-002 | A page with headings, lists, a table, links, and a code block renders those structures with typographic styling in BOTH the native panel and the gen-UI overlay (identical output). |
| SC-003 | Injected hostile markup (script/iframe/`on*`/`javascript:`) never executes; sanitization is verifiable in a test. |
| SC-004 | Empty body, getPage 500, getPage 404, and unsupported-macro pages each render a safe state with no crash. |
| SC-005 | No token/secret appears in any page-detail IPC payload, bridge frame, MCP result, A2UI surface, or log line. |
| SC-006 | No new OAuth scope is requested; the flow stays read-only. |
| SC-007 | The page-detail IPC payload is validated at the main boundary; an invalid payload is warned-and-ignored without crashing. |

---

## Open Questions

- [ ] [NEEDS CLARIFICATION] If Confluence ever returns a non-numeric real page id, the FR-004 "numeric string" guard would wrongly mark a legitimate row inert. Confirm at plan/design time whether to relax the guard to "non-empty id" (relying on the catalog instruction + a graceful getPage-error path) instead of a strict numeric check.
- [ ] [NEEDS CLARIFICATION] Body-format choice (`view` server-rendered HTML vs `storage` XHTML) and the sanitize/typography packages (e.g. DOMPurify + @tailwindcss/typography `prose`) are technical decisions deferred to the plan/design step; the developer/designer will confirm exact packages via context7. The spec only requires "sanitized rich render."
