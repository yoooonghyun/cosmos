# Design: Jira Generative UI — v2

**Status**: Draft
**Created**: 2026-06-06
**Spec**: .sdd/specs/jira-generative-ui-v2.md
**Plan**: .sdd/plans/jira-generative-ui-v2.md
**Supersedes (context)**: .sdd/designs/jira-generative-ui-v1.md (v1 was color-less by the
standard-catalog constraint; v2 restores `--status-*` color via a Jira custom catalog)
**Design system**: Tailwind v4 + shadcn/ui (new-york), dark-first cosmos palette (`src/renderer/index.css`)

---

## 0. Design intent & the v2 win

v1 rendered Jira screens in the **generic Generated-UI panel** with the **A2UI 0.9 standard
catalog**. That catalog passes no `className`/`style`/color to any component, so v1 was forced to
convey status as **text + a fixed-set glyph, no color** — explicitly deferring color parity to "a
future Jira custom catalog" (v1 design §0, §7-OQ1).

**v2 builds exactly that custom catalog.** The native Jira rail panel becomes the generative
surface; its body renders through a Jira-specific A2UI catalog (`catalogId: 'jira'`) whose
components are **plain cosmos React components** — so they can use ANY Tailwind class, including the
`--status-todo/-progress/-done` tokens the native `JiraPanel.StatusBadge` already uses. The whole
v1 "status can't be colored" constraint **disappears**. The custom catalog's job is to make the
agent/main-composed Jira surface **visually identical to the hand-built native panel**.

This design owns the **pixels** of the six custom-catalog components (per the plan's binding
contract table — no component or action added/removed) and the **Jira panel host layout** and all
its states. It does not own the component contract (the architect/plan owns props + actions) or any
build wiring (the developer owns installs/rollup).

---

## 1. CRITICAL grounding — A2UI custom-catalog registration (SDK finding: **BUILDABLE**)

I inspected `node_modules/@a2ui-sdk/react/dist/0.9/` (provider, `ComponentRenderer`,
`ComponentsMapContext`, the standard components, and the data/action hooks). The custom catalog the
plan needs is **fully expressible** in `@a2ui-sdk/react@0.9`. Findings the developer builds against:

### 1.1 How a custom catalog is declared and registered

- A **`Catalog`** (`standard-catalog/index.d.ts`) is just
  `{ components: Record<string, React.ComponentType<any>>; functions: Record<string, unknown> }`.
  `components` maps a **component `type` name** (the string the surface JSON uses, e.g.
  `"TicketCard"`) to a **React component**.
- It is registered by passing it to the provider's **`catalog=` prop**:
  `<A2UIProvider catalog={jiraCatalog}>…</A2UIProvider>`. `A2UIProvider.js` wires `catalog.components`
  straight into `ComponentsMapProvider`; `ComponentRenderer` resolves each node's `component`
  (type name) via `componentsMap.getComponent(type)`. **No global registry, no side-effecting
  register-call** — the catalog is a value owned by whichever provider renders it.
- The Jira catalog is a **completely custom** catalog (the README's "completely custom catalog"
  form): `{ components: { StatusBadge, TicketCard, TransitionPicker, IssueList, CommentList,
  CommentRow, AddCommentControl }, functions: {} }`. It need **not** spread `standardCatalog`
  (the Jira surfaces use only Jira component types). The developer MAY include a couple of generic
  passthroughs (`Column`/`Text`) if the builder emits them, but the contract's six types are the
  surface vocabulary.

### 1.2 Two panels, two different catalogs — confirmed clean

Because the catalog is a **prop on each provider** (not a global), the Generated-UI panel keeps
`<A2UIProvider>` (defaults to `standardCatalog`) and the Jira panel mounts
`<A2UIProvider catalog={jiraCatalog}>`. They are independent React subtrees with independent
`ComponentsMapContext`/`SurfaceContext`. This is exactly what FR-004's "each panel hosts its OWN
`A2UIProvider` with its OWN catalog" requires — **no SDK limitation blocks it.** (The two panels
disambiguate *which* surface to render via the cosmos `target` field on `ui:render`, not via the
SDK; the SDK simply renders whatever `surfaceUpdate` each panel feeds its own provider.)

### 1.3 How a component receives its props/data

`ComponentRenderer` strips `{ component, id }` and spreads the **rest of the node** plus
`{ surfaceId, componentId }` into the component (`ButtonComponent.js` etc. show the shape). So a
Jira component is written as
`function TicketCard({ surfaceId, componentId, issue /* + whatever the builder put on the node */ }) {…}`.
Two data styles are available, both used by the standard catalog:

- **Static props** — the builder/agent puts a plain value on the node (e.g.
  `{ component: 'StatusBadge', statusName: 'In Progress', statusCategory: 'in_progress' }`) and the
  component reads it directly. **Recommended for the display components** (StatusBadge, TicketCard,
  IssueList, CommentList/Row) — the data comes from `src/shared/jira.ts` shapes the builder already
  has, so there is no need for the data-model indirection.
- **Path bindings** — for *input* values that must round-trip through the surface data model, the
  component uses `useFormBinding(surfaceId, valueBinding, default)` → `[value, setValue]` (see
  `TextFieldComponent`/`ChoicePickerComponent`). **Required for the two inputs**: the
  TransitionPicker's selected `transitionId` and the AddCommentControl's `body` both live in the
  surface data model so their value is readable at action-dispatch time (§4.3/§4.6).

### 1.4 How a component emits a `jira.*` bound action

Interactive components call **`const dispatch = useDispatchAction(); dispatch(surfaceId,
componentId, action)`** where `action = { name: 'jira.transition' | 'jira.comment', context: {…} }`.
`context` values may be **literals** or **path bindings** (`{ path: '/transitionId' }`); the SDK
resolves bindings against the surface data model before handing the action up. The action surfaces
to the panel's `onAction` exactly as today (`GeneratedUiPanel.SurfaceBridge.handleAction`), which
maps SDK `action.name → actionId` and `action.context → values`, then posts `ui:action`. So the
six components reuse the **identical** renderer→main action path v1 already proved; main's `jira.*`
dispatcher is untouched (FR-008/FR-009).

### 1.5 Unknown / malformed components degrade safely

If a surface names a type not in the catalog, `ComponentRenderer` renders `UnknownComponent`
(warns, no throw); a render-time throw is caught by the panel's existing `SurfaceErrorBoundary`
(SC-005). So the panel never white-screens on a bad agent surface — the v2 components inherit that
safety for free (mirrors the standard-catalog fallback, spec Edge Cases).

**Conclusion: BUILDABLE, no blocker, no new npm dependency for the SDK.** The only system extension
this design needs is one shadcn primitive cosmos doesn't yet have (a `Select` for TransitionPicker —
§6); everything else uses existing tokens + primitives.

---

## 2. Design language carried from the native panel (the parity baseline)

The custom catalog must read as the **same product** as `JiraPanel.tsx`. The reusable visual facts
to match (all already in the native panel):

| Element | Native-panel treatment to reuse |
|---|---|
| **Status** | `StatusBadge` = shadcn `Badge` with the `--status-*` class set (§3); `unknown` → `Badge variant="outline"`. **This is the v2 win** — reuse verbatim. |
| **Issue key** | `Badge variant="secondary"` `font-mono text-[10px]` chip. |
| **Person** | `Avatar size="sm"` + initials (`initials()`), muted name; "Unassigned" with a `User` glyph when absent (`PersonInline`). |
| **Summary** | `text-sm text-foreground`, single-line `truncate` in lists, `leading-snug` in detail. |
| **Comment** | avatar + `font-medium` author + muted `formatTs(created)` + `whitespace-pre-wrap break-words text-sm` body (`CommentRow`). |
| **Section label** | `text-xs font-medium text-muted-foreground` (e.g. "Description", "Comments"). |
| **Surface chrome** | panel body `bg-card`/`text-card-foreground`, dividers `border-border/60`, rows `px-3 py-2`. |
| **Time** | reuse `formatTs()` from `atlassianPanelBits` (resolves v1 design OQ3). |

The custom-catalog components are essentially the native panel's row/detail building blocks,
**lifted into A2UI components** so the builder and the agent compose them. Where the native panel
already has the exact treatment (StatusBadge, CommentRow, PersonInline, IssueList rows), the
designer's instruction to the developer is **"reuse that treatment"** rather than re-invent it.

---

## 3. Component: `StatusBadge`  (the v2 color win)

**Input** `{ statusName: string; statusCategory: JiraStatusCategory }`. **Display only**, no action.

**Layout** — a single shadcn `Badge`, `shrink-0`, exactly the native panel's mapping:

```
todo         → Badge variant="secondary"  bg-status-todo     text-status-todo-foreground     border-transparent
in_progress  → Badge variant="secondary"  bg-status-progress text-status-progress-foreground border-transparent
done         → Badge variant="secondary"  bg-status-done     text-status-done-foreground     border-transparent
unknown      → Badge variant="outline"    (no status tint; border-border text-foreground)
```

The badge **text is always `statusName`** (e.g. "In Progress") — color is reinforcement only, never
the sole carrier (the `src/shared/jira.ts` a11y rule). Reuse the native panel's `STATUS_CATEGORY_CLASS`
map verbatim — same tokens, same `unknown` fallback.

**States**

- **Loading** — the badge is never independently loading; it appears only when its host
  (TicketCard / detail) has data. A skeleton placeholder is the host's job (§7 IssueList loading),
  shaped as `Skeleton h-5 w-16 rounded-full` to match the badge footprint.
- **Empty** — N/A (a status is always a `{statusName, statusCategory}`; a missing/odd category maps
  to `unknown` → outline, never blank).
- **Populated** — above.
- **Error** — N/A (display only; a bad category degrades to `unknown`, never throws).
- **Disabled** — N/A (non-interactive).

---

## 4. Component: `TicketCard`

**Input** `JiraIssueSummary` (`{ key, summary, statusName, statusCategory, assignee? }`). **Display
only** — opening a ticket is a fresh utterance (the contract emits **no** action from a card, same
as v1).

**Layout** — a shadcn `Card` (compact: override the default `py-6`/`gap-6` to `p-3 gap-2`) so a
list of cards is dense like the native issue rows but boxed:

```
Card  (bg-card border rounded-xl p-3, flex-col gap-2; hover:bg-accent/40 for affordance)
├─ Row  (flex items-center justify-between gap-2)
│   ├─ Badge variant="secondary" font-mono text-[10px]   "PROJ-123"     ← key chip
│   └─ <StatusBadge statusName statusCategory />                          ← right-aligned (§3)
├─ p  text-sm text-foreground leading-snug line-clamp-2   "Summary…"      ← summary (2-line clamp)
└─ Row  (flex items-center gap-1.5  text-xs text-muted-foreground)
    └─ <PersonInline assignee />  (Avatar sm + name, or User glyph + "Unassigned")
```

Rationale: this is the native `IssueList` row re-expressed as a self-contained card (the native list
uses a flat `Button` row; in the generative surface each issue is a `Card` so a vertical list reads
as discrete tickets and a detail surface can embed one card as its header). Key left / status right
is the native scan pattern.

**States**

- **Loading** — host-driven (§7). A single skeleton card = `Card p-3 gap-2` containing
  `Skeleton h-4 w-14` + `Skeleton h-4 w-16 rounded-full` (key+badge row), `Skeleton h-4 w-3/4`
  (summary), `Skeleton h-4 w-24` (assignee). Reuse the native `IssueRowSkeletons` rhythm.
- **Empty** — N/A for a single card; an empty *list* is IssueList's empty state (§5/§7).
- **Populated** — above. Missing `assignee` → "Unassigned" slot (never blank). Missing/blank
  summary → `text-muted-foreground "(no summary)"` so the card never collapses.
- **Error** — N/A (display); a malformed node degrades via the panel error boundary (§1.5).
- **Disabled** — N/A (no interactive control; the card is not a button in v2, matching the contract).

---

## 5. Component: `IssueList`

**Input** `JiraIssueSummary[]` (a container of `TicketCard`s). **Display only**, no action.

**Layout**

```
Column  (flex-col gap-2)
├─ p  text-xs text-muted-foreground   "12 issues"        ← count header (aria-live="polite")
└─ (per issue)  <TicketCard issue={…} />                  ← §4, gap-2 between cards
```

The count line reuses the native list's `{n} issue/issues` header. No "Load more" / pagination in
the generative surface — the default view is a single bounded page (FR-020) and an utterance-driven
list is whatever the agent composed; pagination stays out of scope (matches v1).

**States**

- **Loading** — render **3–5 skeleton TicketCards** (§4 loading) under a `Skeleton h-3 w-16` count
  placeholder; `aria-busy="true"` on the container. (This is the per-switch default-view loading
  body, §7.)
- **Empty** (`items.length === 0`) — a calm single line, no card outlines:
  `Column items-center py-8 gap-2`: `SquareKanban size-7 text-muted-foreground` (or no glyph) +
  `p text-sm text-muted-foreground "No issues found."` (utterance lists may read "No issues match
  this request."). Not alarming.
- **Populated** — above.
- **Error** — the *list* itself doesn't render an error; a failed read is the **panel host's** error
  state (§7), shown in place of the list. (The builder, if it composes an error surface, uses the
  §7 notice block.)
- **Disabled** — N/A.

---

## 6. Component: `TransitionPicker`  (emits `jira.transition`)

**Input** `{ issueKey: string; availableTransitions: JiraTransition[] }`. **Emits**
`jira.transition` with context `{ issueKey, transitionId }`.

**Layout** — a labeled dropdown + an explicit **Apply** button (a transition is a real mutation;
never auto-fire on select — same rule as v1 §3.4):

```
Column  (flex-col gap-2)
├─ span  text-xs font-medium text-muted-foreground   "Move to"            ← section label
└─ Row   (flex items-center gap-2)
    ├─ Select  (value bound to /transitionId via useFormBinding; flex-1)
    │     trigger: "Select a transition"   items: availableTransitions.map(t => ({value:t.id, label:t.name}))
    └─ Button  variant="default" size="sm"   "Apply"
          onClick → dispatch(surfaceId, componentId,
            { name: 'jira.transition', context: { issueKey, transitionId: { path: '/transitionId' } } })
```

- Use shadcn **`Select`** (Radix) for the dropdown — themed, keyboard + arrow-key navigation,
  focus ring (`--ring`) for free. The selected value lives in the surface data model
  (`useFormBinding`) so `{ path: '/transitionId' }` resolves at dispatch (§1.4). Each option label
  is `JiraTransition.name` (e.g. "Start Progress", "Done"); value is `JiraTransition.id`.
- **Apply** is `Button variant="default" size="sm"` (the cosmos filled-primary action, matching the
  Generated-UI composer's Send button), **disabled until a transition is selected**.

**States**

- **Loading** — N/A as a standalone (it appears inside a populated detail surface; the detail
  surface's load is the host §7 loading state).
- **Empty** (`availableTransitions.length === 0`) — **omit the control**; render
  `p text-sm text-muted-foreground "No transitions available."` in its place (so a missing control
  is never silent — same as v1 §3.4).
- **Populated** — above.
- **Error** — the picker doesn't render write errors itself; the post-write **notice** (§7) re-pushed
  by the dispatcher carries success/failure. A stale `transitionId` is a main-side write failure →
  error notice, never a crash (FR-017).
- **Disabled** — **Apply is `disabled` (shadcn `disabled:opacity-50 pointer-events-none`) until a
  transition is selected** (belt-and-braces with main's validation). While a write is dispatching,
  the surface is re-pushed fresh by the dispatcher (new `requestId`), so there is no in-component
  spinner; the dispatch is single-shot per surface (the panel's `submittedRef`, reused).

---

## 7. Components: `CommentRow` / `CommentList`

**Input** `JiraComment[]` (CommentList); one `JiraComment` (CommentRow). **Display only**.

**`CommentRow` layout** — reuse the native `JiraPanel.CommentRow` verbatim:

```
Row  (flex gap-2.5  px-3 py-2  border-b border-border/60 last:border-b-0)
├─ Avatar size="sm" mt-0.5  → AvatarFallback initials(author)
└─ Column  (min-w-0 flex-1)
    ├─ Row  (flex items-baseline gap-2)
    │    ├─ span  truncate text-sm font-medium text-foreground   author.displayName ?? accountId ?? "Unknown"
    │    └─ span  shrink-0 text-xs text-muted-foreground          formatTs(created)   ← only if created
    └─ p   whitespace-pre-wrap break-words text-sm text-card-foreground   body
```

**`CommentList` layout** — a section with a label + the rows:

```
Column  (flex-col gap-1.5)
├─ span  text-xs font-medium text-muted-foreground   "Comments (3)"      ← count in the label
└─ (per comment)  <CommentRow comment={…} />                              ← flat list, divider rows
```

**States**

- **Loading** — host-driven (the detail surface §8 loading shows 1–2 comment skeletons:
  `Avatar skeleton size-6` + two `Skeleton h-3` lines, the native `IssueDetailSkeleton` rhythm).
- **Empty** (`comments.length === 0`) — `p text-sm text-muted-foreground "No comments."` under the
  "Comments (0)" label (native panel wording).
- **Populated** — above.
- **Error** — N/A (display); degrades via the panel error boundary.
- **Disabled** — N/A.

---

## 8. Component: `AddCommentControl`  (emits `jira.comment`)

**Input** `{ issueKey: string }`. **Emits** `jira.comment` with context `{ issueKey, body }`.

**Layout**

```
Column  (flex-col gap-2)
├─ Label  htmlFor   text-xs font-medium text-muted-foreground   "Add a comment"
├─ Textarea  (shadcn, min-h-[80px] max-h-[12rem] resize-none;   value bound to /commentBody via useFormBinding)
└─ Row  (flex justify-end)
    └─ Button  variant="default" size="sm"   "Comment"
          disabled until /commentBody is non-empty/non-whitespace
          onClick → dispatch(surfaceId, componentId,
            { name: 'jira.comment', context: { issueKey, body: { path: '/commentBody' } } })
```

- Reuse the cosmos shadcn **`Textarea`** (same primitive the Generated-UI composer and v1's
  TextField use) — themed, `--ring` focus. The body lives in the surface data model
  (`useFormBinding`) so `{ path: '/commentBody' }` resolves at dispatch.
- **Empty/whitespace guard (FR contract):** the **Comment** button is `disabled` until
  `/commentBody` trimmed is non-empty (mirrors main's `validateJiraComment` whitespace rejection —
  belt-and-braces; main stays the authority).

**States**

- **Loading** — N/A standalone (host §9 loading covers the detail surface).
- **Empty** — the input's resting state: placeholder-empty Textarea, **Comment disabled**.
- **Populated** — user has typed a non-empty body → **Comment enabled** (filled primary).
- **Error** — a failed comment write is surfaced by the post-write **notice** (§9) re-pushed by the
  dispatcher; the input stays usable. Never a crash/leak (FR-017).
- **Disabled** — Comment `disabled` (empty body) → shadcn `opacity-50 pointer-events-none`. Under
  `write_not_authorized` the whole capability is unavailable → the §9 reconnect notice (the
  disabled-equivalent for writes).

---

## 9. Jira panel host layout (the screen the components live in)

The Jira panel (`src/renderer/JiraPanel.tsx`) keeps its **outer chrome unchanged**: the
`bg-card`/`border-l` section, the title bar ("Jira"), and the `ConnectionBar`. What changes is the
**connected body**: instead of the JQL search + native browser, the body becomes an **A2UI host**
(its own `<A2UIProvider catalog={jiraCatalog}>` + a `SurfaceBridge` filtering `ui:render` to
`target: 'jira'`) plus an in-panel **prompt composer**, mirroring `GeneratedUiPanel`'s structure.

### 9.1 Structure (connected)

```
section "Jira"  (flex h-full flex-col bg-card border-l)
├─ title bar          "Jira"   (unchanged: border-b bg-popover px-3 py-2)
├─ <ConnectionBar/>   (unchanged: site · account · Disconnect)
├─ body  (min-h-0 flex-1 overflow-auto p-3 text-card-foreground)   ← the A2UI surface renders here
│     <A2UIProvider catalog={jiraCatalog}>
│       <SurfaceBridge target="jira" … />     ← renders the default / utterance / post-write surface
│     </A2UIProvider>
│     (loading / error / reconnect overlays per §9.3, layered above/around the surface)
└─ <PromptComposer/>  (bottom-docked, mirrors GeneratedUiPanel §1 composer — §9.2)
```

The body is a single scroll container (`overflow-auto`, like `GeneratedUiPanel`), so long lists /
comment threads scroll the panel; the surface does not own scrolling. Panels stay **force-mounted**
on rail switch (App shell), so a post-write re-push lands even if the user is elsewhere (spec Edge
Cases).

### 9.2 In-panel prompt composer (utterance entry)

**Reuse `GeneratedUiPanel`'s `PromptComposer` styling verbatim** — it is already the cosmos composer
language and must read identically in both panels:

```
form  (shrink-0 border-t border-border bg-popover px-3 py-3)
├─ Textarea  (max-h-[9rem] min-h-[2.5rem] resize-none)   placeholder "Ask about your Jira issues…"
├─ [run error]  mt-2 rounded-md border border-destructive/40 bg-destructive/15 text-destructive  (role=alert)
└─ Row  (mt-2 flex items-center justify-between)
    ├─ status  text-[11px] text-muted-foreground (role=status aria-live=polite):
    │     running → Loader2 spin + "Generating…"   |   idle → "Enter to send · Shift+Enter for newline"
    └─ Button variant="default" size="sm"  "Send" / spinner "Generating…"   (disabled when empty or running)
```

The only difference from the generic composer: the placeholder is Jira-flavored ("Ask about your
Jira issues…", e.g. "show my open bugs", "open PROJ-123") and the submit threads `target: 'jira'`.
Enter submits, Shift+Enter newlines, empty/whitespace starts no run (FR-003) — identical guards.

### 9.3 Host states (default / loading / empty / error / reconnect / populated / post-write)

This is where every spec state for the panel host lives. The **composer is always present**; these
states govern the **body** above it.

- **Not connected** (`status.state !== 'connected'`) — **unchanged from today**: center the
  `SquareKanban` glyph + the `ConnectForm` (Connect Jira CTA). **No A2UI host, no composer, no
  per-switch read** (FR-016, FR-002). This is the existing native affordance — keep it exactly.

- **Default-view loading** (per rail switch, while the recent-issues read is in flight, FR-019) —
  the body shows the **IssueList loading state** (§5: count skeleton + 3–5 skeleton TicketCards,
  `aria-busy`). A prior surface MAY remain visible beneath until the fresh surface arrives (the spec
  permits this); simplest correct treatment is to replace the body with the skeleton list and clear
  it when the `target: 'jira'` surface renders. A subtle top affordance (a thin `Loader2` in the
  title bar or a `text-[11px] text-muted-foreground "Refreshing…"` line) MAY signal the refresh when
  a prior surface is kept — optional, not required.

- **Default-view populated** — main's `buildDefaultViewSurface` pushes an **IssueList of TicketCards**
  (recent issues), `target: 'jira'`, jira catalog. This is the resting connected state on every
  switch; it persists until an utterance re-composes the body (it is NOT cleared to an idle prompt,
  FR-002).

- **Empty default view** (recent-issues read returns 0) — IssueList empty state (§5): calm
  "No issues found." line, composer still present.

- **Default-view / utterance error** (rate-limited / network, FR-019/FR-020) — replace the body with
  a **recoverable error block** (reuse `atlassianPanelBits.ErrorState`: destructive-tinted `Alert` +
  a **Retry** button; `rate_limited` shows "Jira is busy — retrying shortly." and disables Retry for
  the Retry-After window). Retry re-issues the bounded `jira:requestDefaultView` (or re-submits the
  utterance). **Never** a crash/hang/stack trace; the rail switch itself always succeeds (only the
  body content is affected, FR-020).

- **Reconnect-needed** (`reconnect_needed` from the read/write) — render
  `atlassianPanelBits.ReconnectState` (destructive `Alert` + **Reconnect** button) which routes to
  the existing native Connect/Reconnect flow (`refreshStatus` / the `ConnectionBar`). **No second
  OAuth entry point on the A2UI surface** (FR-016). This is the read-path analog of the §9 write
  `write_not_authorized` notice.

- **Utterance in-progress** — driven by `agent:status` exactly like the generic composer: the
  composer shows "Generating…", the prior surface MAY stay visible, and a submit while a run is in
  flight is ignored (single-run guard, FR-013). An empty/whitespace utterance starts no run.

- **Utterance-composed populated** — the agent's `render_jira_ui` surface renders in the body
  (jira catalog, `target: 'jira'`): a filtered IssueList, or a **ticket-detail surface** (§9.4).

- **Post-write update** (FR-009) — after a `jira.transition`/`jira.comment` dispatch, main re-reads
  the issue and re-pushes the ticket-detail surface with a **notice prepended** (§9.5). v2 can now
  **color** this notice (unlike v1's color-less glyph+text).

### 9.4 Utterance-composed ticket-detail surface (composition)

The detail surface is composed by `buildIssueDetailSurface` (and re-pushed post-write) from
`JiraIssueDetail`, in this child order (the logical task order; reuse the native detail's section
rhythm):

```
Column  (surface root, flex-col gap-4)
├─ [post-write notice]               ← §9.5, only on a re-push; first child
├─ <TicketCard issue={summaryOfDetail} />   ← header: key + StatusBadge + summary + assignee (§4)
├─ (people)  Row  Assignee / Reporter via PersonInline   (native detail "People block")
├─ (description)  Column gap-1.5:  label "Description" + body (or muted "No description.")
├─ <TransitionPicker issueKey availableTransitions />   ← §6 (or "No transitions available.")
├─ <CommentList comments />                              ← §7
└─ <AddCommentControl issueKey />                        ← §8
```

Reading/focus order follows this child order (key → status → summary → people → description →
transition → comments → add-comment), which is also the task order. Dividers (`border-border/60`)
separate the transition / comments / add-comment sections, matching the native detail.

### 9.5 Post-write notice block (the v2 color restoration)

When `JiraActionDispatcher` re-pushes the detail surface, prepend a notice as the **first child**.
**v2 uses color** (the catalog component is a plain cosmos component — no standard-catalog
constraint). Render it as a shadcn `Alert` variant by outcome:

```
success            → Alert (success tint)   Check glyph    e.g. "Moved to Done." / "Comment added."
error              → Alert variant=destructive (bg-destructive/15 border-destructive/40)  AlertTriangle  e.g. "Couldn't apply that transition — it may no longer be available. The ticket is unchanged."
write_not_authorized → Alert variant=destructive  Lock glyph   JIRA_WRITE_NOT_AUTHORIZED_MESSAGE
                       (points to native Connect/Reconnect — no OAuth button on the surface)
```

- **success** uses a **positive tint** — reuse the `--status-done` token family for the success
  Alert (`bg-status-done/…` background, `text-status-done-foreground`) so success reads green like
  the "Done" badge, OR a neutral `Alert` with a `Check` glyph if a dedicated success Alert variant
  is not added. **Designer preference: neutral `Alert` + `Check` glyph + the `--status-done`-tinted
  accent**, to avoid adding a brand-new "success" semantic token (reuse over new token). The surface
  below already shows the new truth (re-read detail), so the notice is a confirmation.
- **error** reuses the panel's existing tinted-destructive treatment
  (`border-destructive/40 bg-destructive/15 text-destructive`) — identical to the composer run-error
  and the native `ErrorState`, so all error channels read as one product. The ticket below is shown
  **unchanged** (FR-017).
- **write_not_authorized** = the scope-gap state: `Lock` glyph + `JIRA_WRITE_NOT_AUTHORIZED_MESSAGE`
  (from `src/shared/jira.ts`), pointing at the native Connect/Reconnect (no surface OAuth button).

This is the v1→v2 upgrade the spec calls out (SC-003): the notice is now **colored**, not glyph+text
only.

---

## 10. Tokens used

**No new theme token is required.** The custom catalog consumes tokens that already exist in
`src/renderer/index.css`:

| Token(s) | Used by |
|---|---|
| `--status-todo` / `--status-todo-foreground` | StatusBadge `todo` (§3) |
| `--status-progress` / `--status-progress-foreground` | StatusBadge `in_progress` (§3) |
| `--status-done` / `--status-done-foreground` | StatusBadge `done` (§3); success-notice accent (§9.5) |
| `--card` / `--card-foreground` | panel body, TicketCard, CommentRow |
| `--border` (`/60`) | dividers, card borders |
| `--primary` / `--primary-foreground` | Apply / Comment / Send buttons (filled) |
| `--secondary` / `--secondary-foreground` | key chip, StatusBadge base |
| `--muted-foreground` | labels, counts, captions, assignee |
| `--accent` | TicketCard hover (`hover:bg-accent/40`) |
| `--destructive` (`/15`, `/40`) | error notice, run error, ErrorState, ReconnectState |
| `--input` / `--ring` | Select / Textarea inputs, focus rings |

`JiraStatusCategory → --status-*` mapping is **identical to the native panel** (the `unknown`
category intentionally has **no** color → `Badge variant="outline"`, so a missing/odd category never
shows a wrong color). a11y: status is **never color-only** — the `statusName` text is always present
(the `src/shared/jira.ts` rule).

**Flag (NEW token, optional, NOT required):** if product later wants a distinct *success* semantic
(rather than reusing `--status-done` for the success notice), add a `--success` / `--success-foreground`
token pair. This design **does not add it** — it reuses `--status-done` / the neutral `Alert` to
stay within the existing system (tokens-first, one-offs-never). Recorded here only as the future
home for a success semantic.

---

## 11. Components used (shadcn primitives) + the one system extension

| Primitive | Source | Role |
|---|---|---|
| `Badge` | existing `components/ui/badge.tsx` | StatusBadge, key chip |
| `Card` | existing `components/ui/card.tsx` | TicketCard (compact override) |
| `Avatar` / `AvatarFallback` | existing `components/ui/avatar.tsx` | PersonInline, CommentRow |
| `Textarea` | existing `components/ui/textarea.tsx` | AddCommentControl, composer |
| `Button` | existing `components/ui/button.tsx` | Apply, Comment, Send, Retry, Reconnect |
| `Alert` / `AlertTitle` / `AlertDescription` | existing `components/ui/alert.tsx` | post-write notice, ErrorState, ReconnectState |
| `Skeleton` | existing `components/ui/skeleton.tsx` | loading states |
| `ScrollArea` | existing `components/ui/scroll-area.tsx` | (optional) detail/list scroll |
| **`Select`** | **NOT present — must be added** | **TransitionPicker dropdown (§6)** |

### System extension to hand off to the developer (designer has NO Bash)

cosmos's `src/renderer/components/ui/` has **no `select` primitive** (it has badge, avatar, card,
input, textarea, button, alert, skeleton, scroll-area, tabs, tooltip). The standard A2UI catalog's
`ChoicePicker` uses a `Select`, but that is the SDK's **own bundled** copy under
`node_modules/@a2ui-sdk/react/dist/**/components/ui/select.js`, NOT a cosmos primitive — the Jira
custom catalog lives in the cosmos renderer bundle and must use a cosmos primitive.

**Hand-off (developer / main session, since the designer has no Bash):**

- Run `npx shadcn@latest add select` to add `src/renderer/components/ui/select.tsx` (new-york,
  cosmos tokens). This pulls Radix `@radix-ui/react-select` (a peer the SDK already depends on, so
  likely already present — confirm). The TransitionPicker (§6) is designed against this `Select`.
- *(Fallback if a Select install is undesirable: TransitionPicker MAY render the transitions as a
  small vertical list of `Button variant="outline" size="sm"` choice chips with a selected state +
  an Apply button — same action, no new primitive. The `Select` dropdown is preferred for parity
  with the standard catalog's transition affordance and for long transition lists.)*

No `components.json` change. No new npm dependency beyond what `shadcn add select` pulls (Radix
select, almost certainly already installed transitively). The Jira catalog modules
(`src/renderer/jiraCatalog/`) bundle via the existing renderer import graph (no rollup change — the
rollup change in the plan is only for the MCP entry script, not the catalog).

---

## 12. Interaction & accessibility

- **Theme inheritance** gives correct dark contrast for free: foreground `--foreground` (#e0e0e0 on
  #1e1e1e), captions `--muted-foreground` (#888), status foregrounds picked to be legible on their
  tints (the native panel already proved these). **Status is never color-only** — `statusName` text
  is always present, and `unknown` has no tint at all.
- **Focus & keyboard:** the interactive components are Radix-based shadcn (`Select`, `Textarea`,
  `Button`) → focus rings (`--ring`), keyboard open/close, arrow-key option navigation, all built-in.
  Reading/focus order follows the §9.4 child order (the logical task order).
- **Submit guards (surface-side mirror of main's validation):** TransitionPicker's **Apply** is
  disabled until a transition is selected; AddCommentControl's **Comment** is disabled until the body
  is non-empty/non-whitespace. Disabled = shadcn `opacity-50 pointer-events-none`. Main remains the
  authority (FR-008 validators).
- **Single-action semantics:** the panel reuses `GeneratedUiPanel`'s `submittedRef` (one action per
  `requestId`); after a `jira.*` action fires, main re-pushes a **fresh** surface (new `requestId`)
  that remounts a fresh boundary and re-enables interaction — so a user can transition then comment
  in sequence across re-pushes (same flow v1 proved; the re-push MUST carry a fresh `requestId`).
- **Error/empty are calm, recoverable, announced:** error blocks are `role="alert"`; the composer
  status line is `role="status" aria-live="polite"`; counts are `aria-live="polite"`. No state is a
  white-screen — unknown/malformed surfaces degrade via the existing `SurfaceErrorBoundary` (§1.5).
- **a11y parity with native panel:** because the components reuse the native panel's exact treatment
  (StatusBadge, CommentRow, PersonInline), contrast and structure match what already ships.

---

## 13. Open questions

1. **Success-notice color (minor, non-blocking).** §9.5 reuses `--status-done` / a neutral `Alert`
   for the post-write **success** notice rather than introducing a `--success` semantic token. If
   product wants a dedicated success color across cosmos (not just Jira), that is a one-line token
   addition (§10) — flagged, not adopted, to stay tokens-first. **Confirm the reuse is acceptable**;
   if a `--success` token is wanted, it is an architect/system decision, not a per-surface one.

2. **`Select` install vs. choice-chip fallback (§11).** The TransitionPicker is designed against a
   shadcn `Select` the cosmos UI set doesn't yet have; the developer must `shadcn add select`. If
   that install is undesirable, the §11 fallback (outline choice chips + Apply) ships the same action
   with no new primitive. **Confirm which the developer prefers** (designer recommends `Select` for
   parity + long lists).

3. **Default-view "keep prior surface visible during refresh" (FR-019/§9.3).** The spec *permits*
   keeping the prior surface beneath the loading affordance OR replacing it with a skeleton list.
   This design specifies the simple, correct treatment (replace with skeleton list, clear on render)
   and makes the "keep-prior + subtle refresh affordance" optional. **No blocker** — flagged so the
   developer knows both are spec-compliant; pick one for consistency (designer leans: replace with
   skeleton on first switch, keep-prior on subsequent refreshes if it reads better in the running app).

4. **Compact `Card` override.** TicketCard overrides the shadcn `Card` default `py-6 gap-6` to
   `p-3 gap-2` for list density (§4). This is a per-instance className override, not a new Card
   variant. If many surfaces want a compact card, a `Card` size variant would be the systematic home
   — out of scope here (one consumer), flagged for future consolidation.
