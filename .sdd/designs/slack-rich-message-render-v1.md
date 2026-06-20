# Design: Slack Rich Message Render — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/slack-rich-message-render-v1.md
**Plan**: .sdd/plans/slack-rich-message-render-v1.md
**Owner**: designer

> Sits at SDD Step 2.5 (between plan and interface). This pass adds the visual contract for
> the new render runs inside the Slack message body — inline emoji (glyph + custom image),
> resolved mentions, attachment thumbnails, and the broken-image affordance — on the ONE
> canonical `SlackMessageRow`, so both the native Slack panel and the generated A2UI Slack
> surface render identically.

---

## Grounding (queries actually run this session)

**Reads (verbatim source treated as read):**
- `.sdd/specs/slack-rich-message-render-v1.md` + `.sdd/plans/slack-rich-message-render-v1.md`
  — the four behaviors (mention / standard emoji / custom emoji / image), the DTO decision
  (Track A: `text` stays a plain string carrying resolved mentions + standard glyphs; custom
  emoji left as `:name:` markers + a per-message `{ shortcode: ref }` map; image attachments as
  a list of `{ ref, alt?, w?, h? }`), the runs-parser plan (`messageContent.ts`, Track E), and
  the `cosmos-slack-img://` protocol mirror of Confluence (Track D).
- `src/renderer/slackCatalog/SlackMessageRow.tsx` — the canonical row: `Avatar size="sm"` ·
  name(truncate) · timestamp(shrink-0) · `<p className="whitespace-pre-wrap break-words text-sm
  text-card-foreground">{text}</p>` · `RepliesAffordance`. Row clamp `w-full min-w-0`; body column
  `min-w-0 flex-1`. THE single body `<p>` is what this feature replaces with runs.
- `src/renderer/slackCatalog/components.tsx` — generative path: catalog `MessageRow` wraps
  `SlackMessageRow` (spreads `ts/userId/userName/text/replyCount` + `onOpenThread`);
  `SearchResultRow` is NOT folded in but reuses the identical body shell + the same
  `whitespace-pre-wrap break-words text-sm text-card-foreground` `<p>`. Both must gain the same
  runs body. The custom-emoji ref map + image refs are NEW node props that must thread through.
- `src/renderer/confluenceCatalog/contentImageSrc.ts` — the renderer-half precedent for opaque
  image refs: classify → rewrite `src` to `cosmos-confluence-img://confluence/<base64url(ref)>`;
  renderer never holds a token; `min-height:0` + bordered box collapses a broken image to a thin
  placeholder, not a tall gap. `cosmos-slack-img://` mirrors this exactly.
- `src/renderer/index.css` — full token set (`@theme inline` + `.dark`). Confirmed existing
  tokens cover everything this feature needs (`--card-foreground`, `--muted-foreground`,
  `--border`, `--muted`, `--accent`, `--primary`, `--ring`, `--radius-*`). The `prose-cosmos`
  `@utility` already establishes the house broken-image treatment (`& :where(img) { border-radius:
  var(--radius-md); border: 1px solid var(--border); min-height: 0 }`).
- `.sdd/designs/confluence-detail-rich-render-v1.md` §4 — the house broken-remote-image rule
  (rounded + bordered + `min-height:0`, native broken-image box, `alt` as accessible fallback, NO
  `onerror` JS). This design reuses that posture for Slack thumbnails + custom-emoji images.
- `.sdd/designs/slack-generative-message-parity-v1.md` §2/§7 — the canonical-row anatomy + the
  house verdict "no new token" for Slack surfaces; the exact wrap classes this design must preserve.

**Memory:**
- `memory_recall "Slack message row design tokens custom emoji image rendering visual decisions"`
  → empty. No prior design records for this feature area; grounded from code + sibling designs.

---

## 0. Decision summary (read this first)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Standard emoji** | Glyph in the text flow — NO styling, NO image. Already substituted into `text` upstream (Track C); the row renders it as ordinary text. Zero visual cost. |
| 2 | **Custom emoji** | Inline `<img>` sized to the cap-height of the line: `h-[1.25em] w-auto`, `inline-block align-text-bottom`, `select-none`, `rounded-[2px]`. Reads as a glyph sitting on the baseline, not a thumbnail. |
| 3 | **Resolved mention** | `@DisplayName` as a subtle accent: `font-medium text-primary` on the whole `@name` run. Distinguishes a person from body text without a chip/pill (lazy). Unresolved `@<userId>` stays plain body text. |
| 4 | **Attachment thumbnails** | A thumbnail BLOCK below the text: each image capped at `max-h-60 max-w-full`, `rounded-md border border-border`, `object-contain`, lazy-loaded. 1 image → single; 2+ → a 2-column `grid gap-1.5`. No lightbox in v1 (open-in-default-browser on click is the only affordance, and only if trivially wired; otherwise non-interactive). |
| 5 | **Broken image** (custom emoji OR attachment) | Reuse the Confluence posture: a thin bordered placeholder via `min-height:0` + native broken-image box. Custom emoji additionally falls back to the literal `:shortcode:` text (the most readable affordance at glyph scale). Attachments show a small bordered placeholder box with an `ImageOff` glyph + the `alt`/"image" caption. |
| 6 | **New token / primitive** | **NONE.** Every treatment is expressible in existing tokens + Tailwind utilities. This holds the Slack-surface "no new token" line (parity design §7). |

The body's render contract is the same on both surfaces because both consume the one
`SlackMessageRow`. Design once, wired twice.

---

## 1. Surfaces & layout

ONE shared presentational component, two mount points (must render identically — SC-008):

| Surface | Where | What changes |
|---------|-------|--------------|
| **`SlackMessageRow`** | `src/renderer/slackCatalog/SlackMessageRow.tsx` — imported by `SlackPanel.tsx` (native, history + thread) and catalog `MessageRow` (`components.tsx:228`) | The single `<p>{text}</p>` body becomes a **runs body** (`MessageBody`) + an **attachment-thumbnails block** (`MessageImages`). Everything else (avatar · name · timestamp · replies affordance · row clamp) is unchanged. |
| Catalog `MessageRow` | `components.tsx:228` | Threads the NEW node props — the per-message custom-emoji ref map and the image-attachment ref list — through to `SlackMessageRow` (alongside today's `ts/userId/userName/text/replyCount`). |
| `SearchResultRow` | `components.tsx:339` | NOT folded into `SlackMessageRow`, but its body `<p>` is replaced with the SAME `MessageBody` runs render (it carries mentions/emoji too). Search rows do NOT render attachment thumbnails in v1 (search matches carry text, not files — out of scope; if a search match later carries refs, the same `MessageImages` block applies). |

The row stays purely presentational: NO data fetch, NO `useBound`/SDK hooks. Custom-emoji + image
refs are opaque strings handed in via props; the row only maps them to `<img src>` (Track D codec
already produced the `cosmos-slack-img://` ref in main; the renderer holds no token — FR-014).

Body anatomy after this feature:

```
Body column (min-w-0 flex-1)
├─ Header line: Name(truncate) · Timestamp(shrink-0)        ← unchanged
├─ MessageBody   ← runs: text · @mention · standard-glyph · custom-emoji <img>   (replaces <p>{text}</p>)
├─ MessageImages ← attachment thumbnails block (only when images.length > 0)     (NEW)
└─ RepliesAffordance                                          ← unchanged
```

---

## 2. The runs body — `MessageBody`

`messageContent.ts` (Track E, PURE) parses the message into ordered runs; `MessageBody` renders
them inside the SAME paragraph wrapper the row uses today, so wrap/whitespace parity is preserved:

```tsx
<p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
  {runs.map(...)}
</p>
```

- The wrapper keeps `whitespace-pre-wrap` (preserves the `\n`s `decodeSlackText` left in) and
  `break-words` (long unbroken tokens wrap given the row's `min-w-0` clamp — parity §4). The runs
  are inline, so they flow inside this paragraph exactly like text does today.

### 2.1 Text run
Plain text segment — rendered as a bare string/`<span>`, inherits `text-card-foreground`
(`#e0e0e0` on the `#1b1b1c` card). No wrapper styling. Standard emoji are ALREADY Unicode glyphs
inside these text runs (substituted in main, Track C) — they need no special handling and inherit
the line's font-size, so a `:tada:` reads at text scale automatically.

### 2.2 Mention run (`@DisplayName`)
A resolved mention renders the leading `@` + the display name as ONE accented inline run:

```tsx
<span className="font-medium text-primary">@{displayName}</span>
```

- **Token:** `--primary` (`#4a9eff`) + `font-medium`. This is the lightest treatment that marks
  "this names a person" without a chip/pill/background (which would read as a button and over-weight
  a message full of mentions). It matches how Slack itself tints mentions, and reuses the same
  accent the replies affordance and links already use — no new token.
- **No background, no border, no hover, not focusable** — a mention is not interactive in v1 (no
  profile popover); it is styled text only. Keeping it non-interactive avoids implying a click target.
- **Self-mention is NOT specially highlighted** in v1 (Slack's yellow self-mention is out of scope;
  the spec does not call for it). All resolved mentions get the same `text-primary` treatment.
- **Unresolved mention** (`@<userId>` fallback, FR-004): render as PLAIN body text (no
  `text-primary`), so an unresolved id reads as ordinary text rather than masquerading as a resolved
  person. Decision: the runs parser emits a mention run as "resolved" only when a display name was
  substituted; the raw `@U07ABC` fallback is just a text run.

### 2.3 Custom-emoji run (inline image)
A `:name:` marker whose shortcode is in the per-message custom-emoji ref map renders as a small
inline image sized to the line:

```tsx
<img
  src={ref}                       // cosmos-slack-img://… opaque ref (no token — FR-007/FR-014)
  alt={`:${shortcode}:`}          // accessible + the broken-image fallback text
  className="inline-block h-[1.25em] w-auto align-text-bottom select-none rounded-[2px]"
  loading="lazy"
  draggable={false}
/>
```

- **Size:** `h-[1.25em]` — height scales with the surrounding text's font-size (the body is
  `text-sm`, so the emoji is ~17.5px tall against a 14px line — a touch taller than the cap height,
  which reads as a proper emoji glyph rather than a tiny stamp). `w-auto` preserves the emoji's
  aspect ratio (Slack custom emoji are often non-square). Using `em` (not `px`) means the emoji
  tracks the text scale on both surfaces automatically.
- **Baseline alignment:** `align-text-bottom` seats the emoji on the text baseline so it sits in
  line with adjacent glyphs (not floating above or pushing the line-box). `inline-block` keeps it in
  the inline flow inside the `whitespace-pre-wrap` paragraph.
- **`select-none` + `draggable={false}`** — the emoji behaves like a glyph, not a draggable image,
  so a text selection across the message reads cleanly (the `alt` `:shortcode:` is the selectable
  fallback the browser substitutes).
- **`rounded-[2px]`** — a hair of rounding so emoji with hard edges don't look clipped; matches
  Slack. NOT `rounded-md` (too round at glyph scale).
- **No border** on a custom emoji (unlike attachment thumbnails) — a border at glyph scale is noise.
- **Broken / failed-fetch:** §5. Falls back to the literal `:shortcode:` text (the `alt`), which is
  the most readable affordance at this scale.

### 2.4 Run order & spacing
Runs flow inline with no inserted spacing — the parser preserves the original spacing/newlines from
`text`, so `Hi @Jane :wave: how are you` renders with its natural single spaces. The mention/emoji
runs do not add margins; they are drop-in inline replacements for the characters they came from.

---

## 3. Attachment thumbnails — `MessageImages`

When the message carries one or more image refs, render a thumbnail block BELOW the text body and
ABOVE the replies affordance. Only rendered when `images.length > 0` (no empty container, no gap).

### 3.1 Container & layout

```tsx
// 1 image:
<div className="mt-1.5">
  <ThumbImage … />
</div>

// 2+ images:
<div className="mt-1.5 grid grid-cols-2 gap-1.5">
  {images.map(img => <ThumbImage … />)}
</div>
```

- **`mt-1.5`** — a small top gap separating the thumbnails from the text body (matches the row's
  internal vertical rhythm; the row uses `gap-2.5`/`py-2` at the outer level, `1.5` is the tight
  intra-body step).
- **Single image** → rendered at its natural width up to the caps (§3.2), left-aligned. No grid (a
  lone image in a 2-col grid would look arbitrarily half-width).
- **Multiple images** → a **2-column grid** with `gap-1.5`. Two columns (not a horizontal scroller,
  not a 3-col mosaic) is the lazy, panel-width-safe choice: it fills the narrow rail without forcing
  a horizontal scrollbar, each cell stays a legible size, and an odd last image simply occupies one
  cell of its row (left-aligned). 3+ columns would shrink thumbnails below useful size on the rail.
- **Block width** — the grid is `w-full` within the body column (`min-w-0 flex-1`), so thumbnails
  never overflow the panel. Each thumbnail is `max-w-full` so it can't blow out its cell.

### 3.2 `ThumbImage` — the individual thumbnail

```tsx
<img
  src={ref}                       // cosmos-slack-img://… opaque ref (no token — FR-010/FR-014)
  alt={alt ?? 'image'}
  className="max-h-60 max-w-full rounded-md border border-border object-contain"
  loading="lazy"
  decoding="async"
  draggable={false}
  // optional, only if trivially wired (§4): onClick → open in default browser
/>
```

- **Size caps:** `max-h-60` (240px) + `max-w-full`. 240px is a comfortable preview height on the
  narrow Slack rail — large enough to read a screenshot's gist, small enough that several stacked
  messages with images stay scannable. `object-contain` preserves aspect ratio within the caps (no
  cropping/distortion). When the DTO carries `w`/`h`, the developer MAY set `width`/`height`
  attributes to reserve layout space (reduce reflow) — still capped by the CSS max. A small portrait
  image renders at its natural size (it does not upscale to the cap).
- **Frame:** `rounded-md` (`--radius-md`) + `border border-border` (`#333`) — the same rounded,
  bordered image frame the Confluence body uses (consistency across surfaces). The border also keeps
  a light-background image (e.g. a white screenshot) from bleeding into the dark card.
- **Lazy:** `loading="lazy"` + `decoding="async"` — images only fetch when scrolled near (keeps the
  list cheap on long channels; "keep it lazy" per the prompt). The fetch is the main-process
  protocol handler streaming bytes with the token attached in main; the renderer just sets the
  opaque `src`.
- **No caption row** under thumbnails in v1 (Slack filenames add noise to a chat row). `alt` carries
  the accessible label.

---

## 4. Click affordance (kept minimal)

- **v1 default: thumbnails are non-interactive** (no lightbox, no modal — the spec says keep it lazy,
  no lightbox unless trivial). A thumbnail is a static preview.
- **Trivial-only enhancement:** IF opening the image in the OS default browser is a one-liner the
  developer already has wired (e.g. an existing `shell.openExternal`-style bridge used elsewhere for
  external links), a thumbnail MAY become a `<button>`-wrapped image that opens the image. But: the
  opaque `cosmos-slack-img://` ref is NOT a browsable URL and the real `files.slack.com` URL is
  token-gated and confined to main (FR-014) — so "open in browser" would require a main-side resolve
  that is OUT of this feature's lazy scope. **Therefore v1 ships non-interactive thumbnails** and the
  open-externally affordance is deferred (flag, §8 OQ-A). Do NOT hand-roll a renderer lightbox.
- If thumbnails are made interactive later, the wrapper must be a real `<button>` with
  `focus-visible:ring-2 focus-visible:ring-ring` and an `aria-label` (e.g. `Open image: <alt>`) —
  same pattern as the catalog `ChannelList` row button.

---

## 5. Broken / degraded states (the load-bearing graceful-degradation contract)

Every image (custom emoji + attachment) may fail to fetch (missing/expired/forbidden/network), or a
forged ref is rejected by the main SSRF guard → the protocol handler returns a non-2xx Response
(FR-011/FR-013). No `onerror` JS data-refetch is added (mirrors Confluence §4); the treatment is
chosen so a failed load degrades cleanly.

| Element | Failure | Affordance |
|---------|---------|------------|
| **Custom emoji** | image fetch fails / ref rejected | **Fall back to the literal `:shortcode:` text.** The `alt={`:${shortcode}:`}` IS that text — the browser's native broken-image rendering shows the alt at glyph scale. Decision: for the cleanest result, the runs parser SHOULD treat a custom-emoji image error as "render the `:shortcode:` text run" so it reads as ordinary text, not a broken-image icon. (Browser-`alt` fallback is the acceptable minimum; a render-time literal is the polished form.) Matches the spec's FR-008 "literal `:shortcode:`" path. |
| **Standard emoji** | n/a | Already a Unicode glyph in `text` — cannot "fail". Unknown shortcode never became an image; it stays literal `:shortcode:` (FR-008). |
| **Mention** | unresolved id | `@<userId>` plain text (§2.2) — not an image, never a broken state. |
| **Attachment thumbnail** | image fetch fails / ref rejected | **A thin bordered placeholder**, NOT a tall empty gap. The `<img>` already carries `rounded-md border border-border`; add the Confluence rule `min-height: 0` so a failed load collapses to a short bordered box (the native broken-image box) rather than reserving the full `max-h-60`. For a more legible affordance, the developer MAY render an explicit placeholder cell on error: a `flex items-center justify-center` box, `aspect-[4/3]` (or the smaller of natural/`max-h-60`), `rounded-md border border-border bg-muted`, holding a lucide `ImageOff` glyph (`size-5 text-muted-foreground`) + a `text-xs text-muted-foreground` caption = the `alt` or `"Image unavailable"`. This is the polished form; the bare `min-height:0` broken box is the acceptable minimum. |

In all cases the REST of the message renders (FR-013/FR-017) — one failed image/emoji/mention never
blanks the body or the surface. The runs render is independent per run; the thumbnails render is
independent per image.

The `min-height:0` collapse for Slack thumbnails is a tiny, local CSS concern. Because the body's
`<img>` carry Tailwind utility classes (`rounded-md border border-border`), the developer adds
`min-h-0` to the thumbnail `<img>` class set (Tailwind `min-h-0` = `min-height:0`) — no global CSS,
no `index.css` change, no new token.

---

## 6. Tokens & primitives — additions/changes

**Tokens used (all existing, none added/changed):**
- `--card-foreground` (`#e0e0e0`) — body text + text runs.
- `--primary` (`#4a9eff`) — resolved-mention accent.
- `--border` (`#333`) — thumbnail frame + broken-image placeholder border.
- `--muted` (`#252526`) — broken-image placeholder fill.
- `--muted-foreground` (`#888`) — broken-image glyph + caption.
- `--radius-md` — thumbnail corner radius (`rounded-md`).
- `--ring` (`#4a4a4c`) — focus ring IF thumbnails become interactive (deferred, §4).

**Primitives used:** none from `components/ui/` are added or changed. The runs body and thumbnails
are plain `<span>`/`<img>`/`<div>` inside the existing `SlackMessageRow` app component. lucide
`ImageOff` is an icon import (for the optional broken-image placeholder), not a design-system
primitive.

**New design-system token or primitive required: NONE.** This pass does not edit `src/renderer/
index.css` or `src/renderer/components/ui/`. (CSP widening for `cosmos-slack-img:` lives in
`index.html` and is developer build-wiring, not a design-system token — see §7.)

---

## 7. Interaction & accessibility

- **Read-only body** — no controls inside `MessageBody`; mentions and custom emoji are styled text,
  not focusable. Focus order within a row is unchanged: avatar/name/timestamp/body are non-focusable;
  the only tab stop remains the replies affordance (and the tail `LoadMoreButton`). If thumbnails
  become interactive later (§4), each thumbnail `<button>` joins the tab order BEFORE the replies
  affordance, with a visible `focus-visible:ring`.
- **Alt text everywhere** — custom emoji `alt={`:${shortcode}:`}`; attachment `alt={alt ?? 'image'}`.
  A screen reader announces the shortcode/alt; a sighted user with a broken image sees the same as a
  fallback. This is the accessible substitute for the visual glyph/thumbnail.
- **Mention semantics** — `@DisplayName` is plain accented text; it reads naturally in the flow for
  a screen reader (the `@` + name is spoken as written). No ARIA needed (not a control).
- **Contrast (dark palette)** — mention `--primary` `#4a9eff` on `--card` `#1b1b1c` passes AA for the
  small text size and is reinforced by `font-medium` weight (meaning is not carried by color alone —
  the `@` prefix + bolder weight also mark it). Thumbnail border `#333` and placeholder `--muted`/
  `--muted-foreground` are existing palette-vetted values. Body text `#e0e0e0` on `#1b1b1c` is high
  contrast (unchanged).
- **No new motion** — images are static (no shimmer/skeleton on the individual image; the list-level
  `MessageSkeleton` already covers loading). `prefers-reduced-motion` unaffected.
- **Selection** — custom-emoji `<img>` is `select-none` so a drag-select of the message text doesn't
  snag on the emoji; the `alt` is the substituted selectable text. Thumbnails are `select-none`/
  `draggable={false}` so they don't interfere with text selection.

---

## 8. Open questions

- **OQ-A — Thumbnail open-externally affordance.** v1 ships NON-interactive thumbnails (no lightbox,
  no open-in-browser) because the only browsable form of a Slack image is the token-gated
  `files.slack.com` URL confined to main, and exposing/opening it is out of this feature's lazy
  scope (FR-014). Whether to add a main-side "open this attachment externally" path (and its security
  posture) is an architecture decision — flag to `architect`; do NOT hand-roll a renderer lightbox or
  leak the real URL. Non-blocking: a static preview fully satisfies the P1 "see the image inline"
  scenario.
- **OQ-B — Animated custom emoji.** Slack animated custom emoji (GIF) are shown as the image (their
  first frame or full animation per the browser). The spec lists "animated-emoji playback fidelity"
  as out of scope, so v1 simply renders whatever `cosmos-slack-img://` returns at `h-[1.25em]`; no
  play/pause control. Non-blocking; noted so it isn't mistaken for a defect.

---

## 9. Acceptance checklist (visual contract for the developer)

- [ ] `SlackMessageRow`'s single `<p>{text}</p>` body is replaced by a runs `MessageBody` rendered
      inside the SAME `whitespace-pre-wrap break-words text-sm text-card-foreground` paragraph; both
      the native panel and the catalog `MessageRow` inherit it (no duplicated body JSX). The catalog
      `SearchResultRow` body `<p>` uses the SAME `MessageBody` render.
- [ ] Standard emoji render as glyphs inside text runs (no styling); a resolved mention renders
      `@{name}` as `font-medium text-primary`; an unresolved `@<userId>` renders as plain body text.
- [ ] Custom emoji render as `<img src={ref}>` with `inline-block h-[1.25em] w-auto align-text-bottom
      select-none rounded-[2px]`, `loading="lazy"`, `alt={`:${shortcode}:`}`; a failed custom emoji
      falls back to the literal `:shortcode:` text (alt at minimum).
- [ ] Attachment thumbnails render in a `MessageImages` block (`mt-1.5`) below the text: 1 image =
      single, 2+ = `grid grid-cols-2 gap-1.5`; each `<img>` is `max-h-60 max-w-full rounded-md border
      border-border object-contain min-h-0`, `loading="lazy"`, `alt={alt ?? 'image'}`, `draggable={false}`.
- [ ] A broken/failed thumbnail collapses to a thin bordered placeholder (`min-h-0`) — NOT a tall
      gap; the optional `ImageOff` + `--muted` placeholder cell is acceptable polish. The rest of the
      message keeps rendering in every failure case (one bad image/emoji/mention never blanks the body).
- [ ] Thumbnails are NON-interactive in v1 (no lightbox); the opaque `cosmos-slack-img://` ref is the
      only image reference in the renderer/DOM (no token, no `files.slack.com` URL).
- [ ] No edits to `src/renderer/index.css` or `src/renderer/components/ui/`; no new token/primitive.
      (CSP `img-src` widening for `cosmos-slack-img:` in `index.html` is developer build-wiring, not a
      design-system change.)
