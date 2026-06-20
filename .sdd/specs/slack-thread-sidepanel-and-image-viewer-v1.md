# Spec: Slack Thread Side-Panel & Attachment Image Viewer — v1

**Status**: Approved (open questions resolved 2026-06-20)
**Created**: 2026-06-20
**Supersedes**: revises the thread drill-in interaction model fixed by
`.sdd/specs/slack-generative-message-parity-v1.md` (OQ-1 / FR-008) and the native thread view in
`SlackPanel.tsx` — the whole-view "thread" drill-in is replaced by a right-docked thread panel.
Does NOT change that spec's wrap / skeleton / row-unification or read-only requirements.
**Related plan**: .sdd/plans/slack-thread-sidepanel-and-image-viewer-v1.md (to be authored — Step 2)

---

## Grounding

> Investigated directly via codegraph + agentmemory before authoring (CLAUDE.md SDD rule). I did
> NOT take the orchestrator's pointers on faith — each was re-verified against the current tree.

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `SlackPanel native thread view onOpenThread getReplies MessageRow replies` → the native thread
  drill-in is a whole-view switch: `SlackPanel.tsx`'s `view` state has a `{ kind: 'thread'; channel;
  parent }` variant (`:225`); clicking a row's `onOpenThread` does `setView({ kind: 'thread', … })`
  (`:969`), and the `view.kind === 'thread'` branch (`:976–1010`) REPLACES the native base (channel
  list / history / search) with a parent header + a `MessageList` calling
  `window.cosmos.slack.getReplies({ channelId, threadTs, cursor })`, dropping the root reply
  (`items.filter(m => m.ts !== view.parent.ts)`). This whole-base replacement is the "창 전환" the
  user wants gone.
- `SlackMessageRow MessageImages SlackImageRef dialog` → `src/renderer/slackCatalog/SlackMessageRow.tsx`
  is the ONE shared row used by BOTH native and generated surfaces. `MessageImages` (`:92–108`)
  renders a non-interactive `<img>` thumbnail strip from `images?: SlackImageRef[]`, each `src` an
  opaque `cosmos-slack-img://` ref (main attaches the token; renderer never sees it). The strip is
  styled `max-h-40 max-w-[12rem] … object-cover`. This is where the click-to-view affordance attaches.
- `src/renderer/components/ui/dialog.tsx` → a shadcn/Radix `Dialog`/`DialogContent`/`DialogClose`
  exists (Esc/overlay-close, focus trap, `sm:max-w-lg` default to override). Reusable for the
  in-app image viewer; no new modal primitive needed.
- `src/shared/slack.ts:79` → `SlackImageRef { ref; alt?; w?; h? }`. The SAME opaque `ref` used for
  the thumbnail can be reused for the full-size viewer `<img src>` — no token, no `files.slack.com`
  URL ever in the renderer (sidesteps the lightbox-deferral concern OQ-A of
  `.sdd/designs/slack-rich-message-render-v1.md`).
- Read `.sdd/specs/slack-generative-message-parity-v1.md` (OQ-1 left the replies interaction model
  open between inline-expand / drill-in / native-reuse; the shared row's header comment records the
  drill-in was wired) and the superseded `.sdd/specs/slack-thread-replies-v1.md`.

**memory_recall / memory_smart_search queries run (takeaways):**

- `Slack thread drill-in native panel image lightbox attachment viewer` → empty. No prior
  agentmemory records for this area; nothing to reconcile.

**Load-bearing facts that drive this spec:**

1. The read IPC `window.cosmos.slack.getReplies({ channelId, threadTs, cursor? })` is fully wired and
   returns `SlackResult<SlackPage<SlackMessage>>` — NO new IPC, main-process, MCP, or adapter change
   is required for the thread panel. It is a renderer LAYOUT change: render the same reply
   `MessageList` in a right-docked region instead of replacing the base view.
2. Thread coordinates (`channelId`, `threadTs`) are non-secret and already cross the boundary today.
   Image refs are opaque `cosmos-slack-img://` strings; the token stays in main. Neither feature
   adds any write or new secret-bearing payload.
3. The generated (A2UI `catalogId: 'slack'`) surface is display-only and embedded; the native panel
   is where the thread drill-in and clickable affordances actually live today. See the
   native-vs-generative scope decision in the Overview and OQ-1.

---

## Overview

Two in-place usability improvements to the **native Slack panel**, both keeping the user's context
visible instead of switching it:

1. **Thread replies dock to the right.** Clicking "N replies" no longer swaps the whole Slack panel
   to a thread view; instead the selected thread's replies open in a panel **docked to the right
   side**, so the message list stays visible on the left and the replies show on the right.
2. **Attachment image viewer.** Clicking an attachment image thumbnail opens a **separate in-app
   image viewer** (a modal/lightbox) showing the image larger for detail, then closes back to the
   message.

Both use only already-available read paths and opaque refs — no new write capability and no token
ever leaves main.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice to have).

### Open a thread's replies in a right-docked panel · P1

**As a** cosmos user reading a Slack channel's message history
**I want** clicking "N replies" to show that thread's replies in a panel on the right
**So that** I keep seeing the message list on the left and don't lose my place to a full-view switch

**Acceptance criteria:**

- Given a channel history where a message has `replyCount > 0`, when I click its "N replies"
  affordance, then the message list stays visible on the left and a right-side panel opens showing
  that thread: a parent/header row plus the thread's replies.
- Given the thread panel is open, when its replies are fetched, then they load via the existing
  read-only thread read and render using the same message-row presentation as the message list.
- Given the parent is the thread root Slack returns as the first reply item, when replies render,
  then the parent is not shown twice (the root is dropped from the reply list, as today).
- Given the thread panel is open, when I click a different message's "N replies", then the right
  panel updates to that thread (the left list is unchanged).
- Given the thread panel is open, when I dismiss it (close affordance), then the right panel closes
  and the message list returns to full width.

### Thread panel handles narrow widths and failures gracefully · P1

**As a** user on a narrow Slack panel or a flaky connection
**I want** the thread panel to stay usable and fail visibly without breaking the message list
**So that** I can still read or retry without losing the channel view

**Acceptance criteria:**

- Given the Slack panel is too narrow to show list and thread side-by-side comfortably, when the
  thread opens, then the thread panel becomes a right-docked DRAWER that overlays the message list
  (does not squeeze it), rather than producing horizontal overflow or clipped content.
- Given a thread whose replies fail to load (network / reconnect-needed / rate-limited / not
  connected), when the read fails, then the right panel shows a non-alarming inline message (no
  crash, no white-screen, no hung spinner) and the left message list stays interactive.
- Given a failed thread load, when I retry within the panel, then a fresh fetch is attempted,
  consistent with the existing message-list reconnect/retry posture.

### Open an attachment image in an in-app viewer · P1

**As a** cosmos user looking at a Slack message with an attached image thumbnail
**I want** clicking the thumbnail to open a larger in-app image viewer
**So that** I can see the image in detail without leaving the app or exposing the source URL

**Acceptance criteria:**

- Given a message row with one or more attachment image thumbnails, when I click a thumbnail, then an
  in-app image viewer opens showing that image larger than the thumbnail.
- Given the viewer is open, when displayed, then the image is shown via the SAME opaque
  `cosmos-slack-img://` ref as the thumbnail (no token, no `files.slack.com` URL in the renderer).
- Given the viewer is open, when I dismiss it (close button, Escape, or clicking the backdrop), then
  it closes and returns me to the message exactly where I was.
- Given a row with multiple thumbnails, when I click a specific thumbnail, then the viewer shows that
  thumbnail's image (not another image in the row).

### Image viewer degrades gracefully · P2

**As a** user whose image fails to load or who relies on the keyboard
**I want** the viewer to fail visibly and be operable without a mouse
**So that** a broken image or no-mouse setup doesn't trap or confuse me

**Acceptance criteria:**

- Given the full-size image fails to fetch, when the viewer is open, then it shows the broken-image
  / fallback state (using the thumbnail's `alt`) instead of crashing or hanging, and remains
  dismissable.
- Given the viewer is open, when I press Escape or activate the close control, then it closes
  (keyboard-operable, focus returns to the triggering thumbnail per the dialog primitive's behavior).

### Read-only posture and secret safety preserved · P1

**As a** security-conscious operator
**I want** both features to add no write capability and leak no token
**So that** the Slack surfaces stay strictly read-only and secret-safe

**Acceptance criteria:**

- Given any interaction added here (open thread, open image viewer), when data is fetched, then only
  existing read-only Slack reads / opaque image refs are used — no Slack write of any kind.
- Given any payload crossing a process boundary for these features, when inspected, then it carries
  no Slack token, secret, or token-bearing `files.slack.com` URL.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Each traces to a scenario/grounding.

| ID     | Requirement                                                                                                                                                                          |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | Clicking a message's "N replies" affordance MUST open that thread's replies in a panel docked to the RIGHT side, while the originating message list remains visible — replacing today's whole-view ("창 전환") thread switch. This MUST work for BOTH the native Slack panel AND the generative A2UI Slack surface, because both render the canonical shared `SlackMessageRow` and both already route the reply affordance into the same Slack panel (native via `onOpenThread`/`setView`; generative via `SLACK_OPEN_THREAD_ACTION` → `handleSurfaceAction`). |
| FR-002 | The thread panel MUST fetch replies via the existing read-only thread read (`window.cosmos.slack.getReplies`); it MUST NOT introduce a new IPC channel, main-process, MCP, or adapter change for fetching replies, and MUST NOT perform any Slack write. |
| FR-003 | Replies in the thread panel MUST render using the same shared message-row presentation (`SlackMessageRow`) as the message list, and MUST show the parent message as a header without rendering the thread root twice (drop the first reply item whose `ts` equals the parent's, as today). |
| FR-004 | While the thread panel is open, activating a different message's "N replies" MUST retarget the panel to the new thread without disturbing the left message list; activating the SAME open thread's affordance MAY toggle the panel closed. |
| FR-005 | The thread panel MUST offer a clear dismiss affordance that closes the right panel and returns the message list to full width.                                                       |
| FR-006 | A failed reply read (network / reconnect-needed / rate-limited / not-connected) MUST surface a non-alarming inline message inside the thread panel — NEVER a crash, white-screen, or hung spinner — and MUST be retryable, while the left message list stays interactive. |
| FR-007 | At narrow panel widths the list + thread layout MUST remain readable without horizontal overflow or clipped content, per the narrow-width behavior chosen in OQ-2.                   |
| FR-008 | Clicking an attachment image thumbnail in a Slack message row MUST open a separate in-app image viewer (modal/lightbox) showing that image larger than the thumbnail.               |
| FR-009 | The image viewer MUST display the image via the SAME opaque `cosmos-slack-img://` ref used by the thumbnail; no Slack token, secret, or token-bearing `files.slack.com` URL MUST appear in the renderer, DOM, or any payload. |
| FR-010 | When a row has multiple thumbnails, clicking a specific thumbnail MUST open the viewer on THAT thumbnail's image.                                                                    |
| FR-011 | The image viewer MUST be dismissable via a close control, Escape key, and backdrop click, returning the user to the message; it MUST be keyboard-operable (focus trap + focus return) using the existing `Dialog` primitive. |
| FR-012 | If the full-size image fails to load, the viewer MUST show the broken-image / fallback state (the ref's `alt`) and remain dismissable — no crash, no hang.                          |
| FR-013 | Both surfaces MUST feed ONE renderer-local "open thread" state (the non-secret `{ channelId, threadTs }` plus the parent row's display fields), so the right-docked drawer is driven by a single source of truth regardless of which surface triggered it. Neither feature MUST change the read-only, display-only posture of the Slack surfaces or add any new secret-bearing field; thread coordinates and opaque image refs are the only new data the renderer handles, both already non-secret. |
| FR-014 | Both affordances MUST be visually consistent with the existing Slack panel design system (cosmos palette, shared row, shadcn `Dialog`) — exact styling deferred to the designer step. |
| FR-015 | Thread-panel open/target state and image-viewer open state MAY be renderer-local UI state only; they need NOT be persisted into any session snapshot (a restore returns to the message list with no thread panel / viewer open). |

## Edge Cases & Constraints

- **No replies despite `replyCount > 0`** (e.g. all deleted) → the thread panel shows a benign "No
  replies." state (as the native thread `MessageList` already does), not an error.
- **Reply pagination** → the existing reply `MessageList` already paginates via `nextCursor`/"Load
  more"; the thread panel inherits that as-is. No change required (NOT deferred — it already works).
- **Switching channels while a thread panel is open** → the thread panel SHOULD close (or retarget)
  so a stale thread is never shown against a different channel's list. (Behavior bias: close on
  channel/view change; confirm in plan.)
- **Narrow Slack panel** → the thread panel becomes a right-docked DRAWER that OVERLAYS the message
  list (does not squeeze it), per the OQ-2 resolution; MUST NOT horizontally overflow the panel.
- **Image viewer over the thread panel** → clicking a thumbnail inside a reply (if replies show
  thumbnails) MUST also open the viewer; the viewer (modal) layers above both list and thread panel.
- **Very large image** → the viewer MUST fit the image within the in-app viewport (no full-screen
  takeover of the OS); the larger-but-bounded presentation is the goal, not pixel-perfect zoom.
- **Out of scope (YAGNI / not requested):** zoom/pan, image rotation, download/save, a
  prev/next multi-image carousel inside the viewer, reactions/replies-to-replies, posting/editing,
  and real-time thread updates.

## Success Criteria

| ID     | Criterion                                                                                                              |
|--------|----------------------------------------------------------------------------------------------------------------------|
| SC-001 | Clicking "N replies" opens the thread's replies in a right-docked panel with the channel message list still visible on the left; no whole-view switch occurs. |
| SC-002 | The thread panel shows the parent as a header (root not duplicated) and the replies using the shared message-row presentation, fetched via the existing read-only path. |
| SC-003 | A reply read failure shows a retryable inline message in the thread panel and never crashes/hangs; the left list stays interactive; dismissing the panel restores full-width list. |
| SC-004 | Clicking an attachment thumbnail opens an in-app viewer showing that image larger; multiple thumbnails open their own image; the viewer closes via button, Escape, and backdrop. |
| SC-005 | The viewer renders the image only via the opaque `cosmos-slack-img://` ref; no token, secret, or `files.slack.com` URL appears in the renderer/DOM/payloads; no Slack write occurs. |
| SC-006 | At a narrow panel width the list + thread layout stays readable with no horizontal overflow (per the OQ-2 resolution). |

---

## Open Questions

> All open questions were resolved by the user (2026-06-20). Recorded below as resolutions.

- [x] **OQ-1 — Scope → BOTH native AND generative.** RESOLVED: the right-docked thread panel applies
  to BOTH the native Slack panel and the generative A2UI Slack surface. Rationale: `SlackMessageRow`
  is already the ONE canonical shared row (slack-generative-message-parity-v1, OQ-3 full
  unification), and both surfaces already route the reply affordance into the same Slack panel.
  Putting the open-thread handler on the shared row and tracking WHICH thread is open as a single
  renderer-local state covers both surfaces with minimal added complexity. (See FR-001/FR-013.)
- [x] **OQ-2 — Narrow-width → right-drawer overlay.** RESOLVED: when the panel is narrow the thread
  panel is a right-docked DRAWER that OVERLAYS the message list (does not squeeze it). This is the
  design constraint for the designer step. (See FR-007 / Edge Cases.)
- [x] **OQ-3 — Doc reconcile → yes, at wrap-up.** RESOLVED: at wrap-up, update `docs/ARCHITECTURE.md`
  and reconcile the older `slack-generative-message-parity-v1` "native thread-view drill-in" wording
  to "thread replies dock to a right-side panel (drawer overlay when narrow), shared by native +
  generative via the canonical `SlackMessageRow` + a renderer-local open-thread state". This is a
  planned wrap-up doc change; `ARCHITECTURE.md` is not rewritten now beyond what the plan needs.
