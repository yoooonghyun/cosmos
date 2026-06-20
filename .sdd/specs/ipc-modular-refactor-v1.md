# Spec: IPC Modular Refactor — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: —
**Related plan**: .sdd/plans/ipc-modular-refactor-v1.md (to be authored)

---

## Grounding

> Direct investigation performed for this spec (mandatory report).

**codegraph**

- `codegraph_explore("ipc.ts IpcChannel channels payload validators ipcContract")` — returned the
  full verbatim source of `src/shared/ipc.ts` (~1252 lines) plus its blast-radius listing (123
  symbols across 24 in-tree files, the rest in `.claude/worktrees/**` which are out of scope). Takeaway:
  the file is one flat module holding **10 domain channel groups** + the `CosmosApi` shell; every
  `*Channel*` const, `*Payload`/`*Api` type, and the snapshot schema all live together.
- `codegraph_search`/explore confirmed `shortcutMatch.ts` (and other consumers) import contract
  *types* from `'../shared/ipc'` by module specifier, not by hard file path.

**Grep (exact blast radius — codegraph's impact list, cross-checked)**

- `from '...ipc'` → **48 distinct files, 52 import statements** across `src/main/**` (incl. tests),
  `src/preload/**`, `src/renderer/**`, `src/mcp/**`, and `src/shared/**` (`validate.ts` ×3,
  `bridge.ts` ×1, `uiBridge.ts` ×2, `useGenerativePanelTabs.ts` ×2). Takeaway: this is the blast
  radius the refactor must hold at **zero** if the barrel keeps the `src/shared/ipc.ts` path.
- `shared/ipc|shared/validate` in `*.json`/`*.config.ts` → **no matches**. Takeaway: no rollup
  `input`, tsconfig path, or build alias hard-codes `ipc.ts`/`validate.ts`; module resolution alone
  governs, so a same-path barrel is invisible to the build.
- `src/shared/validate.ts` read in full (1574 lines): ~30 validator functions + helper predicates
  (`isObject`/`isNonEmptyString`/`isPositiveInt`/`optionalCursorOk`), the `SECRET_QUERY_KEYS` /
  `TARGET_ADAPTER_SOURCES` tables, and per-domain `*_OPS` bridge-frame sets — all in one flat
  module grouped by the same domains as `ipc.ts`.
- `src/shared/ipc.ts` referenced by **path** in `docs/ARCHITECTURE.md` at lines 185, 292, 297, 372,
  806, 865. Takeaway: keeping the `src/shared/ipc.ts` path stable also avoids arch-doc churn.

**agentmemory**

- `memory_recall("ipc.ts IPC contract modular refactor channel validators shared module")` — no
  prior decisions on this refactor (empty). Takeaway: greenfield; decision persisted via
  `memory_save` (mem_mqjkv7po_5358417cb643) recording the same-path barrel + per-domain decomposition.

---

## Overview

`src/shared/ipc.ts` is a single ~1250-line module that is the authoritative typed IPC contract for
every cross-process channel in cosmos, and `src/shared/validate.ts` is its ~1570-line companion of
boundary validators. Because every feature that touches IPC must edit these two hot files,
concurrently developed features serialize on them and collide in merge. This refactor **physically
splits** both files into per-domain modules while keeping the **logical contract single and
authoritative** (a barrel re-export at the unchanged import path), so parallel feature work edits
independent files without conflict. It is a **pure structural refactor**: no behavior, wire string,
payload shape, channel, or validator semantics change.

## User Scenarios

> Each scenario is independently testable. Roles are cosmos contributors (developer / architect
> agents) and the build itself.

### Parallel IPC edits don't collide · P1

**As a** contributor adding a `pty:*` channel (e.g. a terminal directory-picker)
**I want to** edit only the `pty` IPC module
**So that** a concurrent contributor adding a Slack catalog field edits only the `slack` module and
our branches merge without touching the same file

**Acceptance criteria:**

- Given the contract is split per domain, when one change touches only `pty` channel/payload
  definitions and another touches only `slack`, then the two changes land in different files and
  produce no merge conflict in the contract layer.
- Given a new `pty:*` channel is added in the `pty` module, when the build runs, then the channel is
  exposed through the same single authoritative barrel that all consumers already import — no
  consumer import statement changes.

### Consumers keep importing from one place · P1

**As a** consumer in `main` / `preload` / `renderer` / `mcp`
**I want to** keep importing IPC contract types and channel constants from the same module specifier
**So that** the "one typed IPC contract" rule still holds and no import site has to be rewritten

**Acceptance criteria:**

- Given the split, when a consumer imports `from '../shared/ipc'` (or its layer-relative equivalent),
  then every previously exported name (channels, payloads, APIs, `CosmosApi`, `SESSION_SCHEMA_VERSION`,
  `DEFAULT_UI_RENDER_TARGET`, snapshot types, `GenerativePanelKey`, etc.) resolves unchanged.
- Given all 48 importing files, when `npm run typecheck` runs (node + web), then it passes with **no
  edits to any consumer import path**.

### Boundary validators stay co-located and intact · P1

**As a** main-process IPC handler / MCP bridge
**I want** each domain's boundary validators to live beside that domain's contract
**So that** a malformed inbound payload is still warned-and-ignored (never crashes) exactly as today

**Acceptance criteria:**

- Given the validator split, when an invalid `pty:input` / `ui:action` / `slack:*` / `jira:*` /
  `confluence:*` / `googleCalendar:*` / `settings:*` / `agent:submit` payload arrives, then it is
  warned and ignored identically to pre-refactor behavior (same warn message text, same `null`/`{}`
  return).
- Given the existing validator unit tests (`validate.test.ts`, `validateUi.test.ts`,
  `validateAdapter.test.ts`), when `npm test` runs, then they pass unchanged (or with only their own
  import specifier updated if the validator barrel path is retained — see SC-005).

### Wire strings and shapes are provably unchanged · P1

**As an** architect verifying the refactor is behavior-preserving
**I want** a guarantee that no channel wire string or payload shape changed
**So that** the embedded `claude`, the MCP servers, and persisted sessions still interoperate

**Acceptance criteria:**

- Given the channel-name constants, when their resolved string values are compared before/after,
  then every value is byte-identical (e.g. `pty:data`, `ui:render`, `slack:getStatus`,
  `jira:requestIssueDetail`, `googleCalendar:listEvents`, `session:save`, `settings:save`).
- Given `SESSION_SCHEMA_VERSION`, when read after the refactor, then it is still `6` (no schema bump —
  no snapshot shape changed).

### No two domains can collide on a wire string · P2

**As a** contributor adding a channel in a new domain module
**I want** a single assembled registry/union that proves channel-string uniqueness across all modules
**So that** the split cannot silently introduce two domains sharing one wire string

**Acceptance criteria:**

- Given all per-domain channel constants, when they are aggregated into one place, then a test
  asserts the union of every wire string has no duplicates.
- Given a contributor accidentally reuses an existing wire string in a different module, when the
  uniqueness test runs, then it fails.

---

## Functional Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST split `src/shared/ipc.ts` into per-domain contract modules, one module per IPC domain found in the current file.                                                                                                                                                              |
| FR-002 | The system MUST preserve a **single authoritative contract surface**: all names currently exported from `src/shared/ipc.ts` MUST remain importable from one stable barrel module that re-exports the per-domain modules.                                                                       |
| FR-003 | The barrel MUST keep the import path `src/shared/ipc.ts` (the file becomes a thin re-export of `./ipc/*`), so **no consumer import statement changes**. The per-domain modules live under `src/shared/ipc/`. (Decision: same-path barrel; see Edge Cases for why the `ipc/index.ts` alternative was rejected.) |
| FR-004 | The system MUST NOT change any channel **wire string value**. Every string in every `*Channel*` const stays byte-identical.                                                                                                                                                                   |
| FR-005 | The system MUST NOT add, remove, or rename any channel, payload type, API interface, or exported constant. The set of exported names from the barrel MUST equal the current set (a strict superset is also disallowed — no new public contract).                                               |
| FR-006 | The system MUST NOT change any payload/result **shape** (no added/removed/renamed fields, no changed optionality or types).                                                                                                                                                                    |
| FR-007 | The system MUST split `src/shared/validate.ts` into per-domain validator modules, co-located with (in the same `src/shared/ipc/` domain grouping as) their domain's contract, OR kept as a sibling per-domain set — the plan chooses the exact layout, but each validator MUST live beside its domain.        |
| FR-008 | The system MUST preserve a single authoritative **validator** import surface the same way as the contract: a barrel re-export kept at `src/shared/validate.ts` so existing validator importers do not change. (If the plan elects to move validator importers, FR-016 lists them explicitly.) |
| FR-009 | Each validator's behavior MUST be byte-identical: same input → same return value (validated object / `null` / `{}`), same `warn` message text, same secret-stripping (`SECRET_QUERY_KEYS`) and cross-target membership (`TARGET_ADAPTER_SOURCES`) logic.                                       |
| FR-010 | The system MUST keep all secret-handling guarantees: no token/secret may appear in any payload; the descriptor secret-strip and the settings-save "never log the secret value" rule MUST be preserved verbatim in their new module home.                                                       |
| FR-011 | The system MUST assemble channel-name uniqueness into one verifiable place (a union type and/or a runtime registry) and the test suite MUST assert no wire string is duplicated across domain modules.                                                                                          |
| FR-012 | The system MUST keep `SESSION_SCHEMA_VERSION` at its current value (`6`); the snapshot types move modules but their shapes and the version constant do not change.                                                                                                                             |
| FR-013 | The system MUST keep the `CosmosApi` aggregate interface (the `window.cosmos.*` shape) identical, assembled from the per-domain `*Api` interfaces wherever they now live.                                                                                                                       |
| FR-014 | The system MUST preserve shared primitives (`UiRenderTarget`, `DEFAULT_UI_RENDER_TARGET`, `UiRenderTarget`-keyed helpers, the `isObject`/`isNonEmptyString`/`isPositiveInt`/`optionalCursorOk` validator predicates) in a `common`/shared module that domain modules depend on, with no duplication. |
| FR-015 | After the refactor, `npm run typecheck` (node + web) and `npm test` MUST both pass with no behavioral test changes (only import-specifier edits permitted, and only if FR-016 enumerates them).                                                                                                |
| FR-016 | If any consumer import path MUST change (i.e. the same-path barrel cannot fully cover a case), the change MUST be enumerated as an explicit migration list in the plan; the **target is zero** such files. `[NEEDS CLARIFICATION resolved: target is zero — see Open Questions for the validator-barrel choice.]` |

## Edge Cases & Constraints

- **Circular imports across domain modules.** Some validators reference cross-domain constants
  (e.g. `validate`'s `TARGET_ADAPTER_SOURCES` reads each integration's `*AdapterSource` from
  `./slack`, `./jira`, `./confluence`, `./googleCalendar`; the `ui`/adapter validators import the
  render-target primitive). The decomposition MUST place truly shared primitives in the `common`
  module so domain modules depend downward on `common` (and on the already-separate
  `./adapter`, `./slack`, `./jira`, `./confluence`, `./googleCalendar` data DTO modules) without
  forming cycles. No new circular dependency may be introduced.
- **`*AdapterSource` / `*Op` constants already live in the data DTO modules** (`src/shared/slack.ts`,
  `jira.ts`, `confluence.ts`, `googleCalendar.ts`), not in `ipc.ts`/`validate.ts`. Those files are
  **out of scope** for this refactor — only `ipc.ts` and `validate.ts` are split. Validators keep
  importing those DTO modules unchanged.
- **Barrel strategy chosen: keep `src/shared/ipc.ts` as the barrel.** The alternative —
  delete `ipc.ts`, create `src/shared/ipc/index.ts`, and rely on directory-index resolution — is
  rejected because (a) it churns nothing for module-specifier importers but DOES change the on-disk
  file the architecture doc and tooling reference by path (6 arch-doc mentions), and (b) a thin
  same-name `ipc.ts` re-export is the lowest-churn, most explicit option. Same reasoning applies to
  `validate.ts`.
- **`.claude/worktrees/**` copies** that codegraph surfaced are agent worktrees, not the main tree;
  they are explicitly **out of scope**.
- **No new domain is introduced.** The split mirrors exactly the domains already present.
- **Out of scope:** any change to channel behavior, MCP server wiring, preload method set,
  rollup inputs, the embedded `claude` sandbox, or the `docs/ARCHITECTURE.md` content (an
  arch-doc follow-up note is recorded below — the architect updates it in a separate, non-concurrent
  pass since edits to that file are currently in flight).

### Proposed domain decomposition (the real domains in the file)

Modules under `src/shared/ipc/` (exact filenames are the plan's call; this is the grouping):

1. **`common`** — `UiRenderTarget`, `DEFAULT_UI_RENDER_TARGET`, the `CosmosApi` aggregate (assembled
   last), and any cross-domain primitive. Validator predicates (`isObject`, `isNonEmptyString`,
   `isPositiveInt`, `optionalCursorOk`, `WarnFn`/`defaultWarn`) live in the validator `common`.
2. **`pty`** — `PtyChannel`, `Pty*Payload`, `PtyApi`; validators `validateInput`/`validateResize`/
   `validatePaneId`/`validateStart`/`validateRestart`/`validateDispose`.
3. **`ui`** — `UiChannel`, `UiRenderTarget` consumers, `A2uiSurfaceUpdate`, `UiDataModelPayload`,
   `UiRenderPayload`, `A2uiAction`, `UiActionPayload`, `UiApi`; validators `validateUiAction`,
   `validateSurfaceUpdate`, `validateUiDataModel`, `validateUiRenderTarget`, and the adapter-boundary
   validators (`validateAdapterAction`, `validateAdapterBindings`, `validateAdapterDescriptor`,
   `adapterSourceMatchesTarget`, `SECRET_QUERY_KEYS`, `TARGET_ADAPTER_SOURCES`). The adapter
   validators MAY be their own `adapter` sub-module if cleaner — the plan decides.
4. **`agent`** — `AgentChannel`, `AgentSubmitPayload`, `AgentRunState`, `AgentStatusPayload`,
   `AgentApi`; validator `validateAgentPrompt`.
5. **`shortcut`** — `ShortcutChannel`, `ShortcutCommand`, `ShortcutTriggerPayload`, `ShortcutApi`.
6. **`slack`** — `SlackChannelName`, `SlackApi`; validators `validateSlack*` +
   `validateSlackBridgeCall` / `ValidatedSlackBridgeCall`.
7. **`jira`** — `JiraChannelName`, `JiraRequest*Payload`, `JiraApi`; validators `validateJira*`
   (search/getIssue/transition/comment/create/update/boundAction/bridgeCall) + request-view/issue-detail
   validators.
8. **`confluence`** — `ConfluenceChannelName`, `ConfluenceApi`; validators `validateConfluence*`
   (search/defaultFeed/getPage/pageDetail/create/bridgeCall).
9. **`googleCalendar`** — `GoogleCalendarChannelName`, `GoogleCalendar*Payload`, `GoogleCalendarApi`,
   the `GoogleCalendarEvent` re-export; validators `validateGoogleCalendar*`.
10. **`session`** — `SessionChannel`, `SESSION_SCHEMA_VERSION`, all `*Snapshot` types,
    `GenerativePanelKey`, `SessionApi`.
11. **`settings`** — `SettingsChannelName`, `ClientConfig*` types, `SettingsApi`; validators
    `validateClientConfigSave` / `validateClientConfigClear`.

The barrel `src/shared/ipc.ts` re-exports all of (1)–(11)'s contract names; the barrel
`src/shared/validate.ts` re-exports all of their validators.

## Success Criteria

| ID     | Criterion                                                                                                                                                              |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | `npm run typecheck` (node + web) is green with **0 changes** to any of the 48 contract-importing files' import paths.                                                  |
| SC-002 | `npm test` is green; no behavioral test was modified (only validator-barrel import specifiers if SC-005 forces it — target none).                                      |
| SC-003 | A grep for `from '...shared/ipc'` after the refactor returns the **same 48 files / 52 statements** as before (no consumer added or lost an import to satisfy the split).|
| SC-004 | Every channel wire string and `SESSION_SCHEMA_VERSION` (= 6) is byte-identical before/after (verifiable by diffing resolved constant values or by a snapshot test).    |
| SC-005 | The validator import surface is preserved at `src/shared/validate.ts`; existing validator importers (`uiBridge`, `index`, `agentRunner`, `*Dispatcher`, the MCP servers, the validator tests) compile unchanged. |
| SC-006 | A new uniqueness test fails if two domain modules declare the same wire string, and passes for the current contract.                                                   |
| SC-007 | No new circular import is introduced (verified by typecheck/build succeeding and, if available, a cycle check).                                                        |

---

## Notes for downstream steps

- **Non-visual.** This refactor touches only `src/shared/*` contract + validator organization and
  the files that import them. There is **no UI surface, no Tailwind/shadcn change, no new panel**.
  **No design step is required** — the cycle goes spec → plan → interface → test → implement →
  wrap-up, skipping `design`.
- **Architecture-doc follow-up (do NOT edit now — edits to `docs/ARCHITECTURE.md` are in flight).**
  After this refactor lands, the architect should update the doc's IPC references (lines ~185, 292,
  297, 372, 806, 865) to note that `src/shared/ipc.ts` is now a **barrel** over per-domain modules in
  `src/shared/ipc/` (the "single typed IPC contract" rule is unchanged — it is now physically split,
  logically single), and that `src/shared/validate.ts` is likewise a validator barrel. Also reflect
  the new file layout in `docs/PROJECT-STRUCTURE.md`.

## Open Questions

- [ ] **Validator co-location vs. single validator barrel.** Two acceptable layouts: (a) per-domain
  validator files under `src/shared/ipc/<domain>.validate.ts` re-exported by a kept
  `src/shared/validate.ts` barrel (zero importer churn — preferred), or (b) per-domain validators
  exported from each domain's own contract module (couples contract+validator per domain but may
  require updating validator import specifiers). The plan MUST pick (a) unless it can show (b) also
  yields zero importer churn. Resolution does not block the spec; it is a layout choice that keeps
  FR-008/FR-016/SC-005 satisfied either way.
