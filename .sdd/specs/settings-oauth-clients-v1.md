# Spec: Settings — OAuth Client Configuration — v1

**Status**: Draft
**Created**: 2026-06-15
**Supersedes**: —
**Related plan**: .sdd/plans/settings-oauth-clients-v1.md

---

## Grounding

**codegraph_explore** (queries run, one-line takeaways):
- `atlassianConfig slackConfig tokenStore slackManager jiraManager confluenceManager OAuth client config` → confirmed each manager owns its own `TokenStore`; `createSlackManager/createJiraManager/createConfluenceManager` in `index.ts` are the only places client ids/secret are read (from `process.env`) inside the `runOAuth`/`refresh` closures.
- `atlassianConfig.ts ... createJiraManager createConfluenceManager index.ts connect handlers ipcMain` → ONE Atlassian client (`COSMOS_ATLASSIAN_CLIENT_ID` + optional `COSMOS_ATLASSIAN_CLIENT_SECRET`) drives BOTH Jira (`createJiraManager`, index.ts:370) and Confluence (`createConfluenceManager`, index.ts:424); Slack reads only `COSMOS_SLACK_CLIENT_ID` (no secret, PKCE). `index.ts` registers per-integration ipc handlers (`registerJiraIpcHandlers`, `registerConfluenceIpcHandlers`, Slack inside `registerIpcHandlers`).
- `TokenStore save load clear has encrypt safeStorage StoredTokenSet integrations tokenStore.ts` → `TokenStore` is a `safeStorage`-encrypted single-blob store with injectable `safeStorage`/`fs`; `save()` throws if encryption unavailable (refuses plaintext). This is the exact pattern the new client-config store mirrors.
- `src/shared/ipc.ts channel names ...` → channel-name constants per integration (`SlackChannelName`, `JiraChannelName`, `ConfluenceChannelName`, `SessionChannelName`), each a `{ ... } as const`; renderer surface is `CosmosApi` with per-domain sub-APIs (`slack`, `jira`, `confluence`, `session`).
- `App.tsx renderer sidebar rail ... preload window.cosmos` → the left rail is a Radix vertical `Tabs` `TabsList` in `AppShell` (`App.tsx`), `RAIL_ITEMS` array; the gear button is a NON-tab control that must sit at the BOTTOM of this rail (separate from the surface `TabsTrigger`s).

**memory_recall / memory_smart_search**:
- `OAuth client secret safeStorage encryption Atlassian Slack config env` → no prior stored decision (empty). Saved a new architecture memory for this feature (resolver merge order, encrypted client-config store, write-only secret, force-disconnect-on-change).
- MEMORY.md index confirms the standing rule: secrets/tokens stay in main, encrypted at rest; renderer never sees them.

---

## Overview

A Settings dialog lets the user configure the OAuth client credentials cosmos uses for its
integrations — Slack (client ID only) and Atlassian (client ID + client secret, one client
shared by Jira and Confluence) — without editing a `.env` file. Values saved here override the
environment-variable defaults; the environment remains the fallback. The dialog opens from a gear
icon pinned at the bottom of the left sidebar.

## User Scenarios

### Configure an integration's OAuth client from the UI · P1

**As a** cosmos user
**I want to** enter my own Slack / Atlassian OAuth client credentials in a Settings dialog
**So that** I can connect integrations without hand-editing a `.env` file or restarting from a shell.

**Acceptance criteria:**
- Given the app is running, when I click the gear icon at the bottom of the left sidebar, then a Settings dialog opens showing the OAuth client configuration.
- Given the Settings dialog is open, when I view the Slack section, then I see one editable field — Slack **Client ID** — pre-filled with the currently effective value if one exists.
- Given the Settings dialog is open, when I view the Atlassian section, then I see an editable **Client ID** field (pre-filled if set) and a **Client Secret** field that shows only a "configured / not configured" indicator, never the secret's value.
- Given I have typed a value, when I save, then the dialog reports success and the new values take effect for the next connect/refresh without an app restart.

### Settings override environment defaults · P1

**As a** user who already has `.env` values
**I want** anything I save in Settings to take precedence over the matching `COSMOS_*` env var
**So that** I can change a credential at runtime while still relying on the env value for anything I leave unset.

**Acceptance criteria:**
- Given `COSMOS_ATLASSIAN_CLIENT_ID` is set in the environment and no Atlassian Client ID is saved in Settings, when an Atlassian connection runs OAuth, then the env value is used.
- Given an Atlassian Client ID is saved in Settings, when an Atlassian connection runs OAuth, then the saved value is used (the env value is ignored).
- Given a Settings field is cleared back to empty, when an integration runs OAuth, then it falls back to the matching env value again (clearing a field reverts to the env default, it does not blank the credential).

### Changing a connected client forces a reconnect · P1

**As a** user changing a client ID/secret while an integration is connected
**I want** cosmos to drop the now-stale connection
**So that** I am never left with a token minted by a client I no longer use.

**Acceptance criteria:**
- Given Slack is connected and I change (or clear) the saved Slack Client ID to a different effective value, when I save, then Slack is force-disconnected (its stored token is cleared) and its panel shows not-connected; I reconnect to re-consent.
- Given Jira and/or Confluence are connected and I change (or clear) the saved Atlassian Client ID or Client Secret to a different effective value, when I save, then BOTH Jira and Confluence are force-disconnected.
- Given I open Settings and save WITHOUT changing any effective value, when the save completes, then no integration is disconnected.

### Secret never leaves the main process · P1

**As a** security-conscious operator
**I want** the Atlassian client secret to stay encrypted in main and never reach the renderer
**So that** the secret cannot leak through any UI, IPC payload, or log.

**Acceptance criteria:**
- Given an Atlassian client secret is saved, when the renderer requests the current config, then it receives only a boolean "secret configured" flag, never the secret value.
- Given any save/clear/status operation, when payloads cross the IPC boundary or are logged, then the secret value appears in none of them.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST provide a gear (cog) icon control pinned at the BOTTOM of the left sidebar rail that opens the Settings dialog. |
| FR-002 | The Settings UI MUST be presented as a modal dialog (not a full surface/route). |
| FR-003 | The Settings dialog MUST expose exactly three editable inputs: Slack **Client ID**, Atlassian **Client ID**, Atlassian **Client Secret**. No other OAuth fields are user-editable in v1. |
| FR-004 | Redirect URIs MUST remain runtime-derived (loopback) and MUST NOT be user-editable. |
| FR-005 | The system MUST treat Slack and Atlassian as two logical clients; the single Atlassian client's ID and secret apply to BOTH the Jira and Confluence connections. |
| FR-006 | Saved client config MUST be persisted in the main process, encrypted at rest (same `safeStorage` mechanism as the token store). |
| FR-007 | The Atlassian client secret MUST NEVER be returned to the renderer, placed on any IPC payload sent to the renderer, written to any surface, or logged. The renderer MAY only learn a boolean "secret configured / not configured". |
| FR-008 | Client IDs are NOT secret and MAY round-trip to the renderer for display and editing. |
| FR-009 | When resolving the effective value of any client field, the system MUST use the Settings value when set, and fall back to the matching environment variable (`COSMOS_SLACK_CLIENT_ID`, `COSMOS_ATLASSIAN_CLIENT_ID`, `COSMOS_ATLASSIAN_CLIENT_SECRET`) only when the Settings field is unset. |
| FR-010 | The OAuth connect and token-refresh paths for Slack, Jira, and Confluence MUST read client credentials through this resolver rather than directly from `process.env`. |
| FR-011 | Saving Settings MUST take effect for subsequent connect/refresh operations WITHOUT requiring an app restart. |
| FR-012 | On save, for each logical client whose EFFECTIVE id or secret CHANGES, the system MUST force-disconnect every affected integration by clearing that integration's stored token: a Slack change affects Slack; an Atlassian change affects BOTH Jira and Confluence. |
| FR-013 | On save with NO effective change to a client, the system MUST NOT disconnect that client's integration(s). |
| FR-014 | The renderer MUST be able to query the current config STATUS: each client id's effective value and source (set-in-settings vs from-env vs unset), and a boolean for whether the Atlassian secret is configured (and its source). |
| FR-015 | The system MUST support clearing an individual field back to unset (reverting it to the env fallback) as a distinct operation from saving a new value. |
| FR-016 | Every Settings IPC payload crossing the main boundary MUST be validated; an invalid payload MUST be warned-and-ignored, never crash the process, and never overwrite good stored config. |
| FR-017 | All new IPC MUST use the single typed contract in `src/shared/ipc.ts` (a new `settings:` channel namespace + a `settings` sub-API on `CosmosApi`); no ad-hoc channel strings. |

## Edge Cases & Constraints

- **Encryption unavailable.** If `safeStorage` encryption is unavailable, a SAVE that would persist config (especially the secret) MUST fail with a clear error rather than write plaintext — mirroring `TokenStore.save()`. The dialog surfaces the failure; nothing is persisted.
- **Partial config.** Saving only some fields is allowed. Unset fields fall back to env. An integration whose effective id is still unset (neither Settings nor env) simply cannot connect, exactly as today (fail-fast "not configured" on connect).
- **Clearing a field back to env fallback.** Clearing a Settings field is a real change if it alters the effective value (e.g. Settings had a value, env has a different value or none) — it triggers force-disconnect per FR-012; if it does not alter the effective value, it does not.
- **Save with no change ⇒ no disconnect.** Re-saving identical effective values must not drop any connection (FR-013).
- **Connected-state ambiguity.** "Affected integration" means one that currently holds a stored token; force-disconnect clears the token and resets its connection state to not-connected. An integration that is not connected needs no action.
- **Secret display.** The secret field is write-only from the renderer's perspective: it can be set or cleared, and its configured/not-configured status read, but its value is never read back.
- **Out of scope (v1):** editing redirect URIs/ports; editing OAuth scopes; per-integration separate Atlassian clients; importing/exporting config; multiple saved profiles; validating credentials against the provider before save (validity is still proven only by a successful connect).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A gear button at the bottom of the left rail opens a modal Settings dialog. |
| SC-002 | The dialog shows three inputs (Slack Client ID, Atlassian Client ID, Atlassian Client Secret), with the secret rendered as a configured/not-configured affordance only. |
| SC-003 | A saved Slack/Atlassian Client ID overrides the corresponding env var on the next connect; clearing it reverts to the env value — verifiable via the resolver. |
| SC-004 | After saving a changed Slack client, a connected Slack drops to not-connected; after saving a changed Atlassian client, both connected Jira and Confluence drop to not-connected. |
| SC-005 | Saving with no effective change leaves all connections intact. |
| SC-006 | The on-disk client-config blob is ciphertext (never plaintext secret), and no IPC payload to the renderer, log line, or surface contains the secret value. |
| SC-007 | An invalid Settings IPC payload is warned-and-ignored without crashing and without overwriting existing good config. |
| SC-008 | Saved settings affect the next connect/refresh with no app restart. |

---

## Open Questions

- None blocking. All four product decisions (scope of fields, env-fallback precedence, force-disconnect-on-change, secret-stays-in-main) are settled inputs and are encoded above.
