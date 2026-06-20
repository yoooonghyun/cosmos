# Plan: Jira ticket dock — auto-apply status + ticket web link — v1

**Status**: Draft
**Created**: 2026-06-21
**Last updated**: 2026-06-21
**Spec**: .sdd/specs/jira-dock-autoapply-weblink-v1.md

---

## Grounding

Direct investigation for this plan (architect, this + the prior spec pass):

**codegraph_explore**
- `jiraSurfaceBuilder buildBoundIssueDetailSurface TransitionPicker TicketCard root` → the dock detail surface: header `TicketCard` binds the whole issue at `JIRA_DETAIL_PATH`; `TransitionPicker` binds `…/key` + `…/availableTransitions`; the ticket KEY shows in the `TicketCard` header `Badge`. Detail seed = `{ path: JIRA_DETAIL_PATH, value: detail }` + `/loading=false`; descriptor = `jiraGetIssueDescriptor(detail.key)`.
- `TransitionPicker … Apply handler action binding` → `TransitionPicker` uses `useFormBinding<string>(surfaceId, {path: PATH_TRANSITION_ID}, '')`; `Select` `onValueChange={setTransitionId}` + a separate `Apply` `<Button>` whose `onClick=apply` dispatches `JiraBoundAction.Transition` with `context: { issueKey, transitionId: { path: PATH_TRANSITION_ID } }`. Guard `isTransitionSubmittable`.
- `JiraPanel onAction jira.transition dispatch onUnsolicitedFrame` → `jira.*` writes fall through `handleSurfaceAction` to main; the post-write re-read re-pushes a DETAIL frame that `onUnsolicitedFrame` routes back into the dock slot (FR-012). The re-pushed surface remounts the picker idle.
- `JiraIssueDetail … jiraManager getIssue auth cloudId` + `siteUrl` grep → `JiraIssueDetail` has no `webUrl`; `JiraClient.getIssue(auth, issueKey)` builds the DTO; `JiraCallAuth = { token, cloudId }` today; `jiraManager.auth(tokens)` mints it from the stored set; `extra.siteUrl` (e.g. `https://acme.atlassian.net`) is persisted (`toStoredTokenSet`, from `oauth.siteUrl`) and read with the `readCloudId`/`readSiteName` helper pattern.
- `confluenceWebUrl joinBaseAndWebui` + `PageDetailTitle ExternalLink isOpenableWebUrl` → the exact idiom to mirror: a pure main assembler returning `string | undefined` (omit-when-absent), the DTO carrying a non-secret `webUrl?`, and a renderer link (`<a target="_blank" rel="noreferrer">` + `<ExternalLink>`) gated by a pure `isOpenableWebUrl` `http(s)` re-validation.

**ARCHITECTURE.md** (Deterministic Jira action binding) → `jira.transition` intercepted in main, executed by `JiraActionDispatcher` without re-invoking claude, then issue re-read + detail re-pushed with a fresh `requestId` + notice. Confirms FR-004 (status is server-confirmed, not optimistic) needs NO new main logic — it already re-reads.

**memory** → settled decisions for this feature persisted in the spec pass (`mem_mqmicz5g_…`); no conflicting prior observations.

---

## Summary

Two scoped refinements to the existing Jira ticket-detail dock, reusing established patterns end to
end. **(1) Auto-apply:** drop the Apply button from `TransitionPicker`; dispatch the existing
`jira.transition` bound write directly from the `Select`'s change handler, with an in-flight lock so
the picker disables and cannot double-dispatch until the deterministic main-side re-read re-pushes a
fresh detail surface (which remounts the picker idle with the server-confirmed status). No change to
the `jira.*` action contract, the dispatcher, or the `write:jira-work` scope — the confirmed (not
optimistic) status is already a property of the existing re-read+re-push path. **(2) Ticket web
link:** add a non-secret `webUrl?` to `JiraIssueDetail`, assembled in MAIN by a new pure
`jiraWebUrl(siteUrl, issueKey)` helper (`<siteUrl>/browse/<KEY>`, omit-when-absent / non-`http(s)`)
exactly mirroring `confluenceWebUrl`; thread the connected site URL into `JiraCallAuth` so
`getIssue` can build it; bind `webUrl` onto the dock header in `jiraSurfaceBuilder`; and render the
`TicketCard` key as an external link with an `ExternalLink` icon, gated by a pure openable-URL guard,
mirroring `PageDetailTitle`. No new OAuth scope.

**Design step required (see Phase 0).** This feature is UI-bearing (a changed dock picker
interaction + a new link affordance), so a `designer` design pass runs BEFORE implementation,
reusing the Confluence external-link treatment and extending the existing Jira dock.

## Technical Context

| Item              | Value                                                                                                                                   |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer); vitest (node + web configs)                                                                 |
| Key dependencies  | Existing only: `lucide-react` (`ExternalLink`), shadcn `Select`/`Badge`, A2UI 0.9 SDK (`useFormBinding`/`useDispatchAction`), existing Jira deterministic write path. NO new deps, NO new OAuth scope. |
| Files to create   | (none required) — new symbols land in existing files; a pure `jiraWebUrl` assembler MAY be a new `src/main/integrations/jiraWebUrl.ts` mirroring `confluenceWebUrl.ts`, plus its `.test.ts`. |
| Files to modify   | `src/shared/jira.ts`; `src/main/integrations/jiraClient.ts`; `src/main/jiraManager.ts`; `src/main/jiraSurfaceBuilder.ts`; `src/renderer/jiraCatalog/components.tsx`; `src/renderer/jiraCatalog/logic.ts` (+ their `.test.ts`); `docs/ARCHITECTURE.md`. |

### Approach notes (load-bearing decisions)

- **Where the browse URL is assembled.** A NEW pure `jiraWebUrl(siteUrl, issueKey): string | undefined` in `src/main/integrations/jiraWebUrl.ts`, mirroring `confluenceWebUrl`: returns the assembled `<siteUrl>/browse/<KEY>` ONLY if it parses to an absolute `http(s)` URL, else `undefined` (omit). Pure, node-testable, never throws. Keep it separate from `confluenceWebUrl` (different join rule — origin + `/browse/` + encoded key, not `_links.base`+`webui`).
- **Threading the site URL.** Extend `JiraCallAuth` with an optional `siteUrl?: string`; `jiraManager.auth(tokens)` populates it via a new `readSiteUrl(tokens)` helper (same shape as `readCloudId`/`readSiteName`, reading `extra.siteUrl`). `JiraClient.getIssue` then sets `webUrl: jiraWebUrl(auth.siteUrl, key)` (spread-when-present, mirroring `assignee`/`reporter`). This keeps assembly in ONE pure spot and out of the renderer/secret surface. (The write methods do not need it.)
- **Binding `webUrl` into the dock.** In `buildBoundIssueDetailSurface`, the header `TicketCard` already binds the whole issue at `JIRA_DETAIL_PATH`; `webUrl` rides that same value (no extra data-model entry), so `TicketCard` reads `boundIssue.webUrl`. No change to the post-write re-push wiring — the re-read DTO carries `webUrl`, so the link survives a transition (FR-022).
- **Auto-apply mechanics.** `TransitionPicker` keeps `useFormBinding` for the selected id but moves the dispatch into `onValueChange`: on a non-empty, non-no-op selection, set a local `applying` state, disable the `Select`, and dispatch `JiraBoundAction.Transition`. The component has no success callback (the write is deterministic and asynchronous via main), so the in-flight lock is released by the SURFACE RE-PUSH remounting the picker (a fresh detail frame replaces this instance) — the local `applying` state simply guards against a second dispatch within this instance's lifetime. Remove the `Apply` `<Button>` entirely. Failure path: main re-pushes the SAME detail with an error `Notice` and the unchanged status; the remounted picker is idle again (FR-005).
- **No-op / placeholder guard.** Reuse/extend `isTransitionSubmittable`; do not dispatch when the new value equals the placeholder/empty or equals the current selection (FR-006).
- **Renderer URL re-validation.** A pure `isOpenableJiraWebUrl` (or reuse a shared openable-URL guard) in `logic.ts` re-validates `http(s)` before the `TicketCard` renders the anchor (FR-014), mirroring Confluence's `isOpenableWebUrl`.
- **External-open idiom.** Use the same `<a href target="_blank" rel="noreferrer">` affordance as `PageDetailTitle`; the app's existing `setWindowOpenHandler` → `shell.openExternal` seam routes `target="_blank"` to the system browser (FR-013). No new IPC.
- **Scope unchanged.** `JIRA_OAUTH_SCOPES` is untouched; the `write_not_authorized` short-circuit in `jiraManager.transitionIssue` already covers FR-008.

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates from plan.

### Phase 0 — Design (designer, BEFORE implementation)

- [ ] Designer produces `.sdd/designs/jira-dock-autoapply-weblink-v1.md` extending the existing Jira dock design.
- [ ] Specify the auto-apply `TransitionPicker` states: idle (Select only, no Apply button), in-flight (disabled Select + busy indicator conveyed not-by-color-alone), and the post-failure return-to-idle.
- [ ] Specify the ticket-key external-link treatment in the dock header — REUSE the Confluence `PageDetailTitle` link + `ExternalLink` icon pattern (focus ring, accessible name, plain-text fallback when absent). Confirm it fits the `TicketCard` header `Badge` layout.
- [ ] No new theme tokens or shadcn components expected; confirm or flag.

### Phase 1 — Interface (types & contracts)

- [x] `src/shared/jira.ts`: add `webUrl?: string` to `JiraIssueDetail` (non-secret browse URL; omit-when-absent), with a doc-comment tracing FR-010/FR-011.
- [x] `src/main/integrations/jiraClient.ts`: extend `JiraCallAuth` with optional `siteUrl?: string` (doc: non-secret site origin for browse-URL assembly; never a token).
- [x] Declare the pure assembler signature `jiraWebUrl(siteUrl: string | undefined, issueKey: string): string | undefined` (new `src/main/integrations/jiraWebUrl.ts`).
- [x] Declare the renderer openable-URL guard signature in `src/renderer/jiraCatalog/logic.ts` (mirror `isOpenableWebUrl`) → `isOpenableJiraWebUrl`.
- [x] Review new types vs spec — no invented fields; `webUrl` is the only new DTO field.

### Phase 2 — Testing (write first / alongside)

- [x] `jiraWebUrl.test.ts`: happy path (`https://acme.atlassian.net` + `PROJ-1` → `https://acme.atlassian.net/browse/PROJ-1`, key URL-encoded); missing/empty `siteUrl` → `undefined`; non-`http(s)` / unparseable site → `undefined`; trailing-slash site normalized. (9 cases)
- [x] `logic.test.ts`: openable-URL guard accepts absolute `http(s)`, rejects empty/`undefined`/`mailto:`/relative; `isTransitionSubmittable` no-op/placeholder guard (FR-006, current/in-flight id).
- [x] `jiraSurfaceBuilder.test.ts`: detail surface header `TicketCard` carries the bound issue including `webUrl` when present; absent `webUrl` omitted from the seeded value.
- [x] `jiraClient`: `getIssue` includes `webUrl` when `auth.siteUrl` present, omits it otherwise; existing transitions/secret tests unbroken.
- [x] Confirm no secret leaks into any asserted payload/surface (DTO carries only the non-secret browse URL).

### Phase 3 — Implementation

- [x] `src/main/integrations/jiraWebUrl.ts`: implement the pure assembler (build `<origin>/browse/<encodeURIComponent(key)>`, parse-and-validate `http(s)`, else `undefined`). Uses `URL.origin` so a stray path/query on siteUrl can't corrupt the browse path.
- [x] `src/main/jiraManager.ts`: add `readSiteUrl(tokens)` (reads `extra.siteUrl`) and populate `JiraCallAuth.siteUrl` in `auth(tokens)` (spread-when-present).
- [x] `src/main/integrations/jiraClient.ts`: in `getIssue`, compute `key` first, then `...(webUrl ? { webUrl } : {})` on the returned `JiraIssueDetail`.
- [x] `src/main/jiraSurfaceBuilder.ts`: confirmed `webUrl` rides the whole bound issue value (no code change to binding); added FR-010/FR-022 tracing comment on the header.
- [x] `src/renderer/jiraCatalog/logic.ts`: added `isOpenableJiraWebUrl`; extended `isTransitionSubmittable(transitionId, currentId?)` no-op guard (backward compatible — optional 2nd arg).
- [x] `src/renderer/jiraCatalog/components.tsx` — `TransitionPicker`:
  - [x] Removed the `Apply` `<Button>` (`Button` import kept — still used by AddComment/Create/Edit).
  - [x] Dispatch `JiraBoundAction.Transition` from `Select`'s `onValueChange` when valid + not current/placeholder (no-op guard — FR-006).
  - [x] `applying` (`useState`) lock: disables `Select`, shows `Loader2` + "Applying…" + `aria-busy`; guards a second dispatch (no double-dispatch — FR-003).
  - [x] Settle/idle relies on the deterministic re-push remounting the picker; "No transitions available." early return kept verbatim (FR-007).
  - [x] No optimistic local status mutation — status changes only on the server re-read (FR-004).
- [x] `src/renderer/jiraCatalog/components.tsx` — `TicketCard`:
  - [x] Reads `boundIssue.webUrl`; whole-key anchor (`<a>` + `ExternalLink size-3 aria-hidden`) when `isOpenableJiraWebUrl`, plain `Badge` text otherwise (FR-012).
  - [x] Focus ring (`ring-ring`/`ring-offset-card`) + `aria-label="Open <KEY> in Jira"`; icon `aria-hidden` (FR-015).
  - [x] Dock-only — list/board builder never binds `webUrl`, so the plain-badge branch renders there automatically (FR-020).
- [x] `JIRA_OAUTH_SCOPES` left UNCHANGED — no scope edit.
- [x] `npm run typecheck`: my files (jira/shared) clean. `npm test`: full suite 1911 pass / 0 fail. UI behavior (apply busy/success/failure, link open) NOT exercised — needs live `npm run dev`. NOTE: two pre-existing typecheck errors remain in untracked Slack #104 files (`slackPermalink.ts`, `SlackPanel.tsx`) — outside this feature's scope.

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md`: note (a) the Jira detail dock now auto-applies a transition on select (no Apply button), and (b) the ticket-detail carries a non-secret browse `webUrl` (`<siteUrl>/browse/<KEY>`) rendered as an external link — mirroring the Confluence detail web-link. Keep the deterministic-write description intact (the status remains server-confirmed via re-read).
- [ ] Update `TODO.md` via wrap-up if a milestone item exists.
- [ ] Update this plan's Deviations with anything that differed.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-21**: Plan authored. Open question resolved by user — immediate apply, NO confirmation/undo step. Design step (designer) precedes implementation (Phase 0). `write:jira-work` scope unchanged; no new OAuth scope.
