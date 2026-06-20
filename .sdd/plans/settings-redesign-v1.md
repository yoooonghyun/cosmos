# Plan: Settings Redesign — Tabbed Surface + Per-Integration Rail Gating — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/settings-redesign-v1.md

---

## Summary

Restructure Settings from one stacked modal into a **tabbed surface** (General + one tab per
integration, with Jira and Confluence **split** into separate tabs), and introduce a new,
persisted, per-integration **`enabled`** preference that gates each integration's left-rail icon.
The technical approach reuses what is already in place: each integration's connect/disconnect and
not-connected UI stays in its panel and managers (untouched); the existing settings-oauth-clients-v1
credential editing (write-only secret, env-fallback resolver, force-disconnect-on-change) is
**relocated** into the per-integration tabs rather than re-implemented; and the `enabled` flags
ride in the existing **plain-JSON session snapshot** (`SessionStore` / `validateSnapshot`,
schema-version bumped) — NOT the encrypted credential blob, because `enabled` is a non-secret UI
preference. The rail in `App.tsx` changes from rendering a static `RAIL_ITEMS` array to filtering
the gateable items on `enabled`, with Terminal + Generated UI always present; toggling `enabled`
updates the rail live and re-focuses to Terminal if the disabled panel was active. Because this is
UI-bearing (a new tabbed Settings layout, enable toggles, and a dynamic rail), the plan REQUIRES a
**designer step (Phase 0)** to extend the design system before implementation.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer), Vitest |
| Key dependencies  | Existing only — Radix `Tabs`, shadcn/ui (`Dialog`/`Tabs`/`Switch` or `Toggle`), `react-icons`, the typed `src/shared/ipc` contract, `SessionStore`/`validateSnapshot`, the existing `window.cosmos.settings` + per-integration `getStatus`/`connect`/`disconnect` APIs |
| Files to create   | none expected (the Settings tabs can be sub-components within `SettingsDialog.tsx` or split into a `settings/` folder at the developer's discretion); a design spec at `.sdd/designs/settings-redesign-v1.md` (designer) |
| Files to modify   | `src/shared/ipc/session.ts` (add `enabled` map to `SessionSnapshot` + bump `SESSION_SCHEMA_VERSION`), `src/shared/ipc/session.validate.ts` (validate the `enabled` map), `src/main/sessionSnapshot.ts` (`validateSnapshot` normalizes the `enabled` map), `src/renderer/SettingsDialog.tsx` (tabbed layout + enable toggles + connect/disconnect/status per tab), `src/renderer/App.tsx` (`enabled`-filtered rail, disable-active fallback), `src/renderer/SessionProvider.tsx`/session registry (expose + persist `enabled`), plus the matching `*.test.ts` files |

Notes from grounding (load-bearing):
- The current `SettingsDialog.tsx` edits ONLY credentials and has no connect/disconnect; connect/disconnect lives in the panels via `window.cosmos.<int>.connect/disconnect`. The new per-integration tab must call those existing APIs — do NOT add a parallel connect path.
- `App.tsx` `useConnectedStatus()` already tracks live `connected` per integration; the enable toggles' connection-status display can reuse this rather than re-subscribing.
- `SESSION_SCHEMA_VERSION` is currently **6**; adding the `enabled` map is a schema change → bump to **7**. Older snapshots fail the version check and fall back to a clean session (integrations default disabled, per spec FR-008/FR-018) — this is the established `validateSnapshot` discipline, no migration code needed.
- `enabled` must be VALIDATED at the main boundary like every other snapshot field; an invalid value normalizes to `false` (disabled) rather than crashing.
- Preload edits, if any new `window.cosmos.*` method is added, require a full `npm run dev` restart (HMR alone leaves it "not a function"). Prefer threading `enabled` through the EXISTING `session.save`/`session.load` rather than adding a new channel — avoids a preload change.

Decision record (for the implementing session):
- **D1 — `enabled` lives in the session snapshot, not the encrypted clientConfig blob.** It is a non-secret UI preference; the snapshot is the right home (plain JSON, already persisted/validated/version-gated). Keeps credentials (encrypted) and preferences (plain) cleanly separated.
- **D2 — Reuse `session.save`/`session.load`, no new IPC channel.** Add `enabled` to `SessionSnapshot`; the renderer reads it at startup (already gating the rail behind `useLoadSession`) and writes via the existing debounced save coordinator. Avoids a preload method + restart.
- **D3 — Gateable set is fixed: `slack | jira | confluence | google-calendar`.** Terminal + Generated UI are always present (FR-005). Model `enabled` as a `Record<gateable, boolean>` so adding a future integration is one key.
- **D4 — Rail filter + active-surface fallback in `App.tsx`.** Replace the static `RAIL_ITEMS.map` with a filter that keeps always-present items plus enabled gateable items; on a disable that hides the active surface, set `surface` back to `'terminal'`.
- **D5 — Credentials relocate, behavior preserved.** Move the settings-oauth-clients-v1 fields into the per-integration tabs; the Atlassian Client ID/Secret fields appear on BOTH the Jira and Confluence tabs but mutate the one shared client via the unchanged `settings.save`/`settings.clearField` (force-disconnect-on-change intact).

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates from plan.

### Phase 0 — Design (designer agent, REQUIRED — UI-bearing)

- [ ] Produce `.sdd/designs/settings-redesign-v1.md`: a **tabbed Settings layout** (tab list + one-tab-at-a-time content) within the existing shadcn `Dialog`, using shadcn `Tabs` (and a `Switch`/`Toggle` for Enable if not yet in `src/renderer/components/ui/`).
- [ ] Design the per-integration tab anatomy: Enable toggle, connection status + connect/disconnect affordance, and the relocated credential fields (Client ID; write-only secret as a configured/not-configured affordance) — visually uniform across all four integration tabs and the General tab.
- [ ] Design how the shared Atlassian credentials read on the Jira and Confluence tabs (a clear "shared with the other Atlassian product" affordance) so the FR-012 shared mutation is not surprising.
- [ ] Confirm whether a `Switch` component must be added to `src/renderer/components/ui/` (designer owns the component dir; the install/CLI wiring is done by the developer/main session since the designer has no Bash).
- [ ] Design the empty/minimal rail (first-run: Terminal + Generated UI only) so it does not read as broken.

### Phase 1 — Interface (types + contract)

- [ ] Read the spec, confirm no open questions remain.
- [ ] In `src/shared/ipc/session.ts`: add an `enabled: Record<'slack'|'jira'|'confluence'|'google-calendar', boolean>` (a named type) to `SessionSnapshot`; bump `SESSION_SCHEMA_VERSION` 6 → 7 with a comment explaining the field add.
- [ ] In `src/shared/ipc/session.validate.ts`: add a validator/normalizer for the `enabled` map (each key coerced to boolean, missing keys → `false`).
- [ ] Review types vs spec — no invented properties; `enabled` is the only new persisted field; reuse existing `connected` tracking and `settings.*` types unchanged.

### Phase 2 — Testing

- [ ] `sessionSnapshot.test.ts`: a v7 snapshot with `enabled` round-trips; missing/invalid `enabled` keys normalize to `false`; a v6 (older) snapshot is rejected → clean session with all integrations disabled (FR-008/FR-018).
- [ ] `sessionSnapshot.test.ts` / boundary test: a malformed `enabled` value is warned-and-ignored, never crashes, never overwrites a good file (FR-016/SC-009).
- [ ] Renderer logic test (pure, `.ts`/`.test.ts` split where logic is extractable): rail computation = always-present items + enabled gateable items, in stable order (SC-003/SC-005).
- [ ] Renderer logic test: disable-active-surface → fallback resolves to `terminal` (or first enabled item if terminal absent) (FR-014/SC-007).
- [ ] Confirm settings-oauth-clients-v1 tests still pass unchanged after the credential UI relocates (the IPC contract is untouched) (FR-017/SC-010).

### Phase 3 — Implementation

- [ ] `validateSnapshot` (`src/main/sessionSnapshot.ts`): normalize the `enabled` map alongside `panels`; default all gateable to `false`.
- [ ] Session registry / `SessionProvider`: seed `enabled` from the restored snapshot, expose a setter, and report changes to the debounced save coordinator (same path the panels' tab state uses).
- [ ] `SettingsDialog.tsx`: convert the three stacked `<section>`s into a `Tabs` surface — General + Slack + Jira + Confluence + Google Calendar tabs; each integration tab carries its Enable toggle, connection status + connect/disconnect (calling the existing `window.cosmos.<int>.connect/disconnect`), and the relocated credential fields; the Atlassian fields appear on BOTH the Jira and Confluence tabs bound to the one shared `settings.save`/`clearField` path.
- [ ] `App.tsx`: replace the static `RAIL_ITEMS.map` with an `enabled`-filtered rail (Terminal + Generated UI always; gateable items only when enabled); read initial `enabled` from the restored snapshot; on a disable that hides the active surface, set `surface` to `'terminal'`; keep the Cmd+Shift+[/] cycle working over the now-dynamic visible set.
- [ ] Verify disabling never clears a token (FR-009) and disabling mid-connection leaves the OAuth flow intact (FR-015).
- [ ] All tests pass; reuse `useConnectedStatus()` and the existing `settings.*` API — no duplicated connect/credential logic.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: §3 (rail is now `enabled`-gated, not static; Terminal + Generated UI always present), §4.7 (Settings is a tabbed surface; per-integration `enabled` preference persisted in the session snapshot; Jira/Confluence on separate tabs sharing the Atlassian client), and the session snapshot description (new `enabled` map, schema v7).
- [ ] Reconcile `TODO.md` via the wrap-up skill (check off / add surfaced work).
- [ ] Update this plan with any deviations.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-20**: Plan authored. Key decisions: `enabled` is a distinct persisted boolean per gateable integration living in the plain-JSON session snapshot (schema bump 6 → 7), NOT the encrypted credential blob; gateable = slack/jira/confluence/google-calendar, Terminal + Generated UI always present; first-run all integrations disabled; reuse `session.save`/`session.load` (no new IPC channel, no preload change); relocate (do not re-implement) the settings-oauth-clients-v1 credential UI into per-integration tabs with shared Atlassian fields on both the Jira and Confluence tabs; disable-active-surface falls back to Terminal. Phase 0 designer step is required (UI-bearing).
