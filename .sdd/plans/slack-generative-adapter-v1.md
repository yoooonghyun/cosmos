# Plan: Slack Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Last updated**: 2026-06-09
**Spec**: .sdd/specs/slack-generative-adapter-v1.md

---

## Summary

Wire Slack onto the **already-shipped** API→UI generative adapter (built by
`jira-generative-adapter-v1`, which owns the shared infrastructure). The shared pieces are
reused **verbatim**: `ActiveTabSurface`'s `updateDataModel` processing + `dataModelApply.ts`,
the `updateDataModel` push channel keyed by `surfaceId`, the secret-free descriptor
`{ dataSource, query }` + its snapshot persistence, the channel-independent `AdapterDispatcher`,
the reserved `adapter.*` action namespace + boundary validators (`validateAdapterDescriptor` /
`validateAdapterAction`), and the bound-surface convention (`{path}` + `TemplateBinding` +
initial `updateDataModel` + `hasMore`/`loading` flags). Slack adds only: (1) Slack adapter
descriptors mapping `listChannels`/`getHistory`/`search` to non-secret query+cursor (mirroring
`jiraSearchDescriptor`), (2) a `slackAdapterResolver` (mirroring `jiraAdapterResolver`) that
maps the descriptor to the `SlackManager` read, resolves names via `getUser`, and normalizes to
`AdapterFetchResult`, (3) bound Slack surface builders + catalog components reading the data
model, and (4) `index.ts` wiring registering the Slack resolver/bind-options with the dispatcher
and the Slack render target. **All Slack lists use append (`pagination: 'append'`) only** —
Slack's `next_cursor`/`page+1` cursors are forward-only and opaque, so page-replace prev/next is
impossible; `hasPrev` stays unused. Slack is **read-only**: it reuses only refresh + pagination,
never the Jira write-reconciliation path. **This is a UI-bearing feature** — the `design` skill
runs after this plan is approved and before interface (bound Slack lists + load-more/refresh +
`loading` spinner are new visual states), extending the existing Slack panel chrome.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer + shared) |
| Key dependencies (SHARED, reuse as-is) | `AdapterDispatcher` (`src/main/adapterDispatcher.ts`), `AdapterDescriptor`/`AdapterAction`/`AdapterDataKey`/`AdapterPaginationMode`/`AdapterFetchResult` (`src/shared/adapter.ts` + dispatcher exports), `validateAdapterDescriptor`/`validateAdapterAction` (`src/shared/validate.ts`), `UiDataModelPayload` + snapshot descriptor persistence (`src/shared/ipc.ts`), `ActiveTabSurface` + `dataModelApply.ts`, the `adapter.*` `ui:action` interception + push sink + lazy re-registration in `src/main/index.ts` |
| Key dependencies (Slack) | `SlackManager` (`listChannels`/`getHistory`/`search`/`getUser`), `SlackPage`/`SlackResult`/`SlackMessage`/`SlackChannel`/`SlackSearchMatch` (`src/shared/slack.ts`), `slackRenderUiServer.ts` (`catalogId: 'slack'`, `target: 'slack'`), Slack catalog components (`src/renderer/slackCatalog/components.tsx`) |
| Files to create   | `src/main/slackAdapter.ts` (Slack resolver + bind options, mirrors `jiraAdapter.ts`); `src/main/slackSurfaceBuilder.ts` (bound Slack surface builders + initial `updateDataModel`, if no builder exists yet) + tests; `slackAdapter.test.ts` |
| Files to modify   | `src/shared/slack.ts` (Slack descriptor types + builder fns, mirroring `jira.ts`'s `JiraAdapterDescriptor`/`jiraSearchDescriptor`); `src/renderer/slackCatalog/components.tsx` + its `logic.ts` (bound list variants reading data binding); `src/main/index.ts` (register Slack resolver/bind-options with the shared dispatcher; route Slack bound surfaces); `docs/ARCHITECTURE.md` (note Slack now rides the adapter — append-only, read-only) |

### Reuse-shared vs. Slack-wiring (the load-bearing split)

**Reuse shared (NO change to the shared contract; Slack consumes verbatim):**

- `ActiveTabSurface` + `dataModelApply.ts` `updateDataModel` processing. (FR-001/FR-020)
- `updateDataModel` push channel keyed by `surfaceId`. (FR-009/FR-016)
- Descriptor schema `{ dataSource, query }` + snapshot persistence + boundary validators. (FR-009/FR-019)
- `AdapterDispatcher` register/refresh/load-more/loading + accumulation (append mode). (FR-010/FR-012/FR-014/FR-016)
- Reserved `adapter.refresh`/`adapter.loadMore` interception + lazy re-registration on restore. (FR-013/FR-015)
- Bound-surface convention (`{path}` + `TemplateBinding` + initial seed + `hasMore`/`loading`). (FR-001/FR-003/FR-012)

> If any of these would need a change to accommodate Slack, that is a shared-infra GAP — flag it
> in §Deviations and do NOT silently expand the shared contract. (None expected; see §Resolved.)

**Slack-specific wiring (this cycle; analogous to Jira's, NOT a shared change):**

- Slack descriptor types + builders in `src/shared/slack.ts` (mirror `JiraAdapterDescriptor` /
  `jiraSearchDescriptor`): `SlackAdapterSource = { ListChannels:'listChannels', GetHistory:'getHistory', Search:'search' }`;
  `slackChannelsDescriptor(cursor?)`, `slackHistoryDescriptor(channelId, cursor?)`,
  `slackSearchDescriptor(query, cursor?)`. (FR-005/FR-006)
- `slackAdapterResolver(manager)` + bind options in `src/main/slackAdapter.ts` (mirror
  `jiraAdapter.ts`): map `dataSource` → `SlackManager` read, resolve `getUser` names (FR-008),
  normalize `SlackPage` → `AdapterFetchResult`; bind options all `pagination: 'append'` with the
  bound list path. (FR-007/FR-008/FR-010)
- Bound Slack surface builders (ChannelList/MessageList/SearchResultList) + initial
  `updateDataModel` seed. (FR-002/FR-003)
- Slack catalog components updated to read bound items + render load-more/refresh + spinner bound
  to `hasMore`/`loading`. (FR-004)
- `index.ts`: register the Slack resolver + per-surface bind options with the dispatcher; the
  Slack render target stays display-only (no write registration). (FR-017)

> The Confluence cycle re-implements its own analog (descriptors → CQL/content reads, builders,
> resolver) and decides its own append-vs-replace; it reuses the same shared items 1–6.

---

## Implementation Checklist

> The **`design` skill runs after this plan is approved and before Phase 1 (interface)** — it
> establishes the bound Slack list visual states (load-more control, refresh affordance, per-control
> `loading` spinner) by extending the existing Slack panel chrome + shared Tailwind/shadcn tokens,
> producing `.sdd/designs/slack-generative-adapter-v1.md`. Interface starts after design.

### Phase 0 — Design (designer, precedes interface)

- [ ] Design spec for the bound Slack lists' load-more control, refresh affordance, and the
  per-control `loading` spinner, reusing the native Slack panel's existing "Load more" chrome and
  cosmos tokens. (`.sdd/designs/slack-generative-adapter-v1.md`)

### Phase 1 — Interface (Slack wiring; shared types reused)

- [x] Read spec; confirm no open questions remain.
- [x] **[reuse shared]** Confirm the shared adapter types/validators/push channel cover Slack with
  NO change (descriptor `{ dataSource, query }`, `AdapterFetchResult` items+nextCursor, append mode,
  `validateAdapterDescriptor`/`validateAdapterAction`). If a gap surfaces, STOP and flag it.
  **No shared-infra gap** — validators are panel-agnostic; consumed verbatim.
- [x] **[Slack]** Define `SlackAdapterSource` + `SlackAdapterDescriptor` union + `slackChannelsDescriptor`/
  `slackHistoryDescriptor`/`slackSearchDescriptor` in `src/shared/slack.ts` (mirror `jira.ts`) —
  secret-free, only `channelId`/`query`/`cursor`; no invented fields.
- [x] **[Slack]** Define `slackAdapterResolver`'s manager subset + bind options (`pagination:'append'`,
  list paths) in `src/main/slackAdapter.ts`.
- [x] **[shared extraction]** Move `RefreshButton`/`LoadMoreButton`/`PaginationBar` + the
  `useBound`/`Bound`/`Bind` binding helpers out of `jiraCatalog/components.tsx` into
  `src/renderer/catalogShared/controls.tsx`; Jira re-exports them (no behavior change).
- [x] Review types vs spec — no invented properties; trace each to an FR.

### Phase 2 — Testing

- [x] **[Slack]** `slackAdapter.test.ts` resolver tests: each `dataSource` maps to the right
  `SlackManager` read; `SlackPage` → `AdapterFetchResult` (items + nextCursor); name resolution
  applied (FR-008); `nextCursor` absent ⇒ no `hasMore`; `reconnect_needed`/`not_connected`/
  `search_unavailable`/network → `ok:false` recoverable (loading clears, prior data intact); never
  throws; secret-free result.
- [x] **[Slack]** Bound surface-builder tests (`slackSurfaceBuilder.test.ts`):
  ChannelList/MessageList/SearchResultList use `{path}` bindings + initial `updateDataModel` (seed
  rows + `/loading=false` + `/hasMore` = `nextCursor` present); no literal data props; secret-free
  descriptor; `hasPrev` never emitted (append-only).
- [x] **[reuse shared]** Confirmed existing dispatcher tests cover append accumulation + `loading`
  toggling + recoverable-notice; the Slack resolver exposes no untested dispatcher path. No new
  shared tests added.
- [x] **[renderer]** Bound Slack catalog logic (`boundRows`/`showErrorNotice`/`showEmptyState`)
  covered in `slackCatalog/logic.test.ts` per the `.ts`/`.test.ts` split (the `.tsx` is not
  node-unit-tested).

### Phase 3 — Implementation

- [x] **[Slack]** Implement `slackAdapterResolver` + bind options (`src/main/slackAdapter.ts`):
  descriptor → `SlackManager` read, `getUser` name resolution, normalize to `AdapterFetchResult`,
  recoverable failures, channel-independent (no PtyManager/AgentRunner).
- [x] **[Slack]** Implement bound Slack surface builders + initial `updateDataModel` seed
  (`src/main/slackSurfaceBuilder.ts`), emitting Slack descriptors.
- [x] **[Slack]** Update Slack catalog components (`src/renderer/slackCatalog/`) to read bound data,
  render the load-more control + refresh affordance bound to `hasMore`, and show the `loading`
  spinner (reuse the shared `useBound<T>`/`RefreshButton`/`LoadMoreButton` from `catalogShared`).
  ChannelList/MessageList/SearchResultList all converted; MessageList gains a new count header.
- [x] **[reuse shared]** Wire `index.ts`: COMPOSITE resolver (Slack-vs-Jira by `dataSource`) on the
  shared `AdapterDispatcher`; lazy re-registration consults `slackBindOptionsForSource` first.
  NO write registration (FR-017).
- [x] All tests pass (839); `npm run typecheck` clean. Reused shared utilities — no duplicated logic.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: note Slack now rides the generative adapter — **append-only**
  pagination (forward-only opaque cursors, no prev/next), **read-only** (no write reconciliation),
  reusing the shared infra; keep consistent with the Jira section. Flag any shared-infra gap if one
  appeared (else state explicitly that none did).
- [ ] Update `TODO.md` (wrap-up); mark Slack of the three-sibling rollout done, Confluence next.
- [ ] Update this plan with deviations.

---

## Resolved ambiguities (decided during authoring; consistent with the brief)

- **Append-only, no page-replace.** Slack `conversations.list/history/replies` return an opaque
  forward `next_cursor`; `search.messages` paginates by page number, surfaced as a synthetic
  forward cursor (`page+1`). Neither yields a backward cursor — a true prev page is unfetchable. So
  every Slack bound list registers `pagination: 'append'` and `hasPrev` stays unused. (The shared
  dispatcher supports `'replace'`, but Slack does not use it.) (FR-010/FR-011)
- **`getReplies` is NOT a top-level dataSource.** Thread-reply expansion is the held
  `slack-thread-replies-v1` feature (nested, on-demand). To avoid pre-empting it / conflicting later,
  only `listChannels`/`getHistory`/`search` are mapped here; a future thread surface gets its own
  nested descriptor + sub-path + flags.
- **Name resolution stays in the resolver.** The native panel resolves author names via `getUser`
  (`resolveNames`); the resolver does the same in main so refreshed/appended rows match the composed
  surface, without putting a token in the row shape. (FR-008)
- **Read-only ⇒ refresh + pagination only.** Slack registers no write action and never touches the
  Jira write-reconciliation path. (FR-017)

## What this cycle deliberately leaves to Confluence (and later)

- Confluence's concrete descriptors (`dataSource` → CQL search / content reads; `query` → CQL +
  opaque cursor), its bound builders + catalog components, and its append-vs-replace choice.
- Slack thread-reply nested expansion (`slack-thread-replies-v1`) — explicitly out of scope here.
- Any write-bearing Slack action; real-time/push refresh; any change to the shared infra contract.

## Deviations & Notes

- **2026-06-09**: Initial plan authored. No code written. Design step precedes interface. No
  shared-infra change anticipated — Slack consumes the Jira-built infra verbatim; if interface/impl
  reveals a gap it MUST be flagged here, not silently absorbed into the shared contract.
- **2026-06-09 (impl)**: Phases 1–3 done. **No shared-infra change** — the shared
  `AdapterDispatcher`/descriptor/validators were consumed verbatim. The design-flagged shared
  CONTROL extraction created `src/renderer/catalogShared/controls.tsx` (single home of
  `Bind`/`Bound`/`useBound`/`RefreshButton`/`LoadMoreButton`/`PaginationBar`); Jira now imports +
  re-exports them (pure refactor, all Jira tests green). Slack registers `RefreshButton` +
  `LoadMoreButton` only (append-only — never `PaginationBar`).
- **INTEGRATION SEAM (flagged, NOT implemented this cycle — not a shared-infra gap):** the bound
  Slack surfaces (`buildBoundChannelListSurface`/`buildBoundMessageListSurface`/
  `buildBoundSearchResultListSurface` in `slackSurfaceBuilder.ts`) + the composite resolver are
  wired into the dispatcher, but no MAIN trigger composes them yet. Jira's bound surfaces are
  composed from its IPC handlers; Slack today composes its surfaces AGENT-side via `render_slack_ui`
  (no descriptor/dataModel). A future task must emit these bound surfaces from a Slack
  rail-switch/IPC path (or extend `render_slack_ui` to carry the descriptor) for the refresh/
  load-more controls to be exercised end-to-end. The builders + resolver + catalog are ready and
  unit-tested; the composing trigger is the remaining seam.
- **NOT live-exercised:** the bound Slack renderer (ChannelList/MessageList/SearchResultList header
  refresh + tail load-more + aria-busy/aria-live) was verified only by node unit tests + typecheck,
  NOT in the running app — there is no main trigger composing a bound Slack surface yet (see seam
  above).
