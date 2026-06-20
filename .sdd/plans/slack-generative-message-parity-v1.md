# Plan: Slack Generative Message Parity — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: .sdd/specs/slack-generative-message-parity-v1.md

---

## Grounding

> Authored after directly grounding via codegraph + agentmemory against HEAD (CLAUDE.md SDD
> rule). I re-verified the spec's claims and the user's open-question decisions against the
> current on-disk source — each load-bearing fact below is from a codegraph read, not the prompt.

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `SlackPanel MessageRow MessageList native thread view ScrollArea replies search` → native
  `MessageRow` (`SlackPanel.tsx:191`) takes `{ message: SlackMessage, onOpenThread? }` and renders
  `whitespace-pre-wrap break-words` inside `min-w-0 flex-1`; native `MessageList` (`:460`) wraps rows
  in a Radix `<ScrollArea className="h-full">` and shows `<MessageSkeletons/>` while `loading`, the
  empty `<EmptyLine>` only once `loaded && items.length === 0` (`:511`/`:517`). The native **thread
  view** (`:945`) is INLINE JSX in the panel's `view.kind === 'thread'` branch (a header `MessageRow`
  over a bordered `MessageList` whose `load` calls `getReplies` and `.filter`s out the parent `ts`),
  reached via `setView({ kind:'thread', channel, parent })` from `onOpenThread`.
- `slackCatalog components MessageRow SearchResultRow MessageList logic showEmptyState boundRows` →
  catalog `MessageRow` (`slackCatalog/components.tsx:187`) is a near-duplicate of native (own copy of
  the same JSX), takes node props `{ ts, userId, userName, text, replyCount }`, renders the reply
  count as a **dead `<p>` label**, and `replyCount` is the only thread signal it has (NO
  `channelId`/`threadTs`). `MessageList`/`SearchResultList` roots are `flex flex-col` with **no width
  clamp**; their empty state is gated purely on `showEmptyState(items.length, errorMessage)`
  (`logic.ts:92` = `rowCount === 0 && !error`) — `loading` is read into `isLoading` but only drives
  `aria-busy`, never the empty-vs-skeleton choice. There is NO skeleton component in the catalog yet.
- `slackAdapter mapMessage bound row history getReplies replyCount messages rows mapping replace-fresh` →
  `slackMessageRow` (`slackAdapter.ts:108`) maps `{ ts, userId, userName?, text, replyCount? }` — no
  thread coords. BUT the `getHistory` branch (`:186`) already HAS `descriptor.query.channelId` in
  scope, and each message's own `ts` IS its `threadTs`. `AdapterDispatcher.refresh` (`:224`) runs
  `'replace-fresh'` from the base cursor — momentarily zero items with `loading=true` (the skeleton
  bug's trigger). `getReplies` is wired end-to-end (`slackClient.ts:275`, `slackManager.ts:190`) but
  `slackAdapter.ts:23` deliberately does NOT map it ("held slack-thread-replies-v1").
- `slackRenderUiServer render_slack_ui MessageRow node schema component` (Grep) → the tool
  description (`slackRenderUiServer.ts:176`) advertises `MessageRow { ts, userId, userName?, text,
  replyCount? }` — no thread coords; spec is `z.array(z.unknown())` (props pass through unvalidated
  per-node, validated only as a well-formed surfaceUpdate). So adding `channelId`/`threadTs` is a
  description + catalog-interface change, not a new validated schema.
- `slackAdapter ... ActiveTabSurface dispatch nav action render_slack_ui` → `ActiveTabSurface.tsx`
  routes catalog actions; `onAction` lets a panel intercept a renderer-local action (e.g.
  `SLACK_OPEN_CHANNEL_ACTION`) returning `true` = "handled, not forwarded". `handleSurfaceAction`
  (`SlackPanel.tsx:717`) is the existing intercept that opens a channel's native view IN THE CURRENT
  TAB by clearing the tab's surface + `setView({ kind:'history', channel })`. This is the exact seam
  the reply drill-in reuses.

**memory_recall / memory_smart_search queries run (takeaways):**

- `slack generative panel catalog message parity thread replies native` → empty. No prior records
  for this feature area; nothing to reconcile. (Persisted this plan's resolved decisions with
  `memory_save` after grounding.)

**Resolved Open Questions (user decisions, baked into this plan):**

- **OQ-1 (replies interaction model) → REUSE the native thread view.** The generated/catalog
  `MessageRow`'s "N replies" affordance drills the current tab into the SAME native thread-view
  component the native panel uses (`SlackPanel.tsx:945`), with `← back`. NO inline-expand. This plan
  **supersedes** the held `slack-thread-replies-v1` spec/plan (mark them Superseded — OQ-4).
- **OQ-3 (unification depth) → FULLY unify.** Extract ONE shared presentational message-row
  component imported by BOTH the native panel and the catalog node. No parallel implementations.
- **OQ-2 (reply pagination) → first-page-plus-native-paging is FREE** because we reuse the native
  thread view, which already offers "Load more" via `nextCursor`. No extra work; not a constraint.
- **Skeleton (report #3):** fix the catalog list empty-state gating to require loaded-once AND
  not-loading (mirror native `loaded && items.length === 0`).
- **Wrap (report #1):** structural container width fix on the generated `overflow-auto` div path
  (the prior Radix `display:table` ScrollArea fix does NOT apply there) — NOT per-`<p>`.

---

## Summary

Bring the Slack agent-composed (catalog `slack`) message surface to parity with the native Slack
panel by (1) extracting a single shared presentational row, **`SlackMessageRow`**, used by both the
native panel and the catalog node so wrap/author/timestamp/reply presentation can never diverge
again (full unification, OQ-3); (2) wiring the catalog `MessageRow`'s "N replies" into a renderer-
local action that drills the current tab into the EXISTING native thread view (OQ-1 — reuse, not
inline-expand), carrying secret-free thread coordinates (`channelId` from the history descriptor,
`threadTs` = the message's own `ts`) through the `render_slack_ui` node props + the adapter's
bound-row mapping (FR-013); (3) fixing the wrap divergence at the STRUCTURAL container level (the
generated surface mounts in a plain `overflow-auto` div, not a Radix `ScrollArea`, so the row/list
container must clamp its own width — `min-w-0`/`max-w-full` — rather than relying on the per-`<p>`
`break-words`); and (4) fixing the catalog list empty-vs-skeleton gating to require loaded-once AND
not-loading so an in-flight `replace-fresh` refresh shows a house-style skeleton, not "No content".
The work adds NO Slack write and leaks no token — replies use the already-wired read-only
`getReplies`; the new bound fields are non-secret. A design step follows for the shared row's visual
treatment and the catalog skeleton.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (React renderer + node MCP/adapter); Vitest |
| Key dependencies  | `@a2ui-sdk/react/0.9` (catalog/SDK), existing `getReplies` IPC (`window.cosmos.slack.getReplies`), `AdapterDispatcher`, native `SlackPanel` thread view + nav (`usePerTabNav`/`setView`) |
| Files to create   | `src/renderer/slackCatalog/SlackMessageRow.tsx` (shared presentational row + reply affordance); `src/renderer/slackCatalog/MessageSkeleton.tsx` (catalog list skeleton, house style) — names indicative, designer may rename; `src/renderer/slackCatalog/logic.ts` additions covered by existing `logic.test.ts` |
| Files to modify   | `src/renderer/SlackPanel.tsx` (native `MessageRow` → wrap shared row; reply drill-in handler), `src/renderer/slackCatalog/components.tsx` (`MessageRow`/`MessageList`/`SearchResultList` → shared row + container clamp + skeleton gating), `src/renderer/slackCatalog/logic.ts` (+ `showEmptyState` loaded/loading gating, + reply action constant), `src/renderer/slackCatalog/logic.test.ts`, `src/main/slackAdapter.ts` (`slackMessageRow` injects `channelId`/`threadTs`), `src/mcp/slackRenderUiServer.ts` (MessageRow node-prop description) |
| Out of scope      | Any Slack write; changing native thread view behavior beyond row extraction; reply pagination work (native paging is reused as-is); persisting expanded/reply state into the surface spec/snapshot |

### Decisions & rationale

- **Shared row boundary (OQ-3 "통일").** The single source of truth is a presentational
  `SlackMessageRow` taking a plain props object (`{ ts, userId, userName?, text, replyCount?,
  onOpenThread? }`) — NOT a `SlackMessage` and NOT SDK `SdkProps`. The native `MessageRow`
  (`SlackPanel.tsx:191`) becomes a 3-line adapter that spreads `message.*` into the shared row; the
  catalog `MessageRow` node (`components.tsx:187`) stays an SDK-injected wrapper that maps node props
  (incl. the new `channelId`/`threadTs`) into the shared row + supplies an `onOpenThread` that
  dispatches the renderer-local reply action. This is the maximal sharing the A2UI prop-injection
  model allows; the unavoidably-separate piece (per-surface `onOpenThread` wiring) is minimal and
  explicitly identified (FR-017). The shared row owns the wrap classes + the reply affordance markup.
- **Wrap fix location (report #1 / FR-002/FR-004).** The cap must live on the LIST/ROW CONTAINER,
  not the `<p>`. The shared row's outer flex already has `min-w-0 flex-1` on the text column, but the
  catalog `MessageList`/`SearchResultList` ROOT (`flex flex-col`) lacks a width clamp, so inside the
  plain `overflow-auto` host div the list sizes to intrinsic content width and the cap's containing
  block is already over-wide. Fix: add `w-full max-w-full min-w-0` (and ensure each row is
  `w-full min-w-0`) to the catalog list roots and rows so the wrap cap has a real containing width.
  Apply to `MessageList`, `SearchResultList`, AND `ChannelList` rows that render text (FR-003 covers
  every catalog message-style row). Native surfaces are unaffected (they keep their ScrollArea).
- **Replies via native thread view (OQ-1 / FR-005–FR-012).** A new renderer-local action constant
  `SLACK_OPEN_THREAD_ACTION = 'slack.openThread'` (in `logic.ts`) carries `{ channelId, threadTs,
  ...parent display fields }`. The catalog `MessageRow`'s `onOpenThread` dispatches it; `SlackPanel`'s
  `handleSurfaceAction` intercepts it (returns `true`, never forwarded to main), reconstructs a
  `SlackMessage` parent + a minimal `SlackChannel` from the action context, and `setView({
  kind:'thread', channel, parent })` — landing on the EXISTING native thread view. Because that view
  already collapses-by-default, fetches on demand via `getReplies`, drops the duplicate root, shows
  loading/error states, and offers native paging, **FR-006/FR-007/FR-009/FR-010/FR-011/OQ-2 are
  satisfied by reuse** with no new fetch code. A row missing `channelId`/`threadTs` does not get an
  `onOpenThread` → renders the non-interactive label (FR-012).
- **Thread coordinates carriage (FR-013).** Non-secret only: `channelId` is already in the
  `getHistory` descriptor's `query.channelId`; `threadTs` = the message's own `ts`. `slackMessageRow`
  gains an optional `channelId` arg (passed from the resolver's `getHistory` branch) and sets
  `threadTs: message.ts`. The `render_slack_ui` MessageRow description + the catalog `MessageRowNode`
  interface gain `channelId?`/`threadTs?`. No new secret-bearing field; no IPC contract change beyond
  the (already-existing) `getReplies` channel used by the native view.
- **Skeleton gating (report #3 / FR-014–FR-016).** Add a pure helper
  `showSkeletonState(rowCount, loading, loaded, error)` and tighten `showEmptyState` so the empty
  state requires `loaded && !loading` (mirroring native `loaded && items.length === 0`). The bound
  lists already read `loading`; they additionally bind a `loaded` flag (the dispatcher already
  distinguishes never-loaded from loaded — confirm the bound `loaded`/first-paint signal during
  implementation; if absent, derive loaded-once renderer-locally with a ref, never re-showing empty
  prematurely). Error precedence is preserved: error > skeleton > empty (FR-016). The skeleton is a
  new catalog component in the house style (design step).
- **Disposition (OQ-4).** This plan supersedes `slack-thread-replies-v1`; mark that spec + plan
  `Superseded by slack-generative-message-parity-v1` in their headers as a wrap-up doc task (below).

---

## Implementation Checklist

> Update as work progresses. A **design step precedes Phase 3** (the shared `SlackMessageRow`'s
> visual treatment, the reply affordance styling, and the catalog skeleton — designer owns
> `.sdd/designs/slack-generative-message-parity-v1.md` + any theme tokens). Keep the `.ts`/`.test.ts`
> node-testable split: pure gating/coordinate/label logic lives in `logic.ts` (DOM-free, unit-tested
> in `logic.test.ts`); `.tsx` shells stay thin.

> Implementation status (2026-06-18): Phases 1–3 COMPLETE in worktree `agent-ab393954505248475`
> (typecheck node+web + all 1099 tests green). Phase 4 docs: thread-replies spec/plan marked
> Superseded; TODO/ARCHITECTURE follow-ups noted below for the reconciling pass.

### Phase 1 — Interface (types + contracts, no behavior)

- [x] Re-read the spec; confirm OQ-1/OQ-2/OQ-3 + skeleton/wrap decisions above are reflected (no open
      questions remain blocking the plan).
- [ ] `src/shared` / catalog: add `channelId?: string` and `threadTs?: string` to `MessageRowNode`
      (`slackCatalog/components.tsx`) — non-secret thread coordinates (FR-013). Confirm no other
      MessageRow consumer breaks (catalog index registration unchanged).
- [ ] `src/renderer/slackCatalog/logic.ts`: add `SLACK_OPEN_THREAD_ACTION = 'slack.openThread'` and a
      typed shape for its action context `{ channelId, threadTs, ts, userId, userName?, text,
      replyCount? }` (parent display fields so the native view's header renders without a re-read).
- [ ] `src/renderer/slackCatalog/logic.ts`: add pure `showSkeletonState(rowCount, loading, loaded,
      error)` and tighten `showEmptyState(rowCount, error, loaded?, loading?)` so empty requires
      `loaded && !loading` (error still supersedes). Keep both total/no-throw.
- [ ] Define the shared row props type for `SlackMessageRow`
      (`{ ts?, userId?, userName?, text?, replyCount?, onOpenThread?: () => void }`) — plain props,
      not `SlackMessage` / not `SdkProps`. Review vs spec: no invented fields (every field traces to
      an existing native/catalog prop or FR-013).
- [ ] `src/main/slackAdapter.ts`: extend `slackMessageRow(message, channelId?)` signature (or a
      sibling) so the `getHistory` branch can pass `descriptor.query.channelId`; emit `channelId` +
      `threadTs: message.ts` ONLY when a `channelId` is present. Confirm the search/channel rows are
      untouched. No secret added (assert in review).
- [ ] `src/mcp/slackRenderUiServer.ts`: extend the `MessageRow` tool-description prop list to
      `{ ts, userId, userName?, text, replyCount?, channelId?, threadTs? }` with a note that the two
      coords are non-secret and enable the read-only thread drill-in. Spec validation unchanged
      (still `z.array(z.unknown())` per-node → no Zod schema edit).

### Phase 2 — Testing (write before/with implementation; node-testable split)

- [ ] `logic.test.ts`: `showEmptyState` — empty + loaded + not-loading + no-error → true; empty +
      loading → false; empty + never-loaded → false; empty + error present → false (error supersedes);
      non-empty → false.
- [ ] `logic.test.ts`: `showSkeletonState` — never-loaded first paint → true; loading with zero items
      (in-flight `replace-fresh`) → true; loaded + non-empty → false; loaded + empty + not-loading →
      false (defer to empty); error present → false (error supersedes skeleton per FR-016).
- [ ] `logic.test.ts`: `SLACK_OPEN_THREAD_ACTION` constant value + the action-context shape builder
      (round-trips channelId/threadTs/parent fields; omits them safely when absent → FR-012).
- [ ] `slackAdapter` unit (add `slackAdapter.test.ts` if absent, or extend): `slackMessageRow` emits
      `channelId` + `threadTs === message.ts` when a channelId is supplied; omits both when not;
      the `getHistory` resolver branch threads `descriptor.query.channelId` into the rows; search +
      channel rows carry NO thread coords; result carries no token/secret (FR-013/FR-019).
- [ ] (If feasible without a DOM harness) a render-level check that the catalog `MessageRow` with
      `channelId`+`threadTs`+`replyCount>0` exposes an interactive affordance, and without coords
      degrades to a label (FR-012) — otherwise cover via the logic builder test + manual QA note.

### Phase 3 — Implementation (after the design step)

- [ ] Create `SlackMessageRow.tsx` (shared presentational row): author/timestamp/`whitespace-pre-wrap
      break-words` text + reply affordance (interactive when `onOpenThread` present and
      `replyCount>0`, else the plain label). Container clamps its own width (`min-w-0`, text column
      `min-w-0 flex-1`). Apply the design step's visual treatment.
- [ ] `SlackPanel.tsx`: replace the native `MessageRow` body with a thin adapter spreading
      `message.*` into `SlackMessageRow` (keep `onOpenThread?` passthrough). Native thread view +
      history unchanged otherwise (no behavior regression).
- [ ] `slackCatalog/components.tsx`: `MessageRow` node → maps node props (incl. `channelId`/`threadTs`)
      into `SlackMessageRow`; supply `onOpenThread` ONLY when both coords present, dispatching
      `SLACK_OPEN_THREAD_ACTION` via `useDispatchAction`. Remove the dead reply `<p>` label (now the
      shared row owns it).
- [ ] `slackCatalog/components.tsx`: add `w-full max-w-full min-w-0` (and per-row `w-full min-w-0`) to
      `MessageList`, `SearchResultList`, and `ChannelList` text rows so the wrap cap has a real
      containing block in the `overflow-auto` host (FR-001/FR-002/FR-003). Verify parity vs native at
      a narrow width.
- [ ] `slackCatalog/components.tsx`: bind a `loaded` signal (or derive loaded-once via a ref) and
      switch the three bound lists to: error notice > `showSkeletonState` → `<MessageSkeleton/>` >
      `showEmptyState` → empty > rows. Create the catalog skeleton component (house style, from the
      design step). Confirm `aria-busy` still reflects `isLoading`.
- [ ] `SlackPanel.tsx` `handleSurfaceAction`: intercept `SLACK_OPEN_THREAD_ACTION` (return `true`),
      reconstruct `{ channel, parent }` from the action context, `setView({ kind:'thread', channel,
      parent })` in the current tab (clear the tab's surface like the open-channel intercept does).
      Read-only preserved; never forwarded to main.
- [ ] `slackAdapter.ts`: implement the `channelId`/`threadTs` injection in the `getHistory` branch.
- [ ] `slackRenderUiServer.ts`: update the description text.
- [ ] All tests pass (`npm test`); typecheck clean (`npm run typecheck` — node + web). Reused the
      shared row + existing native thread view + existing `getReplies` — no duplicated fetch/render
      logic.

### Phase 4 — Docs & wrap-up follow-ups

- [ ] Mark `.sdd/specs/slack-thread-replies-v1.md` + `.sdd/plans/slack-thread-replies-v1.md`
      **Superseded by slack-generative-message-parity-v1** (OQ-4).
- [ ] Reconcile `TODO.md` (check off / add items) via the wrap-up skill.
- [ ] **ARCHITECTURE.md follow-up (do NOT edit here — other agents editing concurrently; flag for the
      reconciling pass):** note (a) the new shared `SlackMessageRow` as the single Slack message-row
      presentation spanning native + catalog; (b) the catalog list gating now mirrors native
      `loaded && !loading` for empty-vs-skeleton; (c) the wrap fix lives at the catalog list/row
      container level because the generated surface mounts in a plain `overflow-auto` div, distinct
      from the native Radix `ScrollArea` (and its `display:table` fix); (d) the read-only thread
      drill-in reuses the native thread view via the renderer-local `slack.openThread` intercept,
      carrying only non-secret `channelId`/`threadTs`.
- [ ] Update this plan's Deviations section with anything that differed during implementation.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-18**: Plan authored. OQs resolved per user: OQ-1 = reuse native thread view (drill-in),
  OQ-3 = full unification via shared `SlackMessageRow`, supersedes `slack-thread-replies-v1` (OQ-4).
  Wrap fix = structural container width on the `overflow-auto` generated path (NOT the ScrollArea
  `display:table` fix, which does not apply there). Skeleton fix = `loaded && !loading` empty-state
  gating mirroring native.
- **2026-06-18 (implementation, developer — Steps 3–5)**: Implemented in worktree
  `agent-ab393954505248475`. Deviations from the plan text:
  - `MessageRowNode` lives in `src/renderer/slackCatalog/components.tsx` (NOT `src/shared/slack.ts` —
    that module has no `MessageRowNode`). The `channelId?`/`threadTs?` fields were added there.
  - `loaded` is NOT a bound surface field — derived loaded-once renderer-locally via a
    `useLoadedOnce(rowCount, loading)` ref hook in `components.tsx`, exactly the plan's stated
    fallback. No adapter/surface-spec change.
  - The seed builder `buildBoundMessageListSurface` (`slackSurfaceBuilder.ts`) now passes `channelId`
    into `slackMessageRow` so the FIRST-PAINT seed rows carry the thread coords (not only refresh
    rows) — affordance interactive immediately.
  - `SLACK_OPEN_THREAD_ACTION = 'slack.openThread'` is a renderer-local action (mirrors
    `SLACK_OPEN_CHANNEL_ACTION`); NOT added to `src/shared/ipc.ts` (the `ActiveTabSurface` `onAction`
    intercept consumes it before any forward to main). No IPC contract change.
  - Two existing tests asserting the pre-fix `slackMessageRow`/seed shape were updated; new tests
    added for `showSkeletonState`, tightened `showEmptyState`, `buildOpenThreadContext`, and the
    adapter coord injection (search-rows-untouched + no-token assertions).
  - `npm run typecheck` (node + web) + `npm test` (1099 tests / 56 files) both green. GUI
    verification (live Slack workspace: wrap parity, reply drill-in, refresh skeleton) DEFERRED to
    the user — cannot be exercised headlessly.
