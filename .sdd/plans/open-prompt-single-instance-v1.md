# Plan: Open-Prompt Single App-Root Instance — v1

**Status**: Draft
**Created**: 2026-06-23
**Last updated**: 2026-06-23
**Spec**: .sdd/specs/open-prompt-single-instance-v1.md

---

## Grounding

> Same direct investigation as the spec's Grounding section (architect ran codegraph_explore on `PromptComposer`/`OpenPromptPositionProvider`/`App`/`useGenerativePanelTabs`, Grep on `<PromptComposer`, and memory_recall/memory_smart_search on the flicker + composer config — no prior stored decisions). Key facts that shape the plan:
> - The shared draggable position is ALREADY app-root (`OpenPromptPositionProvider`, App.tsx:88) — only the COMPOSER mount is per-panel.
> - `PromptComposer` derives its position box from `rootRef.current?.closest('section')`; this is the ONE coupling that must change when it leaves the panel subtree.
> - 5 call sites pass `{onSubmit, placeholder, ariaLabel, contextChip?, busy}`; Generated UI omits `contextChip`; none pass `collapsedAriaLabel` today (it defaults to "Open prompt").

---

## Summary

Render the Open-Prompt composer ONCE at the app root. Introduce a small renderer-only
**active-composer registry** (a React context co-located with — or beside —
`OpenPromptPositionProvider`): the currently-active panel publishes its composer config
`{onSubmit, placeholder, ariaLabel, collapsedAriaLabel?, contextChip?, busy}` plus the
element that bounds positioning (its content `<section>` ref), and clears it when inactive
or when its own composer-visibility gate is false. A single `PromptComposer` mounted next
to `AppShell` reads the active registration: when present it renders against the published
config and measures the published element for its position box; when absent it renders
nothing. The 5 per-panel `<PromptComposer>` mounts are removed and replaced by a publish
effect. `PromptComposer` is refactored to take its position-box element from a prop/registry
value instead of `closest('section')`, leaving ALL drag/ease/spinner/draft logic intact.
Renderer-only; no IPC, MCP, or main change.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript + React (renderer only) |
| Key dependencies  | Existing `OpenPromptPositionProvider`, `useGenerativePanelTabs`, `viewContextCapture.ts`, `promptComposerLogic.ts`, Radix `Tabs` in `App.tsx`. No new deps. |
| Files to create   | `src/renderer/OpenPromptRegistry.tsx` (active-composer config context + provider + `useOpenPromptRegistration`/`useActiveOpenPrompt` hooks); optional `src/renderer/openPromptRegistry.ts` if any pure helper emerges. |
| Files to modify   | `src/renderer/App.tsx`, `src/renderer/PromptComposer.tsx`, `src/renderer/GeneratedUiPanel.tsx`, `src/renderer/SlackPanel.tsx`, `src/renderer/JiraPanel.tsx`, `src/renderer/ConfluencePanel.tsx`, `src/renderer/GoogleCalendarPanel.tsx`. Docs: `docs/ARCHITECTURE.md` §4.4, `docs/PROJECT-STRUCTURE.md`. |

---

## Design decisions (resolving spec OQs)

1. **Config publication (spec OQ via registry).** A new `OpenPromptRegistry` context holds
   `registration: OpenPromptRegistration | null`. The active panel calls
   `useOpenPromptRegistration(config | null)` in an effect: it sets the context value when
   the panel is active AND its composer gate is true, and sets `null` otherwise (and on
   unmount). Only ONE panel is active at a time (`AppShell.surface`), so only one panel ever
   publishes a non-null config. Pass the active `surface` id into the panels (they already
   receive `active`) so a panel publishes only while `active`. Config is read through refs
   inside the single `PromptComposer`'s `submit` so the latest `onSubmit`/`contextChip` apply
   at send time (matches the existing `getViewContextRef` pattern in `useGenerativePanelTabs`).
2. **Active panel rect (spec OQ-2 → option a).** The registration carries the panel's
   content-box element: `hostRef: React.RefObject<HTMLElement>` (the panel's `<section>`).
   `PromptComposer` measures `registration.hostRef.current` with the SAME ResizeObserver +
   `window` resize/scroll listeners it uses today, replacing `rootRef.current?.closest('section')`.
   When `hostRef.current` is null/0 it falls back to the 0-box (as today) — but because the
   active panel is always visible, the box is non-zero, so there is no hidden-panel 0-box and
   thus no flicker.
3. **Single global draft (spec OQ-1 → recommended default).** Keep `value`/`expanded`/
   `sentHint`/`contextDismiss` as the single instance's local state — one global draft. No
   per-surface draft map. (If the product later wants per-panel drafts, the registry would key
   draft state by surface id; out of scope here.)
4. **No regressions.** All drag/ease/re-grab/spinner/launch/error-ring logic stays inside
   `PromptComposer`; only the position-box SOURCE changes (prop/registry element instead of
   `closest('section')`) and the config SOURCE changes (registry instead of props). The
   `agent:onStatus` error-ring subscription, `composerInteractiveAfterSubmit`, and
   `surfaceSpinnerVisible` gating are untouched.

## Migration risk (6→1 call sites)

The 5 per-panel mounts each carry distinct `placeholder`/`ariaLabel`/`contextChip`/`busy`
and a per-panel visibility gate. The risk is losing a panel's distinct config or its gate
condition. Mitigation: the publish effect in each panel moves the EXACT same config object
and the SAME gate condition that currently wraps `<PromptComposer>` — when the gate is true
publish the config, else publish `null`. A per-panel checklist item below verifies each
mapping. Generated UI publishes without `contextChip`; the other four include `contextChip`.
None set `collapsedAriaLabel` today (default retained).

---

## Implementation Checklist

### Phase 1 — Interface

- [ ] Read spec; confirm OQ-1/OQ-2/OQ-3 defaults are accepted (single global draft; publish host ref; Terminal excluded). Stop if the product wants per-panel drafts.
- [ ] Define `OpenPromptRegistration` type in `OpenPromptRegistry.tsx`: `{ onSubmit, placeholder, ariaLabel, collapsedAriaLabel?, contextChip?, busy, hostRef }`. Field names/shapes MUST match the existing `PromptComposerProps` (do not invent fields). `onSubmit` keeps the `(utterance, options?: { contextDismiss }) => void` signature.
- [ ] Add `OpenPromptRegistryProvider` + `useActiveOpenPrompt()` (read current registration) + `useOpenPromptRegistration(reg | null)` (publish/clear via effect, with refs so identity churn does not thrash). Review types vs spec — no invented properties.

### Phase 2 — Testing

- [ ] If any pure helper is extracted (e.g. "should the single instance render?" = `registration != null`), add it to `promptComposerLogic.ts` (or `openPromptRegistry.ts`) with `.test.ts` units following the `.ts`/`.test.ts` split. Test: null registration → no render; populated → render with that config.
- [ ] Confirm existing `promptComposerLogic.test.ts` (submit decision, `surfaceSpinnerVisible`, draft) and any draggable position-math tests still pass unchanged.
- [ ] Add a node-testable assertion that a panel publishes `null` when its gate is false and the config object when true (extract the gate→config mapping into a pure function per panel only if it reduces risk; otherwise cover via the effect).

### Phase 3 — Implementation

- [ ] `PromptComposer.tsx`: replace the position-box source — accept the host element from the registry/prop instead of `rootRef.current?.closest('section')` (the `useLayoutEffect` at ~425 and `slotBox`/`panelRect` measurement). Read `{onSubmit, placeholder, ariaLabel, collapsedAriaLabel, contextChip, busy}` from `useActiveOpenPrompt()` instead of props (or keep props and have the app-root wrapper feed them from the registry — pick the lower-churn option). When no active registration, render nothing.
- [ ] `App.tsx`: mount `OpenPromptRegistryProvider` inside `OpenPromptPositionProvider` (around `AppShell`), and render the SINGLE `<PromptComposer>` as a sibling of the panel `Tabs` so it overlays the active panel's content area (positioned `fixed` against the published host rect, as today). Ensure z-order/overlay matches the prior per-panel overlay placement.
- [ ] `GeneratedUiPanel.tsx`: remove `<PromptComposer …>`; add a publish effect that registers `{onSubmit: submit, placeholder: "Describe the UI you want…", ariaLabel: "Compose generated UI", busy: showSpinner, hostRef: <section> ref}` while `active` AND the panel's existing composer-visibility condition holds, else `null`. Capture the `<section>` via a ref.
- [ ] `SlackPanel.tsx`: same, with `placeholder`/`ariaLabel` "…Slack…", `contextChip={contextChipFor('slack', slackViewContext(view, openThread))}`, `busy={showSpinner}`, gate = its current `connected`/composer condition.
- [ ] `JiraPanel.tsx`: same, `contextChip={contextChipFor('jira', jiraViewContext(detailIssueKey))}`, gate = current condition.
- [ ] `ConfluencePanel.tsx`: same, `contextChip={contextChipFor('confluence', confluenceViewContext(view, genUiPage))}`, gate = current condition.
- [ ] `GoogleCalendarPanel.tsx`: same, `contextChip={contextChipFor('google-calendar', calendarViewContext(genUiEvent))}`, gate = current condition.
- [ ] Confirm Terminal panel publishes nothing (it imports no composer; no change).
- [ ] Verify the publish effect uses the SAME gate condition that previously wrapped each `<PromptComposer>` (so visibility is byte-for-byte preserved), and re-publishes when `busy`/`contextChip` change (via deps or a ref-fed latest value read at send time).
- [ ] All tests pass; `npm run typecheck` (node + web) clean; `npm run dev` smoke: switch across all 5 panels and confirm zero flicker, correct placeholder/chip/busy per panel, and drag persists across panels.
- [ ] Reused shared utilities (`surfaceSpinnerVisible`, `contextChipFor`, `useOpenPromptPosition`) — no duplicated logic.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.4 "Shared collapsible prompt composer": note the composer is now a SINGLE app-root instance fed by an active-panel registry (panels publish `{onSubmit/placeholder/ariaLabel/contextChip/busy/hostRef}` instead of mounting it), positioned against the active panel's `<section>` rect; this is the no-flicker invariant.
- [ ] Update `docs/PROJECT-STRUCTURE.md` with `OpenPromptRegistry.tsx` (and any helper).
- [ ] Update this plan's Deviations with anything that differed.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-23**: Plan authored. Open spec questions resolved to defaults (single global draft; publish host ref for the active rect; Terminal excluded) — implementer should re-confirm OQ-1 with the product if per-panel drafts are ever expected, as the single global draft is a deliberate behavior change from today's per-panel drafts.
