# Plan: Composer Send Animation — v1

**Status**: Draft
**Created**: 2026-06-08
**Last updated**: 2026-06-08
**Spec**: .sdd/specs/composer-send-animation-v1.md

---

## Summary

Two renderer-only changes, no IPC/MCP/main work. (1) Change `PromptComposer.tsx`'s
submit-time motion: instead of shrinking the composer card into the logo
(`scale-[0.08]`), animate it EXPANDING past full size while fading to zero, then rest in
the existing collapsed-logo state. (2) Show a busy spinner on each generative panel's
surface region (the `role="tabpanel"` content div) from submit until that run's surface
actually renders into the originating tab — driven by the per-tab `inFlight`/`surface`/
`error` state that already lives in `useGenerativePanelTabs`, surfaced through the panel
(which already owns that div and already renders skeletons/errors there). The in-Send-
button "Generating…" glyph is removed. Exact spinner placement/style and the expand/vanish
easing/duration are deferred to the `design` step (spec OQ-2).

## Spinner-ownership decision (the key integration point)

**The spinner is PANEL/SURFACE-OWNED, not a new `PromptComposer` prop.** Justification,
grounded in code:

- The per-tab busy/surface signal (`activeTab.inFlight`, `activeTab.surface`,
  `activeTab.error`, `activeTab.loadingDefault`) already lives in the panel via
  `useGenerativePanelTabs` → `activeTab`. The composer is intentionally decoupled (it only
  subscribes to `window.cosmos.agent.onStatus`) and has no tab context. Feeding tab state
  INTO the composer via a new prop would invert the data flow for no benefit.
- The composer expands-and-vanishes on submit and **rests collapsed** (spec FR-004), so it
  is not on screen during generation — it cannot host the spinner. The busy affordance must
  live where the result will appear: the surface region.
- That surface region is ALREADY panel-owned and already conditionally renders
  loading/error UI there: Jira renders `DefaultViewSkeleton` and an error `<p>` inside its
  `role="tabpanel"` div; `GeneratedUiPanel` renders the idle placeholder + error `<p>`
  there. The send-spinner is the same kind of per-tab content-region state, so it belongs
  beside them.
- The stop condition is precisely the tab transition `inFlight && !surface && !error` →
  has `surface` (or `error`) — exactly the fields the panel already maps into `stripTabs`
  (`t.inFlight ? 'in-flight' : t.error ? 'error' : 'idle'`). No `agent.onStatus` re-derive.

Consequence: `PromptComposerProps` gains NO prop. The composer change is purely the motion
swap + removing the in-button glyph. A small shared presentational `SurfaceSpinner` component
(designer-styled) is rendered by each panel in its content region, gated on the active tab's
busy-without-surface state.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript + React (renderer), Tailwind v4 |
| Key dependencies  | `lucide-react` (`Loader2`), existing `useGenerativePanelTabs` (`GenerativeTab`), `@a2ui-sdk/react` (unchanged) |
| Files to create   | `src/renderer/SurfaceSpinner.tsx` (shared presentational busy indicator); optional `src/renderer/composerAnimation.ts` (+ `.test.ts`) only if a pure helper is warranted (see below) |
| Files to modify   | `src/renderer/PromptComposer.tsx` (motion swap + remove in-button glyph); `src/renderer/GeneratedUiPanel.tsx`, `JiraPanel.tsx`, `SlackPanel.tsx`, `ConfluencePanel.tsx` (render `SurfaceSpinner` in the content region) |

### `.ts`/`.test.ts` split

Most of this feature is JSX + Tailwind classes (animation states) and per-tab boolean
gating — not standalone testable logic, so it stays in `.tsx`. The ONE candidate for
`promptComposerLogic.ts` (or a tiny `composerAnimation.ts`) is a pure
`surfaceSpinnerVisible({ inFlight, hasSurface, hasError, loadingDefault })` predicate so the
busy-gate decision is node-testable (mirrors the existing pure-helper convention). The
expand/vanish CSS, the `expanded` flag, and DOM/focus concerns remain in the `.tsx`. No new
DOM-bound logic is added to the composer; its `submit()` path (`onSubmit` →
`draftAfterSubmit` → `collapse(true)`) is unchanged.

### Animation mechanics (Tailwind v4 gotcha)

- KEEP both composer states always-mounted and toggled via `expanded` (the existing
  pattern) so the exit transition fires.
- On the EXPANDED form, change ONLY the hidden-state classes for the submit/collapse exit:
  currently `scale-[0.08] opacity-0 blur-sm`. New exit = grow-and-vanish, e.g.
  `scale-[1.06] opacity-0` (final scale + easing are the designer's call, OQ-2). The
  transition MUST name the props: `transition-[opacity,scale,filter]` (already present;
  `scale-*` compiles to a standalone `scale:` prop, so it must be named).
- Keep `motion-reduce:transition-none` + `motion-reduce:transform-none` so reduced-motion is
  an instant swap (spec FR-010).
- The collapsed-logo fade timing (`delay-150` bloom) stays as-is; the logo is still the
  resting state (spec FR-004). Note: the logo currently fades in delayed to sell the
  "shrink into the button" handoff — with grow-and-vanish that handoff narrative changes;
  the designer should re-tune whether the logo still delays its bloom (OQ-2).
- `SurfaceSpinner` must offer a reduced-motion-friendly static busy state and set
  `aria-busy`/a status role on the region (spec FR-012).

## Implementation Checklist

### Phase 0 — Design handoff (UI-bearing)

- [ ] Run the `design` skill: settle spinner placement/style in the content region and the
      expand/vanish easing/duration + final scale (spec OQ-2). Output `.sdd/designs/composer-send-animation-v1.md`.

### Phase 1 — Interface

- [ ] Confirm no spec open question blocks build (OQ-1 resolved: drive off per-tab state).
- [ ] Add the pure predicate `surfaceSpinnerVisible(...)` to `promptComposerLogic.ts` (or a
      new `composerAnimation.ts`) — no invented fields; consumes only existing `GenerativeTab`
      booleans.
- [ ] Define `SurfaceSpinner` props (no new IPC types; presentational only).

### Phase 2 — Testing

- [ ] Unit-test `surfaceSpinnerVisible`: in-flight w/o surface → visible; surface present →
      hidden; error → hidden; not-in-flight idle → hidden; `loadingDefault` (Jira default/nav
      read) interaction defined so it does not double-show with the existing skeleton.
- [ ] Test invalid/missing input → safe `false` (busy never sticks), per the project's
      warn+fallback convention.

### Phase 3 — Implementation

- [ ] `PromptComposer.tsx`: swap the EXPANDED hidden-state classes to grow-and-vanish; keep
      both states mounted, `transition-[opacity,scale,filter]`, reduced-motion fallback.
- [ ] `PromptComposer.tsx`: remove the in-Send-button `Loader2`/"Generating…" glyph (FR-009);
      keep the running-disable gating on the Send control for the re-open-mid-run case.
- [ ] Create `SurfaceSpinner.tsx` (designer-styled), reduced-motion-safe, with `aria-busy`/status.
- [ ] Render `SurfaceSpinner` in each panel's content region, gated on the active tab via
      `surfaceSpinnerVisible(...)`: `GeneratedUiPanel`, `JiraPanel` (compose w/ existing
      `DefaultViewSkeleton`/`navLoading` so they do not collide), `SlackPanel`, `ConfluencePanel`.
- [ ] Verify per-tab scoping (FR-008): switching to a non-in-flight tab hides it; back shows it.
- [ ] `npm run typecheck` + `npm test` green.

### Phase 4 — Docs

- [ ] At wrap-up, reconcile `docs/ARCHITECTURE.md`: the composer section currently states the
      submit motion is "shrink into the logo" and that run feedback surfaces only via the tab
      strip + footer glyphs. Both change — note the grow-and-vanish submit motion and the new
      per-tab surface send-spinner driven off `useGenerativePanelTabs` tab state. Update
      `docs/PROJECT-STRUCTURE.md` for `SurfaceSpinner.tsx`. Update `TODO.md`.
- [ ] Update this plan's Deviations with anything that differed.

---

## Deviations & Notes

- **2026-06-08**: Plan authored. Spinner ownership resolved to panel/surface-owned (not a
  `PromptComposer` prop) because the per-tab busy signal already lives in the panel and the
  composer is off-screen (collapsed) during the run. Final spinner look + easing deferred to
  the `design` step (spec OQ-2).
- **2026-06-08 (impl)**: **Logo hidden during generation supersedes spec P2 "re-open mid-run".**
  Per user direction, the composer now takes a `busy` prop (= the panel's `showSpinner`) that hides
  BOTH composer states including the collapsed logo button; the logo reappears only when the run's
  surface lands (or errors). This replaces FR-004's "logo remains usable mid-run" / the "re-open
  mid-run" edge case — there is intentionally no compose affordance on screen during a run.
- **2026-06-08 (impl)**: Submit now sets `surface: null` on the active tab so the panel blanks to
  just the spinner (the prior surface was being kept, leaving `surfaceSpinnerVisible` false). Jira's
  default-view auto-load effect gained a `!inFlight` guard so clearing the surface mid-compose does
  not re-trigger a default read (which set `loadingDefault` and suppressed the spinner + `busy`).
- **2026-06-08 (impl)**: Added a per-tab `composed` flag in `useGenerativePanelTabs` (true for a
  solicited compose frame, false for an unsolicited push) so Jira hides its JQL search box on a
  generated-UI surface while keeping it for ticket browsing. Distinct exit animations: submit =
  grow-to-fill `scale-[2.6]` launch, Esc/click-outside = gentle `scale-95` dismiss.
