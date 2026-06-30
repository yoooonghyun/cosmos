# Plan: Random Cosmos Tab Icons — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-random-tab-icons-v1.md`

---

## Grounding

**codegraph_explore** (verbatim source, treated as read):
- `PanelTabStrip icon prop SURFACE_ICON SquareTerminal terminal tab kind` → leading-slot precedence
  `spinner › error › isTerminal(SquareTerminal) › LeadingIcon(t.icon) › null` (PanelTabStrip.tsx
  318–331); `icon?: RailIcon` already on `PanelTab`.
- `useGenerativePanelTabs …` → mint sites are all `open({...})` calls: `newTab` (633), `submit`
  auto-create (574), unsolicited-frame auto-create (401), `newTabWithDefault` (663),
  `requestDefaultInActiveTab` zero-tab branch (687); `mintLabel` advances event-time `everOpenedRef`;
  the published `livePanelTabs` projection is `tabs.map(t=>({id,label}))` (≈329).
- `GenerativeTabSnapshot/TerminalTabSnapshot/TerminalTabDraft + sessionSnapshot build/hydrate` →
  `buildGenerativeTab` (sessionSnapshot.ts:132) + `buildTerminalDraft` (95) attach additive-optional
  fields only-when-present; `hydrateGenerativeTabs` (182) + `hydrateTerminalTabs` (247) map snapshot→
  live; main `validateGenerativeTab` (sessionSnapshot.ts:219) / `validateTerminalTab` (189) normalize
  at the load boundary (drop-on-malformed pattern, e.g. `validateOpenFiles`/`validateHiddenCalendars`).
- `LivePanelTab/usePublishPanelTabs/PanelTabTree/toPanelTabGroups` → `LivePanelTab` (panelTabs.ts:36)
  is `{id,label, serialize?}`; `toPanelTabGroups` (panelTabsTree.ts:54) REBUILDS each tab as
  `{id,label}` (drops extras — line 79); `PanelTabTree` maps groups → `TabRow` (PanelTabTree.tsx:209)
  and the leaf glyph is the hardcoded `AppWindow` inside `TabRow`; `usePublishPanelTabs`
  (PanelTabsProvider.tsx:74) is a renderer-only ref-backed registry (NO IPC).
- `TerminalPanel mintTab` → `mintTab()` (TerminalPanel.tsx:688) event-time; the FIRST default tab is
  built in a PURE `useState(() => …)` lazy initializer (697–706) and in the `tabs.length===0` guard
  (805–808); `stripTabs` map (813).

**LLM wiki (`wiki_query`)**: MCP wiki tools were UNAVAILABLE this session ("No such tool available").
Substituted the auto-memory index + direct DESIGN.md reads. **The developer SHOULD re-attempt
`wiki_query` for prior tab-icon / SURFACE_ICON / persistence-field decisions before coding, and
`wiki_ingest` the iconId-registry decision after.**

**docs/DESIGN.md**: D-10 (rail/footer `SURFACE_ICON` = one source), §3.4 tab-glyph treatment,
D-15 (tree leaf glyph + pinned-row `text-primary` marking), D-19 (favorite strip glyph).

---

## Summary

Add a small, pure **14-icon registry** keyed by a stable `iconId` string, assign a random `iconId`
to every newly minted tab in the four generative panels + Terminal (at the event-time mint sites,
never in render), persist the `iconId` as an additive-optional non-secret field on the existing
per-tab snapshot shapes (no schema bump), and render the resolved glyph in TWO places that share the
one assigned id: the panel's own `PanelTabStrip` (existing `icon` slot, with the terminal leading-slot
reordered so a terminal tab shows its random glyph and falls back to `SquareTerminal`) and the Cosmos
Home `PanelTabTree` leaf rows (replacing the uniform `AppWindow`, carried via a new
`LivePanelTab.iconId` on the renderer-only publish projection). Restored pre-feature tabs get a stable
glyph via a deterministic `iconId`-from-id fallback (no `Math.random` in the hydrate/initializer path);
the main load boundary drops an unknown id so hydrate's fallback covers it.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (React renderer + Node main) |
| Key dependencies | `lucide-react` (already a dep), existing session-persistence + `PanelTabsProvider` seams. NO new packages, NO new IPC channel, NO schema bump. |
| Files to create | `src/shared/tabIcons.ts` (id vocabulary + pure helpers, no React); `src/renderer/tabs/tabIconRegistry.tsx` (id→lucide component map); `+ .test.ts(x)` siblings |
| Files to modify | `src/shared/ipc/session.ts`; `src/renderer/session/sessionSnapshot.ts`; `src/main/session/sessionSnapshot.ts`; `src/renderer/tabs/useGenerativePanelTabs.ts`; `src/renderer/terminal/TerminalPanel.tsx`; `src/renderer/{slack/SlackPanel,jira/JiraPanel,confluence/ConfluencePanel,calendar/GoogleCalendarPanel}.tsx` (stripTabs `icon`); `src/renderer/tabs/PanelTabStrip.tsx` (leading-slot reorder); `src/renderer/panelTabs/panelTabs.ts` (`LivePanelTab.iconId`); `src/renderer/panelTabs/panelTabsTree.ts` (`toPanelTabGroups` carry iconId); `src/renderer/cosmos/PanelTabTree.tsx` (leaf glyph); `docs/ARCHITECTURE.md`, `docs/DESIGN.md` (notes) |

---

## Design decisions (concrete)

### 1. The registry — split shared vocabulary vs renderer component map

Main-process snapshot validation needs the SET of valid id strings but must NOT import React/lucide.
So split:

- **`src/shared/tabIcons.ts`** (pure, no React):
  - `export type TabIconId` = a string-literal union of exactly the 14 ids.
  - `export const TAB_ICON_IDS: readonly TabIconId[]` — the ordered 14 (the single source of the set).
  - ID strings = kebab of the icon name: `rocket, orbit, satellite, satellite-dish, telescope, atom,
    star, moon-star, moon, sun, sun-moon, sparkle, sparkles, earth`.
  - `export function isTabIconId(v: unknown): v is TabIconId` — membership test (used by main
    validation + the renderer boundary).
  - `export function randomTabIconId(): TabIconId` — uniform pick via `Math.random()`. **Called ONLY
    from event-handler mint sites** (never render/initializer/hydrate).
  - `export function tabIconIdFromKey(key: string): TabIconId` — DETERMINISTIC: a small stable string
    hash of `key` (e.g. a simple `for`-loop char-code fold) mod 14 → `TAB_ICON_IDS[idx]`. Pure, NO
    `Math.random`. Used for the pre-feature/initializer fallback so it is stable with no side effect.
- **`src/renderer/tabs/tabIconRegistry.tsx`** (imports lucide + shared):
  - `import { Rocket, Orbit, … Earth } from 'lucide-react'`.
  - `export const TAB_ICON_BY_ID: Record<TabIconId, RailIcon>` — the id→component map (every
    `TabIconId` present; a TS exhaustiveness check / test guarantees all 14).
  - `export function tabIconComponent(id: string | undefined): RailIcon | undefined` — returns the
    component for a valid id, else `undefined` (lets a call site choose its own fallback —
    `SquareTerminal` in the strip, `AppWindow` in the tree).

> Why two files: keeps `Math.random`/hash + the id vocabulary framework-free and importable by main
> (`.ts`, node-testable per the repo `.ts`/`.test.ts` split), while the lucide components live in a
> `.tsx` the renderer alone imports. The 14-name SET lives in exactly one place (`TAB_ICON_IDS`); the
> component map is asserted against it by a test.

### 2. Live record field (renderer)

- `GenerativeTab` (useGenerativePanelTabs.ts): add `iconId?: TabIconId` (session-only resolved value;
  doc-comment "mirrors how every other tab field persists").
- Terminal live record (`TerminalTab` / `LiveTerminalTab` in sessionSnapshot.ts): add
  `iconId?: TabIconId`.

### 3. Assignment at every mint site (event-time only — FR-002/FR-003)

- **Generative** (`useGenerativePanelTabs.ts`): add `iconId: randomTabIconId()` to EVERY `open({...})`
  mint site — `newTab`, the `submit` auto-create, the unsolicited-frame auto-create, `newTabWithDefault`,
  and the `requestDefaultInActiveTab` zero-tab branch. (Audit all `open({` calls; each is an event
  handler / subscription callback, never render.)
- **Terminal** (`TerminalPanel.tsx`): `mintTab()` adds `iconId: randomTabIconId()` (event-time). The
  PURE lazy-initializer default tab (697–706) and any other non-event seed use
  `iconId: tabIconIdFromKey(id)` (deterministic — no `Math.random` in the initializer). The
  `tabs.length===0` guard calls `mintTab()` (already an effect/event), so it is random — fine.

### 4. Persistence (additive-optional, NO schema bump — FR-004)

- **Contract** (`src/shared/ipc/session.ts`): add `iconId?: string` to `GenerativeTabSnapshot` and
  `TerminalTabSnapshot` (doc-comment: non-secret fixed-vocabulary id; additive-optional; "no schema
  bump — mirrors `hiddenCalendars`/`openPromptPosition`").
- **Renderer build** (`sessionSnapshot.ts`):
  - `buildGenerativeTab`: `if (tab.iconId) snap.iconId = tab.iconId` — persisted INDEPENDENT of
    `composed` (like `hiddenCalendars`) so a base/live tab keeps its glyph.
  - `buildTerminalDraft`: `if (t.iconId) draft.iconId = t.iconId` (add `iconId?: string` to
    `TerminalTabDraft`).
- **Main enrichment** (draft → `TerminalTabSnapshot`): carry `iconId` through wherever main enriches
  the terminal draft with `sessionId`/`cwd` (locate the enrichment site in main; it copies draft
  fields). Generative snapshots are built renderer-side and sent as-is.
- **Main load validation** (`src/main/session/sessionSnapshot.ts`):
  - `validateGenerativeTab` + `validateTerminalTab`: `if (isTabIconId(value.iconId)) tab.iconId =
    value.iconId` — an unknown/malformed id is simply OMITTED (not warned-noisy; it is benign), so the
    hydrate fallback (below) assigns a deterministic one. This single drop-then-fallback path covers
    BOTH pre-feature-absent AND malformed (FR-006/FR-007). Import `isTabIconId` from `src/shared/tabIcons`.

### 5. Hydrate (stable fallback — FR-006)

- `hydrateGenerativeTabs`: `iconId: snap.iconId ?? tabIconIdFromKey(snap.id)`.
- `hydrateTerminalTabs`: `iconId: t.iconId ?? tabIconIdFromKey(t.id)`.

Both are pure mapping paths → use the DETERMINISTIC `tabIconIdFromKey` (no `Math.random`). A restored
tab without a persisted id thus gets a stable glyph that persists on the next save (build picks it up).

### 6. Strip render (FR-005/FR-008) + terminal leading-slot REORDER (OQ-2)

- **Each generative panel `stripTabs` map** (`SlackPanel`/`JiraPanel`/`ConfluencePanel`/
  `GoogleCalendarPanel`): add `icon: tabIconComponent(t.iconId)` to the `PanelTab` it builds.
- **Terminal `stripTabs` map** (`TerminalPanel.tsx:813`): add `icon: tabIconComponent(t.iconId)` and
  keep `kind: 'terminal'`.
- **`PanelTabStrip.tsx` leading-slot reorder** — change the chain so `LeadingIcon` (the per-tab
  `t.icon`) is preferred over the terminal default, keeping `SquareTerminal` as the terminal FALLBACK:
  ```
  status==='in-flight' ? <Loader2 …/>
  : status==='error'   ? <CircleAlert …/>
  : LeadingIcon        ? <LeadingIcon className="size-3.5 shrink-0 text-muted-foreground group-data-[state=active]/tab:text-foreground" aria-hidden="true" />
  : isTerminal         ? <SquareTerminal className="size-3.5 …" aria-hidden="true" />
  : null
  ```
  - Spinner/error stay first (FR-008 unchanged).
  - Add `aria-hidden="true"` to the `LeadingIcon` render (decorative; the existing favorite path
    lacked it — harmless correction).
  - Generative tabs with no icon → `null` (unchanged). Favorites (non-terminal, `icon=SURFACE_ICON`)
    → render via `LeadingIcon` exactly as before (reorder doesn't affect them — they are not terminal).
  - The default Cosmos tab (`icon=SURFACE_ICON.cosmos`, non-terminal) → unchanged.

### 7. Tree render (FR-010/FR-011/FR-012) — the SECOND place

- **`src/renderer/panelTabs/panelTabs.ts`**: add `iconId?: string` to `LivePanelTab` (doc-comment:
  renderer-only NON-SECRET ref pass like `serialize`; never persisted/IPC on this path; the persisted
  copy is the snapshot field).
- **Publish projections** carry it:
  - `useGenerativePanelTabs` `livePanelTabs`: `tabs: tabs.map(t => ({ id: t.id, label: t.label,
    ...(t.iconId ? { iconId: t.iconId } : {}) }))`.
  - `TerminalPanel` `livePanelTabs`: same `iconId: t.iconId` addition.
- **`toPanelTabGroups`** (`panelTabsTree.ts:79`): the rebuild currently drops extras; carry the id —
  `tabs.push({ id: t.id, label: t.label, ...(isTabIconId(t.iconId) ? { iconId: t.iconId } : {}) })`.
  (Import `isTabIconId`; keep the pure/defensive contract.)
- **`PanelTabTree.tsx` `TabRow`**: replace the hardcoded `AppWindow` leaf glyph with a resolved one.
  Pass a resolved component into `TabRow` (e.g. a new `Icon` prop), computed at the call site
  (PanelTabTree.tsx:215) as `tabIconComponent(tab.iconId) ?? AppWindow`. `TabRow` keeps applying the
  D-15 pinned treatment (`text-primary` tint + `font-medium`) and selected/focus classes to WHATEVER
  glyph it renders — only the glyph component source changes. (`AppWindow` import stays as the fallback.)

### 8. Docs (note — architect-owned, applied in Phase 4)

- **`docs/ARCHITECTURE.md`** (tab model + session-persistence): note the per-tab `iconId`
  (additive-optional, non-secret, no schema bump) on the generative + terminal snapshot shapes, the
  renderer-only `LivePanelTab.iconId` publish ref, and the strip's terminal leading-slot reorder.
- **`docs/DESIGN.md`** (DESIGNER-owned — see Design Step): a note that the per-tab random-icon registry
  is a sanctioned SECOND tab-glyph source distinct from D-10's rail/footer `SURFACE_ICON`, bounded to
  tab strips + the Home tree; the terminal `SquareTerminal`-fallback reorder; favorites keep
  `SURFACE_ICON`.

---

## Test layers

### Node-unit (pure — `.test.ts`)
- **Registry** (`src/shared/tabIcons.test.ts` + `src/renderer/tabs/tabIconRegistry.test.tsx`):
  - `TAB_ICON_IDS` has exactly the 14 named ids (membership + size — SC-006).
  - `TAB_ICON_BY_ID` has a component for EVERY `TabIconId` (id↔component round-trip; no missing/extra).
  - `randomTabIconId()` always ∈ `TAB_ICON_IDS` (sample many).
  - `tabIconIdFromKey(k)` deterministic (same key → same id) and always ∈ set; different keys spread.
  - `isTabIconId` true for members, false for unknown/non-string.
- **Build/hydrate/validate** (extend `src/renderer/session/sessionSnapshot.test.ts` +
  `src/main/session/sessionSnapshot.test.ts`):
  - `buildGenerativeTab`/`buildTerminalDraft` carry `iconId` when present, omit when absent.
  - `hydrateGenerativeTabs`/`hydrateTerminalTabs` keep a present id; assign a stable
    `tabIconIdFromKey(id)` when absent (FR-006) — same id across two hydrate calls.
  - `validateGenerativeTab`/`validateTerminalTab` keep a valid id, DROP an unknown id (→ undefined),
    never throw (FR-007); a pre-feature snapshot (no `iconId`) still validates with no warn (SC-004).
  - A round-trip (build → validate) preserves a valid id and does NOT bump `schemaVersion` (SC-002/SC-004).

### jsdom (`.dom.test.tsx`)
- **Strip** (new/near `PanelTabStrip` tests): a tab with `icon` renders ITS glyph; a `kind:'terminal'`
  tab WITH `icon` renders the random glyph (NOT `SquareTerminal`); a terminal tab WITHOUT `icon` falls
  back to `SquareTerminal`; an `in-flight`/`error` tab shows the spinner/error glyph even with `icon`
  set (FR-008); the glyph is STABLE across a re-render (same component).
- **Tree** (extend `PanelTabTree.dom.test.tsx`): two tabs with different `iconId`s render two
  different leaf glyphs; a tab with no `iconId` falls back to `AppWindow`; a pinned row keeps its
  `text-primary` tint on the per-tab glyph (SC-007).
- *(Optional, if cheap)* a mint→render integration at a panel level: minting a tab yields a non-empty
  `icon`. Not required if the unit + strip tests cover it.

---

## Implementation Checklist

### Phase 1 — Interface / types
- [ ] (Process) Re-attempt `wiki_query` for prior tab-icon/SURFACE_ICON/persistence decisions.
- [ ] Create `src/shared/tabIcons.ts`: `TabIconId`, `TAB_ICON_IDS`, `isTabIconId`, `randomTabIconId`,
      `tabIconIdFromKey`.
- [ ] Create `src/renderer/tabs/tabIconRegistry.tsx`: `TAB_ICON_BY_ID`, `tabIconComponent`.
- [ ] Add `iconId?: string` to `GenerativeTabSnapshot` + `TerminalTabSnapshot` (`src/shared/ipc/session.ts`)
      and `iconId?: string` to `TerminalTabDraft`; add `iconId?: TabIconId` to `GenerativeTab`,
      `TerminalTab`/`LiveTerminalTab`, and `LivePanelTab` (`iconId?: string`).
- [ ] Review types vs spec — no invented properties (only `iconId`).

### Phase 2 — Tests (write first / alongside)
- [ ] Registry unit tests (set membership, id↔component, random ∈ set, deterministic fallback, isTabIconId).
- [ ] Build/hydrate/validate unit tests (carry, fallback, drop-unknown, no schema bump, no-warn pre-feature).
- [ ] Strip jsdom tests (per-tab icon; terminal random vs SquareTerminal fallback; spinner/error precedence; stable).
- [ ] Tree jsdom tests (two distinct glyphs; AppWindow fallback; pinned tint preserved).

### Phase 3 — Implementation
- [ ] Assign `iconId` at every generative mint site (`open({…})`) + terminal `mintTab`; deterministic
      `tabIconIdFromKey` in the pure initializer.
- [ ] `buildGenerativeTab`/`buildTerminalDraft` carry `iconId`; main enrichment carries it into
      `TerminalTabSnapshot`; `validate*` normalize (drop-unknown); `hydrate*` fallback.
- [ ] Wire `icon: tabIconComponent(t.iconId)` into all four generative panels' + Terminal's `stripTabs`.
- [ ] Reorder `PanelTabStrip` leading slot (LeadingIcon before terminal; SquareTerminal fallback; aria-hidden).
- [ ] Add `LivePanelTab.iconId`; include it in both publish projections; carry through `toPanelTabGroups`.
- [ ] `PanelTabTree` leaf glyph = `tabIconComponent(tab.iconId) ?? AppWindow`, pinned/selected states intact.
- [ ] `npm run typecheck` + `npm test` green.

### Phase 4 — Docs
- [ ] DESIGN.md note (designer or developer — see Design Step) distinguishing the registry from D-10.
- [ ] `docs/ARCHITECTURE.md` tab-model + persistence note (architect, at wrap-up).
- [ ] Update this plan's Deviations with anything that differed.
- [ ] `wiki_ingest` the iconId-registry + persistence decision.

---

## Design Step (note-only — call)

The icon SET is fixed by the user and the rendering reuses the existing `size-3.5`
muted→foreground tab/tree glyph treatment, so there is **no new visual design** — only a DESIGN.md
canon note (registry vs D-10; terminal-fallback reorder; favorites keep `SURFACE_ICON`; tree leaf
glyph source change while keeping D-15 pinned marking).

**Recommendation: a quick designer note-pass authors the DESIGN.md note, runnable BEFORE or in
PARALLEL with development** (it is note-only and the code does not depend on the note text). The
designer owns DESIGN.md, so the canon entry should be theirs; it is NOT a blocking gate on the build.
Alternatively, if the orchestrator prefers fewer hops, the developer adds the note and the designer
reviews it during wrap-up. No `.sdd/designs/<feature>-v1.md` file is needed unless the designer
decides the treatment warrants more than a note.

---

## Anything needing confirmation before dev

- **Design-step routing:** designer note-pass before/parallel to dev (recommended) vs developer adds
  the note + designer reviews at wrap-up. Either is fine; pick one.
- **The OQ resolutions** (include Jira; terminal replaces SquareTerminal; favorites keep
  `SURFACE_ICON`; exclude generic Cosmos) were settled via SDD-cycle direction, not a direct end-user
  message. They are encoded as committed scope; flagging per the "coordinator approval ≠ user
  confirmation" rule in case the end user wants to revisit any (especially OQ-2, which changes the
  existing terminal glyph affordance).

## Deviations & Notes
- **Registry test extension** (`tabIconRegistry.test.tsx` → `.test.ts`): the plan named the registry
  test `.tsx`, but the vitest node config globs `src/**/*.test.ts` and the dom config globs
  `*.dom.test.tsx`, so a plain `.test.tsx` would run in NEITHER. The component-map assertions are pure
  (no DOM), so the test is `src/renderer/tabs/tabIconRegistry.test.ts` (node-env), importing the `.tsx`
  registry module (esbuild transforms it; lucide loads in node). The set-membership test is in
  `src/shared/tabIcons.test.ts`.
- **Registry component-type assertion:** lucide-react icons are React forwardRef OBJECTS, not plain
  functions, so the "every id maps to a component" test asserts truthiness, not `typeof === 'function'`.
- **Main terminal enrichment carries `iconId` for free:** `enrichSnapshotForSave` (src/main/index.ts)
  enriches each terminal draft via `{ ...t, sessionId, cwd }`, so the draft's `iconId` spreads through
  into `TerminalTabSnapshot` with NO extra code there.
- **Hydrate uses `isTabIconId` to narrow** the persisted `string` `iconId` to the `TabIconId` union on
  the generative live record (otherwise `string ?? TabIconId` widens to `string`); the terminal live
  record types `iconId?: string` so it needs no narrowing.
- **Checklist:** Phases 1–4 complete. Interface (tabIcons + registry + the additive snapshot/draft/live
  fields), tests (node registry+persistence, jsdom strip+tree), implementation (all mint sites + both
  render seams + the strip reorder + the tree leaf + the publish refs), and docs (DESIGN.md D-20,
  ARCHITECTURE tab-model note, PROJECT-STRUCTURE, TODO, TEST-SCENARIOS rows) are all done.
  `npm run typecheck` + `npm test` (2765) + `npm run test:dom` (151) + `npm run build` all GREEN.
  Red→green confirmed for the OQ-2 terminal reorder (old precedence renders SquareTerminal → test red;
  reorder → green). `wiki_*` MCP tools remained unavailable this session (could not `wiki_ingest`).
