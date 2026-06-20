# Design: Confluence Page Detail — "Open in Confluence" Web Link — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/confluence-detail-weblink-v1.md
**Plan**: .sdd/plans/confluence-detail-weblink-v1.md
**Issue**: #87
**Owner**: designer

> Sits between Plan (Step 2) and Interface (Step 3). Spec + plan are final and fix the
> mechanism (a non-secret `webUrl?` enriched onto `ConfluencePageDetail`, omit-when-absent,
> rendered as a `<a target="_blank">` routed to the existing `setWindowOpenHandler` →
> `shell.openExternal`; no new IPC/scope/fetch). This design fixes only the *visual contract*:
> the page-detail title becomes the external link, matched to the JUST-revised calendar
> title-link idiom — entirely in existing tokens + `components/ui/` primitives, dark-only.

---

## Grounding

> Direct investigation run for this design. Queries actually executed:

**codegraph_explore / Grep:**

- `codegraph_explore` `PageDetail Confluence page detail title render webUrl confluenceCatalog
  components` — returned the verbatim native `PageDetail` (`ConfluencePanel.tsx:260`) and the
  gen-UI catalog `PageDetail` (`confluenceCatalog/components.tsx:260`). **Takeaway:** BOTH render
  the title with the identical element `<h2 className="text-base font-medium leading-snug
  text-foreground">{title}</h2>`, then an optional `space` `Badge variant="outline"`, then
  `PageDetailBody`. The title is a **block `h2`**, not the calendar's inline header `<span>`.
- `Grep` `ExternalLink|asChild|target="_blank"|aria-label` in `googleCalendarCatalog/components.tsx`
  — returned the CURRENT (this-session) calendar title-link (`EventDetail`, ~line 767): the title
  is an `<a href target="_blank" rel="noreferrer" title="${title} — open in Google Calendar"
  className="group flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground
  hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-1 focus-visible:ring-offset-card rounded-sm">` wrapping a
  `<span className="truncate">{title}</span>` + a trailing `<ExternalLink className="size-3.5
  shrink-0 text-muted-foreground" aria-hidden="true" />`; absent link → plain
  `<span className="flex-1 truncate text-sm font-medium text-foreground">{title}</span>`. This is
  the EXACT idiom to mirror. (Note: the older calendar design's §2.8 body-row `Button
  variant="link"` was superseded by this title-link form — adopt the title-link.)

**memory_recall:**

- `calendar event detail title external link ExternalLink icon design system token` — recovered
  `calendar-event-detail-v1` (#85): external link uses `ExternalLink` lucide + the in-place
  `setWindowOpenHandler`, NO new theme token, NO new `components/ui/` primitive. Same constraints
  hold here. (Will `memory_save` this Confluence title-link decision after authoring.)

**Net:** the affordance is fully expressible in existing tokens (`--foreground`,
`--muted-foreground`, `--ring`, `--card`) + the lucide `ExternalLink` glyph already imported in the
sibling calendar surface. **Zero new theme tokens, zero new `components/ui/` primitives.** The title
already exists; we only conditionally wrap it in an anchor.

---

## 1. Title-as-external-link (the affordance)

The Confluence page-detail **title `h2`** becomes the clickable external link to `webUrl` when a
non-secret absolute `http(s)` `webUrl` is present. The title is the affordance — there is **no
separate body link row** (matching the revised calendar idiom; do not add a button row).

### 1.1 Anatomy (present case)

Inside the existing title block (`<div className="flex flex-col gap-2">`), replace the bare
`{title}` text inside the `h2` with an inline `<a>` + trailing icon. Keep the `h2` so the title's
typography (size/weight/line-height) and DOM heading semantics are unchanged:

```tsx
<h2 className="text-base font-medium leading-snug text-foreground">
  {webUrl ? (
    <a
      href={webUrl}
      target="_blank"
      rel="noreferrer"
      title={`${title} — open in Confluence`}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-sm hover:underline
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
    >
      <span className="min-w-0">{title}</span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  ) : (
    title
  )}
</h2>
```

- **Typography — unchanged.** The styling stays on the `h2` (`text-base font-medium leading-snug
  text-foreground`). The `<a>` inherits color/size/weight from the `h2` — it is NOT recolored to
  `--primary`/`text-primary` (this matches the calendar, whose title-link stays `text-foreground`,
  not the old `variant="link"` primary blue). The link reads as the same heading, just interactive.
- **Icon.** lucide **`ExternalLink`** (same glyph the calendar title-link uses — adopt it verbatim
  for cross-surface consistency; do NOT introduce `SquareArrowOutUpRight`). Size `size-3.5`,
  `shrink-0`, color **`text-muted-foreground`** so the glyph is a quiet "leaves the app" hint that
  never competes with the title. `aria-hidden="true"` — the accessible meaning is carried by the
  anchor's `title`/label, not the icon. Spacing: `gap-1.5` between title text and icon.
- **Wrapping vs. truncate.** The native detail title currently wraps (no `truncate`); preserve that
  by NOT adding `truncate` — use `inline-flex max-w-full items-center` so a long title wraps and the
  icon trails the last line, and the full title is always readable in the detail. (The calendar
  header truncates because it is a single-line dock header; the Confluence detail is a scrollable
  page header where wrapping is correct — this is the one intentional, non-visual divergence.)
- **Hover.** `hover:underline` on the anchor — the only hover affordance, matching calendar. No
  background change, no color shift.
- **Focus-visible / keyboard.** Native `<a href>` is a tab stop with Enter activation for free. The
  visible keyboard ring is the shared cosmos idiom: `focus-visible:outline-none
  focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
  focus-visible:ring-offset-card` (`rounded-sm` so the ring has tidy corners) — `--ring` (#4a4a4c)
  is legible against the panel/card. Identical to the calendar title-link.
- **Screen reader.** The anchor's accessible name is the title text; the `title={`${title} — open
  in Confluence`}` attribute (mirroring the calendar's `… — open in Google Calendar`) tells AT/hover
  users the link opens the page in a browser. `rel="noreferrer"` for safe external open. The icon is
  `aria-hidden`, so AT announces "<title>, link" + the title tooltip, not a redundant "external link"
  glyph. (No extra `aria-label` is required since the visible title is the name; the `title` attr
  supplies the "opens in Confluence" intent.)

### 1.2 Placement & layout (must not disturb the existing layout)

The link lives **in place of the existing title text**, inside the current title `h2`, inside the
existing `<div className="flex flex-col gap-2">` header block — above the `space` `Badge` and the
`PageDetailBody`. Nothing else moves: the space chip, body, scroll region, padding (`p-3`,
`gap-4`/`gap-2`), and the gen-UI `flex items-center justify-between gap-2` title row (which carries
the RefreshButton) are all untouched. The affordance adds no row, no separator, no height — the
title simply becomes interactive. (Within the gen-UI variant's `justify-between` row, the linked
`h2` still sits left of the refresh control exactly as the plain `h2` did.)

### 1.3 Both render paths, one treatment (SC-005)

Apply the SAME markup in BOTH titles so native and gen-UI are byte-identical:

- **Native** `PageDetail` (`src/renderer/ConfluencePanel.tsx:303`): `webUrl` comes from
  `detail.webUrl`.
- **Gen-UI catalog** `PageDetail` (`src/renderer/confluenceCatalog/components.tsx:278`): `webUrl`
  comes from a new `useBound<string>(surfaceId, webUrl, '')` (empty string ⇒ absent). Guard on a
  non-empty value (developer also belt-and-suspenders validates absolute `http(s)` per FR-010).

Developer SHOULD factor the link/plain-text title into one tiny shared helper (e.g.
`PageDetailTitle`/`PageTitleLink`) so the two paths cannot drift — same intent as the calendar's
shared title treatment.

---

## 2. States

| State | Treatment |
|-------|-----------|
| **`webUrl` present** | Title `h2` renders the inline `<a target="_blank">` wrapping the title text + trailing `ExternalLink` `size-3.5 text-muted-foreground` icon; `hover:underline`; keyboard-focusable with the shared ring; `title="<title> — open in Confluence"`. Clicking opens the page in the system browser (existing `setWindowOpenHandler`), never in-app. |
| **`webUrl` absent** (omit-to-degrade, FR-004) | The `h2` renders the **plain title text** — no `<a>`, **no icon**, no link, no underline, no extra tab stop. Visually identical to today's detail header. Never a disabled stub or broken link. |
| **Title blank** (FR/edge: empty/whitespace title) | Both branches fall back to whatever the detail provides for an empty title (today the bare value renders nothing). When `webUrl` is present the link still works (the `<span>{title}</span>` may be empty, but the trailing `ExternalLink` icon remains visible and the anchor is still clickable/focusable), so the affordance is never lost just because the title string is blank. The `title` attr ("` — open in Confluence`") still announces intent. (A title-text fallback like "Untitled" is a content decision for the developer/architect, not introduced here.) |
| **Loading / not-connected / reconnect / read error / page-not-found** | **Unchanged.** These are owned by the detail's existing states (`PageDetailSkeleton`, `ReconnectState`, `ErrorState`, "Page not found." `EmptyLine`, and the gen-UI `aria-busy` + `BoundListError`). There is no page to link to in any of them, so no title-link renders — the affordance only exists on a populated detail. |
| **Body absent but `webUrl` present** | The linked title shows normally; the link does not depend on body content (spec edge case). `PageDetailBody` handles the empty body as it does today. |

The rest of the page-detail layout (space chip, body, scroll, refresh control, paddings) is
**not disturbed** in any state.

---

## 3. Interaction & a11y summary

- **Activate:** click / Enter on the title link → opens `webUrl` in the default system browser
  (existing `http(s)` `target=_blank` hand-off; `{ action: 'deny' }` keeps it out of cosmos).
- **Keyboard:** the anchor is a native tab stop; visible `focus-visible` ring (`--ring`) against the
  dark card; no keyboard trap; tab order follows DOM (title before space chip / body).
- **Contrast (dark-only):** title text is `--foreground` (#e0e0e0) on the panel/card background — the
  same pairing the detail already passes; the icon at `--muted-foreground` is decorative
  reinforcement only. No new color, no `text-primary` recolor.
- **Screen reader:** announces the title as a link plus the `title` tooltip "open in Confluence";
  the icon is `aria-hidden` so there is no redundant announcement. `rel="noreferrer"`.

---

## 4. Tokens & primitives ledger

- **New theme tokens:** **none.** Reuses `--foreground`, `--muted-foreground`, `--ring`, `--card`
  (via `ring-offset-card`). No raw hex, no `text-primary` introduction.
- **New `components/ui/` primitives:** **none.** The affordance is a bare semantic `<a>` inside the
  existing `h2` plus the lucide `ExternalLink` glyph (already imported in the sibling calendar
  surface; developer adds the import to the Confluence files). No `Button` import is even required
  here — the title-link form is plain-anchor, matching the revised calendar idiom. (If the developer
  prefers `Button asChild variant="link"`, that is NOT this design — keep the `text-foreground`
  inherited-title look so it matches calendar; do not switch to the primary-blue link variant.)
- **New renderer work (developer, consumes the system — does not extend it):** add `webUrl?` to the
  catalog `PageDetailNode` (`Bound<string>`) + `useBound`, wrap the title in both `PageDetail`
  components (ideally via one shared `PageDetailTitle` helper), and import `ExternalLink`. Build
  wiring + the DTO/surface-builder plumbing are the developer's per the plan.

---

## 5. Open questions

- **None blocking.** All choices carry safe defaults: link omits entirely when `webUrl` is absent;
  icon is `ExternalLink` (calendar-matched); title stays `text-foreground` (not primary); the title
  wraps rather than truncates in this scrollable page header (intentional, non-visual divergence from
  the single-line calendar dock header). A title-text fallback string ("Untitled") for the
  blank-title case is a content/contract decision deferred to developer/architect, not a design need.
