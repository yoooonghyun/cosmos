# Plan: Confluence Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Last updated**: 2026-06-09
**Spec**: .sdd/specs/confluence-generative-adapter-v1.md

---

## Summary

Wire Confluence onto the **already-shipped** API→UI generative adapter (built by
`jira-generative-adapter-v1`, reused verbatim by `slack-generative-adapter-v1`). Confluence is
the **third and final** sibling cycle. The shared pieces are reused **verbatim**:
`ActiveTabSurface`'s `updateDataModel` processing + `dataModelApply.ts`, the `updateDataModel`
push channel keyed by `surfaceId`, the secret-free descriptor `{ dataSource, query }` + its
snapshot persistence, the channel-independent `AdapterDispatcher`, the reserved `adapter.*` action
namespace + boundary validators (`validateAdapterDescriptor` / `validateAdapterAction`), the
bound-surface convention (`{path}` + `TemplateBinding` + initial `updateDataModel` +
`hasMore`/`loading`), and the shared catalog controls in `src/renderer/catalogShared/controls.tsx`
(`Bind`/`Bound`/`useBound`/`RefreshButton`/`LoadMoreButton`). Confluence adds only:
(1) Confluence adapter descriptors mapping `defaultFeed`/`searchContent`/`getPage` to non-secret
query+cursor (mirroring `slackChannelsDescriptor` et al.), (2) a `confluenceAdapterResolver`
(mirroring `slackAdapterResolver`) mapping the descriptor to the `ConfluenceManager` read and
normalizing to `AdapterFetchResult`, (3) bound Confluence surface builders + catalog components
reading the data model, and (4) `index.ts` wiring registering the Confluence resolver/bind-options
with the dispatcher's composite resolver and the Confluence render target. **All Confluence lists
use append (`pagination: 'append'`) only** — Confluence's sole paging cursor is the opaque,
forward-only `_links.next` value (`cursorFromNextLink` → `nextCursor`); no backward/offset cursor
is exposed, so page-replace is impossible and `hasPrev` stays unused. Page detail registers
`pagination: 'none'` (refresh-only). Confluence is **read-only**: it reuses only refresh +
pagination, never the Jira write-reconciliation path; `confluence-create-page-v1` is untouched.
**This is a UI-bearing feature** — the `design` skill runs after this plan is approved and before
interface (bound Confluence lists + load-more/refresh + `loading` spinner are new visual states),
extending the existing Confluence panel chrome + shared tokens.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer + shared) |
| Key dependencies (SHARED, reuse as-is) | `AdapterDispatcher` (`src/main/adapterDispatcher.ts`), `AdapterDescriptor`/`AdapterAction`/`AdapterDataKey`/`AdapterPaginationMode`/`AdapterFetchResult`/`AdapterRegisterOptions` (`src/shared/adapter.ts` + dispatcher exports), `validateAdapterDescriptor`/`validateAdapterAction` (`src/shared/validate.ts`), `UiDataModelPayload` + snapshot descriptor persistence (`src/shared/ipc.ts`), `ActiveTabSurface` + `dataModelApply.ts`, the `adapter.*` `ui:action` interception + push sink + lazy re-registration in `src/main/index.ts`, the shared catalog controls (`src/renderer/catalogShared/controls.tsx`: `Bind`/`Bound`/`useBound`/`RefreshButton`/`LoadMoreButton`) |
| Key dependencies (Confluence) | `ConfluenceManager` (`defaultFeed`/`searchContent`/`getPage`), `ConfluencePage`/`ConfluenceResult`/`ConfluenceSearchResult`/`ConfluencePageDetail`/`ConfluenceDefaultFeedParams`/`ConfluenceSearchParams`/`ConfluenceGetPageParams` (`src/shared/confluence.ts`), `cursorFromNextLink` (already maps `_links.next` → opaque cursor in `confluenceClient.ts`), the Confluence render UI server (`catalogId: 'confluence'`, `target: 'confluence'`), Confluence catalog components (`src/renderer/confluenceCatalog/components.tsx` + `logic.ts`) |
| Files to create   | `src/main/confluenceAdapter.ts` (Confluence resolver + bind options + `confluenceBindOptionsForSource`, mirrors `slackAdapter.ts`) + `confluenceAdapter.test.ts`; `src/main/confluenceSurfaceBuilder.ts` (bound Confluence surface builders + initial `updateDataModel`, if no builder exists yet) + `confluenceSurfaceBuilder.test.ts` |
| Files to modify   | `src/shared/confluence.ts` (Confluence descriptor types + builder fns: `ConfluenceAdapterSource` + `confluenceFeedDescriptor`/`confluenceSearchDescriptor`/`confluencePageDescriptor`, mirroring `slack.ts`); `src/renderer/confluenceCatalog/components.tsx` + `logic.ts` (bound list + bound page-detail variants reading the data binding, import shared controls); `src/main/index.ts` (extend the COMPOSITE resolver + lazy re-registration to recognize Confluence sources; route Confluence bound surfaces; NO write registration); `docs/ARCHITECTURE.md` (note Confluence now rides the adapter — append-only, read-only; close the three-cycle set) |

### Reuse-shared vs. Confluence-wiring (the load-bearing split)

**Reuse shared (NO change to the shared contract; Confluence consumes verbatim — already proven by
Slack):**

- `ActiveTabSurface` + `dataModelApply.ts` `updateDataModel` processing. (FR-001/FR-020)
- `updateDataModel` push channel keyed by `surfaceId`. (FR-009/FR-016)
- Descriptor schema `{ dataSource, query }` + snapshot persistence + boundary validators. (FR-009/FR-019)
- `AdapterDispatcher` register/refresh/load-more/loading + accumulation (append mode). (FR-010/FR-012/FR-014/FR-016)
- Reserved `adapter.refresh`/`adapter.loadMore` interception + lazy re-registration on restore. (FR-013/FR-015)
- Bound-surface convention (`{path}` + `TemplateBinding` + initial seed + `hasMore`/`loading`) + the shared `RefreshButton`/`LoadMoreButton`/`useBound` controls. (FR-001/FR-003/FR-004/FR-012)

> If any of these would need a change to accommodate Confluence, that is a shared-infra GAP — flag
> it in §Deviations and do NOT silently expand the shared contract. (None expected — Confluence's
> shape is a strict subset of what Slack already exercised; see §Resolved.)

**Confluence-specific wiring (this cycle; analogous to Slack's, NOT a shared change):**

- Confluence descriptor types + builders in `src/shared/confluence.ts` (mirror Slack's):
  `ConfluenceAdapterSource = { DefaultFeed:'defaultFeed', SearchContent:'searchContent', GetPage:'getPage' }`;
  `confluenceFeedDescriptor(cursor?)`, `confluenceSearchDescriptor(query, cursor?)`,
  `confluencePageDescriptor(pageId)`. (FR-005/FR-006/FR-007)
- `confluenceAdapterResolver(manager)` + bind options in `src/main/confluenceAdapter.ts` (mirror
  `slackAdapter.ts`): map `dataSource` → `ConfluenceManager` read, normalize
  `ConfluencePage<ConfluenceSearchResult>` → `AdapterFetchResult.items` + `nextCursor`, and
  `ConfluencePageDetail` → `AdapterFetchResult.value`; bind options `pagination: 'append'` for the
  two lists, `pagination: 'none'` for page detail. NO name-resolution step (Confluence rows carry no
  user-id needing a `getUser` lookup — that Slack step does not apply). (FR-008/FR-010)
- Bound Confluence surface builders (default-feed list, search-results list, page detail) + initial
  `updateDataModel` seed. (FR-002/FR-003)
- Confluence catalog components updated to read bound items/value + render load-more/refresh +
  spinner bound to `hasMore`/`loading`, importing the shared controls. (FR-004)
- `index.ts`: extend the composite resolver (Confluence-vs-Slack-vs-Jira by `dataSource`) +
  lazy-re-registration `…BindOptionsForSource` chain to include Confluence; the Confluence render
  target stays display-only (no write registration). (FR-017)

> This closes the three-sibling set. After this cycle there is no remaining panel that rides the
> adapter pattern; the shared infra is exercised by all three integrations.

---

## Implementation Checklist

> The **`design` skill runs after this plan is approved and before Phase 1 (interface)** — it
> establishes the bound Confluence list/detail visual states (load-more control, refresh affordance,
> per-control `loading` spinner) by extending the existing Confluence panel chrome + shared
> Tailwind/shadcn tokens, producing `.sdd/designs/confluence-generative-adapter-v1.md`. Interface
> starts after design. Reuse the already-extracted shared controls — do NOT introduce a Confluence
> copy.

### Phase 0 — Design (designer, precedes interface)

- [ ] Design spec for the bound Confluence lists' load-more control, refresh affordance, and the
  per-control `loading` spinner, reusing the native Confluence panel's existing "Load more" chrome,
  the shared `RefreshButton`/`LoadMoreButton`, and cosmos tokens. Cover the bound page-detail
  refresh affordance too. (`.sdd/designs/confluence-generative-adapter-v1.md`)

### Phase 1 — Interface (Confluence wiring; shared types reused)

- [x] Read spec; confirm no open questions remain.
- [x] **[reuse shared]** Confirmed the shared adapter types/validators/push channel/controls cover
  Confluence with NO change (descriptor `{ dataSource, query }`, `AdapterFetchResult` items+nextCursor
  AND value, append + none modes, `validateAdapterDescriptor`/`validateAdapterAction`,
  `useBound`/`RefreshButton`/`LoadMoreButton`). No gap surfaced — Confluence is a strict subset of
  Slack (append lists) + Jira (none detail).
- [x] **[Confluence]** Defined `ConfluenceAdapterSource` + `ConfluenceAdapterDescriptor` union +
  `confluenceFeedDescriptor`/`confluenceSearchDescriptor`/`confluencePageDescriptor` in
  `src/shared/confluence.ts` (mirror `slack.ts`) — secret-free, only `query`/`cursor`/`pageId`; the
  feed descriptor carries NO CQL (FR-007); no invented fields.
- [x] **[Confluence]** Defined `ConfluenceAdapterManager` subset + bind options
  (`pagination:'append'` for the two lists, `pagination:'none'` for page detail; paths
  `/feed`,`/results`,`/page`) + `confluenceBindOptionsForSource` in `src/main/confluenceAdapter.ts`.
- [x] Reviewed types vs spec — no invented properties; every field traces to an FR.

### Phase 2 — Testing

- [x] **[Confluence]** `confluenceAdapter.test.ts` resolver tests: each `dataSource` maps to the
  right `ConfluenceManager` read; `ConfluencePage<ConfluenceSearchResult>` → `AdapterFetchResult`
  (items + nextCursor); `ConfluencePageDetail` → `AdapterFetchResult.value`; `nextCursor` absent ⇒ no
  `hasMore`; `reconnect_needed`/`rate_limited`/`network`(gone page) → `ok:false` recoverable; never
  throws (missing-required → safe fallback); secret-free result; feed descriptor carries no CQL.
- [x] **[Confluence]** Bound surface-builder tests (`confluenceSurfaceBuilder.test.ts`): feed +
  search lists use `{path}` bindings + initial `updateDataModel` (seed rows + `/loading=false` +
  `/hasMore` = `nextCursor` present); page-detail binds title/space/body to `/page` sub-paths + seeds
  the detail value; no literal data props; secret-free descriptor; `hasPrev` never emitted.
- [x] **[reuse shared]** Confirmed existing dispatcher tests cover append accumulation + `loading`
  toggling + recoverable-notice + the `value`/`none` (detail) path (Jira issue-detail). No
  Confluence-specific shared test needed — the shared paths are unchanged.
- [x] **[renderer]** Bound Confluence catalog logic (`boundRows`/`showEmptyState`/`showErrorNotice`)
  covered in `confluenceCatalog/logic.test.ts` per the `.ts`/`.test.ts` split.

### Phase 3 — Implementation

- [x] **[Confluence]** Implemented `confluenceAdapterResolver` + bind options
  (`src/main/confluenceAdapter.ts`): descriptor → `ConfluenceManager` read, normalize to
  `AdapterFetchResult`, recoverable failures, channel-independent. No name-resolution step.
- [x] **[Confluence]** Implemented bound Confluence surface builders + initial `updateDataModel` seed
  (`src/main/confluenceSurfaceBuilder.ts`), emitting Confluence descriptors. ONE `SearchResultList`
  backs feed + search.
- [x] **[Confluence]** Updated Confluence catalog components (`src/renderer/confluenceCatalog/`):
  bound `SearchResultList` (header count + `RefreshButton`, tail `LoadMoreButton`, `aria-busy`/
  `aria-live`, `BoundListError` above kept rows) + bound `PageDetail` (header refresh, `{path}` props,
  recoverable error notice). Reused the shared `useBound`/`RefreshButton`/`LoadMoreButton`; registered
  them in `index.ts` (NOT `PaginationBar`).
- [x] **[reuse shared]** Wired `index.ts`: extended the COMPOSITE resolver
  (Confluence-vs-Slack-vs-Jira by `dataSource`); lazy re-registration consults
  `confluenceBindOptionsForSource` in the chain. NO write registration (FR-017). Moved
  `confluenceManager` creation before the dispatcher.
- [x] All tests pass (871, incl. 37 new Confluence); `npm run typecheck` clean. Shared utilities
  reused — no duplicated logic.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: note Confluence now rides the generative adapter —
  **append-only** pagination (opaque forward `_links.next` cursor, no prev/next/offset),
  **read-only** (no write reconciliation; page-create stays a separate feature), reusing the shared
  infra; **state explicitly that this closes the three-sibling Jira → Slack → Confluence set** and
  that the shared infra is now exercised by all three. Flag any shared-infra gap if one appeared
  (else state explicitly that none did).
- [ ] Update `TODO.md` (wrap-up); mark Confluence — and the whole three-sibling rollout — done.
- [ ] Update this plan with deviations.

---

## Resolved ambiguities (decided during authoring; consistent with the brief)

- **Append-only, no page-replace — from the actual cursor model.** Confluence's `searchContent` and
  `defaultFeed` both call `GET /wiki/rest/api/search` with a fixed `limit=25` and an opaque
  `cursor`, and derive the next cursor solely from `_links.next` via `cursorFromNextLink`. There is
  no backward `_links.prev` cursor surfaced and no `start`-based offset cursor exposed by the
  client — the page read is strictly forward. So both bound lists register `pagination: 'append'`
  and `hasPrev` stays unused; no `PaginationBar` is rendered. (Confluence does NOT take the
  page-replace path despite the brief noting it *might* if offset-based — the client is opaque-cursor,
  not offset.) (FR-010/FR-011)
- **Page detail uses `pagination: 'none'`.** `getPage` returns a single `ConfluencePageDetail`, not a
  list; its bound surface registers `pagination: 'none'` and is refresh-only (no list path
  accumulation). The shared dispatcher already writes a single `value` for non-list surfaces (proven
  by Jira's issue-detail), so this needs no shared change. (FR-002/FR-010)
- **Feed descriptor carries no CQL.** The default-feed descriptor's `query` is cursor-only; the
  personal-scope CQL stays in `ConfluenceClient.defaultFeed`, preserving `confluence-default-feed-v1`
  FR-006/SC-008. (FR-007)
- **No name resolution.** Unlike Slack (which resolves `getUser` author names), Confluence rows carry
  no user-id needing a lookup — the resolver maps DTOs directly with no enrichment step.
- **Read-only ⇒ refresh + pagination only.** Confluence registers no write action and never touches
  the Jira write-reconciliation path; `confluence-create-page-v1` (the model-mediated MCP write) is
  out of scope and untouched. (FR-017)
- **Re-activation refresh nuance.** The `confluence-default-feed-v1` expectation that the feed shows
  current most-recently-modified activity is now satisfied by an adapter refresh on panel
  re-activation, routed through `ConfluenceManager.run()` (transparent token refresh + reconnect
  handling) inside the resolver. (FR-016)

## Shared-infra gap assessment

- **None expected.** Confluence's needs are a strict subset of what Slack + Jira already exercised:
  append-mode lists (Slack) + a single-`value` refresh-only detail surface (Jira issue-detail). The
  brief specifically asked whether an offset-based page-replace would need anything the dispatcher's
  `'replace'`/`prevCursor` path doesn't already provide — but **Confluence does not use page-replace
  at all** (opaque forward cursor), so that question is moot here and no gap is exposed. If interface
  or implementation reveals one, it MUST be flagged in §Deviations, NOT silently absorbed into the
  shared contract.

## Deviations & Notes

- **2026-06-09**: Initial plan authored. No code written. Design step precedes interface. No
  shared-infra change anticipated — Confluence consumes the Jira-built, Slack-proven infra verbatim;
  if interface/impl reveals a gap it MUST be flagged here, not silently absorbed into the shared
  contract. Like Slack, the live composing trigger (a main path that emits the bound Confluence
  surfaces with their descriptor) is the integration seam to verify end-to-end — the builders +
  resolver + catalog are unit-tested, but exercising the refresh/load-more controls in the running
  app depends on that trigger (carry the same seam note Slack flagged).
- **2026-06-09 (impl)**: Steps 3–5 complete. NO shared-infra change — Confluence consumed the
  infra verbatim as anticipated; no §Deviations gap. Files: `src/shared/confluence.ts` (+descriptor
  types/builders), `src/main/confluenceAdapter.ts` (+resolver/bind-options, NEW),
  `src/main/confluenceSurfaceBuilder.ts` (+bound builders, NEW), `src/renderer/confluenceCatalog/`
  (bound `SearchResultList`+`PageDetail`, `logic.ts` gating helpers, `index.ts` control registration),
  `src/main/index.ts` (composite resolver + lazy re-reg extended; `confluenceManager` moved before the
  dispatcher), `docs/DEVELOPMENT.md` (generative-adapter section updated; three-cycle set noted closed).
  Tests: +37 Confluence (resolver/builder/logic), all 871 green; typecheck clean. **SEAM (same as
  Slack/Jira): no live composing trigger yet** — no main path emits the bound Confluence surfaces with
  their descriptor, so the refresh/load-more/refresh-detail controls were exercised only via node unit
  tests, NOT in the running app. Wiring that trigger (the `render_confluence_ui` builder emitting these
  bound surfaces) is the remaining end-to-end integration step, shared by all three siblings.
