# Design: Jira Write Extend — Create & Update — v1

**Status**: Draft
**Created**: 2026-06-06
**Spec**: .sdd/specs/jira-write-extend-v1.md
**Plan**: .sdd/plans/jira-write-extend-v1.md
**Extends (do NOT restyle)**: .sdd/designs/jira-generative-ui-v2.md — the existing Jira
custom-catalog design (StatusBadge / TicketCard / IssueList / TransitionPicker / CommentRow /
CommentList / AddCommentControl / Notice / Text). The two new forms must read as the SAME product.
**Design system**: Tailwind v4 + shadcn/ui (new-york), dark-first cosmos palette (`src/renderer/index.css`)

---

## 0. Design intent

This adds two NEW Jira custom-catalog form components — **`CreateIssueForm`** and
**`EditIssueForm`** — to the v2 catalog. They are the catalog's first multi-field *forms* (v2's
two input controls, TransitionPicker and AddCommentControl, are each a single field + button). The
design goal is uniformity: both forms must look like they were always part of the v2 catalog, reuse
the v2 input/label/button rhythm, the v2 `Notice` for surface-level write feedback, and the
existing dark tokens — **no bespoke CSS, no new token, no new shadcn primitive.**

Both forms are **interactive catalog components** (the v2 §1.3/§1.4 contract): each field binds to
the surface data model via `useFormBinding`, and the single submit button emits a `jira.*` bound
action via `useDispatchAction`, with a surface-side submit guard that mirrors main's validator. The
post-write surface (success / error / scope-gap) is the dispatcher re-pushing a fresh surface whose
first child is the existing v2 **`Notice`** (design v2 §9.5) — these forms add NO new feedback
mechanism; they reuse the one already shipping.

**This design owns the pixels of the two forms and all five of their states.** It does not own the
component contract (props/paths/actions — the plan's "Component contracts" table owns that, and §2
below confirms it), nor any build wiring.

---

## 1. Grounding — what already exists (so we add nothing we don't need)

Verified against the live system (`src/renderer/components/ui/`, `src/renderer/jiraCatalog/`,
`src/renderer/index.css`):

| Need | Already present? | Source |
|---|---|---|
| Single-line text field (project key, summary) | **Yes** | `components/ui/input.tsx` — `h-9`, `border-input`, `focus-visible:ring-ring/50`, **`aria-invalid:border-destructive`** built-in |
| Multi-line text (description) | **Yes** | `components/ui/textarea.tsx` — same border/focus/`aria-invalid` treatment (used by v2 AddCommentControl) |
| Dropdown (issue type) | **Yes** | `components/ui/select.tsx` — Radix Select, used by v2 TransitionPicker |
| Submit button (filled primary) | **Yes** | `components/ui/button.tsx` — `variant="default" size="sm"`, `disabled:opacity-50 pointer-events-none` (v2's Apply/Comment/Send) |
| Bounding container | **Yes** | `components/ui/card.tsx` — v2 TicketCard already uses the compact `p-3 gap-2` override |
| Section/field label | **Yes** | v2 pattern: `span text-xs font-medium text-muted-foreground` (TransitionPicker "Move to", AddCommentControl "Add a comment") |
| Surface-level write feedback | **Yes** | v2 `Notice` (success / error / write_not_authorized), prepended by the dispatcher (v2 §9.5) |
| Loading placeholders | **Yes** | `components/ui/skeleton.tsx` (v2 §5/§7 loading) |
| `useFormBinding` / `useDispatchAction` | **Yes** | `@a2ui-sdk/react/0.9`, proven by v2's two input controls |

**Conclusion: NO new shadcn primitive and NO new theme token is required.** Both forms are fully
expressible in the existing tokens + primitives. (The v2 design already added `select.tsx`; it is
present in `src/renderer/components/ui/`.) The only catalog additions are the two new React
components + their `index.ts` registration + their pure logic helpers — all owned by the developer,
not the design system.

---

## 2. Component contract confirmation (the plan's Step-2.5 hand-off)

I confirm the plan's "Component contracts" rows for both forms, with two design-level notes:

| Component (`catalogId:'jira'`) | Builder static props | Form-bound fields (data-model paths) | Emitted action | Submit guard |
|---|---|---|---|---|
| `CreateIssueForm` | optional `defaultProjectKey?`; optional `issueTypes?: string[]` (see note A) | `projectKey` (`/createProjectKey`), `issueType` (`/createIssueType`), `summary` (`/createSummary`), `description` (`/createDescription`) | `jira.create` `{ projectKey, issueType, summary, description }` | `isCreateSubmittable` — non-empty `projectKey` **and** non-empty `issueType` **and** non-whitespace `summary` |
| `EditIssueForm` | `issueKey`, seeded `summary` / `description` (and `assignee` — see note B) | `summary` (`/editSummary`), `description` (`/editDescription`) | `jira.update` `{ issueKey, fields }` where `fields` = ONLY changed entries (diff vs. seeded) | `isUpdateSubmittable` — at least one field changed (non-empty diff) |

**Note A — issue type field is a `Select` when the builder supplies options, else a text `Input`.**
The spec/plan keep issue type as a fixed minimal field (no `createmeta` discovery, FR-002), but a
project's issue types are *not* discoverable without a meta call this feature forbids. So the design
supports BOTH shapes with no extra primitive:
- If the builder/agent passes `issueTypes?: string[]` on the node (e.g. it already knows the common
  set like `Task`/`Bug`/`Story`), `CreateIssueForm` renders the issue-type field as a **`Select`**
  (v2 TransitionPicker affordance — parity).
- If `issueTypes` is absent/empty, it renders a **text `Input`** (placeholder `"Task"`). Either way
  the bound value is the issue-type *name* string the `jira.create` body needs
  (`issuetype: { name }`, FR-011). This keeps the form usable with zero discovery and stays within
  FR-002. **Same applies to `projectKey`** (the plan already allows "text or select"): text `Input`
  by default, `Select` only if the builder passes a `projectKeys?: string[]` list. Default for both
  is the text `Input` (simplest, always works).

**Note B — assignee on the edit form is OMITTED for v1 (documented decision).** The spec explicitly
permits this: *"When the form has no assignee picker available, the edit form MAY omit assignee
entirely"* (spec Edge Cases; FR-003 "where cheaply expressible"). There is **no clean, cheap way**
to pick an assignee in this surface: assignee is `{ accountId }` only (no display-name→accountId
search, OUT of scope), and cosmos has no list of project-assignable users to populate a `Select`.
The only expressible control would be a raw-`accountId` text field, which is a poor, error-prone UX
(opaque ID, no validation, easy to mistype into a 400). **Decision: `EditIssueForm` ships with
`summary` + `description` only for v1.** The component still *carries* the seeded `assignee` (so the
detail re-render shows it) but renders no assignee editor. The `jira.update` `fields` therefore only
ever contains `summary` / `description` changes in v1. This is recorded as Open Question 1 (a future
assignee picker is a real user-list feature, not a per-surface tweak) so the developer doesn't build
a half-baked accountId box. **No `assignee.accountId` data-model path is added for v1.**

---

## 3. `CreateIssueForm` (emits `jira.create`)

A blank, top-down form: four fields stacked in a card, one filled primary **Create issue** button.
Reuses the v2 field rhythm (label `text-xs font-medium text-muted-foreground` above each control,
`gap-2` within a field, `gap-4` between fields).

### 3.1 Layout

```
Card  (bg-card border rounded-xl p-3, flex-col gap-4)          ← compact card, same override as v2 TicketCard
├─ header  Row (flex items-center gap-2)
│    ├─ SquareKanban  size-4 text-muted-foreground             ← (optional) form glyph, muted
│    └─ span  text-sm font-medium text-foreground   "Create issue"
│
├─ [surface-level error Notice]                                ← only on a re-push after a failed create (§3.3 Error); first child of the re-pushed surface, NOT inside this Card — see §6
│
├─ field: Project           (flex-col gap-1.5)
│    ├─ Label  htmlFor="create-project"  text-xs font-medium text-muted-foreground   "Project key"
│    └─ Input  id="create-project"  value↔/createProjectKey  placeholder "PROJ"
│         className "font-mono"   (keys are uppercase mono, like the v2 key chip)
│         aria-invalid set when touched && empty (see §3.3)
│   └─ (variant) Select  when builder supplies projectKeys?[]  (trigger "Select a project")
│
├─ field: Issue type        (flex-col gap-1.5)
│    ├─ Label  htmlFor="create-type"   "Issue type"
│    └─ Input  id="create-type"  value↔/createIssueType  placeholder "Task"     ← default text variant
│   └─ (variant) Select  when builder supplies issueTypes?[]  (trigger "Select an issue type", items = names)
│
├─ field: Summary           (flex-col gap-1.5)               ← REQUIRED
│    ├─ Label  htmlFor="create-summary"   "Summary"
│    └─ Input  id="create-summary"  value↔/createSummary  placeholder "Short summary of the issue"
│         aria-invalid set when touched && whitespace-only (see §3.3)
│
├─ field: Description        (flex-col gap-1.5)               ← optional
│    ├─ Label  htmlFor="create-desc"   "Description"
│    └─ Textarea  id="create-desc"  value↔/createDescription  placeholder "Add more detail…"
│         className "max-h-[16rem] min-h-[96px] resize-none"   (taller than the comment box; this is the main body)
│
└─ Row  (flex items-center justify-between gap-2)
    ├─ span  text-[11px] text-muted-foreground   "Project key, type, and summary are required."   ← hint (role omitted; static)
    └─ Button  variant="default" size="sm"  "Create issue"
          disabled = !isCreateSubmittable(projectKey, issueType, summary)
          onClick → dispatch(surfaceId, componentId,
            { name: 'jira.create', context: {
                projectKey:  { path: '/createProjectKey' },
                issueType:   { path: '/createIssueType' },
                summary:     { path: '/createSummary' },
                description: { path: '/createDescription' } } })
```

### 3.2 Hierarchy, spacing, typography (all token-mapped)

- Card surface: `bg-card` / `text-card-foreground`, `border-border`, `rounded-xl`, `p-3`, `gap-4`
  (identical to the v2 TicketCard compact card so the form sits in the same visual family).
- Field label: `text-xs font-medium text-muted-foreground` (the v2 label token, verbatim).
- Controls: `Input` / `Textarea` / `Select` at their default `h-9` height; `text-foreground` value,
  `placeholder:text-muted-foreground` (primitive defaults — no override).
- Header title: `text-sm font-medium text-foreground` (slightly stronger than a field label so the
  form has one clear title).
- Required-fields hint: `text-[11px] text-muted-foreground` (the v2 composer's caption scale).
- Submit: `Button variant="default" size="sm"` → `bg-primary text-primary-foreground` filled — the
  same primary action as v2's Apply / Comment / Send, so "the commit button" looks identical
  everywhere.

### 3.3 The five states

- **Loading** — `CreateIssueForm` is a *blank* form (no seed read), so it has **no loading state of
  its own**; it renders immediately populated-empty. (Contrast EditIssueForm §4, which awaits seed
  data.) If a host ever needs a placeholder, reuse the §4 skeleton rhythm — but the create form
  never blocks on a read.
- **Empty / initial** — all four controls at their resting placeholder state, **Create issue
  `disabled`** (`opacity-50 pointer-events-none`) because the required diff is unmet. No
  `aria-invalid` shown yet (fields are untouched — don't shout at a blank form).
- **Populated / valid** — once `projectKey` and `issueType` are non-empty and `summary` is
  non-whitespace, **Create issue enables** (filled primary, full opacity). Description may be empty
  (optional). This is the submit-ready state.
- **Error** — a create rejected by Jira (missing-required-field 400, unknown project/type 400,
  rate-limited, reconnect-needed, `write_not_authorized`) is surfaced exactly like every other v2
  write: the **dispatcher re-pushes the surface with a `Notice` prepended as the first child**
  (v2 §9.5 / §6 below), carrying the non-secret message (e.g. *"Couldn't create the issue — the
  project may require additional fields."* / the `JIRA_WRITE_NOT_AUTHORIZED_MESSAGE` for the scope
  gap). The form below the notice **stays filled with the user's entered values** so they can fix
  and resubmit (the re-push seeds the data-model paths from the just-submitted values — see §5).
  Per-field invalid: only fields that are *individually* invalid get `aria-invalid` (empty project /
  type / whitespace summary) once touched — destructive border + ring via the Input primitive's
  built-in `aria-invalid:border-destructive aria-invalid:ring-destructive/20`.
- **Disabled / in-flight** — **Create issue is `disabled` whenever the guard is unmet.** During an
  in-flight create the surface is re-pushed fresh by the dispatcher (new `requestId`, v2
  single-action semantics via the panel's `submittedRef`), so there is no in-component spinner — the
  dispatch is single-shot per surface, identical to TransitionPicker/AddCommentControl (v2 §12).

---

## 4. `EditIssueForm` (emits `jira.update`)

The same field rhythm as `CreateIssueForm`, but **seeded** from the issue's current values and
**diff-gated**: submit is enabled only when something actually changed. v1 fields = `summary` +
`description` (assignee omitted, §2 note B).

### 4.1 Layout

```
Card  (bg-card border rounded-xl p-3, flex-col gap-4)
├─ header  Row (flex items-center gap-2)
│    ├─ Badge variant="secondary" font-mono text-[10px]   issueKey   "PROJ-123"   ← the issue being edited (v2 key chip)
│    └─ span  text-sm font-medium text-foreground   "Edit issue"
│
├─ [surface-level error/success Notice]                       ← re-push only; first child of the re-pushed surface (§6)
│
├─ field: Summary           (flex-col gap-1.5)
│    ├─ Label  htmlFor="edit-summary"   "Summary"
│    └─ Input  id="edit-summary"  value↔/editSummary  (seeded = detail.summary)
│         aria-invalid when touched && whitespace-only (summary may not be blanked — see §4.3)
│
├─ field: Description        (flex-col gap-1.5)
│    ├─ Label  htmlFor="edit-desc"   "Description"
│    └─ Textarea  id="edit-desc"  value↔/editDescription  (seeded = detail.description)
│         className "max-h-[16rem] min-h-[96px] resize-none"
│
└─ Row  (flex items-center justify-between gap-2)
    ├─ span  text-[11px] text-muted-foreground   "Change a field to enable saving."   ← hint
    └─ Button  variant="default" size="sm"  "Save changes"
          disabled = !isUpdateSubmittable(diffUpdateFields(seeded, current))
          onClick → dispatch(surfaceId, componentId,
            { name: 'jira.update', context: {
                issueKey,
                fields: <only-changed diff>  })            ← see §4.4 on expressing the diff
```

### 4.2 Hierarchy, spacing, typography

Identical token mapping to §3.2. The one visual difference from the create form: the header carries
the **issue key chip** (`Badge variant="secondary" font-mono text-[10px]`, the v2 key chip verbatim)
so the user always sees *which* issue they're editing — matching how the detail surface's TicketCard
header reads. The submit label is **"Save changes"** (vs. "Create issue") to read as a mutation of an
existing thing.

### 4.3 The five states

- **Loading (edit form awaiting seed data)** — the edit form is composed by the builder from a
  freshly-read `JiraIssueDetail`, so the seed is present at compose time and the form usually renders
  already-populated. BUT the spec calls out a loading state for "edit form awaiting seed data": if
  the surface is pushed before the read resolves (or the read is in flight on open), render a
  **skeleton form** in the same card footprint so the layout doesn't jump:
  ```
  Card  p-3 gap-4
  ├─ Row  Skeleton h-4 w-16 rounded-full  +  Skeleton h-4 w-20      ← key chip + title
  ├─ Column gap-1.5  Skeleton h-3 w-16  +  Skeleton h-9 w-full      ← Summary label + input
  ├─ Column gap-1.5  Skeleton h-3 w-20  +  Skeleton h-24 w-full     ← Description label + textarea
  └─ Row justify-end  Skeleton h-8 w-28 rounded-md                  ← Save button
  ```
  `aria-busy="true"` on the card. This reuses the v2 `Skeleton` rhythm (§5/§7). In practice the
  builder seeds synchronously, so this is the rare/defensive path — but it is specified so the
  developer has it.
- **Empty / initial (seeded, unchanged)** — both controls show the issue's current values; **Save
  changes `disabled`** because `diffUpdateFields(seeded, current)` is empty. This is the resting
  state on open — nothing changed yet.
- **Populated / valid (a field changed)** — the moment the user edits `summary` or `description` so
  it differs from the seeded value, the diff is non-empty → **Save changes enables** (filled
  primary). If the user edits a field back to its original value, the diff empties again and Save
  **re-disables** (the guard is live, mirroring main's `validateJiraUpdate` empty-`fields`
  rejection). A whitespace-only `summary` is treated as invalid (you can't blank a required Jira
  field) → that field gets `aria-invalid` and is **excluded from the diff**, so it can't enable Save
  on its own.
- **Error** — same channel as create: dispatcher re-pushes with a `Notice` first child (v2 §9.5):
  *"Couldn't update the issue — it may not exist or you may not have permission. Nothing was
  changed."* (404/403/400, FR-013), the rate-limited / reconnect / `write_not_authorized` messages,
  etc. The form below is re-seeded from the **re-read** current values (the update either applied —
  success path — or didn't — error path; either way the seed reflects truth, §5).
- **Disabled / in-flight** — **Save changes `disabled`** whenever the diff is empty (or summary is
  whitespace-only). In-flight: single-shot per surface, no in-component spinner; the dispatcher
  re-pushes a fresh surface (v2 §12). Under `write_not_authorized`, the re-push carries the reconnect
  `Notice` (the disabled-equivalent for writes — points at the native Connect/Reconnect, no OAuth
  button on the surface).

### 4.4 Diff expression (design constraint, hand-off to developer)

The plan's resolved Open Question 2 (belt-and-braces) requires `fields` to carry **only changed
entries**, computed surface-side against the seeded values, with main's `validateJiraUpdate` also
rejecting an empty `fields`. Two design constraints for the developer:

1. The seeded values (`detail.summary`, `detail.description`) must be available to the component at
   diff time. Put them on the **node as static props** (`seededSummary`, `seededDescription`) AND
   seed the data-model paths from them (so the controls render the current value and the diff has a
   baseline). The `diffUpdateFields(seeded, current)` helper (plan's logic.ts) compares the two.
2. The `jira.update` action's `context.fields` cannot be a single `{ path }` binding (it's a
   computed *subset*). The component should build the `fields` object from the live diff at click
   time and pass it as a **literal object of literals** in the action context (the SDK accepts
   literal context values, v2 §1.4). i.e. `context: { issueKey, fields: { summary?: <current>,
   description?: <current> } }` containing only the changed keys. This keeps the contract
   (`{ issueKey, fields }`) intact and the diff authoritative on the surface; main re-validates.

(These are implementation shapes, surfaced here only so the design's "only-changed" requirement is
unambiguous. The developer owns the exact code.)

---

## 5. Re-push / re-seed behavior (shared by both forms)

Aligns with how the dispatcher already re-pushes post-write (v2 §9.5, FR-007):

- **After a successful `jira.create`** — the dispatcher re-reads the new key and re-composes the
  **detail surface** (TicketCard + description + TransitionPicker + CommentList + AddCommentControl),
  with a **success `Notice`** ("Issue created.") prepended. So success leaves the create form and
  lands on the new issue's detail — the create form is not re-shown. (Re-read failure → minimal
  notice surface carrying the new key, FR-007 fallback.)
- **After a successful `jira.update`** — the dispatcher re-reads the issue and re-pushes the
  **detail surface** with a success `Notice` ("Issue updated.") — same as transition/comment. The
  edit form is replaced by the updated detail. (The detail's values are the real post-write reads,
  SC-002.)
- **After a FAILED create/update** — the dispatcher re-pushes the **same form surface** with an
  error/scope `Notice` first child, and re-seeds the form's data-model paths from the
  just-submitted values (create) or the re-read current values (update), so the user can correct and
  retry. This requires the builder's `buildCreateIssueSurface` / `buildEditIssueSurface` to accept
  the prior field values + a notice — a builder concern flagged for the developer; the design
  requirement is only that **the form re-appears pre-filled with a notice on failure, never blank.**

The `Notice` component is **reused unchanged** — no new variant. Its three kinds
(`success` / `error` / `write_not_authorized`) already cover every create/update outcome (FR-017).
The success kind reuses the `--status-done`-tinted neutral Alert + `Check` glyph (v2 §9.5 decision);
error/scope reuse the destructive Alert. No token added.

---

## 6. Where the Notice sits relative to the form

Mirror the v2 detail surface: the `Notice` is the **first child of the surface root `Column`**, the
form `Card` is the next child — the notice is NOT nested inside the card. So a re-pushed failed-form
surface is:

```
Column  (surface root, flex-col gap-4)
├─ <Notice noticeKind="error" message="…" />        ← first child (or "write_not_authorized")
└─ <CreateIssueForm … />  /  <EditIssueForm … />     ← the pre-filled form
```

This is exactly the v2 §9.4/§9.5 composition (notice-first), so the form surfaces read identically
to the transition/comment post-write surfaces — one product.

---

## 7. Tokens used

**No new token.** Both forms consume only existing tokens:

| Token(s) | Used by |
|---|---|
| `--card` / `--card-foreground` | form Card surface, control text |
| `--border` | Card border, control borders (`--input` for control borders via the Input/Textarea primitives) |
| `--input` | Input / Textarea / Select control borders + dark `bg-input/30` fill (primitive default) |
| `--ring` | focus rings on every control (`focus-visible:ring-ring/50`, primitive default) |
| `--foreground` | control values, form title |
| `--muted-foreground` | field labels, hints, placeholders |
| `--primary` / `--primary-foreground` | Create issue / Save changes submit buttons (filled) |
| `--secondary` / `--secondary-foreground` | edit form's issue-key chip (`Badge variant="secondary"`) |
| `--destructive` (`/15`, `/20`, `/40`) | per-field `aria-invalid` border+ring; the error `Notice` (reused) |
| `--accent` | (none new; only if a control hover is wanted — not required) |
| `--status-done` / `-foreground` | the **success** `Notice` accent (reused via v2 §9.5, not added here) |

a11y/contrast: all control text is `--foreground` (#e0e0e0 on the #1b1b1c card), labels/hints
`--muted-foreground` (#888) — the same legible pairings the v2 catalog already proved on the dark
palette. `aria-invalid` uses `--destructive` (#f3b0b0 dark) border + a ring, so an invalid field is
signaled by **border + ring + (optionally) the surface notice**, never color-only.

---

## 8. Components used (shadcn primitives) — none added

| Primitive | Source | Role in the two forms |
|---|---|---|
| `Input` | existing `components/ui/input.tsx` | project key, issue type (default), summary (both forms) |
| `Textarea` | existing `components/ui/textarea.tsx` | description (both forms) |
| `Select` | existing `components/ui/select.tsx` | issue type / project key **variant** when the builder supplies an options list (else `Input`) |
| `Button` | existing `components/ui/button.tsx` | "Create issue" / "Save changes" (`variant="default" size="sm"`) |
| `Card` | existing `components/ui/card.tsx` | form bounding card (compact `p-3 gap-4`, v2 override) |
| `Badge` | existing `components/ui/badge.tsx` | edit form's issue-key chip (`variant="secondary"`) |
| `Alert` (via v2 `Notice`) | existing `components/ui/alert.tsx` | surface-level success/error/scope notice (reused, not re-styled) |
| `Skeleton` | existing `components/ui/skeleton.tsx` | edit-form loading (seed-awaiting) state |

There is **NO new shadcn CLI run and NO `components.json` change** for this feature. (The `Select`
primitive the issue-type field can use was already added by the v2 work and is present at
`src/renderer/components/ui/select.tsx`.) The only new files are catalog code the developer owns:
the two components in `jiraCatalog/components.tsx`, their `PATH_*` constants, their registration in
`jiraCatalog/index.ts`, and the pure guards/diff in `jiraCatalog/logic.ts`.

> Label element: the v2 forms use a plain `<Label>`-styled `span`/`<label htmlFor>` (the
> AddCommentControl uses a `span`; this design uses real `<label htmlFor>` for the multi-field forms
> so each control is programmatically labeled — see §9). No shadcn `Label` primitive is required; a
> native `<label>` with the v2 label classes (`text-xs font-medium text-muted-foreground`) is
> sufficient and avoids adding a primitive. (If the developer prefers, `shadcn add label` would give
> the canonical wrapper — **optional, not required**; the native `<label htmlFor>` is the design
> default to keep the system minimal.)

---

## 9. Interaction & accessibility

- **Focus order** — top-to-bottom matches the DOM/visual order: CreateIssueForm = Project key →
  Issue type → Summary → Description → Create issue. EditIssueForm = Summary → Description → Save
  changes. The issue-key chip and the form title are non-focusable text. When a re-pushed surface
  carries a `Notice`, the notice (`role="alert"`) precedes the form in the DOM so screen readers
  announce the outcome before the (refocusable) fields.
- **Labels / ARIA** — every control has a real `<label htmlFor>` (programmatic association), so the
  field name is announced. The required-fields hint is plain static text under the submit button (no
  live region needed — it doesn't change). Invalid fields set `aria-invalid` (the Input/Textarea
  primitives already render the destructive border+ring from it). The `Select` variant is Radix →
  keyboard open/close, arrow-key option nav, typeahead, and focus ring for free.
- **Keyboard** — standard form tabbing; the submit `Button` is reachable and activatable by
  Enter/Space. Unlike the composer, **Enter inside the single-line `Input`s does NOT auto-submit**
  the form (it would be surprising for a multi-field form and risks firing with required fields
  unmet) — submission is the explicit button only. (If the developer wants Enter-to-submit, gate it
  on the submit guard being satisfied; the design default is button-only.)
- **Submit guards (surface-side mirror of main's validators)** — Create's button is `disabled`
  until `projectKey` + `issueType` + non-whitespace `summary` are all present
  (`isCreateSubmittable`, mirrors `validateJiraCreate`). Edit's button is `disabled` until the diff
  is non-empty (`isUpdateSubmittable(diffUpdateFields(...))`, mirrors `validateJiraUpdate`'s
  empty-`fields` rejection). Disabled = shadcn `opacity-50 pointer-events-none`. **Main remains the
  authority** (FR-006) — the surface guard is belt-and-braces, exactly like v2's two controls.
- **Single-action semantics** — both forms reuse the panel's `submittedRef` (one action per
  `requestId`); after submit, main re-pushes a fresh surface (new `requestId`) that remounts a fresh
  boundary and re-enables interaction (v2 §12). No double-submit.
- **Degradation** — a malformed/unknown form node degrades via the existing `SurfaceErrorBoundary` /
  `UnknownComponent` (v2 §1.5) — the panel never white-screens.
- **Contrast** — inherits the v2 dark pairings (§7). No new color decision; nothing is color-only.

---

## 10. Open questions

1. **Assignee on the edit form — OMITTED for v1 (recommend confirm).** §2 note B: assignee is
   `{ accountId }` only with no user list to populate a picker and no display-name search (OUT of
   scope per spec), so the only expressible control is a raw-accountId text box — a poor, 400-prone
   UX. **This design ships `EditIssueForm` with `summary` + `description` only**, consistent with the
   spec's explicit permission to omit assignee ("the edit form MAY omit assignee entirely"). A real
   assignee picker needs a project-assignable-user list (a new read) — a future feature, not a
   per-surface tweak. **Confirm the omission is acceptable for v1** (designer recommends omit).

2. **Issue-type / project-key field shape — `Input` by default, `Select` when options supplied
   (non-blocking).** §2 note A: with no `createmeta` (FR-002) there's no discoverable issue-type
   list, so the create form's type field is a free-text `Input` by default and only upgrades to a
   `Select` if the builder/agent passes an `issueTypes?: string[]` (same for `projectKey` +
   `projectKeys?`). This adds no primitive (Select already exists) and stays within FR-002. **Flagged
   so the developer/architect knows both shapes are intended**; if the agent should always pass a
   curated type list, that's a builder/main decision, not a design one. Design default: text `Input`,
   Select when options present.

3. **Failed-form re-push must re-seed the form (builder concern, flagged).** §5: on a failed
   create/update the dispatcher re-pushes the **same form** pre-filled (with an error `Notice`),
   which requires `buildCreateIssueSurface` / `buildEditIssueSurface` to accept the prior/current
   field values + the notice. This is a surface-builder shape (developer-owned); the **design
   requirement** is only that a failed form never re-appears blank. **No blocker** — recorded so the
   builder is built to re-seed.
