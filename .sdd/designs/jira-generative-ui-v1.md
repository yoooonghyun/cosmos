# Design: Jira Generative UI — v1

**Status**: Draft
**Created**: 2026-06-06
**Spec**: .sdd/specs/jira-generative-ui-v1.md
**Plan**: .sdd/plans/jira-generative-ui-v1.md
**Design system**: Tailwind v4 + shadcn/ui (new-york), dark-first cosmos palette (`src/renderer/index.css`)

---

## 0. Design intent & the central constraint

This feature renders Jira screens — an **issue list**, a **ticket detail** — as A2UI
surfaces in the existing Generated-UI panel, and makes two of their controls perform real
Jira writes (transition, comment). All three surfaces are composed **in main** by the new
`src/main/jiraSurfaceBuilder.ts` (plan D1) from the resource types in `src/shared/jira.ts`,
and pushed through the existing `render_ui` → `UiBridge` → `ui:render` path (FR-001). The
builder is the single composer for both the initial render and the post-write update (FR-007).

**The one design fact that shapes everything below — read this first.**

The surfaces are **A2UI 0.9 standard-catalog** components (FR-003), NOT cosmos shadcn
components. I inspected the renderer the panel actually uses
(`@a2ui-sdk/react@0.4.0`, version `0.9`, `node_modules/@a2ui-sdk/react/dist/0.9/...`). Two
findings govern this design:

1. **The standard catalog IS themeable — by tokens, automatically, for free.** Every
   standard-catalog component is built on the SAME shadcn token classes cosmos defines.
   `Card` → `bg-card text-card-foreground border`; `Button` → `bg-primary
   text-primary-foreground` / `outline border bg-background`; `TextField` → shadcn
   `Input`/`Textarea`/`Label`; `ChoicePicker(mutuallyExclusive)` → shadcn `Select`;
   `Text variant=caption` → `text-muted-foreground`; `Divider` → `Separator` (`border`).
   Those classes resolve against the CSS variables in `src/renderer/index.css` `.dark`
   (cosmos compiles the renderer's Tailwind), so **a Jira surface inherits the cosmos dark
   palette with no extra work** and reads as the same product as the native panels. There is
   no second theme to fight. **Good news: the renderer is not a fixed/foreign style.**

2. **But per-instance restyling is IMPOSSIBLE through the standard catalog.** The surface
   JSON cannot pass `className`, `style`, or a color to any component. Concretely:
   - `Text` accepts only `variant` (`h1–h5|body|caption`) + `weight` (flex-grow). **No color
     prop.** So a non-default text color (e.g. a category-colored status) cannot be expressed.
   - `Icon` renders from a **fixed lucide name map** at a fixed `w-5 h-5` in `currentColor`;
     it has no color prop and **no Jira/status icon** in the set. Usable names relevant here:
     `check`, `error`, `warning`, `info`, `refresh`, `send`, `arrowForward`, `person`,
     `lock`, `event`. (Full set in §3.3.)
   - `Button` is binary: `primary:true` → shadcn `default` (filled `--primary`),
     `primary:false`/absent → `outline`. No `destructive`/`secondary` variant, no size.
   - `Card`, `Row`, `Column`, `List` have fixed paddings/gaps (Card content `p-4`; Row
     `gap-3`; Column `gap-4`; List `gap-3`). Spacing is not tunable per surface.

**Consequence for the status-category color treatment (the spec's explicit ask).** cosmos
*has* a status-color vocabulary — the `--status-todo/-progress/-done` tokens in `index.css`,
consumed today by the native `JiraPanel.tsx` `StatusBadge`. **A2UI v1 surfaces cannot use
it.** There is no standard-catalog component that accepts those classes, and v1 forbids a
custom catalog (FR-003) and forbids restyling the renderer. So:

> **DESIGN DECISION (status color, v1): convey status by NAME + STRUCTURE, not color.**
> Status is rendered as the literal `statusName` text plus a category word the builder
> derives, inside a visually distinct `Card`/`Row` "chip" slot. The cosmos status *colors*
> are **deferred to the Jira custom catalog** (already out of scope per FR-003). This is the
> honest realization of the spec note "if the standard renderer styling is fixed and not
> themeable, say so explicitly and design within that reality." See §3.1 and Open Question 1.

This is consistent with cosmos's own a11y rule already recorded in `src/shared/jira.ts`:
*"Color is never the sole carrier — the Badge always shows the status name."* The standard
catalog simply forces us to the text-only half of that rule for v1.

No new theme token is required by this feature. The existing `--status-*` tokens stay (the
native panel uses them); this design adds **nothing** to `index.css` and **no** new
`components/ui/` primitive — there is nothing for the renderer to consume them through.

---

## 1. Surfaces & where they live

All three surfaces render **in the existing Generated-UI panel body**
(`src/renderer/GeneratedUiPanel.tsx`, inside `<section aria-label="Generated UI">`), in the
scrollable region above the bottom-docked composer. No new rail entry, no new route, no
renderer change (plan D2). The panel chrome (header, "Dismiss", composer, error fallback)
is unchanged and already cosmos-native; these surfaces are the agent/main-composed content
that fills the body.

| Surface | Composed by | From | Trigger |
|---|---|---|---|
| **A. Issue list** | `buildIssueListSurface(page)` | `JiraPage<JiraIssueSummary>` | utterance → agent reads → `render_ui` |
| **B. Ticket detail** | `buildIssueDetailSurface(detail, opts?)` | `JiraIssueDetail` (+ `availableTransitions`) | utterance, OR post-write re-compose |
| **C. Post-write notice** | same `buildIssueDetailSurface(detail, { notice })` | re-read `JiraIssueDetail` + a notice | a `jira.*` bound action resolved |

C is not a separate layout — it is surface B re-pushed by `JiraActionDispatcher` with a
`notice` prepended (success or error). Keeping the builder single (one detail layout, an
optional notice line) is what makes the post-write update deterministic and uniform (FR-007).

The whole surface body is **already in a scroll container** (`overflow-auto` on the panel
body), so long lists / long comment threads scroll the panel; the builder does not own
scrolling.

---

## 2. Surface A — Issue list

### 2.1 Layout (populated)

A vertical `List` (or `Column`) of issue **`Card`s**, newest/most-relevant first as the JQL
returned them. Each card is one issue and is built like this:

```
Column  (surface root)
├─ Text  variant=h4   "Issues"            ← list heading (caption count beneath)
├─ Text  variant=caption  "12 issues"     ← count; "Showing first page" if paged
├─ Divider
└─ List direction=vertical
   └─ (per issue) Card → Column
        ├─ Row justify=spaceBetween align=center
        │   ├─ Text variant=h5   "PROJ-123"        ← issue key (monospace feel via h5)
        │   └─ [status chip]  (see §3.1)            ← Row: Text caption "In Progress"
        ├─ Text variant=body   "Summary line of the issue"
        └─ Row align=center gap
            ├─ Icon name=person
            └─ Text variant=caption  "Ada Lovelace"   ← assignee, or "Unassigned"
```

Rationale: `Card` gives each issue the cosmos `bg-card`/`border` panel treatment (matches the
native Jira panel's issue rows and the foundation's surface cards). `Row
justify=spaceBetween` puts the key left and the status chip right — the scan pattern of the
native panel. Key as `h5` (semibold, `text-base`) reads as the card's title; summary as
`body`; assignee as `caption` (muted) with the `person` glyph.

**No Table** (the catalog has none, per the constraint) — the card list IS the table
substitute and is the cosmos-consistent pattern anyway (the native JiraPanel also uses a
card/row list, not a grid).

### 2.2 States

- **Loading** — The issue-list surface is composed in main only after the agent's read
  resolves, so the *surface itself* has no in-surface spinner. The **panel's existing
  composer "Generating…" state** (Loader2 + `aria-live` "Generating…") is the load
  affordance for the whole compose step (foundation design §4.4) and covers this. The builder
  emits nothing for loading. *(Stated explicitly so the developer does not invent a skeleton
  the catalog can't style anyway.)*
- **Empty** (`page.items.length === 0`) — a single `Column`:
  `Text h4 "No issues"` + `Text caption "No issues match this search."` No card list, no
  empty card outline. Calm, not alarming.
- **Populated** — §2.1.
- **Error** — the issue-list path is a *read*; a failed read is surfaced by the agent/MCP
  result the same way reads already fail today (the agent reports the structured
  "connect/reconnect Jira" or "busy, retry" outcome in the conversation, and may compose a
  minimal notice surface). If main composes an error surface, it uses the **§3.2 notice
  block** (`error` kind) as the whole body. No crash, no stack trace (FR-017).
- **Disabled** — N/A for a read-only list; the list has no interactive controls in v1
  (issue cards are not buttons in v1 — opening a ticket is a fresh utterance). If a future
  per-card "open" button is added it follows §3.4 disabled rules.

---

## 3. Surface B — Ticket detail

### 3.1 Layout (populated)

```
Column (surface root)
├─ Row justify=spaceBetween align=center
│   ├─ Text variant=h3   "PROJ-123"              ← key
│   └─ [status chip]                              ← §3.1-chip
├─ Text variant=h4   "Summary of the ticket"     ← summary
├─ Row align=center
│   ├─ Icon name=person
│   ├─ Text caption  "Assignee: Ada Lovelace"
│   ├─ Text caption  "·"
│   └─ Text caption  "Reporter: Grace Hopper"
├─ Divider
├─ Text variant=caption  "Description"            ← section label
├─ Text variant=body     "<flattened description, or 'No description.'>"
├─ Divider
│
│   ── Transition control (§3.4) ──
├─ Text variant=caption  "Move to"
├─ ChoicePicker  variant=mutuallyExclusive  label="Status"  → options from availableTransitions
├─ Button primary  action=jira.transition   child=Text "Apply transition"
├─ Divider
│
│   ── Comments (§3.5) ──
├─ Text variant=h5  "Comments"
├─ List (per comment) Column
│     ├─ Row align=center
│     │   ├─ Icon name=person
│     │   ├─ Text caption  "Author Name"
│     │   └─ Text caption  "· 2h ago"
│     └─ Text variant=body  "comment body (flattened)"
├─ Divider
│
│   ── Add comment (§3.5) ──
├─ TextField variant=longText  label="Add a comment"  value→ /commentBody
└─ Button primary  action=jira.comment  child=Text "Comment"
```

#### The status "chip" (the color-less realization, §0)

Because no catalog component takes a color, the status chip is a **`Card` wrapping a `Row`**:

```
Card → Row align=center gap
  ├─ Icon name=<category glyph>          ← see mapping below (currentColor, not category color)
  └─ Text variant=caption  "In Progress" ← the literal statusName
```

The `Card` gives it the `bg-card`/`border` boxed-chip look that distinguishes it from
surrounding text; the **statusName text** is the real signal. A category **glyph** adds a
redundant non-color cue (the cosmos a11y rule: never color-only — here we have *no* color, so
the glyph + word carry it entirely):

| `JiraStatusCategory` | glyph (`Icon name`) | category word (in `aria`/optional caption) |
|---|---|---|
| `todo` | `event` (an open/− cue) | "To Do" |
| `in_progress` | `refresh` | "In Progress" |
| `done` | `check` | "Done" |
| `unknown` | `info` | "Status" |

> Glyphs are chosen from the **fixed** standard-catalog icon set (§3.3) — `event/refresh/
> check/info` exist; there is no purpose-built status icon. If the builder finds the glyph map
> too coarse, the fallback is the statusName text **alone** (still complete, since the text is
> the source of truth). The developer MUST NOT introduce a non-catalog icon.

**Flag for the deferred Jira custom catalog (out of scope, FR-003):** a `StatusBadge`
custom component that consumes `--status-todo/-progress/-done` would restore exact native-panel
color parity. That is the right home for category color; v1 ships the text+glyph chip.

### 3.2 Post-write notice block (Surface C, FR-007)

When `JiraActionDispatcher` re-pushes surface B after a write, `buildIssueDetailSurface` is
called with `opts.notice = { kind: 'success' | 'error', message }`, prepended as the FIRST
child of the root `Column`:

```
Card → Row align=center gap
  ├─ Icon name=check   (success)   |   name=error (error)   |   name=lock (write_not_authorized)
  └─ Text variant=body  "<message>"
```

- **success** — e.g. *"Moved to Done."* / *"Comment added."* `Icon check`. The rest of the
  surface below already shows the new truth (re-read detail → new status / appended comment),
  so the notice is a confirmation, not the only signal.
- **error** — e.g. *"Couldn't apply that transition — it may no longer be available. The
  ticket is unchanged."* `Icon error`. The surface below shows the **unchanged** ticket
  (FR-007/FR-017). Message text comes from the `JiraError.message` (already non-alarming,
  non-secret).
- **write_not_authorized** (D4 / FR-013) — `Icon lock` + *"Reconnect Jira to enable actions.
  Open the Jira panel and choose Reconnect."* This is the scope-gap state; see §3.6.

**Color caveat (§0):** this notice **cannot be tinted** destructive/green like the panel's
native error blocks — the catalog `Text`/`Card` won't take the color. The `check`/`error`/
`lock` **glyph + the explicit message wording** carry success-vs-failure. This is a
deliberate, stated downgrade from the native panel's tinted `bg-destructive/15` alert, forced
by the standard catalog. (Custom-catalog parity item, same as the status chip.)

### 3.3 Available icon names (the fixed set — developer reference)

`accountCircle, add, arrowBack, arrowForward, attachFile, calendarToday, call, camera,
check, close, delete, download, edit, event, error, favorite, favoriteOff, folder, help,
home, info, locationOn, lock, lockOpen, mail, menu, moreVert, moreHoriz, notificationsOff,
notifications, payment, person, phone, photo, print, refresh, search, send, settings, share,
shoppingCart, star, starHalf, starOff, upload, visibility, visibilityOff, warning`.
Any other name renders nothing (the catalog warns + drops it). Stay inside this set.

### 3.4 Transition control (the `jira.transition` action)

- **Component:** `ChoicePicker variant=mutuallyExclusive` (renders a shadcn `Select`
  dropdown, themed, with placeholder "Select an option"). `label="Status"`, `value` bound to
  path `/transitionId`. `options` = `availableTransitions.map(t => ({ value: t.id, label:
  t.name }))` (the `JiraTransition.name`, e.g. "Start Progress", "Done").
- **Submit:** a `Button primary` whose `child` is `Text "Apply transition"` and whose
  `action` is `{ name: 'jira.transition', context: { issueKey, transitionId: {path:
  '/transitionId'} } }`. The panel maps SDK `name`→`actionId` and `context`→`values`
  unchanged (plan D2), so main receives `actionId:'jira.transition'`,
  `values:{issueKey, transitionId}`.
- **Why a dropdown + explicit Apply (not auto-fire on select):** a transition is a real
  mutation; the user must confirm. A bare `ChoicePicker` has no submit; the Button is the
  commit. (`Button` `checks`/validation could require a non-empty selection — see a11y §6.)
- **Empty transitions** (`availableTransitions` is `[]`): the builder **omits** the
  transition block entirely and shows `Text caption "No transitions available."` in its place.
  A `ChoicePicker` with no options renders null anyway (verified), so the explicit caption
  prevents a silently missing control.
- **Disabled:** v1 has no per-control disable signal from the catalog beyond validation. The
  control is present whenever transitions exist; the only "disabled" analog is the Button's
  built-in `disabled` when `checks` fail (e.g. nothing selected) — shadcn renders
  `disabled:opacity-50 pointer-events-none`, themed.

### 3.5 Comment control (the `jira.comment` action) + comment list

- **Existing comments:** a `List` of per-comment `Column`s (§3.1). Empty thread → `Text
  caption "No comments yet."` (no empty card). Author from `JiraComment.author?.displayName`
  (else "Unknown"); time from `created` rendered short.
- **Add comment:** `TextField variant=longText` (shadcn `Textarea`, `min-h-[100px]`,
  themed), `label="Add a comment"`, `value` bound to path `/commentBody`. Submit
  `Button primary` child `Text "Comment"`, `action { name:'jira.comment', context:{ issueKey,
  body: {path:'/commentBody'} } }`.
- **Empty/whitespace guard (FR-006):** main's `validateJiraComment` rejects a
  whitespace-only body (no write). On the surface, give the Button a `checks` rule requiring
  a non-empty `/commentBody` so the Button is `disabled` until the user types — the catalog
  `Button` honors `checks` via `useValidation` and renders disabled. (Belt-and-braces with
  the main-side guard.)

### 3.6 Re-consent / `write_not_authorized` state (D4, FR-013)

When a write is attempted with a token lacking `write:jira-work`, the dispatcher does NOT
hit Jira; it re-pushes surface B with the §3.2 **`write_not_authorized` notice** (`lock`
glyph + *"Reconnect Jira to enable actions. Open the Jira panel and choose Reconnect."*).
The ticket data below is the last-known detail (best-effort), unchanged. We deliberately do
**not** put a Connect/OAuth button on the A2UI surface (no second OAuth entry point, D4) —
the message points the user to the **native Jira panel's existing Connect/Reconnect**
affordance (the only consent surface). The native panel already owns that flow and its tokens.

### 3.7 States (Surface B, all five)

- **Loading** — same as §2.2: the panel composer's "Generating…" is the load state; the
  builder emits no in-surface spinner.
- **Empty** — a ticket detail is never "empty" (it's one issue); the per-section empties
  (no description / no comments / no transitions) are handled inline (§3.1/§3.4/§3.5).
- **Populated** — §3.1.
- **Error** — §3.2 error notice prepended; ticket shown unchanged; never crash/leak (FR-017).
- **Disabled** — the two submit Buttons are the only disable-able controls; disabled via
  `checks` (empty selection / empty comment) → shadcn `disabled:opacity-50`. The
  `write_not_authorized` state (§3.6) is the "actions unavailable" disabled-equivalent for
  the whole write capability.

---

## 4. Tokens used

**No tokens added or changed by this feature.** The surfaces consume only what the standard
catalog already maps to: `--card`/`--card-foreground`, `--border`, `--primary`/
`--primary-foreground`, `--secondary`, `--muted-foreground`, `--input`, `--ring`,
`--destructive` (via the catalog's internal shadcn classes). The cosmos `.dark` values in
`src/renderer/index.css` apply automatically (§0.1).

The `--status-todo/-progress/-done` tokens **remain** (the native `JiraPanel.tsx` uses them)
but are **not consumed** by any A2UI surface — the standard catalog has no path to them
(§0.2). They are the right tokens for the deferred Jira custom-catalog `StatusBadge`.

---

## 5. Components used (standard catalog → role)

| A2UI standard component | Variant / props | Role |
|---|---|---|
| `Column` / `Row` | `justify`, `align` | surface scaffold; key↔status split; meta rows |
| `List` | `direction=vertical` | issue cards; comment thread |
| `Card` | (fixed `p-4`) | each issue; the status chip box; the notice box |
| `Text` | `h3/h4/h5/body/caption` | key, summary, labels, body, muted meta — **no color** |
| `Icon` | fixed name set (§3.3) | `person`, category glyph, `check/error/lock/info` cues |
| `Divider` | horizontal | section separation |
| `ChoicePicker` | `mutuallyExclusive` | transition picker (→ shadcn Select) |
| `TextField` | `longText` | add-comment input (→ shadcn Textarea) |
| `Button` | `primary` | Apply transition / Comment submit (→ shadcn `default`) |

**No** shadcn `components/ui/` primitive is added; **no** `components.json` change; **no**
custom catalog (FR-003). The developer installs nothing for this design.

---

## 6. Interaction & accessibility

- **Theme inheritance** gives correct contrast for free: catalog text is `--foreground`
  (#e0e0e0 on #1e1e1e), captions `--muted-foreground` (#888 on card) — both already used
  across cosmos. The one **a11y gap created by the constraint**: status & success/error are
  **not** color-coded (impossible, §0.2). We mitigate with explicit **words** (the statusName,
  "Moved to Done", "Couldn't apply…") and **glyphs** (§3.1/§3.2). Because the signal was never
  color-only, contrast/colorblind safety is actually *better*, not worse — it is text-first.
- **Focus & keyboard:** the catalog controls are Radix-based shadcn (`Select`, `Textarea`,
  `Button`) so focus rings (`--ring`), keyboard open/close, and arrow-key option navigation
  come built-in. Reading/focus order follows the `Column` child order in §3.1 (key → summary
  → meta → description → transition → comments → add-comment), which is also the logical task
  order.
- **Submit guards:** transition `Button` and comment `Button` use catalog `checks`
  (validation) so they are `disabled` until a transition is selected / a non-empty comment is
  typed (§3.4/§3.5) — disabled styling is shadcn `opacity-50 pointer-events-none`. This is the
  surface-side mirror of main's boundary validation (FR-006); main remains the authority.
- **Single-action semantics:** the panel already submits an action once per surface
  (`submittedRef`) and keeps the surface up after acting (foundation). For Jira, after a
  bound action fires, **main re-pushes a fresh surface** (new `requestId`), which remounts a
  fresh boundary and re-enables interaction on the updated surface — so a user can transition
  then comment in sequence across successive re-pushes (each re-push = a fresh actionable
  surface). *(Developer note: this depends on the dispatcher's re-push carrying a new
  `requestId`; flagged as Open Question 2.)*
- **No color-only status** — satisfied by construction (there is no status color at all; §0).

---

## 7. Open questions

1. **Status color in v1 surfaces is genuinely unavailable (BLOCKER for color parity, not for
   shipping).** The standard catalog exposes no way to apply the `--status-*` tokens, and v1
   forbids a custom catalog (FR-003). This design ships status as **statusName text + a
   fixed-set glyph** (§3.1) and ships the success/error notice as **glyph + wording** (§3.2),
   with **no tint**. If product wants the native-panel colored badge parity in the
   Generated-UI panel, that requires the **deferred Jira custom catalog** (`catalogId:"jira"`,
   a `StatusBadge`/notice component consuming `--status-*`) — explicitly out of scope here.
   **Confirm this text-first treatment is acceptable for v1**; if not, the custom catalog must
   be pulled back into scope (an architect/spec change, not a design change).

2. **Does the dispatcher's post-write re-push carry a NEW `requestId`, and does that
   re-enable interaction?** §6 assumes yes (so the user can act again on the updated surface).
   The renderer keys the error boundary and the `submittedRef` by `requestId`; a re-push with
   the *same* id would leave the surface in the already-submitted (inert) state. This is a
   renderer/dispatcher contract detail the developer must settle — recommend the re-push use a
   fresh `requestId` so each post-write surface is freshly actionable. (Plan D1 says main
   "re-pushes via `pushRenderToRenderer`"; confirm the id is fresh.)

3. **Time formatting for comments** (`JiraComment.created`) — the builder needs a short
   relative/absolute format ("2h ago" vs "2026-06-05"). The native `JiraPanel` already
   renders a short time; recommend the builder reuse that formatting convention so the two
   surfaces match. Pure formatting, no token impact — flagging only for consistency.
