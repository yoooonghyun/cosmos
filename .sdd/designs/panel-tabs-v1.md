# Design: VS Code-style tabs within each rail panel — v1

**Status**: Draft
**Created**: 2026-06-06
**Spec**: `.sdd/specs/panel-tabs-v1.md`
**Plan**: `.sdd/plans/panel-tabs-v1.md`
**Owner**: designer

---

## 0. Blockers / required handoffs (read first)

There are **no blocking visual unknowns** — the spec resolves OQ-1 and the tab model is
fully determined. The design fits entirely inside the existing token system and the
existing shadcn primitives; **no new theme token and no new shadcn component are required.**

**Developer handoff (no Bash for the designer):**

- **No `npx shadcn add` runs needed.** `PanelTabStrip` is a bespoke composite assembled
  from existing primitives (`Button`, `Tooltip`) + raw elements; it is **not** the shadcn
  `Tabs` primitive (that primitive's `TabsList`/`TabsTrigger` model an equal-width
  segmented control and is already owned by the rail in `App.tsx` — see §9 for why we do
  not reuse it here).
- **No package installs.** `lucide-react` (icons `X`, `Plus`, `Loader2`,
  `AlertCircle`/`CircleAlert`, `SquareTerminal`) is already a dependency.
- One **net-new renderer file** is created by the developer per the plan
  (`src/renderer/PanelTabStrip.tsx`). The designer authors no `.tsx` here because the
  component needs none of the design-system *source* extended — it only consumes existing
  tokens/primitives. All class strings the developer needs are specified verbatim in §5.

If, during build, the strip's 28px row height visually crowds the existing panel header
(`px-3 py-2`, ~36px), keep the strip at the spec'd height and let the panel header remain
as-is — they are two separate horizontal bands (§2). That is the only judgment call.

---

## 1. Surface & where it lives

`PanelTabStrip` is a **single horizontal band** inserted into every rail panel, directly
**below that panel's existing title/header band** and **above the panel's content region**.
It is the same width as the panel (full-bleed, `border-l` already supplied by the panel
`<section>`). It does not replace any existing chrome; it is a new band between header and
body.

Per-panel placement (each panel keeps its current outer `<section>` / header):

```
┌───────────────────────────────────────────────── panel <section> ──┐
│  [existing title band]   e.g. "Slack" / "Generated UI"  (unchanged) │  ~36px
├─────────────────────────────────────────────────────────────────────┤
│  PanelTabStrip   ◄── THIS DESIGN                                     │  32px
├─────────────────────────────────────────────────────────────────────┤
│  (connection bar / native base / active tab's surface / terminal)   │  flex-1
│  ...panel content region, NOT this design...                        │
└─────────────────────────────────────────────────────────────────────┘
```

- **Terminal** panel: strip sits above the xterm region. (Terminal has no title band today;
  the strip becomes its top chrome.)
- **Slack / Confluence / Jira**: strip sits between the existing title band and the
  connection bar / native base.
- **Generated UI**: strip sits above the idle placeholder / active surface.

The composer (generative panels) is unchanged and stays bottom-docked **below** the content
region — it is not part of the strip.

### 1.1 ASCII mockups (the strip itself)

Populated, 3 tabs, middle one active, last one in-flight:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ │ Q3 launch checklist  ✕ │ Open bugs in EU…  ✕ │ ◌ Sprint health… │  ＋   │
│ └──────────[active]───────┘     [inactive]          [in-flight]            │
└──────────────────────────────────────────────────────────────────────────┘
 ▲ 2px primary top-accent on the active tab        ▲ trailing new-tab button
```

Terminal panel, 2 terminal tabs:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ │ ⌘ Terminal 1   ✕ │  ⌘ Terminal 2 │   ＋                            │
│ └──────[active]───────┘     [inactive]                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

Overflow (many tabs → horizontal scroll; `+` pinned, never scrolls off):

```
┌──────────────────────────────────────────────────────────────────────────┐
│‹ tab 4  ✕ │ tab 5  ✕ │ tab 6  ✕ │ tab 7  ✕ │ tab 8 ✕ │ tab 9 ✕ ›│  ＋    │
│  └──────────────── horizontally scrolling tab list ───────────┘ └pinned┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

Zero tabs (generative panels — Slack/Jira/Confluence/Generated UI):

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                      ＋    │
│  (empty tab list — only the new-tab button shows)                         │
└──────────────────────────────────────────────────────────────────────────┘
```

(The Terminal panel never reaches zero tabs — FR-024.)

---

## 2. Layout & structure

The strip is a flex row, fixed height **`h-8` (32px)**, with two regions:

1. **Scrollable tab list** (`flex-1 min-w-0`, `overflow-x-auto`, `overflow-y-hidden`,
   `flex` row, `whitespace-nowrap`). Tabs sit side-by-side, no wrap. This is the only part
   that scrolls under overflow (FR-008).
2. **Pinned trailing `+` button** (`shrink-0`), separated from the list by a left border so
   it never scrolls away.

Container background matches the existing panel header band: **`bg-popover`** (`#252526`)
with a **`border-b border-border`** (`#333`) under the whole strip, continuous with the
existing header's bottom border. Each tab carries a **right divider** (`border-r
border-border`) so adjacent inactive tabs read as separate cells, VS Code-style.

```
PanelTabStrip  (role="tablist", h-8, flex, bg-popover, border-b border-border, select-none)
├── div.tab-list   (flex-1 min-w-0 flex overflow-x-auto overflow-y-hidden, the scroller)
│   ├── Tab        (button[role=tab], see §3/§5)
│   ├── Tab
│   └── …
└── NewTabButton   (Button ghost icon-sm, shrink-0, border-l border-border)
```

Each **Tab** is itself a flex row:

```
Tab (button[role=tab])
├── [leading slot]   in-flight spinner ◌ | error ⚠ | terminal glyph ⌘  (optional, size-3.5)
├── label            (truncate, min-w-0, max-w-[14rem], text-[13px])
└── CloseButton      (X, size-3.5 hit-area via nested ghost icon-xs; hover/active reveal)
```

**Sizing:** tab `h-full` (fills the 32px strip), `px-2.5`, `gap-1.5` between leading/label/X.
Label `max-w-[14rem]` then truncates with ellipsis (FR-010). Minimum tab width is its
content; there is no fixed min so short labels ("Untitled", "Terminal 1") stay compact.

---

## 3. Per-tab states (the core of this design)

Every tab is one `<button role="tab">`. State is expressed through `data-*` attributes the
developer sets, so the styling is declarative and testable. Required attributes:

- `data-state="active" | "inactive"` (Radix-style naming, consistent with the rail)
- `data-status="idle" | "in-flight" | "error"` (generative tabs; terminal tabs are always
  `idle` for this attribute — terminal exit is **not** an error state on the tab, see §3.6)

| State | Trigger (FR) | Visual treatment |
|-------|--------------|------------------|
| **Inactive** | not the active tab | `bg-transparent`, label `text-muted-foreground` (#888). Right divider `border-r border-border`. X hidden until hover. |
| **Active** | the active tab (FR-002/003) | `bg-background` (#1e1e1e — the content-region color, so the active tab reads "connected" to the body below, VS Code idiom), label `text-foreground` (#e0e0e0). **2px `bg-primary` top-accent bar** (`before:` pseudo, full tab width). X always visible. No right divider (active tab owns both edges via its bg). |
| **Hover (inactive)** | pointer over an inactive tab | `bg-accent` (#2d2d30), label → `text-foreground`. X fades in (`opacity-0 → opacity-100`). Cursor pointer. |
| **In-flight** | generative run composing for this tab (FR-014) | Leading slot shows `Loader2` spinner (`size-3.5 animate-spin text-primary`). Label stays as-is (Untitled or utterance). The X is **still available** (closing an in-flight tab is allowed, FR-027). `aria-busy="true"`. |
| **Error** | this tab's run failed (FR-015) | Leading slot shows `CircleAlert` (`size-3.5 text-destructive`). Label tinted `text-destructive` (#f3b0b0). Tab otherwise behaves normally (clickable, closeable). The full error text lives in the tab **body** (the surface error boundary, §8), not in the strip — the strip only signals "this tab errored." Tooltip on the tab surfaces the message (§6). |
| **Untitled (uncomposed)** | `+`-created, no surface yet (FR-009) | Label literal **"Untitled"** in `text-muted-foreground italic`. No leading glyph. Behaves like a normal active tab otherwise (it becomes active on creation, FR-005). |

### 3.1 Active vs inactive — exact contrast

- Active tab bg `#1e1e1e` on strip bg `#252526` → the active tab is **darker** than the
  strip and matches the body below it (the VS Code "active editor tab merges into the
  editor" look). Top-accent `--primary` (#4a9eff) gives an unmissable active marker
  independent of the subtle bg delta.
- Inactive label `#888` on `#252526` ≈ 3.5:1 (sufficient for the de-emphasized,
  non-essential inactive labels; they are large-ish 13px medium-ish text and the active tab
  / hover both lift to `#e0e0e0` ≈ 11:1). Active/hover label `#e0e0e0` on `#1e1e1e`/`#2d2d30`
  ≈ 11:1 / 9:1 — well past AA.

### 3.2 In-flight indicator placement

The spinner replaces the (absent) leading glyph on the **left** of the label, not over the
X. This keeps the X reachable while a run is in flight (FR-027 requires closing an in-flight
tab to be safe). The spinner is `Loader2 size-3.5 animate-spin text-primary` — identical to
the composer's existing "Generating…" spinner so the two read as the same operation.

### 3.3 Error indicator placement

`CircleAlert size-3.5 text-destructive` in the same leading slot. Error and in-flight are
mutually exclusive on a tab (a run is either composing or has settled). Label text goes
`text-destructive`. The destructive token in dark mode is the **soft red** `#f3b0b0`
(chosen in the palette to be legible on dark, not a harsh saturated red) — on `#1e1e1e`
(active) it is ≈ 7.5:1.

### 3.4 Terminal-tab label (FR-011)

`Terminal N` where N is the 1-based index at creation. Leading glyph: `SquareTerminal`
(`size-3.5 text-muted-foreground`, `text-foreground` when active) to visually distinguish a
terminal tab from a generative tab at a glance. No in-flight/error status on terminal tabs
(see §3.6). Example labels: "Terminal 1", "Terminal 2".

### 3.5 Generative-tab label (FR-010 / FR-009)

- **Composed:** the utterance, truncated to `max-w-[14rem]` with CSS ellipsis. The developer
  passes the full utterance as the label; truncation is purely visual (`truncate`). The full
  utterance is the tab's `title`/tooltip (§6).
- **Uncomposed (`+`-created):** literal "Untitled", `italic text-muted-foreground` even when
  active, so an empty new tab reads as a draft. On first compose the label swaps to the
  utterance and drops the italic/muted treatment.

### 3.6 Terminal exit is NOT a tab error

A terminal PTY exiting (the existing in-panel "claude exited / Restart" banner) is **not**
surfaced as a tab `data-status="error"`. It stays the panel-body affordance it is today
(now scoped to the tab body). The tab strip's `error` status is reserved for **generative
run failures** (FR-015). This keeps the strip's error semantics single-meaning.

---

## 4. The `+` (new-tab) and `X` (close) affordances

### 4.1 New-tab `+`

- `Button variant="ghost" size="icon-sm"` with a `Plus` icon (`size-4`, the Button default
  icon size). `aria-label="New tab"`. Pinned trailing, `shrink-0`, `border-l border-border`
  on its left so it's visually fenced off from the scrolling list.
- Always present, including the **zero-tab** empty state (FR-005, FR-016) — it's the only
  thing in the strip then.
- Tooltip "New tab" (reuse the app's `TooltipProvider`, side `bottom`).

### 4.2 Close `X`

- Rendered **inside** each tab as a nested `Button variant="ghost" size="icon-xs"` with an
  `X` icon. `aria-label="Close {label}"`.
- **VS Code reveal rule:** hidden on inactive tabs (`opacity-0`), shown on the **active** tab
  always, and shown on **hover/focus** of any tab. Implemented with
  `opacity-0 group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100
  focus-visible:opacity-100` on the X (the Tab is the `group/tab`).
- The X is a real nested button, so clicking it must **`stopPropagation`** (developer note)
  to avoid also activating the tab. The X's own hover gives it a faint `bg-accent` round
  highlight (the ghost variant already does this) so it reads as independently clickable.
- A dirty/uncomposed Untitled tab closes the same way (no confirm — tabs are session-only,
  spec Non-Goals).

---

## 5. Tokens & exact classes (no new tokens)

All values map to existing tokens — **nothing added or changed in `index.css`.**

| Element | Token(s) | Class string |
|---------|----------|--------------|
| Strip container | `--popover`, `--border` | `flex h-8 shrink-0 select-none items-stretch border-b border-border bg-popover` |
| Tab list scroller | — | `flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden` |
| Tab (base) | `--border` | `group/tab relative flex h-full min-w-0 max-w-[16rem] cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Tab inactive | `--muted-foreground` | `bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground` |
| Tab active | `--background`, `--foreground`, `--primary` | `data-[state=active]:border-r-transparent data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:before:absolute data-[state=active]:before:inset-x-0 data-[state=active]:before:top-0 data-[state=active]:before:h-0.5 data-[state=active]:before:bg-primary` |
| Tab in-flight | (status driven) | container gets `aria-busy`; leading `Loader2` `size-3.5 animate-spin text-primary` |
| Tab error | `--destructive` | `data-[status=error]:text-destructive` + leading `CircleAlert` `size-3.5 text-destructive` |
| Untitled label | `--muted-foreground` | `italic text-muted-foreground` (overrides active foreground) |
| Label span | — | `min-w-0 truncate` |
| Terminal glyph | `--muted-foreground` | `SquareTerminal size-3.5 text-muted-foreground group-data-[state=active]/tab:text-foreground` |
| Close X (per tab) | `--accent` (ghost hover) | `Button variant="ghost" size="icon-xs"` + `opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5` |
| New-tab `+` | `--accent` (ghost hover), `--border` | `Button variant="ghost" size="icon-sm"` + `shrink-0 self-center border-l border-border rounded-none` |

Notes on the existing-class gotchas (from CLAUDE.md):

- **Unlayered CSS wins over Tailwind utilities.** The strip uses only Tailwind utilities and
  has **no** competing unlayered rule (`App.css` only styles `.app*`/`.terminal-panel*`), so
  the `data-[state=active]:` toggles here are safe — there is no `.panel-tab { display: … }`
  plain rule to beat them. Do **not** add a plain stylesheet for the strip; keep it
  utility-only so this stays true.
- We deliberately do **not** use the shadcn `Tabs`/`TabsTrigger` primitive here (it forces
  equal-width `flex-1` triggers and a segmented `bg-muted` list — the wrong idiom for a
  VS Code editor-tab row, and its `justify-*`/`after:` vertical-variant quirks documented in
  CLAUDE.md are pure friction here). See §9.

---

## 6. Tooltips & truncation

- Each tab gets a **tooltip** showing the full label (the un-truncated utterance, or
  "Terminal N", or "Untitled"). For an **error** tab the tooltip shows the error message
  prefixed, e.g. `Run failed: <message>` so the strip carries the detail without widening.
  Reuse `Tooltip`/`TooltipContent` under the app-level `TooltipProvider` already mounted in
  `App.tsx`; `side="bottom"`, small delay (the provider sets `delayDuration={300}`).
- Because every tab can render a tooltip, the developer should also set the native `title`
  attribute as a no-JS fallback (cheap, and helps screen-reader users who don't trigger the
  Radix tooltip).

---

## 7. Interaction & accessibility

This strip is the ARIA **tablist / tab** pattern (manual activation), matching the rail's
existing pattern but hand-rolled (not Radix Tabs) because of the bespoke close/overflow
needs.

- **Roles:** strip container `role="tablist"` `aria-label="{Panel} tabs"` (e.g. "Slack
  tabs"); each tab `role="tab"` with `aria-selected={active}` and `tabIndex` per the
  roving-tabindex rule below. The tab's controlled body has `role="tabpanel"`
  `aria-labelledby={tabId}` (the panel content region; developer wires the id).
- **Roving tabindex:** the active tab is `tabIndex=0`; inactive tabs `tabIndex=-1`. The
  trailing `+` and each tab's nested `X` are normal focusable buttons (`tabIndex=0`) — they
  are controls, not tabs, so they sit outside the roving set.
- **Keyboard:**
  - `ArrowLeft` / `ArrowRight` move focus between tabs (roving); focus move alone does
    **not** switch the active tab (manual-activation), matching low surprise.
  - `Enter` / `Space` on a focused tab **activates** it (FR-003).
  - `Delete` or `Backspace` on a focused tab **closes** it (a keyboard equivalent of X);
    after close, focus and active follow the adjacent-tab rule (FR-006/007: right-else-left).
  - `Home` / `End` focus first / last tab.
  - The `X` and `+` are reachable by `Tab` key as ordinary buttons; `Enter`/`Space` invoke
    them.
- **Focus order within the panel:** [existing header controls] → tablist (active tab) →
  (within a tab, its X via Tab) → `+` → panel content region → composer. Switching the rail
  away/back does not change a panel's internal focus contract.
- **Focus ring:** tabs and buttons use the standard `focus-visible:ring-[3px]
  ring-ring/50` already baked into `Button` and specified for the tab base — visible on the
  dark bg (`--ring` #4a4a4c).
- **`aria-busy`:** an in-flight tab sets `aria-busy="true"`; the spinner is `aria-hidden`
  (decorative) and the busy state is the programmatic signal. A `role="status"` live region
  is **not** added per-tab (would be noisy across many tabs) — the composer already announces
  "Generating…" via its existing `aria-live` region, which covers the screen-reader
  narration for the single in-flight run (runs are sequential, §4.10).
- **Error announcement:** when a tab flips to error, the tab body's error boundary
  (`role="alert"`, already present in each panel, §8) announces the failure — the strip's
  error glyph is a visual reinforcement only.
- **Contrast:** see §3.1 — active/hover labels and the primary accent all exceed AA; inactive
  labels are intentionally de-emphasized (non-essential duplicated info; the active label and
  tooltip carry the load).

---

## 8. Relationship to existing per-panel states (not this component, but it must compose)

- **Error boundary:** each generative panel already wraps its A2UI renderer in a
  `SurfaceErrorBoundary` that renders a `role="alert"` destructive panel on a malformed
  surface (FR-028). With tabs, that boundary is **per active-tab surface** — the strip's tab
  `error` status and the body's error boundary are two views of the same failure. The
  designer adds nothing here; the existing boundary styling
  (`border-destructive/40 bg-destructive/15 text-destructive`) is the body error treatment.
- **Run-level error (FR-015):** the composer's existing inline error region
  (`mt-2 rounded-md border border-destructive/40 bg-destructive/15 … text-destructive`,
  `role="alert"`) remains the place the **message** is shown; the originating tab gets the
  `error` glyph + tooltip. Visual language is identical (same destructive treatment), so the
  two reinforce rather than diverge.
- **Zero-tab base bodies** (native browser / idle placeholder) are out of scope for this
  component — but the strip still renders (just the `+`), so the band is visually consistent
  whether or not tabs exist.

---

## 9. Why not the shadcn `Tabs` primitive (recorded decision)

The repo's `components/ui/tabs.tsx` models an **equal-width segmented control**
(`TabsTrigger` is `flex-1`, list is `bg-muted` rounded pill) and is already consumed by the
**rail** in `App.tsx` with documented vertical-variant overrides. VS Code editor tabs are a
**variable-width, left-aligned, individually-closeable, horizontally-scrolling** row — a
different idiom. Forcing Radix Tabs here would mean fighting `flex-1`, the `bg-muted` list,
and the `after:`/`justify-*` variant rules (CLAUDE.md gotchas) for no a11y gain we can't get
by hand-rolling the small tablist pattern in §7. So `PanelTabStrip` is a bespoke component
built from `Button` + `Tooltip` + raw `role=tab` elements. This is recorded so a future
surface needing editor-style tabs reuses `PanelTabStrip`, not Radix Tabs.

---

## 10. States checklist (traceability)

| State | FR | Section |
|-------|-----|---------|
| Active tab | FR-002, FR-003 | §3, §3.1, §5 |
| Inactive tab | FR-002 | §3, §5 |
| Hover (inactive) | — (VS Code) | §3, §4.2 |
| In-flight tab | FR-014 | §3, §3.2, §5 |
| Error tab | FR-015 | §3, §3.3, §8 |
| Untitled / uncomposed | FR-009 | §3, §3.5 |
| Terminal label "Terminal N" | FR-011 | §3.4 |
| Generative label (utterance, truncated) | FR-010 | §3.5, §6 |
| Close `X` (hover/active reveal) | FR-004 | §4.2 |
| New-tab `+` | FR-005, FR-016 | §4.1 |
| Overflow (horizontal scroll, `+` pinned) | FR-008 | §1.1, §2 |
| Zero-tab strip (only `+`) | FR-016, FR-017, FR-018 | §1.1, §4.1 |
| Adjacent-activation on close | FR-006, FR-007 | §7 (keyboard `Delete`) |
| Closing in-flight tab safe | FR-027 | §3.2, §4.2 |
| Malformed surface → body boundary | FR-028 | §8 |

---

## 11. Open questions

None. The spec resolves OQ-1 (zero-tab utterance auto-creates the first tab), and every tab
state maps to existing tokens + existing shadcn primitives. The only build-time judgment
(strip vs header crowding, §0) has a stated default.
