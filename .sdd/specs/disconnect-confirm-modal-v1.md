# Spec: Confirm-before-Disconnect Modal — v1

**Status**: Draft
**Created**: 2026-06-22
**Supersedes**: —
**Related plan**: .sdd/plans/disconnect-confirm-modal-v1.md

---

## Grounding

**codegraph_explore** (verbatim source pulled, treated as Read):
- `SlackPanel JiraPanel ConfluencePanel GoogleCalendarPanel disconnect atlassianPanelBits` → each panel holds a local `disconnect` callback wired to a footer `ConnectionStatus`/`GoogleConnectionStatus` whose `onDisconnect` calls `window.cosmos.<int>.disconnect()` immediately; Jira+Confluence SHARE `atlassianPanelBits.tsx`'s `ConnectionStatus`.
- `SettingsDialog disconnect force-disconnect confirm Dialog connect integration rows` → `ConnectionBlock` renders a `Disconnect` Button per integration; 4 rows wire `onDisconnect={() => void window.cosmos.<int>.disconnect()}`. SettingsDialog already has an INLINE confirm-on-Save force-disconnect pattern (`confirming` boolean → `Alert` + Cancel/Confirm in `DialogFooter`; Esc cancels the confirm, not the dialog).
- `dialog.tsx button.tsx` → shadcn `Dialog` exists (`components/ui/dialog.tsx`); **no `alert-dialog` primitive**. `Button` already exposes a `destructive` variant.

**memory_recall**:
- `integration disconnect manager OAuth …` → `oauth-cancel-v1` bug memo: every panel already has a `connecting`-state **Cancel** affordance (wired to `cancelConnect()`), distinct from Disconnect. Confirms a connect/OAuth can be in-flight concurrently with the Disconnect affordance only being shown in the `connected` state.
- Saved `disconnect-confirm-modal-v1` architecture note (5 call sites, no alert-dialog primitive, destructive variant present, reuse Settings confirm shape, Enter-on-destructive OQ).

---

## Overview

Disconnecting an integration (Slack, Jira, Confluence, Google Calendar) is currently
immediate: one click on **Disconnect** drops the connection and clears the stored token.
This feature inserts a confirmation step — a modal that asks "Disconnect *&lt;Integration&gt;*?"
with **Cancel** and a destructive **Disconnect** — so an accidental click never tears down a
connection. Confirming runs the existing disconnect; cancelling/closing leaves the
connection untouched. Renderer-only UX; no change to how disconnect itself works.

## User Scenarios

### Confirm before dropping a panel connection · P1

**As a** cosmos user with a connected integration panel
**I want to** be asked to confirm before the integration disconnects
**So that** an accidental click on Disconnect does not silently sign me out.

**Acceptance criteria:**
- Given the Slack panel footer shows **Disconnect**, when I click it, then a modal opens
  reading "Disconnect Slack? You'll need to reconnect to use it." with **Cancel** and a
  destructive **Disconnect** action, and `window.cosmos.slack.disconnect()` has NOT yet run.
- Given the confirm modal is open, when I click the destructive **Disconnect**, then
  `disconnect()` runs once, the connection drops, and the modal closes.
- Given the confirm modal is open, when I click **Cancel** (or press Esc, or click the
  overlay), then the modal closes, `disconnect()` does NOT run, and the panel stays connected.
- The same flow applies identically in the Jira, Confluence, and Google Calendar panels,
  with the integration's own name in the prompt.

### Confirm from the Settings rows · P1

**As a** user managing integrations in the Settings dialog
**I want to** be asked to confirm before each per-integration **Disconnect** row acts
**So that** Settings behaves consistently with the panels.

**Acceptance criteria:**
- Given a Settings integration tab shows a connected row with **Disconnect**, when I click
  it, then the same confirm modal opens scoped to that integration, and only on confirm does
  `disconnect()` run.
- Given the existing Settings **Save** confirm (the force-disconnect-on-Save warning) is a
  separate flow, when I disconnect a row, then the disconnect-confirm reads consistently with
  the Save confirm (same warning tone/copy family) but is its own distinct prompt.

### Disconnect while a connect/OAuth is in flight · P2

**As a** user
**I want to** the confirm to behave sanely if a connect is happening
**So that** I am not offered a contradictory action.

**Acceptance criteria:**
- Given an integration is in the `connecting` state, then the footer/row shows **Cancel**
  (the existing `cancelConnect` affordance), NOT **Disconnect** — so the disconnect-confirm
  is only reachable from the `connected` state and never collides with an in-flight connect.
- Given the confirm modal is open and the integration transitions OUT of `connected`
  (e.g. an external `reconnect_needed`/disconnect via `statusChanged`), when I then confirm,
  then the disconnect call is a harmless no-op against an already-disconnected manager (no
  crash, modal closes).

## Functional Requirements

| ID     | Requirement                                                                                  |
|--------|----------------------------------------------------------------------------------------------|
| FR-001 | Clicking any **Disconnect** affordance MUST open a confirmation modal instead of disconnecting immediately. |
| FR-002 | The actual `window.cosmos.<int>.disconnect()` MUST run ONLY when the user confirms via the modal's destructive action. |
| FR-003 | Cancelling the modal — Cancel button, Esc, or overlay/outside click — MUST close it and leave the connection untouched (no `disconnect()` call). |
| FR-004 | The modal MUST be a SINGLE shared confirm component reused at every disconnect site (4 panels via 3 status components + 4 Settings rows), not a per-panel reimplementation. |
| FR-005 | The modal copy MUST name the specific integration: title "Disconnect &lt;Integration&gt;?" and a body explaining a reconnect will be needed (designer owns exact wording). |
| FR-006 | The confirm action MUST use the shadcn `destructive` Button variant; the cancel action a non-destructive (`outline`/`ghost`) variant. |
| FR-007 | The shared confirm MUST be composed from the existing shadcn `Dialog` primitive (no new dependency); an `alert-dialog` primitive MAY be added only if the plan finds Dialog insufficient. |
| FR-008 | The **Disconnect** affordance MUST remain available only in the `connected` state; the `connecting` state keeps its existing **Cancel** (`cancelConnect`) affordance unchanged (FR untouched). |
| FR-009 | The Settings Save-confirm (force-disconnect-on-Save) MUST remain its own existing flow; this modal MUST NOT replace or merge it, but SHOULD read consistently with it. |
| FR-010 | Esc while the confirm modal is open MUST cancel the confirm (close modal, stay connected), mirroring the Settings `confirming` Esc semantics. |
| FR-011 | The confirm-state logic (open/which-integration/confirm/cancel) SHOULD be a small pure unit (a hook + pure helper) that is node-testable without Electron or a live DOM. |
| FR-012 | No IPC channel, payload, validator, preload method, or main-process change is introduced; the disconnect contract is reused as-is. |

## Edge Cases & Constraints

- **In-flight connect/OAuth:** Disconnect is only shown in `connected`; `connecting` shows
  Cancel. The two never co-render, so no collision (FR-008).
- **Status changes under an open modal:** if the integration leaves `connected` while the
  modal is open, a subsequent confirm is a harmless no-op (manager already not connected);
  the modal must not crash (FR-002 edge of Scenario 3).
- **Double-confirm guard:** confirming MUST disconnect exactly once even on rapid double
  click (the modal closes on confirm).
- **Enter key on a destructive action:** see Open Questions — recommended default is that
  Enter does NOT trigger the destructive confirm (no autofocus on the destructive button).
- **Out of scope:** changing disconnect behavior itself; any main/IPC/token change; a global
  "disconnect all"; confirming Connect/Reconnect (only destructive Disconnect is gated);
  changing the existing OAuth **Cancel** affordance; changing the Settings Save-confirm copy
  beyond consistency.

## Success Criteria

| ID     | Criterion                                                                                  |
|--------|--------------------------------------------------------------------------------------------|
| SC-001 | All 4 panels + all 4 Settings rows route disconnect through the one shared confirm modal; zero remaining call sites invoke `disconnect()` without a confirm. |
| SC-002 | A confirm fires exactly one `disconnect()`; a cancel/Esc/overlay fires zero. |
| SC-003 | The confirm-state hook/helper has passing node tests for open→confirm (disconnect runs) and open→cancel (disconnect does not run). |
| SC-004 | `npm run typecheck` passes; no new IPC channel appears in `src/shared/ipc/*`. |
| SC-005 | The destructive action uses the `destructive` Button variant and the modal names the correct integration in each of the 4 panels and 4 Settings rows. |

---

## Open Questions

- [ ] **Enter-to-confirm on a destructive action.** Recommended default: **Enter does NOT
  confirm.** Do not autofocus the destructive **Disconnect** button; if anything, focus
  Cancel. This prevents a stray Enter from destroying a connection. Esc cancels (FR-010).
  Confirm with the user if they would rather Enter confirm for speed.
- [ ] **Shared component vs. per-panel.** Recommended default: **one shared `ConfirmDialog`
  component + `useConfirm` hook**, reused everywhere (FR-004). Flagged only because the 3
  status components (`SlackPanel` local, `atlassianPanelBits` shared, `GoogleCalendarPanel`
  local) own the footer button — the plan must decide whether the modal mounts in each panel
  or whether the status components take an `onRequestDisconnect` that the panel wires to the
  shared hook. Recommended: status components emit an intent up to the panel (rename/extend
  `onDisconnect` → "request disconnect"), and the panel owns the shared modal.
- [ ] **Confluence/Google share vs. duplicate copy.** Recommended default: a single
  `integrationLabel` prop drives copy; no per-integration copy duplication.
- [ ] **Should the Settings Save-confirm be unified with this modal?** Recommended default:
  **No — keep the existing Save-confirm as-is** (it is a multi-integration "this save will
  sign out X and Y" warning, semantically different from a single-integration disconnect).
  Only align tone/copy. Confirm the user agrees not to refactor the Save-confirm.
