# Design: Generative UI Foundation — v1

**Status**: Draft
**Created**: 2026-06-06
**Spec**: .sdd/specs/generative-ui-foundation-v1.md
**Plan**: .sdd/plans/generative-ui-foundation-v1.md
**Design system**: Tailwind v4 + shadcn/ui (new-york), dark-first cosmos palette (`src/renderer/index.css`)

---

## 0. Design intent

This feature adds the **prompt composer + run-status affordance** to the existing
Generated-UI panel (`src/renderer/GeneratedUiPanel.tsx`). The composer is the user's
single way to ask Claude to compose a surface; the rest of the panel body still belongs to
the rendered A2UI surface that arrives over the existing `ui:render` path. The design goal
is that the composer reads as **native cosmos chrome** — the same `border-border` / `bg-card`
/ `bg-popover` panel idiom already established in this panel and in the Slack/Jira designs —
not as a bolted-on chat widget. Everything is expressed in existing theme tokens and shadcn
components. The only system growth is **one standard shadcn primitive (`textarea`)** the
composer genuinely needs (flagged in §3 for the developer to install).

It honors the v1 constraints from the spec/plan:
- **Single-run / blocked-while-running** — while a run is in flight the input and submit are
  **disabled**; there is no queue and **no cancel affordance** in v1 (FR-003, plan §Resolved-1).
- The renderer never starts a run for an **empty/whitespace** utterance (FR-004) — submit is
  inert until there is non-whitespace text.
- A failed run shows a **persistent, human-readable error** near the composer (not a toast)
  and the input returns to a **usable idle** state (FR-011, FR-014).

---

## 1. Surfaces & layout

There is **one** surface: the Generated-UI panel, extended with a **bottom-docked composer
bar**. No new rail entry, no new route — this is purely additive inside the existing
`<section aria-label="Generated UI">`.

### 1.1 Placement decision — bottom-docked composer (chat-input idiom)

**Decision: dock the composer at the bottom of the panel, below the surface area.** The
header stays at top; the rendered surface (or empty/error text) fills the scrollable body in
the middle; the composer is a fixed footer that never scrolls away.

**Why bottom, not top-under-header:**
- The mental model is **"the surface is the result of what I typed"** — input below, output
  above matches the chat/REPL convention users already hold, and keeps the latest composed
  surface adjacent to the prompt that produced it.
- The surface area is the panel's primary content and should own the largest, top-anchored
  region; a top input would push the surface down and compete with the header chrome for the
  top edge.
- A bottom dock is the natural home for the **run-status row** (the "Generating…" indicator
  and the error message) — status sits with the control that produced it.
- It sets up the later conversational-refine loop (out of scope here) without a re-layout:
  the composer is already the bottom anchor a transcript would grow above.

### 1.2 ASCII layout sketch (the whole panel)

```
┌─────────────────────────────────────────────┐
│ Generated UI                      [Dismiss]  │  ← header  (existing; bg-popover, border-b)
├─────────────────────────────────────────────┤
│                                             ▲│
│   <rendered A2UI surface>                   ││  ← body  (existing; flex-1, overflow-auto,
│   — or —                                    ││         bg-card, p-3). Scrolls. Owns
│   "Describe a UI above and Claude will      ││         empty-state + surface render-error.
│    build it here." (empty state)            ││
│   — or —                                    ││
│   [ surface render-error alert ]            ▼│
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │  ← COMPOSER (new; footer, border-t,
│ │ Describe the UI you want…               │ │     bg-popover, p-3, shrink-0)
│ │                                         │ │     Textarea (auto-grow, 1–6 rows)
│ └─────────────────────────────────────────┘ │
│  ⟳ Generating…                  [  Send  ]  │  ← status row (left) + submit (right)
│  ⚠ <error message>                          │     (status/error left-aligned, muted/dest.)
└─────────────────────────────────────────────┘
```

The composer is **always present** (idle and while a surface is shown) — it is the panel's
persistent control surface, not gated behind `active` the way `Dismiss` is.

### 1.3 Structure (developer-facing)

Inside the existing `<section>` (currently: header `div`, then the `flex-1` body `div`):

- **Header** — unchanged. `Dismiss` Button stays header-right, still only shown when a
  surface is `active`.
- **Body** — unchanged container (`min-h-0 flex-1 overflow-auto p-3 text-card-foreground`),
  still holds the empty-state text, the surface-render-error alert, and the
  `A2UIProvider`/`SurfaceBridge`. One copy change to the empty-state text (§4.1).
- **Composer (new)** — a `shrink-0` footer `div` after the body, OUTSIDE the scroll area, so
  it is always visible:
  - container: `border-t border-border bg-popover px-3 py-3`
  - a **Textarea** (the prompt input) — full width
  - a **status row** below the textarea: a flex row, `mt-2`, with the run-status indicator
    on the left and the submit **Button** on the right (`justify-between`)
  - the **error message** (when present) renders in this composer region, above or in place
    of the running indicator (§4.4) — never as a transient toast.

The composer is a controlled form. Recommended wrapper is a `<form onSubmit>` so Enter and
the Send button share one submit path; `aria-label="Compose generated UI"`.

---

## 2. Theme tokens used

All existing — **no token is added or changed by this feature.** (Verified against the
current `.dark` block in `src/renderer/index.css`.)

| Token | Used for |
|-------|----------|
| `--card` / `bg-card` | panel body background (existing) |
| `--card-foreground` | body text (existing) |
| `--popover` / `bg-popover` | header background **and the new composer footer** background (matches header chrome) |
| `--border` / `border-border` | panel borders; the composer's `border-t` |
| `--input` / `border-input` | Textarea border (inherited from the `input`/`textarea` primitive) |
| `--muted-foreground` / `text-muted-foreground` | placeholder, header label, the "Generating…" status label, the Enter hint |
| `--primary` / `text-primary` | the spinner / running accent (subtle; status is text-led, see §4.3) |
| `--ring` / `ring-ring` | focus ring on the Textarea and Send button (inherited) |
| `--destructive` / `text-destructive`, `border-destructive`, `bg-destructive/15` | the error message styling (§4.4) |

**Dark-palette contrast notes (the values that matter on `#1e1e1e`-family backgrounds):**
- `--destructive` in dark is `#f3b0b0` (a light salmon **foreground** color, not a saturated
  red fill). So error text uses `text-destructive` (light salmon) **on** the dark
  `bg-destructive/15` tint — light-on-dark, comfortably legible. Do **not** use
  `bg-destructive` as a solid fill here (it would be a salmon block); the established panel
  pattern is the tinted alert (`bg-destructive/15` + `border-destructive/40` +
  `text-destructive`) already used for the surface-render error in this same file — reuse it
  so both error treatments match.
- `--muted-foreground` dark is `#888888` on `bg-popover` `#252526` — adequate for the
  secondary status label and placeholder (passes as non-essential/secondary text); the
  primary prompt text in the Textarea uses default `--foreground` `#e0e0e0` (high contrast).
- The running spinner accent uses `--primary` `#4a9eff` against `#252526` — strong contrast;
  but per §4.3 the running state is **announced via text too**, never color alone.

---

## 3. Components used

| Component | Variant / size | Role | Status |
|-----------|----------------|------|--------|
| `Textarea` (`@/components/ui/textarea`) | default | the prompt input (multi-line, auto-grow) | **ADD — install required (see below)** |
| `Button` (`@/components/ui/button`) | `variant="default" size="sm"` | the **Send** submit button | exists |
| `Alert` + `AlertDescription` (`@/components/ui/alert`) | `variant="destructive"` | OPTIONAL alternative for the error message (§4.4) | exists |
| lucide `Loader2` | `size-3.5`, `animate-spin` | running spinner in the status row | lucide already the icon library (`components.json`) |
| lucide `SendHorizontal` *(optional)* | `size-4` | icon inside Send button (icon-leading) | optional polish |

### 3.1 System addition the developer must install — `textarea`

`src/renderer/components/ui/` has **`input.tsx` but no `textarea.tsx`**. The prompt is a
multi-line natural-language utterance, so it needs a **Textarea**, not the single-line
`Input`. This is a standard shadcn primitive — **add it via the shadcn CLI, do not hand-roll
CSS**:

```
npx shadcn@latest add textarea
```

> **Developer action (the designer has no Bash):** run the install above so
> `@/components/ui/textarea` exists before wiring the composer. It will land styled from our
> `--input` / `--ring` / `--muted-foreground` tokens automatically (same token wiring as the
> existing `Input`), so it matches the design with no extra CSS. If the CLI is unavailable,
> create `src/renderer/components/ui/textarea.tsx` from the canonical shadcn new-york
> `Textarea` source (a `<textarea>` with the standard
> `border-input bg-transparent dark:bg-input/30 placeholder:text-muted-foreground focus-visible:ring-ring/50 …`
> classes) — but the CLI is the preferred path so it stays a managed primitive.

**Textarea presentation tweaks applied at the call site (not in the primitive):**
- `min-h-[2.5rem]` (≈ one comfortable line) and a cap of ~6 rows; allow it to grow and then
  scroll. (If the primitive ships `field-sizing-content`, that yields auto-grow for free;
  otherwise a `max-h-[9rem] overflow-y-auto` cap is acceptable.)
- `resize-none` — height is driven by content/cap, not a manual drag handle, to keep the
  footer chrome stable.
- placeholder: **"Describe the UI you want…"**

No Input usage here — `Input` stays single-line for other surfaces.

---

## 4. States (all five, fully specified)

The composer has two independent inputs into its visual state: **`running`** (a run is in
flight) and **`error`** (the last run failed, message present). The Textarea `value` drives
the empty-vs-ready distinction. Mapping to spec states:

### 4.1 idle / empty  (FR-003 idle)

- **Textarea:** enabled, empty, placeholder **"Describe the UI you want…"** in
  `text-muted-foreground`. Focusable; this is the default focus target when the panel mounts
  (§5).
- **Send button:** `variant="default" size="sm"`, **disabled** (because value is empty —
  see 4.5). Disabled rendering is the shadcn default `disabled:opacity-50` +
  `disabled:pointer-events-none`.
- **Status row:** no spinner, no label. A subtle one-line hint may sit left of the button:
  **"Enter to send · Shift+Enter for newline"** in `text-[11px] text-muted-foreground` (this
  hint is shown in idle/typing, hidden while `running`).
- **Body empty-state copy change:** the current text **"Claude has not rendered any UI yet."**
  reads oddly now that there is a visible composer. **Change it to:**
  **"Describe a UI below and Claude will build it here."** (the composer is at the bottom, so
  "below"). Keep the existing classes
  (`text-[13px] text-muted-foreground`). This empty-state text shows only while no surface is
  `active`; once a surface renders, the surface replaces it (existing behavior, unchanged).

### 4.2 typing / ready-to-submit  (FR-003 idle, non-empty)

- **Textarea:** enabled, contains non-whitespace text in `--foreground` `#e0e0e0`.
- **Send button:** **enabled** (default primary — `bg-primary text-primary-foreground`,
  `hover:bg-primary/90`). This is the only affordance that visibly changes between 4.1 and
  4.2.
- **Keyboard:** **Enter submits**; **Shift+Enter inserts a newline.** (Implement by handling
  `keydown`: `Enter` without `shiftKey` → `preventDefault()` + submit; with `shiftKey` →
  default newline.) The §4.1 hint communicates this.
- **Status row:** unchanged from idle (no spinner). If a prior `error` is present it stays
  visible until the next submit clears it (§4.4).

### 4.3 submitting / in-progress  (FR-003 in-progress; single-run)

Entered when the user submits (optimistically) and confirmed by the `started` status.

- **Textarea:** **disabled** (`disabled:opacity-50 disabled:cursor-not-allowed`,
  `disabled:pointer-events-none` — all inherited from the primitive). The user cannot edit or
  start a second run (single-run / blocked-while-running). Value handling: the plan clears the
  field on submit; the disabled empty Textarea with placeholder is fine for the running
  window.
- **Send button:** **disabled** for the duration. To make "working" unmistakable, swap its
  content while running to a **spinner + label**: `<Loader2 className="size-3.5 animate-spin" /> Generating…`
  (Button keeps `size="sm"`; the `[&_svg]` rules size the icon). Equivalent acceptable
  alternative: keep the button label as "Send" (disabled) and show the spinner+label in the
  status row instead — pick one, do not show the spinner twice.
- **Status row (left):** the running indicator — `Loader2` `animate-spin` in `text-primary`
  + the label **"Generating…"** in `text-muted-foreground`, `text-xs`. The Enter hint is
  hidden while running.
- **a11y:** the status row is an `aria-live="polite"` region (§5) so "Generating…" and then
  its disappearance are announced to screen readers; the running indicator is **not** color-
  only (the "Generating…" word carries it). The spinner icon is `aria-hidden` (decorative);
  the textual label is the announced content.

### 4.4 error  (FR-011 / FR-014)

Entered on a `error` status; `running` returns to false and the input is usable again.

- **Error message:** rendered **in the composer region, above the textarea or in the status
  row area — persistent, not a toast.** Two acceptable treatments, both token-correct:
  - **(preferred, matches this file's existing pattern)** a tinted inline alert identical to
    the surface-render error already in `GeneratedUiPanel.tsx`:
    `className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"`,
    `role="alert"`, e.g. **"Couldn't generate that UI: \<message\>."** Reusing the exact
    class string keeps the two error treatments visually identical.
  - **(library alternative)** `<Alert variant="destructive"><AlertDescription>…</AlertDescription></Alert>`
    — same destructive token, slightly heavier. Use only if you also want a title; otherwise
    prefer the inline tinted treatment for a lighter footer.
- The message is **human-readable** (the plan derives it from the run's stderr / parsed
  output — e.g. "claude command not found", "not logged in", "run exited with code 1"). The
  designer does not author the copy, but the surface must accommodate ~2 lines; let it wrap
  (no truncation) so the reason is fully readable.
- **Textarea + Send:** return to **idle/typing** behavior (enabled; Send enabled iff non-empty
  — note: if the field was cleared on submit, Send is disabled until the user types again,
  which is correct — they can edit and retry).
- **Dismissal:** the error persists until the **next submit** (clear it when a new run is
  submitted / on the next `started`). No separate close button is required for v1, but an
  optional small `×` (`Button variant="ghost" size="icon-xs"`) to dismiss is acceptable.
- **Contrast:** light-salmon `text-destructive` `#f3b0b0` on the `bg-destructive/15` tint over
  `bg-popover` — legible light-on-dark; reinforced by the alert role + (optional) a lucide
  `AlertCircle`/`TriangleAlert` `size-4` glyph in `text-destructive` so it isn't color-only.

### 4.5 empty / whitespace submit attempt  (FR-004)

- **No error, no flash, no spam.** The submit affordance is simply **inert**: the Send button
  is `disabled` whenever `value.trim()` is empty, and the Enter-to-submit handler **also
  guards** on `value.trim()` (so pressing Enter in a whitespace-only field does nothing — it
  just won't submit; a lone Enter with no Shift is consumed without inserting a newline only
  when there's submittable text, otherwise let the newline through or no-op — implement as:
  `if (!value.trim()) return;` before sending).
- Visually identical to **idle/empty (4.1)** — a disabled Send and the placeholder. There is
  no "you must type something" error state; prevention-by-disable is the whole treatment.

### State → visual summary

| State | Textarea | Send button | Status row | Error block |
|-------|----------|-------------|------------|-------------|
| idle/empty | enabled, placeholder | **disabled** | Enter hint (muted) | hidden |
| typing/ready | enabled, text | **enabled** (primary) | Enter hint (muted) | hidden (unless carried-over) |
| submitting | **disabled** | **disabled** + spinner/"Generating…" | ⟳ "Generating…" (live) | hidden |
| error | enabled | enabled iff non-empty | (none) | **shown** (destructive, persistent) |
| empty/whitespace submit | enabled | **disabled** (inert) | Enter hint | hidden |

---

## 5. Interaction & accessibility

- **Focus order (tab):** Textarea → Send button → (Dismiss, when present, lives in the header
  earlier in DOM order). On panel mount/selection, **autofocus the Textarea** so the user can
  type immediately. While `running`, the disabled Textarea and Send are skipped by tab, which
  is the intended "nothing to do but wait" affordance (no cancel in v1).
- **Keyboard:**
  - **Enter** (no Shift) in the Textarea → submit (guarded on non-empty trim; §4.5).
  - **Shift+Enter** → newline (default textarea behavior).
  - **Send button** → submit on click/Enter/Space (native button).
- **Labels / ARIA:**
  - Textarea: `aria-label="Describe the UI you want"` (placeholder is not a substitute for an
    accessible name). Wrap in a `<form aria-label="Compose generated UI">`.
  - The status row is `role="status"` / `aria-live="polite"` so "Generating…" and its
    clearing are announced without stealing focus.
  - The error block is `role="alert"` (assertive) so the failure is announced when it appears
    (matches the existing surface-render error's `role="alert"`).
  - The running spinner icon is `aria-hidden="true"`; the **text** "Generating…" carries the
    state to SR (never color/icon alone — §4.3).
  - Send button: while running, if its content becomes the spinner, set
    `aria-label="Generating"` (or keep accessible text "Generating…") so its name isn't empty.
- **Disabled-while-running** is enforced on BOTH the Textarea and the Send button from the
  same `running` flag (single source), and the Enter handler early-returns when `running`, so
  the keyboard path can't bypass the disabled button.
- **Contrast:** see §2 dark-palette notes — prompt text and Send label are high-contrast
  (`--foreground` / `--primary-foreground`); status/placeholder are intentionally secondary
  (`--muted-foreground`); error is light-salmon-on-dark-tint, reinforced by role + glyph.
- **Reduced motion:** the `Loader2 animate-spin` is the only motion; it is small and
  non-essential (text carries the meaning), acceptable, but respect a global
  `motion-reduce:animate-none` if the project adds one later (no action required now).

---

## 6. Coexistence with the existing rendered surface

- The **rendered A2UI surface** continues to arrive via the existing `ui:render` →
  `SurfaceBridge` path and fills the **body** (the scrollable middle region) **above** the
  composer. No change to that flow (plan confirms).
- The composer is **independent of `active`**: it shows in idle (no surface) and while a
  surface is rendered. Only the header's `Dismiss` button remains gated on `active`.
- **Empty-state text** (§4.1) shows only while no surface is `active`; the composer's presence
  motivates the copy change to **"Describe a UI below and Claude will build it here."** Once a
  surface renders, it replaces the empty text in the body; the composer stays put at the
  bottom.
- **Two error channels, one visual language:** the existing **surface-render error** (a bad
  A2UI spec) stays in the **body** as today; the new **run error** (the headless run failed)
  shows in the **composer**. Both use the identical destructive-tint treatment (§4.4) so they
  read as one product. They are distinct in placement (body vs footer) and wording
  ("Could not render this surface…" vs "Couldn't generate that UI…").

---

## 7. Open questions

- [ ] **Clear-on-submit vs keep-text:** the plan clears the Textarea on submit. Cleared-then-
  disabled-with-placeholder is the assumption here. If product later prefers keeping the
  utterance visible while it runs (so the user sees what they asked for), the running-state
  Textarea would show disabled non-empty text instead — a trivial visual variant, but flag it
  so the developer picks one deliberately. (Recommended for v1: **clear on submit**, matching
  the plan.)
- [ ] **Send button affordance label vs icon:** spec'd as a text "Send" button that swaps to
  "Generating…" while running. An icon-only send (`SendHorizontal`, `Button size="icon-sm"`)
  is a tighter footer but needs an `aria-label`; left as optional polish. Default to the text
  button for clarity in v1.
