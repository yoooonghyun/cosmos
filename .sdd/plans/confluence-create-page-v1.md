# Plan: Confluence Create Page — v1

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: `.sdd/specs/confluence-create-page-v1.md`

---

## Summary

Add the first Confluence **write** — creating a page — by cloning the proven Jira
`jira.create` deterministic write path onto Confluence. A new `CreatePageForm` in the
Confluence custom catalog emits a `confluence.create` bound action; main intercepts
`confluence.*` at the `ui:action` boundary and a new `ConfluenceActionDispatcher` executes
the create via a new `ConfluenceManager.createPage` (scope short-circuit + existing
`run()` refresh path) → a new `ConfluenceClient.createPage` (REST `POST /wiki/api/v2/pages`)
WITHOUT re-invoking `claude`, then settles the pending render as `cancel`, composes a
result surface via a new `ConfluenceSurfaceBuilder`, and re-pushes `ui:render` with a fresh
requestId + `target: 'confluence'`. The body is converted plain text → storage format by a
new pure `plainTextToStorage` (inverse of the existing `storageToPlainText`). Exactly one
new OAuth scope (`write:confluence-content`) is added; tokens + `client_secret` stay
main-only. A connection-gated "New page" affordance in the panel composes the empty form
deterministically (new `confluence:requestCreateForm` IPC → builder → push), no Claude.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload + React renderer + shared) |
| Key dependencies  | existing: `@a2ui-sdk/react/0.9`, the Atlassian OAuth/refresh/cloudId foundation (`atlassianConfig.ts`, `atlassianOAuth.ts`), `safeStorage` token store, `UiBridge` (settle-on-push + `cancelActive`). No new npm dependency. |
| New REST endpoints| create: `POST {base}/wiki/api/v2/pages`; space lookup: `GET {base}/wiki/api/v2/spaces?keys={spaceKey}` (`base = https://api.atlassian.com/ex/confluence/{cloudId}`) |
| New OAuth scope   | `write:confluence-content` (one scope; reads + `offline_access` retained) |
| Files to create   | `src/main/confluenceActionDispatcher.ts`, `src/main/confluenceSurfaceBuilder.ts`, `src/renderer/confluenceCatalog/CreatePageForm.tsx` (or extend `confluenceCatalog/components.tsx` + `index.ts`), plus tests (`confluenceActionDispatcher.test.ts`, `confluenceSurfaceBuilder.test.ts`, `atlassianText` + `validate` test additions) |
| Files to modify   | `src/shared/confluence.ts`, `src/shared/validate.ts`, `src/shared/ipc.ts`, `src/main/integrations/atlassianText.ts`, `src/main/integrations/atlassianConfig.ts`, `src/main/integrations/confluenceClient.ts`, `src/main/confluenceManager.ts`, `src/main/confluenceBridge.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/ConfluencePanel.tsx`, `src/renderer/confluenceCatalog/index.ts` |

---

## Sequencing note (UI-bearing feature)

This feature adds a new renderer surface (`CreatePageForm`). Per the cosmos workflow, a
**design** step (the `designer` agent → `.sdd/designs/confluence-create-page-v1.md`) MUST
run **after this plan is approved and before the interface/test/implement phases**. The
designer owns the form's visual treatment (reusing the Jira `CreateIssueForm` layout +
shared Tailwind/shadcn tokens; cosmos palette only). The non-visual work (Phases A–D below)
is structurally independent of the design and may be specified now; the catalog component's
markup (Phase E) consumes the design spec.

## §A — Approach decisions (grounded in the codebase)

- **Deterministic, not model-mediated** (FR-004): clone `JiraActionDispatcher` →
  `ConfluenceActionDispatcher`. Constructed with only `{ manager subset, cancelActive,
  pushRender }` so it has no PTY/AgentRunner reach (channel independence by construction,
  FR-020). `handles(actionId)` = `isConfluenceBoundActionId`. `dispatch()` validates →
  executes create → `cancelActive()` → composes + pushes result surface (fresh requestId,
  `target: 'confluence'`).
- **One write implementation** (FR-001/008): `ConfluenceManager.createPage` is the single
  caller of `ConfluenceClient.createPage`. The deterministic dispatcher is the only caller
  of the manager's write (no write MCP tool, FR-010/019).
- **Scope gap discipline** (FR-008): add `getWriteCapability()` to `ConfluenceManager`
  (true iff stored `scopes` includes `write:confluence-content`) and a `writeNotAuthorized()`
  helper returning a `ConfluenceResult` with a new `write_not_authorized` error kind —
  mirroring `JiraManager`. `createPage` short-circuits before any client call when the
  scope is absent.
- **Body conversion** (FR-003): new pure `plainTextToStorage(text)` in `atlassianText.ts`
  emitting a storage-format XHTML string of one `<p>…</p>` per line (HTML-escaping the
  text), the inverse of `storageToPlainText`. Empty body → a single empty paragraph.
- **Result surface** (FR-007): `ConfluenceSurfaceBuilder` (pure, like `JiraSurfaceBuilder`)
  with `buildCreatePageSurface(opts)` (empty/seeded form, optional notice) and
  `buildCreatedPageSurface(pageDetail, { notice })` (success — re-read page detail + a
  success `Notice`). Re-uses the existing `confluenceCatalog` component type names
  (`PageDetail`, `Notice`, `Text`) plus the new `CreatePageForm`.
- **Open the form** (FR-012): a native, connection-gated "New page" button in
  `ConfluencePanel` calls a new `window.cosmos.confluence.requestCreateForm()` → main
  composes `buildCreatePageSurface()` and pushes it with `target: 'confluence'` (no Claude).
  Mirrors the panel's existing `requestDefaultView`-style native compose, deterministically.
- **Display-only settle vs. action path** (FR-018): no change needed — the create surface
  is `target: 'confluence'`, so `UiBridge` already settles it on push; the panel's
  `SurfaceBridge.handleAction` already forwards actions over `ui:action`. We add the
  main-side interception so `confluence.create` is dispatched instead of resolved. A test
  asserts the action reaches the dispatcher after a settled render (the Jira mechanism).

## §B — Shared contract (`src/shared/confluence.ts`)

Add (mirroring `src/shared/jira.ts`):

- `ConfluenceCreateParams` `{ spaceKey: string; title: string; body: string; parentId?: string }`
  — all non-secret (FR-016).
- `ConfluenceCreateResult` `{ id: string; title: string }` (the created page id for the
  re-read; FR-009).
- Extend `ConfluenceErrorKind` with `'write_not_authorized'`.
- `CONFLUENCE_WRITE_SCOPE = 'write:confluence-content'` and
  `CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE` (centralized copy, mirroring the Jira consts).
- `ConfluenceBoundAction = { Create: 'confluence.create' } as const`,
  `CONFLUENCE_BOUND_ACTION_PREFIX = 'confluence.'`, `isConfluenceBoundActionId()`, and
  `ConfluenceBoundActionRequest = { name: typeof ConfluenceBoundAction.Create; params: ConfluenceCreateParams }`.
- Extend `ConfluenceOp` with `CreatePage: 'createPage'` (bridge op routing, FR-010).

## §C — REST + scope (resolves the spec's open questions)

- **Create endpoint** (FR-009): `POST {base}/wiki/api/v2/pages` with JSON body
  `{ spaceId, status: 'current', title, body: { representation: 'storage', value: <storage> }, parentId? }`.
  Chosen over the legacy v1 `POST /wiki/rest/api/content` for forward consistency with the
  existing v2 page read (`GET /wiki/api/v2/pages/{id}`).
- **spaceKey → spaceId** (FR-009a): the v2 create needs the numeric `spaceId`, but the user
  supplies a space **key**. Resolve via `GET {base}/wiki/api/v2/spaces?keys={spaceKey}` and
  read `results[0].id`. An empty result / 403 / 404 → recoverable error notice (no crash).
  This is a private helper inside `ConfluenceClient.createPage` (one extra GET); it reuses
  the client's existing `call()` + `mapConfluenceError`.
- **Write scope** (FR-013): add `write:confluence-content` to `CONFLUENCE_OAUTH_SCOPES`.
  Granular fallback (if the registered app is on granular scopes): `write:page:confluence`
  — a one-line edit, documented inline exactly as the read scopes already note. The shared
  Atlassian OAuth/refresh/cloudId machinery is unchanged (confidential-client `client_secret`
  fallback already in place; tokens/secret stay main-only).
- **Operational requirement** (FR-014): `write:confluence-content` must be registered in
  the Atlassian developer console, and an existing Confluence connection must be
  **disconnected + reconnected to re-consent** (a read-only-era token lacks the scope and
  short-circuits to `write_not_authorized`). Documented in the spec; noted for the wrap-up.

## Architecture doc sections to update (note — do NOT write yet)

The following `docs/ARCHITECTURE.md` sections will need updating once this is built (the
architect updates them at wrap-up, not now):

- **§3 / §4.3** — the "settle-on-push is safe for read-only `confluence` because surfaces
  have no controls" statement becomes: Confluence now has exactly ONE control
  (`CreatePageForm`) whose `confluence.create` action is dispatched deterministically by
  main (`ConfluenceActionDispatcher`), never returned to the agent's render call — mirroring
  the Jira rationale.
- **§4.9** — Confluence is no longer "stays read-only": it gains a single deterministic
  write (create page) with its own `ConfluenceActionDispatcher` + `ConfluenceSurfaceBuilder`,
  the `confluence.create` bound action, `ConfluenceManager.createPage` /
  `ConfluenceClient.createPage`, the `POST /wiki/api/v2/pages` write endpoint, and the
  `write:confluence-content` scope. The "Confluence stays read-only (no write scope/tool/
  dispatcher)" and "Deferred: Confluence writes" lines must be revised (writes beyond create
  — update/delete/labels — remain deferred). Confluence MCP tools remain read-only.
- **§4.7** — the "Jira bridge now carries write ops too; Confluence and Slack remain
  read-only" line: Confluence now carries one write **op** (`createPage`) on its bridge,
  but NO write **MCP tool** (deterministic-action-only).
- **§5b** — generalize "Deterministic Jira Bound Action" to note the same mechanism now
  backs `confluence.create` (or add a parallel §5c).
- **§7** — add a completed next-step entry for `confluence-create-page-v1`.

---

## Implementation Checklist

### Phase A — Shared contract & pure helpers (no Electron)

- [ ] Read spec; confirm the two open questions are resolved here in §C (scope string +
  v2 endpoint / spaceId lookup) — no remaining blockers.
- [ ] `src/shared/confluence.ts`: add `ConfluenceCreateParams`, `ConfluenceCreateResult`,
  `write_not_authorized` error kind, `CONFLUENCE_WRITE_SCOPE`,
  `CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE`, `ConfluenceBoundAction` +
  `isConfluenceBoundActionId` + `ConfluenceBoundActionRequest`, and `ConfluenceOp.CreatePage`.
- [ ] `src/main/integrations/atlassianText.ts`: add pure `plainTextToStorage(text)` (inverse
  of `storageToPlainText`; HTML-escape; one `<p>` per line; never throws).
- [ ] `src/main/integrations/atlassianConfig.ts`: add `write:confluence-content` to
  `CONFLUENCE_OAUTH_SCOPES` (document the granular `write:page:confluence` fallback inline).
- [ ] `src/shared/validate.ts`: add `validateConfluenceCreate` (required `spaceKey`,
  `title`, `body` non-empty/non-whitespace; optional `parentId` string) and
  `validateConfluenceBoundAction` (namespace → params), mirroring the Jira validators.
- [ ] `src/shared/ipc.ts`: add the `confluence:requestCreateForm` channel name (renderer→main,
  no payload) to the Confluence channel set.
- [ ] Review all new types against the spec — no invented properties; every field
  non-secret (FR-016).

### Phase B — Main write path (client + manager + bridge)

- [ ] `src/main/integrations/confluenceClient.ts`: add `createPage(auth, params)` —
  resolve `spaceKey`→`spaceId` (GET spaces), `POST /wiki/api/v2/pages` with the storage
  body + optional `parentId`; map failures via `mapConfluenceError`; return `{ id, title }`.
- [ ] `src/main/confluenceManager.ts`: add `getWriteCapability()`, `writeNotAuthorized()`,
  and `createPage(params)` (scope short-circuit → `run()` → client.createPage).
- [ ] `src/main/confluenceBridge.ts`: extend `ConfluenceBridgeManager` with `createPage`
  and add a `ConfluenceOp.CreatePage` branch in `handleCall` (validate params → manager).
  (Bridge op only; no MCP tool — FR-010/019.)

### Phase C — Deterministic dispatch + surface builder (main)

- [ ] `src/main/confluenceSurfaceBuilder.ts` (new, pure): `buildCreatePageSurface(opts?)`
  (empty/seeded form + optional notice) and `buildCreatedPageSurface(detail, { notice })`
  (success: PageDetail + success Notice), plus `ConfluenceSurfaceNotice`
  (`success | error | write_not_authorized`).
- [ ] `src/main/confluenceActionDispatcher.ts` (new): clone `JiraActionDispatcher` —
  `handles` = `isConfluenceBoundActionId`; `dispatch` validates via
  `validateConfluenceBoundAction`, executes `manager.createPage`, `cancelActive()`,
  re-reads the created page (`manager.getPage`) best-effort, composes + pushes the result
  surface (fresh requestId, `target: 'confluence'`); never throws; no PTY/AgentRunner reach.
- [ ] `src/main/index.ts`: instantiate `ConfluenceActionDispatcher` (manager + `cancelActive`
  = `uiBridge.cancelActive` + `pushRender` = `pushRenderToRenderer`); intercept
  `confluence.*` submit actions at the `ui:action` boundary (mirror the `jira.*` branch);
  add a `confluence:requestCreateForm` handler that pushes `buildCreatePageSurface()`; null
  the dispatcher on teardown.

### Phase D — Preload + panel wiring (renderer plumbing)

- [ ] `src/preload/index.ts`: expose `window.cosmos.confluence.requestCreateForm()`.
- [ ] `src/renderer/ConfluencePanel.tsx`: add a connection-gated "New page" affordance that
  calls `requestCreateForm()`; confirm `SurfaceBridge.handleAction` forwards `confluence.create`
  over `ui:action` (already present — un-gate / keep it).

### Phase E — Catalog form component (consumes the design spec)

- [ ] `src/renderer/confluenceCatalog/` + `index.ts`: add `CreatePageForm` (space/title/body
  inputs + optional parent id), each via `useFormBinding`, submit emits `confluence.create`
  via `useDispatchAction`; surface-side guards mirror `validateConfluenceCreate` (required
  non-empty; parent optional). Register the new type in the Confluence catalog.
- [ ] Apply the `.sdd/designs/confluence-create-page-v1.md` visual treatment (reuse the
  Jira `CreateIssueForm` layout + shared tokens; cosmos palette only).

### Phase F — Tests

- [ ] `plainTextToStorage`: happy path, empty body, multi-line, HTML-escaping, never-throws.
- [ ] `validateConfluenceCreate` / `validateConfluenceBoundAction`: happy path, missing
  required (space/title/body), whitespace-only, optional parent present/absent, unknown
  action name, non-object — all warn + ignore.
- [ ] `ConfluenceManager.createPage`: scope-gap short-circuit (no client call), happy path
  through `run()`, refresh-then-retry, `reconnect_needed`/`not_connected`.
- [ ] `ConfluenceClient.createPage`: success (id/title returned), spaceKey→spaceId resolve
  failure, REST 400/403/404/429/network mapping.
- [ ] `ConfluenceActionDispatcher`: happy path (create → cancelActive → re-push fresh
  requestId/`target:'confluence'` success surface), with-parent, scope-gap notice, REST
  failure notice, re-read-failure best-effort fallback, invalid action warn+ignore, never
  disturbs PTY/AgentRunner (no such deps), settled-render-then-action path.
- [ ] `ConfluenceSurfaceBuilder`: empty form, seeded form + notice, created-page success
  surface, notice-only fallback.

### Phase G — Docs

- [ ] Update `docs/ARCHITECTURE.md` per the "sections to update" list above (architect, at
  wrap-up).
- [ ] Mark the item in `TODO.md`; add an `.sdd` next-step entry (§7).
- [ ] Update this plan with any deviations.

---

## Deviations & Notes

> Record anything that differs from the plan during implementation. Date each entry.

- **2026-06-06**: Initial plan authored.
