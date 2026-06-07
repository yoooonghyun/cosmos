# Plan: Sidebar Surface Switch — v1

**Status**: Draft
**Created**: 2026-06-05
**Last updated**: 2026-06-05
**Spec**: .sdd/specs/sidebar-surface-switch-v1.md

---

## Summary

Convert the app shell's left icon rail from a "pinned Terminal + one auxiliary panel" split
into a single-surface switcher: clicking a rail icon shows exactly one surface filling the
whole main content area. The Terminal moves out of the always-visible `div.app__terminal` and
becomes a fifth rail surface (`'terminal'`), rendered as its own `forceMount` `TabsContent`
alongside the existing four. The change is renderer-only and reuses the established
Radix vertical `Tabs` + `forceMount` + `data-[state=inactive]:hidden` idiom for ALL five
surfaces, so every surface stays mounted (preserving the live PTY and any pending A2UI
surface) and only visibility toggles on switch. App.css collapses the 60/40 split into a
single full-bleed flex region.

## Technical Context

| Item              | Value                                                                                  |
|-------------------|----------------------------------------------------------------------------------------|
| Language          | TypeScript + React 19 (renderer)                                                       |
| Key dependencies  | `@/components/ui/tabs` (Radix), `@/components/ui/tooltip`, `lucide-react` (add Terminal/SquareTerminal icon); no new deps |
| Files to create   | none                                                                                    |
| Files to modify   | `src/renderer/App.tsx`, `src/renderer/App.css`                                          |
| Out of scope      | main process, preload, IPC, MCP, shared; no new dependencies; no persistence; no resizable/multi-pane |

### Approach detail

- **SurfaceId** (`App.tsx`): extend the union to `'terminal' | 'generated-ui' | 'slack' | 'jira' | 'confluence'`.
- **RAIL_ITEMS** (`App.tsx`): prepend `{ id: 'terminal', label: 'Terminal', Icon: <terminal icon> }`
  so the rail order is Terminal, Generated UI, Slack, Jira, Confluence. Import the icon from
  `lucide-react` (`SquareTerminal` recommended for visual consistency with `SquareKanban`; `Terminal`
  acceptable). The rail `.map` already renders tooltip + `aria-label` + active indicator per item, so
  Terminal inherits all of it for free.
- **Default state** (`App.tsx`): `useState<SurfaceId>('terminal')` (was `'generated-ui'`) — FR-007.
- **Terminal becomes a TabsContent** (`App.tsx`): remove the standalone
  `<div className="app__terminal"><TerminalPanel /></div>` and instead render the Terminal as the
  first `TabsContent`:
  `<TabsContent value="terminal" forceMount className="app__ui data-[state=inactive]:hidden"><TerminalPanel /></TabsContent>`.
  Keep the existing four `TabsContent` blocks unchanged in structure. All five now use the same
  `forceMount` + hidden idiom — FR-008..FR-011.
- **Single full-bleed region** (`App.css`): the main area now holds the rail + exactly one visible
  surface. Drop the 60/40 split: `.app__terminal` (the always-visible 60% pane) is removed, and
  `.app__ui` changes from `flex: 1 1 40%` / `min-width: 320px` to a full-bleed
  `flex: 1 1 auto; min-width: 0;` so the active surface fills the whole region. Keep `min-height: 0`
  and `display: flex`. The `[data-state='active']` / `data-[state=inactive]:hidden` visibility
  toggling is unchanged. `.app__body` stays a flex row (rail | surface).
- **Preserve**: rail tooltips + `aria-label`s (FR-012), Radix vertical keyboard nav (FR-013),
  active indicator bar styling on `TabsTrigger` (FR-014). None of these markup pieces are touched
  except adding one more `RAIL_ITEMS` entry.
- **Component-doc comment** (`App.tsx`): update the top-of-file JSDoc that currently says
  "Terminal (center) | right column" to describe the single-surface switcher, so the file's own
  documentation does not drift.

### Verification note

`TerminalPanel.tsx` is NOT modified. It already keeps its xterm.js instance and PTY subscription
for its mounted lifetime; because it now lives in a `forceMount` `TabsContent` that is only ever
hidden (never unmounted) on switch, the live session and scrollback persist — FR-009 / SC-003.
Likewise `GeneratedUiPanel.tsx` is unchanged and keeps receiving `ui:render` while hidden — FR-010 / SC-004.

---

## Implementation Checklist

> Renderer-only layout change. No interface/types phase beyond extending one union; no new tests
> are strictly required, but a smoke check of the five-surface switch is the acceptance gate.

### Phase 1 — Interface / types

- [ ] Read `.sdd/specs/sidebar-surface-switch-v1.md` and confirm no open questions remain
- [ ] Extend `SurfaceId` in `App.tsx` to include `'terminal'` (first in the union)
- [ ] Confirm no other module references `SurfaceId` that would need updating (renderer-local type)

### Phase 2 — Implementation (`App.tsx`)

- [ ] Import a terminal icon from `lucide-react` (`SquareTerminal` recommended)
- [ ] Prepend `{ id: 'terminal', label: 'Terminal', Icon: SquareTerminal }` to `RAIL_ITEMS` (order: Terminal, Generated UI, Slack, Jira, Confluence)
- [ ] Change the default surface to `useState<SurfaceId>('terminal')`
- [ ] Remove the standalone `<div className="app__terminal"><TerminalPanel /></div>`
- [ ] Add a `<TabsContent value="terminal" forceMount className="app__ui data-[state=inactive]:hidden"><TerminalPanel /></TabsContent>` as the first content block
- [ ] Leave the existing generated-ui / slack / jira / confluence `TabsContent` blocks intact (all five use forceMount + hidden)
- [ ] Update the top-of-file JSDoc to describe the single-surface switcher (no "center Terminal + right column")

### Phase 3 — Styles (`App.css`)

- [ ] Remove the `.app__terminal` rule (no longer an always-visible 60% pane)
- [ ] Change `.app__ui` to full-bleed: `flex: 1 1 auto; min-width: 0;` (drop `40%` and `min-width: 320px`), keep `min-height: 0; display: flex;`
- [ ] Confirm `.app__body` remains a flex row (rail | single surface) and `.app__ui[data-state='active']` still resolves to `display: flex`

### Phase 4 — Verification

- [ ] `npm run typecheck` passes (node + web)
- [ ] `npm run dev`: launch shows Terminal full-width by default (SC-001)
- [ ] Click each of the five rail icons → only that surface shows, full-width (SC-002)
- [ ] Start a `claude` session in Terminal, switch away and back → same session + scrollback intact (SC-003)
- [ ] Trigger a render_ui while on a non-Generated-UI surface, then open Generated UI → pending surface is shown (SC-004)
- [ ] Each rail item (incl. Terminal) has tooltip + `aria-label`; arrow-key nav works (SC-006)

### Phase 5 — Docs

- [ ] Update this plan's Deviations section with anything that differed
- [ ] **Flag for wrap-up (do NOT edit now):** `docs/ARCHITECTURE.md` §3 (the ASCII diagram showing
      "Terminal Panel" and "Generated-UI Panel" side by side) and §4.2 (Terminal Panel) describe the
      old shell layout where the Terminal sits permanently beside the UI panel. After this ships, the
      shell is a single-surface switcher (Terminal is one of five rail surfaces, exactly one visible).
      The wrap-up step should reconcile those descriptions with the new layout.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-05 — Visibility toggle moved into unlayered CSS (root-cause fix).** The plan's
  `data-[state=inactive]:hidden` Tailwind class did NOT hide inactive panels: Tailwind v4 emits
  utilities into `@layer utilities`, and the unlayered `.app__ui { display: flex }` in `App.css`
  beats any layered utility regardless of specificity, so all panels stayed visible and switching
  appeared broken (this latent bug predated the feature). Fixed by adding
  `.app__ui[data-state='inactive'] { display: none }` in `App.css` (unlayered). Recorded as a
  CLAUDE.md gotcha + agentmemory.
- **2026-06-05 — `.app__ui` set to `flex-direction: column`.** With the region as a flex *row*, the
  panel surfaces (Slack/Jira/Confluence/Generated UI) — which have no `flex-grow` of their own —
  only took content width, so the surface didn't fill horizontally (only Terminal, which has
  `flex: 1 1 auto`, did). Switching `.app__ui` to a column makes all surfaces fill full width via
  cross-axis stretch while still filling height.
- **2026-06-05 — Rail trigger centering override.** shadcn `TabsTrigger` base applies
  `group-data-[orientation=vertical]/tabs:justify-start` + `:w-full`; the unprefixed `justify-center`
  couldn't override it. Added `group-data-[orientation=vertical]/tabs:justify-center` + `:w-10` in
  `App.tsx` to center the rail icons. Recorded as a CLAUDE.md gotcha + agentmemory.
