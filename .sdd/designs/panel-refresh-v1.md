# Design: Panel-Level Refresh Control — v1

**Status**: Draft (2026-06-09)
**Spec**: .sdd/specs/panel-refresh-v1.md
**Plan**: .sdd/plans/panel-refresh-v1.md
**Owner**: designer

---

## 0. Scope

ONE panel-level refresh control per generative panel (Generated UI, Slack, Jira,
Confluence), mounted in the panel CHROME (outside the A2UI host), acting on the active
tab's surface. It REPLACES the per-surface in-surface `RefreshButton`
(`src/renderer/catalogShared/controls.tsx`), which is removed (FR-006). `LoadMoreButton`
and `PaginationBar` STAY in-surface and unchanged (FR-007). This is a pure
reuse-the-system design: the control is one `Button variant="ghost" size="icon-sm"` plus
the existing `lucide` `RotateCw` / `Loader2` glyphs and `Tooltip` — no new tokens, no new
component, no one-off CSS.

The new component is `src/renderer/PanelRefreshButton.tsx` (built by the developer to this
spec). Pure enabled/busy derivation lives in `src/renderer/panelRefreshLogic.ts`.

---

## 1. Placement (one location, all four panels)

**Decision: the trailing area of `PanelTabStrip`, pinned to the LEFT of the `+`
new-tab button.** The control sits in the same non-scrolling trailing cluster the `+`
already lives in, so the strip's trailing edge becomes `[ ⟳ ] [ + ]`.

### Why the tab strip, not the footer or a new row

- **It already has a pinned, non-scrolling trailing cluster.** `PanelTabStrip` keeps the
  `+` button OUTSIDE the `overflow-x-auto` tab list (`src/renderer/PanelTabStrip.tsx:400`),
  always present including the zero-tab state. Adding a sibling immediately before `+`
  reuses that exact slot — no new layout primitive, no new chrome band.
- **The strip is the ONE piece of chrome every panel shares identically.** All four panels
  mount `PanelTabStrip` the same way; the footer's `right` slot is already CONSUMED by the
  connection-status cluster on Jira/Slack/Confluence (`JiraPanel.tsx:471`,
  `ConfluencePanel.tsx:622`, and Slack), so a footer-based control would be uniform on only
  one of four panels and crowd the connection bar on the other three. The tab strip is the
  only placement that is byte-for-byte identical across all four. (FR-001: exactly one,
  consistent location.)
- **It reads as chrome acting on "the active tab," not as surface content.** Refresh is a
  per-active-tab action; living in the tab strip's trailing cluster ties it visually to the
  tab row (which already owns the active-tab concept) and keeps it clearly OUTSIDE the A2UI
  host region below — distinct from in-surface `LoadMoreButton` / `PaginationBar` (§6).
- **A dedicated chrome row is rejected** — it would add a third horizontal band (strip +
  new row + footer) to a deliberately dense VS Code-style layout for a single icon button.

The control is a sibling of `+` inside the strip container, rendered as a new optional
slot in `PanelTabStrip` (a `refresh?: { … }` prop or a `trailing` render slot — interface
decides; the strip stays the owner so the cluster geometry/borders stay in one file). It
is `shrink-0`, `self-center`, and never scrolls.

### ASCII chrome sketch (per panel, control idle)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▎Channels list   ✕ │ #general  ✕ │ Untitled │            [ ⟳ ] [ + ] │  ← PanelTabStrip (h-8)
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   A2UI surface host  (active tab's surface)                            │
│     · LoadMoreButton / PaginationBar live HERE, in-surface             │
│                                                                        │
│                         (PromptComposer overlay floats above footer)   │
├──────────────────────────────────────────────────────────────────────┤
│ # Slack                                       Connected · Disconnect   │  ← PanelFooter (h-7)
└──────────────────────────────────────────────────────────────────────┘
                                                  ▲
                              refresh ⟳ pinned left of + , never scrolls
```

Trailing cluster detail (the only thing that changes):

```
…last tab │ [ ⟳ ]│[ + ]      ⟳ = RotateCw (idle) / Loader2 (busy)
          border-l  border-l   each icon-sm (size-8), ghost, rounded-none
```

Both buttons carry the existing `border-l border-border rounded-none` treatment the `+`
already uses, so they read as one segmented chrome cluster flush to the 32px strip.

---

## 2. Component & variants (reuse only)

| Element            | Component / variant                                                    |
|--------------------|------------------------------------------------------------------------|
| The control button | `Button variant="ghost" size="icon-sm"` (`src/renderer/components/ui/button.tsx`) — SAME variant+size the removed in-surface `RefreshButton` used, and the SAME as the strip's `+` button, so the cluster is visually uniform. |
| Idle glyph         | `lucide` `RotateCw`, `className="size-4"` (parity with removed control) |
| Busy glyph         | `lucide` `Loader2`, `className="size-4 animate-spin"` (parity)          |
| Tooltip            | `Tooltip` / `TooltipTrigger asChild` / `TooltipContent side="bottom"` — matches the `+` button's tooltip pattern exactly (`PanelTabStrip.tsx:402`). Content: "Refresh". |

Container classes on the button (matching the `+` sibling): `shrink-0 self-center
rounded-none border-l border-border`. No bespoke CSS.

**Nothing is added to the design system.** No new token, no new `components/ui/` primitive,
no new variant. If the interface step finds the strip cannot expose a clean trailing slot
without a one-off, that is a structural prop change to `PanelTabStrip`, NOT a design-system
addition — flag back here rather than hand-rolling a styled `<div>`.

---

## 3. The five states

The control derives its state from the active tab's surface via the pure
`panelRefreshLogic` (active `surfaceId | null`, `registered`/`hasDescriptor` boolean,
`busy` boolean). All glyph colors come from existing tokens.

### 3.1 Idle (enabled) — FR-003

- `Button variant="ghost" size="icon-sm"`, not disabled.
- Glyph: `RotateCw size-4 text-muted-foreground` (the removed control's exact idle color,
  `#888888` dark) — reads as available chrome, not a primary CTA.
- Hover: inherits ghost `hover:bg-accent hover:text-accent-foreground` → glyph brightens to
  `--accent-foreground` (`#e0e0e0`). Active press: ghost default (no extra).
- Tooltip "Refresh" on hover/focus.

### 3.2 In-flight / busy (non-actionable) — FR-003 / FR-016

- Glyph swaps to `Loader2 size-4 animate-spin` (spinning), color `text-muted-foreground`
  (same hue as idle; the MOTION, not a color change, carries "busy" — matches the strip's
  in-flight tab glyph using `Loader2`).
- The button is NOT `disabled` (it must stay focusable and keep its `aria-busy`), but its
  `onClick` is a guarded no-op while busy (mirrors the removed control's `if (isLoading)
  return` and `LoadMoreButton`/`PaginationBar`). `aria-busy={true}` set (§5).
- Cursor: default (no `pointer`) while busy, so it does not invite a click.

### 3.3 Disabled (no refreshable surface) — FR-003 / FR-004

Active tab has no registered/bound surface: an empty/Untitled tab, a native-base browser
view (Slack/Confluence/Jira non-composed chrome), or a surface composed without a
descriptor.

- Button gets the `disabled` attribute → shadcn base applies `disabled:opacity-50
  disabled:pointer-events-none` (button.tsx:8). Glyph stays `RotateCw` (idle icon) at 50%
  opacity.
- Conveyed BEYOND color (a11y): the native `disabled` attribute sets `aria-disabled` /
  removes it from the tab order and blocks pointer + keyboard activation; the tooltip on a
  disabled control is suppressed (no actionable hint). The 50% opacity is reinforcement
  only, never the sole signal.
- This is the Generated-UI default when its `render_ui` surface carried no descriptor
  (OQ-2): same shared control, disabled by derivation — no per-panel branch.

### 3.4 Empty panel (zero / Untitled tab)

The panels always keep ≥1 tab (each seeds a tab on mount, e.g. `SlackPanel.tsx:698`), and a
fresh `+` tab is "Untitled" with no composed surface. So "empty panel" resolves to the
**disabled** state (§3.3): the control is present (the strip and its trailing cluster always
render) but disabled, because the active Untitled tab has no refreshable surface. The control
is never absent — a stable, always-present affordance reads as more uniform than one that
appears/disappears, and FR-003 permits disabled in lieu of absent.

### 3.5 Error / last-refresh affordance — NOT added

No error glyph or last-refreshed timestamp on the control. Justification:

- A refresh that fails surfaces through the EXISTING channels the design already owns — the
  active tab's run-status glyph in `PanelTabStrip` (in-flight `Loader2` / error `CircleAlert`
  + tooltip) and `PanelFooter`'s mirrored run-status glyph. Adding a third error signal on
  the refresh button would duplicate that and diverge the four panels.
- After a failed/settled refresh the control simply returns to §3.1 idle (re-clickable —
  FR-008 makes `adapter.*` repeatable), so a retry is the same affordance. No separate
  error/last-refresh state is warranted; adding one is out of scope unless a future spec asks.

### State summary

| State    | `disabled` | Glyph                         | Color                    | Tooltip   | Clickable |
|----------|-----------|-------------------------------|--------------------------|-----------|-----------|
| Idle     | no        | `RotateCw size-4`             | `text-muted-foreground`  | "Refresh" | yes       |
| Busy     | no        | `Loader2 size-4 animate-spin` | `text-muted-foreground`  | "Refresh" | no (guard)|
| Disabled | yes       | `RotateCw size-4`             | inherited @ opacity-50   | none      | no        |
| Empty    | (= Disabled) | `RotateCw size-4`          | inherited @ opacity-50   | none      | no        |

---

## 4. Tokens

All from the existing cosmos dark palette (`src/renderer/index.css`). **None added.**

| Token / value          | Used for                                                            |
|------------------------|--------------------------------------------------------------------|
| `--popover` (#252526)  | Strip background the button sits on (inherited from the strip).     |
| `--border` (#333333)   | `border-l` between the control and `+`, and the strip's bottom edge.|
| `--muted-foreground` (#888888) | Idle + busy glyph color.                                    |
| `--accent` (#2d2d30) / `--accent-foreground` (#e0e0e0) | Ghost hover bg + glyph.            |
| `--ring` (#4a4a4c)     | `focus-visible:ring-[3px] ring-ring/50` from the Button base.       |
| `--radius` (0.5rem)    | Not applied — the cluster uses `rounded-none` to sit flush in the strip (same as `+`). |

Sizing: `size-8` (the `icon-sm` 32px box) fits the 32px (`h-8`) strip exactly; glyph
`size-4` (16px) matches the `+` button's `Plus size-4`. Spacing: none added — the
`border-l` segmenting IS the spacing, identical to the `+` treatment.

### Contrast on the dark palette

- Idle glyph `#888888` on `#252526`: ~2.0:1. This is INTENTIONALLY at the established
  cosmos chrome-glyph level — it is the exact value the removed `RefreshButton` and the
  strip's terminal/decorative glyphs already use, so it stays uniform. The meaning is NOT
  carried by the dim glyph alone: the `aria-label` "Refresh" + tooltip carry it for AT, and
  hover/focus raises the glyph to `#e0e0e0` on `#2d2d30` (~9:1) for the active affordance.
- Focus ring `--ring` (#4a4a4c) at `ring-[3px]` is the same visible focus treatment every
  chrome control uses; it does not rely on glyph contrast.
- Disabled @ opacity-50 is reinforced by the non-color `disabled` semantics (§3.3), so the
  reduced contrast is never the sole disabled signal.

---

## 5. Interaction & accessibility

- **ARIA label**: `aria-label="Refresh"` on the button (parity with the removed control).
- **Busy**: `aria-busy={true}` while in-flight (§3.2); cleared when settled. Matches the
  removed control and the strip's in-flight tab.
- **Disabled**: native `disabled` attribute (§3.3) — conveys disabled to AT and removes the
  control from the tab order; not color-only.
- **Keyboard / focus order**: the control is a normal `<button>` in the strip's trailing
  cluster, BEFORE `+` in DOM order, so Tab order through the chrome reads:
  `…active tab (roving) → [Refresh] → [+] → content/composer`. It is NOT part of the tab
  strip's roving-tabindex tablist (the refresh button is a sibling of the `role="tablist"`
  list container, not a `role="tab"` inside it), so it does not interfere with Arrow-key
  tab navigation. Enter/Space activate it (native button). When disabled it is skipped.
- **Relative to the composer**: the `PromptComposer` lives in its own overlay slot below the
  content; the refresh button is above it in the chrome and reachable independently — no
  focus-trap interaction.
- **Tooltip**: `side="bottom"` "Refresh", shown on hover + keyboard focus (Radix Tooltip
  built-in a11y); suppressed when disabled.
- **Reduced motion**: the busy `Loader2 animate-spin` follows the same project convention as
  the strip's in-flight glyph; if a global reduced-motion gate exists it applies uniformly.
  `aria-busy` carries the busy meaning when motion is off.

---

## 6. Distinction from other affordances (required confirmation)

The control must NOT be confused with in-surface controls or the composer send-spinner:

| Affordance              | Where        | Shape / glyph                         | Distinction |
|-------------------------|--------------|---------------------------------------|-------------|
| **Panel refresh (this)**| Chrome — tab-strip trailing cluster | `icon-sm` ghost icon button, `RotateCw` / `Loader2`, NO text | Lives in the 32px strip, segmented with `+`; icon-only circular-arrow; one per panel. |
| `LoadMoreButton`        | In-surface (inside A2UI host) | `outline` / `sm`, TEXT "Load more" / "Loading…", centered, `pt-1` | Text label + outline variant + centered in the list; appears only when `hasMore`. Never an icon-only button. |
| `PaginationBar`         | In-surface   | Two `ghost sm` TEXT buttons "Prev"/"Next" with chevrons + a page label | A full bar with directional chevrons + page text, justified-between; clearly a pager. |
| Composer send-spinner   | Composer overlay / surface | The `CosmosSpinner` (orbiting 4-point brand star), large, brand-colored | A distinctive multi-element brand mark, NOT a `Loader2` ring; sits center-surface during a run, not in the strip. |

The panel refresh control is the ONLY icon-only circular-arrow (`RotateCw`) affordance, the
ONLY refresh control in the chrome, and uses the plain `Loader2` ring (not the brand
`CosmosSpinner`) for busy — so it is visually unambiguous against all three. The in-surface
`RefreshButton` (the only other `RotateCw`) is being removed (FR-006), so `RotateCw` becomes
unique to this control.

---

## 7. Build notes for the developer (no design-system edits)

- Create `src/renderer/PanelRefreshButton.tsx` per §2/§3/§5. Props (per plan): active
  `surfaceId | null`, `registered`/`hasDescriptor` boolean, `busy` boolean, plus the
  `onRefresh` dispatch. No invented props.
- Expose a trailing slot on `PanelTabStrip` (optional `refresh` prop / `trailing` node)
  rendered LEFT of `+`, sharing the `shrink-0 self-center rounded-none border-l
  border-border` treatment. Keep the geometry in `PanelTabStrip` so the cluster stays in one
  file. (This is a structural prop addition, not a new design-system primitive.)
- Mount it in all four `*Panel.tsx` via that strip slot, fed the active tab's surface state.
  GeneratedUiPanel mounts the SAME control (disabled by derivation when no descriptor).
- Remove `RefreshButton` / `RefreshButtonNode` from `catalogShared/controls.tsx` and drop
  its catalog registrations (FR-006). Leave `LoadMoreButton` / `PaginationBar` untouched.
- No `index.css` change, no `components/ui/` change, no `components.json` change.

---

## 8. Open questions

None blocking. One interface-level choice (not a design blocker): whether the trailing
slot on `PanelTabStrip` is a typed `refresh` prop vs. a generic `trailing` render slot —
either satisfies this design; the strip must remain the owner of the cluster geometry so the
`+`/refresh segmentation stays uniform across panels.
