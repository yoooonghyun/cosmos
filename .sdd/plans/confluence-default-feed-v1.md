# Plan: Confluence Default Base Feed — v1

**Status**: Draft
**Created**: 2026-06-07
**Last updated**: 2026-06-07
**Spec**: .sdd/specs/confluence-default-feed-v1.md

---

## Summary

Replace the Confluence native base's idle search placeholder ("Search Confluence to find
pages.") with a deterministic **personal activity feed** of pages the connected user @mentions,
watches, or has favorited (most-recently-modified first). The feed is a NEW dedicated read
operation — `defaultFeed` — threaded the same way the existing `searchContent` native read is
(client → manager → IPC channel → preload → renderer), reusing the same result DTOs
(`ConfluenceSearchResult` / `ConfluencePage`), the same v1 CQL search endpoint
(`/wiki/rest/api/search`), and the same `search:confluence` scope. The fixed personal-scope CQL
lives only in `ConfluenceClient`; the renderer never carries CQL or a mode flag. In the panel,
the existing `ContentList` is **generalized to accept a `fetcher` prop** so the feed reuses its
five states, "Load more" pagination, and row-click drill-in verbatim — only the empty-state
copy differs. The feed is a native-panel concern only: NO new MCP tool, NO `ConfluenceOp` /
bridge wiring, NO write, NO generative/agent run, NO change to the generative tabs/composer.

## Technical Context

| Item              | Value                                                                                                                                                                                                                                          |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + React renderer), Vitest                                                                                                                                                                                 |
| Key dependencies  | Existing only — no new packages. Reuses `ConfluenceClient.call`, hit-mapping, `cursorFromNextLink`, `ConfluenceManager.run()`, the `window.cosmos.confluence` IPC channel set, and the `ContentList` component.                              |
| Files to create   | none (all changes land in existing files; tests extend existing `*.test.ts`)                                                                                                                                                                  |
| Files to modify   | `src/shared/confluence.ts`, `src/shared/ipc.ts`, `src/shared/validate.ts`, `src/preload/index.ts`, `src/main/integrations/confluenceClient.ts`, `src/main/confluenceManager.ts`, `src/main/index.ts`, `src/renderer/ConfluencePanel.tsx`, `src/main/integrations/confluenceClient.test.ts`, `src/main/confluenceManager.test.ts` |

### Pinned identifier names (the developer MUST use these)

| Layer | Identifier |
|-------|-----------|
| Params type (`src/shared/confluence.ts`) | `ConfluenceDefaultFeedParams { cursor?: string }` |
| IPC channel constant (`ConfluenceChannelName`) | `DefaultFeed: 'confluence:defaultFeed'` |
| Preload + `ConfluenceApi` method | `defaultFeed(params: ConfluenceDefaultFeedParams): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>` |
| `ConfluenceManager` method | `defaultFeed(params: ConfluenceDefaultFeedParams)` |
| `ConfluenceClient` method | `defaultFeed(auth: ConfluenceCallAuth, cursor?: string)` |
| Validator (`src/shared/validate.ts`) | `validateConfluenceDefaultFeed(raw, warn?)` |
| Renderer empty-line copy | `No mentions, watched, or favorited pages yet.` |

### Resolved decisions

- **No `ConfluenceOp` / bridge / MCP wiring.** The bridge routes ops by the `ConfluenceOp`
  discriminator and exposes them to the agent. The default feed is a native-panel-only read
  (spec FR-013), so it MUST NOT get a `ConfluenceOp` entry, a `ConfluenceBridge.handleCall`
  branch, or an MCP tool. `src/main/confluenceBridge.ts` and the `src/mcp/confluence*` servers
  are NOT touched.
- **`ContentList` reuse via a `fetcher` prop (option i).** Generalize the existing `ContentList`
  to take a `fetcher: (cursor?: string) => Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>`
  and an `emptyLabel: string`, rather than adding a sibling `DefaultFeedList`. This avoids
  duplicating the five states + Load more + row rendering. Search passes
  `(cursor) => window.cosmos.confluence.searchContent({ query, ...(cursor?{cursor}:{}) })` with
  the existing "No content matches this query." label; the feed passes
  `(cursor) => window.cosmos.confluence.defaultFeed(cursor ? { cursor } : {})` with the pinned
  feed copy. The `query` dependency that re-runs the search list becomes a generic `reloadKey`
  prop (`query` for search, a stable constant like `'default-feed'` for the feed) so each source
  drives the `useEffect`/`key` correctly.
- **Refetch rule.** The feed loads once when the native base enters the idle search view (no
  submitted query) and is cached in the `ContentList` component's own state (mounted while the
  idle base is shown). Switching to a query swaps the source via the `reloadKey` change;
  returning to idle re-mounts the feed source (loads once). Returning from page-detail back to
  the idle base reuses the cached feed when the list instance is preserved — no forced refetch is
  added beyond the natural mount lifecycle (spec FR-001/FR-009 are satisfied by the idle render
  path, and no explicit invalidation is introduced).
- **Design-skip recommendation: SKIP Step 2.5 (design).** This reuses the existing `ContentList`
  rows/states/skeletons/Load-more unchanged; the only net-new visible element is one empty-line
  string rendered through the existing `EmptyLine` component. No new tokens, components, or
  layout — no design system work. Recommend skipping the design skill and proceeding to
  interface → test → implement.

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates from the plan.

### Phase 1 — Interface (shared types + contract)

- [x] Read `.sdd/specs/confluence-default-feed-v1.md`; confirm no open questions remain (the
      spec lists none).
- [x] `src/shared/confluence.ts`: add `export interface ConfluenceDefaultFeedParams { cursor?: string }`
      beside `ConfluenceSearchParams`, with a doc comment noting it carries NO query/CQL (the
      personal CQL is fixed in the client). Do NOT add a `ConfluenceOp` / `ConfluenceTool` entry
      (native-only, FR-013).
- [x] `src/shared/ipc.ts`: add `DefaultFeed: 'confluence:defaultFeed'` to `ConfluenceChannelName`
      with a doc comment; import `ConfluenceDefaultFeedParams`; add the `defaultFeed(...)` method
      to the `ConfluenceApi` interface returning
      `Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>` (mirror `searchContent`).
- [x] `src/shared/validate.ts`: add `validateConfluenceDefaultFeed(raw, warn?)` returning
      `ConfluenceDefaultFeedParams | null` — accept `{}`/`undefined` (cursor-optional), reject a
      non-object, and reject a non-string `cursor` when present (mirror the optional-cursor branch
      of `validateConfluenceSearch`; do NOT require `query`). Import the new params type.
- [x] Review the new types against the spec — cursor-only, no invented fields, no CQL/mode string
      reaches the renderer or IPC payload (SC-008).

### Phase 2 — Testing (write before implementation)

- [x] `src/main/integrations/confluenceClient.test.ts` — add a
      `describe('ConfluenceClient.defaultFeed …')`:
  - [x] builds the EXACT CQL
        `(mention = currentUser() or watcher = currentUser() or favourite = currentUser()) and type = page order by lastmodified desc`
        and GETs `/wiki/rest/api/search` with `limit=25` (capture the URL; assert it contains
        `/wiki/rest/api/search`, `cql=`, and — via `new URL(...).searchParams.get('cql')` — the
        exact CQL string; assert it is URL-encoded, i.e. the raw captured URL contains `cql=%28`
        not a literal `(`). See deviation re: `decodeURIComponent`.
  - [x] maps hits to plain-text `ConfluenceSearchResult`s and exposes the `_links.next` cursor as
        `nextCursor` (reuse the search test's hit fixture shape).
  - [x] passes `cursor` through to `searchParams` on a subsequent page.
  - [x] omits `nextCursor` when there is no next link.
  - [x] returns `reconnect_needed` on a 403 and `rate_limited` on a 429 (one assertion each — the
        client reuses `call`/`mapConfluenceError`, so a single representative case suffices).
- [x] `src/main/confluenceManager.test.ts` — add `defaultFeed: vi.fn(ok)` to `makeClient`, then:
  - [x] connected manager `defaultFeed({})` resolves `ok` and calls `client.defaultFeed` once.
  - [x] not-connected manager `defaultFeed({})` returns `{ ok: false, kind: 'not_connected' }`
        without calling the client (routes through `ensureToken`/`run`).
  - [x] reconnect_needed retry: a client that returns `reconnect_needed` once then `ok` is retried
        after a successful refresh (mirror the existing `searchContent`/`run()` retry test for the
        same `run()` path).
  - [x] `defaultFeed` passes `params.cursor` to `client.defaultFeed` (assert the second arg).
- [x] (Optional, if `validate.test.ts` exists for Confluence) add cases for
      `validateConfluenceDefaultFeed`: accepts `{}`; accepts `{ cursor: 'abc' }`; rejects
      `{ cursor: 5 }`; rejects a non-object. (Added to `src/shared/validate.test.ts`.)

### Phase 3 — Implementation

- [x] `src/main/integrations/confluenceClient.ts`: add `async defaultFeed(auth, cursor?)`
      mirroring `searchContent` but with the fixed personal CQL. Build the URL with
      `new URL(\`${this.base(auth.cloudId)}/wiki/rest/api/search\`)` and
      `url.searchParams.set('cql', '(mention = currentUser() or watcher = currentUser() or favourite = currentUser()) and type = page order by lastmodified desc')`
      (let `searchParams` encode it — do NOT hand-concatenate the query string), `set('limit','25')`,
      and `if (cursor) set('cursor', cursor)`. Reuse `this.call`, the same hit-mapping block
      (extracted to a shared private mapper `mapSearchResultsPage`), and
      `cursorFromNextLink(links.next)`. Return `ConfluencePage<ConfluenceSearchResult>`.
- [x] `src/main/confluenceManager.ts`: add
      `defaultFeed(params: ConfluenceDefaultFeedParams): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>`
      = `return this.run((auth) => this.deps.client.defaultFeed(auth, params.cursor))`. Import the
      new params type. No scope/write logic (read-only, FR-012).
- [x] `src/main/index.ts`: in `registerConfluenceIpcHandlers`, add an
      `ipcMain.handle(ConfluenceChannelName.DefaultFeed, …)` mirroring the `SearchContent` handler.
      Import `validateConfluenceDefaultFeed`.
- [x] `src/preload/index.ts`: import `ConfluenceDefaultFeedParams`; add
      `defaultFeed(params: ConfluenceDefaultFeedParams) { return ipcRenderer.invoke(ConfluenceChannelName.DefaultFeed, params) }`
      to `confluenceApi` (mirror `searchContent`). NOTE: preload changes require a full
      `npm run dev` restart, not HMR (per CLAUDE.md gotcha).
- [x] `src/renderer/ConfluencePanel.tsx`:
  - [x] Generalize `ContentList`: replaced the `query: string` prop with `fetcher`,
        `reloadKey: string`, and `emptyLabel: string`. `run(next?)` calls `fetcher(next)`; the
        `useEffect` depends on `reloadKey` and the parent `key=` uses `reloadKey`. 5 states, results
        count line, rows + space chip + excerpt, "Load more", and `onOpen`/`onReconnect` unchanged.
  - [x] Replaced the `query === ''` idle branch: renders the feed `ContentList`
        (`reloadKey="default-feed"`, `fetcher` → `defaultFeed`, empty copy
        "No mentions, watched, or favorited pages yet.") — the old `BookText` + placeholder removed.
  - [x] Updated the `query !== ''` branch to the generalized `ContentList`
        (`reloadKey={query}`, `fetcher` → `searchContent`, "No content matches this query.").
  - [x] Left the search `<Input>`, page-detail drill-in, generative tabs, `PromptComposer`, and
        `ActiveTabSurface` host untouched. `BookText` import kept (still used by the not-connected state).
- [x] `npm run typecheck` (node + web) and `npm test` green.

### Phase 4 — Docs

- [ ] No `docs/ARCHITECTURE.md` change required: this adds one more native read within the
      already-documented §4.9 native-panel read pattern and introduces no new pattern. If the
      wrap-up step judges the personal-feed approximation worth a one-line note in §4.9, add it
      then; otherwise leave the doc unchanged.
- [ ] Update `TODO.md` (wrap-up) and record any deviations below.
- [ ] Update this plan with any deviations.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-07** — Phases 1–3 implemented. `npm run typecheck` (node + web) and `npm test` both
  green (592 tests passing, 29 files). No commit made.
- **2026-06-07** — Client hit-mapping was EXTRACTED to a shared private `mapSearchResultsPage(body)`
  in `confluenceClient.ts` (the plan's "extract if cleaner" option) rather than duplicated, so
  `searchContent` and `defaultFeed` share the identical title/space/excerpt + `_links.next`→`nextCursor`
  mapping. No behavior change to `searchContent` (its existing test still passes).
- **2026-06-07** — Test-assertion deviation (not a contract change): the plan suggested asserting the
  exact CQL via `decodeURIComponent` of the raw `cql` param. `URLSearchParams` encodes spaces as `+`,
  and `decodeURIComponent` does NOT turn `+` back into a space, so that exact-string assertion failed.
  The client is correct (it uses `url.searchParams.set` per the plan); only the test was wrong. The
  exact-CQL check now uses `new URL(capturedUrl).searchParams.get('cql')` (which decodes `+`→space),
  and the URL-encoding check is still the `cql=%28` substring assertion on the raw URL. CQL string and
  encoding are both verified.
- **2026-06-07** — `validateConfluenceDefaultFeed` cases were added to the existing
  `src/shared/validate.test.ts` (which exists but had no prior Confluence coverage), exercising the
  validator directly (`{}`/`undefined` accepted, string cursor accepted, non-string cursor + non-object
  rejected with a warning) in addition to the indirect client/manager coverage.
- **2026-06-07** — `searchContent` wiring matched the plan's assumptions exactly across all seven
  files; no structural divergence. The only adjustments beyond a literal mirror were the two above
  (shared mapper extraction, test-assertion fix).
