# Plan: Persist Working Directory & File-Explorer Open Files — v1

**Status**: Draft
**Created**: 2026-06-21
**Last updated**: 2026-06-21
**Spec**: .sdd/specs/persist-workdir-open-files-v1.md

---

## Grounding

> Direct investigation run for this plan (codegraph + agentmemory). One-line takeaways follow each query.

**codegraph_explore**
- `SessionRegistry report buildTerminalPanel buildTerminalDraft TerminalPanelDraft sessionSnapshot.ts renderer enrich cwd scrollback save coordinator` — save path is: each panel `report`s a draft to `SessionRegistry` (`src/renderer/sessionRegistry.ts`) → `assembleSnapshot` → debounced `window.cosmos.session.save`. The terminal draft (`buildTerminalDraft`, `src/renderer/sessionSnapshot.ts`) carries renderer-known fields; **main enriches `sessionId`/`cwd` per tab at the save boundary (D2)**. `SessionRegistry` already has a non-panel `setEnabled` contribution (#93's precedent).
- (prior session) `validateSnapshot` (`src/main/sessionSnapshot.ts`) is the normalize-or-null boundary: wrong `schemaVersion` → `null` → clean session; `validateTerminalTab` requires non-empty `id`/`sessionId`/`cwd`, defaults `label`, passes through optional `renamed`/`scrollback`; bad tabs are dropped, never fatal.
- (prior session) `useFileExplorer` (`src/renderer/fileExplorer/useFileExplorer.ts`, lines 134–173) resets `OpenFilesState` to `EMPTY_OPEN_FILES` on every go-live and reads each open file via `fs:read`; `openFiles.ts` holds the pure `OpenFilesState` (`{ files: OpenFile[]; activeRelPath }`, keyed by root-relative path).
- (prior session) `TerminalPanel.tsx` restores tabs from `useRestoredTerminalPanel()`, auto-resumes restored tabs, and `TerminalTabSnapshot.cwd` already persists the per-tab directory; `resolvePaneSpawn` (`src/main/paneSpawn.ts`) reuses the stored cwd on resume.

**memory_recall / memory_smart_search**
- `session persistence snapshot schema version migration working directory cwd` / `terminal file explorer split working directory open files multi-file tabs session persistence` — no prior stored memory (empty before this cycle).
- Persisted the central finding for this cycle via `memory_save` (mem id `mem_mqmhildb_f6b0ea52c6fe`): terminal cwd already persisted; open-files are the real gap; schema v7 with concurrent #93 reconciliation.

---

## Summary

The working-directory half of this feature is **already implemented**: each terminal tab persists
its `cwd` in `TerminalTabSnapshot`, and restored tabs auto-resume in that directory via
`resolvePaneSpawn`. So that half is a **verify-and-cover** effort (assert the behavior, add the
missing regression coverage), not a rebuild. The net-new work is persisting and restoring the
**per-tab file-explorer open-files state** — the ordered set of open files plus the active/focused
file — reversing the deliberate `EMPTY_OPEN_FILES` wipe in `useFileExplorer.ts:139–141`. The chosen
approach **co-locates the open-files state on the existing `TerminalTabSnapshot`** (a new optional
`openFiles?: { files: string[]; activeRelPath: string | null }` of root-relative paths), because the
tab already owns the per-pane identity and `cwd`; this reuses the established terminal save/restore
pipeline (renderer `buildTerminalDraft` → main per-tab enrichment → `validateTerminalTab` boundary →
`hydrateTerminalTabs`) rather than inventing a second persistence channel. On restore, `useFileExplorer`
seeds its open-files collection from the restored slice instead of emptying it, and **re-reads each
file's content from disk via the existing `fs:read`** (no file contents are ever persisted). All
degradation (missing dir, vanished file, missing active, malformed value, wrong version) routes
through the existing `validateSnapshot`/`fs:read` calm-state machinery. The snapshot change is a
**single coherent schema-version bump composed on top of #93's `enabled` change**, sequenced to land
after #93.

## Technical Context

| Item              | Value                                                                                                   |
|-------------------|---------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer; Vitest node env for pure modules)                           |
| Key dependencies  | Existing session-persistence pipeline (`SessionRegistry`, `validateSnapshot`), file-explorer `fs:*` IPC, `node-pty`/`resolvePaneSpawn` (no new deps) |
| Files to create   | None (extend existing modules + add cases to existing `.test.ts` files)                                 |
| Files to modify   | `src/shared/ipc/session.ts` (schema version + `TerminalTabSnapshot.openFiles`); `src/main/sessionSnapshot.ts` (`validateTerminalTab` normalization); `src/renderer/sessionSnapshot.ts` (`TerminalTabDraft` + `buildTerminalDraft` + `hydrateTerminalTabs`); `src/renderer/TerminalPanel.tsx` (thread per-pane open-files into the draft + pass restored slice down); `src/renderer/fileExplorer/useFileExplorer.ts` (seed from restored slice instead of `EMPTY_OPEN_FILES`; report changes); `src/renderer/fileExplorer/FileExplorer.tsx` (plumb the restored slice + report callback if needed); main per-tab save-boundary enrichment (`src/main/index.ts` / wherever `sessionId`/`cwd` are filled); tests for each |
| Design step       | **SKIPPED** — see "Design step" below.                                                                  |

### Design step

**Skipped.** This is invisible persistence/state plumbing: restore re-instates already-existing
file-explorer tabs and the already-existing viewer, using surfaces, components, and styles that
already ship (terminal-file-tabs-v1 / terminal-file-explorer-v1). No new surface, no new visual
component, no theme-token or `src/renderer/components/ui/` change. The user-visible delta is purely
"the same files are already open after relaunch" — no design system work. (Confirms the orchestrator's
read.) If, during implementation, a *new* visual affordance is discovered to be required (it is not
anticipated), pause and route to `designer`.

### Hard constraint — schema version & migration ordering (CRITICAL)

- The session snapshot is shared with the concurrently-landing **#93 Settings redesign**, which adds
  the top-level `enabled` map and bumped the schema to **`SESSION_SCHEMA_VERSION = 7`** in the main
  tree. (A worktree copy at `.claude/worktrees/agent-ab393954505248475` is still pre-`enabled`; ignore
  it — the main tree is authoritative.)
- **This feature MUST sequence after #93's snapshot change has landed in main.** It bumps **from 7 to
  8** (the next integer), never forking or racing the version.
- The new version's doc-comment migration note (in `SESSION_SCHEMA_VERSION`'s JSDoc) MUST be **appended
  after** the existing `v7` note, in order, describing: "v8 (persist-workdir-open-files-v1): each
  terminal tab gains an optional `openFiles` slice (root-relative open paths + active path). A v7
  snapshot lacks it; restoring under v8 simply yields no restored open files for those tabs (safe
  default)." Within v8, a present-but-malformed `openFiles` is normalized at the boundary.
- **Do NOT touch, drop, or reorder #93's `enabled` field or its `validateEnabled` normalization.** The
  new normalization is **additive** inside `validateTerminalTab`; `validateSnapshot`'s `enabled:
  validateEnabled(value.enabled)` line stays exactly as-is. Both features' fields must coexist in the
  v8 snapshot (SC-008).
- Because v8 invalidates v7 (any version mismatch → clean session), the first relaunch after upgrade
  drops the prior session once. This is the established, accepted behavior of every prior bump
  (v3–v7) and is acceptable here.

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates from plan.

### Phase 0 — Sequencing gate

- [x] Confirm #93's `enabled` snapshot change is merged in the **main** tree and `SESSION_SCHEMA_VERSION === 7` before starting (the rebase/sequence constraint). If not yet landed, STOP and wait — do not fork the schema. (Verified: main at v7 with `enabled: validateEnabled(...)`.)

### Phase 1 — Interface (types & contract)

- [x] Re-read the spec; confirm no open questions remain (spec has none blocking).
- [x] In `src/shared/ipc/session.ts`: add `openFiles?: { files: string[]; activeRelPath: string | null }` to `TerminalTabSnapshot` (root-relative paths only; non-secret — mirror the `cwd` doc note that no absolute path/token is stored). Trace it to spec FR-003/FR-006.
- [x] Bump `SESSION_SCHEMA_VERSION` 7 → 8 and **append** a v8 JSDoc migration note after the v7 note (do not edit the v7 note).
- [x] In `src/renderer/sessionSnapshot.ts`: extend `TerminalTabDraft` with the same optional `openFiles` shape (renderer-known, so it is carried in the draft, not enriched by main).
- [x] Review the new types vs spec — no invented properties (only `files: string[]` + `activeRelPath`; NO file contents, NO tree expansion, NO scroll/selection — those are out of scope per spec).

### Phase 2 — Testing (write first / alongside)

Pure-module tests (node env — these are the load-bearing safety net):

- [x] `src/main/sessionSnapshot.test.ts`: `validateTerminalTab` accepts a valid `openFiles` (array of non-empty strings + string-or-null `activeRelPath`) and round-trips it.
- [x] `validateTerminalTab` normalizes a malformed `openFiles`: non-array `files` → omit/empty; non-string entries dropped; `activeRelPath` not naming a surviving open path → `null`; missing `openFiles` → tab restores with none (safe default). (Spec FR-012/FR-009/FR-010.)
- [x] A v7 (or any non-8) snapshot → `validateSnapshot` returns `null` → clean session (version-bump regression). (Spec FR-011/SC-006.)
- [x] **Co-existence test**: a v8 snapshot carrying BOTH `enabled` and per-tab `openFiles` validates with both preserved — neither clobbers the other. (Spec FR-014/SC-008.)
- [x] `src/renderer/sessionSnapshot.test.ts` (add if absent): `buildTerminalDraft` carries `openFiles` for a pane when supplied, omits it when empty; `hydrateTerminalTabs` surfaces the restored `openFiles` slice per tab.

Behavior/state tests:

- [x] `src/renderer/fileExplorer/openFiles.test.ts` (or a new hydrate helper's test): seeding a non-empty `OpenFilesState` from a restored slice; active falls back when the restored active path is absent.
- [x] Working-dir verify-and-cover: a regression asserting a restored `TerminalTabSnapshot.cwd` is reused on resume via `resolvePaneSpawn` (cover the existing behavior so a future change can't silently drop it). (Spec FR-001/FR-002/SC-001.)

### Phase 3 — Implementation

Main boundary:

- [x] In `src/main/sessionSnapshot.ts` `validateTerminalTab`: after the existing required-field check, normalize `openFiles` **additively** — keep only string entries in `files`, set `activeRelPath` to a surviving member or `null`, omit the field entirely when there is nothing valid. Do NOT alter the `enabled`/`validateEnabled` line in `validateSnapshot`.

Renderer save path:

- [x] In `src/renderer/sessionSnapshot.ts` `buildTerminalDraft`: accept a per-pane open-files map (paneId → `OpenFilesState`, analogous to the existing `scrollbackByPane`), and attach `openFiles` to each tab's draft when present/non-empty.
- [x] In `src/renderer/TerminalPanel.tsx`: collect each live pane's current `OpenFilesState` (register a per-pane accessor the way scrollback serializers are registered, OR lift the open-files state report through the existing `report('terminal', …)`), and pass it into `buildTerminalDraft`. Pass the restored per-tab `openFiles` slice down to each tab's file explorer (via the restored-tab map already captured in `restoredTabIdsRef`/`hydrateTerminalTabs`).

Renderer restore path (the core reversal):

- [x] In `src/renderer/fileExplorer/useFileExplorer.ts`: **replace the unconditional `setOpenFiles(EMPTY_OPEN_FILES)` on go-live (lines ~139–141)** with seeding from the restored slice when one is supplied for this pane (else empty as before). On seed, fire an `fs:read` per restored open path and resolve via the existing `updateOpenFile`/`resolveRead`; a `not-found` read flips THAT file to the existing "no longer available" calm state via `invalidateOpen` (reuse the watch-handler logic), leaving siblings intact. Set the active path to the restored one if it survives, else fall back (existing adjacency/placeholder rules). (Spec FR-004/FR-005/FR-008/FR-009.)
- [x] Thread the restored slice + a "report open-files change" callback through `FileExplorer.tsx`/`useFileExplorer`'s signature (mirror how `enabled`/`paneId` are already passed). Report on every open-files change so the debounced save captures the latest (reuse the existing `SessionRegistry` path; no new persistence mechanism — FR-013).
- [x] Update the in-code comment at the old wipe site to reflect the new persisted behavior (it currently asserts "ephemeral … never survive an app restart" — that decision is being reversed; leave no contradictory comment).

Working-directory verify-and-cover (NOT a rebuild):

- [x] Verify by inspection + the Phase-2 regression that a restored tab resumes in its persisted `cwd` and a fresh tab still defers to the picker; if a previously-persisted `cwd` no longer exists, confirm the resume/file-explorer path degrades to not-live for that tab without crashing and without disturbing siblings. Add a focused test/assertion only where coverage is missing (do not refactor the working path). (Spec FR-007/SC-003.)

### Phase 4 — Verify & Docs

- [x] `npm run typecheck` (node + web) and `npm test` green. (All 99 test files / 1851 tests pass; zero typecheck errors in any touched file. Pre-existing flapping unused-var errors live only in concurrent untracked files `SlackMessageRow.tsx`/`SettingsDialog.tsx`/`validate.test.ts` — not part of this change.)
- [ ] Manual smoke: open files in ≥2 tabs with distinct active files, quit, relaunch → same dirs live, same files open in order, same active file, content re-read. Then delete a previously-open file before relaunch → it shows "no longer available", siblings fine. Then rename a tab's working dir before relaunch → that tab not-live, others fine. (SC-001..SC-005.)
- [ ] Confirm the on-disk snapshot JSON holds only root-relative paths — grep the written snapshot for any absolute path / token to re-verify FR-006/SC-007.
- [ ] Update `docs/ARCHITECTURE.md` §4.13 (Terminal File Explorer): the open-files collection is now **persisted per terminal tab and restored on relaunch** (contents re-read from disk), reversing the terminal-file-tabs-v1 "ephemeral open files" note; cite the v8 schema bump. Update §4.1/§4.11 only if the cwd-restore wording needs the verify note.
- [ ] Append the v8 line to any session-schema changelog the codebase keeps (the `SESSION_SCHEMA_VERSION` JSDoc is the canonical one — already done in Phase 1).
- [x] Update this plan's Deviations section with anything that differed.

---

## Risks & Mitigations

- **Schema clobber with #93.** Mitigated by the Phase-0 gate, the additive-only `validateTerminalTab`
  change, the untouched `validateEnabled` line, and the explicit co-existence test (SC-008).
- **Re-read storm on restore.** Seeding N open files fires N `fs:read`s at go-live; this mirrors the
  existing per-change re-read loop in the watch handler and is bounded by the open-files count — acceptable,
  same cost model as the current "re-read all open on every change" note. No new cap introduced.
- **paneId stability across restart.** Restore relies on the tab `id` (= `paneId`) being the persisted
  one (it already is — `hydrateTerminalTabs` preserves it). Open files are keyed under that tab, so they
  re-attach to the correct restored explorer. Confirm the restored slice is matched by tab `id`, not by
  array position.
- **Active path vanished.** Covered by the FR-009 fallback (existing adjacency/placeholder rules); tested.

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-21 (developer, Steps 3–5).** Implemented to plan. Notes:
  - Schema bumped 7 → 8 in `src/shared/ipc/session.ts`; v8 JSDoc note appended after the v7 note;
    `TerminalTabSnapshot.openFiles?: { files: string[]; activeRelPath: string | null }` added.
    `validateSnapshot`'s `enabled: validateEnabled(...)` line UNTOUCHED — the new normalization is a
    separate `validateOpenFiles()` helper called additively inside `validateTerminalTab`.
  - `enrichSnapshotForSave` (main) needed NO change: it spreads `{ ...t, sessionId, cwd }`, so a
    renderer-supplied `openFiles` on the draft tab survives enrichment automatically.
  - Restore reversal: the old `setOpenFiles(EMPTY_OPEN_FILES)` wipe at `useFileExplorer.ts` go-live
    is replaced by seeding from a consumed-once restored slice (`seedOpenFiles`, new pure helper in
    `openFiles.ts`) + an `fs:read` per restored path resolved through the existing `resolveRead`
    (a vanished file → the calm not-found block; no `invalidateOpen` branch needed since `resolveRead`
    already maps non-ok reads). The contradictory "ephemeral … never survive an app restart" comment
    was removed.
  - Open-files change reporting (FR-013) flows: `useFileExplorer` → `useExplorerPanes` →
    `TerminalView` (per-pane `onOpenFilesChange`) → `TerminalPanel.handleOpenFilesChange` (updates a
    `openFilesByPaneRef` map + re-reports the terminal draft via a shared `reportTerminal` callback) →
    existing `SessionRegistry` debounced save. No new persistence mechanism.
  - Version-pin test `channelUniqueness.test.ts` updated 7 → 8 (the established per-bump pattern).
  - Working-dir half left as verify-and-cover: `resolvePaneSpawn` + its existing `paneSpawn.test.ts`
    already cover persisted-cwd resume; no rebuild.
  - Phase-4 manual smoke + the `docs/ARCHITECTURE.md` §4.13 doc edit (architect-owned) are NOT done
    in this developer pass — flagged for wrap-up / architect.
  - **Add-on (separate logical change, coordinator request):** default 3-pane widths in
    `TerminalPanel.tsx` — terminal LEFT `0 0 50%` → `0 0 45%`, tree RIGHT `0 0 25%` → `0 0 18%`
    (viewer remainder now ~37%). Only the `*Width === null` CSS-default branches changed; the
    controlled drag branches + §1.2 min clamps untouched. No test asserted the old values.
