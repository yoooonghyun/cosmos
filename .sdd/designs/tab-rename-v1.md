# Design: Inline tab rename (editing state for `PanelTabStrip`) — v1

**Status**: Draft
**Created**: 2026-06-07
**Spec**: `.sdd/specs/tab-rename-v1.md`
**Plan**: `.sdd/plans/tab-rename-v1.md`
**Owner**: designer

---

## 0. Blockers / required handoffs (read first)

There are **no blocking visual unknowns**. This feature adds exactly one new visual state
(an inline-edit input) to the existing `PanelTabStrip` and is expressible entirely in the
current token system. **No new theme token is required.**

**One component decision (justified, §4):** the shadcn `Input` primitive does **NOT** fit
the 32px (`h-8`) tab cell — it is `h-9` (36px) with `px-3 py-1 text-base`, which would
exceed the band height and force the strip to grow/jump, violating FR-002's "without
changing cell height". Rather than restyle the shared `Input` (which is correct as-is for
forms everywhere else), the edit field is a **raw `<input>` styled inline to the tab-cell
footprint**, reusing the same tokens the `Input` uses (`--ring`, `selection:bg-primary`,
`text-foreground`). This is a thin in-component element, NOT a new entry in
`components/ui/`. (Verbatim classes in §5.) No `components/ui/` addition, no
`npx shadcn add`, no package install — `PanelTabStrip.tsx` already imports everything it
needs; `lucide-react` glyphs are unchanged.

**Developer handoff (no Bash for the designer):** none. All class strings the developer
needs are in §5. The designer authors no `.tsx` — the strip consumes existing tokens only.

---

## 1. Surface & where it lives

The only surface touched is **`PanelTabStrip`** (`src/renderer/PanelTabStrip.tsx`), the
shared strip rendered below every rail panel's header (Terminal, Generated UI, Slack,
Jira, Confluence). The new state is **per-tab cell**, internal to the strip — no new
panel, header, dialog, or popover. Nothing else in the app changes visually.

The editing field replaces **only the label `<span>`** (`PanelTabStrip.tsx` §5 line ~182)
inside the existing tab `<button role="tab">` cell. The cell's outer footprint — height,
`px-2.5`, `gap-1.5`, leading glyph slot, the active top-accent `before:` bar, the border —
is **unchanged** so the strip never reflows or jumps when a tab enters/leaves edit mode.

---

## 2. Layout — the editing cell

The tab cell keeps its existing three-slot horizontal flex (`gap-1.5`, `items-center`):

```
Tab (button[role=tab], h-full, max-w-[16rem], px-2.5, gap-1.5)   ← unchanged footprint
├── leading glyph   (spinner | error | terminal — UNCHANGED, still shown while editing)
├── EDIT INPUT      (replaces the label <span>; occupies the same min-w-0 flex-1 slot)
└── (Close X)       (HIDDEN while this tab is editing — see §3.2)
```

- The input takes the **same** label slot: `min-w-0 flex-1` so it fills the available
  width and the cell width is still governed by `max-w-[16rem]` (no jump in cell size when
  swapping span→input on a short label; a long label simply truncates as before because
  the cell is already at `max-w-[16rem]`).
- The leading glyph slot is **untouched** — the spinner/error/terminal glyph stays exactly
  where it is (it is part of the tab's lifecycle identity, not its label). A renamed-while-
  in-flight tab still shows the spinner to the left of the input (spec edge case).
- The Close `X` is **removed from layout while editing** (`display:none`, not just opacity)
  so it can never be a click target during a rename and so the input can use the full
  trailing width. On commit/cancel it returns to its normal hover/active-reveal behavior.

### Height discipline (no jump)

The input is sized so its box height ≤ the label line-box it replaces:
`h-5` (20px) inside the 32px band, vertically centered by the cell's `items-center`. No
vertical padding (`py-0`), `leading-none`-equivalent via the fixed `h-5`. The input border
is **inset** (it does not add to the cell height because the cell is `h-full` and the
input is shorter than the band). Result: swapping span↔input changes nothing about the
strip's 32px height or the cell's width band.

---

## 3. States

The existing resting states are **unchanged**. This feature adds ONE new state (`editing`)
that is orthogonal to status (a tab can be idle/in-flight/error AND editing).

### 3.1 Unchanged resting states (for reference, no change)

| State | Treatment (unchanged) |
|-------|------------------------|
| Inactive | `bg-transparent text-muted-foreground`, hover `bg-accent text-foreground` |
| Active | `bg-background font-medium text-foreground`, primary top-accent `before:` bar |
| In-flight | leading `Loader2` spinner (`text-primary`), `aria-busy` |
| Error | leading `CircleAlert` (`text-destructive`), label `text-destructive` |
| Untitled | label `italic text-muted-foreground` |

### 3.2 NEW — Editing state

Entered by double-click on the label region, or F2 on the focused tab (§6). While
`editingTabId === t.id`:

- **Label `<span>` is replaced by the edit `<input>`** (§5). The `untitled` italic-muted
  treatment does **not** apply to the input — the user is typing a real value, so the input
  text is normal `text-foreground` (an Untitled tab being renamed shows normal, not italic,
  text in the field).
- **Leading glyph: stays.** Spinner/error/terminal glyph unchanged (§2).
- **Close `X`: hidden** (`hidden`, removed from layout) for the editing tab only — other
  tabs' `X` behave normally.
- **Cell background:** the editing tab reads as **active** (the act of editing focuses it;
  the panel activates the tab on edit-start). So it gets the active treatment
  (`bg-background`, top-accent bar). If a non-active tab is somehow edited without
  activating, the editing cell still gets `bg-background` so the input sits on the panel-
  body background it shares borders with — i.e. **editing always renders on `bg-background`**
  for input legibility, regardless of active state.
- **Input focus ring:** the input itself carries the focus ring (the tab button's own
  `focus-visible:ring` is not active because focus is inside the input). Ring uses the same
  tokens as the shadcn `Input`: `focus-visible:ring-[3px] focus-visible:ring-ring/50` plus
  `focus-visible:border-ring`. Because the input is always focused while editing, the ring
  is effectively always visible in this state — that IS the affordance that the field is
  live (§4).

### 3.3 Empty-commit revert (visual)

Committing empty/whitespace is **not an error state** — there is no red, no shake, no
toast. The input simply disappears and the tab returns to its **pre-edit label** in its
prior resting state (FR-005). Visually indistinguishable from pressing Escape. The only
difference is internal (renamed flag not set) and not surfaced visually.

### 3.4 Editability affordance (resting)

No persistent "pencil" icon or hover chrome is added — that would clutter the dense strip
and fight the existing hover-reveal `X`. The affordances are:
- **Cursor:** the label region shows `cursor-text` on hover (distinct from the cell's
  `cursor-pointer`) to hint the label is directly editable. (Applied to the label `<span>`
  only; the rest of the cell keeps `cursor-pointer`.)
- **Tooltip:** the existing idle tooltip already shows the full label; no rename hint text
  is added to the tooltip (keeps it quiet; double-click-to-rename is a learned convention
  matching VS Code / browser tab renaming and the F2 parity covers discoverability for
  keyboard users).

---

## 4. Component decision — raw `<input>`, not shadcn `Input`

**Why not the shadcn `Input`:** it is `h-9` (36px) > the 32px band, with `px-3 py-1
text-base` (16px type) — too tall and too large; dropping it in grows the strip and breaks
FR-002. Its border/shadow (`shadow-xs`, `rounded-md`, full-width box) are form-field
styling that reads as a chrome island inside a flat 13px tab cell.

**Why not restyle the shared `Input`:** the `Input` is correct everywhere else (forms,
composers). Overriding half its base classes at this one callsite is more code and more
fragile than a purpose-built field, and risks regressing other `Input` users if the base
changes.

**Decision:** a raw `<input type="text">` styled inline (§5) that:
- matches the tab's own typography (`text-[13px]`) and sits transparently on the cell
  (`bg-transparent`) so it reads as the label becoming editable, not a separate widget;
- reuses the **same focus-ring + selection tokens** as the shadcn `Input`
  (`ring-ring/50`, `border-ring`, `selection:bg-primary selection:text-primary-foreground`)
  so it is visually consistent with every other text field in cosmos.

This is a **one-off element inside the strip**, justified by the cell-height constraint —
consistent with how `PanelTabStrip` is itself a bespoke composite (it is not the shadcn
`Tabs`). It adds **nothing** to `components/ui/`.

---

## 5. Tokens & exact classes (no new tokens)

| Element | Tokens | Classes (verbatim) |
|---------|--------|--------------------|
| Edit input | `--ring`, `--primary` (selection), `--foreground` | `h-5 w-full min-w-0 flex-1 rounded-[3px] border border-ring bg-background px-1 py-0 text-[13px] leading-none text-foreground outline-none selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Label `<span>` (resting, cursor hint added) | — | append `cursor-text` to the existing `min-w-0 truncate` (+ existing `italic text-muted-foreground` when `untitled`) |
| Close `X` (editing tab) | — | add `data-[editing=true]:hidden` (or conditional `hidden`) — removed from layout while this tab is editing |
| Editing cell background | `--background` | force `bg-background` on the cell while editing (it is also active, so the existing `data-[state=active]:bg-background` already supplies this; ensure editing implies the active treatment) |

Notes:
- `rounded-[3px]` (≈ `--radius-sm` family, tighter than the `Input`'s `rounded-md`) keeps
  the small field from looking pill-ish in a 20px box; it is a hairline rounded rect.
- `border-ring` gives a quiet 1px outline using the same `--ring` (`#4a4a4c` dark) the
  `Input` uses for its focus border — the input never appears borderless on `bg-background`.
- `px-1` (4px) horizontal padding — minimal, so the caret/text sit close to where the
  label text was (avoids a visible horizontal shift on span→input swap).
- The input must NOT carry `transition` on width/box so there is no animated reflow; the
  swap is instantaneous.

---

## 6. Interaction & accessibility

### 6.1 Entering edit mode

- **Double-click** the label region (the `<span>`) → edit mode. The double-click must not
  leave the tab half-toggled by the single-click activate handler (FR-010/FR-011) — the
  developer guards activation during the edit gesture (logic concern, plan Phase 3).
- On enter: the input is **focused** and its **text fully selected** (FR-002) so typing
  replaces the whole label and the user sees the current value highlighted (the standard
  rename affordance). Caret-at-end is the fallback only if select-all is unavailable; the
  spec requires select-all.

### 6.2 Commit / cancel

- **Enter** or **blur** → commit the trimmed value via the pure `renameCommitDecision`
  (logic); empty/whitespace reverts silently (§3.3). **Escape** → cancel, restore pre-edit
  label.
- **Focus return (FR-016):** on commit OR cancel, focus returns to the tab's
  `<button role="tab">` (roving-tabindex parity), so keyboard users land back on the tab
  they were renaming, not lost in the document.
- `stopPropagation` on the input's click/keydown so editing never triggers the cell's
  activate/close (FR-010). Escape inside the input must not bubble to any global handler.

### 6.3 ARIA / accessible name

- The input gets **`aria-label={`Rename ${preEditLabel}`}`** (FR-015) so a screen reader
  announces it as the tab-label editor for the specific tab. (Use the pre-edit label so the
  name is stable during typing.)
- The input is a single-line text field; no `role` override needed (native `<input
  type="text">`). It is the only focusable thing in the cell while editing (the `X` is
  removed from layout, §3.2), so Tab/Shift-Tab don't land on a hidden control.
- The tab `<button>` retains `role="tab"`, `aria-selected`, `aria-busy` — editing does not
  change the tab's ARIA lifecycle semantics, only swaps its visible label child.

### 6.4 F2 decision — **CONFIRMED (ship F2)**

**Decision: include F2** as the keyboard entry to edit mode (FR-014, P2/SHOULD). It does
**not** clash with the existing roving-tablist key handling in `handleTabKeyDown`
(`PanelTabStrip.tsx`): that handler binds **Arrow/Home/End** (move focus),
**Enter/Space** (activate), **Delete/Backspace** (close). **F2 is unbound there**, and F2
is the established OS/IDE convention for "rename the focused item" (VS Code, Finder,
Windows Explorer, file trees) — it carries zero collision risk and gives true keyboard
parity with the double-click P1 path. Add `case 'F2'` to `handleTabKeyDown`:
`preventDefault()` then enter edit mode for that tab (seed draft from current label, focus
+ select-all), identical to double-click. While the input is focused, F2 is inert (the tab
button no longer has focus), so no re-entrancy concern. This is purely additive and safe;
**no reason to defer.**

### 6.5 At-most-one-editing + cancellation (visual consequence)

- Only one tab is `editing` at a time (FR-012) — starting an edit elsewhere first
  commits/cancels the current one; visually you never see two input fields.
- The edit is cancelled (input vanishes, label reverts) when the edited tab is closed, a
  new run starts, or the active tab changes (FR-013) — a silent revert, no error visual
  (§3.3).

---

## 7. Contrast (cosmos dark palette)

- **Input text:** `text-foreground` `#e0e0e0` on `bg-background` `#1e1e1e` → contrast ratio
  ≈ 12.6:1 (passes WCAG AAA for text). Far more legible than the resting inactive label
  (`text-muted-foreground` `#888` ≈ 4.0:1), which is intentional — editing should read as
  crisp, active text.
- **Input border:** `border-ring` `#4a4a4c` on `#1e1e1e` is a quiet hairline (≈ 1.4:1 — a
  subtle separator, not text, so the low ratio is appropriate); the **focus ring**
  `ring-ring/50` plus `border-ring` provides the clear "this is live" cue, matching every
  other focused field in cosmos.
- **Selection:** `selection:bg-primary` `#4a9eff` with `selection:text-primary-foreground`
  `#0b1622` — the same high-contrast selection used app-wide; the pre-selected label on
  entry is clearly highlighted.
- The leading spinner/error glyph keep their existing `text-primary` / `text-destructive`
  tints (`#4a9eff` / `#f3b0b0` on `#1e1e1e`), both legible, unchanged.

---

## 8. State / requirement trace

| State / behavior | Spec | Section |
|------------------|------|---------|
| Editing input replaces label, focused + selected | FR-002 | §2, §3.2, §6.1 |
| Leading glyph stays; `X` hidden while editing | edge case | §2, §3.2 |
| Empty-commit reverts with no error visual | FR-005 | §3.3 |
| Editability cursor affordance | — | §3.4 |
| Raw input over shadcn `Input` (fits 32px) | FR-002 | §4 |
| Tokens reused (ring/selection/foreground/background) | — | §5 |
| Double-click + Enter/blur/Escape | FR-001/003/004 | §6.1, §6.2 |
| Accessible name on input | FR-015 | §6.3 |
| Focus enters input, returns to tab button | FR-016 | §6.2 |
| F2 keyboard entry (shipped) | FR-014 | §6.4 |
| One editing tab; cancel on close/run/switch | FR-012/013 | §6.5 |
| Dark-palette contrast | — | §7 |

Unchanged states (idle/active/in-flight/error/Untitled) inherit `panel-tabs-v1.md` §3/§5
verbatim.

---

## 9. Open questions

None. The F2 affordance is resolved (ship it, §6.4); the component choice is resolved (raw
inline input, §4); no new token or `components/ui/` primitive is needed.
