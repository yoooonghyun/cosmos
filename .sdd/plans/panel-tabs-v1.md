# Plan: VS Code-style tabs within each rail panel — v1

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: `.sdd/specs/panel-tabs-v1.md`

---

## Summary

Give each of the five rail surfaces (Terminal, Generated UI, Slack, Jira, Confluence) its
own independent, session-only set of VS Code-style tabs. The work splits cleanly into two
tracks. **Track A (non-visual contract):** the Terminal panel changes from a single shared
PTY to **one PTY per terminal tab** — `PtyManager` becomes multi-session keyed by a
renderer-minted `paneId`, and every `pty:*` IPC payload gains that `paneId`; this is the
only shared-contract / main-process change. **Track B (renderer):** a reusable tab-strip +
per-panel tab-state model. Generative panels (Generated UI / Slack / Jira / Confluence)
keep today's `target`-routed A2UI rendering, but each open tab now owns its own surface
state and its own `A2UIProvider` + `SurfaceBridge` subtree; the panel mounts only the
active tab's subtree (others keep their last surface in React state, restored on switch).
Because the `AgentRunner` is **sequential (one run app-wide)**, a run's surface is
correlated to its **originating tab purely in the renderer** — the composing panel records
which of its tabs was active at submit time and, when the next matching `ui:render`
(`target`) arrives, files it into that tab. No new render-routing field is added to
`UiRenderPayload`; the existing `target` still routes panel→panel, and the renderer adds
the tab dimension. This keeps the main/MCP/bridge surface untouched for generative panels
and confines the contract change to the multi-PTY Terminal path.

## Technical Context

| Item              | Value                                                                                                                                                                                                                                       |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + React renderer), Vitest                                                                                                                                                                              |
| Key dependencies  | node-pty (multi-session), xterm.js + addon-fit (one per terminal tab), `@a2ui-sdk/react` (one provider per active tab), shadcn/ui (tab-strip; design pass), existing `UiRenderPayload.target` routing, sequential `AgentRunner` (§4.10)     |
| Files to create   | `src/renderer/PanelTabStrip.tsx` (reusable tab strip — **needs a design pass**), `src/renderer/usePanelTabs.ts` (per-panel tab-state hook + logic), `src/renderer/panelTabs.ts` (pure tab-collection logic) + `src/renderer/panelTabs.test.ts`, `src/main/ptyManager.test.ts` (multi-session, if not present) |
| Files to modify   | `src/shared/ipc.ts` (add `paneId` to `Pty*` payloads + `PtyApi`), `src/shared/validate.ts` (validate `paneId`), `src/preload/*` (thread `paneId`), `src/main/ptyManager.ts` (multi-session map), `src/main/index.ts` (PTY IPC wiring per pane + lifecycle), `src/renderer/TerminalPanel.tsx` (one terminal per tab), `src/renderer/GeneratedUiPanel.tsx`, `src/renderer/SlackPanel.tsx`, `src/renderer/JiraPanel.tsx`, `src/renderer/ConfluencePanel.tsx` (tabify), `src/renderer/App.tsx` (host panels unchanged in rail behavior; per-panel tab strip lives inside each panel), `docs/ARCHITECTURE.md` (note multi-PTY + per-tab A2UI hosting) |

### Key code seams surveyed (ground truth)

- **Single PTY today.** `PtyManager` (`src/main/ptyManager.ts`) holds ONE `proc: IPty | null`;
  `index.ts` wires `PtyChannel.Input/Resize/Restart` to that single instance and streams
  `PtyChannel.Data/Exit` back with no pane discriminator. `TerminalPanel.tsx` creates one
  `Terminal` bound to those channels. → **Multi-PTY requires a contract change** (a `paneId`
  on every `pty:*` payload) so main can route input/resize/restart/data/exit to the right
  session. This is the one place the shared IPC contract and main process must change.
- **Render routing is panel-level only.** `UiRenderPayload.target` (`src/shared/ipc.ts`)
  routes a frame to a panel; each panel's `SurfaceBridge` filters `ui:render` by `target`
  and renders the single frame. There is **no tab/run correlation id** on the frame. →
  Because `AgentRunner` is **sequential** (single-run guard, §4.10), the renderer can
  correlate a frame to a tab without a new field: the panel that submitted records the
  originating tab id; the next `ui:render` for its `target` belongs to that tab.
- **Single surface per generative panel today.** Jira/Slack/Confluence/Generated-UI panels
  each hold one `surface: ActiveSurface | null` and one `<A2UIProvider>` + `SurfaceBridge`.
  Jira also fires `jira:requestDefaultView` on activation and re-pushes after `jira.*`
  writes. → Tabify by lifting surface state into a per-tab record and mounting the active
  tab's provider subtree. Jira's default-view + deterministic write re-push must target the
  **originating Jira tab** (renderer maps the incoming `target:'jira'` frame to the Jira
  tab that triggered it).
- **Composer submits `{ utterance, target }`** to `window.cosmos.agent.submit`; status
  arrives on `agent:status` (`started`/`completed`/`error`) app-wide (not per panel/tab).
  → The originating-tab correlation and in-flight indicator are renderer bookkeeping keyed
  off the app-wide status plus the locally-remembered originating tab.

### Render-frame → originating-tab correlation (the load-bearing decision)

`UiRenderPayload` is **unchanged** (no new field). Correlation is renderer-side and relies
on the sequential single-run guard:

1. On submit, the composing panel captures `originatingTabId = activeTabId` (auto-creating
   the first tab if zero are open, FR-012a) and marks that tab `in-flight` (FR-014).
2. The single in-flight run produces at most one terminal surface for the panel's `target`.
   When that panel's `SurfaceBridge` receives the next `ui:render` matching its `target`, it
   files the surface into `originatingTabId` and clears the in-flight mark (FR-013).
3. If `originatingTabId` was closed before the frame arrives, the frame is discarded
   (FR-027). On `agent:status` `error`, the originating tab shows the error (FR-015).
4. Jira's per-switch default view + post-write re-push are `target:'jira'` frames with no
   user utterance; they file into the **active Jira tab** (or auto-create the Jira panel's
   first tab on activation, preserving today's "default board appears on switch"). The
   `jira.*` deterministic re-push (fresh `requestId`) updates whichever Jira tab currently
   holds that issue's surface — tracked by the same originating-tab bookkeeping.

> **Note (not a v1 change):** if cosmos ever allows concurrent runs across panels, this
> renderer-only correlation breaks and a per-run/per-tab id on `UiRenderPayload` +
> `AgentSubmitPayload` would be needed. v1 explicitly keeps the sequential guard (spec
> Non-Goals), so we do NOT add that field now.

### Multi-PTY contract change (the one main/IPC change)

- `PtyManager` holds `Map<paneId, IPty>` instead of one `proc`. Methods take a `paneId`:
  `start(paneId)`, `write(paneId, data)`, `resize(paneId, payload)`, `restart(paneId)`,
  `kill(paneId)`, plus `killAll()` for teardown. `onData`/`onExit` sinks carry `paneId`.
- `src/shared/ipc.ts`: add `paneId: string` to `PtyDataPayload`, `PtyInputPayload`,
  `PtyResizePayload`, `PtyExitPayload`, and a `PtyRestartPayload { paneId }`; the `PtyApi`
  methods gain `paneId` (renderer mints it per terminal tab). Add an explicit
  **`pty:start` (R→M)** so a new terminal tab spawns its session (today the single PTY is
  started once at window create; per-tab needs an explicit spawn) and the renderer can
  request disposal via a **`pty:dispose` (R→M)** on tab close (kill that pane, no exit
  event needed). Keep `pty:restart` (now per-pane).
- `src/shared/validate.ts`: validate `paneId` (non-empty string) on every inbound `pty:*`
  payload; invalid → warn + ignore (existing discipline).
- `src/main/index.ts`: route each `pty:*` handler by `paneId`; on window create no longer
  auto-start a single PTY — the Terminal panel's default tab issues `pty:start`. On
  quit/reload call `killAll()`.
- `TerminalPanel.tsx`: render one xterm `Terminal` per terminal tab (each its own
  FitAddon, data/exit subscription filtered by its `paneId`, input/resize/restart/dispose
  scoped to its `paneId`). All terminal tabs stay mounted (only hidden when inactive) so a
  live session + scrollback survive tab/rail switches (FR-025).

### Per-panel tab-state model (renderer)

- `usePanelTabs<TTab>()` hook owns: ordered `tabs`, `activeTabId`, and operations `open`,
  `close` (adjacent-activation per FR-006/FR-007), `setActive`, and `update(tabId, patch)`.
  Pure list logic (open/close/adjacent-pick/label-from-utterance/terminal-index) lives in
  `panelTabs.ts` and is unit-tested in `panelTabs.test.ts` (vitest, node env — no DOM).
- A tab record per panel type:
  - **generative tab:** `{ id, label, surface: ActiveSurface | null, inFlight: boolean,
    error?: string }`.
  - **terminal tab:** `{ id (=paneId), label: 'Terminal N', exitState }`.
- Each panel renders `<PanelTabStrip>` (the active tab styled, `X` per tab, `+`) above its
  content region. Generative panels mount the **active** tab's `<A2UIProvider>` +
  `SurfaceBridge`; inactive tabs keep their `surface` in the hook's state (restored on
  switch) — only the active subtree is mounted to avoid N providers fighting over the one
  `ui:render` channel. When `tabs.length === 0`, the panel shows its native base
  (Slack/Jira/Confluence) or idle placeholder (Generated UI) with the composer still
  present (FR-016/FR-017/FR-018).

### Reusable tab-strip UI — needs a DESIGN PASS

`PanelTabStrip.tsx` (tab strip: side-by-side tabs, active styling, per-tab `X`, `+`,
overflow horizontal scroll, in-flight/error affordance on a generative tab) is **UI-bearing
and must go through the `design` skill before implementation** — the designer owns a
reusable shadcn-based tab-strip component + its states (active / inactive / in-flight /
error / overflow) so all five panels stay visually uniform, producing
`.sdd/designs/panel-tabs-v1.md`. The Track-A multi-PTY contract work is non-visual and can
proceed in parallel with / ahead of the design pass.

---

## Implementation Checklist

> Living progress record. Track A (non-visual contract) lands before Track B (UI), per the
> "contract before UI" sequencing. The design pass gates Track B's visual pieces.

### Phase 0 — Spec confirmation

- [ ] Re-read `.sdd/specs/panel-tabs-v1.md`; confirm OQ-1 is resolved (FR-012a) and no open
  questions remain.

### Phase 1 — Track A: multi-PTY shared contract (non-visual, main/IPC)

- [x] `src/shared/ipc.ts`: add `paneId: string` to `PtyDataPayload`/`PtyInputPayload`/
  `PtyResizePayload`/`PtyExitPayload`; add `PtyRestartPayload`/dispose/start channel
  constants + payloads; extend `PtyApi` (`start(paneId)`, `sendInput`, `resize`, `restart`,
  `dispose(paneId)`, `onData`/`onExit` carry `paneId`). Trace each addition to FR-021..026.
- [x] `src/shared/validate.ts`: add/extend validators to require a non-empty `paneId` on
  every inbound `pty:*` payload; invalid → warn + ignore.
- [x] `src/preload/*`: thread `paneId` through the exposed `window.cosmos.pty` surface.

### Phase 2 — Track A: PtyManager multi-session + main wiring

- [x] `src/main/ptyManager.ts`: replace single `proc` with `Map<paneId, IPty>`; `start`/
  `write`/`resize`/`restart`/`kill` take `paneId`; add `killAll()`; sinks emit `paneId`.
  Keep the missing-binary pre-check per pane.
- [x] `src/main/index.ts`: route `pty:input/resize/restart/start/dispose` by `paneId`;
  remove single-PTY auto-start; emit `pty:data`/`pty:exit` with `paneId`; `killAll()` on
  quit/reload.
- [x] `src/main/ptyManager.test.ts`: spawn/dispose two panes independently; input/resize
  routed by `paneId`; disposing one leaves the other; `killAll` clears the map.

### Phase 3 — Track B prep: pure tab logic (non-visual, testable)

- [x] `src/renderer/panelTabs.ts`: pure functions — `openTab`, `closeTab` (adjacent-pick:
  right-else-left, FR-006/FR-007), `labelFromUtterance` (truncate, FR-010), terminal index
  labelling (FR-011), Untitled default (FR-009).
- [x] `src/renderer/panelTabs.test.ts`: open/close/adjacent-activation; close-active vs
  close-non-active; close-last → empty set; label derivation; terminal indexing.
- [x] `src/renderer/usePanelTabs.ts`: the hook wrapping the pure logic + `update(tabId,
  patch)` for surface / in-flight / error.

### Phase 4 — DESIGN PASS (gates the visual pieces)

- [ ] Hand off to the `design` skill: reusable shadcn-based tab strip + states (active /
  inactive / in-flight / error / overflow scroll), `+` and per-tab `X` affordances,
  terminal vs generative label treatment → `.sdd/designs/panel-tabs-v1.md`.

### Phase 5 — Track B: reusable tab strip + Terminal tabs

- [x] `src/renderer/PanelTabStrip.tsx` per the design spec (strip, active styling, `X`, `+`,
  overflow scroll, in-flight/error affordance).
- [x] `src/renderer/TerminalPanel.tsx`: one xterm `Terminal` per terminal tab (own FitAddon
  + `paneId`-scoped subscriptions); `+` → `pty:start` new pane; `X` → `pty:dispose`; always
  ≥1 terminal, closing the last opens a fresh default (FR-024); all tabs stay mounted
  (FR-025); per-tab restart (FR-026).

### Phase 6 — Track B: generative panels tabified

- [x] `GeneratedUiPanel.tsx`: tabs over idle placeholder (FR-018); active-tab provider;
  utterance fills active tab / auto-creates first tab (FR-012/FR-012a); originating-tab
  correlation (FR-013); in-flight + error per tab (FR-014/FR-015).
- [x] `SlackPanel.tsx`, `ConfluencePanel.tsx`: tabs over the native browser base (FR-017);
  same correlation; read-only preserved (FR-020).
- [x] `JiraPanel.tsx`: tabs over the default-board base; per-switch default view + `jira.*`
  deterministic write re-push file into the originating/active Jira tab (FR-019/FR-020);
  read+write preserved.
- [x] `App.tsx`: confirm rail switcher unchanged (panels stay force-mounted); per-panel tab
  strips live inside each panel; no global tab bar.

### Phase 7 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: (a) §4.1/§4.2 — PTY Manager is multi-session
  (one PTY per Terminal tab, keyed by `paneId`; `pty:*` payloads carry `paneId`); (b) §3 /
  §4.4 — each rail panel hosts an independent session-only set of VS Code-style tabs; a
  generative panel mounts the active tab's `A2UIProvider`/`SurfaceBridge`, and render frames
  route panel→panel by `target` (unchanged) then tab via renderer-side originating-tab
  correlation (safe only because runs stay sequential, §4.10).
- [ ] Reconcile `TODO.md` (wrap-up).
- [ ] Update this plan with any deviations.

---

## Deviations & Notes

- **2026-06-06**: OQ-1 resolved before planning — utterance with zero tabs auto-creates the
  first tab (spec FR-012a); plan encodes the correlation accordingly.
- **2026-06-06 (Track A, Phases 1–2 landed)**: Implemented the multi-PTY contract +
  main-process slice (interface→tests→implement). Notes:
  - `pty:start`, `pty:restart`, and `pty:dispose` are all `{ paneId }`-only payloads. To
    avoid three near-identical validators, `validate.ts` adds one shared
    `validatePaneId(raw, channel, warn)` helper and thin wrappers `validateStart` /
    `validateRestart` / `validateDispose` over it (each tagging its channel in the warning).
    Not a contract change — purely a DRY validator factoring.
  - `PtyManager.resize` is `resize(paneId, payload)` where `payload` is the full
    `PtyResizePayload` (which now itself carries `paneId`); `index.ts` passes
    `payload.paneId, payload`. The manager reads `cols`/`rows` from the payload and the
    `paneId` arg for routing — the payload's own `paneId` is redundant at that call but
    keeps the manager signature uniform with the other per-pane methods.
  - Each `PtySession` remembers its own `cols`/`rows` so a per-pane restart reuses that
    pane's last size (the old single-instance `this.cols/this.rows` became per-session).
  - **Renderer kept minimal (no Phase 5 UI):** `TerminalPanel.tsx` mints ONE stable
    `paneId` via `crypto.randomUUID()` (a `useRef`), issues `pty:start` on mount, threads
    the id through input/resize/restart, filters incoming `pty:data`/`pty:exit` by it, and
    `pty:dispose` on unmount. A `// Phase 5: multiple terminal tabs` marker flags where the
    tab strip will later mint multiple paneIds. Single-terminal behavior is preserved over
    the new per-pane contract.
  - **Not exercised at runtime:** the live single-terminal path (real `claude` spawn over
    the new `pty:start`/dispose contract) was NOT manually run — verification is
    typecheck + unit tests + build only. `npm run typecheck` (node + web) clean;
    `npm test` green (540 tests, incl. new `ptyManager.test.ts` 16 cases + extended
    `validate.test.ts`); `npm run build` bundles.
- **2026-06-06 (Track B, Phases 3/5/6 landed)**: Implemented the renderer tab layer
  (interface→tests→implement). Notes & deviations:
  - **Phase 3 pure logic factoring.** `panelTabs.ts` exports `TabsState<T>` +
    `openTab`/`closeTab`/`setActiveTab`/`updateTab` (all pure, never mutate, never
    overwrite `id`) + `adjacentActiveId` (right-else-left, FR-006/007), plus label helpers
    `labelFromUtterance` (whitespace-collapse + `…` truncate at 60, falls back to
    `'Untitled'`), `terminalLabel(index)` ("Terminal N", degrades to 1), and
    `nextTerminalIndex(everOpenedCount)` (monotonic — closed terminals are NOT renumbered,
    FR-011). Each mutator takes an optional `warn` callback so an invalid/missing required
    arg logs a warning and returns the state unchanged (safe fallback). `panelTabs.test.ts`
    has 30 node-env cases (happy path, missing optional fields, invalid/missing required →
    warn + fallback, purity).
  - **`usePanelTabs<T>` is generic** over the tab record so Terminal (`TerminalTab`) and the
    generative panels (`GenerativeTab`) share one controller (`tabs`, `activeTabId`,
    `activeTab`, `open`, `close`, `setActive`, `update`). No tab logic is inlined in any
    component — it all routes through `panelTabs.ts`.
  - **Shared `useGenerativePanelTabs` (NEW, not named in the plan).** The four generative
    panels need the SAME originating-tab correlation, so rather than re-inline it per panel
    I extracted one hook: it owns `submit` (mark active/auto-created tab in-flight + call
    `agent.submit({utterance, target})`), the panel-level `ui:render` subscription (file the
    frame into the originating tab, or discard if closed — FR-027; an UNSOLICITED frame with
    no originating tab lands in the active tab or auto-creates one — this is how Jira's
    default view + `jira.*` write re-push file in, FR-019/020), the `agent:status` error →
    originating tab (FR-015), `newTab`, and `closeTab`. This is the load-bearing decision
    from the plan body realized as a single hook.
  - **Shared `ActiveTabSurface` (NEW).** All four panels render the active tab's stored spec
    the same way (process `createSurface`+`updateComponents` on mount/surface change so a
    tab switch re-renders from stored state, FR-003; per-tab `SurfaceErrorBoundary` so a bad
    spec degrades to the error boundary without white-screening siblings, SC-005; forward
    SDK actions to `ui:action` submit, FR-006). The only per-panel differences are the
    catalog (provider) + `catalogId` + an optional `onAction` local intercept.
  - **`cancelOnClose` option.** Only `'generated-ui'` render_ui calls BLOCK in main awaiting
    the user's action (CLAUDE.md), so closing a Generated-UI tab holding an unresolved
    surface must send `{type:'cancel'}` to settle that call (else the run hangs). The other
    three targets are settled immediately by `UiBridge`, so they pass `cancelOnClose:false`.
    No main/MCP/bridge code changed — a stale requestId is already ignored in main.
  - **Slack open-channel intercept.** Slack's `SLACK_OPEN_CHANNEL_ACTION` is renderer-local
    navigation (it must NOT be forwarded to main): `ActiveTabSurface.onAction` returns true
    to mark it handled, the panel sets its native `history` view and closes the active
    generative tab so the native browser shows the channel (read-only preserved, FR-020).
  - **Jira default-view-on-activation.** `ConnectedBody` keeps the false→true `active`-edge
    detection but now auto-OPENS one tab (then `jira:requestDefaultView`) on the first show
    with no tab; the default board arrives as an unsolicited `'jira'` frame and the shared
    hook files it into that tab. The `DefaultViewSkeleton` shows until any tab holds a
    surface. `jira.*` write actions are forwarded by `ActiveTabSurface`; main's deterministic
    dispatcher re-pushes a fresh surface that lands in the active tab. Read+write preserved.
  - **App.tsx confirmed UNCHANGED:** rail is still the vertical Radix `Tabs` single-surface
    switcher, all five panels `forceMount` (hidden when inactive), `JiraPanel active=…` still
    passed. Per-panel tab strips live INSIDE each panel; there is no global tab bar.
  - **Contract untouched:** no change to `UiRenderPayload`/render routing or any
    main/MCP/bridge code — the tab dimension is renderer-only originating-tab correlation,
    valid only because headless runs stay sequential (§4.10).
  - **Verification:** `npm run typecheck` (node + web) clean; `npm test` green (570 tests,
    incl. `panelTabs.test.ts` 30 cases); `npm run build` bundles (renderer + preload + main +
    all MCP servers). **Not exercised at runtime:** the live tabbed UI (real terminal panes,
    real generative runs, real Jira default-view/write re-push, A2UI rendering, keyboard
    a11y on the strip) was NOT manually run — verification is typecheck + unit tests + build
    only. The `PanelTabStrip` a11y (roving tabindex, Arrow/Home/End, Enter/Space activate,
    Delete/Backspace close) and the originating-tab correlation across live runs are
    therefore unverified beyond static typing + the pure-logic unit tests.
