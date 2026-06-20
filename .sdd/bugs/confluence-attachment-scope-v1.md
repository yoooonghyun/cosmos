# Bug Report: confluence-attachment-scope (v1)

- **Status:** Fixed — **live GUI confirmed 2026-06-20** (both `.svg` attachments render; diag log
  shows `ATTACH bytes status=200 ct=image/svg+xml`). See "Live root cause #2" below.
- **Reported:** 2026-06-18
- **Severity:** degraded (page text renders; embedded attachment images are broken)
- **Feature area:** `confluence-content-images-v1` (the `cosmos-confluence-img://` proxy)

## Symptom

In the Confluence panel, the "Software Development" page renders its text but some embedded
images stay broken (never load). User confirmed it persists across sessions, and **persists
after a full Confluence disconnect + reconnect** (re-consent).

## Expected vs Actual

- **Expected:** embedded Confluence attachment images load via the `cosmos-confluence-img://`
  main-process proxy (bearer-authorized `net.fetch`), like any other page asset.
- **Actual:** the proxy fetch returns **HTTP 401** and the `<img>` shows broken.

## Reproduction

1. Connect Confluence, open the "Software Development" page (space `cosmos-works`, pageId 65822).
2. The two embedded `.svg` attachments fail to render.

Confluence is NOT reproducible in the dev/CI env (no live workspace there) — evidence below was
captured live from the user's connected workspace via temporary file-logging diagnostics.

## Root Cause (confirmed with live evidence)

The failing images are **`.svg` attachments** embedded by Confluence with a **legacy download
URL** in the page-body HTML:

```
<img class="confluence-embedded-image ..."
     src="https://cosmos-works.atlassian.net/wiki/download/attachments/65822/recently_updated.svg?version=1&modificationDate=...&cacheVersion=1&api=v2"
     data-linked-resource-id="65846" data-linked-resource-type="attachment"
     data-media-id="d6d18685-..." data-media-type="file" ... />
```

The renderer rewrite + the `cosmos-confluence-img` protocol handler both work correctly — the
relative path `/wiki/download/attachments/65822/recently_updated.svg?...` is decoded, validated,
and fetched with the bearer token. The **upstream fetch is what fails**:

```
[proto fetch 401 application/json] path=/wiki/download/attachments/65822/recently_updated.svg?...
  body: {"code":401,"message":"Unauthorized; scope does not match"}
```

`read:attachment:confluence` **is** in `CONFLUENCE_OAUTH_SCOPES` (atlassianConfig.ts:59) and the
user **reconnected** to grant it — yet the legacy `/wiki/download/attachments/...` blob endpoint,
fetched through the OAuth gateway `https://api.atlassian.com/ex/confluence/{cloudId}`
(`buildAssetUrl`, confluenceImageRef.ts:145), still returns `401 "scope does not match"`.

This is the **same class** of failure as the page-read migration (confluenceClient.ts:18-20):
Atlassian's **classic content endpoints are not authorized by granular scopes** and 401 with
"scope does not match"; only the **v2 API** is authorized. The legacy `/wiki/download/attachments/`
path is a classic endpoint → not covered by the granular `read:attachment:confluence` scope. The
attachment bytes must be fetched through a **granular-authorized v2 attachment path** keyed off
the attachment id (`data-linked-resource-id`), not the embedded legacy download URL.

### Evidence summary (captured via temp diagnostics — MUST be removed as part of the fix)

- `src/main/integrations/confluenceClient.ts` `getPage` — logs raw `<img>` tags.
- `src/main/confluenceImageProtocol.ts` handler — logs fetch status/content-type + non-2xx body.
- Both write to `/tmp/cosmos-confluence-img-diag.log`. **REMOVE both temp diagnostics when fixing.**

## Fix (implemented)

Resolve attachment bytes through the **granular-authorized Confluence v2 attachments API**
keyed off the attachment id (`data-linked-resource-id`), instead of the embedded legacy
`/wiki/download/attachments/...` blob URL.

**Chosen v2 path (verified against the Atlassian Confluence Cloud REST v2 docs + OpenAPI spec):**
`GET /wiki/api/v2/attachments/{id}` — authorized by `read:attachment:confluence` (confirmed in the
OpenAPI `security` for that operation). It returns JSON metadata carrying a `downloadLink` (a
Confluence-relative path). Main follows that link against the trusted gateway base to stream the
bytes. The v2 metadata read is the granular-authorized entry point; its `downloadLink` is freshly
minted by the v2 API for the granting token (unlike the stale `cacheVersion`/classic-render legacy
URL embedded in the page body). The v2 API exposes no direct "raw bytes by id" endpoint — the
metadata→downloadLink two-step is the documented route.

**Renderer (`src/renderer/confluenceCatalog/`):**
- `contentImageSrc.ts` — new `attachmentIdOf(el)` (reads `data-linked-resource-id`, gated on
  `data-linked-resource-type !== 'page'`/non-attachment, requires a positive-integer id) and
  `toAttachmentOpaqueSrc(id)` → `cosmos-confluence-img://confluence/<base64url('attachment:<id>')>`.
  New exported const `COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX = 'attachment:'`.
- `sanitize.ts` — the `afterSanitizeAttributes` rewrite now PREFERS the attachment-id ref when
  `attachmentIdOf` returns an id, and FALLS BACK to the existing relative-`/wiki/...`-path ref
  for non-attachment content images (e.g. `/wiki/s/...` site assets). Added
  `data-linked-resource-id` + `data-linked-resource-type` to DOMPurify `ALLOWED_ATTR` so they
  survive attribute filtering before the hook reads them (the hook runs *after* the allow-list).

**Main (`src/main/`):**
- `confluenceImageRef.ts` — `decodeImageRef` now returns a discriminated `ImageRef`
  (`{kind:'attachment',attachmentId}` | `{kind:'path',relativePath}`) | `null`. An
  `attachment:<id>` ref is accepted only when `<id>` is digits-only (path-smuggling guard). New
  pure builders `buildAttachmentMetaUrl(cloudId,id)` (→ `…/wiki/api/v2/attachments/{id}`) and
  `buildDownloadUrl(cloudId,downloadLink)` (normalizes a site-root `/download/...` link to
  `/wiki/download/...`, then re-applies the `safeWikiPath` SSRF guard before appending to the
  gateway base — forged/origin-escaping link → null). `safeWikiPath`/`buildAssetUrl` unchanged.
- `confluenceImageProtocol.ts` — the handler dispatches on `ImageRef.kind`: an `attachment` ref
  is resolved via `resolveAttachmentBytesUrl` (v2 metadata read → `downloadLink` →
  `buildDownloadUrl`) then streamed; a `path` ref streams `buildAssetUrl` directly as before.
  FR-010 preserved (forged → 400; metadata/no-downloadLink failure → 502; never throws). Token
  stays main-only (only ever on the outbound `net.fetch` Authorization header).

**SSRF guard, main-only token rule (CLAUDE.md), FR-010, and the `.ts`/`.test.ts` split are all
preserved.** Non-attachment content images keep working via the retained relative-path ref.

### Temp diagnostics removed
- `src/main/integrations/confluenceClient.ts` `getPage` — the `<img>`-logging block is gone;
  `getPage` returns `body: pageViewBody(r.body)` cleanly.
- `src/main/confluenceImageProtocol.ts` — both `/tmp/cosmos-confluence-img-diag.log` blocks
  (rejected-ref logger + fetch status/body logger) removed; handler is back to its clean form.
- `grep` confirms no `cosmos-confluence-img-diag` / `confluence-image-render bug` references
  remain in `src/`. (An unrelated renderer-crash console diagnostic at `index.ts:1422` is out of
  scope and left in place.)

## Regression Test (implemented)

Node-env vitest, pure codec/URL-builder coverage (`.ts`/`.test.ts` split):
- `src/renderer/confluenceCatalog/contentImageSrc.test.ts` — `attachmentIdOf` extracts `65846`
  from the real failing-page `<img>` markup; `toAttachmentOpaqueSrc('65846')` encodes
  `attachment:65846` and the decoded ref does NOT contain `/wiki/download/attachments/`.
- `src/renderer/confluenceCatalog/sanitize.test.ts` — end-to-end: the embedded attachment `<img>`
  with `data-linked-resource-id="65846"` + a legacy download `src` sanitizes to an opaque ref
  whose decoded value is `attachment:65846` (NOT the legacy blob path; legacy URL/host don't leak).
- `src/main/confluenceImageRef.test.ts` — `decodeImageRef` returns the discriminated
  `{kind:'attachment',attachmentId:'65846'}`; rejects non-numeric ids; `buildAttachmentMetaUrl`
  targets `…/wiki/api/v2/attachments/65846` and `.not.toContain('/wiki/download/attachments/')`;
  `buildDownloadUrl` appends/normalizes a downloadLink and SSRF-rejects forged links.

These fail against the old legacy-path builder (which encoded the `/wiki/download/attachments/...`
path) and pass after the fix.

## Live root cause #2 (downloadLink normalization gap) — confirmed 2026-06-20

The v2-API fix above was correct in approach but had a **second blocker** that only showed up
live. The v2 metadata read returns 200 and a valid `downloadLink`, but that link is rooted at the
**site**, not the wiki context:

```
META status=200  downloadLink=/rest/api/content/65822/child/attachment/att65846/download
```

`buildDownloadUrl` only normalized a `/download/...` prefix to `/wiki/...`; a `/rest/...` link fell
through, failed the `/wiki/`-anchored `safeWikiPath` guard, and returned **null → 502** (`ATTACH
bytesUrl=null`). Generalized the normalization to prefix `/wiki` to **any** non-`/wiki/` site-root
path (still rejects `//host`, `..`):

```ts
if (path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/wiki/')) {
  path = `/wiki${path}`
}
```

After the fix the bytes URL builds (`…/wiki/rest/api/content/.../download`) and the bytes fetch
returns **200 `image/svg+xml`** — images render. The classic `/rest/.../download` endpoint **is**
granular-authorized once reached through the gateway under `/wiki`; the only blocker was the
null bytesUrl. Regression test added: `buildDownloadUrl` normalizes a `/rest/...` link
(`confluenceImageRef.test.ts`). Temp diagnostics in `confluenceImageProtocol.ts` removed.

## Verification

- Live GUI **confirmed** 2026-06-20: both `.svg` attachments on "Software Development" render.
- `npm run typecheck` (node + web) — green.
- `npm test` (vitest, full suite) — green: 1286 passed, 0 failed (incl. the new tests above).
- Live GUI (PENDING USER — Confluence not reproducible in this env): reopen "Software Development"
  and confirm both `.svg` attachments render. Note: already-connected users may need to reconnect
  ONCE to grant `read:attachment:confluence` if they had not before (scope set was already updated
  in a prior change; this fix changes the fetch path, not the scope set).
- `/tmp/cosmos-confluence-img-diag.log` is no longer written (both diagnostics removed).
