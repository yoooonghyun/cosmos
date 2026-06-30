# Spec: Random Cosmos Tab Icons — v1

**Status**: Review (scope resolved via SDD-cycle direction — see Resolved Decisions)
**Created**: 2026-06-30
**Supersedes**: —
**Related plan**: `.sdd/plans/cosmos-random-tab-icons-v1.md`

---

## Grounding

**codegraph_explore** (code structure — verbatim source, treated as read):
- `PanelTabStrip icon prop SURFACE_ICON SquareTerminal terminal tab kind` → the strip already
  accepts a per-tab `icon?: RailIcon`; its leading slot is a strict precedence chain
  `in-flight spinner › error glyph › terminal glyph (kind==='terminal' ⇒ hardcoded SquareTerminal) ›
  t.icon (LeadingIcon) › null` (PanelTabStrip.tsx ~318–331). So a terminal tab's `icon` is
  CURRENTLY never reached (the terminal branch wins).
- `useGenerativePanelTabs mintLabel buildGenerativeTab hydrateGenerativeTabs GenerativeTabSnapshot` →
  generative tabs are minted in event handlers (`newTab`, unsolicited-frame auto-create via
  `open({...})`); `mintLabel` advances an event-time `everOpenedRef` (never render-phase, StrictMode-safe).
  `GenerativeTab` is the live record; `everOpened` is a monotonic counter.
- `GenerativeTabSnapshot … TerminalTabSnapshot … surfaceIcons RailIcon SURFACE_ICON` →
  `GenerativeTabSnapshot` (src/shared/ipc/session.ts:157) already carries ADDITIVE-OPTIONAL fields
  attached only when present (`renamed`, `hiddenCalendars`) built by `buildGenerativeTab`
  (sessionSnapshot.ts:132); the renderer-known terminal fields ride on `TerminalTabDraft`
  (sessionSnapshot.ts:65, e.g. `renamed`, `scrollback`, `openFiles`) and main enriches into
  `TerminalTabSnapshot`. `SessionSnapshot.openPromptPosition`/`favorites` are the precedent for
  "additive + optional, NO schema bump" (session.ts:268–289). `RailIcon` = `React.ComponentType<{
  className?: string }>` (surfaceIcons.tsx:21) — lucide-react icons satisfy this type exactly.
- `SlackPanel … stripTabs … TerminalPanel mintTab` → each panel builds `stripTabs: PanelTab[] =
  tabs.map(...)` (SlackPanel.tsx:1469, TerminalPanel.tsx:813) — the single place an `icon` would be
  wired in. Terminal mints via `mintTab()` (TerminalPanel.tsx:688, event-time `{ id: crypto.randomUUID(),
  label }`).

**LLM wiki (`wiki_query`)**: the wiki MCP tools (`mcp__plugin_oh-my-claudecode_t__wiki_*`) were
NOT available in this session (tool calls erred "No such tool available"). Grounding instead drew on
the auto-memory index (design-foundation / favorite-tabs / footer-icon-unify entries) and
`docs/DESIGN.md` (D-10, D-15, D-19) read directly. **Flag:** the plan author should re-attempt
`wiki_query` for prior tab-icon / SURFACE_ICON decisions before implementation.

**docs/DESIGN.md** (read directly): D-10 (SURFACE_ICON = the ONE source of truth for a RAIL
surface's icon — rail + footer), §3.4 tab-glyph treatment, D-15/D-19 (favorite tab leading-glyph =
`SURFACE_ICON[source.panelId]`, the cosmos default tab glyph = `SURFACE_ICON.cosmos`).

---

## Overview

Every newly created panel tab is assigned a random space-themed glyph (from a fixed 14-icon
lucide-react set) as its leading icon, so multiple open tabs in a panel are visually distinguishable
at a glance instead of reading as a row of identical, label-only cells. The glyph is assigned once at
tab creation, is stable for the life of the tab, and survives an app restart.

The same per-tab glyph is rendered in TWO places that share the one assigned `iconId`: (1) the
panel's own `PanelTabStrip` (the existing per-tab `icon` slot — no new tab chrome), and (2) the
Cosmos Home cross-panel tab survey (`PanelTabTree`), whose leaf rows currently show a uniform
`AppWindow` glyph and instead show each tab's own random glyph.

## Curated icon set (fixed by the user — exactly these 14, no more, no fewer)

All from `lucide-react` (the app's primary icon pack; clean line icons matching the existing tab
glyph style):

`Rocket · Orbit · Satellite · SatelliteDish · Telescope · Atom · Star · MoonStar · Moon · Sun ·
SunMoon · Sparkle · Sparkles · Earth`

Each icon is referenced in persistence by a **stable string id** (an `iconId` — a plain, non-secret
key into the set), NEVER by serializing a component. A renderer-side registry maps `iconId →
component`.

## User Scenarios

### Distinguishable tabs in a panel · P1

**As a** user with several open tabs in a generative panel (e.g. Slack)
**I want to** see a different little space glyph leading each tab
**So that** I can tell the tabs apart at a glance before reading the labels

**Acceptance criteria:**

- Given a panel with one tab, when I create additional tabs (via `+` or a new surface), then each
  newly created tab shows a leading glyph drawn from the 14-icon set, assigned at creation time.
- Given several open tabs, when I look at the strip, then their glyphs are independently assigned
  (repeats are possible — the set is small — but each tab's glyph is chosen per tab, not shared).
- Given a tab is idle, when it has an assigned glyph, then the glyph renders in the same leading slot
  and visual treatment (size, muted→foreground-on-active color) the existing terminal/favorite glyph
  uses — it never widens the tab beyond its current geometry.

### Glyph survives restart · P1

**As a** user who restarts the app
**I want to** see each restored tab keep the SAME glyph it had before
**So that** the visual identity of a tab is stable across sessions

**Acceptance criteria:**

- Given a tab with an assigned glyph, when I quit and relaunch, then the restored tab shows the
  identical glyph (the `iconId` is persisted and rehydrated).
- Given the session snapshot, when the icon is persisted, then it is a plain non-secret string id and
  its presence does NOT bump the session schema version (additive + optional, like
  `openPromptPosition`/`favorites`).

### Glyph never changes while the tab lives · P1

**As a** user interacting with a tab
**I want to** the glyph to stay fixed as I re-render, re-activate, rename, or run in the tab
**So that** the tab never flickers or silently re-rolls its icon

**Acceptance criteria:**

- Given an assigned tab, when the panel re-renders (tab switch, relabel after a compose, status
  change, StrictMode double-invoke), then the glyph is unchanged — it is read from stored state, never
  recomputed with `Math.random` during render.
- Given a tab is in-flight or errored, when it has an assigned glyph, then the in-flight spinner / error
  glyph still takes precedence in the leading slot (the random glyph is the IDLE leading glyph only);
  when it returns to idle the same assigned glyph reappears.

### Distinguishable rows in the Cosmos tab survey · P2

**As a** user looking at the Home cross-panel tab tree (`PanelTabTree`)
**I want to** each surveyed tab's row to carry the SAME random glyph its panel tab carries
**So that** a tab is recognizable both in its panel strip and in the Home survey, instead of every
row reading as an identical `AppWindow`

**Acceptance criteria:**

- Given panels with open tabs, when the Cosmos tab tree renders, then each leaf row shows that tab's
  assigned glyph (resolved from its `iconId`) in place of the uniform `AppWindow`.
- Given two tabs with different assigned glyphs, when both rows render, then they show two different
  glyphs; given a tab with no resolvable `iconId` (pre-feature / edge), then its row falls back to
  `AppWindow`.
- Given a row whose source tab is pinned as a favorite, when it renders, then the D-15 pinned-row
  marking (`text-primary` icon tint + bold label) and the selected/focus/gone states are unchanged —
  only the glyph SOURCE changes (uniform → per-tab).

### Pre-feature tabs get a glyph after upgrade · P2

**As a** user upgrading from a build without this feature
**I want to** my already-open (restored) tabs to gain a stable glyph too
**So that** the feature applies uniformly, not only to brand-new tabs

**Acceptance criteria:**

- Given a restored tab whose snapshot has no `iconId` (created before this feature), when it
  hydrates, then it is assigned a stable glyph exactly once (never blank, never re-rolled on later
  renders), and that glyph persists on the next save.
- Given a restored tab whose persisted `iconId` is unknown/malformed, when it hydrates, then it
  normalizes to a valid glyph from the set (never crashes, never renders a blank/broken icon).

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST define a curated icon registry of EXACTLY the 14 named lucide-react icons (`Rocket, Orbit, Satellite, SatelliteDish, Telescope, Atom, Star, MoonStar, Moon, Sun, SunMoon, Sparkle, Sparkles, Earth`) — no more, no fewer — as a pure module mapping a stable string `iconId` ↔ icon component. The registry has no side effects and is the single source for resolving an `iconId` to a glyph. |
| FR-002 | On tab CREATION (the mint event — `+`/new-tab, terminal `mintTab`, and the unsolicited-frame auto-create path), the system MUST assign the tab a random `iconId` chosen uniformly from the 14-icon set. Assignment MUST occur in the event handler / mint path, NEVER during render. |
| FR-003 | A tab's assigned `iconId` MUST be stable for the life of the tab: it MUST NOT be recomputed or re-randomized on any re-render, re-activation, status change, relabel, or rename. The render path MUST NOT call `Math.random`. |
| FR-004 | The system MUST persist each tab's `iconId` so it survives an app restart. The persisted field MUST be ADDITIVE + OPTIONAL (mirroring how `renamed`/`hiddenCalendars`/`openPromptPosition` persist), attached only when present, carrying NO secret, and MUST NOT require a session-schema-version bump. It rides the existing per-tab snapshot/draft shapes (`GenerativeTabSnapshot`; the terminal `TerminalTabDraft`/`TerminalTabSnapshot`). |
| FR-005 | The strip MUST render a tab's assigned glyph through the EXISTING `PanelTabStrip` per-tab `icon` slot and treatment — same size and muted→foreground-on-active color cascade the current terminal/favorite glyph uses — adding NO new tab chrome and not changing tab geometry. |
| FR-006 | A restored tab with NO persisted `iconId` (pre-feature) MUST receive a stable glyph assigned exactly once at hydrate (so it never flickers and is identical across renders within and across sessions), and that assignment MUST be persisted on the next save. |
| FR-007 | A persisted `iconId` that is unknown/malformed MUST be normalized to a valid glyph from the set at the load/render boundary; an invalid value MUST NOT crash and MUST NOT render a blank/broken glyph. |
| FR-008 | The idle leading glyph (the random icon) MUST NOT override the in-flight spinner or the error glyph in the strip's leading-slot precedence; it is the idle-state glyph only. |
| FR-009 | The feature MUST NOT introduce or expose any secret, token, path, or surface spec into the persisted icon field or any IPC payload (the `iconId` is a fixed-vocabulary string from the 14-icon set). |
| FR-010 | The Cosmos `PanelTabTree` MUST render each surveyed tab's assigned glyph (resolved from its `iconId` via the SAME 14-icon registry, FR-001) as the leaf row's leading glyph, REPLACING the uniform `AppWindow`. A tab with no resolvable `iconId` MUST fall back to `AppWindow`. |
| FR-011 | The tree's pinned-row marking (D-15: `text-primary` icon tint + bold label), selection, roving-focus, and gone/empty states MUST be preserved unchanged — ONLY the leaf-glyph SOURCE changes (uniform → per-tab). |
| FR-012 | The tree MUST receive a tab's `iconId` via the live cross-panel publish projection — an additive, NON-SECRET `iconId?: string` on `LivePanelTab` carried by each panel's `usePublishPanelTabs` publish and passed through the pure `toPanelTabGroups`. This is a renderer-only in-process reference (the `PanelTabsProvider` registry); it MUST NOT be persisted on that path and MUST NOT cross IPC (the persisted copy is the per-tab snapshot field of FR-004). |

> Scope (resolved): the random glyph applies to the four generative panels (Jira/Slack/Confluence/
> Calendar) + Terminal; it is EXCLUDED from the generic Cosmos/Generated-UI default tab. See Resolved
> Decisions.

## Edge Cases & Constraints

- **Render-phase randomness is banned.** `Math.random` must never run during render (flicker +
  banned in pure paths). The hydrate/initializer path is pure-ish too, so the pre-feature fallback
  (FR-006) SHOULD be a deterministic function of the tab's stable id (a hash → index into the 14),
  NOT `Math.random`, so it is stable with no side effect; fresh mints (FR-002) use true random in the
  event handler. *(Deterministic-vs-random for the pre-feature fallback is a minor sub-decision — the
  load-bearing invariant is "assigned once, never re-rolled on render".)*
- **Leading-slot precedence interaction (terminal).** If terminal tabs are in scope (OQ-2), the
  strip's leading slot currently SHORT-CIRCUITS on `kind==='terminal'` to the hardcoded
  `SquareTerminal` BEFORE it ever reads `t.icon` — so randomizing terminal requires the terminal
  branch to defer to the per-tab icon (an implementation concern for the plan; noted here as the
  reason terminal is a real decision, not a free win).
- **Favorites.** A Home favorite tab currently passes `SURFACE_ICON[source.panelId]` as its leading
  glyph to read "shortcut to <panel>" (D-15/D-19). Whether a favorite shows the source tab's random
  glyph or keeps the panel glyph is OQ-3.
- **The pinned default Cosmos tab** carries `SURFACE_ICON.cosmos` (D-19/cosmos-home-keyboard-tab-nav)
  and is out of scope for randomization (it has a fixed identity glyph).
- **Repeats are acceptable.** With 14 icons and per-tab independent selection, two open tabs may
  share a glyph; this is allowed (distinguishability is best-effort, not guaranteed-unique). De-duping
  is explicitly OUT OF SCOPE for v1.
- **Out of scope:** unique-per-panel guarantees, user-pickable icons, animated/colored glyphs, any
  change to the rail or footer icons (those stay `SURFACE_ICON`, D-10), and any new IPC channel.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Creating N tabs in an in-scope panel yields N tabs each showing a leading glyph from the 14-icon set, assigned at creation. |
| SC-002 | After quit + relaunch, every restored in-scope tab shows the identical glyph it had before (round-trip stable). |
| SC-003 | A tab's glyph does not change across tab switches, relabels, status changes, renames, or a StrictMode double-render. |
| SC-004 | The session snapshot persists the icon as an additive-optional non-secret string with NO schema-version bump; a snapshot from a pre-feature build still loads, and its tabs gain stable glyphs. |
| SC-005 | A malformed/unknown persisted `iconId` loads without crashing and renders a valid glyph. |
| SC-006 | The 14-icon registry contains exactly the named set (a test asserts the set's membership and size). |
| SC-007 | A `PanelTabTree` rendering two tabs with different `iconId`s shows two different leaf glyphs; a tab with no `iconId` falls back to `AppWindow`; the pinned-row `text-primary` tint still applies on top of the per-tab glyph. |

---

## Design step

UI-bearing but LIGHT. The icon SET is fixed by the user (not a designer decision), and rendering
reuses the existing `icon` slot/treatment, so this is mostly confirmation + one DESIGN.md note, NOT a
full design spec. The designer SHOULD weigh in on:

1. **Treatment confirmation (trivial):** the random glyph renders at the existing tab-glyph size
   (`size-3.5`), `text-muted-foreground` → `group-data-[state=active]/tab:text-foreground`,
   `currentColor`, `aria-hidden` — i.e. visually identical to today's terminal/favorite tab glyph.
2. **A DESIGN.md note distinguishing this from D-10.** D-10 says a RAIL surface's icon has ONE source
   (`SURFACE_ICON`). The random-tab-icon registry is a SECOND tab-glyph source with a DIFFERENT
   purpose — a per-tab distinguisher, not rail/footer surface identity. The designer should record
   that this is sanctioned and bounded (does not touch rail/footer; does not replace `SURFACE_ICON`
   anywhere) so a later reader does not flag it as a D-10 violation, and (per the resolved
   terminal/favorite decisions) confirm the terminal `SquareTerminal`-as-fallback reorder and the
   favorites-keep-`SURFACE_ICON` choice read correctly in the visual language.

If the designer concurs the treatment is the existing one and only a DESIGN.md note is needed, the
design step is a note-only pass; otherwise a short `.sdd/designs/cosmos-random-tab-icons-v1.md`.

## Architecture / DESIGN.md touchpoints (note only — not edited in this spec)

- `docs/ARCHITECTURE.md` (tab model + session-persistence): note the new per-tab `iconId`
  (additive-optional, non-secret) on the generative + terminal tab persistence shapes.
- `docs/DESIGN.md`: the D-10 distinction note above (per-tab random glyph registry vs rail
  `SURFACE_ICON`), and OQ-2/OQ-3 outcomes once confirmed.

---

## Resolved Decisions (were Open Questions — resolved via SDD-cycle direction)

> These were settled by direction to proceed, not by a direct message from the end user. They are
> treated as the committed scope for the plan; if the end user later differs, revise here first.

- **OQ-1 → RESOLVED: include all FOUR generative panels.** Jira/Slack/Confluence/Calendar + Terminal
  each get a random cosmos glyph at tab mint.
- **OQ-2 → RESOLVED: Terminal REPLACES the fixed `SquareTerminal` with its random glyph.** The strip's
  leading-slot precedence (`spinner › error › terminal SquareTerminal › t.icon`) is REORDERED so a
  terminal tab renders its per-tab `icon` (its random glyph); `SquareTerminal` remains ONLY as the
  fallback when a terminal tab has no assigned icon (pre-feature/edge). Spinner/error precedence
  unchanged.
- **OQ-3 → RESOLVED: Home favorites KEEP `SURFACE_ICON`** (the source panel's brand glyph for the
  cross-panel shortcut). `toFavoriteStripTab` is unchanged.
- **OQ-4 → RESOLVED: EXCLUDE the generic Cosmos / Generated-UI tabs.** The default Cosmos tab keeps
  its `SURFACE_ICON.cosmos`; the feature applies only to the four generative panels + terminal.

## Open Questions (still genuinely open)

- None blocking. (The `wiki_query` re-attempt flagged in Grounding is a process note for the plan
  author, not a product decision.)
