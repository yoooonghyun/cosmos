# Plan: Confluence Page Detail — Right-Side Dock (~half width) — v1

**Status**: Draft (awaiting user confirmation before implementation)
**Spec**: `.sdd/specs/confluence-page-detail-dock-v1.md`
**Design (author next, between this plan and Interface)**: `.sdd/designs/confluence-page-detail-dock-v1.md` — DESIGNER-owned
**Owner (this plan)**: architect · **Implements**: developer (renderer-only)

---

## Grounding

> Direct investigation run for this plan (mandatory). Exact queries executed:

**codegraph_explore / codegraph_search:**

- `ConfluencePanel confluence list page detail native-overlay click navigation` — verbatim `ConfluencePanel.tsx`.
  **Takeaways used below:** `genUiPage` state (:388), `useEffect` reset on `activeTabId` (:389-391), `handleSurfaceAction`
  (:520-534), `closeGenUiPage` (:539), the `detailWebUrl` lift (:397), and the whole-region detail branch
  `genUiPage ? ( back row + PageDetail ) : ( native base / spinner / A2UI host )` (:597-747). `PageDetail` (:264) +
  `PageDetailSkeleton` (:88) + `PageDetailTitle`/`PageDetailBody` import (:41) are renderer-local; `PageDetail` reads
  `getPage` directly and lifts `webUrl` via `onWebUrl`.
- `SlackPanel open thread sidepanel right dock two-pane @container/slackbody message list replies` — the exact dock
  markup to copy: `@container/slackbody relative flex min-h-0 flex-1` wrapper (`SlackPanel.tsx:1359/1458`), list pane
  `min-w-0 flex-1`, scrim `absolute inset-0 z-10 bg-black/40 … @[32rem]/slackbody:hidden` (:1420/:1480), dock
  `absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] … border-l border-border bg-card shadow-lg …
  @[32rem]/slackbody:relative @[32rem]/slackbody:w-[clamp(18rem,42%,28rem)] @[32rem]/slackbody:shrink-0 …`
  (:1424/:1484).
- `GoogleCalendarPanel EventDetail dock @container/calbody two-pane selected event detail right-side` — `genUiEvent`
  per-tab transient + `closeDetail` (`GoogleCalendarPanel.tsx:538-547`), single-dock retarget, reset on `activeTabId`
  + `isConnected`. The Confluence `genUiPage` is already this exact shape.

**Read (precedent designs/specs):**

- `.sdd/designs/jira-ticket-detail-dock-v1.md` — the DIRECT precedent (full-panel detail → `@container/jirabody`
  right dock): §1 two-pane wrapper, §1.2 dock shell classes, §1.3 dock frame (header icon + truncate title + ghost
  `icon-sm` X), §2 selected-row ring (`aria-pressed` + `ring-1 ring-ring/50 ring-inset`), §4 32rem breakpoint, §3 state
  table. Reused wholesale; Confluence's one difference: the dock body is the **native `PageDetail`** (which owns its
  own loading/error states), so NO dock-level skeleton/error-chip is needed (PageDetail carries them) — simpler than
  Jira's live-A2UI-host dock.
- `.sdd/specs/confluence-page-detail-nav-v1.md` (As Built) — the shipped click→overlay this revises.

**memory_recall / memory_smart_search:**

- `Confluence gen-UI page detail native-overlay reuse two-pane dock` — empty; persisted the dock-migration + ~50%-width
  decision via `memory_save`.

**Net:** renderer-only. The work is converting ONE whole-region overlay branch in `ConfluencePanel.tsx` into a
two-pane (`@container/confluencebody`) layout with the existing native `PageDetail` in the right dock — copying the
shipped Slack/Jira dock shell, with a **~50% width** instead of the 42% clamp (spec OQ-1). No IPC, no main, no preload,
no shared, no surface builder, no new token, no new `components/ui/` primitive. The only net-new renderer artifact is
the dock-shell wiring (and an optional tiny pure helper for selected-row marking, if the developer wants a `.ts`/`.test.ts`
split for it).

---

## Technical Approach

**Migrate, don't rebuild.** The shipped feature already does everything behaviorally: a renderer-local
`CONFLUENCE_OPEN_DETAIL_ACTION` intercept sets `genUiPage = { pageId, title }`, the native `PageDetail` renders that
page, a back row closes it, and a `useEffect` resets it per tab. The ONLY change is **where the detail renders**:
today it is a whole-content-region branch that hides the list; this plan renders it in a **right-side dock beside the
still-mounted list**, copying the shipped Slack thread dock / Jira ticket-detail dock shell. So:

1. **Keep:** `genUiPage` state, `handleSurfaceAction`, `closeGenUiPage`, the per-tab `useEffect` reset, the
   `detailWebUrl` lift, the clickable `SearchResultRow`/`SearchResultList` catalog wiring (untouched), and the native
   `PageDetail` component (untouched).
2. **Change:** the connected content region's layout — wrap the list (native base / spinner / generative A2UI host) in
   a `@container/confluencebody relative flex min-h-0 flex-1` two-pane parent; render the existing back-row header +
   `PageDetail` inside a **right dock** (the Slack/Jira shell) when `genUiPage != null`, instead of the full-region
   branch. The list pane is `min-w-0 flex-1` and stays mounted/visible at all times.
3. **Add:** the dock shell classes (Slack/Jira copy, ~50% width per the design), a scrim for the narrow drawer mode,
   and a **selected-row marker** on the open page's list row (the Jira `aria-pressed` + `ring` precedent).

This mirrors EXACTLY how Jira moved from `jira-ticket-detail-v1` (view-swap) to `jira-ticket-detail-dock-v1` (dock).
The one simplification vs. Jira: Confluence's dock body is the native `PageDetail`, which already renders its own
loading/empty/error/reconnect — so there is no dock-level skeleton or error chip to wire (the spec FR-008 maps straight
onto the reused component's states).

**Patterns mirrored (file:line, for the developer to copy verbatim):**

- **Two-pane wrapper + list pane:** `src/renderer/SlackPanel.tsx:1359` / `:1458`
  (`@container/slackbody relative flex min-h-0 flex-1`, list pane `min-w-0 flex-1`).
- **Dock shell (absolute drawer ↔ side-by-side at the breakpoint) + scrim:** `src/renderer/SlackPanel.tsx:1420-1424`
  / `:1480-1484` — copy the scrim + dock `<div>` classes; change ONLY the container name (`slackbody` →
  `confluencebody`) and the width clamp/breakpoint to the **~50%** values the design fixes (spec OQ-1: e.g.
  `@[40rem]/confluencebody:w-[clamp(20rem,50%,40rem)]`).
- **Dock frame (header icon + truncate title + ghost `icon-sm` X + scrollable body):**
  `src/renderer/googleCalendarCatalog/components.tsx:1101-1137` (`EventDetail` frame:
  `flex h-full min-w-0 flex-col bg-card`, header `flex items-center gap-2 border-b border-border px-2 py-1.5`, X
  `Button variant="ghost" size="icon-sm" aria-label="Close …"`). For Confluence the dock header is the EXISTING
  back-row header (`ConfluencePanel.tsx:603-618`: `PageDetailTitle` + the "Open in Confluence" `detailWebUrl` lift) —
  reuse it, swapping the leading `ChevronLeft` "Back" button for an `X` "Close" button (or keeping both per the design).
- **Selected-row marker on the open page's row:** `.sdd/designs/jira-ticket-detail-dock-v1.md` §2
  (`aria-pressed={openId === id}` + `ring-1 ring-ring/50 ring-inset`) — applied to the clickable `SearchResultRow`
  button in `confluenceCatalog/components.tsx` (the design fixes the exact treatment for the flush divided list).
- **Per-tab transient reset:** `src/renderer/GoogleCalendarPanel.tsx:545-547` (already mirrored by Confluence's
  existing `useEffect(() => setGenUiPage(null), [activeTabId])`, :389-391 — keep as-is).

**Width is the ONE deliberate deviation from the shipped docks** (spec OQ-1): Slack/Jira/calendar cap at
`clamp(18rem,42%,28rem)`; this dock targets **~half** (`~clamp(20rem,50%,40rem)`), per the user's "화면 반정도".
The designer fixes the exact clamp/min/breakpoint; the developer takes them from the design doc.

---

## Files

> Renderer-only. No main / preload / shared / IPC / surface-builder files change (the original
> `confluence-page-detail-nav-v1` already reverted those to HEAD).

| File | Change |
|------|--------|
| `src/renderer/ConfluencePanel.tsx` | **Primary.** Replace the whole-region `genUiPage ? (...)` detail branch (:597-627) with a two-pane layout: wrap the connected list region in `@container/confluencebody relative flex min-h-0 flex-1`; render the existing back-row header + `PageDetail` inside a right **dock** (Slack/Jira shell, ~50% width) + a narrow-mode scrim, shown when `genUiPage != null`. List pane stays `min-w-0 flex-1`, mounted and visible. Pass the open `pageId` down so the open row can mark itself selected (via the catalog — see below). Close affordance (X / scrim) calls the existing `closeGenUiPage`. Keep `genUiPage` state, `handleSurfaceAction`, the per-tab reset, and the `detailWebUrl` lift unchanged. |
| `src/renderer/confluenceCatalog/components.tsx` | Add a **selected-row marker** to the clickable `SearchResultRow`/`SearchResultList` button: when the row's `pageId` equals the open dock's pageId, apply `aria-pressed` + the selected ring (Jira §2 precedent). The open pageId is threaded to the catalog the same way the panel already passes context to its host (e.g. via the catalog's existing wiring / a small prop or context the design specifies). Display body unchanged. |
| `src/renderer/confluenceCatalog/logic.ts` (+ `logic.test.ts`) | OPTIONAL: if the selected-marker decision needs a pure helper (e.g. `isRowSelected(rowPageId, openPageId)`), add it here with a node test (the `.ts`/`.test.ts` split). Trivial; may be inlined if the developer prefers. |
| `docs/ARCHITECTURE.md` | §4.9 — update the one sentence describing the Confluence `genUiPage` presentation: the clicked generated-UI row now opens the native `PageDetail` in a **right-side ~half-width dock** (a `@container/confluencebody` two-pane beside the still-visible list, mirroring the Slack thread + Jira ticket-detail docks), not a full-panel overlay. (Architect does this at wrap-up once the dock ships.) |

---

## Implementation Checklist (ordered)

> Sequential. The DESIGN step (designer) sits between step 1 and step 2: it fixes the dock chrome, the ~50% width
> clamp/breakpoint, the divider, the selected-row marker treatment, and the close affordance, all in existing tokens
> + `components/ui/` primitives (no new token/primitive expected). Implementation waits for the approved design.

- [ ] **0. (Architecture, pre-design) Confirm OQs with the user** — width ~50% (OQ-1), replace the overlay entirely
  (OQ-2), fixed (non-resizable) for v1 (OQ-3). Recommendations stand; proceed on them unless the user objects.
- [ ] **1. (Design — DESIGNER, `confluence-page-detail-dock-v1.md`)** Author the dock design: the
  `@container/confluencebody` two-pane shell (copy of the Slack/Jira dock shell, file:line above), the **~50% width**
  clamp + breakpoint (resolve spec OQ-1 — recommend `@[40rem]/confluencebody:w-[clamp(20rem,50%,40rem)]`, list
  `min-w-0 flex-1`), the dock frame (reuse the existing back-row header with `PageDetailTitle` + the "Open in
  Confluence" link; choose X-close and/or keep-the-back-arrow), the narrow-mode right-drawer + scrim, the
  **selected-row marker** on the open page's row (Jira §2 `aria-pressed` + inset ring, adapted to the flush
  `SearchResultRow`), and the per-state behavior (the dock body is the native `PageDetail`, so its loading/empty/error/
  reconnect states are reused — no dock-level skeleton/error chip). Tokens/primitives ledger: expect NONE new.
- [ ] **2. (Interface — developer) Two-pane layout in `ConfluencePanel.tsx`.** Wrap the connected list region
  (native base + spinner + generative A2UI host) in `@container/confluencebody relative flex min-h-0 flex-1` with the
  list pane as `min-w-0 flex-1`. Do NOT yet move the detail — first confirm the list region renders identically inside
  the new wrapper (no visual change while no dock is open).
- [ ] **3. (Implement — developer) Render the detail in the right dock instead of the full region.** Move the existing
  back-row header + `PageDetail` (currently the :597-627 full-region branch) into the dock shell (`absolute inset-y-0
  right-0 …` ↔ side-by-side at the breakpoint, per the design), shown when `genUiPage != null`. Add the narrow-mode
  scrim (click-away closes via `closeGenUiPage`). The list pane stays mounted/visible the whole time. Verify: opening a
  detail no longer hides the list; the list narrows beside the dock at normal widths and the dock is ~half; below the
  breakpoint the dock is a right-drawer over the list.
- [ ] **4. (Implement — developer) Selected-row marker + retarget.** Thread the open `genUiPage.pageId` to the
  generative list so the open page's `SearchResultRow` button marks itself selected (`aria-pressed` + ring per the
  design). Verify: clicking another row swaps the single dock and moves the marker (retarget), never stacks; closing
  clears the marker.
- [ ] **5. (Implement — developer) Close + per-tab + non-regression.** Wire the dock close affordance (X and, in
  drawer mode, the scrim) to `closeGenUiPage`; confirm the list returns to full width with no re-fetch. Confirm the
  per-tab reset (`useEffect(…, [activeTabId])`) still clears the dock on tab switch. Confirm the "Open in Confluence"
  header link (`detailWebUrl`/`PageDetailTitle`) still works in the dock header. Confirm the native-base browser's OWN
  page-detail drill-in (`view.kind === 'page'`), the NL composer, tabs, refresh, and pagination are all unchanged.
- [ ] **6. (Test — developer)** Node-test any pure logic added (the optional `isRowSelected` helper) in
  `confluenceCatalog/logic.test.ts`. The dock layout itself is JSX (no new pure decision logic beyond selection +
  the existing `isOpenDetailEmittable`); rely on the existing catalog/logic tests for the row-click seam, which is
  unchanged. Run `npm run typecheck` + `npm test`.
- [ ] **7. (Wrap-up — architect) `docs/ARCHITECTURE.md` §4.9** one-sentence update (Files table). Reconcile `TODO.md`.

---

## Risks & Mitigations

- **R1 — Width too wide squeezes the list illegible on a narrow panel.** Mitigation: the container-query breakpoint
  (FR-009) drops to a right-drawer overlay below the threshold; the design picks a breakpoint large enough that the
  side-by-side ~50% split only engages when both panes are legible (spec OQ-1). The list keeps `min-w-0 flex-1` so it
  never disappears in side-by-side mode above the breakpoint.
- **R2 — Selected-row marker plumbing.** The open `pageId` must reach the generative `SearchResultRow` inside the A2UI
  host. Mitigation: thread it the way the panel already passes panel-level context to its host (the designer/developer
  pick the minimal seam — a prop or the existing catalog context); keep it a pure equality (`isRowSelected`) so it is
  node-testable. The marker is reinforcement; the open dock's header title is the primary "which page" signal, so a
  fallback of "no marker" still satisfies the core (FR-007 is the only FR it touches).
- **R3 — Regressing the native-base drill-in.** The native `view.kind === 'page'` full-region flow is SEPARATE and
  must stay. Mitigation: this plan touches only the `genUiPage` (generated-UI-list) branch; the native base's
  `view.kind === 'page'` branch (:649-707) is left untouched (FR-012 / spec OQ-2). Verify in step 5.
- **R4 — Scope creep into a resizable dock.** Mitigation: fixed ~50% for v1 (spec OQ-3); a draggable divider is a
  deferred follow-up.

---

## Out of Scope (deferred)

- A resizable / user-draggable dock width (OQ-3 — fixed ~50% for v1).
- Converting the native-base browser's OWN page-detail drill-in to a dock (OQ-2 — only the generated-UI-list click
  migrates).
- Any change to body rendering (ADF/HTML, content images, emoji, checkboxes — all unchanged, FR-003), to IPC/main, or
  any new write capability / OAuth scope.
- Opening a detail in a new tab; forward/redo nav; deep-linking.
