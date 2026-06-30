# Plan: Pinnable Terminal Favorites (xterm multiplex) — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-terminal-favorite-multiplex-v1.md`

---

## Grounding

> Direct investigation for this plan (the LLM-wiki / `wiki_*` tools are NOT in this session's
> toolset — grounding is codegraph + in-repo source, flagged so the gap is visible).

**codegraph_explore queries run (one-line takeaways):**

- `PtyManager TerminalView TerminalPanel pty:data pty:input pty:resize registerSerializer serializersRef scrollback`
  → `TerminalView` (module-local fn in `TerminalPanel.tsx`) is the xterm-bound view: mount subscribes `pty.onData`/`onExit` filtered by `paneId`, wires input → `pty.sendInput`, `pushResize()` = `safeFit()` + **unconditional** `pty.resize`, pre-writes `initialScrollback`, registers a serializer; **unmount calls `pty.dispose(paneId)`; mount calls `pty.start(paneId)` when `autoStart`** (the dispose/start-danger). The 3-pane explorer split (`useExplorerPanes`, Monaco) is rendered only when `live`.
- `FavoriteSurface favoriteCatalogHosts cosmosTabs CosmosPanel PanelTabTree renderRowMenu`
  → `FavoriteSurface` GONE/WAITING/POPULATED keyed off `findLiveTab`; A2UI path mounts `ActiveTabSurface` under `favoriteCatalogHosts[panelId]`. `PanelTabTree.renderRowMenu` has a `panelId==='terminal'` DISABLED-Pin branch; `CosmosPanel.handlePin/handleUnpin/isSourcePinned` early-return on `'terminal'`. `FavoritePanelId = GateableIntegration`.
- `validateFavorites FAVORITE_PANEL_IDS HomeFavorite favoritesToTabs reconcileFavorites toHomeFavorites useRestoredFavorites setFavorites`
  → persistence is fully wired and terminal-agnostic EXCEPT the allowed-id whitelist: `FAVORITE_PANEL_IDS` (shared/ipc) lists the four integrations; `validateFavorites` rejects anything else; `HomeFavorite.panelId: GateableIntegration`. `favoritesToTabs`/`toHomeFavorites`/`reconcileFavorites` are panelId-agnostic.
- `LivePanelTab PanelTabsProvider usePublishPanelTabs` (terminal publish) + preload `pty.onData`
  → `LivePanelTab` already carries an optional `surface?: TabSurface | null` renderer-only ref-pass; terminal publishes `{id,label}` only. Preload `pty.onData` does `ipcRenderer.on` + returns a per-handler `removeListener` off → **multiple subscribers fan out independently, no clobber** (verified in `src/preload/index.ts:116`).

**Conclusion:** NO main/IPC/preload/schema change is required. The shared boundary file `src/shared/ipc/session.ts` changes only its favorite-panel-id WHITELIST (used by main's `validateSnapshot`); everything else is renderer.

---

## Summary

Make terminal tabs pinnable as Home favorites by **multiplexing a second `xterm` onto the same
`paneId`** — Approach A, renderer-side, no new PTY/session. We **reuse the existing `TerminalView`
component as-is** (the coordinator's explicit steer: "reference the same state, don't re-implement"),
adding one minimal **`mirror` (non-owning) mode** that gates off the three things that would break a
second mount of the same `paneId`: (a) it must NOT own the PTY lifecycle (`pty:start`/`dispose`/
`restart`), (b) it seeds its xterm from the source pane's live scrollback serializer (the xterm
buffer is an imperative canvas, not shareable React state, so a 2nd xterm starts blank without a
seed), and (c) it renders the terminal pane only (no file-explorer split — explorer state is per-mount
imperative React/`fs:*` state that genuinely can't be shared across two mounts, so it is excluded by
design, not omission). Data fans out to both views via the existing per-paneId `pty:data`
subscription; both write `pty:input`/`pty:resize` for the shared `paneId`. The favorite mounts
on-activate, re-seeds, and unmounts WITHOUT disposing. We also land a **global latent-correctness fix**
to `pushResize` (a non-measurable view must not drive `pty:resize`) so the source and favorite never
fight over PTY size. The favorites persistence + tree-menu + pin/unpin machinery is reused verbatim;
the only widening is `FavoritePanelId`/the persisted whitelist admitting `'terminal'`.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron renderer; one shared-boundary type/whitelist edit) |
| Key dependencies | Existing: `xterm` + `FitAddon`/`SerializeAddon`, `PanelTabsProvider` ref-registry, `SessionRegistry` favorites path, Radix `ContextMenu`. **No new deps.** |
| New runtime contracts | **None.** No new IPC channel, no preload method, no session schema bump (favorites already additive-optional). |
| Files to create | (Optional) `src/renderer/cosmos/TerminalFavoriteSurface.tsx` (thin terminal branch of `FavoriteSurface`) + its `.dom.test.tsx`; test files listed in Phase 2. |
| Files to modify | `src/shared/ipc/session.ts`, `src/renderer/cosmos/cosmosTabs.ts`, `src/renderer/panelTabs/panelTabs.ts`, `src/renderer/terminal/TerminalPanel.tsx`, `src/renderer/cosmos/FavoriteSurface.tsx`, `src/renderer/cosmos/CosmosPanel.tsx`, `src/renderer/cosmos/PanelTabTree.tsx` |
| Design step | **NOT needed** — reuses the existing terminal chrome + the existing favorite GONE/WAITING idiom + the existing `ContextMenu`. No new visual surface. |

---

## Phase 0 — Sequencing gate (HARD — do not start Phase 1 until cleared)

- [ ] **Confirm the in-flight favorites work has settled.** navigate-on-pin fix is DONE; a
      **Confluence-favorite bugfix is in flight touching the publish path / `FavoriteSurface`**. This
      plan edits `FavoriteSurface.tsx`, `CosmosPanel.tsx`, and the publish path (`panelTabs.ts` /
      `TerminalPanel.tsx` publish) — all overlap. **Implementation MUST land after that bugfix
      merges** to avoid conflicts. Rebase on the settled favorites code before Phase 1.

## Phase 1 — Interface (types + the widening, no behavior yet)

- [ ] **Widen the favorite panel id (shared boundary).** In `src/shared/ipc/session.ts`:
      `HomeFavorite.panelId: GateableIntegration` → `GateableIntegration | 'terminal'`; add `'terminal'`
      to `FAVORITE_PANEL_IDS`. `validateFavorites` then accepts a terminal favorite for free (it gates on
      `FAVORITE_PANEL_IDS` membership). Update the doc comments (drop "terminal is NOT pinnable — FR-040").
- [ ] **Widen `FavoritePanelId` (renderer).** In `src/renderer/cosmos/cosmosTabs.ts`: `export type
      FavoritePanelId = CrossPanelId` (type-only import from `../panelTabs/panelTabs`; keeps the module
      React-free). `CrossPanelId` (`'terminal'|'slack'|'jira'|'confluence'|'google-calendar'`) is
      structurally the shared union, so `favoriteId`/`isPinned`/`appendFavorite`/`favoritesToTabs` widen
      with no further change. Update the module/`FavoritePanelId` doc comments.
- [ ] **Add the scrollback-seed ref to the cross-panel contract.** In `src/renderer/panelTabs/panelTabs.ts`,
      add to `LivePanelTab`: `serialize?: () => string` — "a TERMINAL pane's live scrollback accessor, a
      renderer-only reference (NEVER IPC/persisted), present ONLY while the pane's PTY is live; a Home
      terminal favorite calls it once on mount to seed its mirror xterm. NON-SECRET by the same standard
      as the already-persisted session scrollback (it is on-screen output)." Mirrors the existing
      `surface` ref-pass precedent. Terminal liveness is encoded by PRESENCE of `serialize` (absent ⇒
      WAITING), so no separate `live` flag is needed.
- [ ] **Add the `mirror` prop to `TerminalView`'s props type** (see Phase 3 for the conditionals).
- [ ] Review types vs spec — no invented properties (the only new fields are `mirror` and the
      `serialize` ref; both trace to FR-005/FR-009).

## Phase 2 — Testing (write first where the logic is pure / branchy)

**node-unit (`.test.ts`, vitest node env):**
- [ ] `src/main/session/sessionSnapshot.test.ts` (or the validators test): `validateFavorites` ACCEPTS a
      `{panelId:'terminal',tabId,label}` favorite; still rejects an unknown panelId; still drops a
      secret-shaped/malformed entry.
- [ ] `src/renderer/cosmos/cosmosTabs.test.ts`: `favoriteId`/`isPinned`/`appendFavorite` work with a
      `terminal` source (idempotent de-dupe by `favoriteId`).
- [ ] `src/renderer/cosmos/homeFavorites.test.ts` (NEW — `homeFavorites` has no test today):
      `toHomeFavorites`↔`favoritesToTabs` round-trip a terminal favorite; `reconcileFavorites` KEEPS a
      terminal favorite when its source group is gone, RELABELS on source rename.

**jsdom (`.dom.test.tsx`):**
- [ ] **FavoriteSurface terminal branch** (`TerminalFavoriteSurface.dom.test.tsx`): GONE (no live tab →
      "no longer open" + Unpin), WAITING (live tab, no `serialize` → calm waiting), POPULATED (live tab +
      `serialize` → renders the mirror and seeds `initialScrollback` from `serialize()`). Mock the heavy
      terminal/Monaco imports (see Phase 3 note) + a fake `window.cosmos.pty`.
- [ ] **Non-owning behavior** (the load-bearing guarantee, SC-004): mounting then unmounting the mirror
      `TerminalView` (`mirror`) calls NEITHER `window.cosmos.pty.start` NOR `pty.dispose` NOR `pty.restart`;
      the owning view (no `mirror`) still calls `start` on mount + `dispose` on unmount (regression guard).
- [ ] **Resize guard** (SC-006): a `TerminalView` whose container measures 0 (hidden) does NOT call
      `pty.resize`; a measurable one does. (Drive via a mocked `fitAddon.fit()` throw / 0-size container,
      or test an extracted pure `shouldDriveResize(container)` helper.)
- [ ] **Tree + pin** (`CosmosFavoriteTabs.dom.test.tsx` / `PanelTabTree` test): a Terminal-group row's
      right-click menu now offers **Pin** (not the disabled item); pinning a terminal source appends a
      favorite; the row shows the pinned mark.
- [ ] **CosmosPanel**: `handlePin`/`handleUnpin`/`isSourcePinned` no longer no-op for `'terminal'`
      (pin a terminal source → favorite tab appears after the default; unpin removes it; active favorite
      unpin → default).

**node-integration:** NOT required — no main/PTY contract changes (the fan-out is renderer-side over the
existing per-paneId channels). Note this explicitly so no one adds a redundant `ptyManager` integration test.

## Phase 3 — Implementation

### 3a. The `TerminalView` `mirror` (non-owning) mode — reuse in place, keep the owning path 100% unchanged

In `src/renderer/terminal/TerminalPanel.tsx`, add `mirror?: boolean` (default `false`) to `TerminalView`
and gate ONLY these branches on it (every existing owning-path behavior is untouched when `mirror` is false):

- [ ] **Export `TerminalView`** so `FavoriteSurface` can reuse it (currently module-local).
- [ ] **No PTY lifecycle ownership (FR-005).**
      - Spawn: `if (autoStart && !mirror) window.cosmos.pty.start(paneId)`.
      - Unmount cleanup: `if (!mirror) window.cosmos.pty.dispose(paneId)`.
      - Exit-banner Restart: in `mirror` mode render the exit text READ-ONLY (no "Restart claude" button;
        `handleRestart` is unreachable). (FR-015)
- [ ] **Always-live, no picker (mirror is only mounted when the source PTY is live).** Initialize
      `phase` as `mirror ? 'live' : (autoStart ? 'live' : 'awaiting')`; the `[Open a folder]` welcome CTA
      branch and `handleOpen` are never shown/used in mirror mode (they're gated by `!live`, which is true
      in mirror).
- [ ] **Terminal pane only — exclude the explorer split (FR-017).** Render only the terminal column in
      mirror mode (no dividers, no viewer, no tree dock). Keep the hook call unconditional (rules of hooks)
      but force it inert: `useExplorerPanes(paneId, mirror ? false : live, …)` — `live=false` keeps the
      explorer hook inert (no `fs:*` reads) and Monaco is never MOUNTED at runtime (it's only mounted by the
      rendered viewer, which mirror omits). Rationale to bake into the comment: explorer state (open files,
      Monaco models, `fs:*`) is per-mount imperative state that can't be referenced across two mounts, so it
      is deliberately not mirrored (a second mount would get its own independent state) — only the genuinely
      shared PTY/`pty:data` is mirrored.
- [ ] **Seed scrollback (FR-009).** `mirror` reuses the EXISTING `initialScrollback` prop path verbatim:
      `FavoriteSurface` passes `initialScrollback={live.serialize()}` (the source pane's current buffer),
      pre-written before the live `pty:data` subscription attaches. The seed/subscribe micro-race (a few
      lost/duplicated bytes) is accepted for v1 (perfect replay would need sequence-numbered `pty:data` —
      out of scope; note in comment).
- [ ] **Data fan-out + input (FR-006/FR-007/FR-008).** No change needed — the existing per-paneId
      `pty.onData` subscription + `term.onData → pty.sendInput({paneId})` are reused as-is; the preload
      multiplexes subscribers. Only the focused on-screen view receives keystrokes (xterm focus is DOM-scoped).
- [ ] **Mirror passes no-op panel callbacks.** `registerSerializer`, `onOpenFilesChange`,
      `onViewerStateChange` are required props but irrelevant to a mirror → `FavoriteSurface` passes no-ops
      (the mirror is not part of the Terminal panel's serializer/open-files bookkeeping).

> **jsdom-test note (the one wrinkle):** `TerminalPanel.tsx` statically imports the explorer/Monaco. To
> keep `FavoriteSurface`'s terminal branch jsdom-testable (Monaco crashes jsdom — the reason
> `SharedComposer` was extracted), the `.dom.test` mocks the terminal module (or `useExplorerPanes`/Monaco).
> If that mock proves brittle, the FALLBACK is to extract the xterm-bound core into
> `src/renderer/terminal/TerminalXterm.tsx` (no Monaco import) that both `TerminalPanel` and the mirror
> compose. Default to reuse-in-place per the coordinator's steer; the extraction is a clean fallback, not v1
> scope unless the mock is unworkable. **(Confirm — see Open confirmations.)**

### 3b. Publish the terminal scrollback serializer (FR-009 transport)

- [ ] In `src/renderer/terminal/TerminalPanel.tsx`, the `livePanelTabs` memo maps each tab to also carry
      `serialize` **only for live panes**: `serialize: isPaneLive(t.id) ? () => serializersRef.current.get(t.id)?.() ?? '' : undefined`.
      The closure reads `serializersRef` lazily (the serializer registers after publish, so a lazy read is
      required; the memo must NOT depend on the ref).
- [ ] **Liveness signal.** Add a minimal per-pane live reporter mirroring the existing
      `onOpenFilesChange`/`onViewerStateChange` reporter pattern: `TerminalView` reports `onLiveChange(paneId,
      phase === 'live')` via an effect on `phase`; `TerminalPanel` holds a `livePaneIds` **state Set**
      (state, not ref, so the publish memo re-runs) updated by a stable `handleLiveChange`. The
      `livePanelTabs` memo depends on `[tabs, activeTabId, livePaneIds]`. (Owning views report; the mirror
      does not — it passes a no-op.)

### 3c. The `FavoriteSurface` terminal branch (before the A2UI catalog path) (FR-004/FR-013/FR-014)

- [ ] In `src/renderer/cosmos/FavoriteSurface.tsx`, branch FIRST on `source.panelId === 'terminal'`
      (before the `favoriteCatalogHosts[source.panelId]` lookup, which has no terminal entry). Extract the
      branch into a co-located `TerminalFavoriteSurface` (keeps `FavoriteSurface` lean + isolates the
      terminal/Monaco import for the jsdom split). It reads `live = findLiveTab(registry, 'terminal',
      source.tabId)` and renders:
      - **GONE** (`!live`): reuse the SAME calm "this tab is no longer open" + Unpin block (FR-013).
      - **WAITING** (`live && !live.serialize`): the calm "waiting for this tab's view…" block (FR-014).
      - **POPULATED** (`live.serialize`): `<TerminalView paneId={source.tabId} mirror active autoStart={false}
        initialScrollback={live.serialize()} registerSerializer={noop} onOpenFilesChange={noop}
        onViewerStateChange={noop} />` in the existing favorite content wrapper.

### 3d. Relax the terminal gates (FR-001/FR-002)

- [ ] `src/renderer/cosmos/PanelTabTree.tsx` — `renderRowMenu`: REMOVE the `panelId==='terminal'`
      disabled-Pin special case so terminal rows get the normal state-reflective Pin/Unpin item. The
      `pinned` mark + `isPinned` already light up once `CosmosPanel` stops excluding terminal.
- [ ] `src/renderer/cosmos/CosmosPanel.tsx` — REMOVE the three `if (group.panelId === 'terminal') return`
      early-returns in `handlePin` / `handleUnpin` / `isSourcePinned`. The `handlePin` source becomes
      `{ panelId: group.panelId, tabId: tab.id }` (group.panelId is now a valid `FavoritePanelId`). No other
      CosmosPanel change — the favorite render already dispatches through `FavoriteSurface`.

### 3e. Global resize-guard latent fix (FR-011/FR-012, OQ3 → apply globally)

- [ ] In `TerminalView`'s `pushResize` (and the `active`-effect's fit+resize), only call
      `window.cosmos.pty.resize(...)` when the container is MEASURABLE (fit succeeded / non-zero
      `clientWidth`×`clientHeight`). Today `pushResize` resizes even when `safeFit()` swallowed a throw
      (hidden container) — a hidden view then pushes a stale size. Gate it (e.g. `safeFit()` returns a
      boolean, or check container dims) so ONLY the on-screen view ever drives the PTY size. This benefits
      all terminals (a hidden terminal should never resize the PTY) and makes source↔favorite arbitration
      race-free (the visible view is always the last writer).

## Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` (architect, after implementation): **§4.1/§4.2** — a `paneId` may now
      have MORE THAN ONE bound xterm (source + a Home favorite mirror); only the source view owns
      `pty:start`/`dispose`/`restart`; resize is driven only by the measurable (on-screen) view. **§4.13** —
      the terminal favorite mirrors the terminal pane ONLY; the file-explorer split is excluded BECAUSE its
      per-mount imperative state (Monaco models, `fs:*` open-files) can't be referenced across mounts.
      **§4.14** — terminal tabs ARE pinnable (relax the FR-040 line); a terminal favorite is a renderer-side
      xterm multiplex (non-owning); `FavoritePanelId` widens to `CrossPanelId`; `LivePanelTab` carries a
      terminal `serialize` scrollback-seed ref (renderer-only, non-secret by the persisted-scrollback standard).
- [ ] Reconcile `TODO.md`; update this plan's Deviations with anything that differed.

---

## Reuse surface (what is reused verbatim vs. minimally touched)

| Reused AS-IS | Minimally touched | New |
|---|---|---|
| `TerminalView` xterm/PTY core, `initialScrollback` seed path, `pty.onData/sendInput/resize` wiring, exit banner | `TerminalView` += `mirror` gate (start/dispose/restart/explorer/exit-Restart/resize-guard) | `serialize` ref field on `LivePanelTab` |
| `appendFavorite`/`favoriteId`/`isPinned`/`closeCosmosTab`, `favoritesToTabs`/`toHomeFavorites`/`reconcileFavorites`, `setFavorites` persistence, `findLiveTab` | `FavoritePanelId` + `HomeFavorite.panelId` + `FAVORITE_PANEL_IDS` widen to admit terminal | `TerminalFavoriteSurface` (thin branch) |
| `FavoriteSurface` GONE/WAITING wrappers, `ContextMenu` Pin/Unpin, the tree pinned-mark | `FavoriteSurface` += terminal branch; `PanelTabTree`/`CosmosPanel` drop the terminal exclusions | per-pane `onLiveChange` reporter (mirrors existing reporters) |

## Risks / edge cases carried from the spec

- **Dispose-danger** (the reason `mirror` exists): a naive 2nd mount would `pty.dispose` the shared PTY on
  every Home tab switch → kills the source terminal. FR-005 gate is mandatory; covered by the non-owning
  jsdom test (SC-004).
- **Resize race** across rail switches: solved by the global measurable-guard (3e), not by knowing rail
  visibility. The favorite stays mounted (Home forceMounted) while on the Terminal rail; its hidden 0-size
  container must not resize — the guard ensures it doesn't.
- **Seed micro-race**: accepted for v1 (documented).
- **Awaiting source**: `serialize` is published only for live panes → favorite shows WAITING, never a blank
  terminal.

---

## Open confirmations before dev

1. **Reuse-in-place vs. extract the xterm core.** Plan defaults to reusing `TerminalView` in place (+`mirror`
   prop) per your steer, with the jsdom test MOCKING the Monaco/explorer import. Confirm that's preferred, or
   approve the fallback of extracting `TerminalXterm.tsx` (cleaner test isolation, slightly more move-refactor)
   if the mock is brittle.
2. **WAITING via `serialize`-presence.** Encoding terminal liveness as "`serialize` published only when the
   pane is live" (no separate `live` flag) — adds one small `onLiveChange` reporter to `TerminalView`/
   `TerminalPanel`. Confirm acceptable, or drop WAITING for v1 (awaiting-terminal favorites are a rare corner).
3. **Global resize guard.** Confirm applying the "no resize when non-measurable" fix to ALL terminals (3e),
   not just the mirror — it's a latent-correctness improvement but does change the shared `pushResize` path.

## Deviations & Notes

- **2026-06-30**: Plan authored. No deviations yet (no code written — STOP after plan per the cycle).
</content>
