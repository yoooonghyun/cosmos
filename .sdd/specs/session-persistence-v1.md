# Spec: Session Persistence — v1

**Status**: Draft
**Created**: 2026-06-08
**Supersedes**: —
**Related plan**: .sdd/plans/session-persistence-v1.md (to be authored in Step 2)

---

## Grounding

> Investigation done directly with codegraph (code structure), agentmemory (prior
> decisions), `docs/ARCHITECTURE.md`, and the Claude Code CLI reference. Every
> requirement below traces to one of these findings.

**Architecture / docs (`docs/ARCHITECTURE.md`).**

- §3 / §4.11: each of the five rail panels (Terminal, Generated UI, Jira, Slack,
  Confluence) hosts its **own independent, session-only ordered set of VS Code-style
  tabs** (`+` new, `X` close, click-to-switch, rename via double-click/F2, right-else-left
  adjacent activation). Today this state is **explicitly renderer-only and NOT persisted
  across app restart** — that is the gap this feature closes.
- §4.11 tab record fields (`useGenerativePanelTabs.ts` `GenerativeTab`): `id`, `label`,
  `untitled`, `surface: TabSurface | null` (`{ requestId, spec, error? }`), `inFlight`,
  `error?`, `loadingDefault?`, **`composed?`** (true = user-authored solicited compose;
  false = unsolicited deterministic data push), `renamed?`. The doc and the source both
  annotate every field "Session-only". The **`composed`** flag is the load-bearing
  discriminator this spec relies on to separate restorable surfaces from live data views.
- §4.11 Terminal record (`TerminalPanel.tsx` `TerminalTab`): `id` (= the `paneId`), `label`
  (`Terminal N`), `renamed?`. The Terminal panel always keeps **≥1 tab**; closing the last
  opens a fresh default.
- §4.1 / §4.2: `PtyManager` is multi-session, **keyed by a renderer-minted `paneId`**, one
  live `claude` PTY per terminal tab. The single-PTY auto-start was removed; each tab issues
  its own `pty:start`. Each session remembers its own `cols`/`rows`. `killAll()` runs on
  teardown so no session is orphaned.
- §4.9 / §4.11: Jira/Slack/Confluence panels render **live integration data** as unsolicited
  deterministic frames (default board, JQL/CQL search, ticket/page detail, native browsers)
  — `composed: false` — vs. user composes (`composed: true`). Jira's base is an
  agent-generated my-tickets default board; Slack/Confluence bases are native browsers.
- §4.10 / §4.11: the renderer-only originating-tab correlation is valid **only because
  `AgentRunner` runs are sequential**; `UiRenderPayload` is unchanged. This spec adds no
  render-routing field and does not change that invariant.
- Security invariants (`docs/ARCHITECTURE.md` §4.7, CLAUDE.md): integration tokens +
  Atlassian `client_secret` live **only in main, encrypted at rest, never in any IPC
  payload / bridge frame / MCP result / A2UI surface / renderer**. The snapshot is a new
  on-disk artifact and MUST honor this — it carries **no secrets**.

**Code (codegraph_explore).**

- `src/main/ptyManager.ts` — `PtyManager.start(paneId)` spawns
  `pty.spawn(command, args, { cols, rows, cwd, env })` where `args = this.options.args ?? []`.
  **There is no per-pane arg today and no session id is captured or assigned.** `cwd` is the
  fixed sandbox dir for every pane. `restart()`/`kill()`/`killAll()` exist; a missing binary
  emits a per-pane `onExit` error rather than throwing.
- `src/main/index.ts` — `resolveSandboxDir()` = `join(app.getPath('userData'), 'sandbox')`;
  the embedded `claude` always runs there, so the terminal cwd is **stable across restart**.
  Managers are constructed in `createWindow` and torn down on close/quit. `userData` is the
  established root for app-private on-disk state.
- `src/shared/ipc.ts` — the single typed IPC contract. `PtyStartPayload { paneId }`,
  `PtyDataPayload { paneId, data }`, `PtyResizePayload { paneId, cols, rows }`; `CosmosApi`
  exposes `pty`, `ui`, `slack`, `jira`, `confluence`, `agent`, `shortcuts`. A new
  persistence surface must be **one new namespace on this contract** (no ad-hoc channels).
- `src/main/integrations/tokenStore.ts` — the **precedent on-disk store**: `fs`/`safeStorage`
  injected behind small interfaces, `load()` is defensive (`try/catch` → returns `null` on a
  corrupt/unreadable blob, never throws), `save()` writes atomically to one file under
  `userData`. The snapshot store reuses this *shape* (injectable fs, defensive load,
  warn-and-fall-back) but is **non-secret JSON**, so it is NOT encrypted (encryption is for
  tokens only; a non-secret snapshot needs no keychain dependency and stays readable for
  debugging).
- Renderer tab state lives in `usePanelTabs.ts` (generic controller),
  `useGenerativePanelTabs.ts` (the four generative panels), `TerminalPanel.tsx` (terminal
  tabs), `panelTabs.ts` (pure tab-collection logic + label/index helpers). `usePerTabNav.ts`
  (Slack/Confluence) is per-tab navigation state and is **live/derived, not persisted**.
  `TabSurface` (`{ requestId, spec, error? }`) is the serializable unit of a composed surface.

**Claude Code CLI (code.claude.com/docs/en/cli-reference, fetched 2026-06-08).** This
resolves the one genuinely uncertain area — terminal resume feasibility:

- **`--session-id <UUID>`** — "Use a specific session ID for the conversation (must be a
  valid UUID)." cosmos can therefore **mint** the session id itself at first spawn rather than
  scrape it out of the TUI stream. No capture machinery is needed.
- **`--resume <id>` / `-r`** — "Resume a specific session by ID or name … in interactive"
  mode (the TUI path). Confirmed to work in interactive (not just `-p`) mode.
- **`--fork-session`** — forks a new session id on resume; **not** needed for v1 (we want to
  continue the same session, not branch it).
- Consequence: terminal resume is **feasible** for the primary path — mint a UUID at first
  `start(paneId)`, pass `--session-id <uuid>`, persist it, and on relaunch spawn with
  `--resume <uuid>`. A clean fallback still must be specified for the case where resume fails
  (binary downgraded, transcript purged via `claude project purge`, id rejected): a fresh
  session with the restored scrollback shown as read-only history.

**agentmemory.** `memory_recall`/`memory_smart_search` returned no prior session-persistence
decisions (this is net-new). The feature direction and the verified CLI resume approach are
saved (architecture memory `mem_mq59qkzg_ae4153154396`).

---

## Overview

After fully quitting and reopening cosmos, the user's working session is restored: every
rail panel's tabs (which tabs, their labels, untitled/renamed flags, active tab) come back,
each user-authored *composed* generated-UI surface is re-filed verbatim, terminal tabs resume
their underlying `claude` session, and live integration data is re-fetched fresh rather than
shown stale. Persistence is durable, on-disk, and owned by the main process — it survives a
full process restart, not just a renderer reload.

## User Scenarios

### Restore tab structure across a full quit/relaunch · P1

**As a** cosmos user with several tabs open across panels
**I want to** quit the app and reopen it later with my tabs intact
**So that** I do not have to manually rebuild my working layout every session.

**Acceptance criteria:**

- Given Terminal has tabs `[Terminal, Terminal 2]` with `Terminal 2` active, when I fully
  quit and relaunch, then the Terminal panel shows `[Terminal, Terminal 2]` with `Terminal 2`
  active.
- Given I renamed a Jira tab to `Sprint board`, when I relaunch, then that tab is still
  labeled `Sprint board` and its `renamed` flag is preserved (an auto-relabel will not
  overwrite it).
- Given a Generated UI tab that is still `untitled` (never composed), when I relaunch, then it
  reappears as an untitled tab showing the panel base.
- Given a panel had **zero** tabs at quit (e.g. Slack showing its native base), when I
  relaunch, then that panel again shows zero tabs / its native base.
- Given the Terminal panel (which always keeps ≥1 tab), when I relaunch, then it has at least
  one terminal tab even if the snapshot were empty/absent.

### Composed generated-UI surfaces restored verbatim · P1

**As a** user who composed a custom UI in a Generated UI / Jira / Slack / Confluence tab
**I want to** see that exact surface again after relaunch
**So that** my authored work is not lost on quit.

**Acceptance criteria:**

- Given a tab whose surface is `composed: true`, when I relaunch, then the same A2UI spec is
  re-filed into that tab and rendered, with no re-compose and no agent round-trip.
- Given a composed surface fails to render on restore (unknown/invalid component, see edge
  cases), when it is restored, then that tab degrades to its per-tab surface error boundary
  (the existing safe fallback), never a white screen, and sibling tabs are unaffected.

### Live integration data is fresh, not stale · P1

**As a** user with Jira/Slack/Confluence tabs showing live data
**I want to** see current data after relaunch, not a frozen snapshot
**So that** I never act on out-of-date tickets, messages, or pages.

**Acceptance criteria:**

- Given a Jira tab showing a default board / JQL search results / ticket detail
  (`composed: false`), when I relaunch, then that tab restores to its **base** (re-fetches the
  default board fresh) rather than reloading the stale snapshotted surface.
- Given a Slack/Confluence tab showing native browser data, when I relaunch, then the tab
  reappears at its native base and data is re-fetched on demand — no stale frame is restored.
- Given an integration was connected at quit but is disconnected/needs-reconnect at relaunch,
  when its panel restores, then the tab shells restore but show the panel's existing
  not-connected / reconnect-needed state instead of any old data.

### Terminal tabs resume their claude session · P1

**As a** user mid-conversation in a terminal tab
**I want to** reopen the app and continue that `claude` conversation
**So that** quitting cosmos does not throw away my terminal context.

**Acceptance criteria:**

- Given a terminal tab whose `claude` session id was recorded, when I relaunch, then a new
  PTY spawns resuming that session (the conversation history is available to `claude`), and
  the tab's previously-visible scrollback is restored as on-screen history.
- Given the recorded session cannot be resumed (resume fails for any reason), when I relaunch,
  then the tab still reappears with the same label and cwd, its saved scrollback is shown as
  read-only history, and a fresh `claude` session starts in that tab — no hang, no crash.
- Given two terminal tabs, when I relaunch, then each resumes its own distinct session
  (sessions are not cross-wired and are not cloned OS processes).

### Corrupt or stale snapshot never breaks startup · P1

**As a** user
**I want to** the app to always start cleanly even if the saved session is unreadable
**So that** a bad snapshot can never brick the app.

**Acceptance criteria:**

- Given the snapshot file is missing, corrupt JSON, or a schema version the app does not
  understand, when the app starts, then it warns (logs) and falls back to a clean empty
  session (Terminal with one default tab), never crashing.
- Given no secret was ever written to the snapshot, when I inspect the on-disk file, then it
  contains no access/refresh tokens and no `client_secret`.

---

## Functional Requirements

> "MUST" required, "SHOULD" recommended, "MAY" optional. Each FR traces to the decided scope
> (1 tab structure, 2 composed surfaces verbatim, 3 live data fresh, 4 terminal resume) and
> the hard constraints — no added scope.

### Persistence mechanism & contract

| ID     | Requirement                                                                                                                                                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST persist a **session snapshot** to disk in the **main process**, under `app.getPath('userData')` (e.g. `<userData>/session/session.json`). It MUST survive a full app quit + relaunch (durable on-disk, NOT `sessionStorage`/`localStorage`, NOT renderer-only state).                          |
| FR-002 | The snapshot MUST carry a **schema version** field. On load, a version the running app does not understand MUST be treated as unreadable (FR-018), not migrated speculatively.                                                                                                                                 |
| FR-003 | The renderer MUST read and write the snapshot **only via one new typed IPC namespace** added to `src/shared/ipc.ts` (e.g. `window.cosmos.session` with load + save). No ad-hoc channel strings; no direct renderer filesystem access.                                                                          |
| FR-004 | Every inbound persistence IPC payload MUST be validated at the main-process boundary; an invalid payload MUST be warned and ignored, never crash the process (the established IPC discipline).                                                                                                                |
| FR-005 | On load, a missing / unreadable / unparseable / wrong-schema-version snapshot MUST cause main to warn and return a **clean empty session** (no tabs except the Terminal default), never throwing.                                                                                                              |
| FR-006 | The snapshot MUST contain **no secrets**: no integration access/refresh tokens, no OAuth tokens, no Atlassian `client_secret`, no MCP results. Persisted per-panel state MUST be limited to tab structure + composed-surface specs + terminal-session metadata + scrollback text.                              |
| FR-007 | The snapshot SHOULD be written whenever the persisted state meaningfully changes (tab open/close/rename/activate, a composed surface lands, a terminal session id is assigned/scrollback advances) AND on app teardown (window close / before-quit), debounced so frequent edits do not thrash the disk.       |

### Scope 1 — tab structure per panel

| ID     | Requirement                                                                                                                                                                                                                                                            |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-008 | For each of the five rail panels the snapshot MUST persist the **ordered list of tabs**, and for each tab its `id`, `label`, `untitled` flag, and `renamed` flag; and per panel the **active tab id**. On relaunch these MUST be restored (order, labels, flags, active tab). |
| FR-009 | A restored `renamed` tab MUST keep its custom label; the automatic relabel paths (utterance-derived generative label, static `Terminal N`) MUST continue to skip it (§4.11 rename semantics, unchanged).                                                                |
| FR-010 | The per-panel monotonic seed-tab counter (`everOpened` / `nextTerminalIndex`, "closed tabs are not renumbered") MUST be restored consistently so that a `+` after relaunch continues the sequence (e.g. does not collide with or rewind a restored `Terminal 2`).        |
| FR-011 | A panel that had **zero** tabs at quit MUST restore to zero tabs (its native base / idle placeholder); the **Terminal** panel MUST restore with **≥1 tab** even if the snapshot lists none for it (it always keeps ≥1, §4.2/§4.11).                                       |

### Scope 2 — composed generated-UI surfaces restored verbatim

| ID     | Requirement                                                                                                                                                                                                                                                                                  |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-012 | For a generative-panel tab whose surface is `composed: true`, the snapshot MUST persist that tab's surface **spec** (the A2UI `UiRenderPayload['spec']` stored in `TabSurface`) so it can be re-filed verbatim.                                                                                  |
| FR-013 | On relaunch, a persisted composed surface MUST be re-filed into its tab **without** re-composing, re-invoking `claude`, or any agent round-trip, and MUST keep `composed: true`. A fresh per-tab `requestId` MAY be minted for the restored surface (the old request is dead; nothing awaits it). |
| FR-014 | A tab that was `inFlight`, `loadingDefault`, or carried a transient `error` at quit (no settled composed surface) MUST restore as an empty/uncomposed tab on its panel base — transient run state MUST NOT be persisted or restored.                                                              |

### Scope 3 — live integration data NOT frozen

| ID     | Requirement                                                                                                                                                                                                                                                                  |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-015 | A generative-panel tab whose surface is **`composed: false`** (an unsolicited deterministic data view — Jira default board / search / ticket detail; Slack/Confluence native data) MUST NOT have its surface spec persisted. On relaunch such a tab MUST restore to its panel **base** and re-fetch fresh on demand (Jira re-requests its default view; Slack/Confluence show their native base). |
| FR-016 | Restoration MUST NOT carry any integration data, ticket/message/page content, search results, or cursors from the previous run; the only thing restored for these tabs is the tab shell (id/label/flags/active).                                                                |
| FR-017 | If an integration is disconnected or needs reconnect at relaunch, the restored tabs MUST surface that panel's existing not-connected / reconnect-needed state rather than any restored or re-fetched data.                                                                       |

### Scope 4 — terminal tabs: session resume, not process clone

| ID     | Requirement                                                                                                                                                                                                                                                                                                                       |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-018 | The system MUST NOT serialize or clone a live PTY / OS process. Terminal restoration MUST be **session resume**: re-spawning a fresh `claude` PTY that continues the same Claude Code session.                                                                                                                                       |
| FR-019 | For each terminal tab the system MUST record a stable **`claude` session id**. Per the verified CLI, the system MUST **mint a UUID and assign it at first spawn** via `--session-id <uuid>` (so no after-the-fact capture is needed) and persist `{ paneId, sessionId, cwd }` per terminal tab. cwd is the fixed sandbox dir (stable across restart). |
| FR-020 | On relaunch, for each persisted terminal tab the system MUST spawn a new PTY that **resumes** the recorded session via `--resume <sessionId>` (interactive/TUI mode), in the recorded cwd.                                                                                                                                            |
| FR-021 | The system SHOULD persist each terminal tab's **visible scrollback** (a bounded amount of xterm text) and, on relaunch, restore it into that tab's xterm as on-screen history before/independently of the resumed live session, so the user sees their prior terminal context.                                                       |
| FR-022 | If resume fails for a tab (the binary/transcript no longer supports the id, the id is rejected, or spawn errors), the system MUST fall back to: keep the tab (same label + cwd), show the restored scrollback as **read-only history**, and start a **fresh** `claude` session in that tab — never hang or crash. (See OQ for residual uncertainty.) |
| FR-023 | Per-terminal-tab session ids MUST be independent; resuming one tab MUST NOT affect another, and the multi-session `PtyManager` keying by `paneId` (§4.1) MUST be preserved.                                                                                                                                                          |

### Cross-cutting

| ID     | Requirement                                                                                                                                                                                                                              |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-024 | Restoration MUST NOT depend on or change the renderer-only originating-tab correlation invariant (§4.11) and MUST add **no new field to `UiRenderPayload`** — runs remain sequential; restored composed surfaces are filed client-side, not via a render frame from a run. |
| FR-025 | While the session is being restored the renderer MAY show a brief restore/loading affordance; the restored state MUST converge to a usable app even if some tabs fail to restore individually (a per-tab failure degrades only that tab). |

## Edge Cases & Constraints

- **Corrupt / unparseable snapshot** → warn + clean empty session (FR-005); never crash.
- **Schema-version mismatch** (older or newer than the running app understands) → treated as
  unreadable; clean empty session (FR-002/FR-005). No silent partial migration in v1.
- **Composed surface referencing a now-unavailable catalog component** (catalog changed
  between versions; unknown/invalid component) → that tab degrades to its existing per-tab
  surface error boundary (safe fallback, §4.4), sibling tabs unaffected.
- **Integration disconnected at restore** → tab shells restore; panel shows its
  not-connected / reconnect-needed state; no stale data (FR-017).
- **Terminal whose `claude` session can't resume** → fresh session + read-only scrollback
  history + same label/cwd (FR-022).
- **Very large scrollback** → scrollback persistence MUST be **bounded** (a cap on lines /
  bytes per terminal tab, the most-recent window kept); the snapshot MUST NOT grow unbounded.
  An oversized or absent scrollback MUST degrade gracefully (resume the session with empty
  on-screen history), never block restore.
- **Concurrent writers / mid-write quit** → the snapshot write MUST be safe against a crash
  mid-write (e.g. atomic write/rename) so a partial file never becomes the next startup's
  corrupt snapshot; a corrupt one still falls back per FR-005.
- **Out of scope (explicit):** cloning a live OS process / PTY; freezing live integration
  data as a stale snapshot; persisting any secret/token; cross-device or cloud sync;
  migrating old snapshot schemas; persisting transient run state (`inFlight`,
  `loadingDefault`, in-flight errors); persisting per-tab navigation derived state
  (`usePerTabNav`) beyond what re-fetch reconstructs.

## Success Criteria

| ID     | Criterion                                                                                                                                                              |
|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | After a full quit + relaunch, every panel's tab list, labels, untitled/renamed flags, and active tab match what was open at quit (Terminal keeps ≥1; zero-tab panels stay zero). |
| SC-002 | A `composed: true` surface is rendered identically after relaunch with no agent round-trip; a `composed: false` data view restores to its panel base and re-fetches fresh. |
| SC-003 | Each terminal tab resumes its recorded `claude` session (or, on resume failure, falls back to fresh session + read-only scrollback) — no PTY/process is cloned, none hangs. |
| SC-004 | Inspecting the on-disk snapshot reveals no token, no `client_secret`, and no integration data payloads — only tab structure, composed specs, and terminal session metadata + scrollback. |
| SC-005 | A corrupt / missing / wrong-version snapshot yields a clean empty session at startup with a warning log and no crash. |
| SC-006 | All renderer⇄main persistence traffic flows through the single new typed IPC namespace in `src/shared/ipc.ts`; invalid payloads are warned-and-ignored, never crash. |
| SC-007 | Scrollback persistence stays bounded per terminal tab; a very large terminal does not produce an unbounded snapshot and still restores. |

---

## Open Questions

- [ ] **OQ-1 — Resume robustness across `claude` versions / purged transcripts.** Resume via
  `--resume <id>` is confirmed available in interactive mode, and minting the id with
  `--session-id <uuid>` removes the capture problem. The residual uncertainty is *runtime
  reliability*: whether a resumed interactive session reliably replays usable context in every
  `claude` version cosmos ships against, and the exact failure signal when a transcript was
  removed (e.g. via `claude project purge`) or the id is rejected. FR-022 specifies the
  graceful fallback (fresh session + read-only scrollback) so this uncertainty cannot break
  the feature, but the **detection mechanism** for "resume failed" (exit code/signal vs. a
  silent fresh session) needs to be pinned down during planning/implementation. Not blocking
  the spec — the fallback path is fully specified.

- [ ] **OQ-2 — Design step.** This feature is almost entirely main/IPC/renderer-state work
  with **no new visual surface**. The only possible UI is a brief restore/loading affordance
  (FR-025), which reuses existing spinner/skeleton patterns. Recommendation: **skip the
  dedicated `design` step** unless the team wants a distinct first-paint restore state; if so,
  it is a minimal extension of existing loading states, not new design-system work. Flag for
  the orchestrator to confirm.
