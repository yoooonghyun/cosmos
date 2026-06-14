# Spec: Confluence Page Detail (click-to-open) — v1

**Status**: Implemented (native-reuse approach)
**Created**: 2026-06-14
**Supersedes**: —
**Related plan**: .sdd/plans/confluence-page-detail-nav-v1.md

> **DESIGN PIVOT (post-spec, user-directed).** The original spec below specified
> opening the detail by pushing an UNSOLICITED main-composed A2UI page-detail
> SURFACE over a NEW `confluence:requestPageDetail` IPC channel + main handler +
> Confluence surface builders (mirroring the Jira `jira:requestIssueDetail`
> precedent). The user rejected that as overengineered: *"왜 gen ui를 그리는거지?
> 그냥 confluence list component 재활용했으면 상세 페이지까지 보낼수 있잖아"* —
> reuse the EXISTING native `PageDetail` browser component instead of composing a
> generative surface. **As built**, the generated-UI row click sets a
> renderer-local overlay `{ pageId, title }` in `ConfluencePanel`, which renders
> the existing native `PageDetail` (which already reads via
> `window.cosmos.confluence.getPage` directly in the renderer) with a native back
> row. **No new IPC channel, no main-side handler, no surface builder, no
> fire-or-defer correlation.** FR/SC IDs below marked **[SUPERSEDED]** describe
> the abandoned surface-push design; see the "As built" section for what shipped.

---

## Grounding

> Direct investigation run for this spec (mandatory handoff section).

**codegraph_explore / codegraph_search:**

- `ConfluencePanel confluenceCatalog confluenceSurfaceBuilder confluenceManager getPage` — confirmed the Confluence panel renders per-tab `target:'confluence'` generative surfaces via `useGenerativePanelTabs`, keeps a per-tab native-base browser nav (`ConfluenceView = {kind:'search'} | {kind:'page'; pageId; title}`), and the native base already opens a page detail via the renderer-side `window.cosmos.confluence.getPage` invoke (NOT a request channel). `ConfluencePanel` does NOT pull `requestDefaultInActiveTab` from the hook (Jira does).
- `jiraNav openDetail requestIssueDetail buildIssueDetailSurface jiraBackNav JiraPanel onAction detail back to list` — the full Jira precedent: `JIRA_OPEN_DETAIL_ACTION = 'jiraNav.openDetail'` (non-`jira.*`, intercepted in `JiraPanel.handleSurfaceAction`, returns `true`, never forwarded), `view`/`originListRef` chrome, `goBackToList`, the `beginNavLoad` skeleton floor, and tab-switch reset of detail chrome.
- `ipc.ts jira requestIssueDetail confluence searchContent defaultFeed getPage ConfluencePageDetail ConfluenceSearchResult` — verified `JiraChannelName.RequestIssueDetail = 'jira:requestIssueDetail'` + `JiraRequestIssueDetailPayload { issueKey }`; `ConfluenceChannelName` has GetStatus/Connect/Disconnect/SearchContent/DefaultFeed/GetPage/StatusChanged but NO page-detail REQUEST channel. `ConfluenceSearchResult` already carries a stable `id` (the pageId); `ConfluencePageDetail { id,title,space?,body }`.
- `confluenceSurfaceBuilder buildSearchResultsSurface buildPageDetailSurface buildNoticeSurface pushSurfaceToActiveTab` — `buildNoticeSurface` today lives in `jiraSurfaceBuilder.ts` (Jira `SURFACE_DEFAULT_VIEW`); there is NO Confluence page-detail SURFACE builder and no Confluence notice builder. The Confluence catalog already has a bound `PageDetail` component (title/space/body/loading/error) used by the generative adapter.
- main `index.ts` — `ipcMain.on(JiraChannelName.RequestIssueDetail …) → validateRequestIssueDetail → handleJiraIssueDetail(issueKey)`; `ipcMain.handle(ConfluenceChannelName.GetPage …) → confluenceManager.getPage`. `ConfluenceManager.getPage(params) → ConfluenceResult<ConfluencePageDetail>` (read-only, refresh + reconnect_needed handling via `run()`).

**memory_recall / memory_smart_search:**

- `jira-ticket-detail in-place detail nav back to list generative panel` — no stored observations returned.
- `confluence page detail jira detail surface builder requestIssueDetail back nav` — no stored observations returned. (No prior cross-session decision on this feature; the precedent is the on-disk `jira-ticket-detail-v1` spec/plan/design, which this spec mirrors. New durable decision persisted via `memory_save` after writing.)

**ARCHITECTURE.md §4.9** — read the Jira click-to-open detail paragraph (the seam this mirrors) and the Confluence-panel paragraph (read-only generative + native search/open-page browser base). No new architectural primitive is introduced; this spec applies the established Jira detail seam to the Confluence panel. §4.9 gets one sentence noting the Confluence analog (see plan/wrap-up).

---

## Overview

In the connected Confluence panel, clicking a document row in a **generated-UI list** (an agent-composed
`SearchResultList`) opens that page's full detail **in place in the active tab** — the list surface is
replaced by the page's detail (title, space, body) — with a visible **"back to list"** affordance that
returns the tab to the list it came from. This is the Confluence analog of the shipped Jira
`jira-ticket-detail-v1`: it reuses the same renderer-local nav-action seam, a sibling request IPC
channel, and the unsolicited target-routed frame + fire-or-defer discipline, and stays strictly
read-only (the existing `getPage` read; no new OAuth scope).

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Open a page's detail by clicking it · P1

**As a** Confluence user in cosmos
**I want to** click a document row in a generated-UI list
**So that** I can read that page's full detail (title, space, body) without leaving the panel

**Acceptance criteria:**

- Given a connected Confluence panel whose active tab shows a generated-UI list of pages (an agent-composed
  `SearchResultList`), when I click a row that has a page id, then the active tab's surface is replaced by
  that page's full detail (title, space chip, readable body) — the same detail shape the Confluence
  `PageDetail` catalog component already renders.
- Given I clicked a row, when the page-detail read is in flight, then the active tab shows a loading
  indication (the existing per-tab loading state) until the detail (or a Notice) lands.
- Given the detail is shown, when I look at it, then a clear **"back to list"** affordance (e.g.
  "← Back to list") is visible.
- Given a page detail is open, when I do nothing else, then the detail is display-only (no write control,
  no action that mutates Confluence) — the panel stays read-only.

### Return to the list with "back" · P1

**As a** Confluence user viewing a page detail
**I want to** click "back to list"
**So that** I return to the generated list I was browsing without re-asking

**Acceptance criteria:**

- Given I opened a page detail on top of a pinned generated-UI (`composed`) list surface, when I click
  "back to list", then the active tab shows that exact generated list again (restored verbatim, no
  re-fetch), because the unsolicited detail frame had overwritten it.
- Given "back to list" is shown and I activate it, then the back affordance always leads somewhere
  (never a dead end) — when no originating list was captured it falls back to a sensible base view.

### Stay read-only · P1

**As a** Confluence user
**I want to** click a page row without granting new permissions
**So that** browsing detail is safe and requires no reconnect

**Acceptance criteria:**

- Given a connected Confluence panel, when I click a page row to open its detail, then no new OAuth scope
  is required, the click runs a read-only `getPage` (not a write, not an `AgentRunner` run), and no
  token/secret appears on any IPC payload, bridge frame, or rendered surface.

### Detail read fails calmly · P2

**As a** Confluence user
**I want to** click a page whose detail read fails
**So that** I see a recoverable message instead of a broken panel

**Acceptance criteria:**

- Given I click a page row and `getPage` fails with a non-`reconnect_needed` kind (e.g. `network`,
  `rate_limited`), then the active tab shows a single calm, recoverable `Notice` (never a crash, never a
  raw stack trace), and I can go back to the list and retry.
- Given the read fails with `reconnect_needed` / `not_connected`, then no detail surface is pushed and the
  native Connect/Reconnect affordance takes over via `confluence:statusChanged` (the existing carry-over
  behavior).

### Click does not disturb an in-flight compose · P2

**As a** Confluence user
**I want to** click a page row while a natural-language compose is generating
**So that** neither result is corrupted

**Acceptance criteria:**

- Given an NL compose is awaiting its render frame for this panel, when I click a page row, then the
  page-detail surface does not overwrite or race the awaited compose frame — the detail request is ordered
  against the in-flight compose using the existing fire-or-defer correlation discipline (the shared
  originating-tab slot).

## Functional Requirements

> Every requirement traces to a scenario above or a named precedent (`jira-ticket-detail-v1`, §4.9, §4.11).

| ID     | Requirement |
|--------|-------------|
| FR-001 | A document row in a generated-UI Confluence list (`SearchResultList`'s `SearchResultRow`) MUST be clickable when it carries a non-empty page id. Clicking it MUST carry that page id to a renderer-local open-detail nav action. (Traces: "Open a page's detail by clicking it"; mirrors Jira `FR-001` / clickable `TicketCard`.) |
| FR-002 | A row with no/empty page id MUST be INERT — no cursor affordance, no hover, no keyboard activation, and it MUST emit no open-detail action. (Traces: hard constraint "row with no id must be inert"; mirrors Jira's `—`/no-key inert card and `shouldEmitOpenDetail`.) |
| FR-003 | The open-detail action MUST be a renderer-local nav action (a dedicated `confluenceNav.openDetail`-style name, NOT in the `confluence.*`/reserved namespace) that the Confluence panel's `ActiveTabSurface` `onAction` seam intercepts, returns handled, and NEVER forwards to main or the agent. Any OTHER action MUST still flow through unchanged. (Traces: "Open a page's detail"; mirrors Jira `JIRA_OPEN_DETAIL_ACTION` / the Slack open-channel onAction seam, §4.9.) |
| FR-004 | Clicking a row MUST open that page's detail **in place in the active tab** — replacing the active tab's current surface with the detail surface. It MUST NOT open a new tab. (Traces: "Open a page's detail"; mirrors Jira `FR-002` in-place.) |
| FR-005 | Opening the detail MUST send only the clicked page id to main over a NEW sibling IPC channel (the Confluence analog of `jira:requestIssueDetail`, carrying `{ pageId }`). Main MUST run a native, deterministic read-only `getPage` for that page id, compose the result into a page-detail surface, and push it as an UNSOLICITED `target:'confluence'` frame into the active tab. It MUST NOT invoke the AI agent / `AgentRunner`. (Traces: "Open a page's detail" + "Stay read-only"; mirrors Jira `FR-003` and `jira:requestIssueDetail` → `handleJiraIssueDetail` → `buildIssueDetailSurface`.) |
| FR-006 | The detail surface MUST present a visible **"back to list"** affordance (panel chrome outside the A2UI host — the Confluence `ChevronLeft` back-row precedent) that returns the active tab to the list it was opened from. (Traces: "Return to the list with back"; mirrors Jira `FR-004` native back row.) |
| FR-007 | "Back to list" MUST restore the list the detail was opened from. When the detail was opened on top of a PINNED generated-UI (`composed`) list surface, "back" MUST restore that snapshot **verbatim** (no re-fetch, no loading flash), because the unsolicited detail frame overwrote it (mirrors `jira-detail-back-loses-generated-ui-v1` and the `JiraBackOrigin`/`backNavTarget` restore discipline). The affordance MUST always lead somewhere (never a dead end): when no originating list was captured it MUST fall back to a sensible base view. (Traces: "Return to the list with back".) |
| FR-008 | While the detail read is outstanding, the active tab MUST show the existing per-tab loading indication, cleared when the detail surface (or a Notice) lands. (Traces: in-flight acceptance criterion; mirrors Jira `FR-006` / the per-tab `loadingDefault` + nav-load skeleton floor.) |
| FR-009 | A detail read that fails with a non-`reconnect_needed` kind MUST surface as a single recoverable `Notice` in the active tab; the panel MUST NOT crash, and the user MUST be able to go back and retry. (Traces: "Detail read fails calmly"; mirrors Jira `FR-007` / the Confluence catalog's `Notice` component.) |
| FR-010 | A detail read that fails with `reconnect_needed` / `not_connected` MUST push no surface; the `ConfluenceManager`'s `confluence:statusChanged` routes the panel to the native Connect/Reconnect affordance. (Traces: "Detail read fails calmly"; mirrors Jira `FR-008`.) |
| FR-011 | The new IPC payload MUST be validated at the main-process boundary; an invalid or empty-`pageId` payload MUST be warned-and-ignored (never crash, no read) — consistent with all cosmos IPC. (Traces: edge cases + hard constraint; one typed contract in `src/shared/ipc.ts`, §4.5/CLAUDE.md IPC invariant; mirrors Jira `FR-011` / `validateRequestIssueDetail`.) |
| FR-012 | The open-detail operation MUST be read-only: it requires no new OAuth scope and adds no write path. The renderer MUST send only the page-id operation over IPC; main attaches the token. No token/secret may appear on any IPC payload, type, bridge frame, MCP result, or A2UI surface (cosmos-wide token-in-main-only invariant). (Traces: "Stay read-only"; mirrors Jira `FR-010`.) |
| FR-013 | The open-detail request MUST integrate with the existing fire-or-defer discipline so its unsolicited `target:'confluence'` frame never races an in-flight NL compose for the shared originating-tab slot: fire immediately when the correlation is idle, otherwise defer and flush when the in-flight run resolves (§4.11). (Traces: "Click does not disturb an in-flight compose"; mirrors Jira `FR-009` / `requestDefaultInActiveTab`.) |
| FR-014 | The detail chrome (the "back to list" row + detail view state) MUST be scoped to the active tab and reset on a tab switch / new tab, so an open detail's back row never bleeds across tabs. (Traces: in-place-per-tab consistency; mirrors Jira `FR-013` detail-bleed edge / the `activeTabId`-keyed reset.) |
| FR-015 | The existing Confluence panel surfaces MUST remain present and behave unchanged alongside this feature: the NL `PromptComposer`, the native search/default-feed browser base (including its own existing native search-result → page-detail drill-in with `ChevronLeft`), per-tab tabs, refresh, and pagination. (Traces: non-regression of the §4.9 Confluence panel.) |

## Edge Cases & Constraints

- **Row with no/empty page id** → the row is inert (no cursor/hover/keyboard), emits no action; if a
  malformed open-detail payload still reaches the boundary it is warned-and-ignored (FR-002/FR-011); the
  panel does not crash. (`ConfluenceSearchResult.id` is the pageId; rows already key on `result.id ?? i`.)
- **`getPage` error (`network`/`rate_limited`)** → a single recoverable `Notice` in the active tab
  (FR-009); the user can go back to the list and retry.
- **`reconnect_needed` / `not_connected` mid-click** → push nothing; native Connect/Reconnect takes over
  via `confluence:statusChanged` (FR-010).
- **Click while an NL compose is awaiting its frame** → the detail request is fired-or-deferred against
  the shared correlation slot (FR-013); it never overwrites an awaited compose frame.
- **Back restoring a composed/bound generated list** → the unsolicited detail frame OVERWRITES the active
  tab's surface, so the generated list can only be captured at detail-open time. "Back" restores that
  snapshot verbatim (FR-007). If the originating list was a BOUND (refreshable) generated surface, the
  restore MUST preserve its refreshable state (the Jira precedent restores `composed:true`; the
  Confluence analog must likewise keep the surface refreshable after restore — see OQ-1). When no list was
  captured, "back" falls back to a sensible base view rather than stranding the user.
- **Page detail has no readable body** → the existing `PageDetail` "This page has no readable body."
  empty state applies; this is not an error (no Notice).
- **Clicking a row inside a page detail** → a `ConfluencePageDetail` carries no nested page list, so there
  is no row-in-detail click to handle; out of scope.
- **Out of scope:** opening detail in a NEW tab (explicitly rejected — in-place only); a forward/redo or
  multi-level navigation stack (single back-to-list only); deep-linking to a page by URL; routing the
  click through the AI agent; any new write capability; changing the native-base browser's own existing
  search → page-detail drill-in (that already exists and stays as-is); rendering Confluence macros / rich
  body (body stays flattened plain text, design Q2).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking a document row (with a page id) in a connected Confluence panel's generated-UI list replaces the active tab's surface with that page's full detail (title, space, readable body). |
| SC-002 | The detail surface shows a "back to list" affordance; activating it returns the active tab to the generated list the detail was opened from (the composed list restored verbatim), and never dead-ends. |
| SC-003 | A row with no page id is inert (no cursor/hover/keyboard activation) and emits no open-detail action. |
| SC-004 | Opening a page detail runs a read-only `getPage` (no agent run, no new OAuth scope) and exposes no token/secret on any payload, frame, or surface; an invalid/empty `pageId` payload is warned-and-ignored at the main boundary. |
| SC-005 | A failed detail read (non-reconnect) yields a calm recoverable Notice in the active tab; the app never crashes; the user can return to the list and retry. A reconnect-needed failure routes to the native Connect/Reconnect and pushes no surface. |
| SC-006 | A page row clicked while an NL compose is awaiting its frame does not corrupt either result (the detail frame is fired-or-deferred per the existing correlation discipline). |
| SC-007 | The Confluence panel's existing surfaces (NL composer, native search/default-feed browser + its own page-detail drill-in, tabs, refresh, pagination) continue to work unchanged. |

---

## Open Questions

- [ ] **OQ-1 — Restoring a BOUND (refreshable) generated list on "back to list".** The Jira precedent
  restores a `composed` surface verbatim and re-marks it `composed:true` so its generated-UI gates re-apply.
  Confluence's generated lists are BOUND/refreshable (`confluence-generative-adapter-v1`: a
  `SearchResultList` reads rows/flags from the data model and renders the shared `RefreshButton`). The
  *behavioral* requirement is settled — back restores the list the user left, verbatim, with no re-fetch
  (FR-007) — but whether the restored bound surface should be marked `restored:true` to re-kick its
  refresh (per the `refresh-repaint`/`refreshable-custom-generative-ui` restore discipline) vs. restored as
  a static snapshot is a plan/how concern. **Recommendation:** restore preserving the surface's refreshable
  state (mark `restored:true` for a bound origin so the existing restore-rekick path re-registers it),
  matching the documented bound-surface restore discipline. This does NOT block the plan; confirm only if
  the user wants a static (non-refreshing) restore.

- [ ] **OQ-2 — Source of the clickable list (agent-composed only vs. also the native base).** The user
  asked specifically about "the list gen-ui generated" (the agent-composed `SearchResultList`). The native
  search/default-feed browser base ALREADY has its own search-result → page-detail drill-in (the
  `ChevronLeft` row in `ConfluencePanel`), so this feature's click-to-open targets the GENERATED-UI list
  (`SearchResultList`), leaving the native base browser unchanged (FR-015, Out of scope). This is taken as
  settled from the user ask; noted only so the plan does not accidentally duplicate the native drill-in.
  Not blocking.

---

## As Built (native-reuse approach — supersedes the surface-push design above)

The user directed reuse of the EXISTING native `PageDetail` browser component
instead of composing a main-side generative surface. What actually shipped:

- **Row click (renderer-only).** `SearchResultList.SearchResultRow` is clickable
  when its result carries a non-empty page id (`isOpenDetailEmittable`). Clicking
  dispatches a renderer-local nav action `CONFLUENCE_OPEN_DETAIL_ACTION =
  'confluenceNav.openDetail'` carrying `{ pageId, title }`. A row with an empty id
  is inert (no cursor/hover/wrapping button, no emit). (Satisfies FR-001/FR-002.)
- **onAction intercept.** `ConfluencePanel.handleSurfaceAction` (passed to
  `ActiveTabSurface` `onAction`) intercepts `confluenceNav.openDetail`, reads
  `pageId`/`title` from `action.context`, sets renderer-local overlay state
  `genUiPage = { pageId, title }`, and returns `true` (handled, never forwarded to
  main/agent). Any other action returns `false` and flows through unchanged.
  (Satisfies FR-003.)
- **Detail render (native component reuse, in place).** When `genUiPage` is set,
  the panel renders a native back row (`ChevronLeft` Button + title) plus the
  EXISTING native `PageDetail` component keyed on `pageId`. `PageDetail` reads
  `window.cosmos.confluence.getPage({ pageId })` DIRECTLY in the renderer (the same
  read the native base browser uses) — its existing loading / empty-body / error /
  reconnect states apply unchanged. No new tab. (Satisfies FR-004/FR-008/FR-009/
  FR-010, read-only FR-012; the empty-body and reconnect edge cases.)
- **Back.** The back row's `onClick` clears `genUiPage`, returning the tab to its
  prior surface (the generated list is the live A2UI host underneath the overlay,
  so it is restored verbatim with no re-fetch). (Satisfies FR-006/FR-007.)
- **Per-tab reset.** `useEffect(() => setGenUiPage(null), [activeTabId])` clears the
  overlay on tab switch so an open detail never bleeds across tabs. (Satisfies
  FR-014.) Existing panel surfaces (composer, native base browser + its own
  drill-in, tabs, refresh, pagination) unchanged. (Satisfies FR-015.)

**[SUPERSEDED] FR/SC no longer applicable** (were specific to the surface-push
design): FR-005 (new `confluence:requestPageDetail` IPC channel + main `getPage`
compose + unsolicited target-routed frame), FR-011 (main-boundary validation of
that payload), FR-013 (fire-or-defer correlation for the unsolicited frame), and
SC-004's "warned-and-ignored at the main boundary" / SC-006 (compose-race). These
do not apply because the click never reaches main: the detail read is the
renderer's existing `getPage` invoke, ordered by React state, with no unsolicited
frame to race. Read-only / no-new-scope / no-token-in-renderer (the substance of
FR-012, SC-004) still hold — `getPage` was already a read-only renderer invoke
with the token attached in main.

**Files changed (as built):**
- `src/renderer/confluenceCatalog/logic.ts` — `CONFLUENCE_OPEN_DETAIL_ACTION`,
  `isOpenDetailEmittable`.
- `src/renderer/confluenceCatalog/logic.test.ts` — tests for the above.
- `src/renderer/confluenceCatalog/components.tsx` — clickable `SearchResultRow`
  (`actionable` prop), `SearchResultList.open(pageId, title)` dispatch.
- `src/renderer/ConfluencePanel.tsx` — `genUiPage` overlay state,
  `handleSurfaceAction`/`closeGenUiPage`, native back row + `PageDetail` render,
  per-tab reset.

No main/preload/IPC/shared/surface-builder files changed (the originally-modified
`confluenceSurfaceBuilder.ts`, `ipc.ts`, `validate.ts`, `preload/index.ts`,
`main/index.ts` were reverted to HEAD; net-new `confluenceBackNav.ts` removed).
