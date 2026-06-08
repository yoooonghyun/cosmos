# Plan: Collapsible Prompt Composer — v1

**Status**: Draft
**Created**: 2026-06-07
**Last updated**: 2026-06-07
**Spec**: .sdd/specs/collapsible-prompt-composer-v1.md

---

## Summary

Replace the four generative panels' (Generated UI, Jira, Slack, Confluence) always-on,
full-width bottom `PromptComposer` with a single **shared** collapsible composer that has
two mutually-exclusive states: a **collapsed** cosmos-logo button at the bottom-center,
and an **expanded**, center-aligned, constrained-width composer. The four panels today
each carry a byte-for-byte duplicate of `PromptComposer`; this plan **extracts one shared
component** (`src/renderer/PromptComposer.tsx`) parameterized by per-panel copy
(`placeholder`, `ariaLabel`) and an `onSubmit(utterance)` callback, and that single
component owns the collapsed/expanded state, focus management, draft preservation, the
Esc / click-outside dismissal, and the open/close animation hook points. Pure,
node-testable decision logic (state transitions, draft preservation, the
submit-accepted/dismiss decision, the click-outside/Esc decision) lands in a sibling
`src/renderer/promptComposer.ts` per the project's `.ts`/`.test.ts` split so the `.tsx`
stays a thin shell. The collapsed logo consumes the existing
`assets/logo/cosmos-symbol.svg`, newly wired into the renderer (it lives outside the
renderer root today and only main uses a logo). Resolving the spec's three open questions:
OQ-1 — drop the composer's inline status/error block and rely on the existing always-visible
per-tab surfaces (`PanelTabStrip` status glyph + `PanelFooter` run-status glyph); OQ-2 —
preserve the typed draft on Esc / click-outside dismissal (restore on re-open); OQ-3 —
allow collapsing mid-run. The visual design (logo button styling, animation curve/duration,
centered constrained width, responsive behavior, and where/whether error re-surfaces on the
logo) is **deferred to the `designer` step** (`.sdd/designs/collapsible-prompt-composer-v1.md`),
which runs after this plan is approved; the developer builds against both this plan and that
design spec.

## Technical Context

| Item              | Value                                                                                                                                                                                                                       |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript + React 19 (renderer), Tailwind + shadcn/ui (`@/components/ui/*`)                                                                                                                                               |
| Key dependencies  | Existing only — `Textarea`/`Button` shadcn components, `lucide-react` (current icons), `window.cosmos.agent.onStatus` (run-status subscription, still needed to disable the textarea while running). No new npm deps.       |
| New runtime data  | None crossing IPC. Collapsed/expanded + draft are session-only renderer state (FR-016). `UiRenderPayload`, the IPC contract, main, MCP, and the `AgentRunner` are all **untouched**.                                       |
| Files to create   | `src/renderer/PromptComposer.tsx` (shared component) · `src/renderer/promptComposer.ts` (pure decision logic) · `src/renderer/promptComposer.test.ts` (node-env unit tests) · a renderer-consumable cosmos-symbol asset (see Phase 1, asset wiring) |
| Files to modify   | `src/renderer/GeneratedUiPanel.tsx`, `src/renderer/JiraPanel.tsx`, `src/renderer/SlackPanel.tsx`, `src/renderer/ConfluencePanel.tsx` (delete each local `PromptComposer`, import the shared one, pass per-panel copy) · possibly `electron.vite.config.ts` and/or a renderer asset location (asset wiring, Phase 1) · `docs/ARCHITECTURE.md` (§4.4 forward-reference, at wrap-up) |

### Grounding notes (current code)

- The four `PromptComposer` copies are **identical** in logic and signature
  (`{ onSubmit: (utterance: string) => void }`); they differ ONLY in three string literals
  per panel: the `<form aria-label>`, the `<Textarea placeholder>`, and the
  `<Textarea aria-label>` (e.g. "Describe the UI you want…", "Ask about your Jira issues…",
  "Ask about Slack", "Ask about Confluence"), plus the error-prefix copy
  ("Couldn't generate that UI:", "Couldn't do that:"). FR-015 → extract once; per-panel copy
  becomes props.
- Each local composer subscribes to `window.cosmos.agent.onStatus` to drive a local
  `running` flag (disables the textarea + ignores submit while a run is in flight) AND an
  inline `error`/`Generating…` block. Under OQ-1 the inline status/error block is **removed**;
  the `running` subscription is **kept** (the textarea must still disable mid-run and submit
  must still no-op while running — FR-005/FR-019). The footer + tab strip already show the
  in-flight spinner / error glyph (see `PanelFooter` `activeTab.status`, `PanelTabStrip`),
  so removing the inline block loses no signal (OQ-1 / FR-009 / SC-005).
- Render condition (FR-017) preserved exactly: `GeneratedUiPanel` renders the composer
  unconditionally; `JiraPanel`/`SlackPanel`/`ConfluencePanel` render it only inside
  `{isConnected && <PromptComposer … />}`. The shared component is dropped into the **same JSX
  slot** so the gating condition is unchanged — the collapsed logo therefore appears under the
  same condition the composer does today.
- The panels' `submit` (from `useGenerativePanelTabs`) owns the originating-tab bookkeeping
  and `window.cosmos.agent.submit`; the composer must keep calling `onSubmit(value)` with the
  raw value exactly as today. **Auto-collapse-on-success (FR-006) keys off the composer's OWN
  accept decision** (non-empty trimmed text AND not running) — the same condition that today
  gates the call to `onSubmit` and the `setValue('')` clear — NOT off an `agent:status` event,
  so collapse is immediate and deterministic and the composer needs no new return value from
  `onSubmit`.
- Asset reality: `assets/logo/cosmos-symbol.svg` exists at repo root; the renderer root is
  `src/renderer` (`electron.vite.config.ts`), so `assets/` is **outside** the renderer's
  resolvable tree and is not importable as-is. The renderer CSP is
  `img-src 'self' data:; script-src 'self'` (`src/renderer/index.html`) — an inlined SVG
  (component or `?raw` string) and a `data:`/bundled `'self'` `<img>` are all CSP-safe; a
  remote URL is not. Asset wiring is a Phase 1 decision (below).

---

## Component boundary (the load-bearing decision)

- **`src/renderer/PromptComposer.tsx`** — the single shared component. Props:
  `{ onSubmit: (utterance: string) => void; placeholder: string; ariaLabel: string }`
  (per-panel copy supplied by each panel; the `aria-label` for the collapsed logo button —
  e.g. "Open prompt" — is fixed shared copy, FR-013, but MAY also derive from `ariaLabel` at
  the designer's discretion). It owns: the `collapsed`/`expanded` boolean state (default
  collapsed, FR-001), the preserved `value` draft (kept across collapse, cleared only on a
  successful submit, FR-018/OQ-2), the `running` flag (via the existing `agent.onStatus`
  subscription, to disable mid-run, FR-005/FR-019), focus management (move focus into the
  textarea on expand — FR-011; return focus to the logo button on collapse — FR-012), the
  click-outside listener scoped to the composer's own region (FR-008), the Esc handler
  (FR-007), and the animation hook points (FR-004 — concrete motion is the designer's).
- **`src/renderer/promptComposer.ts`** — pure, React-free, DOM-free decision helpers so the
  `.tsx` is a thin shell and the logic is node-unit-testable (mirrors `panelTabs.ts`). Houses:
  - `nextStateOnLogoClick(state)` → `'expanded'` (open-only, never a toggle — FR-003).
  - `submitDecision({ value, running })` → `{ accept: boolean }` (non-empty trimmed AND not
    running) — drives both the `onSubmit` call and the auto-collapse (FR-005/FR-006).
  - `dismissDecision()` / draft helpers → what happens to the draft on Esc / click-outside
    (preserve — FR-018/OQ-2) vs. on successful submit (clear — FR-005).
  - `shouldCollapseOnOutsideClick(targetInsideComposer: boolean)` → boolean, encoding the
    "clicks inside the composer (textarea, Send, status) do NOT collapse; clicks elsewhere in
    the panel DO" boundary (Edge Cases). The DOM hit-test ("is the event target inside the
    composer root?") stays in the `.tsx`; only the decision is pure.
  - `escDecision({ open, focused })` → whether Esc collapses (it takes precedence while the
    composer is the focused/open element — Edge Cases).
- **`src/renderer/promptComposer.test.ts`** — vitest node-env tests over `promptComposer.ts`
  only (never imports the `.tsx`), per CLAUDE.md / `panelTabs.test.ts` precedent.

This boundary satisfies FR-015 (one mechanism, four reuses) and the `.ts`/`.test.ts` split.

---

## Asset wiring (Phase 1 decision)

`assets/logo/cosmos-symbol.svg` must become consumable by the collapsed logo button under the
renderer CSP. Plan against the **lowest-friction CSP-safe option**, to be finalized with the
developer (who owns build wiring) and confirmed visually by the designer:

- **Preferred:** copy/move a renderer-owned copy of the symbol into the renderer tree (e.g.
  `src/renderer/assets/cosmos-symbol.svg`) and import it — either as a URL for an `<img>`
  (`import logoUrl from './assets/cosmos-symbol.svg'`, bundled under `'self'`, CSP-safe) or as
  an inline React element via `?raw` / an svgr-style import so the mark can inherit
  `currentColor` for theming. Inline-SVG gives the designer the most control (stroke/fill
  follow theme tokens) and avoids a separate network/asset fetch; a bundled `<img>` is simplest.
- **Alternative:** keep the file at `assets/logo/` and add a vite asset alias / `publicDir`
  entry so the renderer can resolve it. Heavier than co-locating a copy.
- Either way, **no remote URL** (CSP `img-src 'self' data:`), and the choice between inline-SVG
  vs `<img>` is finalized in the design step (it determines whether the mark can be recolored
  via Tailwind tokens). Record the final mechanism in the Deviations section.

---

## Open questions — resolved (carried from the spec)

- **OQ-1 → resolved:** Remove the composer's inline status/error block; rely on the existing
  always-visible per-tab surfaces — `PanelTabStrip` status glyph and `PanelFooter`
  run-status glyph (both already render `activeTab.status` `in-flight`/`error`). The designer
  MAY add an error affordance on the collapsed logo, but the plan does not require re-surfacing
  inline error text in the composer. (FR-009 / SC-005.)
- **OQ-2 → resolved:** Preserve the typed draft on Esc / click-outside dismissal; restore it on
  re-open. Clear the draft only on a successful submit. (FR-018.)
- **OQ-3 → resolved:** Collapsing mid-run is allowed (Esc / click-outside collapse even while a
  run is in flight; the textarea is already disabled and status persists via OQ-1). (FR-019.)

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates.
> A **`designer` design step** (`.sdd/designs/collapsible-prompt-composer-v1.md`) runs AFTER
> this plan is approved and BEFORE Phase 2 below; it fixes the logo-button visuals, the
> open/close animation, the centered constrained width + responsive behavior, and the OQ-1
> error-affordance question. The developer implements against BOTH this plan and that design.

### Phase 1 — Interface & asset wiring

- [x] Re-read the spec; confirm OQ-1/OQ-2/OQ-3 are resolved as above (no open questions remain).
- [x] Decide + wire the renderer-consumable cosmos-symbol asset (see Asset wiring) — CSP-safe,
      no remote URL; record the chosen mechanism. → **inline SVG component**
      `src/renderer/CosmosMark.tsx` (path data copied verbatim from
      `assets/logo/cosmos-symbol.svg`, fixed `width/height` stripped, `fill="currentColor"`
      kept, `aria-hidden`). See Deviations.
- [x] Define the shared `PromptComposer` props contract in `src/renderer/PromptComposer.tsx`
      (`onSubmit`, `placeholder`, `ariaLabel`, + optional `collapsedAriaLabel` defaulting to
      "Open prompt") — no invented behavior props; per-panel copy only.
- [x] Define the pure decision helpers' signatures in `src/renderer/promptComposerLogic.ts`
      (`nextStateOnLogoClick`, `submitDecision`, `draftAfterDismiss`/`draftAfterSubmit`,
      `shouldCollapseOnOutsideClick`, `escDecision`) — React-free, DOM-free. (Module renamed
      from `promptComposer.ts` → `promptComposerLogic.ts`; see Deviations: casing collision.)
- [x] Cross-check the contract against the spec — every prop/helper traces to an FR.

### Phase 2 — Testing (node env, over `promptComposerLogic.ts` only)

- [x] `submitDecision`: non-empty trimmed + not running → accept; empty/whitespace → no-op
      (FR-005); running → no-op (FR-005/FR-019); non-string/missing input → warn + safe fallback.
- [x] Logo-click transition is open-only (never toggles an already-expanded composer) (FR-003).
- [x] Draft preservation: dismiss (Esc / click-outside) preserves the draft; successful submit
      clears it (FR-018/OQ-2, FR-005).
- [x] `shouldCollapseOnOutsideClick`: inside-composer target → no collapse; elsewhere → collapse
      (Edge Cases).
- [x] `escDecision`: collapses when open/focused; precedence over unrelated panel Esc handling
      (Edge Cases); safe fallback on missing input.
- [x] Collapse-mid-run is permitted by the dismiss helpers regardless of `running` (FR-019/OQ-3).
- [x] Tests never import the `.tsx` (CLAUDE.md `.ts`/`.test.ts` split). 21 tests, node env.

### Phase 3 — Implementation

- [x] Implement `src/renderer/PromptComposer.tsx` as a thin shell over `promptComposerLogic.ts`:
      collapsed logo button (accessible name, FR-013; `aria-expanded`/focus semantics, FR-014)
      ↔ expanded composer (textarea + Send), mutually exclusive (FR-002/SC-007), animated both
      directions (FR-004, per the design spec).
- [x] Wire behavior: default collapsed (FR-001); logo click → expand + focus textarea (FR-011);
      Enter submits / Shift+Enter newline / empty no-op / ignored mid-run (FR-005); successful
      submit → `onSubmit(value)` then collapse + clear draft + return focus to logo (FR-006/FR-012);
      Esc → collapse + preserve draft + focus logo, no run (FR-007/FR-012/FR-018); click-outside
      (scoped to composer region) → collapse + preserve draft + focus logo, no run
      (FR-008/FR-012/FR-018).
- [x] Apply the centered, constrained-width expanded layout + animation per the design spec (FR-010).
- [x] Remove the inline status/error block; keep the `agent.onStatus` subscription only to drive
      the mid-run `running` disable + the optional collapsed-logo error ring (OQ-1 / FR-009 / §3.4).
- [x] Replace the four local `PromptComposer` definitions with imports of the shared component,
      passing each panel's existing copy as `placeholder` + `ariaLabel`:
  - [x] `GeneratedUiPanel.tsx` — unconditional slot (FR-017), copy "Describe the UI you want…".
  - [x] `JiraPanel.tsx` — keep `{isConnected && <PromptComposer …/>}` (FR-017), Jira copy.
  - [x] `SlackPanel.tsx` — keep `{isConnected && <PromptComposer …/>}` (FR-017), Slack copy.
  - [x] `ConfluencePanel.tsx` — keep `{isConnected && <PromptComposer …/>}` (FR-017), Confluence copy.
- [x] Confirm no fifth divergent copy remains and no panel still inlines collapse logic (FR-015).
- [x] `npm run typecheck` (node + web) and `npm test` green; `npm run dev` smoke per panel.
      → typecheck + 682 tests + `npm run build` all green. **`npm run dev` GUI smoke NOT run
      (no interactive GUI in this environment) — manual verification still required (see Deviations).**

### Phase 4 — Docs

- [x] Update this plan's Deviations with the final asset mechanism and any design-driven changes.
- [ ] Update `docs/ARCHITECTURE.md` §4.4 (and the §4.8/§4.9 composer mentions) to note the
      generative panels now share ONE collapsible `PromptComposer` (collapsed logo ↔ expanded
      centered composer, session-only state, OQ-1 status via footer/tab strip) instead of four
      inline copies — at wrap-up.
- [ ] Reconcile `TODO.md` (check off, add any surfaced follow-ups) via the wrap-up skill.

---

## Architecture impact

This introduces a new **shared renderer component** + a pure-logic sibling, and a small
structural decision (the collapsed/expanded state machine lives once in `PromptComposer`, the
four panels stop duplicating it). The authoritative `docs/ARCHITECTURE.md` update lands at
wrap-up (Phase 4), but the forward-reference target is **§4.4 (A2UI panels)** — where the
panels' composers are described — with companion touch-ups to §4.8 (Slack composer) and §4.9
(Jira/Confluence composer) noting the shared collapsible composer and that run/error status is
read from the always-visible `PanelFooter` + `PanelTabStrip` surfaces rather than an inline
composer block. No change to the IPC contract, `UiRenderPayload`, target routing, per-tab
correlation, or the agent run lifecycle (all explicitly out of scope per the spec).

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-07**: Plan authored. Open questions resolved per the approved direction (OQ-1 rely
  on existing footer/tab-strip status + drop inline block; OQ-2 preserve draft; OQ-3 allow
  collapse mid-run). Visual/animation/centered-width specifics deferred to the design step.

- **2026-06-07 (implementation, developer)**:
  - **Pure-logic module renamed `promptComposer.ts` → `promptComposerLogic.ts`** (+ its test
    `promptComposer.test.ts` → `promptComposerLogic.test.ts`). The plan named the pure file
    `promptComposer.ts`, but on the case-insensitive macOS filesystem that stem collides with
    the `PromptComposer.tsx` component — TypeScript errors `TS1149: File name … differs from
    already included file name … only in casing`. Renaming the logic module to a distinct stem
    resolves it while keeping the component name from the plan (mirrors the existing
    `PanelTabStrip.tsx` ↔ `panelTabs.ts` pattern, where the stems already differ). All
    references (the `.tsx` import + the test import) updated.
  - **Asset mechanism = inline SVG component `src/renderer/CosmosMark.tsx`** (the design §8
    "inline SVG, not `<img>`" recommendation). The mark's `<path>` data is copied verbatim from
    `assets/logo/cosmos-symbol.svg`; the fixed `width="200" height="200"` are dropped (caller
    sizes via `className="size-5"`), `fill="currentColor"` is kept, and the `<svg>` is
    `aria-hidden`/`focusable="false"`. This inherits `currentColor` so the button recolors per
    state (resting `text-muted-foreground` → hover `text-foreground` → error `text-destructive`),
    which an `<img>` could not do; CSP-safe (no remote URL, no `<img>` fetch). Chose a
    hand-authored component over an svgr/`?raw` import to avoid adding a build-time SVG loader /
    `*.svg` type-declaration just for one mark.
  - **Design SHOULD/MAY affordances both implemented (clean):** the collapsed-logo error ring
    (§3.4 / R-1) driven off the same `agent.onStatus` `state:'error'` (cleared on the next
    `started`/`completed`); and the preserved-draft dot (§3.3 / R-2), a decorative
    `bg-primary` dot shown while a non-empty draft is held collapsed. No new IPC.
  - **Removed now-unused imports** from the four panels after deleting their local composers
    (`Textarea`, `Loader2`, `AgentStatusPayload`, `FormEvent`/`KeyboardEvent` type imports where
    they became dangling) so `noUnusedLocals`/`noUnusedParameters` stays green. The SlackPanel's
    in-content `activeTab.error` block ("Couldn't do that: …") is a SEPARATE surface-error display
    in the tab content region (not the composer) and was intentionally left in place.
  - **Verification:** `npm run typecheck` (node + web), `npm test` (32 files / 682 tests, incl.
    the new 21), and `npm run build` all green. **`npm run dev` GUI smoke was NOT performed —
    this environment has no interactive GUI; manual verification of the animation, centered
    width, focus moves, Esc/click-outside/after-submit collapse, draft preservation, the
    footer/tab-strip status surfaces, and the connected-only gate on the three integrations is
    still required.**

- **2026-06-07 (post-implementation UI iteration + design reconciliation)**: the shipped visual
  diverged from the original design spec through live iteration with the user; the design spec
  (`.sdd/designs/collapsible-prompt-composer-v1.md`) was reconciled to match. Net changes:
  - **Mark = pastel, not `currentColor`.** `CosmosMark` now renders the brand pink→purple gradient
    (`assets/logo/cosmos-symbol-pastel.svg`), with a **per-instance `useId()` gradient id** — a
    static id collided across the four simultaneously-mounted panels and painted the mark
    transparent. Brand colors promoted to theme tokens `--brand-pink`/`--brand-purple`/
    `--brand-foreground` (index.css); the Send control uses a new reusable `cosmos` Button variant.
  - **Logo button** is an opaque (`bg-popover`) `rounded-xl` bordered+shadowed `size-12` button (not
    a `rounded-full` ghost); the composer card is opaque `bg-popover` (not `bg-card/40`).
  - **Overlay float:** the expanded card floats in a zero-height in-flow slot + `absolute bottom-0`
    with a transparent `pointer-events-none` surround, so a tall composer never pushes/hides the
    tickets behind it.
  - **Animation:** BOTH states are always mounted in the one slot and cross-faded via `expanded`
    (conditional mount/unmount would skip the CSS transition); hidden state is `inert` +
    `pointer-events-none` + `tabIndex=-1`. The COMPOSER carries the size morph (scales from
    `scale-[0.08]` at `origin-bottom` = the button's point, + opacity + blur); the LOGO only
    opacity-fades, with a `delay-150` stagger on COLLAPSE so it reads as "chat becomes the button".
    400ms `cubic-bezier(0.16,1,0.3,1)`, `motion-reduce:` instant fallback. **Tailwind-v4 gotcha:**
    `scale-*` is the standalone `scale:` CSS property, so the transition must list
    `transition-[opacity,scale,filter]` (NOT `transform`) or the size jumps instantly.
