# Spec: Cosmos tree tab Rename + Delete — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: —
**Related plan**: .sdd/plans/cosmos-tree-tab-rename-delete-v1.md (to be authored)

---

## Grounding

> Investigated directly with codegraph; the OMC wiki tool (`wiki_query`) was **not available** in
> this session (`mcp__plugin_oh-my-claudecode_t__wiki_query` → "No such tool available"), so prior
> decisions were recovered from the authoritative docs (`ARCHITECTURE.md` §4.11/§4.14, `DESIGN.md`
> D-15/D-16/D-19/D-20) plus the verbatim source codegraph returned.

**codegraph_explore queries run (takeaways):**
- `PanelTabTree renderRowMenu ContextMenu Pin Unpin PanelTabsProvider usePublishPanelTabs useAllPanelTabs toPanelTabGroups CrossPanelId` — the tree is a READ-ONLY survey; `renderRowMenu` today emits ONLY Pin/Unpin; `PanelTabsProvider` carries `publish`/`useAllPanelTabs` (forward, label-only) and has NO reverse path; `LivePanelTab` is `{id,label,iconId?,serialize?}`, all non-secret.
- `useGenerativePanelTabs update closeTab renamed PanelTabStrip onRename onClose usePanelTabs terminal` — each generative panel already owns `update(id,{label,renamed:true})` (rename) + `close(id)` (delete) via `usePanelTabs`; the strip's `onRename` fires only on a non-empty trimmed commit (tab-rename-v1 FR-008/FR-019).
- `PanelTabStrip onRename onClose inline rename input F2 double-click commit Enter Escape` — the strip's inline-rename idiom: borderless `field-sizing:content` input, focus+select-once, Enter/blur commit via pure `renameCommitDecision(draft)`, Escape cancel, empty/whitespace reverts silently.
- `CosmosPanel PanelTabTree renderRowMenu onPin onUnpin useAllPanelTabs favorites pin` — `CosmosPanel` wires `onPin`/`onUnpin`/`isPinned` into the tree from its own `tabsState`; favorites kept on gone source (FR-031, `reconcileFavorites`).
- `PanelTabTree props interface TabLeafRow ContextMenu ... PanelTabTreeProps` — the tree props are `{groups,selected,onActivate,isPinned?,onPin?,onUnpin?}`; `menuEnabled = Boolean(onPin && onUnpin)`; each `TabRow` gets `menu={renderRowMenu(...)}`.
- `TerminalPanel usePanelTabs onRename onClose close update rename terminal tab strip` — Terminal uses the same `usePanelTabs` (`update`/`close`); its `TerminalTab` already has a `renamed?` flag (forward-protection); Terminal always keeps ≥1 tab.

**Docs read (takeaways):**
- `ARCHITECTURE.md` §4.14 — `PanelTabsProvider` is the renderer-only cross-panel read seam; a Cosmos→panels reverse **pinned-sources** gate previously existed and was **DELETED** (cosmos-favorite-live-panel-portal-v1). FR-031: a favorite is NEVER auto-dropped when its source closes.
- `DESIGN.md` D-15 (survey-tree visual language + roving keymap), D-19 (shared Radix `ContextMenu`, dense items, label-only Pin/Unpin), D-20 (per-tab glyph). These bound the visual treatment for the new menu items + the in-tree inline edit.

---

## Overview

From the Cosmos (Home) panel's read-only cross-panel **tab tree** (`PanelTabTree`), right-clicking a
tab row offers **Rename** and **Delete** alongside the existing **Pin/Unpin**. Rename and Delete act
on the **source tab in its own panel** (Jira/Slack/Confluence/Calendar/Terminal) — the same operations
the source panel already exposes on its own tab strip — invoked cross-panel from the tree. This turns
the tree from a pure survey into a light cross-panel tab-management surface without any new IPC or
secrets path.

## User Scenarios

### Rename a source tab from the tree · P1

**As a** Cosmos user surveying every panel's open tabs in Home
**I want to** rename another panel's tab directly from its tree row
**So that** I can label a tab meaningfully without leaving Home / switching to that panel

**Acceptance criteria:**

- Given the tree shows a Jira tab row, when I right-click it and choose **Rename**, then the row
  enters an inline edit (borderless input seeded with the current label, text selected).
- Given I am editing a tree row, when I type a new name and press Enter (or blur), then the source
  tab's label changes in BOTH the source panel's strip and the tree, and the change persists (the
  source tab is marked so its panel's generative auto-relabel will not later clobber it).
- Given I am editing a tree row, when I press Escape, then the edit reverts and no label change occurs.
- Given I am editing a tree row, when I commit an empty/whitespace-only name, then the edit reverts
  silently (no rename), matching the strip's inline-rename behavior.

### Delete (close) a source tab from the tree · P1

**As a** Cosmos user surveying every panel's open tabs in Home
**I want to** close another panel's tab directly from its tree row
**So that** I can clean up tabs across panels from one place

**Acceptance criteria:**

- Given the tree shows a Slack tab row, when I right-click it and choose **Delete**, then that tab is
  closed in the Slack panel immediately (no confirmation), exactly as if I had clicked its strip `X`.
- Given a tab is deleted, when the source panel re-picks its active tab by adjacency, then the tree
  re-reads and the row disappears; any one-shot tree selection that named the deleted tab is cleared.
- Given a deleted tab was pinned as a Home favorite, when it is deleted, then the favorite remains as a
  gone-source favorite (never auto-dropped, FR-031) — identical to closing the tab via its own strip `X`.

### Rename + Delete on a Terminal tab · P2

**As a** Cosmos user
**I want to** Rename and Delete Terminal tabs from the tree too
**So that** the tree behaves consistently across all surveyed panels

**Acceptance criteria:**

- Given the tree shows a Terminal tab row, when I right-click it, then Rename, Delete, and Pin/Unpin
  are all offered.
- Given I delete the Terminal panel's last tab, when the close lands, then the Terminal panel applies
  its OWN last-tab semantics (it keeps ≥1 tab / re-opens a default) — the tree does not special-case it.

---

## Functional Requirements

| ID     | Requirement                                                                                  |
|--------|----------------------------------------------------------------------------------------------|
| FR-001 | The tree row `ContextMenu` MUST offer **Rename** and **Delete** items in addition to the existing **Pin/Unpin**, for every tab row of every surveyed panel (Jira, Slack, Confluence, Google Calendar, Terminal). |
| FR-002 | A **reverse command channel** MUST be added to `PanelTabsProvider`: each surveyed panel registers its `{ onRename(tabId, label), onClose(tabId) }` commands keyed by its `CrossPanelId`; the tree reads them by panel id and invokes them. This channel is **renderer-only** (mirrors the now-deleted pins reverse gate, §4.14) — NO IPC, NO new persisted state, NO secret/token may cross it (only the non-secret `tabId` + trimmed `label`). |
| FR-003 | The reverse channel MUST follow the same publish/subscribe shape as the existing forward read seam: a panel publishes its commands while mounted and clears them on unmount; a panel that has not published commands (absent/unmounted) yields no Rename/Delete (the menu degrades — see FR-011). |
| FR-004 | Choosing **Rename** MUST invoke the source panel's rename for that tab, which MUST set the tab's `label` AND mark it `renamed: true`, so the panel's generative auto-relabel (`shouldApplyAutoLabel`, tab-rename-v1 FR-008) will not later overwrite the user's name. This MUST reuse each panel's EXISTING rename path (`update(id, { label, renamed: true })`), not a new one. |
| FR-005 | Choosing **Delete** MUST invoke the source panel's existing tab-close path for that tab (the SAME path as its strip `X` / `usePanelTabs.close`), including the panel's adjacent-active re-pick. The tree MUST NOT implement its own close logic. |
| FR-006 | Rename MUST present an **inline edit IN the tree row** that reuses the `PanelTabStrip` inline-rename idiom: a borderless input seeded with the current label, text selected once on entry; Enter or blur commits, Escape cancels; commit goes through the SAME pure `renameCommitDecision` so an empty/whitespace commit reverts silently and fires no rename. |
| FR-007 | At most ONE tree row may be in inline-edit at a time; starting a new edit (or any tree re-read that removes the edited tab) ends the prior edit without committing stale state. |
| FR-008 | Delete MUST be **immediate** (no confirmation dialog), matching the strip `X` (tabs are ephemeral; close == reversible-by-reopen). |
| FR-009 | Deleting a source tab that is currently PINNED as a Home favorite MUST NOT unpin it; the favorite degrades to a gone-source favorite (FR-031, `reconcileFavorites`) exactly as when the tab is closed via its own strip `X`. |
| FR-010 | A committed Rename MUST keep the tree's one-shot context selection honest: if the renamed tab is the selected context, its label updates (the existing `reconcileSelectedContext` path); a Delete that closes the selected tab clears the selection. No new reconcile logic is required — the existing forward-read reconciliation covers it. |
| FR-011 | Rename/Delete MUST degrade gracefully: a tab that vanishes mid-rename (closed elsewhere, panel unmounted) MUST end the edit with no error; invoking Rename/Delete on a panel that has not published commands MUST be a safe no-op (those items absent or inert), never a crash. |
| FR-012 | The new menu items MUST use the shared Radix `ContextMenu` primitive and the D-19 dense menu chrome (label-only items, `text-caption`, symmetric padding); the in-tree inline edit MUST use the D-15 tree-row visual language. No bespoke menu or input chrome. |
| FR-013 | The feature surface is the **tree only**. It MUST NOT alter the Cosmos strip's default "Cosmos" tab or favorite STRIP tabs (those are not in the tree — the tree is cross-panel only). |

## Edge Cases & Constraints

- **Empty / whitespace rename** → reverts silently (no rename), like the strip (FR-006).
- **Tab vanishes mid-rename** (closed in its panel, or the panel unmounts/disables while editing) →
  the inline edit ends with no commit and no error (FR-011).
- **Panel without published commands** (unmounted/disabled, or has not yet registered) → Rename/Delete
  are absent or inert for that panel's rows; Pin/Unpin behavior is unchanged (FR-011).
- **Delete of a pinned source** → favorite stays as gone-source, never auto-dropped (FR-009/FR-031).
- **Terminal last tab** → Terminal keeps ≥1 tab / re-opens a default per its own close semantics; the
  tree defers entirely (FR-005, P2 scenario).
- **Generative panel reaching zero tabs** → allowed (the panel falls back to its native base view); the
  tree shows the now-empty group's "No open tabs" line. No special-casing in the tree.
- **Out of scope:** the Cosmos default tab, favorite strip tabs, any new IPC/persistence channel, any
  cross-panel mechanism beyond the renderer-only reverse command registry, and any change to the
  forward read seam's payload (still label-only `{id,label,iconId?,serialize?}`).

## Success Criteria

| ID     | Criterion                                                                                    |
|--------|----------------------------------------------------------------------------------------------|
| SC-001 | Right-clicking any tree tab row shows Rename + Delete + Pin/Unpin for all five surveyed panels (incl. Terminal). |
| SC-002 | Rename from the tree changes the source tab's label everywhere it shows (its strip + the tree) and survives a subsequent generative auto-relabel trigger (the `renamed` flag holds). |
| SC-003 | Delete from the tree closes the source tab with the same result as its strip `X` (adjacent-active re-pick), and a pinned source's favorite remains as a gone-source favorite. |
| SC-004 | An empty/whitespace rename commit, an Escape, and a tab vanishing mid-rename each leave the source label unchanged with no error. |
| SC-005 | No secret/token crosses the reverse channel; no new IPC channel is introduced (renderer-only). |

---

## Open Questions

> Recommendations are made; items marked **(confirm)** are decisions I have provisionally taken and
> want ratified before the plan; OQ-1 is a genuine semantic choice.

- [ ] **(confirm) Rename UX — inline-in-tree (recommended) vs dialog.** Recommend **inline**, reusing
  the `PanelTabStrip` idiom for consistency and zero new chrome. Confirm before the plan commits FR-006.
- [ ] **(confirm) Delete UX — immediate (recommended) vs confirm dialog.** Recommend **immediate**,
  matching the strip `X`. Confirm FR-008.
- [ ] **OQ-1: Deleting a PINNED source tab — also unpin, or leave the gone-source favorite?**
  Recommend **leave it** (FR-009): closing a tab via its own strip `X` already leaves the favorite as a
  gone-source entry (FR-031 never-auto-drop), so Delete-from-tree should match that contract rather than
  introduce a second, divergent "close also unpins" behavior. (Counter-argument if you prefer the
  opposite: a tree Delete is a more deliberate "remove this" gesture than an `X`, so it could reasonably
  unpin too — but that forks the close semantics. Your call.)
- [ ] **(confirm) Last-tab semantics defer to each panel** — generative panels may reach zero tabs
  (native base view); Terminal keeps ≥1. The tree does NOT special-case (FR-005). Confirm.
- [ ] **(confirm) Terminal rows get Rename + Delete** (Terminal supports both via `usePanelTabs`).
  Confirm.
- [ ] **(confirm) Surface is the TREE only** — the strip's default/favorite tabs are untouched
  (FR-013). Confirm this matches "Home의 탭목록" = the tree.

## Architecture / Design notes (for the owners — NOT edited here)

- **`docs/ARCHITECTURE.md` §4.14** will need a note that `PanelTabsProvider` gains a renderer-only
  **reverse command channel** (tree → source panel: `onRename`/`onClose` keyed by `CrossPanelId`),
  reviving the shape of the deleted pinned-sources reverse gate — distinct from the still-label-only
  forward read seam, carrying only non-secret `tabId` + trimmed `label`, no IPC. (Architect to apply
  when the plan lands.)
- **`docs/DESIGN.md` D-19** will need the tree row menu extended from Pin/Unpin to
  Pin/Unpin + Rename + Delete (still label-only dense items; Delete is a benign reversible close →
  `variant="default"`, NOT `destructive`, consistent with "X == unpin, no confirm"). **D-15** will need
  a note that a survey-tree row now also supports an in-row inline edit reusing the strip idiom.
- **Design step:** LIGHT. The surface reuses the existing `ContextMenu` (D-19) + the existing strip
  inline-rename idiom (D-15) — two added menu items + an in-row input. A full design spec is likely
  unnecessary; a short design note confirming the menu item order and the inline-edit treatment in the
  tree row would suffice. Flag for the designer's judgement at plan time.
