# Plan: Cosmos Panel-Tab List — v1

**Status**: Draft
**Created**: 2026-06-28
**Last updated**: 2026-06-28
**Spec**: `.sdd/specs/cosmos-panel-tab-list-v1.md`

---

## Summary

Add a resizable split to the Cosmos panel — conversation timeline LEFT, a read-only panel-tab
tree RIGHT — that surveys the live open tabs of the four generative panels (Slack, Jira,
Confluence, Google Calendar) plus the Terminal panel, grouped by panel. Clicking a tab row does
not navigate; it selects that panel + tab as the **one-shot context for the next Cosmos prompt**,
shown in the composer's context chip and embedded in the existing `<cosmos:context>` marker. The
crux — how the Cosmos panel reads every panel's *current* tabs without reaching into their
internals and without the lossy persistence snapshot — is solved with a **new renderer-root
publish/subscribe context, `PanelTabsProvider`**, modeled exactly on the existing
`ActiveComposerProvider` (ref-backed registry + a `version` counter). Each panel publishes its
FULL live tab list (panel id + each tab's id/label + active id, all non-secret); the Cosmos tree
subscribes and re-reads on every publish. Layout reuses the bespoke `ResizeDivider`; the tree
reuses `FileTree`'s roving-tabindex ARIA-tree keymap; the click→context path reuses
`PromptContext` / `buildAgentSubmitWithMarker` / `ActiveComposerProvider` / the composer
`ContextChip`.

## Chosen cross-panel-read mechanism + why (the crux)

**Decision: (b) a new publish/subscribe context — `PanelTabsProvider` — NOT (a) extending
`SessionRegistry`.**

`SessionRegistry` is the wrong vehicle on every axis the spec calls out:

- **Lossy vs. full live list.** The registry holds each panel's *persistence* contribution, built
  by `buildGenerativePanel`/`buildGenerativeTab`, which deliberately keep only composed surfaces
  ("strips the rest"). The tree needs EVERY open tab (spec FR-008). Reusing the registry would
  force either changing persistence semantics (risky — it governs session-restore invariants) or
  bolting a second, parallel contribution onto the save coordinator.
- **Reactivity.** `SessionRegistry` is framework-free, write-only, and **trailing-debounced at
  600 ms** for SAVE; it exposes no subscribe/emit. A live UI read off it would lag a tab open/close
  by up to the debounce window and require inventing an observable layer on a class whose single
  responsibility is debounced persistence.
- **Architectural seam.** The codebase already separates concerns: `SessionRegistry` =
  persistence; `ActiveComposerProvider` = live cross-panel composer routing. A live cross-panel
  *tab-list* read is the same kind of concern as the composer registry, so it belongs in a sibling
  provider, not folded into persistence.

Mechanism (b) satisfies every constraint cleanly: **reactive** (version-counter re-read, immediate,
no debounce), **full live list** (publishes the panel hook's own `tabs`, not the persisted subset),
**non-secret** (publishes only `{ id, label }` per tab + `activeTabId` — display fields already on
screen), **no reach-in** (panels PUSH; the tree never reads panel internals), **Terminal included**
(the Terminal panel publishes alongside the four generative panels through the same hook). It mirrors
a pattern the team already maintains, so it adds no novel infrastructure.

### Contract — what each panel publishes, how the tree subscribes

New module `src/renderer/panelTabs/` (mirrors `composer/ActiveComposerProvider.tsx` +
`composer/activeComposer.ts`):

- **Live shape** (`panelTabs.ts`, pure):
  ```
  type CrossPanelId = Exclude<SurfaceId, 'cosmos'>   // 'terminal'|'slack'|'jira'|'confluence'|'google-calendar'
  interface LivePanelTabs { tabs: { id: string; label: string }[]; activeTabId: string | null }
  type PanelTabsRegistry = Partial<Record<CrossPanelId, LivePanelTabs | null>>
  ```
- **Provider** (`PanelTabsProvider.tsx`): `registryRef: PanelTabsRegistry` + `version` state;
  `publish(panelId, snapshot | null)` swaps the entry and bumps `version` (exactly
  `ActiveComposerProvider.publish`). Mounted at App root, INSIDE `SessionProvider`, wrapping
  `AppShell` so it wraps BOTH publishers (the panels) and the consumer (CosmosPanel).
- **Publish hook** `usePublishPanelTabs(panelId, snapshot)`: an effect that publishes the memoized
  snapshot on change and publishes `null` on unmount (mirrors `usePublishComposer`). Callers pass a
  `useMemo`'d `{ tabs, activeTabId }` so a tab-state change re-publishes but a re-render does not.
  - **Generative panels (one site covers all four):** call it inside `useGenerativePanelTabs` —
    it already holds `tabs` (the FULL live list with `{id, label}`) + `activeTabId` + `target`
    (which for these four equals the `CrossPanelId`). Publish
    `{ tabs: tabs.map(t => ({ id: t.id, label: t.label })), activeTabId }`. NOT
    `buildGenerativePanel` (that is the lossy persistence path).
  - **Terminal:** `TerminalPanel` calls `usePublishPanelTabs('terminal', { tabs: tabs.map(...), activeTabId })`
    from its existing `tabs`/`activeTabId`.
- **Subscribe + shape** (pure `panelTabsTree.ts` + `useAllPanelTabs()`):
  `useAllPanelTabs()` reads `registryRef.current` keyed on `version` and feeds the pure
  `toPanelTabGroups(registry, { order, labels })` which returns ordered groups
  `{ panelId, label, tabs, activeTabId }[]` — fixed panel order, `RAIL_LABEL` labels, a panel that
  has not published (unmounted / disabled / disconnected) is ABSENT (FR-006), a published panel with
  zero tabs yields an empty group (FR-020). Pure ⇒ node-testable.

## Click → context selection wiring

State lives **locally in `CosmosPanel`** (the tree and the cosmos composer config both live there —
no new provider field needed):

- `const [selectedContext, setSelectedContext] = useState<PromptContext | null>(null)` + a
  `selectedContextRef` mirror for stale-free reads at submit.
- Tree `onActivate(panelId, tab)` → `setSelectedContext({ panel: { id, label }, tab: { id, label } })`
  (panel + tab only — no dock, spec FR-018). Re-selecting **replaces** (FR-016).
- The Cosmos `ComposerConfig` (already published via `usePublishComposer('cosmos', …)`) gains:
  - `contextChip`: a chip descriptor derived from `selectedContext` (see design note below).
  - `onSubmit`: builds the captured `PromptContext` from `selectedContextRef.current` when set
    (else the existing cosmos-panel default), feeds it to `buildAgentSubmitWithMarker(utterance,
    'generated-ui', ctx)` + `recordSubmitContext(ctx)` + the live seed — UNCHANGED machinery — then
    **clears** `setSelectedContext(null)` (one-shot, OQ-2 resolved). A `contextDismiss: 'all'` from
    the chip `×` also clears it. The wire target stays `'generated-ui'`.
- **Graceful close/rename (FR-017):** a pure `reconcileSelectedContext(selected, groups)` runs
  against `useAllPanelTabs()` — if the selected tab id is gone → clear; if its label changed →
  update. Reconciled in a `useEffect` on the groups so a closed/renamed selected tab never embeds a
  stale context. Pure ⇒ node-testable.

**Design note (chip representation).** `ContextChipData.primary.kind` is item-oriented
(`jira | slack-channel | confluence | calendar`) and cannot express a generic "panel + tab"
selection. The selection chip needs either a small additive `kind` (e.g. a panel+tab variant) or a
parallel descriptor. This is a **design-step** concern (the tree rows, group headers, empty states,
and the panel+tab chip treatment) — see "Design step" below; the interface step extends
`ContextChipData`/`contextChipIcons` accordingly.

## Terminal-as-context decision (needs confirmation — see Open Items)

The spec scopes the tree to include Terminal, and the click action attaches the row as context.
But `PromptPanelId` / the marker's `PANEL_IDS` whitelist
(`promptContextMarker.ts`) is `{cosmos, slack, jira, confluence, google-calendar}` — **'terminal'
is excluded**, so a terminal-tab `PromptContext` currently serializes to `''` (no marker) and is
rejected by `validatePromptContext`: clicking a terminal row would silently do nothing on submit.

Two clean options (defaulting to T1, but it touches the shipped prompt-context contract — flagged
for confirmation):

- **T1 (recommended, additive contract change):** extend `PromptPanelId` += `'terminal'`,
  `PANEL_IDS` += `'terminal'`, `DOCK_KIND_BY_PANEL.terminal = null`, and the chip glyph/noun maps.
  Terminal tabs become selectable as panel+tab context (no dock — terminal never had one, fully
  consistent with v1's panel+tab-only model). Updates `promptContextMarker.test.ts` +
  `conversation.validate` tests. The sandbox `CLAUDE.md` panel list gains terminal (benign).
- **T2 (no contract change):** Terminal tabs are SHOWN (survey) but NOT context-selectable in v1 —
  the tree marks terminal rows non-interactive; only the four generative panels' tabs set context.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (renderer React + pure node-testable modules) |
| Key dependencies  | Existing only — `ResizeDivider`, `FileTree` keymap idiom, `PromptContext` / `buildAgentSubmitWithMarker` / `promptContextMarker`, `ActiveComposerProvider` (`usePublishComposer` / `useRecordSubmitContext`), `ComposerConfig.contextChip`, `ContextChip` / `ContextChipData` / `contextChipIcons`, `RAIL_LABEL` / `SurfaceId`. No new npm packages, no new MCP server, no new IPC channel, no preload change. |
| Files to create   | `src/renderer/panelTabs/panelTabs.ts` (shape + types), `src/renderer/panelTabs/panelTabsTree.ts` (pure `toPanelTabGroups` + `reconcileSelectedContext`) + `.test.ts`, `src/renderer/panelTabs/PanelTabsProvider.tsx`, `src/renderer/panelTabs/index.ts`, `src/renderer/cosmos/PanelTabTree.tsx` (the right-column tree, `FileTree`-style keymap) + `PanelTabTree.dom.test.tsx`, `src/renderer/cosmos/cosmosSelectedContext.ts` (selection→chip mapping, pure) + `.test.ts`, `src/renderer/cosmos/CosmosPanelTabList.dom.test.tsx` (split + click→context). |
| Files to modify   | `src/renderer/cosmos/CosmosPanel.tsx` (split layout + tree + selection state + chip + one-shot submit), `src/renderer/tabs/useGenerativePanelTabs.ts` (publish full live tabs), `src/renderer/terminal/TerminalPanel.tsx` (publish terminal tabs), `src/renderer/App.tsx` (mount `PanelTabsProvider`), `src/renderer/app/viewContextCapture.ts` + `src/renderer/app/contextChipIcons.ts` (panel+tab chip kind), and — if **T1** — `src/shared/promptContext/promptContext.ts` + `src/shared/promptContext/promptContextMarker.ts` (+ their tests) + the sandbox `CLAUDE.md` provisioning string. `docs/ARCHITECTURE.md` (cross-panel-read seam note). |
| Layers touched    | (1) renderer split/tree (jsdom-tested), (2) new shared renderer store/contract `panelTabs` (node-unit-tested pure logic + jsdom provider), (3) composer context wiring + selection (jsdom + pure node-unit). |

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation.

### Phase 0 — Confirm decisions (before code)

- [ ] Confirm **Terminal-as-context** (T1 extend `PromptPanelId` vs T2 show-only). Default T1.
- [ ] Confirm a **design step** runs for the tree visuals + the panel+tab chip treatment (this is a
  UI-bearing feature; CLAUDE.md workflow adds `design` between plan and interface).

### Phase 1 — Cross-panel read contract (shared renderer store)

- [ ] `panelTabs.ts`: `CrossPanelId`, `LivePanelTabs`, `PanelTabsRegistry` types (non-secret: id +
  label + activeTabId only).
- [ ] `PanelTabsProvider.tsx`: ref-backed registry + `version`, `publish`, `usePublishPanelTabs`,
  `useAllPanelTabs` — modeled on `ActiveComposerProvider`.
- [ ] `panelTabsTree.ts` (pure): `toPanelTabGroups(registry, order, labels)` (ordered groups, absent
  unpublished panels, empty groups for zero-tab panels) + `reconcileSelectedContext(selected, groups)`.
- [ ] `index.ts` barrel. Review types vs spec FR-008/FR-010/FR-011 — no secret fields, full live list.

### Phase 2 — Publishers

- [ ] `useGenerativePanelTabs.ts`: publish `{ tabs: tabs.map(id,label), activeTabId }` for `target`
  (the four generative ids) via `usePublishPanelTabs` — memoized; NOT `buildGenerativePanel`.
- [ ] `TerminalPanel.tsx`: publish `'terminal'` tabs via `usePublishPanelTabs`.
- [ ] `App.tsx`: mount `<PanelTabsProvider>` inside `SessionProvider`, wrapping `AppShell`.

### Phase 3 — Cosmos split + tree (renderer, jsdom)

- [ ] `CosmosPanel.tsx`: wrap the timeline region in a horizontal flex row — timeline LEFT,
  `ResizeDivider`, `PanelTabTree` RIGHT; keep the docked composer below, unchanged. Session-only
  width state (mirror Terminal `termWidth`; NOT persisted — OQ-1 resolved) with the same clamp idiom.
- [ ] `PanelTabTree.tsx`: `role="tree"` with `FileTree`'s roving-tabindex keymap (Arrow Up/Down +
  Home/End focus, Enter/Space activate, Arrow Right/Left expand/collapse group); group headers per
  in-scope panel; "No open tabs" per empty group (FR-020); single calm empty state when all empty
  (FR-021); skip malformed entries (FR-022).
- [ ] Tests: groups render + live update; empty/all-empty states; roving keymap; `onActivate` fires.

### Phase 4 — Click → context selection (composer wiring)

- [ ] `cosmosSelectedContext.ts` (pure): map a `PromptContext` panel+tab selection → chip descriptor.
- [ ] `CosmosPanel.tsx`: `selectedContext` state + ref; tree `onActivate` sets it (replace-on-
  reselect); publish `contextChip` in the cosmos `ComposerConfig`; `onSubmit` uses
  `selectedContextRef` → `buildAgentSubmitWithMarker` + `recordSubmitContext` + live seed, then
  one-shot clears; chip `×` (`contextDismiss: 'all'`) clears.
- [ ] Reconcile selection against `useAllPanelTabs()` (close → clear, rename → relabel) — FR-017.
- [ ] Tests (jsdom): click a row → cosmos chip shows panel+tab; submit → marker embeds panel+tab,
  target stays `generated-ui`, selection clears (one-shot); re-select replaces; close selected tab →
  chip clears; dismiss `×` → next submit carries no selection.

### Phase 5 — Terminal-as-context (only if T1)

- [ ] Extend `PromptPanelId` += `'terminal'`; `PANEL_IDS` += `'terminal'`;
  `DOCK_KIND_BY_PANEL.terminal = null`; chip glyph/noun maps add terminal.
- [ ] Update `promptContextMarker.test.ts` (panel-id whitelist) + `conversation.validate` tests.
- [ ] Add terminal to the sandbox `CLAUDE.md` panel list (FR-027 of prompt-context spec; benign).

### Phase 6 — Chip kind + design reconciliation

- [ ] Extend `ContextChipData` / `contextChipIcons` for the panel+tab selection kind (per the design
  spec). Keep non-secret. Ensure the timeline `PromptContextChip` still renders panel+tab turns.

### Phase 7 — Docs

- [ ] `docs/ARCHITECTURE.md`: note the new `PanelTabsProvider` live cross-panel-read seam (distinct
  from `SessionRegistry` persistence + `ActiveComposerProvider` routing) and refine the "no global
  cross-panel tab bar" wording to "no cross-panel NAVIGATION tab bar; the Cosmos panel hosts a
  READ-ONLY cross-panel tab list as a context-picker." (Started in this plan step — see edit.)
- [ ] `docs/PROJECT-STRUCTURE.md`: add `src/renderer/panelTabs/` + `PanelTabTree.tsx` (wrap-up).
- [ ] Update this plan with deviations; mark `TODO.md` (wrap-up).

---

## Test Layers

- **node-unit (vitest node):** `panelTabsTree.ts` (`toPanelTabGroups`, `reconcileSelectedContext`),
  `cosmosSelectedContext.ts`, and (T1) the `promptContextMarker` whitelist change.
- **jsdom (vitest dom):** `PanelTabsProvider` publish/subscribe, `PanelTabTree` (render + roving
  keymap + empty states), `CosmosPanel` split + click→chip→submit→one-shot-clear + reconcile.

---

## Deviations & Notes

- **2026-06-28**: Cross-panel read decided as a new `PanelTabsProvider` (publish/subscribe), NOT an
  observable `SessionRegistry` — persistence is lossy + debounced + write-only; live UI read is a
  separate seam, mirroring `ActiveComposerProvider`.
- **2026-06-29 (developer, Steps 3–5 implemented):**
  - **T1 taken** (Phase 0/5): `PromptPanelId` += `'terminal'`, `PANEL_IDS` + `DOCK_KIND_BY_PANEL`
    (`terminal: null`) extended, sandbox CLAUDE.md panel list gains terminal. Marker +
    `validatePromptContext` tests extended (terminal round-trip). `PromptContextChip` now also
    excludes `'terminal'` (besides `'cosmos'`) from the dock target — both have no dock.
  - **FR-006 sourced from rail visibility, not from publish-gating.** All panels are `forceMount`ed
    in App (even disabled integrations), so a disabled panel still publishes. The Cosmos tree filters
    the group `order` by `visibleSurfaceIds(enabled)` (reads `useEnabledIntegrations`) so a disabled
    integration is absent — exactly "matching rail visibility". CONSEQUENCE: `CosmosPanel` now has a
    hard dependency on `SessionProvider`; the 3 existing CosmosPanel dom tests were wrapped in
    `SessionProvider`+`PanelTabsProvider` (+ a `session.save` stub).
  - **`RAIL_LABEL` moved** from `App.tsx` into the pure `app/railVisibility.ts` (single label source
    reused by the rail + the tree group headers; avoids an App→CosmosPanel import cycle).
  - **`ResizeDivider` imported from its own module** (`fileExplorer/ResizeDivider`), NOT the
    `../fileExplorer` barrel — the barrel re-exports the Monaco-backed FileViewer which crashes jsdom.
  - **`ResizeObserver` no-op polyfill** added to `src/test-setup.dom.ts` so Radix `ScrollArea` renders
    under jsdom (the tree wraps its rows in `ScrollArea`).
  - **USER-DRIVEN UI changes (during implementation, override design spec — flagged for designer to
    reconcile DESIGN.md D-15):** (1) default split width matches the Terminal file-explorer dock
    (`flex 0 0 18%`, base `total*0.18`), NOT the design's 30%; (2) the active-source `--brand-accent`
    dot was REMOVED; (3) the persistent context-selected highlight (left bar + `bg-accent` +
    `font-medium` + `data-context-selected`) was REMOVED — the tree is now a pure picker, a click only
    reflects the selection into the composer chip; `aria-selected` is kept for a11y (no visual).
  - **One small composer fix:** the docked composer now resets `contextDismiss` to `'none'` after a
    submit (it returns early without the floating-path `collapse()` that used to reset it), so a NEXT
    panel+tab selection's chip is not suppressed by a prior `'all'` dismiss.
  - **BUG (docked composer never rendered the chip):** the docked `PromptComposer` render branch
    (the Cosmos composer) previously OMITTED the `ContextChip` entirely — so a tree-click selection
    had no visible affordance ("context에 들어가는 ui가 전혀 없음"). The docked branch now renders the SAME
    chip the floating composer does (between textarea + Send). Guarded by a new
    `PromptComposerDocked.dom.test.tsx` case.
  - **BUG (re-click after dismiss didn't register):** after the docked chip `×`, the composer-local
    `contextDismiss` stayed `'all'` (the docked composer never collapses, the floating reset path), so
    a re-selected tab's fresh chip was gated off. Fix: a DOCKED-only effect resets `contextDismiss`
    to `'none'` whenever the `contextChip` REFERENCE changes (CosmosPanel mints a fresh chip object on
    every tree click, even re-clicking the same tab) — floating per-compose dismiss semantics
    untouched. Regression test added.

---

## Needs confirmation before Steps 3–5 (developer)

1. **Terminal-as-context (Phase 0 / Phase 5):** T1 (extend `PromptPanelId` to include `'terminal'`
   — a small additive change to the shipped prompt-context contract + its tests + sandbox CLAUDE.md)
   vs T2 (terminal rows shown but not context-selectable in v1). Plan defaults to **T1**.
2. **Design step:** confirm the `designer` runs before interface for the tree (rows, group headers,
   empty states) + the **panel+tab context chip** treatment — `ContextChipData` cannot express a
   panel+tab selection today, so a chip-kind extension is needed and is a design decision.
