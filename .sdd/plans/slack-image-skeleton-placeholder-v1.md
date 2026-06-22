# Plan: Slack Message Image Skeleton Placeholder — v1

**Status**: Draft
**Created**: 2026-06-22
**Last updated**: 2026-06-22
**Spec**: .sdd/specs/slack-image-skeleton-placeholder-v1.md

---

## Grounding

> Same investigation as the spec (codegraph_explore + memory_recall + Read of `src/shared/slack.ts`).
> Key load-bearing facts for the HOW:

- **Where the attachment `<img>` lives:** `MessageImages` in `src/renderer/slackCatalog/SlackMessageRow.tsx`
  (`:127-159`). Each thumbnail is a `<button onClick={() => onView(img)}>` wrapping
  `<img src={img.ref} alt={img.alt ?? 'image'} className="max-h-40 max-w-[12rem] object-cover">`. This
  `<img>` is the one to wrap. Its sibling overlay (`Maximize2` hover icon) and the button's focus ring
  must be preserved.
- **Dimensions source:** `SlackImageRef` (`src/shared/slack.ts:86-95`) already carries optional
  `w?: number` / `h?: number`. NO DTO/IPC/main change needed — the renderer reads `img.w`/`img.h`.
- **Reuse:** `Skeleton` (`src/renderer/components/ui/skeleton.tsx`, `animate-pulse rounded-md bg-accent`);
  `MessageSkeleton.tsx` for visual reference; `ImageOff` error treatment from `SlackImageViewer.tsx:63-67`.
- **House convention:** the catalog `.ts`/`.test.ts` split (DEVELOPMENT.md §600-602) — pure logic in a
  `.ts` beside the `.tsx`, node-tested. So the load-state reducer + box-sizing helper go in a `.ts`.
- **Secret boundary:** `src/main/slackImageProtocol.ts` (token-in-main) is UNTOUCHED — renderer-only.

---

## Summary

Add a small renderer component that wraps each Slack message attachment `<img>` in a loading state: it
shows a `Skeleton` sized to the image's reserved box until `onLoad`, then swaps to the loaded image; on
`onError` it shows an `ImageOff`-style "image unavailable" placeholder in the same box. The reserved box
is computed from `SlackImageRef.w/h` (already on the DTO) clamped to the existing thumbnail bounds, with a
fixed fallback box when dims are unknown — so there is zero layout shift. The lifecycle (loading → loaded
→ error) and box-sizing are pure node-testable helpers in a `.ts` beside the component. Inline custom-emoji
images are left untouched (no skeleton). A designer step defines the skeleton tint/shimmer, the swap
transition (crossfade vs instant), and the error visual to match `MessageSkeleton` + the design system.
No IPC, no main, no DTO, no secret-boundary change.

## Technical Context

| Item              | Value                                                                                  |
|-------------------|----------------------------------------------------------------------------------------|
| Language          | TypeScript (React, renderer)                                                            |
| Key dependencies  | existing `Skeleton`, `lucide-react` `ImageOff`, `cn`; NO new deps                       |
| Files to create   | `src/renderer/slackCatalog/SlackMessageImage.tsx` (wrapper component); `src/renderer/slackCatalog/imageLoadState.ts` (pure helpers); `src/renderer/slackCatalog/imageLoadState.test.ts` (node test); `.sdd/designs/slack-image-skeleton-placeholder-v1.md` (designer) |
| Files to modify   | `src/renderer/slackCatalog/SlackMessageRow.tsx` (`MessageImages` uses the wrapper); possibly `docs/ARCHITECTURE.md` (one phrase, if the loading-state concept warrants it) |
| Secret boundary   | UNCHANGED — token stays in `src/main/slackImageProtocol.ts`; renderer holds only opaque refs |

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates.

### Phase 1 — Pure helper + interface (developer)

- [ ] Read the spec; confirm OQ-1 (emoji = no skeleton), OQ-2 (fixed fallback box), OQ-3 (transition
      deferred to designer), OQ-4 (thumbnails only) — resolve with the user if any is still open.
- [ ] Create `src/renderer/slackCatalog/imageLoadState.ts` with:
  - an `ImageLoadStatus = 'loading' | 'loaded' | 'error'` type + a tiny reducer/transition function
    (`loading` → `loaded` on load, `loading` → `error` on error; idempotent; never regresses to loading).
  - a pure box-sizing helper, e.g. `reservedImageBox({ w, h })` → the style/aspect descriptor (a CSS
    `aspect-ratio` value or width/height pair) clamped to the `max-h-40 max-w-[12rem]` envelope; returns
    the FIXED fallback box (OQ-2) when `w`/`h` are absent, zero, negative, or NaN.
  - Keep it PURE: no React, no DOM, no fetch (node-testable per the `.ts`/`.test.ts` split, FR-009).
- [ ] Review the helper output vs spec — no invented properties; box descriptor traces to `SlackImageRef.w/h`.

### Phase 2 — Testing (developer)

- [ ] `src/renderer/slackCatalog/imageLoadState.test.ts`:
  - reducer: loading→loaded on load; loading→error on error; loaded/error are terminal (idempotent).
  - `reservedImageBox`: known landscape dims → correct aspect clamped to bounds; known portrait dims →
    clamped; missing dims → fixed fallback box; invalid dims (0, negative, NaN) → fixed fallback box.
- [ ] (No separate IPC/main tests — feature is renderer-only.)

### Phase 3 — Component + wiring (developer)

- [ ] Create `src/renderer/slackCatalog/SlackMessageImage.tsx`: a component taking the `SlackImageRef`
      (+ the thumbnail `className`) that:
  - renders the reserved box (from `reservedImageBox`) always, so the box exists before/after load;
  - shows `<Skeleton>` while `status === 'loading'` (with `aria-busy` per FR-011);
  - renders the `<img src={img.ref}>` with `onLoad`/`onError` driving the reducer; on `loaded` the image
    is shown (swap/crossfade per design); on `error` shows the `ImageOff` "image unavailable" placeholder;
  - keeps the existing `alt`, `object-cover`, and thumbnail bounds; does NOT introduce any token/URL.
- [ ] Modify `MessageImages` in `SlackMessageRow.tsx` to render `SlackMessageImage` for each attachment
      INSIDE the existing `<button>` (preserve the button, its `aria-label`, focus ring, and the
      `Maximize2` hover overlay). The `<img>` markup currently at `:147-151` is replaced by the wrapper.
- [ ] Leave `messageContent.ts` `custom-emoji` runs and their inline `<img>` rendering UNCHANGED (FR-008,
      OQ-1) — no skeleton on emoji.
- [ ] Confirm each attachment tracks its own state (the wrapper is per-image, so siblings are independent).

### Phase 2.5 — Design (designer; owned by `designer`, design skill)

> DESIGN STEP — produce `.sdd/designs/slack-image-skeleton-placeholder-v1.md`. Runs between plan and
> interface for the VISUAL contract; the developer wires the behavior above to it.

- [ ] Define the skeleton tint/shimmer to match `MessageSkeleton` (same `Skeleton` primitive,
      `bg-accent animate-pulse`) at thumbnail scale.
- [ ] Decide the swap transition (OQ-3): crossfade vs instant; if crossfade, specify the duration/easing
      using existing design-system transitions (recommend a short crossfade).
- [ ] Specify the error "image unavailable" visual at thumbnail scale — consistent with
      `SlackImageViewer`'s `ImageOff` + muted-foreground treatment, sized to the reserved box.
- [ ] Specify the fixed fallback box dimensions (OQ-2) within the `max-h-40 max-w-[12rem]` envelope.
- [ ] No new theme token and no new shadcn primitive expected (reuse `Skeleton`); flag if one is needed.

### Phase 4 — Docs (developer / wrap-up)

- [ ] Update this plan with any deviations (date each).
- [ ] `docs/ARCHITECTURE.md`: the §Slack panel rich-render passage (`:438-445`) describes attachment
      images rendering through `cosmos-slack-img://`. Add a single phrase that attachment thumbnails show
      a per-image **skeleton** until `onLoad` (graceful `ImageOff` fallback on error) — ONLY if the
      architect judges the loading-state concept worth recording. If it is purely a local component
      detail, leave ARCHITECTURE.md unchanged and note that here.
- [ ] `npm run typecheck` + `npm test` green; reconcile `TODO.md` via wrap-up.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-22**: Plan authored. Dimensions confirmed already on `SlackImageRef.w/h` (no DTO/IPC/main
  change). Secret boundary explicitly untouched (renderer-only). Open questions carry recommended
  defaults; OQ-3 (transition) and OQ-2 (fallback box exact size) are designer-owned.
