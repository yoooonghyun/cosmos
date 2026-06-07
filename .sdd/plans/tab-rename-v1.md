# Plan: Inline tab rename — v1

**Status**: Draft
**Created**: 2026-06-07
**Last updated**: 2026-06-07
**Spec**: .sdd/specs/tab-rename-v1.md

---

## Summary

Add double-click-to-rename to the shared `PanelTabStrip` so any tab's label can be
edited inline (double-click label → focused, pre-selected text input; Enter/blur commit
the trimmed value; Escape cancels; F2 starts a rename from a focused tab as a SHOULD).
The strip is presentational and owns only a single local `editingTabId` + draft string;
when an edit commits non-empty it raises a new `onRename(tabId, label)` callback. Each of
the five panels passes an `onRename` handler that patches its own tab record via the
controller's existing `update`, setting `label` plus a new per-tab `renamed?: boolean`
flag. The flag is the "sticks" mechanism: the generative auto-relabel path
(`labelFromUtterance` application in `useGenerativePanelTabs`) and any terminal relabel
path skip a tab whose `renamed` flag is set. Pure, node-testable pieces (label
trim/empty-revert decision, the renamed-flag patch builder, the skip predicate) live in
`panelTabs.ts` with tests in `panelTabs.test.ts`; inline-edit UI state, a11y, and focus
management live in `PanelTabStrip.tsx`. This is renderer-only — no IPC, main, preload,
MCP, or shared-contract change (the auto-relabel paths are all renderer-side, confirmed
in the spec's investigation and re-confirmed below).

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript / React (renderer only) |
| Key dependencies  | Existing: `usePanelTabs` `update`, `panelTabs.ts` `updateTab`, shadcn `Input` (or a raw `<input>` styled to design), lucide (no new icon required) |
| Files to create   | `src/renderer/panelTabs.test.ts` (extend if it exists; otherwise create) |
| Files to modify   | `src/renderer/panelTabs.ts`, `src/renderer/PanelTabStrip.tsx`, `src/renderer/useGenerativePanelTabs.ts` (GenerativeTab `renamed` + skip), `src/renderer/usePanelTabs.ts` (no change expected — `update` already generic; confirm), `src/renderer/TerminalPanel.tsx`, `src/renderer/GeneratedUiPanel.tsx`, `src/renderer/JiraPanel.tsx`, `src/renderer/SlackPanel.tsx`, `src/renderer/ConfluencePanel.tsx` |

### Confirmed grounding (current structure)

- `PanelTabStrip` (presentational) takes `tabs/activeTabId/onActivate/onClose/onNewTab/
  ariaLabel`. Each tab is a `<button role="tab">` with the label `<span>` inside; close
  `X` already `stopPropagation`s. A new `onRename?` prop and inline-edit state are added
  here. The label `<span>` is the double-click target.
- `panelTabs.ts` already has `updateTab(state, id, patch)` (pure partial-merge, id-locked)
  and `labelFromUtterance`. Rename logic reuses these. `MAX_LABEL_LENGTH` is the
  utterance-path cap only and is intentionally NOT applied to a manual rename (spec edge
  case: no new length cap).
- `usePanelTabs` exposes `update(tabId, patch)` generic over `T`; both controller
  consumers (Terminal via `usePanelTabs` directly; generative panels via
  `useGenerativePanelTabs` which spreads `...controller`) already have `update`. No new
  controller method is required.
- `useGenerativePanelTabs` applies the auto-label at exactly ONE site: the `ui:render`
  subscription's `update(tabId, { ...(utterance ? { label: labelFromUtterance(utterance),
  untitled: false } : {}) })`. The skip-on-renamed guard goes here.
- `TerminalPanel` labels are static `terminalLabel(n)` minted once at create; there is no
  runtime terminal relabel today, so FR-009 is forward-protection — the `renamed` flag on
  `TerminalTab` simply must exist and be respected if a relabel path is ever added. No
  terminal relabel code change is needed now beyond carrying the field.
- All five panels map their tab records into `PanelTab[]` and render `<PanelTabStrip>`;
  each gets a new `onRename` prop wired to its controller `update`.

### Architecture note (record here; reconcile at wrap-up — do NOT edit ARCHITECTURE.md/CLAUDE.md now)

- New strip callback contract: `onRename(tabId, label)` joins
  `onActivate/onClose/onNewTab` as the strip's "surface intent up, panel owns state"
  boundary — the strip never mutates tab records, it reports a committed rename and the
  panel persists it (label + `renamed`) via the controller `update`. This mirrors the
  existing presentational/stateful split.
- New per-tab `renamed?: boolean` on both tab record shapes (`TerminalTab`,
  `GenerativeTab`) is the single source of truth for "manual label wins over auto-label".
  Auto-label sites are the ones that must consult it; today that is exactly the
  `useGenerativePanelTabs` `ui:render` relabel.

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates.

### Phase 0 — Design (precedes interface; owned by the `designer` agent)

- [x] The strip gains a NEW visual state: an inline-edit text input replacing the label
      `<span>` (FR-002). Produce/extend the design spec for: input sizing within the
      `max-w-[16rem]` tab cell, focus ring, how it coexists with the leading glyph
      (spinner/error/terminal) and the close `X` while editing, and the resting→editing
      transition. Implementation builds against this design spec. (UI-bearing → design
      step required per workflow.)

### Phase 1 — Pure logic + types (`panelTabs.ts`, types)

- [x] Add a pure `normalizeRenameInput(raw: string): string` (trim; collapse is NOT
      required — manual labels are verbatim except trim) returning the trimmed value.
      (FR-006)
- [x] Add a pure decision `renameCommitDecision(raw: string): { commit: boolean; label?:
      string }` — empty/whitespace-only ⇒ `{ commit: false }` (revert, NOT renamed,
      FR-005); else `{ commit: true, label: trimmed }` (FR-006). This is the single
      tested predicate the strip/panels consult.
- [x] Add a pure `renamePatch(label: string)` helper (or document using `updateTab` with
      `{ label, renamed: true }` directly) so the renamed-flag patch is defined in one
      place and reused by every panel callsite (FR-007). Reuse existing `updateTab`.
- [x] Add a pure `shouldApplyAutoLabel(tab: { renamed?: boolean }): boolean` returning
      `!tab.renamed` — the skip predicate the generative relabel site consults (FR-008/
      FR-009). Keep it framework-free.
- [x] Add `renamed?: boolean` to `TerminalTab` (in `TerminalPanel.tsx`) and to
      `GenerativeTab` (in `useGenerativePanelTabs.ts`). No invented fields beyond
      `renamed`. (FR-007/FR-017)

### Phase 2 — Tests (`panelTabs.test.ts`, node env, NO jsdom — do not import the .tsx)

- [x] `renameCommitDecision`: non-empty ⇒ commit with trimmed label (happy path, FR-006).
- [x] `renameCommitDecision`: empty `''` and whitespace-only `'   '` ⇒ `{ commit: false }`
      (revert, not renamed, FR-005).
- [x] `renameCommitDecision`: leading/trailing whitespace trimmed (`'  hi  '` ⇒ `'hi'`).
- [x] `renameCommitDecision`: unchanged-but-non-empty value still commits (edge case:
      marking renamed on an unchanged commit is allowed).
- [x] `shouldApplyAutoLabel`: `{ renamed: true }` ⇒ false; `{}`/`{ renamed: false }` ⇒
      true (FR-008/FR-009).
- [x] `updateTab` with `{ label, renamed: true }` merges both fields and leaves id locked
      (reuse-existing-utility check; light, may fold into an existing `updateTab` test).

### Phase 3 — Strip inline-edit state + a11y (`PanelTabStrip.tsx`)

- [x] Add optional `onRename?: (tabId: string, label: string) => void` to
      `PanelTabStripProps`. (FR-019)
- [x] Add local strip state: `editingTabId: string | null` + `draft: string` (at most one
      editable tab at a time — FR-012). Starting an edit on another tab first resolves the
      current one (commit per `renameCommitDecision`, or cancel) (FR-012).
- [x] Double-click the label region enters edit mode: seed `draft` from the tab's current
      label, render an `<input>` in place of the `<span>`, autofocus + select-all
      (FR-001/FR-002). The double-click must not leave the tab half-activated by the
      single-click `onClick` activate — guard so activation during an edit gesture is
      inert (FR-010/FR-011).
- [x] Input handlers: Enter ⇒ commit via `renameCommitDecision` (call `onRename` only when
      `commit` is true) then exit edit; blur ⇒ same as Enter (FR-003); Escape ⇒ cancel,
      restore (drop draft, no `onRename`) (FR-004). `stopPropagation` on input
      click/keydown so no activate/close fires while editing (FR-010).
- [x] Focus management: on enter-edit focus the input; on commit/cancel return focus to
      the tab `<button>` (roving-tabindex parity) (FR-016).
- [x] Accessibility: input gets `aria-label` naming it as the tab-label editor
      referencing the tab (e.g. `Rename ${label}`) (FR-015).
- [x] F2 on a focused tab `<button>` enters edit mode identically (SHOULD; FR-014). Add to
      `handleTabKeyDown`. If the design step finds an irreconcilable conflict with the
      roving tablist, defer F2 and note it here — mouse double-click remains the P1 path.
- [x] Cancel-in-progress edit when the edited tab disappears or the active tab changes:
      when `editingTabId` is no longer in `tabs`, or `activeTabId` changes away, drop edit
      state (revert) (FR-013). (A new run starting is observed by the panel as a tab
      status/active change; the strip's guard on `tabs`/`activeTabId` covers it.)
- [x] Tooltip derives from the (possibly renamed) label already — verify the renamed label
      flows through `tooltip` (edge case: tooltip reflects new label; error tooltip
      unchanged).

### Phase 4 — Controller skip-on-renamed wiring (`useGenerativePanelTabs.ts`)

- [x] At the `ui:render` relabel site, gate the label/untitled patch on
      `shouldApplyAutoLabel(tab)` for the originating tab — a renamed tab keeps its label
      and is NOT reset to `untitled: false` via the auto path (it already left Untitled at
      rename). The surface/inFlight/error/loadingDefault fields still update normally
      (only the label/untitled portion is skipped). (FR-008)
- [x] Read the current tab record to evaluate the predicate (the subscription already has
      access via a ref/`tabIdsRef`; if it lacks the full record, thread the minimal
      `renamed` lookup — prefer reading from `tabs` via a ref without re-subscribing).

### Phase 5 — Five panel callsites (pass `onRename`)

- [x] `TerminalPanel.tsx`: pass `onRename={(id, label) => update(id, { label, renamed:
      true })}`. Note: `update` is not currently destructured from `usePanelTabs` here
      (only `open/close/setActive`) — add `update` to the destructure. (FR-018/FR-019)
- [x] `GeneratedUiPanel.tsx`: pass `onRename` wired to the generative controller `update`.
- [x] `JiraPanel.tsx`: same. (Renaming must not disturb the deterministic `jira.*` write
      re-push or default-view frames — those land via the subscription, which now respects
      `renamed`; verify a renamed Jira tab survives a write re-push.)
- [x] `SlackPanel.tsx`: same.
- [x] `ConfluencePanel.tsx`: same.

### Phase 6 — Verification

- [x] `npm run typecheck` clean (node + web).
- [x] `npm test` — new `panelTabs.test.ts` cases pass in node env (no jsdom).
- [ ] Manual smoke per SC-001..SC-006 across all five panels (double-click, Enter/blur/
      Escape, empty-revert, generative tab survives a completed run, no spurious
      activate/close, F2 if shipped). NOT exercised in the headless dev session (no GUI);
      the interaction is locked by types + node tests + design conformance. Needs a human
      click-through.
- [x] Confirm diff touches ONLY `src/renderer/**` — no `src/shared`, `src/main`,
      `src/preload`, `src/mcp` change (SC-008).

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-07**: Renderer-only confirmed against the codebase — the sole auto-label site
  is `useGenerativePanelTabs` `ui:render` relabel; Terminal labels are static at mint, so
  FR-009 is carried forward via the `renamed` field with no live terminal-relabel code to
  guard yet. `usePanelTabs.update` is already generic and present on both controller
  surfaces, so no new controller method is needed — `TerminalPanel` only needs to
  destructure the already-exported `update`.
- **2026-06-07 (impl)**: Implemented Phases 1–5. Pure helpers added to `panelTabs.ts`:
  `normalizeRenameInput`, `renameCommitDecision` (single tested predicate the strip
  consults), `shouldApplyAutoLabel`; `renamed?: boolean` added to `GenerativeTab` and
  `TerminalTab`. No separate `renamePatch` helper — every panel callsite reuses the
  existing controller `update(id, { label, renamed: true, ... })` directly (plan allowed
  documenting this instead of a new helper).
- **2026-06-07 (impl)**: The four GENERATIVE panels pass `{ label, renamed: true, untitled:
  false }` so renaming an "Untitled" tab ends its italic-muted treatment immediately (spec
  edge case "the italic-muted Untitled treatment ends once a real label is committed").
  Terminal passes only `{ label, renamed: true }` (it has no `untitled`).
- **2026-06-07 (impl)**: Controller skip — the `ui:render` relabel reads the tab record via
  a new `tabsByIdRef` (mirroring the existing `tabIdsRef`/`activeTabIdRef` ref pattern) so
  the subscription can consult `shouldApplyAutoLabel(tab)` without re-subscribing; only the
  `label`/`untitled` portion of the patch is gated, surface/inFlight/error/loadingDefault
  still apply.
- **2026-06-07 (impl)**: Strip `editingTabId`/`draft` state, F2 in `handleTabKeyDown` (its
  signature now takes the full `PanelTab` to seed the draft), double-click on the label
  `<span>`, raw inline `<input>` with the design §5 verbatim classes, autofocus +
  select-all via a `ref` callback, Enter/blur commit, Escape cancel, `stopPropagation` on
  input click/keydown, close `X` `hidden` while editing, and TWO effects: one cancels the
  edit when the tab disappears or the active tab changes away (FR-013), one returns focus
  to the tab button on commit/cancel (FR-016). The cell forces the active treatment while
  editing (`data-state` active) per design §3.2.
