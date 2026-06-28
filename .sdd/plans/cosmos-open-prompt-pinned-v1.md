# Plan: Cosmos Open-Prompt Pinned Composer — v1

**Status**: Draft
**Created**: 2026-06-28
**Last updated**: 2026-06-28
**Spec**: .sdd/specs/cosmos-open-prompt-pinned-v1.md

---

## Grounding

> Direct investigation by the architect (codegraph_explore + the on-disk source it returns +
> existing specs + ARCHITECTURE.md). Names below are real symbols/files confirmed this cycle.

**codegraph_explore queries run (verbatim source returned, treated as Read):**

- `useActiveComposerConfig ActiveComposerProvider ActiveComposerContextValue publishComposer
  CosmosPanel onSubmit busy useCosmosConversation surface routing` → the routing layer:
  `ComposerConfig` (`src/renderer/activeComposer.ts:25`), `selectActiveComposerConfig`,
  `usePublishComposer`/`useActiveComposerConfig` (`src/renderer/ActiveComposerProvider.tsx`),
  and `CosmosPanel.tsx`'s `usePublishComposer('cosmos', useMemo(() => ({ onSubmit, placeholder,
  ariaLabel, busy: showSpinner }), [showSpinner]))`. The other four panels publish their own
  `ComposerConfig` the same way (`usePublishComposer` has 5 callers).
- The `PromptComposer` internals (read 147–230, 496–925): `const [expanded, setExpanded] =
  useState(false)` (default collapsed), `collapse()`, `submit()` (sets `launching` + `collapse(true)`),
  `handleKeyDown` (Esc→`escDecision`→`collapse`), the outside-click effect
  (`shouldCollapseOnOutsideClick`→`collapse`), the expand-focus `useLayoutEffect` (line 724), the
  drag state machine (`onLogoPointer*`, `followRef`, `restingPx`), and the JSX: a `fixed z-50`
  full-panel layer hosting the collapsed draggable logo + the floating expanded card, gated by
  `expanded || busy`.
- Precedent confirmed: `src/renderer/confluenceCatalog/CommentsSection.tsx` already implements a
  **bottom-pinned composer** (`<div className="shrink-0 border-t border-border p-3">` with a
  `Textarea className="max-h-[12rem] min-h-[72px] resize-none"` and a scroll area above) — the exact
  docked layout idiom this feature wants, so the design step has a proven in-repo pattern to extend.

**Decisions confirmed by the user (baked in below):**
- OQ-1 → **Option A**: parameterize the SINGLE shared `PromptComposer` with a
  `mode: 'docked' | 'floating'` flag driven off the active surface. Cosmos ⇒ `docked`; all other
  panels ⇒ `floating` (unchanged). NOT a separate dedicated component.
- OQ-2 → **auto-focus** the docked Cosmos composer on panel activation, WITHOUT stealing focus from
  the Terminal PTY or another panel.

---

## Summary

Make the Open-Prompt composer **always-open and docked to the bottom of the Cosmos panel** while
leaving it a floating, draggable, collapse-on-submit/Esc/outside-click logo on every other panel.
Because there is exactly ONE App-level hoisted `PromptComposer` instance (`SharedComposer` in
`App.tsx`) shared across all surfaces, the approach (OQ-1 Option A) threads a new
`mode: 'docked' | 'floating'` discriminator from the active surface down into the one composer:
`SharedComposer` selects `mode` from the active `SurfaceId` (`'cosmos'` ⇒ `'docked'`, else
`'floating'`) and renders the composer in a normal flex-column bottom slot when docked (vs. the
existing `absolute inset-0` floating overlay). Inside `PromptComposer`, `mode === 'docked'` forces
`expanded` permanently true, suppresses the launch/collapse exits (`submit`, Esc, outside-click,
`busy`-hide, and the whole drag layer), keeps the input cleared-and-focused after submit, and
auto-focuses on activation — all guarded so the `'floating'` path is byte-for-byte the current
behavior. The pure decision logic (which states a mode permits) goes in `promptComposerLogic.ts`
behind the established `.ts`/`.test.ts` split. This is UI-bearing, so a **design step runs after this
plan and before interface/implement** to specify the docked-composer visual treatment (reusing the
Confluence comments-composer idiom + brand tokens).

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (React renderer; no main/IPC changes) |
| Key dependencies  | Existing: `PromptComposer.tsx`, `promptComposerLogic.ts`, `activeComposer.ts`, `ActiveComposerProvider.tsx`, `App.tsx` (`SharedComposer`), `CosmosPanel.tsx`. shadcn `Textarea`/`Button` already in use. No new deps. |
| Files to create   | `.sdd/designs/cosmos-open-prompt-pinned-v1.md` (designer, design step). Possibly a new pure helper test in `promptComposerLogic.test.ts` (extend existing). |
| Files to modify   | `src/renderer/promptComposerLogic.ts` (+ `.test.ts`), `src/renderer/activeComposer.ts` (+ `.test.ts`), `src/renderer/PromptComposer.tsx`, `src/renderer/ActiveComposerProvider.tsx` (only if `mode` is routed through the registry — see Approach note), `src/renderer/App.tsx` (`SharedComposer`), `src/renderer/CosmosPanel.tsx` (docked-composer layout host / busy gate), `docs/ARCHITECTURE.md` §4.4. |

### Approach notes (mechanism decisions for the implementer)

- **Where `mode` is decided.** `mode` is a pure function of the ACTIVE `SurfaceId`, which
  `SharedComposer` already has. Decide it there with a tiny pure helper
  `composerModeForSurface(surface): 'docked' | 'floating'` in `activeComposer.ts` (`'cosmos'` ⇒
  `'docked'`, else `'floating'`) — node-testable, no React. This keeps the per-surface rule in ONE
  place and does NOT require every panel to publish a `mode` in its `ComposerConfig` (so the four
  other panels' `usePublishComposer` calls are untouched). `SharedComposer` passes `mode` as a new
  `PromptComposer` prop. (If the design step decides Cosmos needs a structurally different mount than
  an overlay — likely yes, a real in-flow bottom slot — `SharedComposer` branches its wrapper on
  `mode`: the docked branch renders the composer as a normal `shrink-0` flex child, the floating
  branch keeps today's `pointer-events-none absolute inset-0 flex flex-col justify-end` overlay.)
- **Docked mount location.** Two viable hosts; the design step picks: (a) `SharedComposer` renders the
  docked composer as the last flex child of the shared `surfaceRef` column (so it sits below whichever
  panel is active — but it is only docked for Cosmos, so this is effectively Cosmos-only); or (b) the
  docked composer is hosted INSIDE `CosmosPanel.tsx`'s `<section>` flex column, replacing
  `PanelFooter`'s slot region, while the floating instance stays in `SharedComposer` for the other
  panels. Recommendation: **(a)** keeps the single-instance invariant (one `PromptComposer`, no draft
  duplication) — `SharedComposer` switches the WRAPPER (overlay vs in-flow bottom slot) by `mode`
  while the composer instance stays mounted. The design step confirms the exact DOM placement so the
  Cosmos timeline's existing `overflow-auto` scroll region (`CosmosPanel.tsx` line 199–225) flexes
  above it and the composer is `shrink-0` below.
- **What `mode === 'docked'` changes inside `PromptComposer`** (all guarded so `'floating'` is
  unchanged):
  - `expanded` is forced permanently true (the card/input is the only state; the collapsed-logo layer
    and the entire `fixed z-50` drag layer are NOT rendered in docked mode).
  - `submit()` must NOT call `setLaunching(true)` / `collapse(true)` in docked mode — instead clear
    the draft (`draftAfterSubmit()`), keep focus in the textarea, stay open.
  - `handleKeyDown` Esc branch: in docked mode `escDecision` must be inert (Esc does not collapse;
    may blur or no-op — design picks).
  - The outside-click effect (`shouldCollapseOnOutsideClick` → `collapse`) must be disabled in docked
    mode (no collapse on click-outside).
  - `busy` must NOT hide the composer in docked mode (the in-flight affordance is the timeline
    spinner; the composer stays visible/typeable — consistent with the existing non-blocking
    `composerLocked === false`). The `busy` prop still drives the *floating* logo hide on other panels.
  - Auto-focus on activation: the docked composer focuses its textarea when the Cosmos panel becomes
    active. Use the existing expand-focus `useLayoutEffect` (line 724) extended to also fire on a
    docked-activation signal, WITHOUT stealing focus from the Terminal/another panel (gate on the
    Cosmos panel being the active surface — `SharedComposer` already knows the active surface, so
    pass an `active`/`autoFocus` signal, or have `CosmosPanel`'s `active` prop reach the composer via
    the published config). OQ-2 resolved: focus only when Cosmos is the active surface.
- **Pure logic to add (the `.ts`/`.test.ts` split, mirroring `submitDecision`/`escDecision`):**
  - `composerModeForSurface(surface)` in `activeComposer.ts`.
  - Mode-aware predicates in `promptComposerLogic.ts` so the `.tsx` only reads booleans, e.g.
    `isAlwaysOpen(mode)`, `allowsCollapse(mode)`, `hidesOnBusy(mode)`, `draftAfterSubmit` already
    exists (clear-on-success is shared). Each pure + node-tested.
- **No main / IPC / preload changes.** This is renderer-only; the agent submit path, persistent
  session, and `agent.submit({ target: 'generated-ui' })` in `CosmosPanel` are untouched (spec
  FR-004). No `npm run dev` restart gotcha (no new `window.cosmos.*`).

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation. Cycle order is enforced:
> **Plan → DESIGN → Interface → Test → Implement → Wrap-up.**

### Phase 0 — Design (designer agent, BEFORE any interface/code)

- [ ] **DESIGN STEP (UI-bearing): run the `design` skill / `designer` agent → produce
  `.sdd/designs/cosmos-open-prompt-pinned-v1.md`.** Specify the docked-composer visual treatment:
  bottom-dock layout against the Cosmos timeline (reuse the `confluenceCatalog/CommentsSection.tsx`
  pinned-composer idiom — `shrink-0 border-t border-border p-3`, `Textarea max-h/min-h resize-none`),
  Send control (`cosmos` Button variant + brand tokens), multi-line growth bounds (FR-010),
  empty/loading/error coexistence with the docked input (FR-008), focus/active affordance (OQ-2),
  and how the timeline `overflow-auto` region flexes above. Confirm the exact DOM mount (Approach note
  (a) vs (b)). Designer owns theme tokens + `components/ui/`; no Bash/build wiring here.
- [ ] Architect reviews the design spec for consistency with this plan's `mode` mechanism; reconcile
  any DOM-placement decision back into "Approach notes" above.

### Phase 1 — Interface (developer agent)

- [x] Re-read the spec + design spec; confirmed OQ-1/OQ-2 resolved, no new open questions.
- [x] Added `composerModeForSurface(surface): 'docked' | 'floating'` to
  `src/renderer/activeComposer.ts` (pure; `'cosmos'` ⇒ `'docked'`, else `'floating'`; invalid input
  → safe `'floating'` fallback + warn). Added `ComposerMode` type.
- [x] Added `mode?: 'docked' | 'floating'` (default `'floating'`) + `autoFocusActive?: boolean`
  (OQ-2 activation signal) to `PromptComposerProps` in `src/renderer/PromptComposer.tsx`.
- [x] Added mode-aware pure predicates to `src/renderer/promptComposerLogic.ts`
  (`isAlwaysOpen`/`allowsCollapse`/`hidesOnBusy` + `ComposerMode` re-export) — the `.tsx` reads only
  these booleans. No invented props; every field traces to an FR.

### Phase 2 — Testing (developer agent)

- [x] `activeComposer.test.ts`: `composerModeForSurface('cosmos') === 'docked'`; every other
  `SurfaceId` (via `ALL_SURFACE_IDS`) ⇒ `'floating'`; invalid input ⇒ `'floating'` (no throw).
- [x] `promptComposerLogic.test.ts`: docked ⇒ always-open / no-collapse / not-hidden-on-busy;
  floating ⇒ unchanged (collapse permitted, hide-on-busy); duals asserted.
- [x] Existing floating-mode tests pass unchanged (regression guard — full node suite green, 2566).
- [x] ADDED a jsdom test `PromptComposerDocked.dom.test.tsx` (node-unit predicates are NECESSARY but
  NOT SUFFICIENT for the rendered DOM): always-rendered textarea, no logo, stay-open submit + clear,
  empty/whitespace rejected, Shift+Enter newline, inert Esc, inert click-outside, visible+typeable
  while busy, activation-edge auto-focus. Registered as scenario CMP-MODE-01 in `docs/TEST-SCENARIOS.md`.

### Phase 3 — Implementation (developer agent)

- [x] `src/renderer/App.tsx` `SharedComposer`: computes `mode = composerModeForSurface(surface)`;
  branches the wrapper — docked ⇒ in-flow `shrink-0` bottom slot; floating ⇒ today's
  `pointer-events-none absolute inset-0 flex flex-col justify-end` (byte-for-byte). Passes `mode` +
  `autoFocusActive` to the single `PromptComposer`; ONE instance, no `key={surface}`.
- [x] `src/renderer/PromptComposer.tsx`: gated by `docked` (= `isAlwaysOpen(mode)`) — EARLY-RETURN
  docked body (a flat in-flow `<form>`, no `fixed z-50` drag/logo/scrim/glass), `submit()` stays open
  (skips `setLaunching`/`collapse`, refocuses textarea), Esc + outside-click inert, `busy` never hides
  it, auto-focus on the Cosmos activation EDGE (no focus-steal). Floating branch unchanged.
- [x] `src/renderer/CosmosPanel.tsx`: removed the `PanelFooter` (superseded by the docked band per
  design §1.3) so the timeline `overflow-auto` flexes above and the docked composer is `shrink-0`
  below; empty/loading/error states render with the input present; `usePublishComposer('cosmos', …)`
  + `agent.submit({ target: 'generated-ui' })` unchanged (FR-004); `busy: showSpinner` feeds only the
  timeline spinner, never hides the input (FR-005).
- [x] Auto-scroll-to-newest effect still pins to the bottom of the timeline above the docked composer
  (unchanged — the docked band is a sibling of the panel `<section>` in the surface column).
- [x] `npm run typecheck` + `npm test` + `npm run test:dom` pass; reused shared submit logic + the
  pure predicates (no duplication).

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.4 (the "Shared collapsible prompt composer" paragraph): note
  the composer now has a per-surface `mode` — **`floating`** (default; the draggable collapse-on-exit
  logo on Slack/Jira/Confluence/Google Calendar) vs **`docked`** (Cosmos: always-open, bottom-pinned,
  never collapses, not hidden by `busy`, auto-focus on activation). Make clear the §4.4 "busy hides
  BOTH states" rule applies only to `floating`.
- [ ] Update this plan's Deviations with any DOM-placement / focus-signal choices the design or
  implementation settled differently from the Approach notes.
- [ ] Reconcile `TODO.md` (wrap-up): mark the pinned-composer item; note that broader Cosmos-panel
  rework remains queued (the user's "first").

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-28**: Plan authored. Mechanism = OQ-1 Option A (single `PromptComposer` + `mode` prop
  decided from active surface via `composerModeForSurface`); OQ-2 = auto-focus on Cosmos activation
  without focus-steal. Confirmed in-repo precedent for the docked layout: Confluence comments composer.

- **2026-06-28 (implement)**: Implemented Phases 1–3. DEVIATIONS / decisions settled during impl:
  - **DOM placement = Approach (a)** as planned: `SharedComposer` keeps the ONE `PromptComposer`
    mounted (no `key`) and branches the WRAPPER on `mode` (`shrink-0` in-flow slot for docked vs the
    unchanged `absolute inset-0` overlay for floating). `PromptComposer` EARLY-RETURNS a dedicated
    flat in-flow `<form>` for the docked body — chosen over threading `docked` through every line of
    the large floating JSX, which keeps the floating render path provably byte-for-byte unchanged.
  - **CosmosPanel `PanelFooter` removed** (design §1.3): the docked composer band IS the bottom
    chrome now, so Cosmos no longer renders its status-strip footer (other four panels keep theirs).
    Removed now-unused `PanelFooter`/`CosmosMark` imports.
  - **VISUAL REFINEMENT (user, post-review):** the docked composer is an INSET, margined, ROUNDED
    card on the form body, matching the floating composer's contained card shape but FLAT (no
    glass) — NOT a full-bleed `border-t` bottom band. Behavior (always-open / never-collapse /
    submit-stays-open / inert Esc+click-outside / not-hidden-on-busy / activation auto-focus) is
    unchanged. Design doc §1.1/§1.2/§2 updated to match.
  - **VISUAL REFINEMENT pass 2 (user, 2026-06-28):** the docked card is now CONSTRAINED to the SAME
    width as the floating composer (`w-full max-w-2xl` on the form) and CENTERED — the `SharedComposer`
    docked wrapper became `flex shrink-0 justify-center px-3 pb-3` (centers + side/bottom margin),
    and the form body lost `mx-3 mb-3`, gaining `w-full max-w-2xl`. So the docked input is sized
    identically to the composer on the other panels, just bottom-pinned with a slight margin. Behavior
    unchanged; dom tests (query by role/label, not class) stay green. Design doc §1.1/§1.2/§2/§2.1
    updated to match.
  - **VISUAL REFINEMENT pass 3 (user, 2026-06-28) — bottom margin + COLOR SEAM:** the docked
    `SharedComposer` wrapper now carries the SAME `bg-card border-l border-border` as the Cosmos
    `<section>` and a bigger bottom margin: `flex shrink-0 justify-center border-l border-border
    bg-card px-3 pt-3 pb-4`. ROOT CAUSE of the seam: the docked band is a SIBLING below the
    `bg-card` panel section in the `surfaceRef` column, so without its own surface it exposed the app
    `bg-background` — the panel's bottom area looked a different color than its top. Giving the band
    `bg-card border-l` makes the panel one continuous surface tab-strip→bottom; `pb-4` is the
    requested bottom margin. Renderer-only, behavior unchanged, dom tests stay green. Design doc
    §1.1/§1.2/§2.1 updated.
  - **VISUAL REFINEMENT pass 4 (user, 2026-06-28) — MORE bottom margin:** `pb-4` was still too
    tight, so the docked wrapper bottom padding is bumped `pb-4` → `pb-6` for a clearly larger gap
    below the card and the panel's bottom edge. Final docked wrapper class:
    `flex shrink-0 justify-center border-l border-border bg-card px-3 pb-6 pt-3`. Everything else
    (bg-card seam fix, centering, `max-w-2xl` card, behavior) unchanged; design doc §1.1/§1.2/§2.1
    updated `pb-4`→`pb-6`.
  - **Test infra:** added the `@` alias to `vitest.dom.config.ts` (so the dom test can render the
    real `PromptComposer` importing `@/components/*`) and `import '@testing-library/jest-dom/vitest'`
    in the dom test for matcher types. Both recorded in `docs/DEVELOPMENT.md` §Testing.
  - **Phase 4 (ARCHITECTURE.md §4.4)** is architect-owned — NOT edited here. Flagged for the
    architect: §4.4 should note the composer's per-surface `mode` (`floating` default vs `docked`
    Cosmos) and that "busy hides BOTH states" is now FLOATING-ONLY.
  - **Verification:** `npm run typecheck` clean; `npm test` 2566 passed; `npm run test:dom` 25 passed
    (incl. 8 new docked DOM tests). Runtime layout (actual rendered docked card in `npm run dev`)
    was NOT exercised by this agent — recommend a manual `npm run dev` check of the docked card's
    visual placement + auto-scroll interplay.
