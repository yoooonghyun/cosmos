# Spec: Settings Redesign — Tabbed Surface + Per-Integration Rail Gating — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: builds on (does not replace) settings-oauth-clients-v1
**Related plan**: .sdd/plans/settings-redesign-v1.md

---

## Grounding

**codegraph_explore** (queries run → one-line takeaways):
- `SettingsDialog rail items RAIL_ITEMS SurfaceId integration connection status getStatus onStatusChanged` → the current Settings UI (`SettingsDialog.tsx`) is ONE modal with three stacked `<section>` GROUPS (Slack, **Atlassian — one group for Jira+Confluence combined**, Google Calendar) and edits ONLY OAuth client credentials (ids + write-only secret); it has NO connect/disconnect — those live in the panels.
- `RAIL_ITEMS SurfaceId App rail surface state connection status onStatusChanged getStatus slack jira confluence google` → live `App.tsx` has a STATIC 6-item `RAIL_ITEMS` array (`terminal`, `generated-ui`, `slack`, `jira`, `confluence`, `google-calendar`) all unconditionally rendered; `surface` is a single `useState<SurfaceId>('terminal')`; `useConnectedStatus()` tracks live `connected` per integration via `window.cosmos.<int>.getStatus()` + `onStatusChanged`; the gear opens the modal via `setSettingsOpen`.
- `registerSettingsIpcHandlers ClientConfigStatus ... sessionSnapshot sessionStore SESSION_SCHEMA_VERSION` → session state persists as PLAIN unencrypted JSON via `SessionStore` (`<userData>/session.json`), schema-versioned (`SESSION_SCHEMA_VERSION = 6`), validated/normalized at the boundary by `validateSnapshot`; `SessionSnapshot.panels` is keyed `terminal | generated-ui | jira | slack | confluence | google-calendar`. Client CREDENTIALS persist separately in an ENCRYPTED `clientConfig.enc` blob (settings-oauth-clients-v1). The `settings:` IPC namespace (`getConfig`/`save`/`clearField`) returns `ClientConfigStatus`.
- `SlackPanel not_connected Connect button connect disconnect reconnect-needed empty state JiraPanel ConfluencePanel` → every manager (`SlackManager`/`JiraManager`/`ConfluenceManager`/`GoogleCalendarManager`) owns its own state machine (`not_connected → connecting → connected → reconnect_needed`) and `connect()`/`disconnect()`; the panels render the not-connected/Connect prompt themselves. So "is this integration connected" is already fully independent of "is its icon in the rail."
- `validateSnapshot normalizeGenerativePanel session validate panels google-calendar` → `validateSnapshot` builds the snapshot field-by-field with per-key normalizers and returns `null` on a version mismatch (→ clean session); this is exactly where a new per-integration `enabled` map is added + version-bumped.

**memory_recall / memory_smart_search**:
- `settings modal integration enable connection rail panel persistence` → no prior stored decision (empty); saved a new architecture memory for this feature (enabled-vs-connected split, enabled lives in the session snapshot not the encrypted blob, gateable vs always-present rail items, first-run defaults, tabbed settings, disable-active-surface fallback).
- MEMORY.md index confirms the standing invariants: secrets/tokens stay in main encrypted; the session snapshot is non-secret structure. The new `enabled` flag is a non-secret UI preference, so it belongs with the session snapshot, not the encrypted credential blob.

---

## Overview

Today Settings is a single modal that stacks every integration's OAuth-client fields together
(with Jira and Confluence combined under one "Atlassian" group), and the left rail statically shows
all integration icons whether or not the user uses them. This feature restructures Settings into a
**tabbed surface** — one tab per integration (Slack, Jira, Confluence, Google Calendar), with Jira
and Confluence **split into their own tabs** — and makes each integration's **left-rail panel icon
appear only when that integration is ENABLED**. "Enabled" (the user wants this panel in the rail) is
a new, distinct, persisted preference, separate from "connected" (an OAuth token is present).

## User Scenarios

> Prioritized P1 (must) / P2 (should) / P3 (nice to have).

### Enable an integration to show its panel in the rail · P1

**As a** cosmos user
**I want to** turn an integration on so its icon appears in the left rail
**So that** my rail shows only the panels I actually use, not every integration cosmos supports.

**Acceptance criteria:**
- Given the Settings surface is open, when I view an integration's tab, then I see an **Enable** toggle for that integration alongside its connect/credential controls.
- Given an integration is disabled, when I turn its Enable toggle on, then its icon appears in the left rail without an app restart.
- Given an integration is enabled, when I turn its Enable toggle off, then its icon is removed from the left rail without an app restart.
- Given I enable an integration and close the app, when I relaunch, then that integration's icon is still in the rail (the enabled state persists across sessions).

### Each integration has its own Settings tab; Jira and Confluence are split · P1

**As a** user configuring integrations
**I want** Settings organized as one tab per integration, with Jira and Confluence as separate tabs
**So that** I can find and configure each integration on its own page instead of scrolling one long modal.

**Acceptance criteria:**
- Given the Settings surface is open, when I look at its navigation, then I see a separate tab for each integration — Slack, Jira, Confluence, Google Calendar — plus a General tab.
- Given the Settings surface is open, when I open the Jira tab and the Confluence tab, then each is its own page with its own enable toggle, connection status/connect-disconnect, and credential fields — they are NOT combined into a single Atlassian section.
- Given I select an integration tab, when I view it, then exactly that one integration's settings fill the content area (one tab visible at a time).

### Enable without connecting; the panel prompts to connect · P1

**As a** user who enabled an integration I have not connected yet
**I want** the panel's icon to appear and the panel to prompt me to connect
**So that** enabling is a lightweight "show me this panel" action, decoupled from completing OAuth.

**Acceptance criteria:**
- Given an integration is enabled but not connected, when I open its panel from the rail, then the panel shows its existing not-connected state with a Connect affordance (no change to the panel's own connect flow).
- Given an integration is connected but I disable it, when I disable it, then only its rail icon is removed — its stored token/connection is NOT cleared, and re-enabling shows it connected again.
- Given an integration is enabled, when I view its Settings tab, then I see both its connection status (connected / not-connected / reconnect-needed) and its Enable toggle as two distinct controls.

### Shared Atlassian OAuth reads consistently across the Jira and Confluence tabs · P1

**As a** user who connected Jira and Confluence (which share one Atlassian OAuth client)
**I want** each tab to reflect that one shared client connection honestly
**So that** I am never confused about whether connecting in one tab affected the other.

**Acceptance criteria:**
- Given the Jira and Confluence tabs both show the Atlassian client-credential fields, when I edit the Atlassian Client ID/Secret on either tab, then the change applies to the one shared Atlassian client and (per settings-oauth-clients-v1) force-disconnects BOTH Jira and Confluence on an effective change.
- Given Jira is connected and Confluence is not, when I view each tab, then each tab shows its OWN connection state independently (the connections are separate even though the OAuth client is shared).
- Given I connect Jira from its tab, when the connect completes, then Confluence's tab still shows its own separate connection state (connecting one does NOT auto-connect the other).

### Disabling the active panel re-focuses gracefully · P1

**As a** user disabling the integration whose panel I am currently viewing
**I want** the app to move me to a sensible surface
**So that** I am never left staring at a panel whose icon just vanished.

**Acceptance criteria:**
- Given I am viewing an integration's panel and that integration is the active surface, when I disable it, then the active surface falls back to the Terminal (or, if Terminal were ever unavailable, the first remaining enabled rail item).
- Given I disable an integration that is mid-connection (connecting), when I disable it, then the rail icon is removed and the in-flight connect is left to settle on its own — disabling never cancels or corrupts an OAuth flow, and the integration stays connected if the flow succeeds.

### First-run shows a minimal rail · P2

**As a** first-time user
**I want** the rail to start clean with only the always-present panels
**So that** I opt into integrations deliberately rather than seeing a wall of icons I have not set up.

**Acceptance criteria:**
- Given a fresh install (no persisted snapshot), when the app launches, then the rail shows Terminal and Generated UI only; all integration icons (Slack, Jira, Confluence, Google Calendar) are hidden until enabled.
- Given a fresh install, when I open Settings, then every integration's Enable toggle is OFF by default.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST present Settings as a **tabbed surface** with one tab per integration — Slack, Jira, Confluence, Google Calendar — plus a **General** tab. |
| FR-002 | Jira and Confluence MUST each have their OWN separate Settings tab; they MUST NOT be combined into a single Atlassian section. |
| FR-003 | The system MUST maintain a per-integration **`enabled`** boolean for each gateable integration (Slack, Jira, Confluence, Google Calendar), distinct from that integration's **connection** state. |
| FR-004 | The left rail MUST render an integration's icon if and only if that integration is `enabled`. Enabling/disabling MUST update the rail WITHOUT an app restart. |
| FR-005 | **Terminal** and **Generated UI** are NOT integrations and MUST always be present in the rail (they are not gateable and have no Enable toggle). |
| FR-006 | The `enabled` state MUST be persisted across sessions and MUST be re-read at startup to build the rail. |
| FR-007 | The `enabled` state MUST be persisted as NON-secret app preference in the existing plain-JSON session snapshot store (NOT the encrypted client-config blob). |
| FR-008 | First-run default: every gateable integration MUST be `enabled = false` (Terminal and Generated UI always present). |
| FR-009 | Enabling an integration MUST NOT initiate a connection; disabling an integration MUST NOT clear its stored token or alter its connection state. Enable governs rail visibility ONLY. |
| FR-010 | Each integration tab MUST show that integration's connection status (connected / not-connected / connecting / reconnect-needed) and provide connect/disconnect, alongside its Enable toggle. |
| FR-011 | Each integration tab MUST host that integration's OAuth client-credential fields (the settings-oauth-clients-v1 inputs): Slack Client ID on the Slack tab; the shared Atlassian Client ID + write-only Client Secret on BOTH the Jira and Confluence tabs; Google Client ID + write-only Client Secret on the Google Calendar tab. |
| FR-012 | Because Jira and Confluence share one Atlassian client, the Atlassian credential edit on either tab MUST mutate the single shared client and carry the existing force-disconnect-on-effective-change behavior for BOTH Jira and Confluence (settings-oauth-clients-v1 FR-012 preserved). |
| FR-013 | Each integration tab MUST show its OWN connection state independently; connecting/disconnecting one integration MUST NOT change another's connection state (Jira vs Confluence remain independent connections even though they share an OAuth client). |
| FR-014 | When the currently ACTIVE surface is disabled, the system MUST move the active surface to the Terminal (or, if Terminal were unavailable, the first remaining enabled rail item). |
| FR-015 | Disabling an integration that is mid-connection MUST NOT cancel or corrupt the in-flight OAuth flow; the rail icon is removed and the connection settles on its own. |
| FR-016 | Every new/changed IPC payload that carries `enabled` state across the main boundary MUST use the single typed contract in `src/shared/ipc.ts`, be validated at the boundary, and a malformed payload MUST be warned-and-ignored (never crash, never overwrite good state). |
| FR-017 | The Settings surface MUST keep all behavior from settings-oauth-clients-v1 (write-only secret, secret-never-leaves-main, save/clear, env fallback resolver, force-disconnect-on-change); this feature reorganizes that UI into tabs, it does not weaken its contract. |
| FR-018 | A persisted snapshot lacking the new `enabled` map (older schema) MUST be handled by the existing normalize/version discipline — an unreadable older snapshot falls back to a clean session whose integrations default to disabled (FR-008), never a crash. |

## Edge Cases & Constraints

- **All integrations disabled.** A legal state: the rail shows only Terminal + Generated UI. Settings remains reachable (the gear is not gated).
- **Enabled but credentials unset.** Enabling an integration whose effective client id is unset (neither Settings nor env) is allowed: the icon shows, and the panel/tab surfaces the existing "not configured / connect" state — enabling does not require credentials.
- **Disable the active surface.** Focus falls back to Terminal (FR-014); never to a now-hidden panel.
- **Disable while connecting.** Rail icon removed; the OAuth flow is left to complete (FR-015). If it succeeds the integration is connected-but-disabled (its token is kept); re-enabling shows it connected.
- **Re-enable a previously-connected integration.** Shows connected immediately (token was never cleared by disable — FR-009).
- **Settings surface form factor.** This spec mandates a tabbed Settings *surface*; whether it remains a modal dialog with an internal tab list or becomes a larger panel is a presentation choice left to the design step, provided the one-tab-at-a-time + per-integration-tab structure (FR-001/FR-002) holds.
- **Shared-OAuth wording.** Each of the Jira and Confluence tabs must make clear the Atlassian credentials are shared (so a user editing them on the Jira tab understands Confluence is also affected) — exact copy is a design concern, the shared-mutation behavior is FR-012.
- **Out of scope (v1):** reordering rail items; per-integration rail icon customization; enabling/disabling Terminal or Generated UI; separate Atlassian clients for Jira vs Confluence; remembering the last-open Settings tab across launches; a search/filter over integrations.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Settings shows a General tab plus four integration tabs (Slack, Jira, Confluence, Google Calendar), one visible at a time. |
| SC-002 | Jira and Confluence appear as two separate tabs, each with its own enable toggle, connection controls, and the shared Atlassian credential fields. |
| SC-003 | Toggling an integration's Enable adds/removes exactly that integration's rail icon live, with no app restart. |
| SC-004 | Enabled state survives an app relaunch (persisted) and is re-read at startup to build the rail. |
| SC-005 | A fresh install shows only Terminal + Generated UI in the rail; all integration Enable toggles default OFF. |
| SC-006 | Disabling a connected integration removes only its icon — its token is retained and re-enabling shows it connected. |
| SC-007 | Disabling the active panel moves focus to Terminal; no blank/hidden surface is left active. |
| SC-008 | Editing the Atlassian credentials on either the Jira or Confluence tab mutates the one shared client and force-disconnects both per settings-oauth-clients-v1; Jira and Confluence connection states otherwise stay independent. |
| SC-009 | An invalid `enabled` IPC/snapshot payload is warned-and-ignored without crashing and without corrupting good persisted state. |
| SC-010 | All settings-oauth-clients-v1 secret/resolver/force-disconnect behavior still holds after the reorganization. |

---

## Open Questions

- None blocking. The two principal decisions are settled as defaults below; the design step refines presentation only.
  - **Enabled vs connected:** `enabled` is a separate persisted boolean per gateable integration; the rail filters on `enabled`; the panel still owns connect/disconnect (FR-003/FR-004/FR-009).
  - **First-run defaults:** Terminal + Generated UI always present and ungateable; all integrations default `enabled = false` (FR-005/FR-008).
  - **Where `enabled` lives:** the plain-JSON session snapshot (non-secret preference), version-bumped, validated at the boundary (FR-006/FR-007/FR-018).
