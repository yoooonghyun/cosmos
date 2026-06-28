# Design: Cosmos Timeline Prompt Context — v1

**Status**: Draft
**Created**: 2026-06-28
**Spec**: `.sdd/specs/cosmos-timeline-prompt-context-v1.md` (APPROVED)
**Plan**: `.sdd/plans/cosmos-timeline-prompt-context-v1.md` (Phase 0 — Design)
**Surface owner**: designer · **Builds**: `src/renderer/cosmos/PromptContextChip.tsx`,
`src/renderer/cosmos/CosmosTimelineEntry.tsx` (render site)

---

## Grounding (tools I actually ran)

**`docs/DESIGN.md` (read FIRST, in full):** the enforced canon. Load-bearing for this surface:
§2 surface→token map, §7.1 core tokens, §8 typography ramp (`text-caption`), §14 primitive canon
(**Badge** secondary, **Tooltip** overlay), and registry **D-6** (named scales, no raw arbitrary
values), **D-8** (Cosmos panel is a CHAT timeline), **D-10** (`SURFACE_ICON` = the ONE source of a
rail surface's glyph).

**`codegraph_explore` queries (one-line takeaways):**

- `Badge badgeVariants Tooltip TooltipContent components/ui/badge` — `Badge` is a rounded-full
  `inline-flex … overflow-hidden … text-xs font-medium` pill; `variant="secondary"` =
  `bg-secondary text-secondary-foreground`; all inner SVGs are forced to `size-3` by the variant.
  `Tooltip`/`TooltipTrigger asChild`/`TooltipContent` is the existing overlay primitive (inverted
  `bg-foreground text-background` chip). Both reusable as-is — **no new primitive needed.**
- `PROMPT_PANEL label SurfaceId panelName` — `SurfaceId` (`app/railVisibility.ts`) is the rail id
  type; `PromptPanelId` (plan §A) is its composer-bearing subset, so `SURFACE_ICON[panel.id]`
  (D-10) is keyed correctly for the panel glyph.

**Files read directly:** `app/ContextChip.tsx` + `app/viewContextCapture.ts` (the composer "↳ item"
treatment I am reusing — `Badge variant="secondary"`, leading muted `↳`, `PRIMARY_ICON` per kind,
truncating label + `Tooltip`, `role="note"` + `aria-label="Prompt context: …"`, and a trailing `×`
remove control I am DROPPING for read-only history); `cosmos/CosmosTimelineEntry.tsx` (the
right-aligned, `bg-primary/15`, `rounded-2xl rounded-br-sm` `UserBubble`; the `live-generating`
branch that renders `UserBubble` + `TypingIndicator`).

**`memory_recall`:** `cosmos timeline prompt context marker viewContext chip` — recalled the
design-foundation canon + the finalized prompt-context architecture memo (marker = display/
persistence, chip reuses composer treatment). Nothing re-opened.

---

## 1. Surface & layout

One new read-only affordance: the **PromptContextChip** — a quiet, single-line breadcrumb pill that
names what the user was looking at when they sent a prompt. It attaches to the **user-prompt turn**
of the Cosmos conversation timeline (both the historical `user-prompt` turn and the
`live-generating` in-flight bubble), nowhere else.

**Placement — directly ABOVE the `UserBubble`, right-aligned to it
(cosmos-context-chip-position-and-historical-v1 #2).** The bubble is right-aligned with a squared
bottom-right corner (`rounded-br-sm`, a "sent" tail); the chip sits above it as a leading "I was
looking at …" caption, so the captured context is read BEFORE the prompt it scoped. This keeps the
composer's "↳ item" reading as "context ↳ message."

- **Historical `user-prompt` turn** (`CosmosTimelineEntry`, `case 'user-prompt'`): wrap
  `<PromptContextChip context={turn.context} />` then the existing `<UserBubble>` in a
  `flex flex-col gap-1` container. Today's bare `<UserBubble>` is unchanged when there is no context
  (chip returns null).
- **`live-generating` entry**: the `flex flex-col gap-1` stacks the chip FIRST, then `UserBubble`,
  then `TypingIndicator` (chip → bubble → typing dots). The chip belongs to the user prompt; the
  dots are the assistant.

**Chip internal layout — ONE pill, breadcrumb of segments left→right:**

```
no dock:           [PanelGlyph] Jira  ›  [TabGlyph] Sprint board
dock open (jira):   [PanelGlyph] Jira  ›  [TabGlyph] Sprint board  ›  ↳ [Ticket] PROJ-123
dock open (slack):  [SiSlack] Slack  ›  [TabGlyph] #general  ›  ↳ [Hash] #general  ›  [MessagesSquare] Thread
```

Segments are joined by a muted `ChevronRight` separator (the glyph already used by the timeline's
`ToolCallRow`). The `↳` glyph marks the **dock item only** (echoing the composer, where `↳` precedes
the in-view item); panel and tab are the new lead-in dimensions and carry no `↳`.

**Deliberate divergence from the composer (recorded, not an accident):** the composer `ContextChip`
splits dimensions into SEPARATE removable badges (each carries its own `×`). This timeline chip is
**read-only history** — nothing is removable — so the dimensions collapse into a **single cohesive
breadcrumb pill**. One quiet object reads calmer than a cluster of pills and competes less with the
prompt text, while reusing the EXACT Badge surface keeps it visually of-a-piece (SC-009). The reused
idiom is preserved: secondary pill, leading muted `↳` on the item, per-kind `PRIMARY_ICON`,
truncating labels with tooltips, `role="note"` + `aria-label="Prompt context: …"`.

## 2. Tokens used (all existing — NO new token)

| Element | Token / utility | DESIGN.md ref |
|---|---|---|
| Pill surface + label | `Badge variant="secondary"` → `bg-secondary #3a3a3c` / `text-secondary-foreground #dddddd` | §2, §7.1, §14 Badge |
| Glyphs, `↳`, chevron separators | `text-muted-foreground #888888` | §7.1 |
| Text size | Badge's `text-xs` (≡ `text-caption`, 12/16) | §8 |
| Glyph size | Badge's forced `[&>svg]:size-3` | §14 Badge |
| Row gap / segment gap / offset from bubble | `gap-1` / `mt-1` (4px grid) | §9 |
| Tooltip (full label) | `Tooltip`/`TooltipContent` (overlay, inverted chip, `--duration-fast`, Radix-gated) | §12, §13, §14 Tooltip |

**Contrast guard (deliberate):** "quiet" comes from the small single-line pill, the `secondary`
(not `primary`) fill, and muted **decoration** — NOT from dimming text below contrast. Every text
LABEL stays at `text-secondary-foreground` (`#ddd` on `#3a3a3c`, comfortably legible). Only the
non-text decoration (glyphs, `↳`, `ChevronRight`) uses `text-muted-foreground` (`#888`), exactly as
the composer chip does. No label is rendered at muted-foreground.

**D-6 compliance:** no raw arbitrary type/space/radius/shadow/motion/z values. The only percentage,
`max-w-[85%]`, mirrors the sibling `UserBubble`'s existing constraint (a layout proportion, not a
scale token) so the chip never exceeds the bubble's width; recorded here as the intentional match.

## 3. Components used

- **`Badge`** (`components/ui/badge.tsx`), `variant="secondary"` — the pill. No variant/size change.
- **`Tooltip` / `TooltipTrigger asChild` / `TooltipContent side="top"`** — full-label tooltip on any
  truncated segment (same pattern as the composer chip).
- **Glyphs (no new component):**
  - **Panel glyph** = `SURFACE_ICON[panel.id]` from `app/surfaceIcons.tsx` (D-10 — the ONE source of
    truth for a rail surface's mark: `SiJira`/`SiSlack`/`SiConfluence`/`SiGooglecalendar`/cosmos).
    `currentColor` SVGs that take only `className`, so they inherit `text-muted-foreground` and the
    badge's `size-3` (D-10 already proved this renders well at footer `size-3` muted).
  - **Dock-item glyph** = the composer's `PRIMARY_ICON` mapping (lucide `Ticket`/`Hash`/`FileText`/
    `Calendar`), keyed by dock `kind` — the literal SC-009 reuse for the in-view item.
  - **Thread sub-glyph** (slack dock with `threadTs`) = lucide `MessagesSquare` (the composer's
    secondary-badge glyph) + label `Thread`.
  - **Tab glyph** = lucide **`AppWindow`** (a tab/view mark). NEW icon choice (see §6) — not a token,
    just a lucide import the developer adds.
- **`PromptContextChip.tsx`** is a cosmos-specific COMPOSITION of the above (like `ContextChip`), NOT
  a new `components/ui/` primitive. Developer builds it; it is not a design-system addition.

**Two glyph families, on purpose:** the panel segment uses the **brand mark** (`SURFACE_ICON`) to say
*which app* (matches the rail/footer, D-10); the dock segment uses the **lucide kind icon**
(`PRIMARY_ICON`) to say *what kind of item* (matches the composer, SC-009). They operate at different
levels, so the mixed families clarify rather than clash.

## 4. States

The chip is presentational over a `PromptContext` (or the live `promptContext`). It owns no loading/
error/disabled state of its own (its data is captured synchronously at submit and parsed at read).
The states are the dimension permutations + the absent case.

| State | Condition | Render |
|---|---|---|
| **Absent / malformed** | `context` is `undefined` (no marker, or marker dropped by the parser per FR-020) | **Render nothing** — component returns `null`. The bubble is exactly as today (FR-021). No placeholder, no empty pill. |
| **Panel only** | `panel` present, no `tab`, no `dock` | `[PanelGlyph] <label>` — one segment, no chevron, no `↳`. |
| **Panel + tab** | `panel` + `tab`, no `dock` | `[PanelGlyph] <panel> › [TabGlyph] <tab>`. |
| **Panel + dock (no tab)** | `panel` + `dock`, no `tab` | `[PanelGlyph] <panel> › ↳ [DockGlyph] <item>` (chevron still separates panel and dock). |
| **Panel + tab + dock** | all three | `[PanelGlyph] <panel> › [TabGlyph] <tab> › ↳ [DockGlyph] <item>`. |
| **Slack dock + thread** | dock `kind` slack with `threadTs` | append a trailing `› [MessagesSquare] Thread` sub-segment after the channel. |
| **Long label** | tab label or dock label overflows | that segment's label is `min-w-0 truncate`; full text in a `Tooltip` (panel label is short, stays `shrink-0`). The whole pill caps at `max-w-[85%]`. |
| **Live vs historical parity** | `live-generating` vs confirmed `user-prompt` | identical chip — the live path passes the captured `PromptContext` object directly; the historical path passes the parsed one. Same component, same look, no flicker on confirm (FR-024). |

**Dock label per kind** (reuses the real `ViewContext` fields, plan §A — no fabricated labels):
jira → the issue **key** (`PROJ-123`, no title); slack → `#<channel name>` (or channel id); confluence
→ page **title**; calendar → event **title**. Derive via the existing `contextChipFor(panel.id, dock)`
so the dock segment is byte-identical to the composer's primary badge content.

## 5. Interaction & accessibility

- **Read-only — NO interactive controls.** No `×`/remove (unlike the composer), no buttons. The chip
  is a historical/live record.
- **Roles:** the pill is `role="note"` with a single comprehensive
  `aria-label="Prompt context: <Panel> panel, <Tab> tab, <DockNoun> <item>"` (omit the clauses for
  absent dimensions), mirroring the composer's `role="note"` + `Prompt context: …` label. All glyphs,
  the `↳`, and chevrons are `aria-hidden="true"` (decorative).
- **Keyboard / focus order:** the only focusable elements are the `TooltipTrigger` spans on truncated
  labels (Radix makes them focus/hover reachable to reveal the full label) — same as the composer. No
  other focus targets; the chip does not interrupt the timeline's reading order before/after the
  bubble.
- **Contrast:** labels at `text-secondary-foreground` on `bg-secondary` (legible); decoration at
  `text-muted-foreground` (decorative, lower-contrast acceptable). See §2 contrast guard.
- **Motion:** the chip is **static — reduced-motion N/A.** The only animation is the reused `Tooltip`
  overlay enter/exit, which is already Radix-gated at `--duration-fast` (§12) — nothing new.
- **No raw marker ever shown:** the chip renders only the parsed, structured `PromptContext`; the raw
  `<cosmos:context>` text is stripped upstream (FR-025) and never reaches this surface.

## 6. New token / component the developer must add

- **NO new design token.** Reuses `secondary`, `muted-foreground`, `secondary-foreground`,
  `text-caption`/`text-xs`, the 4px grid, `Badge`, `Tooltip`, `SURFACE_ICON`, `PRIMARY_ICON`,
  `ChevronRight`, `MessagesSquare` — all already in the system.
- **NO new `components/ui/` primitive.** `PromptContextChip.tsx` is a cosmos composition (developer-
  owned), like `ContextChip.tsx`.
- **One new lucide icon import:** `AppWindow` for the **tab** glyph. Not a token — just an import the
  developer adds in `PromptContextChip.tsx`. (Soft recommendation: if `AppWindow` reads oddly at
  `size-3`, `PanelTop` is the fallback; this is the only open glyph choice and is non-blocking.)
- The composer's `PRIMARY_ICON` / `PRIMARY_NOUN` maps live in `app/ContextChip.tsx` (not exported).
  To avoid duplicating them, the developer SHOULD lift them into a shared module (e.g. alongside
  `viewContextCapture`) and import from both chips — a small refactor, not a design-system change.
  (Functional consistency; flagged for the developer.)

## 7. DESIGN.md update

Adds registry rule **D-11** (read-only historical context affordances reuse the composer
`ContextChip` badge idiom). Applied in this same design step.

## Open questions

None blocking. The single soft choice (tab glyph `AppWindow` vs `PanelTop`) is recorded in §6 and is
the developer's to finalize at build; it does not affect the contract, tokens, or states.
