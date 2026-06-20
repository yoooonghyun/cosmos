# Plan: Slack Thread Side-Panel & Attachment Image Viewer — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/slack-thread-sidepanel-and-image-viewer-v1.md

---

## Summary

Two renderer-only Slack panel changes, no main-process / IPC / MCP / adapter work. (1) Replace the
`view.kind === 'thread'` whole-base swap in `SlackPanel.tsx` with a **right-docked thread region**
driven by a single renderer-local "open thread" state (`{ channelId, threadTs }` + parent display
fields). Both surfaces feed that one state: the native panel via the row's `onOpenThread`, the
generative A2UI surface via the existing `SLACK_OPEN_THREAD_ACTION` → `handleSurfaceAction` intercept
(today both land on the native `view`; we retarget both to the new open-thread state). The thread
region reuses the existing reply `MessageList` (still calling read-only `window.cosmos.slack.getReplies`,
still dropping the duplicate root). When the panel is narrow the region is a drawer that overlays the
list. (2) Make the `MessageImages` thumbnails in the shared `SlackMessageRow` clickable to open the
existing shadcn `Dialog` showing the larger image via the SAME opaque `cosmos-slack-img://` ref — no
token, no new IPC. UI-bearing → a designer step (2.5) precedes interface/tests/impl.

## Technical Context

| Item              | Value                                                                                              |
|-------------------|----------------------------------------------------------------------------------------------------|
| Language          | TypeScript / React (renderer only)                                                                 |
| Key dependencies  | `window.cosmos.slack.getReplies` (existing), shadcn `Dialog` (`components/ui/dialog.tsx`), opaque `cosmos-slack-img://` refs (existing), shared `SlackMessageRow` |
| Files to create   | `src/renderer/slackThreadPanelLogic.ts` (+ `.test.ts`) — pure open-thread state reducer/derivations; `src/renderer/slackCatalog/SlackImageViewer.tsx` (Dialog-based viewer); possibly `src/renderer/slackCatalog/slackImageViewerLogic.ts` (+`.test.ts`) only if non-trivial logic emerges |
| Files to modify   | `src/renderer/SlackPanel.tsx` (open-thread state + right-docked region + drawer, replace `view.kind==='thread'`); `src/renderer/SlackPanel.tsx` `handleSurfaceAction` (route `SLACK_OPEN_THREAD_ACTION` to open-thread state, not `setView`); `src/renderer/slackCatalog/SlackMessageRow.tsx` (clickable thumbnails → viewer); `src/renderer/slackCatalog/logic.ts` (only if the open-thread context shape needs a shared type — likely reuse `SlackOpenThreadContext`) |

**Grounding notes that fix the approach (verified against HEAD):**

- `SlackPanel.tsx:225` `View` union has `{ kind: 'thread'; channel; parent }`; `:969` the native
  history row's `onOpenThread` does `setView({ kind:'thread', channel, parent })`; `:976–1010` the
  `view.kind==='thread'` branch REPLACES the native base with parent header + reply `MessageList`
  calling `getReplies` and filtering the root (`m.ts !== view.parent.ts`). This whole block is what
  moves into a docked region; the reply `MessageList` body (fetch + root-drop + reconnect/empty/error
  states) is reused verbatim — it already satisfies FR-002/FR-003/FR-006.
- `SlackPanel.tsx:747` `handleSurfaceAction` already reconstructs `{ channel, parent }` from the
  generative `SLACK_OPEN_THREAD_ACTION` context and calls into the native thread `view`. Retarget it
  to set the SAME open-thread state instead — this is the single seam that makes the drawer work for
  BOTH surfaces (FR-001/FR-013). `SLACK_OPEN_THREAD_ACTION` + `buildOpenThreadContext` +
  `SlackOpenThreadContext` already exist in `slackCatalog/logic.ts` and carry only non-secret fields.
- `SlackMessageRow.tsx:92–108` `MessageImages` renders `<img src={img.ref}>` thumbnails (opaque
  refs). The viewer reuses the same `img.ref` for the large image and the `img.alt` for the broken
  fallback (FR-009/FR-012). `SlackImageRef` = `{ ref; alt?; w?; h? }` (`shared/slack.ts:79`).
- The shared row is purely presentational (no SDK/`useBound` hooks) and used by BOTH surfaces, so
  thumbnail-click → viewer added here covers native AND generative for free (FR-008/FR-010).

**.ts / .tsx split (DEVELOPMENT.md convention):** the open-thread state transitions are pure and
unit-testable, so they live in `slackThreadPanelLogic.ts` (open/retarget/close/toggle reducer +
"is this row's thread open?" derivation + root-drop helper if extracted), tested in
`slackThreadPanelLogic.test.ts`. `SlackPanel.tsx`/`SlackImageViewer.tsx` keep only JSX + wiring.

**Per-tab interaction:** open-thread state is per-tab like `SlackNav` (`SlackPanel.tsx:236`,
`SLACK_NAV_DEFAULT`); confirm during impl whether it nests into `SlackNav` or sits beside it. Default:
add `openThread?: OpenThreadState` to the per-tab nav so switching tabs preserves each tab's drawer
(matches the existing per-tab nav decision, bug `panel-shared-tab-nav-state-v1`).

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 2.5 — Design (REQUIRED, designer owns; precedes interface/tests/impl)

- [ ] Design spec at `.sdd/designs/slack-thread-sidepanel-and-image-viewer-v1.md`
- [ ] Right-docked thread region: side-by-side layout above a width breakpoint; right-drawer OVERLAY
  (does not squeeze the list) below it (FR-001/FR-007, OQ-2 resolution). Header (parent row + close),
  reply list region, divider/border, z-index vs. composer/footer.
- [ ] Thread region states: loading / error+retry / empty ("No replies.") reuse house style (FR-006).
- [ ] Image viewer (`Dialog`) presentation: bounded large image (fit viewport, no OS-fullscreen),
  caption/alt, close control; broken-image fallback (FR-008/FR-011/FR-012). Override `Dialog`'s
  `sm:max-w-lg` default for image sizing.
- [ ] Confirm both affordances stay visually consistent with existing Slack panel (FR-014).

### Phase 3 — Interface

- [x] Define `OpenThreadState` type + transitions in `src/renderer/slackThreadPanelLogic.ts`
  (open(ctx) / retarget / close / toggle-same; `isThreadOpen(state, channelId, threadTs)`). Reuse
  `SlackOpenThreadContext` from `slackCatalog/logic.ts` for the carried fields — no new secret field.
  DONE: `OpenThreadState = SlackOpenThreadContext | null`; `openThread`/`closeThread`/`isThreadOpen`/
  `dropThreadRoot` (root-drop extracted here too for node-testability).
- [x] Add `onImageClick?: (img: SlackImageRef) => void` (or open-on-click internally) to
  `SlackMessageRow` `MessageImages`; decide viewer-state ownership (row-local `Dialog` vs. lifted).
  DONE: thumbnails are real `<button>`s calling `onView(img)`; viewer state row-local in
  `SlackMessageRow` (`useState<SlackImageRef|null>`), one `SlackImageViewer` per row → both surfaces.
- [x] Review types vs spec — no invented properties, no token-bearing field (FR-013/FR-009).

### Phase 4 — Testing (`.test.ts` for pure logic; component tests where they pay off)

- [x] `slackThreadPanelLogic.test.ts`: open sets state; retarget to a different thread; toggle same
  thread closes (FR-004); close resets; `isThreadOpen` correctness. (16 cases, all green.)
- [x] Root-drop helper test (parent `ts` filtered from replies) — extracted (FR-003).
- [x] Image viewer logic test: trivial (onError boolean) → covered by component; no separate `.ts`.
- [x] No test asserts any token / `files.slack.com` URL is present (guards FR-009) — added explicit
  no-token/no-secret guard test on the carried state shape.

### Phase 5 — Implementation

- [x] `SlackPanel.tsx`: remove `view.kind==='thread'` whole-base branch; render reply `MessageList`
  (verbatim fetch/root-drop/states) inside a new right-docked region driven by open-thread state.
  DONE via new `SlackThreadPanel` component (header + parent row + reused `MessageList`).
- [x] Native row `onOpenThread` and `handleSurfaceAction` (`SLACK_OPEN_THREAD_ACTION`) BOTH set the
  one open-thread state (`openThreadFor`); removed the `setView({kind:'thread'})` path. Generative
  intercept still returns `true` (never forwarded to main).
- [x] Drawer/overlay at narrow width (OQ-2); side-by-side above breakpoint via VERIFIED Tailwind v4
  container queries (`@container/slackbody` + `@[32rem]/slackbody:*` — emit confirmed in built CSS,
  NO JS fallback needed). Close on channel/view change (`setView` clears `openThread`).
- [x] `SlackMessageRow` thumbnails clickable → `SlackImageViewer` (`Dialog`) with same `img.ref` +
  `alt` fallback; Esc/backdrop/close dismiss; focus return (Radix built-in, FR-011).
- [x] Removed the `{ kind:'thread' }` `View` variant + the old `MessageRow message={view.parent}`
  thread base path; kept `View` for channels/history/search.
- [x] All tests pass (1467); `npm run typecheck` clean; `npm run build` clean; reused `MessageList`
  reply-fetch — no duplicated logic.

### Phase 6 — Docs (wrap-up)

- [ ] (architect) Update `docs/ARCHITECTURE.md` Slack panel description: thread replies dock to a
  right-side panel (drawer overlay when narrow), shared by native + generative via the canonical
  `SlackMessageRow` + a renderer-local open-thread state (OQ-3).
- [ ] (architect) Reconcile `slack-generative-message-parity-v1` "native thread-view drill-in"
  wording / OQ-1 / FR-008 to reference this v1 (OQ-3).
- [ ] Update `docs/PROJECT-STRUCTURE.md` for new files; reconcile `TODO.md`.
- [ ] Update this plan's Deviations with anything that differed.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-20**: Plan authored. Open questions OQ-1/2/3 resolved in spec (both surfaces; right-drawer
  overlay when narrow; doc reconcile at wrap-up). No main/IPC/MCP changes — renderer-only.
- **2026-06-20 (impl)**: Built Phases 3–5. Files: NEW `src/renderer/slackThreadPanelLogic.ts`
  (+`.test.ts`), NEW `src/renderer/slackCatalog/SlackImageViewer.tsx`; MODIFIED `SlackPanel.tsx`
  (open-thread per-tab nav state, `SlackThreadPanel` dock, two-pane container-query layout in BOTH
  the native history view and the generative-surface region, `handleSurfaceAction` → `openThreadFor`),
  `SlackMessageRow.tsx` (button thumbnails + row-local viewer). Container queries: Tailwind v4 emits
  named container utilities natively in this repo (confirmed `container: slackbody / inline-size`,
  `@container slackbody (min-width: 32rem)`, `clamp(18rem,42%,28rem)` in built CSS) — JS fallback NOT
  needed. No `slackImageViewerLogic.ts` created (onError boolean too trivial; covered by the
  component). `npm run typecheck` + `npm test` (1467) + `npm run build` all green.
