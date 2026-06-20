# Design: Open Prompt View Context — v1 (the context chip)

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/open-prompt-view-context-v1.md
**Plan**: .sdd/plans/open-prompt-view-context-v1.md
**Owns**: the composer context-chip surface (resolves spec OQ-2 = IN, per user decision)

---

## Grounding

> Queries I ran directly for this design (not handed in). One-line takeaways.

**codegraph_explore / codegraph_search**

- `JiraPanel detailIssueKey detail dock header SlackPanel openThread thread dock ConfluencePanel page title how selected item is displayed` — confirmed the panel "selected item" idioms the chip must echo: Slack's drill-in header shows `#${view.channel.name}` as a `truncate text-sm font-medium text-foreground` row with a `ChevronLeft` back affordance (SlackPanel.tsx:1242-1258); the thread is a separate right-dock keyed by `openThread` (`channelId`+`threadTs`). Jira's selection is `detail.detailIssueKey` (JiraPanel.tsx:238/353), Slack's is `view.channel` + `openThread`, Confluence's is `view`/`genUiPage` (`pageId`+`title`), Calendar's is `genUiEvent.id`.
- `useGenerativePanelTabs submit agent.submit` — `submit(utterance)` (useGenerativePanelTabs.ts:433) is the sole caller of `window.cosmos.agent.submit({ utterance, target })` (line 458). The hook (not `PromptComposer`) owns the panel's view state, so it is the natural place to BUILD the chip's display data and the `viewContext` together.

**Reads (on-disk truth)**

- `src/renderer/PromptComposer.tsx` — the shared collapsible composer. Expanded card = `form` `w-full max-w-2xl rounded-lg border border-input bg-popover p-2 shadow-md`; inside it a `Textarea` (borderless, transparent) then a footer row `mt-2 flex items-center justify-between gap-2` with the `HINT_COPY` hint (`text-[11px] text-muted-foreground`) on the left and the `Button variant="cosmos" size="sm"` Send on the right. Props today = `{ onSubmit, placeholder, ariaLabel, collapsedAriaLabel?, busy? }` — the composer is panel-agnostic and currently receives NO per-panel display data.
- `src/renderer/components/ui/badge.tsx` — **`Badge` already exists** (variants `default`/`secondary`/`destructive`/`outline`/`ghost`/`link`; `rounded-full`, `px-2 py-0.5 text-xs font-medium`, `gap-1`, `[&>svg]:size-3`, `asChild` slot). No new component needed.
- `src/renderer/components/ui/button.tsx` — has `size="icon-xs"` (`size-6 rounded-md`, `svg size-3`) — the right size for an inline remove control inside a chip row.
- `src/renderer/components/ui/tooltip.tsx` — `Tooltip`/`TooltipTrigger`/`TooltipContent`, already imported by the composer (used for the collapsed logo). Reused for the truncation tooltip.
- `src/renderer/index.css` — full token set; `--muted`/`--muted-foreground`/`--secondary`/`--border`/`--accent` all available. No color gap; **no new token required.**

**memory**

- `memory_recall` / `memory_smart_search` "PromptComposer / badge chip / detail dock idiom" → no prior results (clean slate). The standing design-system preference (Tailwind + shadcn, token-only, no raw hex) from MEMORY.md `feedback_design_system.md` is honored. I will `memory_save` the chip pattern after this spec.

---

## 1. Overview & intent

The composer gains a **context chip**: a single quiet row, inside the expanded card,
that names the in-view item the run will be grounded against ("↳ PROJ-123", "↳ #general",
"↳ Release notes", "↳ Sprint planning"). It is the visible face of the otherwise-invisible
`viewContext` plumbing — so the user can SEE what "this ticket / this channel / this page /
this event" will resolve to BEFORE they press Enter.

Design stance: the chip is **quiet, informational, and live**. It is NOT a control the
user composes; it passively reflects the active panel's current selection, captured at the
same send-time the `viewContext` is (Edge Cases: "captured at SEND time"). Visually it must
read as metadata attached to the prompt, never as a second action competing with Send.

The chip changes ONLY the renderer surface. It does not alter the contract, the grounding,
or the tool grants — it is a window onto the `viewContext` the plan already threads.

## 2. Surface & placement

**Where:** inside the EXPANDED composer card only (`PromptComposer.tsx`'s `<form>`), as a
new row **directly below the `Textarea` and ABOVE the hint/Send footer row**. Order top→bottom:

```
┌─ composer card (bg-popover, border-input, rounded-lg) ─────────────┐
│  [ Textarea — what the user types ]                                │
│                                                                    │
│  ↳ PROJ-123  (context chip row)            ← NEW                   │
│  ──────────────────────────────────────────────────────────────   │
│  Enter to send · Shift+Enter for newline           [  Send  ]      │
└────────────────────────────────────────────────────────────────────┘
```

Rationale for this slot (not above the textarea, not in the footer):

- **Above the footer, below the textarea** keeps it in the user's eyeline as they finish
  typing and reach for Enter — it sits in the "pre-send" zone the user already scans.
- It does NOT share the footer row with the hint + Send, so the chip never visually
  competes with the primary action and the footer's `justify-between` balance is preserved.
- The collapsed logo state shows NO chip (the composer is a 48px logo; context is shown
  only once the user opens to compose). Consistent with "context is what you see before
  pressing Enter."

**Layout of the chip row** (only rendered when context is present — §4 state B):

```
<div className="mt-2 flex min-w-0 items-center gap-1.5">
  <Badge variant="secondary" …>  ↳ <icon> <label> [× remove]  </Badge>
  (+ optional second Badge for the Slack thread dimension — §3.4)
</div>
```

`min-w-0` + the chip's own `truncate` (§4 state D) let a long label clip instead of
widening the card past `max-w-2xl`.

## 3. Chip content per target

The chip's label mirrors the panel's OWN selected-item idiom so the two read as the same
product. Each chip = leading deixis glyph **↳** (the architect's glyph; `U+21B3`, rendered
as a literal char inside the badge, `aria-hidden` since the badge has an accessible label)
\+ a per-target lucide icon already used by that panel + the label.

| Target | Icon (lucide, `size-3`) | Label | Source field (from `viewContext`) |
|--------|--------------------------|-------|-----------------------------------|
| **Jira** | `Ticket` (or panel's existing issue glyph) | issue key, e.g. `PROJ-123`. Summary is OPTIONAL and SECONDARY — if present, append ` · <summary>` and let it truncate; the key never truncates. | `selectedIssueKey` (+ optional summary if the panel already holds it) |
| **Slack — channel** | `Hash` | `#general` (channel name; falls back to id if name absent, matching SlackPanel's `name ?? id`) | `selectedChannelName` ?? `selectedChannelId` |
| **Slack — thread** | `MessagesSquare` | `Thread` (a SECOND chip beside the channel chip — §3.4) | presence of `threadTs` |
| **Confluence** | `FileText` | page title, e.g. `Release notes` | `selectedPageTitle` (fall back to "Page" if title absent but `selectedPageId` present) |
| **Calendar** | `Calendar` | event title, e.g. `Sprint planning` | event title (the panel holds `EventChipData`; pass its title alongside `selectedEventId`) |
| **Generated-UI** | — | **NO chip** (state A) | n/a |

Notes for the developer on label data:

- The contract (`ViewContext`, plan §Design notes) carries IDs + a few labels
  (`selectedChannelName`, `selectedPageTitle`). The chip needs a HUMAN label; where the
  plan's `viewContext` already carries the label (Slack name, Confluence title) the chip
  reuses it. For **Jira** the key IS the label (no extra field). For **Calendar** the plan's
  `viewContext` is id-only (`selectedEventId`); to label the chip with the event title the
  panel must pass the title to the composer as **display-only chip data** (NOT necessarily
  added to `viewContext` — see §6, "chip data vs. viewContext"). The title is non-secret
  (already on screen).
- The deixis glyph **↳** is decorative reinforcement; the meaning is carried by the icon +
  label, so it is fine under reduced-motion / high-contrast and is `aria-hidden`.

## 4. States

The chip has exactly these states. Everything else (collapsed logo, busy/running, draft
preserved) is unchanged from the shipped composer — the chip is purely additive.

### State A — No context / generic panel → NO chip
- Generated-UI panel always; any panel with no current selection (Jira list view, Slack
  channels list, Confluence search, no Calendar event). **The chip row is not rendered at
  all** — the composer looks byte-for-byte as today (textarea → hint/Send footer).
- This is the spec's no-regression guarantee made visible: no empty chip, no placeholder.

### State B — Context present → chip shown (default)
- Single `Badge variant="secondary"` with `↳` + icon + label, in the new row.
- Treatment (§5): muted/secondary fill, small text, rounded-full, quiet — clearly
  metadata, not a button.

### State C — Multiple dimensions (Slack channel + open thread)
- Two badges in the same row, channel first then thread: `[↳ #general] [⌐ Thread]`.
- The thread badge uses the SAME `secondary` treatment, `gap-1.5` between them.
- If only a channel (no thread open) → one badge (state B). Thread can never appear without
  a channel (the panel's `openThread` always carries a `channelId`).
- The channel badge truncates first under width pressure; the short `Thread` badge does not
  truncate (`shrink-0`).

### State D — Context too long → truncate + tooltip
- The label inside the badge is `truncate` with the badge constrained by the row's `min-w-0`
  and a `max-w-[60%]` (or `max-w-[18rem]`) cap so a long Confluence title / Jira summary
  clips with an ellipsis rather than pushing the card wide.
- Wrap the badge in `Tooltip`/`TooltipTrigger asChild` + `TooltipContent side="top"` showing
  the FULL untruncated label (e.g. full page title). Tooltip is keyboard- and hover-reachable
  (Radix). Already-imported primitive; no new dependency.
- The leading `↳` + icon and (for Jira) the issue key never truncate — only the trailing
  free-text (summary/title) clips.

### State E — Running / busy
- While `busy` the whole composer is hidden (existing behavior) so the chip is hidden with
  it — no special handling. On the re-open-mid-run case (composer expanded, `running` true),
  the chip still renders read-only (it reflects current selection); the remove control (if
  shown — §5) is `disabled` while `running` to match the disabled Send.

### State F — Disabled remove (only if dismissible adopted — §5)
- See §5: the remove `×` is `disabled` (50% opacity, `pointer-events-none`) while `running`,
  mirroring the Send button's disabled treatment, so the chip cannot be torn off mid-run.

## 5. Dismissible? — recommendation

**Recommendation: YES, dismissible, with a quiet inline `×` remove affordance — but the
removal is per-compose and non-sticky.**

Reasoning:
- The user explicitly wanted to SEE what context rides along; the natural next expectation is
  to be able to DROP it for a one-off prompt where "this ticket" is irrelevant ("actually,
  search all my open bugs"). A read-only chip would force the user to navigate away from the
  selection just to send a context-free prompt.
- Keep it **lightweight and reversible**: removing the chip only suppresses `viewContext`
  for the NEXT submit from the composer; it does not change the panel's selection. Re-opening
  the composer (or the selection changing) restores the chip. No persistence (matches spec
  "No persistence").

**Remove affordance design:**
- A trailing `×` inside the badge: a `Button variant="ghost" size="icon-xs"` (or a bare
  `<button>` with the badge's `[a&]:hover` affordances) carrying a lucide `X` (`size-3`),
  `aria-label="Remove context"` + the chip label (e.g. `aria-label="Remove PROJ-123 from this prompt"`).
- It sits at the badge's right edge, `ml-0.5`, with a subtle hover (`hover:bg-accent
  rounded-full`). Focusable, Enter/Space activates (native button). `disabled` while `running`.
- After remove: the chip row collapses to NOT rendered (state A visually) for the rest of
  this compose; an undo is implicit (close/reopen composer, or change selection).

**Multiple dimensions + dismiss (Slack):** removing the channel chip removes BOTH dimensions
(thread cannot outlive its channel). Removing only the thread badge drops just `threadTs`,
leaving the channel chip. So the thread badge gets its own `×`; the channel badge's `×`
clears the whole `viewContext`.

If the developer/architect prefers to ship v1 SIMPLER, the fallback is a **read-only chip
(no `×`)** — still fully satisfies "show what context rides along." Dismiss can be a fast
follow. I recommend shipping dismissible since the remove control is cheap (existing Button +
lucide `X`) and the affordance is the user's most likely next ask. **Flag for the developer:
confirm with the architect whether the remove also needs to be reflected in `viewContext`
capture (it does — the composer must tell the hook to omit `viewContext` for that submit),
which is a small wiring addition beyond the plan's current `getViewContext` seam (see §6).**

## 6. Component & data wiring (for the developer — design contract)

`PromptComposer` is panel-agnostic today and receives no per-panel display data, so the chip
needs new INPUT. Two clean, additive options; **I recommend Option 1** (keeps the composer a
dumb renderer, keeps panel state in the hook/panel where it lives):

**Option 1 (recommended) — pass display-ready chip data into the composer.**
Add ONE optional prop to `PromptComposerProps`:

```ts
/** Display-only descriptor of the in-view item this prompt will be grounded against
 *  (open-prompt-view-context-v1). Undefined → no chip (state A). NON-SECRET labels only. */
contextChip?: ContextChipData

export interface ContextChipData {
  /** Lead dimension shown as the primary badge. */
  primary: { kind: 'jira' | 'slack-channel' | 'confluence' | 'calendar'; label: string; fullLabel?: string }
  /** Optional second dimension (Slack open thread). */
  secondary?: { kind: 'slack-thread'; label: string }
}
```

- The per-panel `submit`/panel builds `contextChip` from the SAME state it builds
  `viewContext` from (Jira `detailIssueKey`; Slack `view.channel` + `openThread`; Confluence
  `view`/`genUiPage` title; Calendar `genUiEvent` title) and threads it down via the panel →
  `PromptComposer` prop. (`useGenerativePanelTabs` already owns this state.)
- `fullLabel` feeds the truncation tooltip (state D); `label` is the truncatable display
  string.
- **Chip data vs. `viewContext`:** `contextChip` is RENDER data; `viewContext` is the
  CONTRACT payload. They derive from the same panel state but are not the same object — keep
  `viewContext` exactly as the plan specifies (IDs + the few labels it lists) and let
  `contextChip` carry whatever the chip needs to read well (e.g. the Calendar/Jira human
  title) without bloating the contract. Both are non-secret.
- **Dismiss wiring (if §5 adopted):** the composer holds a local `contextDismissed` boolean;
  when true it hides the chip AND must signal the submit path to omit `viewContext`. Cleanest:
  the composer calls `onSubmit(value, { includeContext: !contextDismissed })` — i.e. extend
  `onSubmit` to take an optional second arg the hook reads to decide whether to attach
  `viewContext` at send time. (Flag to developer/architect: this is the one place the chip
  touches the plan's capture seam.) If dismiss is dropped for v1, `onSubmit` stays unchanged.

**Option 2 (alternative) — composer stays untouched; render the chip in each panel just
above where it mounts `<PromptComposer>`.** Rejected as default: it would put the chip
OUTSIDE the composer card (breaking the "inside the card, above the footer" placement the
user asked for) and duplicate the chip markup across four panels (anti-uniformity). Use only
if the team wants zero new composer props.

**No new `components/ui/` primitive is required.** `Badge`, `Button` (`icon-xs`), `Tooltip`
all exist. The chip is a small COMPOSITION of these — house it as a local presentational
component `ContextChip` next to `PromptComposer` (e.g. `src/renderer/ContextChip.tsx`), NOT
in `components/ui/` (it is a cosmos-specific composite, not a generic primitive). It is a
renderer file (JSX) — its trivial pure label/truncation helpers, if any, go in a
`.ts`/`.test.ts` pair per the split.

## 7. Visual treatment & tokens

All from the EXISTING token set — **no new color token.**

| Element | Treatment | Tokens / classes |
|---------|-----------|------------------|
| Chip badge | `Badge variant="secondary"` — quiet muted fill, the design system's established "metadata pill". | `bg-secondary text-secondary-foreground` (dark: `#3a3a3c` / `#dddddd`), `rounded-full px-2 py-0.5 text-xs font-medium`, `gap-1` |
| Deixis glyph `↳` | inline char, slightly dimmed so the label leads. | `text-muted-foreground` |
| Icon | lucide, badge's built-in `[&>svg]:size-3`. | `text-muted-foreground` |
| Label | the issue key / channel / title. Truncates (state D). | `truncate` + row `min-w-0` + chip `max-w-[18rem]` |
| Second (thread) badge | same `secondary` badge, `shrink-0`. | as above |
| Remove `×` (if §5) | `Button variant="ghost" size="icon-xs"` + lucide `X`, subtle hover. | `hover:bg-accent rounded-full`, `disabled:opacity-50` while `running` |
| Row spacing | sits between textarea and footer. | `mt-2 flex min-w-0 items-center gap-1.5` |

Why `secondary` (not `outline`/`default`): `default` is `bg-primary` (the blue accent) —
too loud, would read as an action. `outline` is bordered/empty — reads as a clickable tag.
`secondary` is the muted filled pill the design system already uses for quiet metadata, which
is exactly the chip's role, and it echoes the muted, low-emphasis treatment of the panels'
own selected-item headers (Slack's `text-foreground` drill-in label sits on the same muted
chrome family). Contrast: `#dddddd` on `#3a3a3c` is well above 4.5:1 on the dark palette.

The chip must **never** out-emphasize the Send button (`variant="cosmos"`, the pink→purple
brand gradient). Secondary muted vs. brand gradient keeps the hierarchy correct: Send is the
action, the chip is context.

## 8. Interaction & accessibility

- **Reading order / focus order** inside the expanded card: Textarea → (chip remove `×`, if
  present) → Send. The chip badge itself is non-interactive (just the optional `×` is
  focusable), so it does not add focus stops beyond the remove control.
- **Keyboard:** Tab reaches the remove `×` (native button, Enter/Space activates). Esc still
  collapses the composer (unchanged — the chip does not intercept keys). Enter in the textarea
  still submits (the chip adds no key handlers).
- **ARIA:**
  - The chip badge has an accessible label so AT announces meaning, e.g. the badge wraps its
    content and the deixis `↳` + icon are `aria-hidden`; consider `role="note"` /
    `aria-label="Prompt context: Jira issue PROJ-123"` on the chip container so it reads as
    informational, not as a control.
  - Remove `×`: `aria-label="Remove PROJ-123 from this prompt"` (interpolate the label).
  - Truncated label: the Radix `Tooltip` exposes the full label to keyboard + AT; ALSO keep a
    plain `title`/`aria-label` with the full text as a fallback when the tooltip is not open.
- **Contrast:** secondary token pair clears AA on the dark palette (see §7). The dimmed `↳`
  and icon are decorative (`muted-foreground` ~`#888`), reinforced by the always-legible
  label, so their lower contrast is acceptable.
- **Live-region nuance:** the chip updating as selection changes is NOT announced (it is not
  a live region) — it reflects state the user themselves changed by navigating. Avoid
  `aria-live` here to prevent chatty announcements.
- **Reduced motion:** the chip has no animation; it appears/disappears with the composer's
  existing expand transition only. Nothing to gate.

## 9. Consistency notes

- The chip's `↳ + icon + label` echoes each panel's own selected-item header: Slack's
  `#${channel.name}` drill-in row, Confluence's page title, Jira's issue key in the detail
  dock. Same glyphs (`Hash`, `FileText`, `Ticket`, `Calendar`) the panels already use → one
  product.
- `Badge variant="secondary"` is the same quiet-metadata pill used elsewhere in the system,
  so the chip does not introduce a novel shape or color. (The Jira status chips use their own
  `--status-*` tokens for status meaning; the context chip is NOT a status, so it correctly
  uses plain `secondary`, not a status token.)
- Truncation + tooltip is the same pattern the panels use for long titles (`truncate` +
  hover/AT affordance), so behavior under long labels is uniform.

## 10. Hand-off summary (what the developer builds)

- **No package install, no shadcn CLI run, no new `components/ui/` file** — `Badge`, `Button`
  (`icon-xs`), `Tooltip`, lucide icons all already exist. (Confirmed: `badge.tsx` is present.)
- Add a small presentational `ContextChip` composite (e.g. `src/renderer/ContextChip.tsx`)
  built from those primitives, rendered inside `PromptComposer`'s expanded `<form>` between
  the `Textarea` and the hint/Send footer row.
- Add `contextChip?: ContextChipData` to `PromptComposerProps` (Option 1, §6); each panel
  derives it from the SAME state it derives `viewContext` from and passes it down.
- If dismissible (§5, recommended): add the composer-local `contextDismissed` state + remove
  `×`, and thread an "omit context for this submit" signal into the existing `getViewContext`
  capture seam (extend `onSubmit` with an optional flag — §6). **This is the one spot the chip
  touches the plan's capture path; flag to the architect for a one-line plan note.**
- States A–F per §4; tokens per §7; a11y per §8. No new color token.

## 11. Open questions (design)

- [ ] **DQ-1 (dismiss vs. read-only).** §5 recommends a dismissible chip with an inline `×`,
  which requires a small extension to the plan's capture seam (omit `viewContext` for the
  dismissed submit). If the architect prefers v1 stay strictly within the current plan seam,
  ship the **read-only chip** (no `×`) and track dismiss as a fast follow. Default I recommend:
  **dismissible.**
- [ ] **DQ-2 (Jira summary in the chip).** Showing ` · <summary>` after the key is nice-to-have
  and depends on the panel already holding the summary at send time. Default: **key only**;
  append the summary only if it is already in panel state (no new fetch — matches FR-004).
- [ ] **DQ-3 (Calendar/Jira title as chip-only data).** The chip wants a human title for
  Calendar (and optionally Jira summary) that the plan's `viewContext` does not carry. §6
  routes this as DISPLAY-ONLY `contextChip` data, separate from the contract, so `viewContext`
  stays as the plan specifies. Confirm the architect is happy keeping render-label data off the
  IPC `viewContext` (recommended — it is non-secret either way, but keeps the contract lean).
