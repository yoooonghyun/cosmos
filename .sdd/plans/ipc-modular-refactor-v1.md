# Plan: IPC Modular Refactor — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: .sdd/specs/ipc-modular-refactor-v1.md

---

## Grounding

> Direct investigation performed for this plan (mandatory report).

**codegraph**

- `codegraph_explore("src/shared/ipc.ts validate.ts CosmosApi IpcChannels payload types")` — returned
  the verbatim source of `shortcutMatch.ts` (a representative consumer) + the `CosmosApi` aggregate and
  `SlackApi`/`AgentApi`/`SessionApi`/`SettingsApi` blast radius. Takeaway: consumers import contract
  **types** by module specifier (`from '../shared/ipc'`), never by hard file path; `CosmosApi` is the
  single aggregate the preload attaches to `window`, assembled from 10 per-domain `*Api` interfaces.
- Full Read of `src/shared/ipc.ts` (1252 lines) and `src/shared/validate.ts` (1573 lines) — the exact
  symbol inventory both files export is now mapped (see Domain Inventory below). Takeaway: `ipc.ts`
  groups into 10 channel domains + a cross-cutting `common` (render-target primitive + `CosmosApi`);
  `validate.ts` groups by the same domains + a shared predicate `common` + an `adapter` sub-group.

**Grep (exact blast radius, cross-checked)**

- `from '...shared/(ipc|validate)'` across `src/**` → **50 files** touch one or both (48 import `ipc`,
  the validator-importers among them import `validate`). Takeaway: this is the surface the barrel must
  hold at zero churn.
- `shared/(ipc|validate)` in `*.json` / `*.config.ts` / `*.mts` → **no matches**. Takeaway: no rollup
  `input`, tsconfig `paths`, or alias references these files — module resolution alone governs, so a
  same-path barrel is invisible to the build.
- Validator test imports → all 8 validator test files (`validate.test.ts`, `validateUi.test.ts`,
  `validateSlack.test.ts`, `validateAtlassian.test.ts`, `validateJiraWrite.test.ts`,
  `validateAdapter.test.ts`, `validateSettings.test.ts`, `validateGoogleCalendar.test.ts`) import
  `from './validate'`. Takeaway: keeping `validate.ts` as a barrel keeps **all 8 test files unchanged**
  — this is the decisive evidence resolving the Open Question to option (a).
- `validate.ts` internally imports `DEFAULT_UI_RENDER_TARGET` + render/payload types `from './ipc'`,
  and the `*AdapterSource` / `*Op` constants `from './slack' './jira' './confluence' './googleCalendar'`.
  Takeaway: after the split, validator modules depend DOWN on the contract `common` + the already-separate
  data-DTO modules; no new cycle if `common` holds the shared primitive.
- `src/shared/` has no existing `index.ts` barrel; the data-DTO modules (`adapter.ts`, `slack.ts`,
  `jira.ts`, `confluence.ts`, `googleCalendar.ts`, `bridge.ts`, `dataBearingSpec.ts`) are flat siblings
  and **out of scope**. Takeaway: introducing `src/shared/ipc/` is the first sub-directory under
  `shared/`; the barrel files stay at `src/shared/ipc.ts` + `src/shared/validate.ts`.

**agentmemory**

- `memory_recall("ipc refactor shared contract modular")` → `mem_mqjkv7po_5358417cb643` (the spec's
  own persisted decision: per-domain split under `src/shared/ipc/` behind a same-path barrel, zero
  consumer churn, channel-uniqueness test). Takeaway: greenfield otherwise; this plan operationalizes
  that decision and resolves the validator-layout Open Question.

---

## Summary

Physically split the two monolithic shared-contract files — `src/shared/ipc.ts` (~1250 lines, 10 channel
domains + the `CosmosApi` aggregate) and `src/shared/validate.ts` (~1570 lines, ~30 validators) — into
per-domain modules under a new `src/shared/ipc/` directory, while keeping the **logical contract single
and authoritative** via thin same-path barrels. `src/shared/ipc.ts` becomes a re-export barrel over
`./ipc/common`, `./ipc/pty`, `./ipc/ui`, `./ipc/adapter`, `./ipc/agent`, `./ipc/shortcut`,
`./ipc/slack`, `./ipc/jira`, `./ipc/confluence`, `./ipc/googleCalendar`, `./ipc/session`,
`./ipc/settings`; `src/shared/validate.ts` becomes a re-export barrel over the co-located
`./ipc/<domain>.validate` modules. Because every one of the 50 consumer files keeps importing from the
unchanged `'../shared/ipc'` / `'../shared/validate'` specifiers, the refactor lands at **zero consumer
import churn** and is verified green by `npm run typecheck` (node + web) and `npm test`. A new
uniqueness test asserts no two domain modules declare the same wire string. This is a **pure structural
refactor**: no channel, wire string, payload shape, validator semantic, or `SESSION_SCHEMA_VERSION`
(stays `6`) changes.

**Resolved Open Question — validator layout: option (a).** Per-domain validator files live at
`src/shared/ipc/<domain>.validate.ts`, re-exported by a kept `src/shared/validate.ts` barrel. This is
chosen because all 8 validator test files and every main/MCP validator importer reference `'./validate'`
/ `'../shared/validate'` by specifier; the barrel keeps every one unchanged (SC-005, FR-008, FR-016
target of **zero** importer churn). Option (b) — co-exporting validators from each domain's contract
module — was rejected: it would couple contract+validator into one file (re-monolithizing per domain,
working against the parallel-edit goal of letting a type-only edit and a validator-only edit land in
different files) AND would force every validator importer to switch specifiers, breaking the zero-churn
target. Co-location is achieved by placing the `.validate.ts` files **beside** their contract module in
the same `src/shared/ipc/` directory (FR-007 "live beside its domain"), without merging the files.

## Technical Context

| Item              | Value                                                                                                                                                                                                                                                  |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron: node + web tsconfig projects)                                                                                                                                                                                                    |
| Key dependencies  | `@a2ui-sdk/types/0.9` (re-aliased payload types), the existing data-DTO modules `./adapter`, `./slack`, `./jira`, `./confluence`, `./googleCalendar` (out of scope, imported as-is). No new runtime deps.                                              |
| Files to create   | `src/shared/ipc/` directory: `common.ts`, `pty.ts`, `ui.ts`, `adapter.ts`, `agent.ts`, `shortcut.ts`, `slack.ts`, `jira.ts`, `confluence.ts`, `googleCalendar.ts`, `session.ts`, `settings.ts` (contract); `<domain>.validate.ts` companions; one channel-uniqueness test. |
| Files to modify   | `src/shared/ipc.ts` → barrel re-export; `src/shared/validate.ts` → barrel re-export. **Target: zero other files** (consumers + the 8 validator tests unchanged).                                                                                       |
| Verification      | `npm run typecheck` (node + web), `npm test` (vitest) — both green with zero consumer/test import-path edits; grep re-confirms the same 50-file blast radius.                                                                                          |

### Domain Inventory (authoritative move-map)

> Each row = one new contract module under `src/shared/ipc/` + its `.validate.ts` companion. "Contract
> exports" and "Validator exports" are the EXACT symbols moved out of `ipc.ts` / `validate.ts`. Nothing
> is added, renamed, or dropped.

| Module (`src/shared/ipc/…`) | Contract exports (from `ipc.ts`) | Validator exports (`<domain>.validate.ts`, from `validate.ts`) |
|---|---|---|
| `common.ts` / `common.validate.ts` | `UiRenderTarget`, `DEFAULT_UI_RENDER_TARGET` | `WarnFn`, `defaultWarn`, `isObject`, `isNonEmptyString`, `isPositiveInt`, `optionalCursorOk` (all currently module-private predicates — promote to `export` in `common.validate.ts` so domain validators import them) |
| `pty.ts` / `pty.validate.ts` | `PtyChannel`, `PtyChannelName`, `PtyDataPayload`, `PtyInputPayload`, `PtyResizePayload`, `PtyStartPayload`, `PtyRestartPayload`, `PtyDisposePayload`, `PtyExitPayload`, `PtyApi` | `validateInput`, `validateResize`, `validatePaneId`, `validateStart`, `validateRestart`, `validateDispose` |
| `ui.ts` / `ui.validate.ts` | `UiChannel`, `UiChannelName`, `A2uiSurfaceUpdate`, `UiDataModelPayload`, `UiRenderPayload`, `A2uiAction`, `UiActionPayload`, `UiApi` | `validateUiAction`, `validateSurfaceUpdate`, `validateUiDataModel`, `validateUiRenderTarget` |
| `adapter.ts` / `adapter.validate.ts` | *(no NEW contract types — adapter DTOs already live in `./adapter`, out of scope; this contract file may be omitted if empty — see Phase 1)* | `validateAdapterAction`, `validateAdapterBindings`, `validateAdapterDescriptor`, `adapterSourceMatchesTarget`, plus the private tables `SECRET_QUERY_KEYS`, `TARGET_ADAPTER_SOURCES` |
| `agent.ts` / `agent.validate.ts` | `AgentChannel`, `AgentChannelName`, `AgentSubmitPayload`, `AgentRunState`, `AgentStatusPayload`, `AgentApi` | `validateAgentPrompt` |
| `shortcut.ts` / *(no validator)* | `ShortcutChannel`, `ShortcutChannelName`, `ShortcutCommand`, `ShortcutTriggerPayload`, `ShortcutApi` | *(none — shortcut has no inbound-payload validator today)* |
| `slack.ts` / `slack.validate.ts` | `SlackChannelName`, `SlackChannelNameValue`, `SlackApi` | `validateSlackListChannels`, `validateSlackHistory`, `validateSlackReplies`, `validateSlackSearch`, `validateSlackGetUser`, `validateSlackBridgeCall`, `ValidatedSlackBridgeCall` |
| `jira.ts` / `jira.validate.ts` | `JiraChannelName`, `JiraChannelNameValue`, `JiraRequestDefaultViewPayload`, `JiraRequestSearchViewPayload`, `JiraRequestIssueDetailPayload`, `JiraApi` | `validateRequestDefaultView`, `validateRequestSearchView`, `validateRequestIssueDetail`, `validateJiraSearch`, `validateJiraGetIssue`, `validateJiraTransition`, `validateJiraComment`, `validateJiraCreate`, `validateJiraUpdate`, `validateJiraBoundAction`, `validateJiraBridgeCall`, `ValidatedJiraBridgeCall` |
| `confluence.ts` / `confluence.validate.ts` | `ConfluenceChannelName`, `ConfluenceChannelNameValue`, `ConfluenceApi` | `validateConfluenceSearch`, `validateConfluenceDefaultFeed`, `validateConfluenceGetPage`, `validateConfluencePageDetail`, `validateConfluenceCreate`, `validateConfluenceBridgeCall`, `ValidatedConfluenceBridgeCall` |
| `googleCalendar.ts` / `googleCalendar.validate.ts` | `GoogleCalendarChannelName`, `GoogleCalendarChannelNameValue`, `GoogleCalendarRequestDefaultViewPayload`, `GoogleCalendarApi`, the `GoogleCalendarEvent` re-export | `validateGoogleCalendarListEvents`, `validateGoogleCalendarBridgeCall`, `ValidatedGoogleCalendarBridgeCall` |
| `session.ts` / *(no validator here)* | `SessionChannel`, `SessionChannelName`, `SESSION_SCHEMA_VERSION`, `TerminalTabSnapshot`, `TerminalPanelSnapshot`, `GenerativeTabSnapshot`, `GenerativePanelSnapshot`, `SessionSnapshot`, `GenerativePanelKey`, `SessionApi` | *(snapshot validation lives in `src/main/sessionSnapshot.ts`, not in `validate.ts` — out of scope; no validator moves)* |
| `settings.ts` / `settings.validate.ts` | `SettingsChannelName`, `SettingsChannelNameValue`, `ClientConfigSource`, `ClientConfigStatus`, `ClientConfigSavePayload`, `ClientConfigField`, `ClientConfigClearPayload`, `ClientConfigSaveResult`, `SettingsApi` | `validateClientConfigSave`, `validateClientConfigClear`, plus the private `CLIENT_CONFIG_FIELDS` table |
| *(barrel only)* `src/shared/ipc.ts` | re-exports all the above + `CosmosApi` (assembled last, importing the 10 `*Api` interfaces) | — |
| *(barrel only)* `src/shared/validate.ts` | — | re-exports every validator + every `Validated*BridgeCall` interface above |

### Cross-module dependency direction (no new cycles — FR / Edge Case)

```
@a2ui-sdk/types/0.9 ─┐
./adapter ───────────┤
./slack ./jira       ├──▶  src/shared/ipc/<domain>.ts  ──▶  (barrel) src/shared/ipc.ts
./confluence         │            │  depends down on
./googleCalendar ────┘            ▼
                            src/shared/ipc/common.ts  (UiRenderTarget, DEFAULT_UI_RENDER_TARGET)

src/shared/ipc/common.validate.ts (predicates) ──▶ depended on by every <domain>.validate.ts
<domain>.validate.ts ──▶ imports its own <domain>.ts contract types + common.validate predicates
                     ──▶ imports ./slack ./jira ./confluence ./googleCalendar (*AdapterSource/*Op) as today
adapter.validate.ts ──▶ imports common.ts (UiRenderTarget) + ./adapter + the 4 *AdapterSource sets
                                  │  (TARGET_ADAPTER_SOURCES) — same imports validate.ts has today
(barrel) src/shared/validate.ts ──▶ re-exports all <domain>.validate.ts
```

Key cycle-avoidance rules:
- `UiRenderTarget` + `DEFAULT_UI_RENDER_TARGET` go to **`common.ts`** (contract). `ui.ts`, `agent.ts`,
  and `adapter.validate.ts` import them from `common.ts`, never from `ui.ts`. This breaks the only
  cross-domain contract dependency.
- The validator predicates (`isObject` etc., currently private to `validate.ts`) become **exported**
  from `common.validate.ts`; every `<domain>.validate.ts` imports them downward. No predicate is
  duplicated (FR-014).
- `adapter.validate.ts` keeps the `TARGET_ADAPTER_SOURCES` table importing the four `*AdapterSource`
  constants from the data-DTO modules exactly as `validate.ts` does today (Edge Case: those modules are
  out of scope and unchanged).
- The barrels (`ipc.ts`, `validate.ts`) are **leaves of the import graph** (nothing in `src/shared/ipc/`
  imports the barrels — domain modules import each other / `common` directly), so the barrels cannot
  participate in a cycle.

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates. The ORDER below keeps the
> tree green (typecheck-passing) at every committed step: build the new directory first, flip the
> barrels last, never leaving a dangling import.

### Phase 1 — Interface (create per-domain contract modules)

- [ ] Read the spec; confirm no open question remains (validator layout resolved to option (a) above).
- [ ] `mkdir src/shared/ipc/`.
- [ ] Create `src/shared/ipc/common.ts`: move `UiRenderTarget` and `DEFAULT_UI_RENDER_TARGET` (verbatim,
      incl. doc comments) out of `ipc.ts`. No other contents.
- [ ] Create the 10 domain contract modules listed in the Domain Inventory, moving each domain's
      channel const(s), `*ChannelName(Value)` type, payload/result types, and `*Api` interface
      **verbatim** (preserve every doc comment, every `FR-*` reference). Each module imports:
      - `UiRenderTarget` from `./common` where it appears (`ui.ts`, `agent.ts`);
      - the SDK aliases (`UpdateComponentsPayload`, `UpdateDataModelPayload`) from `@a2ui-sdk/types/0.9`
        in `ui.ts`;
      - `AdapterBinding` / `AdapterDescriptor` from `../adapter` in `ui.ts` and `session.ts`;
      - the Slack/Jira/Confluence/GoogleCalendar DTO param/result types from `../slack` … `../googleCalendar`
        in those domain modules (same imports `ipc.ts` has today, re-rooted one level deeper as `../`);
      - `A2uiSurfaceUpdate` / `AdapterDescriptor` / `AdapterBinding` from `./ui` + `../adapter` in
        `session.ts` (the snapshot types reference them).
- [ ] Decide `adapter.ts`: the adapter DTOs already live in `../adapter` (out of scope) and `ipc.ts`
      defines **no** adapter contract types, so the `adapter.ts` CONTRACT module is **omitted** (only
      `adapter.validate.ts` is created in Phase 2). Note this here if confirmed; if any adapter contract
      symbol is found that lives in `ipc.ts`, create `adapter.ts` for it instead.
- [ ] Review each moved type against the spec — **no invented properties, no renames** (FR-005/FR-006).

### Phase 2 — Interface (create per-domain validator modules)

- [ ] Create `src/shared/ipc/common.validate.ts`: move `WarnFn`, `defaultWarn`, `isObject`,
      `isNonEmptyString`, `isPositiveInt`, `optionalCursorOk` out of `validate.ts` and **export** them
      (they are private today). Import `UiRenderTarget` / `DEFAULT_UI_RENDER_TARGET` from `./common`
      only where needed (they are not — predicates are primitive; keep `common.validate.ts` dependency-free
      except the `WarnFn` type).
- [ ] Create each `<domain>.validate.ts` (pty, ui, adapter, agent, slack, jira, confluence,
      googleCalendar, settings) moving its validators + private tables **verbatim**. Each imports:
      - predicates + `WarnFn`/`defaultWarn` from `./common.validate`;
      - its own contract types from `./<domain>` (e.g. `pty.validate.ts` ← `./pty`);
      - cross-domain contract types from `./<other>` where a validator references them (e.g.
        `agent.validate.ts`'s `validateAgentPrompt` returns `AgentSubmitPayload` from `./agent` and calls
        `validateUiRenderTarget` from `./ui.validate`);
      - data-DTO types/constants from `../slack` `../jira` `../confluence` `../googleCalendar` `../adapter`
        exactly as `validate.ts` does today (re-rooted to `../`).
- [ ] Place `validateUiRenderTarget` in `ui.validate.ts` (it validates the UI render target). Note its
      consumers: `validateAgentPrompt` (`agent.validate.ts`) imports it from `./ui.validate`;
      `adapter.validate.ts` does NOT need it (it takes `target` as a typed arg). Confirm no cycle:
      `ui.validate` → `common.validate` + `./ui` + `./common`; `agent.validate` → `./agent` +
      `./ui.validate` + `common.validate`. One-directional.
- [ ] `adapter.validate.ts`: move `validateAdapterAction`, `validateAdapterBindings`,
      `validateAdapterDescriptor`, `adapterSourceMatchesTarget`, `SECRET_QUERY_KEYS`,
      `TARGET_ADAPTER_SOURCES` verbatim — **including the secret-strip loop and the cross-target
      membership table** (FR-009/FR-010 secret-handling preserved byte-for-byte). Imports
      `UiRenderTarget` from `./common`, the adapter request/descriptor/binding/query types + `AdapterAction`
      + `isAdapterActionId` from `../adapter`, and the four `*AdapterSource` constants from
      `../slack` `../jira` `../confluence` `../googleCalendar`.
- [ ] Review each moved validator against the spec — same input→output, same warn text, same return
      shape (FR-009). No behavioral change.

### Phase 3 — Barrels (flip the public surface; this is the green-keeping pivot)

- [ ] Rewrite `src/shared/ipc.ts` as a thin barrel:
      - `export * from './ipc/common'` … through every domain module (or explicit
        `export { … } from './ipc/<domain>'` / `export type { … }` per module — explicit re-exports are
        preferred for the channel CONSTS so a uniqueness test can import them by name).
      - Assemble `CosmosApi` **in the barrel** (it imports the 10 `*Api` interfaces from their modules and
        declares the aggregate), OR put it in `common.ts` and re-export — keep it in the barrel to avoid
        `common.ts` depending up on every domain. The `CosmosApi` field set + order stays identical
        (FR-013): `pty, ui, slack, jira, confluence, googleCalendar, agent, shortcuts, session, settings`.
      - Preserve `ipc.ts`'s top doc-comment (or move it to `common.ts`); the file remains the documented
        entry point.
- [ ] Rewrite `src/shared/validate.ts` as a thin barrel: `export * from './ipc/common.validate'` +
      `export * from './ipc/<domain>.validate'` for every validator module. Re-export the
      `Validated*BridgeCall` interfaces too (they are part of the validator public surface).
- [ ] Confirm the barrel re-export sets EQUAL the original export sets (FR-005, SC-003): a name-by-name
      diff of "what `ipc.ts` exported before" vs "what the barrel re-exports now" — strict equality, no
      superset.

### Phase 4 — Uniqueness guard (new test, the only net-new behavior)

- [ ] Add `src/shared/ipc/channelUniqueness.test.ts` (or `src/shared/ipcChannels.test.ts`): import every
      `*Channel` / `*ChannelName` const from the barrel, flatten all wire-string values into one array,
      and assert the array has no duplicates (e.g. `expect(new Set(all).size).toBe(all.length)`)
      (FR-011, SC-006). Include a negative-control comment showing the test would fail if two modules
      reused a string.
- [ ] (Optional, SC-004) Add a snapshot/byte assertion that the flattened {channel-name → value} map and
      `SESSION_SCHEMA_VERSION === 6` are unchanged, to lock wire strings against future drift. Keep it
      minimal — the uniqueness test plus typecheck already cover the structural guarantee.

### Phase 5 — Verify zero consumer churn (acceptance gate)

- [ ] `npm run typecheck` (node + web) — MUST pass with **zero edits** to any of the 50 consumer files'
      import paths (SC-001). If any consumer fails to resolve, the barrel re-export is incomplete — fix
      the barrel, do NOT edit the consumer (FR-016 target is zero migrations).
- [ ] `npm test` (vitest) — MUST pass; the 8 validator test files compile **unchanged** against the kept
      `./validate` barrel (SC-002, SC-005). The new uniqueness test passes.
- [ ] Re-grep `from '...shared/(ipc|validate)'` across `src/**` — MUST return the **same 50 files** as the
      pre-refactor baseline (SC-003): no consumer added or lost an import to satisfy the split.
- [ ] (If a cycle checker is available, e.g. `madge --circular`) run it over `src/shared/ipc/` to confirm
      no new circular import (SC-007). Otherwise rely on typecheck/build success as the cycle signal.

### Phase 6 — Docs follow-ups (record only; do NOT edit ARCHITECTURE.md now)

- [ ] Update this plan's Deviations with any module that landed differently than the inventory.
- [ ] Leave the `docs/ARCHITECTURE.md` + `docs/PROJECT-STRUCTURE.md` updates to the architect's separate
      pass (see Notes for downstream steps) — `ARCHITECTURE.md` has concurrent edits in flight and MUST
      NOT be touched in this refactor.

---

## Notes for downstream steps

- **Non-visual refactor — no design step.** Touches only `src/shared/*` organization + the new test;
  no UI surface, Tailwind/shadcn, or panel change. The cycle is spec → plan → interface → test →
  implement → wrap-up, skipping `design`.
- **Barrel-leaf discipline (developer note).** Nothing inside `src/shared/ipc/` may import the barrels
  (`../ipc` / `../validate`); domain modules import each other and `common` by their **direct** module
  paths. The barrels exist solely for external consumers. Violating this risks the very cycle the split
  is designed to avoid.
- **Promote-to-export, don't duplicate.** The four validator predicates and the `WarnFn`/`defaultWarn`
  helpers are private in `validate.ts` today; they MUST be promoted to exports in `common.validate.ts`
  and imported, never copy-pasted into each domain validator (FR-014, "no duplication").
- **Secret-handling code moves verbatim.** `SECRET_QUERY_KEYS`, the descriptor secret-strip loop, the
  `TARGET_ADAPTER_SOURCES` cross-target guard (in `adapter.validate.ts`), and the
  "never log the secret value" comments + structure-only warns in `settings.validate.ts`
  (`validateClientConfigSave`) move byte-for-byte (FR-010). No warn message text changes anywhere
  (FR-009).
- **Architecture-doc follow-up (architect, separate non-concurrent pass).** After this lands, update
  `docs/ARCHITECTURE.md` IPC references (≈ lines 185, 292, 297, 372, 806, 865) to note that
  `src/shared/ipc.ts` is now a **barrel** over per-domain modules in `src/shared/ipc/`, and
  `src/shared/validate.ts` a validator barrel — the "single typed IPC contract" rule is unchanged
  (physically split, logically single). Reflect the new `src/shared/ipc/` layout in
  `docs/PROJECT-STRUCTURE.md`. Do NOT edit `ARCHITECTURE.md` during this refactor (edits in flight).
- **`TODO.md` reconciliation** belongs to the wrap-up skill once the refactor lands.

## Open Questions

- **RESOLVED — validator layout.** Per-domain `src/shared/ipc/<domain>.validate.ts` files behind a kept
  `src/shared/validate.ts` barrel (option (a)). Justification: zero importer churn (all 8 validator test
  files + every main/MCP importer reference `'./validate'` / `'../shared/validate'` by specifier), keeps
  contract and validator in **separate files** per domain (so a type-only edit and a validator-only edit
  do not collide — the parallel-edit goal), and satisfies FR-007 "live beside its domain" via the shared
  `src/shared/ipc/` directory. No remaining open questions.

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-18**: Plan authored. Open Question resolved to option (a) (validator barrel kept at
  `src/shared/validate.ts`).
- **2026-06-18**: Implemented (Steps 3-5). All modules landed per the move-map with no deviation:
  - Contract modules created: `src/shared/ipc/{common,pty,ui,agent,shortcut,slack,jira,confluence,googleCalendar,session,settings}.ts`.
    `adapter.ts` CONTRACT module OMITTED as planned (no adapter contract symbol lives in `ipc.ts`;
    adapter DTOs stay in `../adapter`).
  - Validator modules created: `src/shared/ipc/{common,pty,ui,adapter,agent,slack,jira,confluence,googleCalendar,settings}.validate.ts`.
    `common.validate.ts` promotes the four predicates + `WarnFn`/`defaultWarn` to EXPORT (imported, never
    duplicated). NOTE: those predicates are now part of the `validate.ts` barrel's PUBLIC surface (the
    monolith kept them private) — this is the plan's intended promote-to-export, a permitted additive on the
    VALIDATOR surface only; no existing validator export changed shape/semantics, and no contract export changed.
  - Barrels flipped LAST: `src/shared/ipc.ts` re-exports all domain contract modules + assembles `CosmosApi`
    (field set/order identical); `src/shared/validate.ts` re-exports all `*.validate` modules. Barrel-leaf rule
    held — only the two barrels deep-import `src/shared/ipc/` (verified by grep); no consumer leaked a deep import.
  - New uniqueness guard: `src/shared/ipc/channelUniqueness.test.ts` (3 tests: no duplicate wire string across
    domains, all wire strings non-empty, `SESSION_SCHEMA_VERSION === 6`).
  - Verification: `npm run typecheck` (node + web) GREEN with ZERO consumer import-path edits;
    `npm test` GREEN 1330 (1327 baseline + 3 new), 0 failures; a compile-only assertion confirmed every original
    public name from both files resolves through the barrels (FR-005/SC-003 — strict equality, no missing name).
    `SESSION_SCHEMA_VERSION` stays 6.
