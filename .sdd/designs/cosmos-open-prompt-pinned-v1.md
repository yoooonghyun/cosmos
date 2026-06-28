# Design: Cosmos Open-Prompt Pinned Composer — v1

**Status**: Draft
**Created**: 2026-06-28
**Spec**: .sdd/specs/cosmos-open-prompt-pinned-v1.md
**Plan**: .sdd/plans/cosmos-open-prompt-pinned-v1.md
**Owner**: designer
**Cycle position**: between Plan (Step 2) and Interface (Step 3). UI-bearing.

---

## Grounding

> Direct investigation by the designer (codegraph_explore + agentmemory + the on-disk source
> + spec/plan). Listed so the cycle can see this design is grounded against what exists.

**codegraph_explore queries run (verbatim source returned, treated as Read):**

- `PromptComposer promptComposerLogic CosmosPanel App.tsx composer mount` → returned `App.tsx`
  `SharedComposer` (the ONE hoisted instance, wrapped in `pointer-events-none absolute inset-0
  flex flex-col justify-end`, NO `key={surface}`), `PromptComposer.tsx` props + state machine
  (`expanded` default `false`, `submit()`→`setLaunching`+`collapse(true)`, the `fixed z-50` drag
  layer, the expanded glass card). Takeaway: today's composer is a floating draggable logo that
  expands into a CENTERED glass overlay card — never docked.

**Files read directly (Read tool):**

- `src/renderer/confluenceCatalog/CommentsSection.tsx` — the **in-repo docked-composer
  precedent** to extend: `<div className="shrink-0 border-t border-border p-3">` holding a
  `Textarea className="max-h-[12rem] min-h-[72px] resize-none"`, a right-aligned `Button
  variant="default" size="sm"`, and an inline error `<p role="alert">` above the textarea, all
  OUTSIDE a `<ScrollArea className="min-h-0 flex-1">`. This is the exact bottom-pinned idiom.
- `src/renderer/CosmosPanel.tsx` — the host `<section className="flex h-full min-w-0 flex-col
  border-l border-border bg-card">`: `PanelTabStrip` (top), then the timeline scroll region
  `<div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-card-foreground"
  role="tabpanel">` (loading / error / empty / populated all render here), then `PanelFooter`.
  The auto-scroll-to-newest effect (lines 166–170) sets `scrollRef.scrollTop = scrollHeight`.
  `usePublishComposer('cosmos', …)` publishes `onSubmit` / `placeholder` / `ariaLabel` /
  `busy: showSpinner`.
- `src/renderer/PromptComposer.tsx` (700–1122) — the expanded glass card internals to reuse:
  `Textarea` (`max-h-[9rem] min-h-[2.5rem] resize-none`), `HINT_COPY` = "Enter to send ·
  Shift+Enter for newline", the right-aligned `Button variant="cosmos" size="sm"` labeled "Send",
  `submitDecision` / `escDecision` / `shouldCollapseOnOutsideClick` gates, the expand-focus
  `useLayoutEffect` (line 724).
- `src/renderer/components/ui/button.tsx` — confirms the **`cosmos` Button variant** exists
  (`bg-gradient-to-br from-brand-pink to-brand-purple text-brand-foreground hover:brightness-95
  shadow-sm`) and `size="sm"` = `h-8`. Use as-is for Send. No new variant needed.
- `src/renderer/components/ui/textarea.tsx` — shadcn `Textarea` (border-input, bg-transparent,
  focus-visible ring). Use as-is; growth bounds come from `className`.
- `src/renderer/index.css` (374–448) — dark-token block: `--card #1b1b1c`, `--card-foreground
  #e0e0e0`, `--border #333333`, `--input #4a4a4c`, `--muted-foreground #888888`, `--ring
  #d8b4fe`, `--primary #e9aee9`, `--destructive #f3b0b0`, brand gradient `--brand-pink #f9a8d4`
  → `--brand-purple #d8b4fe` on `--brand-foreground #2e1065`. All needed tokens already exist.

**memory_recall / memory_smart_search:**

- `Design system Tailwind shadcn cosmos composer docked pinned` → the cross-session feedback note
  "Design system = Tailwind + shadcn (real component library, not token-only)" — honored here:
  this spec reuses existing tokens + shadcn `Textarea`/`Button`, adds NOTHING new.
- `Slack per-list independent scroll composer` → recalled the locked Slack per-list-scroll rule;
  irrelevant to Cosmos but confirms scroll-region discipline (each scroll region owns `min-h-0
  flex-1 overflow-auto`). Applied below.

**Verdict on new tokens/components: NONE required.** Every value below resolves to an existing
theme token and an existing shadcn primitive. See "New tokens / components" (empty).

---

## 1. Surfaces & layout

ONE surface changes: the **Cosmos panel** (`CosmosPanel.tsx`, rail `SurfaceId 'cosmos'`). The
floating composer on Slack / Jira / Confluence / Google Calendar is **untouched** (it keeps the
`SharedComposer` `pointer-events-none absolute inset-0 flex flex-col justify-end` overlay + the
draggable logo / glass card). The plan's `mode: 'docked' | 'floating'` discriminator selects
between the two; `'cosmos' ⇒ 'docked'`, everything else `'floating'`.

> **Refinement (post-review, applied — 2 passes):** the docked composer is NOT a full-bleed
> `border-t` band edge-to-edge, and NOT a full-width inset card either. It is an **inset, rounded
> card CONSTRAINED to the SAME width as the floating composer (`max-w-2xl`) and CENTERED**, pinned
> at the bottom with a slight bottom margin so it floats just off the bottom edge. This makes the
> docked Cosmos input read as the SAME-SIZED composer the other panels show — only its position
> (bottom-pinned, always-open) differs. The always-open docked BEHAVIOR is unchanged (never
> collapses, submit stays open, Esc/click-outside inert, not hidden on busy, auto-focus on
> activation); only the container treatment changed (full-width bar → centered `max-w-2xl` card).
> The sections below reflect this.

### 1.1 Cosmos panel column (docked mode)

The Cosmos `<section>` is already a `flex h-full min-w-0 flex-col bg-card border-l border-border`.
The docked composer becomes a **`shrink-0` in-flow last slot** of the surface column, directly
below that section and replacing the `PanelFooter` slot. That slot **centers** its contents
(`flex justify-center px-3 pt-3 pb-6`) and — because it is a SIBLING below the `bg-card` section —
carries the **SAME `bg-card border-l border-border`** so the panel surface reads as ONE continuous
color from the tab strip down to the bottom edge (otherwise the band would expose the app
`bg-background` and the panel's bottom area would look a different color than its top — the seam
the user reported). The composer body inside is an **inset, rounded card capped at `w-full
max-w-2xl`** (the SAME width as the floating card), `rounded-lg border bg-popover`, centered just
off the bottom edge with a comfortable `pb-6` bottom margin. Top-to-bottom:

```
┌──────────────────────────────────────────────┐  <section flex h-full flex-col bg-card border-l>
│ PanelTabStrip                          shrink-0│
├──────────────────────────────────────────────┤
│ Timeline scroll region                         │  <div ref={scrollRef}
│   min-h-0 flex-1 overflow-auto p-3             │       className="min-h-0 flex-1
│   (loading / error / empty / populated +       │        overflow-auto p-3 …">
│    live streaming turns — bottom-pinned        │   role="tabpanel"
│    auto-scroll)                                │
│                                          ▲ flex │
│┄┄┄┄┄┄┄┄ docked slot: SAME bg-card border-l ┄┄┄│  shrink-0 slot CENTERS + carries bg-card:
│        ┌──────────────────────────────┐         │  <div className="flex justify-center border-l
│        │ DOCKED COMPOSER CARD          │         │    border-border bg-card px-3 pt-3 pb-6">
│        │ ┌──────────────────────────┐ │         │   <form className="w-full max-w-2xl
│        │ │ Textarea (grows→scrolls) │ │         │     rounded-lg border border-border
│        │ └──────────────────────────┘ │         │     bg-popover p-2 shadow-sm">
│        │  Enter to send…       [Send] │         │   hint (left)        Button cosmos sm (right)
│        └──────────────────────────────┘         │   ↕ pb-6 bottom margin
└──────────────────────────────────────────────┘
```

Because the timeline region keeps `min-h-0 flex-1 overflow-auto` and the composer is `shrink-0`,
the timeline takes ALL remaining height and the composer is never pushed off-screen, never
overlaps the timeline, and stays docked at the bottom as the timeline grows or streams
(spec FR-002 / FR-003 / FR-009 / SC-003).

### 1.2 DOM mount approach (CONFIRMED — Approach note (a) of the plan)

**Keep the single `PromptComposer` instance mounted in `SharedComposer` (no `key={surface}`).**
`SharedComposer` branches its WRAPPER on `mode`:

- **`floating`** (Slack/Jira/Confluence/Calendar): today's wrapper unchanged —
  `<div className="pointer-events-none absolute inset-0 flex flex-col justify-end">`.
- **`docked`** (Cosmos): wrapper becomes an in-flow, `shrink-0`, CENTERING bottom slot —
  `<div className="flex shrink-0 justify-center border-l border-border bg-card px-3 pt-3 pb-6">` —
  rendered as the LAST flex child of the shared `surfaceRef` column so it sits below the active
  panel's content. Since `mode === 'docked'` only for Cosmos, this slot only appears under the Cosmos
  panel. The wrapper centers, supplies the side/bottom margin (`pb-6`), AND carries the SAME
  `bg-card border-l border-border` as the Cosmos `<section>` so there is NO color seam between the
  panel body and the docked band (the surface is one continuous color top-to-bottom). The **rounded
  card + width cap live on the composer BODY** (`w-full max-w-2xl rounded-lg border …`), so the card
  is the SAME width as the floating composer and sits centered just off the bottom edge (NOT a
  full-bleed `border-t` seam, NOT full-width).

This preserves the single-instance / shared-draft invariant (no duplicate composer state, no
flicker on panel switch) while letting Cosmos read as a docked chat input. `PromptComposer`
internally renders its **docked body** (a normal in-flow `<form>`, NOT the `fixed z-50` drag layer
and NOT the centered glass overlay card) when `mode === 'docked'`.

> Note for the developer (applied): the docked body is an INSET ROUNDED CARD capped at `max-w-2xl`
> (same width as the floating card), NOT a full-width band/card. Centering + margin live on the
> wrapper (`flex justify-center px-3 pb-3`); the body carries `w-full max-w-2xl rounded-lg border
> border-border bg-popover p-2 shadow-sm` so it matches the floating composer's size + shape while
> staying FLAT (no glass). Do NOT add a `border-t` band.

### 1.3 Why NOT host it inside CosmosPanel (Approach note (b))

Hosting a second composer inside `CosmosPanel.tsx` would duplicate composer/draft state and risk
the two diverging — rejected by the plan and by the cross-session "real design-system, single
source" preference. The timeline scroll region + footer slot in `CosmosPanel` stay as-is; the
docked composer is the `SharedComposer`'s docked wrapper sitting just below the panel content.
`PanelFooter` for Cosmos is superseded by the docked composer band (the composer IS the bottom
chrome now); keep `PanelFooter` rendering for the floating panels.

---

## 2. Docked composer body (the `mode === 'docked'` render)

A calm, chat-style input rendered as an INSET ROUNDED CARD that matches the floating composer's
size + shape (capped `max-w-2xl`, rounded + bordered, CENTERED), restyled with the cosmos brand
Send, but kept FLAT (no glass). Structure inside the centering `shrink-0` wrapper — the card is the
`<form>` itself:

```
<form className="w-full max-w-2xl rounded-lg border border-border bg-popover p-2 shadow-sm">
  <div className="flex flex-col gap-2">
    [ inline error <p role="alert"> ]   ← only in the error sub-state (§4.3)
    [ ContextChip ]                     ← only if config.contextChip is present (Cosmos: none today)
    <Textarea … />
    <div className="flex items-center justify-between gap-2">
      <span hint>Enter to send · Shift+Enter for newline</span>
      <Button variant="cosmos" size="sm">Send</Button>
    </div>
  </div>
</div>
```

### 2.1 Tokens & classes (all existing)

| Element | Treatment | Tokens / classes |
|---|---|---|
| Docked wrapper | in-flow CENTERING bottom slot, panel-surface continuous | `flex shrink-0 justify-center border-l border-border bg-card px-3 pt-3 pb-6` — centers the card, supplies the side/bottom margin (`pb-6`), and carries the SAME `bg-card border-l border-border` as the Cosmos `<section>` so there is NO color seam between the panel body and the docked band. `--card #1b1b1c`, `--border #333333`. |
| Docked card (body) | inset, centered, width-capped, rounded, bordered, flat | `w-full max-w-2xl rounded-lg border border-border bg-popover p-2 shadow-sm` — the SAME width cap (`max-w-2xl`) + rounded card shape as the floating composer, but FLAT (`bg-popover`, no glass). Centered by the wrapper, off the bottom edge. `--border #333333`, `--popover` fill. |
| Textarea | the input field | shadcn `Textarea` as-is. `--input` border, `--card-foreground #e0e0e0` text, `--muted-foreground #888888` placeholder, focus ring `--ring #d8b4fe`. Growth class in §3. |
| Hint copy | "Enter to send · Shift+Enter for newline" | `min-w-0 truncate text-[11px] text-muted-foreground` (identical to `HINT_COPY` in the floating card). `--muted-foreground`. |
| Send button | primary action, brand gradient | **`Button variant="cosmos" size="sm"`** — `bg-gradient-to-br from-brand-pink to-brand-purple text-brand-foreground` (the logo-matched brand). Label "Send". `aria-label="Send"`, `className="shrink-0"`. Same control the floating card uses, so the two composers stay one product. |
| Row layout | hint left, Send right | `flex items-center justify-between gap-2` (identical to floating card footer). |

Brand-token usage is **only** via the `cosmos` Button variant (which consumes `--brand-pink` /
`--brand-purple` / `--brand-foreground`). No raw hex, no inline brand color. The user's note that
"primary is #e9aee9, the logo-matched brand color" is honored: `--primary #e9aee9` is the SOLID
logo midpoint and drives the focus ring / draft accent family, while the **Send control uses the
full brand GRADIENT** (`cosmos` variant) exactly as the floating composer's Send does — keeping
the two Send buttons visually identical.

### 2.2 No glass material in docked mode

The floating card wears the `glass-dock` liquid-glass material (it floats over panel content). The
docked composer is a flat in-flow band on the opaque `--card` surface, so it does **NOT** use
`glass-dock` / `useGlassDockFilter` / the per-instance backdrop-filter. Flat is correct here: a
docked chat input should read as solid chrome, not a floating glass overlay. This also drops all
the drag/position/`panelRect`/glass machinery from the docked render path (simpler, no measurement
flash). The Textarea therefore does NOT need the floating card's `bg-popover/55` legibility
backing — it sits directly on `--card` with the standard shadcn Textarea fill.

---

## 3. Multi-line growth bounds + internal scroll (FR-010)

The docked Textarea grows with content up to a bounded max, then scrolls internally — it never
pushes the composer off the bottom edge or covers the panel.

| Property | Value | Rationale |
|---|---|---|
| Min height | `min-h-[2.5rem]` (~40px, one comfortable line) | Matches the floating card's `min-h-[2.5rem]`. A compact single-line resting height so the timeline gets maximum room. (Confluence uses `min-h-[72px]` for a multi-line comment box; the Cosmos command input is chat-style and starts single-line, so `2.5rem` is the deliberate choice.) |
| Max height | `max-h-[9rem]` (~144px, ~6–7 lines) | Matches the floating card's `max-h-[9rem]`. Past this the textarea scrolls internally. Keeps the composer from eating the timeline even with a long paste. |
| Resize | `resize-none` | No user drag-handle; growth is automatic via content. |
| Auto-grow | `field-sizing-content` (already on shadcn `Textarea`) | The textarea auto-sizes to content between min/max with no JS. |
| Overflow past max | internal scroll (native textarea) | Standard textarea scrollbar; the cosmos `scrollbar-hover-only` utility applies via the global style. |

Final Textarea class: `max-h-[9rem] min-h-[2.5rem] resize-none` (plus shadcn defaults). Keying the
bounds to the SAME values as the floating card keeps both composers' growth feel identical.

**Keyboard:** Enter submits, Shift+Enter inserts a newline (existing `handleKeyDown`). The hint
copy states this. Unchanged from the floating composer.

---

## 4. States — every state coexists WITH the always-present input

The docked input is **always rendered and always interactive** in every Cosmos panel state
(FR-001 / FR-003 / FR-008 / SC-005). The states below describe what the TIMELINE region above
shows; the composer band is constant beneath them (only the optional inline-error row in §4.3 is
part of the composer itself).

### 4.1 Loading

- **Timeline region:** existing `<p className="text-[13px] text-muted-foreground">Loading
  conversation…</p>` (unchanged).
- **Composer:** present, enabled, focusable. The user can type a first command before the
  transcript finishes loading.

### 4.2 Empty (fresh / no conversation)

- **Timeline region:** existing empty copy `<p className="text-[13px] text-muted-foreground">
  Describe a UI below and Claude will build it here — your conversation will appear in this
  timeline.</p>` (unchanged; "below" now literally points at the docked input).
- **Composer:** present and **auto-focused on Cosmos activation** (§5), inviting the first
  command. This is the primary affordance of the empty state.

### 4.3 Error (transcript read failed)

- **Timeline region:** existing `<p role="alert" className="rounded-md border border-destructive/40
  bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive">Could not read the conversation
  transcript. You can still describe a UI below.</p>` (unchanged — note it already says "below").
- **Composer:** present and fully usable, so the user can still drive the agent despite a transcript
  read error.
- **Composer-local submit error (optional, future-proofing):** if a submit path ever surfaces a
  recoverable error, show it as an inline `<p role="alert">` at the TOP of the composer body, above
  the Textarea, styled exactly like the Confluence precedent: `rounded-md border border-destructive/40
  bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive` (`--destructive #f3b0b0`). Today's
  Cosmos `onSubmit` is fire-and-forget (`agent.submit`) and does NOT return a per-submit error, so
  this row is normally absent; specify it so the layout is reserved and consistent if added.

### 4.4 Populated

- **Timeline region:** the reconciled timeline (`CosmosTimelineEntry` rows) scrolls; auto-scroll
  pins the newest turn to the bottom (existing effect, lines 166–170). The composer stays docked
  below — the growing/streaming timeline scrolls under it, never moving it (SC-003).

### 4.5 Busy / streaming (agent run in flight)

- The docked composer is **NEVER hidden by `busy`** (departs from §4.4's "busy hides BOTH states",
  which now applies to FLOATING only). `busy` (`config.busy` = `showSpinner`) drives ONLY the
  timeline's in-flight affordance (the "generating" entry / spinner already rendered above).
- **Composer:** stays visible, enabled, focused-ready. The user can fire follow-up commands
  mid-run (fire-and-forget, `composerLocked === false` already constant-false). The Send button is
  enabled whenever there is non-empty text (existing `canSubmit`); it is NOT disabled merely
  because a run streams.

### 4.6 After submit (stay-open)

- On accepted submit: clear the draft (`draftAfterSubmit()` → empty string), KEEP the composer
  open and the textarea focused, do NOT `setLaunching(true)` / `collapse()`. No grow-to-fill launch
  animation (that's a floating-only flourish). The textarea simply clears and stays ready (chat-style),
  matching the Confluence composer's clear-on-success.
- No "Sent" transient hint in docked mode (the timeline's new prompt bubble + generating affordance
  is the feedback). The floating "Sent" hint stays floating-only.

### 4.7 Disabled

- There is no whole-composer disabled state in docked mode (it is always usable per FR-003). The
  **Send button** is the only thing that disables: `disabled={!canSubmit}` (empty/whitespace text),
  rendered at `opacity-50` via shadcn's `disabled:opacity-50`. Empty/whitespace submit is rejected
  by the existing `submitDecision` (FR-006). A malformed non-string value is safely ignored (no
  crash, FR-006).

---

## 5. Focus / active affordance (OQ-2 resolved: auto-focus on activation, no focus-steal)

- **Auto-focus on Cosmos activation:** when the Cosmos panel becomes the active surface, move focus
  into the docked Textarea so the user can type immediately (chat-like). Drive this off the existing
  expand-focus `useLayoutEffect` (PromptComposer line 724), extended to fire in docked mode when an
  `active`/`autoFocus` signal for Cosmos is true. The signal is the Cosmos panel's `active` prop /
  the active surface being `'cosmos'` (`SharedComposer` already knows the active surface).
- **No focus-steal (the guard):** only auto-focus when **Cosmos is the active surface AND the
  active surface just became Cosmos**. Never pull focus while the Terminal PTY or another panel is
  active, and do not yank focus on every re-render — gate on the activation transition. (Developer:
  fire on the active-becomes-true edge, not on every render; respect an in-progress focus elsewhere.)
- **Focus ring:** the Textarea's standard shadcn focus ring — `focus-visible:border-ring
  focus-visible:ring-[1.5px] focus-visible:ring-ring/50` (`--ring #d8b4fe`, the brand purple).
  Visible and on-brand against the dark `--card`. No custom focus treatment.
- **Esc:** in docked mode Esc does NOT collapse/hide the composer (FR-007). `escDecision` is inert
  for docked. Esc MAY blur the textarea or be a no-op (developer's choice); it MUST NOT remove the
  input. Recommended: no-op (keep focus) so the chat input stays ready — but blur is acceptable.
- **Click-outside:** the `shouldCollapseOnOutsideClick` → `collapse` path is disabled in docked
  mode (FR-003 / FR-007). Clicking the timeline or elsewhere leaves the composer docked and visible.
- **No drag layer:** the `fixed z-50` draggable-logo layer, the scrim, the "Sent" hint, and all
  position/`panelRect`/glass machinery are NOT rendered in docked mode. The docked body is a single
  in-flow `<form>`.

---

## 6. Interaction & accessibility

- **Form semantics:** the docked composer is a `<form aria-label={ariaLabel}>` (Cosmos publishes
  `ariaLabel: 'Compose generated UI'`). The Textarea carries `aria-label={ariaLabel}` and
  `placeholder` ("Describe the UI you want…"), both from the published `ComposerConfig` — unchanged.
- **Keyboard path:** Tab order is Textarea → Send (the only two interactive elements; no drag
  logo). Enter submits, Shift+Enter newline. Send is reachable by keyboard and shows the focus ring.
- **Focus order on activation:** focus lands in the Textarea (§5). Within the panel, the tab strip
  is above, the timeline is a `role="tabpanel"`, then the composer form — natural top-to-bottom
  order.
- **Contrast (against `--card #1b1b1c`):** input text `--card-foreground #e0e0e0` (high contrast);
  placeholder/hint `--muted-foreground #888888` (sufficient for non-essential hint text); Send
  label `--brand-foreground #2e1065` on the bright pink→purple gradient (high contrast); error text
  `--destructive #f3b0b0` on `bg-destructive/15` (legible). Focus ring `--ring #d8b4fe` reads on the
  dark surface. All within the established dark palette — no new contrast risk.
- **`aria-live` for run state:** the in-flight / generating affordance lives in the timeline region
  (already announced there). The composer itself does not need an `aria-live` region for run status;
  it stays a static, always-available input.
- **Reduced motion:** the docked composer has no entrance/exit/launch animation (it's always
  present), so there is nothing to gate behind `prefers-reduced-motion`. (The floating launch
  animation stays floating-only and keeps its existing `motion-reduce` handling.)

---

## 7. What stays unchanged (floating, the other four panels)

- `SharedComposer`'s `floating` wrapper, the draggable logo, the centered glass card, the launch
  grow-to-fill animation, the "Sent" hint, Esc/outside-click collapse, and `busy`-hides-both — ALL
  unchanged for Slack / Jira / Confluence / Google Calendar (spec FR-011 / SC-006). The `mode`
  branch must leave the floating render path byte-for-byte current.
- The submit wiring (`config.onSubmit` → `agent.submit({ target: 'generated-ui' })`), the
  persistent session, `usePublishComposer('cosmos', …)`, and the IPC contract are untouched
  (FR-004). Renderer-only change.

---

## 8. New tokens / components the developer must add

**NONE.** This design is fully expressible in the existing system:

- **Tokens:** all from the existing dark block — `--card`, `--card-foreground`, `--border`,
  `--input`, `--muted-foreground`, `--ring`, `--destructive`, and the brand gradient
  (`--brand-pink` / `--brand-purple` / `--brand-foreground`) via the `cosmos` Button variant. No
  new CSS variable.
- **Components:** existing shadcn `Textarea` and `Button` (with the existing `cosmos` variant and
  `size="sm"`). No new `components/ui/` primitive, no new Button variant.
- **Idiom:** the docked layout reuses the proven `confluenceCatalog/CommentsSection.tsx`
  bottom-pinned pattern (`shrink-0 border-t border-border p-3` + bounded `resize-none` Textarea over
  a `min-h-0 flex-1 overflow-auto` scroll region). Reused, not reinvented — keeps the docked-input
  idiom uniform across Confluence comments and the Cosmos prompt.

Build wiring (no new installs / no shadcn-CLI runs needed) — there is nothing for the developer to
add to the design system; the developer implements the `mode` branch + wiring per the plan.

---

## 9. Open questions

None. OQ-1 (single-instance mechanism) and OQ-2 (auto-focus on activation, no focus-steal) are
resolved in the plan and reflected here. The DOM mount is confirmed as Approach (a): one shared
`PromptComposer`, `SharedComposer` branches the wrapper (`shrink-0 border-t border-border` in-flow
band for docked vs. the existing `absolute inset-0` overlay for floating), and `PromptComposer`
renders its flat in-flow docked body when `mode === 'docked'`.
