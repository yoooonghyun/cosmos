# Design: Atlassian (Jira + Confluence) Integration (read-only) — v1

**Status**: Draft
**Created**: 2026-06-03
**Spec**: .sdd/specs/atlassian-integration-v1.md
**Plan**: .sdd/plans/atlassian-integration-v1.md
**Design system**: Tailwind v4 + shadcn/ui (new-york), dark-first cosmos palette (`src/renderer/index.css`)
**Reference design**: .sdd/designs/slack-integration-v1.md (this is its sibling — match it)

---

## 0. Design intent

The **Jira** and **Confluence** panels must read as the **same product** as the Terminal,
Generated-UI, and Slack panels beside them — not as "embedded Jira" or "embedded
Confluence." They are deliberately built as **visual siblings of `SlackPanel.tsx`**: same
panel shell, same tab-strip header, same always-present `ConnectionBar`, the same
single-button browser-OAuth Connect call-to-action (**no token inputs anywhere**), the same
five-state discipline (loading / empty-idle / populated / error / disabled+reconnect), the
same `ScrollArea` list idiom, and the same `MessageRow`-style row for comments. cosmos's dark
VS Code palette flows through theme tokens only — **no Atlassian-brand blue**, no raw hex.

**Reuse, don't reinvent.** Every sub-view in these panels maps 1:1 to an existing Slack
sub-view (`ConnectionBar`, `ConnectForm`, `ErrorState`, `ReconnectState`, `EmptyLine`, the
skeleton helpers, `MessageRow`, the back-stack header). The developer should lift those shapes
verbatim and re-skin only the fields. The **one** genuine system growth this feature needs is a
**Jira status-category color mapping** (§3.1) — Jira statuses carry a To-Do / In-Progress /
Done semantic that the current Badge variants (which have no "success/green") cannot express.
Everything else is existing tokens + existing components.

This spec is intentionally explicit so the developer builds against a settled visual contract.

---

## 1. App shell placement — two more rail icons

The Slack design (§1 there) established the left **VS Code activity-bar rail** that switches
the right column's surface. Jira and Confluence are simply **two more rail icons**, exactly
like the Slack icon — no new shell mechanics.

- `src/renderer/App.tsx` already drives the rail from a `RAIL_ITEMS` array and renders each
  surface in a `forceMount` `TabsContent`. The developer extends `SurfaceId` to
  `'generated-ui' | 'slack' | 'jira' | 'confluence'`, appends two `RAIL_ITEMS` entries, and
  adds two `TabsContent` panels mounting `<JiraPanel />` and `<ConfluencePanel />`.
- **Rail icons** (lucide, cosmos-neutral — NOT the vendor glyphs, to stay on-brand):
  - **Jira** → lucide **`SquareKanban`** (board/issue semantic; neutral). `aria-label="Jira"`.
  - **Confluence** → lucide **`BookText`** (docs/pages semantic; neutral). `aria-label="Confluence"`.
  - Both inherit the rail's existing active/inactive treatment verbatim: inactive
    `text-muted-foreground hover:text-foreground`; active `text-foreground` + the 2px
    `--primary` left indicator bar; tooltip (`TooltipContent side="right"`) with the surface name.
- Update the header subtitle string in `App.tsx`
  (`Terminal Panel · Generated UI · Slack · Claude Code`) to include Jira and Confluence —
  cosmetic, developer's call on exact wording.

No layout, spacing, or width changes to the shell. The right column keeps the existing
`app__ui` sizing; each panel fills it exactly like `SlackPanel`.

---

## 2. Panel anatomy (shared by both panels)

Both panels are the **same shell** as `SlackPanel` — copy its outer structure exactly:

```
<section class="flex h-full min-w-0 flex-col border-l border-border bg-card" aria-label="Jira"|"Confluence">
  ├─ Tab-strip header        (bg-popover, border-b, muted semibold label: "Jira" / "Confluence")
  ├─ ConnectionBar           (always present; bg-popover, border-b — §2.1)
  └─ Content region          (min-h-0 flex-1)
       ├─ NOT connected →  centered Connect call-to-action  (§2.2)
       └─ connected     →  Search bar (§2.3) + optional back header + list/detail (§2.4–2.6)
```

### 2.1 Tab-strip header

Identical to Slack's:

```
<div class="flex select-none items-center border-b border-border bg-popover px-3 py-2">
  <span class="text-xs font-semibold tracking-wide text-muted-foreground">Jira</span>  // or "Confluence"
</div>
```

- Tokens: `bg-popover`, `border-border`, `text-muted-foreground`. Type: `text-xs font-semibold tracking-wide`.

### 2.2 ConnectionBar (always present)

Same component shape as Slack's `ConnectionBar`, re-skinned for the Atlassian state machine.
Container: `flex items-center justify-between border-b border-border bg-popover px-3 py-2`.

| State | Left content | Right control |
|-------|--------------|---------------|
| `not_connected` | `text-xs text-muted-foreground` → "Not connected" | — |
| `connecting` | `Loader2 size-3.5 animate-spin` + "Connecting…" (`text-xs text-muted-foreground`) | `Button variant="ghost" size="sm"` → "Cancel" |
| `connected` | **site/account identity**, `truncate text-sm font-medium text-foreground` (see note) | `Button variant="ghost" size="sm"` → "Disconnect" |
| `reconnect_needed` | `Badge variant="outline"` with `className="border-destructive/40 text-destructive"` → "Reconnect needed" | — |

- **Identity shown when connected** (FR-A07, FR-A12): the Atlassian **site name** is the
  primary label (e.g. `acme.atlassian.net`); if an account display name is also present, render
  it muted after the site: `<site> · <account>` with the account in `text-muted-foreground`.
  Falls back to "Connected" when neither is present (mirrors Slack's `workspaceName ?? 'Connected'`).
  These come from the status object (`siteName` / `accountName` style fields on
  `JiraConnectionStatus` / `ConfluenceConnectionStatus`) — **never** a token.

### 2.3 Search bar (connected only)

A single search `Input` in a bordered strip — same idiom as Slack's search field, but here it
is the **primary** content control (there is no channel list to fall back to; an empty query
shows the idle prompt §2.4-empty).

```
<div class="border-b border-border p-2">
  <form onSubmit={submit} class="relative">
    <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input class="h-8 pl-8 text-sm" .../>
  </form>
</div>
```

- **Jira**: `Input` `placeholder="Search issues by JQL (e.g. assignee = currentUser())"`,
  `aria-label="Search Jira issues by JQL"`. Submitting a non-empty trimmed query runs the search.
- **Confluence**: `Input` `placeholder="Search Confluence"`, `aria-label="Search Confluence content"`.
- Tokens: `border-border`, `Search` icon `text-muted-foreground`, `Input` uses its own
  `border-input` / `bg-input/30` defaults. Lucide icon: `Search` (same as Slack).
- The search bar is **hidden in the detail view** (issue/page), where the back header (§2.5)
  takes its place — matching Slack's behavior (Slack hides search only structurally; here the
  detail view replaces the list, search returns when you go back). Keep the search bar mounted
  for the list view; render the back header above the detail.

### 2.4 Content states overview (every surface, FR-J05 / FR-C05)

Both panels reuse Slack's exact state primitives — **lift these verbatim**:

- **Loading** → skeleton rows (`Skeleton`), shaped to the surface (§4.x per panel). `aria-busy="true"`.
- **Empty / idle** → `EmptyLine` (`px-3 py-6 text-center text-sm text-muted-foreground`). Two
  flavors: **idle** (no query yet — the panel performs no read, FR-J03/FR-C03 + scenario) and
  **empty** (query ran, zero results).
- **Populated** → `ScrollArea` list (§2.6) or detail view (§2.5).
- **Error** → `ErrorState`: destructive-tinted `Alert variant="destructive"`
  (`border-destructive/40 bg-destructive/15`) + a `Button variant="secondary" size="sm"` Retry.
  `rate_limited` shows "busy, retry shortly" copy and disables Retry for the `Retry-After`
  cooldown (copy: "Jira is busy" / "Confluence is busy"). Lift Slack's `ErrorState` whole.
- **Disabled / reconnect_needed** → `ReconnectState`: destructive `Alert` ("Reconnect needed" /
  "Your Jira connection expired. Reconnect to continue.") + a `Button variant="default" size="sm"`
  Reconnect. Lift Slack's `ReconnectState` whole. (This is the integration-specific "disabled"
  state — the connection is unusable until re-auth; all read affordances yield to this banner.)

### 2.5 Detail back-header (issue / page drill-in)

Identical to Slack's thread back-header:

```
<div class="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
  <Button variant="ghost" size="icon-sm" aria-label="Back"><ChevronLeft class="size-4" /></Button>
  <span class="truncate text-sm font-medium text-foreground">{title}</span>
</div>
```

- Title text: **Jira** → the issue key (e.g. `PROJ-123`); **Confluence** → the page title (truncated).
- Lucide icon: `ChevronLeft`. Back returns to the list view (preserving the last query/results
  in component state so the user lands back on their results, mirroring Slack's back-stack).

### 2.6 List row idiom

Lists live in a `ScrollArea className="h-full"` wrapping a `flex flex-col`, with a bottom
**"Load more"** affordance when a cursor remains — exactly Slack's `MessageList`/`ChannelList`
pattern (cursor-based, `nextCursor`):

```
<Button variant="ghost" size="sm" class="m-2 justify-center gap-1.5 text-muted-foreground"
        disabled={loadingMore} onClick={loadMore}>
  {loadingMore ? <><Loader2 class="size-3.5 animate-spin"/> Loading…</> : 'Load more'}
</Button>
```

Row dividers: `border-b border-border/60 ... last:border-b-0` (Slack's `MessageRow` divider).

---

## 3. Design-system growth (flag for developer)

### 3.1 NEW — Jira status-category tokens (ADDITION, required)

**Problem.** A Jira issue's status belongs to one of three **status categories** that Jira's own
UI color-codes: **To Do** (neutral/gray), **In Progress** (blue), **Done** (green). The current
theme has `--primary` (blue) and `--secondary`/`--muted` (gray) but **no success/green token** —
so the existing Badge variants (`default`, `secondary`, `destructive`, `outline`, `ghost`,
`link`) cannot express "Done = green" without a one-off hex, which the design rules forbid.

**Decision.** Add a small, named **status-category color set** to the cosmos dark palette as
theme tokens (single source of truth), and drive the Jira status `Badge` from the issue's
`statusCategory` (`'todo' | 'in_progress' | 'done' | 'unknown'`), not from the raw status name.
This keeps the mapping in tokens, scales to any localized status name, and stays on the dark
palette. (Confluence has no equivalent status, so it needs none of this.)

**Tokens to ADD** to `src/renderer/index.css` — in the `@theme inline` block (so Tailwind emits
the utilities) and the `.dark` block (cosmos values), plus a light fallback in `:root`. These
are chosen to sit on the `#1e1e1e`-family dark background with adequate contrast and to harmonize
with the existing `--primary #4a9eff`:

`@theme inline` additions:
```
--color-status-todo: var(--status-todo);
--color-status-todo-foreground: var(--status-todo-foreground);
--color-status-progress: var(--status-progress);
--color-status-progress-foreground: var(--status-progress-foreground);
--color-status-done: var(--status-done);
--color-status-done-foreground: var(--status-done-foreground);
```

`.dark` additions (cosmos values):
```
--status-todo: #3a3a3c;            /* = --secondary; neutral chip */
--status-todo-foreground: #dddddd; /* = --secondary-foreground   */
--status-progress: #1e3a5f;        /* muted blue, darker sibling of --primary */
--status-progress-foreground: #9dc7ff;
--status-done: #1f3d2b;            /* muted green */
--status-done-foreground: #7fd6a0;
```

`:root` (light fallback) additions:
```
--status-todo: #f4f4f5;            /* = light --secondary */
--status-todo-foreground: #1e1e1e;
--status-progress: #e0edff;
--status-progress-foreground: #1e497a;
--status-done: #dcf5e6;
--status-done-foreground: #1d6b3f;
```

**Usage** — the Jira status Badge renders as `Badge variant="secondary"` with the category color
applied via the new tokens, e.g. a tiny mapping the developer keeps next to the panel:
```
statusCategory → className
  'done'        → 'bg-status-done text-status-done-foreground border-transparent'
  'in_progress' → 'bg-status-progress text-status-progress-foreground border-transparent'
  'todo'        → 'bg-status-todo text-status-todo-foreground border-transparent'
  'unknown'     → (Badge variant="outline", no extra class)
```
Because they are theme tokens, this is **not** a one-off hex — it is the same kind of
token consumption as `bg-primary`. `unknown` (no category from the API) falls back to the plain
`outline` Badge so a missing/odd category never crashes or shows a bad color.

> **Designer note / acceptable alternative:** if the developer prefers to add a Badge **variant**
> instead of utility classes, the same tokens back a `success`/`progress`/`neutral-status`
> variant in `badge.tsx`. Either is fine; the tokens are the contract. Do **not** inline hex.

**This is the ONLY token/system addition in this feature.** No new shadcn primitive is required.

### 3.2 Components — all EXISTING, no installs required

Every primitive these panels need already exists under `src/renderer/components/ui/` (they were
installed for Slack). **No `npx shadcn@latest add …` is required for this feature.**

| Component | Used for | Variants / sizes |
|-----------|----------|------------------|
| `Button` | Connect / Disconnect / Cancel / Back / Retry / Reconnect / Load more / row-as-button | `variant`: `default` (Connect, Reconnect), `secondary` (Retry), `ghost` (Disconnect, Cancel, Back, Load more, list rows); `size`: `sm`, `icon-sm` (Back) |
| `Input` | Search / JQL field | default; `className="h-8 pl-8 text-sm"` |
| `Badge` | Jira status (with §3.1 tokens), Jira issue-type/key chip, reconnect-needed pill, Confluence space chip | `variant`: `secondary` (status base, key chip), `outline` (space chip, unknown status, reconnect pill) |
| `Avatar` + `AvatarFallback` | Jira assignee/reporter, comment author | `size="sm"`; `AvatarFallback` initials only (NO remote images — matches Slack §0) |
| `Alert` + `AlertTitle` + `AlertDescription` | error / reconnect / connect-failed banners | `variant="destructive"` with `border-destructive/40 bg-destructive/15` |
| `Skeleton` | loading rows (list + detail) | shaped per surface (§4 / §5) |
| `ScrollArea` | every scrollable list + the detail body | `className="h-full"` |
| lucide icons | `SquareKanban`, `BookText` (rail), `Search`, `ChevronLeft`, `Loader2`, plus `User` (assignee placeholder), `FileText`/`Layers` (Confluence empty), `Inbox`/`SearchX` (empty/idle illustrations) | size `size-3.5`–`size-8` as in Slack |

No `Card`, `Tabs`, or `Tooltip` work is needed inside the panels (Tabs/Tooltip are the shell's;
the panels reuse the shell). If the developer finds a genuinely missing primitive while building,
**stop and flag it** rather than hand-rolling — but none is anticipated.

### 3.3 Tokens used (existing, unchanged)

`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`,
`--popover-foreground`, `--primary`, `--secondary`, `--secondary-foreground`, `--muted`,
`--muted-foreground`, `--accent`, `--border`, `--input`, `--destructive`, `--ring`, `--radius`.
Plus the **six new status tokens** in §3.1. Nothing else; no raw hex on any surface.

---

## 4. JiraPanel (`src/renderer/JiraPanel.tsx`)

### 4.0 Navigation state

```
type JiraView =
  | { kind: 'search' }                      // JQL input + results list (or idle prompt)
  | { kind: 'issue'; issueKey: string }     // single-issue detail (drill-in from a row)
```
- Connected default view is `{ kind: 'search' }` with **no query run yet** → idle prompt (§4.2).
- Opening a row → `{ kind: 'issue', issueKey }`; Back (§2.5) → `{ kind: 'search' }` with the
  prior query + results preserved in state.

### 4.1 Search results list — issue row

Each issue row (FR-J04: key, summary, status, assignee). Row is a clickable `Button variant="ghost"`
(full-width, `justify-start`, `h-auto py-2`) **or** a `div` with the row divider + an inner
keyboard-focusable open affordance — prefer the `Button`-as-row idiom (Slack's `ChannelList`) so
keyboard/focus come free. Layout, left→right:

```
[ Badge: KEY ]  summary (truncate, flex-1, text-foreground)   [ status Badge ]  [ Avatar+name ]
```

- **Issue key** — `Badge variant="secondary"` with `font-mono text-[10px]`, e.g. `PROJ-123`.
  Shrink-0.
- **Summary** — `truncate text-sm text-foreground`, `flex-1 min-w-0` (the row's flexible middle).
- **Status** — `Badge` colored by `statusCategory` via the §3.1 tokens; label is the raw status
  name (`To Do`, `In Progress`, `Done`, or any custom). `shrink-0`.
- **Assignee** — `Avatar size="sm"` (`AvatarFallback` = initials of the assignee display name) +
  `truncate text-xs text-muted-foreground` name; when **unassigned**, show a muted
  `User` lucide glyph in the avatar slot and "Unassigned" in muted text. `shrink-0`, `max-w` so it
  never crowds the summary.
- Row divider: `border-b border-border/60 last:border-b-0`. Hover: inherited ghost `hover:bg-accent`.

### 4.2 Jira states (all five)

| State | Treatment |
|-------|-----------|
| **Idle** (connected, no query yet — FR-J03 + scenario) | Centered prompt in the content region: a muted `SquareKanban` (`size-8 text-muted-foreground`) + `EmptyLine` "Enter a JQL query to search your Jira issues." **No read is performed.** This is the default connected view. |
| **Loading** (query running) | `IssueRowSkeletons`: 4–5 rows, each `flex items-center gap-2 px-3 py-2`: a `Skeleton h-4 w-14 rounded` (key), `Skeleton h-3 flex-1` (summary), `Skeleton h-4 w-16 rounded-full` (status), `Skeleton size-6 rounded-full` (avatar). `aria-busy="true"`. |
| **Populated** | `ScrollArea` of issue rows (§4.1) + "Load more" (§2.6) when `nextCursor` present. A muted result-count line on top (`px-3 py-2 text-xs text-muted-foreground` `aria-live="polite"`, like Slack search): "{n} issues". |
| **Empty** (query ran, 0 results) | `EmptyLine` "No issues match this query." |
| **Error** | `ErrorState` (§2.4). `rate_limited` → "Jira is busy — retrying shortly." + cooldown-disabled Retry. |
| **Disabled / reconnect_needed** | `ReconnectState` (§2.4) replaces the list; copy "Your Jira connection expired. Reconnect to continue." |

### 4.3 Issue detail view (FR-J04)

Drill-in from a row, with the §2.5 back-header (title = issue key). Body is a single
`ScrollArea h-full` with `p-3 flex flex-col gap-4`. Sections, in order:

1. **Header block**
   - Summary — `text-base font-medium text-foreground leading-snug` (multi-line ok, no truncate).
   - Meta row — `flex flex-wrap items-center gap-2`: the status `Badge` (§3.1 colored) + the issue
     key `Badge variant="secondary" font-mono`.
2. **People block** — `flex flex-col gap-2` (or a 2-col grid on wide):
   - **Assignee** — label `text-xs text-muted-foreground` "Assignee" + `Avatar size="sm"` +
     name `text-sm text-foreground`; "Unassigned" muted when none.
   - **Reporter** — same shape, label "Reporter".
3. **Description** — label "Description" (`text-xs font-medium text-muted-foreground`) then the
   body as **wrapped, multi-line readable text**: `whitespace-pre-wrap break-words text-sm
   text-card-foreground leading-relaxed`. (Jira description is ADF/rich; v1 renders plain readable
   text — see Open Questions Q1.) If empty → muted "No description." line.
4. **Comments** (FR-J04 "in order") — label "Comments ({n})" then a `flex flex-col` of
   comment rows. **Reuse Slack's `MessageRow` shape** (it fits exactly): `Avatar size="sm"` +
   author name (`text-sm font-medium`) + timestamp (`text-xs text-muted-foreground`) +
   `whitespace-pre-wrap break-words text-sm text-card-foreground` body, divided by
   `border-b border-border/60 last:border-b-0`. Empty → muted "No comments." line.

**Detail states:**

| State | Treatment |
|-------|-----------|
| **Loading** | `IssueDetailSkeleton`: `Skeleton h-5 w-3/4` (summary), a row of two `Skeleton h-5 w-20 rounded-full` (status/key), two `Skeleton h-4 w-32` (people), `Skeleton h-3 w-full` ×3 (description), then 2 comment-shaped skeletons (Slack's `MessageSkeletons` shape). `aria-busy="true"`. |
| **Populated** | the section stack above. |
| **Empty** | not a whole-view empty — individual sections degrade to their muted "No description." / "No comments." lines; the issue header always renders. |
| **Error** | `ErrorState` replaces the body (back-header stays so the user can return). |
| **Disabled / reconnect_needed** | `ReconnectState` replaces the body (back-header stays). |

---

## 5. ConfluencePanel (`src/renderer/ConfluencePanel.tsx`)

### 5.0 Navigation state

```
type ConfluenceView =
  | { kind: 'search' }                  // search input + results list (or idle prompt)
  | { kind: 'page'; pageId: string }    // single-page detail (drill-in from a row)
```
Same idle-default + drill-in + back behavior as Jira (§4.0).

### 5.1 Search results list — content row

Each row (FR-C04: title, space, excerpt). `Button`-as-row idiom (ghost, full-width,
`justify-start h-auto py-2`, `flex-col items-start gap-1` since the excerpt wraps below the title):

```
title (truncate, text-sm font-medium text-foreground)   [ Badge: space ]
excerpt (line-clamp-2, text-xs text-muted-foreground)
```

- **Title** — `truncate text-sm font-medium text-foreground`, `flex-1`.
- **Space** — `Badge variant="outline"` `px-1.5 py-0 text-[10px]`, the space name/key; `shrink-0`,
  right-aligned on the title line (`ml-auto`).
- **Excerpt** — `line-clamp-2 text-xs text-muted-foreground` beneath, full row width. Confluence
  excerpts can contain markup/highlight tags; v1 shows **plain readable text** (strip to text —
  see Open Questions Q2).
- Row divider: `border-b border-border/60 last:border-b-0`.

### 5.2 Confluence states (all five)

| State | Treatment |
|-------|-----------|
| **Idle** (connected, no query yet — FR-C03 + scenario) | Centered prompt: muted `BookText` (`size-8`) + `EmptyLine` "Search Confluence to find pages." **No read performed.** Default connected view. |
| **Loading** | `ContentRowSkeletons`: 4–5 rows, each `flex flex-col gap-1.5 px-3 py-2`: a row of `Skeleton h-4 flex-1` (title) + `Skeleton h-4 w-16 rounded-full` (space), then `Skeleton h-3 w-full` + `Skeleton h-3 w-2/3` (2-line excerpt). `aria-busy="true"`. |
| **Populated** | `ScrollArea` of content rows (§5.1) + "Load more" (§2.6) when `nextCursor` present. Muted result-count line on top (`aria-live="polite"`): "{n} results". |
| **Empty** (query ran, 0 results) | `EmptyLine` "No content matches this query." |
| **Error** | `ErrorState` (§2.4). `rate_limited` → "Confluence is busy — retrying shortly." |
| **Disabled / reconnect_needed** | `ReconnectState` (§2.4); copy "Your Confluence connection expired. Reconnect to continue." |

### 5.3 Page detail view (FR-C04)

Drill-in from a row, §2.5 back-header (title = page title). Body `ScrollArea h-full` with
`p-3 flex flex-col gap-4`:

1. **Header block** — title `text-base font-medium text-foreground leading-snug` (multi-line ok) +
   meta row `flex flex-wrap items-center gap-2` with the **space** `Badge variant="outline"`.
2. **Body** — the page body/excerpt as **wrapped, readable plain text**: `whitespace-pre-wrap
   break-words text-sm text-card-foreground leading-relaxed`. Confluence body is storage/HTML-ish;
   **v1 renders plain readable text — NO macro/HTML rendering** (Open Questions Q2). If body is
   empty, fall back to the excerpt; if both empty → muted "This page has no readable body." line.

**Detail states:**

| State | Treatment |
|-------|-----------|
| **Loading** | `PageDetailSkeleton`: `Skeleton h-5 w-3/4` (title), `Skeleton h-5 w-20 rounded-full` (space), then `Skeleton h-3 w-full` ×5 (body paragraph). `aria-busy="true"`. |
| **Populated** | the header + body stack above. |
| **Empty** | body degrades to the muted "no readable body" line; header always renders. |
| **Error** | `ErrorState` replaces the body (back-header stays). |
| **Disabled / reconnect_needed** | `ReconnectState` replaces the body (back-header stays). |

---

## 6. Connect call-to-action (not-connected, both panels)

The single-button browser-OAuth Connect surface — **lift Slack's `ConnectForm` whole** (no token
inputs; one `Button` opens the system browser). Centered in the content region:

```
<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
  <SquareKanban|BookText class="size-8 text-muted-foreground" />
  <p class="text-sm text-muted-foreground">{intro copy}</p>
  {state !== 'connecting' && <ConnectForm .../>}   // reconnect Alert + lastError Alert + Connect button + helper
</div>
```

- **Jira** intro: "Connect your Atlassian site to search Jira issues from cosmos."
  `ConnectForm` button label "Connect Jira"; helper: "Opens your browser to sign in to Atlassian.
  cosmos requests read-only access and stores the connection encrypted on this device."
- **Confluence** intro: "Connect your Atlassian site to search Confluence pages from cosmos."
  Button "Connect Confluence"; same helper copy (read-only, encrypted on device).
- Connect button: `Button variant="default" size="sm"`, shows `Loader2` + "Connecting…" while busy.
- `reconnect` Alert and `lastError` Alert use `variant="destructive" border-destructive/40
  bg-destructive/15` — identical to Slack. `lastError` covers all spec connect-failure messages
  (cancelled, denied, state-mismatch, **not configured** when `COSMOS_ATLASSIAN_CLIENT_ID`/`_SECRET`
  unset, **no accessible site**) — the panel just renders the `status.lastError` string main provides.
- The `connecting` ConnectionBar (§2.2) shows the in-flight state; on browser cancel/timeout the
  status returns to `not_connected` with a `lastError`, which renders here.

> **No token input field exists anywhere in either panel.** (Matches Slack; FR-A11/SC-009.)

---

## 7. Interaction & accessibility

Lean on Radix (Button/ScrollArea/Avatar/Alert) for the heavy lifting; match Slack's patterns.

- **Panel landmark**: outer `<section aria-label="Jira" | "Confluence">` (Slack idiom). The tab-strip
  header label is decorative text; the `aria-label` names the region.
- **Rail icons** are icon-only → each MUST keep its `aria-label` (Jira / Confluence) **and** tooltip
  (the shell already enforces this via `TabsTrigger aria-label` + `Tooltip`).
- **Focus order** (connected, list view): Search `Input` → result rows (each a focusable `Button`)
  → "Load more" button. In detail: Back button → (interactive children, if any). Natural DOM order;
  no `tabIndex` gymnastics.
- **Keyboard**:
  - Search: `Enter` submits (form `onSubmit`); empty/whitespace query is a no-op (stays idle).
  - Rows are `Button`s → `Enter`/`Space` opens the issue/page; `ChevronLeft` Back button likewise.
  - "Load more" is a `Button` → keyboard-activatable; disabled (not focus-trapping) while loading.
- **ARIA / live regions**:
  - Loading containers: `aria-busy="true"` (skeleton wrappers).
  - Result-count line: `aria-live="polite"` so the count is announced after a search (Slack idiom).
  - Error/Reconnect `Alert`s carry `role="alert"` (component default) so failures are announced.
  - The status `Badge` text (status name) is real text, not color-only → **color is not the sole
    carrier of status meaning** (a11y: the §3.1 colors are reinforcement, the label is the source
    of truth). This is why the Badge always shows the status name, never just a colored dot.
- **Contrast**: all text on `text-foreground`/`text-card-foreground`/`text-muted-foreground` over
  `--card`/`--popover` meets the existing Slack-panel contrast. The new §3.1 status tokens were
  picked for legible foreground-on-fill on the dark background (light foregrounds `#9dc7ff` /
  `#7fd6a0` / `#dddddd` on dark fills `#1e3a5f` / `#1f3d2b` / `#3a3a3c`). **Developer: eyeball these
  against the running app and nudge toward ≥4.5:1 if any chip reads thin** (they are muted by
  design but must stay readable).
- **No remote images**: `Avatar` uses `AvatarFallback` initials only (matches Slack §0/§5) — no
  Atlassian avatar URLs are fetched, so no network image, no broken-image state, no CSP surprise.
- **Reduced motion**: the only motion is `Loader2 animate-spin` and `Skeleton animate-pulse`, both
  already in the system and consistent with Slack; nothing new to gate.

---

## 8. State matrix (confirmation — every surface, all five states)

| Surface | Loading | Empty / idle | Populated | Error | Disabled (reconnect_needed) |
|---------|---------|--------------|-----------|-------|------------------------------|
| Jira — connection bar | `connecting` spinner | — | site/account + Disconnect | — | "Reconnect needed" pill |
| Jira — connect CTA | Connect button → "Connecting…" | (this IS the not-connected surface) | n/a (flips to list) | `lastError` Alert | reconnect Alert + Connect |
| Jira — search list | IssueRowSkeletons | idle prompt (no query) / "No issues match" (0 results) | issue rows + Load more | ErrorState (+429 copy) | ReconnectState |
| Jira — issue detail | IssueDetailSkeleton | section-level "No description."/"No comments." | header+people+desc+comments | ErrorState (back-header stays) | ReconnectState (back-header stays) |
| Confluence — connection bar | `connecting` spinner | — | site/account + Disconnect | — | "Reconnect needed" pill |
| Confluence — connect CTA | Connect button → "Connecting…" | (this IS the not-connected surface) | n/a | `lastError` Alert | reconnect Alert + Connect |
| Confluence — search list | ContentRowSkeletons | idle prompt (no query) / "No content matches" (0 results) | content rows + Load more | ErrorState (+429 copy) | ReconnectState |
| Confluence — page detail | PageDetailSkeleton | section-level "no readable body" | header + body | ErrorState (back-header stays) | ReconnectState (back-header stays) |

All five states are specified for every surface of both panels.

---

## 9. Open questions

1. **Jira description fidelity (Q1).** Jira Cloud returns the description as **ADF** (Atlassian
   Document Format, a rich JSON doc), not plain text. v1 renders **plain readable text**
   (`whitespace-pre-wrap`), which requires the **client/manager (developer) to flatten ADF → text**
   before it reaches the panel — the panel only renders a string. This is a data-shape decision that
   sits with the developer/architect, not the design; the design simply assumes
   `JiraIssueDetail.description` is a plain string. **Flag:** confirm the DTO carries flattened text
   (the plan's `fields=…,description` returns ADF; the mapper must stringify it). No design blocker —
   the visual treatment (wrapped readable text) is unaffected.
2. **Confluence body/excerpt fidelity (Q2).** Confluence v2 page body is **storage format**
   (HTML-ish XML) and v1 search excerpts contain `<em>`/highlight markup. v1 design = **plain
   readable text, no macro/HTML rendering** (spec/plan explicit). Same as Q1: the developer's
   mapper strips/flattens to a string; the panel renders `whitespace-pre-wrap` text. No design
   blocker. (A future version could add safe rich rendering — out of scope.)
3. **Status-category source (Q3).** The §3.1 status coloring keys off a `statusCategory`
   (`todo`/`in_progress`/`done`/`unknown`). Jira's API exposes this as
   `fields.status.statusCategory.key` (`new`/`indeterminate`/`done`). **Flag for developer:** map
   `new→todo`, `indeterminate→in_progress`, `done→done`, anything else→`unknown`, and surface
   `statusCategory` on `JiraIssueSummary`/`JiraIssueDetail` so the panel never parses raw names.
   Not a design blocker — the design degrades to the `outline` Badge for `unknown`.

None of these block the build: each has a defined v1 fallback. They are flagged so the
interface/implementation steps carry a string into the panel rather than rich content.
```
