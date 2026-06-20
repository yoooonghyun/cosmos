# Plan: Jira Ticket Detail (click-to-open) — v1

**Status**: v1 (view-swap) Implemented 2026-06-07. **REVISED 2026-06-20 (#86): presentation changed to a right-side detail dock — see "Revision (#86)" below. Revision implementation pending (design step first).**
**Created**: 2026-06-07
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/jira-ticket-detail-v1.md

---

## Revision (#86) — view-swap → right-side detail dock

> 2026-06-20. The original v1 (below) shipped the detail as a **whole-panel view-swap** with a native
> `ChevronLeft` "Back to list" row. #86 changes the **presentation only** to a **right-side detail
> dock alongside the still-visible issue list**, matching the shipped Slack thread dock and the
> calendar event-detail dock. Revised in place (not a v2) — presentation-only on a shipped feature,
> same call the calendar event-detail revision made. The original v1 sections are retained below as
> the historical record; this Revision section is the authoritative plan for the dock. **Implementation
> checklist for the revision is "Revision Phase R1–R4" near the end of this doc.**

### Grounding (architect, this revision)

- **codegraph_explore** `JiraPanel jiraCatalog ticket detail nav ActiveTabSurface onAction detail
  component` → the verbatim `JiraPanel`. The click intercept (`handleSurfaceAction` on
  `JIRA_OPEN_DETAIL_ACTION`, returns `true`) and the `jira:requestIssueDetail` read are KEPT. What is
  RETIRED: the `view: {kind:'list'|'detail'}` whole-region swap, the native `ChevronLeft` back row
  (JiraPanel lines ~490-503), the `originListRef`/`backNavTarget`/`JiraBackOrigin` snapshot-restore
  machinery, and `goBackToList`'s re-read. The `navLoading` floor is also no longer needed for a
  list⇄detail swap (no swap happens), though it MAY stay for the in-dock detail read.
- The Slack/calendar dock shell (from the calendar design grounding): `@container/slackbody` two-pane,
  side-by-side `w-[clamp(18rem,42%,28rem)] shrink-0 border-l` at `≥32rem`, absolute right-drawer
  `max-w-[22rem] shadow-lg` over a `bg-black/40 @[32rem]:hidden` scrim below it, X-close + scrim
  dismiss, transient per-tab. The calendar `EventDetail` dock (`.sdd/designs/calendar-event-detail-v1.md`)
  is the closest precedent (also an overlay→dock conversion).
- **memory** `Jira ticket detail nav overlay side-dock presentation` → empty; persisting the dock
  decision.

### Key mechanism change

The detail no longer arrives as an unsolicited `target:'jira'` frame that **overwrites the tab's list
surface**. Instead the detail is rendered in a **native dock component beside the list**, fed by the
`getIssue` read result — so the tab's list surface is **never clobbered**, which is exactly why the
whole `composed`-surface snapshot/restore back-origin machinery can be **deleted**. Two clean options
for HOW the dock gets the detail content (the interface/design step picks one; the spec FRs are
agnostic):

- **(R-A) Render the detail surface IN the dock.** Keep `jira:requestIssueDetail` returning the
  `buildIssueDetailSurface` A2UI surface, but route that unsolicited frame's surface into a **per-tab
  `detailSurface` slot** (NOT the tab's main `surface`) and host it in a second `A2UIProvider` inside
  the dock. The list `A2UIProvider` keeps the tab's main `surface` untouched and visible. Reuses the
  existing main composer + catalog verbatim; the only new renderer state is the per-tab dock slot.
  **Recommended** — preserves the existing main read path and the full detail catalog (transition/
  comment controls) with the least new surface plumbing.
- **(R-B) Native `JiraTicketDetail` dock component** (parallel to calendar's native `EventDetail`),
  fed a plain `JiraIssueDetail` DTO over IPC, no A2UI in the dock. Cleaner separation but it would
  rebuild the detail's transition/comment **write controls** outside the catalog — more work and a
  divergence from the deterministic `jira.*` write path. Prefer R-A unless the design wants a native
  dock; either keeps the read-only/no-new-scope posture.

Renderer state for the revision: replace `view`/`originListRef` with a single per-tab
`detailIssueKey: string | null` (+ the R-A `detailSurface` slot), set by the same
`JIRA_OPEN_DETAIL_ACTION` intercept, cleared by the dock's X / narrow-mode scrim, and reset to `null`
on `activeTabId` change and on disconnect (FR-014). The dock shell is the verbatim Slack/calendar
`@container` two-pane (OQ defaults: `32rem` breakpoint, `clamp(18rem,42%,28rem)`, `max-w-[22rem]`
drawer, X + scrim). **UI-bearing → a `design` step (designer agent) produces
`.sdd/designs/jira-ticket-detail-v1.md` (or refreshes it for the dock) BEFORE interface work**, reusing
the calendar dock design as the direct template.

---

## Summary (original v1 — view-swap; superseded by the Revision above)

Make a `TicketCard` in the Jira panel's `IssueList` clickable so it opens that ticket's full detail
**in place in the active tab**, with a native "back to list" affordance that returns the tab to the
list it was opened from. The whole path is deterministic and read-only — clicking a ticket runs a
native `jira:getIssue` read (NOT the AI agent) and reuses the EXISTING detail composer
(`JiraSurfaceBuilder.buildIssueDetailSurface`), the EXISTING unsolicited-frame routing + fire-or-defer
correlation seam in `useGenerativePanelTabs`, and the EXISTING per-tab `loadingDefault` skeleton.
The only new wire is a thin R→M "render this issue's detail into the panel" trigger
(`jira:requestIssueDetail { issueKey }`), exactly paralleling the `jira:requestSearchView` channel.

The click itself reuses the proven **renderer-local catalog-action intercept** the Slack panel uses
for open-channel navigation: `TicketCard` emits a bound A2UI action (`jira.openDetail` carrying
`{ issueKey }`) via `useDispatchAction`; the panel passes an `onAction` handler to `ActiveTabSurface`
that intercepts that action name, drives renderer `view`/`selectedIssueKey` state, and fires the
detail read — returning `true` so the action is NEVER forwarded to main as a normal `ui:action` and
NEVER reaches the agent. "Back to list" is **panel chrome outside the A2UI host** (a native back row
in `JiraPanel.tsx`, like Confluence's `ChevronLeft` row), driven by the same renderer `view` state:
clicking it re-runs the originating read (OQ-1 option 1 — `requestDefaultView` for a default-view
origin, `requestSearchView({ jql })` for a search origin), with the default view as the fallback when
no prior search is known. UI-bearing → a `design` step (designer agent) follows this plan before
interface work.

### Chosen approach (and why)

- **Renderer-local bound-action intercept for the click** (chosen over a panel-wide DOM `onClick` on
  the catalog component, and over a deterministic `jira.*` main-dispatched action).
  - *Why not a deterministic `jira.*` action* (the transition/comment write path): those are
    intercepted in MAIN by `JiraActionDispatcher` and re-push a surface. Opening a detail is pure
    renderer navigation that ALSO needs to update panel chrome state (the back row + `selectedIssueKey`),
    which main cannot set. Routing the click through main would split the navigation state awkwardly.
  - *Why not a raw React `onClick` on `TicketCard`*: catalog components receive only their spread
    node props + `{ surfaceId, componentId }`; they have no panel callback prop, and the SDK action
    pipeline (`useDispatchAction` → `A2UIRenderer onAction` → `ActiveTabSurface.handleAction` →
    panel `onAction`) is the established, typed seam for "a catalog interaction drives the panel."
    The Slack panel already uses exactly this for open-channel navigation (`SLACK_OPEN_CHANNEL_ACTION`,
    intercepted in `handleSurfaceAction`, returns `true` = handled, not forwarded). Reuse it: emit a
    NEW bound action name `jira.openDetail`, intercept it in `JiraPanel`'s `onAction`, return `true`.
    This keeps the click deterministic + routed to the PANEL (never the agent) and adds no new
    catalog→panel prop plumbing.
  - **How the panel learns which issue was clicked:** the intercepted `A2UIAction` carries
    `context.issueKey` (the `TicketCard`'s `issueKey`, emitted as a literal in the action context).
    `JiraPanel`'s `onAction` reads it, sets `view = { kind: 'detail', issueKey }` +
    remembers the originating list, and fires the detail read. No new IPC field, no main round-trip
    for the navigation state.
- **Detail read = a new thin R→M trigger reusing the deterministic compose/push body** (chosen over
  reading via `window.cosmos.jira.getIssue` directly in the renderer and composing a surface
  client-side). The renderer must NOT compose A2UI surfaces (`JiraSurfaceBuilder` is a main-only pure
  module; the detail surface shape, requestId minting, and `target:'jira'` framing all live in main).
  So add `jira:requestIssueDetail { issueKey }` paralleling `jira:requestSearchView`: main validates,
  calls `jiraManager.getIssue({ issueKey })`, and on `ok` pushes
  `buildIssueDetailSurface(detail)` with a fresh requestId + `target:'jira'` (an UNSOLICITED frame);
  on `reconnect_needed`/`not_connected` pushes nothing (native Connect/Reconnect takes over via
  `statusChanged`); on any other failure pushes `buildNoticeSurface({kind:'error', message})`. This
  mirrors `handleJiraView(jql)` exactly, so the detail path inherits the same error/loading/routing
  discipline with no new behavior to reason about.
- **Result lands in the ACTIVE tab via the existing unsolicited-frame + fire-or-defer seam.** The
  detail frame is an unsolicited `target:'jira'` frame; `useGenerativePanelTabs` already files such
  frames into the active tab (auto-creating one if none) and the existing `requestDefaultInActiveTab`
  hook method marks the active tab `loadingDefault` + fires-or-defers the request so it never races an
  in-flight NL compose for the shared `originatingTabIdRef` slot (§4.11). The detail click reuses
  `requestDefaultInActiveTab(() => window.cosmos.jira.requestIssueDetail({ issueKey }))` verbatim — no
  new correlation code.
- **"Back to list" re-runs the originating read (OQ-1 option 1).** The panel tracks the originating
  list in renderer state: `originList = { kind: 'default' } | { kind: 'search'; jql }` captured when
  the detail is opened (the default-view-on-activation origin is `default`; a JQL search sets
  `search` with the submitted JQL). Back clears `view` to the list and re-fires the originating read
  through the SAME `requestDefaultInActiveTab` seam (`requestDefaultView()` or
  `requestSearchView({ jql })`). When no origin was captured (e.g. a detail landed first in a fresh
  tab), back falls back to the default view — never a dead end (spec edge case). The brief skeleton-on-
  back is acceptable (settled in OQ-1).

## Technical Context

| Item              | Value                                                                                                  |
|-------------------|--------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + React renderer), Vitest (node env)                                |
| Key dependencies  | Existing only: `jiraManager.getIssue`, `JiraSurfaceBuilder.buildIssueDetailSurface`/`buildNoticeSurface`, `handleJiraView` siblings in `src/main/index.ts`, `useGenerativePanelTabs.requestDefaultInActiveTab`, `ActiveTabSurface` `onAction` intercept (the Slack-navigation seam), shadcn `Button`/lucide `ChevronLeft`, `useDispatchAction`. NO new npm dep, NO new OAuth scope, NO new write path. |
| Files to create   | None (all changes extend existing files).                                                               |
| Files to modify   | `src/shared/ipc.ts` (channel + payload type + `JiraApi` method), `src/shared/validate.ts` (validator), `src/preload/index.ts` (`requestIssueDetail`), `src/main/index.ts` (new channel handler reusing the getIssue→detail compose/push), `src/renderer/jiraCatalog/components.tsx` (`TicketCard` emits `jira.openDetail`), `src/renderer/jiraCatalog/logic.ts` (+ `logic.test.ts`) if any pure click-guard logic is added, `src/shared/jira.ts` (add `jira.openDetail` to the bound-action NAME constants as a renderer-local nav action — see Phase 1 note), `src/renderer/JiraPanel.tsx` (back row + `view`/`selectedIssueKey`/`originList` state + `onAction` intercept), `docs/ARCHITECTURE.md` (§4.9 note) |
| Tests to modify   | `src/shared/validate.test.ts` (new `validateRequestIssueDetail` cases), `src/renderer/jiraCatalog/logic.test.ts` (if a pure helper is added) |

### Contract note — `jira.openDetail` is a RENDERER-LOCAL nav action, not a main-dispatched `jira.*` write

The existing `jira.*` namespace (`JiraBoundAction`) is reserved for actions main intercepts at the
`ui:action` boundary and dispatches via `JiraActionDispatcher` (transition/comment/create/update).
`jira.openDetail` is DIFFERENT: it is intercepted in the RENDERER (`JiraPanel.onAction`) and never
forwarded to main, so `JiraActionDispatcher` must NOT treat it as a write. Two clean options for the
plan/interface to pick from (call out, do not silently choose):
- **(A)** Define `jira.openDetail` as its own constant in `src/renderer/` (renderer-local), NOT added
  to `JiraBoundAction`. Then `isJiraBoundActionId('jira.openDetail')` would return `true` (it starts
  with `jira.`) — but it never reaches main because the renderer intercepts it first and returns
  `true`. To be safe against any path where it leaks to main, `validateJiraBoundAction` already
  returns `null` for an unknown `jira.*` name (warn + ignore, no write) — so a leak is a no-op, not a
  bug. This matches Slack's `SLACK_OPEN_CHANNEL_ACTION` (a renderer-local constant, not a write).
- **(B)** Use a NON-`jira.`-prefixed action name (e.g. `openDetail` or `jiraNav.openDetail`) so it can
  never be mistaken for the reserved write namespace.

**Recommendation: (B)** — a non-`jira.`-prefixed name (mirroring how Slack uses a dedicated
`SLACK_OPEN_CHANNEL_ACTION` constant outside any main-dispatched namespace) so the reserved `jira.*`
write namespace stays unambiguous and there is zero chance of a navigation click being mistaken for a
write. The constant lives renderer-side (e.g. in `jiraCatalog/` next to `PATH_*`). The interface step
finalizes the exact string; the spec FRs are agnostic to it.

---

## Implementation Checklist

> UI-bearing feature: after this plan is approved, a `design` step (designer agent) produces
> `.sdd/designs/jira-ticket-detail-v1.md` for the back-row chrome + the TicketCard hover/click
> affordance (paralleling Confluence's `ChevronLeft` back row) before interface work.

### Phase 1 — Interface (shared types + IPC contract)  ·  FR-003, FR-010, FR-011

- [x] Read the spec; confirm OQ-1 resolved to option (1) (re-run originating read) and OQ-2 to
      panel-chrome back row (both settled by the user) — no open questions remain.
- [x] `src/shared/ipc.ts`: add `RequestIssueDetail: 'jira:requestIssueDetail'` to `JiraChannelName`
      (R→M `send`), doc comment paralleling `RequestSearchView`: deterministic, fire-and-forget,
      surface arrives via `ui:render` `target:'jira'` as an unsolicited frame, never blocks, no token
      on the payload. (FR-003/FR-010)
- [x] `src/shared/ipc.ts`: add `export interface JiraRequestIssueDetailPayload { issueKey: string }`
      — the ONLY field; no token/secret (FR-010). Non-empty `issueKey` enforced by the validator.
- [x] `src/shared/ipc.ts`: add `requestIssueDetail(payload: JiraRequestIssueDetailPayload): void` to
      `JiraApi` (fire-and-forget, mirrors `requestSearchView`).
- [x] Decide the renderer-local nav action name per the contract note (recommend non-`jira.`-prefixed,
      option B). Added `JIRA_OPEN_DETAIL_ACTION = 'jiraNav.openDetail'` as a renderer constant in
      `src/renderer/jiraCatalog/logic.ts` (re-exported from `index.ts`). NOT added to `JiraBoundAction`.
      (FR-001/FR-002)
- [x] Review the new types against the spec — no invented properties (only `issueKey`).

### Phase 2 — Validator + preload  ·  FR-011, FR-010

- [x] `src/shared/validate.ts`: add `validateRequestIssueDetail(raw, warn?)` returning
      `JiraRequestIssueDetailPayload | null`. Requires an object with a NON-EMPTY (trim-checked) string
      `issueKey`; rejects a non-object / non-string / empty/whitespace `issueKey` (warn-and-ignore).
      Unlike the search validator (empty = default), an empty `issueKey` here is invalid. (FR-011)
- [x] `src/preload/index.ts`: add `requestIssueDetail(payload)` to `jiraApi`, sending
      `JiraChannelName.RequestIssueDetail` with `{ issueKey }` (mirror `requestSearchView`).
      NOTE (CLAUDE.md): preload changes require a full `npm run dev` restart, not HMR.

### Phase 3 — Main handler  ·  FR-003, FR-006, FR-007, FR-008, FR-010, FR-011

- [x] `src/main/index.ts`: added `async function handleJiraIssueDetail(issueKey: string)` —
      `jiraManager.getIssue({ issueKey })` in try/catch (throw → recoverable Notice); `ok` →
      `buildIssueDetailSurface(result.data)` with fresh requestId + `target:'jira'`;
      `reconnect_needed`/`not_connected` → push nothing (FR-008); any other → `buildNoticeSurface`
      error (FR-007). Mirrors `handleJiraView`; guards `if (!jiraManager) return`. (FR-003/FR-007/FR-008)
- [x] `src/main/index.ts`: registered the `RequestIssueDetail` `ipcMain.on` handler: validate via
      `validateRequestIssueDetail`; valid → `void handleJiraIssueDetail(payload.issueKey)`; invalid →
      warned + ignored. Fire-and-forget. (FR-011)
- [x] Confirmed: the issueKey is non-secret and only logged inside the validator's warn path; the token
      stays in main (no payload/surface carries it). (FR-010)

### Phase 4 — Renderer (catalog click + panel chrome)  ·  FR-001, FR-002, FR-004, FR-005, FR-009, FR-012, FR-013

- [x] `src/renderer/jiraCatalog/components.tsx`: made `TicketCard` clickable via the Slack
      `ChannelList`/`ChannelRow` pattern — the `<button>` wrapper + `useDispatchAction` emit live in
      `IssueList` (which already has `surfaceId`/`componentId`), keeping `TicketCard` display-only with
      an `actionable` prop toggling `cursor-pointer`+`hover:bg-accent/40` (§2.1/§2.2). The actionable
      branch dispatches `JIRA_OPEN_DETAIL_ACTION` with `context: { issueKey }` only when
      `isOpenDetailEmittable(issueKey)` (non-empty key); the `—` placeholder is an inert card (no
      button, not in tab order). (FR-001)
- [x] Added `isOpenDetailEmittable(issueKey)` to `src/renderer/jiraCatalog/logic.ts` + a
      `logic.test.ts` case (node-testable split). (FR-001)
- [x] `src/renderer/JiraPanel.tsx` (`ConnectedBody`): added `view: { kind:'list' } | { kind:'detail';
      issueKey }` state and an `originListRef: { kind:'default' } | { kind:'search'; jql }` ref. Origin
      set to `search` (with raw JQL) on `JqlSearchBox.onSubmit`; defaults to `default` (reset on tab
      change). (FR-005)
- [x] `src/renderer/JiraPanel.tsx`: passed `onAction={handleSurfaceAction}` to `ActiveTabSurface`. The
      handler intercepts `JIRA_OPEN_DETAIL_ACTION` (reads `action.context.issueKey` with a string
      guard, sets the detail view, fires `requestDefaultInActiveTab(() =>
      window.cosmos.jira.requestIssueDetail({ issueKey }))`, returns `true`); any other action returns
      `false` so `jira.transition`/`jira.comment` writes still reach main. (FR-002/FR-009/FR-012)
- [x] `src/renderer/JiraPanel.tsx`: rendered the native back row (outside the `A2UIProvider`) when
      `view.kind === 'detail'` — byte-for-byte Confluence's `ChevronLeft` ghost-`icon-sm` row, label
      `Back to list`. `goBackToList` re-runs the originating read via the in-place seam
      (`requestSearchView({ jql })` for a search origin, else `requestDefaultView()` — also the
      no-origin fallback) and resets `view` to `list`. (FR-004/FR-005)
- [x] Post-write re-push keeps the back row: a `jira.transition`/`jira.comment` write returns `false`
      from `handleSurfaceAction` so it reaches main; `view` is untouched by the re-push, so the back row
      persists across it. (FR-012)
- [x] Left the NL `PromptComposer`, `JqlSearchBox`, and default-view-on-activation effect otherwise
      unchanged. `view`/`originListRef` reset to `list`/`default` on every `activeTabId` change so a
      tab's detail chrome never bleeds across tabs. (FR-013, edge: detail bleed)

### Phase 5 — Tests  ·  FR-011 (+ optional FR-001 guard)

- [x] `src/shared/validate.test.ts`: `validateRequestIssueDetail` — valid `{ issueKey: 'PROJ-1' }`
      returns the payload (and drops extra keys incl. a token); non-object, non-string `issueKey`, and
      EMPTY/whitespace `issueKey` return `null` + warn. (FR-011/FR-010)
- [x] `src/renderer/jiraCatalog/logic.test.ts`: `isOpenDetailEmittable` (non-empty → true;
      absent/empty/whitespace → false) + a guard that `JIRA_OPEN_DETAIL_ACTION` is NOT `jira.*`-prefixed.
      (FR-001)
- [ ] Manual/dev verification — NOT exercised by this developer session (needs a human + a full
      `npm run dev` restart for the preload change). See the GUI caveat in the wrap-up report.

### Phase 6 — Docs  ·  architecture coherence

- [x] `docs/ARCHITECTURE.md` §4.9 already documents click-to-open ticket detail (lines 414-423):
      clickable `TicketCard` → renderer-local nav action via the `ActiveTabSurface` `onAction` seam →
      `jira:requestIssueDetail { issueKey }` → main `getIssue` → `buildIssueDetailSurface` → unsolicited
      `target:'jira'` frame; native back row (Confluence `ChevronLeft` precedent) re-runs the
      originating read; read-only, no new scope, references §4.11. The implementation matches it
      verbatim — no doc edit was required.
- [x] Marked items done; deviations recorded below.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-07 — Click wiring placed on `IssueList`, not `TicketCard` (Slack `ChannelList` parity).**
  The plan Phase 4 said "make `TicketCard` clickable … add `useDispatchAction`". Implemented exactly
  to the design (§1.3) instead: the `<button>` wrapper + `useDispatchAction` dispatch live in
  `IssueList` (the container that already receives a stable `surfaceId`/`componentId`), and
  `TicketCard` stays a display component with a new `actionable?: boolean` prop that toggles the
  `cursor-pointer`+`hover:bg-accent/40` treatment. This is the Slack `ChannelList`/`ChannelRow`
  precedent the design mandated (the row component is display-only; the list owns the button + emit).
  No behavioral change vs. the plan — the same `JIRA_OPEN_DETAIL_ACTION` with `context: { issueKey }`
  is emitted only for a non-empty key.
- **2026-06-07 — Nav action name = `jiraNav.openDetail` (contract-note recommendation B).** Defined
  `JIRA_OPEN_DETAIL_ACTION = 'jiraNav.openDetail'` (non-`jira.`-prefixed) in `jiraCatalog/logic.ts`,
  re-exported from `jiraCatalog/index.ts`. Confirmed it does not collide with the reserved `jira.*`
  write namespace (a `logic.test.ts` assertion guards this).
- **2026-06-07 — `originList` is a ref, `view` is state.** `view` drives the back-row render so it is
  `useState`; `originList` is read only at click/back time (never needs a re-render) so it is a
  `useRef`. Both are panel-level chrome over the active tab and are reset to `list`/`default` on every
  `activeTabId` change (FR-013 edge: detail bleed across tabs).
- **2026-06-07 — Phase 6 docs were already written.** `docs/ARCHITECTURE.md` §4.9 already contained an
  accurate description of this feature (added by the architect during planning); it matches the
  implementation verbatim, so no doc edit was made.

---

## Revision (#86) Implementation Checklist — view-swap → right-side dock

> Pending. **A `design` step (designer agent) MUST run first** to produce/refresh
> `.sdd/designs/jira-ticket-detail-v1.md` for the Jira detail dock, reusing the calendar
> `EventDetail` dock design (`.sdd/designs/calendar-event-detail-v1.md`) as the direct template
> (`@container` two-pane, `32rem` breakpoint, `clamp(18rem,42%,28rem)` side-by-side, `max-w-[22rem]`
> drawer + `bg-black/40` scrim, header X). The mechanism is fixed in the Revision section above;
> recommended approach is **R-A** (route the detail surface into a per-tab dock slot, host it in a
> second `A2UIProvider` inside the dock; list surface untouched). Confirm R-A vs R-B at the
> interface step. No new IPC channel, no new fetch, no new scope — `jira:requestIssueDetail` is reused.

### Revision Phase R1 — Design (designer)  ·  FR-002, FR-004

- [ ] Designer produces/refreshes `.sdd/designs/jira-ticket-detail-v1.md`: the dock shell copied from
      the calendar `EventDetail` dock (verbatim Slack tokens), the detail content layout (key/status,
      description, comments, transition + add-comment controls — the existing detail surface, now
      framed by the dock), the now-interactive ticket card's selected/retarget marking, and the
      narrow-drawer scrim. Dark-only, existing tokens + `components/ui/` primitives only.

### Revision Phase R2 — Renderer dock shell + per-tab dock state  ·  FR-002, FR-004, FR-005, FR-006, FR-014

- [ ] `src/renderer/JiraPanel.tsx`: REMOVE the `view: {kind:'list'|'detail'}` state, the native
      `ChevronLeft` "Back to list" row (~lines 490-503), `goBackToList`, and the `originListRef`
      usage. Replace with per-tab `detailIssueKey: string | null` (and, for R-A, the `detailSurface`
      slot — see R3) set by `handleSurfaceAction` and reset to `null` on `activeTabId` change and on
      disconnect (FR-014). The `JqlSearchBox`/`PromptComposer`/default-view effect stay; the search-box
      no longer needs to clear a detail `view`.
- [ ] `src/renderer/JiraPanel.tsx`: wrap the connected content region in the `@container/<jirabody>`
      two-pane (copy the calendar `@container/calbody` shell verbatim): the existing `A2UIProvider`
      list pane as `min-w-0 flex-1` (stays mounted/visible), and the dock (mounted only when
      `detailIssueKey != null`) as the Slack/calendar dock div (`absolute inset-y-0 right-0 z-20
      w-full max-w-[22rem] shadow-lg … @[32rem]:relative @[32rem]:w-[clamp(18rem,42%,28rem)]
      @[32rem]:shrink-0 @[32rem]:border-l …`) over a `bg-black/40 @[32rem]:hidden` scrim. Dock header
      carries the X (`Button variant="ghost" size="icon-sm"`, `onClick` clears `detailIssueKey`);
      scrim `onClick` also clears it. Clicking another card retargets (sets a new `detailIssueKey`),
      never stacks. (FR-002/FR-004/FR-005)

### Revision Phase R3 — Detail content into the dock  ·  FR-003 (kept), FR-007, FR-012

- [ ] **R-A (recommended):** route the `jira:requestIssueDetail` unsolicited frame's surface into the
      active tab's NEW `detailSurface` slot instead of overwriting `tab.surface`. This needs a small
      `useGenerativePanelTabs` seam (or a JiraPanel-local subscription) so the detail frame lands in
      the dock slot, leaving the list `surface` untouched. Host `detailSurface` in a SECOND
      `A2UIProvider key={tab.id+':detail'} catalog={jiraCatalog}` inside the dock body, so the
      transition/add-comment `jira.*` write controls keep working unchanged (a write re-pushes a fresh
      detail into the dock slot; the dock stays open — FR-012). The in-flight detail read shows the
      existing per-tab loading indication scoped to the dock (FR-006).
      **R-B (alternative):** a native `JiraTicketDetail` dock component fed a `JiraIssueDetail` DTO —
      only if the design chooses native; rebuild the write controls accordingly. Decide at interface.
- [ ] Keep `handleSurfaceAction` intercepting `JIRA_OPEN_DETAIL_ACTION` (returns `true`, sets
      `detailIssueKey` + fires `requestIssueDetail`); any other action returns `false` so `jira.*`
      writes still reach main (FR-012). The `composed`/`backNavTarget` snapshot logic is DELETED — the
      list surface is never clobbered now, so there is nothing to snapshot/restore.

### Revision Phase R4 — Tests + docs  ·  FR-014, architecture coherence

- [ ] Add/adjust pure-logic tests for the per-tab dock open/retarget/close + reset-on-tab-switch
      (the dock-state reducer or helper, node-testable split). Remove/replace the obsolete
      `backNavTarget`/`JiraBackOrigin` tests (`src/renderer/jiraBackNav.test.ts`) — that module is
      retired by the dock.
- [ ] `docs/ARCHITECTURE.md` §4.9: rewrite the "Clicking a ticket opens its detail in place" passage
      (lines ~520-536) to the **right-side detail dock** idiom (list stays mounted beside the detail;
      no surface clobber; no `backNavTarget` snapshot/restore; dock is transient per-tab, X + scrim
      dismiss; reuses the Slack/calendar side-dock shell). Remove the now-incorrect "unsolicited frame
      OVERWRITES the active tab's surface / `backNavTarget` / `JiraBackOrigin` / `jiraBackNav.ts`"
      lesson, replacing it with the dock lesson (keeping the list mounted dissolves the clobber).
- [ ] Manual/dev verification (human + full `npm run dev` restart) — same GUI caveat as v1.
