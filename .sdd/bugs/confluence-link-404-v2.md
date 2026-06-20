# Bug Report: confluence-link-404 (v2 — re-open)

- **Status:** Fixed (live verification owed — see §6)
- **Reported:** 2026-06-21 (re-open of v1)
- **Severity:** broken
- **Regression:** yes — broke when the #87 "Open in Confluence" weblink shipped; the v1 fix
  (string-concat `_links.base + _links.webui`) did NOT resolve it.

## Symptom (re-open, user verbatim)

"여전히 404이고 본문 제목에 link 붙음" — STILL 404, and the link is attached to the BODY title.

Two distinct defects:
1. Clicking "Open in Confluence" still opens a 404 URL (the v1 concat fix did not work in
   practice).
2. The external-link affordance sits on the page's BODY title (the `<h2>` inside the scrolled
   detail body); the user wants it on the DETAIL'S TOP TITLE (the sticky back-row header).

## Why the v1 fix did not work — the REAL root cause

The v1 fix assumed the single-page read returns `_links.base` (the site `/wiki`) alongside a
host-absolute `_links.webui` (no `/wiki`), and string-concatenated them. That premise is wrong
against the real v2 API:

- **Verified against the v2 OpenAPI** (`developer.atlassian.com/.../openapi-v2.v3.json`):
  the per-page `_links` for `GET /wiki/api/v2/pages/{id}` is the **`AbstractPageLinks`** schema —
  `{ webui, editui, tinyui }`. **There is NO `base` field.** `base` belongs to the
  **`MultiEntityLinks`** schema (`{ next, base }`), which is the TOP-LEVEL `_links` of
  **LIST / multi-entity** responses, NOT a single-page object.
- So `confluenceWebUrl(r.body._links)` read `links.base` off a single-page `_links` that does not
  define it. Whatever value the runtime happened to put there was undocumented and unstable, so the
  v1 concat still produced a 404 URL. The two observed failure shapes (both reproduced via `node`):
  - `/wiki`-less: `https://acme.atlassian.net/spaces/ENG/pages/123/Title` (the original #100 bug —
    `base` missing/origin-only or webui resolved against origin).
  - doubled `/wiki`: `https://acme.atlassian.net/wiki/wiki/spaces/ENG/pages/123/Title` (when a
    runtime `base` carried `/wiki` AND `webui` ALSO carried `/wiki` → concat doubles it).
- The v1 unit test masked this by hand-feeding a `_links.base` that the real single-page read does
  not reliably return.

**Pin:** `src/main/integrations/confluenceWebUrl.ts:52` (pre-fix `confluenceWebUrl(links)` reading
`links.base`) and its caller `src/main/integrations/confluenceClient.ts:297`
(`confluenceWebUrl(r.body._links)`).

**Correct URL source:** the browsable host is NOT in the page `_links` at all — it is the site web
ORIGIN already persisted from OAuth accessible-resources (`extra.siteUrl`, e.g.
`https://acme.atlassian.net`, bare origin, NO `/wiki`). Confluence is served under the `/wiki`
context path, so the canonical URL is `<siteUrl>/wiki<webui>` →
`https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title`. The `/wiki` seam is normalized so it
is present EXACTLY once regardless of whether `webui` already carries `/wiki`.

## Link placement — decision

The link currently sits on the body `<h2>` inside `PageDetail` (`ConfluencePanel.tsx`), i.e. the
"본문 제목". The detail view's actual TOP title is the sticky **back-row header**
(`ChevronLeft` + title) rendered by the panel — present for BOTH the native page view
(`view.kind === 'page'`) and the gen-UI list overlay (`genUiPage`).

**Decision:** move the "Open in Confluence" affordance to the back-row header title and make the
body `<h2>` plain text (no double-linked title). The header title only had the title STRING (from
the clicked list row), so `webUrl` is now LIFTED OUT of `PageDetail` to the panel via an `onWebUrl`
callback and rendered on the header via the existing `PageDetailTitle` (icon + link). The gen-UI
catalog `PageDetail` (`confluenceCatalog/components.tsx`) is left unchanged — its `<h2>` IS the top
title of that standalone A2UI surface (it has no separate back-row header), so the link belongs
there.

The external-link idiom is unchanged: `PageDetailTitle` renders a `target="_blank"` `<a>` whose
navigation is routed to the system browser by the single `setWindowOpenHandler` →
`shell.openExternal` hand-off in `src/main/index.ts` (http(s)-only). No new component, IPC channel,
scope, or token.

## Fix — files changed

- `src/main/integrations/confluenceWebUrl.ts` — `confluenceWebUrl` signature changed to
  `(siteUrl, links)`. It now builds `<siteUrl>/wiki<webui>` from the page's `_links.webui` and the
  persisted site origin, via `joinSiteAndWebui` which strips a trailing `/wiki` from `siteUrl` and a
  leading `/wiki` from `webui` so the segment is never doubled or dropped. It no longer reads
  `_links.base`. All omit-when-absent / http(s) / never-throws guards preserved.
- `src/main/integrations/confluenceClient.ts` — `ConfluenceCallAuth` gains optional `siteUrl`;
  `getPage` calls `confluenceWebUrl(auth.siteUrl, r.body._links)`.
- `src/main/confluenceManager.ts` — `auth()` populates `siteUrl` from `extra.siteUrl` via a new
  `readSiteUrl` helper (omitted when absent → legacy tokens degrade gracefully).
- `src/renderer/ConfluencePanel.tsx` — `PageDetail` gains an `onWebUrl` callback (fires the fetched
  `webUrl`, clears on unmount/loading/error); its body `<h2>` is now plain title text. The panel
  holds `detailWebUrl` state and renders `PageDetailTitle` (the link) on BOTH back-row header titles
  (native `view.kind === 'page'` and the `genUiPage` overlay), wiring `onWebUrl={setDetailWebUrl}`.

## Regression test

- `src/main/integrations/confluenceWebUrl.test.ts` — rewritten for the `(siteUrl, links)` signature.
  Feeds the REAL v2 `_links` (webui only, NO `base`) + the real bare-origin `siteUrl` and asserts
  `https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title`, with explicit `.not.toBe(...)`
  guards against BOTH the `/wiki`-less 404 URL and the doubled-`/wiki` 404 URL. Adds a case proving
  a `webui` that already carries `/wiki` is NOT doubled, and that a missing `siteUrl` omits.
- `src/main/integrations/confluenceClient.test.ts` — `getPage` webUrl fixture corrected to the REAL
  v2 `_links` (webui/editui/tinyui, NO base); `auth` fixture gains `siteUrl`. New case: `getPage`
  OMITS `webUrl` when `auth.siteUrl` is absent (legacy token set).
- **Fails-without-fix:** the old assembler required `_links.base`; against the real v2 shape (no
  `base`) it returned `undefined` (no link) OR, with a runtime `base`, produced one of the two 404
  URLs the new `.not.toBe(...)` assertions pin. Both 404 shapes were reproduced via `node` (§ above).

## Verification

- [x] `npm test` — full suite PASS (1911) FAIL (0), incl. the rewritten regression tests.
- [x] `npm run typecheck:web` — clean (covers the `ConfluencePanel.tsx` change).
- [x] `npm run typecheck:node` — no errors in any Confluence file. (One pre-existing error in
  `src/main/integrations/slackPermalink.ts` is an untracked, concurrent Slack-track file, not part
  of this fix.)
- [ ] **Live UI exercised — NOT run (owed).** No live Confluence/Electron session in this env. The
  URL fix is proven by the corrected-shape unit test + the v2-OpenAPI-confirmed `_links` schema; the
  header-placement render is logic-only but was not visually exercised. Live check owed: open a real
  page detail, confirm the link is on the TOP back-row title and resolves (no 404).

## Root-cause lesson (for memory)

The single v2 page read's `_links` (`AbstractPageLinks`) has NO `base` — `base` is a LIST-response
field (`MultiEntityLinks`). Build the Confluence page web URL from the persisted site ORIGIN
(`extra.siteUrl`) + `/wiki` + `_links.webui`, normalizing the `/wiki` seam to exactly one. Do NOT
rely on `_links.base` from a single-page response.
