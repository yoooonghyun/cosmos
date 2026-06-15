# Spec: Confluence content/attachment images in the page-detail body — v1

**Status**: Approved
**Created**: 2026-06-15
**Supersedes**: —
**Related plan**: .sdd/plans/confluence-content-images-v1.md

> **Decisions folded in (2026-06-15):** (Q1) fetch against the gateway base
> `https://api.atlassian.com/ex/confluence/{cloudId}` — the same base every existing
> Confluence call uses for `/wiki/...` paths — never the site base. (Q2) ADD
> `read:attachment:confluence` to the requested OAuth scope set; this forces a one-time
> reconnect for already-connected users (accepted). (Q3) NO size cap — stream whatever
> Confluence returns; all large-image / size-limit handling is dropped.

---

## Grounding

**codegraph_explore / codegraph_search (queries → one-line takeaway):**

- `ConfluencePanel PageDetailBody sanitizeConfluenceHtml ConfluenceClient confluenceClient atlassianConfig` → both the native panel detail and the gen-UI overlay render via `PageDetail`/`PageDetailBody`, which injects `sanitizeConfluenceHtml(body)` through `dangerouslySetInnerHTML` (`components.tsx:61-69`). One shared sanitize gate.
- `confluenceClient getPage atlassianConfig cloudId base url access token fetch authorization bearer` → `getPage` reads `body-format=view` and returns the raw view HTML (`pageViewBody`) unchanged; the token is threaded per-call as `ConfluenceCallAuth.token` and never persisted in the DTO (`confluenceClient.ts:275-302`).
- `ConfluenceClient base method confluenceApiBase ConfluenceCallAuth call registerConfluenceIpcHandlers ConfluenceApi ipc` → `base(cloudId)` = `https://api.atlassian.com/ex/confluence/{cloudId}`; `call()` attaches `Authorization: Bearer <token>` and maps HTTP status → `ConfluenceError` kinds (`network`/`rate_limited`/`reconnect_needed`-equiv). IPC handlers live in `registerConfluenceIpcHandlers` (`index.ts:967`), channels in `ConfluenceChannelName` (`ipc.ts:612`), surface contract `ConfluenceApi` (`ipc.ts:643`) — no method takes/returns a token.
- `SANITIZE_CONFIG ALLOWED_TAGS ALLOWED_URI_REGEXP` → `<img>` is allow-listed (`sanitize.ts:77-106`); `afterSanitizeAttributes` hook strips any `data:` `src`/`href` (closes the `data:image/svg+xml` SVG-script vector) and replaces emoticon `<img>` with glyph text. `ALLOWED_URI_REGEXP` permits http(s)/mailto/relative.
- `app.whenReady new BrowserWindow webPreferences registerSchemesAsPrivileged` → no custom Electron protocol is registered today; `app.whenReady().then(...)` calls `registerIpcHandlers()` + `createWindow()` (`index.ts:1329`). Window is `contextIsolation:true, nodeIntegration:false, sandbox:false`.

**memory_recall / memory_smart_search (queries → takeaway):**

- `Confluence token base URL cloudId atlassian access token renderer images` → no stored result; the load-bearing prior decision is the bug report (read below).
- Bug report `.sdd/bugs/confluence-detail-emoji-checkbox-stripped-v1.md` (read in full): establishes the pipeline + the exact relative-src evidence. Emoticon images were solved by converting `data-emoji-id` to a Unicode glyph offline (no network). It explicitly names THIS spec's work as a known, separate follow-up: "real page-content images (attachments) also arrive as `<img>` with relative + authed `src` and will likewise break in the renderer — proxying those through main with the token is a larger, separate task." It also records the deliberate hardening that `data:` URLs are stripped on media tags.

---

## Overview

Confluence page bodies can embed real **content images** (inline pictures, attachment
images — distinct from emoji, which are already converted to glyphs upstream). Today these
fail to load in the page-detail body: their `<img src>` is a relative, auth-gated Confluence
URL (e.g. `/wiki/download/attachments/<id>/<file>`, `/wiki/s/.../x.png`) that 404s in the
Electron renderer, and the asset is behind Confluence auth whose access token lives only in
main. This feature makes embedded content images render in the page-detail body while keeping
the access token strictly in the main process.

## User Scenarios

### Embedded picture renders in page detail · P1

**As a** cosmos user reading a Confluence page
**I want to** see the pictures embedded in the page body
**So that** the page reads as it does in Confluence, not as a wall of broken-image icons

**Acceptance criteria:**

- Given a connected Confluence session and a page whose body embeds a content image with a
  relative auth-gated `src`, when I open that page's detail (native panel OR gen-UI overlay),
  then the image renders in the body.
- Given the same page, when the image loads, then the Confluence access token never appears
  in the renderer, in any IPC payload/bridge frame/MCP result, in the DOM (`src`), or in logs.
- Given the page also contains emoji and task checkboxes, when it renders, then the existing
  emoji-glyph and inert-checkbox behavior is unchanged (no regression).

### Broken/unavailable image degrades gracefully · P1

**As a** cosmos user
**I want to** the detail to keep working when an image can't be fetched
**So that** one missing asset never blanks or crashes the page

**Acceptance criteria:**

- Given the stored token is missing/expired or the session needs reconnect, when a page with
  content images is opened, then the rest of the body still renders and each unfetchable image
  shows a graceful broken-image fallback (no crash, no app-wide error, no token prompt loop).
- Given an image asset returns an HTTP error (404/403/5xx) or times out, when the body renders,
  then only that image is broken; all other content (text and successfully-fetched images)
  renders.

### External (already-public) images still render · P2

**As a** cosmos user
**I want to** images that point at an absolute external URL to still render
**So that** non-Confluence embeds (e.g. an `https://example.com/x.png`) are not regressed

**Acceptance criteria:**

- Given a page body with an `<img>` whose `src` is an absolute non-Confluence URL, when the
  page renders, then that image loads directly (it is not routed through the main-process
  proxy) — provided it survives the existing sanitize allow-list.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST render content/attachment images embedded in a Confluence page-detail body whose `src` is a relative, auth-gated Confluence URL, in BOTH the native `ConfluencePanel` page detail AND the gen-UI catalog `PageDetail` (both reuse `PageDetailBody`). |
| FR-002 | The Confluence access token MUST NOT appear in the renderer, in any IPC payload, bridge frame, MCP result, A2UI surface, the rendered DOM (`img src`), or any log line. The renderer MUST only ever receive an opaque reference, never the token or a token-bearing URL. |
| FR-003 | Fetching the image bytes from Confluence with the bearer token MUST happen in the main process only, reusing the existing per-call auth model (`ConfluenceCallAuth`: token + resolved `cloudId`) and the same proactive/reactive token-refresh path reads use. |
| FR-004 | The asset request MUST be issued against the gateway base `https://api.atlassian.com/ex/confluence/{cloudId}` (the same base `getPage`/search/emoticon `/wiki/s/...` use), NOT a site base, with relative `/wiki/...` `src` (`/wiki/download/attachments/...`, `/wiki/s/...`) resolved against that base. The implementation MUST NOT depend on the site base. (Q1 resolved.) |
| FR-005 | The transform that rewrites a content image's `src` to the opaque reference MUST run inside the single existing sanitize gate (`src/renderer/confluenceCatalog/sanitize.ts`), AFTER DOMPurify has sanitized the raw HTML, so the one XSS gate still runs first and remains the only injection path. |
| FR-006 | The rewrite MUST distinguish a CONTENT image from an emoticon image and an already-handled emoji: emoticon images (the `isEmoticonImg` set) MUST keep their current glyph-replacement behavior and MUST NOT be routed through the proxy. |
| FR-007 | The existing `data:`-URL strip on media tags MUST remain in force. The chosen approach MUST NOT reintroduce a `data:` `src` on `<img>` (i.e. an "inline the bytes as a base64 `data:` URL" approach is disallowed because it conflicts with this hardening). |
| FR-008 | An `<img>` whose `src` is an absolute non-Confluence URL MUST be left untouched (rendered directly), not routed through the main-process proxy. |
| FR-009 | Any new cross-process channel MUST be declared in the one typed IPC contract (`src/shared/ipc.ts`); no ad-hoc channel strings. Every new cross-process payload MUST be validated at the main-process boundary — an invalid payload warns and is ignored, never crashes. |
| FR-010 | When the asset cannot be produced (missing/expired token, `reconnect_needed`, HTTP error, non-image content type, oversize, malformed reference), the system MUST fail that single image gracefully (broken-image fallback) and MUST NOT throw, blank the body, or trigger an app-level error. |
| FR-011 | A reference MUST be page/asset-scoped and non-forgeable into an arbitrary-URL fetch: the main-process resolver MUST only fetch Confluence-origin asset paths derived from the opaque reference, never an arbitrary attacker-supplied absolute URL (no SSRF). `[NEEDS CLARIFICATION]` — see Open Questions: exact safe encoding of the reference. |
| FR-012 | The feature MUST stay read-only. The requested OAuth scope set MUST gain `read:attachment:confluence` (added wherever the Confluence scope list is defined — `CONFLUENCE_OAUTH_SCOPES` in `atlassianConfig.ts`). This is a scope change: already-connected users MUST reconnect once to grant it; until then asset fetches fail gracefully (FR-010) and the connection/feed surfaces SHOULD make the reconnect discoverable. (Q2 resolved.) |
| FR-013 | A non-image attachment reference (e.g. a linked PDF/doc that is not an inline picture) MUST NOT be rendered as an inline image; only `<img>`-borne content images are in scope. Other attachment link types render as the links the sanitizer already permits. |

## Edge Cases & Constraints

- **Missing / expired token, `reconnect_needed`:** body renders; each Confluence image shows
  a graceful broken-image fallback; native reconnect flow (statusChanged) is unaffected; no
  surface push, no crash (mirrors the read-error degradation already in the codebase).
- **HTTP 403/404/5xx or timeout on the asset:** only that image breaks; everything else
  renders.
- **Non-image content type returned for an asset reference:** the resolver MUST NOT stream
  arbitrary bytes as an image; treat as a broken image (do not inline non-image bytes).
- **Large images:** NO size cap (Q3 resolved) — the resolver streams whatever Confluence
  returns. (Streaming, not buffering, the response keeps this safe without a limit.)
- **Relative vs absolute `src` resolution:** relative `/wiki/...` resolves against the
  resolved Confluence API base for the connected `cloudId`; absolute Confluence-site URLs
  (`https://<site>.atlassian.net/wiki/...`) MUST map to the same authed fetch; absolute
  non-Confluence URLs are left direct (FR-008).
- **Two detail surfaces:** the fix is in the shared `PageDetailBody`/sanitize path so native
  panel and gen-UI overlay both get it with no per-surface duplication.
- **Caching/lifetime of a reference:** a reference's validity is scoped to a live, connected
  session; on disconnect it stops resolving (degrades to broken image), never silently uses a
  stale token. `[NEEDS CLARIFICATION]` — see Open Questions.
- **Out of scope:** image zoom/lightbox, click-to-open-in-Confluence, video/audio/iframe
  embeds, non-image attachment previews, write/upload of images, and pre-fetching images in
  the search/feed LIST screen (this feature is the page-detail BODY only).

## Strategy comparison (spec-level; the plan picks the concrete shape)

Two realistic main-process-token-preserving approaches were weighed. Both keep the token in
main (FR-002/FR-003); they differ in how bytes reach an `<img>`.

**Option A — Registered custom Electron protocol (e.g. `cosmos-confluence-img://`).**
Register a privileged stream/standard protocol at `app.whenReady` whose handler runs in main:
it parses the opaque reference, fetches the Confluence asset with the bearer token (reusing
the `cloudId`/refresh path), and streams the response back. Sanitize rewrites a content
`<img src>` to the opaque `cosmos-confluence-img://...` scheme.
- Pros: the token-bearing fetch is fully in main; the renderer/DOM only ever holds the opaque
  scheme; native `<img>` streaming and browser image caching; no base64 in the DOM (honors
  FR-007); failures are ordinary broken images (FR-010) with no JS plumbing per image. Adds
  one URL scheme to the sanitize allow-list, not a `data:` URL.
- Cons: requires a new protocol registration + a privileged-scheme allow-list entry; the
  scheme must be added to `ALLOWED_URI_REGEXP`/sanitize allow-list deliberately and scoped so
  it can't be abused; reference encoding must be SSRF-safe (FR-011).

**Option B — IPC fetch → returned bytes → renderer-constructed reference.**
Add a typed IPC method that, given a page/asset reference, returns the bytes (or an
`ok/kind` error) to the renderer, which then builds an `<img>` source from them.
- Pros: stays within the existing IPC contract pattern; no protocol registration.
- Cons: to put bytes on an `<img>` the renderer would build a `blob:`/`data:` URL —
  `data:` directly conflicts with the FR-007 hardening, and even `blob:` means the renderer
  handles raw asset bytes and must be allow-listed; per-image async IPC + manual broken-image
  handling is more plumbing; larger payloads cross the IPC boundary as buffers.

**Recommendation: Option A (custom Electron protocol).** It keeps the token-bearing fetch
entirely in main, lets the renderer hold only an opaque scheme (never bytes, never a token,
never a `data:` URL), and gives native `<img>` streaming + graceful broken-image failure with
the least renderer plumbing — while respecting the existing `data:`-strip hardening. The
sanitize transform that rewrites the `src` is the same single-gate change either option needs.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A Confluence page whose body embeds at least one content image renders that image in BOTH the native page detail and the gen-UI overlay (USER-confirmed GUI step). |
| SC-002 | Inspecting the rendered DOM, every IPC payload, and the logs shows NO Confluence access token and NO token-bearing URL anywhere reachable by the renderer. |
| SC-003 | With no valid token / `reconnect_needed`, opening a page with content images renders the rest of the body and shows graceful broken-image fallbacks — no crash, no blank body, no error surface. |
| SC-004 | An absolute non-Confluence `<img src>` still loads directly (not proxied); emoji glyphs and inert task checkboxes are unchanged (no regression). |
| SC-005 | A malformed/forged opaque reference cannot cause main to fetch an arbitrary non-Confluence URL (no SSRF); it resolves to a broken image instead. |
| SC-006 | `npm run typecheck` and `npm test` are green; the sanitize/transform logic is covered by node-testable unit tests (content `<img>` rewritten to the opaque reference; emoticon `<img>` still glyph; external `<img>` untouched; `data:` still stripped; hostile/forged references rejected). |

---

## Open Questions

All blocking questions are RESOLVED (see the decisions banner). For the record:

- [x] (FR-004) Fetch base — RESOLVED: gateway base `https://api.atlassian.com/ex/confluence/{cloudId}`; do not depend on the site base. (A live probe MAY still confirm during implement, but the design commits to the gateway base.)
- [x] (FR-012) Scope — RESOLVED: add `read:attachment:confluence`; one-time reconnect accepted.
- [x] (large-image policy) — RESOLVED: no size cap; stream the response.
- [~] (FR-011) SSRF-safe reference encoding — settled in the PLAN, not the spec (encode only the Confluence-relative asset path; main re-resolves against the trusted gateway base and rejects any reference that escapes the Confluence origin).
- [~] (reference lifetime) — settled in the PLAN: references resolve purely on-demand against the live session (no stored token-bearing URL mapping; on disconnect they degrade to a broken image).
