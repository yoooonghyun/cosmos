# Design: Jira JQL Search Box — v1

**Status**: Draft
**Created**: 2026-06-07
**Spec**: .sdd/specs/jira-jql-search-v1.md
**Plan**: .sdd/plans/jira-jql-search-v1.md
**Owner**: designer

---

## 0. Summary

Add a native, deterministic JQL search box to the **connected** Jira rail panel,
visually and structurally **mirroring the Confluence panel's native search box**
(`ConfluencePanel.tsx`, the `border-b border-border p-2` container with a shadcn `Input`
+ `Search` lucide icon). The box sits **between the `PanelTabStrip` and the per-tab A2UI
host** inside `JiraPanel.ConnectedBody`. The existing bottom-docked NL `PromptComposer`
("Ask about your Jira issues…") is **unchanged** and stays at the bottom.

This is a system-conformant feature: it adds **no new token and no new component** — it
reuses the existing `Input` primitive, the `Search` lucide icon, and existing theme
tokens exactly as Confluence already does. The only deviation from Confluence's box is
behavioral (submitting drives a `target:'jira'` A2UI re-compose into the active tab, not
a native list), which is invisible to the design system.

---

## 1. Surface & layout

### 1.1 Where it lives

`JiraPanel.ConnectedBody` returns a vertical flex column. Today it is:

```
<div className="flex h-full flex-col">
  <PanelTabStrip … />                 ← tab strip
  <div role="tabpanel" …>…A2UI host…</div>   ← the per-tab surface (flex-1)
  <PromptComposer … />                ← NL composer (bottom)
</div>
```

The search box is inserted as a **new shrink-0 row between `PanelTabStrip` and the
`role="tabpanel"` host**, giving:

```
<div className="flex h-full flex-col">
  <PanelTabStrip … />                 ← tab strip
  <JqlSearchBox … />                  ← NEW: native JQL search row (shrink-0)
  <div role="tabpanel" …>…A2UI host…</div>   ← per-tab surface (flex-1, unchanged)
  <PromptComposer … />                ← NL composer, unchanged (bottom)
</div>
```

This matches Confluence, where the search row is a `border-b border-border p-2`
container placed **above** the content region. In Jira the content region is the A2UI
`role="tabpanel"` host; the search row sits directly above it, below the tab strip.

> Note: in Confluence the search box only renders when `showNativeBase` is true (the
> zero-tab / uncomposed base). In **Jira** the base of every tab IS the default board
> view (the A2UI surface), and the search box **filters that surface**, so the Jira
> search box is **always visible while connected** — it is panel chrome, not a base-only
> affordance. It is shown for every connected state regardless of which tab is active or
> whether that tab is loading/populated/error.

### 1.2 The search row — exact structure (mirrors Confluence)

Container (identical to Confluence's search container):

```
<div className="border-b border-border p-2">
  <form onSubmit={…} className="relative">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input
      value={searchText}
      onChange={…}
      placeholder="assignee = currentUser() ORDER BY updated DESC"
      className="h-8 pl-8 text-sm"
      aria-label="Search Jira issues with JQL"
    />
  </form>
</div>
```

- The `Search` icon is `lucide-react`'s `Search` (already imported by Confluence; add the
  import to `JiraPanel.tsx`). Positioned absolutely inside the relative `<form>`, left
  `2.5`, vertically centered, `size-3.5`, `text-muted-foreground`,
  `pointer-events-none` (decorative; not a focus target).
- The `Input` is the existing shadcn primitive (`@/components/ui/input`), overridden to
  `h-8 pl-8 text-sm` — **byte-for-byte the same className Confluence uses** (`h-8`
  compact height, `pl-8` to clear the icon, `text-sm`). No new size/variant.
- The whole row is `shrink-0` by virtue of being a non-`flex-1` child of the column; no
  explicit class needed (Confluence relies on the same), but the `border-b border-border
  p-2` container already gives it a fixed natural height (~`h-8` input + `p-2` padding).

### 1.3 Placeholder

Placeholder text is the exact my-tickets JQL constant `JIRA_DEFAULT_VIEW_JQL`:

```
assignee = currentUser() ORDER BY updated DESC
```

This string is longer than the compact box at the rail's narrow width and **will
visually truncate** — that is accepted (FR-002). Overflow behavior is the browser/shadcn
`Input` default: a single-line text input clips the placeholder at the right edge (no
wrap, no ellipsis glyph — native single-line input clipping). This is exactly how the
Confluence box renders its even-longer placeholder today; **do not add `text-ellipsis`,
`truncate`, or a `title` tooltip** — match Confluence's untreated clip. The full string
becomes visible as the user types/scrolls within the field (native caret-follows-text).

> Use the shared constant, not a hard-coded literal. The plan defines
> `JIRA_DEFAULT_VIEW_JQL` (already the default-view JQL in main); the renderer
> imports/defines the same string for the placeholder so the placeholder and the
> empty-submit fallback can never drift.

---

## 2. Tokens used

All tokens are existing; **none added, none changed.**

| Token (CSS var) | Where it is consumed | Class |
|---|---|---|
| `--border` | search-row bottom divider; `Input` border | `border-b border-border`, `border-input` (inside `Input`) |
| `--input` | `Input` border + `dark:bg-input/30` fill | (inside the `Input` primitive) |
| `--muted-foreground` | `Search` icon color + placeholder text | `text-muted-foreground`; `placeholder:text-muted-foreground` (inside `Input`) |
| `--ring` | focus ring on the `Input` | `focus-visible:ring-ring/50 focus-visible:border-ring` (inside `Input`) |
| `--foreground` | typed query text | default input text color |
| `--popover` / `--card` | inherited panel chrome behind the row | (panel shell, unchanged) |
| `--destructive` | invalid-JQL `Notice` (rendered by the A2UI catalog, not the box) | (existing catalog/Notice styling) |
| `--radius` (→ `--radius-md`) | `Input` corner radius | `rounded-md` (inside `Input`) |

No `--status-*` chip tokens are touched by the box itself; they continue to color the
`IssueList` chips inside the A2UI surface exactly as today.

**Flag: tokens added/changed — none.**

---

## 3. Components used

| Component | Source | Variant / size / props | Added? |
|---|---|---|---|
| `Input` | `@/components/ui/input` | className override `h-8 pl-8 text-sm`; `aria-label`, `value`, `onChange`, `placeholder` | No (existing) |
| `Search` (icon) | `lucide-react` | `className="… size-3.5 … text-muted-foreground pointer-events-none"` | No (existing; new import in `JiraPanel.tsx`) |
| `<form>` (native) | — | `className="relative"`, `onSubmit` | n/a |
| `DefaultViewSkeleton` | `JiraPanel.tsx` (existing) | reused unchanged for the submitting state | No (existing) |
| `PromptComposer` | `JiraPanel.tsx` (existing) | unchanged, stays bottom-docked | No (existing) |
| `Notice` surface | `jiraCatalog` (existing, via `buildNoticeSurface`) | invalid/error JQL recoverable notice | No (existing) |
| `IssueList` surface | `jiraCatalog` (existing, via `buildDefaultViewSurface`) | populated + empty-results states | No (existing) |

**Flag: shadcn components added/changed — none.** There is intentionally **no submit
button** for the search box (Confluence's box has none either) — submission is Enter-key
only (§5). This keeps the two native search boxes identical.

---

## 4. The five states

The search box is a thin native control; most of its "states" are reflected in the
**A2UI surface it drives** (the active tab's content region), which reuses surfaces that
already exist. The box's own visual states are limited to the `Input`'s standard
idle/focus/typing. Mapping each spec state:

### 4.1 Idle (default)
- **Box:** empty `Input`, placeholder `assignee = currentUser() ORDER BY updated DESC`
  shown in `--muted-foreground`, `Search` icon at left. No focus ring.
- **Surface behind it:** the active tab's existing content — on first connect, the
  my-tickets default board (`IssueList` via `requestDefaultView`). The box does not
  change what is already rendered; it overlays as chrome above it.

### 4.2 Typing / focused
- **Box:** `Input` is focused → `focus-visible` ring (`ring-ring/50`, `border-ring`,
  `ring-[3px]`) per the primitive. Typed text in `--foreground`. Placeholder gone once a
  character is present. Long JQL scrolls within the single-line field (caret-follows).
- **Surface behind it:** unchanged from whatever the active tab currently shows; no read
  fires until submit (submit-driven only, like Confluence — no debounced live search,
  out of scope).

### 4.3 Submitting (read in flight)
- **Box:** stays interactive and retains the submitted text (it is NOT cleared on submit
  — the query remains editable for refinement, unlike the NL composer which clears). No
  spinner is added inside the box.
- **Surface behind it — this is where in-flight is shown:** the active tab is marked
  `loadingDefault: true` by `requestDefaultInActiveTab`, so the existing
  **`DefaultViewSkeleton`** renders in the `role="tabpanel"` host until the surface (or a
  Notice) lands. This is the SAME skeleton the per-tab default view already uses
  (FR-006) — no new loading treatment. When zero tabs / no active tab, one tab is
  auto-created already marked `loadingDefault` to hold the skeleton then the result.
- **a11y:** the skeleton container is `aria-busy="true"` (already on `DefaultViewSkeleton`).

### 4.4 Populated (results landed)
- **Surface behind it:** the `IssueList` A2UI surface fills the active tab
  (`buildDefaultViewSurface(result.data)` pushed as an unsolicited `target:'jira'`
  frame), replacing the skeleton. Identical rendering to the default board — same catalog
  components, same `--status-*` chips, same row layout. The box keeps its submitted text.

### 4.5 Empty results
- **Surface behind it:** the JQL ran but matched zero issues → the **catalog's
  `IssueList` "No issues found." empty state** renders in the active tab (no crash, no
  error styling). This is produced by `buildDefaultViewSurface` over an empty result —
  the existing empty-state path; nothing new to design. The box is unchanged and editable
  for a retry.

### 4.6 Error / invalid JQL (recoverable)
- **Trigger:** a non-`reconnect_needed` failure (invalid JQL → 400 → `network`, or
  `rate_limited`).
- **Surface behind it:** a single calm, recoverable **`Notice` surface** in the active
  tab via `buildNoticeSurface({ kind: 'error', message })` — the existing destructive-toned
  Notice the Jira catalog already renders (border `--destructive/40`, fill `--destructive/15`,
  `role="alert"` semantics carried by the catalog). **Never** a raw stack trace, never the
  panel-level "Could not render this surface" red bar (that is for A2UI render failures,
  not read failures). The box keeps its text and is immediately editable to correct and
  resubmit (Enter). No inline error is shown inside the search row itself — the error lives
  in the surface, keeping the box visually calm.

### 4.7 Not-connected / reconnect (box not shown)
- When `status.state !== 'connected'` the `ConnectedBody` (and therefore the entire search
  row) is **not rendered at all** — the panel shows the existing native Connect/Reconnect
  affordance (`ConnectForm` under the `SquareKanban` icon). If a token is rejected
  **mid-search** (`reconnect_needed` / `not_connected`), main pushes **no surface**;
  `JiraManager.statusChanged` flips the panel to the Connect/Reconnect affordance via the
  existing `onStatusChanged` path (FR-008). The search box is unmounted along with
  `ConnectedBody`. No new design — this is the established connection-gating behavior.

---

## 5. Interaction & accessibility

### 5.1 Keyboard / submit
- **Enter submits** the form (native `<form onSubmit>`). There is no submit button by
  design (matches Confluence) — Enter is the only submit path.
- **Empty / whitespace-only submit** is a valid action: it returns to the my-tickets
  default view (main trims and falls back to `JIRA_DEFAULT_VIEW_JQL`). So pressing Enter
  on an empty box is NOT a no-op (this differs from the NL composer, where empty is a
  no-op) — it is the documented "clear the filter" gesture (FR-005). The renderer sends
  the RAW text; main owns the trim + empty⇒default decision.
- **No `Shift+Enter`** semantics — single-line `Input`, not a `Textarea`. Newlines are not
  meaningful in the box.

### 5.2 Focus order
Top-to-bottom DOM order within the connected body, which is also tab order:
1. `PanelTabStrip` controls (tab buttons, close `X`, trailing `+`).
2. **The JQL search `Input`** (immediately after the tab strip, before the surface).
3. The A2UI surface content (any focusable controls inside `IssueList`, e.g. issue rows).
4. The NL `PromptComposer` `Textarea`, then its `Send` button (bottom).

This places the deterministic search directly after the tabs and ahead of both the
generated surface and the NL composer — a natural "filter, then read, then ask" order.
The search `Input` and the composer `Textarea` are two distinct, separately-labelled text
fields; their `aria-label`s disambiguate them for screen readers.

### 5.3 ARIA / labels
- The search `Input` carries `aria-label="Search Jira issues with JQL"` (it has no visible
  `<label>`; the placeholder is not a substitute for an accessible name). This parallels
  Confluence's `aria-label="Search Confluence content"` and the plan's
  "Search Jira issues" intent — the design specifies the slightly more precise
  **"Search Jira issues with JQL"** since the field accepts JQL, not free text.
- The `Search` icon is decorative (`pointer-events-none`, no label) — it is not announced.
- The in-flight skeleton is `aria-busy="true"` (existing). Result/empty/error surfaces
  carry their own catalog semantics (the Notice is `role="alert"` via the catalog).
- The `<form>` itself does not need a separate `aria-label` (the single labelled input
  inside it is sufficient), but adding `aria-label="JQL search"` on the form is acceptable
  and harmless; Confluence omits it, so for consistency **omit it** and rely on the
  input's label.

### 5.4 Contrast (dark palette)
- Placeholder `--muted-foreground` `#888888` on the input fill (`dark:bg-input/30`, i.e.
  `--input` `#4a4a4c` at 30% over `--card` `#1b1b1c`) — this is the SAME placeholder/field
  pairing Confluence and the NL composer already ship; it reads as intentionally muted
  (placeholder, not content) and is consistent app-wide. Typed text uses `--foreground`
  `#e0e0e0` for full-contrast content.
- Focus ring `--ring` `#4a4a4c` at 50% with a 3px ring is the standard cosmos focus
  treatment (every `Input`/`Textarea` uses it) — visible against the dark chrome.
- The `--border` `#333333` bottom divider separates the row from the surface below,
  matching every other `border-b border-border` divider in the panels.

### 5.5 Clear / "X" affordance
- **None.** The spec does not call for a clear button, and Confluence's box has none.
  Clearing is achieved by emptying the field and pressing Enter (returns to default view).
  Adding an `X` would be scope the spec excludes — **do not add it.**

---

## 6. Consistency notes (why this stays on-system)

- The two native search boxes (Jira, Confluence) are now **pixel-identical** chrome: same
  container (`border-b border-border p-2`), same `<form className="relative">`, same
  absolutely-positioned `Search` icon, same `Input` override (`h-8 pl-8 text-sm`). Only
  the placeholder string and the `aria-label` differ (per-integration), and the behavior
  behind submit (Confluence → native list; Jira → A2UI re-compose). A user who learns one
  search box knows the other.
- The box reuses the **existing loading/empty/error surfaces** of the Jira panel
  (`DefaultViewSkeleton`, the `IssueList` empty state, `buildNoticeSurface`) rather than
  inventing search-specific variants — so a search and a default-view load are visually
  indistinguishable except for their content, which is correct (search is "a filter of the
  current view").
- No token, no `components/ui/` change, no `components.json` change. **The design system is
  not extended by this feature** — it is fully expressible in what exists, which is the
  desired outcome.

---

## 7. Developer build notes (non-binding, for convenience)

- Add `import { Search } from 'lucide-react'` and `import { Input } from
  '@/components/ui/input'` to `JiraPanel.tsx` (the `Loader2`/`SquareKanban` lucide import
  line already exists; extend it). The `Search` icon and `Input` are both already used
  elsewhere, so no install.
- The search row is rendered inside `ConnectedBody`, **between** `<PanelTabStrip>` and the
  `<div role="tabpanel">`. Keep `PromptComposer` exactly where it is (last child).
- `searchText` is local `useState('')` in `ConnectedBody`; submit calls
  `requestDefaultInActiveTab(() => window.cosmos.jira.requestSearchView({ jql: searchText }))`
  (per the plan) and does **not** clear `searchText`.
- Do NOT clear the box on submit, do NOT add a button, a spinner-in-box, a clear `X`, an
  inline error, a `title` tooltip, or `truncate`/`text-ellipsis` on the placeholder — all
  excluded above to stay identical to Confluence and within spec scope.

---

## 8. Open questions

**None.** Every state and affordance is resolved against the approved spec/plan and the
existing Confluence pattern:

- Placement (between tab strip and A2UI host) — resolved (mirrors Confluence's above-content row).
- Placeholder = `JIRA_DEFAULT_VIEW_JQL`, untreated single-line clip — resolved (FR-002).
- No submit button, no clear `X`, Enter-only submit, empty submit ⇒ default view — resolved (matches Confluence + FR-005).
- In-flight reflected via the existing per-tab `DefaultViewSkeleton` (`loadingDefault`) — resolved (FR-006).
- Populated/empty/error reuse existing `IssueList` / `buildNoticeSurface` surfaces — resolved (FR-003/FR-007).
- Not-connected hides the box (gated by `ConnectedBody`) — resolved (FR-008).
- `aria-label="Search Jira issues with JQL"`, decorative icon, dark-palette contrast — resolved.
- Tokens/components added: none — resolved.
