# Plan: Terminal Open-Directory Picker — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: `.sdd/specs/terminal-open-directory-picker-v1.md`

---

## Grounding

> Direct investigation run for THIS plan (mandatory). Tools were run by the architect, not handed in.

**codegraph_explore**

- `TerminalPanel TerminalView pty.start mount effect paneId handleNewTab mintTab PtyManager start PaneSpawnOptions cwd paneSpawnFor PtyChannel PtyStartPayload` — confirmed the auto-spawn point: `TerminalView`'s mount effect calls `window.cosmos.pty.start(paneId)` unconditionally at `src/renderer/TerminalPanel.tsx:171`, right after wiring `onData`/`onExit`/`onData`/resize subscriptions. The view is mounted for EVERY tab (kept mounted, hidden via inline `display`), so deferring the spawn means gating that one line on an "awaiting directory" state. `TerminalPanel.handleNewTab` just `open(mintTab())`s — the spawn is driven entirely by the view mounting. The ≥1-tab guard re-seeds a default tab when the collection empties (`tabs.length === 0` effect).
- `PtyManager.start / PaneSpawnOptions / paneSpawnFor` — `PaneSpawnOptions.cwd` ALREADY exists (`src/main/ptyManager.ts:87`); `PtyManager.start(paneId, opts)` resolves `pane.cwd ?? this.options.cwd` (`ptyManager.ts:190`). The per-pane cwd spawn path is real — REUSE it (FR-004). The cwd that lands today comes from `paneSpawnFor(paneId, sandboxDirCached)` (`index.ts:281`), which returns `cwd: sandboxDir` for a fresh (non-resume) pane and `cwd: resume.cwd` for a resumed pane.

**Reading the IPC contract + wiring** (`src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/validate.ts`)

- `PtyChannel` = `Data/Input/Resize/Exit/Restart/Start/Dispose`. `PtyStartPayload` carries ONLY `{ paneId }`. The `pty:start` handler (`index.ts:655`) validates via `validateStart` (→ `validatePaneId`) then `ptyManager?.start(payload.paneId, paneSpawnFor(payload.paneId, sandboxDirCached))`. **There is no directory-picker channel and no `cwd` field on `pty:start` today.**
- The preload `ptyApi.start(paneId)` sends `{ paneId }` (`src/preload/index.ts:76`). Validators live in `src/shared/validate.ts` (`validateStart`, `validateInput`, `validateResize`, `validatePaneId`) and each warns + returns null on a bad payload (SC-005 discipline). Grep for `showOpenDialog`/`dialog.` across `src/` returns NOTHING — a native OS dialog is net-new.
- `terminalResumeMap`/`terminalSessionMap` (`index.ts:264/273`): a restored tab is seeded into `terminalResumeMap` at `session:load`, so its first `pty:start` resumes `--resume <id>` with the persisted cwd. A fresh tab is NOT in the resume map. This is exactly the seam for OQ-2: restored tabs keep auto-resuming because they go through the resume branch of `paneSpawnFor`, untouched by this feature.

**memory_recall / memory_smart_search**

- `terminal pty spawn cwd ptyManager TerminalPanel start session restore` — one relevant memory: session-resume uses `--session-id`/`--resume`, sessions are dir-scoped, embedded `claude` runs in the fixed sandbox cwd (`userData/sandbox`) by default. This feature overrides that sandbox cwd per-tab at spawn time for NEWLY-opened tabs only; restored tabs keep their persisted cwd. No conflicting prior decision on a directory picker.

---

## Summary

Defer a freshly-opened Terminal tab's `claude` spawn until the user picks a working directory. Today `TerminalView`'s mount effect calls `window.cosmos.pty.start(paneId)` unconditionally; this feature gates that call behind a per-tab "awaiting directory" state that renders an **[Open]** affordance instead. Clicking [Open] calls a NEW request/response IPC method (`window.cosmos.pty.pickDirectory()`) that runs `dialog.showOpenDialog({ properties: ['openDirectory'] })` in MAIN and resolves with the chosen absolute path or `null` (cancel). On a non-null path the renderer issues `pty.start(paneId, { cwd })`; `pty:start` gains an OPTIONAL `cwd` that `paneSpawnFor` honours as an override for a fresh (non-resume) spawn, REUSING the existing `PaneSpawnOptions.cwd` path. Cancel leaves the tab in the [Open] state with no spawn and no error. Restored (resume-mapped) tabs and per-tab Restart are untouched — they keep their persisted/previous cwd. The technical approach adds exactly: one new typed IPC channel + payload/result types + preload method, one boundary validator, one main `dialog.showOpenDialog` handler, an optional `cwd` on the existing `pty:start` contract, and a renderer "awaiting" state gate + [Open] button in `TerminalView`.

## Technical Context

| Item              | Value                                                                                                                                                   |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + React renderer), Vitest                                                                                          |
| Key dependencies  | Electron `dialog` (main), existing `PtyManager` per-pane `cwd` spawn path, `node-pty`, xterm.js (renderer)                                              |
| Files to create   | none (all changes extend existing modules; new tests go beside existing `*.test.ts`)                                                                   |
| Files to modify   | `src/shared/ipc.ts`, `src/shared/validate.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/TerminalPanel.tsx`, `src/shared/validate.test.ts`, `src/main/index.test.ts` (or the relevant main test file) |

### New IPC / preload surface introduced

All names go through `src/shared/ipc.ts` — NO ad-hoc channel strings anywhere (CLAUDE.md). The chosen path is a user-selected local filesystem path; it is NOT a secret, but it still travels only over the validated typed boundary and is never logged in violation of conventions. NO token/secret rides on any new payload.

1. **New channel constant** on `PtyChannel`:
   - `PickDirectory: 'pty:pickDirectory'` — R→M, request/response (`ipcRenderer.invoke` / `ipcMain.handle`). Opens the native OS directory picker and resolves with the chosen path or null. Modelled on the request/response `invoke` style already used by `session:load`/`settings:*`, NOT the fire-and-forget `send` style of the other `pty:*` channels.
2. **New payload + result types**:
   - `PtyPickDirectoryRequest` — `Record<string, never>` (carries NO field today; the picker uses the OS default location per OQ-4, no `defaultPath`). Typed so a future `defaultPath` is additive.
   - `PtyPickDirectoryResult` — `{ path: string } | { path: null }` (or `{ path: string | null }`): `path` is the chosen absolute directory, or `null` when the user cancelled/dismissed (FR-006). NO error field — cancel is a normal, error-free outcome.
3. **Extend the EXISTING `PtyStartPayload`** with an OPTIONAL `cwd?: string`:
   - Present only when the renderer is spawning a freshly-picked tab. Absent for the restored/normal path (backward-compatible — the field is additive and optional). When present, it is the chosen working directory for a fresh spawn.
4. **New preload method** on `PtyApi` (`window.cosmos.pty`):
   - `pickDirectory(): Promise<PtyPickDirectoryResult>` — wraps `ipcRenderer.invoke(PtyChannel.PickDirectory)`.
   - **Extend the existing** `start(paneId: string, opts?: { cwd?: string }): void` to forward an optional cwd in the `{ paneId, cwd? }` send payload. (Existing callers pass no second arg — unchanged.)
   - **CRITICAL (CLAUDE.md):** adding `pickDirectory` is a NET-NEW `window.cosmos.*` preload method. It requires a FULL `npm run dev` restart — HMR alone leaves `window.cosmos.pty.pickDirectory` as "not a function". Changing `start`'s signature is the same preload module, also needs the restart. Call this out at the top of the implementation checklist.

### Boundary validation (FR-008, SC-005)

- `validateStart` must now accept an OPTIONAL `cwd`: still require a non-empty `paneId`; if `cwd` is present it MUST be a non-empty string (else warn + ignore the whole payload — never crash). Return `{ paneId, cwd? }`. Reuse the existing `isNonEmptyString` helper. An absent `cwd` is valid (the normal/restore path).
- `pty:pickDirectory` is request/response with no meaningful inbound payload; the handler validates nothing inbound but MUST tolerate any junk arg (ignore it). The RESPONSE is constructed entirely in main from the dialog result, so there is no renderer-supplied data to validate on the way back.
- No new validator file — extend `src/shared/validate.ts` and its test.

### Main-process spawn wiring (FR-004 — REUSE, do not invent)

- `paneSpawnFor(paneId, sandboxDir)` gains an OPTIONAL override cwd param (e.g. `paneSpawnFor(paneId, sandboxDir, overrideCwd?)`). For the RESUME branch the override is IGNORED (a resumed tab keeps its persisted cwd — OQ-2). For the FRESH branch, when an override cwd is present it replaces `sandboxDir` as the spawned `cwd` (and as the cwd recorded in `terminalSessionMap` so a later save/persist captures the chosen dir). The `pty:start` handler passes `payload.cwd` through.
- This keeps the spawn flowing through the SAME `PtyManager.start` → `PaneSpawnOptions.cwd` path; no new spawn option is invented (FR-004).

### Renderer state model (FR-001, FR-005, FR-006, FR-007, FR-009)

- `TerminalView` gains an "awaiting directory" state (e.g. a `phase: 'awaiting' | 'live'` distinct from the existing `exitState`). On mount, instead of calling `pty.start(paneId)`, it stays in `awaiting` and renders the [Open] affordance over the xterm container (which is still constructed so output/resize subscriptions are wired and ready). The mount effect's subscription setup (`onData`/`onExit`/`onData input`/resize) stays as-is; ONLY the `window.cosmos.pty.start(paneId)` line (~`TerminalPanel.tsx:171`) becomes conditional — it fires when the user picks a directory, not on mount.
- [Open] handler: `const res = await window.cosmos.pty.pickDirectory(); if (res.path) { window.cosmos.pty.start(paneId, { cwd: res.path }); setPhase('live') } /* else: stay awaiting, no error */`.
- Per-tab independence (FR-007): the awaiting state lives inside each `TerminalView` instance keyed by `paneId`, so each tab's [Open]→pick→spawn touches only its own pane; other tabs are untouched. The newly-seeded first/default tab (clean session, or after closing the last tab) renders a `TerminalView` exactly like any other, so it ALSO starts in `awaiting` (FR-009) — no special-casing needed.
- **Restored tabs (OQ-2):** a restored `TerminalView` already pre-writes `initialScrollback` and is expected to AUTO-RESUME. These tabs must NOT enter the awaiting state. Discriminator: a restored tab is one hydrated from the snapshot (it has `initialScrollback` and/or is seeded in main's `terminalResumeMap`). Pass a prop (e.g. `autoStart`/`resume`) from `TerminalPanel` down to `TerminalView` so a restored/resumed tab keeps the unconditional `pty.start(paneId)` on mount (no cwd override), while a freshly-minted tab defers. `TerminalPanel.mintTab` produces fresh tabs (defer); `hydrateTerminalTabs` produces restored tabs (auto-start). Wire the flag off that distinction.
- **Restart after exit (OQ-1):** the existing exit banner's "Restart claude" calls `pty.restart(paneId)`, which in main restarts in the previously-recorded cwd (`terminalSessionMap`/`PtyManager.restart`). UNCHANGED — a post-pick exited tab restarts in the same chosen cwd, NOT a re-pick (least change). No work here beyond confirming Restart is not routed through the awaiting state.
- **Tab closed while picker open (OQ-3):** tab close is NOT blocked while the dialog is open. If a directory is returned for a tab whose `TerminalView` has since unmounted, the `await` resolves into an unmounted component — guard the post-await `pty.start` with a mounted check (e.g. an `isMounted` ref cleared in the effect cleanup, or ignore if the component unmounted) so NO orphan spawn is issued. Additionally, main's `pty:start` handler already only spawns for a live `paneId` map; a stale `cwd` for a disposed pane simply spawns nothing harmful — but the renderer-side mounted guard is the primary defence (no IPC sent at all).

### Out of scope (from the spec — do NOT build)

Remembering last-used directory, recent-dirs list/favorites, manual path entry, changing cwd of an already-live terminal, multi-directory selection, persisting the awaiting state beyond existing session-persistence behavior.

---

## Implementation Checklist

> Update as work progresses; add inline notes when a step deviates.

### Phase 0 — Preconditions / gotchas

- [ ] **RESTART REQUIRED:** after the preload edit (new `pickDirectory` + changed `start` signature), do a FULL `npm run dev` restart — HMR leaves `window.cosmos.pty.pickDirectory` as "not a function" and the new `start` arg silently undelivered (CLAUDE.md).
- [ ] Re-read the spec; all four Open Questions are resolved by the accepted defaults (OQ-1 same-cwd restart, OQ-2 restored tabs unchanged, OQ-3 ignore selection for an absent tab, OQ-4 OS default location). No open questions remain.
- [ ] A **design step follows this plan** (`designer`, `.sdd/designs/terminal-open-directory-picker-v1.md`) for the [Open] empty-state visual (button placement, label, terminal-area treatment while awaiting). Do NOT finalize the visual treatment here — the renderer change should land a minimal, behavior-correct [Open] affordance the designer then styles.

### Phase 1 — Interface (`src/shared/ipc.ts`)

- [ ] Add `PickDirectory: 'pty:pickDirectory'` to the `PtyChannel` const (with a doc comment: R→M invoke, opens the native OS directory picker, resolves chosen path or null; NO secret).
- [ ] Add `PtyPickDirectoryRequest` (= `Record<string, never>`, OS-default location per OQ-4) and `PtyPickDirectoryResult` (`{ path: string | null }`, null = cancel) types.
- [ ] Add OPTIONAL `cwd?: string` to `PtyStartPayload` with a doc comment: present only when spawning a freshly-picked tab; absent for the restore/normal path (additive/backward-compatible).
- [ ] On `PtyApi`: add `pickDirectory(): Promise<PtyPickDirectoryResult>`; change `start(paneId: string): void` → `start(paneId: string, opts?: { cwd?: string }): void`. Doc-comment both, noting the preload-restart requirement.
- [ ] Review the added types against the spec — no invented fields (no `defaultPath`, no error field on the result, no token/secret anywhere).

### Phase 2 — Boundary validation (`src/shared/validate.ts` + test)

- [ ] Extend `validateStart` to accept an optional `cwd`: require non-empty `paneId`; if `cwd` is present, require a non-empty string (else warn + ignore the whole payload); return `{ paneId, cwd? }`. Reuse `isNonEmptyString`.
- [ ] In `src/shared/validate.test.ts`: happy path with no `cwd` (unchanged behavior); happy path WITH a valid `cwd`; invalid `cwd` (empty string / non-string) → warned + null; missing `paneId` still → null.

### Phase 3 — Main process (`src/main/index.ts`)

- [ ] Register `ipcMain.handle(PtyChannel.PickDirectory, …)`: call `dialog.showOpenDialog(mainWindow ?? undefined, { properties: ['openDirectory'] })` (OS default location, single directory). Return `{ path: result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] }`. Wrap so any dialog error resolves to `{ path: null }` rather than rejecting (cancel-like, no crash). Import `dialog` from `electron`.
- [ ] Thread an optional override cwd through `paneSpawnFor(paneId, sandboxDir, overrideCwd?)`: RESUME branch ignores it (persisted cwd wins — OQ-2); FRESH branch uses `overrideCwd ?? sandboxDir` for both the spawned `cwd` and the `terminalSessionMap` record.
- [ ] Update the `pty:start` handler (`index.ts:655`) to read the validated `payload.cwd` and pass it: `ptyManager?.start(payload.paneId, paneSpawnFor(payload.paneId, sandboxDirCached, payload.cwd))`.
- [ ] Confirm no path/cwd is logged in violation of conventions; the picker result and chosen cwd carry no secret (FR-010) but follow existing non-logging discipline.
- [ ] Main test: a `pty:start` WITH a `cwd` spawns with that cwd; a fresh `pty:start` WITHOUT a `cwd` still spawns in the sandbox cwd; a RESUME-mapped pane ignores any override and keeps its persisted cwd (OQ-2). (Use the injectable `spawn` / existing main test seams.)

### Phase 4 — Preload (`src/preload/index.ts`)

- [ ] Add `pickDirectory(): Promise<PtyPickDirectoryResult> { return ipcRenderer.invoke(PtyChannel.PickDirectory) }` to `ptyApi`.
- [ ] Change `start(paneId, opts?)` to send `{ paneId, ...(opts?.cwd ? { cwd: opts.cwd } : {}) }` over `PtyChannel.Start`.
- [ ] (No new top-level `window.cosmos.*` namespace — `pickDirectory` lives under the existing `pty` surface.)

### Phase 5 — Renderer (`src/renderer/TerminalPanel.tsx`)

- [ ] Add a per-view phase: `awaiting` vs `live`. A FRESH tab mounts in `awaiting`; a RESTORED/resumed tab mounts in `live` and keeps the unconditional `pty.start(paneId)` on mount (OQ-2).
- [ ] Pass an `autoStart` (or `resume`) prop from `TerminalPanel` to `TerminalView`: true for hydrated/restored tabs, false for `mintTab`-created tabs (incl. the seeded first/default tab — FR-009). Wire it off the hydrate-vs-mint distinction.
- [ ] In `TerminalView` mount effect: KEEP all subscriptions (`onData`/`onExit`/input/resize) wired so the pane is ready; make ONLY the `window.cosmos.pty.start(paneId)` call conditional — fire on mount when `autoStart`, otherwise defer to the [Open] handler.
- [ ] Render the [Open] affordance while `phase === 'awaiting'` (minimal behavior-correct button; designer styles later). On click: `const res = await window.cosmos.pty.pickDirectory(); if (res.path && isMounted) { window.cosmos.pty.start(paneId, { cwd: res.path }); setPhase('live') }`. On cancel (`res.path === null`): stay `awaiting`, no error (FR-006).
- [ ] Add an `isMounted` ref cleared in the effect cleanup so a selection returned after the tab closed is ignored (no orphan spawn — OQ-3). Do NOT block tab close while the dialog is open.
- [ ] Confirm the ≥1-tab re-seed effect and `handleNewTab` are unchanged — a re-seeded default tab is a fresh tab and naturally starts in `awaiting` (FR-009).
- [ ] Confirm "Restart claude" (exit banner) still calls `pty.restart(paneId)` and restarts in the same cwd (OQ-1) — it must NOT route back through the awaiting/[Open] state.

### Phase 6 — Verify against success criteria

- [ ] SC-001: a newly-opened tab shows [Open] and spawns ZERO `claude` until a directory is chosen (assert no `pty:start` fires on mount for a fresh tab).
- [ ] SC-002: clicking [Open] opens the dialog; selecting spawns `claude` with `cwd` = chosen dir.
- [ ] SC-003: cancel leaves the tab [Open], no spawn, no error.
- [ ] SC-004: two tabs launch into two different directories independently.
- [ ] SC-005: a malformed `pty:start` (bad `cwd`) is warned + ignored at the main boundary; no crash.
- [ ] SC-006: no token/secret in the new channel, preload method, or any payload.
- [ ] `npm run typecheck` (node + web) and `npm test` pass.

### Phase 7 — Docs (architect-owned follow-up — NOT in this plan's edits)

- [ ] **Do NOT edit `docs/ARCHITECTURE.md` during this work** (concurrent-edit hazard; architect owns it). After this lands, the architect updates `docs/ARCHITECTURE.md` §4.1/§4.11: a fresh terminal tab now DEFERS its `pty:start` until the user selects a directory (it no longer auto-spawns on view mount); restored tabs still auto-resume with their persisted cwd. Tracked here so the doc does not drift.
- [ ] Update `TODO.md` / mark this plan's items done at wrap-up.
- [ ] Update this plan's Deviations section with anything that differed.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-18**: Plan authored. Open Questions resolved via accepted spec defaults (OQ-1 same-cwd restart, OQ-2 restored tabs auto-resume unchanged, OQ-3 ignore selection for an absent tab / don't block close, OQ-4 OS default picker location).
- **2026-06-19**: Implemented Steps 3-5 (interface/tests/code). Deviations from plan:
  - **Pure spawn resolver extracted** (not in the plan's file list): the plan said to thread an override cwd through the in-`index.ts` `paneSpawnFor`, but `index.ts` has top-level Electron side effects and is not unit-testable as a module. To honour the `.ts`/`.test.ts` split + the plan's "main test" requirement, the resolution logic was extracted to a NEW pure module `src/main/paneSpawn.ts` (`resolvePaneSpawn(paneId, sandboxDir, resumeMap, sessionMap, mintSessionId, overrideCwd?)`) with maps + the id-minter injected. `index.ts`'s `paneSpawnFor(paneId, sandboxDir, overrideCwd?)` now delegates to it. New test `src/main/paneSpawn.test.ts` covers FR-004 override, empty-string fallback, resume-ignores-override (OQ-2), per-pane independence (FR-007).
  - **`validateStart` cwd tests** added as a dedicated `describe` in `src/shared/validate.test.ts` (the existing shared `describe.each` block for start/restart/dispose stayed valid since `{paneId}`→`{paneId}` is unchanged).
  - **Renderer awaiting/live render**: the [Open] empty state renders when `phase==='awaiting'`; the xterm container stays mounted but `display:none` while awaiting (subscriptions stay wired). Exit banner branch only shows in `live`. `autoStart` derives from a `restoredTabIdsRef` Set captured once from the snapshot (hydrate-vs-mint distinction).
  - **Test count**: 1367 → 1381 (+9 paneSpawn, +5 validateStart cwd). Typecheck (node+web) green.
  - **Preload surface CHANGED** (new `pty.pickDirectory`, changed `pty.start` signature) → a full `npm run dev` restart is required before the feature works live.
