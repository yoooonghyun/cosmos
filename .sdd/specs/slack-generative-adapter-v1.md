# Spec: Slack Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Supersedes**: —
**Related plan**: .sdd/plans/slack-generative-adapter-v1.md

---

## Overview

Slack's composed generative-UI surfaces (channel list, message history, search results)
today bake **literal** Slack data into A2UI props at compose time, so a restored/reactivated
surface is frozen against the workspace as it was when first composed. This feature wires
Slack onto the **already-shipped API→UI generative adapter** (built by
`jira-generative-adapter-v1`): Slack surfaces become `{path}`-bound, a secret-free **adapter
descriptor** captures how to refetch, and the shared main-side `AdapterDispatcher` re-runs it
on refresh triggers and pagination, pushing a fresh `updateDataModel` (not a surface re-push).
This is the **second of three sibling cycles** (Jira → Slack → Confluence); it reuses the
shared infrastructure verbatim and adds only Slack-specific wiring. Slack generative-UI is
**read-only**, so it reuses only the refresh + pagination portions of the shared dispatcher,
never the Jira write-reconciliation path.

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Live Slack data on a restored surface · P1

**As a** cosmos user who composed a Slack surface and relaunched/reactivated the panel
**I want to** see current Slack data rather than the values frozen at compose time
**So that** the surface reflects the workspace without me re-asking the agent.

**Acceptance criteria:**

- Given a bound Slack surface persisted in the session, when the tab is restored on relaunch,
  then main re-registers the surface from its persisted descriptor, re-executes it, and replaces
  the data via a fresh `updateDataModel` (the view is NOT re-composed, the agent is NOT re-invoked).
- Given a restored bound Slack surface, when the panel is re-activated as the rail surface, then
  the adapter re-runs and refreshes the data model.
- Given a bound Slack surface visible in the active tab, when the user activates the explicit
  refresh affordance, then the adapter re-runs from the descriptor's base cursor and the data
  model is replaced with fresh values.

### Load more on a bound Slack list · P1

**As a** user viewing a bound Slack channel list, message history, or search results
**I want to** load more results
**So that** I can browse beyond the first page against live data.

**Acceptance criteria:**

- Given a bound Slack list with a `nextCursor`, when the user triggers the reserved append
  ("load more") action, then main fetches the next page with the descriptor's opaque cursor and
  pushes an `updateDataModel` that writes the **full accumulated list** at the bound list path,
  growing the rendered list.
- Given a bound Slack list whose last page returned no `nextCursor`, then the load-more control is
  disabled, driven by a bound boolean over `hasMore`.
- Given a load-more or refresh dispatch is in flight, when it has not yet landed, then a bound
  `loading` flag is true (driving the control spinner) and clears to false once data lands.
- Given a Slack search-results surface (page-numbered source), when the user loads more, then the
  next page is fetched via the synthetic forward page cursor and **appended**; there is no
  backward (prev) control because Slack search exposes only a forward page cursor.

### Secrets never leave main · P1

**As a** security-conscious operator
**I want to** know the descriptor, data model, and every payload carry no Slack token
**So that** the bot/user token can never leak through a snapshot, IPC frame, bridge frame,
MCP result, or surface.

**Acceptance criteria:**

- Given any Slack adapter refresh/pagination, when main fetches, then the Slack token is attached
  only in `SlackManager`/`SlackClient` and never appears in the descriptor, the `updateDataModel`
  payload, the session snapshot, a bridge frame, an MCP result, or the rendered surface.
- Given the persisted Slack descriptor, when inspected, then it contains only non-secret
  `{ dataSource, query }` values (manager call id + non-secret channelId/query/cursor).

### Slack surfaces are bound, not literal · P1

**As a** user composing or opening Slack channel-list, message-history, or search surfaces
**I want to** those surfaces to be data-bound
**So that** they participate in refresh and pagination uniformly.

**Acceptance criteria:**

- Given a bound Slack list surface (channel list, message history, or search results) is produced,
  when it renders, then its rows bind to a data path via `TemplateBinding` and main seeds the data
  with an initial `updateDataModel`, rather than baking literal row props.
- Given any bound Slack surface, when it first paints, then it is populated by the initial
  `updateDataModel` seed (first page + `loading=false` + `hasMore`), not by static props.

### Safe fallback on Slack adapter failure · P1

**As a** user whose Slack refetch fails or points at gone/forbidden data
**I want to** a calm, recoverable state instead of a crash, hang, or stale silent surface
**So that** the panel stays usable.

**Acceptance criteria:**

- Given a refresh/load-more fetch fails (network/rate-limited/forbidden), when it returns, then the
  surface shows a calm recoverable notice and `loading` clears; the prior data is not corrupted.
- Given a Slack list's forward cursor is exhausted (no `nextCursor`), when load-more would fire,
  then the control is disabled and the list is left unchanged.
- Given a fetch returns an empty page, when applied, then the bound list shows its empty state and
  `hasMore` reflects "no more" correctly.
- Given a `reconnect_needed`/`not_connected` result, when it returns, then the panel routes to the
  native Connect/Reconnect affordance (existing Slack behavior) rather than pushing a broken
  surface.
- Given a `search_unavailable` result (no `search:read` scope), when a search surface refreshes,
  then it degrades to a calm recoverable notice, not a crash.

---

## Functional Requirements

> Each FR is marked **[reuses shared]** (the `jira-generative-adapter-v1` infrastructure Slack
> consumes unchanged) or **[Slack-specific]** (this cycle's concrete wiring). Brief points
> referenced as (P1)–(P6).

### Bound Slack surfaces — view/data split

| ID     | Requirement |
|--------|-------------|
| FR-001 | Bound Slack list surfaces MUST be rendered using A2UI 0.9 `{path}` bindings + `TemplateBinding` list children instead of literal row props (P2). [reuses shared] |
| FR-002 | The Slack surface builder MUST re-express ChannelList, MessageList, and SearchResultList as **bound** variants whose rows read the bound list path and whose `loading`/`hasMore` read the reserved flag paths; ChannelRow/MessageRow/SearchResultRow row shapes are unchanged (P2). [Slack-specific] |
| FR-003 | Each bound Slack surface MUST be accompanied by an **initial `updateDataModel`** seeding the data model (first page items + `loading=false` + `hasMore`) so it renders populated on first paint (P2). [reuses shared convention] |
| FR-004 | The Slack catalog components for the bound lists (ChannelList, MessageList, SearchResultList) MUST read their items via the data binding and render the load-more control + spinner bound to `hasMore`/`loading`; the row components and UserChip/Notice/Text are unchanged (P2). [Slack-specific] |

### Slack adapter descriptors + resolver

| ID     | Requirement |
|--------|-------------|
| FR-005 | The system MUST define secret-free Slack adapter descriptors `{ dataSource, query }` whose `dataSource` maps to a `SlackManager` **read** and whose `query` carries only non-secret params + opaque cursor (P1). [Slack-specific] |
| FR-006 | The Slack `dataSource` values MUST map: channel list → `listChannels` (`query: { cursor? }`); message history → `getHistory` (`query: { channelId, cursor? }`); search results → `search` (`query: { query, cursor? }`) (P1). [Slack-specific] |
| FR-007 | A Slack `AdapterResolver` MUST map a Slack descriptor's `dataSource`/`query` to the corresponding `SlackManager` read (token attached inside main), and normalize the `SlackResult<SlackPage<…>>` into the shared `AdapterFetchResult` (`items` + `nextCursor`, or an `ok:false` recoverable notice carrying `kind`/`message`); it MUST NOT throw and MUST NOT leak a secret (P1). [Slack-specific] |
| FR-008 | The resolver MUST resolve author display names (via `getUser`, mirroring the native panel's `resolveNames`) where the native surface does, so refreshed/appended message rows carry the same `userName` the composed surface had — name resolution stays in main, never altering the non-secret row shape (P1). [Slack-specific] |
| FR-009 | The Slack descriptor MUST be persisted in the session snapshot beside the composed view spec and MUST carry no token/secret (P1, hard constraint). [reuses shared] |

### Pagination shape — append only (cursor model)

| ID     | Requirement |
|--------|-------------|
| FR-010 | All bound Slack lists (channel list, message history, search results) MUST use **append ("load more")** pagination registered with the shared dispatcher's `pagination: 'append'` mode; main holds the accumulated list and pushes the **full accumulated list** at the bound path (P3). [reuses shared + Slack-specific bind options] |
| FR-011 | Slack lists MUST NOT use page-replace (prev/next) pagination: Slack's `next_cursor` (conversations.*) and synthetic `page+1` (search.messages) cursors are **forward-only and opaque** — no backward cursor exists, so a prev page cannot be fetched. `hasPrev` MUST therefore remain false/unused for Slack surfaces (P3). [Slack-specific decision] |
| FR-012 | `hasMore` MUST be bound to the presence of the page's `nextCursor`; when a page returns no `nextCursor`, `hasMore` MUST be false and the load-more control disabled (P3). [reuses shared convention] |
| FR-013 | The reserved `adapter.loadMore` and `adapter.refresh` actions MUST be used for Slack pagination/refresh; the `adapter.page` (prev/next) action MUST NOT be emitted by any Slack surface (P3). [reuses shared] |

### Refresh triggers

| ID     | Requirement |
|--------|-------------|
| FR-014 | A bound Slack surface's adapter MUST re-run on **tab restore**, **panel re-activation**, and an **explicit refresh affordance**, each producing a fresh `updateDataModel`; a refresh re-executes from the descriptor's base cursor (P4). [reuses shared] |
| FR-015 | On restore/re-activation, the Slack surface MUST be lazily (re-)registered from its persisted descriptor (via the `adapter.refresh` variant carrying the secret-free descriptor) before refreshing, since main has no live registration for a surface it never freshly composed (P4). [reuses shared] |
| FR-016 | A refresh MUST replace the data model without re-composing the view or re-invoking the agent; a freshly composed surface seeds its own data model and MUST NOT immediately re-fetch (P4). [reuses shared] |

### Read-only scope (no writes)

| ID     | Requirement |
|--------|-------------|
| FR-017 | Slack generative-UI MUST remain **display-only**: it reuses ONLY the refresh + pagination portions of the shared dispatcher and MUST NOT register any write action, MUST NOT use the Jira write-reconciliation path, and MUST NOT introduce any `adapter.*` mutation (P5). [Slack-specific scope] |

### Security & validation (hard constraints — shared)

| ID     | Requirement |
|--------|-------------|
| FR-018 | All Slack fetching and the Slack token MUST stay in **main**; nothing secret may enter an IPC payload, session snapshot, bridge frame, MCP result, or A2UI surface. [reuses shared] |
| FR-019 | All Slack adapter payloads (descriptor, reserved actions, `updateDataModel`) MUST reuse the existing typed contract in `src/shared/ipc.ts` / `src/shared/adapter.ts` and the existing boundary validators (`validateAdapterDescriptor`, `validateAdapterAction`); Slack MUST NOT add ad-hoc channel strings. A malformed payload MUST be **warned + ignored, never crash** (P1, hard constraint). [reuses shared] |
| FR-020 | A malformed `updateDataModel` for a Slack surface MUST be ignored safely by `ActiveTabSurface` (degrade to the tab's error boundary at worst), never white-screening the panel or affecting sibling tabs. [reuses shared] |

## Edge Cases & Constraints

- **Forward-only cursor exhausted.** A Slack list whose last page returned no `nextCursor` MUST
  disable load-more (`hasMore=false`); a load-more that somehow fires MUST be a safe no-op leaving
  the list unchanged.
- **Empty / last page.** An append returning zero new items MUST leave the accumulated list
  unchanged and set `hasMore=false`; an empty first page MUST show the bound empty state.
- **Stale/opaque cursor rejected.** A `nextCursor` (or `page+1`) the source no longer accepts MUST
  surface a calm recoverable notice and clear `loading`; the existing list is not corrupted.
- **Fetch error → safe fallback keeping prior data.** Network/rate-limited/forbidden failures MUST
  render a calm recoverable notice and clear `loading`, leaving prior data intact.
- **`reconnect_needed`/`not_connected` routing.** These MUST route to the native Slack
  Connect/Reconnect affordance (existing behavior), not a broken surface.
- **`search_unavailable`.** A search refresh without `search:read` scope MUST degrade to a
  recoverable notice, not a crash.
- **Secret-free invariant.** No Slack token may appear in the descriptor, data model,
  `updateDataModel` payload, snapshot, bridge frame, MCP result, or surface (FR-009/FR-018).
- **Malformed payload.** Warned + ignored at the main boundary / safely ignored at the renderer —
  never a crash (FR-019/FR-020).
- **Relationship to held `slack-thread-replies-v1`.** That on-hold feature adds clickable
  "N replies" → load a thread's replies (`getReplies`) as a NESTED, on-demand expansion. This
  cycle is about refreshable/paginated **top-level** Slack surfaces only and MUST NOT fold in
  thread expansion. The two are designed not to conflict: thread expansion, when built, will be a
  per-message nested surface/sub-model with its own `getReplies`-backed descriptor + its own
  `hasMore`/cursor state under a distinct sub-path — it does not reuse a top-level surface's list
  path or `loading`/`hasMore` flags. `getReplies` is therefore deliberately **not** mapped to a
  top-level `dataSource` here.
- **Out of scope (deliberately left to the Confluence cycle / later):** Confluence adapter wiring
  (its descriptors/surfaces/pagination); any write-bearing Slack action; real-time/push refresh
  (refresh is trigger-driven only); thread-reply nested expansion (`slack-thread-replies-v1`);
  any change to the shared infra contract.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A bound Slack surface restored on relaunch shows data fetched fresh at restore time, not values frozen at compose time, with no view re-compose and no agent invocation. |
| SC-002 | Panel re-activation and the explicit refresh affordance each produce a fresh `updateDataModel`. |
| SC-003 | Load-more grows each bound Slack list (full accumulated list written at the path); `hasMore` disables load-more when the forward cursor is exhausted; no Slack surface renders a prev/next control. |
| SC-004 | The `loading` flag toggles the control spinner: true on dispatch, false on land. |
| SC-005 | No Slack token appears in any descriptor, data model, `updateDataModel` payload, session snapshot, bridge frame, MCP result, or surface (verified by inspection + tests). |
| SC-006 | A malformed Slack `updateDataModel` / action payload is warned + ignored at the main boundary and safely ignored at the renderer — process never crashes, sibling tabs unaffected. |
| SC-007 | Fetch errors, exhausted cursors, empty/last pages, `reconnect_needed`/`not_connected`, and `search_unavailable` each degrade to a calm recoverable state with `loading` cleared. |
| SC-008 | Slack registers NO write action and uses NONE of the Jira write-reconciliation path (display-only). |
| SC-009 | Slack reuses the shared dispatcher / `updateDataModel` channel / descriptor schema / bound-surface convention / append pagination verbatim — no shared-infra contract is redefined or expanded by this cycle. |

---

## Open Questions

- [ ] None blocking. One non-blocking note for the plan: whether the message-history bound surface
  composes a real channel id into its descriptor at compose time (the agent has the channel id from
  its read) is a Slack-wiring detail captured in the plan, consistent with the secret-free
  descriptor constraint.
