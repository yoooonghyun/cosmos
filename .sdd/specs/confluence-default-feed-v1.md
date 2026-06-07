# Spec: Confluence Default Base Feed — v1

**Status**: Draft
**Created**: 2026-06-07
**Supersedes**: —
**Related plan**: .sdd/plans/confluence-default-feed-v1.md (to follow)

---

## Overview

When the Confluence panel is connected and its native base sits in the idle search view with
no query entered, today it shows a static placeholder ("Search Confluence to find pages.").
This feature replaces that idle placeholder with a **default personal activity feed** — a
deterministic read of pages the user @mentions, watches, or has favorited (most-recently-
modified first) — rendered with the exact same list UI the text search already uses. It gives
the connected user something useful to see and click into before they type anything, while the
search box and text-search path stay unchanged.

---

## User Scenarios

> Each scenario is independently testable. Priorities: P1 (must), P2 (should), P3 (nice to have).

### See a personal feed of pages on the idle Confluence base · P1

**As a** cosmos user with a connected Confluence integration
**I want to** see the pages I should care about (my mentions, watches, favorites) the moment I
open the Confluence panel's native base — without typing a query
**So that** I have a useful Confluence starting point instead of an empty placeholder

**Acceptance criteria:**

- Given Confluence is connected and the native base is showing the search view with no query
  entered, when the base first shows (or re-enters that idle state), then the panel
  automatically fetches and renders the default feed using the same row layout as search.
- Given the default feed returns results, when it renders, then each row shows the same
  title / space chip / excerpt layout as a search result and clicking a row opens the existing
  page detail drill-in.
- Given the default feed is the most-recently-modified ordering, when it renders, then the rows
  are ordered most-recently-modified first.

### Switch to text search and back to the feed · P1

**As a** connected Confluence user
**I want to** type a query to search, then clear it and return to my default feed
**So that** search and the feed coexist without one replacing the other permanently

**Acceptance criteria:**

- Given the default feed is showing on the idle base, when I submit a non-empty query, then the
  panel switches to the existing text search (`text ~ "query" and type = page`), unchanged.
- Given a text search is showing, when I return the base to the idle (no-query) state, then the
  default feed is shown again.
- Given I am viewing the default feed, when I look at the panel, then the search input is present
  on top exactly as before.

### Page through the default feed · P2

**As a** connected Confluence user with many relevant pages
**I want to** load more pages from the default feed
**So that** I can browse beyond the first page of results

**Acceptance criteria:**

- Given the default feed has more results than the first page, when it renders, then a
  "Load more" control is shown.
- Given I click "Load more", when the next page loads, then its rows are appended below the
  existing rows using the same opaque-cursor pagination as search.

### Empty, error, and reconnect states on the feed · P2

**As a** connected Confluence user
**I want to** the feed to degrade gracefully when there is nothing to show or a read fails
**So that** the panel never hangs, blanks, or crashes

**Acceptance criteria:**

- Given the user has no mentions, watches, or favorites, when the default feed loads, then it
  shows a suitable empty line (not the old placeholder).
- Given the default feed read fails with a recoverable error, when it renders, then it shows the
  same recoverable error state with a retry affordance as search.
- Given the default feed read returns `reconnect_needed`, when it renders, then it shows the same
  Confluence reconnect prompt as search.
- Given the default feed read is in progress, when it renders, then it shows the same loading
  skeletons as search.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | When Confluence is `connected` AND the native base is in the search view AND no query has been entered, the panel MUST automatically fetch and render the default feed (on first show / when entering that idle state) in place of the old idle placeholder. |
| FR-002 | The default feed MUST render with the SAME existing `ContentList` UI as text search — same row layout (title / space chip / excerpt), same five states, same "Load more" pagination, and the same row-click behavior. |
| FR-003 | Clicking a default-feed row MUST open the existing page-detail drill-in (the same `view: { kind: 'page' }` flow as a search result), with no new detail surface. |
| FR-004 | The default feed MUST be fetched as a deterministic main-process read over `window.cosmos.confluence` IPC. It MUST NOT be an `AgentRunner` run, MUST NOT use a render MCP tool, and MUST NOT touch the generative tabs or the prompt composer. |
| FR-005 | The default-feed read MUST use the Confluence v1 CQL search endpoint (`GET /wiki/rest/api/search`), authorized by the existing `search:confluence` scope. No new OAuth scope MUST be requested or required. |
| FR-006 | The default-feed CQL MUST be exactly: `(mention = currentUser() or watcher = currentUser() or favourite = currentUser()) and type = page order by lastmodified desc`. The renderer MUST NOT compose or carry any raw CQL; the CQL string MUST live only in the main-process Confluence client. |
| FR-007 | The default feed MUST support the same opaque-cursor "Load more" pagination as text search (cursor derived from `_links.next` via `cursorFromNextLink`, mapped to `nextCursor`). |
| FR-008 | The search input MUST stay exactly as-is on top of the native base. Submitting a non-empty query MUST switch to the EXISTING text search path (`text ~ "query" and type = page`), unchanged. |
| FR-009 | Returning the native base to the idle (empty-query) state MUST show the default feed again. |
| FR-010 | The default feed MUST render the SAME five states the search list renders: loading (skeletons), empty, populated (rows + Load more), error (recoverable retry), and `reconnect_needed` (Confluence reconnect prompt). |
| FR-011 | The empty state for the default feed MUST be a suitable empty line for "no mentions / watches / favorites" (e.g. distinct copy from search's "No content matches this query."), NOT the removed "Search Confluence to find pages." placeholder. |
| FR-012 | Confluence MUST remain read-only. This feature MUST add only a read; it MUST NOT introduce any write, dispatcher, or mutation. |
| FR-013 | The default feed MUST be a native-panel concern only. It MUST NOT add or require a new MCP tool exposed to the agent. |
| FR-014 | The default-feed read MUST reuse `ConfluenceManager.run()` so it inherits the same proactive/reactive token refresh and `reconnect_needed` handling as the existing reads, and MUST return the same `ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>` shape as search. |
| FR-015 | The default feed MUST NOT run when Confluence is not connected; the not-connected base (Connect call-to-action) is unchanged and performs no reads. |
| FR-016 | The default-feed contract SHOULD be a NEW dedicated read operation distinct from `searchContent` (see Contract Decision), so the text-search path is untouched and the personal CQL stays server-side. The renderer MUST never carry a CQL or a search "mode" string to select the feed. |

### Contract Decision (resolves the open design question)

A **new dedicated read operation** is chosen over extending `searchContent` with a mode flag.

- **Decision:** add a parameter-free (cursor-only) read operation alongside the existing
  `searchContent` / `getPage`, threaded the same way every other Confluence native read is:
  - a new `window.cosmos.confluence` method (renderer-facing) that takes only an optional
    `cursor`,
  - a new IPC channel constant in `ConfluenceChannelName`,
  - a new `ConfluenceManager` method routing through `run()`,
  - a new `ConfluenceClient` method that builds the fixed personal-scope CQL and GETs
    `/wiki/rest/api/search` (reusing the existing `call`, hit-mapping, and `cursorFromNextLink`
    plumbing), returning the same `ConfluencePage<ConfluenceSearchResult>`.
- **Naming guidance (non-binding on the plan):** "default feed" semantics, e.g.
  `confluence.defaultFeed({ cursor? })` / `confluence:defaultFeed` / `ConfluenceManager.defaultFeed` /
  `ConfluenceClient.defaultFeed`. The plan chooses the exact identifiers.
- **Justification:**
  1. **Text search stays byte-for-byte untouched.** `searchContent`'s `query`-required params,
     validator (`validateConfluenceSearch`), CQL (`text ~ "…" and type = page`), and all
     callers are unmodified — no risk of regressing the shipped search path.
  2. **CQL stays server-side.** The personal-scope CQL lives only in the client; the renderer
     and IPC payload never carry a CQL string or a mode discriminator (FR-006), so the renderer
     cannot inject or vary CQL.
  3. **No misleading "empty query" overload.** The existing search validator rejects an empty
     `query`; bending `searchContent` to also mean "feed when query is empty" would weaken that
     validator and conflate two distinct reads.
  4. The default feed reuses the identical result DTO (`ConfluenceSearchResult`,
     `ConfluencePage`), so the renderer's `ContentList` can render either source unchanged — the
     only difference is which IPC method it calls.

---

## Edge Cases & Constraints

- **Why approximate the bell/inbox with CQL (on the record):** the default feed deliberately
  approximates Confluence's notification/bell inbox via the CQL
  `(mention = currentUser() or watcher = currentUser() or favourite = currentUser())`. This is a
  conscious approximation because **Confluence Cloud exposes no OAuth-3LO-accessible
  notifications/inbox API and no notification scope** (verified against Atlassian's scope docs).
  There is no way to read the literal bell feed within the granted scopes, so the personal-scope
  CQL over the already-authorized `search:confluence` endpoint is the closest available signal.
- **No new scope:** the feed reuses `search:confluence` and the same `/wiki/rest/api/search`
  endpoint as text search; nothing in the OAuth grant changes.
- **`currentUser()` resolution:** the CQL `currentUser()` function is resolved server-side by
  Confluence from the bearer token; cosmos does not need to resolve or pass an account id.
- **Empty feed is normal:** a user with no mentions/watches/favorites legitimately yields zero
  results; this is the empty state (FR-011), not an error.
- **Idle transitions:** the feed is shown whenever the native base is in the search view with no
  submitted query; it must (re)load when entering that state and must not fight the search path
  when a query is present.
- **Generative panel untouched:** the generative tabs, prompt composer, `target: 'confluence'`
  runs, and the Confluence MCP server (including the existing model-mediated `confluence_create_page`
  write tool) are all out of scope and unchanged.
- **Out of scope:** any new write; exposing the feed as an MCP/agent tool; making the feed
  generative; cross-product or unified search; customizing the CQL from the UI; surfacing the feed
  in a generative tab; multi-site selection; real-time updates; persisting feed state across
  restarts.

---

## Success Criteria

| ID     | Criterion                                                                                                                                                  |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | With Confluence connected and no query entered, the native base shows the default feed (rows or its empty/loading/error/reconnect state) — never the removed "Search Confluence to find pages." placeholder. |
| SC-002 | A default-feed row click opens the existing page detail; the row layout is visually identical to a search result row. |
| SC-003 | Submitting a non-empty query shows the unchanged text-search results; clearing back to idle shows the default feed again. |
| SC-004 | "Load more" appends a second page of feed results via the same cursor pagination as search. |
| SC-005 | The feed renders all five states (loading / empty / populated / error-with-retry / reconnect) identically to the search list. |
| SC-006 | No new OAuth scope is requested or required, and no new MCP tool is added; `git`-level diff to the OAuth scope list and the MCP tool/grant set is empty. |
| SC-007 | The text-search path (params, validator, CQL, callers) is unchanged — search behavior is byte-for-byte preserved. |
| SC-008 | The CQL string for the default feed exists only in the main-process Confluence client; no CQL or feed-mode string appears in any renderer file or IPC payload. |
| SC-009 | The default-feed read returns the same `ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>` shape and routes through `ConfluenceManager.run()` (transparent refresh + reconnect handling). |

---

## Open Questions

- None. The contract decision (a new dedicated `defaultFeed` read operation) is resolved above;
  the CQL string, scope reuse, and read-only constraint are fixed by the request. Exact
  identifier names and the empty-state copy are deferred to the implementation plan as
  non-behavioral choices.
