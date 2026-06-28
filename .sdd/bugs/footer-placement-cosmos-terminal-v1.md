# Bug: Footer placement — Cosmos footer above composer; Terminal UI invades footer

ID: `footer-placement-cosmos-terminal-v1`
Status: In progress
Skill: bugfix
Reported: 2026-06-28

## Symptom (user)

1. Cosmos panel: the footer sits ABOVE the chat-input (docked composer); it should be BELOW it.
2. Terminal panel: the terminal UI (xterm) invades / overlaps the footer.

## Root cause

1. **Cosmos footer order.** The surface column (`App.tsx`, `flex flex-col`) is
   `[active panel app__ui flex-1][SharedComposer shrink-0]`. The Cosmos `PanelFooter` was added
   INSIDE `CosmosPanel`'s `<section>` (its last child, `CosmosPanel.tsx:243`), while the docked
   Open-Prompt composer is the SEPARATE `SharedComposer` column child rendered AFTER the panel.
   So top→bottom = timeline → footer → composer ⇒ footer is above the composer. To put the footer
   below the composer it must be a column child AFTER `SharedComposer`.
2. **Terminal xterm spill.** `.terminal-panel__xterm` (`TerminalPanel.css`) is `flex:1 1 auto;
   min-height:0` with NO `overflow: hidden`. xterm renders its screen/viewport as
   `position: absolute` boxes sized by rows×lineHeight; when the fit lags a height change the
   screen overflows its container and, unclipped, paints over the `shrink-0` `PanelFooter` below
   it in flow.

## Fix

1. Move the Cosmos footer OUT of `CosmosPanel` and render it in `SharedComposer`'s `docked`
   branch BELOW the composer band, so it is the LAST column child (timeline → composer → footer).
   `SharedComposer` already reads the active surface's `config.busy` (the generating signal), so
   the footer keeps its in-flight spinner without cross-component status threading. Carry
   `border-l border-border` so the panel's left border continues to the bottom edge.
2. Add `overflow: hidden` to `.terminal-panel__xterm` so the xterm screen is clipped to its
   container and can never paint over the footer (defensive + correct for an xterm host).

## Classification

Implementation/layout defect → handled inline (contained renderer layout, root cause known).

## Regression test

jsdom/visual: assert the Cosmos surface column order is timeline → composer → footer (composer
precedes footer in DOM). Node-unit for any pure helper. Terminal clip is CSS (visual). Update
`docs/TEST-SCENARIOS.md`.

## Resolution (2026-06-28)

1. `CosmosPanel.tsx`: removed the in-section `PanelFooter` + `footerTab` + the now-unused
   `PanelFooter`/`SURFACE_ICON` imports. `App.tsx` `SharedComposer` docked branch now returns a
   fragment `[composer band][PanelFooter]` (footer wrapped in `border-l border-border`), with the
   footer status from `config.busy`. Column order is now timeline → composer → footer.
2. `TerminalPanel.css`: `.terminal-panel__xterm` gains `overflow: hidden`.

Verified: typecheck clean, unit **2573**, dom **26** green. The Cosmos order is structurally
guaranteed by the fragment (composer band precedes footer in the SAME `SharedComposer` return).
NOT exercised in the live app — the cosmos column + the terminal xterm clip need a `npm run dev`
eyeball (xterm doesn't render in jsdom/harness); logic + structure verified.

Status: Fixed (pending a live-dev visual confirm).

## Verification

`npm run typecheck`, `npm test`, `npm run test:dom` green; DOM order structurally guaranteed;
terminal clip is CSS — confirm in `npm run dev`.
