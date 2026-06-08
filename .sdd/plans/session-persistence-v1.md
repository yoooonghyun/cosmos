# Plan: Session Persistence — v1

**Status**: Draft
**Created**: 2026-06-08
**Last updated**: 2026-06-08
**Spec**: .sdd/specs/session-persistence-v1.md

---

## Grounding

> Investigation run directly with codegraph + agentmemory for the *plan* (the spec's
> grounding established the architecture/feasibility; this layer pins down the exact code
> seams the plan edits). Design step is **confirmed skipped** (OQ-2): main/IPC/renderer-state
> work, the only UI is a brief restore affordance reusing existing spinner/skeleton patterns.

- **`src/renderer/usePanelTabs.ts`** — `usePanelTabs<T>(initial = { tabs: [], activeTabId: null })`
  already takes an **`initial` seed** and stores it in `useState`. This is the rehydration seam:
  the renderer just passes a snapshot-derived `TabsState<T>` as `initial` instead of empty/default.
  No hook signature change needed — only the *call sites* change what they pass.
- **`src/renderer/panelTabs.ts`** — the StrictMode-purity contract is explicit:
  `seedTerminalIndex()` returns the constant `1`, the seed `useState` initializer must stay
  referentially **pure** (no counter mutation), and `nextTerminalIndex(everOpened)` only advances
  from event handlers / the empty-refill effect. The generative seed counter is `everOpenedRef`
  in `useGenerativePanelTabs.ts`, advanced only off render-phase. **Rehydration must seed these
  counters from the restored max index, still without mutating a ref during render** — I add pure
  helpers (`seedEverOpenedFrom(tabs)`) so the lazy `useState` initializer stays pure.
- **`src/renderer/useGenerativePanelTabs.ts`** — `GenerativeTab` is the record; `controller =
  usePanelTabs<GenerativeTab>()` is currently called with **no `initial`** (always empty). The
  hook owns `everOpenedRef` (seed-label counter) and the originating-tab correlation refs. To
  rehydrate, `useGenerativePanelTabs(options)` must accept an optional `initial:
  TabsState<GenerativeTab>` and seed both `usePanelTabs` and `everOpenedRef.current` from it.
  Transient fields (`inFlight`, `loadingDefault`, `error`) are **stripped** at snapshot build time
  (FR-014), and a `composed:false` tab's `surface` is **dropped** to `null` (FR-015).
- **`src/renderer/TerminalPanel.tsx`** — seeds `usePanelTabs<TerminalTab>(initial)` from a lazy
  `useState` (`{ tabs: [first], activeTabId }`) and `everOpened = useRef(seedTerminalIndex())`.
  `TerminalView` calls `window.cosmos.pty.start(paneId)` in its mount effect and renders streamed
  `pty:data`. Rehydration seeds the tab list from the snapshot and pre-writes restored scrollback
  into the xterm before/around `start`.
- **`src/main/ptyManager.ts`** — `start(paneId)` spawns `pty.spawn(command, args, { cols, rows,
  cwd, env })` with `args = this.options.args ?? []` (manager-wide, **no per-pane args today**).
  cwd is the single fixed sandbox dir for every pane. This is THE change point for terminal
  resume: `start` must accept **per-pane args** (the `--session-id`/`--resume` flags). `restart`
  delegates to `start`; `kill`/`killAll` already tear down cleanly.
- **`src/main/index.ts`** — `resolveSandboxDir() = join(app.getPath('userData'),'sandbox')`;
  managers built in `createWindow`, torn down on close/quit; `userData` is the on-disk root.
  `PtyManager` is constructed here with `{ cwd }` and wired to IPC sinks. The new
  `SessionStore` is constructed here too, and `pty:start`'s main-side handler resolves the
  per-pane session flags before calling `ptyManager.start`.
- **`src/shared/ipc.ts`** — single typed contract; `CosmosApi = { pty, ui, slack, jira,
  confluence, agent, shortcuts }`. Add **one namespace `session`** (load + save). `PtyStartPayload
  = { paneId }` — extend with an optional resume hint OR (preferred) keep the renderer thin and
  resolve session flags entirely in main from the SessionStore keyed by `paneId`.
- **`src/main/integrations/tokenStore.ts`** — the **store precedent**: injectable `fs`/`safeStorage`
  behind small interfaces, `load()` defensive (`try/catch` → `null`, never throws), `save()` writes
  one file under `userData`. The `SessionStore` copies this *shape* (injectable `fs`, defensive
  load, warn-and-fall-back) but is **non-secret JSON → NOT encrypted** (no `safeStorage`).
- **`src/renderer/App.tsx`** — five panels `forceMount`-ed; `surface` state only. Each panel owns
  its own tabs. Rehydration is per-panel (each panel seeds from its slice of the snapshot); App
  needs only to ensure the snapshot is **loaded before panels mount** (see save/load timing).
- **agentmemory** — `mem_mq59qkzg_ae4153154396` (terminal resume via `--session-id`/`--resume`,
  saved during the spec). `memory_recall` returned no other prior persistence decisions.

---

## Summary

Add a main-process, on-disk, schema-versioned **session snapshot** (`SessionStore`, a non-secret
JSON file under `app.getPath('userData')/session/session.json`, built on the `tokenStore.ts`
injectable-fs + defensive-load shape but without encryption). Expose it to the renderer through one
new typed IPC namespace `window.cosmos.session` (`load` + `save`), validated at the main boundary;
a corrupt/old-schema/missing snapshot warns and yields a clean empty session. The renderer builds a
serializable snapshot (per-panel tab structure + `composed:true` surface specs verbatim;
`composed:false` data surfaces and all transient run state excluded) and writes it debounced on
state change + on teardown. On startup the renderer loads the snapshot once and seeds each panel's
`usePanelTabs`/`useGenerativePanelTabs`/terminal tabs from it (via the existing `initial` seam and
new **pure** counter-seed helpers, preserving the StrictMode-purity + monotonic-counter
invariants). Terminal tabs resume their `claude` session: cosmos **mints a UUID** and assigns it
via `claude --session-id <uuid>` at first spawn (new per-pane args on `PtyManager.start`), persists
`{ paneId, sessionId, cwd }`, and on relaunch spawns with `claude --resume <sessionId>` plus
restores bounded scrollback; if resume fails it falls back to a fresh session with read-only
scrollback (FR-022). No change to `UiRenderPayload`; the sequential-runs correlation invariant is
untouched.

## Technical Context

| Item              | Value                                                                                                   |
|-------------------|---------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + preload + renderer/React), vitest                                            |
| Key dependencies  | Existing only — `node:fs`, `app.getPath('userData')`, node-pty, xterm `@xterm/addon-serialize` (NEW, for scrollback capture — see Decision D4); NO new runtime deps in main |
| Files to create   | `src/main/sessionStore.ts`, `src/main/sessionStore.test.ts`, `src/main/sessionSnapshot.ts` (pure shape/validate/merge helpers) + `.test.ts`, `src/renderer/sessionSnapshot.ts` (pure renderer-side build/strip helpers) + `.test.ts` |
| Files to modify   | `src/shared/ipc.ts`, `src/shared/validate.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/ptyManager.ts`, `src/renderer/panelTabs.ts`, `src/renderer/usePanelTabs.ts`, `src/renderer/useGenerativePanelTabs.ts`, `src/renderer/TerminalPanel.tsx`, the four generative panels (`GeneratedUiPanel.tsx`, `JiraPanel.tsx`, `SlackPanel.tsx`, `ConfluencePanel.tsx`), `src/renderer/App.tsx` (load-before-mount), `docs/ARCHITECTURE.md` (deferred to post-approval) |

---

## Architecture / approach detail

### A. On-disk snapshot store (main) — `SessionStore`

- **Path:** `join(app.getPath('userData'), 'session', 'session.json')` (dir created on save). One
  file (matches `tokenStore` single-blob convention).
- **Shape:** modeled on `TokenStore` — `SessionStoreDeps { filePath, dirPath, fs: FsLike, now? }`,
  injectable `fs` so it is unit-testable without Electron. **No `safeStorage`** — the snapshot is
  non-secret (FR-006), so it is plain JSON (readable for debugging, no keychain dependency).
- **`load(): SessionSnapshot | null`** — defensive, mirroring `tokenStore.load`: missing file →
  `null`; read/parse/validate inside `try/catch`; a parse error, failed validation, or unknown
  `schemaVersion` → warn + return `null` (FR-005/FR-002). Never throws. Validation delegates to a
  pure `validateSnapshot` in `sessionSnapshot.ts`.
- **`save(snapshot): void`** — `mkdirSync(dir,{recursive:true})` then an **atomic write**
  (`writeFileSync(tmp)` + `renameSync(tmp, filePath)`) so a crash mid-write can never leave a
  half-written file as the next startup's snapshot (spec edge case). Caches in-process.
- **Save/load timing:**
  - **Load:** once at startup, BEFORE the renderer mounts its panels. Mechanism: the renderer
    calls `window.cosmos.session.load()` and `App` gates panel mount on the resolved snapshot
    (a tiny "restoring…" state — FR-025 — that reuses the existing `CosmosSpinner`). Because the
    panels seed their tabs from `initial` at first mount (lazy `useState`), they MUST NOT mount
    until the snapshot is in hand; App holds a `snapshot | 'loading'` state and renders the rail +
    a spinner until `load()` resolves, then mounts the panels with the snapshot in context.
  - **Save:** the renderer owns the source of truth (tab state lives in React). A small
    `useSessionPersistence` coordinator subscribes to each panel's persisted state and calls
    `window.cosmos.session.save(snapshot)` **debounced (~500ms)** on any persisted change (tab
    open/close/rename/activate, a composed surface landing, a terminal session-id assignment /
    scrollback advance), AND **flushed on teardown** (`beforeunload` in the renderer → a final
    synchronous save IPC; plus a main-side `before-quit`/window-`close` safety net that persists
    the last-known snapshot it already holds). Debounce avoids disk thrash (FR-007).
  - **Scrollback** is the heaviest field; it is captured lazily (on teardown + on a coarse timer),
    not on every keystroke — see D4.

### B. IPC contract — one new namespace (`src/shared/ipc.ts`)

```
interface SessionApi {                       // window.cosmos.session
  load(): Promise<SessionSnapshot | null>    // M->R read at startup; null => clean empty
  save(snapshot: SessionSnapshot): void      // R->M persist (validated + debounced upstream)
}
// add `session: SessionApi` to CosmosApi
```

- `load` is `Promise`-returning (an `ipcRenderer.invoke` round-trip) so the renderer can await it
  before mounting panels. `save` is fire-and-forget (`ipcRenderer.send`).
- **Validation at the main boundary** (`src/shared/validate.ts` gets `validateSessionSnapshot`):
  every inbound `save` payload is validated; an invalid payload is **warned and ignored**, never
  crashes, never overwrites a good snapshot (FR-004). `load` returns `null` on any read/validate
  failure (FR-005). The validator is a pure function with an injectable logger (project
  convention), unit-tested in `sessionSnapshot.test.ts` / `validate.test.ts`.

### C. Snapshot schema (serializable) — `src/main/sessionSnapshot.ts` (shared shape)

```
interface SessionSnapshot {
  schemaVersion: 1
  panels: {
    terminal:    { tabs: TerminalTabSnap[];    activeTabId: string | null; everOpened: number }
    'generated-ui': GenerativePanelSnap
    jira:        GenerativePanelSnap
    slack:       GenerativePanelSnap
    confluence:  GenerativePanelSnap
  }
}
interface TerminalTabSnap {
  id: string                 // = paneId
  label: string
  renamed?: boolean
  sessionId: string          // the minted claude UUID (FR-019)
  cwd: string                // the sandbox dir (stable; recorded for forward-safety)
  scrollback?: string        // bounded serialized xterm text (FR-021/SC-007), optional
}
interface GenerativePanelSnap {
  tabs: GenerativeTabSnap[]; activeTabId: string | null; everOpened: number
}
interface GenerativeTabSnap {
  id: string
  label: string
  untitled: boolean
  renamed?: boolean
  // surface persisted ONLY when composed === true (FR-012/FR-013); else omitted (FR-015)
  surface?: { spec: UiRenderPayload['spec'] }   // requestId is re-minted on restore; not stored
  composed?: true                               // only the true case is ever serialized
}
```

- **EXCLUDED by construction (no field exists in the snap type):** `inFlight`, `loadingDefault`,
  transient `error`, any `composed:false` surface, any integration data / cursors / tokens, the
  live PTY, `usePerTabNav` derived state. This makes FR-006/FR-014/FR-015/FR-016 structural, not a
  runtime filter that could be forgotten.
- `everOpened` per panel is persisted so the monotonic seed counter survives restart (FR-010); on
  load it is reconciled with `max(restored tab indices)` via a pure helper (defensive against a
  hand-edited file).

### D. Renderer build + strip helpers — `src/renderer/sessionSnapshot.ts` (pure)

- `buildGenerativePanelSnap(tabs, activeTabId, everOpened): GenerativePanelSnap` — maps live
  `GenerativeTab[]` → snap, **dropping** transient fields and any `composed!==true` surface.
- `buildTerminalSnap(...)`, `hydrateGenerativeTabs(snap): { initial: TabsState<GenerativeTab>,
  everOpened }`, `hydrateTerminalTabs(snap)` — inverse, re-minting a fresh `requestId` for each
  restored composed surface (FR-013) and stamping `composed:true`.
- `seedEverOpenedFrom(snap | tabs): number` — pure; lets the lazy `useState`/`useRef` initializers
  seed the counter from restored data **without mutating during render** (preserves the
  StrictMode-purity invariant — same rule as `seedTerminalIndex()`).
- All pure → node-tested in `sessionSnapshot.test.ts` (the `.ts`/`.test.ts` split; no `.tsx`
  import).

### E. Renderer rehydrate wiring (the four generative panels + Terminal)

- `useGenerativePanelTabs(options)` gains an optional `options.initial: TabsState<GenerativeTab>`;
  it passes it to `usePanelTabs<GenerativeTab>(initial)` and seeds `everOpenedRef.current =
  seedEverOpenedFrom(initial)`. Restored composed surfaces are already in `initial.tabs` (no
  re-compose, no agent round-trip — FR-013). Correlation refs start idle (no in-flight run is
  restored — FR-024).
- Each generative panel reads its snapshot slice (from the App-provided snapshot context) and
  passes `initial` into `useGenerativePanelTabs`. A `composed:false` tab restores with
  `surface:null` → its panel **base** renders and Jira's first activation re-requests its default
  view via the existing `newTabWithDefault` path (FR-015) — no new fetch machinery.
- `TerminalPanel` seeds `usePanelTabs<TerminalTab>(initial)` from the snapshot (≥1 tab guaranteed —
  if the snapshot lists none, fall back to the existing single-default seed, FR-011) and
  `everOpened` from `seedEverOpenedFrom`. Each `TerminalView` pre-writes its restored `scrollback`
  into the xterm on mount (`term.write(scrollback)`), then calls `pty.start(paneId)` — which main
  resolves to a `--resume <sessionId>` spawn.
- **App.tsx**: `await window.cosmos.session.load()` once; hold `loading | snapshot`; render rail +
  `CosmosSpinner` while loading; on resolve, mount the five panels passing the snapshot down (a
  small React context or props). Panels still `forceMount` after that point (unchanged).

### F. Terminal resume (main) — `--session-id` / `--resume`

- **First spawn:** when a terminal tab is created with **no recorded session id**, main mints a
  UUID (`crypto.randomUUID()`), records `{ paneId, sessionId, cwd }`, and `PtyManager.start` spawns
  `claude --session-id <uuid>` (+ the existing `--mcp-config` etc. — note: the TUI `claude` is the
  *interactive* path, distinct from the headless `AgentRunner`; confirm the interactive spawn's
  existing arg set when implementing). The minted id is surfaced to the renderer so it lands in the
  snapshot (cleanest: main keeps the paneId→sessionId map and includes it when the renderer builds
  the snapshot via `session.save`; OR main stamps it — resolve in Phase 1, see Decision D2).
- **Relaunch:** the snapshot's `TerminalTabSnap.sessionId` is known per pane. On `pty:start` for a
  restored pane, main looks up the recorded session and spawns `claude --resume <sessionId>`
  (interactive). `cwd` is the sandbox dir (stable).
- **Per-pane args** are **new** on `PtyManager.start` — today `args` is manager-wide
  (`options.args`). Change: `start(paneId, opts?: { args?: string[] })` (or a `sessionId`/`resume`
  hint resolved inside `start` from an injected lookup). `restart` keeps a pane on the SAME session
  id (re-resume, not a new id) so a manual restart does not lose context.
- **Fallback (FR-022):** if the resumed spawn exits immediately with an error/abnormal code
  (resume rejected — purged transcript, downgraded binary, bad id), main retries **once** with a
  fresh `--session-id <newUuid>` (fresh session), keeps the tab + cwd, and the renderer keeps the
  restored scrollback on screen as read-only history. Detection signal (exit code vs. silent) is
  **OQ-1** — pinned in Phase 1; the retry-on-abnormal-exit path is the safety net regardless.

---

## Implementation Checklist

> Update as work progresses; add inline notes on any deviation. Phases map to sdd Steps 3/4/5.

### Phase 1 — Interface (sdd Step 3)

- [x] Re-read `.sdd/specs/session-persistence-v1.md`; confirm OQ-1 (resume-failure detection
      signal) and OQ-2 (design skipped — confirmed) are settled before coding. **OQ-1 settled:
      abnormal exit (non-zero code or non-zero signal) within `RESUME_FAILURE_WINDOW_MS`=4000.**
- [x] `src/shared/ipc.ts`: add `SessionApi` (`load`/`save`) + `session` on `CosmosApi`; add
      `SessionSnapshot` + sub-types. No `UiRenderPayload` change (FR-024). **D2 chose Option A
      (main owns the id), so `PtyStartPayload` was NOT extended — main resolves resume flags.**
- [x] `src/main/sessionSnapshot.ts`: pure `SessionSnapshot` types + `validateSnapshot` +
      `reconcile*` helpers (no Electron import). **DEVIATION: `validateSnapshot` lives HERE, not in
      `src/shared/validate.ts` — shared cannot import main, and snapshot validation is a
      main-boundary-only concern.**
- [x] `src/renderer/sessionSnapshot.ts`: pure build/hydrate/strip helpers (`buildGenerativeTab`/
      `buildGenerativePanel`, `buildTerminalDraft`, `hydrate*`, `capScrollback`, re-export
      `seedEverOpenedFrom`).
- [x] `src/renderer/panelTabs.ts`: added pure `seedEverOpenedFrom(everOpened, tabCount)` consistent
      with `seedTerminalIndex()` (render-phase seeding stays pure — StrictMode invariant).
- [x] ~~`src/shared/validate.ts`: declare `validateSessionSnapshot`~~ **DROPPED — see deviation
      above; validation lives in `src/main/sessionSnapshot.ts`.**
- [x] Review types vs spec — every field traces to an FR; no invented properties; transient +
      `composed:false` fields are structurally absent.

### Phase 2 — Testing (sdd Step 4)

- [x] `src/main/sessionStore.test.ts`: happy-path save→load round-trip; missing file → `null`;
      corrupt JSON → warn + `null` (FR-005); unknown `schemaVersion` → `null` (FR-002); atomic write
      (tmp+rename) leaves no partial file; refuses-invalid keeps existing file; injected `fs` asserts
      on-disk bytes are plain JSON with **no token/secret** (SC-004).
- [x] `src/main/sessionSnapshot.test.ts`: `validateSnapshot` accepts a good snapshot, rejects
      malformed / wrong-version / non-array tabs (warns, no throw); drops bad tabs; keeps a surface
      only when `composed:true`; `reconcile*` derive max index (FR-010).
- [x] `src/renderer/sessionSnapshot.test.ts`: build drops `inFlight`/`loadingDefault`/`error`
      (FR-014) and any `composed:false`/errored surface (FR-015); keeps `composed:true` spec verbatim
      (FR-012); hydrate re-mints `requestId` + stamps `composed:true` (FR-013); `seedEverOpenedFrom`
      pure + handles empty/missing (FR-010/FR-011); `capScrollback` UTF-8-boundary tail.
- [x] `src/renderer/sessionRegistry.test.ts` (NEW, replaces the dropped `validate.test.ts` item):
      `assembleSnapshot` merges 5 panels w/ empty defaults; `SessionRegistry` trailing-debounce +
      `flush()` immediate save. (Main-boundary validation is covered by `sessionSnapshot.test.ts`.)
- [x] PtyManager resume tests (extended): `start` passes `--session-id <uuid>` on first spawn and
      `--resume <id>` on a recorded pane (injected fake `spawn`+`now`); fallback fires
      `onResumeFailure` on abnormal exit inside the window (FR-019/FR-020/FR-022/FR-023).

### Phase 3 — Implementation (sdd Step 5)

- [x] `src/main/sessionStore.ts`: `SessionStore` (injectable `SessionFsLike` w/ `renameSync`,
      defensive `load`, atomic `save` validating via `validateSnapshot`, no encryption) per the
      `tokenStore` shape.
- [x] ~~`src/shared/validate.ts`: implement `validateSessionSnapshot`~~ **DROPPED — impl is
      `validateSnapshot` in `src/main/sessionSnapshot.ts`.**
- [x] `src/preload/index.ts`: exposed `window.cosmos.session` (`load` via `invoke`, `save` via
      `send`). **preload edit ⇒ full `npm run dev` restart, not HMR.**
- [x] `src/main/index.ts`: constructs `SessionStore`; wires `ipcMain.handle('session:load')` +
      `ipcMain.on('session:save')` (`enrichSnapshotForSave` validates inbound → ignore-on-invalid);
      owns `terminalSessionMap` + `terminalResumeMap`; `paneSpawnFor` resolves per-pane resume flags
      before `ptyManager.start`; `onResumeFailure` re-mints + restarts once.
      **DEVIATION (D2): renderer sends terminal tabs WITHOUT sessionId/cwd (it cannot know the
      main-owned id); `enrichSnapshotForSave` fills them from `terminalSessionMap` and DROPS panes
      with no live session. Save teardown-flush is renderer-side (`pagehide`/`beforeunload`) — no
      separate main `before-quit` net needed since enrich runs on each `session:save`.**
- [x] `src/main/ptyManager.ts`: per-pane args on `start(paneId, PaneSpawnOptions)`
      (`--session-id`/`--resume`/fresh-id fallback); injectable `spawn`/`now`; `onResumeFailure`
      sink on abnormal exit within window.
- [x] `src/renderer`: `App.tsx` load-before-mount + `CosmosSpinner`; `SessionProvider`/
      `SessionRegistry` debounced-save + `flush()` teardown coordinator (replaces the planned
      `useSessionPersistence` name); panels seed via `useRestoredGenerativePanel`/
      `useRestoredTerminalPanel` + `useReportPanel`; scrollback via `@xterm/addon-serialize` (D4)
      bounded by `capScrollback` 256KB (D5/SC-007).
- [x] All tests pass (`npm test` — 743 passed, 37 files); `npm run typecheck` green; `npm run build`
      clean.
- [x] Reused shared utilities — `usePanelTabs` `initial` seam, `tokenStore` store shape, existing
      Jira default-view re-fetch path — no duplicated logic.

### Phase 4 — Docs (post-approval)

- [ ] `docs/ARCHITECTURE.md`: new **§4.12 Session Persistence** (main `SessionStore`, schema,
      `window.cosmos.session` contract, `composed`-only surface restore, live-data re-fetch,
      terminal `--session-id`/`--resume` resume + fallback) and one-line cross-refs from §4.1/§4.2
      (per-pane args + session id), §4.11 (tabs now persist; the "session-only" annotations
      updated), and a §7 Open Questions / Next Steps entry. **Deferred until this plan is approved.**
- [x] `docs/DEVELOPMENT.md`: added the **Session persistence** subsection (atomic JSON store,
      `composed` structural rule, D2 main-owned id + enrich, resume-failure, scrollback cap,
      save coordinator, StrictMode-safe restore seeding). **`docs/PROJECT-STRUCTURE.md` and
      `docs/ARCHITECTURE.md` §4.12 still pending (architect-owned / wrap-up).**
- [ ] `TODO.md`: check off session-persistence-v1 (wrap-up).
- [x] Update this plan with deviations (below).

---

## Decisions needing sign-off

- **D1 — Snapshot is plain (unencrypted) JSON.** It is non-secret (FR-006); encryption is reserved
  for tokens (`tokenStore`). Keeps it debuggable and keychain-free. (Recommend: accept.)
- **D2 — Where the minted session id lives.** Option A: **main mints + owns** the paneId→sessionId
  map and includes it when the renderer saves (renderer stays unaware of flags; cleanest secret/
  process boundary). Option B: renderer mints the UUID (it already mints `paneId`) and passes it on
  `pty:start`. Recommend **A** (main owns process/session concerns; renderer owns layout). Confirm.
- **D3 — Restore-time UX.** A brief full-panel "restoring…" spinner (existing `CosmosSpinner`)
  while `session.load()` resolves, then mount. Minimal, no design step (OQ-2). (Recommend: accept.)
- **D4 — Scrollback capture dependency.** Use `@xterm/addon-serialize` to capture bounded xterm
  scrollback text (the supported xterm way) — a NEW small dev/runtime dep in the renderer only.
  Alternative: accumulate `pty:data` in the renderer ourselves (no dep, but re-implements xterm's
  serializer and risks ANSI-state drift). Recommend the addon. Confirm the new dep is acceptable.
- **D5 — Scrollback bound.** Cap per-tab scrollback to the most-recent ~N lines/bytes (e.g. the
  visible viewport + a few screens, or ~64KB) to keep the snapshot small (SC-007). Exact cap set in
  Phase 1; flag if you want a specific limit.

## Deviations & Notes

- **2026-06-08**: Plan authored. No code written. `docs/ARCHITECTURE.md` edit deferred to
  post-approval (Phase 4). Awaiting sign-off on D1–D5 and OQ-1 (resume-failure detection signal).
- **2026-06-08 (impl)**: Steps 3/4/5 implemented. Verification: `npm run typecheck` green,
  `npm test` 743 passed (37 files), `npm run build` clean. Decisions built to: D1 plain JSON +
  atomic tmp/rename; D2 **Option A** (main owns the session id); D3 `CosmosSpinner` restore; D4
  `@xterm/addon-serialize`; D5 256KB cap; OQ-1 abnormal exit within 4000ms → retry once with fresh
  `--session-id`, restored scrollback read-only.
  **Deviations from the plan:**
  1. **`validateSnapshot` lives in `src/main/sessionSnapshot.ts`, not `src/shared/validate.ts`.**
     Shared cannot import main and snapshot validation is a main-boundary-only concern, so the
     planned `validateSessionSnapshot` in shared was dropped. `validate.test.ts` was likewise
     replaced by `sessionSnapshot.test.ts` + `sessionRegistry.test.ts`.
  2. **D2 split: renderer sends terminal tabs WITHOUT sessionId/cwd.** The renderer cannot know the
     main-owned `claude` session id, so terminal contributions omit it; main's `enrichSnapshotForSave`
     fills sessionId/cwd from `terminalSessionMap` at the `session:save` boundary and DROPS any pane
     with no live session (not resumable). The save-coordinator name is `SessionRegistry`/
     `SessionProvider` (not the planned `useSessionPersistence`); teardown flush is renderer-side
     (`pagehide`/`beforeunload`), no separate main `before-quit` net.
  **Pending (architect / wrap-up, not developer):** `docs/ARCHITECTURE.md` §4.12 + §4.1/§4.2/§4.11
  cross-refs; `docs/PROJECT-STRUCTURE.md` new-file entries; `TODO.md` check-off.
