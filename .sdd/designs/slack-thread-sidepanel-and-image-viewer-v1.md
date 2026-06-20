# Design: Slack Thread Side-Panel & Attachment Image Viewer — v1

**Status**: Draft (designer step / Phase 2.5)
**Created**: 2026-06-20
**Spec**: .sdd/specs/slack-thread-sidepanel-and-image-viewer-v1.md
**Plan**: .sdd/plans/slack-thread-sidepanel-and-image-viewer-v1.md
**Owns**: visual contract for the right-docked thread region + the attachment image viewer.
No new tokens. No new shadcn primitive. Reuses existing components only.

---

## Grounding

> Investigated directly via codegraph + agentmemory before designing (CLAUDE.md SDD rule).
> Each pointer in the prompt was re-verified against the current tree.

**codegraph_explore / codegraph_search (one-line takeaways):**

- `SlackMessageRow MessageImages MessageSkeleton MessageList SlackPanel view thread Notice Alert getReplies`
  → `SlackMessageRow.tsx` is the ONE shared row (native + generative). `MessageImages` (`:92–108`)
  renders the non-interactive `<img>` thumbnail strip: `max-h-40 max-w-[12rem] rounded-md
  border border-border/60 object-cover`. `MessageSkeleton.tsx` = four avatar+name+body skeleton
  rows. The generated `MessageList` already owns skeleton / "No messages." empty / `BoundListError`
  states. `Notice` (catalog `components.tsx`) wraps shadcn `Alert` with `variant="destructive"` +
  `border-destructive/40 bg-destructive/15` (error) or default; this is the house error/info treatment.
- `src/renderer/components/ui/dialog.tsx` → shadcn/Radix `Dialog`. `DialogContent` defaults to
  `sm:max-w-lg`, centered, has a built-in top-right close `X` with `focus:ring-2 focus:ring-ring`,
  Esc/overlay close, focus trap + focus-return. Overlay = `fixed inset-0 z-50 bg-black/50`. I OVERRIDE
  `sm:max-w-lg` for the image viewer.
- `SlackPanel.tsx` → panel is a `<section className="flex h-full min-w-0 flex-col border-l border-border
  bg-card">`; `PanelTabStrip` on top; content region `<div className="flex min-h-0 flex-1 flex-col">`.
  The native thread lives at `:976–1010` as a `view.kind==='thread'` branch that REPLACES the base
  (header `MessageRow` + reply `MessageList` calling `getReplies`, dropping the root `m.ts !==
  view.parent.ts`). That reply-list body is reused verbatim inside the new docked region.
- `index.css` → cosmos dark palette: `--card #1b1b1c`, `--popover #252526`, `--border #333`,
  `--primary #4a9eff`, `--muted #252526`, `--muted-foreground #888`, `--ring #4a4a4c`,
  `--accent #2d2d30`. All design below maps to these tokens; no raw hex, no Slack brand color.

**memory (`memory_recall`):**

- `slack panel design thread replies image viewer tokens design system` → empty. Plus prior
  `feedback_design_system` (Tailwind + shadcn is the system) and `feedback_background_delegation`.
  Nothing to reconcile.

**Conclusion:** the whole feature is expressible in existing tokens + existing components. No token
added, no component install. Justification for "no new token" recorded in §6.

---

## 1. Surfaces & layout

Two surfaces, both inside the existing `SlackPanel.tsx` content region. The tab strip, refresh
button, search field, and footer status are UNTOUCHED (FR-014; layout-must-not-break-chrome).

### 1.1 The two-pane content region

Today the content region is a single vertical column. We split the **history view's** content area
into a horizontal flex pair:

```
SlackPanel <section>            (border-l, bg-card — unchanged)
├─ PanelTabStrip                (unchanged)
└─ content region  flex min-h-0 flex-1 flex-col   (unchanged outer)
   └─ history layout  @container/slackbody  flex min-h-0 flex-1 (NEW horizontal wrapper)
      ├─ MessageList pane   min-w-0 flex-1          (the existing left list)
      └─ ThreadPanel pane   (right dock — see §2)   (only when a thread is open)
```

The horizontal wrapper is the only structural change. When no thread is open the list pane is
`flex-1` and fills the width exactly as today (zero visual change — FR-005 "returns to full width").

The header strip with the Back affordance (`:927–950`) keeps working for `channels`/`history`/
`search`. The `view.kind==='thread'` branch and its `'Thread'` header label are REMOVED — the thread
is now the docked pane, not a base view (plan Phase 5).

### 1.2 Breakpoint — container query, value `32rem` (512px)

**Chosen breakpoint: `32rem` (512px) of the Slack panel's own width.** Below it the right dock is a
DRAWER OVERLAY; at/above it the two panes sit side-by-side (FR-007, OQ-2).

Use a **Tailwind container query**, NOT the viewport `md:` breakpoint, because the Slack panel is one
resizable column inside a multi-panel workspace — its width is independent of the window width. Mark
the history wrapper `@container/slackbody` and gate the side-by-side layout on `@[32rem]/slackbody`.
This is the same reasoning the panels already use for their own widths and keeps the thread layout
correct regardless of how the user has sized the Slack column.

Rationale for `32rem`: the left list pane needs ~`18rem` to render `SlackMessageRow` (avatar + name +
wrapped body) without the body wrapping to one word per line; the thread pane needs a comparable
minimum. Below ~32rem two live panes would each be too narrow, so we overlay instead of squeeze.

### 1.3 Side-by-side (≥ 32rem) — `@[32rem]/slackbody`

- List pane: `min-w-0 flex-1` (shrinks to share width; never below its `min-w-0` floor).
- Thread pane: `@[32rem]/slackbody:relative @[32rem]/slackbody:w-[clamp(18rem,42%,28rem)]
  @[32rem]/slackbody:shrink-0 @[32rem]/slackbody:translate-x-0 @[32rem]/slackbody:border-l`.
  - `clamp(18rem,42%,28rem)`: at least 18rem readable, ~42% of the panel normally, capped at 28rem so
    the list never collapses. `shrink-0` keeps the thread pane from being crushed by a long reply.
  - Divider: `border-l border-border` (the established `#333` panel divider — same token the section
    `<section>` and existing `border-l border-border pl-2` thread divider already use).
- No overlay, no backdrop in this mode; both panes scroll independently (each pane owns
  `min-h-0 overflow-auto`).

### 1.4 Drawer overlay (< 32rem) — default (un-prefixed) classes

- Thread pane is positioned `absolute inset-y-0 right-0 z-20 w-full max-w-[22rem]` so it docks to the
  RIGHT and overlays the list (does NOT squeeze it — FR-007). On a panel narrower than 22rem it falls
  to `w-full` (covers the list fully) via the `max-w` clamp.
- Surface: `bg-card border-l border-border shadow-lg` so it reads as a raised layer above the list
  (`--card #1b1b1c` panel surface + the standard `shadow-lg`).
- Scrim over the list beneath the drawer: a sibling `absolute inset-0 z-10 bg-black/40` (matches the
  Dialog overlay's `bg-black/50` family; slightly lighter since this is an in-panel drawer, not a
  modal). Clicking the scrim closes the thread (parity with the close button — FR-005). The scrim is
  rendered only in the un-prefixed (narrow) mode: hide it at `@[32rem]/slackbody:hidden`.
- Animation: slide-in from the right + fade the scrim, gated on reduced-motion.
  - Drawer: `transition-transform duration-200 ease-out`; closed/initial `translate-x-full`,
    open `translate-x-0`. (Mount the pane only while a thread is open; drive the `translate-x` off an
    `data-state` / boolean so the closed→open transition runs. If a CSS-only enter transition proves
    fiddly with conditional mounting, the developer MAY instead keep the pane mounted and toggle
    `translate-x-full`/`translate-x-0` — both are acceptable; the visible result is a right-slide.)
  - Scrim: `transition-opacity duration-200`.
  - Reduced motion: wrap nothing extra — `motion-reduce:transition-none motion-reduce:transform-none`
    on the drawer so it appears/disappears instantly under `prefers-reduced-motion: reduce`
    (a11y; consistent with the spinner's reduced-motion gating in `index.css`).
- z-index budget: scrim `z-10`, drawer `z-20`. Both sit BELOW the Dialog image viewer's `z-50`
  overlay/content, so opening an image from a reply correctly layers the viewer above the drawer
  (Edge Case "Image viewer over the thread panel").

---

## 2. Thread panel (right dock) — anatomy & states

Single component (suggested `SlackThreadPanel`, the developer decides file placement per plan —
likely co-located with `SlackPanel.tsx` or in `slackCatalog/`). Same JSX in both layout modes; only
the wrapper positioning classes differ (§1.3 vs §1.4). Internal structure:

```
ThreadPanel  (flex h-full min-w-0 flex-col bg-card)
├─ Header   flex items-center gap-2 border-b border-border px-2 py-1.5
│   ├─ MessageSquare  size-4 text-muted-foreground   (thread glyph, aria-hidden)
│   ├─ <span> "Thread"  truncate text-sm font-medium text-foreground   flex-1
│   └─ Close Button  variant="ghost" size="icon-sm"  aria-label="Close thread"  (X size-4)
├─ Parent context   border-b border-border           (the root message as header — FR-003)
│   └─ <SlackMessageRow {...parent} />   (NO onOpenThread → non-interactive replies label per §3.2)
└─ Reply region   min-h-0 flex-1 overflow-auto       (the reused reply MessageList — §2.x states)
```

The parent row uses the shared `SlackMessageRow` so the header reads identically to the list. It
carries NO `onOpenThread` (you are already in its thread), so the row's own replies affordance
degrades to the muted label — desired. This replaces the old `<MessageRow message={view.parent}/>`
header path (plan: remove the now-unused native `MessageRow` header).

**Tokens:** header/divider `border-border` (`#333`); glyph + title `text-muted-foreground` /
`text-foreground`; surface `bg-card` (`#1b1b1c`). No accent on the header chrome — the only accent in
the panel is the `text-primary` (`#4a9eff`) reply links inside rows, inherited from `SlackMessageRow`.

### State matrix (reply region)

| State | Treatment | Source / FR |
|-------|-----------|-------------|
| **Loading** | `MessageSkeleton` (four shimmer rows) fills the reply region. Header + parent already visible. | reuse `MessageSkeleton.tsx`; FR-006 (no hung spinner) |
| **Loaded (replies)** | The reused reply `MessageList`: rows via `SlackMessageRow`, count label, "Load more" pagination (inherited as-is), root dropped (`m.ts !== parent.ts`). | FR-002/FR-003 |
| **Empty (no replies)** | `<p className="px-3 py-6 text-center text-sm text-muted-foreground">No replies.</p>` — same shape as the list's "No messages." empty. Benign, not an error (e.g. all replies deleted). | Edge Case "No replies"; FR-006 |
| **Error / not-connected / rate-limited** | The catalog **`Notice` (error)** treatment inline at the top of the reply region: `Alert variant="destructive"` + `border-destructive/40 bg-destructive/15`, `TriangleAlert` glyph `text-destructive`, message in `text-destructive`. Followed by a **Retry** `Button variant="outline" size="sm"` that re-runs the fetch (reuse the list's reconnect/retry posture). The left list stays interactive. NEVER a crash / white-screen / hung spinner. | FR-006, SC-003; reuse `Notice`/`Alert` |
| **Disabled** | n/a — the panel only exists while a thread is open; closing it removes the surface. The Close button is never disabled. | — |

`aria-busy` is set on the reply region while loading (matches the existing list panes).

### Open / retarget / close behavior (drives the surface, not new visuals)

- Open: clicking a row's "N replies" sets the single renderer-local open-thread state → the dock
  appears (FR-001/FR-013). Works for native AND generative because both feed that one state.
- Retarget: clicking a DIFFERENT row's "N replies" swaps the dock's parent + refetches; the dock does
  not close/reopen (no slide-out/in churn) — the content updates in place (FR-004). Left list
  unchanged.
- Toggle: clicking the SAME open thread's affordance MAY close the dock (FR-004, "MAY").
- Channel/view change closes the dock (Edge Case — never show a stale thread against another channel).
- Close: the header X (or, narrow mode, the scrim) clears the state → list returns to full width
  (FR-005).

---

## 3. Clickable thumbnail affordance (in `MessageImages`)

The thumbnail strip in `SlackMessageRow.MessageImages` stays the same grid (`mt-1 flex flex-wrap
gap-1.5`); each `<img>` becomes the child of a **`<button type="button">`** so it is a real, keyboard-
operable control (FR-008/FR-010; a11y "thumbnail-as-button").

**Button wrapper classes:**

```
group relative overflow-hidden rounded-md border border-border/60
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
focus-visible:ring-offset-card
hover:border-border transition-colors
```

- `aria-label`: `View image{img.alt ? ': ' + img.alt : ''}` (e.g. "View image: chart.png"). The inner
  `<img>` keeps `alt={img.alt ?? 'image'}`.
- The `<img>` keeps its current sizing (`max-h-40 max-w-[12rem] object-cover`) but moves the
  `rounded-md border` to the button wrapper so the focus ring hugs the visible image.
- **Hover affordance (signals clickable):** on `group-hover` overlay a subtle scrim + a maximize glyph
  so it reads as "click to enlarge":
  - Overlay: `pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0
    group-hover:bg-black/30 transition-colors`.
  - Glyph: lucide `Maximize2` (or `Expand`) `size-4 text-white opacity-0 group-hover:opacity-100
    transition-opacity` (white reads on any thumbnail; it sits on the hover scrim, not the panel, so
    it is not a palette token violation — it is on-image chrome, like the Dialog's `bg-black/50`).
  - `cursor-pointer` is implicit on the button.
- Focus parity: keyboard focus shows the `focus-visible:ring-ring` ring (the cosmos `--ring #4a4a4c`);
  the hover overlay also shows on `group-focus-visible` so keyboard users get the same affordance —
  add `group-focus-visible:bg-black/30` / `group-focus-visible:opacity-100` mirrors.

This affordance lives in the shared row, so native AND generative thumbnails both become clickable for
free (FR-008/FR-010).

---

## 4. Image viewer (Dialog / lightbox)

Reuse the existing shadcn `Dialog`. Suggested component `SlackImageViewer` (plan:
`slackCatalog/SlackImageViewer.tsx`), state owned row-local inside `SlackMessageRow` so both surfaces
get it with zero panel wiring (plan Phase 3). One `Dialog`, opened with the clicked `img` (ref + alt).

### 4.1 Sizing (override `sm:max-w-lg`)

`DialogContent` classes (override the default width, keep the rest):

```
max-w-[min(90vw,72rem)] w-fit p-0 gap-0 bg-popover border-border overflow-hidden
```

- `max-w-[min(90vw,72rem)]`: large but never exceeds 90% of the app viewport (FR /  Edge Case
  "Very large image" — fit within the in-app viewport, no OS full-screen).
- The image: `<img src={img.ref} alt={img.alt ?? 'image'}
  className="block max-h-[80vh] max-w-full w-auto h-auto object-contain mx-auto" />`.
  - `object-contain` + `max-h-[80vh] max-w-full` scales the image to FIT, never crops (FR — "scaled to
    fit, not cropped"). `w-fit` on the content lets the dialog shrink-wrap a small image rather than
    leaving large empty bars.
- `p-0 gap-0` + `bg-popover` (`#252526`): a near-frameless viewer; the image sits on the cosmos popover
  surface so any letterboxing reads as intentional dark chrome, not white bars.
- Surface uses `bg-popover` (modal surface token) rather than `bg-background` so it is distinct from
  the page and consistent with other cosmos popovers/menus.

### 4.2 Close affordance

- The Dialog's built-in top-right close `X` (`showCloseButton` default true) is kept; it already has
  `focus:ring-2 focus:ring-ring` and an `sr-only` "Close" label. Because we set `p-0`, the X's
  `top-4 right-4` sits over the image corner — fine on the dark scrim; if it is hard to see over a
  light image, the developer MAY wrap it: add a small `rounded-full bg-black/50` plate behind the X via
  a className override. Keep it as on-image chrome (not a palette token), same reasoning as §3.
- Esc + backdrop click + the X all dismiss (Dialog built-in), focus returns to the triggering
  thumbnail button (Radix built-in) — satisfies FR-011 with zero extra code.

### 4.3 Title / alt (accessibility, not a caption)

Out of scope: visible captions. But Radix Dialog needs an accessible name. Provide a visually-hidden
title: `<DialogTitle className="sr-only">{img.alt ?? 'Image'}</DialogTitle>`. This labels the dialog
for screen readers WITHOUT adding a visible caption (respecting "no captions" out-of-scope). No
`DialogDescription` needed; if Radix warns, add `<DialogDescription className="sr-only">`.

### 4.4 State matrix (image viewer)

| State | Treatment | FR |
|-------|-----------|----|
| **Loading** | The `<img>` simply paints when ready (small in-app refs, near-instant). No spinner — a spinner over a frameless dark surface would flash; the dark `bg-popover` is the resting state. (If a perceptible delay is later observed, a `Skeleton` sized to `img.w/h` MAY be added — not needed now, YAGNI.) | — |
| **Loaded** | Image fit per §4.1. | FR-008 |
| **Broken / failed fetch** | `onError` on the `<img>` swaps to a fallback panel: a `flex flex-col items-center justify-center gap-2 p-10 text-muted-foreground` block with an `ImageOff` (lucide) glyph `size-8` + `<p className="text-sm">{img.alt ?? 'Image unavailable'}</p>`. The dialog stays open and dismissable (FR-012). No crash, no hang. | FR-012, SC-004 |
| **Empty** | n/a — the viewer only opens from a real thumbnail (always has a ref). | — |

---

## 5. Interaction & accessibility summary

- **Thread dock:** Close button `aria-label="Close thread"`; reply region `aria-busy` while loading;
  Retry is a real `Button`. Narrow-mode scrim is decorative (`aria-hidden`) — closing is also reachable
  via the labeled Close button, so keyboard users never depend on the scrim. Focus order: tab strip →
  search → list → (when open) thread header Close → parent row → replies. Opening/retargeting the dock
  does NOT steal focus (it is not a modal); the list stays the focus context, matching the
  non-context-switch intent of FR-001.
- **Thumbnail button:** real `<button>`, `aria-label="View image[: alt]"`, `focus-visible:ring-ring`
  ring on `--ring`, Enter/Space activate (native button). Hover AND focus-visible both reveal the
  enlarge affordance.
- **Image Dialog:** Radix provides focus trap, focus-return to the thumbnail, Esc + backdrop close
  (FR-011). `sr-only` `DialogTitle` gives the accessible name. Contrast: `text-destructive`/
  `text-muted-foreground` fallbacks read on `bg-popover` `#252526`; the `ring-ring #4a4a4c` ring is
  visible against the dark surfaces.
- **Reduced motion:** drawer slide + scrim fade gated via `motion-reduce:*` so they no-op under
  `prefers-reduced-motion: reduce`; the Dialog's own `data-[state]` animations are shadcn-default and
  already respect the global reduced-motion posture.
- **Contrast:** all chrome on tokens already passing on the `#1b1b1c`/`#252526` family; the only
  near-black-on-image elements (hover scrim glyph, optional X plate) are on-image chrome, not
  panel text.

---

## 6. Tokens & components

**New tokens added: NONE.** Justification: every surface here is expressible in existing tokens —
`bg-card`, `bg-popover`, `border-border`, `text-foreground`, `text-muted-foreground`,
`text-destructive`, `ring-ring`, `text-primary` (the only accent, inherited via `SlackMessageRow`).
The two black overlays (`bg-black/30` hover scrim, `bg-black/40` drawer scrim) and the white enlarge
glyph are deliberately NOT tokens: they are on-image / modal chrome in the same family as the existing
Dialog overlay (`bg-black/50`) and the spinner, never panel surface color. Inventing a `--scrim` token
for two one-line overlays would add system surface for no reuse — reuse the established `bg-black/N`
convention instead. (Tokens-first held: the need resolved to existing tokens, so no extension.)

**New shadcn primitive added: NONE.** The image viewer is the existing `Dialog`; the drawer is plain
Tailwind positioning on existing surfaces (NOT a new Drawer/Sheet primitive — a Sheet would be heavier
and the spec wants an in-panel right dock, not a viewport-edge sheet).

**Components reused:** `Dialog`/`DialogContent`/`DialogClose`/`DialogTitle`, `Button` (ghost icon-sm,
outline sm, link xs), `SlackMessageRow`, `MessageSkeleton`, the reply `MessageList`, `Notice`/`Alert`,
`Avatar`. lucide icons: `MessageSquare`, `Maximize2` (or `Expand`), `ImageOff`, `TriangleAlert` (via
`Notice`), `X` (via Dialog/Button).

---

## 7. Developer handoff (no Bash for designer)

- **No installs, no shadcn CLI, no token wiring required.** `index.css` is unchanged; `Dialog` already
  exists. Nothing for the main session to install.
- Container query: this repo's Tailwind v4 supports `@container` / `@[32rem]/name` arbitrary container
  queries out of the box (v4 core). If the project has NOT used a named container query before, confirm
  no plugin gating is needed — but no config change is expected. If `@container` utilities do not emit,
  flag back to me and I will provide a `resize`/state-driven fallback (measure panel width → boolean).
- Icons (`Maximize2`/`Expand`, `ImageOff`) are lucide-react (already a dependency).

---

## 8. Design-decision → FR trace

| Decision | FR |
|----------|----|
| Two-pane history layout; list stays left, thread docks right | FR-001 |
| Single renderer-local open-thread state feeds the one dock (native + generative) | FR-001, FR-013 |
| Reuse reply `MessageList` + `getReplies`, drop root, parent as header | FR-002, FR-003 |
| Retarget in place; toggle-same MAY close | FR-004 |
| Header Close (+ narrow scrim) → list full width | FR-005 |
| Loading=`MessageSkeleton`, empty="No replies.", error=`Notice`+Retry, never crash/hang | FR-006, SC-003 |
| `@[32rem]/slackbody` side-by-side vs right-drawer overlay (no squeeze) | FR-007, OQ-2 |
| Thumbnail `<button>` → Dialog viewer, larger image | FR-008 |
| Same opaque `cosmos-slack-img://` ref for the large image; no token/URL | FR-009 |
| Per-thumbnail open (the clicked `img`) | FR-010 |
| Dialog close: X + Esc + backdrop, focus-return, keyboard-operable | FR-011 |
| `onError` fallback (`ImageOff` + `alt`), stays dismissable | FR-012 |
| Visual consistency: cosmos palette, shared row, shadcn `Dialog`, no new token | FR-014 |
| Open-thread / viewer state renderer-local, not persisted | FR-015 |

---

## 9. Open questions for the user

1. **Side-by-side thread pane width** = `clamp(18rem, 42%, 28rem)`. Confirm 42% reads right, or do you
   prefer a fixed ~24rem thread pane regardless of panel width?
2. **Narrow-mode drawer width cap** = `max-w-[22rem]` (covers most of a narrow panel but not edge-to-
   edge until the panel itself is < 22rem). Confirm, or prefer the drawer always full-width when narrow?
3. **Image viewer surface** = `bg-popover` (`#252526`) frameless. Confirm, or do you want a visible
   thin `border-border` frame around the image as well?

None of these block implementation — defaults above are buildable as-is; confirmations only adjust
literals.
