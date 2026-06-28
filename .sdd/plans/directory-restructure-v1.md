# Plan: Directory Restructure (Phase 1) — v1

**Status**: Draft
**Created**: 2026-06-28
**Last updated**: 2026-06-28
**Spec**: .sdd/specs/directory-restructure-v1.md

---

## Grounding

Investigated directly via codegraph + agentmemory + targeted Glob/Grep/Read before authoring.

**agentmemory (prior decisions):**
- `memory_recall` "directory structure restructure renderer folders organization" → empty (at
  spec time). The spec step persisted the blast-radius facts to memory
  (`mem_mqx4cekf_3f70c010f4dd`); this plan operationalizes them into a safe move sequence.

**codegraph / Glob / Grep / Read (the move-ordering evidence):**
- Re-read `plan_template.md` for structure.
- Grep `dataModelApply` across `src/` — it is a **cross-tree hot file**: imported by renderer
  `ActiveTabSurface.tsx` (`./dataModelApply`) AND by main `refreshRepaintIntegration.test.ts`
  (`../renderer/dataModelApply`), AND hardcoded in `tsconfig.node.json` as the single renderer-
  pure file listed for the composite boundary. Moving it touches a relative cross-tree import +
  a tsconfig literal → its group (`renderer/generative/`) is the **highest-risk move** and is
  scheduled with that listed explicitly.
- `Glob src/**/*.integration.test.ts` — **4 integration tests under `src/main/`**:
  `localFileProtocol.integration.test.ts` + `fsExplorer.integration.test.ts` (→ target `fs/`),
  `confluenceComments.integration.test.ts` (→ target `confluence/`),
  `agentRunner.integration.test.ts` (→ target `agent/`). All four nest under this restructure,
  so `package.json`'s NON-recursive `test:integration` glob (`src/main/*.integration.test.ts`)
  **will silently match zero files** the moment the first one moves → must become
  `src/main/**/*.integration.test.ts`. This is the single most important config edit.
- Confirmed (spec step) the vitest node/dom globs are recursive (`src/**/*.test.ts`,
  `src/**/*.dom.test.tsx`) → safe under nesting; the `@/`→`src/renderer` alias is depth-
  independent and used only for `@/components/ui/*` + `@/lib/utils`.

---

## Summary

Restructure the flat top-level files of `src/renderer/`, `src/main/`, and `src/shared/` into
domain/feature subfolders as a **pure file-move + import-repath refactor with zero behavior
change**. The work proceeds **one domain group at a time**: move a group, re-path its relative
cross-process imports (`../shared`, `../main`) and any intra-group/intra-renderer imports, apply
the config edits that group triggers, then prove `npm run typecheck` + `npm test` (+ `test:dom`,
`test:integration` when relevant) GREEN before starting the next group — never one giant move.
`src/renderer/components/` (shadcn primitives), `src/mcp/` (left flat), the `src/shared/ipc.ts`
+ `validate.ts` barrels, and the `ipc/` folder are NOT touched. Gated on a clean working tree:
the user commits current work first, so the restructure lands on an otherwise-empty diff.

## Technical Context

| Item              | Value                                                                            |
|-------------------|----------------------------------------------------------------------------------|
| Language          | TypeScript (Electron: main / preload / renderer / mcp), React 19, Vitest         |
| Key dependencies  | none added — pure move; relies on `@/`→`src/renderer` alias, recursive vitest globs |
| Files to create   | new domain folders (dir creation only) — no new source files                     |
| Files to modify   | every moved file's importers (relative re-path) + 6 config files (below)         |
| Out of scope      | `src/renderer/components/` (Phase 2, deferred), `src/mcp/` (left flat), any logic/symbol/API/dep change |

### Config files — what changes and when

| Config file | Change | When |
|-------------|--------|------|
| `package.json` | `test:integration`: `src/main/*.integration.test.ts` → `src/main/**/*.integration.test.ts` (NON-recursive trap) | BEFORE the first `src/main/` group that contains an integration test (do it up front, defensively — harmless while files are still flat) |
| `tsconfig.node.json` | Update the hardcoded `"src/renderer/dataModelApply.ts"` literal to its new path; `include` globs already recursive (`src/main/**/*.ts` etc.) so no glob change needed | In the SAME step that moves `dataModelApply.ts` (renderer `generative/` group) |
| `tsconfig.web.json` | `include` globs (`src/renderer/**/*.ts(x)`, `src/shared/**/*.ts`) are recursive → no change; `@/*`→`src/renderer/*` path unchanged | Verify only (no edit expected) |
| `electron.vite.config.ts` | renderer `root`/`@` alias unchanged (entry files stay at root); MCP rollup input KEYS unchanged because `src/mcp/` stays flat AND emitted output names must stay stable | Verify only (no edit expected, since mcp stays flat) |
| `vitest.config.ts` | `include: src/**/*.test.ts` recursive → no change | Verify only |
| `vitest.dom.config.ts` | `include: src/**/*.dom.test.tsx` recursive; `@`→`src/renderer` alias unchanged → no change | Verify only |

> The `@/` alias mapping is NOT changed. `@/components/ui/*` and `@/lib/utils` survive every
> move untouched (depth-independent). Intra-renderer imports MAY be re-pathed relative OR routed
> through `@/` where it removes brittle `../../`.

---

## Implementation Checklist

> Each "Group" step = move the group's files (with co-located tests + non-`.ts` assets), re-path
> imports, apply that group's config edit (if any), then run the gate. **Gate** = `npm run
> typecheck` AND `npm test` GREEN (add `npm run test:dom` for any group containing `*.dom.test.tsx`,
> and `npm run test:integration` for any group containing `*.integration.test.ts`). Do NOT start
> the next group until the gate is green. Commit per group (or per small batch) so each move is a
> reviewable, revertable unit.

### Phase 0 — Preflight (gated on clean tree)

- [x] Confirm working tree is clean (user has committed all in-flight work). Do NOT start on a dirty tree.
- [x] Read the spec; confirm OQ defaults are adopted (renderer/main taxonomy; nest the four `*Catalog/` under their domain folder; `atlassianPanelBits.tsx`→`atlassian/`; group clear `src/main/` clusters, leave cross-cutting files near root; `src/mcp/` flat; `components/` deferred).
- [x] Establish a baseline: run `npm run typecheck`, `npm test`, `npm run test:dom`, `npm run test:integration` and record the GREEN counts (the "same set of tests" reference for SC-002).
- [x] **Up-front config fix:** change `package.json` `test:integration` glob to `src/main/**/*.integration.test.ts`. Re-run `npm run test:integration` (still flat) → must stay green with the same 4 tests. Commit.

### Phase 1 — `src/shared/` (do FIRST: everything imports it; keep barrels stable)

> Lowest depth-change risk, but done first so later renderer/main re-paths target a settled shared tree.

- [x] Create `src/shared/types/`. Move per-integration type files into it: `jira.ts`, `slack.ts`, `confluence.ts`, `googleCalendar.ts`, `googleCalendarColor.ts` (+ `googleCalendarColor.test.ts`). Move generative-contract types `adapter.ts`, `conversation.ts`, `dataBearingSpec.ts` (+ `dataBearingSpec.test.ts`) into `src/shared/types/` (or a `core/` — keep with the spec's taxonomy).
- [x] DO NOT move `ipc.ts`, `validate.ts`, `bridge.ts`, or the `ipc/` folder — barrel/consumer paths (`../shared/ipc`, `../shared/validate`, `../shared/bridge`) stay STABLE.
- [x] Re-path importers of the moved type files across `src/main`, `src/renderer`, `src/mcp`, `src/shared/ipc/*` (e.g. `../shared/jira` → `../shared/types/jira`). Keep the top-level `validate*.test.ts` files where they are (they exercise the `ipc/` barrels next to `validate.ts`).
- [x] **Gate.** (typecheck + test) Commit.

### Phase 2 — `src/main/` (one domain cluster per step)

> `index.ts` stays at root. Cross-cutting files (`mcpConfig`(+test), `shortcutMatch`(+test), `clientConfigResolver`(+test), `clientConfigMutate`(+test)) stay near root for this cycle (OQ default). Main files import shared via `../shared/...`; moving one level deeper makes that `../../shared/...`.

- [x] **`src/main/slack/`** — move `slackBridge`, `slackManager`, `slackAdapter`, `slackSurfaceBuilder`, `slackImageRef`, `slackImageProtocol` (+ each `*.test.ts`). Re-path `../shared`→`../../shared`, `./integrations/*`→`../integrations/*`. **Gate.** Commit.
- [x] **`src/main/jira/`** — move `jiraBridge`, `jiraManager`, `jiraAdapter`, `jiraActionDispatcher`, `jiraSurfaceBuilder` (+ tests). Re-path. **Gate.** Commit.
- [x] **`src/main/confluence/`** — move `confluenceBridge`, `confluenceAdapter`, `confluenceSurfaceBuilder`, `confluenceImageRef`, `confluenceImageProtocol` (+ tests, incl. `confluenceComments.integration.test.ts`). Re-path. **Gate** (run `test:integration` here). Commit.
- [x] **`src/main/calendar/`** — move `googleCalendarBridge`, `googleCalendarManager`, `googleCalendarSurfaceBuilder`, `googleCalendarWindow` (+ tests). Re-path. **Gate.** Commit.
- [x] **`src/main/pty/`** — move `ptyManager`, `paneSpawn`, `processGroupKill`, `orphanReaper`, `sessionLockRecovery` (+ tests). Re-path. **Gate.** Commit.
- [x] **`src/main/agent/`** — move `agentRunner`, `agentSessionStore`, `agentSessionQueue` (+ tests, incl. `agentRunner.integration.test.ts`). Re-path. **Gate** (run `test:integration`). Commit.
- [x] **`src/main/session/`** — move `sessionStore`, `sessionSnapshot` (+ tests). Re-path. **Gate.** Commit. (Note: a same-named `sessionSnapshot` also exists in renderer — they are separate files in separate trees; keep them in their own trees.)
- [x] **`src/main/fs/`** — move `fsExplorer`, `pathConfine`, `fileKind`, `localFileRef`, `localFileProtocol`, `viewerKind`, `viewerCaps`, `transcriptReader`, `transcriptParse` (+ tests, incl. `fsExplorer.integration.test.ts` + `localFileProtocol.integration.test.ts`). Re-path. **Gate** (run `test:integration`). Commit.
- [x] **`src/main/generative/`** — move `uiBridge`, `descriptorShell`, `descriptorRegistration`, `adapterDispatcher`, `adapterBindingRegistry`, `specRebinder`, `dataBearingWarning`, `pendingCalls`, `viewContextGrounding` (+ tests). **Hold `refreshRepaintIntegration.test.ts` for Phase 3** (it imports `../renderer/dataModelApply`, which moves in Phase 3). Re-path. **Gate.** Commit.
- [x] Verify `index.ts` imports all re-path correctly after each group; it is the largest importer of main modules. (No move of `index.ts`.)

### Phase 3 — `src/renderer/` (entry/shell files stay at root; `components/` UNTOUCHED)

> Stays at root: `index.html`, `main.tsx`, `App.tsx`, `App.css`, `index.css`, `vite-env.d.ts`. UNTOUCHED: `components/`, `lib/`. Renderer→shared is relative `../shared`; one level deeper → `../../shared`. `@/components/ui/*` + `@/lib/utils` need NO change.

- [x] **`src/renderer/terminal/`** — move `TerminalPanel.tsx` **+ `TerminalPanel.css`** (asset travels with it), `terminalTheme`(+test), `terminalKeymap`(+test). Re-path; update `App.tsx`'s import of `TerminalPanel`. **Gate.** Commit.
- [x] **`src/renderer/slack/`** — move `SlackPanel.tsx`, `slackComposerLogic`(+test), `slackThreadPanelLogic`(+test), `slackChannelSearchLogic`(+test), `slackScrollToLatest`(+test), `useSlackScrollToLatest`(+`.dom.test.tsx`), `slackScrollPaginate`(+test), `useSlackScrollPaginate.dom.test.tsx` + `useSlackScrollPaginate.ts`. **Nest `slackCatalog/` → `src/renderer/slack/slackCatalog/`** (folder move; re-path its `@/`-imports are unaffected, its `../shared`/`../../` relatives shift by one). Re-path. **Gate** (+`test:dom`). Commit.
- [x] **`src/renderer/jira/`** — move `JiraPanel.tsx`; **nest `jiraCatalog/`**. Re-path. **Gate.** Commit.
- [x] **`src/renderer/confluence/`** — move `ConfluencePanel.tsx`; **nest `confluenceCatalog/`**. Re-path. **Gate.** Commit.
- [x] **`src/renderer/atlassian/`** — move shared `atlassianPanelBits.tsx` here; update `JiraPanel`/`ConfluencePanel` imports to point at `../atlassian/atlassianPanelBits`. **Gate.** Commit.
- [x] **`src/renderer/calendar/`** — move `GoogleCalendarPanel.tsx`, `calendarNavLogic`(+test); **nest `googleCalendarCatalog/`**. Re-path. **Gate.** Commit.
- [x] **`src/renderer/cosmos/`** — move `CosmosPanel.tsx` (+ `cosmosConversation`(+test), `cosmosTabs`(+test), `CosmosTimelineEntry.tsx` if not placed in `session/`; per OQ keep cosmos conversation/timeline with `CosmosPanel`). Re-path. **Gate.** Commit.
- [x] **`src/renderer/session/`** — move `SessionProvider.tsx`, `sessionRegistry`(+test), `sessionSnapshot`(+test). Re-path. **Gate.** Commit.
- [x] **`src/renderer/tabs/`** — move `panelTabs`(+test), `usePanelTabs`, `PanelTabStrip.tsx`, `useGenerativePanelTabs`, `perTabNav`(+test), `usePerTabNav`, `closeTabRouting`(+test), `useTabShortcuts`(+`.dom.test.tsx`), `cosmosTabs`(if not in cosmos/), `TerminalTabNavRouting.dom.test.tsx`. Re-path. **Gate** (+`test:dom`). Commit.
- [x] **`src/renderer/composer/`** — move `PromptComposer.tsx`, `PromptComposerDocked.dom.test.tsx`, `promptComposerLogic`(+test), `activeComposer`(+test), `ActiveComposerProvider.tsx`, `OpenPromptPositionProvider.tsx`, `openPromptPosition`(+test). Re-path. **Gate** (+`test:dom`). Commit.
- [x] **`src/renderer/generative/`** (HIGHEST RISK — cross-tree file) — move `ActiveTabSurface.tsx`, `activeTabSurfaceRefresh`(+test), `panelRefreshLogic`(+test), `PanelRefreshButton.tsx`, **`dataModelApply.ts`(+`dataModelApply.test.ts`)**, and **nest `catalogShared/`**. In the SAME step: (a) update `tsconfig.node.json` literal `"src/renderer/dataModelApply.ts"` → new path; (b) update main `refreshRepaintIntegration.test.ts` import `../renderer/dataModelApply` → new path AND move it into `src/main/generative/` now (held from Phase 2), re-pathing its `../shared`/`../renderer` accordingly; (c) update `ActiveTabSurface`'s `./dataModelApply` import. **Gate** (typecheck node+web + test + `test:dom` + `test:integration`). Commit.
- [x] **`src/renderer/app/`** — move `railVisibility`(+test), `CosmosMark.tsx`, `CosmosSpinner.tsx`, `SurfaceSpinner.tsx`, `PanelFooter.tsx`, `SettingsDialog.tsx`, `settingsStatusDot`(+test), `ContextChip.tsx`, `viewContextCapture`(+test). Re-path; update `App.tsx` imports. **Gate.** Commit.
- [x] **`src/renderer/confirm/`** — move `confirmLogic`(+test), `useConfirm.ts` (or fold into `app/` per OQ — pick one and stay consistent). Re-path. **Gate.** Commit.
- [x] Final renderer sweep: confirm `App.tsx` (the largest renderer importer) compiles with all updated paths; confirm `fileExplorer/` (moved as-is, untouched internals) still resolves.

### Phase 4 — Verify + Docs

- [x] Full gate: `npm run typecheck` (node+web), `npm test`, `npm run test:dom`, `npm run test:integration` — all GREEN, **same test counts as the Phase-0 baseline** (SC-002).
- [x] `npm run build` succeeds; confirm `out/main/mcp/*.js` emit with their **original filenames** (SC-003) — proves the untouched `src/mcp/` + rollup keys are intact.
- [ ] `npm run dev`: smoke every surface — terminal, file explorer, Slack, Jira, Confluence, Google Calendar, cosmos panel, settings, open-prompt composer — behaves identically (SC-004). (Reminder: a fresh `npm run dev` is required, not HMR, since preload imports may have re-pathed — CLAUDE.md gotcha.) **NOT exercised by the implementing session — requires a live GUI run the headless environment can't drive. `npm run build` (prod bundle incl. preload + MCP) succeeds and the full typecheck/test/dom/integration matrix is green, so the move is sound at the bundle/type level; a human should still do the live smoke before final sign-off.**
- [x] `git diff` review: ONLY relocations + import-path/config edits — no logic, no symbol renames, no signature/API changes, no dependency changes (SC-005). Confirm `src/renderer/components/` byte-for-byte unchanged (SC-006).
- [x] Regenerate `docs/PROJECT-STRUCTURE.md` to describe the new nested tree (SC-007).
- [x] Reconcile `docs/ARCHITECTURE.md` §4.6 tree references to the nested layout (paths like `slackBridge.ts`→`slack/slackBridge.ts`) without changing design meaning (SC-007).
- [x] Update this plan's Deviations with any folder/name adjustments made during the move.

---

## Success Criteria (from spec)

- SC-001 `npm run typecheck` passes (node + web).
- SC-002 `npm test` / `test:dom` / `test:integration` pass with the SAME test set/count as baseline.
- SC-003 `npm run build` emits all MCP bundles to `out/main/mcp/` with original filenames.
- SC-004 `npm run dev` launches; every surface behaves identically.
- SC-005 `git diff` = relocations + import/config edits ONLY (no logic/rename/signature/dep change).
- SC-006 `src/renderer/components/` byte-for-byte unchanged (Phase 2 deferred).
- SC-007 `docs/PROJECT-STRUCTURE.md` regenerated; `docs/ARCHITECTURE.md` §4.6 reconciled.
- SC-008 Every test file co-located with its source in the new folders.

## Risk Notes

- **Highest-risk step:** renderer `generative/` (the `dataModelApply.ts` cross-tree triad:
  renderer importer + main integration test + `tsconfig.node.json` literal). It is isolated into
  one step with all three edits done together and a full multi-suite gate.
- **The silent trap:** `test:integration`'s non-recursive glob — fixed UP FRONT in Phase 0 so it
  never silently drops the 4 main integration tests as they nest.
- **Per-group gating** keeps blast radius bounded: any red gate localizes to the just-moved group,
  and per-group commits keep each move independently revertable.
- **Barrels stay stable:** `../shared/ipc`, `../shared/validate`, `../shared/bridge` unchanged →
  zero churn for the dozens of contract consumers.

## Deviations & Notes

> Record anything that differs during implementation. Date each entry.

- **2026-06-28 — `test:integration` glob (Phase 0).** The plan prescribed changing the glob to
  the single pattern `src/main/**/*.integration.test.ts`. Empirically, in vitest 4 the `**`
  segment REQUIRES at least one intermediate directory, so `src/main/**/*.integration.test.ts`
  matches ZERO of the 4 still-flat `src/main/*.integration.test.ts` files (verified via npm run
  + a temp nested probe). Using the single `**` glob would make the gate RED while flat and only
  partially green mid-transition — the opposite of the plan's stated intent ("must stay green
  with the same 4 tests"). Deviation: used the TWO-pattern glob
  `src/main/*.integration.test.ts src/main/**/*.integration.test.ts`, which matches both the
  flat files (4) AND any nested files, so the gate stays green through every transition state and
  in the final nested layout. This satisfies the plan's intent (never silently drop an
  integration test) more robustly than the literal single-glob instruction.
- **2026-06-28 — `confluenceManager` included in confluence group (Phase 2).** The plan's
  confluence bullet omitted `confluenceManager.ts`(+test), but it is on disk and is plainly a
  confluence-domain file (mirrors slackManager/jiraManager). Moved it into
  `src/main/confluence/` with the rest of the cluster for consistency. Pure move + re-path.
- **2026-06-28 — catalog `logic.test.ts` `import.meta.url` SDK paths (Phase 3).** The
  `slackCatalog/jiraCatalog/confluenceCatalog` `logic.test.ts` files read SDK source via
  `readFileSync(new URL('../../../node_modules/@a2ui-sdk/...', import.meta.url))`. These
  depth-sensitive runtime paths are NOT covered by typecheck and break silently (ENOENT) when
  the catalog nests one level deeper. Re-pathed the traversal by one `../` per nesting
  (`../../../` → `../../../../`) as part of the move. Pure path re-target, no logic change.
  (Also why every catalog-nesting group runs `npm test`, not just typecheck.)
- **2026-06-28 — inline `import('...')` type imports (Phase 3, cosmos).** `cosmosConversation.ts`
  uses inline dynamic-type imports `import('../shared/ipc/ui').A2uiSurfaceUpdate` (not
  `from '...'` statements). The bulk `from '../shared/'` sed misses these, so they needed a
  separate `import('../shared/...')` → `import('../../shared/...')` re-path. Typecheck catches
  these (TS2307), so they are not silent — but worth re-pathing both forms when moving a file.
