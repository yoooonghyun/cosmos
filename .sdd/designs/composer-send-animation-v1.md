# Design: Composer Send Animation — v1

**Status**: Draft
**Created**: 2026-06-08
**Owner**: designer
**Spec**: .sdd/specs/composer-send-animation-v1.md
**Plan**: .sdd/plans/composer-send-animation-v1.md
**Evolves**: .sdd/designs/collapsible-prompt-composer-v1.md (submit/collapse motion only)

---

## 0. Summary (visual approach in one paragraph)

On Send the composer no longer shrinks back into the logo — it **grows past full size while
fading and softening to nothing** (`scale-[1.04] opacity-0 blur-[2px]`, `origin-bottom`,
the existing 400ms `cubic-bezier(0.16,1,0.3,1)`), as if the prompt were launched into the
surface. The panel still **rests in the existing collapsed-logo state** (unchanged), but the
logo's `delay-150` bloom on collapse is **dropped** for the submit path so the button is
already present as the composer expands away. While the run is in flight the **surface
itself shows the busy state**: a new shared `SurfaceSpinner` — the repo's
`cosmos-spinner.svg` reborn as an inline React component (`CosmosSpinner`) with a `useId()`
gradient and its keyframes hoisted into `index.css` — centered in the panel's
`role="tabpanel"` body with a "Generating…" label, gated on the originating tab's
`inFlight && !surface && !error && !loadingDefault`. The in-button `Loader2`/"Generating…"
glyph is removed. Reduced motion: instant composer swap; the spinner becomes a static
sparkle that still reads as "busy" via `aria-busy` + a `role="status"` label.

---

## 1. Asset wiring decision (the headline)

**Decision: inline the spinner as a React component `CosmosSpinner` (sibling of
`CosmosMark`), with a `useId()`-scoped gradient, and move its three `@keyframes` +
animation classes into `src/renderer/index.css`. Do NOT use `<img src>` and do NOT inline
the SVG's internal `<style>` block verbatim.**

Why:

- **Matches the established convention.** `CosmosMark.tsx` is already inlined-as-component
  precisely to be CSP-safe (`img-src 'self' data:`) and to make the gradient id
  per-instance via `useId()`. The spinner has the **identical static-id problem**: its
  `<defs>` uses a hard-coded `id="ps"`, and although only one spinner is visible at a time,
  the component can be **mounted in up to four panels at once** (each panel renders its own
  content region). Four mounted `<defs id="ps">` → `url(#ps)` resolves to the first/hidden
  one → the visible spinner paints transparent. `useId()` per instance eliminates this,
  exactly as for `CosmosMark`.
- **`<img src>` is rejected** on two grounds: (1) CSS animations *inside* an SVG loaded via
  `<img>` **do** run, but the SVG is then an opaque replaced element — we cannot scope its
  gradient id, cannot drive its fill from `var(--brand-*)` theme tokens (an `<img>` SVG
  can't read the host document's CSS variables), and cannot apply the renderer's
  `prefers-reduced-motion` gate to its internal keyframes. (2) It re-introduces a bundled
  asset path + Vite asset-import wiring we otherwise avoid. Inlining keeps the spinner a
  first-class themed component on the same footing as the mark.
- **Why hoist the keyframes to `index.css` rather than keep the SVG's inline `<style>`:**
  an inlined `<style>` injects **global, unscoped** class names (`.fl`, `.sA`, `.sB`) and
  global `@keyframes` (`flSpin`, `spkA`, `spkB`) once per mounted instance — duplicated,
  leak-prone, and impossible to gate with Tailwind's `motion-reduce:` variant. Defining the
  keyframes **once** in `index.css` under uniquely-named classes (below) and applying them
  to `<g>` elements in the component is the clean, de-duplicated, reduced-motion-gateable
  form. This is a small extension of the design system (new keyframes), recorded in §5.

### 1.1 `CosmosSpinner` component shape (developer builds; designer specifies)

A new `src/renderer/CosmosSpinner.tsx`, mirroring `CosmosMark`:

- `viewBox="-80 -80 160 160"`, accepts `SVGProps<SVGSVGElement>`, sized by caller via
  `className` (no fixed width/height), `aria-hidden focusable="false"` (the owning
  `SurfaceSpinner` carries the accessible name).
- `const gid = useId()` → `<linearGradient id={gid}>` with stops `var(--brand-pink)` →
  `var(--brand-purple)` (NO raw hex — the SVG's literal `#f9a8d4`/`#d8b4fe` are replaced by
  the tokens, identical values, now theme-routed). All three `fill="url(#ps)"` become
  `fill={\`url(#${gid})\`}`.
- The three animated groups carry **new global class names** (not the SVG's `.fl/.sA/.sB`):
  `cosmos-spinner-orbit` (the 4-point star, `flSpin` 4s linear), `cosmos-spinner-sparkA`
  (top-right sub-sparkle, `spkA` 1.5s), `cosmos-spinner-sparkB` (bottom-left sub-sparkle,
  `spkB` 2.1s, `.5s` delay). Keyframes + these classes live in `index.css` (§5.2). The
  paths/transforms are copied verbatim from `assets/images/cosmos-spinner.svg`.

> `cosmos-spinner.svg` stays in `assets/images/` as the source-of-truth artwork; it is not
> imported at runtime. No Vite asset wiring is needed (this is the build to-do avoided).

---

## 2. SurfaceSpinner — placement, size, layout

A new shared presentational `src/renderer/SurfaceSpinner.tsx`. It is **not** a `components/ui/`
primitive (like `CosmosMark`/`CosmosSpinner`, it's a cosmos-specific composite, not a
generic shadcn part) — it lives in `src/renderer/` alongside the panels.

**Placement:** centered in the panel's content region (the `role="tabpanel"` body), as a
sibling beside the existing idle-placeholder / error `<p>` / skeleton. It is the busy state
of that same region (spec §99: the composer is gone during the run, so the surface owns the
busy affordance).

**Layout & size:**

```
<div role="status" aria-live="polite" aria-busy="true"
     className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-3 text-muted-foreground">
  <CosmosSpinner className="size-10" />            {/* 2.5rem sparkle */}
  <span className="text-[13px] text-muted-foreground">Generating…</span>
</div>
```

- **Spinner size:** `size-10` (2.5rem / 40px) — larger than the `size-8` collapsed mark so
  it reads as a primary surface affordance, not chrome. The sub-sparkles sit at the
  artwork's corners within the same box.
- **Centering:** `flex … items-center justify-center` filling the content region
  (`h-full`), with a `min-h-[8rem]` floor so it is centered even before the region has
  grown. The Jira/Generated-UI bodies already provide the `flex-1 overflow-auto p-3`
  container; `SurfaceSpinner` is dropped straight in.
- **Label:** "Generating…" in `text-[13px] text-muted-foreground` — the same 13px body size
  and `--muted-foreground` used by every panel's idle/error copy, so it reads as one family.
  `gap-3` between sparkle and label.

**Reduced motion (`prefers-reduced-motion`):** the keyframe classes are wrapped so they
animate only when motion is allowed (see §5.2 — the `@keyframes` application sits behind a
`@media (prefers-reduced-motion: no-preference)` query, OR each class carries
`motion-reduce:[animation:none]`). With motion off, the sparkle is shown **static at full
opacity/scale** (a legible filled cosmos star) and the "Generating…" label plus
`aria-busy="true"` / `role="status"` still convey "busy" to sighted and AT users. The label
is therefore **load-bearing**, not decorative — it must always render (it is the
reduced-motion busy signal).

---

## 3. The grow-and-vanish composer motion (replaces shrink-to-logo)

Change applies to the EXPANDED `<form>` hidden-state classes in `PromptComposer.tsx`. Both
states stay mounted (FR-003/FR-013); only the hidden-state class set changes.

| | Old (shrink-to-logo) | New (grow-and-vanish) |
|---|---|---|
| Hidden-state classes | `scale-[0.08] opacity-0 blur-sm` | `scale-[1.04] opacity-0 blur-[2px]` |
| Visible-state classes | `scale-100 opacity-100 blur-0` | unchanged |
| Origin | `origin-bottom` | `origin-bottom` (unchanged) |
| Transition property | `transition-[opacity,scale,filter]` | unchanged (DO NOT drop `scale`/`filter` — Tailwind v4 gotcha §4.0 of predecessor) |
| Duration / easing | `duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]` | unchanged |
| Reduced motion | `motion-reduce:transition-none motion-reduce:transform-none` | unchanged (instant swap) |

Values & rationale:

- **Target scale `scale-[1.04]`** — a *restrained* grow. The composer is already a large
  `max-w-2xl` card; scaling it to e.g. `1.2` would push it past the panel edges and read as
  a glitch. `1.04` (4% past full size) is enough to register as "expanding/launching" while
  the simultaneous `opacity-0` fade carries the disappearance. The eased-out curve front-
  loads the growth so the expansion is perceived early and the fade finishes it.
- **`opacity-0`** — the vanish; the dominant exit channel.
- **`blur-[2px]`** — a light defocus reinforcing "dispersing into the surface" (softer than
  the old `blur-sm` = 4px, because a growing element blurring heavily looks like a render
  bug; 2px is a gentle bloom). Optional but recommended; keep it in `transition-[…,filter]`.
- **`origin-bottom`** retained so the growth pushes UP/outward from where the logo sits,
  visually "into" the content region above — consistent with the launch metaphor.

**Logo on submit-collapse:** the predecessor delayed the logo's fade-in (`delay-150`) to
sell "chat shrinks INTO the button." That narrative is now inverted — there is no shrink-to-
button handoff. The logo should be **present immediately** as the composer grows away.

- **Recommendation:** keep the logo's open/close fade as-is for the click-outside / Esc
  paths, but for the **submit** collapse the delayed bloom is wrong. Since the existing
  collapsed-state class is a single `delay-150` on the `opacity-100` branch, the simplest
  correct treatment is to **remove the `delay-150`** from the collapsed (`!expanded`)
  branch so the logo fades in immediately on every collapse. The lost "bloom after shrink"
  flourish was only meaningful for the old shrink motion; with grow-and-vanish an immediate
  logo is more honest. (If the developer wants to preserve the delayed bloom for the
  Esc/click-outside dismiss specifically, that requires distinguishing collapse-reason in
  the class — out of scope; the unconditional removal is the approved simpler path.)

---

## 4. Every state of the surface (the busy region)

The `role="tabpanel"` content region of each generative panel has these mutually-exclusive
states. `SurfaceSpinner` adds exactly one (loading); the others are unchanged.

| State | Gate | Visual |
|-------|------|--------|
| **Idle** (no run, no surface) | `!inFlight && !surface && !error` (+ `!loadingDefault`) | Existing idle placeholder `<p>` ("Describe a UI below…", etc.). No spinner. |
| **Loading (send in flight)** | `inFlight && !surface && !error && !loadingDefault` | **`SurfaceSpinner`** centered: animated cosmos sparkle (`size-10`) + "Generating…". `aria-busy`/`role="status"`. Replaces nothing visually permanent — it occupies the region until a surface/error lands. |
| **Populated** | `surface != null` | The A2UI surface via `ActiveTabSurface`. No spinner (gate's `!surface` is false). |
| **Error** | `error != null` | Existing error `<p role="alert">` ("Could not generate that UI: …", etc.). No spinner (gate's `!error` is false). |
| **Jira default/nav loading** | `loadingDefault \|\| navLoading` (Jira only) | Existing `DefaultViewSkeleton`. **Spinner suppressed** — the gate excludes `loadingDefault`, and `navLoading` is Jira-local; Jira renders the skeleton branch first, so the two never co-render. Confirmed in §4.1. |
| **Disabled** | n/a | The surface region has no disabled state. (Send-control disabling is composer-side, unaffected.) |

### 4.1 Per-panel integration (no divergence — FR-011)

The spinner gate is the pure predicate `surfaceSpinnerVisible(...)` from the plan
(Phase-1), consuming only existing `GenerativeTab` booleans
(`inFlight`, `hasSurface`, `hasError`, `loadingDefault`). Each panel renders
`{surfaceSpinnerVisible(activeTab) && <SurfaceSpinner />}` in its content `<div role="tabpanel">`:

- **GeneratedUiPanel** — beside the `showBase` placeholder and `activeTab?.error` `<p>`. The
  base placeholder and the spinner are mutually exclusive (base shows only when not
  in-flight). Render order: spinner branch before/after the placeholder is fine since gates
  don't overlap.
- **JiraPanel** — inside the `isConnected` content `<div role="tabpanel">`, in the **`else`
  (not `loadingDefault || navLoading`)** branch alongside the error `<p>` and the
  `A2UIProvider`. Because `loadingDefault` already routes to `DefaultViewSkeleton` first and
  the predicate excludes `loadingDefault`, the send-spinner and the skeleton **cannot
  co-render**. A user-typed prompt sets `inFlight` (not `loadingDefault`), so it correctly
  shows `SurfaceSpinner`; a default/nav read shows the skeleton. Both read as "loading" and
  share the pastel-on-dark family, so the difference is acceptable and intentional (skeleton
  = structured list read; sparkle = generative compose).
- **SlackPanel / ConfluencePanel** — inside their `role="tabpanel"` content `<div>`, beside
  the error `<p>` and `A2UIProvider`. Same gate.

---

## 5. Tokens, keyframes & component additions

### 5.1 Tokens used (none added)

| Token | Use |
|-------|-----|
| `--brand-pink` (`#f9a8d4`) | `CosmosSpinner` gradient start (`var(--brand-pink)`) |
| `--brand-purple` (`#d8b4fe`) | `CosmosSpinner` gradient end (`var(--brand-purple)`) |
| `--muted-foreground` (`#888`) | "Generating…" label + spinner default text color |

No new color/spacing/radius token is needed. Sizing uses existing scale (`size-10`,
`gap-3`, `min-h-[8rem]`). The `text-[13px]` label matches the panels' existing body copy
(an established arbitrary value already used for idle/error `<p>`s).

### 5.2 Keyframes added (NEW — design-system extension)

Three `@keyframes` + three classes are added to `src/renderer/index.css`. There are no
existing keyframes in the file today, so these are net-new and uniquely prefixed
(`cosmos-spinner-*`) to avoid the SVG's leak-prone generic names. Recommended placement:
after the `@layer base` block (around line 140), outside any `@layer` so they are always
available. Reduced-motion is gated with `prefers-reduced-motion: no-preference`:

```css
@keyframes cosmos-spinner-orbit { to { transform: rotate(360deg); } }
@keyframes cosmos-spinner-pulse-a {
  0%, 100% { opacity: .2; transform: scale(.45); }
  50%      { opacity: 1;  transform: scale(1.2); }
}
@keyframes cosmos-spinner-pulse-b {
  0%, 100% { opacity: .25; transform: scale(.5); }
  45%      { opacity: 1;   transform: scale(1.3); }
}
.cosmos-spinner-orbit,
.cosmos-spinner-sparkA,
.cosmos-spinner-sparkB { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .cosmos-spinner-orbit  { animation: cosmos-spinner-orbit 4s linear infinite; }
  .cosmos-spinner-sparkA { animation: cosmos-spinner-pulse-a 1.5s ease-in-out infinite; }
  .cosmos-spinner-sparkB { animation: cosmos-spinner-pulse-b 2.1s ease-in-out infinite .5s; }
}
```

Under reduced motion no `animation` is applied, so all three groups render static at their
authored base transform/opacity — the orbit star is fully opaque (legible), the sub-sparkles
sit at their reduced base opacity (decorative). The "Generating…" label + `aria-busy` carry
the busy meaning. (Values copied verbatim from `cosmos-spinner.svg`'s `<style>`.)

### 5.3 Component additions

| New file | Kind | Notes |
|----------|------|-------|
| `src/renderer/CosmosSpinner.tsx` | Inline SVG brand asset (sibling of `CosmosMark`) | `useId()` gradient, `var(--brand-*)` stops, classes `cosmos-spinner-orbit/sparkA/sparkB`. `aria-hidden`. |
| `src/renderer/SurfaceSpinner.tsx` | Shared presentational busy indicator | Wraps `CosmosSpinner` + label; `role="status" aria-live="polite" aria-busy="true"`. |

No `components/ui/` primitive added. No `Button` variant change. The predecessor's
`variant="cosmos"` Send button is untouched (only its in-button `Loader2` content is removed
in `PromptComposer`).

---

## 6. Interaction & a11y

- **Composer exit:** after the grow-and-vanish, the form is `inert` + `pointer-events-none`
  + `tabIndex=-1` (existing pattern, unchanged) — focus/clicks/AT cannot reach it. Focus
  returns to the collapsed logo (existing `pendingLogoFocus`, unchanged).
- **Surface busy semantics (FR-012):** `SurfaceSpinner` is `role="status"` with
  `aria-live="polite"` and `aria-busy="true"`, and contains the visible "Generating…" text
  — so a screen reader announces generation starting. When the surface lands (or errors),
  the spinner unmounts and the new content (surface or `role="alert"` error) takes its place;
  the live region's removal + the new content announce the transition. The panel's
  `role="tabpanel"` is the container; the status node sits inside it.
- **Reduced motion:** composer = instant swap (no scale/fade/blur tween); spinner = static
  sparkle + label. Busy/idle transition remains perceivable to AT (the `role="status"`
  node appears then disappears regardless of motion preference).
- **Contrast:** "Generating…" `--muted-foreground` (`#888`) on the panel body `--card`
  (`#1b1b1c`/`#1e1e1e`) — the same pairing already used for every idle placeholder, AA for
  this 13px non-essential-redundant label (the sparkle co-signals). The sparkle's pastel
  gradient on the dark body is high-contrast and decorative.
- **Per-tab scoping (FR-008):** the gate reads the **active** tab's record, so switching to
  a non-in-flight tab hides the spinner and switching back to a still-in-flight tab re-shows
  it automatically (no spinner state of its own — it's a pure function of tab state).

---

## 7. Developer build-wiring to-dos (flagged for the no-Bash designer → developer)

1. **Create `src/renderer/CosmosSpinner.tsx`** — inline the artwork from
   `assets/images/cosmos-spinner.svg` (paths/transforms verbatim), swap `id="ps"`→`useId()`,
   swap literal hex stops → `var(--brand-pink)`/`var(--brand-purple)`, swap classes
   `fl/sA/sB`→`cosmos-spinner-orbit/sparkA/sparkB`, drop the inline `<style>`.
2. **Add the three `@keyframes` + classes to `src/renderer/index.css`** (§5.2), behind
   `@media (prefers-reduced-motion: no-preference)` for the `animation` rules. (Designer
   owns `index.css` and may author this directly; flagged here for visibility.)
3. **Create `src/renderer/SurfaceSpinner.tsx`** (§2 layout).
4. **No Vite/asset-import wiring** — `cosmos-spinner.svg` stays an artifact, not imported.
   Nothing added to `electron.vite.config.ts`. (Explicitly: this is the wiring we avoid by
   inlining.)
5. **No CSP change** — inlined SVG + theme-var fills are already permitted (same as
   `CosmosMark`); `img-src` is untouched.
6. `npm run typecheck` + `npm test` after wiring (the pure `surfaceSpinnerVisible` predicate
   is the only node-testable unit, per plan Phase 2).

---

## 8. Open questions

- **OQ-D1 (resolved, confirm):** Logo bloom delay on submit — design removes the
  collapsed-branch `delay-150` unconditionally (§3) so the logo is present immediately as
  the composer grows away. If the team wants to keep the delayed bloom for Esc/click-outside
  dismiss only, that needs a collapse-reason distinction in the class set — flagged as a
  possible follow-up, not built here.
- **OQ-D2 (designer→developer, non-blocking):** `scale-[1.04]` + `blur-[2px]` are the
  approved target values; if in-app the 4% grow reads as too subtle next to the 400ms fade,
  nudge to `scale-[1.06]` (still within-panel). Either is acceptable; pick by eye during
  implementation. Not a blocker.

No blocking unknowns — the design is buildable as specified.
