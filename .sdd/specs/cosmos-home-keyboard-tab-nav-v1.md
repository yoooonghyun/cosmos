# Spec: Home keyboard tab navigation — v1

**Status**: Draft
**Created**: 2026-06-30
**Supersedes**: —
**Related plan**: (none yet — Plan to follow after approval)

---

## Grounding

> Direct investigation by the architect (codegraph + wiki). The agentmemory/LLM-wiki tool
> (`wiki_query`) was **not available** in this environment (returned "No such tool"); grounding
> therefore relied on codegraph + direct reads of the authoritative docs.

**codegraph_explore queries run (one-line takeaways):**

- `matchShortcut keymap tab:next tab:prev global keyboard shortcut routing App.tsx dispatch panel tab cycle`
  → The whole shortcut vocabulary is matched in **main** by the pure `matchShortcut`
  (`src/main/shortcutMatch.ts`) and forwarded over `shortcut:trigger`. `tab:next`/`tab:prev` keychords
  are **Ctrl+Tab / Ctrl+Shift+Tab** and **mod+Alt+Right / mod+Alt+Left** (mod = Cmd on macOS → Cmd+Opt+Arrow).
- `CosmosPanel cosmosTabs setActiveCosmosTab appendFavorite closeCosmosTab PanelTabStrip useGenerativePanelTabs`
  → Home uses a purpose-built `cosmosTabs.ts` (pure `setActiveCosmosTab` / `appendFavorite` /
  `closeCosmosTab`), NOT `useGenerativePanelTabs`. Default tab first, favorites appended in pin order.
- `ShortcutTriggerPayload onShortcut tab:next tab:prev surface:next activeSurface AppShell dispatch shortcut handler focus-aware composer textarea`
  → `AppShell` handles ONLY `surface:next`/`surface:prev` (rail switch); per-panel `tab:*` is delegated to
  each panel via `useTabShortcuts`, gated on its `active` prop. Rail id `'cosmos'` is labelled **"Home"**.
- `useTabShortcuts TabShortcutOps onTrigger tab:next tab:prev tab:jump tab:new tab:close active focus-aware composer guard cycleActiveId panelTabs cycle`
  → `useTabShortcuts` (`src/renderer/tabs/useTabShortcuts.ts`) is the shared per-panel consumer: binds
  once, reads tab state via a ref, gates every command on `active`, and cycles with wrap-around. Every
  generative panel + terminal call it; **`CosmosPanel` does NOT** (confirmed by grep — no `useTabShortcuts`
  reference in `CosmosPanel.tsx`). The pure `cycleActiveId` (`src/renderer/tabs/panelTabs.ts`) is the
  reusable wrap helper.

**Direct reads:** `docs/ARCHITECTURE.md` §4.12 (global keyboard shortcuts — authoritative key map),
`src/renderer/app/railVisibility.ts` (`'cosmos'` → "Home"; one active surface at a time),
`src/renderer/cosmos/cosmosTabs.ts` (full pure tab state), `CosmosPanel.tsx` lines around the
`PanelTabStrip` wiring.

**Key grounding conclusion:** Because shortcuts are matched and `preventDefault`'d in **main** before
the renderer/DOM ever sees the keystroke (§4.12), the gesture fires regardless of DOM focus —
including a focused composer textarea or xterm — and **cannot emit a stray character**. No renderer-side
focus/typing guard is needed; reusing the existing shortcut path preserves this property for free.

---

## Overview

Add keyboard navigation between the Home (`cosmos`) panel's tabs — the pinned default "Cosmos"
tab plus any appended favorite tabs — using the **same global tab-cycle gesture** the other panels
already use, so a user can move the active Home tab to the previous/next tab without reaching for the
mouse. Home currently does not participate in the global tab-cycle shortcut; every other rail panel
does. This closes that gap.

## User Scenarios

> Each scenario independently testable. P1 (must), P2 (should), P3 (nice to have).

### Cycle Home tabs with the global tab-cycle shortcut · P1

**As a** Home user with the default tab plus one or more favorites pinned
**I want to** press the same tab-cycle shortcut the other panels use (Ctrl+Tab / Ctrl+Shift+Tab, or
Cmd+Opt+Right / Cmd+Opt+Left on macOS) while Home is the active rail surface
**So that** the active Home tab moves to the next / previous tab without touching the mouse, exactly
as it does in Slack/Jira/Confluence/Calendar/Terminal.

**Acceptance criteria:**

- Given Home is the active rail surface with tabs `[default, favA, favB]` and `default` active, when the
  user triggers `tab:next`, then `favA` becomes the active Home tab.
- Given the same and `favB` active, when the user triggers `tab:next`, then it wraps to `default`.
- Given the same and `default` active, when the user triggers `tab:prev`, then it wraps to `favB`.
- Given Home is NOT the active rail surface (e.g. Slack is active), when the user triggers `tab:next`,
  then the Home active tab does NOT change (only the active surface's panel reacts).

### Gesture is consistent with the rest of the app · P1

**As a** user who has learned the app's "cycle tabs in the active panel" gesture
**I want to** the very same keychord to cycle Home's tabs
**So that** I never have to learn or remember a Home-specific binding.

**Acceptance criteria:**

- Given any rail surface is active, when the user triggers the tab-cycle shortcut, then the tabs of the
  *currently visible* panel cycle — Home included — with no Home-specific exception.
- Given Home is active, the tab-cycle keychord is identical to the one documented in ARCHITECTURE §4.12
  (`tab:next` / `tab:prev`); no new keychord is introduced.

### No stray input while a composer/field is focused · P1

**As a** user typing in the Home prompt composer
**I want to** trigger the tab-cycle shortcut without the gesture leaking a character into the textarea
**So that** keyboard cycling never corrupts what I am typing.

**Acceptance criteria:**

- Given the Home composer textarea is focused, when the user triggers the tab-cycle shortcut, then the
  active Home tab cycles AND no character/caret-move is inserted into the textarea (the keystroke is
  consumed in main before the DOM sees it — §4.12).

---

## Functional Requirements

> "MUST" required, "SHOULD" recommended, "MAY" optional. Each traces to a scenario / architecture decision.

| ID     | Requirement |
|--------|-------------|
| FR-001 | When Home (`cosmos`) is the active rail surface, the global `tab:next` command MUST move the active Home tab to the NEXT tab in `cosmosTabs` order, and `tab:prev` to the PREVIOUS tab. (Scenario 1) |
| FR-002 | The tab order Home cycles MUST be the canonical `cosmosTabs` order: the pinned default tab first, then favorites in pin (append) order — the same order rendered in the Home `PanelTabStrip`. (Scenario 1; `cosmosTabs.ts`) |
| FR-003 | Cycling MUST wrap around: `tab:next` from the last tab activates the first; `tab:prev` from the first activates the last — matching the wrap semantics every other panel uses (`useTabShortcuts` / `cycleActiveId`). (Scenario 1) |
| FR-004 | The Home tab cycle MUST reuse the EXACT same keychord(s) as the other panels' tab cycle (`tab:next` = Ctrl+Tab / mod+Alt+Right; `tab:prev` = Ctrl+Shift+Tab / mod+Alt+Left). No new keychord is introduced. (Scenario 2; §4.12) |
| FR-005 | The Home tab cycle MUST fire ONLY when Home is the active rail surface; when another surface is active, triggering the shortcut MUST NOT change Home's active tab (only the active surface reacts). (Scenario 1; `useTabShortcuts` `active` gate) |
| FR-006 | The gesture MUST work GLOBALLY when Home is the active surface — i.e. WITHOUT first focusing the tab strip — consistent with how the gesture works in the other panels (it does not require the roving strip to hold focus). (Scenario 2) |
| FR-007 | Cycling MUST set the active tab through the existing pure `setActiveCosmosTab` op on the Home tab state; it MUST NOT mutate tab membership, labels, favorites, or the timeline. (purity / no scope creep) |
| FR-008 | Triggering the shortcut while a Home composer/textarea (or any DOM element) holds focus MUST NOT insert a character or move the caret — the keystroke is consumed in main before the renderer sees it. No renderer-side focus guard is added or removed. (Scenario 3; §4.12) |
| FR-009 | When Home holds exactly ONE tab (the default tab only — no favorites), `tab:next` / `tab:prev` MUST be a no-op (the active tab stays the default tab; no error, no flicker). (Edge case) |
| FR-010 | If the active Home favorite is unpinned (closed) while Home is active, subsequent `tab:next` / `tab:prev` MUST cycle over the REMAINING tabs from the reconciled active tab (the default, per `closeCosmosTab`), with no stale index. (Edge case; `closeCosmosTab` hands active → default) |
| FR-011 | The Home tab cycle MUST NOT change, intercept, or break any EXISTING shortcut behavior: rail switching (`surface:next`/`surface:prev`) and the other panels' `tab:*` handling MUST be unaffected. (collision avoidance; §4.12) |
| FR-012 | The existing roving-tabindex strip navigation (ArrowLeft/Right move focus, Enter/Space activate, Delete/Backspace close, F2 rename) on the Home `PanelTabStrip` MUST remain intact and unchanged; the global gesture is ADDITIVE to it, not a replacement. (`PanelTabStrip.tsx`) |
| FR-013 | The Home `tab:new` command (mod+T) MUST be a no-op: Home has no new-tab affordance (favorites are pinned from other panels' context menus, the default is fixed). It MUST NOT create a tab. [NEEDS CLARIFICATION — see Open Questions on whether mod+T should instead be ignored vs. surfaced.] |
| FR-014 | `tab:jump` (mod+1..8) and `tab:last` (mod+9) SHOULD activate the Home tab at that index / the last Home tab, for parity with the other panels — pure navigation, no membership change. [Scope: P2 — see Open Questions.] |

## Edge Cases & Constraints

- **Single tab (default only).** `tab:next`/`tab:prev` resolve to the same tab → no-op (FR-009). The
  pure cycle math `(from + delta + 1) % 1 === 0` already yields this; assert it.
- **Composer / field focused.** No stray character (FR-008) — guaranteed by main-side `preventDefault`,
  not a renderer guard. This is the load-bearing reason to reuse the existing shortcut path.
- **Unpin-while-active.** `closeCosmosTab` already reconciles an unpinned active favorite back to the
  default tab; the cycle reads the *current* reconciled state each time (ref-backed, per `useTabShortcuts`)
  so there is no stale active index (FR-010).
- **Collision with existing bindings.** Only one rail surface is active at a time and each panel gates its
  `tab:*` handling on `active`, so Home reacting cannot double-fire with another panel. `surface:*` is a
  different command handled by `AppShell`. The roving strip nav uses *plain* arrows (no modifier), which do
  not collide with the modified tab-cycle keychord (FR-011/FR-012).
- **`tab:close` (mod+W) — explicitly deferred.** Whether mod+W should unpin the active Home favorite (the
  default tab is never closeable) is an OPEN QUESTION; this spec scopes the feature to *navigation* ("tab간
  이동"), so close behavior is out of scope unless confirmed. The default behavior pending confirmation:
  mod+W is a no-op in Home.
- **Out of scope:** any change to the keychord vocabulary, to main-side matching, to the IPC contract, to
  the persisted session snapshot, or to favorites/timeline behavior. This is a *renderer-only* wiring of an
  already-delivered shortcut onto Home's existing tab state.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | With Home active and ≥2 tabs, the tab-cycle shortcut moves the active tab forward/back with wrap-around in `cosmosTabs` order, verified by an automated test over the pure cycle + a DOM test of the Home panel. |
| SC-002 | With Home active and exactly 1 tab, the tab-cycle shortcut is a verified no-op (no state change, no throw). |
| SC-003 | The same keychord cycles the active panel's tabs uniformly across ALL rail panels including Home — no Home-specific keychord exists (ARCHITECTURE §4.12 key map still describes the single gesture). |
| SC-004 | Triggering the shortcut while the Home composer is focused cycles the tab AND leaves the textarea value + caret unchanged (no stray character). |
| SC-005 | Existing shortcuts — rail switch and the other panels' tab cycle — pass their existing tests unchanged; no regression. |

---

## Layer / Sequencing notes (informative — not requirements)

- **Layer:** purely **renderer**. The shortcut is already matched in main and delivered over
  `window.cosmos.shortcuts.onTrigger`; the only gap is that `CosmosPanel` does not yet consume `tab:*`.
  The expected change is to wire Home's existing `cosmosTabs` state + `setActiveCosmosTab` into the
  shared per-panel consumer, gated on the Home `active` prop. No main / IPC / preload / shared-contract /
  new-keychord changes are anticipated. (Plan will settle the exact mechanism — reuse `useTabShortcuts`
  vs. a thin Home-specific subscription — but the spec asserts no new wire surface.)
- **ARCHITECTURE §4.12 update (do NOT edit yet):** §4.12 currently says `tab:*` is handled "per-panel by
  `useTabShortcuts` on the active surface" and lists the generative panels + terminal. After this feature,
  Home also participates in `tab:next`/`tab:prev` (and the resolved scope of jump/last/close). §4.12 will
  need a one-line reconciliation noting Home is now a tab-cycle participant.
- **Sequencing — MUST land after `cosmos-home-favorite-tabs-v1`.** A developer is CONCURRENTLY refining
  the Home favorites feature in `CosmosPanel.tsx` + the Home tab state. Both this feature and favorites
  touch `CosmosPanel.tsx` and `cosmosTabs.ts`. Implementation of this spec MUST be sequenced AFTER
  `cosmos-home-favorite-tabs-v1` lands to avoid a merge conflict and to build on the final favorites
  shape (favorite ordering, unpin reconciliation). This spec is doc-only and does not itself touch code.

---

## Open Questions

- [ ] **Q1 — Same keychord vs. new (RECOMMEND: same).** Reuse the EXACT `tab:next`/`tab:prev` keychord
  the generative panels + terminal already use (one consistent "cycle tabs in the active panel" gesture),
  rather than minting a Home-specific binding. Recommendation: **same keychord** (FR-004). Confirm.
- [ ] **Q2 — Global shortcut vs. strip-focus-only (RECOMMEND: global, additive).** Add the GLOBAL gesture
  (works when Home is the active surface, without focusing the strip — parity with other panels), keeping
  the existing roving strip-focus arrow nav as-is. Recommendation: **global + keep roving nav** (FR-006 /
  FR-012). Confirm we are not relying on strip focus alone.
- [ ] **Q3 — Command scope beyond next/prev.** The user asked for "tab간 이동" (navigation). Core scope is
  `tab:next`/`tab:prev` (P1). Should Home ALSO honor `tab:jump` (mod+1..8) + `tab:last` (mod+9) for parity
  (P2, FR-014)? Recommendation: include them (pure navigation, low cost). Confirm or drop.
- [ ] **Q4 — `tab:close` (mod+W) in Home.** Should mod+W unpin the active favorite (default never
  closeable), or be a no-op? This is destructive and an unpin affordance already exists in the menu.
  Recommendation: **no-op for v1** (out of navigation scope). Confirm.
- [ ] **Q5 — `tab:new` (mod+T) in Home.** Home has no new-tab affordance. Confirm mod+T should be a silent
  no-op (FR-013) rather than, say, focusing the composer.
