# Spec: Home favorites render the LIVE source panel (reparenting portal) — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: the surface-re-projection mechanism of `cosmos-home-favorite-tabs-v1` (the
`ActiveTabSurface`/`FavoriteSurface` `surface` mirror) **and** `cosmos-native-view-mirror-surface-v1`
(the `mirrorSurface` projection) **for the four generative panels only**. The terminal favorite
(`cosmos-terminal-favorite-multiplex-v1`) is unchanged.
**Related plan**: `.sdd/plans/cosmos-favorite-live-panel-portal-v1.md`

---

## Deviation from spec — AS SHIPPED (reconciled 2026-06-30, commit e0446d9)

The reparenting-portal core (FR-001..FR-005, FR-009..FR-011, FR-014..FR-017) shipped as specified. Two
open questions were **overridden mid-implementation by user feedback** to a **body-only** favorite, which
changes FR-007 and the OQ-1/OQ-3 recommendations:

- **OQ-1 (inner tab strip) → SUPPRESS, not show.** The recommendation was "show the inner strip as-is".
  As shipped, while a generative panel is favorite-hosted (`hostFor(id) === 'favorite'`) it **suppresses
  its own `PanelTabStrip` AND `PanelFooter`** — the favorite shows the active tab's BODY only. So FR-007's
  "present the live panel as-is, including the panel's own tab strip" is amended: the favorite presents the
  live panel **body-only** (no nested strip/footer); the user still navigates via panel-internal nav (Slack
  open-channel, Jira/Calendar open-detail, page-back), which works because it is the live instance.
- **OQ-3 (keyboard tab-shortcut ownership) → Home KEEPS `tab:*`.** With no nested strip, there is no inner
  strip to cede shortcuts to: **Home keeps the global `tab:*` shortcuts** (`cosmos-home-keyboard-tab-nav-v1`),
  and the relocated panel gates its own `useTabShortcuts` to its **RAIL surface only** (`active &&
  !favoriteHosted`), so there is no double-bind. (The OQ-3 recommendation — shortcuts target the inner panel
  — is therefore moot.)

OQ-2/OQ-4/OQ-5/OQ-6 shipped per their recommendations (initial-focus-then-free; retained Home-side floating
composer; `react-reverse-portal`; the surface-mirror removed outright). The Home docked composer + footer are
hidden on a favorite tab (null `'cosmos'` config), as specified.

---

## Grounding

> Direct investigation run by the architect for THIS spec — not handed in by the orchestrator.

**LLM-wiki status:** the `wiki_query`/`wiki_ingest` MCP tools are **not present in this session's
toolset** (`mcp__plugin_oh-my-claudecode_t__wiki_query` → "No such tool available"). Prior-decision
grounding therefore came from the committed specs + `docs/ARCHITECTURE.md` in-repo (the material the
wiki was seeded from), flagged here so the gap is visible. The relevant prior decisions are recorded
below from those sources.

**codegraph_explore queries run (one-line takeaways):**

- `App.tsx rail panels force-mount FavoriteSurface mirrorSurface ActiveTabSurface generative panel`
  → confirmed `FavoriteSurface` mounts `live.mirrorSurface ?? live.surface` through the shared
  `ActiveTabSurface` host under `favoriteCatalogHosts[panelId]` — i.e. it re-projects the A2UI **data
  surface only**. The interactive **chrome** (search box, month/date nav, legend toggle, tab strip) is
  NOT in that surface, so a mirrored favorite has none of it. This is the root defect.
- `AppShell forceMount rail panel active prop hidden render ConfluencePanel JiraPanel SlackPanel
  GoogleCalendarPanel CosmosPanel` → all six rail panels are **force-mounted** in `AppShell`
  (`<TabsContent forceMount className="...data-[state=inactive]:hidden">`), each fed an `active={surface
  === id}` prop; **exactly one rail surface is visible at a time** (Radix vertical `Tabs`, `surface`
  state). So each generative panel's single live instance already exists and is idle-in-DOM when Home
  is active.
- `CosmosPanel home favorites render FavoriteSurface homeFavorites cosmosTabs FavoritePanelId pin
  unpin docked composer hidden` → Home is a multi-tab container; the active favorite renders
  `<FavoriteSurface>` full-width and Home publishes a **null `'cosmos'` composer config** (hides its
  docked composer) and re-renders the SOURCE panel's published composer config as a floating
  `PromptComposer` (submit → source target). The floating Open-Prompt composer is **App-level/hoisted**
  (`SharedComposer`), NOT inside the panel body.
- `useGenerativePanelTabs ... TabSurface GenerativeTab projectLivePanelTab livePanelProjection` →
  the published `LivePanelTab` carries `surface` + (favorite-only) `mirrorSurface`, projected mutually
  exclusively for the favorite mirror. The tree itself is **label-only** (`toPanelTabGroups` ignores
  `surface`). These published surface fields exist ONLY to feed the favorite mirror this spec replaces.
- `GoogleCalendarPanel ConfluencePanel render body search box month navigation legend ... PanelFooter`
  → each panel renders its own body chrome + its own `PanelFooter` inside its `<section>`; that chrome
  is native panel React, never serialized into a `TabSurface`. Confirms the chrome travels with the
  COMPONENT, not the surface.

**Architecture cross-refs read:** §3 (left-rail single-surface switcher; `forceMount` + only-one-
visible; "Home is a multi-tab container"), §4.14 (the cross-panel publish seam + Home favorites; the
`surface`/`mirrorSurface` seam evolutions; the terminal multiplex relaxation). Prior specs read in full:
`cosmos-native-view-mirror-surface-v1` (the `mirrorSurface` mechanism this supersedes), the relevant
parts of `cosmos-home-favorite-tabs-v1` + `cosmos-terminal-favorite-multiplex-v1` (the favorites
contract this preserves and the terminal carve-out it keeps).

---

## Overview

A Home **favorite** of a generative panel (Jira, Slack, Confluence, Google Calendar) must show that
panel's source tab **"그대로" (as-is)** — the SAME component with its FULL interactive chrome (search
box, date/month navigation, legend toggle, tab strip, footer) and live state — not a flattened copy.
Today the favorite re-projects only the tab's **A2UI data surface** (`mirrorSurface ?? surface`)
through `ActiveTabSurface`; because the interactive chrome is native panel React that never enters the
surface, a mirrored Confluence/Jira/Calendar favorite has **no search box, no month nav, no legend
toggle** — it is dead.

The fix exploits an existing architectural fact (§3): every rail panel is **force-mounted** and only
**one rail surface is visible at a time**. So a generative panel's single live instance — its
`useGenerativePanelTabs` state, native chrome, MCP/IPC subscriptions, current surface — **already
exists and is live** even while its rail surface is hidden (because Home is the visible surface). This
feature **renders that already-mounted live instance inside the favorite** by **relocating** (reparenting)
its output — one instance, retargeted to wherever it should appear (its rail slot by default, or the
Home favorite slot when a favorite of it is the active Home tab). Because it is literally the same
component, the favorite gets full chrome + interactivity + shared state **for free** — exactly "그대로".

This **supersedes** the surface-re-projection for the four generative panels. The terminal favorite
**keeps** its xterm-multiplex + explorer-share approach (xterm couples buffer+DOM and the terminal
favorite is a terminal-pane-ONLY sub-view, not the whole panel — reparenting doesn't fit; this contrast
is the whole reason generative panels get the cleaner portal model and terminal does not).

---

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### A Confluence favorite has a WORKING search box and page navigation · P1

**As a** Home user who pinned a Confluence tab
**I want to** open that favorite and actually browse — type a search, open a page, page back
**So that** the favorite is a real shortcut to the panel, not a frozen snapshot

**Acceptance criteria:**

- Given I pinned a Confluence tab and open its favorite in Home, when the favorite renders, then I see
  the SAME Confluence panel I see on the rail — its search box, its feed/page chrome, its tab strip and
  footer — not a chrome-less surface.
- Given I type a query into the favorite's search box and submit, when the search runs, then results
  update in place (it is the live panel, so the search works exactly as on the rail).
- Given I open a page from within the favorite, when it loads, then the page detail appears with its
  real navigation, and the same change is reflected on the Confluence rail (it is one shared instance).

### A Jira favorite has a working JQL search / refresh, a Calendar favorite has working date+month nav and legend toggles · P1

**As a** Home user who pinned a Jira or Google Calendar tab
**I want** the favorite's interactive controls to work
**So that** I can use the panel from Home

**Acceptance criteria:**

- Given a Jira favorite, when I use its JQL search box / refresh / pagination, then they work (it is the
  live Jira panel, not a surface copy).
- Given a Google Calendar favorite, when I change the date or navigate months and toggle a calendar in
  the legend, then the view responds — because the favorite IS the live Calendar panel with its real
  chrome and per-tab `hiddenCalendars` state.
- Given a Slack favorite showing a channel's history, when I scroll/search/switch channel within it,
  then it behaves as the live Slack panel.

### Switching between Home favorite and the panel's rail keeps state · P1

**As a** Home user
**I want** moving the panel between Home and its rail to never lose what I was doing
**So that** in-flight searches, scroll position, and open tabs survive the move

**Acceptance criteria:**

- Given a Confluence favorite is showing the live panel and I switch to the Confluence rail, when the
  rail surface appears, then it shows the exact same live panel state (no reload, no flicker, no reset).
- Given I switch back to Home's favorite, when it re-appears, then the same live state is shown again —
  the single instance was relocated, never remounted.
- Given a search or compose is in flight when I switch, then it continues uninterrupted (the instance
  and its subscriptions never tore down).

### A favorite opens at the tab it points at · P2

**As a** Home user
**I want** opening a favorite to show the specific tab I pinned
**So that** the shortcut is meaningful

**Acceptance criteria:**

- Given I pinned the Jira panel's "Sprint board" tab and the panel's active tab is currently a different
  tab, when I open that favorite, then the favorite shows the panel focused on "Sprint board".
- Given I then navigate to another tab within the favorite (it is the live panel), then the panel's
  active tab follows (one shared instance), and the Home favorite tab keeps its original shortcut label.

### Two favorites of the same panel · P2

**As a** Home user who pinned two different tabs of the same panel
**I want** each favorite to open the panel at its own tab
**So that** both shortcuts are useful despite there being one panel instance

**Acceptance criteria:**

- Given two Confluence favorites pointing at two different Confluence tabs, when I activate favorite A,
  then Home shows the live Confluence panel focused on A's tab; when I activate favorite B, then it
  re-focuses to B's tab (one instance, re-focused).
- Given favorite A is the active Home tab, then favorite B (an inactive Home tab) renders nothing — the
  panel is never shown in two places at once (only one Home tab is active).

### Gone source / unpin / relaunch are unchanged · P2

**As a** user
**I want** the favorites contract (persist by reference, calm gone-state, never auto-dropped) preserved
**So that** the redesign changes only HOW the favorite renders, not the favorites lifecycle

**Acceptance criteria:**

- Given a favorite whose pinned source tab no longer exists, when I open it, then it shows the calm "no
  longer open" + Unpin state (never the live panel), never auto-dropped.
- Given I pinned favorites and relaunch, when the panels restore, then the favorites re-bind to their
  source tabs by reference (`{panelId,tabId,label}`) exactly as today.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Traces reference `docs/ARCHITECTURE.md`
> §3/§4.14, `cosmos-home-favorite-tabs-v1`, and `cosmos-native-view-mirror-surface-v1`.

### Render the live instance (the core inversion)

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-001 | A Home favorite of a generative panel (Jira/Slack/Confluence/Google Calendar) MUST render the SOURCE panel's **LIVE component instance** — its real chrome (search box, date/month nav, legend toggle, tab strip, footer) and interactivity — NOT a re-projected A2UI data surface. The favorite shows the same component the rail shows because it IS that component. | §3; root defect |
| FR-002 | There MUST be exactly ONE live instance of each generative panel — the existing force-mounted instance (§3). The favorite MUST display that single instance by **relocating its rendered output**, NEVER by mounting a second copy (no duplicate `useGenerativePanelTabs`, no duplicate MCP subscriptions). | §3 force-mount |
| FR-003 | Relocating a panel's output between its rail slot and the Home favorite slot MUST NOT remount the panel or reset its state: its `useGenerativePanelTabs` tab collection, its IPC/MCP subscriptions, in-flight surfaces, scroll, and native chrome state MUST survive the move. RECOMMENDED mechanism: a **stable-container reparenting (reverse) portal** — the panel renders once into a stable detached host node (container identity fixed; the panel's React-tree position fixed), and only that node's DOM parent is moved between mount points; React never reconciles a container change, so no remount. (See OQ-5: hand-roll vs `react-reverse-portal`.) | §3; OQ-5 |
| FR-004 | At most ONE mount point — the rail slot OR the Home favorite slot — may host a panel's output at any instant. The chosen host MUST be a deterministic, total function of (visible rail surface, Home's active tab). Given the only-one-surface-visible invariant (§3), this is unambiguous, so the rail slot and the favorite slot can never both claim or both drop the output. Default host = the panel's rail slot; the Home favorite slot claims it only while a favorite of that panel is the active tab of the (visible) Home surface. | §3; race-freedom |
| FR-005 | The relocation MUST be renderer-only DOM movement: it MUST NOT introduce any new IPC channel, cross-process payload, or persisted field, and MUST NOT expose any secret (the panel already renders these surfaces legitimately in the renderer). | CLAUDE.md secrets rule |

### Which tab the favorite shows

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-006 | When a favorite of panel X becomes the active Home tab, the system MUST **focus panel X's active tab to the pinned source tab** (the tab the favorite points at) so the favorite opens showing that tab. (Initial-focus only — see FR-007.) | "그대로"; OQ-2 |
| FR-007 | While the favorite is shown, it MUST present the live panel **as-is, including the panel's own tab strip**; the user MAY navigate within it. Because it is the live shared instance, switching its inner tab switches that instance's active tab (the truthful consequence of one component). The favorite MUST NOT continuously re-pin the source's active tab after the initial focus (no fighting the user's in-favorite navigation). | "그대로"; OQ-1/OQ-2 |
| FR-008 | The Home favorite tab's LABEL MUST remain the pinned source tab's label (the shortcut name), reconciled as that specific source tab renames/closes — unchanged from the favorites contract. Inner navigation within the live panel MUST NOT rename the Home favorite tab. | `cosmos-home-favorite-tabs-v1` FR-041 |

### Rail ↔ favorite handoff

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-009 | Switching from a Home favorite of X to X's rail (or back) MUST retarget the single instance between the two mount points without remount or state loss, and MUST be **race-free** — the handoff is a single relocation driven by the deterministic host derivation (FR-004), and only-one-visible guarantees exactly one claimant at every instant. | §3; FR-004 |
| FR-010 | The panel hosted in a favorite is on screen though it is NOT the active rail surface. The panel's **visibility-dependent behavior** (layout/resize fit, auto-scroll, rendering of the active surface) MUST treat "hosted in the active favorite" as visible. Keyboard tab-shortcut **ownership** MUST be reconciled so the favorite's inner panel and Home do not double-bind the global tab shortcuts (`tab:next/prev/jump/new/close`). (Exact ownership — see OQ-3.) | §3 `active` prop; OQ-3 |

### Multiple favorites of one panel

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-011 | When multiple favorites point at tabs of the SAME panel, only the favorite that is the ACTIVE Home tab hosts the live instance (focusing its pinned tab, FR-006); every other favorite of that panel is an inactive Home tab and renders nothing. No placeholder is required for an inactive favorite — only-one-Home-tab-active means the panel is never needed in two places at once. | only-one-Home-tab-active |

### Footer + composer (the favorite chrome)

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-012 | The favorite MUST show the live panel's OWN body chrome **including its `PanelFooter`** — it travels with the relocated output. (This is a strict improvement: the superseded surface-mirror showed no footer/chrome.) | "그대로"; PanelFooter |
| FR-013 | Home MUST continue to hide its docked Cosmos composer while a favorite is active (publish a null `'cosmos'` composer config). The floating Open-Prompt composer is App-level/**hoisted** (`SharedComposer`), so it does NOT travel inside the relocated panel body; Home MUST therefore continue to surface the SOURCE panel's published composer config as a floating `PromptComposer` over the favorite, routing submits to the SOURCE target. This is the one piece of today's favorite wiring that is **RETAINED** (the body+footer come via the portal; the floating composer via the existing Home re-publish). | hoist invariant; OQ-4 |

### Supersede the surface-mirror; keep the terminal multiplex

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-014 | The live-panel portal SUPERSEDES the surface re-projection for the four generative panels: `FavoriteSurface` MUST NO LONGER mount `mirrorSurface ?? surface` via `ActiveTabSurface` for them. The `mirrorSurface` projection (`cosmos-native-view-mirror-surface-v1`) and its renderer-side native-view builder (`nativeMirror.ts`) + the reverse "pinned-sources" gate that existed ONLY to feed that mirror SHOULD be removed as dead code; the published `LivePanelTab.surface`/`mirrorSurface` fields, read only by the superseded mirror, SHOULD likewise be dropped from the publish (the tree is label-only). (Remove outright vs keep as a degraded fallback — OQ-6.) | supersede; OQ-6 |
| FR-015 | The TERMINAL favorite MUST keep its xterm-multiplex + explorer-share approach unchanged: `FavoriteSurface`'s `source.panelId === 'terminal'` branch → `TerminalFavoriteSurface` is preserved exactly. ONLY the four generative panels switch to the portal. Rationale: a terminal favorite is a terminal-pane-ONLY sub-view (not the whole panel) and xterm couples buffer+DOM with no shared-model/portal option. | `cosmos-terminal-favorite-multiplex-v1` |

### Gone source / persist (unchanged contract)

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-016 | A favorite whose pinned source TAB no longer exists in the (always-mounted) panel MUST show the calm "no longer open" + Unpin state — never the live panel, never auto-dropped. Because the panel instance now always exists, GONE detection becomes "the panel has no tab with the pinned id" (not "no live surface"). | `cosmos-home-favorite-tabs-v1` FR-031 |
| FR-017 | Favorites MUST persist by reference only (`{panelId,tabId,label}`) and re-bind to the restored source tab on relaunch — unchanged. This feature adds NO new persisted state (the portal is purely renderer-side). | §4.14; FR-005 |

## Edge Cases & Constraints

- **The remount trap (why a naive portal is wrong).** React reconciles a `createPortal(children,
  container)` by container identity; swapping the container to a different DOM node DELETES the old
  portal fiber and mounts a new one — losing all child state. So the favorite **cannot** be implemented
  by simply pointing the panel's portal at "the rail div, or the Home div". The recommended fix (FR-003)
  keeps the portal **container stable** (a panel-owned detached node) and moves THAT node imperatively
  between mount points; reparenting a DOM node does not touch React's tree, so state survives. This is
  the genuine non-triviality — call it out plainly; it is the difference between "works" and "resets on
  every switch".
- **The `active` prop is now overloaded.** Today `active = (surface === id)` drives both rail-level
  concerns (per-switch default-view refresh, tab-shortcut scoping) and visibility concerns (resize-fit,
  auto-scroll). A favorited panel is **visible but not the rail surface**, so these split: visibility
  concerns want "rail-active OR hosted-in-active-favorite"; keyboard ownership must not double-bind with
  Home. RECOMMENDED: derive a "visible" signal for layout/render and keep keyboard ownership resolved by
  OQ-3. (Plan owns the exact split.)
- **Nested tab strips.** Showing the live panel as-is means the favorite (a single Home tab) contains
  the panel's own tab strip — a strip inside a tab. This is the honest consequence of "그대로"; it is
  surfaced as OQ-1 (show the inner strip vs suppress to the pinned tab's body).
- **Disabled integration.** A disabled integration is filtered from the rail but its panel stays
  force-mounted and keeps its tabs. A favorite of a disabled panel's still-existing tab MAY still render
  the live (disabled-state) panel; this is an edge to confirm in the plan (likely: render it; its own
  chrome shows the disconnected/disabled state — strictly better than a blank surface).
- **Disconnected source.** A favorite of a disconnected panel now shows the panel's OWN disconnected
  chrome (real), not a "Waiting…" placeholder — an improvement; the WAITING idiom is largely obviated
  because the panel renders its own loading/empty/disconnected states.
- **Dev Fast-Refresh / StrictMode.** The stable container must be created once (lazy `useState`/`useRef`
  init, not a render-phase side effect) so StrictMode's double-invoke and Fast-Refresh remounts don't
  orphan or duplicate it. (Plan concern; noted so it isn't missed.)
- **Out of scope (v1):** changing the terminal favorite (FR-015); any new cross-process contract;
  persisting panel/native view state for favorites (still reference-only); a generic "render any panel
  anywhere" framework beyond the rail-slot ↔ favorite-slot relocation these four panels need.

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | A Confluence/Jira/Slack/Calendar favorite renders the LIVE source panel with FULL working chrome — search box, date/month nav, legend toggle, tab strip, footer — because it is the same component, not a surface copy. |
| SC-002 | Interactive controls inside the favorite (Confluence search, Jira JQL/refresh/pagination, Calendar date+month nav + legend, Slack channel switch/search) actually work and reflect on the source panel — one shared instance. |
| SC-003 | Switching a panel between its Home favorite and its rail relocates the single instance with NO remount, NO flicker, NO state reset; in-flight searches/composes and scroll survive. |
| SC-004 | Opening a favorite focuses the live panel on the pinned source tab; inner navigation thereafter follows the shared instance without renaming the Home favorite tab. |
| SC-005 | With two favorites of one panel, only the active Home tab's favorite hosts the live instance (focused on its tab); the inactive favorite renders nothing and the panel is never shown twice. |
| SC-006 | The favorite shows the panel's own `PanelFooter`; Home's docked Cosmos composer stays hidden; the source panel's floating Open-Prompt composer is surfaced over the favorite and submits to the source target. |
| SC-007 | The four generative favorites no longer use `ActiveTabSurface`/`mirrorSurface ?? surface`; the terminal favorite is byte-for-byte unchanged (still the xterm multiplex). |
| SC-008 | A favorite whose pinned source tab is gone shows the calm "no longer open" + Unpin (never the live panel, never auto-dropped); favorites still persist by reference and re-bind on relaunch; no new persisted/IPC state was added. |

---

## Open Questions

> These are the genuinely unresolved choices needing your confirmation. Each has a recommendation.

- [x] **[RESOLVED → SUPPRESS (body-only); see Deviation note at top] OQ-1 Inner tab strip: show or suppress?** A favorite is one Home tab,
  but the live panel renders its OWN tab strip inside it (a strip within a tab). **RECOMMEND: show it
  as-is** (true "그대로"; it is the same component, suppressing its strip would mean a special stripped
  render mode that fights the "same component" model). The alternative is to hide the inner strip and
  show only the pinned tab's body — cleaner visually but less truthful and more code. Confirm.
- [ ] **[NEEDS CLARIFICATION — OQ-2] Initial-focus only, or continuously pin tab T?** **RECOMMEND:
  focus the pinned tab once on favorite activation (FR-006), then let the user navigate freely (FR-007)**
  — the favorite is a deep-link into the live panel at tab T. The alternative (continuously re-pin T
  while the favorite is shown) makes the inner strip non-functional and fights "그대로". Confirm
  initial-focus-then-free.
- [x] **[RESOLVED → Home keeps `tab:*` (inner strip suppressed); see Deviation note at top] OQ-3 Keyboard tab-shortcut ownership while a favorite is active.** With
  the inner strip visible, which strip do the global `tab:*` shortcuts target — the favorite's inner
  panel (the thing on screen) or Home's favorite strip? **RECOMMEND: while a generative favorite is
  active, the global tab shortcuts target the inner (visible) panel; Home tab switching stays available
  via clicking the Home strip.** This needs your call because it changes keyboard behavior. (If OQ-1 is
  "suppress inner strip", this collapses — shortcuts go to Home.)
- [ ] **[NEEDS CLARIFICATION — OQ-4] Floating composer surfacing.** The hoisted Open-Prompt composer is
  App-level, so it does NOT travel inside the reparented panel body. **RECOMMEND: keep today's
  mechanism** (Home reads the source panel's published composer config and renders the floating composer
  over the favorite, routing to the source target — FR-013). The footer DOES travel with the portal. This
  is a slight mismatch with the framing "the floating Open Prompt comes with the panel" — confirm you're
  fine retaining the Home re-publish for the composer specifically.
- [ ] **[NEEDS CLARIFICATION — OQ-5] Reparenting portal: hand-roll vs `react-reverse-portal`.** The
  stable-container reparent (FR-003) is a known pattern; the `react-reverse-portal` library implements it
  (`createHtmlPortalNode` / `InPortal` / `OutPortal`). **RECOMMEND: evaluate the library in the plan** —
  adopt it if it cleanly fits the rail-slot ↔ favorite-slot mount points, else hand-roll the ~40-line
  equivalent (a panel-owned detached node + a small Outlet that `appendChild`s it when chosen). Plan
  decision; flagged so the dependency call is explicit.
- [ ] **[NEEDS CLARIFICATION — OQ-6] Remove the superseded surface-mirror outright, or keep as fallback?**
  **RECOMMEND: remove it** for the four generative panels (the `mirrorSurface` projection, `nativeMirror.ts`,
  the pinned-sources gate, and the now-unused published `surface`/`mirrorSurface` fields) — keeping a dead,
  competing mechanism is worse than deleting it, and the portal renders strictly more. The plan must
  sequence the deletion (it touches `livePanelProjection`, `FavoriteSurface`, `useGenerativePanelTabs`
  publish, and the Cosmos pinned-sources channel). Confirm removal vs retaining it behind a fallback.

---

## Honest complexity assessment

The user's **core model is right**: rendering the SAME component is the correct way to get "그대로",
not re-projecting a surface. The chrome problem is intrinsic to the surface-mirror and cannot be patched
by enriching the surface — the chrome is native panel React.

That said, this is **non-trivial** and should not be undersold:

1. **Reparent-without-remount is the crux (FR-003).** A naive portal-target swap *resets the panel on
   every switch* (React deletes the old portal fiber). The stable-container reparent avoids it but is an
   imperative-DOM pattern layered under React — the part most likely to be done wrong.
2. **The `active`/visibility prop split + keyboard ownership (FR-010, OQ-3)** is real wiring across
   every generative panel, not a one-line change.
3. **The which-tab + nested-strip reconciliation (OQ-1/OQ-2)** is a genuine UX choice, not a mechanical
   one.
4. **The deletion of the superseded mirror (FR-014, OQ-6)** touches several files and must be sequenced.

Net recommendation: adopt the live-panel reparenting portal for the four generative panels, with the
stable-container reverse-portal mechanism (FR-003), initial-focus-then-free which-tab (FR-006/FR-007),
retained Home-side floating composer (FR-013), and removal of the surface-mirror (FR-014) — pending your
answers to OQ-1..OQ-6.

---

## Notes for the architecture doc (do NOT edit yet)

- **§3 "Home is a multi-tab container."** Update the favorite description: a generative-panel favorite no
  longer mirrors an A2UI surface — it **renders the live source panel instance itself** (reparented), so
  the favorite has the panel's full chrome + interactivity. Note the new invariant: a panel's single
  force-mounted instance is *relocated* between its rail slot and the Home favorite slot (never copied),
  exploiting only-one-visible.
- **§4.14 seam evolution.** The `LivePanelTab.surface` + `mirrorSurface` "labels + LIVE surface" evolutions
  are SUPERSEDED for the four generative panels (the favorite no longer reads a published surface); record
  that the published per-tab payload reverts toward label-only for the tree, and the favorite obtains the
  live view by reparenting the panel, not by reading a surface. The terminal `serialize` ref and the
  terminal multiplex are unchanged.
- **§4.14 Home favorites.** Generative favorites = reparented live panels (full chrome); terminal favorite
  = xterm multiplex (unchanged). The favorites lifecycle (persist by reference, gone-state, never
  auto-dropped) is unchanged. Note the retained Home-side floating-composer re-publish (the hoisted
  composer does not travel with the portal).
