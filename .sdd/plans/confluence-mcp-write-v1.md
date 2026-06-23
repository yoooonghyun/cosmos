# Plan: Confluence MCP Write (Update Page) — v1

**Status**: Draft
**Created**: 2026-06-23
**Last updated**: 2026-06-23
**Spec**: `.sdd/specs/confluence-mcp-write-v1.md`

---

## Grounding

See the spec's Grounding section for the full tool-by-tool log. Key facts this plan builds on:

- **Create already ships** as the `confluence_create_page` MCP tool (model-mediated relay →
  bridge `CreatePage` op → `ConfluenceManager.createPage` → `ConfluenceClient.createPage` →
  `POST /wiki/api/v2/pages`). Update is a strict mirror of this path.
- The write scope `write:page:confluence` is **already** in `CONFLUENCE_OAUTH_SCOPES` — no
  scope change, no re-consent for write-capable users (`atlassianConfig.ts`).
- `confluenceMcpServer` is **already** a rollup `input` in `electron.vite.config.ts` — the
  add-a-server gotcha does NOT apply; we register one more tool on the existing server.
- Reusable in place, unchanged: `plainTextToStorage` (`atlassianText.ts`), `mapConfluenceError`
  + the POST-capable `call()` (`confluenceClient.ts`), `getWriteCapability()` + `run()` +
  `writeNotAuthorized()` (`confluenceManager.ts`), `CONFLUENCE_WRITE_SCOPE` +
  `CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE` (`confluence.ts`), `validateConfluenceBridgeCall`
  + the `invalidParams` path (`confluenceBridge.ts`).

## Summary

Add a single model-mediated MCP write tool, `confluence_update_page`, to the existing
Confluence MCP server, exactly mirroring the shipped `confluence_create_page` end-to-end
path (shared contract in `src/shared/confluence.ts` → bridge op routing →
`ConfluenceManager` scope-gated method → `ConfluenceClient` v2 REST call). The update issues
`PUT /wiki/api/v2/pages/{id}` and, because v2 update is optimistic-locked and replaces
content wholesale, the client first reads the page (reusing the existing read plumbing) to
obtain the current `version.number` (and the current storage body when no new body is
supplied), then submits `version.number + 1`. No new OAuth scope, no new MCP server, no new
rollup input, no preload change. Pure helpers (validator, version/body resolution) are
unit-testable without Electron or the network.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (Electron main + plain-Node MCP entry; Vitest tests) |
| Key dependencies  | Existing only — `@modelcontextprotocol/sdk`, `zod`, the in-tree Confluence client/manager/bridge/shared modules. No new deps. |
| Files to create   | none required (all changes land in existing files); test files as below |
| Files to modify   | `src/shared/confluence.ts`, `src/shared/ipc/confluence.validate.ts`, `src/main/confluenceBridge.ts`, `src/main/confluenceManager.ts`, `src/main/integrations/confluenceClient.ts`, `src/mcp/confluenceMcpServer.ts`; plus `docs/ARCHITECTURE.md` / `docs/PROJECT-STRUCTURE.md` touch-ups |
| NOT touched       | `electron.vite.config.ts` (no new input), `src/preload/**` (no new bridge method), `src/main/integrations/atlassianConfig.ts` (no scope change), the read tools |

### §C — Pinned technical resolutions (resolve the spec's open questions in code)

- **C1 — current-version + body read (FR-009a).** The v2 update needs the current
  `version.number`. The existing `getPage` requests `?body-format=view` (server-rendered
  HTML), which is NOT a valid storage body to re-submit. So the update path MUST read with
  **`GET /wiki/api/v2/pages/{id}?body-format=storage&version=true`** (or read the page and
  request the storage representation) to get BOTH the current `version.number` AND the
  current `body.storage.value` for the title-only / no-body case. Implement this as a small
  private `readForUpdate(auth, pageId)` in `ConfluenceClient` returning
  `{ versionNumber, storageBody }` — do NOT reuse the public `getPage` (its `view` body is
  unusable for re-submission and its DTO drops the version). Confirm the v2 storage body path
  (`body.storage.value`) at implementation against a real response.
- **C2 — version conflict (FR-009b).** Add a `version_conflict` member to
  `ConfluenceErrorKind` (mirrors how `write_not_authorized` was added) with a clear
  "the page changed since it was read — re-read it and try the update again" message. Map the
  Confluence response to it in `ConfluenceClient.updatePage` (inspect for HTTP 409, and 400
  whose body indicates a version mismatch). If the real response shape makes a clean
  discriminator impossible, fall back to mapping it to `network` with the same message — the
  behavior (recoverable, non-crash) is identical; only the discriminator differs.
- **C3 — empty-body semantics.** Treat a present-but-empty/whitespace `body` as **absent**
  (preserve the existing body). `validateConfluenceUpdate` therefore accepts an optional
  `body` string but the manager/client treats `body.trim() === ''` as "no new body". This
  prevents an accidental content wipe; an intentional wipe is out of scope.
- **C4 — read-then-write race.** The read-current-version then PUT window is inherently
  racy; C2's conflict handling is the mitigation (Confluence rejects the stale version). No
  locking is attempted (out of scope) — the agent re-reads and retries on conflict.

---

## Implementation Checklist

> Sequential — each phase compiles/tests before the next. Update as work progresses.

### Phase 0 — Confirm scope before building

- [ ] Re-read the spec's first Open Question with the user resolved: confirm "update existing
      page" is the intended write (create already exists). If the user wanted only create, or
      also append/comment/delete, STOP and revise the spec before coding.

### Phase 1 — Shared contract (`src/shared/confluence.ts`)

- [ ] Add `UpdatePage: 'confluence_update_page'` to the `ConfluenceTool` const.
- [ ] Add `UpdatePage: 'updatePage'` to the `ConfluenceOp` const.
- [ ] Add `ConfluenceUpdateParams` (`pageId: string; title: string; body?: string; versionMessage?: string`)
      and `ConfluenceUpdateResult` (`id: string; title: string; version: number`), mirroring the
      `ConfluenceCreate*` types, with doc comments noting all fields are non-secret.
- [ ] Add `'version_conflict'` to `ConfluenceErrorKind` (per §C2) + a doc line in the union.
- [ ] Add a `CONFLUENCE_VERSION_CONFLICT_MESSAGE` const ("the page changed since it was
      read — re-read it and try again").
- [ ] Review types vs spec — no invented fields; `versionMessage` traces to FR-002, `version`
      result to FR-009.

### Phase 2 — Boundary validator (`src/shared/ipc/confluence.validate.ts`)

- [ ] Add pure `validateConfluenceUpdate(raw, warn)` → `ConfluenceUpdateParams | null`,
      mirroring `validateConfluenceCreate`: required `pageId` non-empty string; required `title`
      non-empty non-whitespace string; optional `body` a string when present; optional
      `versionMessage` a string when present. Warn + return null on any violation. (The body
      "preserve if empty" semantics from §C3 live in the manager/client, NOT here — the
      validator only type-checks.)
- [ ] Confirm it is exported through the `src/shared/validate.ts` barrel automatically (the
      file is already re-exported; no barrel edit needed) — verify.

### Phase 3 — Client REST (`src/main/integrations/confluenceClient.ts`)

- [ ] Add a private `readForUpdate(auth, pageId)` issuing
      `GET {base}/wiki/api/v2/pages/{id}?body-format=storage&version=true`, returning
      `{ versionNumber: number; storageBody: string }` (per §C1); map failures via the existing
      error path. Do NOT alter the public `getPage`.
- [ ] Add `updatePage(auth, params: ConfluenceUpdateParams): Promise<ConfluenceResult<ConfluenceUpdateResult>>`:
      call `readForUpdate`; compute the new body (`plainTextToStorage(params.body)` when a
      non-empty body is supplied, else the read `storageBody`); `PUT {base}/wiki/api/v2/pages/{id}`
      with `{ id, status: 'current', title, body: { representation: 'storage', value }, version: { number: versionNumber + 1, ...(message?) } }`.
- [ ] Map a version conflict to `version_conflict` per §C2 (HTTP 409 / 400-version), else use
      `mapConfluenceError`. Return `{ id, title, version: versionNumber + 1 }` on success
      (read the returned `version.number`/`title` where present, fall back to the computed
      values).
- [ ] Reuse the existing POST/`call()` plumbing for the PUT (`call()` already passes through
      `method`/`body`; confirm it threads `PUT`).

### Phase 4 — Manager (`src/main/confluenceManager.ts`)

- [ ] Add `updatePage(params: ConfluenceUpdateParams): Promise<ConfluenceResult<ConfluenceUpdateResult>>`
      mirroring `createPage`: short-circuit to `writeNotAuthorized()` when
      `!getWriteCapability()`; otherwise route through `run((auth) => client.updatePage(auth, params))`.
- [ ] No new scope/capability logic — `getWriteCapability()` already gates on
      `write:page:confluence`, which update needs (FR-010).

### Phase 5 — Bridge routing (`src/main/confluenceBridge.ts`)

- [ ] Add `updatePage` to the `ConfluenceBridgeManager` interface (params + result typed via
      the shared types).
- [ ] Add a `case ConfluenceOp.UpdatePage:` to `handleCall` that runs `validateConfluenceUpdate`
      and forwards to `manager.updatePage`, returning `invalidParams` on a null validation —
      mirroring the `CreatePage` case exactly.
- [ ] Import `validateConfluenceUpdate` alongside the existing validators.

### Phase 6 — MCP tool registration (`src/mcp/confluenceMcpServer.ts`)

- [ ] Register `ConfluenceTool.UpdatePage` with a zod `inputSchema`
      `{ pageId: z.string(), title: z.string(), body: z.string().optional(), versionMessage: z.string().optional() }`
      and the explicit MUTATES description per FR-015 (page id, title, optional body —
      omitting body preserves current; failure states incl. version conflict / not found /
      write not authorized — reconnect).
- [ ] The handler relays `bridge.call(ConfluenceOp.UpdatePage, { pageId, title, ...(body?) , ...(versionMessage?) })`
      and wraps with the existing `toToolResult`, mirroring the `CreatePage` registration.
- [ ] Confirm NO change to `electron.vite.config.ts` (existing `confluenceMcpServer` input
      already bundles the new tool — verify the build emits it).

### Phase 7 — Tests (Vitest, `.test.ts` co-located, no Electron/network)

- [ ] `validateConfluenceUpdate`: happy path; missing/empty `pageId`; missing/empty/whitespace
      `title`; non-string `body`/`versionMessage`; extra/unknown fields ignored.
- [ ] `ConfluenceClient.updatePage` with an injected `fetchImpl`: body+title replace
      (asserts the PUT body carries `version.number = current+1`, storage body, title);
      title-only preserves the read storage body; version conflict maps to `version_conflict`;
      403/404/429/network map via `mapConfluenceError`; unknown page read fails recoverably.
- [ ] `ConfluenceManager.updatePage`: scope-gap short-circuits to `write_not_authorized`
      WITHOUT calling the client; happy path routes through `run()`; expired-then-refresh
      proceeds; failed-refresh → `reconnect_needed`.
- [ ] `ConfluenceBridge.handleCall(UpdatePage, …)`: valid params forward to the manager;
      invalid params return the structured `invalidParams` (no throw).
- [ ] Security assertion: no test fixture/result/log carries a token or `client_secret`; the
      tool result + bridge frame carry only non-secret fields.

### Phase 8 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: the Confluence MCP now exposes **two** writes
      (create + update); correct any lingering "Confluence is read-only" wording; note update
      reuses `write:page:confluence` (no scope change) and the optimistic-locking read-then-PUT.
- [ ] Update `docs/PROJECT-STRUCTURE.md` per-file notes for the touched files (new tool/op,
      `updatePage` methods).
- [ ] `memory_save` the decision: Confluence MCP write set = create + update; update is
      optimistic-locked (read current version → PUT current+1); `version_conflict` error kind;
      no new scope. Reconcile `TODO.md` if it tracked Confluence write.
- [ ] Update this plan's Deviations with anything that differed (esp. the §C confirmations
      against real v2 responses).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-23**: Plan authored. Pre-build correction recorded: the originating request
  assumed Confluence MCP is read-only, but `confluence_create_page` already ships as a write
  tool — this plan adds the missing **update** write, not create. The build is gated on the
  user confirming "update existing page" is the intended capability (Phase 0).
- **2026-06-23 (implementation)**: User confirmed TWO tools — `confluence_update_page` AND a
  page-comment tool. Built `confluence_create_comment` alongside update; spec extended in-place
  with the comment FRs (§Comment, FR-016..FR-021, SC-009/SC-010).
  - **Comment endpoint confirmed** via the Atlassian OpenAPI v2 spec (`openapi-v2.v3.json`):
    `POST /wiki/api/v2/footer-comments`, body `{ pageId, body: { representation:'storage', value } }`,
    required scope `write:comment:confluence` (`oAuthDefinitions`).
  - **NEW OAuth scope added** — `write:comment:confluence` appended to `CONFLUENCE_OAUTH_SCOPES`
    (`atlassianConfig.ts`). **This is a CONSENT change: existing users must disconnect + reconnect
    once to grant it.** Page create/update need NO scope change (`write:page:confluence` already
    granted). Comment is gated on a SEPARATE `getCommentCapability()` so a page-write-only token
    cannot comment.
  - **§C1 confirmed**: the update read uses `GET …?body-format=storage&version=true`, version from
    `body.version.number`, storage body from `body.body.storage.value`.
  - **§C2 implemented**: added `version_conflict` `ConfluenceErrorKind`. `updatePage` uses a
    dedicated private `callWrite` (surfaces raw HTTP status) so it can map 409 (and 400 whose body
    mentions version+conflict/match) to `version_conflict` before falling back to `mapConfluenceError`.
  - **§C3 implemented**: empty/whitespace `body` treated as absent (existing storage body re-sent).
  - **Renderer type touch (necessary, additive)**: adding `version_conflict` to the shared
    `ConfluenceErrorKind` broke `AtlassianError` in `src/renderer/atlassianPanelBits.tsx` (it
    re-enumerates the kinds for the read `ErrorState`). Widened that union by one member
    (type-only, no logic) so a `ConfluenceError` keeps assigning cleanly; reads never produce
    `version_conflict`, so behavior is unchanged.
  - **Tests**: full suite green — `npm run typecheck` exit 0; `npx vitest run` = 2182 passed, 0 failed.
  - **NOT touched**: `electron.vite.config.ts` (no new input), `src/preload/**` (no new bridge
    method), no new IPC channel (the writes flow over the existing Confluence socket bridge).
