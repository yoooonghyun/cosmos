# Design: Sidebar Surface Switch — v1

**Status**: Draft
**Created**: 2026-06-05
**Spec**: .sdd/specs/sidebar-surface-switch-v1.md
**Plan**: .sdd/plans/sidebar-surface-switch-v1.md

---

## TL;DR (read this first)

This is a **layout rearrangement, not a design-system change.** It reuses the
existing app-shell idioms wholesale:

- the VS Code-style left icon rail (Radix vertical `Tabs` + `TabsList`),
- the `TabsTrigger` rail-item styling (foreground icon + 2px primary left
  indicator bar),
- the `Tooltip` per rail item,
- the `forceMount` + `data-[state=inactive]:hidden` visibility idiom.

**Tokens added/changed: NONE.** **shadcn components added: NONE.** The only new
UI atom is one more `RAIL_ITEMS` entry (Terminal) that flows through the exact
same `TabsTrigger` + `Tooltip` map as the other four. The CSS change is purely
geometric: collapse the 60/40 two-pane split into a single full-bleed surface
region.

A thin design note is the correct outcome here. There is no genuine gap that
needs a new token or component.

---

## 1. Surfaces & layout

### Before (current shell)

```
┌──────────────────────────────────────────────────────────┐
│ header: cosmos · subtitle                                 │
├──┬───────────────────────────┬───────────────────────────┤
│  │                           │                           │
│R │   Terminal (pinned)       │   selected aux surface    │
│a │   ~60% width              │   ~40% width, min 320px   │
│i │   always visible          │   (Generated UI / Slack / │
│l │                           │    Jira / Confluence)     │
│  │                           │                           │
└──┴───────────────────────────┴───────────────────────────┘
```

Rail (4 items): Generated UI, Slack, Jira, Confluence.

### After (single-surface switcher)

```
┌──────────────────────────────────────────────────────────┐
│ header: cosmos · subtitle                                 │
├──┬───────────────────────────────────────────────────────┤
│  │                                                       │
│R │   exactly ONE selected surface                        │
│a │   full bleed — fills the entire main content area     │
│i │   (Terminal / Generated UI / Slack / Jira / Confluence)│
│l │                                                       │
│  │                                                       │
└──┴───────────────────────────────────────────────────────┘
```

Rail (5 items, in order): **Terminal, Generated UI, Slack, Jira, Confluence.**
Terminal is first and is the launch default.

- **Header** — unchanged. (Note: the subtitle already reads
  "Terminal Panel · Generated UI · Slack · Jira · Confluence · Claude Code", so
  it needs no change for this feature.)
- **`.app__body`** — stays a flex row: `rail | single surface`.
- **Rail** — unchanged geometry: `w-12` (48px), `bg-popover`, `border-r
  border-border`, `p-0 py-2`, vertical `gap-1`, top-aligned (`justify-start`),
  `aria-label="Surfaces"`. Now holds 5 triggers instead of 4.
- **Main surface region (`.app__ui`)** — was the 40% right column
  (`flex: 1 1 40%; min-width: 320px`). Becomes full-bleed
  (`flex: 1 1 auto; min-width: 0`), keeping `min-height: 0; display: flex`.
  The standalone `.app__terminal` 60% pane is removed; the Terminal now renders
  inside its own `TabsContent` using the same `.app__ui` class as the other
  four, so all five share identical full-bleed geometry.

Each surface's **own internal layout/scroll/overflow is unchanged and out of
scope** — they were already designed (see slack-integration-v1, atlassian-
integration-v1, and the Generated-UI panel). Going full-width must not alter
their inner composition; they simply receive more horizontal room.

---

## 2. The Terminal rail item

- **Icon: `SquareTerminal` (lucide-react).** Chosen over the plain `Terminal`
  glyph for **visual-family consistency**: the rail already uses square-framed
  lucide marks (`SquareKanban` for Jira), and `Sparkles` / `MessageSquare` /
  `BookText` all read as solid, evenly-weighted ~20px marks. `SquareTerminal`
  (a `>_` prompt inside a rounded square) sits in that same family and balances
  the optical weight of `SquareKanban` directly below it in the stack, whereas
  bare `Terminal` reads lighter/thinner and would look like an outlier. Render
  at the existing rail icon size (`size-5` / 20px).
- **Label / a11y text: "Terminal".** Used verbatim for both the `aria-label`
  on the `TabsTrigger` and the `TooltipContent` text, matching the other four.
- **Placement: first** in `RAIL_ITEMS` (top of the rail), so the engine the
  user most often returns to is the top, default, keyboard-Home target.
- **Styling: identical to every other rail item** — it flows through the same
  `RAIL_ITEMS.map` and inherits the full trigger className with no special-
  casing. No bespoke styles.

---

## 3. Tokens used (NONE added/changed)

All consumed via existing classes; no raw hex, no new `--*` variables.

| Role                         | Token / class                          | Value (dark)        |
|------------------------------|----------------------------------------|---------------------|
| Rail background              | `bg-popover` → `--popover`              | `#252526`           |
| Rail right border            | `border-border` → `--border`            | `#333333`           |
| Inactive rail icon           | `text-muted-foreground` → `--muted-foreground` | `#888888`    |
| Hover / active rail icon     | `text-foreground` → `--foreground`      | `#e0e0e0`           |
| Active indicator bar         | `bg-primary` → `--primary`              | `#4a9eff`           |
| Focus ring                   | `ring-ring` / `--ring` (via `TabsTrigger` focus-visible) | `#4a4a4c` |
| Tooltip surface / text       | `bg-foreground` / `text-background`     | `#e0e0e0` / `#1e1e1e` |
| Surface region background    | inherits `--background`                 | `#1e1e1e`           |

**Tokens added: none. Tokens changed: none.**

---

## 4. shadcn components used (NONE added)

| Component        | Variant / props                                   | Role                              |
|------------------|---------------------------------------------------|-----------------------------------|
| `Tabs`           | `orientation="vertical"`, controlled `value`      | the switcher root                 |
| `TabsList`       | `variant="line"`                                  | the icon rail                     |
| `TabsTrigger`    | (existing rail className, unchanged)              | one per surface, incl. Terminal   |
| `TabsContent`    | `forceMount`, `className="app__ui data-[state=inactive]:hidden"` | one per surface, incl. Terminal |
| `Tooltip` / `TooltipTrigger` / `TooltipContent` | `side="right"`     | per-rail-item label               |
| `TooltipProvider`| `delayDuration={300}`                             | shell-level provider              |

**Components added to `components/ui/`: none. Variants added: none.** The
Terminal surface is just a fifth `TabsContent` using the same `app__ui` class
the four aux surfaces already use.

---

## 5. States of the shell / switcher

The five-states matrix applies to the **shell/switcher**, not to re-designing
each panel (each panel's own loading/empty/error/populated states are already
designed and out of scope).

| State | Treatment |
|-------|-----------|
| **Default (launch)** | Terminal selected (`useState<SurfaceId>('terminal')`). Terminal rail item shows the active treatment (foreground `#e0e0e0` icon + 2px `#4a9eff` left indicator bar); the Terminal surface fills the entire main region. All five surfaces are mounted; the other four are `hidden`. |
| **Switching surface** | Clicking a different rail icon makes it the sole `data-[state=active]` trigger and the sole visible `TabsContent`; the previously active surface flips to `hidden` (mounted, not unmounted). No layout reflow of the region beyond the content swap — the region geometry is identical for all five. |
| **Hover (rail item)** | Inactive icon brightens `--muted-foreground` → `--foreground` (`#888` → `#e0e0e0`) via `hover:text-foreground`. No background fill (rail uses `variant="line"`, transparent). Tooltip with the surface name opens to the right after the 300 ms provider delay. |
| **Focus / keyboard** | `TabsTrigger` focus-visible ring (`focus-visible:ring-[3px] ring-ring/50` + `focus-visible:border-ring`) renders around the focused rail item. Radix roving tabindex: one tab stop for the whole rail; Up/Down (vertical orientation) move and activate between items; Home/End jump to Terminal / Confluence. |
| **Active indicator** | The selected item keeps the foreground icon and the 2px primary left bar (`before:` pseudo-element, `before:bg-primary`, `data-[state=active]:before:opacity-100`). Exactly one item is ever active. |
| **Empty / disabled (rail)** | N/A for v1. The rail is a fixed five-item set; no item is ever empty, hidden, or disabled, and there is no "no surfaces" state. No disabled styling is introduced. (Individual surfaces may show their own internal empty/disabled states inside the region — out of scope here.) |

---

## 6. Interaction & accessibility

- **Focus order:** header (non-interactive) → rail (single roving tab stop) →
  active surface content. Within the rail, Radix vertical Tabs provides roving
  tabindex: Tab enters the rail at the active item; Up/Down arrows move between
  the five items (wrapping per Radix default) and, with automatic activation,
  switch the surface; Home/End jump to first/last (Terminal/Confluence).
- **Labels:** every rail item — including Terminal — has `aria-label` equal to
  its display name and a matching `Tooltip` (`side="right"`). The `TabsList`
  carries `aria-label="Surfaces"`. Radix exposes the rail as a `tablist` with
  five `tab`s and links each to its `tabpanel` (`TabsContent`).
- **Hidden surfaces:** inactive `TabsContent` panels stay mounted but hidden;
  Radix sets `hidden` / removes them from the a11y tree when inactive, so AT
  users only perceive the one active surface — matching the visual single-
  surface model. This is unchanged from today's idiom.
- **Contrast (dark palette):**
  - Active/hover icon `#e0e0e0` on rail `#252526` ≈ 11:1 — passes AAA for the
    20px glyph.
  - Inactive icon `#888888` on `#252526` ≈ 3.5:1 — adequate for a large non-
    text graphic; the active state plus the primary bar carry the "which is
    selected" signal, so the muted inactive tone is intentional, not the sole
    differentiator.
  - Active indicator `#4a9eff` (primary) on `#252526` ≈ 4.6:1 — a clearly
    visible accent bar; selection is never conveyed by the bar alone (the icon
    also brightens to foreground), so it is not a color-only signal.
  - Focus ring uses `--ring` (`#4a4a4c`) at 3px — visible against the rail and
    the brighter active icon.

No new ARIA wiring is introduced; all of it is inherited from the existing
Radix Tabs + Tooltip composition simply by adding one more item to the map.

---

## 7. Open questions

None. The feature is fully expressible in the existing design system: no token
added or changed, no shadcn component or variant added. The only design
decision is the Terminal rail icon, resolved as **`SquareTerminal`** for
square-glyph family consistency with `SquareKanban`. If during build the
`SquareTerminal` mark reads optically heavier/lighter than its neighbors at
20px, the acceptable fallback is the plain `Terminal` glyph (same label, same
states) — but `SquareTerminal` is the recommendation.
