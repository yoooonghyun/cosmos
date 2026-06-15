# Plan: Confluence Detail — Real-Id Open + Rich Render — v1

**Status**: Draft
**Created**: 2026-06-15
**Last updated**: 2026-06-15
**Spec**: .sdd/specs/confluence-detail-rich-render-v1.md

---

## Grounding

- `codegraph_explore` "CONFLUENCE_TOOL_DESCRIPTION confluenceRenderUiServer SearchResultRow confluenceNav openDetail" + Read confluenceRenderUiServer.ts:156-222 — catalog says "DISPLAY-ONLY: no actions" + example seeds `"id":"1"`; the row's `id` is dispatched as `pageId` to `getPage`.
- `codegraph_explore` "confluenceClient getPage storageToPlainText ConfluencePageDetail body-format storage" — `getPage` (confluenceClient.ts:254-283) requests `?body-format=storage`, flattens via `storageToPlainText(storage.value)`. Errors already route via `mapConfluenceError` (line 68/175) to a recoverable Notice — so a bad id degrades safely TODAY (the 500 is shown, not crashed). The bug is the WRONG id, fixed by the catalog instruction.
- Grep `isOpenDetailEmittable` (confluenceCatalog/logic.ts:31) — existing renderer guard is non-empty/non-whitespace; tests at logic.test.ts. Keep AS-IS (OQ1 resolved: numeric guard cannot catch "1").
- Read ARCHITECTURE.md:548-549 — documents `body-format=storage` page reads; supersede to `view` + rich render (the "design Q2 plain text / no macro rendering" note is now stale).
- Read DEVELOPMENT.md:298-323 + Grep index.css — Tailwind v4 is CSS-first (`@import "tailwindcss"` at index.css:1; plugins register via `@plugin` in index.css, NOT a JS `tailwind.config`). `prose` utilities land in `@layer utilities`; unlayered App.css rules beat them (cascade-layer gotcha).
- `memory_recall`/`memory_smart_search` confluence detail — empty (per spec grounding).

## Summary

Fix the gen-UI row-click 500 by rewriting the `render_confluence_ui` catalog description so the
model uses the REAL Confluence page id (from `confluence_search_content`) as `SearchResultRow.id`,
and correcting the stale "no actions" wording. Independently, upgrade page-detail readability:
`getPage` requests `body-format=view` (Confluence server-rendered HTML), the HTML is carried through
the `ConfluencePageDetail` contract, and the SHARED `PageDetail` render surface (native panel +
gen-UI overlay) displays it sanitized with DOMPurify and styled with `@tailwindcss/typography`
`prose`. Graceful degradation (empty body, unsupported macros, getPage 500/404) reuses the existing
`mapConfluenceError` → Notice path. Read-only; no new scopes; no secret ever leaves main.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer), Tailwind v4 CSS-first |
| Key dependencies  | `dompurify` (+ `@types/dompurify`), `@tailwindcss/typography` (dev) — exact versions/APIs confirmed via context7 at design/implement; do NOT pin here |
| Files to create   | none expected (sanitize helper may live in a new `src/renderer/...` `.ts` for node-testability — decide at implement) |
| Files to modify   | `src/mcp/confluenceRenderUiServer.ts` (catalog desc), `src/main/integrations/confluenceClient.ts` (`getPage` body-format=view + HTML mapping), `src/shared/confluence.ts` (`ConfluencePageDetail` body contract), `src/shared/validate.ts` + `src/shared/ipc.ts` (page-detail payload validation if a typed channel exists), `src/renderer/confluenceCatalog/components.tsx` (`PageDetail` rich render), `src/renderer/ConfluencePanel.tsx` (native `PageDetail` rich render), `src/renderer/index.css` (`@plugin "@tailwindcss/typography"`), `docs/ARCHITECTURE.md` |

---

## Implementation Checklist

> Update as work progresses. Steps ordered as the SDD steps that follow.

### Phase 2.5 — Design (UI-bearing; designer owns, no Bash)

- [ ] Design spec at `.sdd/designs/confluence-detail-rich-render-v1.md`: the `prose` typography
      treatment for the shared `PageDetail` (headings/lists/tables/links/code/emphasis) tuned to the
      cosmos theme tokens (dark + light), constrained to a `prose` container.
- [ ] All states designed: loading (skeleton, reuse `PageDetailSkeleton`), empty-body ("no readable
      body" safe state), recoverable error (Notice above stale content), sanitized/normal render.
- [ ] Confirm the `prose` container does NOT leak styles into surrounding panel chrome; scope it.
- [ ] Note the cascade-layer risk (DEVELOPMENT.md): `prose` utilities are layered; ensure no
      unlayered App.css rule overrides them.

### Phase 3 — Interface (contracts only)

- [x] `src/shared/confluence.ts`: `ConfluencePageDetail.body` semantics changed to
      "Confluence server-rendered HTML (body-format=view), sanitized in the renderer before
      display." Kept the field a SINGLE `string` (no new field / no discriminator — minimal,
      per DECISIONS). Kept `id`/`title`/`space?`.
- [x] `src/shared/validate.ts`: added `validateConfluencePageDetail` (the page-detail RESULT
      payload validator, FR-009): `id`/`title` strings + `body` string (`''` allowed — empty
      body is valid, FR-012), `space?` string when present; invalid → warn + null (ignore),
      never crash. The request payload validator (`validateConfluenceGetPage`, pageId) already
      exists; no NEW channel string added (detail crosses via the existing `confluence:getPage`
      invoke result + the bound `/page` data-model value).
- [x] Review contract vs spec — no invented properties; FR-006/FR-009 traced.

### Phase 4 — Tests (node-env vitest; `.ts` logic ONLY, no `.tsx`/DOM import)

- [x] Catalog description: `src/mcp/confluenceToolDescription.test.ts` asserts it states
      `SearchResultRow.id` = real page id from `confluence_search_content`, no longer claims "no
      actions", and the example id is not `"id": "1"` (FR-001/002/003). RED now (2 of 4 fail
      against the stale string); green after the Step-5 rewrite. NOTE: the description was
      EXTRACTED into a new side-effect-free module `src/mcp/confluenceToolDescription.ts` (the
      server runs `main()` at import, so it can't be imported into a node test) and re-imported
      by `confluenceRenderUiServer.ts` — pure refactor, no behavior change.
- [x] Sanitize logic: `src/renderer/confluenceCatalog/sanitize.test.ts` (12 GREEN) asserts
      `<script>`/`<iframe>`/`on*=`/`javascript:` stripped and benign rich HTML
      (h1-h4/ul-ol-li/table/a[href]/code-pre/blockquote/strong-em/hr) survives (FR-008/SC-003).
      Tests the pure helper `sanitizeConfluenceHtml` in `confluenceCatalog/sanitize.ts` (NOT a
      `.tsx`); node env passes a jsdom window. **Build-wiring:** installed `jsdom` + `@types/jsdom`
      as devDependencies (jsdom was not present).
- [x] Validator: 8 GREEN cases in `validate.test.ts` — valid HTML-bearing detail passes
      (incl. empty `body` + missing `space`); missing/non-string `body`/`id`/`title`/bad `space`
      warned + ignored (FR-009/SC-007).
- [x] Body mapping: DONE in Step 5 — extracted pure `pageViewBody(responseBody)` in
      `confluenceClient.ts` (reads `body.view.value`, '' for missing/non-string/non-object);
      3 unit cases in `confluenceClient.test.ts` + the getPage integration test now assert
      `body-format=view` + raw HTML returned + empty→''.

### Phase 5 — Implement

- [x] Rewrote `CONFLUENCE_TOOL_DESCRIPTION` (`confluenceToolDescription.ts`): states
      SearchResultRow.id MUST be the REAL page id from `confluence_search_content` (clicking
      opens that page), NEVER positional; corrected the actionable wording; example id now
      `"131073"` with the "illustrative only, never copy" caveat kept (FR-001/002/003). The 2
      red catalog tests are GREEN.
- [x] `getPage` (confluenceClient.ts): requests `?body-format=view`, maps `body.view.value`
      via pure `pageViewBody`, carries RAW HTML through the contract; error routing via
      `mapConfluenceError` unchanged (FR-005/FR-012). Doc comment updated (dropped "flattened
      plain text / design Q2"); removed the now-unused `storageToPlainText` import.
- [x] Shared `PageDetail` rich render: NEW exported `PageDetailBody` + `PAGE_DETAIL_BODY_CLASS`
      in `confluenceCatalog/components.tsx` — ONE component used by BOTH the catalog `PageDetail`
      AND the native `ConfluencePanel.PageDetail` (SC-002 identical output). Renders
      `sanitizeConfluenceHtml(body)` inside `prose prose-sm prose-cosmos max-w-none break-words`
      via `dangerouslySetInnerHTML` (DOMPurify-first — the one sanctioned raw-HTML site,
      FR-007/FR-008). Empty sanitized body → existing "no readable body" state (FR-012). Enhanced
      `PageDetailSkeleton` to foreshadow rich content (design §5).
- [x] Kept `isOpenDetailEmittable` as-is (non-empty guard) — untouched (OQ1).
- [x] `index.css`: `@plugin "@tailwindcss/typography";` after `@import "tailwindcss";` +
      `@utility prose-cosmos { --tw-prose-* → cosmos tokens + code-chip/pre/table/img tunings }`
      (design §7). NO `.prose` rule added to App.css (cascade-layer gotcha). Build confirms
      `prose-cosmos`/`prose-sm`/`--tw-prose-body` emitted into the compiled CSS.
- [x] `npm run typecheck` + `npm test` green (54 files, 1020 tests). `npm run build` exit 0.

### Build-wiring (developer/main session — designer has no Bash)

- [x] `npm install -D jsdom @types/jsdom` (Phase 4: the node-env sanitize test needs a DOM for
      DOMPurify; jsdom was not a dep). `dompurify@^3.4.10` already present (ships own types — do
      NOT add `@types/dompurify`). The new `src/mcp/confluenceToolDescription.ts` bundles
      transitively via the existing `mcp/confluenceRenderUiServer` rollup input — no new input.
- [x] `@tailwindcss/typography@^0.5.20` already installed — verified, NOT reinstalled.
- [x] Registered `@plugin "@tailwindcss/typography";` in `src/renderer/index.css`; prose kept fully
      layered (defined as `@utility`), NO unlayered App.css `.prose` rule (cascade-layer gotcha,
      DEVELOPMENT.md:300). Cascade WIN can only be fully confirmed in the running app (see GUI repro).

### Phase 6 — Docs

- [ ] `docs/ARCHITECTURE.md`: update the Confluence read line (~548) from
      `body-format=storage` plain-text to `body-format=view` sanitized rich render; remove the stale
      "design Q2 / no macro rendering" framing for page detail.
- [ ] Update this plan's Deviations with any actual package APIs/versions chosen via context7.
- [ ] `memory_save` the rich-render + real-page-id decisions.

---

## Risks & Notes

- **XSS is the load-bearing risk** — HTML from Confluence is untrusted; DOMPurify MUST run before any
  `dangerouslySetInnerHTML`. This is the one place the project relaxes the no-raw-HTML rule, gated on
  sanitization. Covered by a node-env sanitize test (no DOM-component test).
- **Cascade-layer** — `prose` is a layered utility; an unlayered App.css rule can silently beat it
  (DEVELOPMENT.md gotcha). Verify in the running app, not just typecheck.
- **`body-format=view`** returns rendered HTML for macros too; unsupported/dynamic macros degrade to
  whatever `view` emits, then sanitization strips anything unsafe — acceptable per FR-012.
- **Contract migration** — changing `ConfluencePageDetail.body` touches every consumer (native +
  gen-UI overlay share the component, so one render change covers both); confirm no other reader
  depends on the plain-text shape.

## Deviations & Notes

- **2026-06-15**: Plan authored. OQ1 (no strict-numeric guard) + OQ2 (`body-format=view` + DOMPurify
  + `@tailwindcss/typography`) baked in per approval. Versions intentionally unpinned — context7 at
  design/implement.
