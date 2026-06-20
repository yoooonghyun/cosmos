# Design: Jira ticket dock — auto-apply status + ticket web link — v1

**Status**: Draft
**Created**: 2026-06-21
**Spec**: .sdd/specs/jira-dock-autoapply-weblink-v1.md
**Plan**: .sdd/plans/jira-dock-autoapply-weblink-v1.md
**Owner**: designer (Phase 0 of the SDD cycle — produced BEFORE interface/implementation)

---

## Grounding (queries actually run this pass)

**codegraph_explore**
- `TransitionPicker TicketCard jiraCatalog components.tsx Select Apply Button Badge useFormBinding isTransitionSubmittable` → verbatim source of the dock's `TransitionPicker` (today: `Select` + a trailing default-variant `Apply` `<Button>` gated by `isTransitionSubmittable`; "No transitions available." empty state at the top) and `TicketCard` (header row = a `Badge variant="secondary" font-mono text-[10px]` showing `key ?? '—'`, right-aligned `StatusBadge`). Confirmed `TransitionPicker` has NO success callback — it only dispatches; settle/idle comes from main re-pushing a fresh detail frame that remounts the component.
- `PageDetailTitle ExternalLink isOpenableWebUrl confluenceCatalog components.tsx anchor external link` → the exact link idiom to mirror: a single `<a href target="_blank" rel="noreferrer">` wrapping `<span>{text}</span>` + a trailing `<ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />`, with `group inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card`, gated by a pure `isOpenableWebUrl` (`http(s)`-only `URL` parse) that returns plain `<>{text}</>` when absent.
- `LoadMoreButton catalogShared controls.tsx Loader2 animate-spin disabled busy` → the established cosmos BUSY idiom: `<Button disabled={isLoading} aria-busy={isLoading}>` with `<Loader2 className="size-3.5 animate-spin" /> Loading…` while in flight. This is the spinner treatment to reuse verbatim (`lucide-react` `Loader2`, `size-3.5`, `animate-spin`).
- (Notice/error) Grep in `jiraCatalog/components.tsx` → the failure notice is the existing `Notice` component (`Alert variant="destructive"` + `TriangleAlert`, or `Lock` for `write_not_authorized`), **re-pushed by main** above the detail surface. `TransitionPicker` does NOT render its own error — so the failure-state design here is "the picker remounts idle; the error is the existing `Notice`."

**index.css (tokens)** — read `--brand-accent`/`--primary`/`--ring` block (lines 88–95, 168–183, 227–254, 303–304). Confirmed: the old `#4a9eff` blue is **retired**; `--primary`, `--ring`, and `--brand-accent` are all brand purple `#d8b4fe` (dark + light). `--ring` is the focus-ring token; `--brand-accent` is the active/selected affordance token ("Consumable as bg-/text-/ring-/before:bg-brand-accent"). The Select trigger already focuses with `focus-visible:ring-ring` (= purple) — no token work needed. `text-muted-foreground` = `#888888` (dark).

**memory_recall / memory_smart_search** (`Jira dock #86 brand-accent token`, `design system blue retirement purple link tokens`) → **empty** (no stored observations returned). Design decisions below are grounded in the live `index.css` tokens + the Confluence/`LoadMoreButton` idioms above. New standards from this pass persisted with `memory_save`.

---

## Verdict on new primitives / tokens

**NONE required.** Both surfaces are fully expressible in the existing system:

- **Components:** existing shadcn `Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem`, existing `Badge`, plain `<a>` (the external-link idiom is a styled anchor, not a primitive), and `lucide-react`'s `ExternalLink` + `Loader2` (both already imported across the renderer). No new `components/ui/` primitive. The `Apply` `<Button>` is **removed**, not replaced.
- **Tokens:** `--ring` (focus), `--muted-foreground` (icon + busy text + plain-key text), `--accent`/`--accent-foreground` (Select hover/open, already baked into the primitive), `--secondary` (Badge), `--destructive` (failure `Notice`, already in `Notice`). No new theme variable, no new hex. The link reuses `ring-ring` / `ring-offset-card` exactly as `PageDetailTitle` does; `--brand-accent` is already === `--ring` value, so the existing `ring-ring` focus treatment IS the brand-accent affordance.

Developer adds **zero** shadcn-CLI installs and **zero** `index.css` edits for this feature. If implementation discovers a primitive gap, stop and flag — do not hand-roll.

---

## Surface 1 — Status picker, apply-on-select (`TransitionPicker`)

**Where:** the ticket-detail dock body, rendered under the "Move to" label.
**File:** `src/renderer/jiraCatalog/components.tsx`, `TransitionPicker` — currently lines ~391–449 (the `Select` + trailing `Apply` `<Button>` block at ~421–447). The `Apply` `<Button>` and its `apply()`-on-click are removed; dispatch moves into the `Select`'s `onValueChange`.

### Layout change

Today the picker is a two-child flex row: `<Select className="flex-1">` + `<Button>Apply</Button>`. **Remove the `Button`.** The `Select` now occupies the full row width on its own.

- Keep the wrapper `<div className="flex flex-col gap-2">` and the `<span className="text-xs font-medium text-muted-foreground">Move to</span>` label.
- The inner row becomes a single full-width trigger. Drop `flex-1` (no sibling to flex against) and let the trigger fill: change the trigger to `className="w-full"`. Keep `aria-label="Select a transition"`.
- A trailing inline busy affordance appears to the RIGHT of the trigger only while applying (see In-flight). So keep the inner `<div className="flex items-center gap-2">` so the spinner can sit beside the trigger; when idle the trigger is the only child and fills the row.

### States

| State | Trigger | Affordance | Tokens / classes |
|-------|---------|-----------|------------------|
| **Idle** | `Select` enabled, shows `SelectValue placeholder="Select a transition"` (placeholder text already renders in `text-muted-foreground` via `data-[placeholder]`). No value is pre-selected — the placeholder is the resting label (the displayed STATUS lives in the header `StatusBadge`, not here). | none | trigger default; `border-input`, focus `ring-ring` |
| **Open / selecting** | `SelectContent` open; each `SelectItem` is a transition name; hover/active item uses the primitive's `focus:bg-accent focus:text-accent-foreground`; selected item shows the `CheckIcon`. | Radix-driven, no change | `--accent` / `--accent-foreground` |
| **In-flight / busy** | `Select` is **`disabled`** (`disabled:cursor-not-allowed disabled:opacity-50`, already in the trigger). Set `aria-busy={true}` on the trigger (or its wrapping row) so AT announces busy — **not color alone** (FR / SC-002, AC "not by color"). | A `<Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />` appears to the RIGHT of the (dimmed) trigger, inside the `flex items-center gap-2` row. Optionally pair with a `<span className="text-xs text-muted-foreground">Applying…</span>` to its left for a non-icon-only signal. | reuse the `LoadMoreButton` busy idiom exactly: `Loader2 size-3.5 animate-spin`, text `text-muted-foreground` |
| **Success** | The component **does not mutate its own value optimistically.** Main re-reads the issue and re-pushes a fresh detail frame; this `TransitionPicker` instance **remounts** in the Idle state, and the header `StatusBadge` now shows the server-confirmed status. There is NO flicker of the target status before confirmation — the only thing that changes mid-flight is the busy treatment, never the displayed status. | busy affordance gone (fresh mount) | — |
| **Failure** | The re-push carries the SAME (unchanged) status + an error `Notice` (the existing `Notice` component, `Alert variant="destructive"` + `TriangleAlert`, or `Lock` for `write_not_authorized`) rendered above the detail by main. This `TransitionPicker` remounts **Idle and re-selectable** — no stuck spinner, no false target value. | the existing `Notice`, unchanged | `--destructive` (in `Notice`) |
| **Empty (no transitions)** | **Unchanged.** Keep the early return `<p className="text-sm text-muted-foreground">No transitions available.</p>` exactly as-is. No spinner, no Select. | — | `text-muted-foreground` |

### Interaction logic (drives the states above — developer wires in `logic.ts` + the component)

- **Apply-on-select:** dispatch `JiraBoundAction.Transition` from `Select`'s `onValueChange(next)` — NOT from a button. There is **no Apply button anywhere** (SC-001).
- **No-op / placeholder guard:** dispatch only when `next` is a real, non-empty transition id AND differs from the last dispatched id. Selecting the placeholder or re-selecting the in-flight value dispatches nothing (FR-006). Reuse/extend `isTransitionSubmittable`.
- **In-flight lock (no double-dispatch):** on a valid selection, set a local `applying` flag → it (a) disables the `Select`, (b) shows the busy affordance, and (c) makes a second `onValueChange` a no-op until settle. Because there is no success callback, the lock is released by the **surface re-push remounting** the component (a fresh frame = fresh `applying=false`). The local flag only needs to guard within this instance's lifetime (FR-003 / SC-002).
- **No optimistic status:** never set the header status locally; the displayed status changes only on the server re-read (FR-004). The picker's own `value` may track the in-flight selection (so the dimmed trigger shows what is being applied) but this is the PICKER value, not the ticket STATUS — the `StatusBadge` is untouched until re-push.

### Accessibility (Surface 1)

- The `Select` keeps `aria-label="Select a transition"`. While applying, set `aria-busy="true"` on the trigger so the busy state is conveyed to AT, not by spinner color alone (Scenario "Keyboard and assistive-tech access").
- `Loader2` is decorative → `aria-hidden="true"`; the optional "Applying…" text or `aria-busy` carries the meaning.
- Keyboard: the disabled trigger is correctly skipped/announced-disabled by Radix; focus returns naturally when the component remounts idle. No custom focus management needed.
- Contrast: `Loader2` and busy text use `text-muted-foreground` (`#888888` on the `#1b1b1c` card) — same as every other muted affordance in the dock; the `disabled:opacity-50` trigger remains legible.

---

## Surface 2 — Ticket key as external link (`TicketCard` header, dock only)

**Where:** the dock-header `TicketCard`'s left `Badge` (the ticket key).
**File:** `src/renderer/jiraCatalog/components.tsx`, `TicketCard` — the header `<Badge variant="secondary" className="shrink-0 font-mono text-[10px]">{key ?? '—'}</Badge>` at ~226–228. Mirror `PageDetailTitle` from `confluenceCatalog/components.tsx`.

### Treatment

Read `webUrl` off the bound issue value (`boundIssue?.webUrl`) and a pure `isOpenableJiraWebUrl(webUrl)` guard (mirror Confluence's `isOpenableWebUrl`: `http(s)`-only `URL` parse, in `logic.ts`).

**The whole key is the link** (key text + trailing icon are one anchor — matches `PageDetailTitle` and the spec's "single anchor, whole key clickable" decision). Wrap the `Badge` content (not the `Badge` element) in the anchor so the monospace pill styling is preserved and the link is the interactive child:

- **Link present (openable `webUrl`):** render the existing `Badge variant="secondary"` pill, but its child is the anchor:
  ```
  <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
    <a
      href={webUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${key} in Jira`}
      title={`${key} — open in Jira`}
      className="group inline-flex items-center gap-1 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
    >
      <span>{key}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  </Badge>
  ```
  - Icon size `size-3` (slightly smaller than Confluence's `size-3.5`) to suit the `text-[10px]` badge scale; `gap-1` (tighter than the title's `gap-1.5`) for the same reason.
  - Focus ring + offset reuse `ring-ring` (= brand purple `--ring`/`--brand-accent`, `#d8b4fe`) and `ring-offset-card` — IDENTICAL to `PageDetailTitle`, so the link's selected/focus affordance reads as the brand-accent treatment with no new token.
  - Hover = `hover:underline` (the Confluence idiom), keeping the badge's secondary fill; the icon stays `text-muted-foreground` so the affordance is calm, not loud.

- **Link absent (no `webUrl`, or non-`http(s)`):** render the **plain badge exactly as today** — `<Badge variant="secondary" className="shrink-0 font-mono text-[10px]">{key ?? '—'}</Badge>`. No anchor, no icon, no extra tab stop (FR-012 / SC-005). This is the omit-when-absent default (mirrors `PageDetailTitle`'s `return <>{title}</>`).

### Scope guard (dock only, not list/board)

`TicketCard` is shared by the list cards and the dock header. The link must appear **only in the dock header path**. Gate it on `webUrl` presence + openability: the list/board surface builder does NOT bind `webUrl` onto its cards, so `boundIssue?.webUrl` is `undefined` there and the plain-badge branch renders automatically. Developer must NOT add `webUrl` to the list-card data path (FR-020 — list/board unaffected). Belt-and-suspenders: the openable-URL guard is the single switch, so an accidental `webUrl` on a list card would still need to be a valid `http(s)` URL to link — acceptable, but the binding-side omission is the real scope boundary.

### Accessibility (Surface 2)

- Anchor `aria-label="Open <KEY> in Jira"` gives the accessible name; the `ExternalLink` icon is decorative (`aria-hidden="true"`) so meaning is not carried by the icon alone (FR-015).
- Focusable with a visible `focus-visible:ring-2 ring-ring ring-offset-1 ring-offset-card` ring (brand-purple, consistent with the whole app's focus treatment). Keyboard Enter activates the anchor; `target="_blank"` + the app's `setWindowOpenHandler` → `shell.openExternal` routes to the system browser (no in-app webview, no app-window nav).
- `rel="noreferrer"` (matches Confluence) — no referrer leak.
- Contrast: the `Badge variant="secondary"` fill + `font-mono text-[10px]` key text is unchanged from today's legible treatment; the icon at `text-muted-foreground` clears contrast as a decorative glyph beside legible text.

---

## Consistency notes (why this stays one product)

- The busy treatment is **the same `Loader2 size-3.5 animate-spin` + `aria-busy`** the shared `LoadMoreButton` uses — no new spinner.
- The external link is **the same anchor recipe** as the Confluence `PageDetailTitle` (same `target`/`rel`/`ExternalLink`/focus-ring/offset), only scaled to the badge. A Jira ticket key and a Confluence page title now open out the same way.
- All focus rings are `ring-ring` (brand purple) — the link's "active affordance" is the brand-accent value with zero divergence from the rest of the dock.
- No optimistic UI anywhere: the dock's confirmed-server-read model (already true for refresh) now also governs status — uniform with how the rest of the Jira surface treats state.

---

## Handoff — precise edits for the developer

All edits in `src/renderer/jiraCatalog/components.tsx` + `src/renderer/jiraCatalog/logic.ts` (no `components/ui/` or `index.css` changes):

1. **`TransitionPicker`** (~391–449):
   - Delete the trailing `<Button … >Apply</Button>` (~437–445) and the `apply()`-on-click wiring; remove the now-unused `Button` import if nothing else uses it in the file (verify — `Button` may be used elsewhere).
   - Move dispatch into `Select`'s `onValueChange`; add a local `applying` state.
   - Trigger: `className="w-full"` (drop `flex-1`), add `disabled={applying}` and `aria-busy={applying}`.
   - Inside the `flex items-center gap-2` row, render `{applying && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}` (optionally with a `<span className="text-xs text-muted-foreground">Applying…</span>`) to the right of the trigger.
   - Keep the `transitions.length === 0` early return verbatim.

2. **`TicketCard`** (~226–228, header `Badge`):
   - Read `boundIssue?.webUrl`; when `isOpenableJiraWebUrl(webUrl)` render the anchor-inside-badge shown above; otherwise keep the plain `Badge` text.
   - Import `ExternalLink` from `lucide-react` (already importing several icons from it).

3. **`logic.ts`**: add `isOpenableJiraWebUrl(webUrl: string | undefined): webUrl is string` mirroring Confluence's `isOpenableWebUrl`; extend/confirm the `isTransitionSubmittable` no-op guard so a re-selection of the in-flight/current id is a no-op.

4. **No theme/primitive work.** Confirmed: zero new tokens, zero new `components/ui/` primitives, zero shadcn-CLI runs.

---

## Open questions

None. The spec's lone open question ("no confirmation step for auto-apply") was resolved by the user in favor of immediate apply (plan Deviations, 2026-06-21); this design implements immediate-apply with no Apply button, no confirmation, no optimistic status. Recovery is re-selecting the prior status after the failure `Notice`.
