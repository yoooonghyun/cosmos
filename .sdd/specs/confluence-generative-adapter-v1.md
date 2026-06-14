# Spec: Confluence Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Supersedes**: —
**Related plan**: .sdd/plans/confluence-generative-adapter-v1.md

---

## Overview

Confluence's composed generative-UI surfaces (default activity feed, CQL/text search results,
page detail) today bake **literal** Confluence data into A2UI props at compose time, so a
restored/reactivated surface is frozen against the wiki as it was when first composed. This
feature wires Confluence onto the **already-shipped API→UI generative adapter** (built by
`jira-generative-adapter-v1`, reused unchanged by `slack-generative-adapter-v1`): Confluence
surfaces become `{path}`-bound, a secret-free **adapter descriptor** captures how to refetch, and
the shared main-side `AdapterDispatcher` re-runs it on refresh triggers and pagination, pushing a
fresh `updateDataModel` (not a surface re-push). This is the **third and final sibling cycle**
(Jira → Slack → Confluence); it reuses the shared infrastructure verbatim and adds only
Confluence-specific wiring. Confluence generative-UI is **read-only**, so — like Slack — it reuses
only the refresh + pagination portions of the shared dispatcher, never the Jira
write-reconciliation path.

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Live Confluence data on a restored surface · P1

**As a** cosmos user who composed a Confluence surface and relaunched/reactivated the panel
**I want to** see current Confluence data rather than the values frozen at compose time
**So that** the surface reflects the wiki without me re-asking the agent.

**Acceptance criteria:**

- Given a bound Confluence surface persisted in the session, when the tab is restored on relaunch,
  then main re-registers the surface from its persisted descriptor, re-executes it, and replaces the
  data via a fresh `updateDataModel` (the view is NOT re-composed, the agent is NOT re-invoked).
- Given a restored bound Confluence surface, when the panel is re-activated as the rail surface,
  then the adapter re-runs and refreshes the data model. This matches the existing Confluence
  default-feed expectation that the feed reflects most-recently-modified-first activity each time
  the idle base is shown, now achieved by an adapter refresh rather than a re-compose.
- Given a bound Confluence surface visible in the active tab, when the user activates the explicit
  refresh affordance, then the adapter re-runs from the descriptor's base cursor and the data model
  is replaced with fresh values.

### Load more on a bound Confluence list · P1

**As a** user viewing a bound Confluence default feed or search-results list
**I want to** load more results
**So that** I can browse beyond the first page against live data.

**Acceptance criteria:**

- Given a bound Confluence list with a `nextCursor`, when the user triggers the reserved append
  ("load more") action, then main fetches the next page with the descriptor's opaque
  `_links.next`-derived cursor and pushes an `updateDataModel` that writes the **full accumulated
  list** at the bound list path, growing the rendered list.
- Given a bound Confluence list whose last page returned no `nextCursor` (no `_links.next`), then the
  load-more control is disabled, driven by a bound boolean over `hasMore`.
- Given a load-more or refresh dispatch is in flight, when it has not yet landed, then a bound
  `loading` flag is true (driving the control spinner) and clears to false once data lands.
- Given any bound Confluence surface, then NO backward (prev) control is rendered: Confluence's
  cursor is the opaque, forward-only `_links.next` value, so a previous page cannot be fetched.

### Secrets never leave main · P1

**As a** security-conscious operator
**I want to** know the descriptor, data model, and every payload carry no Confluence token,
refresh token, cloudId-bearing secret, or Atlassian `client_secret`
**So that** credentials can never leak through a snapshot, IPC frame, bridge frame, MCP result, or
surface.

**Acceptance criteria:**

- Given any Confluence adapter refresh/pagination, when main fetches, then the access/refresh token
  is attached only inside `ConfluenceManager`/`ConfluenceClient` and never appears in the descriptor,
  the `updateDataModel` payload, the session snapshot, a bridge frame, an MCP result, or the rendered
  surface.
- Given the persisted Confluence descriptor, when inspected, then it contains only non-secret
  `{ dataSource, query }` values (manager call id + non-secret query/cursor). The personal-feed CQL
  string MUST NOT appear in the descriptor — only the cursor — preserving the
  `confluence-default-feed-v1` invariant that the fixed CQL lives only in the main-process client.

### Confluence surfaces are bound, not literal · P1

**As a** user composing or opening Confluence default-feed, search-results, or page-detail surfaces
**I want to** those surfaces to be data-bound
**So that** they participate in refresh and pagination uniformly.

**Acceptance criteria:**

- Given a bound Confluence list surface (default feed or search results) is produced, when it
  renders, then its rows bind to a data path via `TemplateBinding` and main seeds the data with an
  initial `updateDataModel`, rather than baking literal row props.
- Given a bound Confluence page-detail surface is produced, when it renders, then its display props
  bind to the data model via `{path}` and main seeds the detail with an initial `updateDataModel`.
- Given any bound Confluence surface, when it first paints, then it is populated by the initial
  `updateDataModel` seed (first page/value + `loading=false` + `hasMore`), not by static props.

### Safe fallback on Confluence adapter failure · P1

**As a** user whose Confluence refetch fails or points at gone/forbidden data
**I want to** a calm, recoverable state instead of a crash, hang, or stale silent surface
**So that** the panel stays usable.

**Acceptance criteria:**

- Given a refresh/load-more fetch fails (`network`/`rate_limited`), when it returns, then the surface
  shows a calm recoverable notice and `loading` clears; the prior data is not corrupted.
- Given a Confluence list's forward cursor is exhausted (no `_links.next`), when load-more would fire,
  then the control is disabled and the list is left unchanged.
- Given a fetch returns an empty page, when applied, then the bound list shows its empty state and
  `hasMore` reflects "no more" correctly.
- Given a `reconnect_needed`/`not_connected` result, when it returns, then the panel routes to the
  native Connect/Reconnect affordance (existing Confluence behavior) rather than pushing a broken
  surface.
- Given a page-detail descriptor refers to a now-gone page (the read fails), when re-executed, then
  the surface degrades to a recoverable notice rather than crashing.

---

## Functional Requirements

> Each FR is marked **[reuses shared]** (the `jira-generative-adapter-v1` infrastructure Confluence
> consumes unchanged, already proven by the Slack cycle) or **[Confluence-specific]** (this cycle's
> concrete wiring).

### Bound Confluence surfaces — view/data split

| ID     | Requirement |
|--------|-------------|
| FR-001 | Bound Confluence list + detail surfaces MUST be rendered using A2UI 0.9 `{path}` bindings + `TemplateBinding` list children instead of literal props. [reuses shared] |
| FR-002 | The Confluence surface builder MUST re-express the default-feed list and the search-results list as **bound** variants whose rows read the bound list path and whose `loading`/`hasMore` read the reserved flag paths; the page-detail surface MUST bind its `title`/`space`/`body` props to the data model; SearchResultRow/PageDetail/Notice/Text row shapes are unchanged. [Confluence-specific] |
| FR-003 | Each bound Confluence surface MUST be accompanied by an **initial `updateDataModel`** seeding the data model (first page items + `loading=false` + `hasMore` for lists; the detail value for page detail) so it renders populated on first paint. [reuses shared convention] |
| FR-004 | The Confluence catalog components for the bound lists (`SearchResultList`, and the bound default-feed list it backs) MUST read their items via the data binding and render the load-more control + spinner bound to `hasMore`/`loading`; the bound `PageDetail` MUST read its bound value; `SearchResultRow`/`Notice`/`Text` are unchanged. [Confluence-specific] |

### Confluence adapter descriptors + resolver

| ID     | Requirement |
|--------|-------------|
| FR-005 | The system MUST define secret-free Confluence adapter descriptors `{ dataSource, query }` whose `dataSource` maps to a `ConfluenceManager` **read** and whose `query` carries only non-secret params + opaque cursor. [Confluence-specific] |
| FR-006 | The Confluence `dataSource` values MUST map: default feed → `defaultFeed` (`query: { cursor? }`); content/CQL search → `searchContent` (`query: { query, cursor? }`); page detail → `getPage` (`query: { pageId }`). [Confluence-specific] |
| FR-007 | The default-feed descriptor MUST carry only an optional `cursor` and MUST NOT carry the personal-scope CQL or any feed-mode discriminator — the fixed CQL stays only in `ConfluenceClient.defaultFeed` (preserves `confluence-default-feed-v1` FR-006/SC-008). [Confluence-specific] |
| FR-008 | A Confluence `AdapterResolver` MUST map a Confluence descriptor's `dataSource`/`query` to the corresponding `ConfluenceManager` read (token + cloudId attached inside main), and normalize the `ConfluenceResult<ConfluencePage<…>>`/`ConfluenceResult<ConfluencePageDetail>` into the shared `AdapterFetchResult` (`items` + `nextCursor` for lists; `value` for page detail; or an `ok:false` recoverable notice carrying `kind`/`message`); it MUST NOT throw and MUST NOT leak a secret. [Confluence-specific] |
| FR-009 | The Confluence descriptor MUST be persisted in the session snapshot beside the composed view spec and MUST carry no token/refresh token/cloudId-derived secret/`client_secret`. [reuses shared] |

### Pagination shape — append only (cursor model)

| ID     | Requirement |
|--------|-------------|
| FR-010 | The bound Confluence lists (default feed, search results) MUST use **append ("load more")** pagination registered with the shared dispatcher's `pagination: 'append'` mode; main holds the accumulated list and pushes the **full accumulated list** at the bound path. The page-detail surface uses `pagination: 'none'` (no list, refresh-only). [reuses shared + Confluence-specific bind options] |
| FR-011 | Confluence lists MUST NOT use page-replace (prev/next) pagination: Confluence's only paging cursor is the opaque `_links.next` value (extracted by `cursorFromNextLink`, mapped to `nextCursor`) — it is **forward-only**, with no backward cursor and no offset (`start`) cursor exposed by the client. A prev page therefore cannot be fetched, so `hasPrev` MUST remain false/unused for Confluence surfaces and no `PaginationBar` is rendered. [Confluence-specific decision] |
| FR-012 | `hasMore` MUST be bound to the presence of the page's `nextCursor` (i.e. `_links.next` present); when a page returns no `nextCursor`, `hasMore` MUST be false and the load-more control disabled. [reuses shared convention] |
| FR-013 | The reserved `adapter.loadMore` and `adapter.refresh` actions MUST be used for Confluence pagination/refresh; the `adapter.page` (prev/next) action MUST NOT be emitted by any Confluence surface. [reuses shared] |

### Refresh triggers

| ID     | Requirement |
|--------|-------------|
| FR-014 | A bound Confluence surface's adapter MUST re-run on **tab restore**, **panel re-activation**, and an **explicit refresh affordance**, each producing a fresh `updateDataModel`; a refresh re-executes from the descriptor's base cursor. [reuses shared] |
| FR-015 | On restore/re-activation, the Confluence surface MUST be lazily (re-)registered from its persisted descriptor (via the `adapter.refresh` variant carrying the secret-free descriptor) before refreshing, since main has no live registration for a surface it never freshly composed. [reuses shared] |
| FR-016 | A refresh MUST replace the data model without re-composing the view or re-invoking the agent; a freshly composed surface seeds its own data model and MUST NOT immediately re-fetch. The default-feed re-activation refresh MUST reuse `ConfluenceManager.run()` (transparent refresh + `reconnect_needed` handling) via the resolver, inheriting the existing read discipline. [reuses shared] |

### Read-only scope (no writes)

| ID     | Requirement |
|--------|-------------|
| FR-017 | Confluence generative-UI MUST remain **display-only**: it reuses ONLY the refresh + pagination portions of the shared dispatcher and MUST NOT register any write action, MUST NOT use the Jira write-reconciliation path, and MUST NOT introduce any `adapter.*` mutation. The existing `confluence_create_page` MCP write is a SEPARATE feature (`confluence-create-page-v1`) and MUST NOT be folded into this cycle. [Confluence-specific scope] |

### Security & validation (hard constraints — shared)

| ID     | Requirement |
|--------|-------------|
| FR-018 | All Confluence fetching and the access/refresh token + cloudId MUST stay in **main**; nothing secret may enter an IPC payload, session snapshot, bridge frame, MCP result, or A2UI surface. [reuses shared] |
| FR-019 | All Confluence adapter payloads (descriptor, reserved actions, `updateDataModel`) MUST reuse the existing typed contract in `src/shared/ipc.ts` / `src/shared/adapter.ts` and the existing boundary validators (`validateAdapterDescriptor`, `validateAdapterAction`); Confluence MUST NOT add ad-hoc channel strings. A malformed payload MUST be **warned + ignored, never crash**. [reuses shared] |
| FR-020 | A malformed `updateDataModel` for a Confluence surface MUST be ignored safely by `ActiveTabSurface` (degrade to the tab's error boundary at worst), never white-screening the panel or affecting sibling tabs. [reuses shared] |

## Edge Cases & Constraints

- **Forward-only cursor exhausted.** A Confluence list whose last page returned no `_links.next`
  (`nextCursor` absent) MUST disable load-more (`hasMore=false`); a load-more that somehow fires MUST
  be a safe no-op leaving the list unchanged.
- **Empty / last page.** An append returning zero new items MUST leave the accumulated list unchanged
  and set `hasMore=false`; an empty first page (e.g. a personal feed with no mentions/watches/
  favorites) MUST show the bound "No content matches." empty state.
- **Stale/opaque cursor rejected.** A `_links.next` cursor the source no longer accepts MUST surface
  a calm recoverable notice and clear `loading`; the existing list is not corrupted.
- **Fetch error → safe fallback keeping prior data.** `network`/`rate_limited` failures MUST render a
  calm recoverable notice and clear `loading`, leaving prior data intact.
- **Gone page (detail).** A page-detail refresh whose descriptor points at a deleted/forbidden page
  MUST degrade to a recoverable notice, not a crash.
- **`reconnect_needed`/`not_connected` routing.** These MUST route to the native Confluence
  Connect/Reconnect affordance (existing behavior), not a broken surface. `write_not_authorized` is
  irrelevant here (no writes) and MUST NOT be produced by any adapter read path.
- **Secret-free invariant.** No Confluence token, refresh token, cloudId-derived secret, Atlassian
  `client_secret`, or personal-feed CQL string may appear in the descriptor, data model,
  `updateDataModel` payload, snapshot, bridge frame, MCP result, or surface (FR-007/FR-009/FR-018).
- **Malformed payload.** Warned + ignored at the main boundary / safely ignored at the renderer —
  never a crash (FR-019/FR-020).
- **Relationship to `confluence-create-page-v1`.** Page creation is a separate, existing
  model-mediated MCP write. This cycle adds NO write and MUST NOT touch that feature's scope/dispatch.
- **Out of scope (deliberately left to later / unchanged):** any write-bearing Confluence action
  (page create stays in its own feature); offset/`start`-based or page-numbered pagination (the
  client exposes only the opaque forward cursor); real-time/push refresh (refresh is trigger-driven
  only); any change to the shared infra contract; space-key/scoped-CQL surfaces beyond the existing
  text-search and personal-feed sources.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A bound Confluence surface restored on relaunch shows data fetched fresh at restore time, not values frozen at compose time, with no view re-compose and no agent invocation. |
| SC-002 | Panel re-activation and the explicit refresh affordance each produce a fresh `updateDataModel`; the default-feed re-activation refresh reflects current most-recently-modified-first activity. |
| SC-003 | Load-more grows each bound Confluence list (full accumulated list written at the path); `hasMore` disables load-more when the forward cursor is exhausted; no Confluence surface renders a prev/next control. |
| SC-004 | The `loading` flag toggles the control spinner: true on dispatch, false on land. |
| SC-005 | No Confluence token, refresh token, cloudId-derived secret, `client_secret`, or personal-feed CQL appears in any descriptor, data model, `updateDataModel` payload, session snapshot, bridge frame, MCP result, or surface (verified by inspection + tests). |
| SC-006 | A malformed Confluence `updateDataModel` / action payload is warned + ignored at the main boundary and safely ignored at the renderer — process never crashes, sibling tabs unaffected. |
| SC-007 | Fetch errors, exhausted cursors, empty/last pages, gone pages, and `reconnect_needed`/`not_connected` each degrade to a calm recoverable state with `loading` cleared. |
| SC-008 | Confluence registers NO write action and uses NONE of the Jira write-reconciliation path (display-only); `confluence-create-page-v1` is untouched. |
| SC-009 | Confluence reuses the shared dispatcher / `updateDataModel` channel / descriptor schema / bound-surface convention / append pagination verbatim — no shared-infra contract is redefined or expanded by this cycle. |

---

## Open Questions

- [ ] None blocking. One non-blocking note for the plan: whether a bound page-detail surface
  registers with `pagination: 'none'` for refresh-only (no list) is a wiring detail captured in the
  plan, consistent with the shared `AdapterRegisterOptions` shape.
