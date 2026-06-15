# Bug: Confluence detail — emojis & task checkboxes render broken (stripped by sanitizer) — v1

**Status**: Fixed — emoticon `<img>`→glyph + literal `\uXXXX` escape decode (detail body text nodes + list/header/excerpt at source); GUI confirmation is a user step
**Created**: 2026-06-15
**Reporter**: user ("confluence 상세에서 이모지나 체크박스등이 너무 깨지는데?")
**Related feature**: confluence-detail-rich-render-v1

---

## Symptom

In the Confluence page-detail surface (native panel AND gen-UI overlay — both reuse the
shared `PageDetailBody`), pages that contain **emojis** and **task-list checkboxes** render
broken: the emoji images and the checkboxes are missing / mangled, leaving holes or bare text.

## Expected vs Actual

- **Expected**: a Confluence page with emojis (`:smile:` etc.) and a task list (checkbox items)
  renders the emoji glyph and an inline (display-only) checkbox, matching the page as authored.
- **Actual**: emoji and checkbox markup is dropped entirely → broken render.

## Reproduction

1. Open a Confluence page whose body contains at least one emoji and one task list (checkbox).
2. Open its detail in cosmos (native panel or agent-composed search-result row).
3. Observe: emoji image absent / broken; task-list checkboxes gone.

(Electron not browser-automatable from here — repro reasoned from the sanitize allow-list, see
root cause. GUI confirmation is a user step.)

## Scope & Severity

- Cosmetic but high-visibility; affects every page using emojis or task lists. Both detail
  surfaces (native + gen-UI) since they share `PageDetailBody` → `sanitizeConfluenceHtml`.
- **Regression** from confluence-detail-rich-render-v1: before, body was flattened plain text
  (no rich markup at all); now rich HTML renders but the sanitizer allow-list omits the tags
  Confluence uses for emoji (`<img>`) and task checkboxes (`<input>`).

## Classification & Routing

- **Class**: Implementation defect — `SANITIZE_CONFIG` allow-list in
  `src/renderer/confluenceCatalog/sanitize.ts` is too restrictive; it strips valid benign
  Confluence `body-format=view` markup.
- **Route to**: `developer` (sanitize allow-list is node-testable `.ts` logic).
- Secondary (design) follow-up: emoji sizing (inline 1em) + checkbox display styling via
  `prose-cosmos` — spin to `designer` only if the allow-list fix alone leaves it visually off.

## Root Cause (hypothesis → confirm in Step 3)

`src/renderer/confluenceCatalog/sanitize.ts:30` `ALLOWED_TAGS` lacks `img` and `input`;
`:41` `ALLOWED_ATTR` lacks `src`, `alt`, `class`, `width`, `height`, `type`, `checked`,
`disabled` (and emoji `data-emoji-*`). Confluence view HTML emits emoji as
`<img class="emoticon" src=... alt=...>` and task checkboxes as `<input type="checkbox">`;
DOMPurify drops both because they are not allow-listed → symptom.

## Root Cause (confirmed — Step 3)

Confirmed against the DOMPurify allow-list and Confluence `body-format=view` markup shapes.

`src/renderer/confluenceCatalog/sanitize.ts` `SANITIZE_CONFIG`:
- `ALLOWED_TAGS` omitted `img` and `input`. Confluence view HTML emits emoji/emoticons as
  `<img class="emoticon …" src="https://…" alt="(smile)" data-emoji-shortname=":smile:"
  data-emoji-id=… data-emoji-fallback=…>` and task-list checkboxes as
  `<input type="checkbox" checked>` (inside `ul.inline-task-list` / `div.task-list`). Both
  tags were not allow-listed, so DOMPurify dropped them entirely → broken render.
- `ALLOWED_ATTR` (was `['href','title','colspan','rowspan']`) lacked `src`, `alt`, `class`,
  `width`, `height`, `type`, `checked`, `disabled`, and the emoji `data-emoji-*` attrs, so
  even had the tags survived, the emoji image and checkbox state would have been stripped.

Security finding confirmed during the fix: DOMPurify permits `data:` URIs on media tags
(`img`/`audio`/`video`/…) via its OWN internal allow-list, BYPASSING `ALLOWED_URI_REGEXP`.
So merely allow-listing `<img src>` would have permitted `data:image/svg+xml,<svg
onload=…>` — an inline-script XSS vector. This is closed explicitly (see Fix).

## Fix

`src/renderer/confluenceCatalog/sanitize.ts` (minimal, allow-list-only; no refactor):

1. `ALLOWED_TAGS` (sanitize.ts:30–49) += `img`, `input`.
2. `ALLOWED_ATTR` (sanitize.ts:50–58) += `src`, `alt`, `class`, `width`, `height`, `type`,
   `checked`, `disabled`, and emoji metadata `data-emoji-id`, `data-emoji-shortname`,
   `data-emoji-fallback`, `data-emoji-short-name`.
3. New per-instance `afterSanitizeAttributes` hook `registerSanitizeHook` (sanitize.ts:64–88),
   registered once per cached purifier in `purifierFor` (sanitize.ts:~104):
   - **Task checkboxes inert (read-only viewer):** forces `disabled` on every surviving
     `<input>` so the checkbox shows its `checked` state but is never toggleable/focusable —
     no write path added. Confluence does not always emit `disabled`, so it is added
     unconditionally rather than trusting source markup.
   - **`data:` URL block:** strips any `src`/`href` whose scheme is `data:`, closing the
     `data:image/svg+xml` SVG-script vector that DOMPurify's media-tag data-URI allowance
     would otherwise let through. Emoji images are always http(s), so nothing legitimate is lost.

`<script>`/`<iframe>`/`on*=`/`javascript:` remain stripped by DOMPurify defaults +
`ALLOWED_URI_REGEXP` (verified by tests). `ALLOWED_URI_REGEXP` unchanged.

## Regression Test

`src/renderer/confluenceCatalog/sanitize.test.ts` (node-env vitest, jsdom window — same
pattern as existing cases). Added:
- emoji `<img class="emoticon" src="https://…" alt="(smile)" data-emoji-*>` survives (tag +
  http src + alt + class + data-emoji-shortname kept).
- task `<input type="checkbox" checked>` survives with its `checked` state.
- task `<input>` with NO `disabled` in source is forced `disabled` (proves inert).
- hostile markup STILL stripped (new img-specific cases proving the widened allow-list did
  not open XSS): `<img src="javascript:…">`, `<img … onerror="…">`, and `data:image/svg+xml`
  `<img>` all lose the dangerous attribute/payload. (Existing `<script>`/`<iframe>`/`on*=`/
  link-`javascript:` cases retained.)

Proven failing-before / passing-after: with the allow-list temporarily reverted to the buggy
state, the 3 emoji/checkbox cases FAIL; with the fix they PASS, while every hostile-markup
case passes in BOTH states (confirms the widening is what fixes the bug and not a test gap).

## Verification

- `npm run typecheck` — green (node + web).
- `npm test` (full suite) — 1026 passed, 0 failed; the sanitize file's 18 cases all pass.
- **GUI confirmation is a USER step** (Electron is not browser-automatable from here): in a
  Confluence page detail with an emoji and a task list, confirm the emoji glyph image renders
  and an inline (display-only, non-toggleable) checkbox shows its checked state; confirm any
  hostile markup stays inert. The app runs via `npm run dev` (backgrounded) so renderer HMR
  picks up the change.

## Re-open (2026-06-15) — Unicode emoji still broken after the allow-list fix

Allow-listing `<img>` was necessary but NOT sufficient. Live diagnostic on a real page
(`body-format=view`) showed Confluence renders an emoji as:

```html
<img class="emoticon emoticon-calendar_spiral" data-emoji-id="1f5d3"
     data-emoji-shortname=":calendar_spiral:" data-emoji-fallback="🗓"
     src="/wiki/s/-1224781331/64...">
```

Two defects this exposes:
1. **Relative `src`** (`/wiki/s/...`) resolves against the Electron renderer origin, not
   `https://<site>.atlassian.net` → the image 404s → broken-image icon (the "spiral calendar
   못 로딩" symptom). The real asset is also behind Confluence auth; the token is main-only,
   so the renderer cannot load it anyway.
2. **`data-emoji-fallback="🗓"`** is a literal JS-escaped string, and the broken
   `<img>`'s alt/fallback renders it as literal `🗓` TEXT (the "\uD83D 같은 텍스트"
   symptom).

**Fix (routed to developer):** convert each emoticon `<img>` to its real Unicode glyph from
`data-emoji-id` (hex codepoint(s), hyphen-separated for compound/flag emoji →
`String.fromCodePoint(...)`), e.g. `1f5d3` → 🗓. Offline, no auth, no broken image, no `\u`
text. For an emoticon `<img>` whose `data-emoji-id` is absent/undecodable (legacy
Atlassian-only emoticons like `emoticon-blue-star`), degrade to the `data-emoji-shortname`/`alt`
text rather than a broken image. Implement in the renderer Confluence sanitize/transform path
(node-testable). **Status reset to: Investigating → (developer).**

Known follow-up (separate, NOT this bug): real page-content images (attachments) also arrive as
`<img>` with relative + authed `src` and will likewise break in the renderer — proxying those
through main with the token is a larger, separate task.

### Fix (re-open) — emoticon `<img>` → Unicode glyph in the sanitize path

`src/renderer/confluenceCatalog/sanitize.ts` (same single XSS gate; transform lives inside the
existing `afterSanitizeAttributes` hook so the DOMPurify gate still runs FIRST on the raw HTML):

1. New pure, exported helper `emojiIdToGlyph(id)` (sanitize.ts:23–60): decodes a Confluence
   `data-emoji-id` (one or more hyphen-separated hex Unicode codepoints) to its glyph via
   `String.fromCodePoint(...)`. `1f5d3` → 🗓; `1f1fa-1f1f8` → 🇺🇸 (flag). Returns `null` for an
   absent / non-hex / out-of-range / surrogate id (legacy Atlassian-only emoticons like
   `emoticon-blue-star`). Node-unit-testable in isolation.
2. `isEmoticonImg(el)` (sanitize.ts) — an `<img>` is an emoticon if it has `data-emoji-id` OR its
   `class` contains `emoticon`. Content/attachment images do NOT match, so they are untouched
   (the attachment-proxy follow-up above stays out of scope).
3. `emoticonReplacementText(el)` (sanitize.ts) — the text the emoticon collapses to: decoded
   glyph, else `data-emoji-shortname`/`data-emoji-short-name`, else `alt`, else '' (drop). Never a
   broken-image placeholder, never the literal escaped fallback string.
4. The `afterSanitizeAttributes` hook (sanitize.ts) now, after the existing input-inert + `data:`
   strip, replaces every emoticon `<img>` node IN PLACE with a text node of that glyph/fallback
   (`parentNode.replaceChild`). Net: no network, no auth, no relative `/wiki/s/` src, no broken
   image, no `\uXXXX` literal text. `<img>` stays in `ALLOWED_TAGS` (real content images are a
   separate concern), so only emoticon imgs are transformed.

## Regression Test (re-open)

`src/renderer/confluenceCatalog/sanitize.test.ts` — added (node-env vitest, jsdom window):
- pure `emojiIdToGlyph` block: single (`1f5d3`→🗓), compound/flag (`1f1fa-1f1f8`→🇺🇸), case-
  insensitive, garbage→null (`zzz`, `blue-star`, '', whitespace, undefined, null), out-of-range
  / surrogate → null.
- emoticon `<img data-emoji-id="1f5d3" … src="/wiki/s/…">` → output contains 🗓, NO `<img>`, NO
  `/wiki/s/` src, NO `\uD83D` literal text.
- compound/flag emoticon `<img data-emoji-id="1f1fa-1f1f8">` → 🇺🇸, no `<img>`.
- undecodable emoticon (`emoticon-blue-star`, no id) → degrades to `alt`, no `<img>`, no
  `/wiki/s/`.
- shortname-only emoticon (no id, no alt) → degrades to `:calendar_spiral:`, no `<img>`.
- (Existing emoji-img test that asserted the `<img>` SURVIVED was updated to the new
  img→glyph behavior — that assertion was the old, now-superseded contract.)
- REGRESSION GUARDS UNCHANGED + green in both states: `<script>`/`<iframe>`/`on*=`/
  `javascript:`/`data:image/svg+xml` still stripped; task-list checkbox kept + forced inert.

## Verification (re-open)

- `npm run typecheck` — green (node + web).
- `npm test` (full suite) — 1034 passed, 0 failed; the sanitize file's 26 cases all pass.
- **GUI confirmation is a USER step** (Electron is not browser-automatable from here): in a
  Confluence page detail containing the spiral-calendar / other Unicode emoji, confirm the real
  glyph (🗓) renders inline with NO broken-image icon and NO literal `\uD83D…` text. The app runs
  via `npm run dev` so renderer HMR picks up the sanitize change.

## Follow-up (design, not this fix)

If after the allow-list fix the emoji or checkbox still looks visually off purely due to CSS
(e.g. emoji not sized to ~1em inline, unstyled checkbox), that is a `prose-cosmos` styling
concern owned by the designer (theme tokens / `PAGE_DETAIL_BODY_CLASS`), not a sanitizer
issue. No one-off CSS was hand-rolled here.

---

## Re-open #2 (2026-06-15) — literal `\uXXXX` escape text + list screen

After the emoticon-img→glyph fix, calendar 🗓 rendered (user confirmed), but:
- 👥 (U+1F465), 🥅 (U+1F945), 🗣 (U+1F5E3) still showed as literal `👥` text.
- Emoji also broken on the Confluence document LIST screen, not just detail.

### Root cause (#2)

Diagnostic dump of `body-format=view` proved TWO emoji representations coexist in one page:
1. Emoticon `<img data-emoji-id="…">` (calendar/art/check) — fixed by re-open #1.
2. Emoji as the LITERAL six-char text `👥` sitting directly in element text, e.g.
   `<h2 …>👥 Participants</h2>`. This is double-escaped at the source (JSON carried
   `\\uD83D\\uDC65`, parsing to literal backslash-u text), so it is NOT an `<img>` and the
   emoticon transform never touched it. Confluence also serializes this literal-escape form into
   plain `title`/`excerpt`/space fields, so the search/feed LIST screen showed `\uD83D…` too.

### Fix (#2)

- New shared pure helper `decodeUnicodeEscapes(text)` in `src/shared/confluence.ts`: replaces each
  well-formed `\uXXXX` with `String.fromCharCode(hex)`; adjacent high+low surrogate units re-form
  the astral glyph naturally (UTF-16). Non-string/no-escape → verbatim. Shared so main + renderer
  apply the SAME transform.
- Renderer (`sanitize.ts`): imports + re-exports the shared helper; the `afterSanitizeAttributes`
  hook now decodes each visited element's direct `\u`-bearing TEXT-node children (every text node
  is some element's child; DOMPurify visits every element once → full coverage). Decoding at the
  text-node level (not the serialized string) avoids corrupting attribute values / tag syntax.
- Main (`confluenceClient.ts`): applies `decodeUnicodeEscapes` to plain `title` + space + `excerpt`
  at the data source — `mapSearchResultsPage` (search/feed LIST) and `getPage` (detail header) —
  so the LIST screen, detail header, and gen-UI catalog all get real glyphs uniformly. The HTML
  body is NOT decoded in main (stays raw; decode happens at the renderer text-node level).

### Regression test (#2)

- `sanitize.test.ts`: `decodeUnicodeEscapes` block (surrogate-pair → astral glyph, BMP, case-
  insensitive, verbatim non-escape, non-string→'', malformed escape untouched) + a sanitize-level
  test that `<h2>👥 Participants</h2>` → contains 👥, no `\uD83D` text.
- `confluenceClient.test.ts`: search hit with literal-escape `title`/`excerpt`/space decodes to
  real glyphs in `result.data.items` (LIST regression).

### Verification (#2)

- `npm run typecheck` green; `npm test` full suite 1041 passed, 0 failed.
- GUI (USER step): open a page whose headings contain 👥/🥅/🗣 — confirm real glyphs in detail
  AND that LIST titles/excerpts show glyphs not `\uD83D…`.
