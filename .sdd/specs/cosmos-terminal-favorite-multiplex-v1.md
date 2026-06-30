# Spec: Pinnable Terminal Favorites (xterm multiplex) — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: — (relaxes FR-040 of `cosmos-home-favorite-tabs-v1`)
**Related plan**: `.sdd/plans/cosmos-terminal-favorite-multiplex-v1.md` (not yet written)

---

## Grounding

> Direct investigation run for THIS spec. The LLM-wiki / agentmemory MCP tools (`wiki_query` /
> `memory_*`) were **not present in this session's toolset**, so prior-decision grounding came from
> reading the committed specs/designs/architecture in-repo (the material the wiki was seeded from)
> plus codegraph. Flagged so the gap is visible.

**codegraph_explore queries run (one-line takeaways):**

- `PtyManager PtySession TerminalView TerminalPanel pty:data pty:input pty:resize registerSerializer serializersRef scrollback`
  → ONE PTY per terminal tab in main (`PtyManager.sessions: Map<paneId, PtySession>`), routed by `paneId`. `TerminalView` (renderer) binds ONE xterm per `paneId`: on mount it subscribes `pty.onData`/`onExit` **filtered by paneId** → `term.write`, wires `term.onData → pty.sendInput({paneId})`, fits + `pty.resize({paneId,cols,rows})`, pre-writes `initialScrollback`, and `registerSerializer(paneId, () => capScrollback(serialize()))`. **CRITICAL:** the unmount cleanup calls `window.cosmos.pty.dispose(paneId)` (kills the PTY) and mount calls `pty.start(paneId)` when `autoStart` — so a 2nd view of the same paneId MUST NOT own that lifecycle.
- `FavoriteSurface favoriteCatalogHosts ActiveTabSurface cosmosTabs homeFavorites FavoritePanelId GateableIntegration CosmosTab`
  → `FavoriteSurface` mounts the source's LIVE `TabSurface` via shared `ActiveTabSurface` under `favoriteCatalogHosts[source.panelId]`; GONE/WAITING/POPULATED states keyed off `findLiveTab(registry, panelId, tabId)`. `FavoritePanelId = GateableIntegration` (four integrations; **excludes terminal**). `favoriteCatalogHosts` has no terminal entry → terminal currently falls through to the GONE state.
- `TerminalPanel serializersRef registerSerializer TerminalPanelSnapshot session restore paneId panes`
  → `TerminalPanel` owns `serializersRef: Map<paneId, ()=>string>`, restores tabs by persisted `id` (= paneId, stable across relaunch — `restoredTabIdsRef`/`hydrateTerminalTabs`), `autoStart=restoredTabIds.has(id)`. It publishes its live tab list (`{id,label}`, no surface) via `usePublishPanelTabs('terminal', …)`.
- `homeFavorites findLiveTab favoritesToTabs appendFavorite useAllPanelTabs LivePanelTab publishPanelTabs`
  → `PanelTabsProvider` = renderer-only ref registry (NO IPC). `LivePanelTab` already carries an optional `surface?: TabSurface | null` ref-pass (added by v1) — `undefined` for terminal. `findLiveTab` is defensive (null on miss).
- `CosmosPanel render favorite branch SharedComposer publish cosmos composer null` + `PanelTabTree renderRowMenu terminal disabled`
  → On a favorite tab CosmosPanel renders `<FavoriteSurface>` (mounted ONLY while that favorite is active — unmounts on tab switch) and publishes a **null `'cosmos'` composer** to hide the docked composer. `PanelTabTree.renderRowMenu` ALREADY branches `panelId === 'terminal'` to a **disabled** "Pin" + "Terminal tabs can't be pinned" label. `CosmosPanel.handlePin/handleUnpin/isSourcePinned` early-return on `'terminal'`. These four sites are exactly where the FR-040 relaxation lands.
- `SharedComposer` → Terminal/disconnected surfaces publish NO composer → `SharedComposer` renders nothing for them.

**Architecture cross-refs read:** §3 (rail single-surface switcher; ALL panels stay `forceMount`ed when hidden — so both the source and the favorite terminal views are always mounted but only one is on-screen), §4.1 (PTY manager, paneId routing, continue-don't-restart, dispose-on-tab-close), §4.2 (one xterm per tab, filtered by paneId), §4.13 (terminal 3-pane file-explorer split), §4.14 (cross-panel seam + Home favorites). Prior spec read: `cosmos-home-favorite-tabs-v1` (FR-040 excludes terminal; the live-mirror idiom this extends).

---

## Overview

Let a user **pin a terminal tab** as a Home favorite, just like a generative-panel tab. A terminal
favorite renders a **second live `xterm` view bound to the SAME PTY** as the source terminal tab —
no new `claude` session, no second PTY. Both views subscribe to the same `paneId`'s `pty:data` and
write `pty:input`/`pty:resize` for it, so the one live session drives both (**Approach A: renderer-
side xterm multiplex**). This relaxes `cosmos-home-favorite-tabs-v1`'s FR-040 (terminal tabs were
excluded because a PTY has no A2UI surface) — the favorite mirrors the terminal's live screen
instead of an A2UI surface.

---

## User Scenarios

### Pin a terminal tab from Home's tree · P1

**As a** Home user surveying the cross-panel tab tree
**I want to** right-click a Terminal-group tab row and choose Pin
**So that** I can keep that live terminal one click away in Home

**Acceptance criteria:**

- Given the tree's "Terminal" group lists an open terminal tab, when I right-click that row, then the menu offers **Pin** (no longer a disabled "can't be pinned" item).
- Given I choose Pin, then a favorite tab appears in Home's strip after the default "Cosmos" tab, labeled with the source terminal's label (e.g. "Terminal 2") and the terminal rail glyph, WITHOUT changing which tab is active (pinning stays non-disruptive).
- Given a terminal tab is already pinned, when I right-click its tree row, then the menu shows **Unpin**, and the row carries the same pinned mark generative rows get.

### Open a terminal favorite as a live mirror · P1

**As a** Home user with a terminal favorite pinned
**I want to** click the favorite tab
**So that** I see the live terminal session inside Home, in sync with the source terminal

**Acceptance criteria:**

- Given a terminal favorite, when I click it, then Home's content area shows a full-width terminal view bound to the source `paneId` (no rail navigation; the cross-panel tree is hidden on a favorite tab, as for A2UI favorites).
- Given the source terminal already has scrollback history, when the favorite opens, then the favorite shows that history (seeded from the source's current screen), not a blank screen, then continues live.
- Given the source terminal prints new output, when I am viewing the favorite, then that output appears in the favorite in real time (same `pty:data` stream).

### Type into the favorite · P1

**As a** Home user viewing a terminal favorite
**I want to** type into it
**So that** I can drive the same `claude` session from Home

**Acceptance criteria:**

- Given the favorite terminal has focus, when I type, then the keystrokes reach the source PTY's stdin (`pty:input {paneId}`) and the resulting output appears in BOTH the favorite and the source view.
- Given I type, then each character appears exactly once (no double-echo) in each view.
- Given the favorite is not the on-screen view, then it does not capture keystrokes (only the visible, focused terminal does).

### The source terminal goes away · P1

**As a** Home user whose pinned terminal's source tab was closed (or its `claude` exited)
**I want** the favorite to degrade calmly
**So that** nothing crashes and I am never left driving a dead view

**Acceptance criteria:**

- Given I close the source terminal tab while its favorite is pinned, when I open the favorite, then it shows the calm "this tab is no longer open" state with an **Unpin** affordance (the same gone-source idiom as A2UI favorites); the favorite is never auto-removed.
- Given the source's `claude` process exits on its own, when I view the favorite, then the favorite reflects the exited state read-only (it does NOT offer its own Restart — lifecycle stays with the source).
- Given the source tab is closed, then closing/unpinning the favorite (or its source's PTY teardown) NEVER kills a still-open source terminal — the favorite never owns the PTY lifecycle.

### Terminal favorites survive relaunch · P1

**As a** user who pinned a terminal favorite
**I want** it back after quit/relaunch, re-bound to the restored session
**So that** my workspace is stable

**Acceptance criteria:**

- Given I pinned a terminal favorite and quit, when I relaunch, then the favorite is present in Home's strip in pinned order.
- Given the Terminal panel restores that pane by its stable id and auto-resumes its session, when I open the favorite, then it re-binds to the restored `paneId` and mirrors the resumed session (re-seeded from restored scrollback, then live).
- Given the source terminal was NOT restored (or fails to resume), when I open the favorite, then it shows the calm gone-source state and is not dropped.

### Resize stays correct across surface/tab switches · P2

**As a** user switching between the Terminal rail surface and a Home terminal favorite
**I want** the terminal to size to whichever view I'm looking at
**So that** the `claude` TUI is never mis-fit

**Acceptance criteria:**

- Given the source view and the favorite view of the same `paneId` may differ in size, when I switch which one is on-screen, then the newly-visible view re-fits and resizes the PTY, and the hidden view does not resize it.
- Given I resize the app window while viewing the favorite, then the PTY resizes to the favorite's measured size (the hidden source view does not drive a competing resize).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. New requirements for this feature;
> traces reference `cosmos-home-favorite-tabs-v1` FRs (prefixed v1-) and architecture sections.

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-001 | Terminal tabs MUST become pinnable: the prior exclusion (v1-FR-040) is RELAXED. The Terminal-group tree row's right-click menu MUST offer **Pin**/**Unpin** (state-reflective) exactly as a generative row does, replacing the disabled "Terminal tabs can't be pinned" item. | v1-FR-040 relaxation; `PanelTabTree.renderRowMenu` |
| FR-002 | The favorite-source type MUST widen to admit terminal: `FavoritePanelId` (today `= GateableIntegration`) MUST become the full cross-panel id set incl. `'terminal'` (i.e. `CrossPanelId`). `HomeFavorite.panelId`, the persisted `FAVORITE_PANEL_IDS` whitelist, and `validateFavorites` MUST likewise admit `'terminal'`. The `CosmosPanel.handlePin/handleUnpin/isSourcePinned` early-returns on `'terminal'` MUST be removed. | FR-001; `cosmosTabs.ts`, `shared/ipc/session.ts`, `CosmosPanel.tsx` |
| FR-003 | A terminal favorite MUST be a `kind:'favorite'` `CosmosTab` whose `source.panelId === 'terminal'` and `source.tabId === the source paneId`. Pinning MUST be idempotent/de-duped by `favoriteId` and non-disruptive (no activation change), identical to generative favorites. | v1-FR-010/FR-013 |
| FR-004 | A terminal favorite's content MUST render a SECOND `xterm` view bound to the source `paneId`, REUSING the existing terminal view (not a re-implementation of xterm) — `FavoriteSurface` MUST branch on `source.panelId === 'terminal'` to the terminal mirror BEFORE the A2UI `favoriteCatalogHosts` path. | FR-001; §4.2 |
| FR-005 | The favorite's terminal view MUST be a **non-owning (secondary) view**: it MUST NOT call `pty:start`, `pty:dispose`, or `pty:restart` for the shared `paneId`, on mount, unmount, or any user action. Only the source Terminal panel owns that PTY's lifecycle. (The existing `TerminalView` disposes the PTY on unmount and starts it on mount — the favorite view MUST NOT.) | §4.1 dispose-on-tab-close; the dispose-danger |
| FR-006 | Both the source view and the favorite view MUST receive the same `paneId`'s `pty:data` — each subscribes to `pty.onData` and filters by `paneId`, so the live stream fans out to both (the preload `onData` supports multiple subscribers). Live output MUST appear in both views. | §4.2; data fan-out |
| FR-007 | The favorite view MUST forward keystrokes to the shared PTY via `pty:input {paneId}` (same stdin as the source). Output (the PTY's echo) MUST appear once per view; there MUST be no client-side double echo. | input routing |
| FR-008 | Only the on-screen, focused terminal view MUST capture keystrokes. A mounted-but-hidden view (e.g. the source view while Home is the visible rail, or a favorite while inactive) MUST NOT capture input. | FR-007; §3 |
| FR-009 | On mount/activate, the favorite view MUST seed its scrollback from the source terminal's CURRENT screen+scrollback (so it shows real history, not a blank screen), THEN attach to live `pty:data`. The seed source MUST be the source pane's live serializer, surfaced as a renderer-only reference (the natural extension of the `LivePanelTab` ref-pass seam — never IPC, never persisted). | scrollback replay; §4.14 seam |
| FR-010 | The seeded scrollback carried via the registry MUST be treated as **non-secret by the same standard as the already-persisted session scrollback** (it is on-screen terminal output) and MUST remain a renderer-only ref pass — never crossing IPC, an A2UI surface, or the persisted favorite (`SessionSnapshot.favorites` stays `{panelId,tabId,label}` only). | CLAUDE.md secrets rule; v1-FR-023/FR-033 |
| FR-011 | The favorite view (and, going forward, ANY terminal view) MUST NOT drive `pty:resize` while its container is not measurable (hidden / zero-size). Only a measurable, on-screen view fits and resizes the PTY. | resize arbitration |
| FR-012 | On becoming on-screen (tab/rail switch making its container measurable), the newly-visible view MUST re-fit and `pty:resize` to its own size; the previously-visible (now hidden) view MUST NOT compete. The currently-visible view is therefore the last writer of the PTY size. | FR-011; resize on switch |
| FR-013 | A terminal favorite MUST detect a GONE source the SAME way A2UI favorites do — `findLiveTab(registry, 'terminal', tabId)` returning null (the Terminal panel republishes its tab list without a closed tab) — and render the calm "no longer open" + Unpin state. It MUST NOT be auto-removed. | v1-FR-031; FavoriteSurface GONE idiom |
| FR-014 | If the source pane is published but its session is not yet live (a fresh terminal still in the `[Open a folder]` awaiting phase, or no scrollback yet), the favorite MUST show a calm WAITING state and flip to the live mirror once the session is live — mirroring the A2UI favorite's WAITING state. | v1 WAITING idiom; §4.1 deferred spawn |
| FR-015 | If the source `claude` process exits (a `pty:exit` for the shared `paneId`), the favorite MUST reflect the exited state read-only (no Restart button in the favorite). Restarting remains a source-only action. | FR-005; §4.1 exit banner |
| FR-016 | Terminal favorites MUST persist across relaunch by reference only (`SessionSnapshot.favorites` `{panelId:'terminal', tabId, label}`, additive/optional, NO schema bump, `validateFavorites`), and on relaunch MUST re-bind to the restored pane by its stable id (terminal tabs restore with their persisted ids). | v1-FR-030/FR-032; §4.1 stable paneIds |
| FR-017 | The mirror scope MUST be the TERMINAL PANE ONLY — a single full-width `xterm` bound to the `paneId`. It MUST NOT mirror the §4.13 file-explorer split (viewer + tree dock + open-files), the `[Open a folder]` welcome CTA (the favorite shows WAITING instead while awaiting), or a Restart affordance. *(Recommendation — see Open Questions; confirm.)* | §4.13; mirror-scope #6 |
| FR-018 | On a terminal favorite tab, Home MUST hide its docked Cosmos composer (publish a null `'cosmos'` composer config, as it does for generative favorites). Because the Terminal surface has no published composer, the terminal favorite shows NO floating Open Prompt — it is a pure terminal mirror. | v1 favorite-composer rule; SharedComposer |
| FR-019 | Pin/Unpin and the gone/waiting/exited states MUST be operable by keyboard and screen-reader to the same standard as A2UI favorites (the tree's roving-tabindex menu; the favorite's Unpin button). | v1-FR-003 |

## Edge Cases & Constraints

- **Dispose-danger (the load-bearing constraint).** The existing `TerminalView` calls `pty.dispose(paneId)` on unmount. Since the favorite's terminal view unmounts on every Home tab switch, a naive reuse would kill the shared PTY (and the source terminal) on every switch/unpin. FR-005 forbids the favorite from owning start/dispose/restart — this requires a "secondary/non-owning" mode on the reused terminal view (a flag, or a thin wrapper), decided in the plan.
- **Two views, one PTY, never simultaneously visible.** The source (Terminal rail) and the favorite (Home rail) are on DIFFERENT rail surfaces; at most one rail is on-screen at a time. Both panels stay `forceMount`ed (§3), so both views can be MOUNTED, but only one is measurable. FR-011 (no resize when not measurable) makes resize race-free: only the measurable view ever resizes, so the visible view is always the last writer.
- **Seed-vs-subscribe micro-race.** Between snapshotting the source's scrollback and attaching to live `pty:data`, a few bytes can be lost or duplicated (PTY data has no sequence numbers, so perfect replay is not achievable with today's contract). For a secondary mirror this is visually tolerable; the exact ordering and acceptable tolerance are flagged (Open Questions).
- **Favorite mounts on activate.** CosmosPanel renders the favorite body only while that favorite tab is active, so the favorite terminal view mounts on activate and unmounts on switch-away → it re-seeds on each activation. (An alternative — keep it mounted+subscribed to avoid re-seed — is a plan-level choice; either way FR-005's non-dispose rule is mandatory.)
- **Scrollback content sensitivity.** Terminal scrollback can contain whatever the user printed. cosmos ALREADY persists bounded scrollback in the session snapshot, so seeding a second renderer-side view from the same on-screen buffer introduces no new secret surface (FR-010). It is never sent over IPC or persisted by the favorites seam.
- **Pinning the SAME terminal twice / pinning then renaming.** De-duped by `favoriteId` (FR-003); label reconciliation follows the existing `reconcileFavorites` path (a terminal tab's label, e.g. "Terminal 2", relabels live; a closed source keeps the favorite).
- **Out of scope (v1):** mirroring the terminal's file-explorer split or open files in Home; a Restart/Open-folder affordance inside the favorite; pinning a terminal from inside the Terminal panel's own strip (pin only from Home's tree); driving session lifecycle (start/kill/resume) from the favorite; making the second xterm independently scrollable-with-its-own-history beyond the seeded snapshot.

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | A user can Pin a terminal tab from Home's tree, see a favorite appear after the default tab, and Unpin it from the tree or the strip. |
| SC-002 | Opening a terminal favorite shows the source session's history (seeded) then live output, in sync with the source view, with no rail navigation. |
| SC-003 | Typing in the favorite drives the shared PTY; output shows once per view in both; only the visible view captures input. |
| SC-004 | Closing the source tab, unpinning the favorite, or switching Home tabs NEVER kills a still-open source terminal (the favorite never disposes/starts/restarts the PTY). |
| SC-005 | A gone source shows the calm "no longer open" + Unpin state (never auto-dropped); a fresh/awaiting source shows WAITING; an exited session shows read-only exited (no favorite Restart). |
| SC-006 | The on-screen view always ends up correctly sized after a surface/tab switch or window resize; the hidden view never drives a competing resize (verified race-free by the not-measurable guard). |
| SC-007 | Terminal favorites survive quit/relaunch in order and re-bind to the restored pane by its stable id; the persisted favorite carries only `{panelId:'terminal',tabId,label}` — no scrollback, cwd, sessionId, path, or token. |

---

## Open Questions

- [ ] **[NEEDS CLARIFICATION — mirror scope, #6] Terminal pane only vs whole Terminal view.** This spec RECOMMENDS the favorite mirror JUST the terminal pane (a single full-width xterm) — NOT the §4.13 file-explorer split (viewer + tree dock + open-files), the `[Open a folder]` welcome CTA, or a Restart button (FR-017). Rationale: the favorite is a quick-glance live terminal; the explorer is a heavy, separately-focused, per-panel-stateful tool (its own `fs:*`-backed open-files, Monaco viewer, dividers) that would double-mount and fight the source's state. Confirm "terminal pane only", or specify that the favorite must mirror the full 3-pane Terminal view.
- [ ] **[NEEDS CLARIFICATION] Scrollback-replay mechanism + tolerance.** Recommended: surface the source pane's live serializer as a renderer-only reference through the cross-panel registry (the natural extension of `LivePanelTab.surface`'s ref-pass), and on favorite mount seed `serialize()` then attach to `pty:data`. Confirm (a) that registry ref-pass is the right transport (vs. a dedicated seam), and (b) that a few lost/duplicated bytes at the seed/subscribe boundary are acceptable for a secondary mirror (perfect replay needs sequence-numbered `pty:data`, out of scope).
- [ ] **[NEEDS CLARIFICATION] Resize guard scope.** FR-011 forbids a NON-measurable view from driving `pty:resize`. This changes the shared terminal resize path for ALL terminals (today `pushResize` sends even when `fit()` throws). Confirm it is acceptable to apply this guard globally (a hidden terminal resizing the PTY is never desirable anyway), vs. confining it to the favorite/secondary view only.
- [ ] **[NEEDS CLARIFICATION] Mount lifetime of the favorite view.** Mount-on-activate (re-seed each activation, simplest, matches CosmosPanel's per-active-tab body) vs. keep-mounted-and-subscribed (no re-seed flicker, but a background xterm parses the stream continuously while hidden). Either satisfies FR-005; confirm the preferred default.
- [ ] **[NEEDS CLARIFICATION — low risk] Second-xterm perf/echo.** A second always-or-often-mounted xterm doubles that pane's stream parsing while present; echo is the PTY's (written once per view), so no double-char is expected. Confirm this is acceptable (it is negligible for a single extra terminal), or cap the favorite mirror to active-only.

---

## Notes for the architecture doc (do NOT edit yet)

- **§4.14 (Home favorites):** "Terminal tabs are **not pinnable** (no A2UI surface)" becomes: terminal tabs ARE pinnable; a terminal favorite is a **renderer-side xterm multiplex** (a second xterm bound to the same `paneId`, no new session), a NON-OWNING view of the shared PTY. `FavoritePanelId` widens to `CrossPanelId`.
- **§4.1 / §4.2 (terminal):** note that a `paneId` may now have MORE THAN ONE bound xterm view (source + a Home favorite), that only the source view owns `pty:start`/`dispose`/`restart`, and that resize is driven only by the measurable (on-screen) view.
- **§4.14 seam evolution:** the `LivePanelTab` ref-pass (today: A2UI `surface`) extends to also carry a terminal pane's live scrollback serializer reference (renderer-only, non-secret by the persisted-scrollback standard, never IPC/persisted).

## Sequencing note

A developer is concurrently fixing navigate-on-pin in `cosmosTabs.ts` / favorites tests. This is a
SPEC document only — no code conflict. Implementation of this feature should land AFTER that fix and
after the current `cosmos-home-favorite-tabs-v1` work settles, since it reuses `appendFavorite`,
`FavoriteSurface`, the tree Pin menu, and the favorites persistence path directly.
</content>
</invoke>
