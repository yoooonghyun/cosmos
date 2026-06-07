# Design: Slack Integration (read-only) — v1

**Status**: Draft
**Created**: 2026-06-03
**Spec**: .sdd/specs/slack-integration-v1.md
**Plan**: .sdd/plans/slack-integration-v1.md
**Design system**: Tailwind v4 + shadcn/ui (new-york), dark-first cosmos palette (`src/renderer/index.css`)

---

## 0. Design intent

The Slack panel must read as the **same product** as the Terminal and Generated-UI panels
sitting beside it — not as "embedded Slack." That means: cosmos's dark VS Code palette via
theme tokens, **no Slack-brand purple**, the same panel chrome idiom already established in
`GeneratedUiPanel.tsx` (`border-border bg-card` body, `bg-popover` header, muted header
label, shadcn `Button` for actions). Every surface is expressed in existing tokens +
shadcn components; the only system growth is a handful of standard shadcn primitives the
panel genuinely needs (listed in §3, flagged for the developer to install).

This is also the **template for Jira and Confluence**: the right-column tab container (§1)
and the connection/list/detail/state patterns below are meant to be reused, so those cycles
inherit a settled visual language instead of re-deriving one.

---

## 1. App shell placement — left icon rail (VS Code activity bar)

**Decision (user-selected):** a slim **vertical icon rail** on the far left (VS Code
activity-bar style) switches what the **right column** shows. The Terminal stays in the
center, always visible; the right column renders the **selected** auxiliary surface
(**Generated UI** or **Slack**; Jira / Confluence become additional rail icons in later
cycles).

Rationale: three fixed side-by-side panes in an ~1100px window would crowd as integrations
arrive; a rail scales to many surfaces in a tiny fixed width and reads as a familiar
"activity bar." The Terminal (live Claude TUI) stays primary; auxiliary surfaces share the
right column one at a time.

```
┌────┬──────────────────────┬────────────────────────────┐
│ ▣  │                      │                            │  ← rail icons switch the
│ ◈  │   Terminal Panel     │   selected surface (~40%)   │     right column's surface
│ ▤  │   (xterm.js, ~55%)   │   (Generated UI OR Slack)   │
│    │                      │                            │
└────┴──────────────────────┴────────────────────────────┘
  rail        center                right column
 (~48px)
```

- **Rail** (~48px wide, far left): `bg-popover`, `border-r border-border`, a vertical stack
  of **icon buttons** (`Button variant="ghost" size="icon"`), one per surface:
  - Generated UI → lucide `Sparkles` (or `LayoutTemplate`)
  - Slack → lucide `MessageSquare` (cosmos-neutral, not the Slack glyph, to stay on-brand)
  - (future: Jira, Confluence)
  - **Active** icon: `text-foreground` + a 2px left **accent indicator bar in `--primary`**
    (VS Code idiom). **Inactive:** `text-muted-foreground`, `hover:text-foreground`.
  - Each rail icon has a **tooltip / `aria-label`** with its surface name (icon-only needs an
    accessible name).
- **Right column** renders the selected surface, keeping the existing Generated-UI panel
  chrome idiom. **Both surfaces stay mounted** (toggle visibility, don't unmount) so a
  pending `render_ui` surface isn't lost when the user views Slack.
- **Implementation recommendation (flagged for the developer):** build the rail + right
  column as a Radix **`Tabs` with `orientation="vertical"`**, styled so the `TabsList` is the
  icon rail and the `TabsContent` panels are kept mounted via `forceMount` (hidden when
  inactive). This gives roving-tabindex, arrow-key nav, and `tablist`/`tab`/`tabpanel`
  semantics for free, and satisfies the keep-mounted requirement — rather than hand-rolling
  the rail's a11y.
- **Structural change to `App.tsx`/`App.css`** (flagged for the developer): the body changes
  from `terminal | ui` (two flex panes) to `rail | terminal | right-column`. The app header
  and Terminal pane internals are untouched. Fully migrating `App.tsx`/`App.css` off raw-hex
  CSS onto tokens is desirable but out of scope here — minimal touch: introduce the rail +
  right-column switch, keep the rest.

---

## 2. Slack panel — surfaces, layout, and all states

The Slack tab content is a single vertical column: a **connection bar** (top, always
present) + a **content region** below whose contents depend on connection + navigation
state. The panel owns its own navigation: **channel list → channel history → thread**
(a simple back-stack), plus a **search** entry that swaps the content region for results.

### 2.1 Connection bar (always visible at top of the Slack tab)

A slim row under the tab strip showing connection identity + the primary connection action.

| Connection state | Connection bar contents |
|---|---|
| **not-connected** | Left: muted "Not connected". Right: `Button variant="default" size="sm"` **"Connect Slack"**. This single button is the ONLY connect affordance — there is no token-paste form/input; clicking it hands off to the system browser for the PKCE OAuth flow (cosmos's own public client). |
| **connecting** | Left: workspace handoff hint "Waiting for browser sign-in…" with a small spinner (`Loader2` from lucide, `animate-spin`). Right: `Button variant="ghost" size="sm"` **"Cancel"**. |
| **connected** | Left: workspace name (`text-foreground` font-medium) + small `Badge variant="secondary"` showing scopes summary is optional. Right: `Button variant="ghost" size="sm"` **"Disconnect"**. |
| **reconnect-needed** | Left: `Badge variant="outline"` tinted with `--destructive` text "Reconnect needed". Right: `Button variant="default" size="sm"` **"Reconnect"**. |

Disconnect is intentionally a **calm `ghost`** action, not destructive-styled — it's a
routine teardown, and `--destructive` (#f3b0b0) is reserved for error/attention text per the
existing token usage. A confirm step for Disconnect is **not** required in v1 (it only
deletes a re-obtainable token).

### 2.2 Content region by state

#### not-connected (empty/intro)
Centered empty-state: a Slack-neutral lucide icon (e.g. `MessageSquare`) in
`text-muted-foreground`, a one-line `text-muted-foreground` explainer
("Connect your Slack workspace to browse channels and search messages from cosmos."), and
the same **Connect Slack** primary button (mirrors the connection bar; either is fine to
activate). No reads happen here (FR-012).

#### connect failure / cancelled
An **`Alert`** (see §3) in the content region, non-alarming, `variant` default (not
destructive-loud): "Couldn't connect to Slack. No changes were made. Try again." with a
secondary **Try again** button. Covers user-deny, `state` mismatch, and timeout (the panel
copy is the same calm message; the spec only requires "clear, non-alarming").

#### connected → Channel list  (default connected view)
- A **search field** pinned at the top of the content region: shadcn `Input` with a
  leading `Search` icon, placeholder "Search messages". (When search scope is absent, see
  "search unavailable" below.)
- Below it, the **channel list** in a `ScrollArea` (already in `components/ui/`):
  - Each row: `#` `Hash` icon (`text-muted-foreground`) + channel **name** (`text-foreground`,
    truncate) + a `Badge variant="secondary" size`-equivalent small chip "member" when the
    user is a member. Row is a `Button variant="ghost"` full-width, left-aligned, so hover =
    `hover:bg-accent/50` and the **selected** channel = `bg-accent text-accent-foreground`.
  - **Pagination (FR-013):** at the list end, a full-width `Button variant="ghost" size="sm"`
    **"Load more channels"**; while loading the next page it shows an inline spinner and
    "Loading…". When no more pages, render nothing (the list simply ends).

#### connected → Channel history
- A **header strip** for the open channel: a back affordance (`Button variant="ghost"
  size="icon-sm"` with `ChevronLeft`) + `#channel-name` (`text-foreground` font-medium,
  truncate). `border-b border-border`.
- **Message list** in a `ScrollArea`, newest-in-order per spec ("recent messages in order"):
  each message row =
  - `Avatar` (size-6/size-8) with the author's image if available, else **initials fallback**
    (`AvatarFallback`, `bg-muted text-muted-foreground`) — and if the display name itself
    can't be resolved, fall back to the **raw user id** as the name (FR-014).
  - author **display name** (`text-foreground` text-sm font-medium) + timestamp
    (`text-muted-foreground text-xs`) on the same line; message **text** below
    (`text-card-foreground text-sm`, wraps; preserve line breaks).
  - If the message has replies, a `Button variant="link" size="xs"` **"N replies"** that
    opens the thread view.
- Rows separated by subtle spacing + an optional hairline `border-border/60`.

#### connected → Thread
- Same header-strip pattern with back to the channel; title "Thread".
- The **parent message** rendered as in history, then its **replies in order** (FR-013),
  visually indented (`pl-8` / a `border-l border-border` rail) so the thread reads as nested.

#### connected → Search results
- Triggered from the search `Input`. Replaces the content region with a results list:
  - A results header: muted "Results for “{query}”" + result count.
  - Each result row: author `Avatar` + display name, the matching message **text**
    (`text-card-foreground`, with the channel context `#channel` as a `Badge variant="outline"`
    small chip and a `text-muted-foreground text-xs` timestamp).
  - A back affordance returns to the channel list.
- **Search unavailable (FR-015):** when the granted scopes on the single user token lack
  `search:read` (`canSearch` is false), the
  search `Input` is rendered **disabled** with a helper line beneath it — an `Alert` or a
  `text-muted-foreground text-xs` note: "Search isn't available for this connection." No
  silent failure, no crash.

### 2.3 The five per-surface states (channel list, history, thread, search)

Every read surface specifies all of: **loading / empty / populated / error / disabled**.

| State | Visual treatment (uniform across all four read surfaces) |
|---|---|
| **loading** | shadcn `Skeleton` rows (3–6 placeholder rows shaped like the real rows: a `size-6` circle + two `h-3` bars for messages; a single `h-4` bar for channels), `bg-muted` pulse. Never a blank pane. |
| **empty** | Centered `text-muted-foreground text-sm` line scoped to the surface: "No channels available." / "No messages yet." / "No replies." / "No results for “{query}”." |
| **populated** | The lists described in §2.2. |
| **error** | An `Alert` with `--destructive` text + `bg-destructive/15 border-destructive/40` (matching the Generated-UI panel's error box idiom) and a **Retry** `Button variant="secondary" size="sm"`. **Rate-limit (429, FR-026):** same `Alert`, copy "Slack is busy — retrying shortly." and Retry is disabled until `Retry-After` elapses (a small countdown is a nice-to-have, not required). |
| **disabled** | Controls that can't act are `disabled` (shadcn buttons already dim to `opacity-50`); the search input's disabled/unavailable case is covered above. |

A **reconnect-needed** result arriving mid-read (token rejected during a call) collapses the
content region to a single reconnect `Alert` ("Your Slack connection expired. Reconnect to
continue.") + **Reconnect** primary button — consistent with the connection bar's
reconnect state (SC-007).

---

## 3. Tokens & components

### Tokens
**No new tokens.** Everything maps to the existing `.dark` palette:
`--card`/`--card-foreground` (panel body + message text), `--popover` (tab strip + headers),
`--muted`/`--muted-foreground` (skeletons, secondary text, icons), `--accent`/
`--accent-foreground` (row hover + selected channel), `--primary` (Connect/Reconnect CTAs,
active-tab indicator, links), `--secondary` (chips + Retry button), `--border` (dividers),
`--destructive` (error/reconnect text + tinted alert backgrounds). Reinforcing uniformity:
Slack content deliberately uses cosmos tokens, **not** Slack brand colors.

### shadcn components — already present (reuse)
`button`, `card`, `scroll-area`, plus the `cn()` helper.

### shadcn components to ADD — **flagged for the developer** (no Bash here)
Install via `npx shadcn@latest add <name>` (reads `components.json`; per the developer's
earlier note the CLI mis-places files under a literal `@/` dir — move them into
`src/renderer/components/ui/` as was done for button/card/scroll-area).

| Component | Why it's needed | Surfaces |
|---|---|---|
| **tabs** | Powers the **left icon rail + right column** as a vertical `Tabs` (keeps both surfaces mounted, gives rail a11y). **Shell-level, required.** | §1 |
| **input** | The message **search** field. | §2.2 search |
| **avatar** | Uniform author rendering with built-in **image→initials fallback** (pairs with the raw-id name fallback, FR-014). | history, thread, search |
| **badge** | "member" chip, `#channel` context chip, "reconnect needed" chip. | channel list, search, connection bar |
| **alert** | Uniform banner for not-connected-failure, error, rate-limit, reconnect-needed, search-unavailable. | all state banners |
| **skeleton** | Uniform loading placeholders for every read surface (FR-016). | all read surfaces |

| **tooltip** | Hover/focus labels for the **icon-only rail buttons** (paired with `aria-label`). Recommended now that the switcher is an icon rail. | §1 rail |

Optional (use border/util classes instead unless the developer prefers the component):
**separator** (row/section dividers — `border-border` utilities suffice).

Icons come from **lucide-react** (already installed): `Sparkles`/`LayoutTemplate` (rail),
`MessageSquare` (rail + not-connected empty), `Hash`, `Search`, `ChevronLeft`, `Loader2`.

---

## 4. Interaction & accessibility

- **Rail (vertical Tabs):** Radix `Tabs orientation="vertical"` gives the rail roving-tabindex
  + arrow-key movement and `role="tablist"`/`tab`/`tabpanel` for free. The selected surface
  persists while the Terminal keeps running. Switching the rail must **not** unmount the
  Generated-UI provider (keep both surfaces mounted via `forceMount` + hidden, toggle
  visibility) so a pending render_ui surface isn't lost when the user views Slack. Icon-only
  rail buttons MUST carry an accessible name (`aria-label` + tooltip).
- **Navigation:** channel-list → history → thread is a back-stack; the back affordance
  (`ChevronLeft` icon button) is keyboard-focusable and labeled (`aria-label="Back"`).
  Channel/result/reply rows are real `<button>`s (via shadcn `Button`), so they're tabbable
  and Enter/Space-activated.
- **Search:** the `Input` submits on Enter; results region gets focus or an `aria-live`
  "N results" announcement so the change is perceivable. Disabled/unavailable search uses
  `disabled` + helper text (not just a visual dim).
- **Status banners:** error/reconnect/empty use `Alert` with appropriate `role` (`alert`
  for errors, matching the Generated-UI panel's `role="alert"` error idiom) so they're
  announced.
- **Loading:** skeletons are decorative; pair with an `aria-busy="true"` on the surface
  container so SRs don't read placeholder noise.
- **Contrast on the dark palette:** body/message text `--card-foreground` (#e0e0e0) on
  `--card` (#1b1b1c) and secondary text `--muted-foreground` (#888) both clear AA for their
  sizes; the `--primary` (#4a9eff) CTAs use `--primary-foreground` (#0b1622) for legible
  contrast. Selected-row `--accent-foreground` on `--accent` (#2d2d30) is sufficient.
- **Focus visibility:** rely on the shadcn focus-ring (`focus-visible:ring-ring/50`,
  `--ring` #4a4a4c) already baked into `button`/`input`; do not remove it.

---

## 5. Open questions / handoff notes

- **Avatar images & CSP:** message author avatars would load from Slack's CDN
  (`*.slack-edge.com`). The renderer CSP today is `img-src 'self' data:` — loading remote
  avatars would require relaxing `img-src` (or proxying images through main). **Recommended
  for v1: skip remote images and use `AvatarFallback` initials only** (no CSP change, stays
  read-only/offline-friendly). Flagging for the developer/architect: if real avatars are
  wanted, that's a CSP decision, not a pure design one. Design works fully with initials.
- **Timestamp formatting** (relative "2h" vs absolute) is a developer detail; design only
  requires a `text-muted-foreground text-xs` timestamp present.
- **App shell migration:** this feature only introduces the `Tabs` container in the right
  column; fully migrating `App.tsx`/`App.css` (header, panes) off raw-hex CSS onto tokens is
  recommended as a **separate follow-up**, not bundled here.
- No behavioral blockers — the spec's surfaces/states are fully expressible in the current
  token set + the six flagged components.

---

## 6. Developer handoff checklist (design → sdd Step 3–5)

1. `npx shadcn add tabs input avatar badge alert skeleton tooltip`; move generated files into
   `src/renderer/components/ui/` (per the known CLI alias quirk).
2. App shell: change `App.tsx` body to `rail | terminal | right-column`, building the left
   icon rail + right column as a vertical `Tabs` (Generated UI / Slack), **both surfaces kept
   mounted** (`forceMount`, don't unmount the A2UI provider). Rail icons are `aria-label`ed +
   tooltipped.
3. Build `SlackPanel.tsx` against §2: connection bar + content region with the channel-list →
   history → thread back-stack + search, all five states per read surface, using only theme
   tokens (no raw hex) and the listed components.
4. Author avatars = initials fallback only in v1 (no remote images, no CSP change) unless the
   architect approves relaxing `img-src`.
5. Design review (§ design skill Step 6) after implementation: verify token-only styling
   (no stray hex), all states present, visual parity with the Generated-UI/Terminal panels.
