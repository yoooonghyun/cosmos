# Plan: Confluence Page Dock — View + Add Comments — v1

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: `.sdd/specs/confluence-dock-comments-v1.md`

---

## Grounding

> Direct investigation run for THIS plan (mandatory handoff). Exact tool queries + one-line takeaways.

**codegraph_explore (code structure):**

- `ConfluenceClient createComment call POST mapConfluenceError plainTextToStorage pageViewBody confluence IPC handler validateConfluenceGetPage` → `ConfluenceClient.createComment` already does `POST /wiki/api/v2/footer-comments` with `plainTextToStorage` body + `mapConfluenceError`; `getPage` does `GET /wiki/api/v2/pages/{id}?body-format=view` via the shared `call()`. The validator file `src/shared/ipc/confluence.validate.ts` holds `validateConfluenceGetPage` (the exact pattern a new comment-read validator mirrors).
- `confluence ipcMain handle getPage searchContent registerConfluenceIpcHandlers index.ts preload` → `registerConfluenceIpcHandlers()` (`src/main/index.ts:1801`) wires each channel as `ipcMain.handle(name, (_e, raw) => { const p = validate(raw); if (!p || !confluenceManager) return badParams; return confluenceManager.X(p) })`. `ConfluenceManager.createComment` already gates on `getCommentCapability()`; `getWriteCapability`/`getCommentCapability` read scopes off the stored token. `run()` owns token/refresh/`reconnect_needed`.
- `Jira comments dock CommentList CommentRow AddCommentControl` (prior session) → `jiraCatalog` `CommentRow`/`CommentList`/`AddCommentControl` are the UI precedent (avatar+name+ts+body row; Textarea + disabled-until-non-empty submit + in-flight lock). The Confluence dock builds the analogous native renderer components (NOT A2UI — the dock body is native, reached by IPC).
- Slack `getReplies` (`SlackManager`/`SlackClient`) → the precedent for a paginated nested-children read; reply pagination is cursor-based per parent. Informs reply-tree shaping (children fetched per top-level comment, bounded — see §C).

**memory_recall:** prior `memory_save` (mem_mqvsonsf…) captured the comment-read scope gap + the MCP-vs-renderer-IPC split + reply-tree decision; reused here.

**ARCHITECTURE.md §4.9** read (lines 471–652): documents the Confluence panel, the renderer-local `getPage` dock, the Confluence MCP write tools, and the granular scope list. §4.9 needs a comments-read-scope + dock-comments-section update (see Phase 4).

---

## Summary

Add a **comments section + compose box** to the Confluence page dock (the renderer-local `genUiPage` overlay over `ConfluencePanel`, dock body = native `PageDetail`). Two NEW renderer IPC methods on `window.cosmos.confluence`: **`getComments`** (a new main-side read fetching footer comments **with their nested reply tree**) and **`addComment`** (a new IPC write that **reuses the existing `ConfluenceManager.createComment`** — no second write impl). Reading footer comments needs the granular OAuth scope **`read:comment:confluence`** (added to `CONFLUENCE_OAUTH_SCOPES` — a one-time disconnect→reconnect); adding needs the already-granted `write:comment:confluence`; the two capabilities are gated independently. All failure/not-authorized states degrade gracefully inside the dock (loading / empty / error / reconnect affordance) — never crash, never leak a token. UI-bearing → the **Design step (2.5, `designer`) runs before implementation** for the comments section, compose affordance, reply-tree layout, and the not-authorized/loading/empty/error states.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main + React renderer) |
| Key dependencies | existing: `ConfluenceClient.call`/`mapConfluenceError`/`plainTextToStorage`/`pageViewBody`; `ConfluenceManager.run`/`getCommentCapability`/`createComment`; `registerConfluenceIpcHandlers`; DOMPurify renderer sanitize gate; native `PageDetail` dock; Confluence v2 `/wiki/api/v2/pages/{id}/footer-comments` + `/footer-comments/{id}/children` |
| Files to create | `src/renderer/confluenceCatalog/CommentsSection.tsx` (native dock comments list + reply tree + compose); a comment-read validator (may live in `src/shared/ipc/confluence.validate.ts`); tests below |
| Files to modify | `src/shared/confluence.ts`, `src/shared/ipc/confluence.ts`, `src/shared/ipc/confluence.validate.ts`, `src/main/integrations/confluenceClient.ts`, `src/main/confluenceManager.ts`, `src/main/integrations/atlassianConfig.ts`, `src/main/index.ts`, `src/preload/index.ts`, the Confluence dock host in `src/renderer/ConfluencePanel.tsx` (or the dock body component), `docs/ARCHITECTURE.md` |

---

## §C — Resolved technical decisions (from spec Open Questions)

- **OQ-1 Reply tree (v1 = INCLUDED, per user).** `getComments` returns top-level footer comments **each with a nested `replies` array**. Read shape:
  1. `GET {base}/wiki/api/v2/pages/{pageId}/footer-comments?body-format=view&limit=N` → top-level comments (id, author, created/version ts, body, `_links`).
  2. For each top-level comment, `GET {base}/wiki/api/v2/footer-comments/{commentId}/children?body-format=view&limit=M` → its direct replies (one level deep for v1; the v2 model is parent→children, replies-of-replies exist but v1 shapes **one nesting level** — a flat reply list under each top-level comment, matching how Confluence renders most footer threads). Children reads are **bounded and best-effort**: a failed/absent children read yields an empty `replies` array, never fails the whole comments read.
  3. **Author display name**: footer-comment v2 returns an author **account id**, not a name. Resolve to a display name via the same per-token name-resolver idiom Slack uses (`resolveUserName`, memoized), OR surface the raw id when resolution is unavailable (degrade-never-throw). Pin the exact resolver wiring at implement time; the DTO field is `author: { displayName?, accountId? }`.
  4. **Pagination**: v1 caps top-level comments + replies at a sane limit (no "load more comments" control in v1 — out of scope; note as a follow-up). The read returns whatever the first page yields; `nextCursor` MAY be carried on the DTO for a future load-more but is **not consumed** by the v1 UI.
- **OQ-2 Post-add refresh = RE-FETCH.** After a successful `addComment`, the dock **re-calls `getComments`** for the open page and re-renders (no optimistic insert in v1 — simplest, always-consistent). A re-fetch failure leaves the prior list + a recoverable notice; the just-typed text is already cleared on the confirmed success.
- **OQ-3 Comment body rendering = reuse the page-body sanitize path.** Footer comments are `view` HTML; render the comment body through the **same DOMPurify renderer sanitize gate** the page detail uses (so emoji/links/`\uXXXX` decode behave identically), inside the dock. The IPC contract carries the raw `view` HTML string (sanitized at the renderer display site, exactly like `ConfluencePageDetail.body`).
- **OQ-4 Re-auth UX = inline reconnect affordance.** The comment-read-not-authorized state renders an inline affordance in the comments section that triggers the EXISTING `window.cosmos.confluence.connect()` (reuse — no parallel connect path), consistent with `SettingsDialog` `ConnectionBlock`. Final placement/copy owned by the `designer`.
- **New result `kind` for comment-read scope gap.** Reads do not have a `write_not_authorized` analog. Add a **`comment_read_not_authorized`** discriminant to the comment-read result path (gated by a new `getCommentReadCapability()` reading `read:comment:confluence`) so the renderer can branch to the reconnect affordance distinctly from `reconnect_needed`/`network`. (Mirrors how `write_not_authorized` was introduced; one-line union extension — confirm exact placement at implement time to avoid widening the shared `ConfluenceErrorKind` more than needed.)

---

## Implementation Checklist

> interface → tests → implement, then docs. Update as work progresses.

### Phase 0 — Design (2.5, runs BEFORE Phase 1)

- [ ] `designer` authors `.sdd/designs/confluence-dock-comments-v1.md`: the comments section inside the dock (placement beneath `PageDetail`), the **reply-tree layout** (top-level comment + indented replies), the compose affordance (Textarea + submit, disabled/in-flight), and the **loading / empty / error / comment-read-not-authorized (reconnect) / comment-write-not-authorized** states. Reuse theme tokens + `src/renderer/components/ui/` (Textarea, Button, Avatar, Alert). No Bash/build wiring (that's the developer/main session).

### Phase 1 — Interface (typed contract, no behavior)

- [x] `src/shared/confluence.ts`: add `ConfluenceComment` DTO (`id`, `author: { displayName?; accountId? }`, `created?` ts, `body` raw `view` HTML, `replies: ConfluenceComment[]`); add `ConfluenceGetCommentsParams` (`pageId`, optional `cursor`); add `ConfluenceGetCommentsResult` (e.g. `{ comments: ConfluenceComment[]; nextCursor? }`). Add the comment-read scope const **`CONFLUENCE_COMMENT_READ_SCOPE = 'read:comment:confluence'`** + a `CONFLUENCE_COMMENT_READ_NOT_AUTHORIZED_MESSAGE`. (No secret fields — FR-011.)
- [x] `src/shared/ipc/confluence.ts`: add channels `GetComments: 'confluence:getComments'` and `AddComment: 'confluence:addComment'`; extend `ConfluenceApi` with `getComments(params): Promise<ConfluenceResult<ConfluenceGetCommentsResult>>` and `addComment(params: ConfluenceCommentParams): Promise<ConfluenceResult<ConfluenceCommentResult>>`.
- [x] `src/shared/ipc/confluence.validate.ts`: add `validateConfluenceGetComments` (required `pageId` non-empty string; optional `cursor` string) and `validateConfluenceAddComment` (required `pageId` non-empty; required `body` non-empty/non-whitespace string) — mirror `validateConfluenceGetPage`/`validateConfluenceComment`; warn + ignore → null on invalid.
- [x] `src/preload/index.ts`: expose `getComments`/`addComment` on `window.cosmos.confluence` via `ipcRenderer.invoke`. **Note: preload edit ⇒ full `npm run dev` restart (HMR insufficient) — flag in dev notes.**
- [x] Review types vs spec — no invented properties (only `pageId`/`cursor`/author/body/ts/replies; no secrets).

### Phase 2 — Tests (write before implement)

- [x] `confluence.validate.test.ts`: `validateConfluenceGetComments` + `validateConfluenceAddComment` — happy path, missing/empty `pageId`, empty/whitespace `body`, non-object payload, optional `cursor` present/absent (never throws).
- [x] `confluenceClient` test: `getComments` — happy path shapes top-level + nested `replies`; a failed children read yields empty `replies` (best-effort), not a whole-read failure; 403/404/429/network map via `mapConfluenceError`; author id→name fallback to raw id when unresolved; token never in result.
- [x] `confluenceManager.test.ts` (existing file): `getComments` short-circuits to `comment_read_not_authorized` when `read:comment:confluence` absent (no client call); routes through `run()` when present; `addComment` reuses `createComment` (short-circuits to `write_not_authorized` when `write:comment:confluence` absent). Independent gating: read-scope present + write-scope absent (and vice versa).
- [ ] (DEFERRED) renderer interaction test for `CommentsSection` — node-env vitest cannot import the `.tsx` (jsdom/render harness not set up in this split); state logic is exercised via the manager/client + validator tests instead. Manual UI verification noted (preload restart required).

### Phase 3 — Implementation

- [x] `src/main/integrations/atlassianConfig.ts`: add `'read:comment:confluence'` to `CONFLUENCE_OAUTH_SCOPES` + update the scope-set doc comment (one-time reconnect note).
- [x] `src/main/integrations/confluenceClient.ts`: add `getComments(auth, params)` — top-level footer-comments GET + bounded per-comment children GET, shaping `ConfluenceComment[]` with `replies`; reuse `call`/`mapConfluenceError`; author-name resolution (memoized) or raw-id fallback; never throws/leaks token.
- [x] `src/main/confluenceManager.ts`: add `getCommentReadCapability()` (reads `CONFLUENCE_COMMENT_READ_SCOPE`); add `getComments(params)` that short-circuits to `comment_read_not_authorized` when absent else `run()`; add `addComment(params)` delegating to the existing `createComment` (keeps the single write impl). Add the `commentReadNotAuthorized()` structured result.
- [x] `src/main/index.ts` `registerConfluenceIpcHandlers()`: wire `GetComments` + `AddComment` handlers (validate → `badParams` on invalid/no-manager → manager call), mirroring `GetPage`.
- [x] Renderer: build `CommentsSection` (native, dock body) — comments list + reply tree, compose box (Textarea + submit, disabled/in-flight), states (loading/empty/error/reconnect/write-not-authorized); body via the existing DOMPurify gate; load on dock open + reload on retarget; **discard stale in-flight results** when the open `pageId` changes (FR-009); post-add re-fetch (OQ-2). Mount it under `PageDetail` in the `genUiPage` dock (`ConfluencePanel.tsx`).
- [x] All tests pass (2459/2459); `npm run typecheck` (node + web) clean; reused shared utilities — `addComment` delegates to the single `createComment` (no duplicated comment-write logic).

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md` §4.9: (a) note the dock now shows a **comments section (view + add) via renderer IPC `getComments`/`addComment`**, where `addComment` reuses `ConfluenceManager.createComment`; (b) add **`read:comment:confluence`** to the documented Confluence granular scope set (the scope paragraph ~lines 643–652) with the one-time-reconnect note; (c) note comment bodies reuse the page-body DOMPurify sanitize gate; (d) opportunistically correct the now-stale "single `confluence_create_page` write tool" phrasing where it conflicts (update + comment tools already ship) IF it sits in an edited paragraph — otherwise leave broader §4.9 reconciliation to `wrap-up`.
- [ ] Update `TODO.md` (mark dock-comments done) via `wrap-up`; record deviations below.

---

## Deviations & Notes

- **2026-06-27**: Created. Reply tree INCLUDED in v1 per user decision (spec OQ-1 default overridden); comment-read scope `read:comment:confluence` approved (one-time reconnect). Comment ADD reuses existing `ConfluenceManager.createComment` (no second write impl). New `comment_read_not_authorized` result discriminant for the read scope gap; final union placement confirmed at implement time. Reply depth = one nesting level for v1 (flat replies under each top-level comment); deeper nesting + a comments "load more" deferred.
- **2026-06-27 (implement)**: Phases 1–3 done; tests + typecheck green (2459 pass). Deviations:
  - Widening `ConfluenceErrorKind` with `comment_read_not_authorized` REQUIRED mirroring it into the renderer `AtlassianError` union (`src/renderer/atlassianPanelBits.tsx`) — that interface explicitly mirrors `ConfluenceErrorKind`/`JiraErrorKind` so `ConfluenceError` assigns to `ErrorState`. `CommentsSection` branches the new kind to a calm inline reconnect BEFORE `ErrorState`, so `ErrorState` never renders it.
  - Author display name: footer-comment v2 returns only an account id; the client surfaces `author.accountId` (reads `version.authorId`/`authorId`) and leaves `displayName` absent — the renderer falls back (`displayName ?? accountId ?? 'Unknown'`). No per-comment user-resolve call added (avoids N+1; plan §C step 3 "raw-id fallback" option taken).
  - `getComments` validator rejects only an EMPTY pageId (not whitespace), matching the existing `validateConfluenceGetPage` (`isNonEmptyString`, not `.trim()`); the add-comment BODY does enforce non-whitespace (matches `validateConfluenceComment`).
  - `CommentsSection` owns the dock scroll layout: it renders the page header+body as `children` at the top of one `ScrollArea` (flex-1) with the composer pinned outside it (design §2 "latter" option) — the populated branch of the dock `PageDetail` now returns `<CommentsSection>` wrapping the existing header+body.
  - Phase 4 ARCHITECTURE.md §4.9 + TODO.md left to `wrap-up`/`architect` (architect-owned doc); no code blocker.
