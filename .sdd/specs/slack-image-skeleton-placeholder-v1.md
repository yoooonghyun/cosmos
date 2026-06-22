# Spec: Slack Message Image Skeleton Placeholder — v1

**Status**: Draft
**Created**: 2026-06-22
**Supersedes**: none
**Related plan**: .sdd/plans/slack-image-skeleton-placeholder-v1.md

---

## Grounding

> Investigated directly via codegraph + agentmemory before writing (CLAUDE.md SDD rule).

**codegraph_explore / codegraph_search (queries + one-line takeaways):**

- `SlackImageViewer messageContent custom-emoji cosmos-slack-img components.tsx Slack message image attachment thumbnail`
  → `MessageImages` (`SlackMessageRow.tsx:127`) renders the message attachment thumbnail strip:
  each is a `<button>` wrapping `<img src={img.ref} className="max-h-40 max-w-[12rem] object-cover">`.
  `messageContent.ts` parses the body into `text` / `custom-emoji` runs; a `custom-emoji` run is a
  tiny text-scale inline `<img>` (NOT an attachment). `SlackImageViewer.tsx:56-68` already has the
  `ImageOff` "Image unavailable" error fallback on `onError → setFailed(true)`.
- `Skeleton MessageSkeleton slackImageProtocol cosmos-slack-img protocol handler`
  → `Skeleton` (`components/ui/skeleton.tsx`) = `animate-pulse rounded-md bg-accent`. `MessageSkeleton.tsx`
  builds list-level loading rows from that same primitive. The per-image skeleton must read consistently
  with these (same primitive, same `bg-accent` shimmer).
- Read `src/shared/slack.ts` → `SlackImageRef` ALREADY carries optional `w?: number` / `h?: number`
  ("Natural pixel width/height when known … lets the row reserve layout space"). This is the dimension
  source for layout-shift avoidance. The protocol handler (`src/main/slackImageProtocol.ts`) stays in
  main with the token — out of scope here (renderer loading-state only).

**memory (`memory_recall` / `memory_smart_search`):**

- `Slack image protocol skeleton loading state A2UI custom protocol cosmos-slack-img secret boundary`
  → empty. No prior conflicting decision. MEMORY.md confirms the `cosmos-slack-img://` token-in-main
  boundary and the Tailwind+shadcn design-system direction.

**Conclusion:** the eventual image box dimensions are already available on the DTO (`SlackImageRef.w/h`),
so the skeleton can reserve the exact aspect box with zero new IPC and no secret-boundary change. This is
a pure renderer loading-state feature.

---

## Overview

Slack message **attachment images** render via the `cosmos-slack-img://` custom protocol, whose bytes
are fetched in main (with the Slack token) only after the `<img>` mounts. Until that fetch completes the
thumbnail is blank, then the image pops in — a jarring late appearance plus layout shift. This feature
shows a loading **skeleton** in the image's eventual box until the image finishes downloading, then
swaps the loaded image in; a failed download shows a graceful "image unavailable" placeholder.

## User Scenarios

> Each scenario must be independently testable. P1 (must), P2 (should), P3 (nice to have).

### Skeleton while an attachment image downloads · P1

**As a** cosmos user reading a Slack channel/search/thread with image attachments
**I want to** see a placeholder in the image's spot while it loads
**So that** the message reads as complete immediately instead of showing blank boxes that pop in late.

**Acceptance criteria:**

- Given a message row with an attachment image whose bytes have not yet arrived, when the row renders,
  then a `Skeleton` placeholder occupies the image's thumbnail box (same primitive + shimmer as
  `MessageSkeleton`).
- Given the image's bytes finish downloading, when the `<img>` `onLoad` fires, then the loaded image
  replaces the skeleton in the same box.
- Given the loaded image replaces the skeleton, then the box does not change size/position (no layout
  shift / no reflow of the rest of the row).

### No layout shift when the image lands · P1

**As a** cosmos user
**I want to** the surrounding text and rows to not jump when an image finishes loading
**So that** reading is not disrupted by reflow.

**Acceptance criteria:**

- Given a `SlackImageRef` that carries `w`/`h`, when the thumbnail renders, then the skeleton box is
  sized to that image's aspect ratio (clamped to the existing `max-h-40 max-w-[12rem]` thumbnail bounds)
  so the loaded image occupies the identical box.
- Given a `SlackImageRef` with NO `w`/`h`, when the thumbnail renders, then the skeleton box uses a
  sensible default placeholder box (a fixed fallback aspect/size within the same bounds) so it still
  does not jump when the image lands.

### Graceful fallback on a failed download · P1

**As a** cosmos user
**I want to** a clear "image unavailable" affordance instead of a broken-image icon or a stuck skeleton
**So that** a failed Slack fetch does not look like the app is broken or perpetually loading.

**Acceptance criteria:**

- Given an attachment image whose fetch fails, when the `<img>` `onError` fires, then the skeleton is
  replaced by an "image unavailable" placeholder consistent with `SlackImageViewer`'s `ImageOff`
  fallback — NOT a perpetual skeleton and NOT the browser's default broken-image glyph.
- Given the error placeholder is shown, then it occupies the same reserved box (still no layout shift).

### Inline custom-emoji images are unaffected · P2

**As a** cosmos user
**I want to** tiny inline custom-emoji images to keep rendering as before (no flickering skeleton)
**So that** a one-line message body is not visually noisy with miniature placeholders.

**Acceptance criteria:**

- Given a message body containing `custom-emoji` runs, when it renders, then those inline `<img>`s do
  NOT show a per-image skeleton (they render as today), per OQ-1's recommended default.

### Smooth swap (designer-owned) · P3

**As a** cosmos user
**I want to** the loaded image to appear with a gentle transition rather than a hard flash
**So that** the swap feels polished and consistent with the rest of the UI.

**Acceptance criteria:**

- Given the image finishes loading, when it replaces the skeleton, then the transition follows the
  design spec (crossfade vs instant — OQ-3); the chosen treatment is uniform across all attachment
  thumbnails.

---

## Functional Requirements

| ID     | Requirement                                                                                           |
|--------|-------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST show a loading skeleton in place of each Slack message **attachment image** until that image's `<img>` `onLoad` fires, then swap to the loaded image. |
| FR-002 | The skeleton MUST be built from the existing `Skeleton` primitive (`components/ui/skeleton.tsx`) so it reads consistently with `MessageSkeleton`. |
| FR-003 | The skeleton box MUST occupy the image's eventual box so swapping in the loaded image causes no layout shift / reflow. |
| FR-004 | When the `SlackImageRef` carries `w`/`h`, the placeholder box MUST be sized to that aspect ratio, clamped within the existing thumbnail bounds (`max-h-40 max-w-[12rem]`). |
| FR-005 | When the `SlackImageRef` lacks `w`/`h`, the placeholder box MUST fall back to a fixed default box within the same bounds (no jump when the image lands). |
| FR-006 | On `<img>` `onError`, the system MUST replace the skeleton with an "image unavailable" placeholder consistent with `SlackImageViewer`'s `ImageOff` fallback — never a perpetual skeleton or a default broken-image glyph. |
| FR-007 | The error/loaded placeholder MUST occupy the same reserved box as the skeleton (still no layout shift). |
| FR-008 | Inline `custom-emoji` images MUST NOT show a per-image skeleton (OQ-1 default: emoji = no skeleton). |
| FR-009 | The image-load lifecycle decision (loading → loaded → error) and the box-sizing decision MUST be expressed as a pure, node-testable helper(s) in a `.ts` beside the component (the catalog `.ts`/`.test.ts` split), with tests. |
| FR-010 | The feature MUST NOT alter the secret boundary: the Slack token stays in main, the renderer holds only opaque `cosmos-slack-img://` refs; no token/URL crosses into any renderer state, prop, or DOM attribute. |
| FR-011 | The skeleton MUST mark its loading state accessibly (e.g. `aria-busy`) and the loaded `<img>` MUST keep its existing `alt` so the thumbnail stays accessible across states. |
| FR-012 | The loaded-image swap transition (crossfade vs instant — OQ-3) MUST follow the design spec and be uniform across all attachment thumbnails. |

## Edge Cases & Constraints

- A row may carry multiple attachment images; each tracks its OWN load state independently (one slow
  image must not block its siblings' skeletons from resolving).
- An image already in the browser cache may fire `onLoad` synchronously on mount; the component MUST
  still resolve to the loaded state correctly (no stuck skeleton, no double-swap flash).
- `w`/`h` may be present but absurd (zero, negative, NaN); the box-sizing helper MUST treat these as
  "unknown" and fall back to the default box (FR-005).
- The thumbnail is wrapped in a `<button>` (open-in-viewer); the skeleton must not break that button's
  size, focus ring, or hover overlay.
- The `SlackImageViewer` lightbox (the larger image opened from a thumbnail) is OUT OF SCOPE for this
  feature unless trivially reusable; it already has its own `ImageOff` error path. [NEEDS CLARIFICATION
  — see OQ-4: apply the skeleton to the lightbox too, or thumbnail-only?]
- Explicitly out of scope: changing the `cosmos-slack-img://` protocol handler, the fetch, the token
  boundary, or the DTO shape (`w`/`h` already exist on `SlackImageRef`).

## Success Criteria

| ID     | Criterion                                                                                  |
|--------|--------------------------------------------------------------------------------------------|
| SC-001 | No blank/empty image box is shown for an attachment image while it loads — a skeleton is always shown until `onLoad`. |
| SC-002 | Loading → loaded and loading → error transitions cause zero layout shift (the reserved box is unchanged across all three states). |
| SC-003 | The pure load-state + box-sizing helper(s) have node tests covering loading/loaded/error and known-dims / unknown-dims / invalid-dims. |
| SC-004 | No Slack token or token-bearing URL appears in any renderer state, prop, or DOM attribute introduced by this feature (manual audit + existing secret-boundary review). |
| SC-005 | Inline custom-emoji rendering is byte-for-byte unchanged (no skeleton regression on message bodies). |

---

## Open Questions

- [ ] **OQ-1 — Do inline custom-EMOJI images get a skeleton?** Recommended default: **NO.** Custom-emoji
  images are tiny (text-scale, ~`size-4`); a skeleton would flicker and add visual noise to a one-line
  body. Reserve their space as today (intrinsic inline size) but show no skeleton. Spec assumes this
  default (FR-008); flip only on explicit request.
- [ ] **OQ-2 — How to size the placeholder when `w`/`h` are unknown?** Recommended default: a fixed
  fallback box within the existing thumbnail bounds (e.g. a modest landscape box around the
  `max-h-40 max-w-[12rem]` envelope). Final exact dimensions are a designer call. The point is a STABLE
  reserved box so there is no jump; `object-cover` already crops a mismatch gracefully.
- [ ] **OQ-3 — Crossfade vs instant swap?** Recommended default: a **short crossfade** (the loaded image
  fades over the skeleton) for polish, consistent with the design system's existing transitions; instant
  swap is acceptable if the designer judges crossfade too heavy at thumbnail scale. Designer-owned (§5).
- [ ] **OQ-4 — Apply the skeleton to the `SlackImageViewer` lightbox too, or thumbnails only?**
  Recommended default: **thumbnails only** in v1 (the lightbox already has an `ImageOff` error path and
  opens on demand from an already-loaded thumbnail, so it is far less likely to show a blank). Reuse the
  same wrapper component in the lightbox in a follow-up if desired.
