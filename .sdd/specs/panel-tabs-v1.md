# Spec: VS Code-style tabs within each rail panel — v1

**Status**: Draft
**Created**: 2026-06-06
**Supersedes**: —
**Related plan**: (to be authored — `.sdd/plans/panel-tabs-v1.md`)

---

## Overview

Each of the five rail surfaces (Terminal, Generated UI, Slack, Jira, Confluence)
becomes a host for **multiple VS Code-style tabs**, so a user can keep several
working contexts open in one panel and switch between them without losing any.
Within a panel a tab strip shows the open tabs side by side; clicking switches the
active tab, an `X` closes a tab, and a `+` opens a new one. This lets a user (per
the request) open the Confluence panel, spin up several generated-UI tabs, and move
between them while working.

This spec describes the tabbing behavior only. It does not change what each panel
*does* inside a tab (the existing native browsers, generative composers, terminal,
and `target`-routed A2UI rendering are unchanged in kind — they are now scoped to a
tab instead of to the whole panel).

---

## User Scenarios

> Prioritized P1 (must) / P2 (should) / P3 (nice to have).

### Keep multiple generated-UI surfaces open in one panel · P1

**As a** cosmos user working in a generative panel (Generated UI / Slack / Jira / Confluence)
**I want to** open several generated-UI surfaces as separate tabs and switch between them
**So that** I can compare or work across multiple generated views without re-running the agent each time

**Acceptance criteria:**

- Given the Confluence panel is open with zero tabs (native base showing), when I submit
  an utterance, then a tab is auto-created and the generated-UI surface fills it, and a
  second tab can be opened with `+` to compose a different surface, with both tabs
  remaining open.
- Given two or more tabs are open in a panel, when I click a non-active tab, then that
  tab becomes active and its surface is shown, and the previously active tab's surface
  is preserved (not re-composed) when I switch back to it.
- Given I switch the rail to another surface and back, when I return to the panel, then
  the same tabs are still open with the same active tab (consistent with today's
  keep-mounted behavior).

### Utterance fills the active tab (no auto-spawn) · P1

**As a** user in a generative panel
**I want to** have a submitted utterance fill or replace the currently active tab's surface
**So that** composing behaves like editing one VS Code editor — predictable, not spawning tabs behind my back

**Acceptance criteria:**

- Given a generative panel has an active tab, when I submit an utterance, then the
  resulting surface fills (replaces) that active tab's content; no new tab is created.
- Given I want a fresh surface instead of replacing the current one, when I click `+`
  first and then submit, then the surface lands in the newly created (now active) tab.
- Given zero tabs are open (panel showing its native base), when I submit an utterance,
  then a tab is **auto-created** to hold the composed surface (there is no active tab to
  fill) and the panel switches to it; `+` is only needed for the 2nd, 3rd, … tab.

### Multiple live terminals · P1

**As a** user
**I want to** open multiple terminal tabs, each its own live Claude Code session
**So that** I can run several terminal sessions in parallel and switch between them

**Acceptance criteria:**

- Given the Terminal panel, when I click `+`, then a new terminal tab opens with its own
  live PTY session (a distinct `claude` process), independent of the other terminal tabs.
- Given multiple terminal tabs are open, when I switch between them, then each tab keeps
  its own live session, scrollback, and exit/restart state (no session is torn down by
  switching).
- Given I switch the rail away from Terminal and back, when I return, then every terminal
  tab's live session and scrollback survive (consistent with today's keep-mounted PTY).

### Close a tab · P1

**As a** user
**I want to** close a tab with its `X`
**So that** I can clean up surfaces or terminals I no longer need

**Acceptance criteria:**

- Given multiple tabs are open and I close the active tab, when the close completes, then
  an adjacent tab becomes active (VS Code rule: the tab to the right, or the left if the
  closed tab was last).
- Given I close a non-active tab, when the close completes, then the active tab is
  unchanged.
- Given I close a Terminal tab, when the close completes, then that tab's PTY session is
  disposed/killed (the `claude` process for that tab ends).
- Given I close the last tab of a panel that has a native base (Slack / Jira / Confluence),
  when the close completes, then the panel returns to its native browser base.
- Given I close the last tab of the Generated UI panel (no native base), when the close
  completes, then the panel shows its idle/empty placeholder.

### Tab labels · P2

**As a** user
**I want to** see a meaningful label on each tab
**So that** I can tell my open tabs apart

**Acceptance criteria:**

- Given I create a generated-UI tab by submitting an utterance, when the tab appears, then
  its label is derived from the utterance (truncated); a tab created with `+` but not yet
  composed reads "Untitled".
- Given I open a Terminal tab, when it appears, then its label is a terminal name with an
  index (e.g. "Terminal 1", "Terminal 2").

### Many tabs · P2

**As a** user with many tabs open
**I want to** still reach every tab
**So that** the strip stays usable when it overflows

**Acceptance criteria:**

- Given more tabs are open than fit the strip width, when the strip overflows, then the
  tab strip scrolls (horizontal) so all tabs remain reachable; the `+` affordance remains
  reachable.

### A run in flight while I switch tabs · P2

**As a** user
**I want to** keep working in other tabs while a generative run is in flight
**So that** an in-progress compose doesn't block the whole panel

**Acceptance criteria:**

- Given I submit an utterance in a tab and switch to another tab while the run is in
  flight, when the run completes, then its surface lands in the originating tab (not the
  tab I switched to), and the originating tab shows the in-flight indicator until then.
- Given a run is in flight for one tab, when I view its originating tab, then that tab
  shows an in-flight / generating indicator.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.
> Every requirement traces to the user request (R) or a settled decision (D1–D3) /
> per-panel reconciliation (T = Terminal, G = Generated UI, N = native-base panels).

### Tab model (all five panels)

| ID     | Requirement                                                                                                                                                                       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | Each of the five rail surfaces (Terminal, Generated UI, Slack, Jira, Confluence) MUST host its own **independent ordered set of tabs**; switching the rail MUST NOT lose a panel's tabs, its per-tab content, or its active tab. (R, D1)        |
| FR-002 | Each panel MUST render a **tab strip** showing its open tabs side by side, with the active tab visually distinguished, in their open order. (R)                                  |
| FR-003 | Clicking a tab MUST make it the **active tab** and show its content; the previously active tab's content MUST be **preserved** (not re-fetched / not re-composed) so switching back restores it. (R, D1)                                       |
| FR-004 | Each tab MUST have a **close (`X`) affordance**; closing removes that tab from the strip. (R)                                                                                    |
| FR-005 | Each panel MUST have a **`+` new-tab affordance** that opens a new tab and makes it active. (D2)                                                                                 |
| FR-006 | When the **active** tab is closed, the panel MUST activate an **adjacent** tab — the tab to its right, or (if it was the rightmost) the tab to its left. (R, VS Code rule)        |
| FR-007 | When a **non-active** tab is closed, the active tab MUST be unchanged. (R)                                                                                                       |
| FR-008 | The tab strip MUST remain usable when it **overflows** the available width (e.g. horizontal scroll), keeping every tab and the `+` affordance reachable. (R)                     |

### Tab labels

| ID     | Requirement                                                                                                                                                                       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-009 | A generative tab created by `+` but **not yet composed** MUST show a default label ("Untitled"). (D2)                                                                            |
| FR-010 | A generative tab that has composed a surface SHOULD show a label **derived from the originating utterance**, truncated to fit the strip. (R)                                     |
| FR-011 | A Terminal tab MUST show a label identifying it as a terminal with an **index** (e.g. "Terminal 1"). (T)                                                                          |

### Generative panels — Generated UI / Slack / Jira / Confluence

| ID     | Requirement                                                                                                                                                                       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-012 | In a generative panel, submitting an utterance when **≥1 tab is open** MUST **fill/replace the ACTIVE tab's surface** — it MUST NOT auto-spawn a new tab. To get a fresh surface alongside the current one the user clicks `+` first. (D2) |
| FR-012a | In a generative panel, submitting an utterance when **zero tabs are open** (native base showing — no active tab to fill) MUST **auto-create the first tab**, make it active, and land the composed surface there. `+` is required only for the 2nd, 3rd, … tab. (OQ-1 resolved) |
| FR-013 | The composed surface from a run MUST land in the **tab that was active when the utterance was submitted** (the originating tab), even if the user has since switched to a different tab in that panel. (R, D2)                                  |
| FR-014 | A tab whose run is **in flight** MUST show an in-flight / generating indicator on (or for) that tab; the user MAY switch to and work in other tabs while it runs. (R)            |
| FR-015 | A run that **errors** MUST surface the error **in its originating tab** (the tab's content shows the error state), not as a panel-wide failure. (R)                              |
| FR-016 | The **prompt composer** MUST remain available in a generative panel whenever the integration permits composing (i.e. when connected, mirroring today's gating), including when the panel is showing its native base (zero tabs). (D3)          |
| FR-017 | Slack, Jira, and Confluence panels MUST treat their existing **native browser** (Slack channel/search browser; Jira default board/recent-issues view; Confluence search browser) as the **base shown when zero tabs are open**; closing the last tab MUST return the panel to that native base. (D3, N)                                          |
| FR-018 | The Generated UI panel (which has **no integration native base**) MUST show an **idle/empty placeholder** (with its composer) when zero tabs are open. (G)                       |
| FR-019 | Each generative tab MUST host its surface with that panel's existing **`target`-routed A2UI catalog** (standard / jira / slack / confluence) so per-tab rendering keeps today's fidelity and read-only/write semantics unchanged. A render frame MUST be routed not only to the correct **panel** (by `target`, as today) but to the correct **tab** within that panel. (R; preserves §4.3/§4.4)                                            |
| FR-020 | The existing **deterministic Jira write path** (`jira.*` bound actions re-composing the surface) MUST continue to update the **originating Jira tab's** surface, never a panel-wide singleton. The Slack/Confluence generative tabs MUST remain **read-only** as today. (preserves §4.8/§4.9)                                                  |

### Terminal panel

| ID     | Requirement                                                                                                                                                                       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-021 | A Terminal "tab" MUST be a **distinct PTY session** — its own live `claude` process; the tab's content **is** the xterm.js terminal. There is NO prompt composer and NO native browser base in the Terminal panel. (D1, T)                     |
| FR-022 | `+` in the Terminal panel MUST spawn a **new PTY session** in a new tab. (D1, T)                                                                                                 |
| FR-023 | Closing a Terminal tab MUST **dispose/kill that tab's PTY** (end its `claude` process), without affecting any other terminal tab's session. (D1, T)                              |
| FR-024 | The Terminal panel MUST **always have at least one terminal tab** present; there is no "zero terminals" empty state. On first open it MUST show a single default terminal, and after closing the last remaining terminal tab a fresh default terminal MUST take its place. (T; VS Code-consistent — closing the last terminal opens a new one rather than an empty panel)  |
| FR-025 | Each Terminal tab's live session, scrollback, and per-tab exit/restart state MUST survive **both** switching between terminal tabs and switching the rail away and back (consistent with today's keep-mounted PTY). (D1, T, §4.2)              |
| FR-026 | Per-tab terminal **restart** MUST restart only that tab's PTY session (today's single-session restart behavior, now scoped to a tab). (T, FR-008 of terminal-panel-v1)           |

### Lifecycle / robustness

| ID     | Requirement                                                                                                                                                                       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-027 | Closing a generative tab **whose run is still in flight** MUST not crash the panel; the surface for that closed tab MUST be discarded when (or if) the run completes (the run's result has no tab to land in). The single-run guard (§4.10) MUST remain correct — closing a tab MUST NOT leave the panel permanently unable to submit. |
| FR-028 | An invalid / malformed surface in one tab MUST degrade to that tab's existing surface error boundary (a safe fallback), never white-screen the panel or affect other tabs. (preserves §4.4)                                       |

## Edge Cases & Constraints

- **Zero tabs (generative panels):** native base for Slack/Jira/Confluence (FR-017);
  idle placeholder for Generated UI (FR-018). Composer stays available (FR-016). Submitting
  an utterance here **auto-creates the first tab** (FR-012a).
- **Zero tabs (Terminal):** not allowed — a default terminal is always present (FR-024).
- **Closing the active tab:** adjacent-tab activation (FR-006).
- **Closing the last tab:** native base / idle placeholder (FR-017/FR-018); for Terminal,
  a fresh default terminal replaces it (FR-024).
- **Many tabs / overflow:** strip scrolls; `+` stays reachable (FR-008).
- **Run in flight + tab switch:** result lands in the originating tab (FR-013); other tabs
  remain interactive (FR-014).
- **Run in flight + originating tab closed:** result discarded; panel stays usable (FR-027).
- **Run errors:** error shown in the originating tab (FR-015).
- **Sequential agent runs (§4.10):** the single-run guard is unchanged — only one headless
  run at a time across the whole app. With multiple tabs/panels, a submit while any run is
  in flight is still ignored (no per-tab concurrency). This spec does NOT change that guard.
- **Malformed surface:** degrades to the tab's error boundary (FR-028).

**Explicitly out of scope (Non-Goals):**

- Tab **drag-to-reorder**.
- **Split editor groups** / side-by-side panes within a panel.
- Tab **pinning**.
- **Dragging a tab between panels** (e.g. a Slack tab into Confluence).
- **Persistence of tabs across app restart** (open tabs are session-only; a fresh launch
  starts each panel at its base/default state).
- **Per-tab concurrent agent runs** — the single-run guard (§4.10) stays; runs remain
  sequential app-wide.
- Any change to **what a panel does** inside a tab (native browser features, generative
  composing semantics, integration scopes, the Confluence model-mediated create tool, the
  Jira deterministic write path) — those are unchanged in kind, only scoped to a tab.
- A **global / cross-panel** tab bar — each panel keeps its own independent tab set (FR-001).

## Success Criteria

| ID     | Criterion                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| SC-001 | A user can open the Confluence panel, create ≥2 generated-UI tabs, and switch between them with each tab's surface preserved across switches. |
| SC-002 | A user can open ≥2 Terminal tabs, each a distinct live `claude` session, switch between them, and switch the rail away and back without any session being torn down. |
| SC-003 | Submitting an utterance with ≥1 tab open fills the active tab (no auto-spawn); submitting with zero tabs auto-creates the first tab; clicking `+` first yields a fresh tab for the next compose. |
| SC-004 | Closing the active tab activates an adjacent tab; closing a non-active tab leaves the active tab unchanged; closing a Terminal tab ends exactly that tab's PTY. |
| SC-005 | Closing the last tab returns Slack/Jira/Confluence to their native base and the Generated UI panel to its idle placeholder; the Terminal panel always retains at least one live terminal. |
| SC-006 | A run that is in flight when the user switches tabs delivers its surface to the originating tab; an errored run shows the error in its originating tab; both leave the panel usable. |
| SC-007 | Each panel's tab set is independent and survives rail switches; no panel shows another panel's tabs; the tab strip remains usable (scrollable) under overflow. |

---

## Open Questions

- [x] **OQ-1 — Utterance with zero tabs open (generative panels) — RESOLVED.** A submit
  with **zero tabs** open (native base showing, no active tab to fill) **auto-creates the
  first tab**, makes it active, and lands the composed surface there; `+` is needed only
  for the 2nd, 3rd, … tab. Utterance-fills-active still holds when ≥1 tab exists. Encoded
  as **FR-012a** (with FR-012 scoped to the ≥1-tab case).
