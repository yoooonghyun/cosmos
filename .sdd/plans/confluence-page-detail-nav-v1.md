# Plan: Confluence Page Detail (click-to-open) — v1

**Status**: SUPERSEDED by native-reuse approach — see spec "As Built"
**Created**: 2026-06-14
**Last updated**: 2026-06-14
**Spec**: .sdd/specs/confluence-page-detail-nav-v1.md

> **This plan is obsolete.** It plans the surface-push design (new
> `confluence:requestPageDetail` IPC channel, main handler, Confluence surface
> builders, fire-or-defer). The user directed reuse of the EXISTING native
> `PageDetail` component instead — the click sets a renderer-local overlay that
> renders `PageDetail` (which reads `getPage` directly in the renderer); no main/
> IPC/surface-builder work shipped. See the spec's "As Built" section for what was
> actually implemented and which files changed.

---

## Summary

Make a document row in a Confluence **generated-UI list** (`SearchResultList`'s `SearchResultRow`)
clickable so it opens that page's full detail **in place in the active tab**, with a native
"← Back" affordance that returns the tab to the generated list it was opened from. The whole path is
deterministic and read-only — clicking a row runs a native `confluence:getPage` read (NOT the AI agent)
and pushes a composed detail surface as an unsolicited `target:'confluence'` frame into the active tab.
This is the Confluence analog of the shipped `jira-ticket-detail-v1`; every seam is mirrored from it,
not invented.

The four gaps codegraph confirmed Confluence is missing (vs. Jira) are exactly what this plan fills:

1. **A request IPC channel** — `confluence:requestPageDetail { pageId }` (the analog of
   `jira:requestIssueDetail { issueKey }`). Today `confluence:getPage` is a renderer-`invoke` used only
   by the NATIVE base browser; there is no fire-and-forget "render this page's detail into the panel"
   trigger. Validated at the main boundary (reuse the `{ pageId }` non-empty shape that
   `validateConfluenceGetPage` already enforces).
2. **A Confluence page-detail SURFACE builder** — Confluence has no surface builder at all
   (`buildNoticeSurface`/`buildIssueDetailSurface` live in `jiraSurfaceBuilder.ts`, Jira-only). Add a
   small `src/main/confluenceSurfaceBuilder.ts` with a `buildPageDetailSurface(detail)` and a
   `buildConfluenceNoticeSurface(notice)`, emitting the Confluence catalog's existing `PageDetail` /
   `Notice` component vocabulary (static props — no binding; the click-detail surface is a one-shot
   read, not refreshable). The catalog components already exist and render title/space/body/empty/error.
3. **The renderer-local nav action + clickable/inert row** — a non-`confluence.*` `confluenceNav.openDetail`
   action (mirrors `JIRA_OPEN_DETAIL_ACTION = 'jiraNav.openDetail'` and the Slack open-channel seam),
   emitted by `SearchResultList` ONLY for a row with a non-empty page id (the inert row stays display-only,
   not in tab order), intercepted by `ConfluencePanel`'s `ActiveTabSurface` `onAction` handler, which
   returns `true` so it is never forwarded to main/agent.
4. **`requestDefaultInActiveTab` wired into `ConfluencePanel`** — the shared hook already exposes it
   (Jira uses it; Confluence currently destructures the hook WITHOUT it). Pull it out and use it to
   fire-or-defer the unsolicited detail frame so it never races an in-flight NL compose for the shared
   `originatingTabIdRef` slot (§4.11).

Plus a Confluence back-nav pure helper (`src/renderer/confluenceBackNav.ts`, mirroring `jiraBackNav.ts`):
the detail can be opened on top of a pinned generated-UI (`composed`) list surface, and the unsolicited
detail frame OVERWRITES that surface — so the panel snapshots the composed list AT detail-open time and
"back" restores the snapshot verbatim. Per the approved **OQ-1**, a restored BOUND surface is re-filed
with `restored: true` so `ActiveTabSurface`'s existing restore-refresh re-registers it in main and
re-kicks its refresh (it carries a `descriptor`/`bindings`). When no list was captured, back falls back
to the native base view (never a dead end). Per the approved **OQ-2**, only the agent-composed
`SearchResultList` becomes clickable; the native search/default-feed browser keeps its OWN existing
`ChevronLeft` page-detail drill-in untouched.

UI-bearing → a `design` step (designer agent) follows this plan before interface work.

### Chosen approach (and why)

- **Renderer-local bound-action intercept for the click** (chosen over a DOM `onClick` on the catalog
  component and over a deterministic `confluence.*` main-dispatched action — Confluence has NO
  deterministic dispatcher anyway). Opening a detail is renderer navigation that must update panel chrome
  (the back row + the detail view state), which main cannot set; and the SDK action pipeline
  (`useDispatchAction` → `A2UIRenderer onAction` → `ActiveTabSurface` → panel `onAction`) is the
  established seam the Jira panel already uses for this exact feature and Slack uses for open-channel nav.
  Reuse it: emit a NEW renderer-local action `confluenceNav.openDetail` carrying `context: { pageId }`,
  intercept it in `ConfluencePanel`'s `onAction`, return `true` (handled, not forwarded). Wire the
  `<button>` + `useDispatchAction` on `SearchResultList` (the container that already receives a stable
  `surfaceId`/`componentId`), keeping `SearchResultRow` display-only with an `actionable` prop — the
  Jira `IssueList`/`TicketCard` deviation, itself the Slack `ChannelList`/`ChannelRow` precedent.
- **Detail read = a new thin R→M trigger reusing a deterministic compose/push body** (chosen over reading
  via `window.cosmos.confluence.getPage` in the renderer and composing client-side — the renderer must
  NOT compose A2UI surfaces; surface shape + requestId minting + `target:'confluence'` framing live in
  main). Add `confluence:requestPageDetail { pageId }`; main validates, calls
  `confluenceManager.getPage({ pageId })`, and on `ok` pushes `buildPageDetailSurface(detail)` with a
  fresh requestId + `target:'confluence'` (unsolicited frame); on `reconnect_needed`/`not_connected`
  pushes nothing (native Connect/Reconnect takes over via `confluence:statusChanged`); on any other
  failure (`network`/`rate_limited`/throw) pushes `buildConfluenceNoticeSurface({kind:'error', message})`.
  Mirrors `handleJiraIssueDetail` exactly.
- **Result lands in the ACTIVE tab via the existing unsolicited-frame + fire-or-defer seam.** The detail
  frame is an unsolicited `target:'confluence'` frame; `useGenerativePanelTabs` already files such frames
  into the active tab (auto-creating one if none) and `requestDefaultInActiveTab` marks the active tab and
  fires-or-defers the request so it never races an in-flight NL compose for the shared
  `originatingTabIdRef` slot. The detail click uses
  `requestDefaultInActiveTab(() => window.cosmos.confluence.requestPageDetail({ pageId }))` verbatim.
- **"Back" restores the composed/bound list verbatim (OQ-1).** A pure `confluenceBackNav.ts` mirrors
  `jiraBackNav.ts`: a `ConfluenceBackOrigin` union — `{ kind: 'base' }` (the native browser fallback) or
  `{ kind: 'composed'; surface: TabSurface }` (the snapshotted generated list captured at detail-open when
  the active tab's surface was `composed`). `backNavTarget(origin)` returns either `restore-surface`
  (re-file `surface` into the active tab with `composed: true`, and `restored: true` when the surface
  carries a `descriptor`/`bindings` so the bound-surface refresh re-kicks — OQ-1) or `base` (flip the
  panel back to its native search/default-feed view). The helper is `.ts`-only (no `.tsx` import) with a
  `confluenceBackNav.test.ts`, exactly like `jiraBackNav.test.ts`.

### Why no per-tab loadingDefault skeleton parity question

Confluence tabs never set `loadingDefault` today (it's documented Jira-only on `GenerativeTab`). The
spec's FR-008 ("show the existing per-tab loading indication") is satisfied by Confluence's existing
`showSpinner`/`SurfaceSpinner` region while the detail read is outstanding — `requestDefaultInActiveTab`
marks the active tab `loadingDefault: true`, which Confluence can either honor (render its skeleton/spinner)
or leave to the existing surface-replacement flow. The designer confirms the exact loading visual; no new
loading mechanism is introduced.

## Technical Context

| Item              | Value                                                                                                                                                                                                                                                                                                                                                                  |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + React renderer), Vitest (node env)                                                                                                                                                                                                                                                                                              |
| Key dependencies  | Existing only: `confluenceManager.getPage` (`src/main/confluenceManager.ts:206`), the Confluence catalog `PageDetail`/`Notice`/`SearchResultList`/`SearchResultRow` components, `useGenerativePanelTabs.requestDefaultInActiveTab` (already shipped), `TabSurface.restored` + `GenerativeTab.composed`/`descriptor`/`bindings`, `ActiveTabSurface` `onAction` intercept, `validateConfluenceGetPage`'s `{ pageId }` shape, shadcn `Button` + lucide `ChevronLeft`, `useDispatchAction`. NO new npm dep, NO new OAuth scope, NO new write path. |
| Files to create   | `src/main/confluenceSurfaceBuilder.ts` (+ `confluenceSurfaceBuilder.test.ts`), `src/renderer/confluenceBackNav.ts` (+ `confluenceBackNav.test.ts`)                                                                                                                                                                                                                       |
| Files to modify   | `src/shared/ipc.ts` (channel + payload type + `ConfluenceApi` method), `src/shared/validate.ts` (+ `validate.test.ts`) — `validateRequestPageDetail`, `src/preload/index.ts` (`requestPageDetail`), `src/main/index.ts` (new channel handler reusing getPage→detail compose/push), `src/renderer/confluenceCatalog/components.tsx` (`SearchResultList` emits the nav action; `SearchResultRow` gets `actionable`), `src/renderer/confluenceCatalog/logic.ts` (+ `logic.test.ts`) — page-id emit-guard + the `CONFLUENCE_OPEN_DETAIL_ACTION` constant, `src/renderer/confluenceCatalog/index.ts` (re-export the constant if needed), `src/renderer/ConfluencePanel.tsx` (pull `requestDefaultInActiveTab`; detail view state + back row + `onAction` intercept + origin snapshot), `docs/ARCHITECTURE.md` (§4.9 one-sentence note — at wrap-up) |
| Tests to create   | `src/main/confluenceSurfaceBuilder.test.ts`, `src/renderer/confluenceBackNav.test.ts`                                                                                                                                                                                                                                                                                   |
| Tests to modify   | `src/shared/validate.test.ts` (new `validateRequestPageDetail` cases), `src/renderer/confluenceCatalog/logic.test.ts` (emit-guard + non-`confluence.*` name guard)                                                                                                                                                                                                       |

### Contract note — `confluenceNav.openDetail` is a RENDERER-LOCAL nav action

Confluence's generative panel is read-only and has NO main-side action dispatcher, so any catalog action
that DID reach main would be a no-op. Still, to keep the seam identical to Jira and unambiguous, the
nav action is a NON-`confluence.`-prefixed constant (`confluenceNav.openDetail`) defined renderer-side
in `confluenceCatalog/logic.ts`, intercepted in `ConfluencePanel.onAction` (returns `true`), and never
forwarded. A `logic.test.ts` assertion guards that it is not `confluence.*`-prefixed. The interface step
finalizes the exact string; the spec FRs are agnostic to it.

### Secret discipline (CLAUDE.md / FR-012)

`pageId` is non-secret. The renderer sends ONLY `{ pageId }`; main attaches the token inside
`confluenceManager.getPage`. No token/secret appears on the payload, the type, the bridge frame, the MCP
result, or the composed `PageDetail`/`Notice` surface. The validator's warn path logs only the malformed
shape, never a token.

---

## Implementation Checklist

> UI-bearing feature: after this plan is approved, a `design` step (designer agent) produces
> `.sdd/designs/confluence-page-detail-nav-v1.md` (see the "Design step" callout at the end) before
> interface work. Map each item to its FR.

### Phase 1 — Interface (shared types + IPC contract)  ·  FR-003, FR-005, FR-011, FR-012

- [ ] Read the spec; confirm OQ-1 (bound list restores with `restored:true` re-kick) and OQ-2 (clickable
      list = agent-composed `SearchResultList`; native base drill-in untouched) are settled — no open
      questions remain.
- [ ] `src/shared/ipc.ts`: add `RequestPageDetail: 'confluence:requestPageDetail'` to
      `ConfluenceChannelName` (R→M `send`), doc comment paralleling `JiraChannelName.RequestIssueDetail`:
      deterministic, fire-and-forget, surface arrives via `ui:render` `target:'confluence'` as an
      unsolicited frame, never blocks, no token on the payload. (FR-005)
- [ ] `src/shared/ipc.ts`: add `export interface ConfluenceRequestPageDetailPayload { pageId: string }`
      — the ONLY field; no token/secret (FR-012). Non-empty `pageId` enforced by the validator. (Do not
      reuse `ConfluenceGetPageParams` for the channel payload type even though the shape matches — keep a
      dedicated request-payload type so the channel contract is self-documenting, mirroring how Jira keeps
      `JiraRequestIssueDetailPayload` distinct.)
- [ ] `src/shared/ipc.ts`: add `requestPageDetail(payload: ConfluenceRequestPageDetailPayload): void` to
      `ConfluenceApi` (fire-and-forget; mirrors `JiraApi.requestIssueDetail`).
- [ ] Decide the renderer-local nav action name per the contract note (non-`confluence.`-prefixed,
      `confluenceNav.openDetail`). Add `CONFLUENCE_OPEN_DETAIL_ACTION = 'confluenceNav.openDetail'` as a
      renderer constant in `src/renderer/confluenceCatalog/logic.ts` (re-export from `index.ts` if the
      panel imports from the barrel). NOT a `confluence.*` name. (FR-003)
- [ ] Review the new types against the spec — no invented properties (only `pageId`).

### Phase 2 — Validator + preload  ·  FR-011, FR-012

- [ ] `src/shared/validate.ts`: add `validateRequestPageDetail(raw, warn?)` returning
      `ConfluenceRequestPageDetailPayload | null`. Requires an object with a NON-EMPTY (trim-checked)
      string `pageId`; rejects a non-object / non-string / empty/whitespace `pageId` (warn-and-ignore).
      Model it on `validateRequestIssueDetail` (NOT on `validateConfluenceGetPage`'s exact return type,
      but the same non-empty-string rule). (FR-011)
- [ ] `src/preload/index.ts`: add `requestPageDetail(payload)` to the Confluence API object, sending
      `ConfluenceChannelName.RequestPageDetail` with `{ pageId }` (mirror `jira.requestIssueDetail`).
      NOTE (CLAUDE.md): preload changes require a full `npm run dev` restart, not HMR.

### Phase 3 — Confluence surface builder (main, pure)  ·  FR-005, FR-009

- [ ] Create `src/main/confluenceSurfaceBuilder.ts` — a pure A2UI surface builder (no Electron imports;
      node-testable), mirroring the structure of `jiraSurfaceBuilder.ts`:
  - `buildPageDetailSurface(detail: ConfluencePageDetail): A2uiSurfaceUpdate` — a single `PageDetail`
    root carrying STATIC props (`title`, `space?`, `body`) — no `{path}` binding (the click-detail surface
    is a one-shot read, not refreshable; the catalog `PageDetail` accepts literal props via `useBound`'s
    literal branch). Stable surfaceId (e.g. `confluence-page-detail`). (FR-005)
  - `buildConfluenceNoticeSurface(notice: { kind: 'error' | 'info'; message: string }): A2uiSurfaceUpdate`
    — a single `Notice` root (the Confluence catalog `Notice` takes `noticeKind: 'info' | 'error'`). The
    Confluence panel has no surface notice builder today; this is the recoverable-error carrier. (FR-009)
- [ ] Create `src/main/confluenceSurfaceBuilder.test.ts` — happy path (detail → `PageDetail` root with
      title/space/body; empty body still composes — the catalog renders the empty-body state), missing
      optional `space` (omitted prop), and the notice builder (error/info kind + message). No `.tsx`
      import. (FR-005/FR-009)

### Phase 4 — Main handler  ·  FR-005, FR-008, FR-009, FR-010, FR-011, FR-012

- [ ] `src/main/index.ts`: add `async function handleConfluencePageDetail(pageId: string)` — guard
      `if (!confluenceManager) return`; `confluenceManager.getPage({ pageId })` in try/catch (throw →
      recoverable Notice via `buildConfluenceNoticeSurface`); `ok` → `buildPageDetailSurface(result.data)`
      pushed with a fresh requestId + `target:'confluence'`; `reconnect_needed`/`not_connected` → push
      nothing (FR-010); any other (`rate_limited`/`network`/`write_not_authorized` n/a) → recoverable
      Notice (FR-009). Mirrors `handleJiraIssueDetail`. (FR-005/FR-008/FR-009/FR-010)
- [ ] `src/main/index.ts`: register the `RequestPageDetail` `ipcMain.on` handler: validate via
      `validateRequestPageDetail`; valid → `void handleConfluencePageDetail(payload.pageId)`; invalid →
      warned + ignored (return). Fire-and-forget. (FR-011)
- [ ] Confirm the `pageId` is non-secret and only logged in the validator warn path; the token stays in
      main (no payload/surface carries it). (FR-012)

### Phase 5 — Back-nav helper (renderer, pure)  ·  FR-007

- [ ] Create `src/renderer/confluenceBackNav.ts` — mirror `jiraBackNav.ts`:
  - `export type ConfluenceBackOrigin = { kind: 'base' } | { kind: 'composed'; surface: TabSurface }`
    (`base` = the native search/default-feed browser fallback; `composed` = snapshotted generated list).
  - `export type ConfluenceBackTarget = { kind: 'restore-surface'; surface: TabSurface; restored: boolean }
    | { kind: 'base' }`.
  - `backNavTarget(origin)`: for `composed`, return `restore-surface` with `surface` + `restored` set TRUE
    when the surface carries a `descriptor` or `bindings` (bound → re-kick refresh, OQ-1), else FALSE for a
    static composed surface; for `base` (or no origin), return `{ kind: 'base' }`. (FR-007)
- [ ] Create `src/renderer/confluenceBackNav.test.ts` — composed+bound origin → `restore-surface` with
      `restored:true`; composed+static origin → `restore-surface` with `restored:false`; base origin →
      `base`. No `.tsx` import (TabSurface is a type from `useGenerativePanelTabs`; importing the type is
      fine — `jiraBackNav.test.ts` does this). (FR-007)

### Phase 6 — Renderer (catalog click + panel chrome)  ·  FR-001, FR-002, FR-003, FR-004, FR-007, FR-008, FR-013, FR-014, FR-015

- [ ] `src/renderer/confluenceCatalog/logic.ts`: add `isOpenDetailEmittable(id?: string): boolean` (true
      only for a non-empty, non-whitespace id) + the `CONFLUENCE_OPEN_DETAIL_ACTION` constant. (FR-001/FR-002)
- [ ] `src/renderer/confluenceCatalog/logic.test.ts`: `isOpenDetailEmittable` cases (non-empty → true;
      absent/empty/whitespace → false) + a guard that `CONFLUENCE_OPEN_DETAIL_ACTION` is NOT
      `confluence.*`-prefixed. (FR-001/FR-002/FR-003)
- [ ] `src/renderer/confluenceCatalog/components.tsx`: make `SearchResultList` rows clickable via the
      Jira `IssueList`/Slack `ChannelList` pattern — the `<button>` wrapper + `useDispatchAction` emit
      live in `SearchResultList` (it has `surfaceId`/`componentId`), keeping `SearchResultRow`
      display-only with an `actionable?: boolean` prop toggling `cursor-pointer`+`hover:bg-accent/40`. The
      actionable branch dispatches `CONFLUENCE_OPEN_DETAIL_ACTION` with `context: { pageId: result.id }`
      ONLY when `isOpenDetailEmittable(result.id)`; a row with no id is an inert row (no button, not in
      tab order). (FR-001/FR-002)
- [ ] `src/renderer/ConfluencePanel.tsx`: pull `requestDefaultInActiveTab` out of the
      `useGenerativePanelTabs(...)` destructure (currently absent). (FR-013)
- [ ] `src/renderer/ConfluencePanel.tsx`: add detail view state — a `detailView: { kind: 'list' } |
      { kind: 'detail'; pageId: string }` (state, drives the back row) + a `backOriginRef:
      ConfluenceBackOrigin` ref. Reset BOTH to `list`/`{kind:'base'}` on every `activeTabId` change so an
      open detail's back row never bleeds across tabs. NOTE: this is the GENERATED-UI detail chrome,
      distinct from the existing per-tab native-base `ConfluenceNav.view` (`search`/`page`); keep them
      separate so the native browser drill-in (OQ-2) is untouched. (FR-004/FR-014)
- [ ] `src/renderer/ConfluencePanel.tsx`: pass `onAction={handleSurfaceAction}` to `ActiveTabSurface`
      (Confluence currently passes no `onAction`). The handler intercepts `CONFLUENCE_OPEN_DETAIL_ACTION`:
      read `action.context.pageId` (string guard); if the active tab's surface is `composed`, SNAPSHOT it
      into `backOriginRef = { kind: 'composed', surface: activeTab.surface }` NOW (the detail frame will
      overwrite it); set `detailView = { kind: 'detail', pageId }`; fire
      `requestDefaultInActiveTab(() => window.cosmos.confluence.requestPageDetail({ pageId }))`; return
      `true`. Any OTHER action returns `false`. (FR-003/FR-007/FR-013)
- [ ] `src/renderer/ConfluencePanel.tsx`: render a native back row (outside the `A2UIProvider`) when
      `detailView.kind === 'detail'` — the existing Confluence `ChevronLeft` ghost `icon-sm` row, label
      "Back". `goBackToList` calls `backNavTarget(backOriginRef.current)`: for `restore-surface`,
      `update(activeTabId, { surface: target.surface, composed: true, ...(target.restored ? { restored:
      true } : {}) })` (wait — `restored` lives on `TabSurface`, so set it on the surface object:
      `surface: { ...target.surface, restored: target.restored || undefined }`); for `base`, flip
      `detailView` to `list` (the panel then shows the native base / the kept composed surface). Reset
      `detailView` to `list` + `backOriginRef` to `{ kind: 'base' }` after. (FR-004/FR-007)
- [ ] `src/renderer/ConfluencePanel.tsx`: leave the NL `PromptComposer`, the native search/default-feed
      browser base AND its existing `ChevronLeft` page-detail drill-in, tabs, refresh, and pagination
      otherwise unchanged (OQ-2 / FR-015). The new back row + detail chrome apply ONLY to the
      generated-UI detail path, gated so they never co-render with the native-base `view.kind === 'page'`
      drill-in. (FR-015)
- [ ] While the detail read is outstanding, the active tab shows the existing loading region
      (`requestDefaultInActiveTab` marks it `loadingDefault`; reuse Confluence's existing
      spinner/skeleton region for the detail-view path — the designer confirms the exact visual). (FR-008)

### Phase 7 — Tests  ·  FR-005, FR-007, FR-009, FR-011

- [ ] `src/shared/validate.test.ts`: `validateRequestPageDetail` — valid `{ pageId: '12345' }` returns the
      payload (and drops extra keys incl. a token); non-object, non-string `pageId`, and EMPTY/whitespace
      `pageId` return `null` + warn. (FR-011/FR-012)
- [ ] `src/main/confluenceSurfaceBuilder.test.ts` (Phase 3) and `src/renderer/confluenceBackNav.test.ts`
      (Phase 5) pass. (FR-005/FR-007/FR-009)
- [ ] `src/renderer/confluenceCatalog/logic.test.ts` (Phase 6) passes. (FR-001/FR-002/FR-003)
- [ ] `npm run typecheck` (node + web) and `npm test` green.
- [ ] Manual/dev verification — NOT exercised by the implementing session (needs a human + a full
      `npm run dev` restart for the preload change). Record as a GUI caveat in the wrap-up report.

### Phase 8 — Docs  ·  architecture coherence

- [ ] `docs/ARCHITECTURE.md` §4.9 (Confluence-panel paragraph): add ONE sentence noting the Confluence
      click-to-open page-detail analog — a clickable `SearchResultRow` in a generated list emits a
      renderer-local `confluenceNav.openDetail` action intercepted via the `onAction` seam, firing
      `confluence:requestPageDetail { pageId }` → main `getPage` → `buildPageDetailSurface` → unsolicited
      `target:'confluence'` frame; a native back row restores the composed list (snapshotted at
      detail-open; bound surfaces restored `restored:true`); read-only, no new scope. **Done at wrap-up**
      (not during implementation), per the cycle's doc-ownership rule.
- [ ] Mark checklist items done; record deviations below.

---

## Design step (designer agent) — visual states to define

> This plan is UI-bearing. Before interface work, the `design` skill (designer agent) produces
> `.sdd/designs/confluence-page-detail-nav-v1.md`. New/extended visual states to specify:

- **Clickable vs. inert `SearchResultRow`** — the hover/cursor/focus affordance for an actionable row
  (mirror the Jira `TicketCard` `actionable` treatment) and the inert (no-id) row that stays display-only,
  not in tab order.
- **Generated-UI page-detail surface layout** — title, space chip, readable body (reuse the existing
  Confluence `PageDetail` component visuals; confirm parity with the native page-detail view).
- **"← Back" chrome row** — the `ChevronLeft` ghost-`icon-sm` back row above the A2UI host (parity with the
  existing Confluence native back row and the Jira detail back row), incl. its label.
- **Loading state** — the detail-read in-flight indication in the active tab (which existing spinner/skeleton
  region the detail path uses).
- **Error Notice** — the recoverable destructive `Notice` shown when `getPage` fails (non-reconnect).
- **Empty body** — the existing "This page has no readable body." state (confirm it is not styled as an
  error).

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-14** — Plan Phase 3 assumed "Confluence has no surface builder at all"; in fact
  `src/main/confluenceSurfaceBuilder.ts` (+ `.test.ts`) ALREADY existed with the bound-adapter
  builders from `confluence-generative-adapter-v1`. The new STATIC `buildPageDetailSurface` /
  `buildConfluenceNoticeSurface` were APPENDED alongside them under a DISTINCT surfaceId
  `SURFACE_CONFLUENCE_PAGE_DETAIL = 'confluence-page-detail'` (vs the bound `confluence-page`),
  so a one-shot click-detail never collides with a registered bound surface in the dispatcher.
  Not a spec divergence — consistent with FR-005/plan Phase 3/design §3.2 ("static one-shot, not
  refreshable").
- **2026-06-14** — Loading wiring (FR-008 / design OQ-B): `requestDefaultInActiveTab` marks the
  active tab `loadingDefault: true` (NOT `inFlight`) and does NOT clear the prior `surface`, so
  Confluence's `surfaceSpinnerVisible`-based `showSpinner` gate stays false during a detail read.
  Added a dedicated `showDetailLoading = detailView.kind === 'detail' && activeTab.loadingDefault
  && !showSpinner` gate that shows the EXISTING `SurfaceSpinner` and suppresses the stale composed
  host for the read window. Back row stays reachable (gated on `!showSpinner`, independent of
  `showDetailLoading`). The chosen minimal wiring per OQ-B; no new skeleton.
- **2026-06-14** — `dispatch(...).context.pageId` typed `string | undefined` from
  `SearchResultRowNode.id`; narrowed with `pageId as string` AFTER the `isOpenDetailEmittable`
  guard (the guard already proves it non-empty) to satisfy the SDK's `DynamicValue` context type.
- **2026-06-14** — Typecheck (node + web), full `npm test` (1015 passing), and `npm run build` all
  green. GUI CAVEAT: the click-to-open / back-row / inert-row behavior was NOT exercised at runtime
  by the implementing session; it needs a human + a full `npm run dev` restart (preload added
  `confluence.requestPageDetail`, which throws "not a function" until restart). Phase 8 docs
  (`docs/ARCHITECTURE.md` §4.9) deferred to wrap-up per the cycle's doc-ownership rule.
