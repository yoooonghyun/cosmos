# Plan: Jira JQL Search Box — v1

**Status**: Implemented (603/603 tests pass; GUI verification pending)
**Created**: 2026-06-07
**Last updated**: 2026-06-07
**Spec**: .sdd/specs/jira-jql-search-v1.md

---

## Summary

Add a native, deterministic JQL search box to the connected Jira panel that mirrors the
Confluence panel's search-box UX. The box reuses the EXISTING `jira:searchIssues` read +
`JiraSurfaceBuilder.buildDefaultViewSurface` compose path; the only new wire is a thin R→M
"render this JQL into the panel" trigger. Main generalizes the existing `handleJiraDefaultView`
into a shared `handleJiraView(jql)` helper: empty/whitespace JQL falls back to
`JIRA_DEFAULT_VIEW_JQL`, otherwise it runs the supplied JQL; on `ok` it pushes
`buildDefaultViewSurface(result.data)` with `target: 'jira'`, on `reconnect_needed`/`not_connected`
it pushes nothing (native Connect/Reconnect takes over), and on any other failure it pushes a
recoverable `buildNoticeSurface`. The result lands in the ACTIVE tab via the existing
unsolicited-frame path in `useGenerativePanelTabs`, and the search request reuses the existing
fire-or-defer seam (a new in-place hook method analogous to `newTabWithDefault`) so it never races
an in-flight NL compose for the shared `originatingTabIdRef` slot. The NL `PromptComposer` is kept
unchanged alongside the new box. UI-bearing → a `design` step follows this plan before
implementation.

### Chosen approach (and why)

- **New channel, shared internal helper** (recommended over extending the existing default-view
  path). `jira:requestDefaultView` is a *semantic* zero-payload "I was switched to" trigger; adding
  a JQL field to it would overload that contract and force every caller to pass an empty string.
  Instead add a sibling channel `jira:requestSearchView` carrying `{ jql: string }`, and refactor
  the read/compose/push body of `handleJiraDefaultView` into one private `handleJiraView(jql)` that
  both handlers call (default view passes `JIRA_DEFAULT_VIEW_JQL`; search passes the user's JQL,
  with the helper itself doing the empty→default fallback). This keeps the existing default-view
  contract byte-for-byte and shares all the read/error/push logic (DRY, no behavior drift).
- **Result lands in the ACTIVE tab** (Decision #1). "Filter the current view" means replace the
  active tab's surface. Both default-view and search are UNSOLICITED `target:'jira'` frames; the
  hook's existing unsolicited branch already files them into the active tab and auto-creates a tab
  when there are none — so search needs NO new routing, only a request trigger.
- **Fire-or-defer reuse** (Decision #2). A submitted search pushes an unsolicited frame that shares
  the single `originatingTabIdRef` slot with any in-flight NL compose. Reuse the proven
  `newTabWithDefault` fire/defer seam, but IN PLACE (don't open a new tab): add a hook method
  `requestDefaultInActiveTab(request)` that marks the ACTIVE tab `loadingDefault: true` (or
  auto-creates one if zero) and then calls the same `defaultRequestDecision` /
  `deferredDefaultRequestRef` fire-or-defer logic. `newTabWithDefault` and the new method share that
  fire/defer core (extract a private `fireOrDeferDefault(request)` helper inside the hook).

## Technical Context

| Item              | Value                                                                                                  |
|-------------------|--------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + React renderer), Vitest (node env)                                |
| Key dependencies  | Existing: `jiraManager.searchIssues`, `JiraSurfaceBuilder` (`buildDefaultViewSurface`/`buildNoticeSurface`), `useGenerativePanelTabs`, `panelTabs.ts` fire/defer helpers, shadcn `Input`. No new deps, no new OAuth scope. |
| Files to create   | None (all changes extend existing files)                                                                |
| Files to modify   | `src/shared/ipc.ts` (channel + payload type + `JiraApi` method), `src/shared/validate.ts` (validator), `src/preload/index.ts` (`requestSearchView`), `src/main/index.ts` (new channel handler + `handleJiraView(jql)` refactor), `src/renderer/useGenerativePanelTabs.ts` (`requestDefaultInActiveTab` + shared fire/defer), `src/renderer/JiraPanel.tsx` (search box + wiring), `docs/ARCHITECTURE.md` (§4.9 note) |
| Tests to modify   | `src/shared/validate.test.ts` (new validator), `src/renderer/panelTabs.test.ts` if any pure decision is added; hook behavior covered by existing fire/defer pure tests |

---

## Implementation Checklist

> UI-bearing feature: after this plan is approved, a `design` step (designer agent) produces
> `.sdd/designs/jira-jql-search-v1.md` for the search-box placement/affordance before interface work.

### Phase 1 — Interface (shared types + IPC contract)

- [x] Read the spec; confirm no open questions remain (the spec lists none).
- [x] `src/shared/ipc.ts`: add `RequestSearchView: 'jira:requestSearchView'` to `JiraChannelName`
      (R→M send), with a doc comment paralleling `RequestDefaultView` (deterministic JQL filter,
      fire-and-forget, surface arrives via `ui:render` `target:'jira'`, never blocks).
- [x] `src/shared/ipc.ts`: add `export interface JiraRequestSearchViewPayload { jql: string }`
      (the ONLY field; no token/secret — trace FR-011). Note empty/whitespace `jql` ⇒ default view
      is handled in MAIN, so the payload type itself just requires a string.
- [x] `src/shared/ipc.ts`: add `requestSearchView(payload: JiraRequestSearchViewPayload): void` to
      `JiraApi` (fire-and-forget, mirrors `requestDefaultView`).
- [x] Review the types against the spec — no invented properties (only `jql`).

### Phase 2 — Validator + preload

- [x] `src/shared/validate.ts`: add `validateRequestSearchView(raw, warn?)` returning
      `JiraRequestSearchViewPayload | null`. Accept any object with a STRING `jql` (allow empty
      string — empty/whitespace is the valid "clear to default" case, resolved in main); reject a
      non-object or a non-string `jql` (warn-and-ignore). Trace FR-012.
- [x] `src/preload/index.ts`: add `requestSearchView(payload)` to `jiraApi`, sending
      `JiraChannelName.RequestSearchView` with the `{ jql }` payload (mirror `requestDefaultView`).
      NOTE (CLAUDE.md): preload changes require a full `npm run dev` restart, not HMR.

### Phase 3 — Main handler + refactor

- [x] `src/main/index.ts`: extract the read/compose/push body of `handleJiraDefaultView` into a
      private `async function handleJiraView(jql: string)` that:
      runs `jiraManager.searchIssues({ jql })` (try/catch → recoverable Notice on throw); on `ok`
      pushes `buildDefaultViewSurface(result.data)` `target:'jira'`; on `reconnect_needed`/
      `not_connected` pushes nothing; on other kinds pushes `buildNoticeSurface({kind:'error',
      message: result.message})`. (Identical to today's logic, just parameterized by `jql`.)
- [x] `src/main/index.ts`: keep `handleJiraDefaultView()` as a thin wrapper calling
      `handleJiraView(JIRA_DEFAULT_VIEW_JQL)` so the existing `RequestDefaultView` handler is
      unchanged in behavior.
- [x] `src/main/index.ts`: register the `RequestSearchView` handler: validate via
      `validateRequestSearchView`; compute `const jql = payload.jql.trim()`; call
      `handleJiraView(jql.length === 0 ? JIRA_DEFAULT_VIEW_JQL : jql)` — this is the empty⇒default
      fallback (FR-005). Fire-and-forget, never blocks.
- [x] Confirm the JQL is never logged and the token stays in main (no payload/surface carries it).

### Phase 4 — Renderer (hook + panel)

- [x] `src/renderer/useGenerativePanelTabs.ts`: extract the fire-or-defer core of
      `newTabWithDefault` into a private `fireOrDeferDefault(request)` (uses
      `defaultRequestDecision` + `deferredDefaultRequestRef`), and have `newTabWithDefault` call it
      (no behavior change).
- [x] `src/renderer/useGenerativePanelTabs.ts`: add `requestDefaultInActiveTab(request: () => void)`
      to `GenerativePanelTabs`: mark the ACTIVE tab `loadingDefault: true` + clear its prior error
      (or, if there is no active tab, open one marked `loadingDefault`), then `fireOrDeferDefault`.
      This is the in-place analog of `newTabWithDefault` for "filter the current tab" (FR-004/FR-006/
      FR-009). The landed surface clears `loadingDefault` via the existing render subscription.
- [x] `src/renderer/JiraPanel.tsx`: in `ConnectedBody`, add a native search box above the tab body
      (a `<form onSubmit>` with shadcn `<Input>`), placeholder = `JIRA_DEFAULT_VIEW_JQL`
      (define/import the constant string), `searchText` state. On submit: prevent default, call
      `requestDefaultInActiveTab(() => window.cosmos.jira.requestSearchView({ jql: searchText }))`
      (send the RAW text; main trims + does empty⇒default). Mirror Confluence's box chrome
      (Search icon, height, aria-label "Search Jira issues") per the design spec.
- [x] `src/renderer/JiraPanel.tsx`: pull `requestDefaultInActiveTab` from the hook destructure;
      leave `PromptComposer` and the default-view-on-activation effect untouched (FR-010).

### Phase 5 — Tests

- [x] `src/shared/validate.test.ts`: `validateRequestSearchView` — valid `{ jql }` (incl. empty
      string) returns the payload; non-object and non-string `jql` return `null` + warn.
- [x] If `requestDefaultInActiveTab` introduces a new pure decision in `panelTabs.ts`, add a node
      test there; otherwise the existing `defaultRequestDecision`/`shouldFlushDeferredDefault` tests
      cover the fire/defer behavior (note: the hook itself is DOM-bound, so keep any unit-testable
      logic pure per the CLAUDE.md `logic.ts` split convention).
- [x] Manual/dev verification (documented, not automated — DOM): valid JQL filters the active tab;
      empty submit returns the default view; invalid JQL shows a Notice; a search during an
      in-flight NL compose defers and both results land correctly.

### Phase 6 — Docs

- [x] `docs/ARCHITECTURE.md` §4.9: add a minimal sentence to the Jira-panel paragraph noting the
      native deterministic JQL search box (placeholder = the my-tickets JQL; empty ⇒ default view;
      non-empty ⇒ native `jira:searchIssues` → `JiraSurfaceBuilder` → unsolicited `target:'jira'`
      frame into the active tab; read-only, no new scope) — paralleling the Confluence "default
      personal feed / search swap" note. Do NOT duplicate the §4.11 correlation prose; reference it.
- [x] Mark items done here; record any deviations below.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- 2026-06-07 (developer): Implemented Phases 1–5 exactly as specified. Notes:
  - **Phase 6 (docs) was already done** — `docs/ARCHITECTURE.md` §4.9 already contains the
    full jira-jql-search-v1 paragraph (placeholder = my-tickets JQL, empty ⇒ default view,
    non-empty ⇒ native `jira:searchIssues` → `JiraSurfaceBuilder` → unsolicited `target:'jira'`
    frame into the active tab, read-only, `handleJiraView(jql)` refactor, `jira:requestSearchView`
    `{ jql }` channel). No docs edit was needed; left as-is.
  - **No new pure decision added to `panelTabs.ts`.** `requestDefaultInActiveTab` reuses the
    existing `defaultRequestDecision` / `shouldFlushDeferredDefault` via the new private
    `fireOrDeferDefault` hook helper (shared with `newTabWithDefault`), so the existing
    node tests in `panelTabs.test.ts` cover the fire/defer behavior unchanged — no test added
    there (the plan's Phase-5 conditional).
  - **Placeholder constant** defined renderer-local as `JIRA_DEFAULT_VIEW_JQL` in
    `JiraPanel.tsx` (main's same-named constant in `src/main/index.ts` is not exported); used
    for the `<Input>` placeholder so it can never drift from main's empty⇒default fallback.
  - Validator allows an EMPTY/whitespace `jql` string (the "clear to default" case) and rejects
    a non-object or non-string `jql` (warn + null); main trims and falls back to the default JQL.
  - typecheck (node + web) clean; `npm test` 603/603 pass (11 new `validateRequestSearchView`
    cases). DOM/GUI behavior NOT exercised (needs a human + a full `npm run dev` restart for the
    preload change).
