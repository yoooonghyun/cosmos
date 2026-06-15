# Design: Confluence Detail — Rich Render — v1

**Status**: Draft
**Created**: 2026-06-15
**Spec**: .sdd/specs/confluence-detail-rich-render-v1.md
**Plan**: .sdd/plans/confluence-detail-rich-render-v1.md
**Owner**: designer

---

## Grounding (queries actually run this session)

- `memory_recall "confluence design system prose typography"` — empty (no prior prose decision stored).
- Read `.sdd/specs/confluence-detail-rich-render-v1.md` + `.sdd/plans/...` — confirmed `body-format=view`
  server-rendered HTML, DOMPurify sanitize, ONE shared `PageDetail` (native + gen-UI overlay), all states
  required (loading/empty/error/sanitized).
- Read `src/renderer/ConfluencePanel.tsx:82-94,253-315` (native `PageDetail` + `PageDetailSkeleton`) and
  `src/renderer/confluenceCatalog/components.tsx:235-272` (gen-UI catalog `PageDetail`, `body` is `Bound<string>`
  resolved via `useBound`) — BOTH render body as `whitespace-pre-wrap` `<p>`; both keep title/space chrome
  OUTSIDE the body container.
- Read `src/renderer/index.css` — Tailwind v4 CSS-first (`@import "tailwindcss"` line 1); tokens mapped in
  `@theme inline` + `.dark` block; app forces `.dark` at runtime (`:root` is a light fallback only). Precedent:
  CosmosSpinner keyframes are PLAIN UNLAYERED CSS to beat layered utilities (lines 142-203).
- Read `src/renderer/App.css` — unlayered plain CSS (`.app*` rules). This is the file the DEVELOPMENT.md
  cascade gotcha warns about.
- Read `docs/DEVELOPMENT.md:298-304` — "Tailwind v4 utilities lose to unlayered plain CSS" (layer gotcha).
- context7 / typography docs — `@plugin "@tailwindcss/typography";` registers in v4; prose is themed via
  `--tw-prose-*` custom properties; `prose-invert` is a separate hand-designed dark palette (hardcoded grays).

---

## 1. Decision summary (read this first)

| Decision | Choice | Why |
|----------|--------|-----|
| Dark treatment | **Custom token-mapped `prose-cosmos` utility, NOT `prose-invert`** | cosmos is single-mode dark (forced `.dark`), so there is no light↔dark prose toggle to drive. `prose-invert` ships its OWN hardcoded gray scale that ignores cosmos tokens and would drift from the panel. Mapping `--tw-prose-*` to existing theme vars keeps the body identical to surrounding chrome. |
| Scope | `prose prose-sm prose-cosmos` on the **body container only** | Title (`h2`), space `Badge`, Notice chrome stay outside `prose` so the plugin never restyles panel UI. |
| Layer safety | Define `prose-cosmos` as a Tailwind **`@utility`** in `index.css` (layered with other utilities) — no unlayered `App.css` rule may target `.prose` | App.css unlayered rules beat layered utilities; keep all prose styling inside the Tailwind layer so it is not silently overridden, and add NO `.prose` rule to App.css. |
| Render site | `dangerouslySetInnerHTML` **only** after DOMPurify, inside the scoped `prose` container | The one sanctioned raw-HTML site (FR-008). |

---

## 2. Surfaces & layout

ONE shared surface, two mount points — they MUST render identically (SC-002):

- **Native panel** `PageDetail` — `src/renderer/ConfluencePanel.tsx:253`, inside `<ScrollArea className="h-full">`.
- **Gen-UI overlay** catalog `PageDetail` — `src/renderer/confluenceCatalog/components.tsx:235`.

Structure (unchanged outer layout — `flex flex-col gap-4 p-3`):

```
ScrollArea (native) / div (gen-UI)
└─ div.flex.flex-col.gap-4.p-3
   ├─ [error Notice]        ← gen-UI bound error / native ErrorState (above body)
   ├─ header (NOT prose)
   │  ├─ h2  title          ← text-base font-medium leading-snug text-foreground
   │  └─ Badge space        ← variant="outline", existing chip
   └─ body region
      ├─ populated:  <div class="prose prose-sm prose-cosmos max-w-none break-words"
      │                   dangerouslySetInnerHTML={{ __html: sanitized }} />
      └─ empty:      <p class="text-sm text-muted-foreground">This page has no readable body.</p>
```

Notes:
- `max-w-none` — prose defaults to `max-width: 65ch`; the panel is a fixed narrow rail, so cap removal lets
  the body fill the column. Keep `break-words` for long unbroken tokens/URLs.
- The body container replaces the current `<p className="whitespace-pre-wrap ...">`. Nothing else in the
  layout moves.

## 3. Tokens used

No NEW global theme tokens. The `prose-cosmos` utility maps the typography plugin's `--tw-prose-*` knobs onto
EXISTING cosmos vars (defined in `index.css` `.dark`):

| `--tw-prose-*` | cosmos var | Element | Dark value |
|----------------|-----------|---------|-----------|
| `body` | `var(--card-foreground)` | paragraphs, list text | `#e0e0e0` |
| `headings` | `var(--foreground)` | h1–h4 | `#e0e0e0` |
| `lead` | `var(--card-foreground)` | lead paragraph | `#e0e0e0` |
| `links` | `var(--primary)` | `<a>` | `#4a9eff` |
| `bold` | `var(--foreground)` | strong/b | `#e0e0e0` |
| `counters` | `var(--muted-foreground)` | `<ol>` markers | `#888888` |
| `bullets` | `var(--muted-foreground)` | `<ul>` markers | `#888888` |
| `hr` | `var(--border)` | `<hr>` | `#333333` |
| `quotes` | `var(--muted-foreground)` | blockquote text | `#888888` |
| `quote-borders` | `var(--border)` | blockquote left rule | `#333333` |
| `captions` | `var(--muted-foreground)` | fig/table captions | `#888888` |
| `code` | `var(--foreground)` | inline `<code>` | `#e0e0e0` |
| `pre-code` | `var(--card-foreground)` | fenced block text | `#e0e0e0` |
| `pre-bg` | `var(--muted)` | fenced block bg | `#252526` |
| `th-borders` | `var(--border)` | table header borders | `#333333` |
| `td-borders` | `var(--border)` | table cell borders | `#333333` |

Inline `<code>` also gets a chip treatment (see §4) using `var(--muted)` bg + `var(--border)` so it reads as a
token, not raw text — matching the fenced-block surface.

## 4. Element coverage (h1–h4, lists, tables, links, code, blockquote, em/strong, hr, images)

`prose prose-sm` already styles all of these structurally (margins, weights, list markers, table layout); the
token map in §3 supplies the COLORS. Specific tunings the `@utility` must add on top of the plugin defaults:

- **Headings h1–h4** — color `--tw-prose-headings`. `prose-sm` scale is fine for a narrow panel; the page
  `<h1>` may equal the panel `h2` title visually — acceptable (it is page content, not chrome).
- **Inline `<code>`** — plugin renders backtick-bare; add chip styling in the utility:
  `padding: 0.15em 0.4em; border-radius: var(--radius-sm); background: var(--muted); border: 1px solid var(--border);`
  and remove the plugin's default `` `…` `` pseudo-quotes (`--tw-prose-code` + `prose-code:before:content-none
  prose-code:after:content-none`).
- **Fenced `<pre><code>`** — bg `--tw-prose-pre-bg` (`--muted` #252526), text `--tw-prose-pre-code`, rounded
  `var(--radius-md)`, `overflow-x-auto` so wide code scrolls (panel stays responsive on large pages).
- **Tables** — `prose` gives borders via `--tw-prose-th/td-borders` (`--border`). Wrap behaviour: tables can
  exceed the rail width; rely on the body container's horizontal scroll within `ScrollArea` (do NOT force-shrink).
- **Links** — `--primary` (#4a9eff), underline on hover via `prose-a:underline-offset-2`. External links open
  in-app context only; no new nav behavior added here.
- **Blockquote** — left border `--border`, italic muted text via `--tw-prose-quotes`.
- **Emphasis/strong** — `em` italic (inherits body color), `strong` bold colored `--tw-prose-bold`.
- **Horizontal rule** — `--tw-prose-hr` (`--border`).
- **Images** — best-effort. Remote Confluence images require auth and will NOT load (no token-bearing fetch is
  added — FR-010/FR-011). Graceful fallback: style `prose-img:rounded-md prose-img:border prose-img:border-border`
  and rely on the browser's native broken-image box; add `img { min-height: 0 }` so a failed load collapses to a
  thin bordered placeholder rather than a tall empty gap. Do NOT add `onerror` JS or alt-fetching. `alt` text (if
  present in the sanitized HTML) remains the accessible fallback.

## 5. States (all four)

| State | Trigger | Treatment |
|-------|---------|-----------|
| **Loading** | `loading === true` (native: before `getPage` resolves; gen-UI: bound `loading`) | **Keep `PageDetailSkeleton`** (`ConfluencePanel.tsx:82`). Extend it to better foreshadow rich content: keep the title + chip skeletons, then render a heading-sized bar (`h-4 w-1/2`) + 3 paragraph line groups + one wide block (`h-16 w-full rounded-md`) to hint at a code/table block. `aria-busy="true"` stays. The gen-UI catalog `PageDetail` keeps its `aria-busy={isLoading}` wrapper and shows its bound error notice above stale content (no full skeleton swap — refreshable-binding behavior, FR-013). |
| **Empty body** | sanitized body is empty/whitespace (`hasReadableBody` false) | Existing safe state: `<p class="text-sm text-muted-foreground">This page has no readable body.</p>`. Title + space chip still render above. Never render an empty `prose` container. |
| **Error** | native: `getPage` 404/500 → `ErrorState`; reconnect → `ReconnectState`; gen-UI: bound `error` string → `Notice`/`BoundListError` ABOVE stale content | Reuse the existing `ErrorState` / `Notice` (catalog `Notice`, `variant="destructive"`). No new error component. 404 and 500 both resolve through `mapConfluenceError` to a recoverable Notice — never a crash (FR-012). |
| **Sanitized / populated** | DOMPurify-cleaned HTML, non-empty | Rich `prose-cosmos` render. Hostile markup (`<script>`, `<iframe>`, `on*=`, `javascript:`) is stripped BEFORE injection; the surviving structure renders normally — the page still reads, just without the stripped nodes. Unsupported macros degrade to whatever `body-format=view` emitted, then sanitize trims unsafe bits. |

## 6. Interaction & accessibility

- **Render is read-only** — no controls inside the body. Focus order unchanged: title → space chip → existing
  panel footer/nav. Sanitized links are keyboard-focusable (native `<a>`); contrast of `--primary` #4a9eff on
  `#1b1b1c` card passes for body link text.
- **Contrast** — all mapped colors are existing cosmos tokens already vetted on the dark palette: body
  `#e0e0e0` on `#1b1b1c` (high), muted markers/quotes `#888888` (secondary, acceptable for non-essential
  markers), code chip `#e0e0e0` on `#252526`.
- **Sanitized HTML a11y** — DOMPurify preserves semantic tags (`<h*>`, `<ul>`, `<table>`, `<a>`), so screen
  readers get real structure. Keep table semantics; do not strip `<th scope>`.
- **`prefers-reduced-motion`** — no animation introduced; nothing to gate.

## 7. Cascade-layer approach (the load-bearing gotcha)

DEVELOPMENT.md:300 — unlayered plain CSS beats layered Tailwind utilities regardless of specificity. The
typography plugin emits `.prose` into the Tailwind utilities layer.

Approach:
1. Register the plugin and define the cosmos prose variant as a Tailwind **`@utility`** in `index.css` (it
   lands in the SAME layered Tailwind cascade as `.prose`). Example shape:
   ```css
   @plugin "@tailwindcss/typography";

   @utility prose-cosmos {
     --tw-prose-body: var(--card-foreground);
     --tw-prose-headings: var(--foreground);
     --tw-prose-links: var(--primary);
     --tw-prose-bold: var(--foreground);
     --tw-prose-counters: var(--muted-foreground);
     --tw-prose-bullets: var(--muted-foreground);
     --tw-prose-hr: var(--border);
     --tw-prose-quotes: var(--muted-foreground);
     --tw-prose-quote-borders: var(--border);
     --tw-prose-captions: var(--muted-foreground);
     --tw-prose-code: var(--foreground);
     --tw-prose-pre-code: var(--card-foreground);
     --tw-prose-pre-bg: var(--muted);
     --tw-prose-th-borders: var(--border);
     --tw-prose-td-borders: var(--border);
   }
   ```
   (The inline-`<code>` chip + img/pre tunings in §4 are applied as `prose-code:* prose-pre:* prose-img:*`
   utility classes ON the element alongside `prose-cosmos`, OR added inside this `@utility` block — developer's
   choice, both stay layered.)
2. **Do NOT add any `.prose` / `.prose *` rule to `App.css`** (or any other unlayered stylesheet). An unlayered
   rule there would silently beat the plugin. App.css must remain limited to `.app*` chrome.
3. The `@theme inline`/`.dark` token vars already live in the right place; `prose-cosmos` only references them, so
   dark values flow through automatically.

## 8. Build wiring — HAND OFF TO DEVELOPER (designer has no Bash)

1. `npm install -D @tailwindcss/typography` (plan says `^0.5.20` already present — verify; if so, skip install).
2. In `src/renderer/index.css`, add `@plugin "@tailwindcss/typography";` immediately AFTER
   `@import "tailwindcss";` (line 1), and add the `@utility prose-cosmos { … }` block from §7 (place it near the
   `@theme inline` block so the token references read together).
3. `npm install dompurify @types/dompurify` (sanitize dependency from the plan).
4. After wiring, verify in the RUNNING app (not just typecheck) that prose styles win — open a page with a
   heading + list + code block and confirm cosmos colors apply (cascade-layer risk per §7).

> Designer MAY edit `index.css` tokens, but the `@plugin` registration + the install are build-wiring, so this
> spec hands them to the developer rather than editing the `@plugin` line directly. The `@utility prose-cosmos`
> block is a design-token artifact — designer may author it, but it is grouped with the `@plugin` handoff so the
> registration and the utility land together.

## 9. Open questions

- None blocking. The image-auth limitation (remote Confluence images not loading without a token) is an accepted
  constraint (FR-010/FR-011), handled by the graceful broken-image fallback in §4 — not an open question.

## 10. Risks

- **Cascade-layer regression** — if a future unlayered `App.css` rule ever targets `.prose`, it silently wins.
  Mitigated by §7.2 (keep prose fully layered) + the running-app verification in §8.4.
- **Wide tables / code on a narrow rail** — addressed by `overflow-x-auto` on `pre` and table scroll within
  `ScrollArea`; surface stays responsive (FR-012 "very large pages").
- **Two mount points drifting** — native and gen-UI `PageDetail` must apply the IDENTICAL
  `prose prose-sm prose-cosmos max-w-none break-words` class set and the SAME sanitize helper, or SC-002
  (identical output) fails. Specify the class string once and reuse.
