# Plan: Settings — OAuth Client Configuration — v1

**Status**: Draft
**Created**: 2026-06-15
**Last updated**: 2026-06-15
**Spec**: .sdd/specs/settings-oauth-clients-v1.md

---

## Grounding

**codegraph_explore** queries run (takeaways):
- `atlassianConfig slackConfig tokenStore slackManager jiraManager confluenceManager OAuth client config` → managers each own a `TokenStore`; client creds are read from `process.env` ONLY inside `runOAuth`/`refresh` closures in `index.ts` (`createSlackManager` ~326, `createJiraManager` ~370, `createConfluenceManager` ~424). These closures are the single integration point for the resolver.
- `... createJiraManager createConfluenceManager index.ts connect handlers ipcMain` → confirmed ONE Atlassian client drives Jira + Confluence; `index.ts` already has `registerJiraIpcHandlers`/`registerConfluenceIpcHandlers` + a module-level `mainWindow` and the three manager singletons (`slackManager`, `jiraManager`, `confluenceManager`) — these are reachable for the save handler's force-disconnect.
- `TokenStore save load clear has encrypt safeStorage` → `TokenStore` (`integrations/tokenStore.ts`) is the exact template: injectable `safeStorage`/`fs`, `save()` throws when encryption unavailable (refuses plaintext), single encrypted blob under `<userData>/integrations/`. `sessionStore.ts` is the parallel non-encrypted analogue with validate-and-ignore semantics.
- `src/shared/ipc.ts channel names` → per-domain `*ChannelName` const objects + `CosmosApi` sub-APIs; new work adds a `SettingsChannelName` const and a `settings` sub-API following the existing `session`/`slack` shape. Validation helpers live in `src/shared/validate.ts` (`isObject`, `isNonEmptyString`, `WarnFn`, `defaultWarn`).
- `App.tsx renderer sidebar rail` → the rail is the `TabsList` in `AppShell` (`App.tsx`); the gear must be a non-`TabsTrigger` control placed at the bottom of that rail container.

**memory_recall**: `OAuth client secret safeStorage encryption ... env` → no prior decision existed; saved one (resolver merge order, encrypted client-config store, write-only secret, force-disconnect). Standing global rule (MEMORY.md / CLAUDE.md): secrets stay in main, encrypted at rest, never in any renderer payload/log/surface.

---

## Summary

Add a Settings dialog (opened from a gear button at the bottom of the left rail) that configures
the OAuth client credentials for Slack (client ID) and Atlassian (client ID + secret, one client
for Jira and Confluence). Persistence is a new main-process `safeStorage`-encrypted store
(`clientConfigStore.ts`) mirroring `tokenStore.ts`, so the Atlassian secret stays encrypted at
rest and never reaches the renderer. A small resolver merges Settings-over-env and becomes the
single source the existing manager `runOAuth`/`refresh` closures read from (replacing direct
`process.env` reads). A new typed `settings:` IPC namespace exposes: get config status (ids +
sources + secret-configured boolean — never the secret), save config, and clear a field; the save
handler diffs effective values and force-disconnects affected integrations (Slack → Slack;
Atlassian → Jira + Confluence) by clearing their tokens via the existing managers. Renderer adds
the gear button and the dialog. This is a UI-bearing feature: a **design step** (designer) precedes
implementation for the dialog and the gear button.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload + React renderer), vitest |
| Key dependencies  | Electron `safeStorage`, existing `TokenStore` pattern, `src/shared/ipc.ts` typed contract, `src/shared/validate.ts`, Radix/shadcn Dialog (renderer), `lucide-react` (Settings/cog icon) |
| Files to create   | `src/main/integrations/clientConfigStore.ts`, `src/main/integrations/clientConfigStore.test.ts`, `src/main/clientConfigResolver.ts`, `src/main/clientConfigResolver.test.ts`, `src/renderer/SettingsDialog.tsx` |
| Files to modify   | `src/shared/ipc.ts` (new `SettingsChannelName` + `SettingsApi` types + `CosmosApi.settings`), `src/shared/validate.ts` (validate save/clear payloads), `src/main/index.ts` (build store + resolver; wire resolver into the 3 managers' `runOAuth`/`refresh`; register `settings:` ipc handlers incl. force-disconnect), `src/preload/index.ts` (expose `settings` sub-API — needs full `npm run dev` restart), `src/renderer/App.tsx` (gear button at bottom of rail + dialog open state), `docs/ARCHITECTURE.md` (§4.7 note) |

---

## Design model (the how)

**Stored shape (encrypted, main-only):**
```
ClientConfig {
  slack?:     { clientId?: string }
  atlassian?: { clientId?: string; clientSecret?: string }
}
```
Only fields the user has set are present; absence ⇒ fall back to env. Persisted as one
`safeStorage`-encrypted JSON blob at `<userData>/integrations/clientConfig.enc` (sibling of the
`*.token.enc` blobs).

**Resolver (`clientConfigResolver.ts`, pure, node-testable):** given the stored `ClientConfig`
plus an env reader, computes effective values:
- `slackClientId = stored.slack.clientId ?? env.COSMOS_SLACK_CLIENT_ID`
- `atlassianClientId = stored.atlassian.clientId ?? env.COSMOS_ATLASSIAN_CLIENT_ID`
- `atlassianClientSecret = stored.atlassian.clientSecret ?? env.COSMOS_ATLASSIAN_CLIENT_SECRET`

It also produces a **renderer-safe status** (the only thing that crosses to the renderer): for each
id, the effective value + a `source` of `'settings' | 'env' | 'unset'`; for the secret, a
`configured: boolean` + `source` — **never the secret value**. The managers' closures call the
resolver for the actual effective credential at connect/refresh time, so a save takes effect with
no restart (FR-010/FR-011).

**Force-disconnect on save (FR-012/FR-013):** the save handler computes effective id/secret BEFORE
and AFTER persisting. If Slack's effective clientId changed → `slackManager.disconnect()`. If the
Atlassian effective clientId OR clientSecret changed → `jiraManager.disconnect()` AND
`confluenceManager.disconnect()`. `disconnect()` already clears the token and emits the
`*:statusChanged` event the panels listen to. No change ⇒ no disconnect.

**IPC contract (new `settings:` namespace, all validated at the main boundary):**

| Channel const | String | Dir | Payload → Result |
|---------------|--------|-----|------------------|
| `SettingsChannelName.GetConfig` | `settings:getConfig` | R→M invoke | `() → ClientConfigStatus` (ids + sources + `atlassianSecretConfigured` + secret source; NEVER the secret) |
| `SettingsChannelName.Save` | `settings:save` | R→M invoke | `(ClientConfigSavePayload) → ClientConfigStatus` (validated; persists, force-disconnects changed; returns refreshed status) |
| `SettingsChannelName.ClearField` | `settings:clearField` | R→M invoke | `(ClientConfigClearPayload) → ClientConfigStatus` (unset one field → revert to env; same force-disconnect diffing) |

Proposed payload shapes (in `src/shared/ipc.ts`):
```
ClientConfigStatus {
  slack:     { clientId: string | null; source: 'settings' | 'env' | 'unset' }
  atlassian: {
    clientId: string | null; clientIdSource: 'settings' | 'env' | 'unset'
    secretConfigured: boolean; secretSource: 'settings' | 'env' | 'unset'
  }
}
// Save: any subset; only present keys are written. An explicit empty string for an id
// is treated as "unset" (revert to env), distinct from "absent" (leave unchanged).
ClientConfigSavePayload {
  slack?:     { clientId?: string }
  atlassian?: { clientId?: string; clientSecret?: string }
}
// Clear one specific field back to env fallback.
ClientConfigClearPayload {
  field: 'slack.clientId' | 'atlassian.clientId' | 'atlassian.clientSecret'
}
```
Validation in `validate.ts` mirrors existing `validate*` helpers (`isObject`/`isNonEmptyString`,
warn-and-return-null on any malformed field; an unknown `field` value on clear ⇒ ignored). The
save handler refuses to persist (and surfaces an error result) when `safeStorage` is unavailable,
mirroring `TokenStore.save()`.

**Note on Save returning status:** Save/ClearField return the post-save `ClientConfigStatus` so the
renderer reflects the new source/secret-configured state without a second round-trip — and so the
secret value is never needed renderer-side.

---

## Implementation Checklist

### Phase 1 — Interface
- [x] Read the spec; confirm no open questions remain (none flagged).
- [x] `src/shared/ipc.ts`: add `SettingsChannelName` const + value type; add `ClientConfigStatus`, `ClientConfigSavePayload`, `ClientConfigClearPayload`; add `SettingsApi` interface (`getConfig`, `save`, `clearField`); add `settings: SettingsApi` to `CosmosApi`.
- [x] `src/main/integrations/clientConfigStore.ts`: `ClientConfig` type + `ClientConfigStore` class (injectable `safeStorage`/`fs`, `load()/save()/clear()`), modeled on `TokenStore` — `save()` throws if encryption unavailable; never writes plaintext.
- [x] `src/main/clientConfigResolver.ts`: pure resolver — `resolveEffective(stored, env)` → effective `{ slackClientId, atlassianClientId, atlassianClientSecret }`; `toStatus(stored, env)` → renderer-safe `ClientConfigStatus` (no secret); a `diff(beforeEffective, afterEffective)` helper returning which logical clients changed.
- [x] Review types vs spec — confirm the secret has NO path to a renderer-facing type (only `secretConfigured`/`secretSource`).

### Phase 2 — Testing
- [x] `clientConfigStore.test.ts`: round-trips config; on-disk bytes are ciphertext (assert not equal to plaintext, no secret substring); `save()` throws when `isEncryptionAvailable()` is false; corrupt/missing blob → null (treated as empty).
- [x] `clientConfigResolver.test.ts`: Settings-over-env precedence for each field; clearing reverts to env; `toStatus` reports correct `source` per field and never includes the secret value; `diff` flags Slack vs Atlassian changes correctly (incl. clear-to-env that does/does not change effective value, and identical re-save = no change).
- [x] `validate.ts` tests: valid save/clear payloads pass; malformed (non-object, wrong types, unknown clear `field`) are warned-and-ignored (null).

### Phase 3 — Implementation
- [x] `src/main/index.ts`: construct one `ClientConfigStore` (under `<userData>/integrations/`) + an env-backed resolver; refactor `createSlackManager`/`createJiraManager`/`createConfluenceManager` so their `runOAuth`/`refresh` closures read effective creds from the resolver instead of `process.env` directly (keep the same fail-fast "not configured" reject when an effective id is unset).
- [x] `src/main/index.ts`: register `settings:` ipc handlers — `GetConfig` returns `toStatus`; `Save`/`ClearField` validate, compute before-effective, persist, compute after-effective, and force-disconnect via `slackManager`/`jiraManager`/`confluenceManager` per the diff (FR-012/FR-013); never log the secret.
- [x] `src/preload/index.ts`: expose `settings` sub-API (invoke wrappers). **Requires a full `npm run dev` restart, not HMR.**
- [x] `src/renderer/App.tsx`: add a gear (cog) button pinned at the BOTTOM of the left rail (separate from the surface `TabsTrigger`s — a non-tab control), wired to open the dialog; manage dialog open state.
- [x] `src/renderer/SettingsDialog.tsx`: modal dialog with the three inputs per the design spec; Slack Client ID + Atlassian Client ID prefilled from `getConfig`; Atlassian Client Secret as a write-only field showing configured/not-configured; Save → `settings.save`, per-field clear → `settings.clearField`; surface the encryption-unavailable error.
- [x] All tests pass (`npm test`); typecheck clean (`npm run typecheck`).

### Phase 4 — Docs
- [x] `docs/ARCHITECTURE.md` §4.7 (Integration Foundation): add the client-config store + resolver alongside the token store — "OAuth client credentials are configured via Settings, persisted as a `safeStorage`-encrypted main-only blob (`integrations/clientConfig.enc`); a resolver merges Settings-over-env and feeds the managers' connect/refresh; the Atlassian secret never crosses to the renderer (renderer sees only a configured/not-configured boolean)." Add a one-line entry to the milestone history list. The feature's design lives in this §4.7 note — NO separate design doc.
- [x] Update this plan's Deviations with anything that differed.

> **Design-step gate (UI-bearing):** after this plan is approved, the `design` skill (designer)
> produces `.sdd/designs/settings-oauth-clients-v1.md` BEFORE renderer implementation. Renderer
> pieces needing design: (1) the Settings **dialog** layout + all states (loaded/empty, secret
> configured vs not, per-field clear affordance, save success/error incl. encryption-unavailable,
> input focus/validation styling); (2) the **gear button** placement at the bottom of the left rail
> (idle/hover/active/focus states, separation from the surface rail items, tooltip).

---

## Deviations & Notes

- **2026-06-15**: Plan authored. Key decision: persist a SEPARATE encrypted blob (`clientConfig.enc`) rather than extending any `*.token.enc` — keeps client config independent of connection tokens and lets force-disconnect clear tokens without touching saved creds. Save/ClearField return the post-save status so the secret value is never needed renderer-side.
- **2026-06-15 (impl)**: Implemented all phases; `npm run typecheck` + `npm test` (1108 tests, 59 files) green. Deviations from the plan:
  - **Test-file split.** Boundary-validator tests landed in `src/shared/validateSettings.test.ts` (not added inline to an existing `validate.ts` test file), matching the repo's per-domain `validate<Domain>.test.ts` convention.
  - **`diff` renamed `diffEffective`.** The resolver helper the plan called `diff(...)` is exported as `diffEffective(before, after)` (returns `{ slack, atlassian }`).
  - **`ClientConfigSaveResult` shape.** The Save/ClearField return type carries `ok`, optional `errorKind` (`'encryption_unavailable' | 'write_failed' | 'invalid'`) + `message`, the post-op `status`, and `disconnected: { slack, jira, confluence }` — so the renderer can both message the encryption failure and name force-disconnected integrations without a second round-trip. (Plan implied "return the status"; this is the fuller result envelope.)
  - **`connected` prop derivation.** `App.tsx` derives the live `{ slack, jira, confluence }` connection state via a local `useConnectedStatus()` hook that seeds from `*.getStatus()` and subscribes to the three `*:statusChanged` pushes, then passes it to `SettingsDialog` — driving the precise force-disconnect caption + confirm-on-Save (design §F), rather than the conservative always-confirm fallback.
  - **shadcn CLI literal-`@/` output.** `npx shadcn add dialog label` wrote to a literal `./@/components/ui/` dir (the CLI doesn't resolve this repo's `@`→`src/renderer` alias); files were `mv`'d into `src/renderer/components/ui/` and the stray `@` dir removed. Both already used the unified `radix-ui` import convention (no rewrite). Recorded in `docs/DEVELOPMENT.md` (Styling/shadcn).
  - **Docs.** `docs/ARCHITECTURE.md` §4.7 already described this feature accurately (architect-owned) — left as-is; the implementation matches it. The one stale phrase there ("no separate design doc") is for `architect` to reconcile since a design doc now exists (`.sdd/designs/settings-oauth-clients-v1.md`). Developer-owned gotcha added to `docs/DEVELOPMENT.md` instead.
