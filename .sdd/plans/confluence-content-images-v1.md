# Plan: Confluence content/attachment images in the page-detail body — v1

**Status**: Draft
**Created**: 2026-06-15
**Last updated**: 2026-06-15
**Spec**: .sdd/specs/confluence-content-images-v1.md

---

## Grounding

**codegraph_explore (queries → takeaway):**

- `ConfluencePanel PageDetailBody sanitizeConfluenceHtml ConfluenceClient atlassianConfig` → both detail surfaces inject `sanitizeConfluenceHtml(body)` via `dangerouslySetInnerHTML` (`components.tsx:61-69`); single sanitize gate.
- `confluenceClient getPage atlassianConfig cloudId base url access token call` → `base(cloudId)=https://api.atlassian.com/ex/confluence/{cloudId}` (`atlassianConfig.ts:73`); `call()` attaches `Authorization: Bearer <token>` (`confluenceClient.ts:164-205`); `getPage` reads `?body-format=view`. `ConfluenceCallAuth = { token, cloudId }`. `ConfluenceManager.run((auth)=>…)` threads auth + does refresh/`reconnect_needed` (`confluenceManager.ts`).
- `SANITIZE_CONFIG isEmoticonImg afterSanitizeAttributes registerSanitizeHook` → `<img>` allow-listed; `registerSanitizeHook` adds an `afterSanitizeAttributes` hook (`sanitize.ts:159-186`) that forces `<input>` inert, strips `data:` `src`/`href`, and replaces emoticon `<img>` (`isEmoticonImg`, line 132) with glyph text. This is the exact seam the content-img rewrite plugs into.
- `validateConfluenceGetPage validate.ts isObject isNonEmptyString` → boundary validators are pure `(raw, warn)=>params|null` with injectable `warn` (`validate.ts`); the `.ts`/`.test.ts` split applies.
- `registerConfluenceIpcHandlers app.whenReady createWindow webPreferences` → IPC handlers registered in `registerIpcHandlers()`; window is `contextIsolation:true, nodeIntegration:false, sandbox:false`; **no custom protocol registered today** (`index.ts`).

**Electron API (context7 / docs):** modern non-deprecated path is `protocol.registerSchemesAsPrivileged([{scheme, privileges:{standard,secure,supportFetchAPI,stream,bypassCSP?}}])` BEFORE `app.ready`, then `protocol.handle(scheme, (request)=>Promise<Response>)` after ready; `net.fetch(url,{headers})` streams a remote response back transparently. This replaces all `register*Protocol`/`intercept*Protocol`.

**memory_recall:** prior Confluence/token decisions captured in `.sdd/bugs/confluence-detail-emoji-checkbox-stripped-v1.md` (the emoticon-img→glyph + the deliberate `data:`-strip hardening); MEMORY index notes the read-only-departing Jira write direction (not relevant here — this stays read-only).

---

## Summary

Render embedded Confluence **content/attachment images** in the shared page-detail body
(native panel + gen-UI overlay) WITHOUT the access token ever leaving main. Strategy: register
a custom **privileged streaming Electron protocol `cosmos-confluence-img://`**; its main-process
handler decodes the opaque reference, fetches the asset from the gateway base
`https://api.atlassian.com/ex/confluence/{cloudId}` with the bearer token (via the existing
manager auth path), and streams the `net.fetch` response straight back. In the renderer, the
single sanitize gate (`sanitize.ts`) — running AFTER DOMPurify — rewrites each **content**
`<img src>` (a relative/absolute Confluence asset URL; NOT an emoticon, NOT an external URL) to
the opaque `cosmos-confluence-img://` scheme. The renderer therefore only ever holds an opaque
scheme — never the token, never bytes, never a `data:` URL (preserving the existing `data:`-strip
hardening). The Confluence OAuth scope set gains `read:attachment:confluence` (one-time reconnect).
No size cap — the handler streams. References resolve purely on-demand against the live session
(no stored token-bearing URL), and the handler re-resolves every reference against the trusted
gateway base, rejecting anything that escapes the Confluence origin (SSRF-safe).

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main + renderer + shared) |
| Key dependencies | Electron `protocol` + `net` (already present); DOMPurify (already present). No new npm deps. |
| Files to create | `src/main/confluenceImageProtocol.ts` (scheme reg + `protocol.handle` handler + pure reference codec/validator); `src/main/confluenceImageProtocol.test.ts`; `src/renderer/confluenceCatalog/contentImageSrc.ts` (pure: classify + rewrite an `<img>` src ↔ opaque ref); `src/renderer/confluenceCatalog/contentImageSrc.test.ts` |
| Files to modify | `src/main/integrations/atlassianConfig.ts` (+`read:attachment:confluence`); `src/main/index.ts` (register scheme pre-ready + `protocol.handle` post-ready, wired to `ConfluenceManager` auth); `src/renderer/confluenceCatalog/sanitize.ts` (call the content-img rewrite inside the existing `afterSanitizeAttributes` hook; allow `cosmos-confluence-img:` in `ALLOWED_URI_REGEXP` and keep `data:` stripped); `src/renderer/confluenceCatalog/sanitize.test.ts` (cases); `docs/ARCHITECTURE.md` (§2 protocol note, §4.9 scope + asset-protocol) |

---

## Design decisions (settling the spec's plan-level open items)

**D1 — Custom privileged streaming protocol (committed; spec Option A).**
Scheme `cosmos-confluence-img`. `registerSchemesAsPrivileged` is called at module top-level in
main BEFORE `app.whenReady` (Electron requires pre-ready registration) with privileges
`{ standard:true, secure:true, supportFetchAPI:true, stream:true }`. `protocol.handle('cosmos-confluence-img', handler)`
is wired AFTER ready, alongside `createWindow()`. The handler is given a resolver
`() => ConfluenceCallAuth | null` (token+cloudId for the live connection, or null when not
connected) sourced from `ConfluenceManager`, so the protocol layer never stores a token and
always uses the current (refreshed) one.

**D2 — SSRF-safe opaque reference encoding.**
The reference encodes ONLY the Confluence-relative asset path (the original `src`'s
path+query, e.g. `/wiki/download/attachments/123/x.png?version=2`) — NOT a full URL, NOT a
host. Authority/host comes from `cosmos-confluence-img://confluence/<encoded-path>` where the
fixed authority segment is a constant (`confluence`), and `<encoded-path>` is the
percent/base64url-encoded relative path. The handler: (a) decodes the path; (b) REJECTS any
decoded path that is not an absolute `/wiki/...` path or that contains a scheme/`//`/`..`
traversal or an embedded host — i.e. anything that could escape the Confluence origin; (c)
builds the fetch URL strictly as `${confluenceApiBase(cloudId)}${relativePath}`. There is no
way for a forged reference to point `net.fetch` at a non-Confluence origin (FR-011/SC-005). The
codec + validator are PURE and unit-tested in isolation.
`[DECISION — confirm in implement]` encoding choice (percent-encode the single path segment vs.
base64url the whole relative path). Base64url avoids nested-percent-encoding ambiguity for paths
that already carry `%` and query strings; lean base64url unless a probe shows the scheme parser
mangles it.

**D3 — Content-image vs emoticon vs external classification (renderer, pure).**
`contentImageSrc.ts` exports `classifyImg(el)` → `'emoticon' | 'confluence-content' | 'external' | 'drop'`
and `toOpaqueSrc(relativePath)`:
- emoticon (`isEmoticonImg`, already handled) → NOT rewritten here (emoticon branch still runs first and replaces it with a glyph; ordering in the hook ensures emoticon replacement happens before content rewrite so an emoticon is never double-processed).
- a Confluence asset src — relative `/wiki/...` OR absolute `https://<anything>.atlassian.net/wiki/...` (normalize the absolute site form to its relative `/wiki/...` path) → rewrite `src` to `toOpaqueSrc(relativePath)`.
- absolute non-Confluence URL → left untouched (FR-008).
- a `data:` src → already stripped by the existing hook step; never rewritten (FR-007).

**D4 — Hook wiring (one XSS gate preserved).**
The rewrite is invoked INSIDE the existing `afterSanitizeAttributes` hook in `sanitize.ts`,
AFTER DOMPurify has run and AFTER the existing emoticon-replacement + `data:`-strip + input-inert
steps. `ALLOWED_URI_REGEXP` is widened to also permit the `cosmos-confluence-img:` scheme on
`<img src>` (added deliberately, scoped to that scheme); `data:` stays stripped. Net: DOMPurify is
still the first and only injection gate; the rewrite only swaps a benign already-sanitized `src`.

**D5 — Scope + reconnect.**
`CONFLUENCE_OAUTH_SCOPES` gains `read:attachment:confluence`. Changing the set forces a
disconnect+reconnect to re-consent (existing behavior when scopes change). Until reconnected, the
bearer lacks the scope → asset fetch returns 401/403 → handler yields a non-2xx Response → the
`<img>` shows a broken-image fallback (FR-010), never a crash. No new user-facing reconnect UI is
built in v1 beyond the existing Connect/Reconnect affordance; ARCHITECTURE notes the reconnect.

**D6 — Reference lifetime / no caching of token-bearing URLs.**
References are resolved purely on-demand: nothing stores a token or a token-bearing URL. On
disconnect the auth resolver returns null → handler returns a non-2xx/early Response → broken
image. Browser-level image caching of the streamed BYTES is fine (no token in the cached URL,
which is only the opaque scheme).

**D7 — Failure mapping (graceful, never throws — FR-010).**
The handler never throws: not-connected/no-auth → early non-2xx Response; invalid/forged ref →
non-2xx; `net.fetch` rejection → non-2xx; non-2xx upstream → pass the status through. Each yields
an ordinary broken `<img>`; the rest of the body renders. (No `ConfluenceResult` envelope here —
the protocol speaks HTTP Responses, mapping cleanly to `<img>` load/error.)

## Implementation Checklist

### Phase 1 — Interface

- [x] Re-read the spec; confirm all 3 blocking questions resolved (gateway base, +scope, no cap).
- [x] `src/renderer/confluenceCatalog/contentImageSrc.ts` — pure types/helpers: `classifyImg(el)`, `confluenceRelativePath(el)` (relative or normalized-from-absolute-site), `toOpaqueSrc(relativePath)`, the scheme constant `COSMOS_CONFLUENCE_IMG_SCHEME`. No DOM mutation here.
- [x] `src/main/confluenceImageProtocol.ts` — pure codec/validator: `decodeImageRef(url): string | null` (returns a safe `/wiki/...` relative path or null), `buildAssetUrl(cloudId, relativePath)`; plus `registerConfluenceImageScheme()` (pre-ready) and `handleConfluenceImage(authResolver)` factory (post-ready). Keep Electron calls thin; logic in the pure fns.
- [x] Confirm no invented properties — reference carries ONLY the relative path; no token/cloudId in the scheme.

### Phase 2 — Testing

- [x] `contentImageSrc.test.ts`: emoticon → not content; relative `/wiki/download/attachments/...` → content + correct opaque src; absolute `https://x.atlassian.net/wiki/...` → normalized + content; absolute non-Confluence → external (untouched); `data:` → not rewritten.
- [x] `confluenceImageProtocol.test.ts` (pure codec/validator, no Electron): round-trip relative path ↔ opaque ref; REJECT forged refs (scheme in path, `//host`, `..` traversal, non-`/wiki` path, embedded `http(s)://`) → null (SSRF guard); `buildAssetUrl` always `${gatewayBase}/wiki/...`.
- [x] `sanitize.test.ts`: a content `<img src="/wiki/download/attachments/…">` → src rewritten to `cosmos-confluence-img://…`, NOT dropped; emoticon `<img>` still → glyph (no regression); external `<img>` untouched; `data:image/svg+xml` `<img>` still stripped; hostile (`javascript:`, `onerror=`) still stripped.

### Phase 3 — Implementation

- [x] `atlassianConfig.ts`: add `read:attachment:confluence` to `CONFLUENCE_OAUTH_SCOPES` (update the doc-comment noting the reconnect).
- [x] `sanitize.ts`: inside the existing `afterSanitizeAttributes` hook, after the emoticon/`data:`/input steps, call the content-image rewrite for surviving `<img>`; widen `ALLOWED_URI_REGEXP` to permit `cosmos-confluence-img:` on `src` while keeping `data:` stripped.
- [x] `index.ts`: call `registerConfluenceImageScheme()` at top-level (pre-`whenReady`); in `whenReady` after manager init, `protocol.handle(scheme, handleConfluenceImage(() => confluenceManager?.currentAuth() ?? null))` (add a thin `currentAuth()` accessor to `ConfluenceManager` returning `{token,cloudId}` for the live connection or null — no new IPC, main-only).
- [x] All tests pass; reused the existing sanitize hook + manager auth path (no duplicated fetch/auth logic).

### Phase 4 — Docs

- [x] `docs/ARCHITECTURE.md`: §2 Window security — note the registered privileged `cosmos-confluence-img` scheme; §4.9 — add the asset-image protocol (main fetches with token + streams; renderer holds only the opaque scheme; `data:` still stripped) and add `read:attachment:confluence` to the Confluence scope list + the one-time reconnect.
- [x] Update this plan with deviations; reconcile `TODO.md` (wrap-up).

---

## Deviations & Notes

- **2026-06-15**: Plan authored. Committed to the custom-protocol strategy (spec Option A) per orchestrator decision; gateway base, +`read:attachment:confluence` scope (one-time reconnect), and no size cap folded in from the resolved spec questions.
- **2026-06-15 (implement)**: All checklist phases done; `npm run typecheck` + `npm test` green (1075 tests, +34 new). Notes on deviations:
  - **Pure/Electron split**: the plan named one `confluenceImageProtocol.ts` for both the codec AND the Electron wiring, but a node-testable pure module CANNOT import `electron`, and the node tsconfig excludes renderer DOM files. Split into `src/main/confluenceImageRef.ts` (PURE codec/validator/`buildAssetUrl`, node-tested) + `src/main/confluenceImageProtocol.ts` (Electron scheme reg + `protocol.handle` factory). Renderer pure half is `src/renderer/confluenceCatalog/contentImageSrc.ts` as planned.
  - **Ref encoding (resolved open item D2)**: chose **base64url, no padding** (`-`/`_`, strip `=`). The decoder's `^[A-Za-z0-9_-]+$` guard parses it cleanly and it round-trips `/wiki/...` paths that already carry `%`-escapes + query strings without nested-percent ambiguity. Confirmed by a cross-module round-trip test (renderer encode ↔ main decode).
  - **CSP blocker (NOT in spec/plan — found at GUI verify)**: the renderer Content-Security-Policy `img-src 'self' data:` (`src/renderer/index.html`) blocked the `cosmos-confluence-img:` scheme BEFORE `protocol.handle` was ever invoked (CSP console error, no handler log). Fixed by adding `cosmos-confluence-img:` to `img-src`. Registering the privileged scheme + handler is necessary but NOT sufficient — the renderer CSP must allow the scheme too. Recorded to agentmemory.
  - **External-CDN images (scope gap for architect)**: live verification showed the test page embeds images as ABSOLUTE EXTERNAL CDN URLs (`https://dam-cdn.atl.orangelogic.com/…`), not relative `/wiki/...`. These are correctly classified `external` (FR-008, untouched by the proxy) but the renderer CSP still blocks arbitrary `https:` → broken image. Whether external embeds should render (loosen CSP to `https:` vs proxy them) is a follow-up decision, NOT folded in here. The `/wiki/…` proxy path itself is implemented + unit-tested; GUI confirmation on a page with a RELATIVE content image remains a user step.
