# Bug Report: confluence-link-404 (v1)

- **SUPERSEDED by `confluence-link-404-v2.md`** — this v1 fix (string-concat `_links.base +
  _links.webui`) did NOT resolve the 404 in practice. The single v2 page read's `_links`
  (`AbstractPageLinks`) has NO `base`; the browsable host is the persisted site origin
  (`extra.siteUrl`) + `/wiki` + `_links.webui`. See v2 for the real root cause + fix.
- **Status:** Superseded (was: Fixed)
- **Reported:** 2026-06-21
- **Severity:** broken
- **Regression:** yes — broke at the moment the #87 "Open in Confluence" weblink shipped
  (the link was never correct against the real Confluence Cloud `_links` shape).

## Symptom

In the Confluence panel's page detail (both the native detail and the gen-UI `PageDetail`),
the "Open in Confluence" link — the page title rendered as an external link (#87) — opens a
URL that 404s in the browser instead of the actual Confluence page. The user also wants the
nav link surfaced on the detail's TOP TITLE (not only in the body).

## Expected vs Actual

- **Expected:** Clicking the title opens the page at
  `https://<site>.atlassian.net/wiki/spaces/<KEY>/pages/<id>/<Title>` (resolves to the page).
- **Actual:** The link opened `https://<site>.atlassian.net/spaces/<KEY>/pages/<id>/<Title>`
  (missing the `/wiki` context path) → Confluence 404.

## Reproduction

1. Connect Confluence, open the panel, click a search/feed row to open a page detail.
2. Click the page title (the "Open in Confluence" external-link affordance).
3. Observe: the browser opens a `/spaces/.../pages/...` URL WITHOUT `/wiki` → 404.

Deterministic at the unit level: `confluenceWebUrl({ base: 'https://acme.atlassian.net/wiki',
webui: '/spaces/ENG/pages/123/Title' })` returned `https://acme.atlassian.net/spaces/ENG/pages/123/Title`
(the 404 shape) before the fix — verified with `node -e "new URL('/spaces/ENG/pages/123/Title',
'https://acme.atlassian.net/wiki')"` → `https://acme.atlassian.net/spaces/ENG/pages/123/Title`.

## Scope & Severity

Every Confluence page-detail surface (native + gen-UI; they share one `PageDetailTitle`). The
affordance is present but the destination is wrong on every page → broken, not cosmetic. Single
root cause in one pure assembler file.

## Scope gate (Step 1.5)

- **Decision:** continue bug cycle (no escalation to `sdd`).
- **Reason:** single root cause in one pure node-testable file (`confluenceWebUrl.ts`); the
  contract (`webUrl?: string`, omit-when-absent) is unchanged; the title-link placement already
  exists from #87 and only needed confirmation, not a new visual system.

## Classification & Routing (Step 2)

- **Class:** Implementation defect.
- **Routed to:** developer.
- **Reason:** the URL-assembly logic mis-joins two real API fields; no design/spec/contract
  change — the DTO field and the render-site link idiom are unchanged.

## Root Cause (Step 3)

- **Origin:** `src/main/integrations/confluenceWebUrl.ts:44` (pre-fix line — the
  `resolved = new URL(webui, base)` call).
- **Why:** Confluence Cloud v2 `GET /wiki/api/v2/pages/{id}` returns
  `_links.base = "https://<site>.atlassian.net/wiki"` (the `/wiki` context path lives in
  `base`) and `_links.webui = "/spaces/<KEY>/pages/<id>/<Title>"` (host-absolute, with a
  LEADING `/` and NO `/wiki` prefix). The canonical browser URL is the STRING CONCATENATION
  `base + webui`. The old code used `new URL(webui, base)`, which follows the WHATWG URL spec:
  a host-absolute reference (leading `/`) is resolved against the base's ORIGIN, REPLACING the
  base path — so `/wiki` was dropped, yielding `https://<site>.atlassian.net/spaces/.../pages/...`
  which 404s.

  The pre-existing `confluenceWebUrl.test.ts` masked this by feeding a fixture `webui` that
  ALREADY contained `/wiki` (`/wiki/spaces/ENG/pages/123/Title`) — not the real API shape — so
  the wrong resolution happened to land on a `/wiki/...` path and the test went green over a
  URL the real API never produces. `confluenceClient.test.ts` carried the same wrong fixture.

## Fix (Step 4)

- **Files changed:**
  - `src/main/integrations/confluenceWebUrl.ts` — replaced `new URL(webui, base)` with a
    `joinBaseAndWebui(base, webui)` helper that PATH-CONCATENATES `base + webui` (collapsing the
    slash seam to exactly one `/`), then `new URL(<concatenated string>)` to validate it parses
    to an absolute `http(s)` URL. This preserves base's `/wiki` context path. All guards
    (missing/non-string/empty fields, relative-only base, non-http(s) protocol, never-throws)
    are unchanged → the omit-when-absent contract is untouched.
  - `src/main/integrations/confluenceWebUrl.test.ts` — re-pointed the happy path to the REAL
    Cloud shape (host-absolute `webui` WITHOUT `/wiki`) and added a regression assertion pinning
    that the output is NOT the old `/wiki`-less 404 URL.
  - `src/main/integrations/confluenceClient.test.ts` — corrected the `getPage` `_links` fixture
    to the real shape (`webui: '/spaces/ENG/pages/12345/Runbook'`), so it agrees with the fixed
    assembler instead of the old wrong assumption.
- **Title nav link (part 2):** ALREADY satisfied by #87 — `PageDetailTitle`
  (`src/renderer/confluenceCatalog/components.tsx:103`) renders the title itself as the inline
  external link with a trailing `ExternalLink` glyph, used by BOTH the native and gen-UI
  `PageDetail`. It reuses the EXISTING external-link idiom: a `target="_blank"` `<a>` whose
  navigation is routed to the system browser by the single `setWindowOpenHandler` →
  `shell.openExternal` hand-off in `src/main/index.ts:1617` (http(s)-only guard). No new
  component, IPC channel, scope, or token was introduced. **Choice:** kept the title-as-link
  placement and did NOT add a separate body link — the title affordance is the single, cleaner
  surface (the body link never existed separately; the title IS the affordance). Once the URL is
  correct the existing placement is exactly what the user asked for.

## Regression Test (Step 5)

- **Test:** `src/main/integrations/confluenceWebUrl.test.ts`
- **Asserts:** for the real Cloud `_links` shape
  (`base: 'https://acme.atlassian.net/wiki'`, `webui: '/spaces/ENG/pages/123/Title'`) the
  assembler returns `https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title` (corrected
  shape) AND explicitly `.not.toBe('https://acme.atlassian.net/spaces/ENG/pages/123/Title')`
  (the old 404 shape).
- **Fails-without-fix confirmed:** yes — the old `new URL(webui, base)` resolves that input to
  `https://acme.atlassian.net/spaces/ENG/pages/123/Title` (demonstrated via `node -e`), which
  fails both the corrected `.toBe(...)` and the explicit `.not.toBe(old shape)` assertion.

## Verification (Step 6)

- [x] `npm run typecheck` green for the changed Confluence files (remaining `index.ts`
  `renderPushedForRun` unused-var error is a concurrent track's transient, not in my files).
- [x] `npm test` green — full suite PASS (1883) FAIL (0), incl. the new regression test.
- [x] Original Step 1 reproduction re-run at the unit level — the assembler now keeps `/wiki`.
- [ ] UI surface exercised live — NOT run (no live Confluence/Electron session in this env). The
  fix is a pure URL string + the title-link render is unchanged from #87; logic is unit-covered.
- [x] No regressions in adjacent behavior — `confluenceWebUrl` has 1 caller (`getPage`); its
  test updated and the renderer `isOpenableWebUrl` guard (http(s) re-validation) is unaffected.

## Wrap-up (Step 7)

- **bug memory saved:** see memory_save below.
- **Docs updated:** none (no architecture/convention change; the omit-when-absent contract and
  the external-link idiom are unchanged).
- **wrap-up run:** pending (orchestrator).
