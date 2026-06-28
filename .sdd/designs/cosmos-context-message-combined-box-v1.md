# Design: Cosmos Timeline — Context + Message Combined Box — v1

**Status**: Draft
**Created**: 2026-06-29
**Spec**: `.sdd/specs/cosmos-context-message-combined-box-v1.md`
**Plan**: `.sdd/plans/cosmos-context-message-combined-box-v1.md`
**Owner**: designer

---

## Grounding (tools run directly for this design)

**codegraph_explore** — `CosmosTimelineEntry PromptContextChip UserBubble ToolCallRow`
(one-line takeaways):

- `UserBubble` = `<div className="flex justify-end"><p className="max-w-chat-bubble whitespace-pre-wrap
  break-words rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-body-sm text-primary-foreground">`.
  This is the EXACT no-context target the combined box must reproduce.
- `CosmosTimelineEntry` renders BOTH the `live-generating` and `user-prompt` branches as
  `flex flex-col gap-1` → `<PromptContextChip>` ABOVE `<UserBubble>`. These two stacks become the
  one combined `UserMessageBox`.
- `PromptContextChip` breadcrumb segments ALL hardcode `text-muted-foreground` on their glyphs/
  separators (panel glyph, `ChevronRight`, `↳`, `PRIMARY_ICON`, `MessagesSquare`) — tuned for the
  `bg-secondary` pill. Labels sit on the `Badge variant="secondary"` default foreground. The
  `role="note"` + `ariaLabelFor` + `TruncLabel`/`Tooltip` truncation are the reusable content.
- `ToolCallRow` = the STRUCTURAL reference only: an outer box with a header row + a body section
  separated by `border-t border-border/60`, body behind `{open && …}`. The combined box borrows the
  header→divider→body *structure* but is NOT collapsible and NOT `bg-muted/40`.

**Reads** — `docs/DESIGN.md` (§2 surface→token map, §15 chat-surface canon, D-11/D-14/D-17),
`src/renderer/index.css` (token confirmation), `src/renderer/cosmos/CosmosTimelineEntry.tsx`.

**Token values confirmed in `index.css`:** `--primary #e9aee9`, `--primary-foreground #2e1065`,
`--secondary-foreground #dddddd`, `--chat-bubble-max-w 66.6667%` (the `max-w-chat-bubble` @utility, 2/3).

---

## Overview

The user-prompt turn (live AND historical) becomes ONE combined message box inside the existing
right-aligned `bg-primary` bubble: **context breadcrumb HEADER → divider → message BODY**. The header
is static (no toggle/collapse), the body is always visible — explicitly the OPPOSITE of the
collapsible `ToolCallRow` (whose structure, not color, is the reference). Null/absent context → exactly
today's plain `bg-primary` bubble (no header, no divider). The breadcrumb CONTENT (panel › tab › ↳ dock,
same glyphs/separators/truncation/ARIA) is unchanged — only its PLACEMENT (above → in-bubble header)
and its on-fill COLOR change.

This is a renderer-only restructure of `CosmosTimelineEntry.tsx` consuming the plan's extracted
`PromptContextBreadcrumb`. No new token, no new `components/ui/` primitive.

---

## 1. Surfaces & layout

ONE surface: the Cosmos timeline user-prompt turn, in `CosmosTimelineEntry.tsx`, for BOTH the
`live-generating` and `user-prompt` branches (identical structure — FR-010). It replaces the
`flex flex-col gap-1` (`PromptContextChip` above `UserBubble`) stack with a single combined
`UserMessageBox`, right-aligned, capped at `max-w-chat-bubble` (2/3).

### Combined-box anatomy (context PRESENT)

```
┌─ flex justify-end (right-align) ────────────────────────────────────┐
│                          ╔═ max-w-chat-bubble ═══════════════════╗   │
│                          ║  HEADER  [glyph] Panel › [glyph] Tab  ║   │  ← static breadcrumb
│                          ║          › ↳ [glyph] item             ║   │
│                          ╟───────────── divider ─────────────────╢   │  ← border-t primary-fg/20
│                          ║  BODY  the user's prompt text, which  ║   │  ← always visible
│                          ║        wraps and is left-aligned …    ║   │
│                          ╚═══════════════════════════════════════╝   │
└─────────────────────────────────────────────────────────────────────┘
```

The box itself (one element) carries the brand accent + geometry: `bg-primary`,
`text-primary-foreground`, `rounded-2xl rounded-br-sm`, `max-w-chat-bubble`, `text-body-sm`, plus
`overflow-hidden` so the full-bleed divider clips cleanly to the rounded corners. The right-aligned
`rounded-br-sm` "tail" corner of the existing bubble is preserved.

### Combined-box anatomy (context ABSENT — FR-009 / SC-004)

The box renders ONLY the body section — no header, no divider — visually identical to today's
`UserBubble`: `bg-primary` / `text-primary-foreground` / `rounded-2xl rounded-br-sm` /
`max-w-chat-bubble` / `whitespace-pre-wrap break-words` / `px-3 py-1.5` / `text-body-sm`. The
header + divider appear ONLY when a context is present. The divider must never appear alone.

---

## 2. Tokens used

### Box (always)

| Element | Token(s) | Note |
|---|---|---|
| Box surface | `bg-primary` (`#e9aee9`) | unchanged brand "my message" accent (D-14) |
| Box text base | `text-primary-foreground` (`#2e1065`) | the body's tone |
| Box radius | `rounded-2xl rounded-br-sm` | unchanged sent-message geometry |
| Box width | `max-w-chat-bubble` (2/3) | unchanged shared width token |
| Box body type | `text-body-sm` (13px) | unchanged |
| Clip | `overflow-hidden` | so the divider clips to the rounded corners |
| Align | `flex justify-end` | right-aligned (box owns alignment) |

### Header (context present)

| Element | Token(s) | Contrast on `bg-primary` |
|---|---|---|
| Header type | `text-caption` (12px, §8) | matches the chip's prior Badge size |
| Header padding | `px-3 pt-1.5 pb-1` (§9 4px grid) | 12 / 6 / 4 px |
| Header inline layout | `flex min-w-0 items-center gap-1` | one-line breadcrumb, same gap as the chip |
| **Breadcrumb LABELS** (panel/tab/dock text) | **`text-primary-foreground/80`** | **≈5.4:1 — AA for the 12px label** |
| **Breadcrumb DECORATION** (glyphs, `ChevronRight`, `↳`, `MessagesSquare` — all `aria-hidden`) | **`opacity-70` relative to the header's `currentColor`** (≈ `primary-foreground/56`) | **≈3:1 — meets the graphical-object threshold; ornamental, the label carries meaning** |

### Divider (context present)

| Element | Token | Note |
|---|---|---|
| **Divider** | **`border-t border-primary-foreground/20`** | a subtle inset hairline in the SAME `primary-foreground` family as the header text — reads as a quiet rule ON the accent fill, NOT the foreign dark `border-border/60` line ToolCallRow uses on its muted box. Placed as `border-t` on the BODY section (ToolCallRow idiom), full-bleed within `overflow-hidden`. |

### Body (always)

| Element | Token(s) | Note |
|---|---|---|
| Body text | `text-primary-foreground` (full, `#2e1065`) | ≈8.5:1 — the loud element |
| Body wrapping | `whitespace-pre-wrap break-words` | unchanged escaped React text (FR-011) |
| Body padding | `px-3 py-1.5` | identical to today's bubble; `border-t border-primary-foreground/20` added ONLY when context present |

**No new tokens. No new primitives.** Every value is an existing foundation token (§7–§15) or a
Tailwind 4px-grid step (§9) — no raw hex, no arbitrary value (D-6).

---

## 3. CONTRAST FIX — the breadcrumb on `bg-primary` (architect-flagged)

**The problem.** The breadcrumb glyphs/separators are currently `text-muted-foreground` (`#888888`),
tuned for the OLD `bg-secondary` (`#3a3a3c`) pill. On `bg-primary` (`#e9aee9`, the pastel logo pink)
`#888888` computes to **≈1.9:1** — far below even the 3:1 graphical floor. It would read as a washed,
near-invisible gray smear on the pink. This is a real regression the move surfaces, not a hypothetical.

**The fix — move the header into the `primary-foreground` family.** The body already proves
`#2e1065` on `#e9aee9` is excellent (≈8.5:1). The header is a QUIETER caption (D-14: "accent message
vs quiet context — keep the prompt the loud element and the context a calm sub-line"), so:

- **Labels** = `text-primary-foreground/80` → **≈5.4:1**, comfortably AA for the 12px breadcrumb,
  yet visibly quieter than the full-strength body text below the divider.
- **Decoration** (icons + separators, all `aria-hidden`) = `opacity-70` relative → **≈3:1**, meeting
  the graphical-object threshold; these are purely ornamental (the labels and the single `aria-label`
  carry all meaning), so a soft decoration is correct and keeps the chip's "muted glyph / solid label"
  hierarchy intact on the new fill.

**Rationale, side by side (on `#e9aee9`):**

| Tone | Hex/effect | Contrast | Verdict |
|---|---|---|---|
| OLD `text-muted-foreground` | `#888888` | ≈1.9:1 | FAIL — the bug |
| Body `text-primary-foreground` | `#2e1065` | ≈8.5:1 | loud — the message |
| **Header label `…/80`** | ≈`#53307f` | **≈5.4:1** | **AA — quiet but legible** |
| **Header decoration `opacity-70`** | ≈`#724a8e` | **≈3:1** | **graphical AA — ornament** |

**Why the family, not a new token:** the header text is on the SAME accent fill as the body, so it
belongs to the same `primary-foreground` family; expressing "quiet" as an opacity step of that one
token (rather than inventing a `--primary-foreground-muted`) keeps the box on a single foreground
source and avoids a new token for a one-surface need.

**Standalone-pill coherence (the extracted breadcrumb stays reusable).** The plan extracts a
tone-NEUTRAL `PromptContextBreadcrumb` that draws labels in `currentColor` and decoration at
`opacity-70` relative — it hardcodes NO `text-muted-foreground`. Each consumer sets the base family:

- **In-bubble header container** sets `text-primary-foreground/80` → the tones above.
- **Standalone `Badge variant="secondary"` shell** sets `text-secondary-foreground` (`#dddddd` on
  `#3a3a3c`) → labels solid, decoration at `opacity-70` (a clean light-gray, ≥ the old muted look) —
  the pill stays legible and on-system. Its dom tests assert content/ARIA, not exact glyph hex, so this
  is safe.

This is the single mechanism that keeps the two surfaces from forking: ONE breadcrumb content source,
container-set tone, decoration as a relative opacity that works on ANY base family.

---

## 4. States

| State | Treatment |
|---|---|
| **Context present (populated)** | header (breadcrumb) → `border-t border-primary-foreground/20` divider → always-visible body, inside the one `bg-primary` box. |
| **Context absent / null (FR-009, SC-004)** | body ONLY — no header, no divider — visually identical to today's `UserBubble`. Applies to a `user-prompt` turn with no `context` AND a `live-generating` entry with no `promptContext`. |
| **Live (in-flight)** | identical combined box (header + divider + body) as the historical turn; the `AssistantRow` typing indicator renders below it as today. Box structure is stable across the live→confirmed transition (FR-010, SC-005). |
| **Long breadcrumb** | the existing `TruncLabel` (`min-w-0 truncate` + `Tooltip`) truncates the over-long segment WITHIN the box; the header's `flex min-w-0` + the box's `max-w-chat-bubble` keep it from widening the box past 2/3 (SC-006). |
| **Long / multi-line body** | `whitespace-pre-wrap break-words` wraps within `max-w-chat-bubble`, exactly as today; the header sits above unaffected. |
| **No collapse / no toggle (FR-005/FR-006)** | the header is static: NO `<button>`, NO `aria-expanded`, NO click target on header OR body. The body is never hidden. This is the explicit inverse of `ToolCallRow`. |
| **Loading / error / disabled** | N/A for this surface — it renders settled prompt text; the live turn's "in-progress" affordance is the assistant-side `TypingIndicator` (D-8), unchanged. |

---

## 5. Interaction & accessibility

- **No interaction** on the combined box: it is read-only display. No focusable control is added; the
  box introduces no new tab stop (the header is not a button — FR-005).
- **ARIA unchanged:** the breadcrumb keeps `role="note"` + the comprehensive `aria-label`
  ("Prompt context: …") from `ariaLabelFor`. All decorative glyphs/separators stay `aria-hidden`. The
  body is plain text. Screen-reader order = context note, then the message — context is announced
  before the prompt it scoped (the D-11 "read context before the prompt" intent, preserved).
- **Contrast:** labels ≈5.4:1 (AA), body ≈8.5:1, decoration ≈3:1 (graphical AA), divider is a non-text
  separator. See §3.
- **Keyboard:** nothing new — the box adds no controls; existing timeline scroll/focus behavior is
  unchanged.
- **Reduced motion:** N/A — the box has no animation (the divider is static; the only motion in the
  live turn is the assistant `TypingIndicator`, already reduced-motion-gated, D-8/§12).

---

## 6. DESIGN.md updates made (this design step)

- **§2 surface→token map** — the "Cosmos timeline — prompt context chip" row rewritten: the breadcrumb
  is now the IN-BUBBLE static HEADER of the user-prompt box (header → divider → body), sitting on the
  `bg-primary` fill with `text-primary-foreground/80` labels + a `border-primary-foreground/20`
  divider — NOT a free-standing `bg-secondary` pill above the bubble.
- **§15 chat-surface canon** — the role-map "Prompt context chip" row replaced by "User-prompt box
  (combined)" with header/divider/body sections, tones, and the in-bubble placement; the "Why
  `secondary` for its chip" prose reconciled to the in-bubble header (kept coherent with D-14 / D-17).
- **D-11** — rule changed from "chip ABOVE the bubble (`Badge variant="secondary"`)" to "context is the
  IN-BUBBLE static HEADER of the user-prompt box (header → divider → body) on the `bg-primary` fill,"
  retaining the breadcrumb CONTENT/idiom and the shared `max-w-chat-bubble`, and recording the on-fill
  contrast tones (the architect-flagged fix). Cross-refs the new D-18.
- **D-18 (new registry row)** — the combined-box contrast/divider rule: breadcrumb-on-`bg-primary`
  must use the `primary-foreground` family (labels `/80` ≈5.4:1, decoration `opacity-70`), NEVER
  `text-muted-foreground` (≈1.9:1 on the pink); the on-fill divider is `border-primary-foreground/20`,
  NOT `border-border`. Locks the regression the placement move surfaced.

---

## 7. Open questions

None blocking. The spec's confirmed decisions (sectioned structure, keep `bg-primary` accent,
static/no-collapse, both-turns parity, null→plain bubble) fully constrain the design; the deferred
items (divider treatment, header type/spacing, breadcrumb-on-`bg-primary` contrast) are resolved above
with exact tokens and a contrast rationale. The extracted `PromptContextBreadcrumb` is the developer's
to build (plan Phase 1); this spec fixes its tones via the consuming container, not by hardcoding color
inside it.
