# Spec: Home Favorites (Pin / Unpin tabs) — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: —
**Related plan**: `.sdd/plans/cosmos-home-favorite-tabs-v1.md` (not yet written)

---

## Grounding

> Direct investigation run for this spec. The agentmemory/LLM-wiki MCP tools
> (`wiki_query`/`memory_*`) were **not present in this session's toolset**, so prior-decision
> grounding came from reading the committed specs/designs/architecture in-repo (the same
> material the wiki was seeded from) plus codegraph. This is flagged so the gap is visible.

**codegraph_explore queries run (one-line takeaways):**

- `cosmosTabs CosmosTab kind favorite default CosmosPanel CosmosTimelineEntry PanelTabTree cosmos-panel-tab-list`
  → `cosmosTabs.ts` already models `kind: 'default' | 'favorite'` with `appendFavorite` / `closeCosmosTab` / `isCloseable` pure ops; favorites were left as a forward-compat seam (no UI). `CosmosPanel` holds `useState(initialCosmosTabs)`, renders a `PanelTabStrip` + a timeline|tree split; the strip already supports a per-tab `closeable` flag.
- `PanelTabsProvider usePublishPanelTabs useAllPanelTabs LivePanelTabs PanelTabsContext CrossPanelId reconcileSelectedContext panelTabChipFor`
  → The cross-panel seam publishes **labels only** (`LivePanelTab = {id,label}` + `activeTabId`), explicitly non-secret, NO surface spec. It is a renderer-only ref-backed registry (no IPC). `reconcileSelectedContext` is the existing "keep a selection honest as tabs close/rename" discipline.
- `ActiveTabSurface InlineSurface A2uiHost catalog render surface spec ActiveTabProvider GenerativeTab surface`
  → `ActiveTabSurface` renders a `TabSurface` under a panel's `<A2UIProvider>` (`catalogId` per panel); on mount of a `restored` surface it fires `adapter.refresh` so main lazily re-registers the descriptor + re-fetches. `InlineSurface` (Cosmos timeline) reuses it with `catalogId="standard"`. Actions route via `window.cosmos.ui.sendAction({requestId, action})`.
- `SessionRegistry useReportPanel buildGenerativePanel GenerativePanelSnapshot hydrateGenerativeTabs session persistence restore TabSurface DropdownMenu ContextMenu SURFACE_ICON`
  → Persistence is a per-panel `report()` → debounced `SessionRegistry.assembleSnapshot()` → `window.cosmos.session.save`. `SessionSnapshot.panels` is keyed by render target; the Cosmos panel (`cosmosTabs`) is **not** itself persisted today. `hydrateGenerativeTabs` re-instates composed surfaces with a **fresh requestId** + `restored: true`. `TabSurface` carries `spec/dataModel/descriptor/bindings/restored` — non-secret by the render contract.
- `TabSurface interface SURFACE_ICON RAIL_LABEL CosmosPanel render content timeline area` →
  CosmosPanel's content area renders the timeline when the (only) tab is active; `SURFACE_ICON` is the shared per-`SurfaceId` glyph map (rail + footer); `RAIL_LABEL` the per-panel display name.
- Glob `components/ui/*` → there is **no** `dropdown-menu`/`context-menu` shadcn primitive yet (radix-ui is already a dependency, used by `tabs.tsx`). A menu primitive must be added by the designer.

**Architecture cross-refs read:** §3 (rail single-surface switcher, panels stay mounted), §4.11 (per-panel VS Code tabs + persistence), §4.14 (Cosmos read-only cross-panel tab list / context-picker), §5/§5a (utterance → surface), §5b (deterministic bound action). Prior specs read: `cosmos-conversation-panel-v2`, `cosmos-panel-tab-list-v1` (via §4.14), `panel-tabs-v1`, `tab-rename-v1`, `jira-generative-adapter-v1` (restore-refresh path).

---

## Overview

In the Home panel (the Cosmos surface), a user can **pin** another panel's open tab as a
**favorite tab** in Home's own tab strip; clicking that favorite renders the pinned tab's
generated A2UI surface **inline inside Home** (without navigating away). Favorites survive
quit/relaunch. This turns Home from a single conversation timeline into a small multi-tab
container — the default "Cosmos" conversation plus the user's pinned surfaces — so a person can
keep the views they care about (a Jira board, a Slack list, a Calendar) one click away while
they work in the conversation.

---

## User Scenarios

### Pin a tab from the cross-panel tree · P1

**As a** Home user surveying other panels' open tabs
**I want to** right-click a tab row in Home's panel-tab tree and choose "Pin"
**So that** that tab becomes a favorite I can return to from Home

**Acceptance criteria:**

- Given the panel-tab tree (right side of the Home split) lists a generative panel's tab, when I right-click that tab row, then a small menu opens with a single **Pin** action.
- Given I choose Pin, then a new favorite tab appears in Home's tab strip, appended after the pinned default "Cosmos" tab.
- Given a tab is already pinned, when I right-click its tree row, then the menu shows **Unpin** instead of Pin.
- Given I right-click the same already-pinned source tab and choose Unpin, then its favorite tab is removed from the strip.

### Open a favorite inline · P1

**As a** Home user with a favorite pinned
**I want to** click the favorite tab in Home's strip
**So that** the pinned panel-tab's surface renders inside Home, without switching surfaces

**Acceptance criteria:**

- Given a favorite tab exists, when I click it, then Home's content area shows that source tab's generated A2UI surface inline (I stay in the Home surface; the rail does not switch).
- Given I click the default "Cosmos" tab, then Home shows the conversation timeline as today.
- Given a favorite surface is a refreshable (bound) surface, when I activate the favorite, then its data refreshes to current (it is not a frozen image of pin-time data).
- Given a favorite surface offers a deterministic/bound control (e.g. a Jira transition, a load-more), when I act on it, then the action behaves per the existing render contract.

### Unpin from the strip · P1

**As a** Home user
**I want to** remove a favorite directly from Home's strip
**So that** I can declutter without going back to the tree

**Acceptance criteria:**

- Given a favorite tab, when I click its close `X`, then the favorite is removed (unpinned).
- Given a favorite tab, when I right-click it, then a menu with **Unpin** opens and removing it unpins it.
- Given I remove the active favorite, then focus returns to the default "Cosmos" tab.
- Given the default "Cosmos" tab, then it has no close affordance and cannot be closed.

### Favorites persist across relaunch · P1

**As a** Home user who pinned favorites
**I want** my favorites to still be there after I quit and reopen the app
**So that** my workspace is stable

**Acceptance criteria:**

- Given I pinned one or more favorites and quit, when I relaunch, then those favorites are present in Home's strip in the same order.
- Given a favorite whose source tab no longer exists on relaunch, when I open it, then it still renders from its persisted snapshot (graceful degradation — it is not silently dropped, it is not a crash, and a bound favorite still refreshes its data).

### Keyboard access to Pin/Unpin · P2

**As a** keyboard user navigating the roving-tabindex tree
**I want to** open the Pin/Unpin menu without a mouse
**So that** the feature is accessible

**Acceptance criteria:**

- Given a tree tab row is focused, when I press the platform context-menu key (or Shift+F10), then the Pin/Unpin menu opens and is operable by arrow keys + Enter.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement | Traces to |
|--------|-------------|-----------|
| FR-001 | Right-clicking a **tab row** in Home's panel-tab tree (`PanelTabTree`) MUST open a small menu offering **Pin** when that source tab is not yet pinned, or **Unpin** when it is. | Decision 1 |
| FR-002 | The menu MUST reflect the source tab's current pinned state (Pin vs Unpin), derived from Home's favorites — not a fixed label. | Decision 1 |
| FR-003 | The menu MUST be reachable by keyboard from a focused tree row (platform context-menu key / Shift+F10) and be arrow-key + Enter operable, preserving the tree's roving-tabindex behavior. | Decision 1 |
| FR-004 | Right-clicking a **favorite tab in Home's strip** MUST offer **Unpin**; the favorite's close `X` MUST also unpin it. The two are equivalent (close == unpin). | Decision 1 |
| FR-005 | The menus MUST be built on a shared shadcn/Radix menu primitive (dropdown/context-menu), consistent with the design system — NOT a hand-rolled menu. | Decision 1; DESIGN.md |
| FR-010 | Choosing Pin MUST append a `kind: 'favorite'` `CosmosTab` to Home's tab state **after** the pinned default tab, recording the source `{ panelId, tabId }` and a captured surface snapshot. Pinning MUST be **non-disruptive**: it MUST NOT change which tab is active — the user stays on the currently-active tab (the favorite simply appears in the strip + the tree row marks it pinned). *(Correction: navigating to the favorite on pin was confusing — user feedback.)* | Decision 2 |
| FR-011 | The default "Cosmos" tab MUST remain first and undeletable (no close affordance, never unpinnable). | Decision 2 |
| FR-012 | Favorite tabs MUST be closeable/unpinnable; closing/unpinning the active favorite MUST return focus to the default tab. | Decision 2 |
| FR-013 | Pinning a source tab that is already pinned MUST be idempotent (no duplicate favorite); favorites are de-duplicated by source `{ panelId, tabId }`. | Decision 2 |
| FR-014 | A favorite tab's label MUST identify its source: it SHOULD show the source panel's `SURFACE_ICON` glyph as a leading icon plus the source tab's label (truncated by the strip as usual). | Decision 2 (label question) |
| FR-020 | Clicking a favorite tab MUST render that source tab's generated A2UI surface **inline in Home's content area** — Home stays the active rail surface; no rail navigation, no surface teardown of the source panel. | Decision 3 |
| FR-021 | Clicking the default tab MUST render the conversation timeline exactly as today. | Decision 3 |
| FR-022 | A favorite surface MUST be rendered through the **same A2UI host path** the source panel uses (`ActiveTabSurface` under the source panel's catalog). Repeatable/bound/deterministic controls (`adapter.*`, `jira.*`, etc.) MUST work; a one-shot terminal `submit` with no live pending call is inert (matching how a historical surface in the timeline is display-only today). | Decision 3 |
| FR-023 | The favorite's surface MUST be obtained as **NON-SECRET data only** (the A2UI spec + secret-free descriptor/bindings + non-secret labels) — never a token, OAuth secret, credential, file path, transcript line, or dock secret. | Decision 3; CLAUDE.md secrets rule; §4.14 FR-011 |
| FR-024 | Activating a **bound (refreshable)** favorite MUST refresh its data to current (via the existing descriptor restore-refresh path), not show pin-time data; a **non-bound** favorite renders its captured static spec. | Decision 3/4 |
| FR-030 | Favorites (their source identity, label, and captured non-secret snapshot) MUST persist across quit/relaunch via the session-persistence mechanism, restored in their pinned order. | Decision 4 |
| FR-031 | A favorite whose source tab no longer exists on relaunch (or after the source is closed mid-session) MUST still render from its persisted snapshot and MUST NOT be auto-removed; the user unpins it explicitly. | Decision 4 (graceful degradation) |
| FR-032 | A restored favorite surface MUST be re-instated with a **fresh requestId** (mirroring generative-tab restore), and a bound one marked so it fires the descriptor restore-refresh on first mount. | Decision 4 |
| FR-033 | Only non-secret fields MUST be persisted for a favorite (FR-023's whitelist); a malformed/secret-bearing persisted favorite MUST be warned + skipped at the main boundary, never crash restore. | Decision 4; project boundary rule |
| FR-040 | **Terminal tabs MUST NOT be pinnable** (a terminal/PTY tab has no A2UI surface to render inline). The Pin action MUST be absent or disabled for terminal tree rows, with the reason discoverable. | Decision 1 scope; §4.13 |
| FR-041 | A favorite whose source tab is **renamed** after pinning MAY relabel (reusing the `reconcileSelectedContext` discipline) while the source is open, but MUST NOT be removed by a rename. | Edge case |

## Edge Cases & Constraints

- **No menu primitive exists yet.** `src/renderer/components/ui/` has no `dropdown-menu`/`context-menu`. This feature is UI-bearing and REQUIRES a **design step** to add the shared menu primitive (radix-ui is already a dependency). The architect/plan must route through `designer` before implementation.
- **Cross-panel surface delivery crosses the §4.14 contract.** Today `PanelTabsProvider` publishes labels only and is documented (§4.14, FR-011) as a labels survey, explicitly NOT a surface mirror. Rendering a favorite inline requires Home to OBTAIN the source surface. This needs a new/expanded contract — see Open Questions (the crux). Because `PanelTabsProvider` is a renderer-only ref registry (not IPC), passing a surface reference is cheap, but it still changes that seam's documented purpose, so it needs an explicit decision.
- **Source tab with no surface yet.** An untitled `+`/in-flight source tab has `surface: null`. Pinning such a tab would capture nothing. The feature SHOULD only allow Pin when the source tab currently has a renderable surface (Pin disabled otherwise), OR capture-on-first-surface — needs confirmation (OQ).
- **Catalog coupling.** Each generative panel mounts `ActiveTabSurface` under its OWN catalog/`<A2UIProvider>` (jira/slack/confluence/calendar/standard). To render a foreign panel's surface inline, Home must select the source panel's catalog by `panelId`. This couples Home to the four catalogs (or a shared catalog-host registry) — a plan-level concern, flagged here.
- **Composer behavior on a favorite tab.** Home's docked Open-Prompt composer submits to the default conversation. Its behavior while a favorite tab is active is unresolved (OQ).
- **Security.** No token/secret/path ever crosses into a favorite, its persisted snapshot, or its inline render (FR-023/FR-033). Same whitelist as `ViewContext`/`PromptContext`/`TabSurface`.
- **Out of scope (v1):** reordering favorites by drag; pinning a tab from inside the *source* panel's own strip (v1 pins only from Home's tree, plus unpin from Home's strip); pinning the default conversation; cross-device sync; live two-way interactivity that resolves the source tab's *original* one-shot pending call.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A user can pin a generative panel tab from Home's tree and see a favorite appear after the default tab, then unpin it from either the tree or the strip. |
| SC-002 | Clicking a favorite renders the source surface inline in Home with no rail navigation; clicking the default tab shows the timeline. |
| SC-003 | A bound favorite shows current data on activation; a non-bound favorite shows its captured spec. |
| SC-004 | Favorites survive quit/relaunch in order; a favorite whose source is gone still renders from its snapshot and is not dropped or crashing. |
| SC-005 | Terminal tabs cannot be pinned, and the reason is discoverable (disabled/absent Pin). |
| SC-006 | No token, secret, credential, path, or transcript line appears in any favorite, its persisted snapshot, or its inline surface (verified against the IPC/persistence payloads). |
| SC-007 | The default "Cosmos" tab is always present, first, and uncloseable. |

---

## Open Questions

- [ ] **[NEEDS CLARIFICATION — THE CRUX] Inline-surface mechanism.** How does Home obtain the source tab's A2UI surface to render it inline? Recommended: **option (b) snapshot, delivered via an expanded (a) renderer-only publish** — expand `PanelTabsProvider`'s per-tab payload to also carry the tab's current non-secret `TabSurface` (cheap, since the registry is a same-renderer ref pass, not IPC); on Pin, Home stores a **snapshot** (spec + secret-free descriptor/bindings + source ids + label) as the favorite; Home renders it via `ActiveTabSurface` under the source panel's catalog with a **fresh requestId + `restored: true`**, so a bound favorite fires the existing `adapter.refresh` restore path (re-registers in main, re-fetches fresh data) and the snapshot persists naturally in the session. **Why:** it reuses the proven session-restore machinery end-to-end (`hydrateGenerativeTabs` semantics, `ActiveTabSurface` restore refresh, `AdapterDispatcher` lazy re-registration) and gives both persistence and live bound-data refresh for free; option (c) descriptor-only fails for non-bound surfaces (no descriptor, and the spec is always needed), and option (d) live cross-panel requestId routing introduces a brand-new interactivity contract for little gain. The cost: it changes §4.14's seam from a labels survey into a labels + surface mirror. **Please confirm (b)+(a-transport), or pick a/c/d / a pull-on-pin variant.**
- [ ] **[NEEDS CLARIFICATION] Terminal pinnability.** This spec assumes Terminal tabs are NOT pinnable (no A2UI surface to render inline — FR-040). Confirm, or specify what "pin a terminal tab" should mean instead (e.g. a shortcut row that navigates to the Terminal panel rather than rendering inline).
- [ ] **[NEEDS CLARIFICATION] Pin when the source tab has no surface yet.** Should Pin be disabled for a source tab whose `surface` is currently null (untitled/in-flight), or should it pin and capture the surface once one lands?
- [x] **[RESOLVED — user feedback 2026-06-30] Composer behavior + tree on an active favorite tab.** A favorite is "literally a shortcut showing the SOURCE tab AS-IS." So: (1) the cross-panel tree renders ONLY on the default "Cosmos" tab — a favorite tab is a SINGLE FULL-WIDTH pane (no tree, no divider). (2) The docked Cosmos conversation composer is HIDDEN on a favorite tab; instead the favorite shows the SOURCE panel's OWN floating Open Prompt, whose submit routes to the SOURCE target (jira/slack/confluence/google-calendar) — NOT the cosmos conversation. Implemented as contained renderer wiring (Home publishes a null `'cosmos'` composer config + renders the source's already-published config via `useActiveComposerConfig(source.panelId)` as a floating `PromptComposer`); no contract change — the generative panels publish their composer unconditionally (gated on `isConnected`, not on being the active rail surface), and the submit goes through the source panel's own `onSubmit`.
- [ ] **[NEEDS CLARIFICATION] Where favorites persist.** Extend the session snapshot with a dedicated Home/favorites slice, or fold favorites into the (currently unused-for-Cosmos) `generated-ui` panel snapshot? This is a contract-shape decision for the plan, but confirm whether a schema-version bump is acceptable.
