# Plan: Confirm-before-Disconnect Modal — v1

**Status**: Draft
**Created**: 2026-06-22
**Last updated**: 2026-06-22
**Spec**: .sdd/specs/disconnect-confirm-modal-v1.md

---

## Grounding

See the spec's Grounding section (same investigation). Net findings driving this plan:
- 5 disconnect call sites in the renderer: `SlackPanel.tsx`, `JiraPanel.tsx`,
  `ConfluencePanel.tsx`, `GoogleCalendarPanel.tsx` (each owns a local `disconnect`
  callback rendered through a footer status component — Jira+Confluence share
  `atlassianPanelBits.tsx`'s `ConnectionStatus`), plus 4 `ConnectionBlock` rows in
  `SettingsDialog.tsx` wiring `onDisconnect={() => void window.cosmos.<int>.disconnect()}`.
- No `alert-dialog` shadcn primitive exists (`components/ui/` has `dialog.tsx` only).
  `Button` already has a `destructive` variant. Compose the confirm from shadcn `Dialog`.
- SettingsDialog already models a confirm via a `confirming` boolean + `Alert` + Cancel/Confirm
  in `DialogFooter`, with "Esc cancels the confirm, not the dialog" — reuse that interaction shape.

## Summary

Add ONE shared renderer-only confirm primitive — a `ConfirmDialog` composed from the existing
shadcn `Dialog` with a `destructive` confirm Button, plus a tiny `useConfirm` hook + pure
`confirmLogic.ts` helper holding the open/which-target state (node-testable, `.ts`/`.test.ts`
split per DEVELOPMENT.md). Each integration panel and each Settings disconnect row routes its
disconnect through this confirm: the click now OPENS the modal; the real
`window.cosmos.<int>.disconnect()` runs only from the modal's confirm callback. The three footer
status components (`SlackPanel` local `ConnectionStatus`, the shared `atlassianPanelBits`
`ConnectionStatus`, `GoogleCalendarPanel`'s `GoogleConnectionStatus`) keep their `onDisconnect`
prop, but the panel wires it to "open the confirm" rather than "disconnect now". No IPC, preload,
main, or token change — the disconnect contract is reused verbatim.

## Technical Context

| Item              | Value                                                                 |
|-------------------|-----------------------------------------------------------------------|
| Language          | TypeScript / React 19 (renderer only)                                 |
| Key dependencies  | Existing shadcn `Dialog` (`components/ui/dialog.tsx`), `Button` `destructive` variant; radix-ui already present. NO new package. |
| Files to create   | `src/renderer/components/ui/confirm-dialog.tsx` (shared component); `src/renderer/useConfirm.ts` + `src/renderer/confirmLogic.ts` + `src/renderer/confirmLogic.test.ts` |
| Files to modify   | `src/renderer/SlackPanel.tsx`, `src/renderer/JiraPanel.tsx`, `src/renderer/ConfluencePanel.tsx`, `src/renderer/GoogleCalendarPanel.tsx`, `src/renderer/atlassianPanelBits.tsx`, `src/renderer/SettingsDialog.tsx` (+ designer copy pass) |
| Contract change   | NONE — no `src/shared/ipc/*` edit, no preload, no main handler        |

---

## Implementation Checklist

### Phase 1 — Shared confirm primitive + logic (interface)

- [ ] Read the spec; confirm the four Open Questions are resolved (defaults stand unless the
      user overrode them: Enter does NOT confirm; one shared component; label-driven copy;
      Save-confirm left as-is).
- [ ] Create `src/renderer/confirmLogic.ts` — pure helpers for the confirm state machine:
      e.g. `type ConfirmTarget = { integration: 'slack'|'jira'|'confluence'|'google-calendar'; label: string }`
      and pure reducers `openConfirm(target)`, `closeConfirm()` returning `{ open, target }`,
      plus a `confirmCopy(label)` → `{ title, body, confirmLabel }` builder. No React, no DOM.
- [ ] Create `src/renderer/useConfirm.ts` — a thin hook over `confirmLogic`: holds
      `{ open, target }` state and exposes `requestConfirm(target, onConfirm)`, `cancel()`,
      `confirm()` (runs the stored `onConfirm` once then closes). Keep the side-effecting
      `onConfirm` in a ref so the pure logic stays testable.
- [ ] Create `src/renderer/components/ui/confirm-dialog.tsx` — a `ConfirmDialog` composed from
      shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter`.
      Props: `{ open, title, description, confirmLabel?, onConfirm, onOpenChange }`. Footer:
      a `Cancel` (`variant="outline"`, closes) + a destructive confirm (`variant="destructive"`).
      Do NOT autofocus the destructive button (OQ default: Enter must not confirm). `onOpenChange(false)`
      (Esc / overlay / Cancel) closes without confirming (FR-003/FR-010).
- [ ] Review types vs spec — no invented props; `integrationLabel` drives all copy (FR-005).

### Phase 2 — Testing (node, `.ts`/`.test.ts` split)

- [ ] `confirmLogic.test.ts`: open→target set & `open:true`; close→`open:false` & target cleared;
      `confirmCopy('Slack')` yields a title naming Slack. (SC-003)
- [ ] A `useConfirm` behavior test (pure-logic level): `requestConfirm` then `confirm()` invokes
      the stored callback exactly once; `requestConfirm` then `cancel()` invokes it zero times.
      (SC-002 — exercise via the hook's reducer/ref seam without a live DOM where feasible.)

### Phase 3 — Wire the panels (each connected-state Disconnect)

- [ ] `SlackPanel.tsx`: mount one `useConfirm` + `ConfirmDialog`; change the footer
      `ConnectionStatus onDisconnect` to call `requestConfirm({ integration:'slack', label:'Slack' }, disconnect)`
      instead of `disconnect()` directly. Keep the existing `disconnect` useCallback as the
      confirmed action. Leave `onCancel`/`cancelConnect` (connecting state) untouched (FR-008).
- [ ] `atlassianPanelBits.tsx`: the shared `ConnectionStatus` is rendered by BOTH `JiraPanel`
      and `ConfluencePanel`. Keep its `onDisconnect` prop signature; the change is in each
      PANEL's wiring (below). No new behavior inside the shared component beyond styling parity.
- [ ] `JiraPanel.tsx`: mount `useConfirm` + `ConfirmDialog`; wire `ConnectionStatus.onDisconnect`
      → `requestConfirm({ integration:'jira', label:'Jira' }, disconnect)`.
- [ ] `ConfluencePanel.tsx`: same, label `'Confluence'`, integration `'confluence'`.
- [ ] `GoogleCalendarPanel.tsx`: same against `GoogleConnectionStatus.onDisconnect`, label
      `'Google Calendar'`, integration `'google-calendar'`.
- [ ] Verify each panel's `ConfirmDialog` mounts inside the panel `<section>` and does not
      disturb the per-tab A2UI host (it is a portal-rendered Dialog, so it overlays cleanly).

### Phase 4 — Wire the Settings rows

- [ ] `SettingsDialog.tsx`: mount one `useConfirm` + `ConfirmDialog` at the dialog level (NOT
      per row). Change each `ConnectionBlock onDisconnect` (the 4 rows: slack/jira/confluence/
      google-calendar) from `() => void window.cosmos.<int>.disconnect()` to
      `() => requestConfirm({ integration, label }, () => void window.cosmos.<int>.disconnect())`.
- [ ] Ensure the disconnect-confirm and the EXISTING Save-confirm (`confirming` boolean) are
      independent: the Save-confirm stays as-is (OQ default — do not merge). Two separate
      confirm surfaces may exist in the dialog but never simultaneously for the same action.
- [ ] Confirm the disconnect-confirm modal renders ABOVE the Settings Dialog (nested Dialog /
      higher z portal) without trapping focus incorrectly — adjust if Radix nested-dialog needs
      an explicit `modal`/portal container (note DEVELOPMENT.md "Nested Radix triggers").

### Phase 5 — Design pass (designer)

- [ ] **DESIGN STEP (designer, `.sdd/designs/disconnect-confirm-modal-v1.md`):** finalize the
      modal copy ("Disconnect &lt;Integration&gt;? You'll need to reconnect to use it." or the
      designer's refinement), the destructive-button visual + Cancel placement, spacing, and
      ensure the tone reads consistently with the Settings Save-confirm "Saving will sign out …"
      warning (FR-009). Confirm focus order (Cancel first / no destructive autofocus, FR-010 / OQ).
      Renderer-only visual; designer owns `confirm-dialog.tsx` copy + classes, build wiring (none
      needed — no shadcn install, Dialog already present) is a no-op.

### Phase 6 — Verify & docs

- [ ] `npm run typecheck` (node + web) passes; `npm test` green incl. new `confirmLogic.test.ts`.
- [ ] Grep confirms zero remaining direct `disconnect()` calls bypassing the confirm (SC-001):
      every `onDisconnect`/row now routes through `requestConfirm`.
- [ ] Manual smoke: each of the 4 panels + 4 Settings rows opens the modal, Cancel/Esc/overlay
      leaves connected, Confirm drops the connection once.
- [ ] Update `docs/ARCHITECTURE.md` §4.4/§4.7 (or a short note): record that all integration
      disconnects are gated by a shared renderer-only confirm modal; no contract change.
- [ ] Update `TODO.md` if it tracks this; record any deviations below.

---

## Deviations & Notes

- **2026-06-22**: Initial plan. Chose shared `ConfirmDialog` composed from existing shadcn
  `Dialog` (no `alert-dialog` install) since the primitive does not exist and Dialog already
  carries Esc/overlay-close semantics matching the Settings confirm. Kept the Settings
  Save-confirm untouched per OQ default.
