# Bug: Cosmos panel footer gone + footer icons don't match sidebar icons

ID: `cosmos-footer-and-icon-unify-v1`
Status: In progress
Skill: bugfix
Reported: 2026-06-28

## Symptom

1. The Cosmos panel has NO footer (the bottom "panel name + status" strip every other rail
   panel shows). It disappeared.
2. Across panels, the FOOTER icon differs from that panel's SIDEBAR (rail) icon. User wants
   the footer unified to the sidebar icon.

## Classification

Design defect → `designer`. Visual inconsistency + a missing state strip; underlying logic fine.

## Root cause

1. **Cosmos footer:** `cosmos-open-prompt-pinned-v1` made the docked Open-Prompt composer the
   Cosmos bottom chrome and REMOVED the `PanelFooter` from `CosmosPanel.tsx` (see the comment
   at `CosmosPanel.tsx:225-230`). The other four panels + Terminal still render `PanelFooter`.
2. **Icon drift:** each panel passes an ad-hoc lucide icon to `PanelFooter`, NOT its rail icon:
   - terminal: footer `SquareTerminal` vs rail `ClaudeCodeIcon`
   - jira: footer `SquareKanban` vs rail `SiJira`
   - slack: footer `MessageSquare` vs rail `SiSlack`
   - confluence: footer `BookText` vs rail `SiConfluence`
   - calendar: footer `CalendarDays` vs rail `SiGooglecalendar`
   The rail icons are the `RAIL_ITEM` map in `App.tsx` (incl. custom `ClaudeCodeIcon` /
   `CosmosGlyphIcon` + react-icons `Si*`). Two independent icon choices that drifted.

## Fix (designer → developer verify)

1. **Single source of truth for surface icons:** extract the rail icon map out of `App.tsx`
   into a shared module (e.g. `src/renderer/app/surfaceIcons.tsx`) exporting
   `SURFACE_ICON: Record<SurfaceId, RailIcon>` (terminal/cosmos/slack/jira/confluence/
   google-calendar). `App.tsx` `RAIL_ITEM` consumes it; every `PanelFooter` call passes
   `icon={SURFACE_ICON[<surface>]}` instead of its lucide icon. Footer == rail by construction.
2. **Restore the Cosmos footer:** render `PanelFooter surfaceName="Cosmos"
   icon={SURFACE_ICON.cosmos}` at the bottom of the Cosmos `<section>` (status glyph from the
   in-flight `live.phase === 'generating'` — feed it an activeTab-shaped status or extend
   PanelFooter minimally). Decide placement relative to the App-level docked composer (the
   composer is `shrink-0` BELOW the section); footer goes at the section bottom so the panel
   regains parity. Keep the docked composer.

## Regression test

Node-unit: assert `SURFACE_ICON` covers every `SurfaceId` and that each panel footer uses it
(class/identity check where node-testable). jsdom/visual for the rendered Cosmos footer
presence. Update `docs/TEST-SCENARIOS.md`.

## Designer resolution (cosmos-footer-and-icon-unify-v1)

- **Single source of truth:** `src/renderer/app/surfaceIcons.tsx` exports `RailIcon` (type),
  `ClaudeCodeIcon`, `CosmosGlyphIcon`, and `SURFACE_ICON: Record<SurfaceId, RailIcon>`
  (terminal/cosmos/slack/jira/confluence/google-calendar). `App.tsx` `RAIL_ITEM` consumes it
  (rail unchanged); every `PanelFooter` now passes `icon={SURFACE_ICON[<surface>]}`.
- **Footer placement (decision):** the restored Cosmos `PanelFooter` sits at the BOTTOM of the
  Cosmos `<section>` — AFTER the `flex-1 overflow-auto` timeline div (so the strip is pinned
  `shrink-0` directly below the conversation) and ABOVE the App-level docked Open-Prompt composer
  band (a separate `shrink-0` child rendered by `SharedComposer` below this section). The docked
  composer is kept. Order top→bottom: tabstrip → timeline (flex-1) → PanelFooter → [docked composer].
- **Status glyph:** no PanelFooter API change. Fed a minimal `PanelTab`-shaped `footerTab`
  (`{ id, label: 'Cosmos', status: showSpinner ? 'in-flight' : 'idle' }`) where `showSpinner ===
  live?.phase === 'generating'`, so the footer shows the in-flight spinner while generating, else
  the `SURFACE_ICON.cosmos` glyph.
- **Lucide imports kept (deviation from "remove unused"):** Jira/Slack/Confluence/Calendar still
  USE their lucide icon elsewhere (panel empty-states / list headers), so only the footer `icon=`
  prop changed; the lucide imports remain live and are NOT removed. Terminal was already on
  `SURFACE_ICON.terminal`.
- **DESIGN.md:** added registry rule **D-10** ("rail surface icon has one source of truth =
  `SURFACE_ICON`; footer == rail; Cosmos keeps its footer for parity").

Status: fixed (pending main-session typecheck/test/test:dom).

## Verification

`npm run typecheck`, `npm test`, `npm run test:dom`; spot-check panels + Cosmos footer in dev.
