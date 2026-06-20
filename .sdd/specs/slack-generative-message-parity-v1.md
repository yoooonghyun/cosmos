# Spec: Slack Generative Message Parity — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: subsumes `.sdd/specs/slack-thread-replies-v1.md` (the replies portion below is the
parity-scoped successor of that held spec; see Open Questions on whether to formally retire it)
**Related plan**: .sdd/plans/slack-generative-message-parity-v1.md (to be authored — Step 2)

---

## Grounding

> Investigated directly via codegraph + agentmemory before authoring (CLAUDE.md SDD rule). I did
> NOT trust the request's notes blindly — each was re-verified against the current tree. agentmemory
> had NO records for this area (empty recall on every Slack-catalog / wrap / skeleton / unify query),
> so there are no superseded prior decisions to honor; grounding is from codegraph against HEAD.

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `SlackPanel MessageRow MessageList thread replies search native panel` → native `MessageRow`
  (`SlackPanel.tsx:191`) renders `whitespace-pre-wrap break-words` inside `min-w-0 flex-1`; native
  `MessageList` (`:460`) wraps rows in a Radix `<ScrollArea className="h-full">` (`:521`) and shows
  `<MessageSkeletons/>` while `loading` and `<EmptyLine>` only once `loaded && items.length === 0`.
- `SlackPanel GeneratedUiPanel catalog mount overflow-auto MessageList thread view render container`
  → the GENERATED Slack surface mounts inside a **plain `overflow-auto` div** (`SlackPanel.tsx:1002`,
  and the same pattern in `GeneratedUiPanel.tsx:108`) — **NOT** a Radix `ScrollArea`. So the prior
  `display:table` ScrollArea fix does not cover the generated path; the catalog `MessageList` root is
  `flex flex-col` with NO `min-w-0`.
- `useBound useDataBinding boundRows showEmptyState AdapterDispatcher refresh loading items replace` →
  catalog `MessageList` gates its empty state purely on `showEmptyState(items.length, errorMessage)`
  = `rowCount === 0 && !error` (`slackCatalog/logic.ts:92`); `loading` is read into `isLoading` but
  only drives `aria-busy`, never the empty-vs-skeleton choice. `AdapterDispatcher.refresh` clears to
  the base cursor and runs `'replace-fresh'`, momentarily yielding zero items while `loading=true`.
- `slackRenderUiServer render_slack_ui tool description catalog SlackMessage replies thread fetchReplies SlackManager conversationsReplies`
  → `render_slack_ui` is display-only; `getReplies` exists end-to-end (`slackClient.ts:275`,
  `slackManager.ts:190`, `slackBridge.ts:164`, exposed `window.cosmos.slack.getReplies`,
  `ipc.ts`), but `slackAdapter.ts:23` deliberately does NOT map it ("held `slack-thread-replies-v1`").
- Read `slackAdapter.ts`, `slackCatalog/components.tsx`, `catalogShared/controls.tsx`,
  `ActiveTabSurface.tsx`, `scroll-area.classes.ts`, `SlackPanel.tsx` (native thread view `:945`).

**memory_recall / memory_smart_search queries run (takeaways):**

- `slack message overflow wrap ScrollArea display table decodeSlackText thread replies` → empty.
- `slack message overflow wrap generative catalog jira generative adapter loading skeleton refresh empty state unify message row` → empty.
- No agentmemory records exist for this feature area; nothing to reconcile.

**Load-bearing facts that drive this spec:**

1. **Wrap (report #1) root cause is NOT the ScrollArea `display:table` bug.** That bug
   (`scroll-area.classes.ts`) only affects native surfaces, which render inside Radix `ScrollArea`.
   The generated Slack surface renders inside a plain `overflow-auto` div, and the catalog
   `MessageList`/`SearchResultList` root is `flex flex-col` with no width clamp. Inside an
   `overflow-auto` container a flex/block child sizes to its content's intrinsic max width, so a
   long unbroken token expands the list wider than the panel and the per-`<p>` `break-words` cap
   fails — the cap's containing block is already over-wide. Fix belongs at the list/row CONTAINER
   width-constraint level, not per-`<p>`. (Newlines ARE in the data — `decodeSlackText` preserves
   `\n` at the single client mapping point feeding both surfaces — so this is layout, not decode.)
2. **Replies (report #2):** the read IPC `getReplies` is already wired and used by the native panel;
   only the generated catalog lacks an affordance. A held spec/plan (`slack-thread-replies-v1`)
   already designed a renderer-local inline-expand mechanism; this parity spec carries that behavior
   forward as one of three bundled concerns.
3. **Skeleton (report #3):** catalog list empty-state gating ignores `loading`, so an in-flight
   refresh (items momentarily zero, `loading=true`) paints the "No …" empty state. Distinguishing
   "loading" from "genuinely empty" requires the empty state to require `loading=false` AND a
   has-loaded-once signal, matching the native panel's `loaded && items.length === 0` rule.

---

## Overview

Bring cosmos's Slack **agent-composed** (generated-UI / `catalogId: 'slack'`) message rendering to
parity with the **native** Slack panel by unifying their message-row presentation and fixing three
divergences the user reported: long lines that overflow horizontally instead of wrapping, thread
replies that cannot be viewed in the generated surface, and a refresh that flashes a "No content"
empty state instead of a loading skeleton. The unifying directive is to share one message-row
presentation between the native and generated surfaces so these behaviors cannot diverge again.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice to have).

### Long Slack lines wrap in the generated surface · P1

**As a** cosmos user reading an agent-composed Slack message history or search result
**I want** long lines and long unbroken tokens (URLs, IDs, code) to wrap within the panel width
**So that** I can read the full text without horizontal scrolling, exactly as in the native panel

**Acceptance criteria:**

- Given a generated Slack surface containing a message whose text has a very long unbroken token
  (e.g. a long URL or path with no spaces), when the surface renders, then that token wraps within
  the panel width and the message row does not force horizontal overflow of the surface.
- Given a generated Slack surface narrower than a message's longest line, when rendered, then the
  text reflows to the available width and no horizontal scrollbar appears solely because of message
  text width.
- Given the same long-token message rendered in BOTH the native panel and the generated surface at
  the same panel width, when compared, then both wrap it the same way (visual parity).
- Given a generated `SearchResultRow` (not just `MessageRow`) with a long unbroken token, when
  rendered, then it wraps identically (the fix is structural, covering every catalog message-style row).

### View a thread's replies in the generated surface · P1

**As a** cosmos user looking at an agent-composed Slack message history
**I want to** see the replies of a message that has a thread
**So that** I can read the conversation without leaving the generated surface, as the native panel allows

**Acceptance criteria:**

- Given a generated `MessageRow` with `replyCount > 0` and thread coordinates available, when the
  surface first renders, then the thread is collapsed (only the "N replies" indicator shows) and no
  replies are fetched.
- Given a collapsed thread, when I activate the "N replies" affordance, then its replies are fetched
  via the existing read-only thread read and displayed consistently with how the native panel shows
  replies (interaction model — inline expand vs. drill-in — per the resolved Open Question OQ-1),
  each reply using the same message-row presentation as the parent.
- Given the parent is the thread root that Slack returns as the first reply item, when replies
  render, then the parent is not shown twice (the root is dropped, matching native behavior).
- Given replies are being fetched, when the fetch is in flight, then the affordance shows a loading
  state and cannot be double-triggered into a second concurrent fetch.
- Given a `MessageRow` that has no thread coordinates (`channelId`/`threadTs`), when rendered, then
  it degrades to the non-interactive "N replies" label rather than erroring.

### Refresh shows a skeleton, not an empty state · P1

**As a** cosmos user refreshing an agent-composed Slack list
**I want to** see a loading skeleton while the refresh is in flight
**So that** I am not misled by a "No content" message that flashes before data arrives

**Acceptance criteria:**

- Given a generated Slack list with items, when I trigger a refresh and the refetch is in flight
  (items momentarily cleared, loading active), then the list shows a loading skeleton in the house
  style — not the "No messages." / "No results." / "No channels." empty state.
- Given a refresh that completes with zero items, when loading ends, then the genuine empty state is
  shown (the skeleton is not shown indefinitely, and empty is not suppressed forever).
- Given a generated list that has never loaded, when it first paints before its initial data arrives,
  then it shows the skeleton (or the existing first-paint seed), never the empty state prematurely.

### Graceful failure when replies cannot load · P1

**As a** user clicking a thread whose replies fail to load (network / reconnect-needed / not connected)
**I want** a clear, non-alarming inline message instead of a crash or hung spinner
**So that** I understand the thread could not load and the rest of the surface stays usable

**Acceptance criteria:**

- Given a click on a thread, when the read fails for any reason, then an inline error/notice is shown
  for that thread (no crash, no white-screen, no hung spinner) and the rest of the surface stays
  interactive.
- Given a failed expansion, when I retry the affordance, then a fresh fetch is attempted.
- Given Slack is not connected when I activate the affordance, then the inline message communicates
  that connecting Slack is required, consistent with the read-only tools' not-connected posture.

### Unified message-row presentation · P2

**As a** cosmos maintainer
**I want** the native and generated Slack surfaces to share one message-row presentation
**So that** wrap, replies, and timestamp/author behavior cannot silently diverge between them again

**Acceptance criteria:**

- Given a change to the shared message-row presentation (wrap behavior, author/timestamp rendering),
  when applied, then it takes effect in both the native and generated surfaces without duplicated edits.
- Given the A2UI catalog architecture's constraints (the generated row is an SDK-injected catalog
  node), when full code-sharing is not possible, then any unavoidably-separate piece is explicitly
  identified and kept minimal, with the wrap/author/timestamp/reply presentation shared to the extent
  the architecture allows.

### Read-only posture and secret safety preserved · P1

**As a** security-conscious operator
**I want** this work to add no write capability and leak no token
**So that** the Slack generated-UI surface stays strictly read-only and secret-safe

**Acceptance criteria:**

- Given any interaction added by this feature (reply expand, refresh), when data is fetched, then
  only read-only Slack reads are used — no Slack write of any kind.
- Given any payload crossing a process boundary for this feature, when inspected, then it carries no
  Slack token or secret.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Each traces to a scenario/grounding.

| ID     | Requirement                                                                                                                                                                                 |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | Generated-UI Slack message rows MUST wrap long lines and long unbroken tokens within the panel width, matching the native panel's wrapping at the same width.                              |
| FR-002 | The wrap fix MUST be applied at the structural (list/row container) level of the catalog render chain — constraining the width/overflow of the bound list and its rows — NOT only on the per-`<p>` text node, so it cannot be defeated by an over-wide ancestor. |
| FR-003 | The wrap fix MUST cover every catalog message-style row that renders Slack text (`MessageRow` and `SearchResultRow` at minimum), not just the message-history row.                         |
| FR-004 | The system MUST identify and document the actual ancestor width/overflow constraint in the generated Slack render chain (the catalog renders inside a plain `overflow-auto` div, distinct from the native Radix `ScrollArea`) so the fix targets the real cause. |
| FR-005 | The generated `MessageRow` MUST render the "N replies" indicator as an interactive affordance when `replyCount > 0` and thread coordinates are present, replacing the current dead label.  |
| FR-006 | A freshly composed/refreshed generated surface MUST NOT preload thread replies; each thread starts collapsed and fetches replies only on the user's activation (on-demand).               |
| FR-007 | On activation, the system MUST fetch a thread's replies via the existing read-only Slack thread read (`getReplies`) and MUST NOT perform any Slack write or expose any token.             |
| FR-008 | Fetched replies MUST be presented consistently with the native panel's thread view, each reply using the same message-row presentation as the parent (no divergent reply row visual). The interaction model (inline expand vs. drill-in / native-thread reuse) is fixed by OQ-1. |
| FR-009 | The system MUST NOT render the thread root twice: the parent message Slack returns as the first reply item MUST be dropped from the reply list (native parity).                            |
| FR-010 | While a thread's replies are being fetched, the affordance MUST show a loading state and MUST prevent a second concurrent fetch for that thread.                                          |
| FR-011 | A failed reply read (network / reconnect-needed / rate-limited / not-connected) MUST surface an inline, non-alarming error/notice for that thread — NEVER a crash, white-screen, or hung spinner — and MUST be retryable on re-activation. |
| FR-012 | A generated `MessageRow` lacking thread coordinates, or with `replyCount` 0/absent, MUST degrade to the non-interactive "N replies" label (or no label) without error.                    |
| FR-013 | If the reply affordance requires thread coordinates not already present on the bound row, the system MUST carry them through the existing validated boundaries (the `render_slack_ui` node schema and/or the adapter's bound-row mapping) — NOT via any new secret-bearing field. Any new node prop or bound region MUST be specified on the one typed contract. |
| FR-014 | A bound generated Slack list MUST show a loading skeleton (house style) while a refresh is in flight, instead of its empty state.                                                          |
| FR-015 | The empty-vs-skeleton decision MUST distinguish "loading" from "genuinely empty": the empty state MUST be shown only when the list is empty AND not loading AND has completed at least one load (mirroring the native `loaded && items.length === 0` rule); otherwise the skeleton (or first-paint seed) shows. |
| FR-016 | The loading-skeleton change MUST NOT regress the existing recoverable-error notice precedence (an error still supersedes both the empty state and, where data is absent, the skeleton, per the established bound-list gating). |
| FR-017 | The native and generated Slack surfaces MUST share ONE message-row presentation for author/timestamp/text(wrap)/reply affordance, to the extent the A2UI catalog architecture permits a shared presentational component; any piece that cannot be shared MUST be explicitly identified and minimized. |
| FR-018 | This feature MUST NOT introduce any Slack write or change the generated surface's display-only posture; its render call still settles immediately and the surface remains display-only.   |
| FR-019 | No Slack token or secret MUST appear in any payload, IPC message, MCP result, bridge frame, or A2UI surface introduced by this feature; cross-process payloads MUST be validated at the main-process boundary (invalid → warn + ignore, never crash). |
| FR-020 | Expanded/collapsed thread state and fetched replies MAY be renderer-local UI state only; they need NOT be persisted into the composed surface spec or any session snapshot (a restore re-collapses and re-fetches on demand). |

## Edge Cases & Constraints

- **Long unbroken token (no whitespace)** → wraps within panel width; covers `MessageRow` and
  `SearchResultRow` (FR-001/FR-003). The native ScrollArea `display:table` fix does NOT apply to the
  generated path (different container) — do not assume parity is "already inherited."
- **Mixed content with embedded newlines** → newlines are preserved (decode already runs upstream);
  the fix must not strip or collapse them while wrapping.
- **Refresh in flight with prior items** → skeleton, not empty state (FR-014); prior items MAY be
  cleared during `replace-fresh` — the gating must treat that transient zero-item + loading state as
  "loading", not "empty".
- **Refresh returns zero items** → genuine empty state shows once loading ends (FR-015); skeleton must
  not persist.
- **Recoverable read error during refresh** → the error notice still takes precedence over both empty
  and skeleton per existing gating (FR-016).
- **Thread reply fetch fails / not connected / rate-limited** → inline notice for that thread,
  retryable; rest of surface interactive (FR-011).
- **Zero replies returned despite `replyCount > 0`** (e.g. all deleted) → benign "no replies" inline
  state, not an error.
- **`MessageRow` without thread coordinates** → non-interactive label, no error (FR-012).
- **Restore after restart** → composed surface spec restored verbatim; threads come back collapsed and
  re-fetch on demand (FR-020).
- **Catalog-architecture constraint on unification** → the generated row is an SDK-injected catalog
  node (props spread by the A2UI SDK; rows take `surfaceId`/`componentId`), whereas the native row
  takes a `SlackMessage` and a callback; full code-sharing may be limited to a shared presentational
  inner component plus thin per-surface adapters — the plan/design must define exactly how far the
  shared component reaches (FR-017).
- **Out of scope:** reply pagination beyond the first page is OPTIONAL for v1 (defer "load more" of
  long reply chains — see OQ-2); posting/editing/reacting to messages or replies (read-only); real-time
  thread/message updates; changing the native panel's own behavior beyond extracting the shared row.

## Success Criteria

| ID     | Criterion                                                                                                                          |
|--------|----------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | A long unbroken token in a generated `MessageRow` and `SearchResultRow` wraps within the panel width — no horizontal overflow — matching the native panel at the same width. |
| SC-002 | On a generated Slack surface, activating "N replies" reveals that thread's replies (parent not duplicated), each using the same message-row presentation as the native panel. |
| SC-003 | Triggering a refresh on a generated Slack list shows a loading skeleton while in flight; a zero-item result then shows the empty state, and a non-empty result shows the rows. |
| SC-004 | A reply read failure renders an inline message and never crashes/white-screens/hangs the surface; re-activation retries; not-connected shows the connect message. |
| SC-005 | A change to the shared message-row presentation takes effect in both the native and generated surfaces without duplicated edits. |
| SC-006 | No Slack write is performed and no token/secret appears in any payload, IPC message, MCP result, bridge frame, or surface introduced by this feature. |

---

## Open Questions

> These genuinely require user input before planning. The plan step should not proceed past the
> affected areas until OQ-1 (and ideally OQ-3) are resolved.

- [x] **OQ-1 — Replies interaction model.** SUPERSEDED by
  `.sdd/specs/slack-thread-sidepanel-and-image-viewer-v1.md` (2026-06-20). The thread interaction is
  now a **right-docked thread panel** (drawer overlay when the panel is narrow), NOT a whole-view
  drill-in and NOT inline expand. One renderer-local open-thread state, keyed off the canonical
  `SlackMessageRow`, serves BOTH the native and generative surfaces (native via `onOpenThread`,
  generative via `SLACK_OPEN_THREAD_ACTION` → `handleSurfaceAction`); both reuse the read-only
  `getReplies` reply list with the root dropped and the parent as header. The original options
  below (a inline-expand / b drill-in / c native-thread-view reuse) are retained for history only.
  Options were: (a) **inline expand** — replies nest/indent under the parent
  within the composed surface (the held `slack-thread-replies-v1` direction); (b) **drill-in** —
  activating "N replies" navigates the tab to a thread view (reuses the renderer-local nav-action
  seam, like channel-open), replacing the composed surface; (c) **reuse the native thread view**
  component directly.
- [ ] **OQ-2 — Reply pagination scope (v1).** Native paginates replies via `nextCursor` "Load more".
  Is **first-page-only** acceptable for the generated surface in v1 (paging deferred), or must the
  reply view also offer "Load more"? Default assumption pending confirmation: first-page-only.
- [ ] **OQ-3 — How far should native/generated unification physically go?** Acceptable targets:
  (i) a shared presentational inner row component both surfaces wrap (maximal sharing, but the
  generated row stays an SDK-injected catalog node wrapping it); (ii) a shared CSS/structural
  contract only (same wrap classes/container rule, separate components); (iii) full reuse of the
  native `MessageRow` inside the catalog node. The architecture allows (i) cleanly; (iii) may fight
  the SDK prop-injection model. NEEDS USER DECISION on the desired depth so the plan/design can fix
  the boundary.
- [ ] **OQ-4 — Disposition of `slack-thread-replies-v1`.** This spec subsumes that held spec's
  replies behavior. Should `slack-thread-replies-v1` be formally marked Superseded by this v1, or
  kept as the detailed sub-spec the plan references? (Process choice, not behavioral.)
